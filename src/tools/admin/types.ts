/* ================================================================
 * src/tools/admin/types.ts
 *
 * 编辑部用到的库表行类型。
 * 与 fuwendangan_backend 的字段保持一致 —— 表结构不变,只是界面换了。
 * ============================================================== */

/** cards_base · 卡牌主数据 */
export interface CardBase {
  id: string;
  card_no: string | null;
  card_name_cn: string | null;
  card_name_en: string | null;
  sub_title_cn: string | null;
  sub_title_en: string | null;
  card_color_list: string[] | null;
  region: string[] | null;
  tag: string[] | null;
  keyword: string[] | null;
  advanced_tag: string[] | null;
  champion_tag: string | null;
  effect_cn: string | null;
  effect_en: string | null;
  flavor_text_cn: string | null;
  flavor_text_en: string | null;
  energy: number | null;
  return_energy: number | null;
  power: number | null;
  rarity_name: string | null;
  series_name: string | null;
  card_category: string[] | null;
  is_banned: boolean;
  deck_limit: number | null;
  updated_at: string | null;
}

/** card_prints · 印刷版本 */
export interface CardPrint {
  id: string;
  card_id: string;
  card_no_extend: string | null;
  rarity_name: string | null;
  extend_rarity_name: string | null;
  language: string | null;
  artist: string | null;
  img_cdn: string | null;
  tts_cdn: string | null;
  back_image: string | null;
  print_order: number | null;
  is_default: boolean;
  is_promo: boolean;
}

/** 新建但尚未落库的印刷版本行(id 为空) */
export type DraftPrint = Omit<CardPrint, 'id'> & { id: null };

/** rules · 规则书条目 */
export interface Rule {
  id: string;
  rule_number: string;
  parent_number: string | null;
  level: number | null;
  is_heading: boolean;
  text_zh: string | null;
  text_en: string | null;
  sort_order: number | null;
  rules_book: string | null;
  updated_at?: string | null;
}

/** series · 系列字典 */
export interface Series {
  code: string;
  name_cn: string | null;
  name_en: string | null;
  release_order: number | null;
  is_standard: boolean;
  is_active: boolean;
  base_count: number | null;
  alt_count: number | null;
  overnum_count: number | null;
  rune_count: number | null;
  token_count: number | null;
  cover_image: string | null;
}

/** card_icons · 关键词图标 */
export interface CardIcon {
  id: string;
  name_zh: string | null;
  name_en: string | null;
  url: string | null;
  url_en: string | null;
  storage_type: string | null;
  isWhite: boolean;
}

/** version · 发布标记 */
export interface VersionRow {
  id: number;
  name: string;
  updated_at: string | null;
}

/* ──────────────────────── deck_limit 三态 ──────────────────────── */

/**
 * deck_limit 语义(全站统一,勿改):
 *   null → 默认 3 张
 *   0    → 不限
 *   N    → 最多 N 张
 */
export type DeckMode = 'default' | 'unlimited' | 'limited';

export function deckLimitToMode(limit: number | null | undefined): DeckMode {
  if (limit === null || limit === undefined) return 'default';
  if (limit === 0) return 'unlimited';
  return 'limited';
}

export function modeToDeckLimit(mode: DeckMode, n: number): number | null {
  if (mode === 'default') return null;
  if (mode === 'unlimited') return 0;
  return n;
}

export function deckLimitLabel(limit: number | null | undefined): string {
  if (limit === null || limit === undefined) return '默认 3 张';
  if (limit === 0) return '不限';
  return `限 ${limit} 张`;
}
