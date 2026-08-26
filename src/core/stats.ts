/* ================================================================
 * src/core/stats.ts
 *
 * 稳健统计工具(v3 新增):
 *   - 贝叶斯收缩(向环境均值收缩):解决小样本胜率霸榜问题
 *     winRate_adj = (wins + k·prior) / (rounds + k)
 *     k(强度)= 10:样本 10 轮时先验约占一半权重,样本越大越接近真实值
 *     实际使用时建议 adaptiveShrinkStrength(按数据规模自适应,≈ 样本量 1%)
 *   - 环境先验 = Σwins / Σrounds(加权口径,同 heroStats)
 *   - 威尔逊区间下界(Wilson score lower bound):热度榜排序用,
 *     「高出场 + 高占比」才排前面,低样本自动下沉(无需手调阈值)
 * 纯函数,无 DOM / Vue 依赖。
 * ============================================================== */

import type { Deck } from '@/types';

/** 贝叶斯收缩基础强度:等效 10 轮样本的先验权重 */
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

/**
 * 自适应收缩强度:C = max(min, 样本量 × ratio)。
 * 数据规模越大,先验权重可越强(固定 C=100 会把小样本压平,退化成纯热度榜)。
 * 默认:总量 1% 起步、下限 10(≈ 用户建议 C=50~100 在周赛数据上的温和版)。
 */
export function adaptiveShrinkStrength(
  grandTotal: number,
  min = SHRINK_STRENGTH,
  ratio = 0.01
): number {
  return Math.max(min, Math.round(grandTotal * ratio));
}

/**
 * 威尔逊区间下界(比例 0-1)。
 * @param successes 成功次数(如某英雄/传奇被携带的卡组数)
 * @param trials    总试验数(如全量卡组数)
 * @param z         置信度常数,默认 1.96(95% 置信度)
 * 性质:同占比下样本越大分数越高;样本越小越被拉向 0,天然过滤"假热度"。
 */
export function wilsonLowerBound(successes: number, trials: number, z = 1.96): number {
  if (trials <= 0) return 0;
  const n = Math.max(1, trials);
  const p = Math.min(1, Math.max(0, successes) / n);
  const z2 = z * z;
  const center = p + z2 / (2 * n);
  const width = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return Math.max(0, (center - width) / (1 + z2 / n));
}

/** 威尔逊下界的百分点形式(0-100),热度榜排序与展示用 */
export function wilsonLowerBoundPct(successes: number, trials: number, z = 1.96): number {
  return wilsonLowerBound(successes, trials, z) * 100;
}

/* ================================================================
 * 转化综合分(v3.1):名次转化口径的强度指标,全面替代胜率。
 * 瑞士轮胜率受轮数结构与出勤噪声影响大,名次转化(Top8/Top4/冠/亚)
 * 更贴近赛事真实表现,且不依赖 rank_data 导入。
 * ============================================================== */

/** 转化综合分权重:Top8率 35% + Top4率 35% + 冠军率 20% + 亚军率 10% */
export const CONVERT_TOP8_W = 0.35;
export const CONVERT_TOP4_W = 0.35;
export const CONVERT_CHAMPION_W = 0.2;
export const CONVERT_RUNNER_UP_W = 0.1;

/**
 * 转化综合分(0-100):Top8率×0.35 + Top4率×0.35 + 冠军率×0.2 + 亚军率×0.1。
 * 冠军/亚军率在周赛数据中稀疏,权重刻意压低;Top8/Top4 承担主体。
 */
export function convertScore(
  top8Rate: number,
  top4Rate: number,
  championRate: number,
  runnerUpRate: number
): number {
  return (
    top8Rate * CONVERT_TOP8_W +
    top4Rate * CONVERT_TOP4_W +
    championRate * CONVERT_CHAMPION_W +
    runnerUpRate * CONVERT_RUNNER_UP_W
  );
}
