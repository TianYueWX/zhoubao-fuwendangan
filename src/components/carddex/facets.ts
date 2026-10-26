/**
 * 筛选面板的标准分面定义。
 *
 * 卡牌查询与卡池共用同一份，保证标题、顺序、图标来源不会各写一套。
 * 卡池只是在这八个前面插了语言 / 版本两个 toggle 组。
 */
import type { CardIcon, FacetGroupDef, FilterType } from "./types";

export const STANDARD_FACET_LABELS: Record<FilterType, [string, string]> = {
  color: ["颜色", "Color"],
  category: ["类别", "Category"],
  series: ["系列", "Series"],
  rarity: ["稀有度", "Rarity"],
  region: ["地区", "Region"],
  tag: ["标签", "Tag"],
  keyword: ["关键词", "Keyword"],
  advancedTag: ["进阶标签", "Advanced tag"],
};

/** 与卡牌查询原来的竖向顺序一致：颜色在前。 */
export const STANDARD_FACET_ORDER: readonly FilterType[] = [
  "color",
  "category",
  "series",
  "rarity",
  "region",
  "tag",
  "keyword",
  "advancedTag",
];

/** 哪些分面用图标代替文字：颜色用本地符文图，关键词查 card_icons。 */
const FACET_ICONS: Partial<Record<FilterType, "rune" | "keyword">> = {
  color: "rune",
  keyword: "keyword",
};

export function standardFacetGroups(
  options: Record<FilterType, string[]>,
): FacetGroupDef[] {
  return STANDARD_FACET_ORDER.map((id) => ({
    id,
    kind: "cycle" as const,
    label: STANDARD_FACET_LABELS[id],
    options: options[id] ?? [],
    icon: FACET_ICONS[id],
  }));
}

/**
 * 关键词芯片的图标：`card_icons` 里既有基础名，也有 `迅捷>` 这类条件变体。
 * 先按精确名找，再试带 `>` 的变体；都没有就回落文字。
 */
export function keywordIcon(
  value: string,
  icons: readonly CardIcon[] | undefined,
): CardIcon | null {
  if (!icons?.length) return null;
  const exact = icons.find((icon) => icon.name === value);
  if (exact) return exact;
  return icons.find((icon) => icon.name === `${value}>`) ?? null;
}
