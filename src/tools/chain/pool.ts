/* ================================================================
 * src/tools/chain/pool.ts
 *
 * 结算链推演 —— 卡池派生层(纯函数)。
 *
 * 卡池口径(与原项目对齐):
 *   上游 rune-chain-tools 从 cardDB.json 里筛 `extend_rarity_name === '平卡'`,
 *   得到 382 张。本项目直接用**随站点发布的内置卡表**做同样的筛选,
 *   实测 1907 条平卡印刷 / 965 张唯一卡,且每张都有 SC 简体中文卡图 ——
 *   比上游那份子集导出更全,且不依赖已失效的第三方 CDN。
 *
 * 关联口径与站点既有实现一致(见 src/utils/dataParser.ts):
 *   prints.card_id → cards_base.id   (UUID 关联)
 *   对外编号统一用 prints.card_no_extend(已去掉 '※' 等后缀)
 *   卡图裁决复用 buildCardCatalog(),天然带 SC 优先。
 * ============================================================== */

import type { CardCatalog, RawCardBaseRow, RawCardPrintRow } from '@/types';
import { normalizeCategory } from '@/utils/parseTTS';

/** 卡池里的一条(卡牌定义,不是盘内实例) */
export interface ChainPoolItem {
  /** 卡牌编号,如 'OGN-308' */
  id: string;
  /** 中文卡名 */
  name: string;
  /** 副标题 */
  subtitle: string;
  /** 效果原文(含 {{关键字}} 标记,渲染层负责高亮) */
  text: string;
  /** 归一化类型 */
  category: string;
  /** 颜色域 */
  colors: readonly string[];
  /** 费用 */
  energy: number;
  /** 战力 */
  power: number;
  /** 系列 */
  series: string;
  /** 稀有度 */
  rarity: string;
  /** 卡图 CDN 地址;可能为空 */
  image: string;
  /** 是否官方禁卡(卡池中给角标提示) */
  banned: boolean;
}

/** 平卡口径常量:与上游 cardDB.json 的筛选条件一致 */
export const FLAT_RARITY = '平卡';

function asText(v: string | null | undefined): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** 解析 cards_base.card_color_list 这类 JSON 数组字符串 */
function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const arr: unknown = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function toNumber(raw: string | null | undefined): number {
  const n = parseFloat(asText(raw));
  return Number.isFinite(n) ? n : 0;
}

/**
 * 构建卡池。
 *
 * @param cardBase    内置卡表主表(可能尚未加载完,调用方传 null 即可)
 * @param cardPrints  内置印刷版本表
 * @param catalog     已构建的卡牌目录(只为复用 SC 优先的卡图裁决)
 * @returns           卡池条目(按卡牌编号排序);数据未就绪时返回空数组
 */
export function buildChainPool(
  cardBase: readonly RawCardBaseRow[] | null,
  cardPrints: readonly RawCardPrintRow[] | null,
  catalog: CardCatalog | null
): ChainPoolItem[] {
  if (!cardBase || !cardPrints) return [];

  const baseById = new Map<string, RawCardBaseRow>();
  for (const row of cardBase) {
    const id = asText(row.id);
    if (id) baseById.set(id, row);
  }

  const out: ChainPoolItem[] = [];
  const seen = new Set<string>();

  for (const print of cardPrints) {
    // 1) 平卡口径
    if (asText(print.extend_rarity_name) !== FLAT_RARITY) continue;

    // 2) 关联主表
    const cardId = asText(print.card_id);
    if (!cardId) continue;
    const base = baseById.get(cardId);
    if (!base) continue;

    // 3) 对外编号(去掉印刷后缀)
    const no = asText(print.card_no_extend).replace(/\*$/, '');
    if (!no || seen.has(no)) continue;
    seen.add(no);

    const category = normalizeCategory(base.card_category);
    out.push({
      id: no,
      name: asText(base.card_name_cn) || no,
      subtitle: asText(base.sub_title_cn),
      text: asText(base.effect_cn),
      category,
      colors: parseJsonArray(base.card_color_list),
      energy: toNumber(base.energy),
      power: toNumber(base.power),
      series: asText(print.series) || asText(base.series_name) || no.split('-')[0] || '',
      rarity: asText(print.rarity_name) || '未知',
      image: catalog?.cardImg.get(no) ?? '',
      banned: asText(base.is_banned).toLowerCase() === 'true'
    });
  }

  // 编号排序(OGN-001 → OGN-999 → OGS-…),同系列内按数字而非字典序
  out.sort((a, b) => {
    const [sa = '', na = ''] = a.id.split('-');
    const [sb = '', nb = ''] = b.id.split('-');
    if (sa !== sb) return sa < sb ? -1 : 1;
    return (parseInt(na, 10) || 0) - (parseInt(nb, 10) || 0);
  });

  return out;
}

/**
 * 卡池搜索。
 *
 * 搜索范围:卡名 / 副标题 / 编号 / 效果原文。
 * 上游只搜卡名+副标题;这里补上编号与效果文本 ——
 * 推演时经常按「横置」「迅捷」这类关键字找卡,只搜卡名不够用。
 * 多关键字以空格分隔,全部命中才返回(AND 语义)。
 */
export function searchPool(pool: readonly ChainPoolItem[], keyword: string): ChainPoolItem[] {
  const terms = keyword.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...pool];

  return pool.filter((item) => {
    const haystack = [item.name, item.subtitle, item.id, item.text, item.category]
      .join('\u0000')
      .toLowerCase();
    return terms.every((t) => haystack.includes(t));
  });
}

/**
 * 把池内一条转成盘内实例所需的「非实例字段」。
 * uid / player / custom 由 board.ts 在落盘时生成。
 */
export function poolItemToCardSource(item: ChainPoolItem): {
  cardId: string;
  name: string;
  subtitle: string;
  text: string;
  category: string;
  colors: string[];
  energy: number;
  power: number;
} {
  return {
    cardId: item.id,
    name: item.name,
    subtitle: item.subtitle,
    text: item.text,
    category: item.category,
    colors: [...item.colors],
    energy: item.energy,
    power: item.power
  };
}
