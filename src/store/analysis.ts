/* ================================================================
 * src/store/analysis.ts
 *
 * 全局响应式单例:
 *   - 6 个数据槽位(3 必需 CSV + 3 可选增强 JSON)
 *   - 全局范围:周次选择(数据包可含一周或多周,默认聚焦最新一周)
 *   - 英雄页下钻焦点 focusHero(仅英雄页消费)
 *   - 当前视图 + 分析结果
 * ============================================================== */

import { reactive } from 'vue';
import { runAnalysis } from '@/core';
import { compareWeekBucket } from '@/utils/isoWeek';
import type {
  AnalysisResult,
  DeckCacheData,
  RankRow,
  RawCardBaseRow,
  RawCardPrintRow,
  RawDeckRow,
  ShopRow,
  WeekBucket
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
  | 'legendary'
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
  { id: 'legendary', label: '传奇对比', emoji: '⚔️' },
  { id: 'region', label: '地域差异', emoji: '🗺️' },
  { id: 'decks', label: '卡组浏览器', emoji: '🃏' }
]);

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

  /* ── 全局范围:周次选择(数据包可含一周或多周) ── */
  /** 选中周次标签(Deck.week.label);'' = 全部周汇总。分析完成后默认聚焦最新一周 */
  filterWeek: '',
  /**
   * 英雄页下钻焦点:Overview Tier 行 / 散点点击后跳转英雄页时定位用,
   * 仅 HeroesView 消费,不过滤其他视图的数据集。
   */
  focusHero: '',

  /* ── Combo 参数(UI 实时调节) ── */
  comboMinBase: 0.15,
  comboMinLift: 1.2,

  result: null as AnalysisResult | null,
  isAnalyzing: false,
  analysisError: null as Error | null,

  /** 当前数据来源刊名(如预设包 '第四赛季 · 第三周'),报头刊号行使用 */
  sourceLabel: '',

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
  store.filterWeek = '';
  store.focusHero = '';
}

/* ============================================================
 * 周次选择辅助
 * ============================================================ */

/** 数据包内全部周次(按时间升序),供周次选择器使用 */
export function weekBuckets(): WeekBucket[] {
  const r = store.result;
  if (!r) return [];
  const seen = new Map<string, WeekBucket>();
  for (const d of r.allDecks) {
    if (d.week.label && !seen.has(d.week.label)) seen.set(d.week.label, d.week);
  }
  return [...seen.values()].sort(compareWeekBucket);
}

/** 最新一周的标签;无数据返回 '' */
export function latestWeekLabel(): string {
  const list = weekBuckets();
  return list.length ? (list[list.length - 1]!.label ?? '') : '';
}

/**
 * 应用全局范围(周次筛选)后的卡组集合。
 * '' = 全部周汇总;趋势对比页刻意绕过本函数,始终用全量数据跨周计算。
 */
export function applyGlobalFilters(decks: readonly NonNullable<AnalysisResult['allDecks']>[number][]): typeof decks {
  if (!store.filterWeek) return decks;
  return decks.filter((d) => d.week.label === store.filterWeek);
}

export function runStoredAnalysis(): boolean {
  if (!store.isReady) return false;
  const deckSlot = store.slots[0];
  const baseSlot = store.slots[1];
  const printSlot = store.slots[2];
  if (!deckSlot?.rows || !baseSlot?.rows || !printSlot?.rows) return false;

  store.isAnalyzing = true;
  store.analysisError = null;
  store.sourceLabel = '';

  try {
    store.result = runAnalysis({
      deckRows: deckSlot.rows as RawDeckRow[],
      baseRows: baseSlot.rows as RawCardBaseRow[],
      printRows: printSlot.rows as RawCardPrintRow[],
      cityOverrides: store.cityOverrides,
      rankRows: store.extras.rankRows ?? undefined,
      shopRows: store.extras.shopRows ?? undefined,
      cacheData: store.extras.cacheData ?? undefined
    });
    // 多周数据默认聚焦最新一周;单周数据等价于全部
    store.filterWeek = latestWeekLabel();
    store.focusHero = '';
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
