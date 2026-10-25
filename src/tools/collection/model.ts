/**
 * 卡池的纯数据层：键的拼法、数量钳制、行 ←→ 映射、版本词、
 * 以及「卡组缺什么」的推导。不碰网络与 DOM，可直接被 verify 脚本跑。
 */
import type { CardPrint, CardRecord } from "@/components/carddex/types";
import { cardIndex, type DeckEntry } from "@/tools/deckbuilder/model";

/** 单个印本的持有上限，与 SQL 里的 check 保持一致。 */
export const QUANTITY_MAX = 999;

export interface CollectionEntry {
  /** 印本编号 card_prints.card_no_extend，保留原始大小写与星号。 */
  cardNo: string;
  /** 大写语言代码：SC / EN。 */
  language: string;
  quantity: number;
  /** 上次确认写入云端的时间（ISO）；本机缓存里可能是空串。 */
  updatedAt: string;
}

export type CollectionMap = Map<string, CollectionEntry>;

export const EMPTY_COLLECTION: CollectionMap = new Map();

/**
 * 卡池格子与云端行的唯一键。
 * 卡号与语言都做 trim + 大写：云端行的来源不止一个（表单、CSV 导入、手工 SQL），
 * 大小写不一致会被 PostgREST 的唯一索引当成两行，前端必须自己先收敛。
 * 星号（超编印本，如 UNL-233*）原样保留。
 */
export function collectionKey(cardNo: string, language: string): string {
  return `${String(cardNo ?? "").trim().toUpperCase()}\u0000${String(language ?? "").trim().toUpperCase()}`;
}

export function keyOfPrint(print: Pick<CardPrint, "cardNo" | "language">): string {
  return collectionKey(print.cardNo, print.language);
}

/** 0 表示「没有这张」，不是有效数量；负数一律视为 0。 */
export function clampQuantity(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(QUANTITY_MAX, Math.trunc(value)));
}

export interface CollectionRowLike {
  card_no?: unknown;
  language?: unknown;
  quantity?: unknown;
  updated_at?: unknown;
}

export function entriesFromRows(rows: readonly CollectionRowLike[]): CollectionMap {
  const map: CollectionMap = new Map();
  for (const row of rows) {
    const cardNo = String(row.card_no ?? "").trim();
    const language = String(row.language ?? "").trim().toUpperCase();
    const quantity = clampQuantity(Number(row.quantity ?? 0));
    if (!cardNo || !language || quantity < 1) continue;
    map.set(collectionKey(cardNo, language), {
      cardNo,
      language,
      quantity,
      updatedAt: typeof row.updated_at === "string" ? row.updated_at : "",
    });
  }
  return map;
}

/** 缓存 / 队列用的扁平快照，按卡号 → 语言排序，方便比对。 */
export function entriesFromSnapshot(snapshot: readonly CollectionEntry[]): CollectionMap {
  const map: CollectionMap = new Map();
  for (const entry of snapshot) {
    const quantity = clampQuantity(entry.quantity);
    if (quantity < 1) continue;
    map.set(collectionKey(entry.cardNo, entry.language), {
      cardNo: entry.cardNo,
      language: entry.language.toUpperCase(),
      quantity,
      updatedAt: entry.updatedAt ?? "",
    });
  }
  return map;
}

export function toSnapshot(map: CollectionMap): CollectionEntry[] {
  return [...map.values()]
    .map((entry) => ({ ...entry }))
    .sort((a, b) =>
      a.cardNo === b.cardNo
        ? a.language.localeCompare(b.language)
        : a.cardNo.localeCompare(b.cardNo),
    );
}

export function totalQuantity(map: CollectionMap): number {
  let total = 0;
  for (const entry of map.values()) total += entry.quantity;
  return total;
}

export function countEntries(map: CollectionMap): number {
  return map.size;
}

export const COLLECTION_VERSIONS = ["平卡", "异画", "超编", "签名超编"] as const;
export type CollectionVersion = (typeof COLLECTION_VERSIONS)[number];

/** 版本词与开卡包模拟器同一判定：extend_rarity_name 里带「签名 / 超编 / 异画」。 */
export function printVersion(print: Pick<CardPrint, "extendedRarity">): CollectionVersion {
  const label = print.extendedRarity ?? "";
  if (label.includes("签名")) return "签名超编";
  if (label.includes("超编")) return "超编";
  if (label.includes("异画")) return "异画";
  return "平卡";
}

const LANGUAGE_LABELS: Record<string, string> = {
  SC: "简中",
  EN: "英文",
  KR: "韩文",
  TW: "繁中",
};

export function languageLabel(language: string): string {
  const code = language.trim().toUpperCase();
  return LANGUAGE_LABELS[code] ?? code;
}

export function languageRank(language: string): number {
  const code = language.trim().toUpperCase();
  if (code === "SC") return 0;
  if (code === "EN") return 1;
  return 2;
}

export interface HeldIndex {
  /** 印本键 → 条目。 */
  byPrint: CollectionMap;
  /** 基础卡号 → 各语言各版本合计。 */
  byBase: Map<string, number>;
  /** `基础卡号|语言` → 合计。 */
  byBaseLanguage: Map<string, number>;
  total: number;
}

export function buildHeldIndex(
  map: CollectionMap,
  records: readonly CardRecord[],
): HeldIndex {
  const baseOfPrint = new Map<string, string>();
  for (const record of records) {
    const baseNo = record.base.cardNo.trim().toUpperCase();
    baseOfPrint.set(baseNo, baseNo);
    for (const print of record.prints) {
      baseOfPrint.set(print.cardNo.trim().toUpperCase(), baseNo);
    }
  }
  const byBase = new Map<string, number>();
  const byBaseLanguage = new Map<string, number>();
  let total = 0;
  for (const entry of map.values()) {
    const base = baseOfPrint.get(entry.cardNo.trim().toUpperCase()) ?? entry.cardNo.trim().toUpperCase();
    byBase.set(base, (byBase.get(base) ?? 0) + entry.quantity);
    const splitKey = `${base}\u0000${entry.language}`;
    byBaseLanguage.set(splitKey, (byBaseLanguage.get(splitKey) ?? 0) + entry.quantity);
    total += entry.quantity;
  }
  return { byPrint: map, byBase, byBaseLanguage, total };
}

export function heldOfPrint(held: HeldIndex, cardNo: string, language: string): number {
  return held.byPrint.get(collectionKey(cardNo, language))?.quantity ?? 0;
}

export function heldOfBase(held: HeldIndex, baseCardNo: string): number {
  return held.byBase.get(baseCardNo.trim().toUpperCase()) ?? 0;
}

export function heldOfBaseLanguage(
  held: HeldIndex,
  baseCardNo: string,
  language: string,
): number {
  return (
    held.byBaseLanguage.get(
      `${baseCardNo.trim().toUpperCase()}\u0000${language.trim().toUpperCase()}`,
    ) ?? 0
  );
}

export interface ShortfallRow {
  /** deck entry 的键，供界面定位到具体条目。 */
  key: string;
  zone: string;
  name: string;
  cardNo: string;
  printNo: string;
  language: string;
  need: number;
  have: number;
  missing: number;
  /** 同卡同语言下、其它印版的存量。缺卡时用它提示「另有 N 张」。 */
  alternative: number;
}

export interface DeckHolding {
  /** 卡组总张数（含所有分区）。 */
  total: number;
  /** 按印版精确对齐后真正凑齐的张数。 */
  owned: number;
  /** 缺口总数。 */
  missing: number;
  shortfall: ShortfallRow[];
}

export function entryKeyOf(entry: Pick<DeckEntry, "cardNo" | "printNo" | "language">): string {
  return `${entry.cardNo.toUpperCase()}\u0000${entry.printNo.toUpperCase()}\u0000${entry.language.toUpperCase()}`;
}

/**
 * 卡组对照持有量：缺卡按印版精确计算；
 * alternative 给出同卡同语言其它印版的存量，避免「明明有卡却提示缺卡」的困惑。
 */
export function deckHolding(
  deck: { zones: Record<string, DeckEntry[]> },
  records: readonly CardRecord[],
  held: HeldIndex,
): DeckHolding {
  const index = cardIndex(records);
  let total = 0;
  let owned = 0;
  let missing = 0;
  const shortfall: ShortfallRow[] = [];

  for (const [zone, entries] of Object.entries(deck.zones ?? {})) {
    for (const entry of entries ?? []) {
      const need = Math.max(0, Math.trunc(entry.quantity));
      if (!need) continue;
      total += need;
      const language = (entry.language || "SC").toUpperCase();
      const printNo = entry.printNo || entry.cardNo;
      const have = heldOfPrint(held, printNo, language);
      const covered = Math.min(need, have);
      owned += covered;
      const gap = need - covered;
      if (gap <= 0) continue;
      missing += gap;
      const record = index.get(printNo.toUpperCase()) ?? index.get(entry.cardNo.toUpperCase());
      const baseNo = record?.base.cardNo ?? entry.cardNo;
      const sameLanguageAllPrints = heldOfBaseLanguage(held, baseNo, language);
      shortfall.push({
        key: entryKeyOf(entry),
        zone,
        name: entry.name || record?.base.nameCn || entry.cardNo,
        cardNo: entry.cardNo,
        printNo,
        language,
        need,
        have,
        missing: gap,
        alternative: Math.max(0, sameLanguageAllPrints - have),
      });
    }
  }
  shortfall.sort((a, b) => b.missing - a.missing || a.name.localeCompare(b.name, "zh-CN"));
  return { total, owned, missing, shortfall };
}
