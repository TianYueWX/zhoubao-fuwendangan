/**
 * 符文战场 · 线上数据接口客户端
 *
 * 数据来源：官方小程序后端 https://lol-api.playloltcg.com/xcx
 *  - 公开可访问（无需鉴权），CORS 全开，浏览器可直连
 *  - 统一响应结构 { result, code, message }，code === 0 为成功
 *
 * 只读接口，不写入任何数据；写入由 SyncView 通过 supabase 完成。
 */

export const RIFTBOUND_API_BASE = 'https://lol-api.playloltcg.com/xcx'

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

export interface RequestOptions {
  baseUrl?: string
  signal?: AbortSignal
}

const RETRYABLE = new Set([403, 408, 429, 500, 502, 503, 504])
const MAX_RETRIES = 6

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new DOMException('已取消', 'AbortError'))
    }, { once: true })
  })
}

async function request<T>(
  path: string,
  init: RequestInit,
  opts: RequestOptions = {},
  attempt = 0
): Promise<ApiEnvelope<T>> {
  const base = (opts.baseUrl || RIFTBOUND_API_BASE).replace(/\/+$/, '')
  let res: Response
  try {
    res = await fetch(base + path, { ...init, signal: opts.signal })
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e
    if (attempt < MAX_RETRIES) {
      await sleep(400 * 2 ** attempt + Math.random() * 300, opts.signal)
      return request<T>(path, init, opts, attempt + 1)
    }
    throw e
  }
  // 网关限流（403/429）或瞬时 5xx：指数退避重试
  if (RETRYABLE.has(res.status)) {
    if (attempt < MAX_RETRIES) {
      await sleep(600 * 2 ** attempt + Math.random() * 400, opts.signal)
      return request<T>(path, init, opts, attempt + 1)
    }
    throw new Error(`接口限流或不可用 HTTP ${res.status}（${path}），已重试 ${MAX_RETRIES} 次`)
  }
  if (!res.ok) throw new Error(`接口请求失败 HTTP ${res.status}（${path}）`)
  return (await res.json()) as ApiEnvelope<T>
}

function ensureOk<T>(env: ApiEnvelope<T>, path: string): T {
  if (env.code !== 0) throw new Error(env.message || `接口返回错误 code=${env.code}（${path}）`)
  return env.result
}

/** POST /card/searchCardCraft —— 分页拉取卡牌（每行 = 一个印刷版本） */
export async function searchCards(
  params: SearchCardParams = {},
  opts: RequestOptions = {}
): Promise<ApiSearchCard[]> {
  const body: SearchCardParams = { pageNum: 1, pageSize: 1000, ...params }
  const env = await request<ApiSearchCard[]>('/card/searchCardCraft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }, opts)
  return ensureOk(env, '/card/searchCardCraft') || []
}

/** 分页拉取全部卡牌（直到某页为空） */
export async function searchAllCards(
  opts: RequestOptions & { pageSize?: number; onPage?: (page: number, got: number) => void } = {}
): Promise<ApiSearchCard[]> {
  const pageSize = opts.pageSize ?? 1000
  const out: ApiSearchCard[] = []
  for (let page = 1; page <= 50; page++) {
    const rows = await searchCards({ pageNum: page, pageSize }, opts)
    out.push(...rows)
    opts.onPage?.(page, rows.length)
    if (rows.length < pageSize) break
  }
  return out
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
