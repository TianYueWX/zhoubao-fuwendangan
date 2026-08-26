/* ================================================================
 * src/core/delta.ts
 *
 * 周环比对比引擎(v3 新增,多包/周报模式的通用底座):
 *   - 两组同构指标(前期 prev / 本期 curr)按 key 对齐
 *   - 输出:Δpp(百分点差)、名次变动、样本量、显著性标记
 *   - movers():升降榜提取(周报叙事用)
 * 纯函数,无 DOM / Vue 依赖。
 * ============================================================== */

/** 单条目环比结果 */
export interface DeltaItem<K = string> {
  key: K;
  /** 前期值(百分点) */
  prev: number | null;
  /** 本期值(百分点) */
  curr: number | null;
  /** Δpp = curr - prev(百分点),任一为空则 null */
  delta: number | null;
  /** 前期名次(1-based,按 prev 降序) */
  prevRank: number | null;
  /** 本期名次(1-based,按 curr 降序) */
  currRank: number | null;
  /** 名次变动(负 = 上升,如 -3 表示升 3 位) */
  rankChange: number | null;
  /** 前期样本数 */
  prevSample: number;
  /** 本期样本数 */
  currSample: number;
  /** 是否可信:|Δpp| ≥ minAbsDelta 且本期样本 ≥ minSample */
  significant: boolean;
}

export interface DeltaOptions {
  /** 显著性:Δpp 绝对值下限(默认 0.5) */
  minAbsDelta?: number;
  /** 显著性:本期样本下限(默认 10) */
  minSample?: number;
}

/** 把 {key → 值} 对齐成环比条目 */
export function buildDeltas<K>(
  prev: ReadonlyMap<K, number>,
  curr: ReadonlyMap<K, number>,
  prevSamples?: ReadonlyMap<K, number>,
  currSamples?: ReadonlyMap<K, number>,
  opts: DeltaOptions = {}
): DeltaItem<K>[] {
  const { minAbsDelta = 0.5, minSample = 10 } = opts;
  const keys = new Set<K>([...prev.keys(), ...curr.keys()]);

  // 名次:值降序
  function ranks(map: ReadonlyMap<K, number>): Map<K, number> {
    const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]);
    const out = new Map<K, number>();
    sorted.forEach(([k], i) => out.set(k, i + 1));
    return out;
  }
  const prevRanks = ranks(prev);
  const currRanks = ranks(curr);

  const items: DeltaItem<K>[] = [];
  for (const key of keys) {
    const p = prev.get(key) ?? null;
    const c = curr.get(key) ?? null;
    const prevSample = prevSamples?.get(key) ?? 0;
    const currSample = currSamples?.get(key) ?? 0;
    const delta = p != null && c != null ? c - p : null;
    const pr = prevRanks.get(key) ?? null;
    const cr = currRanks.get(key) ?? null;
    items.push({
      key,
      prev: p,
      curr: c,
      delta,
      prevRank: pr,
      currRank: cr,
      rankChange: pr != null && cr != null ? pr - cr : null,
      prevSample,
      currSample,
      significant:
        delta != null &&
        Math.abs(delta) >= minAbsDelta &&
        currSample >= minSample
    });
  }
  return items;
}

/** 从两组"行"构建环比(行需含 key 与 value 字段,便于与 quickHeroRows 等对接) */
export interface DeltaRowLike<K> {
  key: K;
  value: number | null;
  sample: number;
}

export function deltasFromRows<K>(
  prevRows: readonly DeltaRowLike<K>[],
  currRows: readonly DeltaRowLike<K>[],
  opts?: DeltaOptions
): DeltaItem<K>[] {
  const toMap = (rows: readonly DeltaRowLike<K>[]) => {
    const v = new Map<K, number>();
    const s = new Map<K, number>();
    for (const r of rows) {
      if (r.value != null) v.set(r.key, r.value);
      s.set(r.key, r.sample);
    }
    return { v, s };
  };
  const p = toMap(prevRows);
  const c = toMap(currRows);
  return buildDeltas(p.v, c.v, p.s, c.s, opts);
}

export interface MoversOptions {
  /** 升降方向:up(本期更高)/ down(本期更低)/ all */
  direction?: 'up' | 'down' | 'all';
  /** 只取显著条目 */
  significantOnly?: boolean;
  /** 返回条数 */
  topN?: number;
}

/** 升降榜:按 Δpp 绝对值降序取前 N */
export function movers<K>(
  items: readonly DeltaItem<K>[],
  opts: MoversOptions = {}
): DeltaItem<K>[] {
  const { direction = 'all', significantOnly = true, topN = 5 } = opts;
  return items
    .filter((it) => it.delta != null)
    .filter((it) => (significantOnly ? it.significant : true))
    .filter((it) => {
      if (direction === 'up') return it.delta! > 0;
      if (direction === 'down') return it.delta! < 0;
      return true;
    })
    .sort((a, b) => Math.abs(b.delta!) - Math.abs(a.delta!))
    .slice(0, topN);
}

/** Meta 集中度(HHI = Σ 出场率²,0-10000 区间),用于周报叙事 */
export function hhi(pickRates: readonly { rate: number }[]): number {
  const sum = pickRates.reduce((s, r) => s + r.rate * r.rate, 0);
  return sum;
}
