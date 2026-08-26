/* ================================================================
 * src/utils/palette.ts
 *
 * 集中管理 ECharts 调色板、卡牌类型配色与颜色域配色。
 * 普通图表 series 配色用 CHART_PALETTE(可旋转),
 * 卡牌类型用 CATEGORY_COLORS,六色域用 CARD_COLOR_HEX(语义固定)。
 * ============================================================== */

import type { CardCategory, CardColor } from '@/types';

export const CHART_PALETTE: readonly string[] = [
  '#6366f1', // indigo
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#06b6d4', // cyan
  '#a855f7', // purple
  '#22c55e', // green
  '#eab308', // yellow
  '#0ea5e9', // sky
  '#f43f5e'  // rose
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

/** Tier 徽章配色(S/A/B/C) */
export const TIER_COLORS: Readonly<Record<string, { bg: string; text: string }>> = Object.freeze({
  S: { bg: 'bg-amber-100 dark:bg-amber-500/20 border-amber-300 dark:border-amber-500/40', text: 'text-amber-700 dark:text-amber-400' },
  A: { bg: 'bg-rose-100 dark:bg-rose-500/20 border-rose-300 dark:border-rose-500/40', text: 'text-rose-700 dark:text-rose-400' },
  B: { bg: 'bg-sky-100 dark:bg-sky-500/20 border-sky-300 dark:border-sky-500/40', text: 'text-sky-700 dark:text-sky-400' },
  C: { bg: 'bg-slate-100 dark:bg-slate-500/20 border-slate-300 dark:border-slate-500/40', text: 'text-slate-600 dark:text-slate-400' }
});
