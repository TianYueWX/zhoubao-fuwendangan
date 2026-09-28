/**
 * 离线拉取包 → SyncDataset
 *
 * 包由 `scripts/colab_fetch_xcx_cards.py` 在 Colab 里产出
 * （`format = "riftbound-xcx-pull"`，内含原始接口响应 + 拉取元信息）。
 *
 * 设计原则：**与在线拉取共用同一套映射**。这里按列表的原始顺序逐行走
 * `run.ts` 步骤 ④ 的同一段逻辑（`buildCardsBase` / `buildCardsBaseFromSearch`
 * / `buildPrintFromSearch` / `normalizeCardNo`，`byBase` 去重键一字不改），
 * 因此导入结果与网页在线「深度模式」逐字一致，审核层不需要任何新概念。
 *
 * 分级校验：
 *  - 结构性错误（不是 JSON / format 不符 / 版本不支持 / 没有卡牌列表）→ 抛错，拒绝导入
 *  - 数据性缺失（个别卡没详情、个别字段为空）→ 放行，按列表行构建并在摘要里标黄
 */
import type { ApiCardDetail, ApiDictItem, ApiKeywordConfig, ApiSearchCard } from './riftboundApi'
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
import {
  SERIES_RELEASE_ORDER,
  type SyncDataset
} from './run'

export const PULL_FORMAT = 'riftbound-xcx-pull'
export const PULL_FORMAT_VERSION = 1

/** 详情包里的每一条：原始信封，或（宽容起见）直接给的详情对象。 */
type EnvelopeOrValue = unknown

export interface PullErrorItem {
  cardNo: string
  stage: string
  error: string
}

export interface PullSummary {
  /** 拉取时间（原样展示，解析不了就用原字符串） */
  pulledAt: string
  /** 相对现在的时长（如「3 小时前」），拿不到时间为空 */
  ageText: string
  baseUrl: string
  filters: Record<string, unknown>
  script: string
  searchRows: number
  detailOk: number
  detailMissing: number
  detailFailed: number
  icons: number
  hasIcons: boolean
  hasDict: boolean
  /** 数据性问题：只标黄，不拦截导入 */
  problems: string[]
  errors: PullErrorItem[]
}

export interface PullImportResult {
  dataset: SyncDataset
  summary: PullSummary
}

export interface PullImportOptions {
  /** 库内已有的系列代码，用于算「缺失系列」预置 */
  existingSeriesCodes?: string[]
  /** 库内卡号前缀 → 系列代码，仅用于缺详情的行推断 series_name */
  seriesByPrefix?: Record<string, string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 从信封里取 result；兼容「直接给值」的写法。 */
function unwrap<T>(value: EnvelopeOrValue, looksLikeValue: (v: unknown) => boolean): T | null {
  if (isRecord(value) && 'code' in value) {
    if (value.code !== 0) return null
    return (value.result ?? null) as T | null
  }
  return looksLikeValue(value) ? (value as T) : null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * 结构校验并返回原始包对象。任何结构性错误都抛 Error（中文、可读），
 * 由调用方展示后放弃导入，当前数据集不受影响。
 */
export function parsePullPackage(raw: string): Record<string, unknown> {
  const source = (raw || '').trim()
  if (!source) throw new Error('文件是空的，没有可导入的内容')
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch (e) {
    throw new Error(`不是合法的 JSON：${e instanceof Error ? e.message : String(e)}`)
  }
  if (!isRecord(parsed)) throw new Error('包内容不是对象，无法识别为本工具的拉取包')
  const format = text(parsed.format)
  if (!format) {
    throw new Error(`缺少 format 标记，不是本工具产出的拉取包（期望 ${PULL_FORMAT}）`)
  }
  if (format !== PULL_FORMAT) {
    throw new Error(`format 不是 ${PULL_FORMAT}（实际为 ${format}），请确认选的是 Colab 脚本产出的文件`)
  }
  const version = parsed.formatVersion
  if (version !== PULL_FORMAT_VERSION) {
    throw new Error(
      `包版本 formatVersion=${String(version)} 不受支持（本页支持 ${PULL_FORMAT_VERSION}），` +
      '请用仓库里最新的 scripts/colab_fetch_xcx_cards.py 重新拉取'
    )
  }
  const search = parsed.search
  if (!isRecord(search) || !isRecord(search.envelope)) {
    throw new Error('缺少 search.envelope，包里没有卡牌列表')
  }
  const envelope = search.envelope
  if (envelope.code !== 0) {
    throw new Error(`包里的卡牌列表是失败的响应（code=${String(envelope.code)} message=${String(envelope.message)}）`)
  }
  if (!Array.isArray(envelope.result)) {
    throw new Error('search.envelope.result 不是数组，无法读取卡牌列表')
  }
  if (!envelope.result.length) {
    throw new Error('包里的卡牌列表是空的（0 行），拒绝导入以免误判成「库里全是多的」')
  }
  return parsed
}

function formatAge(pulledAt: string): string {
  if (!pulledAt) return ''
  const at = Date.parse(pulledAt)
  if (!Number.isFinite(at)) return ''
  const diff = Date.now() - at
  if (diff < 0) return ''
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

function prefixOf(base: string): string {
  return base.split('-')[0] ?? ''
}

/**
 * 把拉取包转成 SyncDataset。映射规则与 `run.ts` 的在线拉取完全一致，
 * 只是「详情」来自包里而不是网络。
 */
export function datasetFromPull(
  pkg: Record<string, unknown>,
  opts: PullImportOptions = {}
): PullImportResult {
  const searchEnvelope = (pkg.search as Record<string, unknown>).envelope as Record<string, unknown>
  const rows = (searchEnvelope.result as unknown[]).filter(isRecord) as unknown as ApiSearchCard[]
  const problems: string[] = []

  const invalidRows = (searchEnvelope.result as unknown[]).length - rows.length
  if (!rows.length) throw new Error('卡牌列表里没有可解析的行')
  if (invalidRows > 0) problems.push(`列表里有 ${invalidRows} 行不是对象，已跳过`)

  const missingCardNo = rows.filter((r) => !text(r.cardNo)).length
  if (missingCardNo) problems.push(`列表里有 ${missingCardNo} 行没有 cardNo，已按空编号处理`)
  if (missingCardNo === rows.length) throw new Error('列表里所有行都没有 cardNo，无法构建卡表')

  // ── 详情：信封或裸对象都吃，键用 JSON 里的 cardNo 与响应里的 cardNo 双写 ──
  const detailByCardNo = new Map<string, ApiCardDetail>()
  const rawDetails = isRecord(pkg.details) ? pkg.details : {}
  for (const [key, value] of Object.entries(rawDetails)) {
    const detail = unwrap<ApiCardDetail>(value, (v) => isRecord(v) && 'cardNo' in v)
    if (!detail) continue
    detailByCardNo.set(key, detail)
    if (text(detail.cardNo)) detailByCardNo.set(text(detail.cardNo), detail)
  }

  const errors: PullErrorItem[] = Array.isArray(pkg.errors)
    ? (pkg.errors as unknown[]).filter(isRecord).map((e) => ({
      cardNo: text(e.cardNo) || '(未知卡号)',
      stage: text(e.stage) || 'detail',
      error: text(e.error) || '未知错误'
    }))
    : []

  // ── 与 run.ts 步骤 ④ 同一段构建 ──
  const { existingSeriesCodes = [], seriesByPrefix = {} } = opts
  const banned = new Set<string>()
  const byBase = new Map<string, CardsBaseRow>()
  const printMap = new Map<string, CardPrintExportRow>()
  const tokenSet = new Set<string>()
  let detailRows = 0

  for (const row of rows) {
    const { extend } = normalizeCardNo(row.cardNo)
    const base = baseCardNo(extend)
    const detail = detailByCardNo.get(row.cardNo)
    if (detail) detailRows++
    const seriesName = detail?.cardSeries || seriesByPrefix[prefixOf(base)] || null

    const cardRow = detail
      ? buildCardsBase(detail, banned.has(base))
      : buildCardsBaseFromSearch(row, banned.has(base), seriesName)
    byBase.set(JSON.stringify([base, cardRow.card_name_cn, cardRow.sub_title_cn, cardRow.effect_cn]), cardRow)

    const printRow = buildPrintFromSearch(row, seriesName)
    const key = `${printRow.card_no_extend}\u0000${printRow.language}`
    const previousPrint = printMap.get(key)
    if (previousPrint && JSON.stringify(previousPrint) !== JSON.stringify(printRow)) {
      previousPrint.sync_error = '接口中同一编号和语言存在多个不同版本，请核对来源'
    } else printMap.set(key, printRow)

    for (const t of extractTokens(row.cardEffect)) tokenSet.add(t)
    for (const t of extractTokens(row.errata)) tokenSet.add(t)
    if (detail) for (const t of extractTokens(detail.attachEffect)) tokenSet.add(t)
  }

  // ── 图标：包里有就同步，没有就留空由审核页跳过该阶段 ──
  const iconMap = new Map<string, CardIconRow>()
  let hasIcons = false
  const rawIcons = isRecord(pkg.icons) ? pkg.icons : null
  if (rawIcons) {
    for (const value of Object.values(rawIcons)) {
      const cfg = unwrap<ApiKeywordConfig>(value, (v) => isRecord(v) && 'name' in v)
      const icon = buildIcon(cfg)
      if (icon) {
        hasIcons = true
        iconMap.set(icon.name_zh, icon)
      }
    }
  }

  // ── 系列字典：有字典用字典，没有就按卡号前缀与库内已有系列推断 ──
  const rawDict = isRecord(pkg.dict) ? pkg.dict : null
  const seriesEnvelope = rawDict && isRecord(rawDict.card_series) ? rawDict.card_series : null
  const dictSeries = seriesEnvelope
    ? (unwrap<ApiDictItem[]>(seriesEnvelope, Array.isArray) ?? [])
    : []
  const hasDict = dictSeries.length > 0
  const presentCodes = new Set<string>(dictSeries.map((d) => text(d?.code)).filter(Boolean))
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

  // ── 摘要与数据性提示 ──
  const rawStats = isRecord(pkg.stats) ? pkg.stats : {}
  const statNumber = (key: string) => (typeof rawStats[key] === 'number' ? (rawStats[key] as number) : 0)
  const detailMissing = rows.length - detailRows
  const detailFailed = errors.filter((e) => e.stage === 'detail').length
  const pulledAt = text(pkg.pulledAt)
  const ageText = formatAge(pulledAt)
  const filters = isRecord(pkg.filters) ? pkg.filters : {}
  const filterKeys = Object.keys(filters).filter((k) => {
    const v = filters[k]
    return Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined && v !== ''
  })
  const script = isRecord(pkg.script)
    ? [text(pkg.script.name) || 'colab_fetch_xcx_cards.py', text(pkg.script.version)].filter(Boolean).join(' v')
    : ''

  if (detailMissing > 0) {
    problems.push(
      `${detailMissing} 个印刷版本没有详情，已按列表行构建（缺装配效果；系列用编号前缀推断），这些行会显示「详情缺失」`
    )
  }
  if (detailFailed > 0) problems.push(`拉取时有 ${detailFailed} 条详情失败，详见包的 errors 清单`)
  if (!hasIcons) problems.push('本包不含关键词图标，「关键词图标」阶段没有数据可同步（不影响卡牌与印刷版本）')
  if (!hasDict) problems.push('本包不含系列字典，「缺失系列」按卡号前缀推断，可能需要到资源页核对名称')
  if (filterKeys.length) {
    problems.push(
      `本包是筛选拉取（${filterKeys.map((k) => `${k}=${JSON.stringify(filters[k])}`).join(' ')}），` +
      '审核只覆盖这些卡；库内其余卡牌不在本轮比对范围内'
    )
  }
  const ageMs = pulledAt ? Date.now() - Date.parse(pulledAt) : 0
  if (Number.isFinite(ageMs) && ageMs > 24 * 3600 * 1000) {
    problems.push(`本包拉取于 ${ageText}，如果这期间官方有改动，建议重新拉一份`)
  }

  const dataset: SyncDataset = {
    cards: [...byBase.values()].sort((a, b) => a.card_no.localeCompare(b.card_no)),
    prints: [...printMap.values()].sort((a, b) => a.card_no_extend.localeCompare(b.card_no_extend)),
    icons: [...iconMap.values()].sort((a, b) => a.name_zh.localeCompare(b.name_zh, 'zh')),
    seriesPresets,
    stats: {
      searchRows: rows.length,
      details: detailRows,
      missingDetails: detailMissing,
      enriched: statNumber('enriched') || detailRows,
      bannedCards: 0,
      tokens: tokenSet.size,
      icons: iconMap.size
    }
  }

  return {
    dataset,
    summary: {
      pulledAt,
      ageText,
      baseUrl: text(pkg.baseUrl),
      filters,
      script,
      searchRows: rows.length,
      detailOk: detailRows,
      detailMissing,
      detailFailed,
      icons: iconMap.size,
      hasIcons,
      hasDict,
      problems,
      errors
    }
  }
}
