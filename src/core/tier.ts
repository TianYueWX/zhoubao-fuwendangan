/* ================================================================
 * src/core/tier.ts
 *
 * 英雄 Tier 自动分级(纯函数,两处复用):
 *   综合分 = 胜率分位 × 0.55 + Top8率分位 × 0.20 + 出场率分位 × 0.25
 *
 *   S ≥ p85 / A ≥ p60 / B ≥ p30 / C 其余
 *
 * 无胜场数据时退化为 Top8率 × 0.6 + 出场率 × 0.4。
 * ============================================================== */

import type { HeroStats, TierRating } from '@/types';

/** 参与评级的最低卡组数 */
export const MIN_TIER_SAMPLE = 15;

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
  winRate: number | null;
  top8Rate: number;
  popularity: number;
}

export interface TierOutput {
  tier: TierRating | null;
  tierScore: number | null;
}

/**
 * 对一组英雄指标批量评级。样本不足(<4 个有效英雄)时全部返回 null。
 */
export function rateTiers(
  inputs: readonly TierInput[],
  opts: { hasWinData?: boolean } = {}
): TierOutput[] {
  const useWin = opts.hasWinData !== false;
  const idx: number[] = [];
  const winRates: number[] = [];
  const top8s: number[] = [];
  const pops: number[] = [];

  inputs.forEach((e, i) => {
    if (useWin && e.winRate == null) return;
    idx.push(i);
    winRates.push(e.winRate ?? e.top8Rate);
    top8s.push(e.top8Rate);
    pops.push(e.popularity);
  });

  if (idx.length < 4) {
    return inputs.map(() => ({ tier: null, tierScore: null }));
  }

  const out: TierOutput[] = inputs.map(() => ({ tier: null, tierScore: null }));

  for (const i of idx) {
    const e = inputs[i]!;
    const pWin = percentile(winRates, e.winRate ?? e.top8Rate);
    const pTop8 = percentile(top8s, e.top8Rate);
    const pPop = percentile(pops, e.popularity);

    const score = useWin ? pWin * 0.55 + pTop8 * 0.2 + pPop * 0.25 : pWin * 0.6 + pPop * 0.4;

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
  opts: { minSample?: number; hasWinData?: boolean } = {}
): void {
  const minSample = opts.minSample ?? MIN_TIER_SAMPLE;

  const keys: string[] = [];
  const inputs: TierInput[] = [];
  for (const [hero, stat] of heroes) {
    if (stat.total < minSample) continue;
    keys.push(hero);
    inputs.push({
      winRate: stat.winRate,
      top8Rate: stat.top8Rate,
      popularity: stat.popularity
    });
  }

  const rated = rateTiers(inputs, opts);
  keys.forEach((hero, i) => {
    const r = rated[i];
    if (!r || !r.tier) return;
    const stat = heroes.get(hero);
    if (!stat) return;
    stat.tier = r.tier;
    stat.tierScore = r.tierScore;
  });
}
