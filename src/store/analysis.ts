/* ================================================================
 * src/store/analysis.ts
 *
 * 全局响应式单例:
 *   - 3 个上传槽位(1 必需 CSV + 2 可选增强 JSON)
 *   - 内置卡表预加载:cards_base × card_prints 随站点发布(data/ 顶层),
 *     启动时自动 fetch;失败可手动上传兜底
 *   - 全局范围:周次选择(数据包可含一周或多周,默认聚焦最新一周)
 *   - 英雄页下钻焦点 focusHero(仅英雄页消费)
 *   - 当前视图 + 分析结果
 * ============================================================== */

import { reactive } from 'vue';
import { runAnalysis } from '@/core';
import { compareWeekBucket } from '@/utils/isoWeek';
import { parseCSVText } from '@/utils/dataParser';
import type {
  AnalysisResult,
  RankRow,
  RawCardBaseRow,
  RawCardPrintRow,
  RawDeckRow,
  ShopRow,
  WeekBucket
} from '@/types';

export interface SlotFile {
  /** CSV 行 / JSON 数组(rank、shop),按槽位而不同 */
  rows: RawRow[] | RankRow[] | ShopRow[] | null;
  fileName: string | null;
  matched: boolean;
}

interface RawRow {
  [key: string]: string | null | undefined;
}

export type { RawRow };

/** 可选增强槽位单独存放 */
export interface ExtraState {
  rankRows: RankRow[] | null;
  shopRows: ShopRow[] | null;
}

export const SLOT_KINDS = ['deck', 'rank', 'shop'] as const;
export type SlotKindId = (typeof SLOT_KINDS)[number];

export const SLOT_META: ReadonlyArray<{
  id: SlotKindId;
  label: string;
  hint: string;
  required: boolean;
}> = Object.freeze([
  { id: 'deck', label: '赛事卡组', hint: '*decks_data*.csv', required: true },
  { id: 'rank', label: '名次胜场', hint: '*rank_data*.json', required: false },
  { id: 'shop', label: '赛事门店', hint: '*shop_data*.json', required: false }
]);

export type ViewName =
  | 'import'
  | 'overview'
  | 'heroes'
  | 'cards'
  | 'legendary'
  | 'region'
  | 'decks';

export interface ViewMeta {
  id: ViewName;
  label: string;
}

export const views: ReadonlyArray<ViewMeta> = Object.freeze([
  { id: 'import', label: '数据导入' },
  { id: 'overview', label: 'Meta 总览' },
  { id: 'cards', label: '单卡分析' },
  { id: 'legendary', label: '传奇构筑' },
  { id: 'region', label: '地域差异' },
  { id: 'decks', label: '卡组浏览器' }
]);

export const store = reactive({
  slots: [
    { rows: null, fileName: null, matched: false } as SlotFile,
    { rows: null, fileName: null, matched: false } as SlotFile,
    { rows: null, fileName: null, matched: false } as SlotFile
  ] as SlotFile[],

  extras: {
    rankRows: null,
    shopRows: null
  } as ExtraState,

  /* ── 内置卡表预加载(随站点发布的静态数据,无需用户上传) ── */
  cardDataStatus: 'loading' as 'loading' | 'ok' | 'failed',
  cardBase: null as RawCardBaseRow[] | null,
  cardPrints: null as RawCardPrintRow[] | null,

  cityOverrides: new Map<string, string>(),

  /* ── 全局范围:周次选择(数据包可含一周或多周) ── */
  /** 选中周次标签(Deck.week.label);'' = 全部周汇总。分析完成后默认聚焦最新一周 */
  filterWeek: '',
  /**
   * 英雄·传奇融合页下钻焦点:Overview Tier 行 / 散点 / 传奇榜点击后跳转时定位用,
   * 仅 HeroLegendView 消费,不过滤其他视图的数据集。
   */
  focusHero: '',

  /* ── Combo 参数(UI 实时调节) ── */
  comboMinBase: 0.15,
  comboMinLift: 1.2,

  result: null as AnalysisResult | null,
  isAnalyzing: false,
  analysisError: null as Error | null,

  /** 当前数据来源刊名(如 '第四赛季 · 第三周'),报头刊号行使用 */
  sourceLabel: '',

  currentView: 'import' as ViewName,

  get isReady(): boolean {
    const deckReady =
      !!this.slots[0]?.rows && (this.slots[0].rows as RawRow[]).length > 0;
    return deckReady && this.cardBase !== null && this.cardPrints !== null;
  },

  get hasEnhanced(): boolean {
    return !!(this.extras.rankRows || this.extras.shopRows);
  },

  /** 当前分析结果是否带真实胜场数据 */
  get hasWinData(): boolean {
    return this.result?.hasWinData ?? false;
  },

  get statusLabel(): string {
    if (this.analysisError) return '分析失败';
    if (this.isAnalyzing) return '分析中…';
    if (this.result) return '已就绪';
    if (this.isReady) return '数据就绪';
    return '等待数据';
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
  const rankSlot = store.slots[1];
  const shopSlot = store.slots[2];
  store.extras.rankRows =
    rankSlot && Array.isArray(rankSlot.rows) ? (rankSlot.rows as RankRow[]) : null;
  store.extras.shopRows =
    shopSlot && Array.isArray(shopSlot.rows) ? (shopSlot.rows as ShopRow[]) : null;
}

export function clearSlots(): void {
  for (let i = 0; i < store.slots.length; i++) {
    store.slots[i] = { rows: null, fileName: null, matched: false };
  }
  store.cityOverrides.clear();
  store.extras = { rankRows: null, shopRows: null };
  store.result = null;
  store.filterWeek = '';
  store.focusHero = '';
}

/* ============================================================
 * 内置卡表预加载(cards_base × card_prints,随站点发布)
 * ============================================================ */

const CARD_BASE_URL = `${import.meta.env.BASE_URL}data/cards_base_rows.csv`;
const CARD_PRINTS_URL = `${import.meta.env.BASE_URL}data/card_prints_rows.csv`;

/** 启动时预加载静态卡表;失败时 status 置 'failed',由导入页提供手动上传兜底 */
export async function loadCardData(): Promise<boolean> {
  store.cardDataStatus = 'loading';
  try {
    const [baseRes, printsRes] = await Promise.all([
      fetch(CARD_BASE_URL),
      fetch(CARD_PRINTS_URL)
    ]);
    if (!baseRes.ok || !printsRes.ok) {
      throw new Error(`HTTP ${baseRes.status}/${printsRes.status}`);
    }
    const [baseText, printsText] = await Promise.all([baseRes.text(), printsRes.text()]);
    store.cardBase = parseCSVText<RawCardBaseRow>(baseText);
    store.cardPrints = parseCSVText<RawCardPrintRow>(printsText);
    store.cardDataStatus = 'ok';
    return true;
  } catch (e) {
    store.cardDataStatus = 'failed';
    // eslint-disable-next-line no-console
    console.warn('[loadCardData] 内置卡表加载失败(可手动上传兜底):', e);
    return false;
  }
}

/** 手动兜底:预加载失败时由用户上传 base/prints CSV 写入 */
export function setCardData(
  kind: 'base' | 'prints',
  rows: RawCardBaseRow[] | RawCardPrintRow[]
): void {
  if (kind === 'base') store.cardBase = rows as RawCardBaseRow[];
  else store.cardPrints = rows as RawCardPrintRow[];
  if (store.cardBase && store.cardPrints) store.cardDataStatus = 'ok';
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
  if (!deckSlot?.rows || !store.cardBase || !store.cardPrints) return false;

  store.isAnalyzing = true;
  store.analysisError = null;
  store.sourceLabel = '';

  try {
    store.result = runAnalysis({
      deckRows: deckSlot.rows as RawDeckRow[],
      baseRows: store.cardBase,
      printRows: store.cardPrints,
      cityOverrides: store.cityOverrides,
      rankRows: store.extras.rankRows ?? undefined,
      shopRows: store.extras.shopRows ?? undefined
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
