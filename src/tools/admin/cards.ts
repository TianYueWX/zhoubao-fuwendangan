/* ================================================================
 * src/tools/admin/cards.ts
 *
 * 卡牌校勘的数据访问层(cards_base + card_prints)。
 *
 * 沿用后台确立的三条库约定:
 *   ① 库中没有触发器 → **每次 UPDATE 必须显式带 updated_at**;
 *   ② 保存只提交**变更字段**(不是整行覆盖),降低误清空风险;
 *   ③ 「发布」= 触碰 version.name='cards' 的时间戳(客户端缓存失效依据)。
 * ============================================================== */

import {
  restDelete,
  restInsert,
  restSelect,
  restSelectAll,
  restUpdate,
  touchVersion,
  type RestFilter
} from '../sources/rest';
import type { CardBase, CardPrint } from './types';
import type { LuaExportCard, LuaExportPrint } from './luaExport';

/** 列表页只取必要列,避免 971 行 × 全字段的传输 */
export const CARD_LIST_COLUMNS =
  'id,card_no,card_name_cn,card_name_en,energy,is_banned,deck_limit,series_name,rarity_name';

/** 整型列:原生 number 输入被清空时 v-model 会给 '' 或 NaN,直接写库会被 Postgres 拒绝 */
const NUMERIC_CARD_FIELDS = ['energy', 'return_energy', 'power'] as const;
const NUMERIC_PRINT_FIELDS = ['print_order'] as const;

/**
 * 可继承文本列:印刷版本留空表示继承基础卡。
 * 空串与 null 都归一成 null,避免「空串覆盖」这种库内不存在的语义。
 */
const INHERITABLE_PRINT_FIELDS = ['series', 'flavor_text_cn', 'flavor_text_en'] as const;

/** 把整型字段里的 '' / NaN / undefined 归一成 null */
function coerceNumericNulls(
  patch: Record<string, unknown>,
  fields: readonly string[]
): Record<string, unknown> {
  for (const f of fields) {
    if (!(f in patch)) continue;
    const v = patch[f];
    if (v === '' || v === undefined || (typeof v === 'number' && Number.isNaN(v))) {
      patch[f] = null;
    }
  }
  return patch;
}

/** 把可继承文本字段里的 '' / undefined / 纯空白归一成 null(=继承基础卡) */
function coerceInheritNulls(
  patch: Record<string, unknown>,
  fields: readonly string[]
): Record<string, unknown> {
  for (const f of fields) {
    if (!(f in patch)) continue;
    const v = patch[f];
    if (v === undefined || (typeof v === 'string' && !v.trim())) {
      patch[f] = null;
    }
  }
  return patch;
}

/**
 * PostgREST 的 or=(...) 语法里 , ( ) 是结构字符,搜索词里出现会破坏表达式。
 * `*` 是 PostgREST 的 like 通配符,保留(用户可主动用)。
 */
function sanitizeSearch(raw: string): string {
  return raw.replace(/[,()\\]/g, ' ').trim();
}

export interface CardQuery extends CardFilter {
  page: number;
  pageSize: number;
}

/** 列表筛选条件。关键词体检也用这一套 —— 两处语义必须一致 */
export interface CardFilter {
  search?: string;
  series?: string;
  rarity?: string;
}

/**
 * 把筛选条件翻译成 PostgREST 查询。
 *
 * 抽出来共用而不是各写一份:关键词体检必须和列表页筛出**同一批卡**,
 * 否则「列表里筛出 45 张 RAD」与「体检扫出来的卡」对不上,编务就不知道
 * 自己到底在改哪些卡。
 */
function filterQuery(f: CardFilter): { or?: string; filters: RestFilter[] } {
  const kw = sanitizeSearch(f.search ?? '');
  return {
    or: kw
      ? `card_no.ilike.*${kw}*,card_name_cn.ilike.*${kw}*,card_name_en.ilike.*${kw}*`
      : undefined,
    filters: [
      ...(f.series ? [{ column: 'series_name', op: 'eq' as const, value: f.series }] : []),
      ...(f.rarity ? [{ column: 'rarity_name', op: 'eq' as const, value: f.rarity }] : [])
    ]
  };
}

export interface CardPage {
  rows: CardBase[];
  total: number | null;
}

/**
 * 印刷版本写入载荷。
 * id 允许为 null —— 界面上「新增但尚未保存」的行带着 id: null,
 * 用这个类型才不会和 CardPrint 的 id: string 打架。
 */
export type PrintPayload = Omit<CardPrint, 'id'> & { id?: string | null };

/** 分页 + 筛选读取卡牌列表(服务端分页) */
export async function listCards(q: CardQuery): Promise<CardPage> {
  const offset = (q.page - 1) * q.pageSize;
  const { rows, total } = await restSelect<CardBase>('cards_base', {
    columns: CARD_LIST_COLUMNS,
    ...filterQuery(q),
    order: 'card_no.asc',
    limit: q.pageSize,
    offset,
    count: true
  });
  return { rows, total };
}

export async function getCard(id: string): Promise<CardBase | null> {
  const { rows } = await restSelect<CardBase>('cards_base', {
    filters: [{ column: 'id', op: 'eq', value: id }],
    limit: 1
  });
  return rows[0] ?? null;
}

/**
 * 只提交变更字段。
 * @returns 真正被更新的行(空数组 = 无匹配或被 RLS 拒绝)
 */
export async function updateCard(
  id: string,
  patch: Record<string, unknown>
): Promise<CardBase[]> {
  if (!Object.keys(patch).length) return [];
  return restUpdate<CardBase>(
    'cards_base',
    { ...coerceNumericNulls(patch, NUMERIC_CARD_FIELDS), updated_at: new Date().toISOString() },
    [{ column: 'id', op: 'eq', value: id }]
  );
}

/** 新建空白卡牌(卡号占位,待编务改写) */
export async function createCard(): Promise<CardBase> {
  const rows = await restInsert<CardBase>('cards_base', {
    card_no: `NEW-${Date.now()}`,
    updated_at: new Date().toISOString()
  });
  const created = rows[0];
  if (!created) throw new Error('创建失败:服务端未返回新行(可能是权限不足)');
  return created;
}

/**
 * 删除卡牌。
 * 必须先删全部印刷版本 —— card_prints.card_id 有外键约束指向 cards_base。
 */
export async function deleteCard(id: string): Promise<void> {
  await restDelete('card_prints', [{ column: 'card_id', op: 'eq', value: id }]);
  const removed = await restDelete<CardBase>('cards_base', [{ column: 'id', op: 'eq', value: id }]);
  if (!removed.length) throw new Error('删除失败:未删除任何行(可能是权限不足)');
}

/* ──────────────────────── 印刷版本 ──────────────────────── */

export async function listPrints(cardId: string): Promise<CardPrint[]> {
  const { rows } = await restSelect<CardPrint>('card_prints', {
    filters: [{ column: 'card_id', op: 'eq', value: cardId }],
    order: 'print_order.asc'
  });
  return rows;
}

/** 印刷版本的「接口拥有列」,与同步模块的边界一致 */
function printPatch(row: PrintPayload): Record<string, unknown> {
  const patch = coerceNumericNulls(
    {
      card_no_extend: row.card_no_extend,
      rarity_name: row.rarity_name,
      extend_rarity_name: row.extend_rarity_name,
      language: row.language,
      artist: row.artist,
      img_cdn: row.img_cdn,
      tts_cdn: row.tts_cdn,
      back_image: row.back_image,
      print_order: row.print_order,
      is_default: row.is_default,
      is_promo: row.is_promo,
      series: row.series,
      flavor_text_cn: row.flavor_text_cn,
      flavor_text_en: row.flavor_text_en
    },
    NUMERIC_PRINT_FIELDS
  );
  return coerceInheritNulls(patch, INHERITABLE_PRINT_FIELDS);
}

export async function insertPrint(
  cardId: string,
  row: Partial<PrintPayload>
): Promise<CardPrint> {
  const rows = await restInsert<CardPrint>('card_prints', {
    card_id: cardId,
    ...printPatch(row as PrintPayload),
    updated_at: new Date().toISOString()
  });
  const created = rows[0];
  if (!created) throw new Error('新增印刷版本失败:服务端未返回新行');
  return created;
}

export async function updatePrint(
  id: string,
  row: Partial<PrintPayload>
): Promise<CardPrint[]> {
  return restUpdate<CardPrint>(
    'card_prints',
    { ...printPatch(row as PrintPayload), updated_at: new Date().toISOString() },
    [{ column: 'id', op: 'eq', value: id }]
  );
}

export async function deletePrint(id: string): Promise<CardPrint[]> {
  return restDelete<CardPrint>('card_prints', [{ column: 'id', op: 'eq', value: id }]);
}

/** 把印刷版本转移到另一张卡(改 card_id) */
export async function transferPrint(
  printId: string,
  targetCardId: string
): Promise<CardPrint[]> {
  return restUpdate<CardPrint>(
    'card_prints',
    { card_id: targetCardId, updated_at: new Date().toISOString() },
    [{ column: 'id', op: 'eq', value: printId }]
  );
}

/* ──────────────────────── 选项 ──────────────────────── */

export interface SeriesOption {
  code: string;
  name_cn: string | null;
}

export async function loadSeriesOptions(): Promise<SeriesOption[]> {
  const { rows } = await restSelect<SeriesOption>('series', {
    columns: 'code,name_cn',
    order: 'release_order.asc'
  });
  return rows;
}

/** 稀有度候选:全表去重(库中无字典表) */
export async function loadRarityOptions(): Promise<string[]> {
  const rows = await restSelectAll<{ rarity_name: string | null }>('cards_base', {
    columns: 'rarity_name'
  });
  return [...new Set(rows.map((r) => r.rarity_name).filter((v): v is string => !!v))].sort();
}

/**
 * 数组字段候选值:全表去重(供多选标签输入器的下拉)。
 *
 * 必须走 restSelectAll —— PostgREST 单次响应上限 1000 行,而 cards_base 已有
 * 1016 行。原先用 restSelect 不分页,会静默漏掉最后 16 行:线上实测下拉框里
 * 只有 49 个关键词候选取值,而全表实际有 50 个(漏掉的是「法盾3」)。
 */
export async function loadArrayFieldOptions(
  field: 'card_color_list' | 'region' | 'tag' | 'keyword' | 'advanced_tag'
): Promise<string[]> {
  const rows = await restSelectAll<Record<string, string[] | null>>('cards_base', {
    columns: field
  });
  const set = new Set<string>();
  for (const row of rows) {
    const arr = row[field];
    if (Array.isArray(arr)) for (const v of arr) if (typeof v === 'string' && v) set.add(v);
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'zh'));
}

/* ──────────────────────── 关键词体检 ──────────────────────── */

/** 体检所需列:只取判定用得到的字段,不拉整表全字段 */
export const KEYWORD_AUDIT_COLUMNS =
  'id,card_no,card_name_cn,effect_cn,effect_en,keyword,series_name';

/** 体检行(比 CardBase 窄) */
export type KeywordAuditRow = Pick<
  CardBase,
  'id' | 'card_no' | 'card_name_cn' | 'effect_cn' | 'effect_en' | 'keyword' | 'series_name'
>;

/**
 * 拉取「关键词体检」要扫的卡(分页拉完)。
 *
 * 走与列表页**同一套筛选语义**:编务筛了哪个系列、哪个稀有度、搜了什么词,
 * 体检就只扫那一批。不传筛选 = 全表(1016 行 = 2 次请求)。
 * 判定全部在本地做 —— 规则引擎是纯函数,这里只负责把文本取回来。
 */
export function selectCardsForKeywordAudit(filter: CardFilter = {}): Promise<KeywordAuditRow[]> {
  return restSelectAll<KeywordAuditRow>('cards_base', {
    columns: KEYWORD_AUDIT_COLUMNS,
    ...filterQuery(filter),
    order: 'card_no.asc'
  });
}

export interface KeywordWriteItem {
  id: string;
  card_no: string;
  keyword: string[];
}

export interface KeywordWriteResult {
  /** 真正落库的行数(服务端回了行才算) */
  ok: number;
  failed: { id: string; card_no: string; error: string }[];
}

/**
 * 批量写关键词。
 *
 * 为什么不复用 batch.ts 的 updateMany:那是「同值补丁」批处理(一次请求改
 * 一批行),而每张卡的关键词数组各不相同,合并不到一个 patch 里。
 * 所以逐行更新,但每行**只提交 keyword 一个字段**(外加 updated_at),
 * 不整行覆盖 —— 沿用后台三条库约定之②③。
 */
export async function writeKeywords(
  patches: readonly KeywordWriteItem[],
  onProgress?: (done: number, total: number) => void
): Promise<KeywordWriteResult> {
  const failed: KeywordWriteResult['failed'] = [];
  let ok = 0;
  let done = 0;

  for (const p of patches) {
    try {
      const rows = await restUpdate<{ id: string }>(
        'cards_base',
        { keyword: p.keyword, updated_at: new Date().toISOString() },
        [{ column: 'id', op: 'eq', value: p.id }]
      );
      // 服务端只回真正被改动的行;空数组 = 无匹配行或被 RLS 拒绝(不是错误,但多半是权限)
      if (rows.length) ok += 1;
      else failed.push({ id: p.id, card_no: p.card_no, error: '未写入(无匹配行或权限不足)' });
    } catch (e) {
      failed.push({
        id: p.id,
        card_no: p.card_no,
        error: e instanceof Error ? e.message : String(e)
      });
    }
    done += 1;
    onProgress?.(done, patches.length);
  }
  return { ok, failed };
}

/* ──────────────────────── 发布 ──────────────────────── */

/** 触碰 version.name='cards' —— 站内客户端据此判断卡表缓存是否失效 */
export function publishCards(): Promise<void> {
  return touchVersion('cards');
}

/* ──────────────────────── 变更计算 ──────────────────────── */

/** 可编辑的卡牌字段(与后端方案 A 的表单范围一致) */
export const CARD_EDITABLE_FIELDS = [
  'card_no',
  'card_name_cn',
  'card_name_en',
  'card_name_kr',
  'card_name_tw',
  'sub_title_cn',
  'sub_title_en',
  'sub_title_kr',
  'sub_title_tw',
  'card_color_list',
  'region',
  'tag',
  'keyword',
  'advanced_tag',
  'champion_tag',
  'effect_cn',
  'effect_en',
  'effect_kr',
  'effect_tw',
  'flavor_text_cn',
  'flavor_text_en',
  'energy',
  'return_energy',
  'power',
  'rarity_name',
  'series_name',
  'is_banned',
  'deck_limit'
] as const satisfies readonly (keyof CardBase)[];

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
  return (a ?? null) === (b ?? null);
}

/**
 * 只挑出真正变了的字段 —— 保存时不整行覆盖,
 * 避免把一个未加载/未编辑的列顺手写成 null。
 */
export function changedCardFields(
  before: CardBase,
  after: CardBase
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const f of CARD_EDITABLE_FIELDS) {
    if (!sameValue(before[f], after[f])) patch[f] = after[f];
  }
  return patch;
}

/** 卡牌总行数(卡片墙/快照导出提示用) */
export async function countCards(): Promise<number | null> {
  const { total } = await restSelect('cards_base', { columns: 'id', limit: 1, count: true });
  return total;
}

/** 全量读取(快照导出用),分页拉完 */
export async function selectAllCards(columns = '*'): Promise<CardBase[]> {
  return restSelectAll<CardBase>('cards_base', { columns, order: 'card_no.asc' });
}

/** 全量读取印刷版本(快照导出用) */
export async function selectAllPrints(columns = '*'): Promise<CardPrint[]> {
  return restSelectAll<CardPrint>('card_prints', { columns, order: 'card_no_extend.asc' });
}

/* ──────────────────────── 导出 TTS Lua ──────────────────────── */

/** 「导出 TTS Lua」所需列(cards_base 只取用到的字段) */
export const LUA_EXPORT_CARD_COLUMNS =
  'id,card_name_cn,sub_title_cn,effect_cn,card_category,rarity_name,series_name';

/** 「导出 TTS Lua」所需列(card_prints 只取用到的字段) */
export const LUA_EXPORT_PRINT_COLUMNS =
  'card_id,card_no_extend,img_cdn,back_image,extend_rarity_name,series,is_promo';

export interface LuaExportRows {
  cards: LuaExportCard[];
  prints: LuaExportPrint[];
}

/**
 * 拉取生成 TTS mod Lua 数据块所需的全部行。
 * 印刷版本只取 language='SC'(卡图 / 异画版本以简中印刷版为准)。
 */
export async function loadLuaExportRows(): Promise<LuaExportRows> {
  const [cards, prints] = await Promise.all([
    restSelectAll<LuaExportCard>('cards_base', {
      columns: LUA_EXPORT_CARD_COLUMNS,
      order: 'card_no.asc'
    }),
    restSelectAll<LuaExportPrint>('card_prints', {
      columns: LUA_EXPORT_PRINT_COLUMNS,
      filters: [{ column: 'language', op: 'eq', value: 'SC' }],
      order: 'card_no_extend.asc'
    })
  ]);
  return { cards, prints };
}
