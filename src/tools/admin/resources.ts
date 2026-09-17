/* ================================================================
 * src/tools/admin/resources.ts
 *
 * 资源校勘的数据层:series + card_icons (+ version 复用 sources/rest.ts)。
 *
 * 注意 series 的主键是 **code(text)** 而不是 id —— 与 cards_base 的
 * 逻辑关联(无外键约束),所以删除系列不会动卡牌,只会让引用该代码的
 * 卡牌失去系列归属。界面上必须把这一点说清楚。
 * ============================================================== */

import { restDelete, restInsert, restSelect, restUpdate } from '../sources/rest';
import type { CardIcon, Series } from './types';

/* ──────────────────────── 系列 ──────────────────────── */

export const SERIES_COLUMNS =
  'code,name_cn,name_en,release_order,is_standard,is_active,base_count,alt_count,overnum_count,rune_count,token_count,cover_image';

export function listSeries(): Promise<Series[]> {
  return restSelect<Series>('series', {
    columns: SERIES_COLUMNS,
    order: 'release_order.asc'
  }).then((r) => r.rows);
}

export interface SeriesPatch {
  name_cn: string | null;
  name_en: string | null;
  release_order: number | null;
  is_standard: boolean;
  is_active: boolean;
  cover_image: string | null;
}

export async function insertSeries(code: string, patch: SeriesPatch): Promise<Series> {
  const rows = await restInsert<Series>('series', {
    code,
    ...patch,
    updated_at: new Date().toISOString()
  });
  const created = rows[0];
  if (!created) throw new Error('新增失败:服务端未返回新行(可能是权限不足)');
  return created;
}

export async function updateSeries(code: string, patch: SeriesPatch): Promise<Series[]> {
  return restUpdate<Series>(
    'series',
    { ...patch, updated_at: new Date().toISOString() },
    [{ column: 'code', op: 'eq', value: code }]
  );
}

/** 内联开关:只改一个布尔列 */
export async function setSeriesFlag(
  code: string,
  field: 'is_standard' | 'is_active',
  value: boolean
): Promise<Series[]> {
  return restUpdate<Series>(
    'series',
    { [field]: value, updated_at: new Date().toISOString() },
    [{ column: 'code', op: 'eq', value: code }]
  );
}

export async function deleteSeries(code: string): Promise<Series[]> {
  return restDelete<Series>('series', [{ column: 'code', op: 'eq', value: code }]);
}

/** 统计:有多少卡牌引用了某个系列代码(删除前提示用) */
export async function countCardsInSeries(code: string): Promise<number | null> {
  const { total } = await restSelect('cards_base', {
    columns: 'id',
    filters: [{ column: 'series_name', op: 'eq', value: code }],
    limit: 1,
    count: true
  });
  return total;
}

/* ──────────────────────── 图标库 ──────────────────────── */

export const ICON_COLUMNS = 'id,name_zh,name_en,url,url_en,storage_type,isWhite';

export function listIcons(): Promise<CardIcon[]> {
  return restSelect<CardIcon>('card_icons', {
    columns: ICON_COLUMNS,
    order: 'name_zh.asc'
  }).then((r) => r.rows);
}

export interface IconPatch {
  name_zh: string;
  name_en: string;
  url: string;
  url_en: string | null;
  storage_type: string;
  isWhite: boolean;
}

export async function insertIcon(patch: IconPatch): Promise<CardIcon> {
  const rows = await restInsert<CardIcon>('card_icons', {
    ...patch,
    updated_at: new Date().toISOString()
  });
  const created = rows[0];
  if (!created) throw new Error('新增失败:服务端未返回新行(可能是权限不足)');
  return created;
}

export async function updateIcon(id: string, patch: IconPatch): Promise<CardIcon[]> {
  return restUpdate<CardIcon>(
    'card_icons',
    { ...patch, updated_at: new Date().toISOString() },
    [{ column: 'id', op: 'eq', value: id }]
  );
}

export async function deleteIcon(id: string): Promise<CardIcon[]> {
  return restDelete<CardIcon>('card_icons', [{ column: 'id', op: 'eq', value: id }]);
}

/** 图标 URL 校验见 ./validate.ts(纯函数,可单测) */
export { isUsableIconUrl } from './validate';
