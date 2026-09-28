#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
符文战场 · 小程序卡牌接口离线拉取包（Colab 用）

用途
    在 Colab 里把官方小程序后端（lol-api.playloltcg.com/xcx）的「卡牌列表 + 每张卡详情」
    完整拉下来，存成一个自描述的 JSON 包，然后在站点的「数据同步」页用「导入拉取包」导入，
    走现有的同步审核步骤（待处理 / 新增 / 待更新 / 无变更）提交入库。

    这么做的原因：浏览器直连官方接口会被 WAF 限流（表现为 CORS 报错），
    Colab 出口 IP 干净而且可以慢慢拉；导入后网页端一个请求都不用发。

用法（Colab）
    新建一个单元格，把本文件整段粘进去直接运行；或者：
        !python colab_fetch_xcx_cards.py
    ── 只想先验证链路：SELF_TEST_ONLY = True 跑一次，只拉列表首页不写进度文件。
    ── 只想先试一个系列：FILTERS = {"searchContent": "VEN"}

包结构（formatVersion = 1）
    {
      "format": "riftbound-xcx-pull", "formatVersion": 1,
      "script": {"name": ..., "version": ...},
      "pulledAt": "2026-09-28T10:00:00+08:00", "baseUrl": ...,
      "filters": {...}, "pageSize": 25,
      "search":  {"params": {...}, "envelope": {"code": 0, "message": "操作成功", "result": [...]}},
      "details": {"OGN·061/298": {"code": 0, "message": "操作成功", "result": {...}}, ...},
      "icons":   {"key": {"code": 0, ...}}   # 可选，FETCH_KEYWORD_ICONS 打开才有
      "dict":    {"card_series": {"code": 0, ...}}  # 可选，FETCH_SERIES_DICT 打开才有
      "errors":  [{"cardNo": ..., "stage": "detail", "error": ...}],
      "stats":   {...}
    }
"""

from __future__ import annotations

import json
import os
import random
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

SCRIPT_NAME = "colab_fetch_xcx_cards.py"
SCRIPT_VERSION = "1.0.0"
PACKAGE_FORMAT = "riftbound-xcx-pull"
PACKAGE_VERSION = 1

# ══════════════════════════ CONFIG（要改就改这里） ══════════════════════════

BASE_URL = "https://lol-api.playloltcg.com/xcx"

# 列表分页：与网页在线拉取一致，25 条/页，直到空页为止（约 53 页 / 1306 行）。
PAGE_SIZE = 25

# 可选筛选，空字典 = 全量。实测（2026-09）服务端只认这三个：
#   searchContent   关键字，按系列拉就用它，如 {"searchContent": "VEN"} → 253 行
#   isErrata        True 只拉有勘误的卡
#   otherDesc       1 = 只看禁限/特殊标记
#   ⚠ productCodeList / cardSeriesList / cardCategoryList 传了服务端会返回 0 行，
#     不要用它们做筛选，否则列表为空、脚本会直接报错停下。
# 例：FILTERS = {"searchContent": "VEN"}
FILTERS: dict = {}

FETCH_DETAILS = True          # 逐印刷行拉详情（1306 行 ≈ 90–150 分钟串行）
FETCH_KEYWORD_ICONS = False   # 关键词图标：默认不拉，网页导入时按包里有没有自动检测
FETCH_SERIES_DICT = False     # 系列字典：同上
SELF_TEST_ROWS = 5            # 开跑前自检：拉首页并打印前几条 + 抽样测详情耗时
SELF_TEST_ONLY = False        # True = 只自检，不拉全量、不写进度文件

CONCURRENCY = 1               # 默认串行最稳；调大请自行承担被 WAF 限流的风险
GAP_MIN_MS = 800              # 每次请求之间的随机间隔下限
GAP_MAX_MS = 1600             # 上限
MAX_PACER_GAP_MS = 5000       # 触发限流后自动降速的封顶间隔
MAX_RETRIES = 6               # 单次请求最大重试次数
HTTP_TIMEOUT_SEC = 60
MAX_PAGES = 400               # 列表分页上限（25 × 400 = 1 万行，远超现有全表）
USER_AGENT = "riftbound-sync-colab/1.0 (+offline pull package)"

PROGRESS_FILE = "/content/xcx_progress.jsonl"   # 会话内续跑用；Colab 重启会丢
OUT_DIR = "/content"
DOWNLOAD_AT_END = True        # 收尾自动 files.download()

# ═══════════════════════════════════════════════════════════════════════════

RETRYABLE_STATUS = {403, 408, 429, 500, 502, 503, 504, 520, 522, 523, 524, 525, 526}


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def log(msg: str) -> None:
    print(msg, flush=True)


def human_sec(sec: float) -> str:
    sec = max(0, int(sec))
    h, rem = divmod(sec, 3600)
    m, s = divmod(rem, 60)
    return f"{h} 小时 {m} 分" if h else (f"{m} 分 {s} 秒" if m else f"{s} 秒")


def parse_retry_after(raw, now: float | None = None) -> float:
    """Retry-After：秒数或 HTTP 日期，返回毫秒；拿不到返回 0。"""
    if not raw:
        return 0.0
    value = str(raw).strip()
    if re.fullmatch(r"\d+(?:\.\d+)?", value):
        return max(0.0, float(value) * 1000)
    try:
        from email.utils import parsedate_to_datetime

        at = parsedate_to_datetime(value).timestamp()
        return max(0.0, (at - (now if now is not None else time.time())) * 1000)
    except Exception:
        return 0.0


class Pacer:
    """全局请求节流器（同网页 pacer）：串行预约启动时刻，重试后整体降速。"""

    def __init__(self, min_gap_ms: float, max_gap_ms: float):
        self.min = max(0.0, float(min_gap_ms))
        self.max = max(self.min, float(max_gap_ms))
        self._next = 0.0
        self._lock = threading.Lock()

    def wait(self) -> None:
        with self._lock:
            now = time.monotonic()
            at = max(now, self._next)
            self._next = at + random.uniform(self.min, self.max) / 1000.0
            delay = at - now
        if delay > 0:
            time.sleep(delay)

    def slow_down(self, factor: float = 2.0) -> None:
        with self._lock:
            self.min = min(MAX_PACER_GAP_MS, round(self.min * factor))
            self.max = min(MAX_PACER_GAP_MS, max(self.min, round(self.max * factor)))

    def label(self) -> str:
        return f"{self.min / 1000:.1f}–{self.max / 1000:.1f} 秒/次"


class RateLimited(Exception):
    """重试耗尽后的上游拒绝。"""


def request_json(path: str, body=None, method: str = "POST", pacer: Pacer | None = None,
                 quiet: bool = False) -> dict:
    """请求接口并返回 {code, message, result} 信封；可重试错误自动退避重试。"""
    url = BASE_URL.rstrip("/") + path
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    last_error = "未知错误"

    for attempt in range(MAX_RETRIES + 1):
        if pacer:
            pacer.wait()
        try:
            req = urllib.request.Request(
                url, data=data, method=method,
                headers={"Content-Type": "application/json", "Accept": "application/json",
                         "User-Agent": USER_AGENT},
            )
            with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_SEC) as resp:
                raw = resp.read().decode("utf-8", "replace")
                status = getattr(resp, "status", 200)
                retry_after = resp.headers.get("Retry-After")
        except urllib.error.HTTPError as exc:
            status = exc.code
            retry_after = exc.headers.get("Retry-After") if exc.headers else None
            raw = ""
        except Exception as exc:  # URLError / timeout / 连接被重置
            status = None
            retry_after = None
            raw = ""
            last_error = f"{type(exc).__name__}: {exc}"

        if status is not None and status not in RETRYABLE_STATUS:
            if status >= 400:
                raise RuntimeError(f"接口返回 HTTP {status}（{path}）")
            try:
                return json.loads(raw)
            except json.JSONDecodeError as exc:
                if attempt < MAX_RETRIES:
                    last_error = f"响应不是合法 JSON：{exc}"
                    wait_ms = 600 * 2 ** attempt + random.random() * 400
                else:
                    raise RuntimeError(f"响应不是合法 JSON（{path}）：{raw[:200]}") from exc
        elif status is None:
            last_error = last_error or "网络错误"
            wait_ms = 0
        else:
            last_error = f"HTTP {status}"
            wait_ms = 0

        if attempt >= MAX_RETRIES:
            if status is None:
                raise RateLimited(f"网络持续失败（{path}）：{last_error}")
            hint = "（限流/WAF，稍后重试）" if status in (403, 429) else ""
            raise RateLimited(f"HTTP {status}{hint}（{path}），已重试 {MAX_RETRIES} 次")

        backoff = 600 * 2 ** attempt + random.random() * 400
        retry_after_ms = parse_retry_after(retry_after)
        wait_ms = max(backoff, retry_after_ms, wait_ms)
        if pacer:
            pacer.slow_down()
        if not quiet:
            log(f"    ↻ {path} 失败（{last_error}），第 {attempt + 1}/{MAX_RETRIES} 次重试，"
                f"等 {wait_ms / 1000:.1f} 秒；节奏降为 {pacer.label() if pacer else '-'}")
        time.sleep(wait_ms / 1000.0)

    raise RateLimited(f"请求失败（{path}）：{last_error}")


def ensure_ok(envelope: dict, path: str) -> list:
    if not isinstance(envelope, dict) or envelope.get("code") != 0:
        message = (envelope or {}).get("message") if isinstance(envelope, dict) else envelope
        raise RuntimeError(f"接口返回错误 code={message!r}（{path}）")
    result = envelope.get("result")
    return result if isinstance(result, list) else []


def search_page(page: int, pacer: Pacer) -> dict:
    body = {"pageNum": page, "pageSize": PAGE_SIZE}
    body.update(FILTERS or {})
    return request_json("/card/searchCardCraft", body, pacer=pacer)


def detail_of(card_no: str, pacer: Pacer) -> dict:
    return request_json("/card/cardDetail", {"cardNo": card_no}, pacer=pacer)


def keyword_icon_of(key: str, pacer: Pacer) -> dict:
    return request_json(f"/cardDetailsConfig/getCardDetailsConfig/{urllib.parse.quote(key)}",
                        None, method="GET", pacer=pacer)


def series_dict(pacer: Pacer) -> dict:
    return request_json("/dict/getDictList",
                        {"pageNum": 1, "pageSize": 200, "type": "card_series"}, pacer=pacer)


def fetch_all_search_rows(pacer: Pacer):
    """分页拉全量列表：直到空页；整页重复（分页未推进）或超过页数上限直接报错。"""
    pages: list[list] = []
    seen: set[str] = set()
    rows: list[dict] = []
    for page in range(1, MAX_PAGES + 1):
        envelope = search_page(page, pacer)
        page_rows = ensure_ok(envelope, "/card/searchCardCraft")
        if not page_rows:
            log(f"  列表第 {page} 页为空，分页结束：共 {len(rows)} 行 / {page - 1} 页")
            return pages, rows
        fresh = 0
        for row in page_rows:
            card_no = row.get("cardNo")
            if card_no in seen:
                continue
            seen.add(card_no)
            rows.append(row)
            fresh += 1
        pages.append(page_rows)
        log(f"  列表第 {page} 页：{len(page_rows)} 条，新 {fresh} 条，累计 {len(rows)} 行")
        if page > 1 and fresh == 0:
            raise RuntimeError(f"分页未推进（第 {page} 页全是重复卡号），已停止以避免静默漏卡")
    raise RuntimeError(f"列表分页超过 {MAX_PAGES} 页仍未结束，已停止以避免静默漏卡")


def self_test(pacer: Pacer) -> None:
    log("① 连通性自检")
    t0 = time.time()
    envelope = search_page(1, pacer)
    rows = ensure_ok(envelope, "/card/searchCardCraft")
    log(f"  HTTP 正常，code={envelope.get('code')}，message={envelope.get('message')!r}，"
        f"首页 {len(rows)} 条，耗时 {time.time() - t0:.1f} 秒")
    for row in rows[:SELF_TEST_ROWS]:
        log(f"    · {row.get('cardNo')}  {row.get('cardName')} / {row.get('subTitle')}  "
            f"rarity={row.get('rarityName')}")
    if not rows:
        raise RuntimeError("接口能连通但没返回任何卡牌，请检查 FILTERS 或等 10–30 分钟后再试")
    log("② 抽样测速（用来估算全量耗时）")
    samples = [row["cardNo"] for row in rows[:3] if row.get("cardNo")]
    spent = []
    for card_no in samples:
        t0 = time.time()
        detail = detail_of(card_no, pacer)
        cost = time.time() - t0
        spent.append(cost)
        log(f"    · {card_no}  code={detail.get('code')}  详情耗时 {cost:.1f} 秒")
    if spent:
        avg = sum(spent) / len(spent)
        per_card = avg + (GAP_MIN_MS + GAP_MAX_MS) / 2000.0
        log(f"  单条均值 {avg:.1f} 秒；按当前节奏每条约 {per_card:.1f} 秒，"
            f"1306 条详情约需 {human_sec(per_card * 1306)}")
    log("自检通过 ✅")


def read_progress(path: str) -> dict:
    """读回进度文件：已完成的列表页 / 详情 / 图标，用于会话内续跑。"""
    state = {"meta": None, "pages": {}, "details": {}, "icons": {}, "errors": []}
    if not path or not os.path.exists(path):
        return state
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                continue
            kind = item.get("k")
            if kind == "meta":
                state["meta"] = item.get("v")
            elif kind == "page":
                state["pages"][int(item["page"])] = item.get("envelope")
            elif kind == "detail":
                state["details"][item["cardNo"]] = item.get("envelope")
            elif kind == "icon":
                state["icons"][item["key"]] = item.get("envelope")
            elif kind == "error":
                state["errors"].append(item)
    return state


def append_progress(path: str, item: dict) -> None:
    if not path:
        return
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(item, ensure_ascii=False) + "\n")


def detail_cards_from_pages(pages: dict) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for page in sorted(pages):
        for row in (pages[page] or {}).get("result") or []:
            card_no = row.get("cardNo")
            if card_no and card_no not in seen:
                seen.add(card_no)
                out.append(card_no)
    return out


def collect_details(card_nos: list[str], pacer: Pacer, progress_file: str,
                    done: dict, errors: list) -> None:
    """逐卡拉详情：串行 + 随机间隔，每条完成即写盘，重跑自动跳过已完成。"""
    todo = [c for c in card_nos if c not in done]
    total = len(card_nos)
    log(f"③ 拉取详情：共 {total} 个印刷版本，已完成 {total - len(todo)}，本次待拉 {len(todo)}")
    if not todo:
        log("  详情已全部就绪，跳过")
        return
    started = time.time()
    lock = threading.Lock()
    counter = {"done": total - len(todo), "failed": 0}

    def work(card_no: str) -> None:
        try:
            envelope = detail_of(card_no, pacer)
            if isinstance(envelope, dict) and envelope.get("code") == 0 and envelope.get("result"):
                with lock:
                    done[card_no] = envelope
                    append_progress(progress_file, {"k": "detail", "cardNo": card_no, "envelope": envelope})
            elif isinstance(envelope, dict) and "不存在" in str(envelope.get("message") or ""):
                with lock:
                    errors.append({"cardNo": card_no, "stage": "detail", "error": "接口返回卡牌不存在"})
                    append_progress(progress_file, {"k": "error", "cardNo": card_no,
                                                    "stage": "detail", "error": "接口返回卡牌不存在"})
            else:
                raise RuntimeError(f"code={envelope.get('code')} message={envelope.get('message')!r}")
        except Exception as exc:  # 单卡失败不拖垮整轮，记进 errors 交给网页端标黄
            with lock:
                errors.append({"cardNo": card_no, "stage": "detail", "error": f"{type(exc).__name__}: {exc}"})
                append_progress(progress_file, {"k": "error", "cardNo": card_no, "stage": "detail",
                                                "error": f"{type(exc).__name__}: {exc}"})
        finally:
            with lock:
                counter["done"] += 1
                if counter["done"] % 25 == 0 or counter["done"] == total:
                    spent = time.time() - started
                    rate = spent / max(1, counter["done"] - (total - len(todo)))
                    left = rate * (total - counter["done"])
                    log(f"    进度 {counter['done']}/{total} · 已用 {human_sec(spent)} · "
                        f"预计剩余 {human_sec(left)} · 节奏 {pacer.label()}")

    if CONCURRENCY > 1:
        with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
            list(pool.map(work, todo))
    else:
        for card_no in todo:
            work(card_no)
    failed = len([e for e in errors if e.get("stage") == "detail"])
    log(f"  详情完成：成功 {len(done)} / {total}，失败或缺 {failed}")


def build_package(pages: dict, details: dict, icons: dict, dicts: dict, errors: list,
                  started_at: str, elapsed: float) -> dict:
    rows: list[dict] = []
    card_nos: list[str] = []
    seen: set[str] = set()
    for page in sorted(pages):
        for row in (pages[page] or {}).get("result") or []:
            card_no = row.get("cardNo")
            if not card_no or card_no in seen:
                continue
            seen.add(card_no)
            card_nos.append(card_no)
            rows.append(row)
    missing = [c for c in card_nos if c not in details]
    package = {
        "format": PACKAGE_FORMAT,
        "formatVersion": PACKAGE_VERSION,
        "script": {"name": SCRIPT_NAME, "version": SCRIPT_VERSION},
        "pulledAt": now_iso(),
        "startedAt": started_at,
        "baseUrl": BASE_URL.rstrip("/"),
        "filters": FILTERS or {},
        "pageSize": PAGE_SIZE,
        "search": {
            "params": {"pageNum": "1..N", "pageSize": PAGE_SIZE, **(FILTERS or {})},
            "envelope": {"code": 0, "message": "操作成功", "result": rows},
        },
        "details": {c: details[c] for c in card_nos if c in details},
        "errors": errors,
        "stats": {
            "searchRows": len(rows),
            "searchPages": len(pages),
            "detailRequested": len(card_nos),
            "detailOk": len([c for c in card_nos if c in details]),
            "detailMissing": len(missing),
            "detailFailed": len([e for e in errors if e.get("stage") == "detail"]),
            "icons": len(icons),
            "elapsedSec": round(elapsed, 1),
        },
    }
    if icons:
        package["icons"] = icons
    if dicts:
        package["dict"] = dicts
    return package


def output_path() -> str:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    slug = ""
    if FILTERS:
        raw = "_".join(f"{k}-{v}" for k, v in sorted(FILTERS.items()))
        slug = "_" + re.sub(r"[^0-9A-Za-z_-]+", "", raw)[:40]
    return os.path.join(OUT_DIR, f"xcx_pull{slug}_{stamp}.json")


def main() -> None:
    started_at = now_iso()
    t_start = time.time()
    pacer = Pacer(GAP_MIN_MS, GAP_MAX_MS)
    log("═" * 68)
    log(f"符文战场离线拉取包 {SCRIPT_VERSION} · {BASE_URL}")
    log(f"分页 {PAGE_SIZE} 条/页 · 并发 {CONCURRENCY} · 间隔 {GAP_MIN_MS}–{GAP_MAX_MS} 毫秒 · "
        f"筛选 {FILTERS or '全量'}")
    log("═" * 68)

    self_test(pacer)
    if SELF_TEST_ONLY:
        log("SELF_TEST_ONLY = True，自检到此结束（未拉全量）。")
        return

    progress = read_progress(PROGRESS_FILE)
    meta = progress["meta"]
    # 换了筛选/接口地址却沿用同一份进度文件，会把两轮数据混成一个包 —— 直接改名保留并重新开始。
    if meta and (meta.get("filters") or {}) != (FILTERS or {}):
        backup = f"{PROGRESS_FILE}.bak-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
        os.replace(PROGRESS_FILE, backup)
        log(f"⚠ 进度文件是另一组筛选（{meta.get('filters')}）拉出来的，已改名保留为 {backup}，本轮从头开始")
        progress = read_progress(PROGRESS_FILE)
    elif meta and str(meta.get("baseUrl") or "").rstrip("/") != BASE_URL.rstrip("/"):
        backup = f"{PROGRESS_FILE}.bak-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
        os.replace(PROGRESS_FILE, backup)
        log(f"⚠ 进度文件的接口地址是 {meta.get('baseUrl')}，与当前 {BASE_URL} 不同，"
            f"已改名保留为 {backup}，本轮从头开始")
        progress = read_progress(PROGRESS_FILE)
    pages: dict = dict(progress["pages"])
    details: dict = dict(progress["details"])
    icons: dict = dict(progress["icons"])
    errors: list = list(progress["errors"])
    if progress["meta"]:
        log(f"发现进度文件：已完成 {len(pages)} 页列表、{len(details)} 条详情，将续跑")
    else:
        append_progress(PROGRESS_FILE, {"k": "meta", "v": {
            "baseUrl": BASE_URL, "filters": FILTERS or {}, "pageSize": PAGE_SIZE,
            "script": SCRIPT_VERSION, "startedAt": started_at}})

    if not pages:
        log("② 拉取卡牌列表（分页直到空页）")
        fetched_pages, _ = fetch_all_search_rows(pacer)
        for index, page_rows in enumerate(fetched_pages, start=1):
            envelope = {"code": 0, "message": "操作成功", "result": page_rows}
            pages[index] = envelope
            append_progress(PROGRESS_FILE, {"k": "page", "page": index, "envelope": envelope})
    else:
        log(f"② 列表已在进度文件里（{len(pages)} 页），跳过")

    card_nos = detail_cards_from_pages(pages)
    if not card_nos:
        raise RuntimeError("列表为空，无法继续；请检查 FILTERS 或等 10–30 分钟后再试")
    log(f"列表合计 {len(card_nos)} 个印刷版本")

    if FETCH_DETAILS:
        collect_details(card_nos, pacer, PROGRESS_FILE, details, errors)
    else:
        log("FETCH_DETAILS = False，跳过详情（网页导入后这些卡按列表行构建并标记详情缺失）")

    if FETCH_KEYWORD_ICONS:
        tokens: list[str] = []
        for row in (r for page in pages.values() for r in (page.get("result") or [])):
            for field in ("cardEffect", "errata"):
                tokens += re.findall(r"\{\{([^{}]+)\}\}", str(row.get(field) or ""))
        for envelope in details.values():
            result = envelope.get("result") or {}
            tokens += re.findall(r"\{\{([^{}]+)\}\}", str(result.get("attachEffect") or ""))
        wanted = [t.strip() for t in dict.fromkeys(tokens) if t.strip()]
        log(f"④ 拉取关键词图标：{len(wanted)} 个待查，已有 {len(icons)} 个")
        for key in wanted:
            if key in icons:
                continue
            try:
                envelope = keyword_icon_of(key, pacer)
                if isinstance(envelope, dict) and envelope.get("code") == 0 and envelope.get("result"):
                    icons[key] = envelope
                    append_progress(PROGRESS_FILE, {"k": "icon", "key": key, "envelope": envelope})
            except Exception as exc:
                log(f"    · 图标 {key} 拉取失败：{type(exc).__name__}: {exc}")
        log(f"  图标完成：{len(icons)} 个")

    dicts: dict = {}
    if FETCH_SERIES_DICT:
        log("⑤ 拉取系列字典")
        try:
            dicts["card_series"] = series_dict(pacer)
            log(f"  系列 {len(ensure_ok(dicts['card_series'], '/dict/getDictList'))} 条")
        except Exception as exc:
            log(f"  系列字典拉取失败（不影响卡牌导入）：{type(exc).__name__}: {exc}")
            dicts = {}

    elapsed = time.time() - t_start
    package = build_package(pages, details, icons, dicts, errors, started_at, elapsed)
    path = output_path()
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(package, fh, ensure_ascii=False, separators=(",", ":"))

    stats = package["stats"]
    size_mb = os.path.getsize(path) / 1024 / 1024
    log("═" * 68)
    log(f"完成：列表 {stats['searchRows']} 行 / {stats['searchPages']} 页 · "
        f"详情 {stats['detailOk']}/{stats['detailRequested']} · "
        f"失败 {stats['detailFailed']} · 用时 {human_sec(elapsed)}")
    log(f"文件：{path}（{size_mb:.1f} MB）")
    if stats["detailMissing"]:
        log(f"注意：有 {stats['detailMissing']} 条没有详情，网页导入后会标黄并按列表行构建")
    log("下一步：把该文件传到电脑，在站点「数据同步」页点「导入拉取包」选择它。")
    log("═" * 68)

    if DOWNLOAD_AT_END:
        try:
            from google.colab import files  # type: ignore

            files.download(path)
        except Exception as exc:
            log(f"自动下载不可用（{type(exc).__name__}）：请用左侧文件面板下载 {path}")


if __name__ == "__main__":
    main()
