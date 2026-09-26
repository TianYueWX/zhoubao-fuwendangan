/**
 * 官网卡表同步的逐条审核规则。
 *
 * 与小程序审核（review.ts）的差异：
 *  - 基础卡按 card_no 唯一匹配（官网与库内编号体系一致），不做中文名身份匹配；
 *  - 更新只允许目标语言列，避免一次英文同步把中文文本清空；
 *  - 星号/SP/超编号印刷（SFD-227* → OGN-119）用英文名＋副标题回找基础卡；
 *  - 只读语区（fr/es/de/it/ja）照常比对，但提交/导出由界面禁用。
 */
import type { ExistingSnapshot } from '../admin/sync'
import { equivalent, printIdentity, textValue, type ReviewOperation, type ReviewState, type Values } from './review'
import type { ReviewIndex } from './reviewIndex'
import { normalizeCardNo } from './normalize'
import type { GalleryDataset } from './galleryRun'
import type { GalleryTarget } from './galleryApi'

export type GalleryTable = 'cards_base' | 'card_prints'

export interface GalleryReviewRow {
  key: string
  table: GalleryTable
  label: string
  target: GalleryTarget
  source: Values
  draft: Values
  selected: string[]
  included: boolean
  parentKey?: string
  baseCardNo?: string
  chosenBaseId: string
  /** 官网该卡未翻译（目标语言文本为空） */
  untranslated: boolean
  error: string
}

interface TargetFields {
  name: string
  subtitle: string
  effect: string
}

export const TARGET_FIELDS: Record<GalleryTarget, TargetFields> = {
  en: { name: 'card_name_en', subtitle: 'sub_title_en', effect: 'effect_en' },
  cn: { name: 'card_name_cn', subtitle: 'sub_title_cn', effect: 'effect_cn' },
  kr: { name: 'card_name_kr', subtitle: 'sub_title_kr', effect: 'effect_kr' },
  tw: { name: 'card_name_tw', subtitle: 'sub_title_tw', effect: 'effect_tw' }
}

/** 基础卡已有记录时允许更新的字段（仅目标语言列）。 */
export function galleryBaseUpdateFields(target: GalleryTarget): string[] {
  const f = TARGET_FIELDS[target]
  return [f.name, f.subtitle, f.effect]
}

export const GALLERY_PRINT_FIELDS = [
  'rarity_name',
  'extend_rarity_name',
  'img_cdn',
  'artist',
  'series',
  'is_promo'
] as const

const PRINT_LANGUAGES = ['SC', 'TC', 'EN', 'JP', 'JA', 'KR', 'KO'] as const

function hasValue(v: unknown): boolean {
  if (v === null || v === undefined) return false
  if (Array.isArray(v)) return v.length > 0
  return textValue(v) !== ''
}

function pick(row: Values, fields: readonly string[]): Values {
  return Object.fromEntries(fields.filter((f) => row[f] !== undefined).map((f) => [f, row[f]]))
}

/* ------------------------------------------------------------------ */
/* 草稿行                                                              */
/* ------------------------------------------------------------------ */

export function createGalleryReview(dataset: GalleryDataset): GalleryReviewRow[] {
  const rows: GalleryReviewRow[] = []
  const target = dataset.option.target

  for (const base of dataset.bases) {
    const f = TARGET_FIELDS[target]
    const draft: Values = {
      card_no: base.card_no,
      [f.name]: base.name,
      [f.subtitle]: base.subtitle,
      [f.effect]: base.effect,
      series_name: base.series_name,
      rarity_name: base.rarity_name,
      energy: base.energy,
      card_category: base.card_category
    }
    if (target !== 'en') {
      draft.card_name_en = base.card_name_en
      draft.sub_title_en = base.sub_title_en
    }
    const row: GalleryReviewRow = {
      key: `gbase:${base.card_no}:${target}`,
      table: 'cards_base',
      label: base.card_no,
      target,
      source: { ...draft },
      draft,
      selected: [],
      included: true,
      chosenBaseId: '',
      untranslated: !base.localized,
      error: base.sync_error ?? ''
    }
    rows.push(row)
  }

  for (const print of dataset.prints) {
    const draft: Values = {
      card_no_extend: print.card_no_extend,
      language: print.language,
      rarity_name: print.rarity_name,
      extend_rarity_name: print.extend_rarity_name,
      img_cdn: print.img_cdn,
      artist: print.artist,
      series: print.series,
      is_promo: print.is_promo
    }
    const row: GalleryReviewRow = {
      key: `gprint:${print.card_no_extend}:${print.language}`,
      table: 'card_prints',
      label: `${print.card_no_extend} · ${print.language} · ${print.name ?? print.name_en ?? ''}`.trim(),
      target,
      source: { ...draft, name_en: print.name_en, sub_title_en: print.subtitle_en },
      draft,
      selected: [],
      included: true,
      parentKey: `gbase:${print.base_card_no}:${target}`,
      baseCardNo: print.base_card_no,
      chosenBaseId: '',
      untranslated: false,
      error: print.sync_error ?? ''
    }
    rows.push(row)
  }

  return rows
}

/* ------------------------------------------------------------------ */
/* 基础卡匹配                                                          */
/* ------------------------------------------------------------------ */

/** 官网印刷绑定基础卡的候选：先按编号，再按英文名＋副标题（含仅名字回退）。 */
export function galleryBaseCandidates(
  row: GalleryReviewRow,
  ex: ExistingSnapshot,
  index: ReviewIndex
): Values[] {
  if (row.table === 'cards_base') return []
  const number = row.baseCardNo ?? ''
  const byNumber = index.basesByNumber.get(number)
  if (byNumber) return [byNumber]
  const name = String(row.source.name_en ?? '').trim()
  const subtitle = String(row.source.sub_title_en ?? '').trim()
  const byIdentity = index.basesByEnIdentity.get(JSON.stringify([name, subtitle])) ?? []
  if (byIdentity.length) return byIdentity
  // 库内副标题常为空：副标题匹配失败时退化为仅英文名匹配，歧义再手选。
  return index.basesByEnName.get(name) ?? []
}

function resolveGalleryParent(
  row: GalleryReviewRow,
  rows: GalleryReviewRow[],
  ex: ExistingSnapshot,
  index: ReviewIndex
): { id?: string; candidates: Values[]; reason?: string } {
  const candidates = galleryBaseCandidates(row, ex, index)
  if (candidates.length === 1) return { id: candidates[0]?.id as string, candidates }
  if (candidates.length > 1) {
    const chosen = candidates.find((c) => c.id === row.chosenBaseId)
    if (chosen) return { id: chosen.id as string, candidates }
    return { candidates, reason: '官网编号指向原作异画，且英文身份有多个候选，请选择关联基础卡' }
  }
  // 还没进库的新基础卡：先创建基础卡，再提交印刷版本
  const parent = (row.parentKey ? index.rows.get(row.parentKey) : undefined) as unknown as GalleryReviewRow | undefined
  if (parent) {
    const parentState = galleryState(parent, rows, ex, index)
    if (parentState.kind === 'new') return { candidates, reason: '等待你先创建基础卡，再单独提交印刷版本' }
    if (parentState.kind !== 'blocked' && parentState.before?.id) {
      return { id: parentState.before.id as string, candidates }
    }
  }
  return { candidates, reason: '库内找不到所属基础卡，请先创建或人工确认关联' }
}

/* ------------------------------------------------------------------ */
/* 状态与操作                                                          */
/* ------------------------------------------------------------------ */

export function galleryState(
  row: GalleryReviewRow,
  rows: GalleryReviewRow[],
  ex: ExistingSnapshot,
  index: ReviewIndex
): ReviewState {
  if (row.table === 'cards_base') {
    const cardNo = String(row.draft.card_no ?? '').trim()
    if (!/^[A-Z0-9]+-[A-Z0-9]*\d[A-Z0-9]*[a-z*]*$/.test(cardNo)) {
      return { kind: 'blocked', fields: [], changed: [], reason: '基础编号格式错误' }
    }
    const before = index.basesByNumber.get(cardNo)
    const f = TARGET_FIELDS[row.target]
    const updateFields = galleryBaseUpdateFields(row.target)
    const insertFields = [
      'card_no',
      f.name,
      f.subtitle,
      f.effect,
      ...(row.target === 'en' ? [] : ['card_name_en', 'sub_title_en']),
      'series_name',
      'rarity_name',
      'energy',
      'card_category'
    ]
    const reason = row.error && /无法解析/.test(row.error) ? row.error : ''
    if (before) {
      if (!before.id) return { kind: 'blocked', before, fields: updateFields, changed: [], reason: '库内记录缺少 ID，请重新读取' }
      const changed = updateFields.filter((field) => hasValue(row.draft[field]) && !equivalent(before[field], row.draft[field]))
      return { kind: reason ? 'blocked' : changed.length ? 'update' : 'same', before, fields: updateFields, changed, reason }
    }
    const fields = insertFields.filter((field) => field === 'card_no' || hasValue(row.draft[field]))
    if (!hasValue(row.draft[f.name])) {
      return {
        kind: 'blocked',
        fields,
        changed: [],
        reason: row.untranslated ? '官网该卡未翻译（仅有英文回退），暂不能新增' : '官网缺少卡名，暂不能新增'
      }
    }
    return { kind: reason ? 'blocked' : 'new', fields, changed: [], reason }
  }

  // ── 印刷版本 ──
  const normalized = normalizeCardNo(String(row.draft.card_no_extend ?? ''))
  const language = String(row.draft.language ?? '').toUpperCase()
  const parent = resolveGalleryParent(row, rows, ex, index)
  const fields = [
    'card_no_extend',
    'language',
    'card_id',
    ...GALLERY_PRINT_FIELDS
  ]
  const updateFields = [...GALLERY_PRINT_FIELDS]
  const reason = normalized.error
    ? normalized.error
    : !PRINT_LANGUAGES.includes(language as (typeof PRINT_LANGUAGES)[number])
      ? '无法解析语言'
      : parent.reason ?? ''
  if (reason) {
    return {
      kind: 'blocked',
      fields: updateFields,
      changed: [],
      parentId: parent.id,
      reason
    }
  }
  const matches = index.prints.get(printIdentity(normalized.extend, String(row.draft.language))) ?? []
  const before = matches[0]
  if (matches.length > 1) {
    return { kind: 'blocked', before, fields: updateFields, changed: [], parentId: parent.id, reason: '库内有多个相同编号和语言的印刷版本，请先处理冲突' }
  }
  if (before) {
    if (!before.id) return { kind: 'blocked', before, fields: updateFields, changed: [], parentId: parent.id, reason: '库内记录缺少 ID，请重新读取' }
    const changed = updateFields.filter((field) => hasValue(row.draft[field]) && !equivalent(before[field], row.draft[field]))
    return { kind: changed.length ? 'update' : 'same', before, fields: updateFields, changed, parentId: parent.id, reason: '' }
  }
  const insertFields = fields.filter((field) =>
    field === 'card_no_extend' || field === 'language' || field === 'card_id' || hasValue(row.draft[field])
  )
  return { kind: 'new', fields: insertFields, changed: [], parentId: parent.id, reason: '' }
}

export function buildGalleryOperation(
  row: GalleryReviewRow,
  rows: GalleryReviewRow[],
  ex: ExistingSnapshot,
  index: ReviewIndex
): ReviewOperation | null {
  const state = galleryState(row, rows, ex, index)
  if (state.kind === 'blocked') throw new Error(state.reason)
  if (state.kind === 'same') return null
  const fields = state.kind === 'new' ? state.fields : state.changed.filter((f) => row.selected.includes(f))
  if (!fields.length) return null
  const payload = pick({ ...row.draft, ...(state.parentId ? { card_id: state.parentId } : {}) }, fields)
  if (state.kind === 'new') {
    const required =
      row.table === 'cards_base'
        ? ['card_no', TARGET_FIELDS[row.target].name]
        : ['card_no_extend', 'language', 'card_id']
    for (const field of required) if (!hasValue(payload[field])) throw new Error(`${field} 不能为空`)
  }
  return {
    table: row.table,
    kind: state.kind === 'new' ? 'insert' : 'update',
    id: state.before?.id as string | undefined,
    payload,
    expected: state.before ? pick(state.before, fields) : {}
  }
}

/** 面板的状态筛选与批量逻辑需要知道某行是否只读语区。 */
export function galleryWritable(dataset: GalleryDataset): boolean {
  return !dataset.readOnly
}
