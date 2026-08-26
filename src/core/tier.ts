/* ================================================================
 * src/core/tier.ts
 *
 * 英雄 Tier 自动分级(纯函数,两处复用):
 *   综合分 = Top8率分位 × 0.35 + Top4率分位 × 0.35 + 冠军率分位 × 0.20 + 亚军率分位 × 0.10
 *   (名次转化口径,替代胜率:瑞士轮胜率噪声大,且转化指标不依赖 rank_data)
 *
 *   S ≥ p85 / A ≥ p60 / B ≥ p30 / C 其余
 *
 * 无胜场数据不影响评级(转化指标来自名次)。样本数量不设门槛。
 * ============================================================== */

import type { HeroStats, TierRating } from '@/types';

/**
 * 参与评级的最低卡组数(0 = 不限制)。
 * 产品要求:英雄 Tier List 全量展示,样本数量不做门槛;
 * 转化率分母天然惩罚小样本,分位评级相对稳健。
 */
export const MIN_TIER_SAMPLE = 0;

/** 百分位(0-1):value 在 values 中的排名比例 */
function percentile(values: readonly number[], value: number): number {
  if (values.length === 0) return 0;
  let below = 0;
  for (const v of values) {
    if (v < value) below += 1;
  }
  return below / values.length;
}

export interface TierInput {
  top8Rate: number;
  top4Rate: number;
  championRate: number;
  runnerUpRate: number;
  popularity: number;
}

export interface TierOutput {
  tier: TierRating | null;
  tierScore: number | null;
}

/**
 * 对一组英雄指标批量评级。样本不足(<4 个有效英雄)时全部返回 null。
 */
export function rateTiers(inputs: readonly TierInput[]): TierOutput[] {
  const idx: number[] = [];
  const top8s: number[] = [];
  const top4s: number[] = [];
  const champs: number[] = [];
  const runners: number[] = [];
  const pops: number[] = [];

  inputs.forEach((e, i) => {
    idx.push(i);
    top8s.push(e.top8Rate);
    top4s.push(e.top4Rate);
    champs.push(e.championRate);
    runners.push(e.runnerUpRate);
    pops.push(e.popularity);
  });

  if (idx.length < 4) {
    return inputs.map(() => ({ tier: null, tierScore: null }));
  }

  const out: TierOutput[] = inputs.map(() => ({ tier: null, tierScore: null }));

  for (const i of idx) {
    const e = inputs[i]!;
    const pTop8 = percentile(top8s, e.top8Rate);
    const pTop4 = percentile(top4s, e.top4Rate);
    const pChamp = percentile(champs, e.championRate);
    const pRunner = percentile(runners, e.runnerUpRate);
    const pPop = percentile(pops, e.popularity);

    // 转化综合分:Top8 0.35 + Top4 0.35 + 冠军 0.20 + 亚军 0.10
    const score = pTop8 * 0.35 + pTop4 * 0.35 + pChamp * 0.2 + pRunner * 0.1;

    out[i] = {
      tierScore: Math.round(score * 100),
      tier: score >= 0.85 ? 'S' : score >= 0.6 ? 'A' : score >= 0.3 ? 'B' : 'C'
    };
  }
  return out;
}

/**
 * 就地填充 HeroStats 的 tier 字段(全量分析管线使用)。
 */
export function computeTiers(
  heroes: Map<string, HeroStats>,
  opts: { minSample?: number } = {}
): void {
  const minSample = opts.minSample ?? MIN_TIER_SAMPLE;

  const keys: string[] = [];
  const inputs: TierInput[] = [];
  for (const [hero, stat] of heroes) {
    if (stat.total < minSample) continue;
    keys.push(hero);
    inputs.push({
      top8Rate: stat.top8Rate,
      top4Rate: stat.top4Rate,
      championRate: stat.championRate,
      runnerUpRate: stat.runnerUpRate,
      popularity: stat.popularity
    });
  }

  const rated = rateTiers(inputs);
  keys.forEach((hero, i) => {
    const r = rated[i];
    if (!r || !r.tier) return;
    const stat = heroes.get(hero);
    if (!stat) return;
    stat.tier = r.tier;
    stat.tierScore = r.tierScore;
  });
}
