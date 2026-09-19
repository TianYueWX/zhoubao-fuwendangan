/**
 * 导出：把归一化后的行生成
 *   - 可直接在 Supabase SQL Editor 执行的幂等 upsert 脚本
 *   - 可导入 Table Editor 的 CSV
 * 以及浏览器下载辅助。
 */
import type {
  CardIconRow,
  CardPrintExportRow,
  CardsBaseRow
} from './normalize'

/* ------------------------------------------------------------------ */
/* SQL 字面量                                                          */
/* ------------------------------------------------------------------ */

export function sqlStr(s: string | null | undefined): string {
  if (s === null || s === undefined) return 'NULL'
  return "'" + String(s).replace(/'/g, "''") + "'"
}

function sqlInt(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return 'NULL'
  return String(Math.trunc(n))
}

function sqlBool(b: boolean | null | undefined): string {
  return b ? 'true' : 'false'
}

function sqlTextArray(arr: string[] | null | undefined): string {
  if (!arr || arr.length === 0) return "'{}'::text[]"
  return 'array[' + arr.map((x) => sqlStr(x)).join(', ') + ']::text[]'
}

function quoteIdent(name: string): string {
  return '"' + name + '"'
}

/* ------------------------------------------------------------------ */
/* cards_base                                                          */
/* ------------------------------------------------------------------ */

/**
 * 同步**始终**写入的卡牌列 —— 接口是这些字段的唯一来源。
 *
 * 注意这里**不含 is_banned**。原因见 CARDS_BASE_OPTIONAL_COLUMNS。
 */
export const CARDS_BASE_COLUMNS = [
  'card_no', 'card_name_cn', 'sub_title_cn',
  'card_color_list', 'region', 'tag', 'champion_tag',
  'effect_cn', 'flavor_text_cn',
  'energy', 'return_energy', 'power',
  'rarity_name', 'series_name', 'card_category'
] as const

/**
 * ⚠ 同步模块里**唯一**的破例,改动前请读完这段。
 *
 * is_banned 属于「人工维护列」:接口确实带官方禁限标记,但后台手工调整过的
 * 禁限表才是权威(赛事环境会临时禁卡,官方接口未必同步)。若默认写入,
 * 一次同步就会把编务刚设好的禁限覆盖掉,而且**没有任何提示** ——
 * 这正是搬迁前存在的缺陷。
 *
 * 因此约定:默认不写;仅当编务在同步页显式勾选「用官方禁限表覆盖」时才纳入。
 */
export const CARDS_BASE_OPTIONAL_COLUMNS = ['is_banned'] as const

/** 按是否包含禁限列,给出实际写入的列顺序 */
export function cardsBaseColumns(includeBanList = false): string[] {
  return includeBanList
    ? [...CARDS_BASE_COLUMNS, ...CARDS_BASE_OPTIONAL_COLUMNS]
    : [...CARDS_BASE_COLUMNS]
}

export const CARDS_BASE_ARRAY_FIELDS = ['card_color_list', 'region', 'tag', 'card_category']

/**
 * 列 → SQL 字面量。
 * 用映射而不是数组:列顺序可由 cardsBaseColumns() 决定,
 * 增删列时不会出现「值与列错位」这种致命且难查的错误。
 */
function cardsBaseValueMap(r: CardsBaseRow): Record<string, string> {
  return {
    card_no: sqlStr(r.card_no),
    card_name_cn: sqlStr(r.card_name_cn),
    sub_title_cn: sqlStr(r.sub_title_cn),
    card_color_list: sqlTextArray(r.card_color_list),
    region: sqlTextArray(r.region),
    tag: sqlTextArray(r.tag),
    champion_tag: sqlStr(r.champion_tag),
    effect_cn: sqlStr(r.effect_cn),
    flavor_text_cn: sqlStr(r.flavor_text_cn),
    energy: sqlInt(r.energy),
    return_energy: sqlInt(r.return_energy),
    power: sqlInt(r.power),
    rarity_name: sqlStr(r.rarity_name),
    series_name: sqlStr(r.series_name),
    card_category: sqlTextArray(r.card_category),
    is_banned: sqlBool(r.is_banned)
  }
}

function cardsBaseValues(r: CardsBaseRow, columns: string[]): string {
  const m = cardsBaseValueMap(r)
  return '(' + columns.map((c) => m[c] ?? 'NULL').join(', ') + ')'
}

export function buildCardsBaseSql(
  rows: CardsBaseRow[],
  options: { includeBanList?: boolean } = {}
): string {
  if (!rows.length) return ''
  const columns = cardsBaseColumns(options.includeBanList ?? false)
  const cols = columns.map(quoteIdent).join(', ')
  const update = columns
    .filter((c) => c !== 'card_no')
    .map((c) => `  ${quoteIdent(c)} = excluded.${quoteIdent(c)}`)
    .concat('  "updated_at" = now()')
    .join(',\n')
  const values = rows.map((r) => cardsBaseValues(r, columns)).join(',\n  ')
  return (
    `insert into public.cards_base (${cols}) values\n  ${values}\n` +
    `on conflict ("card_no") do update set\n${update};\n`
  )
}

/* ------------------------------------------------------------------ */
/* card_prints（card_id 用父卡号子查询解析，兼容新卡）                  */
/* ------------------------------------------------------------------ */

export const CARD_PRINT_COLUMNS = [
  'card_no_extend', 'language', 'rarity_name', 'extend_rarity_name',
  'img_cdn', 'artist', 'series', 'flavor_text_cn', 'is_promo'
] as const

function printValues(r: CardPrintExportRow): string {
  return '(' + [
    `(select id from public.cards_base where card_no = ${sqlStr(r.base_card_no)})`,
    sqlStr(r.card_no_extend),
    sqlStr(r.language),
    sqlStr(r.rarity_name),
    sqlStr(r.extend_rarity_name),
    sqlStr(r.img_cdn),
    sqlStr(r.artist),
    sqlStr(r.series),
    sqlStr(r.flavor_text_cn),
    sqlBool(r.is_promo)
  ].join(', ') + ')'
}

export function buildCardPrintsSql(rows: CardPrintExportRow[]): string {
  if (!rows.length) return ''
  const cols = ['card_id', ...CARD_PRINT_COLUMNS].map(quoteIdent).join(', ')
  const update = ['card_id', ...CARD_PRINT_COLUMNS]
    .map((c) => `  ${quoteIdent(c)} = excluded.${quoteIdent(c)}`)
    .concat('  "updated_at" = now()')
    .join(',\n')
  const values = rows.map(printValues).join(',\n  ')
  return (
    `insert into public.card_prints (${cols}) values\n  ${values}\n` +
    `on conflict ("card_no_extend", "language") do update set\n${update};\n`
  )
}

/* ------------------------------------------------------------------ */
/* card_icons                                                          */
/* ------------------------------------------------------------------ */

export const CARD_ICON_COLUMNS = ['name_zh', 'name_en', 'url', 'storage_type', 'isWhite'] as const

function iconValues(r: CardIconRow): string {
  return '(' + [
    sqlStr(r.name_zh),
    sqlStr(r.name_en),
    sqlStr(r.url),
    sqlStr(r.storage_type),
    sqlBool(r.isWhite)
  ].join(', ') + ')'
}

export function buildCardIconsSql(rows: CardIconRow[]): string {
  if (!rows.length) return ''
  const cols = CARD_ICON_COLUMNS.map(quoteIdent).join(', ')
  const update = ['url', 'storage_type', 'isWhite']
    .map((c) => `  ${quoteIdent(c)} = excluded.${quoteIdent(c)}`)
    .concat('  "updated_at" = now()')
    .join(',\n')
  const values = rows.map(iconValues).join(',\n  ')
  return (
    `insert into public.card_icons (${cols}) values\n  ${values}\n` +
    `on conflict ("name_zh") do update set\n${update};\n`
  )
}

/* ------------------------------------------------------------------ */
/* series 预置（缺失系列，用户后续手改名称）                            */
/* ------------------------------------------------------------------ */

export interface SeriesPreset {
  code: string
  name_cn: string
  name_en: string
  release_order: number
}

export function buildSeriesPresetSql(rows: SeriesPreset[]): string {
  if (!rows.length) return ''
  const cols = ['code', 'name_cn', 'name_en', 'release_order', 'is_standard', 'is_active']
    .map(quoteIdent).join(', ')
  const values = rows
    .map((r) => `  (${sqlStr(r.code)}, ${sqlStr(r.name_cn)}, ${sqlStr(r.name_en)}, ${sqlInt(r.release_order)}, true, true)`)
    .join(',\n')
  return `insert into public.series (${cols}) values\n${values}\non conflict ("code") do nothing;\n`
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

function pgArray(arr: string[] | null | undefined): string {
  if (!arr || !arr.length) return '{}'
  const parts = arr.map((el) => {
    const needsQuote = /[",\\\s{}]/.test(el) || el === ''
    return needsQuote ? '"' + el.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"' : el
  })
  return '{' + parts.join(',') + '}'
}

function csvCell(v: unknown, isArray = false): string {
  if (v === null || v === undefined) return ''
  let s: string
  if (isArray) s = pgArray(v as string[])
  else if (typeof v === 'boolean') s = v ? 'true' : 'false'
  else s = String(v)
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"'
  return s
}

export function toCsv(
  columns: string[],
  rows: Array<Record<string, unknown>>,
  arrayFields: string[] = []
): string {
  const arr = new Set(arrayFields)
  const lines = [columns.join(',')]
  for (const r of rows) {
    lines.push(columns.map((c) => csvCell(r[c], arr.has(c))).join(','))
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n'
}

export function cardsBaseCsv(
  rows: CardsBaseRow[],
  options: { includeBanList?: boolean } = {}
): string {
  return toCsv(
    cardsBaseColumns(options.includeBanList ?? false),
    rows as unknown as Array<Record<string, unknown>>,
    CARDS_BASE_ARRAY_FIELDS
  )
}

export function cardPrintsCsv(rows: CardPrintExportRow[]): string {
  return toCsv(['card_no', ...CARD_PRINT_COLUMNS], rows as unknown as Array<Record<string, unknown>>)
}

export function cardIconsCsv(rows: CardIconRow[]): string {
  return toCsv([...CARD_ICON_COLUMNS], rows as unknown as Array<Record<string, unknown>>)
}

/* ------------------------------------------------------------------ */
/* 下载                                                                */
/* ------------------------------------------------------------------ */

export function downloadText(filename: string, content: string, mime = 'text/plain'): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function buildSyncSql(parts: {
  cards?: CardsBaseRow[]
  prints?: CardPrintExportRow[]
  icons?: CardIconRow[]
  series?: SeriesPreset[]
  /** 是否把官方禁限标记一并写入(默认否,见 CARDS_BASE_OPTIONAL_COLUMNS) */
  includeBanList?: boolean
}): string {
  const ban = parts.includeBanList ?? false
  const header =
    '-- 符文档案 · 数据同步脚本（由编辑部生成）\n' +
    `-- 生成时间：${new Date().toISOString()}\n` +
    '-- 依赖：先执行 supabase/sync-constraints.sql 建立唯一约束\n' +
    '-- 说明：仅写入接口拥有的列，人工维护列（keyword/advanced_tag/deck_limit/*_en 等）不受影响\n' +
    (ban
      ? '-- ⚠ 本次包含 is_banned：会用官方禁限标记覆盖库里的人工禁限表\n\n'
      : '-- 本次不含 is_banned：库里的人工禁限表保持不变\n\n') +
    'begin;\n\n'
  const body =
    (parts.series?.length ? '-- 系列预置\n' + buildSeriesPresetSql(parts.series) + '\n' : '') +
    (parts.cards?.length
      ? '-- 卡牌主数据\n' + buildCardsBaseSql(parts.cards, { includeBanList: ban }) + '\n'
      : '') +
    (parts.prints?.length ? '-- 印刷版本\n' + buildCardPrintsSql(parts.prints) + '\n' : '') +
    (parts.icons?.length ? '-- 关键词图标\n' + buildCardIconsSql(parts.icons) + '\n' : '')
  const footer =
    "\nupdate public.version set updated_at = now() where name in ('cards','prints','icons');\n\ncommit;\n"
  return header + body + footer
}
