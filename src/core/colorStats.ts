/* ================================================================
 * src/core/colorStats.ts
 *
 * 颜色域 / 域对统计(Riftbound Domain Identity):
 *   - 每套卡组的传奇(1 张)定义双色域 → 域对分布
 *   - 主卡组(排除符文/战场)六色张数占比
 *   - 按周次追踪颜色趋势
 * ============================================================== */

import type {
  CardCatalog,
  CardColor,
  ColorStatsResult,
  Deck,
  DomainPairStat
} from '@/types';
import { CARD_COLOR_LABELS } from '@/types';

const ALL_COLORS: readonly CardColor[] = ['red', 'green', 'blue', 'yellow', 'purple', 'orange'];

function pairLabel(colors: readonly CardColor[]): string {
  return colors.map((c) => CARD_COLOR_LABELS[c]).join('·');
}

export function computeColorStats(
  decks: readonly Deck[],
  catalog: CardCatalog,
  weeks: readonly { label: string }[]
): ColorStatsResult {
  const pairDecks = new Map<string, { colors: CardColor[]; decks: number }>();
  const colorCopies = new Map<CardColor, number>();
  const weekly = new Map<string, Map<CardColor, number>>();
  for (const w of weeks) {
    weekly.set(w.label, new Map<CardColor, number>());
  }
  let identifiedDecks = 0;

  for (const d of decks) {
    // ── 1) 域对:找传奇卡的 colors ──
    let pair: CardColor[] | null = null;
    for (const id of d.cards.keys()) {
      if (catalog.cardCategory.get(id) === '传奇') {
        const cs = catalog.cardColors.get(id);
        if (cs && cs.length >= 1) {
          pair = [...cs].filter((c): c is CardColor => c !== 'colorless').sort();
          break;
        }
      }
    }
    if (pair && pair.length >= 1) {
      identifiedDecks++;
      const key = pair.join('|');
      const prev = pairDecks.get(key);
      if (prev) prev.decks += 1;
      else pairDecks.set(key, { colors: pair, decks: 1 });
    }

    // ── 2) 六色张数(排除符文/战场;含传奇/英雄单位/单位/法术/装备/其他)──
    const weekColors = weekly.get(d.week.label);
    for (const [id, count] of d.cards) {
      const cat = catalog.cardCategory.get(id);
      if (cat === '符文' || cat === '战场') continue;
      const cs = catalog.cardColors.get(id);
      if (!cs) continue;
      for (const c of cs) {
        colorCopies.set(c, (colorCopies.get(c) ?? 0) + count);
        weekColors?.set(c, (weekColors.get(c) ?? 0) + count);
      }
    }
  }

  const totalForShare = identifiedDecks || 1;
  const pairs: DomainPairStat[] = Array.from(pairDecks.values())
    .map((p) => ({
      label: pairLabel(p.colors),
      colors: p.colors,
      decks: p.decks,
      share: (p.decks / totalForShare) * 100
    }))
    .sort((a, b) => b.decks - a.decks);

  return {
    pairs,
    colorCopies,
    weeklyColors: Array.from(weekly.entries()).map(([week, colors]) => ({
      week,
      colors
    })),
    identifiedDecks
  };
}
