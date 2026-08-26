/* ================================================================
 * src/utils/palette.ts
 *
 * 集中管理 ECharts 调色板、卡牌类型配色与颜色域配色。
 * 普通图表 series 配色用 CHART_PALETTE(可旋转),
 * 卡牌类型用 CATEGORY_COLORS,六色域用 CARD_COLOR_HEX(语义固定)。
 * ============================================================== */

import type { CardCategory, CardColor } from '@/types';

/** 古典色系图表调色板(朱砂/远山黛/藤黄/黛绿/藕紫…) */
export const CHART_PALETTE: readonly string[] = [
  '#b23a27', // 朱砂
  '#3b4a5a', // 远山黛
  '#c59b46', // 藤黄
  '#5b8c6e', // 黛绿
  '#7c6a9e', // 藕紫
  '#4e8a8c', // 青碧
  '#a0724f', // 赭石
  '#5f7fa6', // 黛蓝
  '#8a8478', // 灰褐
  '#a33e2e'  // 深朱
];

/** 取一个循环的 series 颜色 */
export function pickChartColor(index: number): string {
  return CHART_PALETTE[index % CHART_PALETTE.length] ?? '#6366f1';
}

/** 卡牌类型 → 固定配色(主题切换时不变,保证数据辨识度) */
export const CATEGORY_COLORS: Readonly<Record<CardCategory, string>> = Object.freeze({
  传奇: '#0f172a',
  英雄单位: '#8b5cf6',
  单位: '#3b82f6',
  法术: '#ef4444',
  装备: '#f59e0b',
  符文: '#a78bfa',
  战场: '#06b6d4',
  其他: '#9ca3af'
});

/**
 * 六色域 → 品牌近似色。
 * 狂怒红 / 平静绿 / 心灵蓝 / 躯体黄 / 混沌紫 / 秩序橙 / 无色灰。
 */
export const CARD_COLOR_HEX: Readonly<Record<CardColor, string>> = Object.freeze({
  red: '#e2372b',
  green: '#3fa650',
  blue: '#2f7dd1',
  yellow: '#d9a514',
  purple: '#8b48c9',
  orange: '#e2762b',
  colorless: '#94a3b8'
});

/** Tier 徽章配色(S 朱砂 / A 藤黄 / B 黛蓝 / C 灰) */
export const TIER_COLORS: Readonly<Record<string, { bg: string; text: string }>> = Object.freeze({
  S: { bg: 'bg-brand-soft border-brand-faint', text: 'text-brand' },
  A: { bg: 'bg-[#f3ead6] border-[#d9c49a]', text: 'text-[#7a5c1e]' },
  B: { bg: 'bg-[#e8ebee] border-[#b9c0c9]', text: 'text-ink-muted' },
  C: { bg: 'bg-[#eeece5] border-[#d6d2c6]', text: 'text-ink-faint' }
});
