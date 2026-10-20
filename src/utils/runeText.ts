/* ================================================================
 * src/utils/runeText.ts
 *
 * 效果文本里的「本牌色域」占位符 {{C}} 的解析(纯函数,可单测)。
 *
 * 数据来源与语义:
 *   - 官方小程序接口把卡面符文符号写成 {{C}},表示**本牌所属色域的符文**,
 *     不是任意色(任意色是 {{A}},彩虹符文)。线上实例:RAD-105 鲁莽的发明家
 *     (混沌/紫)「支付{{C}}，以此抽一张牌。」——同一张卡的官网英文正文是
 *     「Pay :rb_rune_chaos: to draw 1.」,官方卡图 alt 则把该符号写成 [C]。
 *   - {{C}} 在 card_icons 里没有对应图标(官方关键词配置对 C 返回 null),
 *     所以渲染层必须按卡牌自身的 colors 换算成六色/彩虹符文图标。
 *
 * 口径(与编务约定一致):
 *   - 单色 → 该色符文图标;多色 → 按 card_color_list 原顺序,图标间用 "/" 分隔;
 *   - 无色 / colors 为空 → A(彩虹符文)图标;
 *   - 去重、忽略未知颜色值;有实色时 colorless / neutral 不参与。
 *
 * 返回 null 表示「调用方没提供颜色上下文」——渲染层据此保持旧行为,不解析 C。
 * ============================================================== */

import { CARD_COLOR_LABELS, type CardColor } from '@/types';

/** 卡牌颜色 token → card_icons 图标名(与 effect_cn 里 {{红色}} 等标记同键) */
export const RUNE_ICON_BY_COLOR: Readonly<Record<CardColor, string>> = Object.freeze({
  red: '红色',
  green: '绿色',
  blue: '蓝色',
  yellow: '黄色',
  purple: '紫色',
  orange: '橙色',
  colorless: 'A'
});

/** card_color_list 里可能出现的写法(neutral 在构筑模型中出现过,与无色同口径) */
const COLOR_BY_TOKEN: Readonly<Record<string, CardColor>> = Object.freeze({
  red: 'red',
  green: 'green',
  blue: 'blue',
  yellow: 'yellow',
  purple: 'purple',
  orange: 'orange',
  colorless: 'colorless',
  neutral: 'colorless'
});

/** 一处 {{C}} 解析出的一个色域符号 */
export interface RuneRef {
  /** 主图标名,也是查不到图标时粗体回退显示的字(红色 / A) */
  label: string;
  /** 卡牌色域;无色与空颜色都落到 colorless(A 彩虹符文) */
  color: CardColor;
  /** 图标查找顺序:主名(红色)→ 备用名(狂怒),兼容图标表的两种命名 */
  candidates: readonly string[];
}

function candidatesOf(color: CardColor): readonly string[] {
  const primary = RUNE_ICON_BY_COLOR[color];
  // 图标表若按 CARD_COLOR_LABELS 的「狂怒/平静…」命名,再兜底一层;
  // 无色只有 A,不拿「无色」图标顶替 —— 语义不同(任意色 vs 无色)。
  if (color === 'colorless') return [primary];
  const alias = CARD_COLOR_LABELS[color];
  return alias && alias !== primary ? [primary, alias] : [primary];
}

/**
 * 卡牌颜色 → {{C}} 要渲染的色域符号列表(去重、保序、忽略未知值)。
 * @param colors cards_base.card_color_list;传 null/undefined 表示不解析
 */
export function runeRefs(colors: readonly string[] | null | undefined): RuneRef[] | null {
  if (colors == null) return null;
  const seen = new Set<CardColor>();
  for (const raw of colors) {
    const color = COLOR_BY_TOKEN[String(raw ?? '').trim().toLowerCase()];
    if (color) seen.add(color);
  }
  const real = [...seen].filter((color) => color !== 'colorless');
  const effective: readonly CardColor[] = real.length ? real : ['colorless'];
  return effective.map((color) => ({
    label: RUNE_ICON_BY_COLOR[color],
    color,
    candidates: candidatesOf(color)
  }));
}

/** 文本标记是否为「本牌色域」占位符 {{C}}(兼容小写 c,防止录入手误) */
export function isColorMarker(mark: string): boolean {
  return mark === 'C' || mark === 'c';
}
