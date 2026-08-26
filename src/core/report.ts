/* ================================================================
 * src/core/report.ts
 *
 * 趋势周报引擎(v3 新增,v3.1 切名次转化口径,纯函数):
 *   - 把数据包按 ISO 周分组,对比最后两周,产出周报全部素材
 *   - KPI(数量/赛事/HHI)+ 热度升降榜 + 转化变化榜
 *   - 传奇热度 movers + 域对热度 movers
 *   - 周际时间线(各周英雄出场率/Top8率序列,供 MetaTimeline 线图)
 * 强度指标全部使用名次转化(转化综合分),不再使用胜率。
 * 无 DOM / Vue 依赖;视图层只消费 WeeklyReport。
 * ============================================================== */

import type { CardCatalog, Deck } from '@/types';
import { quickHeroRows } from './quickStats';
import { legendaryRows } from './legendaryStats';
import { wilsonLowerBoundPct } from './stats';
import { deltasFromRows, hhi, movers, type DeltaItem } from './delta';

export interface WeekPoint {
  label: string;
  sample: number;
  events: number;
}

export interface TimelineHero {
  hero: string;
  /** 每周出场率(%)序列,与 weeks 对齐;缺席为 null */
  pickRates: (number | null)[];
  /** 每周 Top8 率(%)序列 */
  top8Rates: (number | null)[];
}

export interface WeeklyReport {
  prevLabel: string;
  currLabel: string;
  weeks: WeekPoint[];
  prevSample: number;
  currSample: number;
  sampleDelta: number | null;
  prevEvents: number;
  currEvents: number;
  hhiPrev: number;
  hhiCurr: number;
  /** 热度上升 Top5 */
  popUp: DeltaItem<string>[];
  /** 热度下降 Top5 */
  popDown: DeltaItem<string>[];
  /** 转化综合分变化 Top8 */
  convertMovers: DeltaItem<string>[];
  /** 传奇热度 movers(按卡名聚合)Top8 */
  legMovers: DeltaItem<string>[];
  /** 域对热度 movers Top8 */
  domainMovers: DeltaItem<string>[];
  /** 周际时间线(Top6 英雄) */
  heroTimeline: TimelineHero[];
}

export interface ReportOptions {
  popTop?: number;
  convertTop?: number;
  legTop?: number;
  timelineHeroes?: number;
}

/** 把任意行按 key 聚合(通用小工具) */
export function aggregateBy<T, K>(
  rows: readonly T[],
  keyFn: (r: T) => K,
  valueFn: (r: T) => number
): Map<K, number> {
  const out = new Map<K, number>();
  for (const r of rows) {
    const k = keyFn(r);
    out.set(k, (out.get(k) ?? 0) + valueFn(r));
  }
  return out;
}

/**
 * 构建周报:按 ISO 周分组 → 最后两周对比。
 * 周次 < 2 时返回 null。
 */
export function buildWeeklyReport(
  allDecks: readonly Deck[],
  catalog: CardCatalog,
  opts: ReportOptions = {}
): WeeklyReport | null {
  const { popTop = 5, convertTop = 8, legTop = 8, timelineHeroes = 6 } = opts;

  // ── 按周分组 ──
  const byWeek = new Map<string, Deck[]>();
  for (const d of allDecks) {
    const k = d.week.label || '未知';
    const arr = byWeek.get(k);
    if (arr) arr.push(d);
    else byWeek.set(k, [d]);
  }
  const labels = [...byWeek.keys()].sort((a, b) => a.localeCompare(b));
  if (labels.length < 2) return null;
  const weeks: WeekPoint[] = labels.map((label) => {
    const decks = byWeek.get(label)!;
    return {
      label,
      sample: decks.length,
      events: new Set(decks.map((d) => d.activityName)).size
    };
  });

  const prevLabel = labels[labels.length - 2] as string;
  const currLabel = labels[labels.length - 1] as string;
  const prevG = byWeek.get(prevLabel)!;
  const currG = byWeek.get(currLabel)!;

  // ── 英雄维度 ──
  const prevHeroes = quickHeroRows(prevG, prevG.length);
  const currHeroes = quickHeroRows(currG, currG.length);
  // 热度一律用威尔逊下界(95% 置信):同出场率下样本越大分数越高,低样本"假热度"自动下沉
  const toRows = (rows: ReturnType<typeof quickHeroRows>) =>
    rows.map((x): { key: string; value: number; sample: number } => ({
      key: x.hero,
      value: x.wilson ?? x.popularity,
      sample: x.total
    }));
  const popItems = deltasFromRows(toRows(prevHeroes), toRows(currHeroes));
  const convertItems = deltasFromRows(
    prevHeroes.map((x): { key: string; value: number; sample: number } => ({
      key: x.hero,
      value: x.convert,
      sample: x.total
    })),
    currHeroes.map((x): { key: string; value: number; sample: number } => ({
      key: x.hero,
      value: x.convert,
      sample: x.total
    }))
  );

  // ── 传奇 / 域对维度(按周)──
  const legPrev = legendaryRows(prevG, catalog, prevG.length);
  const legCurr = legendaryRows(currG, catalog, currG.length);
  const legPopPrev = aggregateBy(legPrev, (r) => r.name, (r) => r.total);
  const legPopCurr = aggregateBy(legCurr, (r) => r.name, (r) => r.total);
  // 热度占比 → 威尔逊下界(%),口径与英雄热度一致
  const toWilson = (m: Map<string, number>, total: number) =>
    new Map(
      [...m.entries()].map(([k, v]) => [k, total > 0 ? wilsonLowerBoundPct(v, total) : 0])
    );
  const legItems = deltasFromRows(
    [...toWilson(legPopPrev, prevG.length)].map(([key, value]) => ({ key, value, sample: legPopPrev.get(key) ?? 0 })),
    [...toWilson(legPopCurr, currG.length)].map(([key, value]) => ({ key, value, sample: legPopCurr.get(key) ?? 0 }))
  );
  const domainPrev = aggregateBy(legPrev, (r) => r.colors.join('+'), (r) => r.total);
  const domainCurr = aggregateBy(legCurr, (r) => r.colors.join('+'), (r) => r.total);
  const domainItems = deltasFromRows(
    [...toWilson(domainPrev, prevG.length)].map(([key, value]) => ({ key, value, sample: domainPrev.get(key) ?? 0 })),
    [...toWilson(domainCurr, currG.length)].map(([key, value]) => ({ key, value, sample: domainCurr.get(key) ?? 0 }))
  );

  // ── 时间线:Top6 英雄的周际出场率/Top8率 ──
  const weekHeroes = labels.map((label) => {
    const decks = byWeek.get(label)!;
    return { label, rows: quickHeroRows(decks, decks.length) };
  });
  const pickByWeek = new Map<string, Map<string, number>>();
  const top8ByWeek = new Map<string, Map<string, number | null>>();
  const totalPick = new Map<string, number>();
  for (const { label, rows } of weekHeroes) {
    const p = new Map<string, number>();
    const t = new Map<string, number | null>();
    for (const r of rows) {
      p.set(r.hero, r.popularity);
      t.set(r.hero, r.top8Rate);
      totalPick.set(r.hero, (totalPick.get(r.hero) ?? 0) + r.popularity);
    }
    pickByWeek.set(label, p);
    top8ByWeek.set(label, t);
  }
  const topHeroes = [...totalPick.entries()].sort((a, b) => b[1] - a[1]).slice(0, timelineHeroes);
  const heroTimeline: TimelineHero[] = topHeroes.map(([hero]) => ({
    hero,
    pickRates: labels.map((l) => pickByWeek.get(l)?.get(hero) ?? null),
    top8Rates: labels.map((l) => top8ByWeek.get(l)?.get(hero) ?? null)
  }));

  // ── KPI ──
  const hhiPrev = hhi(prevHeroes.map((x) => ({ rate: x.popularity })));
  const hhiCurr = hhi(currHeroes.map((x) => ({ rate: x.popularity })));

  return {
    prevLabel,
    currLabel,
    weeks,
    prevSample: prevG.length,
    currSample: currG.length,
    sampleDelta: prevG.length > 0 ? ((currG.length - prevG.length) / prevG.length) * 100 : null,
    prevEvents: weeks[weeks.length - 2]?.events ?? 0,
    currEvents: weeks[weeks.length - 1]?.events ?? 0,
    hhiPrev,
    hhiCurr,
    popUp: movers(popItems, { direction: 'up', topN: popTop }),
    popDown: movers(popItems, { direction: 'down', topN: popTop }),
    convertMovers: movers(convertItems, { topN: convertTop }),
    legMovers: movers(legItems, { topN: legTop }),
    domainMovers: movers(domainItems, { topN: legTop }),
    heroTimeline
  };
}
