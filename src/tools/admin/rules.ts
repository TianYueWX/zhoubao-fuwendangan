/* ================================================================
 * src/tools/admin/rules.ts
 *
 * 规则校勘的数据层(rules)。
 *
 * 两处与后台原实现的差异,都有实测依据:
 *   ① 只取需要的列,不 select('*') —— search_vector 是 tsvector,
 *      2381 行全带上会白白拉大几百 KB。
 *   ② 检索走子串匹配而非库里的 search_vector(原因见 rulesTree.ts 注释,
 *      实测中文召回只有子串的 3–7%)。
 * ============================================================== */

import { restDelete, restInsert, restSelectAll, restUpdate, touchVersion } from '../sources/rest';
import type { Rule } from './types';

/** 规则树需要的列(search_vector 刻意排除) */
export const RULE_COLUMNS =
  'id,rule_number,parent_number,level,is_heading,text_zh,text_en,sort_order,rules_book,updated_at';

/** 全量读取 —— 建树必须拿到全部条目 */
export function listAllRules(): Promise<Rule[]> {
  return restSelectAll<Rule>('rules', { columns: RULE_COLUMNS, order: 'rule_number.asc' });
}

export interface RulePatch {
  rule_number: string;
  parent_number: string | null;
  level: number | null;
  is_heading: boolean;
  text_zh: string | null;
  text_en: string | null;
  sort_order: number | null;
  rules_book: string | null;
}

/** 新增规则 */
export async function insertRule(patch: RulePatch): Promise<Rule> {
  const rows = await restInsert<Rule>('rules', {
    ...patch,
    updated_at: new Date().toISOString()
  });
  const created = rows[0];
  if (!created) throw new Error('新增失败:服务端未返回新行(可能是权限不足)');
  return created;
}

/** 更新规则;返回真正被写入的行(空数组 = 被拒或无匹配) */
export async function updateRule(id: string, patch: RulePatch): Promise<Rule[]> {
  return restUpdate<Rule>(
    'rules',
    { ...patch, updated_at: new Date().toISOString() },
    [{ column: 'id', op: 'eq', value: id }]
  );
}

export async function deleteRule(id: string): Promise<Rule[]> {
  return restDelete<Rule>('rules', [{ column: 'id', op: 'eq', value: id }]);
}

/** 触碰 version.name='rules' —— 客户端据此刷新规则书缓存 */
export function publishRules(): Promise<void> {
  return touchVersion('rules');
}
