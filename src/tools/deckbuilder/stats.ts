import {
  LABELS,
  LIMITS,
  ZONES,
  kind,
  resolveEntry,
  type BuilderDeck,
  type CardIndex,
  type Zone
} from './model';

export interface DeckStats {
  costs: [string, number][];
  colors: [string, number][];
  types: [string, number][];
  maximum: number;
}

export interface DeckZoneCount {
  zone: Zone;
  label: string;
  used: number;
  limit: number;
}

/** 费用曲线 / 颜色分布 / 类型分布；`includeSide` 决定备牌是否算进曲线。 */
export function deckStats(
  deck: BuilderDeck,
  index: CardIndex,
  includeSide: boolean
): DeckStats {
  const costs = new Map<string, number>();
  const colors = new Map<string, number>();
  const types = new Map<string, number>();
  const zones = includeSide
    ? (['champion', 'main', 'side'] as const)
    : (['champion', 'main'] as const);
  for (const zone of zones) {
    for (const entry of deck.zones[zone]) {
      const record = resolveEntry(entry, index).record;
      const cost = record?.base.energy == null ? '?' : String(record.base.energy);
      const type = record ? kind(record) : '未识别';
      costs.set(cost, (costs.get(cost) ?? 0) + entry.quantity);
      types.set(type, (types.get(type) ?? 0) + entry.quantity);
      const hues = record?.base.colors.length ? record.base.colors : ['colorless'];
      for (const color of hues) colors.set(color, (colors.get(color) ?? 0) + entry.quantity);
    }
  }
  return {
    costs: [...costs].sort((a, b) => Number(a[0]) - Number(b[0])),
    colors: [...colors],
    types: [...types],
    maximum: Math.max(1, ...costs.values())
  };
}

/** 各分区张数与上限，用于详情页的概览。 */
export function deckOverview(deck: BuilderDeck): DeckZoneCount[] {
  return ZONES.map((zone) => ({
    zone,
    label: LABELS[zone],
    used: deck.zones[zone].reduce((sum, entry) => sum + entry.quantity, 0),
    limit: LIMITS[zone]
  }));
}
