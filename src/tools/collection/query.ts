/**
 * 卡池页的展示卡片：把 (印本, 语言) 展开成格子，贴上持有数量，再按视图 / 筛选 / 排序收敛。
 * 标准 8 个分面直接复用 carddex 的匹配与分面语义，避免两套筛选口径。
 */
import { buildPrintCards, facetOptions, numericBounds } from "@/components/carddex/query";
import type {
  ActiveFilter,
  CardRecord,
  CarddexQueryState,
  DisplayCard,
  FilterType,
  NumberRange,
  NumericFilters,
  SortField,
  SortRule,
} from "@/components/carddex/types";
import {
  collectionKey,
  languageRank,
  printVersion,
  type CollectionMap,
  type CollectionVersion,
} from "./model";
import { DEFAULT_SORT, type CollectionViewMode } from "./storage";

export interface CollectionItem extends DisplayCard {
  /** 这一格的持有数量；0 表示没有。 */
  quantity: number;
  updatedAt: string;
}

export interface CollectionQueryInput {
  search: string;
  view: CollectionViewMode;
  sort: SortRule[];
  filters: ActiveFilter[];
  numeric: NumericFilters;
  languages: string[];
  versions: string[];
}

export interface CollectionFacets {
  options: Record<FilterType, string[]>;
  bounds: Record<"energy" | "returnEnergy" | "power", { min: number; max: number }>;
}

export function collectionFacets(records: readonly CardRecord[]): CollectionFacets {
  return {
    options: facetOptions(records, "print"),
    bounds: numericBounds(records),
  };
}

/** 页面上可选的语言 / 版本，按卡表实际出现的值生成。 */
export function collectionAxes(records: readonly CardRecord[]): {
  languages: string[];
  versions: CollectionVersion[];
} {
  const languages = new Set<string>();
  const versions = new Set<CollectionVersion>();
  for (const record of records) {
    for (const print of record.prints) {
      languages.add(print.language.toUpperCase());
      versions.add(printVersion(print));
    }
  }
  return {
    languages: [...languages].sort((a, b) => languageRank(a) - languageRank(b) || a.localeCompare(b)),
    versions: (["平卡", "异画", "超编", "签名超编"] as CollectionVersion[]).filter((v) => versions.has(v)),
  };
}

export function buildCollectionItems(
  records: readonly CardRecord[],
  input: CollectionQueryInput,
  entries: CollectionMap,
): CollectionItem[] {
  const state: CarddexQueryState = {
    search: input.search,
    mode: "print",
    // 收藏视角不看禁卡状态：禁卡照样可能被持有。
    banned: "all",
    filters: input.filters,
    numeric: input.numeric,
    sort: [],
  };
  const languages = new Set(input.languages.map((v) => v.toUpperCase()));
  const versions = new Set(input.versions);
  const items: CollectionItem[] = [];
  for (const card of buildPrintCards(records, state)) {
    const print = card.print;
    if (!print) continue;
    if (languages.size && !languages.has(print.language.toUpperCase())) continue;
    if (versions.size && !versions.has(printVersion(print))) continue;
    const entry = entries.get(collectionKey(print.cardNo, print.language));
    const quantity = entry?.quantity ?? 0;
    if (input.view === "owned" && quantity < 1) continue;
    items.push({ ...card, quantity, updatedAt: entry?.updatedAt ?? "" });
  }
  return sortItems(items, input.sort);
}

function defaultOrder(a: CollectionItem, b: CollectionItem): number {
  return (
    a.base.series.localeCompare(b.base.series) ||
    a.base.cardNo.localeCompare(b.base.cardNo, undefined, { numeric: true }) ||
    languageRank(a.print?.language ?? "") - languageRank(b.print?.language ?? "") ||
    (a.print?.cardNo ?? "").localeCompare(b.print?.cardNo ?? "", undefined, { numeric: true })
  );
}

const TEXT_FIELDS = new Set<SortField>(["name", "cardNo", "category", "color", "series", "rarity"]);

function numeric(value: number | null | undefined): number {
  return typeof value === "number" ? value : -1;
}

function sortValue(item: CollectionItem, field: SortField): string | number {
  const { base, print } = item;
  if (TEXT_FIELDS.has(field)) {
    switch (field) {
      case "name":
        return base.nameCn || "";
      case "cardNo":
        return print?.cardNo || base.cardNo;
      case "category":
        return base.categories[0] ?? "";
      case "color":
        return base.colors[0] ?? "";
      case "series":
        return base.series || "";
      default:
        return print?.rarity || base.rarity || "";
    }
  }
  switch (field) {
    case "power":
      return numeric(base.power);
    case "energy":
      return numeric(base.energy);
    default:
      return numeric(base.returnEnergy);
  }
}

function compareField(a: CollectionItem, b: CollectionItem, field: SortField, asc: boolean): number {
  const left = sortValue(a, field);
  const right = sortValue(b, field);
  let diff: number;
  if (typeof left === "number" && typeof right === "number") {
    diff = left - right;
  } else if (field === "cardNo") {
    diff = String(left).localeCompare(String(right), undefined, { numeric: true });
  } else if (field === "name") {
    diff = String(left).localeCompare(String(right), "zh-CN");
  } else {
    diff = String(left).localeCompare(String(right));
  }
  return asc ? diff : -diff;
}

/** 多条件排序：逐条比规则，全相等时回落到「系列 → 印本号 → 简中先」。 */
export function sortItems(items: readonly CollectionItem[], rules: readonly SortRule[]): CollectionItem[] {
  const out = [...items];
  const active = rules.length ? rules.filter((rule) => rule && rule.field) : DEFAULT_SORT;
  out.sort((a, b) => {
    for (const rule of active) {
      const diff = compareField(a, b, rule.field, rule.asc !== false);
      if (diff !== 0) return diff;
    }
    return defaultOrder(a, b);
  });
  return out;
}

/** 筛选面板的徽章数：语言 + 版本各自算 1 个，标准分面按条数算。 */
export function activeFilterCount(input: {
  filters: ActiveFilter[];
  languages: string[];
  versions: string[];
  numeric: NumericFilters;
  /** 三个数值范围各自的默认区间（卡表到齐后才知道），不传退回 0–99 哨兵 */
  bounds?: Record<"energy" | "returnEnergy" | "power", NumberRange>;
}): number {
  let count = input.filters.length + input.languages.length + input.versions.length;
  for (const key of ["energy", "returnEnergy", "power"] as const) {
    const range = input.numeric[key];
    const reference = input.bounds?.[key] ?? { min: 0, max: 99 };
    if (range.min !== reference.min || range.max !== reference.max) count += 1;
  }
  return count;
}
