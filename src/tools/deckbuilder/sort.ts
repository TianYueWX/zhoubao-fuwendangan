import { COLOR_ORDER } from './sheet';
import { kind, resolveEntry, type CardIndex, type DeckEntry } from './model';

export type DeckSortField = 'type' | 'energy' | 'color' | 'name' | 'power' | 'rarity' | 'cardNo';

export const DECK_SORT_FIELDS: readonly { id: DeckSortField; label: string }[] = [
  { id: 'type', label: '类型' },
  { id: 'energy', label: '费用' },
  { id: 'color', label: '颜色' },
  { id: 'name', label: '名称' },
  { id: 'power', label: '战力' },
  { id: 'rarity', label: '稀有度' },
  { id: 'cardNo', label: '卡号' }
];

export interface DeckSortRule {
  id: string;
  field: DeckSortField;
  asc: boolean;
}

export const DEFAULT_DECK_SORT: DeckSortRule[] = [
  { id: 'sort-type', field: 'type', asc: true },
  { id: 'sort-energy', field: 'energy', asc: true },
  { id: 'sort-name', field: 'name', asc: true }
];

const STORAGE_KEY = 'rune.deckbuilder.detail.v1';
const TYPE_ORDER = ['传奇', '单位', '法术', '装备', '战场', '符文', '其他'] as const;
const RARITY_ORDER = ['普通', '不凡', '稀有', '史诗', '异画'] as const;

function rankOf(list: readonly string[], value: string): number {
  const found = list.indexOf(value);
  return found < 0 ? list.length : found;
}

function colorRank(hues: readonly string[]): number {
  if (!hues.length) return COLOR_ORDER.length;
  return Math.min(...hues.map((hue) => rankOf(COLOR_ORDER, hue)));
}

/** 卡号里带数字时按数字比，避免 OGN-100 < OGN-99。 */
function compareCardNo(a: string, b: string): number {
  const left = a.match(/^(.*?)(\d+)$/);
  const right = b.match(/^(.*?)(\d+)$/);
  if (left && right) {
    const prefix = left[1]!.localeCompare(right[1]!);
    return prefix || Number(left[2]) - Number(right[2]);
  }
  return a.localeCompare(b, 'zh-CN');
}

function valueOf(field: DeckSortField, entry: DeckEntry, index: CardIndex): string | number {
  const resolved = resolveEntry(entry, index);
  const base = resolved.record?.base;
  switch (field) {
    case 'type':
      return rankOf(TYPE_ORDER, resolved.record ? kind(resolved.record) : '其他');
    case 'energy':
      return base?.energy ?? 99;
    case 'color':
      return colorRank(base?.colors ?? []);
    case 'power':
      return base?.power ?? -1;
    case 'rarity':
      return rankOf(RARITY_ORDER, base?.rarity ?? '');
    case 'cardNo':
      return resolved.print?.cardNo ?? entry.cardNo;
    default:
      return entry.name;
  }
}

function compareValues(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'zh-CN');
}

export function activeSortRules(rules: readonly DeckSortRule[]): DeckSortRule[] {
  return rules.filter((rule) => DECK_SORT_FIELDS.some((field) => field.id === rule.field));
}

/** 多级排序；规则用尽时保持构筑时的原有顺序。 */
export function sortDeckEntries(
  entries: readonly DeckEntry[],
  index: CardIndex,
  rules: readonly DeckSortRule[]
): DeckEntry[] {
  const active = activeSortRules(rules);
  if (!active.length) return [...entries];
  return entries
    .map((entry, position) => ({
      entry,
      position,
      keys: active.map((rule) => valueOf(rule.field, entry, index))
    }))
    .sort((a, b) => {
      for (let i = 0; i < active.length; i++) {
        const rule = active[i]!;
        const result = compareValues(a.keys[i]!, b.keys[i]!);
        if (result) return rule.asc ? result : -result;
      }
      return a.position - b.position;
    })
    .map((item) => item.entry);
}

export function describeSort(rules: readonly DeckSortRule[]): string {
  const active = activeSortRules(rules);
  if (!active.length) return '构筑顺序';
  return active
    .map((rule) => {
      const label = DECK_SORT_FIELDS.find((field) => field.id === rule.field)?.label ?? rule.field;
      return `${label}${rule.asc ? '↑' : '↓'}`;
    })
    .join(' · ');
}

function normalizeRules(input: unknown): DeckSortRule[] {
  if (!Array.isArray(input)) return DEFAULT_DECK_SORT.map((rule) => ({ ...rule }));
  const valid = input
    .filter((rule): rule is DeckSortRule =>
      Boolean(rule) &&
      typeof rule === 'object' &&
      DECK_SORT_FIELDS.some((field) => field.id === (rule as DeckSortRule).field) &&
      typeof (rule as DeckSortRule).asc === 'boolean'
    )
    .map((rule, position) => ({ id: `sort-${position}`, field: rule.field, asc: rule.asc }));
  return valid.length ? valid : DEFAULT_DECK_SORT.map((rule) => ({ ...rule }));
}

/** 排序偏好按浏览器记，不跟着卡组走。 */
export function loadDeckSort(): DeckSortRule[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeRules(JSON.parse(raw)) : DEFAULT_DECK_SORT.map((rule) => ({ ...rule }));
  } catch {
    return DEFAULT_DECK_SORT.map((rule) => ({ ...rule }));
  }
}

export function saveDeckSort(rules: readonly DeckSortRule[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
  } catch {
    /* 隐私模式写不进去时只是不记忆 */
  }
}
