/* ================================================================
 * src/core/stats.ts
 *
 * 稳健统计工具(v3 新增):
 *   - 贝叶斯收缩(向环境均值收缩):解决小样本胜率霸榜问题
 *     winRate_adj = (wins + k·prior) / (rounds + k)
 *     k(强度)= 10:样本 10 轮时先验约占一半权重,样本越大越接近真实值
 *   - 环境先验 = Σwins / Σrounds(加权口径,同 heroStats)
 * 纯函数,无 DOM / Vue 依赖。
 * ============================================================== */

import type { Deck } from '@/types';

/** 贝叶斯收缩默认强度:等效 10 轮样本的先验权重 */
export const SHRINK_STRENGTH = 10;

/**
 * 收缩胜率(%)。
 * @param wins 胜场数(≥0)
 * @param rounds 总轮次(>0)
 * @param prior 先验胜率(0-1 小数,通常为环境均值)
 * @param strength 收缩强度(默认 SHRINK_STRENGTH)
 */
export function shrinkWinRate(wins: number, rounds: number, prior: number, strength = SHRINK_STRENGTH): number {
  if (rounds <= 0) return prior * 100;
  return ((wins + strength * prior) / (rounds + strength)) * 100;
}

/**
 * 环境先验胜率(小数 0-1):全部卡组的 Σwins/Σrounds。
 * 无任何胜场数据时返回 null。
 */
export function envPriorWinRate(decks: readonly Deck[]): number | null {
  let wins = 0;
  let rounds = 0;
  for (const d of decks) {
    if (d.wins !== null && d.eventRounds !== null && d.eventRounds > 0) {
      wins += d.wins;
      rounds += d.eventRounds;
    }
  }
  if (rounds <= 0) return null;
  return wins / rounds;
}

/**
 * 收缩一批 (wins, rounds):返回收缩后胜率(%);无数据项返回 null。
 */
export function shrinkBatch(
  items: readonly { wins: number | null; rounds: number | null }[],
  prior: number | null,
  strength = SHRINK_STRENGTH
): (number | null)[] {
  if (prior == null) {
    return items.map((it) =>
      it.wins != null && it.rounds != null && it.rounds > 0 ? (it.wins / it.rounds) * 100 : null
    );
  }
  return items.map((it) =>
    it.wins != null && it.rounds != null && it.rounds > 0
      ? shrinkWinRate(it.wins, it.rounds, prior, strength)
      : null
  );
}
