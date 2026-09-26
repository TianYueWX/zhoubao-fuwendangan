/**
 * 符文战场 · 线上数据接口客户端
 *
 * 数据来源：官方小程序后端 https://lol-api.playloltcg.com/xcx
 *  - 公开可访问（无需鉴权）；QA 端点不返回 CORS 头，默认经本站同源函数转发
 *  - 统一响应结构 { result, code, message }，code === 0 为成功
 *
 * 只读接口，不写入任何数据；写入由 SyncView 通过 supabase 完成。
 */

export const RIFTBOUND_API_BASE = 'https://lol-api.playloltcg.com/xcx'
export const RIFTBOUND_QA_PROXY_BASE = '/api/riftbound'

/**
 * 官方卡牌列表接口实测单次只返回 25 条；服务端不保证会尊重更大的 pageSize，
 * 因此列表分页固定按 25 条/批，并只在拿到空页时收工（见 searchAllCards）。
 */
export const SEARCH_PAGE_SIZE = 25
/** 卡牌列表分页上限：25 条/页 × 400 页 = 1 万条，远超当前全表规模 */
export const MAX_SEARCH_PAGES = 400

/** 只对已知缺少 CORS 头的官方 QA 地址使用同源代理。 */
export function qaApiBase(baseUrl?: string): string {
  const base = (baseUrl || RIFTBOUND_API_BASE).replace(/\/+$/, '')
  return base === RIFTBOUND_API_BASE ? RIFTBOUND_QA_PROXY_BASE : base
}

export interface ApiEnvelope<T> {
  result: T
  resData?: unknown
  code: number
  type?: string
  message: string
}

export interface ApiSearchCard {
  id: number
  cardCategoryList: string[] | null
  cardCategoryNameList: string[] | null
  cardNo: string
  cardName: string | null
  subTitle: string | null
  extendType: string | null
  extendTypeName: string | null
  cardColorList: string[] | null
  hero: string | null
  region: string | null
  tag: string | null
  artist: string | null
  cardEffect: string | null
  flavorText: string | null
  energy: number | null
  returnEnergy: number | null
  power: number | null
  productCodeList: string[] | null
  productNameList: string[] | null
  craftLevel: number | null
  rarity: string | null
  rarityName: string | null
  extendRarity: string | null
  extendRarityName: string | null
  frontImage: string | null
  backImage: string | null
  listSort: number | null
  status: number | null
  isPreview: boolean | null
  errata: string | null
  otherDesc: number | null
}

export interface ApiCraft {
  craftLevel: number | null
  frontImage: string | null
  backImage: string | null
  rarity: string | null
  rarityName: string | null
  extendRarity: string | null
  extendRarityName: string | null
  listSort: number | null
  artist: string | null
}

export interface ApiCardDetail {
  id: number
  cardCategoryList: string[] | null
  cardCategoryNameList: string[] | null
  cardNo: string
  cardName: string | null
  subTitle: string | null
  extendType: string | null
  extendTypeName: string | null
  cardColorList: string[] | null
  cardColorNameList: string[] | null
  hero: string | null
  region: string | null
  tag: string | null
  cardEffect: string | null
  flavorText: string | null
  energy: number | null
  returnEnergy: number | null
  power: number | null
  cardQaList: unknown[] | null
  craftList: ApiCraft[] | null
  productList: Array<{ productCode: string; productName: string }> | null
  isPreview: boolean | null
  otherDesc: number | null
  cardSeries: string | null
  attachEffect: string | null
  errata: string | null
}

export interface ApiKeywordConfig {
  id: number
  name: string
  icon: string | null
  color: string | null
  category: number | null
  content: string | null
  cardType: string | null
}

export interface ApiDictItem {
  id: number
  type: string
  code: string
  name: string
  sort: number | null
}

export interface ApiCommonQa {
  id: number | string
  code: string | null
  sort: number | null
  cardNo: string[] | null
  cardName: string[] | null
  question: string
  answer: string
}

export interface SearchCardParams {
  pageNum?: number
  pageSize?: number
  searchContent?: string
  isPreview?: boolean
  isErrata?: boolean
  /** 1 = 只看禁限/特殊标记 */
  otherDesc?: number
  productCodeList?: string[]
  cardCategoryList?: string[]
  cardColorList?: string[]
  cardSeriesList?: string[]
  rarityList?: string[]
  extendRarityList?: string[]
}

export interface RetryInfo {
  path: string
  status?: number
  /** 即将进行的第几次重试（1 起） */
  attempt: number
  maxAttempts: number
  waitMs: number
  /** 自动降速后的请求间隔（毫秒），供界面显示当前节奏。 */
  gapRange?: { min: number; max: number }
}

export interface RequestOptions {
  baseUrl?: string
  signal?: AbortSignal
  /** 同一轮同步共享的请求前置节流器。 */
  beforeRequest?: () => Promise<void>
  /** 触发退避重试前的回调，用于界面显示「重试中」。 */
  onRetry?: (info: RetryInfo) => void
}

// 5xx 与网关限流：包含 Cloudflare 的 520–526（尤其 524 源站超时）。
const RETRYABLE = new Set([403, 408, 429, 500, 502, 503, 504, 520, 522, 523, 524, 525, 526])
const MAX_RETRIES = 6

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('已取消', 'AbortError'))
      return
    }
    const onAbort = () => {
      clearTimeout(t)
      reject(new DOMException('已取消', 'AbortError'))
    }
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** 解析 Retry-After（秒数或 HTTP 日期），返回还需等待的毫秒数。 */
export function parseRetryAfterMs(raw: string | null, now = Date.now()): number | null {
  if (!raw) return null
  const value = raw.trim()
  if (/^\d+(?:\.\d+)?$/.test(value)) return Math.max(0, Math.ceil(Number(value) * 1000))
  const at = Date.parse(value)
  return Number.isFinite(at) ? Math.max(0, at - now) : null
}

/** 在上下限之间生成一次请求间隔；导出以便离线回归测试。 */
export function randomGapMs(minGapMs: number, maxGapMs: number, random = Math.random): number {
  const min = Math.max(0, minGapMs)
  const max = Math.max(min, maxGapMs)
  return Math.round(min + random() * (max - min))
}

/** 节流器自动降速后的间隔上限：再慢也不能让整轮同步停滞。 */
export const MAX_PACER_GAP_MS = 5000

export interface RequestPacer {
  (): Promise<void>
  /** 触发限流/重试后整体放慢：间隔 ×factor（默认 2），封顶 MAX_PACER_GAP_MS。 */
  slowDown(factor?: number): void
  /** 当前请求间隔范围，供界面显示与离线测试。 */
  gapRange(): { min: number; max: number }
}

/**
 * 创建一轮同步专用的全局节流器。并发调用会先同步预约启动时刻，
 * 因此即使有多个 worker，也不会在同一瞬间向上游发出突发请求。
 *
 * 官方接口在持续快速请求后会触发 WAF 限流（浏览器里常表现为 CORS 报错）。
 * 因此每次重试都会调用 slowDown()，让整轮请求越挫越慢，而不是只等单次退避。
 */
export function createRequestPacer(minGapMs: number, maxGapMs = minGapMs, signal?: AbortSignal): RequestPacer {
  let min = Math.max(0, minGapMs)
  let max = Math.max(min, maxGapMs)
  let nextStart = 0
  const pace = (async (): Promise<void> => {
    const now = Date.now()
    const wait = Math.max(0, nextStart - now)
    nextStart = Math.max(now, nextStart) + randomGapMs(min, max)
    if (wait > 0) await sleep(wait, signal)
  }) as RequestPacer
  pace.slowDown = (factor = 2): void => {
    const f = Math.max(1, factor)
    min = Math.min(MAX_PACER_GAP_MS, Math.round(min * f))
    max = Math.min(MAX_PACER_GAP_MS, Math.max(min, Math.round(max * f)))
  }
  pace.gapRange = () => ({ min, max })
  return pace
}

async function request<T>(
  path: string,
  init: RequestInit,
  opts: RequestOptions = {},
  attempt = 0
): Promise<ApiEnvelope<T>> {
  const base = (opts.baseUrl || RIFTBOUND_API_BASE).replace(/\/+$/, '')
  await opts.beforeRequest?.()
  let res: Response
  try {
    res = await fetch(base + path, { ...init, signal: opts.signal })
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e
    if (attempt < MAX_RETRIES) {
      const waitMs = Math.round(400 * 2 ** attempt + Math.random() * 300)
      opts.onRetry?.({ path, attempt: attempt + 1, maxAttempts: MAX_RETRIES, waitMs })
      await sleep(waitMs, opts.signal)
      return request<T>(path, init, opts, attempt + 1)
    }
    throw new Error(
      `无法访问官方接口（${path}）：${e?.message ?? e}。` +
      '请求可能被限流/WAF 拦截（浏览器里常显示为 CORS 错误），请等待 10–30 分钟后用更慢的节奏重试'
    )
  }
  // 网关限流（403/429）或瞬时 5xx：指数退避重试
  if (RETRYABLE.has(res.status)) {
    if (attempt < MAX_RETRIES) {
      const backoff = 600 * 2 ** attempt + Math.random() * 400
      const retryAfter = parseRetryAfterMs(res.headers.get('retry-after')) ?? 0
      const waitMs = Math.round(Math.max(backoff, retryAfter))
      opts.onRetry?.({ path, status: res.status, attempt: attempt + 1, maxAttempts: MAX_RETRIES, waitMs })
      await sleep(waitMs, opts.signal)
      return request<T>(path, init, opts, attempt + 1)
    }
    const hint = res.status === 403
      ? '官方接口拒绝访问（可能触发限流/WAF，浏览器里常显示为 CORS 错误），请等待 10–30 分钟后重试'
      : '接口限流或不可用'
    throw new Error(`${hint} HTTP ${res.status}（${path}），已重试 ${MAX_RETRIES} 次`)
  }
  if (!res.ok) throw new Error(`接口请求失败 HTTP ${res.status}（${path}）`)
  return (await res.json()) as ApiEnvelope<T>
}

function ensureOk<T>(env: ApiEnvelope<T>, path: string): T {
  if (env.code !== 0) throw new Error(env.message || `接口返回错误 code=${env.code}（${path}）`)
  return env.result
}

/** POST /card/searchCardCraft —— 分页拉取卡牌（每行 = 一个印刷版本，官方单次上限 25 条） */
export async function searchCards(
  params: SearchCardParams = {},
  opts: RequestOptions = {}
): Promise<ApiSearchCard[]> {
  const body: SearchCardParams = { pageNum: 1, pageSize: SEARCH_PAGE_SIZE, ...params }
  const env = await request<ApiSearchCard[]>('/card/searchCardCraft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }, opts)
  return ensureOk(env, '/card/searchCardCraft') || []
}

/**
 * 分页拉取全部卡牌：25 条/批，逐页累计直到**空页**。
 *
 * 不能用「本页不足 pageSize 即结束」判断：服务端实际只给 25 条，
 * 若请求更大的 pageSize，第一页就会被误判为最后一页，静默漏掉全表。
 * 另设两道保险：整页重复（pageNum 未推进）或超过页数上限时直接抛错，
 * 宁可使本轮失败，也不产出不完整的卡表。
 */
export async function searchAllCards(
  opts: RequestOptions & { pageSize?: number; onPage?: (page: number, got: number, total: number) => void } = {}
): Promise<ApiSearchCard[]> {
  const pageSize = opts.pageSize ?? SEARCH_PAGE_SIZE
  const out: ApiSearchCard[] = []
  const seen = new Set<string>()
  for (let page = 1; page <= MAX_SEARCH_PAGES; page++) {
    const rows = await searchCards({ pageNum: page, pageSize }, opts)
    if (!rows.length) return out
    let fresh = 0
    for (const row of rows) {
      if (seen.has(row.cardNo)) continue
      seen.add(row.cardNo)
      out.push(row)
      fresh++
    }
    opts.onPage?.(page, rows.length, out.length)
    if (page > 1 && fresh === 0) {
      throw new Error(`官方接口分页未推进（第 ${page} 页全部为重复卡号），已停止以避免静默漏卡`)
    }
  }
  throw new Error(`官方接口分页超过 ${MAX_SEARCH_PAGES} 页仍未结束，已停止以避免静默漏卡`)
}

/** POST /card/cardDetail —— 单卡详情；卡牌不存在时返回 null */
export async function cardDetail(
  cardNo: string,
  opts: RequestOptions = {}
): Promise<ApiCardDetail | null> {
  const env = await request<ApiCardDetail>('/card/cardDetail', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cardNo })
  }, opts)
  if (env.code === 0) return env.result
  if (/不存在/.test(env.message || '')) return null
  throw new Error(env.message || `拉取卡牌详情失败（${cardNo}）`)
}

/** GET /cardDetailsConfig/getCardDetailsConfig/{key} —— 关键词图标/说明 */
export async function getKeywordConfig(
  key: string,
  opts: RequestOptions = {}
): Promise<ApiKeywordConfig | null> {
  const env = await request<ApiKeywordConfig>(
    `/cardDetailsConfig/getCardDetailsConfig/${encodeURIComponent(key)}`,
    { method: 'GET' },
    opts
  )
  if (env.code === 0) return env.result
  return null
}

/** POST /dict/getDictList —— 字典（card_series / card_category / ...） */
export async function getDictList(
  type: string,
  opts: RequestOptions & { pageSize?: number } = {}
): Promise<ApiDictItem[]> {
  const env = await request<ApiDictItem[]>('/dict/getDictList', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pageNum: 1, pageSize: opts.pageSize ?? 200, type })
  }, opts)
  return ensureOk(env, '/dict/getDictList') || []
}

/** POST /cardCommonQa/getCardCommonQaList —— 卡牌常见问题（分页） */
export async function getCardCommonQaList(
  params: { pageNum?: number; pageSize?: number; searchContent?: string } = {},
  opts: RequestOptions = {}
): Promise<ApiCommonQa[]> {
  const body = { pageNum: 1, pageSize: 30, searchContent: '', ...params }
  const env = await request<ApiCommonQa[]>('/cardCommonQa/getCardCommonQaList', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }, { ...opts, baseUrl: qaApiBase(opts.baseUrl) })
  return ensureOk(env, '/cardCommonQa/getCardCommonQaList') || []
}

/** 分页拉取全部卡牌问答（直到某页不足一页） */
export async function searchAllCommonQa(
  opts: RequestOptions & { pageSize?: number; onPage?: (page: number, got: number, total: number) => void } = {}
): Promise<ApiCommonQa[]> {
  // 官方玩家端实际请求使用 30；不假设服务端会尊重更大的 pageSize，
  // 否则若服务端强制上限 30，第一页就会被误判为最后一页。
  const pageSize = opts.pageSize ?? 30
  const out: ApiCommonQa[] = []
  for (let page = 1; page <= 200; page++) {
    const rows = await getCardCommonQaList({ pageNum: page, pageSize, searchContent: '' }, opts)
    out.push(...rows)
    opts.onPage?.(page, rows.length, out.length)
    if (rows.length < pageSize) break
  }
  return out
}

/**
 * 并发映射（受控并发数）。用于把上千次 cardDetail 调用压在合理并发内。
 * onProgress 每完成一项回调一次。
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
  /** 全局最小请求间隔（毫秒），用于平滑突发、规避网关限流 */
  minGapMs = 0
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  let done = 0
  let lastStart = 0
  const gap = async () => {
    if (minGapMs <= 0) return
    const wait = Math.max(0, lastStart + minGapMs - Date.now())
    lastStart = Date.now() + wait
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  }
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) break
      await gap()
      // 索引由 next++ 保证在界内;断言以满足 noUncheckedIndexedAccess
      results[i] = await fn(items[i]!, i)
      done++
      onProgress?.(done, items.length)
    }
  })
  await Promise.all(workers)
  return results
}
