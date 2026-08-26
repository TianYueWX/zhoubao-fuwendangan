/* ================================================================
 * src/core/analyzer.ts
 *
 * 核心分析引擎 · 唯一入口 `runAnalysis(input)`
 *
 *   - 纯函数:无 DOM / 无 Vue 依赖
 *   - 内部串联 normalizeDecks → buildCardCatalog → computeHeroStats →
 *     computeRegionStats → computeCombos,产出 AnalysisResult
 *   - 范围(Scope)切换由 getDecksForScope + computeCombosForScope 工具函数承担
 *     保持主入口轻量,把"按英雄过滤"等动作留给 store/composable
 * ============================================================== */

import type {
  AnalysisOptions,
  AnalysisResult,
  CardCatalog,
  Deck,
  DeckCacheData,
  RankRow,
  RawCardBaseRow,
  RawCardPrintRow,
  RawDeckRow,
  ShopRow
} from '@/types';
import { DEFAULT_ANALYSIS_OPTIONS } from '@/types';
import {
  buildCardCatalog,
  dedupeSampleDecks,
  normalizeDecks
} from '@/utils/dataParser';
import { computeHeroStats } from './heroStats';
import { computeCombos } from './combo';
import { computeRegionStats } from './region';
import { attachWinData, buildEventList, buildShopIndex } from './join';
import { computeTiers } from './tier';
import { computeColorStats } from './colorStats';

/* ============================================================
 * 输入契约
 * ============================================================ */

export interface AnalyzeInput {
  deckRows: readonly RawDeckRow[];
  baseRows: readonly RawCardBaseRow[];
  printRows: readonly RawCardPrintRow[];
  options?: Partial<AnalysisOptions>;
  /** 来自 MappingPanel 的活动名 → 城市覆盖 */
  cityOverrides?: ReadonlyMap<string, string>;
  /** 增强数据源(可选) */
  rankRows?: readonly RankRow[];
  shopRows?: readonly ShopRow[];
  cacheData?: DeckCacheData;
}

/* ============================================================
 * Scope 描述(供 store 切换)
 * ============================================================ */

export type ScopeSelector =
  | { kind: 'allTop' } // 全部英雄高排名样本
  | { kind: 'allDecks' } // 全部参赛卡组
  | { kind: 'hero'; hero: string }; // 单个英雄的 Top 样本

/* ============================================================
 * 主入口
 * ============================================================ */

export function runAnalysis(input: AnalyzeInput): AnalysisResult {
  const opts: AnalysisOptions = {
    ...DEFAULT_ANALYSIS_OPTIONS,
    ...input.options
  };

  // 0) 增强数据源索引
  const joinShopIndex = buildShopIndex(input.shopRows);

  // 1) 数据归一化(列名识别 + 城市(shop 优先) + 周次聚类 + TTS_code 解析)
  const normalized = normalizeDecks(input.deckRows, {
    cityOverrides: input.cityOverrides ?? new Map<string, string>(),
    weekMode: opts.weekMode,
    rollingGapDays: opts.rollingGapDays,
    shopIndex: joinShopIndex
  });

  // 2) 真实胜场关联(rank_data)
  const winMatchedDecks = attachWinData(normalized.decks, input.rankRows);
  const hasWinData = winMatchedDecks > 0;

  // 3) 卡牌目录 cross-ref(含 cache 卡图补充)
  const catalog = buildCardCatalog(input.baseRows, input.printRows, input.cacheData);

  let imageCount = 0;
  for (const [id] of catalog.cardImg) {
    if (catalog.byId.has(id)) imageCount++;
  }

  // 4) 英雄统计(含真实胜率)+ Tier 分级
  const heroes = computeHeroStats(normalized.decks, catalog, normalized.weeks, {
    topThreshold: opts.topThreshold
  });
  computeTiers(heroes, { hasWinData });

  // 5) 收集所有英雄的 Top 卡组并去重
  const topDecksBag: Deck[] = [];
  for (const heroStat of heroes.values()) {
    topDecksBag.push(...heroStat.topDecks);
  }
  const uniqueSampleDecks = dedupeSampleDecks(topDecksBag);

  // 6) 全局卡牌携带统计(按规范键:同名+副标题归并)
  const globalTopCards = countCards(uniqueSampleDecks, catalog);
  const globalAllCards = countCards(normalized.decks, catalog);

  // 7) 地域统计
  const { regionStats, regionHeat, provinceStats } =
    computeRegionStats(normalized.decks);

  // 8) Combo(默认范围 = 全英雄高排名样本)
  const combos = computeCombos(uniqueSampleDecks, catalog, {
    minBase: opts.comboMinBase,
    minLift: opts.comboMinLift
  });

  // 9) 颜色域 / 域对统计
  const colorStats = computeColorStats(uniqueSampleDecks, catalog, normalized.weeks);

  // 10) 赛事元信息
  const events = buildEventList(normalized.decks, joinShopIndex, input.rankRows);

  return {
    totalDecks: normalized.decks.length,
    uniqueSampleDecks,
    sampleSize: uniqueSampleDecks.length,
    heroes,
    weeks: normalized.weeks,
    allDecks: normalized.decks,
    globalTopCards,
    globalAllCards,
    combos,
    regionStats,
    regionHeat,
    provinceStats,
    cityUnknown: normalized.cityUnknownActivities,
    catalog,
    rankColumn: normalized.columns.rankCol,
    provinceColumn: normalized.columns.provinceCol ?? '',
    cityUnknownActivityNames: normalized.cityUnknownActivities,
    events,
    hasWinData,
    winMatchedDecks,
    shopMatchedEvents: events.filter((e) => e.shopName).length,
    imageCount,
    colorStats
  };
}

/* ============================================================
 * Helper: 计数每张卡在卡组集合中的携带 deck 数(同时供外部使用)
 * 按规范键(同名+副标题)归并:同一张卡的多印刷版本计为一张。
 * 符文卡不在分析范围内(每套卡组按规则自动携带,携带率无信息量),
 * 直接剔除,与 combo/colorStats 口径对齐。
 * ============================================================ */

export function countCards(decks: readonly Deck[], catalog: CardCatalog): Map<string, number> {
  const m = new Map<string, number>();
  for (const deck of decks) {
    const seen = new Set<string>();
    for (const id of deck.cards.keys()) {
      if (catalog.cardCategory.get(id) === '符文') continue;
      const key = catalog.canonicalById.get(id) ?? id;
      if (seen.has(key)) continue;
      seen.add(key);
      m.set(key, (m.get(key) ?? 0) + 1);
    }
  }
  return m;
}

/* ============================================================
 * Scope 切换辅助(供 store 调用,避免在 Vue 层直接知悉 heroes/allDecks)
 * ============================================================ */

export function getDecksForScope(
  result: AnalysisResult,
  scope: ScopeSelector
): Deck[] {
  switch (scope.kind) {
    case 'allTop':
      return result.uniqueSampleDecks;
    case 'allDecks':
      return result.allDecks;
    case 'hero': {
      const stat = result.heroes.get(scope.hero);
      return stat ? stat.topDecks : [];
    }
  }
}

export function computeCombosForScope(
  result: AnalysisResult,
  scope: ScopeSelector,
  options?: Partial<{ minBase: number; minLift: number }>
) {
  const decks = getDecksForScope(result, scope);
  return computeCombos(decks, result.catalog, options);
}
