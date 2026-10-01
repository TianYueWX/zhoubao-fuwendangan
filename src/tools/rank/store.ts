/* ================================================================
 * src/tools/rank/store.ts
 *
 * 「积分榜速查」的响应式单例 —— 快照的存取、追加与展示态。
 *
 * 口径(与站点主商定):
 *   · 首屏一次请求(pageSize=200)即出,之后**无限滚动**逐批追加;
 *   · 快照按 uid **并集**追加,不清不重排 —— 上游推进的明细由 resync 显式重建;
 *   · localStorage 只留最新一份快照 + 抓取时间戳 + 覆盖范围;
 *   · 本批失败即作废(不写缓存、不改游标),已抓到的行原样保留;
 *   · 无服务端缓存,站点不发布榜单副本 —— 数据只落在访问者自己的浏览器里。
 * ============================================================== */

import { computed, reactive } from 'vue';
import {
  FIRST_PAGE_SIZE,
  MAX_PAGES,
  PAGE_SIZE_MAX,
  RankFetchError,
  fetchRankPage,
  isAbortError,
  pageGap,
  type RankRow
} from './api';

const SNAPSHOT_KEY = 'riftbound.rankLadder.snapshot.v1';

export interface RankSnapshot {
  /** 已抓到的行(按上游顺序并集追加) */
  rows: RankRow[];
  /**
   * 下一个待抓页号(1 起)。
   *
   * 游标比 `rows` 权威:某页整页都是重复 uid 时,行数不变但游标必须推进,
   * 否则下一批会原地重抓同一页。
   */
  nextPage: number;
  /** 快照覆盖到第几名(取已抓行的最大 ranking) */
  coverage: number;
  /** 抓取时刻(epoch ms) */
  fetchedAt: number;
}

/** 本批失败原因(已抓到的行不受影响) */
export interface RankBatchError {
  kind: RankFetchError['kind'];
  message: string;
}

interface RankState {
  snapshot: RankSnapshot | null;
  loading: boolean;
  batchError: RankBatchError | null;
  /** 已经抓到榜单末尾(某页不足一页) */
  reachedEnd: boolean;
  /** 撞上 MAX_PAGES 护栏 */
  capped: boolean;
  /** 界面筛选态(刻意不做排序:榜单顺序即官方名次顺序,排序反而会诱导误读) */
  ui: {
    search: string;
    rankNames: string[];
  };
}

function emptySnapshot(): RankSnapshot {
  return { rows: [], nextPage: 1, coverage: 0, fetchedAt: 0 };
}

export const rankState = reactive<RankState>({
  snapshot: null,
  loading: false,
  batchError: null,
  reachedEnd: false,
  capped: false,
  ui: {
    search: '',
    rankNames: []
  }
});

/* ────────────────────── 本地快照读写 ────────────────────── */

/** 逐字段校验:localStorage 是用户可改的外部输入,不信任其形状 */
function isRankRow(v: unknown): v is RankRow {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.ranking === 'number' &&
    typeof r.totalIntegral === 'number' &&
    typeof r.uid === 'string' &&
    typeof r.name === 'string' &&
    typeof r.avatar === 'string' &&
    typeof r.rankIcon === 'string' &&
    typeof r.rankName === 'string'
  );
}

function readSnapshot(): RankSnapshot | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const s = parsed as Record<string, unknown>;
    const rows = Array.isArray(s.rows) ? s.rows.filter(isRankRow) : [];
    if (!rows.length) return null;
    const nextPage = typeof s.nextPage === 'number' && s.nextPage >= 1 ? Math.floor(s.nextPage) : 1;
    const coverage =
      typeof s.coverage === 'number' && s.coverage >= 0
        ? Math.floor(s.coverage)
        : rows.reduce((m, r) => Math.max(m, r.ranking), 0);
    return {
      rows,
      nextPage,
      coverage,
      fetchedAt: typeof s.fetchedAt === 'number' ? s.fetchedAt : 0
    };
  } catch {
    // 损坏的缓存不值得让整个工具瘫掉,直接当作没有快照
    return null;
  }
}

function writeSnapshot(snap: RankSnapshot): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap));
  } catch {
    // 配额写满(榜单越大越可能)不该让已抓到的数据消失 —— 内存里仍在,
    // 只是刷新后要重抓。这里刻意不报警:它不是抓取失败。
  }
}

function clearSnapshotStorage(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(SNAPSHOT_KEY);
  } catch {
    /* 忽略:清不掉也不影响内存态 */
  }
}

/** 应用启动时恢复上次快照(幂等;没有就保持空态) */
export function initRankStore(): void {
  if (rankState.snapshot) return;
  const restored = readSnapshot();
  if (restored) rankState.snapshot = restored;
}

/* ────────────────────── 抓取 ────────────────────── */

/** 已抓到的最大名次 = 快照覆盖范围 */
function coverageOf(rows: RankRow[]): number {
  let max = 0;
  for (const r of rows) if (r.ranking > max) max = r.ranking;
  return max;
}

/**
 * 把新一页并集追加到已有行上(按 uid 去重,保留先到者)。
 *
 * 为什么是并集而不是直接拼接:上游在两次请求之间会推进名次,新页里可能出现
 * 与已抓行同 uid 的新行。若整表按新数据重排,用户滚动中榜单会在脚下跳动;
 * 保留先到者则整表稳定,代价是新页中重复 uid 的新名次被丢弃 —— 需要精确
 * 最新值时由用户显式「重新抓取」重建。
 *
 * 导出以便离线回归测试直接验这条口径。
 */
export function mergeUniqueRows(existing: readonly RankRow[], pageRows: readonly RankRow[]): RankRow[] {
  const merged = existing.slice();
  const seen = new Set(merged.map((r) => r.uid));
  for (const row of pageRows) {
    if (seen.has(row.uid)) continue;
    seen.add(row.uid);
    merged.push(row);
  }
  return merged;
}

let inFlight: AbortController | null = null;

/** 取消进行中的抓取(离开页面/用户点停止) */
export function abortRankFetch(): void {
  inFlight?.abort();
  inFlight = null;
}

/**
 * 抓取**下一批**并追加到快照。
 *
 * - 无快照时从第 1 页发起(= 首屏)。
 * - 有快照时从 `nextPage` 续抓(无限滚动 / 手动「抓取更多」共用此路径)。
 * - 失败:抛错前把 `batchError` 写进状态,**不动**快照与游标,已抓到的行照常可查。
 * - `force`:忽略 `reachedEnd`/`capped` 闸门,用于用户手动要求重抓。
 */
export async function fetchNextBatch(force = false): Promise<void> {
  if (rankState.loading) return;
  if (!force && (rankState.reachedEnd || rankState.capped)) return;

  const current = rankState.snapshot ?? emptySnapshot();
  const pageNum = current.nextPage;
  if (pageNum > MAX_PAGES) {
    rankState.capped = true;
    return;
  }

  rankState.loading = true;
  rankState.batchError = null;
  const controller = new AbortController();
  inFlight = controller;

  try {
    const pageRows = await fetchRankPage(pageNum, PAGE_SIZE_MAX, { signal: controller.signal });

    // 并集追加:上游在两次请求之间推进过的名次会产出新 uid,
    // 已存在的 uid 保留旧行 —— 否则滚动过程中整表会在脚下重排。
    const merged = mergeUniqueRows(current.rows, pageRows);

    rankState.snapshot = {
      rows: merged,
      nextPage: pageNum + 1,
      coverage: coverageOf(merged),
      fetchedAt: Date.now()
    };
    // 不足一页 = 到榜单末尾(实测服务端足量返回,这条判据可信)
    if (pageRows.length < PAGE_SIZE_MAX) rankState.reachedEnd = true;
    if (pageNum >= MAX_PAGES) rankState.capped = true;
    writeSnapshot(rankState.snapshot);
  } catch (e: unknown) {
    if (isAbortError(e)) return; // 主动取消不算失败
    const err =
      e instanceof RankFetchError
        ? { kind: e.kind, message: e.message }
        : { kind: 'network' as const, message: e instanceof Error ? e.message : String(e) };
    rankState.batchError = err;
    throw e;
  } finally {
    rankState.loading = false;
    inFlight = null;
  }
}

/**
 * 重新抓取:清空快照后从第 1 页重来(用户点「重新抓取」)。
 *
 * 按站点裁定「失败即作废」—— 重建失败就真的什么都不留,而不是留一份
 * 半新半旧的快照让人误以为是最新的。
 *
 * 但「作废」不等于「过程中让用户看空表」:重建期间旧数据仍在界面上,
 * 失败时会把旧快照**还原**回来并如实报错 —— 旧数据虽然可能过时,
 * 也远好过一张空表;用户能看到的错因比沉默的空白更有用。
 */
export async function resyncRank(): Promise<void> {
  abortRankFetch();
  const previous = rankState.snapshot;
  rankState.snapshot = null;
  rankState.reachedEnd = false;
  rankState.capped = false;
  rankState.batchError = null;
  clearSnapshotStorage();
  try {
    await fetchNextBatch(true);
  } catch (e: unknown) {
    // 重建失败:还原旧快照(存储里仍是空的,下次启动会重新抓)
    if (previous) rankState.snapshot = previous;
    throw e;
  }
}

/** 首屏自动加载:已有快照就什么都不做 */
export async function ensureFirstBatch(): Promise<void> {
  if (rankState.snapshot?.rows.length) return;
  await fetchNextBatch(true).catch(() => {
    /* 错误已记在 state.batchError,界面自会显示 */
  });
}

/* ────────────────────── 展示态派生 ────────────────────── */

export const rankRows = computed<RankRow[]>(() => rankState.snapshot?.rows ?? []);

export const hasSnapshot = computed(() => rankRows.value.length > 0);

/** 还能继续往下抓吗(无限滚动的闸门) */
export const canLoadMore = computed(
  () =>
    hasSnapshot.value &&
    !rankState.loading &&
    !rankState.reachedEnd &&
    !rankState.capped &&
    (rankState.snapshot?.nextPage ?? 1) <= MAX_PAGES
);

/**
 * 段位筛选选项 —— **从已抓数据里动态生成**,不硬编码段位名。
 * 上游将来新增段位(或改名)时选项自动跟上,不会与真实数据脱节。
 * 排序按该段位的最低积分从高到低(段位由高到低)。
 */
export const rankNameOptions = computed<Array<{ name: string; count: number }>>(() => {
  const acc = new Map<string, { count: number; min: number }>();
  for (const r of rankRows.value) {
    const name = r.rankName;
    if (!name) continue;
    const e = acc.get(name);
    if (e) {
      e.count++;
      if (r.totalIntegral < e.min) e.min = r.totalIntegral;
    } else {
      acc.set(name, { count: 1, min: r.totalIntegral });
    }
  }
  return [...acc.entries()]
    .map(([name, e]) => ({ name, count: e.count, min: e.min }))
    .sort((a, b) => b.min - a.min)
    .map(({ name, count }) => ({ name, count }));
});

/** 搜索(昵称 + uid 模糊)+ 段位多选筛选后的行 —— 顺序即上游返回的名次顺序 */
export const filteredRankRows = computed<RankRow[]>(() => {
  const q = rankState.ui.search.trim().toLowerCase();
  const picked = rankState.ui.rankNames;
  const pool = rankRows.value;
  if (!q && !picked.length) return pool;
  const wanted = picked.length ? new Set(picked) : null;
  return pool.filter((r) => {
    if (wanted && !wanted.has(r.rankName)) return false;
    if (!q) return true;
    return r.name.toLowerCase().includes(q) || r.uid.toLowerCase().includes(q);
  });
});

/** 界面用:快照覆盖面的一句话描述 */
export const coverageText = computed(() => {
  const snap = rankState.snapshot;
  if (!snap || !snap.rows.length) return '尚未抓取';
  if (rankState.reachedEnd) return `已到榜单末尾 · 共 ${snap.rows.length} 行 · 最末第 ${snap.coverage} 名`;
  return `覆盖第 1–${snap.coverage} 名 · 已抓 ${snap.rows.length} 行`;
});

export const fetchedAtText = computed(() => {
  const at = rankState.snapshot?.fetchedAt;
  if (!at) return '';
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
});

/** 用于离线回归测试:把内部口径暴露成纯函数,避免测试去戳组件 */
export const __testing = {
  SNAPSHOT_KEY,
  coverageOf,
  emptySnapshot,
  mergeUniqueRows
};
