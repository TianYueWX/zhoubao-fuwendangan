/* ================================================================
 * src/core/region.ts
 *
 * 地域维度统计:
 *   regionStats : city → hero → count
 *   regionHeat  : city → hero → { n, top8 }
 *   provinceStats: shopProvince → count
 *
 * 注:
 *   - city === '未知' 时仍计入 regionHeat(便于诊断),但不计入 regionStats
 *   - 热力图的过滤(>=5)是渲染层职责,本函数只产数据
 * ============================================================== */

import type {
  Deck,
  RegionHeatMap,
  RegionHeatCell,
  RegionStatsMap
} from '@/types';
import { UNKNOWN_CITY } from '@/utils/cityRegex';

export interface RegionStatsResult {
  regionStats: RegionStatsMap;
  regionHeat: RegionHeatMap;
  provinceStats: Map<string, number>;
}

export function computeRegionStats(decks: readonly Deck[]): RegionStatsResult {
  const regionStats: RegionStatsMap = new Map();
  const regionHeat: RegionHeatMap = new Map();
  const provinceStats = new Map<string, number>();

  for (const deck of decks) {
    const city = deck.city || UNKNOWN_CITY;
    const hero = deck.hero || '未知';

    // Stats(只统计已知城市)
    if (city !== UNKNOWN_CITY) {
      let heroMap = regionStats.get(city);
      if (!heroMap) {
        heroMap = new Map<string, number>();
        regionStats.set(city, heroMap);
      }
      heroMap.set(hero, (heroMap.get(hero) ?? 0) + 1);
    }

    // Heat
    let heatHeroMap = regionHeat.get(city);
    if (!heatHeroMap) {
      heatHeroMap = new Map<string, RegionHeatCell>();
      regionHeat.set(city, heatHeroMap);
    }
    let cell = heatHeroMap.get(hero);
    if (!cell) {
      cell = { n: 0, top8: 0, winsSum: null, roundsSum: null };
      heatHeroMap.set(hero, cell);
    }
    cell.n += 1;
    if (deck.rank >= 1 && deck.rank <= 8) cell.top8 += 1;
    if (deck.wins !== null && deck.eventRounds !== null && deck.eventRounds > 0) {
      cell.winsSum = (cell.winsSum ?? 0) + deck.wins;
      cell.roundsSum = (cell.roundsSum ?? 0) + deck.eventRounds;
    }

    // Province
    if (deck.province) {
      provinceStats.set(deck.province, (provinceStats.get(deck.province) ?? 0) + 1);
    }
  }

  return { regionStats, regionHeat, provinceStats };
}
