/* ================================================================
 * src/tools/rank/api.ts
 *
 * 玩家端积分排行榜接口客户端(只读)。
 *
 * 端点:POST https://lol-api.playloltcg.com/xcx/userIntegral/ranking/list
 * 证据:reports/接口档案-userIntegral-ranking.md(wxappUnpacker 仓库)
 *
 * 实测事实(2026-10-01 匿名探测,结论见 docs/rank-ladder.md):
 *   · 无需 Authorization —— 匿名即 code=0,且响应头带 access-control-allow-origin: *,
 *     浏览器可直连,因此**不设同源转发函数**(与 cardCommonQa 不同)。
 *   · 服务端**老实尊重 pageSize**(实测 1000/5000 均足量返回),客户端小程序那份
 *     「pageSize 硬编码 10 + 第 100 页即停」纯属客户端行为,不是服务端约束。
 *   · 行内含 `rankName`(段位名),无需按 rankIcon 反推 —— 档案 §4.3 的
 *     「未观察到 rankName」经实测不成立。
 *   · `ranking` 遇并列跳号(同名次可多行),原样展示,不做去重或补号。
 *
 * 抓取粒度由调用方定;对外**硬上限 PAGE_SIZE_MAX = 200**(按站点主裁定)。
 * ============================================================== */

/** 官方网关根(与 src/tools/sync/riftboundApi.ts 的 RIFTBOUND_API_BASE 同源) */
export const RANK_API_BASE = 'https://lol-api.playloltcg.com/xcx';

/** 单次请求行数上限。实测服务端能吃得更大,这里是我们**自我约束**的上限。 */
export const PAGE_SIZE_MAX = 200;

/** 首页行数(一次请求即出,秒开) */
export const FIRST_PAGE_SIZE = PAGE_SIZE_MAX;

/**
 * 翻页硬护栏。
 *
 * 无限滚动会一路翻下去,护栏防的是「谁滚到底就一直翻」把上游当自家数据库刷,
 * 而不是我们怀疑榜单只有这么多行(实测 pageNum=2 仍非空,总量远超 1000)。
 * 50 × 200 = 10000 行,已远超任何实际查阅需要。
 */
export const MAX_PAGES = 50;

/** 单次请求超时(毫秒) */
export const REQUEST_TIMEOUT_MS = 20_000;

/** 网络/网关类瞬时失败的退避重试次数(含首次) */
export const MAX_ATTEMPTS = 3;

/** 请求节流:相邻两次上游请求的最小间隔(毫秒) */
export const REQUEST_GAP_MS = 300;

export interface RankRow {
  /** 名次;**并列时多行同值且跳号**,照原样展示 */
  ranking: number;
  /** 积分 */
  totalIntegral: number;
  /** 段位图标(CDN 绝对 URL) */
  rankIcon: string;
  /** 段位名(服务端直接给,如「最强王者」) */
  rankName: string;
  /** 玩家 uid,定长字符串;作列表 key 用 */
  uid: string;
  /** 头像(CDN 绝对 URL) */
  avatar: string;
  /** 昵称 */
  name: string;
}

interface RankEnvelope {
  code: number;
  message?: string;
  type?: string;
  result: unknown;
}

/** 失败类别 —— 界面据此给出可操作的提示,而不是一句笼统的「加载失败」 */
export type RankErrorKind = 'network' | 'http' | 'business' | 'malformed' | 'aborted';

export class RankFetchError extends Error {
  readonly kind: RankErrorKind;
  readonly status?: number;
  /** 业务错误码(code !== 0 时的服务端 code) */
  readonly code?: number;

  constructor(
    kind: RankErrorKind,
    message: string,
    extra: { status?: number; code?: number } = {}
  ) {
    super(message);
    this.name = 'RankFetchError';
    this.kind = kind;
    this.status = extra.status;
    this.code = extra.code;
  }
}

/** 是否是被调用方主动取消(用户点「停止」/离开页面),界面不该报成故障 */
export function isAbortError(e: unknown): boolean {
  return e instanceof RankFetchError && e.kind === 'aborted';
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new RankFetchError('aborted', '已取消'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      reject(new RankFetchError('aborted', '已取消'));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * 严格校验单行:字段缺失即判整页 malformed。
 *
 * 宁可报「响应结构不符」也不要静默渲染出 undefined 行 —— 上游改结构时,
 * 半渲染的榜单比一个明确的错误更难发现。
 */
function parseRow(raw: unknown, index: number, pageNum: number): RankRow {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new RankFetchError('malformed', `第 ${pageNum} 页第 ${index + 1} 行不是对象`);
  }
  const r = raw as Record<string, unknown>;
  const { ranking, totalIntegral, rankIcon, rankName, uid, avatar, name } = r;
  if (typeof ranking !== 'number' || !Number.isFinite(ranking)) {
    throw new RankFetchError('malformed', `第 ${pageNum} 页第 ${index + 1} 行缺少数值 ranking`);
  }
  if (typeof totalIntegral !== 'number' || !Number.isFinite(totalIntegral)) {
    throw new RankFetchError('malformed', `第 ${pageNum} 页第 ${index + 1} 行缺少数值 totalIntegral`);
  }
  if (typeof uid !== 'string' || !uid) {
    throw new RankFetchError('malformed', `第 ${pageNum} 页第 ${index + 1} 行缺少 uid`);
  }
  return {
    ranking,
    totalIntegral,
    rankIcon: typeof rankIcon === 'string' ? rankIcon : '',
    rankName: typeof rankName === 'string' ? rankName : '',
    uid,
    avatar: typeof avatar === 'string' ? avatar : '',
    name: typeof name === 'string' ? name : ''
  };
}

function parsePage(body: unknown, pageNum: number): RankRow[] {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new RankFetchError('malformed', `第 ${pageNum} 页响应不是 JSON 对象`);
  }
  const env = body as RankEnvelope;
  if (typeof env.code !== 'number') {
    throw new RankFetchError('malformed', `第 ${pageNum} 页响应缺少数值 code`);
  }
  if (env.code !== 0) {
    throw new RankFetchError(
      'business',
      env.message || `接口返回业务错误 code=${env.code}`,
      { code: env.code }
    );
  }
  if (!Array.isArray(env.result)) {
    // 榜单接口的 result 必为数组;不是数组说明上游改了契约
    throw new RankFetchError('malformed', `第 ${pageNum} 页 result 不是数组`);
  }
  return env.result.map((row, i) => parseRow(row, i, pageNum));
}

/**
 * 拉取一页榜单。
 *
 * @throws RankFetchError kind='aborted' 表示被 signal 取消,调用方应静默处理。
 */
export async function fetchRankPage(
  pageNum: number,
  pageSize: number = PAGE_SIZE_MAX,
  opts: { signal?: AbortSignal } = {}
): Promise<RankRow[]> {
  if (!Number.isInteger(pageNum) || pageNum < 1) {
    throw new RankFetchError('malformed', `pageNum 必须是 ≥1 的整数,收到 ${pageNum}`);
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > PAGE_SIZE_MAX) {
    throw new RankFetchError(
      'malformed',
      `pageSize 必须在 1..${PAGE_SIZE_MAX} 之间(站点自我约束的上限),收到 ${pageSize}`
    );
  }

  const url = `${RANK_API_BASE}/userIntegral/ranking/list`;
  let lastError: RankFetchError | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (opts.signal?.aborted) throw new RankFetchError('aborted', '已取消');

    // 每次尝试各自计时:重试不该共享同一个已消耗大半的超时预算
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS);
    const onOuterAbort = () => timeout.abort();
    opts.signal?.addEventListener('abort', onOuterAbort, { once: true });

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageNum, pageSize }),
        signal: timeout.signal
      });

      if (!res.ok) {
        const err = new RankFetchError('http', `接口返回 HTTP ${res.status}`, { status: res.status });
        // 4xx 是确定性拒绝,重试无意义;5xx/429 才退避重试
        if (res.status < 500 && res.status !== 429) throw err;
        lastError = err;
      } else {
        return parsePage(await res.json(), pageNum);
      }
    } catch (e: unknown) {
      if (opts.signal?.aborted) throw new RankFetchError('aborted', '已取消');
      // 结构/业务错误是确定性的,不重试直接抛
      if (e instanceof RankFetchError && (e.kind === 'malformed' || e.kind === 'business')) throw e;
      if (e instanceof RankFetchError) {
        lastError = e;
      } else {
        lastError = new RankFetchError(
          'network',
          timeout.signal.aborted && !opts.signal?.aborted
            ? `请求超时(${REQUEST_TIMEOUT_MS / 1000} 秒)`
            : `网络请求失败:${e instanceof Error ? e.message : String(e)}`
        );
      }
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onOuterAbort);
    }

    if (attempt < MAX_ATTEMPTS) {
      // 指数退避 + 抖动,避免多个访客在同一毫秒齐刷刷重试
      await sleep(Math.round(600 * 2 ** (attempt - 1) + Math.random() * 400), opts.signal);
    }
  }

  throw lastError ?? new RankFetchError('network', '接口请求失败,且未捕获到具体原因');
}

/** 相邻两批之间的固定间隔,给上游留余地(见 REQUEST_GAP_MS) */
export function pageGap(signal?: AbortSignal): Promise<void> {
  return sleep(REQUEST_GAP_MS, signal);
}
