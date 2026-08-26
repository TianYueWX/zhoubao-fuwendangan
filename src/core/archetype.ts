/* ================================================================
 * src/core/archetype.ts
 *
 * 流派聚类 —— 基于 Jaccard 相似度的贪心聚类
 *
 *  1. 把每套卡组的"卡牌 ID 集合"两两算 Jaccard 相似度
 *  2. 计算每套卡组的平均相似度作为"中心度"
 *  3. 取中心度最高且未分配的卡组作种子,贪心扩展
 *     (sim >= jaccardMin) → 一支流派
 *  4. 重复最多 archMax 次
 *  5. 剩余卡组若 >= minClusterSize,合并为"其他"
 * ============================================================== */

import type {
  Archetype,
  ArchetypeCoreCard,
  ArchetypeResult,
  CardCatalog,
  HeroStats
} from '@/types';
import { pickChartColor } from '@/utils/palette';

export type { Archetype, ArchetypeCoreCard, ArchetypeResult };

export interface ArchetypeOptions {
  jaccardMin: number;
  archMax: number;
}

export const DEFAULT_ARCHETYPE_OPTIONS: Readonly<ArchetypeOptions> = Object.freeze({
  jaccardMin: 0.55,
  archMax: 3
});

const LABELS = ['A', 'B', 'C', 'D', 'E', 'F'];

export function buildArchetypes(
  heroStat: HeroStats,
  catalog: CardCatalog,
  opts: Partial<ArchetypeOptions> = {}
): ArchetypeResult | null {
  const jaccardMin = opts.jaccardMin ?? DEFAULT_ARCHETYPE_OPTIONS.jaccardMin;
  const archMax = opts.archMax ?? DEFAULT_ARCHETYPE_OPTIONS.archMax;

  const decks = heroStat.topDecks;
  if (!decks || decks.length < 6) return null;
  const n = decks.length;
  const minClusterSize = Math.max(3, Math.ceil(n * 0.08));

  // 1) 每套卡组的卡牌集合
  const sets: ReadonlySet<string>[] = decks.map((d) => new Set(d.cards.keys()));

  // 2) Pairwise Jaccard
  const sim: number[][] = [];
  for (let i = 0; i < n; i++) sim.push(new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s = jaccard(sets[i]!, sets[j]!);
      const rowI = sim[i]!;
      const rowJ = sim[j]!;
      rowI[j] = s;
      rowJ[i] = s;
    }
  }

  // 3) 中心度(平均相似度)
  const centrality: number[] = [];
  for (let i = 0; i < n; i++) {
    let sum = 0;
    const row = sim[i]!;
    for (let j = 0; j < n; j++) {
      if (i !== j) sum += row[j] ?? 0;
    }
    centrality.push(sum / Math.max(1, n - 1));
  }

  // 4) 贪心聚类
  const assigned = new Array<number>(n).fill(-1);
  const clusters: number[][] = [];

  for (let c = 0; c < archMax; c++) {
    let seed = -1;
    let best = -Infinity;
    for (let i = 0; i < n; i++) {
      if (assigned[i] === -1 && centrality[i]! > best) {
        best = centrality[i]!;
        seed = i;
      }
    }
    if (seed === -1) break;

    const members: number[] = [seed];
    assigned[seed] = c;
    const seedRow = sim[seed]!;
    for (let i = 0; i < n; i++) {
      if (assigned[i] === -1 && (seedRow[i] ?? 0) >= jaccardMin) {
        assigned[i] = c;
        members.push(i);
      }
    }

    if (members.length < minClusterSize) {
      for (const m of members) assigned[m] = -1;
      break;
    }
    clusters.push(members);
  }

  if (clusters.length === 0) return null;

  // 5) "其他"分簇
  const rest: number[] = [];
  for (let i = 0; i < n; i++) {
    if (assigned[i] === -1) rest.push(i);
  }

  function summarize(memberIdx: number[], label: string, color: string): Archetype {
    const usage = new Map<string, number>();
    let rankSum = 0;
    let rankCnt = 0;

    for (const mi of memberIdx) {
      const deck = decks[mi]!;
      for (const [id, count] of deck.cards) {
        usage.set(id, (usage.get(id) ?? 0) + count);
      }
      if (deck.rank !== Number.MAX_SAFE_INTEGER && deck.rank >= 1) {
        rankSum += deck.rank;
        rankCnt += 1;
      }
    }

    const coreCards: ArchetypeCoreCard[] = Array.from(usage.entries())
      .map(([id, count]) => ({
        id,
        name: catalog.cardDict.get(id) ?? id,
        rate: memberIdx.length > 0 ? (count / memberIdx.length) * 100 : 0
      }))
      .sort((a, b) => b.rate - a.rate || a.id.localeCompare(b.id))
      .slice(0, 8);

    return {
      name: label,
      color,
      count: memberIdx.length,
      share: (memberIdx.length / n) * 100,
      avgRank: rankCnt > 0 ? rankSum / rankCnt : null,
      coreCards
    };
  }

  const result: Archetype[] = clusters.map((members, k) =>
    summarize(members, `流派 ${LABELS[k] ?? String(k + 1)}`, pickChartColor(k))
  );

  if (rest.length >= minClusterSize) {
    result.push(summarize(rest, '其他', '#9ca3af'));
  }

  return { list: result, sampleSize: n, jacMin: jaccardMin };
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}
