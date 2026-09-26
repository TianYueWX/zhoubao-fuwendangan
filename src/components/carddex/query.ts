import { chooseDefaultPrint, printKey } from "./data";
import type {
  ActiveFilter,
  CardBase,
  CardPrint,
  CardRecord,
  CarddexQueryState,
  DisplayCard,
  FilterType,
  ResultMode,
  SortField,
} from "./types";

export const DEFAULT_QUERY: CarddexQueryState = {
  search: "",
  mode: "base",
  banned: "hide",
  filters: [],
  numeric: {
    energy: { min: 0, max: 99 },
    returnEnergy: { min: 0, max: 99 },
    power: { min: 0, max: 99 },
  },
  sort: [{ id: "default-card-no", field: "cardNo", asc: true }],
};

export const FILTER_TYPES: readonly FilterType[] = [
  "color",
  "category",
  "series",
  "rarity",
  "region",
  "tag",
  "keyword",
  "advancedTag",
];

export const OPTIONS_PRIORITY = {
  card_color_list: ["red", "green", "blue", "orange", "purple", "yellow"],
  series: ["FND", "ARC", "OGS", "OGN", "SFD", "UNL", "VEN", "T1S", "T1A", "RAD"],
  rarity: ["普通", "不凡", "稀有", "史诗", "异画"],
  card_category: [
    "传奇",
    "英雄单位",
    "单位",
    "法术",
    "装备",
    "战场",
    "符文",
    "专属单位",
    "专属法术",
    "专属装备",
    "单位指示物",
    "装备指示物",
    "战场指示物",
  ],
  keyword: [
    "反应",
    "迅捷",
    "后排",
    "壁垒",
    "伏击",
    "急速",
    "游走",
    "绝念",
    "瞬息",
    "鼓舞",
    "预知",
    "待命",
    "回响",
    "获得",
    "眩晕",
    "增益",
    "强力",
    "百炼",
    "灵便",
    "装配",
  ],
} as const;

const priorityByType: Partial<Record<FilterType, readonly string[]>> = {
  color: OPTIONS_PRIORITY.card_color_list,
  series: OPTIONS_PRIORITY.series,
  rarity: OPTIONS_PRIORITY.rarity,
  category: OPTIONS_PRIORITY.card_category,
  keyword: OPTIONS_PRIORITY.keyword,
};

function values(
  base: CardBase,
  prints: readonly CardPrint[],
  type: FilterType,
  mode: ResultMode,
): string[] {
  switch (type) {
    case "color":
      return base.colors;
    case "category":
      return base.categories;
    case "series":
      // 系列是模式相关的 facet：按卡牌只认基础卡系列，按印本才看每个印本的系列。
      if (mode === "base") return base.series ? [base.series] : [];
      return [
        ...new Set(
          (prints.length
            ? prints.map((p) => p.series || base.series)
            : [base.series]
          ).filter(Boolean),
        ),
      ];
    case "rarity":
      return [
        ...new Set(
          (prints.length
            ? prints.map((p) => p.rarity || base.rarity)
            : [base.rarity]
          ).filter(Boolean),
        ),
      ];
    case "region":
      return base.regions;
    case "tag":
      return base.tags;
    case "keyword":
      return base.keywords;
    case "advancedTag":
      return base.advancedTags;
  }
}

function typeMatches(
  haystack: readonly string[],
  filters: readonly ActiveFilter[],
): boolean {
  const include = filters
    .filter((f) => f.mode === "include")
    .map((f) => f.value);
  const require = filters
    .filter((f) => f.mode === "require")
    .map((f) => f.value);
  const exclude = filters
    .filter((f) => f.mode === "exclude")
    .map((f) => f.value);
  if (include.length && !include.some((v) => haystack.includes(v)))
    return false;
  if (require.some((v) => !haystack.includes(v))) return false;
  if (exclude.some((v) => haystack.includes(v))) return false;
  return true;
}

function textMatches(
  base: CardBase,
  prints: readonly CardPrint[],
  raw: string,
): boolean {
  const q = raw.trim().toLocaleLowerCase();
  if (!q) return true;
  return [
    base.nameCn,
    base.nameEn,
    base.subtitleCn,
    base.subtitleEn,
    base.effectCn.replace(/<[^>]*>/g, " "),
    base.effectEn.replace(/<[^>]*>/g, " "),
    base.cardNo,
    base.championTag,
    ...prints.map((p) => p.cardNo),
  ].some((v) => v.toLocaleLowerCase().includes(q));
}

function numericMatches(base: CardBase, state: CarddexQueryState): boolean {
  const checks: Array<[number | null, { min: number; max: number }]> = [
    [base.energy, state.numeric.energy],
    [base.returnEnergy, state.numeric.returnEnergy],
    [base.power, state.numeric.power],
  ];
  return checks.every(
    ([value, range]) =>
      value == null || (value >= range.min && value <= range.max),
  );
}

function baseMatches(
  record: CardRecord,
  prints: readonly CardPrint[],
  state: CarddexQueryState,
): boolean {
  if (state.banned === "hide" && record.base.banned) return false;
  if (state.banned === "only" && !record.base.banned) return false;
  if (
    !textMatches(record.base, prints, state.search) ||
    !numericMatches(record.base, state)
  )
    return false;
  return FILTER_TYPES.every((type) => {
    const fs = state.filters.filter((f) => f.type === type);
    return (
      !fs.length || typeMatches(values(record.base, prints, type, state.mode), fs)
    );
  });
}

function printMatchesFacet(
  base: CardBase,
  print: CardPrint,
  state: CarddexQueryState,
): boolean {
  return FILTER_TYPES.every((type) => {
    const fs = state.filters.filter((f) => f.type === type);
    return (
      !fs.length ||
      typeMatches(values(base, [print], type, state.mode), fs)
    );
  });
}

function matchingDisplayPrint(
  record: CardRecord,
  state: CarddexQueryState,
): CardPrint | null {
  const constrained = record.prints.filter((p) =>
    printMatchesFacet(record.base, p, state),
  );
  const q = state.search.trim().toLocaleLowerCase();
  if (q) {
    const numberMatches = constrained.filter((p) =>
      p.cardNo.toLocaleLowerCase().includes(q),
    );
    if (numberMatches.length) return chooseDefaultPrint(numberMatches);
  }
  return chooseDefaultPrint(constrained.length ? constrained : record.prints);
}

function sortValue(item: DisplayCard, field: SortField): string | number {
  const b = item.base;
  const p = item.print;
  switch (field) {
    case "name":
      return b.nameCn || b.nameEn;
    case "cardNo":
      return p?.cardNo || b.cardNo;
    case "category":
      return b.categories.join("·");
    case "color":
      return b.colors.join("·");
    case "series":
      return p?.series || b.series;
    case "rarity":
      return p?.rarity || b.rarity;
    case "power":
      return b.power ?? -1;
    case "energy":
      return b.energy ?? -1;
    case "returnEnergy":
      return b.returnEnergy ?? -1;
  }
}

function compare(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function sortDisplayCards(
  items: readonly DisplayCard[],
  rules: CarddexQueryState["sort"],
): DisplayCard[] {
  const out = [...items];
  out.sort((a, b) => {
    for (const rule of rules) {
      const c = compare(sortValue(a, rule.field), sortValue(b, rule.field));
      if (c) return rule.asc ? c : -c;
    }
    return a.key.localeCompare(b.key, undefined, { numeric: true });
  });
  return out;
}

export function buildDisplayCards(
  records: readonly CardRecord[],
  state: CarddexQueryState,
): DisplayCard[] {
  const out: DisplayCard[] = [];
  for (const record of records) {
    if (state.mode === "base") {
      if (!baseMatches(record, record.prints, state)) continue;
      const print = matchingDisplayPrint(record, state);
      out.push({ key: record.base.id, base: record.base, print });
      continue;
    }
    // 印本模式：同一 card_no_extend 的多个语言只出一张 tile，语言取 SC 优先。
    const byCardNo = new Map<string, CardPrint[]>();
    for (const print of record.prints) {
      if (
        !baseMatches(record, [print], state) ||
        !printMatchesFacet(record.base, print, state)
      )
        continue;
      const group = byCardNo.get(print.cardNo) ?? [];
      group.push(print);
      byCardNo.set(print.cardNo, group);
    }
    for (const group of byCardNo.values()) {
      const print = chooseDefaultPrint(group);
      if (print) out.push({ key: printKey(print), base: record.base, print });
    }
  }
  return sortDisplayCards(out, state.sort);
}

export function facetOptions(
  records: readonly CardRecord[],
  mode: ResultMode,
): Record<FilterType, string[]> {
  const sets = Object.fromEntries(
    FILTER_TYPES.map((type) => [type, new Set<string>()]),
  ) as Record<FilterType, Set<string>>;
  for (const record of records) {
    for (const type of FILTER_TYPES)
      for (const v of values(record.base, record.prints, type, mode))
        sets[type].add(v);
  }
  return Object.fromEntries(
    FILTER_TYPES.map((type) => {
      const priority = priorityByType[type] ?? [];
      const rank = new Map(priority.map((value, index) => [value, index]));
      return [
        type,
        [...sets[type]].sort((a, b) => {
          const ar = rank.get(a) ?? Number.MAX_SAFE_INTEGER;
          const br = rank.get(b) ?? Number.MAX_SAFE_INTEGER;
          return ar - br || a.localeCompare(b, undefined, { numeric: true });
        }),
      ];
    }),
  ) as Record<FilterType, string[]>;
}

export function numericBounds(
  records: readonly CardRecord[],
): Record<"energy" | "returnEnergy" | "power", { min: number; max: number }> {
  const bound = (
    pick: (b: CardBase) => number | null,
  ): { min: number; max: number } => {
    const ns = records
      .map((r) => pick(r.base))
      .filter((v): v is number => v != null && Number.isFinite(v));
    return {
      min: ns.length ? Math.min(...ns) : 0,
      max: ns.length ? Math.max(...ns) : 0,
    };
  };
  return {
    energy: bound((b) => b.energy),
    returnEnergy: bound((b) => b.returnEnergy),
    power: bound((b) => b.power),
  };
}
