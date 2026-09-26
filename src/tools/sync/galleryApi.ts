/**
 * 官网卡表接口客户端（Riot Publishing Content Service）。
 *
 * 上游：https://content.publishing.riotgames.com/.../list/riftbound_gallery_{sets,cards}
 *  - 公开可访问（无需鉴权），但 CORS 只放行 playriftbound.com，
 *    浏览器一律经本站同源函数 /api/riftbound/gallery/* 转发。
 *  - 只读接口，不写入任何数据。
 *
 * 实测：列表接口不支持按系列过滤（set/cardSet/filter 均被忽略），
 * 因此这里固定拉全量，系列筛选由调用方在内存中完成。
 */
import { createRequestPacer, parseRetryAfterMs, type RetryInfo } from './riftboundApi'

export type { RetryInfo }

export const GALLERY_PROXY_BASE = '/api/riftbound/gallery'

/** 列表分页大小（上游上限 200）。 */
export const GALLERY_PAGE_SIZE = 200

export type GalleryLocale = 'en_US' | 'zh_CN' | 'ko_KR' | 'zh_TW' | 'fr_FR' | 'es_ES' | 'de_DE' | 'it_IT' | 'ja_JP'

/** 该语区写入 cards_base 的目标列后缀；无本地化列的语言标记为只读。 */
export type GalleryTarget = 'cn' | 'en' | 'kr' | 'tw'

export interface GalleryLocaleOption {
  id: GalleryLocale
  label: string
  target: GalleryTarget
  /** 能不能写库：仅 en/zh-cn/ko-kr/zh-tw 有对应列 */
  writable: boolean
}

/**
 * 语言选择器。
 *
 * 实测只有 en_US / zh_CN / ko_KR / zh_TW 有卡牌级本地化：
 *  - ko_KR / zh_TW 仅 OGN + OGS 两系列有本地化文本与卡图；
 *  - fr/es/de/it/ja 的卡名、效果、卡图全部回退英文（只有界面标签本地化），
 *    因此只允许拉取预览，不写库。
 */
export const GALLERY_LOCALE_OPTIONS: readonly GalleryLocaleOption[] = [
  { id: 'en_US', label: 'English · en-us', target: 'en', writable: true },
  { id: 'zh_CN', label: '简体中文 · zh-cn', target: 'cn', writable: true },
  { id: 'ko_KR', label: '한국어 · ko-kr', target: 'kr', writable: true },
  { id: 'zh_TW', label: '繁體中文 · zh-tw', target: 'tw', writable: true },
  { id: 'fr_FR', label: 'Français · fr-fr（仅预览）', target: 'en', writable: false },
  { id: 'es_ES', label: 'Español · es-es（仅预览）', target: 'en', writable: false },
  { id: 'de_DE', label: 'Deutsch · de-de（仅预览）', target: 'en', writable: false },
  { id: 'it_IT', label: 'Italiano · it-it（仅预览）', target: 'en', writable: false },
  { id: 'ja_JP', label: '日本語 · ja-jp（仅预览）', target: 'en', writable: false }
] as const

export function galleryLocaleOption(locale: GalleryLocale): GalleryLocaleOption {
  return GALLERY_LOCALE_OPTIONS.find((o) => o.id === locale) ?? GALLERY_LOCALE_OPTIONS[0]!
}

export interface GallerySet {
  id: string
  name: string
  collectorNumberMax: number | null
}

export interface GalleryImage {
  url: string | null
  accessibilityText?: string | null
  width?: number | null
  height?: number | null
}

export interface GalleryNamedValue {
  id: string
  label: string
}

export interface GalleryCard {
  id: string
  collectorNumber: number | null
  name: string
  subtitle?: string | null
  publicCode: string
  set: { id: string; label: string }
  rarity: { id: string; label: string }
  cardType: GalleryNamedValue[]
  superType?: GalleryNamedValue[]
  domains: GalleryNamedValue[]
  image: GalleryImage
  illustrator: string | null
  textHtml: string | null
  energy: number | null
  might: number | null
  power: number | null
  tags: string[]
}

export interface RetryOptions {
  signal?: AbortSignal
  beforeRequest?: () => Promise<void>
  onRetry?: (info: RetryInfo) => void
}

// 5xx 与网关限流：与官方小程序接口共用同一套退避策略。
const RETRYABLE = new Set([403, 408, 429, 500, 502, 503, 504, 520, 522, 523, 524, 525, 526])
const MAX_RETRIES = 5

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

function asString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

function asNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function namedValues(value: unknown): GalleryNamedValue[] {
  if (!Array.isArray(value)) return []
  return value
    .map((v) => {
      if (!v || typeof v !== 'object') return null
      const item = v as Record<string, unknown>
      const id = asString(item.id).trim()
      const label = asString(item.label).trim()
      if (!id && !label) return null
      return { id: id || label, label: label || id }
    })
    .filter((v): v is GalleryNamedValue => v !== null)
}

/** 上游 JSON → 稳定的内部结构；字段缺失一律降级为空值而不是抛错。 */
export function toGalleryCard(raw: unknown): GalleryCard | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, any>
  const id = asString(r.id).trim()
  const publicCode = asString(r.publicCode).trim()
  if (!id || !publicCode) return null
  return {
    id,
    collectorNumber: asNumberOrNull(r.collectorNumber),
    name: asString(r.name).trim(),
    subtitle: asString(r.subtitle).trim() || null,
    publicCode,
    set: {
      id: asString(r.set?.value?.id).trim(),
      label: asString(r.set?.value?.label).trim()
    },
    rarity: {
      id: asString(r.rarity?.value?.id).trim(),
      label: asString(r.rarity?.value?.label).trim()
    },
    cardType: namedValues(r.cardType?.type),
    superType: namedValues(r.cardType?.superType),
    domains: namedValues(r.domain?.values),
    image: {
      url: asString(r.cardImage?.url).trim() || null,
      accessibilityText: asString(r.cardImage?.accessibilityText).trim() || null,
      width: asNumberOrNull(r.cardImage?.dimensions?.width),
      height: asNumberOrNull(r.cardImage?.dimensions?.height)
    },
    illustrator: asString(r.illustrator?.values?.[0]?.label).trim() || null,
    textHtml: asString(r.text?.richText?.body).trim() || null,
    energy: asNumberOrNull(r.energy?.value?.id),
    might: asNumberOrNull(r.might?.value?.id),
    power: asNumberOrNull(r.power?.value?.id),
    tags: Array.isArray(r.tags?.tags) ? r.tags.tags.map((t: unknown) => asString(t).trim()).filter(Boolean) : []
  }
}

async function requestJson<T>(path: string, opts: RetryOptions, attempt = 0): Promise<T> {
  await opts.beforeRequest?.()
  let res: Response
  try {
    res = await fetch(path, { signal: opts.signal, headers: { Accept: 'application/json' } })
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e
    if (attempt < MAX_RETRIES) {
      const waitMs = Math.round(400 * 2 ** attempt + Math.random() * 300)
      opts.onRetry?.({ path, attempt: attempt + 1, maxAttempts: MAX_RETRIES, waitMs })
      await sleep(waitMs, opts.signal)
      return requestJson<T>(path, opts, attempt + 1)
    }
    throw e
  }
  if (RETRYABLE.has(res.status) && attempt < MAX_RETRIES) {
    const backoff = 600 * 2 ** attempt + Math.random() * 400
    const retryAfter = parseRetryAfterMs(res.headers.get('retry-after')) ?? 0
    const waitMs = Math.round(Math.max(backoff, retryAfter))
    opts.onRetry?.({ path, status: res.status, attempt: attempt + 1, maxAttempts: MAX_RETRIES, waitMs })
    await sleep(waitMs, opts.signal)
    return requestJson<T>(path, opts, attempt + 1)
  }
  if (!res.ok) throw new Error(`官网卡表接口请求失败 HTTP ${res.status}（${path}）`)
  return (await res.json()) as T
}

export function galleryPath(list: 'cards' | 'sets', locale: GalleryLocale, from: number, limit: number): string {
  const params = new URLSearchParams({ locale, from: String(from), limit: String(limit) })
  return `${GALLERY_PROXY_BASE}/${list}?${params.toString()}`
}

export interface GalleryFetchOptions extends RetryOptions {
  /** 同一轮拉取共享的请求前置节流器。 */
  minGapMs?: number
  maxGapMs?: number
}

function withPacer(opts: GalleryFetchOptions): RetryOptions {
  const minGapMs = opts.minGapMs ?? 120
  const maxGapMs = Math.max(minGapMs, opts.maxGapMs ?? minGapMs)
  return {
    ...opts,
    beforeRequest: createRequestPacer(minGapMs, maxGapMs, opts.signal)
  }
}

/** 拉取系列列表（含每个系列的最大编号，用于超编/签名超编判定）。 */
export async function fetchGallerySets(
  locale: GalleryLocale,
  opts: GalleryFetchOptions = {}
): Promise<GallerySet[]> {
  const json = await requestJson<{ data?: unknown[] }>(galleryPath('sets', locale, 0, 200), withPacer(opts))
  const rows = Array.isArray(json.data) ? json.data : []
  return rows
    .map((raw) => {
      if (!raw || typeof raw !== 'object') return null
      const r = raw as Record<string, unknown>
      const id = asString(r.id).trim()
      if (!id) return null
      return { id, name: asString(r.name).trim() || id, collectorNumberMax: asNumberOrNull(r.collectorNumberMax) }
    })
    .filter((s): s is GallerySet => s !== null)
}

export interface GalleryCardsResult {
  cards: GalleryCard[]
  /** 上游元数据里的 totalItems（可能略大于去重后的实际条数）。 */
  reportedTotal: number | null
}

/**
 * 分页拉取全量卡片并按 id 去重。
 *
 * 实测分页并不严格稳定（每页 195–200 条、顺序会变），因此不能只靠
 * 「本页不足 200 即结束」：这里以「连续两页无新增且已到上报总数」或
 * 「本页为空」作为终止条件，保证不遗漏。
 */
export async function fetchAllGalleryCards(
  locale: GalleryLocale,
  opts: GalleryFetchOptions & {
    onPage?: (page: number, got: number, unique: number) => void
  } = {}
): Promise<GalleryCardsResult> {
  const req = withPacer(opts)
  const byId = new Map<string, GalleryCard>()
  let reportedTotal: number | null = null
  const maxPages = 20

  for (let page = 1; page <= maxPages; page++) {
    const from = (page - 1) * GALLERY_PAGE_SIZE
    const json = await requestJson<{ data?: unknown[]; metadata?: { totalItems?: unknown } }>(
      galleryPath('cards', locale, from, GALLERY_PAGE_SIZE),
      req
    )
    const total = asNumberOrNull(json.metadata?.totalItems)
    if (total !== null) reportedTotal = total
    const rows = Array.isArray(json.data) ? json.data : []
    const before = byId.size
    for (const raw of rows) {
      const card = toGalleryCard(raw)
      if (card && !byId.has(card.id)) byId.set(card.id, card)
    }
    opts.onPage?.(page, rows.length, byId.size)
    if (!rows.length) break
    // 页序会漂移：只有连续一页毫无新增且已拿满上报总数才收工。
    if (byId.size === before && reportedTotal !== null && byId.size >= reportedTotal) break
    if (rows.length < GALLERY_PAGE_SIZE && reportedTotal !== null && byId.size >= reportedTotal) break
  }

  const cards = [...byId.values()].sort(
    (a, b) =>
      a.set.id.localeCompare(b.set.id) ||
      (a.collectorNumber ?? 0) - (b.collectorNumber ?? 0) ||
      a.publicCode.localeCompare(b.publicCode)
  )
  return { cards, reportedTotal }
}
