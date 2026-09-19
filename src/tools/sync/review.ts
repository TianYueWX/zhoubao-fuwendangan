/** Shared review rules for single writes, batch writes and exports. No network access. */
import type { ExistingSnapshot } from '../admin/sync'
import type { SyncDataset } from './run'
import { CARDS_BASE_COLUMNS, CARD_PRINT_COLUMNS, toCsv, sqlStr } from './exporters'
import { normalizeCardNo } from './normalize'
// Type-only: reviewIndex imports values from this module, so importing it back
// at runtime would create a cycle. Erased at compile time.
import type { ReviewIndex } from './reviewIndex'

export type ReviewTable = 'cards_base' | 'card_prints' | 'card_icons' | 'series'
export type Values = Record<string, unknown>
export interface ReviewRow {
  key: string
  table: ReviewTable
  label: string
  source: Values
  draft: Values
  selected: string[]
  included: boolean
  parentKey?: string
  chosenBaseId: string
  errata: boolean
  error: string
  variants: Values[]
  variantChosen: boolean
  detailComplete: boolean
}
export interface ReviewState {
  kind: 'new' | 'update' | 'same' | 'blocked'
  before?: Values
  fields: string[]
  changed: string[]
  reason: string
  parentId?: string
}
export interface ReviewOperation {
  table: ReviewTable
  kind: 'insert' | 'update'
  id?: string
  payload: Values
  /** Fields read during review; checked again before an update. */
  expected: Values
}
export const INSERT_FIELDS: Record<ReviewTable, readonly string[]> = {
  cards_base: CARDS_BASE_COLUMNS,
  card_prints: ['card_id', ...CARD_PRINT_COLUMNS],
  card_icons: ['name_zh', 'url', 'storage_type', 'isWhite'],
  series: ['code', 'name_cn', 'name_en', 'release_order', 'is_standard', 'is_active']
}
export const UPDATE_FIELDS: Record<ReviewTable, readonly string[]> = {
  cards_base: ['effect_cn'],
  card_prints: ['card_id', ...CARD_PRINT_COLUMNS.filter((f) => f !== 'card_no_extend' && f !== 'language')],
  card_icons: ['url', 'storage_type', 'isWhite'],
  series: []
}
export const ARRAY_FIELDS = ['card_color_list', 'region', 'tag', 'card_category']
export const NUMBER_FIELDS = ['energy', 'return_energy', 'power', 'release_order']
export const BOOL_FIELDS = ['is_promo', 'isWhite', 'is_standard', 'is_active']
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
export const identity = (name: unknown, subtitle: unknown): string =>
  JSON.stringify([String(name ?? '').trim(), String(subtitle ?? '').trim()])
/** Identity of a draft print row. Deliberately **not** normalized: reviewState compares
 *  draft identities verbatim, while existing prints match on the normalized number. */
export const printIdentity = (number: unknown, language: unknown): string => JSON.stringify([number, language])
export const textValue = (v: unknown): string => String(v ?? '').replace(/\r\n?/g, '\n').trim()
export function equivalent(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b)
  return textValue(a) === textValue(b)
}
const asValues = (r: object): Values => r as Values
function pick(row: Values, fields: readonly string[]): Values {
  return Object.fromEntries(fields.filter((f) => row[f] !== undefined).map((f) => [f, clone(row[f])]))
}
function makeRow(table: ReviewTable, key: string, source: Values, label: string): ReviewRow {
  return { table, key, source: clone(source), draft: pick(source, INSERT_FIELDS[table]), label,
    selected: [], included: true, chosenBaseId: '', errata: false, error: '', variants: [],
    variantChosen: true, detailComplete: true }
}

export function createReview(ds: SyncDataset): ReviewRow[] {
  const rows: ReviewRow[] = []
  const groups = new Map<string, Values[]>()
  const cardByNo = new Map<unknown, Values>()
  for (const card of ds.cards) {
    const key = identity(card.card_name_cn, card.sub_title_cn)
    const group = groups.get(key) ?? []
    group.push(asValues(card)); groups.set(key, group)
    // First card wins, matching the `find` this replaces (Map compares keys with
    // SameValueZero, i.e. === for strings). Indexed so that 1500 prints against
    // 900 cards stays linear instead of 1.35M comparisons.
    if (!cardByNo.has(card.card_no)) cardByNo.set(card.card_no, asValues(card))
  }
  for (const [key, group] of groups) {
    const errata = group.filter((c) => textValue(c.sync_errata))
    const variants = [...new Map(errata.map((c) => [textValue(c.effect_cn), c])).values()]
    const source = variants[0] ?? group.find((c) => c.sync_detail_complete) ?? group[0]!
    const r = makeRow('cards_base', `base:${key}`, source, group.map((c) => c.card_no).join(' / '))
    r.errata = errata.length > 0
    r.detailComplete = source.sync_detail_complete === true
    r.variants = variants
    r.variantChosen = variants.length <= 1
    rows.push(r)
  }
  for (const print of ds.prints) {
    const fallback = cardByNo.get(print.base_card_no)
    const key = identity(print.sync_card_name !== undefined ? print.sync_card_name : fallback?.card_name_cn,
      print.sync_sub_title !== undefined ? print.sync_sub_title : fallback?.sub_title_cn)
    const r = makeRow('card_prints', `print:${print.card_no_extend}:${print.language}`, asValues(print),
      `${print.card_no_extend} · ${print.language} · ${print.sync_card_name ?? fallback?.card_name_cn ?? ''} ${print.sync_sub_title ?? fallback?.sub_title_cn ?? ''}`)
    r.parentKey = `base:${key}`
    r.error = print.sync_error ?? ''
    rows.push(r)
  }
  for (const icon of ds.icons) rows.push(makeRow('card_icons', `icon:${icon.name_zh}`, asValues(icon), icon.name_zh))
  for (const series of ds.seriesPresets) rows.push(makeRow('series', `series:${series.code}`,
    { ...series, is_standard: true, is_active: true }, series.code))
  return rows
}

export function baseCandidates(row: ReviewRow, ex: ExistingSnapshot, index?: ReviewIndex): Values[] {
  const key = identity(row.draft.card_name_cn, row.draft.sub_title_cn)
  if (index) return index.bases.get(key) ?? []
  return ex.cards.filter((c) => identity(c.card_name_cn, c.sub_title_cn) === key).map(asValues)
}
export function resolvedBase(row: ReviewRow, ex: ExistingSnapshot, index?: ReviewIndex): Values | undefined {
  const candidates = baseCandidates(row, ex, index)
  return candidates.length === 1 ? candidates[0] : candidates.find((c) => c.id === row.chosenBaseId)
}

/** Pass `index` (see reviewIndex.ts) to answer every lookup in O(1). Without it the
 *  same rules run over the full snapshot, which is O(rows × snapshot) per render. */
export function reviewState(row: ReviewRow, rows: ReviewRow[], ex: ExistingSnapshot, index?: ReviewIndex): ReviewState {
  let before: Values | undefined
  let reason = row.error
  let parentId: string | undefined
  if (row.table === 'cards_base') {
    const candidates = baseCandidates(row, ex, index)
    before = resolvedBase(row, ex, index)
    if (!textValue(row.draft.card_name_cn)) reason = '卡名不能为空'
    else if (candidates.length > 1 && !before) reason = '同名同副标题有多个基础卡，请选择关联记录'
    else if (!row.variantChosen) reason = '官方存在不同勘误文本，请选择要采用的来源'
    else if ((!before || row.errata) && !row.detailComplete) reason = '详情缺失，无法确认装配效果；请重新拉取详情'
    else if (!before && (index
      ? index.baseNumbers.has(row.draft.card_no)
      : ex.cards.some((c) => c.card_no === row.draft.card_no))) reason = '基础编号已被另一张卡占用，请修改新增编号'
    else if (!before && (index
      ? (index.baseCounts.get(identity(row.draft.card_name_cn, row.draft.sub_title_cn)) ?? 0) > 1
      : rows.some((r) => r !== row && r.table === 'cards_base' &&
        identity(r.draft.card_name_cn, r.draft.sub_title_cn) === identity(row.draft.card_name_cn, row.draft.sub_title_cn)))) reason = '另一个草稿使用了相同名字和副标题，请先处理该草稿'
  } else if (row.table === 'card_prints') {
    const normalized = normalizeCardNo(String(row.draft.card_no_extend ?? ''))
    const matches = index
      ? index.prints.get(printIdentity(normalized.extend, row.draft.language)) ?? []
      : ex.prints.filter((p) => normalizeCardNo(p.card_no_extend).extend === normalized.extend && p.language === row.draft.language)
    before = matches[0] ? asValues(matches[0]) : undefined
    const parent = row.parentKey
      ? (index ? index.rows.get(row.parentKey) : rows.find((r) => r.key === row.parentKey))
      : undefined
    const base = parent ? resolvedBase(parent, ex, index) : undefined
    parentId = base?.id as string | undefined
    if (normalized.error || normalized.extend !== row.draft.card_no_extend) reason = '请填写不含语言的有效印刷编号'
    else if (!['SC', 'TC', 'EN', 'JP', 'JA', 'KR', 'KO'].includes(String(row.draft.language))) reason = '无法解析语言'
    else if (matches.length > 1) reason = '库内有多个相同编号和语言的印刷版本，请先处理冲突'
    else if (!parentId) reason = parent && baseCandidates(parent, ex, index).length > 1
      ? '请先选择关联的基础卡' : '等待你先创建基础卡，再单独提交印刷版本'
    else if (index
      ? (index.printCounts.get(printIdentity(row.draft.card_no_extend, row.draft.language)) ?? 0) > 1
      : rows.some((r) => r !== row && r.table === 'card_prints' &&
        r.draft.card_no_extend === row.draft.card_no_extend && r.draft.language === row.draft.language)) reason = '另一个草稿使用了相同印刷编号和语言'
  } else if (row.table === 'card_icons') {
    const found = index ? index.icons.get(row.draft.name_zh) : ex.icons.find((i) => i.name_zh === row.draft.name_zh)
    before = found ? asValues(found) : undefined
  } else {
    before = (index ? index.series.has(String(row.draft.code)) : ex.seriesCodes.includes(String(row.draft.code)))
      ? { code: row.draft.code } : undefined
  }
  const fields = [...(before ? UPDATE_FIELDS[row.table] : INSERT_FIELDS[row.table])]
  const changed = before ? fields.filter((f) => equivalent(before?.[f], f === 'card_id' ? parentId : row.draft[f]) === false) : []
  if (row.table === 'cards_base' && before && !row.errata) changed.length = 0
  if (before && row.table !== 'series' && !before.id) reason = '库内记录缺少 ID，请重新读取'
  return { kind: reason ? 'blocked' : !before ? 'new' : changed.length ? 'update' : 'same',
    before, fields, changed, reason, parentId }
}

export function buildOperation(row: ReviewRow, rows: ReviewRow[], ex: ExistingSnapshot, index?: ReviewIndex): ReviewOperation | null {
  const state = reviewState(row, rows, ex, index)
  if (state.kind === 'blocked') throw new Error(state.reason)
  if (state.kind === 'same') return null
  const fields = state.kind === 'new' ? state.fields : state.changed.filter((f) => row.selected.includes(f))
  if (!fields.length) return null
  const payload = pick({ ...row.draft, ...(state.parentId ? { card_id: state.parentId } : {}) }, fields)
  if (state.kind === 'new') {
    const required = row.table === 'cards_base' ? ['card_no', 'card_name_cn'] : row.table === 'card_prints'
      ? ['card_no_extend', 'language', 'card_id'] : row.table === 'series' ? ['code', 'name_cn'] : ['name_zh', 'url']
    for (const field of required) if (!textValue(payload[field])) throw new Error(`${field} 不能为空`)
  }
  for (const f of NUMBER_FIELDS) if (payload[f] !== undefined && payload[f] !== null &&
    (typeof payload[f] !== 'number' || !Number.isFinite(payload[f]) || !Number.isInteger(payload[f]))) throw new Error(`${f} 必须为整数或空值`)
  for (const f of ARRAY_FIELDS) if (payload[f] !== undefined && (!Array.isArray(payload[f]) ||
    !(payload[f] as unknown[]).every((v) => typeof v === 'string'))) throw new Error(`${f} 必须为字符串数组`)
  if (row.table === 'cards_base' && state.kind === 'new' && normalizeCardNo(String(payload.card_no)).error) throw new Error('基础编号格式错误')
  return { table: row.table, kind: state.kind === 'new' ? 'insert' : 'update',
    id: state.before?.id as string | undefined, payload,
    expected: state.before ? pick(state.before, fields) : {} }
}

/** Whitelist is applied again at the write/export boundary. */
export function validateOperation(op: ReviewOperation): void {
  const allowed = op.kind === 'insert' ? INSERT_FIELDS[op.table] : UPDATE_FIELDS[op.table]
  if (!allowed || !Object.keys(op.payload).length || Object.keys(op.payload).some((k) => !allowed.includes(k))) throw new Error('提交包含未授权的字段')
  if (op.kind === 'update' && !op.id) throw new Error('更新必须指定记录 ID')
  if (op.kind === 'update' && (Object.keys(op.expected).some((k) => !allowed.includes(k)) ||
    Object.keys(op.payload).some((k) => !(k in op.expected)))) throw new Error('更新缺少审核时的字段值')
}
function sqlValue(value: unknown): string {
  if (value == null) return 'NULL'
  if (Array.isArray(value)) return value.length ? `ARRAY[${value.map((v) => sqlStr(String(v))).join(', ')}]::text[]` : "'{}'::text[]"
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('无效数字'); return String(value) }
  return sqlStr(String(value))
}
export function reviewSql(operations: ReviewOperation[], options: { publish?: boolean } = {}): string {
  const statements = operations.map((op) => {
    validateOperation(op)
    const entries = Object.entries(op.payload)
    if (op.kind === 'insert') {
      const insert = `INSERT INTO public.${op.table} (${entries.map(([k]) => `"${k}"`).join(', ')}) VALUES (${entries.map(([, v]) => sqlValue(v)).join(', ')});`
      if (op.table !== 'cards_base') return insert
      const name = sqlStr(String(op.payload.card_name_cn ?? '').trim())
      const subtitle = sqlStr(String(op.payload.sub_title_cn ?? '').trim())
      const block = `BEGIN\nIF EXISTS (SELECT 1 FROM public.cards_base WHERE btrim(coalesce(card_name_cn, '')) = ${name} AND btrim(coalesce(sub_title_cn, '')) = ${subtitle}) THEN RAISE EXCEPTION 'Base card already exists; review its association'; END IF;\n${insert}\nEND;`
      return `DO ${sqlStr(block)};`
    }
    const guard = Object.entries(op.expected).map(([k, v]) => ` AND "${k}" IS NOT DISTINCT FROM ${sqlValue(v)}`).join('')
    // Raise on stale/denied writes instead of silently exporting a successful-looking no-op.
    const block = `BEGIN\nUPDATE public.${op.table} SET ${entries.map(([k, v]) => `"${k}" = ${sqlValue(v)}`).join(', ')}, "updated_at" = now() WHERE "id" = ${sqlStr(op.id)}${guard};\nIF NOT FOUND THEN RAISE EXCEPTION 'Record changed or unavailable'; END IF;\nEND;`
    return `DO ${sqlStr(block)};`
  })
  if (operations.length && options.publish !== false) {
    const names = [...new Set(operations.map((op) => ({ cards_base: 'cards', card_prints: 'prints', card_icons: 'icons', series: 'series' })[op.table]))]
    statements.push(`UPDATE public.version SET updated_at = now() WHERE name IN (${names.map(sqlStr).join(', ')});`)
  }
  return '-- 仅包含审核选中的记录与字段；基础卡和印刷版本分别执行。\nBEGIN;\n' + statements.join('\n\n') + '\nCOMMIT;\n'
}
/** Updates use one field per CSV row: omitted attributes cannot be mistaken for NULL. */
export function reviewCsv(operations: ReviewOperation[], kind: 'insert' | 'update'): string {
  const ops = operations.filter((o) => o.kind === kind)
  ops.forEach(validateOperation)
  if (kind === 'update') return toCsv(['table', 'id', 'attribute', 'value_json'], ops.flatMap((op) =>
    Object.entries(op.payload).map(([field, value]) => ({ table: op.table, id: op.id, attribute: field, value_json: JSON.stringify(value) }))))
  const columns = [...new Set(ops.flatMap((op) => Object.keys(op.payload)))]
  return toCsv(columns, ops.map((op) => op.payload), ARRAY_FIELDS)
}
