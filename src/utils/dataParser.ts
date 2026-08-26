/* ================================================================
 * src/utils/dataParser.ts
 *
 * CSV → 类型安全数据 / 卡牌目录 cross-ref / Deck 归一化
 *
 * 流程:
 *   1. parseCSVFile/parseCSVText   —— PapaParse 包装
 *   2. detectDeckColumns           —— 自动识别列名(activityName / finalRanking / TTS_code ...)
 *   3. buildCardCatalog            —— 把 cards_base × card_prints 关联成 CardMeta Map
 *   4. precomputeWeeks             —— 按 ISO / Rolling 模式聚类 week bucket
 *   5. normalizeDecks              —— 单行 → Deck(已含 city + week + cards Map)
 * ============================================================== */

import Papa from 'papaparse';
import type {
  CardCatalog,
  CardColor,
  CardMeta,
  CardCategory,
  Deck,
  DeckCacheData,
  EventMeta,
  RankRow,
  RawCardBaseRow,
  RawCardPrintRow,
  RawDeckRow,
  RawRow,
  ShopRow,
  WeekBucket
} from '@/types';
import {
  bucketByRollingWindow,
  compareWeekBucket,
  getISOWeek,
  rollingLabelToBucket
} from './isoWeek';
import { extractCityFromProvince, resolveCity, UNKNOWN_CITY } from './cityRegex';
import { parseTTSCode, normalizeCategory } from './parseTTS';

/* ============================================================
 * 1. PapaParse 包装
 * ============================================================ */

/**
 * 字符串版:同步返回数组,便于 SSR / 测试。
 */
export function parseCSVText<R extends RawRow>(text: string): R[] {
  const result = Papa.parse<R>(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false
  });
  if (result.errors && result.errors.length > 0) {
    // 大部分错误是字段数不匹配,PapaParse 会自动忽略;此处仅打印警告
    // eslint-disable-next-line no-console
    console.warn('CSV parse warnings:', result.errors.slice(0, 3));
  }
  return (result.data ?? []) as R[];
}

/**
 * File 版:异步主线程读取,把 Papa.parse 包装成回调形式。
 */
export function parseCSVFile<R extends RawRow>(
  file: File,
  onComplete: (rows: R[]) => void,
  onError?: (err: Error) => void
): void {
  Papa.parse<R>(file, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
    complete: (res) => onComplete((res.data ?? []) as R[]),
    error: (err) => onError?.(err)
  });
}

/**
 * JSON 文件版:文本读取 + JSON.parse。
 * decks_cache.json 约 40MB,parse 耗时 ~1s,由调用方负责展示 busy 态。
 */
export function parseJSONFile<T>(
  file: File,
  onComplete: (data: T) => void,
  onError?: (err: Error) => void
): void {
  file
    .text()
    .then((text) => {
      try {
        onComplete(JSON.parse(text) as T);
      } catch (e) {
        onError?.(e instanceof Error ? e : new Error(String(e)));
      }
    })
    .catch((e) => onError?.(e instanceof Error ? e : new Error(String(e))));
}

/* ============================================================
 * 2. 列名容错识别
 *
 * 精确匹配优先,其次按提示子串(含英文)。
 * ============================================================ */

export function pickColumn(
  keys: readonly string[],
  exact: string,
  hints: readonly string[]
): string | null {
  if (!keys) return null;
  for (const k of keys) {
    if (k && k.toLowerCase() === exact) return k;
  }
  for (const k of keys) {
    if (!k) continue;
    const low = k.toLowerCase();
    for (const hint of hints) {
      if (low.includes(hint)) return k;
    }
  }
  return null;
}

/* ============================================================
 * 3. 卡牌目录构建(CardBase × CardPrint)
 * ============================================================ */

export function buildCardCatalog(
  cBase: readonly RawCardBaseRow[],
  cPrints: readonly RawCardPrintRow[],
  cacheData?: DeckCacheData | null
): CardCatalog {
  const baseById = new Map<string, RawCardBaseRow>();
  for (const b of cBase) {
    const id = b.id;
    if (typeof id === 'string' && id) baseById.set(id, b);
  }

  const byId = new Map<string, CardMeta>();
  const cardDict = new Map<string, string>();
  const cardEnergy = new Map<string, number>();
  const cardRarity = new Map<string, string>();
  const cardCategory = new Map<string, CardCategory>();
  const cardColors = new Map<string, readonly CardColor[]>();
  const cardImg = new Map<string, string>();

  const VALID_COLORS: ReadonlySet<CardColor> = new Set<CardColor>([
    'red', 'green', 'blue', 'yellow', 'purple', 'orange', 'colorless'
  ]);

  function parseColors(raw: string | null | undefined): readonly CardColor[] {
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr.filter(
        (c): c is CardColor => typeof c === 'string' && VALID_COLORS.has(c as CardColor)
      );
    } catch {
      return [];
    }
  }

  function parseJsonArrayFirst(raw: string | null | undefined): string {
    if (!raw) return '';
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && typeof arr[0] === 'string') return arr[0] as string;
    } catch {
      /* ignore */
    }
    return '';
  }

  // 1) 印刷版本 → 卡图(优先默认印刷)
  for (const p of cPrints) {
    if (typeof p.card_id !== 'string' || !p.card_id) continue;
    if (typeof p.card_no_extend !== 'string' || !p.card_no_extend) continue;
    const base = baseById.get(p.card_id);
    if (!base) continue;

    const rawNo = p.card_no_extend.replace(/\*$/, '').trim();
    if (!rawNo) continue;

    const series = rawNo.split('-')[0] ?? '';
    const energy = parseFloat(base.energy ?? '') || 0;
    const category = normalizeCategory(base.card_category);
    const name = base.card_name_cn || rawNo;
    const rarity = p.rarity_name || '未知';

    const meta: CardMeta = {
      id: rawNo,
      name,
      series,
      rarity,
      energy,
      category,
      rawCategory: base.card_category ?? '',
      colors: parseColors(base.card_color_list),
      region: parseJsonArrayFirst(base.region),
      power: parseFloat(base.power ?? '') || 0,
      championTag: (base.champion_tag ?? '').trim(),
      isBanned: String(base.is_banned ?? '').toLowerCase() === 'true'
    };

    byId.set(rawNo, meta);
    cardDict.set(rawNo, name);
    cardEnergy.set(rawNo, energy);
    cardRarity.set(rawNo, rarity);
    cardCategory.set(rawNo, category);
    cardColors.set(rawNo, meta.colors);

    const img = p.img_cdn;
    if (typeof img === 'string' && img.startsWith('http')) {
      // 同编号多印刷时保留第一个;is_default 的排前可后续优化
      if (!cardImg.has(rawNo)) cardImg.set(rawNo, img);
    }
  }

  // 2) decks_cache 补充卡图(编号归一化:· → - ,去 /变体 后缀)
  if (cacheData) {
    for (const entries of Object.values(cacheData)) {
      if (!Array.isArray(entries)) continue;
      for (const e of entries) {
        if (!e || typeof e.cardNo !== 'string') continue;
        const no = normalizeCardNo(e.cardNo);
        if (!no) continue;
        if (!cardImg.has(no) && typeof e.frontImage === 'string' && e.frontImage.startsWith('http')) {
          cardImg.set(no, e.frontImage);
        }
        // cache 里出现而 catalog 缺失的编号(如特殊印刷),补一条最小元数据
        if (!byId.has(no) && no.includes('-')) {
          const name = e.cardName ?? no;
          const series = no.split('-')[0] ?? '';
          const colors = (e.cardColorList ?? []).filter(
            (c: unknown): c is CardColor =>
              typeof c === 'string' && VALID_COLORS.has(c as CardColor)
          );
          const catRaw = e.cardCategoryName ?? '';
          const category = ALLOWED_CACHE_CATEGORY.has(catRaw)
            ? (catRaw as CardCategory)
            : '其他';
          const meta: CardMeta = {
            id: no,
            name,
            series,
            rarity: e.rarity ?? '未知',
            energy: 0,
            category,
            rawCategory: catRaw,
            colors,
            region: '',
            power: 0,
            championTag: e.hero ?? '',
            isBanned: false
          };
          byId.set(no, meta);
          cardDict.set(no, name);
          cardEnergy.set(no, 0);
          cardRarity.set(no, meta.rarity);
          cardCategory.set(no, category);
          cardColors.set(no, colors);
        }
      }
    }
  }

  return { byId, cardDict, cardEnergy, cardRarity, cardCategory, cardColors, cardImg };
}

/** cache 中出现的规范类型名 */
const ALLOWED_CACHE_CATEGORY: ReadonlySet<string> = new Set([
  '传奇', '英雄单位', '单位', '法术', '装备', '符文', '战场'
]);

/**
 * 卡牌编号归一化:'SFD·140/221' → 'SFD-140','VEN·113a' → 'VEN-113a'。
 */
export function normalizeCardNo(no: string): string {
  return no
    .replace(/·/g, '-')
    .replace(/\/.*$/, '')
    .replace(/\*$/, '')
    .trim();
}

/* ============================================================
 * 4. Deck 列名解析上下文
 * ============================================================ */

export interface DeckColumnMapping {
  rankCol: string;
  eventCol: string | null;
  playerCol: string | null;
  dateCol: string | null;
  provinceCol: string | null;
  heroCol: string | null;
  ttsCol: string | null;
}

export function detectDeckColumns(rows: readonly RawDeckRow[]): DeckColumnMapping {
  if (rows.length === 0) {
    return {
      rankCol: 'rank',
      eventCol: null,
      playerCol: null,
      dateCol: null,
      provinceCol: null,
      heroCol: null,
      ttsCol: null
    };
  }

  const first = rows[0] ?? {};
  const keys = Object.keys(first);
  const rankCol =
    pickColumn(keys, 'finalranking', ['rank']) ?? keys[3] ?? 'rank';
  const eventCol = pickColumn(keys, 'activityname', ['activity', 'tournament', 'event']);
  const playerCol = pickColumn(keys, 'playername', ['player']);
  const dateCol = pickColumn(keys, 'date', ['date']);
  const provinceCol = pickColumn(keys, 'shopprovince', ['province']);
  const heroCol = pickColumn(keys, 'hero', ['hero', 'champion']);
  const ttsCol = pickColumn(keys, 'tts_code', ['tts', 'deckcode', 'code']);

  return { rankCol, eventCol, playerCol, dateCol, provinceCol, heroCol, ttsCol };
}

/* ============================================================
 * 5. 周次预计算
 * ============================================================ */

export interface WeekPrecompute {
  /** date 'YYYY-MM-DD' → bucket */
  dateToBucket: Map<string, WeekBucket>;
  /** 全量有序去重的 week 列表 */
  list: WeekBucket[];
  /** 是否有任何有效周次识别出来 */
  hasAny: boolean;
}

export function precomputeWeeks(
  rows: readonly RawDeckRow[],
  dateCol: string | null,
  weekMode: 'iso' | 'rolling',
  rollingGapDays: number
): WeekPrecompute {
  const result: WeekPrecompute = {
    dateToBucket: new Map(),
    list: [],
    hasAny: false
  };

  if (!dateCol) return result;

  if (weekMode === 'iso') {
    const seen = new Map<string, WeekBucket>();
    for (const r of rows) {
      const dateStr = (r[dateCol] ?? '').slice(0, 10);
      if (!dateStr) continue;
      const bucket = getISOWeek(dateStr);
      if (!bucket) continue;
      result.hasAny = true;
      result.dateToBucket.set(dateStr, bucket);
      if (!seen.has(bucket.label)) seen.set(bucket.label, bucket);
    }
    result.list = Array.from(seen.values()).sort(compareWeekBucket);
  } else {
    // rolling window
    const dates = rows
      .map((r) => (r[dateCol] ?? '').slice(0, 10))
      .filter((d): d is string => !!d);
    const { dateToLabel, list } = bucketByRollingWindow(dates, rollingGapDays);
    result.hasAny = dateToLabel.size > 0;
    list.forEach((label, idx) => {
      const bucket = rollingLabelToBucket(label, idx + 1);
      // 把同一 label 的日期都映射到同一个 bucket
      for (const [d, l] of dateToLabel.entries()) {
        if (l === label) result.dateToBucket.set(d, bucket);
      }
    });
    result.list = list.map((l, idx) => rollingLabelToBucket(l, idx + 1));
  }

  return result;
}

/* ============================================================
 * 6. 单行 → Deck 归一化
 * ============================================================ */

const UNKNOWN_WEEK: WeekBucket = { year: 0, week: 0, label: '未知' };

function cell(row: RawDeckRow, col: string | null, fallback = ''): string {
  if (!col) return fallback;
  const v = row[col];
  if (v == null) return fallback;
  return String(v).trim();
}

export function normalizeDeck(
  row: RawDeckRow,
  cols: DeckColumnMapping,
  weekPre: WeekPrecompute,
  cityOverrides: ReadonlyMap<string, string>,
  shopIndex?: ReadonlyMap<string, ShopRow>
): Deck {
  const activityName = cell(row, cols.eventCol);
  const playerName = cell(row, cols.playerCol);
  const dateStr = cell(row, cols.dateCol).slice(0, 10);
  const provinceRaw = cell(row, cols.provinceCol);
  const heroRaw = cell(row, cols.heroCol, '未知') || '未知';
  const ttsCode = cell(row, cols.ttsCol);

  // 名次:NaN → Number.MAX_SAFE_INTEGER,统一丢到队尾
  const rankRaw = cols.rankCol ? row[cols.rankCol] : undefined;
  const rankParsed = parseInt(String(rankRaw ?? ''), 10);
  const rank = Number.isFinite(rankParsed) ? rankParsed : Number.MAX_SAFE_INTEGER;

  // 精确门店信息(shop_data 按"去空白赛事名"匹配)
  const shop = activityName ? shopIndex?.get(normalizeEventKey(activityName)) : undefined;
  const province = shop?.shopProvince || provinceRaw;
  const shopName = shop?.shopName ?? '';

  // 城市:override > shopCity > 赛事名正则 > 省份回退 > 未知
  const override = activityName ? cityOverrides.get(activityName) : undefined;
  const city = resolveCity({
    activityName,
    province: provinceRaw,
    override,
    shopCity: shop?.shopCity
  });

  // 周次
  const week =
    (dateStr && weekPre.dateToBucket.get(dateStr)) ||
    UNKNOWN_WEEK;

  return {
    raw: row,
    playerName,
    activityName,
    date: dateStr,
    rank,
    hero: heroRaw,
    province,
    city,
    week,
    ttsCode,
    cards: parseTTSCode(ttsCode),
    wins: null,
    eventRounds: null,
    winRate: null,
    shopCity: shop?.shopCity ?? '',
    shopName,
    cardGroupId: null
  };
}

/* ============================================================
 * 7. 批量归一化
 * ============================================================ */

export interface NormalizedDecksResult {
  decks: Deck[];
  columns: DeckColumnMapping;
  weeks: WeekBucket[];
  /** 解析中未能识别城市的赛事列表(供 MappingPanel 兜底) */
  cityUnknownActivities: string[];
}

export function normalizeDecks(
  rows: readonly RawDeckRow[],
  opts: {
    cityOverrides?: ReadonlyMap<string, string>;
    weekMode?: 'iso' | 'rolling';
    rollingGapDays?: number;
    /** shop_data 索引(赛事名 → ShopRow),用于精确城市/门店 */
    shopIndex?: ReadonlyMap<string, ShopRow>;
  } = {}
): NormalizedDecksResult {
  const cityOverrides = opts.cityOverrides ?? new Map<string, string>();
  const weekMode = opts.weekMode ?? 'iso';
  const rollingGapDays = opts.rollingGapDays ?? 4;
  const shopIndex = opts.shopIndex;

  const columns = detectDeckColumns(rows);
  const weekPre = precomputeWeeks(rows, columns.dateCol, weekMode, rollingGapDays);

  const decks: Deck[] = [];
  const unknownEvents = new Set<string>();

  for (const r of rows) {
    const deck = normalizeDeck(r, columns, weekPre, cityOverrides, shopIndex);
    decks.push(deck);
    if (deck.city === UNKNOWN_CITY && deck.activityName) {
      unknownEvents.add(deck.activityName);
    }
  }

  return {
    decks,
    columns,
    weeks: weekPre.list,
    cityUnknownActivities: Array.from(unknownEvents)
  };
}

/* ============================================================
 * 8. 工具:根据 (player, event, date, rank) 去重
 * ============================================================ */

export function dedupeSampleDecks(decks: readonly Deck[]): Deck[] {
  const seen = new Set<string>();
  const out: Deck[] = [];
  for (const d of decks) {
    const key = `${d.playerName}|${d.activityName}|${d.date}|${d.rank}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}

/* ============================================================
 * 9. 文件名槽位识别(给 FileDrop.vue 用)
 * ============================================================ */

export type SlotKind = 'deck' | 'base' | 'prints' | 'rank' | 'shop' | 'cache';

/**
 * 赛事名匹配 key:去掉全部空白,统一全角/半角括号差异。
 * shop_data 与 decks CSV 的活动名可能存在空格差异(如 '【城市挑战赛】 广州站-8.09')。
 */
export function normalizeEventKey(name: string): string {
  return name.replace(/\s+/g, '').replace(/（/g, '(').replace(/）/g, ')');
}

/**
 * 文件名 → 槽位。注意顺序:decks_cache 同时含 'deck' 与 'cache',
 * 必须先判 cache/rank/shop 再判 deck。
 */
export function detectSlotFromFilename(name: string): SlotKind | null {
  const low = (name || '').toLowerCase();
  if (low.includes('cache')) return 'cache';
  if (low.includes('rank') || low.includes('win')) return 'rank';
  if (low.includes('shop')) return 'shop';
  if (low.includes('base')) return 'base';
  if (low.includes('print')) return 'prints';
  if (low.includes('deck') || low.includes('tts')) return 'deck';
  return null;
}
