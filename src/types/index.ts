/* ================================================================
 * src/types/index.ts
 *
 * 符文战场 Meta 分析系统 · 全局业务类型定义
 *
 * 设计原则:
 *  - 所有 CSV 输入都先解析为带 readonly 字段的 POJO,再交给纯函数核心层
 *  - 不在类型层暴露任何 DOM / Vue 依赖
 *  - 使用 ReadonlyMap / ReadonlyArray / readonly 限制不可变性
 *  - 与 strict + noUncheckedIndexedAccess 选项兼容
 * ============================================================== */

/* ──────────────────────────────────────────────────────────────
 * 主题
 * ──────────────────────────────────────────────────────────── */

export type Theme = 'light' | 'dark' | 'system';
export type EffectiveTheme = 'light' | 'dark';

/* ──────────────────────────────────────────────────────────────
 * 主题颜色 token(从 src/style.css 中导出,运行时读 CSS 变量)
 * ──────────────────────────────────────────────────────────── */

export interface ChartThemeColors {
  textColor: string;
  subTextColor: string;
  bgColor: string;
  axisLineColor: string;
  splitLineColor: string;
  tooltipBg: string;
  tooltipBorder: string;
  /** ECharts series 配色板 */
  palette: readonly string[];
  /** 卡牌类型配色 */
  categoryPalette: Readonly<Record<CardCategory, string>>;
}

/* ──────────────────────────────────────────────────────────────
 * CSV 原始行类型 (PapaParse header 模式,所有字段为 string | null)
 * ──────────────────────────────────────────────────────────── */

export type RawRow = Readonly<Record<string, string | null | undefined>>;

export type RawDeckRow = RawRow;
export type RawCardBaseRow = RawRow;
export type RawCardPrintRow = RawRow;

/* ──────────────────────────────────────────────────────────────
 * 卡牌业务模型
 * ──────────────────────────────────────────────────────────── */

export type CardCategory =
  | '传奇'
  | '英雄单位'
  | '单位'
  | '法术'
  | '装备'
  | '符文'
  | '战场'
  | '其他';

/**
 * 卡牌颜色域(Riftbound Domain)。
 * 官方六色:Fury 狂怒 / Calm 平静 / Mind 心灵 / Body 躯体 / Chaos 混沌 / Order 秩序。
 * 数据源中为英文小写(colorless 为无色)。
 */
export type CardColor = 'red' | 'green' | 'blue' | 'yellow' | 'purple' | 'orange' | 'colorless';

/** 颜色 → 中文名 */
export const CARD_COLOR_LABELS: Readonly<Record<CardColor, string>> = Object.freeze({
  red: '狂怒',
  green: '平静',
  blue: '心灵',
  yellow: '躯体',
  purple: '混沌',
  orange: '秩序',
  colorless: '无色'
});

/** 传奇卡定义的双色域(域对),如 ['red','blue'] = 狂怒·心灵 */
export type DomainPair = readonly [CardColor, CardColor] | readonly [CardColor];

export interface CardMeta {
  /** 卡牌编号,如 'OGN-308' */
  id: string;
  /** 中文名 */
  name: string;
  /** 系列(OGN / VEN / ...) */
  series: string;
  /** 稀有度 */
  rarity: string;
  /** 法力费用 */
  energy: number;
  /** 归一化后的类型(保留 传奇 / 英雄单位 细分) */
  category: CardCategory;
  /** 原始 card_category JSON 字符串(用于诊断) */
  rawCategory: string;
  /** 颜色域(0-2 个) */
  colors: readonly CardColor[];
  /** 地域(LoL 地区,如 艾欧尼亚),可空 */
  region: string;
  /** 战力 */
  power: number;
  /** 英雄标签(champion_tag,如 安妮),空串表示非英雄关联卡 */
  championTag: string;
  /** 是否官方禁卡 */
  isBanned: boolean;
}

/**
 * 卡牌目录视图:把 CardBase × CardPrint 关联后产出的多键索引,
 * 供分析层按"编号"高效查找。
 */
export interface CardCatalog {
  /** 编号 → CardMeta */
  byId: ReadonlyMap<string, CardMeta>;
  /** 编号 → 中文名(兼容旧版直接 Map 引用) */
  cardDict: ReadonlyMap<string, string>;
  /** 编号 → 费用 */
  cardEnergy: ReadonlyMap<string, number>;
  /** 编号 → 稀有度 */
  cardRarity: ReadonlyMap<string, string>;
  /** 编号 → 归一化类型 */
  cardCategory: ReadonlyMap<string, CardCategory>;
  /** 编号 → 颜色域 */
  cardColors: ReadonlyMap<string, readonly CardColor[]>;
  /** 编号 → 卡图 CDN URL(来自 prints 或 decks_cache,可能不全) */
  cardImg: ReadonlyMap<string, string>;
}

/* ──────────────────────────────────────────────────────────────
 * 周次模型(ISO 8601 Week of Year 或 rolling window)
 * ──────────────────────────────────────────────────────────── */

export interface WeekBucket {
  /** ISO 4 位年;rolling 模式下为 0 表示"无固定年" */
  year: number;
  /** 周数;1-53(ISO)或 1..N(rolling) */
  week: number;
  /** 'YYYY-Wnn' 或 '第N周' */
  label: string;
}

/* ──────────────────────────────────────────────────────────────
 * 增强数据源原始行(rank_data.json / shop_data.json / decks_cache.json)
 * ──────────────────────────────────────────────────────────── */

/** rank_data.json 单行:真实胜场数据 */
export interface RankRow {
  activityShopId?: number | null;
  activityName?: string | null;
  playerName?: string | null;
  finalRanking?: number | null;
  /** 瑞士轮胜场数 */
  winCount?: number | null;
  /** 卡组 ID,关联 decks_cache.json 的 key */
  cardGroupId?: number | null;
  shopProvince?: string | null;
  date?: string | null;
}

/** shop_data.json 单行:赛事/门店元信息(精确城市) */
export interface ShopRow {
  activityShopId?: number | null;
  name?: string | null;
  date?: string | null;
  shopProvince?: string | null;
  /** 精确城市,如 深圳市 */
  shopCity?: string | null;
  shopArea?: string | null;
  shopName?: string | null;
  playerMaxCount?: number | null;
}

/** decks_cache.json 中单张卡条目 */
export interface CacheCardEntry {
  cardNo?: string | null;
  cardName?: string | null;
  subTitle?: string | null;
  hero?: string | null;
  isMainHero?: boolean | null;
  cardCategoryName?: string | null;
  rarity?: string | null;
  frontImage?: string | null;
  cardColorList?: readonly string[] | null;
  cardCount?: number | null;
}

/** decks_cache.json 顶层结构:cardGroupId → 卡牌列表 */
export type DeckCacheData = Readonly<Record<string, readonly CacheCardEntry[]>>;

/** 赛事元信息(join shop_data + decks 推断轮次后) */
export interface EventMeta {
  name: string;
  date: string;
  province: string;
  city: string;
  area: string;
  shopName: string;
  playerMax: number | null;
  deckCount: number;
  /** 瑞士轮轮次数 = max(winCount),无胜场数据时为 null */
  rounds: number | null;
}

/* ──────────────────────────────────────────────────────────────
 * Deck 归一化模型
 * ──────────────────────────────────────────────────────────── */

export interface Deck {
  /** 原始 CSV 行(PapaParse 输出),保留以备分析层对未抽取字段溯源 */
  raw: RawDeckRow;
  playerName: string;
  activityName: string;
  /** 'YYYY-MM-DD',空时为 '' */
  date: string;
  /** 名次;NaN 时为 Number.MAX_SAFE_INTEGER,避免排序歧义 */
  rank: number;
  hero: string;
  /** 省份原值,如 '广东省',可空 */
  province: string;
  /** 提取出来的城市;识别失败固定为 '未知' */
  city: string;
  /** 该 deck 所属的周次 bucket */
  week: WeekBucket;
  ttsCode: string;
  /** TTS_code 解析结果:编号 → 张数 */
  cards: ReadonlyMap<string, number>;
  /* —— 以下字段来自增强数据源(join 后填充),无数据时为 null/空 —— */
  /** 瑞士轮胜场数(rank_data.winCount) */
  wins: number | null;
  /** 本场赛事总轮次 = max(winCount);winRate = wins / eventRounds */
  eventRounds: number | null;
  /** 胜率(0-100),wins/eventRounds*100;无数据时 null */
  winRate: number | null;
  /** 精确城市(shop_data.shopCity),可空 */
  shopCity: string;
  /** 门店名,可空 */
  shopName: string;
  /** 关联的卡组明细 ID(decks_cache key),可空 */
  cardGroupId: number | null;
}

/* ──────────────────────────────────────────────────────────────
 * 分析层可调参数(全部带默认值)
 * ──────────────────────────────────────────────────────────── */

export interface AnalysisOptions {
  /** 高排名阈值;0.10 / 0.15 / 0.20 表百分比,>=8 表绝对 Top N */
  readonly topThreshold: number;
  /** Combo 双向最低基础携带率 */
  readonly comboMinBase: number;
  /** Combo Lift 阈值(只输出 Lift ≥ 此值) */
  readonly comboMinLift: number;
  /** 流派聚类最小 Jaccard 相似度 */
  readonly jaccardMin: number;
  /** 流派最大数量(超出归入"其他") */
  readonly archMax: number;
  /** 周次模式 */
  readonly weekMode: 'iso' | 'rolling';
  /** rolling 模式下相邻比赛日期间隔超过该天数即切分新周 */
  readonly rollingGapDays: number;
}

/**
 * 默认参数。Lift 取 1.2 而非原版 1.5,
 * 因 Step 1 已与用户约定:进一步过滤万金油伪 Combo。
 */
export const DEFAULT_ANALYSIS_OPTIONS: AnalysisOptions = Object.freeze({
  topThreshold: 0.15,
  comboMinBase: 0.15,
  comboMinLift: 1.2,
  jaccardMin: 0.55,
  archMax: 3,
  weekMode: 'iso',
  rollingGapDays: 4
});

/* ──────────────────────────────────────────────────────────────
 * 英雄维度的统计输出
 * ──────────────────────────────────────────────────────────── */

export interface CardUsage {
  id: string;
  name: string;
  series: string;
  rarity: string;
  /** 该卡在 Top 样本中的携带率(%) */
  rate: number;
  /** 该卡在携带它的卡组中的平均张数 */
  avg: number;
  /** 该卡的平均法力费用 */
  energy: number;
  /** 颜色域标签,如 '狂怒·心灵' */
  colors: readonly CardColor[];
}

/** Tier 分级(S 最强) */
export type TierRating = 'S' | 'A' | 'B' | 'C';

export interface HeroStats {
  /** 该英雄全部参赛卡组数 */
  total: number;
  /** 分析样本数(Top 阈值切分后的卡组数) */
  topCount: number;
  /** Top 样本卡组 */
  topDecks: Deck[];
  /** 出场率 = total / totalDecks % */
  popularity: number;
  /** Top8 率 = 该英雄 Top8 内数量 / total % */
  top8Rate: number;
  /** 加权真实胜率(%)= Σwins / ΣeventRounds;无胜场数据时 null */
  winRate: number | null;
  /** 平均胜场数;无胜场数据时 null */
  avgWins: number | null;
  /** Tier 分级;样本不足或无胜率数据时 null(表格显示 '-') */
  tier: TierRating | null;
  /** Tier 综合分 0-100 */
  tierScore: number | null;
  /** Top 样本内卡牌携带率排行 */
  cards: CardUsage[];
  /** 周次 → 套数(已排序填充 0) */
  weeks: Map<string, number>;
  /** 城市 → 套数 */
  cities: Map<string, number>;
}

/* ──────────────────────────────────────────────────────────────
 * 地域维度统计
 * ──────────────────────────────────────────────────────────── */

export interface RegionHeatCell {
  /** 该 cell 的样本量(≥ 5 才会出现在热力图中) */
  n: number;
  /** Top8 内数量 */
  top8: number;
  /** Σwins(用于城市×英雄胜率热力),无数据时为 null */
  winsSum: number | null;
  /** ΣeventRounds,与 winsSum 配对使用 */
  roundsSum: number | null;
}

/** 城市 → 英雄 → 计数 */
export type RegionStatsMap = Map<string, Map<string, number>>;
/** 城市 → 英雄 → { n, top8 } */
export type RegionHeatMap = Map<string, Map<string, RegionHeatCell>>;

/* ──────────────────────────────────────────────────────────────
 * Combo (Lift 算法输出)
 * ──────────────────────────────────────────────────────────── */

export interface ComboResult {
  /** 卡 A 编号 */
  a: string;
  /** 卡 B 编号 */
  b: string;
  nameA: string;
  nameB: string;
  /** 两卡在样本中的同现卡组数 */
  count: number;
  /** 卡 A 携带卡组数 */
  countA: number;
  /** 卡 B 携带卡组数 */
  countB: number;
  /** Lift = P(A∩B) / (P(A) * P(B)) */
  lift: number;
  /** P(B|A) % */
  coRate: number;
  /** P(A|B) % */
  coRateReverse: number;
}

/* ──────────────────────────────────────────────────────────────
 * 流派聚类输出
 * ──────────────────────────────────────────────────────────── */

export interface ArchetypeCoreCard {
  id: string;
  name: string;
  /** 在该流派内的携带率(%) */
  rate: number;
}

export interface Archetype {
  name: string;
  color: string;
  /** 该流派卡组数 */
  count: number;
  /** 占英雄总样本的份额(%) */
  share: number;
  /** 该流派的平均名次,可能为 null(无 rank 数据) */
  avgRank: number | null;
  /** 该流派核心卡 TopN(已排序,默认 8) */
  coreCards: ArchetypeCoreCard[];
}

export interface ArchetypeResult {
  list: Archetype[];
  /** 实际参与聚类的样本量 */
  sampleSize: number;
  /** 本次聚类使用的 Jaccard 阈值 */
  jacMin: number;
}

/* ──────────────────────────────────────────────────────────────
 * 颜色域 / 域对统计输出
 * ──────────────────────────────────────────────────────────── */

/** 单个域对的聚合结果 */
export interface DomainPairStat {
  /** 展示名,如 '狂怒·心灵' */
  label: string;
  colors: readonly CardColor[];
  /** 使用该域对(传奇双色)的卡组数 */
  decks: number;
  /** 占样本份额(%) */
  share: number;
}

export interface ColorStatsResult {
  /** 域对(传奇颜色组合)排行,降序 */
  pairs: DomainPairStat[];
  /** 主卡组卡牌(排除符文/战场)的六色张数分布 */
  colorCopies: Map<CardColor, number>;
  /** 周次 → 六色张数(趋势堆叠用) */
  weeklyColors: Array<{ week: string; colors: Map<CardColor, number> }>;
  /** 成功识别域对的卡组数 */
  identifiedDecks: number;
}

/* ──────────────────────────────────────────────────────────────
 * 分析管线的最终输出(由 analyzer.ts 一次性产出)
 * ──────────────────────────────────────────────────────────── */

export interface AnalysisResult {
  /** CSV 全部赛事的参赛卡组数 */
  totalDecks: number;
  /** Top 阈值去重后的样本(以 deck 为单位) */
  uniqueSampleDecks: Deck[];
  /** Top 阈值卡组数(同 uniqueSampleDecks 长度,语义重复,便于 store 直接读) */
  sampleSize: number;
  /** 英雄名 → 统计(只覆盖出现过的英雄) */
  heroes: Map<string, HeroStats>;
  /** 全部周次的去重有序列表(供趋势图 xAxis) */
  weeks: WeekBucket[];
  /** 全部 CSV 行的归一化 deck 列表 */
  allDecks: Deck[];
  /** 样本范围内的卡牌 → 携带 deck 数 */
  globalTopCards: Map<string, number>;
  /** 全部卡组范围的卡牌 → 携带 deck 数 */
  globalAllCards: Map<string, number>;
  /** 全英雄高排名样本的 Combo(默认范围;按 scope 重算时由 store 缓存) */
  combos: ComboResult[];
  /** 城市 → 英雄 → 计数 */
  regionStats: RegionStatsMap;
  /** 城市 → 英雄 → { n, top8 } */
  regionHeat: RegionHeatMap;
  /** 省份原文 → 卡组数 */
  provinceStats: Map<string, number>;
  /** 用户尚未指定城市的赛事列表,用于 MappingPanel 兜底 */
  cityUnknown: string[];
  /** 卡牌目录(已在 pipeline 内 cross-ref 过) */
  catalog: CardCatalog;
  /** 实际使用的列名(用于调试面板 + 二次分析) */
  rankColumn: string;
  provinceColumn: string;
  cityUnknownActivityNames: string[];
  /* —— 增强数据源产出 —— */
  /** 赛事元信息列表(按日期升序) */
  events: EventMeta[];
  /** 是否有真实胜场数据(rank_data.json 已导入) */
  hasWinData: boolean;
  /** rank 匹配成功的卡组数 */
  winMatchedDecks: number;
  /** shop_data 精确匹配到的赛事数 */
  shopMatchedEvents: number;
  /** decks_cache 中可提供卡图的编号数 */
  imageCount: number;
  /** 颜色域 / 域对统计(基于高排名样本) */
  colorStats: ColorStatsResult | null;
}

/* ──────────────────────────────────────────────────────────────
 * 图表相关辅助类型
 * ──────────────────────────────────────────────────────────── */

export interface TableColumn<T = Record<string, unknown>> {
  key: string;
  label: string;
  /** 智能排序识别 */
  type?: 'text' | 'number' | 'percent';
  /** 是否显示排序按钮 */
  sortable?: boolean;
  /** 自定义单元格渲染 */
  render?: (row: T) => string | number;
  /** 文本对齐 */
  align?: 'left' | 'center' | 'right';
  /** 自定义 CSS 类 */
  className?: string;
}

/**
 * 上层图表数据 computed 返回的 option 类型。
 * ECharts 5.x 的 `SeriesOption` / `TooltipComponentOption` 是超长判别联合,
 * 对象字面量里 `{ type: 'line', ... }` 会被推断成 `type: string`,直接赋值给
 * `EChartsOption` 会触发 TS2322 与 TS2769。这里放宽为 `EChartsOption | Record<string, unknown>`,
 * 运行时的 `setOption` 会做实际校验。
 *
 * 类型主体见 `useChart.ts`,此处仅作 re-export,避免上层模块引入 echarts 类型。
 */
export type { ChartOptionInput } from '@/composables/useChart';
