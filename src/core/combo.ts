/* ================================================================
 * src/core/combo.ts
 *
 * Combo 羁绊挖掘 —— 基于关联规则的 Lift 提升度指标
 *
 *   Lift(A, B) = P(A ∩ B) / ( P(A) × P(B) )
 *
 * - lift = 1      → 独立,无关联
 * - lift > 1      → 正相关(常见于战术配合)
 * - lift < 1      → 负相关(互斥)
 *
 * 仅当 Lift ≥ minLift(默认 1.2)且 A、B 各自基础携带率均不低于
 * minBase(默认 0.15)时输出,大幅过滤"万金油"卡的伪共现。
 * 符文卡直接剔除,不参与计算。
 * ============================================================== */

import type { CardCategory, CardCatalog, ComboResult, Deck } from '@/types';

export interface ComboOptions {
  /** 双向最低基础携带率 */
  minBase: number;
  /** Lift 阈值 */
  minLift: number;
  /** 最小同现套数(默认 2,过滤噪声) */
  minCount?: number;
}

export const DEFAULT_COMBO_OPTIONS: Readonly<ComboOptions> = Object.freeze({
  minBase: 0.15,
  minLift: 1.2
});

export function computeCombos(
  decks: readonly Deck[],
  catalog: CardCatalog,
  options: Partial<ComboOptions> = {}
): ComboResult[] {
  const opts: ComboOptions = { ...DEFAULT_COMBO_OPTIONS, ...options };
  const nTop = decks.length;
  if (nTop === 0) return [];

  // 1) 统计每张卡(排除符文)的出现卡组数
  const cardCount = new Map<string, number>();
  const deckFilteredIds: string[][] = [];

  for (const deck of decks) {
    const ids: string[] = [];
    for (const id of deck.cards.keys()) {
      if (catalog.cardCategory.get(id) === ('符文' as CardCategory)) continue;
      ids.push(id);
      cardCount.set(id, (cardCount.get(id) ?? 0) + 1);
    }
    deckFilteredIds.push(ids);
  }

  // 2) 基础携带率门槛,过滤低频卡
  const thresholdCount = nTop * opts.minBase;
  const validCards = new Set<string>();
  for (const [id, count] of cardCount) {
    if (count >= thresholdCount) validCards.add(id);
  }
  if (validCards.size < 2) return [];

  // 3) 统计 pairwise 同现 → 用排序拼接作为去重 key
  const comboCount = new Map<string, number>();
  for (const ids of deckFilteredIds) {
    const filtered: string[] = [];
    for (const id of ids) {
      if (validCards.has(id)) filtered.push(id);
    }
    if (filtered.length < 2) continue;

    // 排序后用 <a, b> 唯一表示,避免 (i,j)/(j,i) 重复计数
    const sorted = filtered.slice().sort();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i]!;
        const b = sorted[j]!;
        const key = pairKey(a, b);
        comboCount.set(key, (comboCount.get(key) ?? 0) + 1);
      }
    }
  }

  // 4) 计算 Lift & 输出
  const results: ComboResult[] = [];
  for (const [key, count] of comboCount) {
    const { a, b } = parseKey(key);
    const countA = cardCount.get(a) ?? 0;
    const countB = cardCount.get(b) ?? 0;
    if (countA === 0 || countB === 0) continue;

    const pA = countA / nTop;
    const pB = countB / nTop;
    const pAB = count / nTop;
    const denom = pA * pB;
    if (denom === 0) continue;

    const lift = pAB / denom;
    if (lift < opts.minLift) continue;
    if (count < (opts.minCount ?? 2)) continue;

    results.push({
      a,
      b,
      nameA: catalog.cardDict.get(a) ?? a,
      nameB: catalog.cardDict.get(b) ?? b,
      count,
      countA,
      countB,
      lift,
      coRate: count / countA * 100,
      coRateReverse: count / countB * 100
    });
  }

  // 5) Lift 降序,相等时按 count 降序
  results.sort((x, y) =>
    y.lift - x.lift || y.count - x.count || x.nameA.localeCompare(y.nameA)
  );
  return results;
}

/* ============================================================
 * Key helpers:用 (sorted_a, sorted_b) 唯一表示一对
 * ============================================================ */

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function parseKey(key: string): { a: string; b: string } {
  const idx = key.indexOf('|');
  if (idx < 0) return { a: key, b: '' };
  return { a: key.slice(0, idx), b: key.slice(idx + 1) };
}
