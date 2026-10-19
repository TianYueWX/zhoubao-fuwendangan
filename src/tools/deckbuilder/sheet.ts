import { CARD_COLOR_LABELS, type CardColor } from '@/types';
import { LABELS, kind, resolveEntry, type BuilderDeck, type CardIndex, type DeckEntry, type Zone } from './model';

export type SheetSort = 'type' | 'energy' | 'color' | 'name';

export const SHEET_SORTS: readonly { id: SheetSort; label: string }[] = [
  { id: 'type', label: '类型' },
  { id: 'energy', label: '费用' },
  { id: 'color', label: '颜色' },
  { id: 'name', label: '名称' }
];

export interface SheetSection {
  zone: Zone;
  label: string;
  count: number;
  entries: DeckEntry[];
}

export interface RuneColorCount {
  color: CardColor;
  label: string;
  count: number;
}

export interface DeckSheetData {
  legend: DeckEntry | null;
  champion: DeckEntry | null;
  runes: RuneColorCount[];
  sections: SheetSection[];
}

const COLOR_ORDER = ['red', 'green', 'blue', 'yellow', 'purple', 'orange', 'colorless'] as const;
const TYPE_ORDER = ['单位', '法术', '装备', '其他'] as const;

/* A4 版面常量（mm），与 DeckSheet.vue 的 CSS 保持一致。 */
const PAGE_W = 210;
const PAGE_H = 297;
const PAGE_PAD = 10;
const HEADER_H = 16;
const IDENTITY_H = 52;
const FOOTER_H = 8;
const SECTIONS_TOP = 3;
const SECTION_HEAD = 6;
const SECTION_GAP = 3;
const CARD_GAP = 2;
const CONTENT_W = PAGE_W - PAGE_PAD * 2;
const SECTIONS_H = PAGE_H - PAGE_PAD * 2 - HEADER_H - IDENTITY_H - FOOTER_H - SECTIONS_TOP;

function colorOf(value: string): CardColor {
  return (COLOR_ORDER as readonly string[]).includes(value) ? (value as CardColor) : 'colorless';
}

function typeRank(value: string): number {
  const index = (TYPE_ORDER as readonly string[]).indexOf(value as (typeof TYPE_ORDER)[number]);
  return index < 0 ? TYPE_ORDER.length : index;
}

function compareEntries(a: DeckEntry, b: DeckEntry, index: CardIndex, sort: SheetSort): number {
  const ra = resolveEntry(a, index);
  const rb = resolveEntry(b, index);
  const typeA = ra.record ? kind(ra.record) : '其他';
  const typeB = rb.record ? kind(rb.record) : '其他';
  const energyA = ra.record?.base.energy ?? 99;
  const energyB = rb.record?.base.energy ?? 99;
  const colorA = colorOf(ra.record?.base.colors[0] ?? 'colorless');
  const colorB = colorOf(rb.record?.base.colors[0] ?? 'colorless');
  const nameOrder = ra.name.localeCompare(rb.name, 'zh-CN');

  if (sort === 'energy') {
    return energyA - energyB || typeRank(typeA) - typeRank(typeB) || nameOrder;
  }
  if (sort === 'color') {
    return COLOR_ORDER.indexOf(colorA) - COLOR_ORDER.indexOf(colorB) || typeRank(typeA) - typeRank(typeB) || nameOrder;
  }
  if (sort === 'name') return nameOrder;
  return typeRank(typeA) - typeRank(typeB) || energyA - energyB || nameOrder;
}

function sortedEntries(entries: readonly DeckEntry[], index: CardIndex, sort: SheetSort): DeckEntry[] {
  return entries
    .map((entry, order) => ({ entry, order }))
    .sort((a, b) => compareEntries(a.entry, b.entry, index, sort) || a.order - b.order)
    .map(({ entry }) => entry);
}

function runeColors(deck: BuilderDeck, index: CardIndex): RuneColorCount[] {
  const counts = new Map<CardColor, number>();
  for (const entry of deck.zones.rune) {
    const record = resolveEntry(entry, index).record;
    const colors = record?.base.colors.length ? record.base.colors : ['colorless'];
    for (const value of colors) {
      const color = colorOf(value);
      counts.set(color, (counts.get(color) ?? 0) + entry.quantity);
    }
  }
  return [...counts]
    .sort((a, b) => COLOR_ORDER.indexOf(a[0]) - COLOR_ORDER.indexOf(b[0]))
    .map(([color, count]) => ({ color, label: CARD_COLOR_LABELS[color], count }));
}

export function buildDeckSheet(deck: BuilderDeck, index: CardIndex, sort: SheetSort): DeckSheetData {
  const sections = (['main', 'battlefield', 'side', 'additional'] as const)
    .map((zone) => {
      const entries = sortedEntries(deck.zones[zone], index, sort);
      return {
        zone,
        label: LABELS[zone],
        count: entries.reduce((sum, entry) => sum + entry.quantity, 0),
        entries
      };
    })
    .filter((section) => section.entries.length > 0);

  return {
    legend: deck.zones.legend[0] ?? null,
    champion: deck.zones.champion[0] ?? null,
    runes: runeColors(deck, index),
    sections
  };
}

/**
 * 选择一行放几张卡：优先少列（卡图大），逐列增加直到 A4 高度放得下。
 * 返回 7～16 之间的列数；版面仍放不下时保持 16 列。
 */
export function chooseSheetColumns(sections: readonly Pick<SheetSection, 'entries'>[]): number {
  if (!sections.length) return 7;
  for (let columns = 7; columns <= 16; columns++) {
    const cardWidth = (CONTENT_W - (columns - 1) * CARD_GAP) / columns;
    const cardHeight = cardWidth * 1040 / 744;
    const height = sections.reduce(
      (sum, section) => sum + SECTION_HEAD + Math.ceil(section.entries.length / columns) * cardHeight + SECTION_GAP,
      0
    );
    if (height <= SECTIONS_H) return columns;
  }
  return 16;
}
