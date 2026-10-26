export type CarddexLocale = "zh" | "en";
export type ResultMode = "base" | "print";
export type BannedMode = "hide" | "all" | "only";
export type FilterMode = "include" | "require" | "exclude";
export type FilterType =
  | "color"
  | "category"
  | "series"
  | "rarity"
  | "region"
  | "tag"
  | "keyword"
  | "advancedTag";

/**
 * 筛选面板里的一个分面组。
 *
 * `cycle` 是卡牌查询的八个标准分面（包含 / 必须 / 排除 三态循环，可右键清除）；
 * `toggle` 是卡池新增的两个轴（语言 / 版本），只有选中与未选中两种状态。
 * 两者共用同一套外壳：标题、计数、折叠、芯片。
 */
export type FacetKind = "cycle" | "toggle";

export interface FacetGroupDef {
  /** cycle 组用 FilterType；toggle 组用任意稳定 id（language / version） */
  id: string;
  kind: FacetKind;
  /** [中文, English] */
  label: [string, string];
  /** 候选值；不传则回落到面板的 options[group.id] */
  options?: string[];
  /** 值 → 显示文案（语言码 SC → 简中） */
  display?: Record<string, string>;
  /** 图标来源：只有颜色用本地符文图，其余分面显示文字 */
  icon?: "rune";
}

export interface CardBase {
  id: string;
  cardNo: string;
  nameCn: string;
  nameEn: string;
  nameKr: string;
  nameTw: string;
  subtitleCn: string;
  subtitleEn: string;
  subtitleKr: string;
  subtitleTw: string;
  colors: string[];
  regions: string[];
  tags: string[];
  keywords: string[];
  advancedTags: string[];
  championTag: string;
  effectCn: string;
  effectEn: string;
  effectKr: string;
  effectTw: string;
  energy: number | null;
  returnEnergy: number | null;
  power: number | null;
  rarity: string;
  series: string;
  flavorCn: string;
  flavorEn: string;
  banned: boolean;
  categories: string[];
  deckLimit: number | null;
}

export interface CardPrint {
  id: string;
  cardId: string;
  cardNo: string;
  rarity: string;
  extendedRarity: string;
  language: string;
  imageUrl: string;
  ttsUrl: string;
  artist: string;
  printOrder: number;
  isDefault: boolean;
  isPromo: boolean;
  series: string;
  flavorCn: string;
  flavorEn: string;
  /**
   * 卡图展示旋转角（度，CSS 约定，负值逆时针）。
   * 0 / 180 用 744×1040 竖框，±90 用 1040×744 横框。
   * null = 库里没有该列（旧缓存或未迁移的库），由 printRotation() 回退到类目规则。
   */
  rotateDeg: number | null;
}

export interface CardRecord {
  base: CardBase;
  prints: CardPrint[];
}

export interface DisplayCard {
  key: string;
  base: CardBase;
  print: CardPrint | null;
}

export interface ActiveFilter {
  type: FilterType;
  value: string;
  mode: FilterMode;
}

export interface NumberRange {
  min: number;
  max: number;
}

export interface NumericFilters {
  energy: NumberRange;
  returnEnergy: NumberRange;
  power: NumberRange;
}

export type SortField =
  | "name"
  | "cardNo"
  | "category"
  | "color"
  | "series"
  | "rarity"
  | "power"
  | "energy"
  | "returnEnergy";

export interface SortRule {
  id: string;
  field: SortField;
  asc: boolean;
}

export interface CarddexQueryState {
  search: string;
  mode: ResultMode;
  banned: BannedMode;
  filters: ActiveFilter[];
  numeric: NumericFilters;
  sort: SortRule[];
}

export interface PinnedPrint {
  key: string;
  cardNo: string;
  language: string;
}

export interface CardIcon {
  name: string;
  url: string;
  isWhite: boolean;
}

/** 与某张卡关联的一条问答（来自 qa_entries + qa_entry_cards）。 */
export interface CardQa {
  id: string;
  sourceId: string | null;
  question: string;
  answer: string;
  questionEn: string;
  answerEn: string;
  /** qa_entry_cards.position，越小越靠前 */
  position: number;
}

export interface CarddexData {
  records: CardRecord[];
  icons: CardIcon[];
  /** cards_base.card_no → 该卡关联的问答（按 position 升序） */
  qaByCardNo: Map<string, CardQa[]>;
}
