/* ================================================================
 * src/tools/admin/luaExport.ts
 *
 * 卡表 → TTS mod 的 Lua 数据块(`local all_cards = {...}`)。
 *
 * 纯函数,不依赖浏览器 / 网络,供卡牌校勘页导出与 Node 验收脚本共用。
 *
 * 口径(与 TTS mod 模板逐字对齐,只导 SC 语言印刷版):
 *   card_no            ← card_prints.card_no_extend
 *   card_name          ← cards_base.card_name_cn
 *   sub_title          ← cards_base.sub_title_cn
 *   card_effect        ← cards_base.effect_cn(不是 effect_en 的 HTML)
 *   front_image_en     ← card_prints.img_cdn(SC 印刷版)
 *   back_image         ← card_prints.back_image
 *   card_category      ← cards_base.card_category[0]
 *   rarity_name        ← cards_base.rarity_name(不是印刷版的 rarity_name:
 *                         异画印刷版的 rarity_name 在库里是「异画」,
 *                         而 mod 模板要的是基础卡稀有度,如 OGN-007a = 普通)
 *   extend_rarity_name ← card_prints.extend_rarity_name
 *   series_name        ← cards_base.series_name ?? card_prints.series
 *   is_promo           ← card_prints.is_promo(Lua 布尔字面量 true/false)
 * ============================================================== */

/** 导出所需的 cards_base 行(只取用到的列) */
export interface LuaExportCard {
  id: string;
  card_name_cn: string | null;
  sub_title_cn: string | null;
  effect_cn: string | null;
  card_category: string[] | null;
  rarity_name: string | null;
  series_name: string | null;
}

/** 导出所需的 card_prints 行(调用方只传 SC 印刷版) */
export interface LuaExportPrint {
  card_id: string | null;
  card_no_extend: string | null;
  img_cdn: string | null;
  back_image: string | null;
  extend_rarity_name: string | null;
  series: string | null;
  is_promo: boolean;
}

/** 渲染用的扁平条目,字段顺序即模板字段顺序 */
export interface LuaCardEntry {
  card_no: string;
  card_name: string | null;
  sub_title: string | null;
  card_effect: string | null;
  front_image_en: string | null;
  back_image: string | null;
  card_category: string | null;
  rarity_name: string | null;
  extend_rarity_name: string | null;
  series_name: string | null;
  is_promo: boolean;
}

export interface LuaBuildResult {
  text: string;
  total: number;
  /** 印刷版找不到对应基础卡(或 card_id 为空) */
  skippedNoBase: number;
  /** 印刷版没有 card_no_extend,无法生成 card_no */
  skippedNoCardNo: number;
}

const FIELD_ORDER = [
  'card_no',
  'card_name',
  'sub_title',
  'card_effect',
  'front_image_en',
  'back_image',
  'card_category',
  'rarity_name',
  'extend_rarity_name',
  'series_name',
  'is_promo'
] as const;

/**
 * Lua 短字符串转义:反斜杠、双引号、三种换行统一为 `\n`。
 * 库里的 effect_cn 是 CRLF,模板是 LF —— 这一步是格式对齐的关键。
 */
export function escapeLuaString(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** null / undefined / 空串 → `nil`,否则输出已转义的 Lua 字符串字面量 */
export function luaValue(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return 'nil';
  return `"${escapeLuaString(value)}"`;
}

/** 把基础卡 + SC 印刷版拼成扁平条目(按 card_no 排序,过滤无基础卡的印刷版) */
export function buildLuaEntries(
  cards: readonly LuaExportCard[],
  prints: readonly LuaExportPrint[]
): Omit<LuaBuildResult, 'text'> & { entries: LuaCardEntry[] } {
  const baseById = new Map(cards.map((c) => [c.id, c]));
  const entries: LuaCardEntry[] = [];
  let skippedNoBase = 0;
  let skippedNoCardNo = 0;

  for (const print of prints) {
    const cardNo = print.card_no_extend;
    if (!cardNo) {
      skippedNoCardNo += 1;
      continue;
    }
    const base = print.card_id ? baseById.get(print.card_id) : undefined;
    if (!base) {
      skippedNoBase += 1;
      continue;
    }
    entries.push({
      card_no: cardNo,
      card_name: base.card_name_cn,
      sub_title: base.sub_title_cn,
      card_effect: base.effect_cn,
      front_image_en: print.img_cdn,
      back_image: print.back_image,
      card_category: base.card_category?.[0] ?? null,
      rarity_name: base.rarity_name,
      extend_rarity_name: print.extend_rarity_name,
      series_name: base.series_name ?? print.series,
      is_promo: print.is_promo
    });
  }

  entries.sort((a, b) => (a.card_no < b.card_no ? -1 : a.card_no > b.card_no ? 1 : 0));

  return { entries, total: entries.length, skippedNoBase, skippedNoCardNo };
}

/** 渲染 `local all_cards = {...}`,格式与 TTS mod 模板一致 */
export function renderAllCardsLua(entries: readonly LuaCardEntry[]): string {
  const lines: string[] = ['local all_cards = {'];
  for (const entry of entries) {
    lines.push('    {');
    for (const key of FIELD_ORDER) {
      const value = entry[key];
      const literal = typeof value === 'boolean' ? String(value) : luaValue(value);
      lines.push(`        ["${key}"] = ${literal},`);
    }
    lines.push('    },');
  }
  lines.push('}');
  return `${lines.join('\n')}\n`;
}

/** 一步到位:基础卡 + SC 印刷版 → Lua 文本 + 统计 */
export function buildAllCardsLua(
  cards: readonly LuaExportCard[],
  prints: readonly LuaExportPrint[]
): LuaBuildResult {
  const { entries, total, skippedNoBase, skippedNoCardNo } = buildLuaEntries(cards, prints);
  return { text: renderAllCardsLua(entries), total, skippedNoBase, skippedNoCardNo };
}
