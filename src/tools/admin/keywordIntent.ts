/* ================================================================
 * src/tools/admin/keywordIntent.ts
 *
 * 跨视图的一次性意图:「同步刚落地了新卡,去卡片页把关键词补上」。
 *
 * 为什么不用路由参数:hash 路由的查询串只在**同一条路由**上保留
 * (见 src/router/hash.ts 的 syncUrl),从 #/editorial/sync 跳到
 * #/editorial/cards 时会被规范化掉,和目标页读取形成竞态。
 * 模块级 ref 没有这个问题:置位即生效,消费即清零。
 * ============================================================== */

import { ref } from 'vue';

/** 目标页挂载时是否自动打开关键词体检抽屉 */
const keywordAuditIntent = ref(false);

/** 由同步页在卡片落地成功后调用 */
export function requestKeywordAudit(): void {
  keywordAuditIntent.value = true;
}

/** 由卡片页在启动时调用一次:拿到 true 就自动开抽屉,并把意图清掉 */
export function consumeKeywordAuditIntent(): boolean {
  if (!keywordAuditIntent.value) return false;
  keywordAuditIntent.value = false;
  return true;
}
