/**
 * 线上接口 → Supabase 行 的字段映射与规范化。
 *
 * 只映射「接口拥有」的列；以下人工维护列一律不产出、不覆盖：
 *   cards_base : keyword / advanced_tag / deck_limit / *_en
 *   card_prints: tts_cdn / print_order / is_default / EN 行
 *   card_icons : name_en / url_en
 */
import type { ApiCardDetail, ApiKeywordConfig, ApiSearchCard } from './riftboundApi'

/* ------------------------------------------------------------------ */
/* 目标行类型                                                          */
/* ------------------------------------------------------------------ */

export interface CardsBaseRow {
  card_no: string
  card_name_cn: string | null
  sub_title_cn: string | null
  card_color_list: string[]
  region: string[]
  tag: string[]
  champion_tag: string | null
  effect_cn: string | null
  flavor_text_cn: string | null
  energy: number | null
  return_energy: number | null
  power: number | null
  rarity_name: string | null
  series_name: string | null
  card_category: string[]
  is_banned: boolean
}

export interface CardPrintRow {
  card_no_extend: string
  language: 'SC'
  rarity_name: string | null
  extend_rarity_name: string | null
  img_cdn: string | null
  back_image: string | null
  artist: string | null
  series: string | null
  flavor_text_cn: string | null
  is_promo: boolean
}

export interface CardIconRow {
  name_zh: string
  name_en: string
  url: string
  storage_type: 'online'
  isWhite: boolean
}

/** 仅用于 SQL 导出的 card_prints 行（附带父卡号，导出时用子查询解析 card_id） */
export interface CardPrintExportRow extends CardPrintRow {
  base_card_no: string
}

export interface CardsBaseExportRow extends CardsBaseRow {
  id?: string
}

/* ------------------------------------------------------------------ */
/* 卡号规范化                                                          */
/* ------------------------------------------------------------------ */

const PROMO_SUFFIX = /·P(?:·(?:SC|EN))?$/

export interface NormalizedCardNo {
  /** 归一化后的扩展编号，如 VEN·019a → VEN-019a、OGN·001/298 → OGN-001 */
  extend: string
  /** 是否带 ·P 促销标记 */
  isPromo: boolean
}

/** 把接口展示用卡号（·、/总数、·P·SC）归一化为库内 card_no_extend */
export function normalizeCardNo(apiCardNo: string): NormalizedCardNo {
  let s = (apiCardNo || '').trim()
  let isPromo = false
  const promo = s.match(PROMO_SUFFIX)
  if (promo && promo.index !== undefined) {
    isPromo = true
    s = s.slice(0, promo.index)
  }
  s = s.replace(/·/g, '-')
  s = s.replace(/\/\d+$/, '')
  return { extend: s, isPromo }
}

/** 去掉尾部小写字母后缀，得到基础卡号：VEN-019a → VEN-019 */
export function baseCardNo(extend: string): string {
  return extend.replace(/[a-z]+$/, '')
}

/** 卡号所属系列代码：VEN-019a → VEN */
export function seriesCodeOf(cardNo: string): string {
  const m = (cardNo || '').match(/^([A-Za-z0-9]+)-/)
  // noUncheckedIndexedAccess:m[1] 可能为 undefined
  return m?.[1] ?? ''
}

/** 提取效果文本里的 {{标记}}（去重、保序、去空白） */
export function extractTokens(text: string | null | undefined): string[] {
  if (!text) return []
  const out: string[] = []
  const seen = new Set<string>()
  const re = /\{\{([^{}]+)\}\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const t = (m[1] ?? '').trim()
    if (t && !seen.has(t)) {
      seen.add(t)
      out.push(t)
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* 行构建                                                              */
/* ------------------------------------------------------------------ */

function splitList(s: string | null | undefined): string[] {
  if (!s) return []
  return s
    .split(/[，,、]/)
    .map((x) => x.trim())
    .filter(Boolean)
}

function emptyToNull(s: string | null | undefined): string | null {
  if (s === null || s === undefined) return null
  const t = String(s).trim()
  return t ? t : null
}

/** 效果文本：errata 优先，其次 cardEffect；有装配效果则追加 */
function buildEffectCn(detail: ApiCardDetail): string | null {
  const errata = (detail.errata || '').trim()
  const base = errata || (detail.cardEffect || '').trim()
  const attach = (detail.attachEffect || '').trim()
  const parts = [base, attach].filter(Boolean)
  return parts.length ? parts.join('\n') : null
}

export function buildCardsBase(detail: ApiCardDetail, isBanned: boolean): CardsBaseRow {
  const { extend } = normalizeCardNo(detail.cardNo)
  const craft = (detail.craftList && detail.craftList[0]) || null
  return {
    card_no: baseCardNo(extend),
    card_name_cn: emptyToNull(detail.cardName),
    sub_title_cn: emptyToNull(detail.subTitle),
    card_color_list: detail.cardColorList || [],
    region: splitList(detail.region),
    tag: splitList(detail.tag),
    champion_tag: emptyToNull(detail.hero),
    effect_cn: buildEffectCn(detail),
    flavor_text_cn: emptyToNull(detail.flavorText),
    energy: detail.energy ?? null,
    return_energy: detail.returnEnergy ?? null,
    power: detail.power ?? null,
    rarity_name: emptyToNull(craft?.rarityName),
    series_name: emptyToNull(detail.cardSeries) || seriesCodeOf(extend) || null,
    card_category: detail.cardCategoryNameList || [],
    is_banned: isBanned
  }
}

export function buildPrint(detail: ApiCardDetail): CardPrintExportRow {
  const { extend, isPromo } = normalizeCardNo(detail.cardNo)
  const craft = (detail.craftList && detail.craftList[0]) || null
  return {
    base_card_no: baseCardNo(extend),
    card_no_extend: extend,
    language: 'SC',
    rarity_name: emptyToNull(craft?.rarityName),
    extend_rarity_name: emptyToNull(craft?.extendRarityName),
    img_cdn: emptyToNull(craft?.frontImage),
    back_image: craft?.backImage ?? '',
    artist: emptyToNull(craft?.artist),
    series: emptyToNull(detail.cardSeries) || seriesCodeOf(extend) || null,
    flavor_text_cn: emptyToNull(detail.flavorText),
    is_promo: isPromo
  }
}

/* ------------------------------------------------------------------ */
/* 快速模式：仅凭列表行构建（不逐卡拉详情）                             */
/* 说明：列表行已含绝大部分字段；缺 attachEffect（装配效果），          */
/*       series_name 由调用方按前缀映射给出。                          */
/* ------------------------------------------------------------------ */

function effectFromSearch(row: ApiSearchCard): string | null {
  const errata = (row.errata || '').trim()
  const base = errata || (row.cardEffect || '').trim()
  return base || null
}

export function buildCardsBaseFromSearch(
  row: ApiSearchCard,
  isBanned: boolean,
  seriesName: string | null
): CardsBaseRow {
  const { extend } = normalizeCardNo(row.cardNo)
  return {
    card_no: baseCardNo(extend),
    card_name_cn: emptyToNull(row.cardName),
    sub_title_cn: emptyToNull(row.subTitle),
    card_color_list: row.cardColorList || [],
    region: splitList(row.region),
    tag: splitList(row.tag),
    champion_tag: emptyToNull(row.hero),
    effect_cn: effectFromSearch(row),
    flavor_text_cn: emptyToNull(row.flavorText),
    energy: row.energy ?? null,
    return_energy: row.returnEnergy ?? null,
    power: row.power ?? null,
    rarity_name: emptyToNull(row.rarityName),
    series_name: seriesName || seriesCodeOf(extend) || null,
    card_category: row.cardCategoryNameList || [],
    is_banned: isBanned
  }
}

export function buildPrintFromSearch(row: ApiSearchCard, seriesName: string | null): CardPrintExportRow {
  const { extend, isPromo } = normalizeCardNo(row.cardNo)
  return {
    base_card_no: baseCardNo(extend),
    card_no_extend: extend,
    language: 'SC',
    rarity_name: emptyToNull(row.rarityName),
    extend_rarity_name: emptyToNull(row.extendRarityName),
    img_cdn: emptyToNull(row.frontImage),
    back_image: row.backImage ?? '',
    artist: emptyToNull(row.artist),
    series: seriesName || seriesCodeOf(extend) || null,
    flavor_text_cn: emptyToNull(row.flavorText),
    is_promo: isPromo
  }
}

export function buildIcon(cfg: ApiKeywordConfig | null): CardIconRow | null {
  if (!cfg || !cfg.name || !cfg.icon) return null
  return {
    name_zh: cfg.name,
    name_en: '',
    url: cfg.icon,
    storage_type: 'online',
    isWhite: cfg.color === 'white'
  }
}
