/* ================================================================
 * src/core/join.ts
 *
 * 增强数据源关联层:
 *   - shop_data.json → 精确城市 / 门店 / 赛事规模
 *   - rank_data.json → 真实胜场 winCount → 卡组胜率
 *   - decks_cache.json → cardGroupId → 完整卡表明细与卡图
 *
 * 全部为纯函数,不依赖 Vue / DOM。
 * ============================================================== */

import type { Deck, EventMeta, RankRow, ShopRow } from '@/types';
import { normalizeEventKey } from '@/utils/dataParser';

/* ============================================================
 * 1. shop_data 索引:normalizeEventKey(name) → ShopRow
 * ============================================================ */

export function buildShopIndex(rows: readonly ShopRow[] | undefined): Map<string, ShopRow> {
  const idx = new Map<string, ShopRow>();
  if (!rows) return idx;
  for (const r of rows) {
    const name = (r.name ?? '').trim();
    if (!name) continue;
    // 同名冲突时保留 playerMax 更大的一条(通常更完整)
    const key = normalizeEventKey(name);
    const prev = idx.get(key);
    if (!prev || (r.playerMaxCount ?? 0) > (prev.playerMaxCount ?? 0)) {
      idx.set(key, r);
    }
  }
  return idx;
}

/* ============================================================
 * 2. rank_data 关联:按 赛事名|选手名 匹配 → wins/cardGroupId/胜率
 *
 * 返回匹配成功的卡组数。每场赛事的轮次 = 该场 max(winCount)
 * (瑞士轮:128人7轮 / 67人6轮,实测吻合)。
 * ============================================================ */

export function attachWinData(
  decks: readonly Deck[],
  rankRows: readonly RankRow[] | undefined
): number {
  if (!rankRows || rankRows.length === 0) return 0;

  // key = normalizeEventKey(activity) + '|' + playerName
  interface RankAgg {
    wins: number;
    gid: number | null;
  }
  const byKey = new Map<string, RankAgg>();
  const roundsByEvent = new Map<string, number>();
  let matched = 0;

  for (const r of rankRows) {
    const activity = (r.activityName ?? '').trim();
    const player = (r.playerName ?? '').trim();
    if (!activity || !player) continue;
    const key = `${normalizeEventKey(activity)}|${player}`;
    const wins = typeof r.winCount === 'number' && Number.isFinite(r.winCount) ? r.winCount : null;
    byKey.set(key, {
      wins: wins ?? 0,
      gid: typeof r.cardGroupId === 'number' ? r.cardGroupId : null
    });
    if (wins !== null) {
      const evKey = normalizeEventKey(activity);
      roundsByEvent.set(evKey, Math.max(roundsByEvent.get(evKey) ?? 0, wins));
    }
  }

  for (const d of decks) {
    const key = `${normalizeEventKey(d.activityName)}|${d.playerName.trim()}`;
    const hit = byKey.get(key);
    if (!hit) continue;
    matched++;
    d.wins = hit.wins;
    d.cardGroupId = hit.gid;
    const rounds = roundsByEvent.get(normalizeEventKey(d.activityName)) ?? null;
    d.eventRounds = rounds;
    d.winRate = rounds && rounds > 0 ? (hit.wins / rounds) * 100 : null;
  }

  return matched;
}

/* ============================================================
 * 3. 赛事元信息列表:shop_data × decks 聚合 × 推断轮次
 * ============================================================ */

export function buildEventList(
  decks: readonly Deck[],
  shopIndex: ReadonlyMap<string, ShopRow>,
  rankRows?: readonly RankRow[]
): EventMeta[] {
  interface Agg {
    date: string;
    province: string;
    city: string;
    area: string;
    shopName: string;
    playerMax: number | null;
    deckCount: number;
  }
  const byEvent = new Map<string, Agg>();

  for (const d of decks) {
    if (!d.activityName) continue;
    const key = normalizeEventKey(d.activityName);
    let agg = byEvent.get(key);
    if (!agg) {
      agg = {
        date: d.date,
        province: d.province,
        city: d.city,
        area: '',
        shopName: '',
        playerMax: null,
        deckCount: 0
      };
      byEvent.set(key, agg);
    }
    agg.deckCount += 1;
    if (!agg.date && d.date) agg.date = d.date;

    const shop = shopIndex.get(key);
    if (shop) {
      agg.city = shop.shopCity?.replace(/市$/, '') || agg.city;
      agg.area = shop.shopArea ?? '';
      agg.shopName = shop.shopName ?? '';
      agg.playerMax = shop.playerMaxCount ?? agg.playerMax;
      if (shop.date) agg.date = shop.date.slice(0, 10);
      if (shop.shopProvince) agg.province = shop.shopProvince;
    }
  }

  // 轮次(rank_data 的 max winCount)
  const roundsByEvent = new Map<string, number>();
  if (rankRows) {
    for (const r of rankRows) {
      const activity = (r.activityName ?? '').trim();
      const wins = r.winCount;
      if (!activity || typeof wins !== 'number' || !Number.isFinite(wins)) continue;
      const key = normalizeEventKey(activity);
      roundsByEvent.set(key, Math.max(roundsByEvent.get(key) ?? 0, wins));
    }
  }

  const list: EventMeta[] = [];
  for (const [key, agg] of byEvent) {
    list.push({
      name: key,
      date: agg.date,
      province: agg.province,
      city: agg.city,
      area: agg.area,
      shopName: agg.shopName,
      playerMax: agg.playerMax,
      deckCount: agg.deckCount,
      rounds: roundsByEvent.get(key) ?? null
    });
  }

  list.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  return list;
}
