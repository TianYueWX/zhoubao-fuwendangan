/* ================================================================
 * src/core/report.ts
 *
 * 趋势周报引擎(v3 新增,纯函数):
 *   - 把数据包按 ISO 周分组,对比最后两周,产出周报全部素材
 *   - KPI(样本/赛事/环境胜率/HHI)+ 热度升降榜 + 胜率变化榜
 *   - 传奇热度 movers + 域对热度 movers
 *   - 周际时间线(各周英雄出场率/胜率序列,供 MetaTimeline 线图)
 * 无 DOM / Vue 依赖;视图层只消费 WeeklyReport。
 * ============================================================== */

import type { CardCatalog, Deck } from '@/types';
import { quickHeroRows } from './quickStats';
import { legendaryRows } from './legendaryStats';
import { envPriorWinRate } from './stats';
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
  /** 每周胜率(%)序列(收缩值) */
  winRates: (number | null)[];
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
  envPrev: number | null;
  envCurr: number | null;
  envDelta: number | null;
  hhiPrev: number;
  hhiCurr: number;
  /** 热度上升 Top5 */
  popUp: DeltaItem<string>[];
  /** 热度下降 Top5 */
  popDown: DeltaItem<string>[];
  /** 胜率变化 Top8 */
  winMovers: DeltaItem<string>[];
  /** 传奇热度 movers(按卡名聚合)Top8 */
  legMovers: DeltaItem<string>[];
  /** 域对热度 movers Top8 */
  domainMovers: DeltaItem<string>[];
  /** 周际时间线(Top6 英雄) */
  heroTimeline: TimelineHero[];
}

export interface ReportOptions {
  popTop?: number;
  winTop?: number;
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
  hasWinData: boolean,
  catalog: CardCatalog,
  opts: ReportOptions = {}
): WeeklyReport | null {
  const { popTop = 5, winTop = 8, legTop = 8, timelineHeroes = 6 } = opts;

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
  const prevHeroes = quickHeroRows(prevG, prevG.length, hasWinData);
  const currHeroes = quickHeroRows(currG, currG.length, hasWinData);
  const toRows = (rows: ReturnType<typeof quickHeroRows>) =>
    rows.map((x): { key: string; value: number; sample: number } => ({
      key: x.hero,
      value: x.popularity,
      sample: x.total
    }));
  const popItems = deltasFromRows(toRows(prevHeroes), toRows(currHeroes));
  const winItems = deltasFromRows(
    prevHeroes.map((x): { key: string; value: number; sample: number } => ({
      key: x.hero,
      value: x.winRate ?? x.top8Rate,
      sample: x.total
    })),
    currHeroes.map((x): { key: string; value: number; sample: number } => ({
      key: x.hero,
      value: x.winRate ?? x.top8Rate,
      sample: x.total
    }))
  );

  // ── 传奇 / 域对维度(按周)──
  const legPrev = legendaryRows(prevG, catalog, prevG.length);
  const legCurr = legendaryRows(currG, catalog, currG.length);
  const legPopPrev = aggregateBy(legPrev, (r) => r.name, (r) => r.total);
  const legPopCurr = aggregateBy(legCurr, (r) => r.name, (r) => r.total);
  const toPct = (m: Map<string, number>, total: number) =>
    new Map([...m.entries()].map(([k, v]) => [k, (v / Math.max(total, 1)) * 100]));
  const legItems = deltasFromRows(
    [...toPct(legPopPrev, prevG.length)].map(([key, value]) => ({ key, value, sample: legPopPrev.get(key) ?? 0 })),
    [...toPct(legPopCurr, currG.length)].map(([key, value]) => ({ key, value, sample: legPopCurr.get(key) ?? 0 }))
  );
  const domainPrev = aggregateBy(legPrev, (r) => r.colors.join('+'), (r) => r.total);
  const domainCurr = aggregateBy(legCurr, (r) => r.colors.join('+'), (r) => r.total);
  const domainItems = deltasFromRows(
    [...toPct(domainPrev, prevG.length)].map(([key, value]) => ({ key, value, sample: domainPrev.get(key) ?? 0 })),
    [...toPct(domainCurr, currG.length)].map(([key, value]) => ({ key, value, sample: domainCurr.get(key) ?? 0 }))
  );

  // ── 时间线:Top6 英雄的周际出场率/胜率 ──
  const weekHeroes = labels.map((label) => {
    const decks = byWeek.get(label)!;
    return { label, rows: quickHeroRows(decks, decks.length, hasWinData) };
  });
  const pickByWeek = new Map<string, Map<string, number>>();
  const winByWeek = new Map<string, Map<string, number | null>>();
  const totalPick = new Map<string, number>();
  for (const { label, rows } of weekHeroes) {
    const p = new Map<string, number>();
    const w = new Map<string, number | null>();
    for (const r of rows) {
      p.set(r.hero, r.popularity);
      w.set(r.hero, r.winRate);
      totalPick.set(r.hero, (totalPick.get(r.hero) ?? 0) + r.popularity);
    }
    pickByWeek.set(label, p);
    winByWeek.set(label, w);
  }
  const topHeroes = [...totalPick.entries()].sort((a, b) => b[1] - a[1]).slice(0, timelineHeroes);
  const heroTimeline: TimelineHero[] = topHeroes.map(([hero]) => ({
    hero,
    pickRates: labels.map((l) => pickByWeek.get(l)?.get(hero) ?? null),
    winRates: labels.map((l) => winByWeek.get(l)?.get(hero) ?? null)
  }));

  // ── KPI ──
  const envPrev = envPriorWinRate(prevG);
  const envCurr = envPriorWinRate(currG);
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
    envPrev,
    envCurr,
    envDelta: envPrev != null && envCurr != null ? (envCurr - envPrev) * 100 : null,
    hhiPrev,
    hhiCurr,
    popUp: movers(popItems, { direction: 'up', topN: popTop }),
    popDown: movers(popItems, { direction: 'down', topN: popTop }),
    winMovers: movers(winItems, { topN: winTop }),
    legMovers: movers(legItems, { topN: legTop }),
    domainMovers: movers(domainItems, { topN: legTop }),
    heroTimeline
  };
}
