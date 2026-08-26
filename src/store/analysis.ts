/* ================================================================
 * src/store/analysis.ts
 *
 * 全局响应式单例:
 *   - 6 个数据槽位(3 必需 CSV + 3 可选增强 JSON)
 *   - 全局过滤器(Top 阈值 / 日期范围 / 英雄 / 城市 / Combo 参数)
 *   - 当前视图 + 分析结果
 * ============================================================== */

import { reactive } from 'vue';
import { runAnalysis } from '@/core';
import type {
  AnalysisResult,
  DeckCacheData,
  RankRow,
  RawCardBaseRow,
  RawCardPrintRow,
  RawDeckRow,
  ShopRow
} from '@/types';

export interface SlotFile {
  /** CSV 行 / JSON 数组(rank、shop)/ JSON 对象(cache),按槽位而不同 */
  rows: RawRow[] | RankRow[] | ShopRow[] | DeckCacheData | null;
  fileName: string | null;
  matched: boolean;
}

interface RawRow {
  [key: string]: string | null | undefined;
}

export type { RawRow };

/** cache 槽位单独存放(非数组) */
export interface ExtraState {
  rankRows: RankRow[] | null;
  shopRows: ShopRow[] | null;
  cacheData: DeckCacheData | null;
}

export const SLOT_KINDS = ['deck', 'base', 'prints', 'rank', 'shop', 'cache'] as const;
export type SlotKindId = (typeof SLOT_KINDS)[number];

export const SLOT_META: ReadonlyArray<{
  id: SlotKindId;
  label: string;
  emoji: string;
  hint: string;
  required: boolean;
}> = Object.freeze([
  { id: 'deck', label: '赛事卡组', emoji: '📊', hint: '*decks_data*.csv', required: true },
  { id: 'base', label: '卡牌基础', emoji: '🃏', hint: 'cards_base*.csv', required: true },
  { id: 'prints', label: '卡牌印刷', emoji: '🖨️', hint: 'card_prints*.csv', required: true },
  { id: 'rank', label: '名次胜场', emoji: '🏅', hint: '*rank_data*.json', required: false },
  { id: 'shop', label: '赛事门店', emoji: '🏪', hint: '*shop_data*.json', required: false },
  { id: 'cache', label: '卡组缓存', emoji: '🖼️', hint: '*decks_cache*.json', required: false }
]);

export type ViewName =
  | 'import'
  | 'overview'
  | 'heroes'
  | 'cards'
  | 'combo'
  | 'region'
  | 'decks';

export interface ViewMeta {
  id: ViewName;
  label: string;
  emoji: string;
}

export const views: ReadonlyArray<ViewMeta> = Object.freeze([
  { id: 'import', label: '数据导入', emoji: '📥' },
  { id: 'overview', label: 'Meta 总览', emoji: '📊' },
  { id: 'heroes', label: '英雄拆解', emoji: '🏆' },
  { id: 'cards', label: '单卡分析', emoji: '🌟' },
  { id: 'combo', label: 'Combo 羁绊', emoji: '🔗' },
  { id: 'region', label: '地域差异', emoji: '🗺️' },
  { id: 'decks', label: '卡组浏览器', emoji: '🃏' }
]);

export interface TopPercentOption {
  value: number;
  label: string;
}

export const store = reactive({
  slots: [
    { rows: null, fileName: null, matched: false } as SlotFile,
    { rows: null, fileName: null, matched: false } as SlotFile,
    { rows: null, fileName: null, matched: false } as SlotFile,
    { rows: null, fileName: null, matched: false } as SlotFile,
    { rows: null, fileName: null, matched: false } as SlotFile,
    { rows: null, fileName: null, matched: false } as SlotFile
  ] as SlotFile[],

  extras: {
    rankRows: null,
    shopRows: null,
    cacheData: null
  } as ExtraState,

  cityOverrides: new Map<string, string>(),

  /* ── 全局过滤器 ── */
  topPercent: 0.15,
  topPercentOptions: [
    { value: 0.10, label: 'Top 10%' },
    { value: 0.15, label: 'Top 15%' },
    { value: 0.20, label: 'Top 20%' },
    { value: 8, label: 'Top 8' }
  ] as TopPercentOption[],
  /** '' 表示不过滤 */
  filterHero: '',
  filterCity: '',
  /** YYYY-MM-DD,'' 表示不限 */
  filterDateFrom: '',
  filterDateTo: '',

  /* ── Combo 参数(UI 实时调节) ── */
  comboMinBase: 0.15,
  comboMinLift: 1.2,

  result: null as AnalysisResult | null,
  isAnalyzing: false,
  analysisError: null as Error | null,

  currentView: 'import' as ViewName,

  get isReady(): boolean {
    return this.slots.slice(0, 3).every((s) => s.rows !== null && (s.rows as RawRow[]).length > 0);
  },

  get hasEnhanced(): boolean {
    return !!(this.extras.rankRows || this.extras.shopRows || this.extras.cacheData);
  },

  /** 当前分析结果是否带真实胜场数据 */
  get hasWinData(): boolean {
    return this.result?.hasWinData ?? false;
  },

  get statusLabel(): string {
    if (this.analysisError) return '❌ 分析失败';
    if (this.isAnalyzing) return '⏳ 分析中…';
    if (this.result) return '✅ 已就绪';
    if (this.isReady) return '🚀 数据就绪';
    return '⏳ 等待数据';
  },

  get statusTone(): 'idle' | 'ready' | 'busy' | 'error' {
    if (this.analysisError) return 'error';
    if (this.isAnalyzing) return 'busy';
    if (this.result) return 'ready';
    if (this.isReady) return 'ready';
    return 'idle';
  }
});

/* ============================================================
 * Actions
 * ============================================================ */

export function loadSlotFile(
  slotIndex: number,
  rows: SlotFile['rows'],
  fileName: string,
  matched: boolean
): void {
  store.slots[slotIndex] = { rows, fileName, matched };
  syncExtras();
}

function syncExtras(): void {
  const rankSlot = store.slots[3];
  const shopSlot = store.slots[4];
  const cacheSlot = store.slots[5];
  store.extras.rankRows =
    rankSlot && Array.isArray(rankSlot.rows) ? (rankSlot.rows as RankRow[]) : null;
  store.extras.shopRows =
    shopSlot && Array.isArray(shopSlot.rows) ? (shopSlot.rows as ShopRow[]) : null;
  store.extras.cacheData =
    cacheSlot &&
    cacheSlot.rows &&
    typeof cacheSlot.rows === 'object' &&
    !Array.isArray(cacheSlot.rows)
      ? (cacheSlot.rows as DeckCacheData)
      : null;
}

export function clearSlots(): void {
  for (let i = 0; i < store.slots.length; i++) {
    store.slots[i] = { rows: null, fileName: null, matched: false };
  }
  store.cityOverrides.clear();
  store.extras = { rankRows: null, shopRows: null, cacheData: null };
  store.result = null;
}

export function resetFilters(): void {
  store.filterHero = '';
  store.filterCity = '';
  store.filterDateFrom = '';
  store.filterDateTo = '';
}

/**
 * 应用全局过滤器后的卡组集合。
 */
export function applyGlobalFilters(decks: readonly NonNullable<AnalysisResult['allDecks']>[number][]): typeof decks {
  let out = decks;
  if (store.filterHero) {
    out = out.filter((d) => d.hero === store.filterHero);
  }
  if (store.filterCity) {
    out = out.filter((d) => d.city === store.filterCity);
  }
  if (store.filterDateFrom) {
    out = out.filter((d) => !d.date || d.date >= store.filterDateFrom);
  }
  if (store.filterDateTo) {
    out = out.filter((d) => !d.date || d.date <= store.filterDateTo);
  }
  return out;
}

export function runStoredAnalysis(): boolean {
  if (!store.isReady) return false;
  const deckSlot = store.slots[0];
  const baseSlot = store.slots[1];
  const printSlot = store.slots[2];
  if (!deckSlot?.rows || !baseSlot?.rows || !printSlot?.rows) return false;

  store.isAnalyzing = true;
  store.analysisError = null;

  try {
    store.result = runAnalysis({
      deckRows: deckSlot.rows as RawDeckRow[],
      baseRows: baseSlot.rows as RawCardBaseRow[],
      printRows: printSlot.rows as RawCardPrintRow[],
      cityOverrides: store.cityOverrides,
      options: { topThreshold: store.topPercent },
      rankRows: store.extras.rankRows ?? undefined,
      shopRows: store.extras.shopRows ?? undefined,
      cacheData: store.extras.cacheData ?? undefined
    });
    return true;
  } catch (e: unknown) {
    store.analysisError = e instanceof Error ? e : new Error(String(e));
    console.error('[runStoredAnalysis] failed:', e);
    return false;
  } finally {
    store.isAnalyzing = false;
  }
}

export function setCityOverride(activity: string, city: string | null): void {
  if (city) store.cityOverrides.set(activity, city);
  else store.cityOverrides.delete(activity);
}
