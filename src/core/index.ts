/* ================================================================
 * src/core/index.ts
 * Barrel re-export for the core analysis layer.
 *
 * 让上层只需:
 *   import { runAnalysis, computeHeroStats, buildArchetypes } from '@/core';
 * ============================================================ */

export { runAnalysis, getDecksForScope, computeCombosForScope, countCards } from './analyzer';
export type { AnalyzeInput, ScopeSelector } from './analyzer';

export { computeCombos, pairKey, parseKey } from './combo';
export type { ComboOptions } from './combo';
export { DEFAULT_COMBO_OPTIONS } from './combo';

export { computeHeroStats, applyTopThreshold } from './heroStats';

export { buildArchetypes } from './archetype';
export type { ArchetypeOptions, ArchetypeResult, Archetype, ArchetypeCoreCard } from './archetype';
export { DEFAULT_ARCHETYPE_OPTIONS } from './archetype';

export { computeRegionStats } from './region';
export type { RegionStatsResult } from './region';

export { attachWinData, buildEventList, buildShopIndex } from './join';
export type { RankRow as JoinRankRow } from '@/types';

export { computeTiers, rateTiers, MIN_TIER_SAMPLE } from './tier';
export type { TierInput, TierOutput } from './tier';
export { computeColorStats } from './colorStats';
export { quickHeroRows } from './quickStats';
export type { QuickHeroRow } from './quickStats';
