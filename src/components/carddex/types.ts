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

export interface CardBase {
  id: string;
  cardNo: string;
  nameCn: string;
  nameEn: string;
  subtitleCn: string;
  subtitleEn: string;
  colors: string[];
  regions: string[];
  tags: string[];
  keywords: string[];
  advancedTags: string[];
  championTag: string;
  effectCn: string;
  effectEn: string;
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
