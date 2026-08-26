/* ================================================================
 * src/utils/parseTTS.ts
 *
 * TTS_code 字符串解析 + 卡牌类型归一化
 *
 * TTS_code 形如 'OGN-308-2 VEN-197-1',空格分隔的 三元组 (系列-编号-张数),
 * 本文件产出:
 *   parseTTSCode → Map<cardId, count>  (cardId = 系列 + '-' + 编号)
 *   parseTTSWithZones → 卡表 + token 序列 + 每卡区域 + 选定英雄卡号
 *   normalizeCategory → '单位' | '法术' | '装备' | '符文' | '战场' | '其他'
 *
 * TTS_code 顺序固定(与 decks_data.json deckList 顺序一致,120/120 验证):
 *   传奇×1 → 选定×1 → 主牌堆×39 → 战场×3 → 符文×12 → 备牌(末尾 8~10 张)
 * 主牌堆固定 39 张,因此按 token 位置即可切分区域,无需任何字段;
 * 同一卡号可跨区域(如某卡主牌堆 1 张 + 备牌 1 张),故区域是 token 级的。
 * ============================================================== */

import type { CardCatalog, CardCategory, CardZoneType } from '@/types';

/** TTS_code 固定顺序各区域张数(数据实测校准) */
export const TTS_LEGEND_COUNT = 1;
export const TTS_MAIN_COUNT = 39;
export const TTS_BATTLEFIELD_COUNT = 3;
export const TTS_RUNE_COUNT = 12;

/** token 位置 → 区域(选定英雄在位置 1,由 mainHeroCardNo 单独标记) */
export function zoneAtTokenIndex(idx: number): CardZoneType {
  let p = 0;
  p += TTS_LEGEND_COUNT; // 传奇
  if (idx < p) return 'legend';
  p += 1; // 选定(位置 1)
  if (idx < p) return 'main'; // 选定英雄卡本身按主卡堆区域存储
  p += TTS_MAIN_COUNT; // 主牌堆 39
  if (idx < p) return 'main';
  p += TTS_BATTLEFIELD_COUNT; // 战场 3
  if (idx < p) return 'battlefield';
  p += TTS_RUNE_COUNT; // 符文 12
  if (idx < p) return 'rune';
  return 'side'; // 剩余 = 备牌
}

/**
 * 解析 TTS_code 字符串为"编号 → 张数"Map。
 * - 容错处理空、空白、单项异常(JUNK 输入不会抛错)
 * - 容许尾部 '*'(原 index.html 中 'card_no_extend.replace(/\*$/, "")' 兼容)
 */
export function parseTTSCode(input: string | null | undefined): Map<string, number> {
  const result = new Map<string, number>();
  if (!input) return result;
  const parts = input.trim().split(/\s+/);
  for (const part of parts) {
    if (!part) continue;
    const segs = part.split('-');
    if (segs.length < 2) continue;
    const series = segs[0];
    const no = (segs[1] ?? '').replace(/\*$/, '').trim();
    if (!series || !no) continue;
    const id = `${series}-${no}`;
    result.set(id, (result.get(id) ?? 0) + 1);
  }
  return result;
}

export interface TTSZoneResult {
  /** 编号 → 张数(与 parseTTSCode 同口径,每个 token 记 1 张) */
  cards: Map<string, number>;
  /** token 卡号序列(保序;同一卡号可跨区域,分组须按 token 逐张判定) */
  cardTokens: readonly string[];
  /** 编号 → 区域(覆盖口径:备牌段在末尾后写优先;跨区域卡取末尾区域) */
  zones: Map<string, CardZoneType>;
  /** 选定英雄卡号(位置 1 的卡;兜底英雄单位 + championTag 匹配),无则 null */
  mainHeroCardNo: string | null;
}

/**
 * 解析 TTS_code 并按固定顺序标注区域(主牌堆固定 39 张,按 token 位置切分)。
 */
export function parseTTSWithZones(
  input: string | null | undefined,
  hero: string,
  catalog: CardCatalog
): TTSZoneResult {
  const cards = new Map<string, number>();
  const cardTokens: string[] = [];
  if (input) {
    for (const part of input.trim().split(/\s+/)) {
      if (!part) continue;
      const segs = part.split('-');
      if (segs.length < 2) continue;
      const series = segs[0];
      const no = (segs[1] ?? '').replace(/\*$/, '').trim();
      if (!series || !no) continue;
      const id = `${series}-${no}`;
      cards.set(id, (cards.get(id) ?? 0) + 1);
      cardTokens.push(id);
    }
  }

  // 选定英雄:位置 1 的卡;无第二张时用英雄单位 + championTag 匹配兜底
  let mainHeroCardNo: string | null = null;
  if (cardTokens.length > 1) {
    mainHeroCardNo = cardTokens[1]!;
  } else {
    for (const no of cardTokens) {
      const meta = catalog.byId.get(no);
      const tag = meta?.championTag ?? '';
      if (meta?.category === '英雄单位' && tag && hero && hero.includes(tag)) {
        mainHeroCardNo = no;
        break;
      }
    }
  }

  // token 级区域:按位置切分;zones 顺序写入(备牌段在末尾自然覆盖同卡号早期区域)
  const zones = new Map<string, CardZoneType>();
  cardTokens.forEach((no, idx) => {
    zones.set(no, zoneAtTokenIndex(idx));
  });

  return { cards, cardTokens, zones, mainHeroCardNo };
}

/* ============================================================
 * 卡牌类型归一化
 * 原版 card_category 是 JSON 数组字符串,如 ["单位"] / ["英雄", "专属", "单位"]
 * 第一项为'英雄'/'专属'/'指示物'时剥去该前缀,统一映射到 6 大基础类型。
 * ============================================================ */

const CATEGORY_PREFIX_STRIP = /^(专属|指示物)/u;

const ALLOWED: ReadonlySet<CardCategory> = new Set<CardCategory>([
  '传奇',
  '英雄单位',
  '单位',
  '法术',
  '装备',
  '符文',
  '战场',
  '其他'
]);

export function normalizeCategory(raw: string | null | undefined): CardCategory {
  let s: string = '其他';
  if (raw) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && typeof arr[0] === 'string') s = arr[0];
    } catch {
      /* 不是合法 JSON,例如某些人工改写后的 CSV '单位' 单值,直接用 */
      if (/^[\u4e00-\u9fa5]+$/.test(raw.trim())) s = raw.trim();
    }
  }

  s = s.replace(CATEGORY_PREFIX_STRIP, '');

  // '传奇' 与 '英雄单位' 作为独立类型保留(域对识别 / UI 徽章需要)
  return (ALLOWED.has(s as CardCategory) ? (s as CardCategory) : '其他');
}
