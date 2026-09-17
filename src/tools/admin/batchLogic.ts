/* ================================================================
 * src/tools/admin/batchLogic.ts
 *
 * 批量校勘的**纯逻辑** —— 零 I/O、零框架依赖,可在 Node 里直接单测
 * (见 scripts/verify-admin-logic.mjs)。I/O 部分见 ./batch.ts。
 *
 * 之所以单独成文件:batch.ts 会 import rest.ts → auth.ts → vue,
 * 而 Node 的 ESM 解析不了 vue 的具名导出;把纯函数隔离出来才测得动。
 * ============================================================== */

/** 表内可编辑的标量字段(数组与长文本留给卡牌校勘) */
export const BATCH_FIELDS = [
  'card_no',
  'card_name_cn',
  'card_name_en',
  'energy',
  'return_energy',
  'power',
  'rarity_name',
  'series_name',
  'is_banned'
] as const;

export type BatchField = (typeof BATCH_FIELDS)[number];

function sameScalar(a: unknown, b: unknown): boolean {
  return (a ?? null) === (b ?? null);
}

/** 逐行挑出真正变了的字段(与卡牌校勘同策略:不整行覆盖) */
export function changedBatchFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const f of BATCH_FIELDS) {
    if (!sameScalar(before[f], after[f])) patch[f] = after[f];
  }
  return patch;
}

export interface NumericGroup {
  /** 该组统一写入的目标绝对值 */
  target: number;
  ids: string[];
}

/**
 * 把「当前值 + delta」结果相同的行归成一组。
 *
 * 为什么需要分组:PostgREST 的 PATCH 是「一个补丁作用于一批行」,
 * 不支持 SQL 的 `SET energy = energy + 1`。只能在前端把结果相同的行
 * 归成一组,每组发一次 .in() 请求。
 *
 * 语义约定:`null` 视为 0(与后台一致 —— 库里没有值的卡按 0 参与加减),
 * 因此「null 行 +3」与「值为 3 的行」会归入同一组、写同一个目标值。
 * 界面必须把这一点显式告诉编务,否则会被误以为 null 被保留。
 */
export function groupByDelta(
  currentById: Map<string, number | null>,
  ids: readonly string[],
  delta: number
): NumericGroup[] {
  const groups = new Map<number, string[]>();
  for (const id of ids) {
    const cur = currentById.get(id) ?? 0;
    const target = cur + delta;
    const bucket = groups.get(target);
    if (bucket) bucket.push(id);
    else groups.set(target, [id]);
  }
  return [...groups.entries()]
    .map(([target, groupIds]) => ({ target, ids: groupIds }))
    .sort((a, b) => a.target - b.target);
}

export interface BatchPreviewGroup {
  label: string;
  count: number;
}

/** 同值补丁的预览(单组) */
export function valuePreview(label: string, count: number): BatchPreviewGroup[] {
  return [{ label, count }];
}

/** ±N 的预览(多组,顺序与 groupByDelta 一致) */
export function deltaPreview(groups: NumericGroup[], fieldLabel: string): BatchPreviewGroup[] {
  return groups.map((g) => ({ label: `${fieldLabel} → ${g.target}`, count: g.ids.length }));
}

/** 预览里的边界提醒:哪些行无值会被写成具体数字、哪些结果会小于 0 */
export function deltaWarnings(
  currentById: Map<string, number | null>,
  ids: readonly string[],
  delta: number
): string[] {
  const notes: string[] = [];
  const nulls = ids.filter((id) => (currentById.get(id) ?? null) === null).length;
  if (nulls) notes.push(`其中 ${nulls} 行当前无值,按 0 参与加减后会被写成具体数值`);
  const negatives = ids.filter((id) => (currentById.get(id) ?? 0) + delta < 0).length;
  if (negatives) notes.push(`有 ${negatives} 行加完后小于 0,数据库可能拒绝写入`);
  return notes;
}
