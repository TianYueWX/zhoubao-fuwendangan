/* ================================================================
 * src/core/quickStats.ts
 *
 * 轻量实时聚合:在全局过滤器生效时,视图层基于过滤后的卡组
 * 即时计算英雄指标(无需重跑完整分析管线)。
 * ============================================================== */

import type { Deck, TierRating } from '@/types';
import { rateTiers, MIN_TIER_SAMPLE } from './tier';

export interface QuickHeroRow {
  hero: string;
  total: number;
  /** Top8 率(%) */
  top8Rate: number;
  /** 出场率(%)= total / grandTotal */
  popularity: number;
  /** 加权真实胜率(%),无数据为 null */
  winRate: number | null;
  /** 平均胜场 */
  avgWins: number | null;
  tier: TierRating | null;
  tierScore: number | null;
}

export function quickHeroRows(
  decks: readonly Deck[],
  grandTotal: number,
  hasWinData: boolean,
  minSample = MIN_TIER_SAMPLE
): QuickHeroRow[] {
  const byHero = new Map<
    string,
    { total: number; top8: number; winsSum: number; roundsSum: number; winDecks: number }
  >();

  for (const d of decks) {
    const hero = d.hero || '未知';
    let agg = byHero.get(hero);
    if (!agg) {
      agg = { total: 0, top8: 0, winsSum: 0, roundsSum: 0, winDecks: 0 };
      byHero.set(hero, agg);
    }
    agg.total += 1;
    if (d.rank >= 1 && d.rank <= 8) agg.top8 += 1;
    if (d.wins !== null && d.eventRounds !== null && d.eventRounds > 0) {
      agg.winsSum += d.wins;
      agg.roundsSum += d.eventRounds;
      agg.winDecks += 1;
    }
  }

  const rows: QuickHeroRow[] = Array.from(byHero.entries()).map(([hero, a]) => ({
    hero,
    total: a.total,
    top8Rate: a.total > 0 ? (a.top8 / a.total) * 100 : 0,
    popularity: grandTotal > 0 ? (a.total / grandTotal) * 100 : 0,
    winRate:
      a.winDecks > 0 && a.roundsSum > 0 ? (a.winsSum / a.roundsSum) * 100 : null,
    avgWins: a.winDecks > 0 ? a.winsSum / a.winDecks : null,
    tier: null,
    tierScore: null
  }));

  const rated = rateTiers(
    rows.map((r) => ({
      winRate: r.winRate,
      top8Rate: r.top8Rate,
      popularity: r.popularity
    })),
    { hasWinData }
  );

  rows.forEach((r, i) => {
    if (r.total < minSample) return;
    const t = rated[i];
    if (t) {
      r.tier = t.tier;
      r.tierScore = t.tierScore;
    }
  });

  rows.sort((a, b) => b.popularity - a.popularity);
  return rows;
}
