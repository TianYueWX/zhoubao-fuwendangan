/* ================================================================
 * src/core/legendaryStats.ts
 *
 * 传奇卡排行引擎(v3 新增):
 *   - 每套卡组恰好 1 张传奇卡(cardCategory === '传奇'),它定义卡组双色域
 *   - 按传奇聚合:样本 / Top8 率 / 出场率 / 加权真实胜率(Σwins/Σrounds)/
 *     最常见搭配英雄 / 卡图 / 禁卡标记
 *   - 纯函数,无 DOM / Vue 依赖;排行与对比组件只消费 LegendaryRow
 * ============================================================== */

import type { CardCatalog, CardColor, Deck } from '@/types';

/** 排行指标:真实胜率(缺省降级 Top8 率)/ 出场率 / Top8 率 */
export type LegendaryMetric = 'winRate' | 'popularity' | 'top8Rate';

/** 单个传奇卡的聚合结果 */
export interface LegendaryRow {
  /** 卡牌编号,如 'VEN·197' */
  cardNo: string;
  /** 中文名 */
  name: string;
  /** 双色域(排除 colorless,已排序) */
  colors: readonly CardColor[];
  /** 样本(携带该传奇的卡组数) */
  total: number;
  /** Top8 次数 */
  top8: number;
  /** Top8 率(%) */
  top8Rate: number;
  /** 出场率(%)= total / grandTotal */
  popularity: number;
  /** 加权真实胜率(%),无胜场数据为 null */
  winRate: number | null;
  /** 平均胜场(仅含 join 成功的卡组) */
  avgWins: number | null;
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
  total: number;
  top8: number;
  winsSum: number;
  roundsSum: number;
  winDecks: number;
  heroes: Map<string, number>;
}

/**
 * 全量聚合:每套卡组 → 传奇卡(取第一张 '传奇' 类型卡,与 colorStats 口径一致)。
 * 胜率 = Σwins / Σrounds(加权口径,同 heroStats)。
 */
export function legendaryRows(
  decks: readonly Deck[],
  catalog: CardCatalog,
  grandTotal: number
): LegendaryRow[] {
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

    let agg = byLeg.get(leg);
    if (!agg) {
      agg = { colors, total: 0, top8: 0, winsSum: 0, roundsSum: 0, winDecks: 0, heroes: new Map() };
      byLeg.set(leg, agg);
    }
    agg.total += 1;
    if (d.rank >= 1 && d.rank <= 8) agg.top8 += 1;
    if (d.wins !== null && d.eventRounds !== null && d.eventRounds > 0) {
      agg.winsSum += d.wins;
      agg.roundsSum += d.eventRounds;
      agg.winDecks += 1;
    }
    const hero = d.hero || '未知';
    agg.heroes.set(hero, (agg.heroes.get(hero) ?? 0) + 1);
  }

  const rows: LegendaryRow[] = [];
  for (const [cardNo, a] of byLeg) {
    const meta = catalog.byId.get(cardNo);
    const topHero = [...a.heroes.entries()].sort((x, y) => y[1] - x[1])[0];
    rows.push({
      cardNo,
      name: meta?.name ?? cardNo,
      colors: a.colors,
      total: a.total,
      top8: a.top8,
      top8Rate: a.total > 0 ? (a.top8 / a.total) * 100 : 0,
      popularity: grandTotal > 0 ? (a.total / grandTotal) * 100 : 0,
      winRate: a.winDecks > 0 && a.roundsSum > 0 ? (a.winsSum / a.roundsSum) * 100 : null,
      avgWins: a.winDecks > 0 ? a.winsSum / a.winDecks : null,
      topHero: topHero?.[0] ?? '—',
      topHeroRate: topHero && a.total > 0 ? (topHero[1] / a.total) * 100 : 0,
      imgUrl: catalog.cardImg.get(cardNo) ?? null,
      isBanned: meta?.isBanned ?? false
    });
  }

  rows.sort((x, y) => y.total - x.total);
  return rows;
}

/** 取某行的指标值;胜率缺失时降级为 Top8 率 */
export function metricValue(r: LegendaryRow, m: LegendaryMetric): number {
  if (m === 'winRate') return r.winRate ?? r.top8Rate;
  return r[m];
}

/**
 * 按指标排序(降序),并列时按样本数;样本 < minSample 的行不参与排行。
 * 排序结果即"最佳传奇"榜单。
 */
export function sortLegendaryRows(
  rows: readonly LegendaryRow[],
  metric: LegendaryMetric,
  minSample = 5
): LegendaryRow[] {
  return [...rows]
    .filter((r) => r.total >= minSample)
    .sort((a, b) => metricValue(b, metric) - metricValue(a, metric) || b.total - a.total);
}
