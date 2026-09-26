/**
 * 官网卡表同步编排：拉取 → 归一化 → 审核草稿。
 *
 * 与小程序同步（run.ts）的差异：
 *  - 列表接口不支持按系列过滤，先拉全量再本地筛；
 *  - en/zh-cn 收录全部印刷；ko/tw 只收录「卡图与英文不同」的本地化卡图；
 *  - 非目标语言（未翻译）的条目文本置空并标记，绝不把英文回退写进译文列。
 */
import {
  fetchAllGalleryCards,
  fetchGallerySets,
  galleryLocaleOption,
  type GalleryCard,
  type GalleryLocale,
  type GalleryLocaleOption,
  type RetryInfo
} from './galleryApi'
import {
  cardTextForTarget,
  mapGalleryCategories,
  mapGalleryRarity,
  normalizeGalleryCode,
  printLanguageOf
} from './galleryNormalize'

export type GalleryPrintLanguage = 'EN' | 'SC' | 'KR' | 'TC'

export interface GallerySeriesOption {
  id: string
  name: string
  collectorNumberMax: number | null
}

export interface GalleryBaseRow {
  card_no: string
  /** 目标语言卡名（未翻译时为空） */
  name: string | null
  subtitle: string | null
  effect: string | null
  /** 英文身份（accessibility 解析），用于新增与星号/SP 印刷绑定 */
  card_name_en: string | null
  sub_title_en: string | null
  series_name: string
  rarity_name: string | null
  energy: number | null
  card_category: string[]
  /** 官网该卡确实有目标语言文本 */
  localized: boolean
  sync_error?: string
  source_id: string
}

export interface GalleryPrintRow {
  base_card_no: string
  card_no_extend: string
  language: GalleryPrintLanguage
  rarity_name: string | null
  extend_rarity_name: string | null
  img_cdn: string | null
  artist: string | null
  series: string | null
  is_promo: boolean
  name: string | null
  subtitle: string | null
  name_en: string | null
  subtitle_en: string | null
  sync_error?: string
}

export interface GalleryDataset {
  locale: GalleryLocale
  option: GalleryLocaleOption
  language: GalleryPrintLanguage
  /** 官网无对应文本列的语言（fr/es/de/it/ja）只允许预览 */
  readOnly: boolean
  bases: GalleryBaseRow[]
  prints: GalleryPrintRow[]
  series: GallerySeriesOption[]
  selectedSeries: string[]
  stats: {
    cards: number
    bases: number
    prints: number
    untranslated: number
    skippedImages: number
  }
}

export interface GalleryProgress {
  label: string
  done: number
  total: number
  retry: RetryInfo | null
}

export interface FetchGalleryOptions {
  locale: GalleryLocale
  /** 选中的系列代码；空数组 = 全部 */
  seriesIds?: readonly string[]
  signal?: AbortSignal
  /** 请求节流（测试可传 0 关闭等待） */
  minGapMs?: number
  maxGapMs?: number
  onProgress?: (p: GalleryProgress) => void
  onRetry?: (info: RetryInfo) => void
}

/**
 * 判断某个编号形态是否应该有独立的基础卡行：
 *  - 字母版本（OGN-066a）、星号（SFD-227*）、SP 促销、超编号（OGN-300/298）
 *    都是致敬原作的异画，基础卡号指向别处，不能凭空新建；
 *  - 指示物（UNL-T04）与普通编号才有独立基础卡。
 */
function shouldCreateBase(extend: string, base: string): boolean {
  if (extend !== base) return false
  if (/\*/.test(extend)) return false
  if (/-SP\d+/i.test(extend)) return false
  return true
}

function isOverNumber(card: GalleryCard, max: number | null): boolean {
  return card.collectorNumber !== null && max !== null && card.collectorNumber > max
}

export async function fetchGalleryDataset(opts: FetchGalleryOptions): Promise<GalleryDataset> {
  const option = galleryLocaleOption(opts.locale)
  const target = option.target
  const language = printLanguageOf(opts.locale)
  const signal = opts.signal
  const req = { signal, onRetry: opts.onRetry, minGapMs: opts.minGapMs, maxGapMs: opts.maxGapMs }

  opts.onProgress?.({ label: '拉取系列列表…', done: 0, total: 0, retry: null })
  const sets = await fetchGallerySets(opts.locale, req)
  const maxBySet = new Map(sets.map((s) => [s.id, s.collectorNumberMax]))
  const series: GallerySeriesOption[] = sets.map((s) => ({
    id: s.id,
    name: s.name || s.id,
    collectorNumberMax: s.collectorNumberMax
  }))

  const cardsResult = await fetchAllGalleryCards(opts.locale, {
    ...req,
    onPage: (page, got, unique) =>
      opts.onProgress?.({ label: `拉取卡片列表…第 ${page} 页`, done: unique, total: got, retry: null })
  })
  const cards = cardsResult.cards

  // ko/tw 需要英文基线来判断卡图是否真正本地化（实测多数卡仍回退英文图）
  let baseline: Map<string, string> | null = null
  if (target === 'kr' || target === 'tw') {
    opts.onProgress?.({ label: '拉取英文基线以比对卡图…', done: 0, total: 0, retry: null })
    const en = await fetchAllGalleryCards('en_US', {
      ...req,
      onPage: (page, got, unique) =>
        opts.onProgress?.({ label: `拉取英文基线…第 ${page} 页`, done: unique, total: got, retry: null })
    })
    baseline = new Map(
      en.cards.filter((c) => c.image.url).map((c) => [c.id, c.image.url as string])
    )
  }

  const selected = [...(opts.seriesIds ?? [])]
  const selectedSet = new Set(selected)
  const inScope = (card: GalleryCard) => !selected.length || selectedSet.has(card.set.id)

  opts.onProgress?.({ label: '整理差异…', done: 0, total: cards.length, retry: null })

  const bases = new Map<string, GalleryBaseRow>()
  const prints = new Map<string, GalleryPrintRow>()
  let untranslated = 0
  let skippedImages = 0

  for (const card of cards) {
    if (!inScope(card)) continue
    const code = normalizeGalleryCode(card.publicCode)
    const text = cardTextForTarget(card, target)
    if (!text.localized) untranslated++

    // ── 基础卡行 ──
    const overNumber = isOverNumber(card, maxBySet.get(card.set.id) ?? null)
    const createBase = shouldCreateBase(code.extend, code.base) && !overNumber
    if (createBase && (target === 'en' || text.localized)) {
      const mapped = mapGalleryRarity(card.rarity.id, code.extend, card.collectorNumber, maxBySet.get(card.set.id) ?? null)
      const row: GalleryBaseRow = {
        card_no: code.base,
        name: text.name,
        subtitle: text.subtitle,
        effect: text.effect,
        card_name_en: text.nameEn,
        sub_title_en: text.subtitleEn,
        series_name: card.set.id,
        rarity_name: mapped.rarity_name,
        energy: card.energy,
        card_category: mapGalleryCategories(card, code.extend),
        localized: text.localized,
        sync_error: code.error ?? (text.unmapped.length ? `未识别标记：${text.unmapped.join('、')}` : undefined),
        source_id: card.id
      }
      const previous = bases.get(code.base)
      if (!previous || (!previous.localized && row.localized)) bases.set(code.base, row)
    }

    // ── 印刷行 ──
    let includePrint = true
    if (baseline) {
      const baseUrl = baseline.get(card.id)
      includePrint = Boolean(card.image.url && baseUrl && baseUrl !== card.image.url)
      if (!includePrint) skippedImages++
    }
    if (!includePrint) continue

    const mapped = mapGalleryRarity(card.rarity.id, code.extend, card.collectorNumber, maxBySet.get(card.set.id) ?? null)
    const printRow: GalleryPrintRow = {
      base_card_no: code.base,
      card_no_extend: code.extend,
      language,
      rarity_name: mapped.rarity_name,
      extend_rarity_name: mapped.extend_rarity_name,
      img_cdn: card.image.url,
      artist: card.illustrator,
      series: card.set.id,
      is_promo: false,
      name: text.name ?? text.nameEn,
      subtitle: text.subtitle ?? text.subtitleEn,
      name_en: text.nameEn,
      subtitle_en: text.subtitleEn,
      sync_error: code.error
    }
    const key = `${printRow.card_no_extend}\u0000${printRow.language}`
    const previous = prints.get(key)
    if (previous && JSON.stringify(previous) !== JSON.stringify(printRow)) {
      previous.sync_error = '官网中同一编号和语言存在多个不同版本，请核对来源'
    } else prints.set(key, printRow)
  }

  return {
    locale: opts.locale,
    option,
    language,
    readOnly: !option.writable,
    bases: [...bases.values()].sort((a, b) => a.card_no.localeCompare(b.card_no)),
    prints: [...prints.values()].sort((a, b) => a.card_no_extend.localeCompare(b.card_no_extend)),
    series,
    selectedSeries: selected,
    stats: {
      cards: cards.length,
      bases: bases.size,
      prints: prints.size,
      untranslated,
      skippedImages
    }
  }
}

/** 面板展示用：把选中的系列映射成文案。 */
export function gallerySeriesLabel(dataset: GalleryDataset): string {
  if (!dataset.selectedSeries.length) return '全部系列'
  const codes = dataset.series.filter((s) => dataset.selectedSeries.includes(s.id)).map((s) => s.id)
  return codes.length ? codes.join('、') : dataset.selectedSeries.join('、')
}
