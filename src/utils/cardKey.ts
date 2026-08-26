/* ================================================================
 * src/utils/cardKey.ts
 *
 * 卡牌规范身份键(v3 领域修正):
 *   同一张卡会因稀有度/印刷版本不同而拥有多个卡号(如 虚空之女
 *   OGN-247 与 OGN-299 实为同一张卡),所有卡级聚合必须按
 *   「同名 + 副标题(如有)」归并,而非按卡号。
 *
 *   规范键 = card_name_cn + ('|' + sub_title_cn 若有)
 * ============================================================== */

/**
 * 计算卡牌规范键。
 * @param name 卡名(card_name_cn / cardName)
 * @param subtitle 副标题(sub_title_cn / subTitle),可为空
 */
export function cardKey(name: string, subtitle?: string | null): string {
  const n = (name ?? '').trim();
  if (!n) return '';
  const s = (subtitle ?? '').trim();
  return s ? `${n}|${s}` : n;
}
