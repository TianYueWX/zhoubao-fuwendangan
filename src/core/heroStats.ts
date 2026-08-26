/* ================================================================
 * src/core/heroStats.ts
 *
 * 英雄维度统计:出场率 / 真实胜率 / Top8 转化率 / 卡牌携带率 /
 * 周次趋势 / 城市分布
 * ============================================================== */

import type {
  CardCatalog,
  CardUsage,
  Deck,
  HeroStats
} from '@/types';
import { UNKNOWN_CITY } from '@/utils/cityRegex';
import type { WeekBucket } from '@/types';

export interface HeroStatsOptions {
  topThreshold: number;
}

/**
 * 阈值切分:
 *   - 当 threshold >= 8 时,视为绝对 Top N(精确名次)
 *   - 否则视为百分比,与 8 取 max,避免小样本时样本数为 0
 */
function pickTopCount(n: number, threshold: number): number {
  if (n === 0) return 0;
  if (threshold >= 8) {
    return Math.min(Math.floor(threshold), n);
  }
  return Math.min(n, Math.max(8, Math.ceil(n * threshold)));
}

interface UsageAgg {
  deckCount: number;
  totalCount: number;
  energySum: number;
}

/** Top 样本 → 卡牌携带率聚合(两个入口共用) */
function aggregateUsage(
  topDecks: readonly Deck[],
  catalog: CardCatalog,
  topCount: number
): CardUsage[] {
  const usage = new Map<string, UsageAgg>();
  for (const deck of topDecks) {
    for (const [id, count] of deck.cards) {
      let u = usage.get(id);
      if (!u) {
        u = { deckCount: 0, totalCount: 0, energySum: 0 };
        usage.set(id, u);
      }
      u.deckCount += 1;
      u.totalCount += count;
      const energy = catalog.cardEnergy.get(id) ?? 0;
      u.energySum += energy * count;
    }
  }

  const cards: CardUsage[] = [];
  for (const [id, u] of usage) {
    const rate = topCount > 0 ? (u.deckCount / topCount) * 100 : 0;
    const avg = u.deckCount > 0 ? u.totalCount / u.deckCount : 0;
    const energy = u.totalCount > 0 ? u.energySum / u.totalCount : 0;
    cards.push({
      id,
      name: catalog.cardDict.get(id) ?? id,
      series: id.split('-')[0] ?? '',
      rarity: catalog.cardRarity.get(id) ?? '未知',
      rate,
      avg,
      energy,
      colors: catalog.cardColors.get(id) ?? []
    });
  }
  cards.sort((a, b) => b.rate - a.rate || a.id.localeCompare(b.id));
  return cards;
}

/** 英雄全样本的加权胜率与平均胜场 */
function aggregateWins(heroDecks: readonly Deck[]): {
  winRate: number | null;
  avgWins: number | null;
} {
  let winsSum = 0;
  let roundsSum = 0;
  let winsDecks = 0;
  for (const d of heroDecks) {
    if (d.wins === null || d.eventRounds === null || d.eventRounds <= 0) continue;
    winsSum += d.wins;
    roundsSum += d.eventRounds;
    winsDecks += 1;
  }
  if (winsDecks === 0 || roundsSum === 0) return { winRate: null, avgWins: null };
  return {
    winRate: (winsSum / roundsSum) * 100,
    avgWins: winsSum / winsDecks
  };
}

export function computeHeroStats(
  allDecks: readonly Deck[],
  catalog: CardCatalog,
  weeks: readonly WeekBucket[],
  options: HeroStatsOptions = { topThreshold: 0.15 }
): Map<string, HeroStats> {
  // 1) 按英雄分组
  const byHero = new Map<string, Deck[]>();
  for (const d of allDecks) {
    const hero = d.hero || '未知';
    let arr = byHero.get(hero);
    if (!arr) {
      arr = [];
      byHero.set(hero, arr);
    }
    arr.push(d);
  }

  const totalDecks = allDecks.length;
  const result = new Map<string, HeroStats>();

  for (const [hero, heroDecks] of byHero) {
    // 2) 名次升序(Number.MAX_SAFE_INTEGER 永远在尾部)
    const sorted = heroDecks.slice().sort((a, b) => a.rank - b.rank);

    // 3) Top 阈值切分(阈值来自全局选项)
    const topCount = pickTopCount(sorted.length, options.topThreshold);
    const topDecks = sorted.slice(0, topCount);

    // 4) Top 卡组内的卡牌聚合
    const cards = aggregateUsage(topDecks, catalog, topCount);

    // 5) Top8 率统计(基于全样本)
    let top8 = 0;
    for (const d of heroDecks) {
      if (d.rank >= 1 && d.rank <= 8) top8++;
    }

    // 6) 周次聚合(zero-fill)
    const weekMap = new Map<string, number>();
    for (const w of weeks) weekMap.set(w.label, 0);
    for (const d of heroDecks) {
      weekMap.set(d.week.label, (weekMap.get(d.week.label) ?? 0) + 1);
    }

    // 7) 城市分布(排除 '未知')
    const cityMap = new Map<string, number>();
    for (const d of heroDecks) {
      if (d.city === UNKNOWN_CITY) continue;
      cityMap.set(d.city, (cityMap.get(d.city) ?? 0) + 1);
    }

    // 8) 真实胜率
    const { winRate, avgWins } = aggregateWins(heroDecks);

    result.set(hero, {
      total: heroDecks.length,
      topCount,
      topDecks,
      popularity: totalDecks > 0 ? (heroDecks.length / totalDecks) * 100 : 0,
      top8Rate: heroDecks.length > 0 ? (top8 / heroDecks.length) * 100 : 0,
      winRate,
      avgWins,
      tier: null,
      tierScore: null,
      cards,
      weeks: weekMap,
      cities: cityMap
    });
  }

  return result;
}

/* ============================================================
 * Hero × Top threshold 切分(独立函数,供阈值切换时轻量重算)
 * ============================================================== */

export function applyTopThreshold(
  heroes: ReadonlyMap<string, HeroStats>,
  catalog: CardCatalog,
  topThreshold: number
): Map<string, HeroStats> {
  const updated = new Map<string, HeroStats>();
  for (const [hero, stat] of heroes) {
    // topDecks 是按名次排序的前缀;要拿完整序列需要重新排序全样本。
    // 这里保存了全部样本吗?HeroStats 没有存全样本 —— 因此该函数
    // 只能基于"已知的 topDecks + 更大阈值不可行"的限制工作:
    // 实际上 runStoredAnalysis 在阈值变化时会整体重跑分析,此函数
    // 仅用于小工具场景,保持向下兼容。
    const sorted = stat.topDecks.slice().sort((a, b) => a.rank - b.rank);
    const topCount = pickTopCount(stat.total, topThreshold);
    const topDecks = sorted.slice(0, topCount);
    const cards = aggregateUsage(topDecks, catalog, topCount);
    updated.set(hero, { ...stat, topCount, topDecks, cards });
  }
  return updated;
}
