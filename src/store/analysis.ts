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
import { buildIssueBrief, type IssueBrief } from '@/core/issue';
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

/**
 * 视图标识(字符串形式的工具 code)。
 *
 * 工具的事实来源在 `src/tools/catalog.ts`(含分组/数据源/状态);
 * 这里只保存「当前在哪个工具」,由 router + catalog 校验合法性,
 * 因此新增工具无需改动本文件。
 *
 * 内容层特例:'issue'(期号正文)、'archive'(往期归档)不是工具,是期刊的次级路由。
 */
export type ViewName = string;

/** 数据工具 code(与 catalog 一致;此处仅作类型便利,不重复登记元数据) */
export type ToolName = string;

/* ══════════════════════════════════════════════════════════════
 * 数据包(多包并存)
 *
 * 每个包 = 一次完整上传 + 分析结果,自成一「期」。内容层(期刊首页/往期/期号)
 * 以包为单位展示;工具层操作 store.activePackageId 指向的活动包。
 * 兼容约定:store.result / store.slots / store.extras 始终镜像活动包,
 * 因此全部既有工具视图无需改动。
 * ══════════════════════════════════════════════════════════════ */

export interface PackageMeta {
  /** 赛事场次 */
  eventCount: number;
  /** 卡组样本数 */
  sampleCount: number;
  /** 日期区间 [最早, 最晚](ISO 日期串) */
  dateRange: [string, string] | null;
  /** 覆盖城市数 */
  cityCount: number;
  /** 内含周次数 */
  weekCount: number;
  /** 最新周标签(YYYY-Wnn),用于期刊排序 */
  latestWeek: string;
  /** 是否有真实胜场数据 */
  hasWinData: boolean;
}

export interface PackageRecord {
  id: string;
  /** 刊名(如「第四赛季 · 第三周」),用户可改 */
  label: string;
  /** 赛季标识(如 S4),未知为 '' */
  season: string;
  /** 来源:上传 / 内置预设 */
  source: 'upload' | 'preset';
  /** 载入时间戳 */
  loadedAt: number;
  meta: PackageMeta;
  /** 分析结果(引擎输出,可直接喂给全部 selector) */
  result: AnalysisResult;
  /** 该包的原始槽位(重新分析/城市映射修正用) */
  slots: SlotFile[];
  extras: ExtraState;
  cityOverrides: Map<string, string>;
}

let packageSeq = 0;
function nextPackageId(): string {
  packageSeq += 1;
  return `pkg-${Date.now().toString(36)}-${packageSeq}`;
}

export const store = reactive({
  /* ── 上传暂存区(draft):用户当前正在上传/待分析的槽位 ── */
  slots: [
    { rows: null, fileName: null, matched: false } as SlotFile,
    { rows: null, fileName: null, matched: false } as SlotFile,
    { rows: null, fileName: null, matched: false } as SlotFile
  ] as SlotFile[],

  extras: {
    rankRows: null,
    shopRows: null
  } as ExtraState,

  /** 暂存区刊名(留空则分析时按文件名/日期自动推断) */
  draftLabel: '',

  /** 暂存区是否处在"待分析"状态(用于区分「数据已改」与「已入档」) */
  draftDirty: false,

  /* ── 多数据包 ── */
  /** 已分析入档的数据包(按期号从旧到新),每个包即期刊的一期 */
  packages: [] as PackageRecord[],
  /** 活动包 id;'' = 无包 */
  activePackageId: '',

  /* ── 内置卡表预加载(随站点发布的静态数据,无需用户上传) ── */
  cardDataStatus: 'loading' as 'loading' | 'ok' | 'failed',
  cardBase: null as RawCardBaseRow[] | null,
  cardPrints: null as RawCardPrintRow[] | null,

  cityOverrides: new Map<string, string>(),

  /* ── 全局范围:周次选择(数据包可含一周或多周) ── */
  /** 选中周次标签(Deck.week.label);'' = 全部周汇总。切换活动包时默认聚焦该包最新一周 */
  filterWeek: '',
  /**
   * 英雄·传奇融合页下钻焦点:Overview Tier 行 / 散点 / 传奇榜点击后跳转时定位用,
   * 仅 HeroLegendView 消费,不过滤其他视图的数据集。
   */
  focusHero: '',

  /* ── Combo 参数(UI 实时调节) ── */
  comboMinBase: 0.15,
  comboMinLift: 1.2,

  /** 活动包的分析结果镜像(全部工具视图消费本字段) */
  result: null as AnalysisResult | null,
  isAnalyzing: false,
  analysisError: null as Error | null,

  /** 当前数据来源刊名(如 '第四赛季 · 第三周'),报头刊号行使用 */
  sourceLabel: '',

  currentView: 'home' as ViewName,

  /** 内容层当前期号(仅 currentView === 'issue' 时有意义) */
  currentIssueId: '',

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

  /** 活动数据包 */
  get activePackage(): PackageRecord | null {
    if (!this.activePackageId) return null;
    return this.packages.find((p) => p.id === this.activePackageId) ?? null;
  },

  get hasPackages(): boolean {
    return this.packages.length > 0;
  },

  /** 暂存区有待分析的新数据(且不是刚入档的同一批) */
  get draftPending(): boolean {
    return this.isReady && this.draftDirty;
  },

  get statusLabel(): string {
    if (this.analysisError) return '分析失败';
    if (this.isAnalyzing) return '分析中…';
    if (this.draftPending) return '待分析';
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
  },

  /* ── 期刊内容层:每包一份期号简报(纯派生,内容层视图共用) ── */
  get issueBriefs(): IssueBrief[] {
    return this.packages.map((p, i) => buildIssueBrief(p.id, p.label, p.result, i + 1));
  },

  /** 本期(最新一期) */
  get currentIssue(): IssueBrief | null {
    const list = this.issueBriefs;
    return list.length ? list[list.length - 1]! : null;
  },

  /** 往期(从新到旧) */
  get backIssues(): IssueBrief[] {
    return this.issueBriefs.slice(0, -1).reverse();
  },

  /** 按 id 取期号简报 */
  issueById(id: string): IssueBrief | null {
    return this.issueBriefs.find((b) => b.id === id) ?? null;
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
  store.draftDirty = true;
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

/** 清空上传暂存区(不影响已入档的数据包) */
export function clearSlots(): void {
  for (let i = 0; i < store.slots.length; i++) {
    store.slots[i] = { rows: null, fileName: null, matched: false };
  }
  store.cityOverrides.clear();
  store.extras = { rankRows: null, shopRows: null };
  store.draftLabel = '';
  store.draftDirty = false;
  store.analysisError = null;
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

  try {
    const result = runAnalysis({
      deckRows: deckSlot.rows as RawDeckRow[],
      baseRows: store.cardBase,
      printRows: store.cardPrints,
      cityOverrides: store.cityOverrides,
      rankRows: store.extras.rankRows ?? undefined,
      shopRows: store.extras.shopRows ?? undefined
    });
    addPackageFromDraft(result);
    return true;
  } catch (e: unknown) {
    store.analysisError = e instanceof Error ? e : new Error(String(e));
    console.error('[runStoredAnalysis] failed:', e);
    return false;
  } finally {
    store.isAnalyzing = false;
  }
}

/* ══════════════════════════════════════════════════════════════
 * 数据包操作
 * ══════════════════════════════════════════════════════════════ */

/** 从文件名或日期推断刊名:优先数据包名(去掉槽位后缀),否则用当前日期 */
export function inferPackLabel(fileName?: string | null): string {
  const base = (fileName ?? '')
    .replace(/\.(csv|json)$/i, '')
    .replace(/_(decks?|rank|shop)_data.*$/i, '')
    .replace(/(decks?|rank|shop)_data.*$/i, '')
    .replace(/[_-]+$/, '')
    .trim();
  if (base) return base;
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} 数据包`;
}

/** 从刊名里抠赛季标识:S4 / 第四赛季 / 赛季4 → 'S4';无则 '' */
export function inferSeason(label: string): string {
  const s = /S(\d+)/i.exec(label);
  if (s) return `S${s[1]}`;
  const cn = /第([一二三四五六七八九十]+)赛季/.exec(label);
  if (cn) return `第${cn[1]}赛季`;
  const num = /赛季\s*(\d+)/.exec(label);
  return num ? `S${num[1]}` : '';
}

/** 汇总一个包的元信息(日期区间/赛事数/城市数/周次数/最新周) */
export function summarizeResult(result: AnalysisResult): PackageMeta {
  /**
   * 日期以「卡组行日期」为准(与周次分组同源):赛事元数据可能滞后或缺失,
   * 而卡组日期恒存在,保证刊期区间与周次标签自洽。events 仅作兜底。
   */
  const deckDates = result.allDecks
    .map((d) => d.date)
    .filter((x): x is string => !!x)
    .sort();
  const eventDates = (result.events.map((e) => e.date).filter(Boolean) as string[]).sort();
  const dates = deckDates.length > 0 ? deckDates : eventDates;

  const weeks = new Map<string, WeekBucket>();
  for (const d of result.allDecks) {
    if (d.week.label && !weeks.has(d.week.label)) weeks.set(d.week.label, d.week);
  }
  const weekList = [...weeks.values()].sort(compareWeekBucket);
  return {
    eventCount: result.events.length,
    sampleCount: result.allDecks.length,
    dateRange:
      dates.length >= 2
        ? [dates[0]!, dates[dates.length - 1]!]
        : dates.length === 1
          ? [dates[0]!, dates[0]!]
          : null,
    cityCount: result.regionStats.size,
    weekCount: weekList.length,
    latestWeek: weekList.length ? (weekList[weekList.length - 1]!.label ?? '') : '',
    hasWinData: result.hasWinData
  };
}

/** 把当前暂存区分析结果入档为一个数据包,并设为活动包 */
function addPackageFromDraft(result: AnalysisResult): PackageRecord {
  const label = store.draftLabel.trim() || inferPackLabel(store.slots[0]?.fileName);
  const meta = summarizeResult(result);
  // 同一个包名再次分析 = 覆盖更新,避免重复归档
  const dup = store.packages.find((p) => p.label === label);
  if (dup) store.packages = store.packages.filter((p) => p.id !== dup.id);

  const pkg: PackageRecord = {
    id: nextPackageId(),
    label,
    season: inferSeason(label),
    source: 'upload',
    loadedAt: Date.now(),
    meta,
    result,
    slots: store.slots.map((s) => ({ ...s })),
    extras: { ...store.extras },
    cityOverrides: new Map(store.cityOverrides)
  };
  // 按期号(最新周)从旧到新排序,首页直接倒序取「本期」
  store.packages = [...store.packages, pkg].sort(comparePackages);
  store.draftDirty = false;
  selectPackage(pkg.id);
  return pkg;
}

/** 包排序:最新周升序(无周次的用载入时间兜底) */
export function comparePackages(a: PackageRecord, b: PackageRecord): number {
  const wa = a.meta.latestWeek;
  const wb = b.meta.latestWeek;
  if (wa && wb && wa !== wb) return wa < wb ? -1 : 1;
  const da = a.meta.dateRange?.[1] ?? '';
  const db = b.meta.dateRange?.[1] ?? '';
  if (da && db && da !== db) return da < db ? -1 : 1;
  return a.loadedAt - b.loadedAt;
}

/** 把活动包镜像回 store(工具视图全部读这些字段,因此零改动) */
function syncActive(): void {
  const p = store.activePackage;
  if (!p) {
    store.result = null;
    store.sourceLabel = '';
    store.filterWeek = '';
    return;
  }
  store.result = p.result;
  store.sourceLabel = p.label;
  store.cityOverrides = new Map(p.cityOverrides);
  // 默认聚焦该包最新一周(多周包);单周包等价于全部
  const weeks = new Map<string, WeekBucket>();
  for (const d of p.result.allDecks) if (d.week.label) weeks.set(d.week.label, d.week);
  const list = [...weeks.values()].sort(compareWeekBucket);
  store.filterWeek = list.length ? (list[list.length - 1]!.label ?? '') : '';
  store.focusHero = '';
}

/** 切换活动包 */
export function selectPackage(id: string): void {
  if (!store.packages.some((p) => p.id === id)) return;
  store.activePackageId = id;
  syncActive();
}

/** 移除数据包;若移除的是活动包,自动切到最新的一包 */
export function removePackage(id: string): void {
  store.packages = store.packages.filter((p) => p.id !== id);
  if (store.activePackageId === id) {
    const last = store.packages[store.packages.length - 1];
    store.activePackageId = last ? last.id : '';
    syncActive();
  }
}

/** 改刊名(期刊标题) */
export function renamePackage(id: string, label: string): void {
  const p = store.packages.find((x) => x.id === id);
  if (!p) return;
  p.label = label.trim() || p.label;
  p.season = inferSeason(p.label);
  if (store.activePackageId === id) store.sourceLabel = p.label;
}

/** 把某个已入档的包重新载入暂存区(用于改城市映射后重算) */
export function loadPackageToDraft(id: string): boolean {
  const p = store.packages.find((x) => x.id === id);
  if (!p) return false;
  store.slots = p.slots.map((s) => ({ ...s }));
  store.extras = { ...p.extras };
  store.cityOverrides = new Map(p.cityOverrides);
  store.draftLabel = p.label;
  store.draftDirty = false;
  syncExtras();
  return true;
}

/** 当前活动包内是否有多个周次(决定「往期」是否还有内容) */
export function activeWeekCount(): number {
  return store.activePackage?.meta.weekCount ?? 0;
}

export function setCityOverride(activity: string, city: string | null): void {
  if (city) store.cityOverrides.set(activity, city);
  else store.cityOverrides.delete(activity);
}
