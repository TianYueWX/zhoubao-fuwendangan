/* ================================================================
 * src/core/quickStats.ts
 *
 * 轻量实时聚合:在全局过滤器生效时,视图层基于过滤后的卡组
 * 即时计算英雄指标(无需重跑完整分析管线)。
 * 强度口径:名次转化(Top8 / Top4 / 冠军 / 亚军),不再使用胜率。
 * ============================================================== */

import type { Deck, TierRating } from '@/types';
import { rateTiers, MIN_TIER_SAMPLE } from './tier';
import { convertScore, wilsonLowerBoundPct } from './stats';

export interface QuickHeroRow {
  hero: string;
  total: number;
  /** Top8 次数 */
  top8: number;
  /** Top8 率(%) */
  top8Rate: number;
  /** Top4 次数(rank ≤ 4) */
  top4: number;
  /** Top4 率(%) */
  top4Rate: number;
  /** 夺冠次数(rank = 1) */
  champions: number;
  /** 冠军率(%) */
  championRate: number;
  /** 亚军次数(rank = 2) */
  runnersUp: number;
  /** 亚军率(%) */
  runnerUpRate: number;
  /** 转化综合分(%) = Top8率×0.35 + Top4率×0.35 + 冠军率×0.2 + 亚军率×0.1 */
  convert: number;
  /** 出场率(%)= total / grandTotal */
  popularity: number;
  /** 威尔逊下界(出场率的 95% 置信下界,%),热度榜排序用;无样本为 null */
  wilson: number | null;
  tier: TierRating | null;
  tierScore: number | null;
}

export function quickHeroRows(
  decks: readonly Deck[],
  grandTotal: number
): QuickHeroRow[] {
  const byHero = new Map<
    string,
    { total: number; top8: number; top4: number; champions: number; runnersUp: number }
  >();

  for (const d of decks) {
    const hero = d.hero || '未知';
    let agg = byHero.get(hero);
    if (!agg) {
      agg = { total: 0, top8: 0, top4: 0, champions: 0, runnersUp: 0 };
      byHero.set(hero, agg);
    }
    agg.total += 1;
    if (d.rank >= 1 && d.rank <= 8) agg.top8 += 1;
    if (d.rank >= 1 && d.rank <= 4) agg.top4 += 1;
    if (d.rank === 1) agg.champions += 1;
    if (d.rank === 2) agg.runnersUp += 1;
  }

  const rows: QuickHeroRow[] = Array.from(byHero.entries()).map(([hero, a]) => {
    const top8Rate = a.total > 0 ? (a.top8 / a.total) * 100 : 0;
    const top4Rate = a.total > 0 ? (a.top4 / a.total) * 100 : 0;
    const championRate = a.total > 0 ? (a.champions / a.total) * 100 : 0;
    const runnerUpRate = a.total > 0 ? (a.runnersUp / a.total) * 100 : 0;
    return {
      hero,
      total: a.total,
      top8: a.top8,
      top8Rate,
      top4: a.top4,
      top4Rate,
      champions: a.champions,
      championRate,
      runnersUp: a.runnersUp,
      runnerUpRate,
      convert: convertScore(top8Rate, top4Rate, championRate, runnerUpRate),
      popularity: grandTotal > 0 ? (a.total / grandTotal) * 100 : 0,
      wilson: grandTotal > 0 && a.total > 0 ? wilsonLowerBoundPct(a.total, grandTotal) : null,
      tier: null,
      tierScore: null
    };
  });

  const rated = rateTiers(
    rows.map((r) => ({
      top8Rate: r.top8Rate,
      top4Rate: r.top4Rate,
      championRate: r.championRate,
      runnerUpRate: r.runnerUpRate,
      popularity: r.popularity
    }))
  );

  const minSample = MIN_TIER_SAMPLE;
  rows.forEach((r, i) => {
    if (r.total < minSample) return;
    const t = rated[i];
    if (t) {
      r.tier = t.tier;
      r.tierScore = t.tierScore;
    }
  });

  // 热度榜排序:威尔逊下界优先(低样本自动下沉),出场率与数量兜底
  rows.sort(
    (a, b) =>
      (b.wilson ?? b.popularity) - (a.wilson ?? a.popularity) ||
      b.popularity - a.popularity ||
      b.total - a.total
  );
  return rows;
}
