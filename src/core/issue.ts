/* ================================================================
 * src/core/issue.ts
 *
 * 「期号」模型(期刊内容层,纯函数,无 Vue 依赖)
 *
 * 一个数据包 = 期刊的一期。本模块把包的分析结果(sample/日期/统计引擎输出)
 * 翻译成博客式首页与期号正文页需要的结构化内容:
 *   - IssueBrief    往期卡片:期号 / 发布日期 / 日期区间 / 3 条要点 / 摘要句
 *   - IssueArticle  期号正文:头条标题 + 导语 + 统计行 + 分节(段落/榜单/表格)
 *
 * 全部数字来自现有引擎(quickStats / legendaryStats / report / delta),
 * 不重算口径、不引入外部数据。文案为模板生成的事实陈述。
 * ============================================================== */

import { buildWeeklyReport } from './report';
import { legendaryRows, sortLegendaryRows, MIN_LEGEND_SAMPLE } from './legendaryStats';
import { quickHeroRows } from './quickStats';
import { hhi } from './delta';
import type { DeltaItem } from './delta';
import type { AnalysisResult, Deck, WeekBucket } from '@/types';

/* ────────────────────────────── 类型 ────────────────────────────── */

export interface IssueStat {
  label: string;
  value: string;
  sub?: string;
}

export interface IssueDelta {
  label: string;
  /** 环比差值(百分点) */
  delta: number | null;
  prev?: string;
  curr?: string;
}

export interface IssueListItem {
  key: string;
  /** 当期值 */
  curr: number | null;
  /** 上期值 */
  prev: number | null;
  delta: number | null;
  /** 名次变动文案(如「名次 3→1」),无则 '' */
  rankNote: string;
}

export interface IssueBullet {
  /** ▲ / ▼ / ·
   */
  mark: string;
  text: string;
  /** 环比差值,用于着色;null 不着色 */
  delta?: number | null;
}

export type IssueSection =
  | { kind: 'paragraph'; title?: string; text: string }
  | { kind: 'list'; title: string; note?: string; items: IssueListItem[] }
  | { kind: 'table'; title: string; note?: string; columns: string[]; rows: string[][] }
  | { kind: 'chart'; title: string; note?: string; chart: 'timeline' };

export interface IssueBrief {
  id: string;
  /** 期号(如「第 3 期」) */
  issueNo: string;
  /** 刊名(如「第四赛季 · 第三周」) */
  label: string;
  /** 拉丁铭文副标(如「Vol. 3 · WEEK 35」) */
  roman: string;
  /** 发布日期(数据包内最新赛事日期) */
  pubDate: string;
  /** 日期区间文案(如「2026-08-17 — 2026-08-23」) */
  dateRangeText: string;
  sample: number;
  eventCount: number;
  cityCount: number;
  heroCount: number;
  /** 头条标题 */
  headline: string;
  /** 导语 */
  lead: string;
  /** 卡片要点(最多 3 条) */
  bullets: IssueBullet[];
  stats: IssueStat[];
  deltas: IssueDelta[];
}

export interface IssueArticle extends IssueBrief {
  subtitle: string;
  sections: IssueSection[];
  /** 免责与口径 */
  footnote: string;
}

/* ──────────────────────────── 工具函数 ──────────────────────────── */

/** 'YYYY-MM-DD' → 'MM-DD';空值/非法值原样返回 */
export function shortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${m[2]}-${m[3]}` : iso || '';
}

function issueWeeks(decks: readonly Deck[]): WeekBucket[] {
  const seen = new Map<string, WeekBucket>();
  for (const d of decks) if (d.week.label && !seen.has(d.week.label)) seen.set(d.week.label, d.week);
  return [...seen.values()];
}

/**
 * 刊期日期区间:与周次分组同源(卡组行日期),events 元数据仅作兜底。
 * 与 store.summarizeResult 口径一致 —— 否则同一期会出现"周次是第 N 周、日期却是上周"的矛盾。
 */
function dateRangeOf(result: AnalysisResult): string {
  const deckDates = result.allDecks
    .map((d) => d.date)
    .filter((x): x is string => !!x)
    .sort();
  const dates =
    deckDates.length > 0
      ? deckDates
      : ((result.events.map((e) => e.date).filter(Boolean) as string[]).sort());
  if (dates.length === 0) return '';
  return dates.length === 1 ? dates[0]! : `${dates[0]} — ${dates[dates.length - 1]}`;
}

/** 环比徽章文案:「名次 3→1」 */
function rankNote(it: DeltaItem<string>): string {
  if (it.prevRank == null || it.currRank == null || it.prevRank === it.currRank) return '';
  return `名次 ${it.prevRank}→${it.currRank}`;
}

function toListItems(items: readonly DeltaItem<string>[], limit: number): IssueListItem[] {
  return items
    .filter((it) => it.delta != null && Math.abs(it.delta) >= 0.05)
    .slice(0, limit)
    .map((it) => ({
      key: it.key,
      curr: it.curr,
      prev: it.prev,
      delta: it.delta,
      rankNote: rankNote(it)
    }));
}

const fmtPct = (v: number | null | undefined): string =>
  v == null ? '—' : `${v.toFixed(1)}%`;

/* ──────────────────────────── 期号正文 ──────────────────────────── */

export interface BuildIssueOptions {
  /** 期号(该包在归档中的序号,从 1 开始) */
  issueNo: number;
  /** 拉丁铭文副标,默认按期号生成 */
  roman?: string;
}

/**
 * 为一个数据包生成完整期号正文。
 * @param id    包 id(路由用)
 * @param label 刊名
 * @param result 该包的分析结果
 */
export function buildIssueArticle(
  id: string,
  label: string,
  result: AnalysisResult,
  opts: BuildIssueOptions
): IssueArticle {
  const decks = result.allDecks;
  const sample = decks.length;
  const weeks = issueWeeks(decks);
  const latestWeek = weeks.length ? weeks[weeks.length - 1]!.label : '';
  /** 周报:周次 < 2 时为 null(单期包没有环比) */
  const report = buildWeeklyReport(decks, result.catalog);
  const heroes = quickHeroRows(decks, result.totalDecks);
  const heroCount = heroes.length;
  const dateRangeText = dateRangeOf(result);
  const pubDate = dateRangeText.includes('—')
    ? dateRangeText.split('—')[1]!.trim()
    : dateRangeText;

  /* 头条传奇:与总览「综合表现榜」同口径(metaScore) */
  const minSample = Math.max(MIN_LEGEND_SAMPLE, Math.floor(sample * 0.02));
  const legends = sortLegendaryRows(
    legendaryRows(decks, result.catalog, result.totalDecks),
    'metaScore',
    minSample
  );
  const topLeg = legends[0] ?? null;
  const topLegHero = topLeg ? (topLeg.topHero && topLeg.topHero !== '—' ? topLeg.topHero : topLeg.name) : '';

  /* 最多出场英雄(本周热度第一) */
  const hottestHero = heroes.slice().sort((a, b) => b.total - a.total)[0] ?? null;

  /* 三条要点:头条 · 最大热度变化 · 集中度 */
  const bullets: IssueBullet[] = [];
  if (topLeg) {
    bullets.push({
      mark: '·',
      text: `综合表现榜首 ${topLegHero}(${topLeg.total} 套 · 均名次 ${
        topLeg.avgRank != null ? topLeg.avgRank.toFixed(1) : '—'
      })`,
      delta: null
    });
  }
  if (report) {
    const up = toListItems(report.popUp, 1)[0];
    const down = toListItems(report.popDown, 1)[0];
    if (up) bullets.push({ mark: '▲', text: `${up.key} 热度上升至 ${fmtPct(up.curr)}`, delta: up.delta });
    if (down) bullets.push({ mark: '▼', text: `${down.key} 热度回落至 ${fmtPct(down.curr)}`, delta: down.delta });
    if (bullets.length < 3) {
      bullets.push({
        mark: '·',
        text: `Meta 集中度 HHI ${report.hhiPrev.toFixed(0)} → ${report.hhiCurr.toFixed(0)}`,
        delta: null
      });
    }
  } else if (hottestHero) {
    bullets.push({
      mark: '·',
      text: `出场最多 ${hottestHero.hero}(${hottestHero.total} 套 · ${hottestHero.popularity.toFixed(1)}%)`,
      delta: null
    });
    bullets.push({
      mark: '·',
      text: `Meta 集中度 HHI ${hhi(heroes.map((h) => ({ rate: h.popularity }))).toFixed(0)}`,
      delta: null
    });
  }

  /* 头条标题:数据驱动,不用形容词 */
  const headline = topLegHero ? `${topLegHero}领跑本期综合榜` : `${label} · 数据速览`;

  /* 导语(standfirst):把统计事实串成一句 */
  const leadParts: string[] = [];
  leadParts.push(
    `本期收录 ${sample} 套卡组、${result.events.length} 场赛事${
      result.regionStats.size ? `,覆盖 ${result.regionStats.size} 个城市` : ''
    }。`
  );
  if (topLeg) {
    leadParts.push(
      `${topLegHero}以 ${topLeg.total} 套、均名次 ${
        topLeg.avgRank != null ? topLeg.avgRank.toFixed(1) : '—'
      } 位居综合榜首。`
    );
  }
  if (report) {
    const up = toListItems(report.popUp, 1)[0];
    const down = toListItems(report.popDown, 1)[0];
    if (up) leadParts.push(`${up.key} 热度上升 ${fmtPct(up.curr)}(${sign(up.delta)}pp)。`);
    if (down) leadParts.push(`${down.key} 回落至 ${fmtPct(down.curr)}(${sign(down.delta)}pp)。`);
  } else if (hottestHero) {
    leadParts.push(`${hottestHero.hero} 出场率最高,达 ${hottestHero.popularity.toFixed(1)}%。`);
  }

  /* 统计行 */
  const stats: IssueStat[] = [
    { label: '卡组样本', value: String(sample) },
    { label: '赛事', value: String(result.events.length) },
    { label: '城市', value: String(result.regionStats.size) },
    { label: '英雄', value: String(heroCount) },
    { label: '传奇种类', value: String(legends.length) }
  ];

  /* 环比行(需要 ≥2 个周次) */
  const deltas: IssueDelta[] = [];
  if (report) {
    deltas.push({
      label: '样本',
      delta: report.sampleDelta,
      prev: String(report.prevSample),
      curr: String(report.currSample)
    });
    deltas.push({ label: '赛事', delta: report.currEvents - report.prevEvents, prev: String(report.prevEvents), curr: String(report.currEvents) });
    deltas.push({
      label: 'HHI 集中度',
      delta: report.hhiCurr - report.hhiPrev,
      prev: report.hhiPrev.toFixed(0),
      curr: report.hhiCurr.toFixed(0)
    });
  }

  /* ── 分节 ── */
  const sections: IssueSection[] = [];

  sections.push({
    kind: 'paragraph',
    title: '本期综述',
    text: leadParts.join('')
  });

  if (report) {
    sections.push({
      kind: 'list',
      title: '热度上升',
      note: `对比 ${report.prevLabel} → ${report.currLabel} · 出场率变化(百分点)`,
      items: toListItems(report.popUp, 5)
    });
    sections.push({
      kind: 'list',
      title: '热度下降',
      note: `对比 ${report.prevLabel} → ${report.currLabel} · 出场率变化(百分点)`,
      items: toListItems(report.popDown, 5)
    });
  }

  if (report && report.heroTimeline.length > 0) {
    sections.push({
      kind: 'chart',
      title: '周际热度时间线',
      note: 'Top 英雄出场率 · 周际迁移',
      chart: 'timeline'
    });
  }

  if (report) {
    const convert = toListItems(report.convertMovers, 8);
    if (convert.length > 0) {
      sections.push({
        kind: 'table',
        title: '转化变化榜',
        note: '转化综合分变化,仅列 |Δ| ≥ 0.05',
        columns: ['英雄', '上期', '本期', 'Δ', '名次变动', '本期数量'],
        rows: report.convertMovers.slice(0, 8).map((it) => [
          it.key,
          it.prev == null ? '—' : it.prev.toFixed(1),
          it.curr == null ? '—' : it.curr.toFixed(1),
          it.delta == null ? '—' : `${sign(it.delta)}`,
          rankNote(it) || '—',
          String(it.currSample ?? '—')
        ])
      });
    }
  }

  const legMovers = report ? toListItems(report.legMovers, 6) : [];
  if (legMovers.length > 0) {
    sections.push({
      kind: 'list',
      title: '传奇热度变化',
      note: '按传奇卡聚合 · 出场率变化(百分点)',
      items: legMovers
    });
  }

  const domainMovers = report ? toListItems(report.domainMovers, 6) : [];
  if (domainMovers.length > 0) {
    sections.push({
      kind: 'list',
      title: '域对热度变化',
      note: '英雄单色域 ∪ 传奇双色域 · 出场率变化(百分点)',
      items: domainMovers
    });
  }

  /* 结构说明早于榜单:单期包没有环比时,补一段口径交代 */
  if (!report) {
    sections.push({
      kind: 'paragraph',
      title: '关于环比',
      text: `本数据包仅含单周(${latestWeek || '未标注周次'}),无法生成周际环比。载入第二个数据包或含多周的包后,本期将自动补齐热度升降与转化变化榜。`
    });
  }

  return {
    id,
    issueNo: opts.issueNo > 0 ? `第 ${opts.issueNo} 期` : '本期',
    label,
    roman: opts.roman ?? `Vol. ${opts.issueNo > 0 ? opts.issueNo : 1}`,
    pubDate,
    dateRangeText,
    sample,
    eventCount: result.events.length,
    cityCount: result.regionStats.size,
    heroCount,
    headline,
    lead: leadParts.join(''),
    bullets: bullets.slice(0, 3),
    stats,
    deltas,
    subtitle: [label, dateRangeText, `样本 ${sample}`].filter(Boolean).join(' · '),
    sections,
    footnote: `口径:胜率为 Σ胜场/Σ轮次 加权值;转化综合分 = Top8率35% + Top4率35% + 冠军率20% + 亚军率10%;样本 <${MIN_LEGEND_SAMPLE} 不参与综合榜。数据仅供竞技参考 · Riot Games 与本工具无关。`
  };
}

function sign(v: number | null): string {
  if (v == null) return '—';
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
}

/* ────────────────────── 卡片简报(往期列表用) ────────────────────── */

/** 轻量简报:只算卡片需要的字段,避免为列表构建整篇文章 */
export function buildIssueBrief(
  id: string,
  label: string,
  result: AnalysisResult,
  issueNo: number
): IssueBrief {
  const short = buildIssueArticle(id, label, result, { issueNo });
  return {
    id: short.id,
    issueNo: short.issueNo,
    label: short.label,
    roman: short.roman,
    pubDate: short.pubDate,
    dateRangeText: short.dateRangeText,
    sample: short.sample,
    eventCount: short.eventCount,
    cityCount: short.cityCount,
    heroCount: short.heroCount,
    headline: short.headline,
    lead: short.lead,
    bullets: short.bullets,
    stats: short.stats,
    deltas: short.deltas
  };
}
