/* ================================================================
 * src/core/legendaryStats.ts
 *
 * 传奇卡排行引擎(v3 新增,v3.1 全面切名次转化口径):
 *   - 每套卡组恰好 1 张传奇卡(cardCategory === '传奇'),它定义卡组双色域
 *   - 按传奇聚合:数量 / Top8 率 / Top4 率 / 冠军率 / 亚军率 / 出场率 /
 *     转化综合分 / 平均名次 / 最常见搭配英雄 / 卡图 / 禁卡标记
 *   - 强度一律用「名次转化」而非胜率:瑞士轮轮数与出勤结构会让胜率
 *     噪声远大于 Top8/Top4/夺冠转化,且转化口径不依赖 rank_data
 *   - 综合表现榜 metaScore = 转化综合分 × log10(数量+10) × 名次权重
 *     (转化只代表「强」,乘上对数热度与名次权重才是「又强又主流又稳定」的 T0 定义)
 *   - 热度榜 wilson = 出场率 95% 置信下界(威尔逊区间,低样本自动下沉)
 *   - 纯函数,无 DOM / Vue 依赖;排行与对比组件只消费 LegendaryRow
 * ============================================================== */

import type { CardCatalog, CardColor, Deck } from '@/types';
import { convertScore, wilsonLowerBoundPct } from './stats';

/** 排行指标:转化综合分 / 热度(威尔逊下界)/ 出场率 / Top8 率 / 综合表现分 */
export type LegendaryMetric = 'convert' | 'wilson' | 'popularity' | 'top8Rate' | 'metaScore';

/** 排行参与的最低数量(默认):低于此值的传奇不进任何榜单 */
export const MIN_LEGEND_SAMPLE = 10;

/** 单个传奇卡的聚合结果 */
export interface LegendaryRow {
  /** 代表卡牌编号(优先有卡图的印刷版本),如 'OGN-247' */
  cardNo: string;
  /** 归并的卡号变体数(同名+副标题;稀有度/印刷版本不同导致多卡号) */
  variants: number;
  /** 中文名 */
  name: string;
  /** 双色域(排除 colorless,已排序) */
  colors: readonly CardColor[];
  /** 数量(携带该传奇的卡组数) */
  total: number;
  /** Top8 次数 */
  top8: number;
  /** Top8 率(%) */
  top8Rate: number;
  /** Top4 次数(rank ≤ 4) */
  top4: number;
  /** Top4 率(%) */
  top4Rate: number;
  /** 夺冠次数(rank = 1) */
  champions: number;
  /** 冠军率(%)= champions / total */
  championRate: number;
  /** 亚军次数(rank = 2) */
  runnersUp: number;
  /** 亚军率(%)= runnersUp / total */
  runnerUpRate: number;
  /** 转化综合分(%) = Top8率×0.35 + Top4率×0.35 + 冠军率×0.2 + 亚军率×0.1 */
  convert: number;
  /** 出场率(%)= total / grandTotal */
  popularity: number;
  /** 威尔逊下界(出场率的 95% 置信下界,%),热度榜排序用 */
  wilson: number | null;
  /** 平均名次(仅统计有有效名次的卡组),无名次数据为 null */
  avgRank: number | null;
  /** 名次权重 R_weight(0.5~1.5,平均名次越好越高,归一化到全榜百分位),无数据为 1 */
  rankWeight: number | null;
  /** 综合表现分 = 转化综合分 × log10(数量+10) × 名次权重(「又强又主流又稳定」的 T0 指数) */
  metaScore: number | null;
  /** 最常见搭配英雄名 */
  topHero: string;
  /** 最常见英雄占比(%) */
  topHeroRate: number;
  /** 卡图 CDN URL,可能缺失(离线降级为色块) */
  imgUrl: string | null;
  /** 是否官方禁卡 */
  isBanned: boolean;
}

interface LegendaryAgg {
  colors: CardColor[];
  /** 观察到的卡号变体(同名+副标题 归并) */
  variants: Set<string>;
  total: number;
  top8: number;
  top4: number;
  champions: number;
  runnersUp: number;
  /** 有效名次合计与计数(avgRank 用) */
  rankSum: number;
  rankCnt: number;
  heroes: Map<string, number>;
}

export interface LegendaryOptions {
  /** 威尔逊置信度常数,默认 1.96(95% 置信度) */
  wilsonZ?: number;
}

/**
 * 全量聚合:每套卡组 → 传奇卡(取第一张 '传奇' 类型卡,与 colorStats 口径一致)。
 * 按规范键(同名+副标题)归并:同一张卡的多稀有度卡号(如 虚空之女 OGN-247/OGN-299)
 * 合并为一行,cardNo 为代表卡号(优先有卡图),variants 为合并的卡号数。
 */
export function legendaryRows(
  decks: readonly Deck[],
  catalog: CardCatalog,
  grandTotal: number,
  opts: LegendaryOptions = {}
): LegendaryRow[] {
  const wilsonZ = opts.wilsonZ ?? 1.96;
  const byLeg = new Map<string, LegendaryAgg>();

  for (const d of decks) {
    let leg: string | null = null;
    let colors: CardColor[] = [];
    for (const id of d.cards.keys()) {
      if (catalog.cardCategory.get(id) === '传奇') {
        leg = id;
        const cs = catalog.cardColors.get(id);
        if (cs) {
          colors = [...cs].filter((c): c is CardColor => c !== 'colorless').sort();
        }
        break;
      }
    }
    if (!leg) continue;

    const key = catalog.canonicalById.get(leg) ?? leg;
    let agg = byLeg.get(key);
    if (!agg) {
      agg = {
        colors,
        variants: new Set(),
        total: 0,
        top8: 0,
        top4: 0,
        champions: 0,
        runnersUp: 0,
        rankSum: 0,
        rankCnt: 0,
        heroes: new Map()
      };
      byLeg.set(key, agg);
    }
    agg.variants.add(leg);
    agg.total += 1;
    if (d.rank >= 1 && d.rank <= 8) agg.top8 += 1;
    if (d.rank >= 1 && d.rank <= 4) agg.top4 += 1;
    if (d.rank === 1) agg.champions += 1;
    if (d.rank === 2) agg.runnersUp += 1;
    if (d.rank >= 1 && d.rank < Number.MAX_SAFE_INTEGER) {
      agg.rankSum += d.rank;
      agg.rankCnt += 1;
    }
    const hero = d.hero || '未知';
    agg.heroes.set(hero, (agg.heroes.get(hero) ?? 0) + 1);
  }

  const rows: LegendaryRow[] = [];
  for (const [key, a] of byLeg) {
    // 代表卡号:优先有卡图,其次字典序(确定性)
    let repId = '';
    let imgUrl: string | null = null;
    for (const vid of a.variants) {
      if (!repId) repId = vid;
      if (catalog.cardImg.has(vid) && imgUrl === null) {
        imgUrl = catalog.cardImg.get(vid) ?? null;
        repId = vid;
      }
    }
    const meta = catalog.byId.get(repId);
    const topHero = [...a.heroes.entries()].sort((x, y) => y[1] - x[1])[0];
    const top8Rate = a.total > 0 ? (a.top8 / a.total) * 100 : 0;
    const top4Rate = a.total > 0 ? (a.top4 / a.total) * 100 : 0;
    const championRate = a.total > 0 ? (a.champions / a.total) * 100 : 0;
    const runnerUpRate = a.total > 0 ? (a.runnersUp / a.total) * 100 : 0;
    rows.push({
      cardNo: repId || key,
      name: meta?.name ?? key,
      variants: a.variants.size,
      colors: a.colors,
      total: a.total,
      top8: a.top8,
      top8Rate,
      top4: a.top4,
      top4Rate,
      champions: a.champions,
      championRate,
      runnersUp: a.runnersUp,
      runnerUpRate,
      convert: convertScore(top8Rate, top4Rate, championRate, runnerUpRate),
      popularity: grandTotal > 0 ? (a.total / grandTotal) * 100 : 0,
      wilson: grandTotal > 0 ? wilsonLowerBoundPct(a.total, grandTotal, wilsonZ) : null,
      avgRank: a.rankCnt > 0 ? a.rankSum / a.rankCnt : null,
      rankWeight: null, // 下方按全榜平均名次归一化
      metaScore: null, // 下方计算
      topHero: topHero?.[0] ?? '—',
      topHeroRate: topHero && a.total > 0 ? (topHero[1] / a.total) * 100 : 0,
      imgUrl,
      isBanned: meta?.isBanned ?? false
    });
  }

  // 名次权重 R_weight:平均名次越好权重越高,按全榜百分位归一化到 [0.5, 1.5]。
  // 平均名次第 1 → 1.5(名次碾压),中位 → ≈1.0,垫底 → ≈0.5。
  const withRank = rows.filter((r) => r.avgRank != null);
  if (withRank.length > 1) {
    for (const r of withRank) {
      const better = withRank.filter((o) => (o.avgRank ?? Infinity) < (r.avgRank ?? Infinity)).length;
      r.rankWeight = 1.5 - better / (withRank.length - 1);
    }
  } else if (withRank.length === 1) {
    withRank[0]!.rankWeight = 1;
  }

  // 综合表现分(metaScore):「又强、又主流、又稳定」的 T0 指数。
  //   metaScore = 转化综合分 × log10(数量 + 10) × 名次权重
  // 对数热度防止"无脑刷数量"霸榜;无名次数据时名次权重按 1 兜底。
  for (const r of rows) {
    r.metaScore = r.convert * Math.log10(r.total + 10) * (r.rankWeight ?? 1);
  }

  rows.sort((x, y) => y.total - x.total);
  return rows;
}

/** 取某行的指标值;热度用威尔逊下界(无数据降级出场率) */
export function metricValue(r: LegendaryRow, m: LegendaryMetric): number {
  if (m === 'convert') return r.convert;
  if (m === 'wilson') return r.wilson ?? r.popularity;
  if (m === 'metaScore') return r.metaScore ?? r.convert;
  return r[m];
}

/**
 * 按指标排序(降序),并列时按数量;数量 < minSample 的行不参与排行。
 * 排序结果即"最佳传奇"榜单。minSample 默认 MIN_LEGEND_SAMPLE(10),
 * 低数量行会被过滤,避免"假转化/假热度"进榜。
 */
export function sortLegendaryRows(
  rows: readonly LegendaryRow[],
  metric: LegendaryMetric,
  minSample = MIN_LEGEND_SAMPLE
): LegendaryRow[] {
  return [...rows]
    .filter((r) => r.total >= minSample)
    .sort((a, b) => metricValue(b, metric) - metricValue(a, metric) || b.total - a.total);
}

/**
 * 头条候选排序:转化综合分降序,并列按数量。
 * minSample 由调用方按数据规模给定(建议 ≥ max(10, 数量×2%))。
 */
export function sortLeadCandidates(
  rows: readonly LegendaryRow[],
  minSample: number
): LegendaryRow[] {
  return [...rows]
    .filter((r) => r.total >= minSample)
    .sort((a, b) => b.convert - a.convert || b.total - a.total);
}
