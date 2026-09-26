/**
 * 官网卡表 → cards_base / card_prints 行 的字段映射与规范化。
 *
 * 与小程序接口（normalize.ts）的关键差异：
 *  - 编号包含 `*`（签名超编）、`SPn`（促销）、`Tn`（指示物）等形态；
 *  - 副标题有独立字段 `subtitle`，缺失且名字含逗号时才按逗号拆分；
 *  - 中文/韩文/繁中效果是 HTML + `:rb_*:` 标记，需转成库内
 *    `纯文本 + {{标记}}` 约定（英文保持原始 HTML）。
 */
import type { GalleryCard, GalleryLocale } from './galleryApi'
import { galleryLocaleOption, type GalleryTarget } from './galleryApi'

/* ------------------------------------------------------------------ */
/* 编号                                                                */
/* ------------------------------------------------------------------ */

export interface NormalizedGalleryCode {
  /** 印刷编号（含字母版本/星号/SP/T 后缀），如 OGN-066a、SFD-227*、VEN-SP3、UNL-T04 */
  extend: string
  /** 基础卡号（去掉字母版本与星号），如 OGN-066、SFD-227、VEN-SP3、UNL-T04 */
  base: string
  error?: string
}

/**
 * `UNL-131/219` → UNL-131；`OGN-066a/298` → OGN-066a；
 * `SFD-227*` 加 `/221` → SFD-227*；`VEN-SP3/006` → VEN-SP3。
 */
export function normalizeGalleryCode(publicCode: string): NormalizedGalleryCode {
  let s = (publicCode || '').trim()
  s = s.replace(/[·.．・]/g, '-')
  s = s.replace(/\/\d+$/, '')
  const valid = /^[A-Za-z0-9]+-[A-Za-z0-9*]+[a-z*]?$/.test(s)
  const base = s.replace(/[*]+$/, '').replace(/[a-z]+$/, '')
  return { extend: s, base: base || s, error: valid ? undefined : `无法解析官网编号：${publicCode}` }
}

/* ------------------------------------------------------------------ */
/* 副标题                                                              */
/* ------------------------------------------------------------------ */

/** 名字/副标题拆分：优先独立 subtitle 字段，其次按中英文逗号拆。 */
export function splitNameSubtitle(
  name: string | null | undefined,
  subtitle: string | null | undefined
): { name: string; subtitle: string | null } {
  const n = (name ?? '').trim()
  const s = (subtitle ?? '').trim()
  if (s) return { name: n, subtitle: s }
  const m = n.match(/^([^,，]+)[,，]\s*(.+)$/)
  if (m) return { name: (m[1] ?? '').trim(), subtitle: (m[2] ?? '').trim() || null }
  return { name: n, subtitle: null }
}

/**
 * accessibilityText 里始终保留英文名：`Riftbound Unit: Ahri, Alluring. …`
 * 用于星号/SP 印刷绑定库内基础卡（库内只有 en/cn 文本）。
 */
export function parseEnglishIdentity(accessibilityText: string | null | undefined): {
  name: string | null
  subtitle: string | null
} {
  const text = (accessibilityText ?? '').trim()
  const m = text.match(/^Riftbound [A-Za-z ]+?: ([^.]*)\./)
  if (!m) return { name: null, subtitle: null }
  const raw = (m[1] ?? '').trim()
  if (!raw) return { name: null, subtitle: null }
  return splitNameSubtitle(raw, null)
}

/* ------------------------------------------------------------------ */
/* 稀有度                                                              */
/* ------------------------------------------------------------------ */

const RARITY_BASE: Record<string, string> = {
  common: '普通',
  uncommon: '不凡',
  rare: '稀有',
  epic: '史诗',
  showcase: '异画'
}

export interface GalleryRarity {
  rarity_name: string | null
  extend_rarity_name: string | null
}

/**
 * 官网稀有度 id → 库内中文稀有度约定。
 * showcase + 编号超过系列上限 → 超编；showcase + `*` → 签名超编。
 */
export function mapGalleryRarity(
  rarityId: string,
  extend: string,
  collectorNumber: number | null,
  collectorNumberMax: number | null
): GalleryRarity {
  const base = RARITY_BASE[rarityId] ?? null
  if (rarityId !== 'showcase') return { rarity_name: base, extend_rarity_name: base ? '平卡' : null }
  const signed = /\*$/.test(extend)
  const over = collectorNumber !== null && collectorNumberMax !== null && collectorNumber > collectorNumberMax
  return { rarity_name: '异画', extend_rarity_name: signed ? '签名超编' : over ? '超编' : '异画' }
}

/* ------------------------------------------------------------------ */
/* 类别                                                                */
/* ------------------------------------------------------------------ */

const TYPE_CATEGORY: Record<string, string> = {
  unit: '单位',
  spell: '法术',
  gear: '装备',
  battlefield: '战场',
  legend: '传奇',
  rune: '符文'
}

const TOKEN_CATEGORY: Record<string, string> = {
  unit: '指示物单位',
  gear: '指示物装备',
  battlefield: '指示物战场'
}

/** 官网 cardType/superType → 库内中文类别（仅新增基础卡时使用）。 */
export function mapGalleryCategories(card: GalleryCard, extend: string): string[] {
  const isToken = /-T\d+$/i.test(extend)
  const champion = card.superType?.some((s) => s.id === 'champion' || s.label === 'Champion') ?? false
  const out = new Set<string>()
  for (const type of card.cardType) {
    if (isToken) {
      const token = TOKEN_CATEGORY[type.id]
      if (token) out.add(token)
      continue
    }
    if (type.id === 'unit' && champion) out.add('英雄单位')
    else if (type.id === 'spell' && champion) out.add('专属法术')
    else if (type.id === 'gear' && champion) out.add('专属装备')
    else {
      const mapped = TYPE_CATEGORY[type.id]
      if (mapped) out.add(mapped)
    }
  }
  if (isToken && !out.size) out.add('指示物单位')
  return [...out]
}

/* ------------------------------------------------------------------ */
/* 效果文本                                                            */
/* ------------------------------------------------------------------ */

/** `:rb_*:` → 库内 `{{标记}}`；用中文图标键以便复用 card_icons。 */
export const GALLERY_MARKER_MAP: Record<string, string> = {
  'rb_might': 'S',
  'rb_exhaust': '横置',
  'rb_rune_fury': '红色',
  'rb_rune_mind': '蓝色',
  'rb_rune_calm': '绿色',
  'rb_rune_order': '黄色',
  'rb_rune_chaos': '紫色',
  'rb_rune_body': '橙色',
  'rb_rune_rainbow': 'A'
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
}

export interface EffectConversion {
  text: string | null
  /** 未识别的 `:rb_*:` / `{{…}}` 标记，供审核提示 */
  unmapped: string[]
}

/**
 * HTML（含 :rb_ 标记与 [关键词]）→ 库内 `纯文本 + {{标记}}`。
 * 中文/韩文/繁中效果都走这一条，保证与 effect_cn 的现有约定一致。
 */
export function convertGalleryEffect(html: string | null | undefined): EffectConversion {
  const raw = (html ?? '').trim()
  if (!raw) return { text: null, unmapped: [] }
  const unmapped = new Set<string>()
  let s = raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
  s = decodeEntities(s)
  s = s.replace(/:rb_([a-z0-9_]+):/gi, (_m, key: string) => {
    const lower = key.toLowerCase()
    const token = GALLERY_MARKER_MAP[`rb_${lower}`]
    if (token) return `{{${token}}}`
    const energy = lower.match(/^energy_(\d+)$/)
    if (energy) return `{{${energy[1]}}}`
    unmapped.add(`:rb_${key}:`)
    return `:rb_${key}:`
  })
  s = s.replace(/\[([^\[\]]{1,24})\]/g, (_m, inner: string) => `{{${inner.trim()}}}`)
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return { text: s || null, unmapped: [...unmapped] }
}

export function isHtmlEffect(text: string | null | undefined): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(text ?? '')
}

/* ------------------------------------------------------------------ */
/* 本地化判定                                                          */
/* ------------------------------------------------------------------ */

export function hasTargetScript(text: string | null | undefined, target: GalleryTarget): boolean {
  const s = text ?? ''
  if (target === 'kr') return /[\uac00-\ud7af\u1100-\u11ff]/.test(s)
  if (target === 'tw' || target === 'cn') return /[\u4e00-\u9fff]/.test(s)
  return /[A-Za-z]/.test(s)
}

export interface GalleryCardText {
  name: string | null
  subtitle: string | null
  effect: string | null
  nameEn: string | null
  subtitleEn: string | null
  /** 文本确实是目标语言（false = 官网该卡未翻译，只有英文回退） */
  localized: boolean
  unmapped: string[]
}

/**
 * 按目标语言整理一张卡的文本。
 *  - en：name/subtitle 直接用字段，effect 保持 HTML；
 *  - cn/kr/tw：只有含目标文字才认为已本地化，否则文本置空（不覆盖已有译文）；
 *    effect 转成 `纯文本 + {{标记}}`。
 */
export function cardTextForTarget(card: GalleryCard, target: GalleryTarget): GalleryCardText {
  const identity = parseEnglishIdentity(card.image.accessibilityText)
  const split = splitNameSubtitle(card.name, card.subtitle)
  if (target === 'en') {
    return {
      name: card.name || null,
      subtitle: split.subtitle,
      effect: card.textHtml ?? null,
      nameEn: card.name || null,
      subtitleEn: split.subtitle,
      localized: true,
      unmapped: []
    }
  }
  const localized = hasTargetScript(card.name, target) || hasTargetScript(card.textHtml, target)
  if (!localized) {
    return {
      name: null,
      subtitle: null,
      effect: null,
      nameEn: identity.name,
      subtitleEn: identity.subtitle,
      localized: false,
      unmapped: []
    }
  }
  const converted = convertGalleryEffect(card.textHtml)
  return {
    name: split.name || null,
    subtitle: split.subtitle,
    effect: converted.text,
    nameEn: identity.name,
    subtitleEn: identity.subtitle,
    localized: true,
    unmapped: converted.unmapped
  }
}

/** 语言选择器的目标语言 → card_prints.language 代码。 */
export function printLanguageOf(locale: GalleryLocale): 'EN' | 'SC' | 'KR' | 'TC' {
  const option = galleryLocaleOption(locale)
  return { en: 'EN', cn: 'SC', kr: 'KR', tw: 'TC' }[option.target] as 'EN' | 'SC' | 'KR' | 'TC'
}
