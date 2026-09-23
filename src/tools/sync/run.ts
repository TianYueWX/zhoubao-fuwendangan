/**
 * 同步编排：线上接口 → 归一化行。
 * 不涉及 Supabase 写入，纯数据获取与转换。
 *
 * 两种模式：
 *  - fast（默认）：分页拉取列表，对新增基础卡、勘误卡及未知系列补拉详情
 *    （用于取得 cardSeries / attachEffect），其余直接由列表行构建；印刷属性始终来自对应列表行。
 *  - deep：逐卡拉取详情（1266 次），字段最全，但易触发网关限流；配合本地缓存续跑。
 */
import {
  cardDetail,
  createRequestPacer,
  getDictList,
  getKeywordConfig,
  mapLimit,
  searchAllCards,
  type ApiCardDetail,
  type ApiSearchCard,
  type RetryInfo
} from './riftboundApi'
import {
  baseCardNo,
  buildCardsBase,
  buildCardsBaseFromSearch,
  buildIcon,
  buildPrintFromSearch,
  extractTokens,
  normalizeCardNo,
  type CardIconRow,
  type CardPrintExportRow,
  type CardsBaseRow
} from './normalize'
import type { SeriesPreset } from './exporters'

export type SyncPhase = 'idle' | 'search' | 'detail' | 'keywords' | 'done' | 'error'
export type FetchMode = 'fast' | 'deep'

export const DEFAULT_FETCH_POLICY = {
  fast: { concurrency: 3, minGapMs: 150, maxGapMs: 150 },
  deep: { concurrency: 1, minGapMs: 500, maxGapMs: 1200 }
} as const satisfies Record<FetchMode, { concurrency: number; minGapMs: number; maxGapMs: number }>

export interface SyncProgress {
  phase: SyncPhase
  label: string
  done: number
  total: number
}

export interface SyncDataset {
  cards: CardsBaseRow[]
  prints: CardPrintExportRow[]
  icons: CardIconRow[]
  /** 数据中出现、但 series 表里没有的系列（预置用，用户后续手改名称） */
  seriesPresets: SeriesPreset[]
  stats: {
    searchRows: number
    details: number
    missingDetails: number
    enriched: number
    bannedCards: number
    tokens: number
    icons: number
  }
}

export interface FetchDatasetOptions {
  baseUrl?: string
  /** 拉取模式，默认 fast */
  mode?: FetchMode
  /** 并发数：快速模式默认 3，深度模式默认 1 */
  concurrency?: number
  /** 全局最小请求间隔（毫秒）：快速模式默认 150，深度模式默认 500 */
  minGapMs?: number
  /** 全局最大请求间隔（毫秒）：快速模式默认 150，深度模式默认 1200 */
  maxGapMs?: number
  /** series 表已有代码，用于计算缺失系列 */
  existingSeriesCodes?: string[]
  /** 卡号前缀 → 系列代码（来自现有 cards_base），用于 fast 模式推断 series_name */
  seriesByPrefix?: Record<string, string>
  /** 已有基础卡身份，用于补拉新基础卡详情（含装配效果）。 */
  existingCardKeys?: string[]
  /** 详情缓存（按接口 cardNo），命中则跳过网络请求；会被就地写入以便续跑 */
  detailCache?: Record<string, ApiCardDetail>
  /** fast 模式下允许补拉详情的未知前缀卡牌上限，默认 120 */
  maxEnrich?: number
  signal?: AbortSignal
  onProgress?: (p: SyncProgress) => void
  /** 触发退避重试前的回调，用于界面显示「重试中」。 */
  onRetry?: (info: RetryInfo) => void
}

const SERIES_RELEASE_ORDER: Record<string, number> = {
  FND: 10, ARC: 20, OGN: 30, OGS: 40, SFD: 50, UNL: 50, VEN: 60
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('已取消', 'AbortError')
}

function prefixOf(base: string): string {
  return base.split('-')[0] ?? ''
}

/** 拉取并归一化全部数据（cards_base / card_prints / card_icons 三类） */
export async function fetchDataset(opts: FetchDatasetOptions = {}): Promise<SyncDataset> {
  const mode = opts.mode ?? 'fast'
  const policy = DEFAULT_FETCH_POLICY[mode]
  const concurrency = opts.concurrency ?? policy.concurrency
  const minGapMs = opts.minGapMs ?? policy.minGapMs
  const maxGapMs = opts.maxGapMs ?? (opts.minGapMs === undefined ? policy.maxGapMs : minGapMs)
  const {
    baseUrl,
    existingSeriesCodes = [], seriesByPrefix = {}, existingCardKeys = [], detailCache,
    maxEnrich = 120, signal, onProgress, onRetry
  } = opts
  const req = {
    baseUrl,
    signal,
    beforeRequest: createRequestPacer(minGapMs, maxGapMs, signal),
    onRetry
  }
  const report = (phase: SyncPhase, label: string, done = 0, total = 0) =>
    onProgress?.({ phase, label, done, total })

  // ① 卡牌列表
  report('search', '拉取卡牌列表…')
  const searchRows: ApiSearchCard[] = await searchAllCards({
    ...req,
    onPage: (page, got) => report('search', `拉取卡牌列表…第 ${page} 页（${got} 条）`)
  })
  throwIfAborted(signal)
  if (!searchRows.length) throw new Error('接口未返回任何卡牌')

  // 禁限状态由人工维护，本次同步不获取、不写入。
  const banned = new Set<string>()
  throwIfAborted(signal)

  // ③ 详情（deep：全部；fast：仅未知前缀的少量卡牌）
  const knownPrefixes = new Set(Object.keys(seriesByPrefix))
  const detailByCardNo = new Map<string, ApiCardDetail>()
  let detailsCount = 0
  let missing = 0
  let enriched = 0

  const fetchDetails = async (rows: ApiSearchCard[]) => {
    report('detail', '拉取卡牌详情…', 0, rows.length)
    const out = await mapLimit(
      rows,
      concurrency,
      async (row) => {
        const cached = detailCache?.[row.cardNo]
        if (cached && !row.errata?.trim() && !cached.errata?.trim()
          && cached.cardName === row.cardName && cached.subTitle === row.subTitle
          && (cached.cardEffect || '').trim() === (row.cardEffect || '').trim()) return cached
        const d = await cardDetail(row.cardNo, req)
        if (d && detailCache) detailCache[row.cardNo] = d
        if (!d) missing++
        return d
      },
      (done, total) => report('detail', '拉取卡牌详情…', done, total)
    )
    for (const d of out) if (d) detailByCardNo.set(d.cardNo, d)
  }

  if (mode === 'deep') {
    await fetchDetails(searchRows)
    detailsCount = detailByCardNo.size
    enriched = detailsCount
  } else {
    // 未知前缀卡牌：补拉详情以取得 cardSeries（及 attachEffect）
    const unknown = searchRows.filter((r) => {
      const base = baseCardNo(normalizeCardNo(r.cardNo).extend)
      const p = prefixOf(base)
      return !knownPrefixes.has(p) && !existingSeriesCodes.includes(p)
    })
    const knownCards = new Set(existingCardKeys)
    const required = searchRows.filter((r) => Boolean(r.errata?.trim()) ||
      !knownCards.has(JSON.stringify([(r.cardName || '').trim(), (r.subTitle || '').trim()])))
    const enrich = [...new Map([
      ...required, ...(unknown.length <= maxEnrich ? unknown : [])
    ].map((r) => [r.cardNo, r])).values()]
    if (enrich.length) {
      await fetchDetails(enrich)
      detailsCount = detailByCardNo.size
      enriched = detailsCount
    }
  }
  throwIfAborted(signal)

  // ④ 逐列表行构建 cards_base / card_prints
  const byBase = new Map<string, CardsBaseRow>()
  const printMap = new Map<string, CardPrintExportRow>()
  const tokenSet = new Set<string>()

  for (const row of searchRows) {
    const { extend } = normalizeCardNo(row.cardNo)
    const base = baseCardNo(extend)
    const d = detailByCardNo.get(row.cardNo)
    const seriesName = d?.cardSeries || seriesByPrefix[prefixOf(base)] || null

    const cardRow = d
      ? buildCardsBase(d, banned.has(base))
      : buildCardsBaseFromSearch(row, banned.has(base), seriesName)
    // 保留同名不同编号/不同勘误的候选，交给审核层去重或提示冲突。
    byBase.set(JSON.stringify([base, cardRow.card_name_cn, cardRow.sub_title_cn, cardRow.effect_cn]), cardRow)

    // 列表的一行就是一个印刷版本；详情的 craftList[0] 不一定对应该版本。
    const printRow = buildPrintFromSearch(row, seriesName)
    const key = `${printRow.card_no_extend}\u0000${printRow.language}`
    const previousPrint = printMap.get(key)
    if (previousPrint && JSON.stringify(previousPrint) !== JSON.stringify(printRow)) {
      previousPrint.sync_error = '接口中同一编号和语言存在多个不同版本，请核对来源'
    } else printMap.set(key, printRow)

    for (const t of extractTokens(row.cardEffect)) tokenSet.add(t)
    for (const t of extractTokens(row.errata)) tokenSet.add(t)
    if (d) for (const t of extractTokens(d.attachEffect)) tokenSet.add(t)
  }

  // ⑤ 关键词图标
  const tokens = [...tokenSet]
  report('keywords', '拉取关键词图标…', 0, tokens.length)
  const iconRows = await mapLimit(
    tokens,
    concurrency,
    async (t) => buildIcon(await getKeywordConfig(t, req)),
    (done, total) => report('keywords', '拉取关键词图标…', done, total)
  )
  const iconMap = new Map<string, CardIconRow>()
  for (const ic of iconRows) if (ic) iconMap.set(ic.name_zh, ic)

  // ⑥ 缺失系列预置（名称先占位，用户后续手改）
  let dictSeries: string[] = []
  try {
    const dict = await getDictList('card_series', req)
    dictSeries = dict.map((d) => d.code)
  } catch {
    /* 忽略 */
  }
  const presentCodes = new Set<string>(dictSeries)
  for (const row of byBase.values()) if (row.series_name) presentCodes.add(row.series_name)
  const existing = new Set(existingSeriesCodes)
  const seriesPresets: SeriesPreset[] = [...presentCodes]
    .filter((code) => code && !existing.has(code))
    .sort()
    .map((code) => ({
      code,
      name_cn: code,
      name_en: code,
      release_order: SERIES_RELEASE_ORDER[code] ?? 0
    }))

  report('done', '拉取完成')
  return {
    cards: [...byBase.values()].sort((a, b) => a.card_no.localeCompare(b.card_no)),
    prints: [...printMap.values()].sort((a, b) => a.card_no_extend.localeCompare(b.card_no_extend)),
    icons: [...iconMap.values()].sort((a, b) => a.name_zh.localeCompare(b.name_zh, 'zh')),
    seriesPresets,
    stats: {
      searchRows: searchRows.length,
      details: detailsCount,
      missingDetails: missing,
      enriched,
      bannedCards: banned.size,
      tokens: tokens.length,
      icons: iconMap.size
    }
  }
}
