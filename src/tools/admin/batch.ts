/* ================================================================
 * src/tools/admin/batch.ts
 *
 * 批量校勘的数据层(cards_base)。
 *
 * 关于「数值 ±N」为何要分组:
 *   PostgREST 的 PATCH 是「一个补丁作用于一批行」,不支持行内表达式
 *   (没有 SQL 的 `SET energy = energy + 1`)。所以只能在前端把
 *   「加完之后结果相同」的行归成一组,每组发一次 .in() 请求。
 *   分组逻辑是纯函数,单独可测(见 scripts/verify-admin-logic.mjs)。
 * ============================================================== */

import { restSelect, restUpdate } from '../sources/rest';
import type { CardBase } from './types';

/*
 * 纯逻辑(变更计算 / ±N 分组 / 预览)在 ./batchLogic.ts,此处 re-export,
 * 调用方只需 import 一个模块。
 */
export {
  BATCH_FIELDS,
  changedBatchFields,
  deltaPreview,
  deltaWarnings,
  groupByDelta,
  valuePreview,
  type BatchField,
  type BatchPreviewGroup,
  type NumericGroup
} from './batchLogic';

/** 可排序的列 */
export const SORTABLE_FIELDS = [
  'card_no',
  'card_name_cn',
  'card_name_en',
  'card_name_kr',
  'card_name_tw',
  'energy',
  'return_energy',
  'power',
  'rarity_name',
  'series_name'
] as const;

export type SortField = (typeof SORTABLE_FIELDS)[number];

/** 表内展示需要的列(card_no 必带,用于定位) */
export const BATCH_COLUMNS =
  'id,card_no,card_name_cn,card_name_en,card_name_kr,card_name_tw,energy,return_energy,power,rarity_name,series_name,is_banned,deck_limit';

export type BatchRow = Pick<
  CardBase,
  | 'id'
  | 'card_no'
  | 'card_name_cn'
  | 'card_name_en'
  | 'card_name_kr'
  | 'card_name_tw'
  | 'energy'
  | 'return_energy'
  | 'power'
  | 'rarity_name'
  | 'series_name'
  | 'is_banned'
  | 'deck_limit'
>;

export interface BatchQuery {
  search?: string;
  series?: string;
  rarity?: string;
  sortField: SortField;
  sortAsc: boolean;
  page: number;
  pageSize: number;
}

function sanitizeSearch(raw: string): string {
  return raw.replace(/[,()\\]/g, ' ').trim();
}

export async function listBatchRows(
  q: BatchQuery
): Promise<{ rows: BatchRow[]; total: number | null }> {
  const kw = sanitizeSearch(q.search ?? '');
  const offset = (q.page - 1) * q.pageSize;
  const { rows, total } = await restSelect<BatchRow>('cards_base', {
    columns: BATCH_COLUMNS,
    or: kw
      ? `card_no.ilike.*${kw}*,card_name_cn.ilike.*${kw}*,card_name_en.ilike.*${kw}*,card_name_kr.ilike.*${kw}*,card_name_tw.ilike.*${kw}*`
      : undefined,
    filters: [
      ...(q.series ? [{ column: 'series_name', op: 'eq' as const, value: q.series }] : []),
      ...(q.rarity ? [{ column: 'rarity_name', op: 'eq' as const, value: q.rarity }] : [])
    ],
    order: `${q.sortField}.${q.sortAsc ? 'asc' : 'desc'}`,
    limit: q.pageSize,
    offset,
    count: true
  });
  return { rows, total };
}

/**
 * 同值补丁批量更新:一次请求改一批行。
 *
 * 按 50 个 id 分块 —— 每个 uuid 36 字符,一次塞几百个会把 URL 撑爆
 * (PostgREST 的 in.() 走查询串)。分块后逐块顺序执行,并汇总失败块的行 id。
 */
export async function updateMany(
  ids: string[],
  patch: Record<string, unknown>
): Promise<{ updated: number; failedIds: string[] }> {
  if (!ids.length) return { updated: 0, failedIds: [] };
  const CHUNK = 50;
  let updated = 0;
  const failedIds: string[] = [];

  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    try {
      const rows = await restUpdate<{ id: string }>('cards_base', patch, [
        { column: 'id', op: 'in', value: chunk }
      ]);
      updated += rows.length;
      // 服务端只回被真正改动的行;缺口即被 RLS 拦掉的行
      if (rows.length < chunk.length) {
        const done = new Set(rows.map((r) => r.id));
        failedIds.push(...chunk.filter((id) => !done.has(id)));
      }
    } catch {
      failedIds.push(...chunk);
    }
  }
  return { updated, failedIds };
}

/** 行内保存:只提交变更字段 */
export async function saveRow(
  id: string,
  patch: Record<string, unknown>
): Promise<{ ok: boolean; changed: number }> {
  if (!Object.keys(patch).length) return { ok: true, changed: 0 };
  const rows = await restUpdate<{ id: string }>(
    'cards_base',
    { ...patch, updated_at: new Date().toISOString() },
    [{ column: 'id', op: 'eq', value: id }]
  );
  return { ok: rows.length > 0, changed: Object.keys(patch).length };
}
