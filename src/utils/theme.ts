/* ================================================================
 * src/utils/theme.ts
 * 宣纸·卷宗单主题 → 喂给 ECharts 的轴 / tooltip 颜色
 * 颜色以 CSS 变量为单一来源,缺失时回退内置值。
 * ============================================================== */

export interface ThemeColors {
  textColor: string;
  subTextColor: string;
  bgColor: string;
  axisLineColor: string;
  splitLineColor: string;
  tooltipBg: string;
  tooltipBorder: string;
  /** 中国地图:省份底色 / 描边 / 高亮 */
  mapArea: string;
  mapBorder: string;
  mapEmphasis: string;
  /** 省份热度色带(3 段) */
  mapRamp: [string, string, string];
  /** 城市×英雄热力色带(4 段) */
  heatRamp: [string, string, string, string];
}

const FALLBACK: ThemeColors = Object.freeze({
  textColor: '#2c2c2c',
  subTextColor: '#3b4a5a',
  bgColor: 'transparent',
  axisLineColor: 'rgba(59,74,90,0.28)',
  splitLineColor: 'rgba(59,74,90,0.12)',
  tooltipBg: 'rgba(251,249,243,0.98)',
  tooltipBorder: 'rgba(59,74,90,0.3)',
  mapArea: '#efede6',
  mapBorder: '#b9c0c9',
  mapEmphasis: '#e4e1d8',
  mapRamp: ['#ece9e0', '#8e9aa8', '#3b4a5a'] as [string, string, string],
  heatRamp: ['#f4f1ea', '#d9c49a', '#c59b46', '#b23a27'] as [string, string, string, string]
});

function cssVar(name: string): string {
  if (typeof document === 'undefined') return '';
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** 读取 CSS 变量色带(逗号分隔),缺失时回退 */
function cssVarList(name: string, fallback: readonly string[]): string[] {
  if (typeof document === 'undefined') return [...fallback];
  const raw = cssVar(name);
  if (!raw) return [...fallback];
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length >= fallback.length ? parts : [...fallback];
}

export function getChartColors(): ThemeColors {
  return {
    textColor: cssVar('--color-text-primary') || FALLBACK.textColor,
    subTextColor: cssVar('--color-text-muted') || FALLBACK.subTextColor,
    bgColor: 'transparent',
    axisLineColor: cssVar('--color-axis-line') || FALLBACK.axisLineColor,
    splitLineColor: cssVar('--color-split-line') || FALLBACK.splitLineColor,
    tooltipBg: cssVar('--color-tooltip-bg') || FALLBACK.tooltipBg,
    tooltipBorder: cssVar('--color-tooltip-border') || FALLBACK.tooltipBorder,
    mapArea: cssVar('--color-map-area') || FALLBACK.mapArea,
    mapBorder: cssVar('--color-map-border') || FALLBACK.mapBorder,
    mapEmphasis: cssVar('--color-map-emphasis') || FALLBACK.mapEmphasis,
    mapRamp: cssVarList('--color-map-ramp-1, --color-map-ramp-2, --color-map-ramp-3', FALLBACK.mapRamp) as [string, string, string],
    heatRamp: cssVarList('--color-heat-ramp-1, --color-heat-ramp-2, --color-heat-ramp-3, --color-heat-ramp-4', FALLBACK.heatRamp) as [string, string, string, string]
  };
}

/** 朱砂红(用于散点/气泡等图表强调色) */
export function getBrandColor(): string {
  if (typeof document === 'undefined') return '#b23a27';
  return cssVar('--color-brand') || '#b23a27';
}

/**
 * 给一个 EChartsOption 注入主题颜色到 axis / tooltip / text,
 * 同时保留调用方的自定义项不被覆盖。
 */
export function injectTheme<E extends Record<string, unknown>>(option: E): E {
  if (typeof document === 'undefined') return option;
  const cc = getChartColors();

  const tooltip = {
    backgroundColor: cc.tooltipBg,
    borderColor: cc.tooltipBorder,
    textStyle: { color: cc.textColor },
    ...((option.tooltip as object) ?? {})
  };

  return {
    ...option,
    tooltip
  };
}

/** 提供一个"axis 基础参数"工厂,各 Tab 用其构造 xAxis/yAxis */
export function themedAxes(): {
  axisBase: Record<string, unknown>;
} {
  const cc = getChartColors();
  const axisBase = {
    axisLabel: { color: cc.textColor },
    nameTextStyle: { color: cc.subTextColor },
    axisLine: { lineStyle: { color: cc.axisLineColor } },
    splitLine: { lineStyle: { color: cc.splitLineColor } }
  };
  return { axisBase };
}
