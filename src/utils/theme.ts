/* ================================================================
 * src/utils/theme.ts
 * 运行时读取 CSS 变量 → 喂给 ECharts 的轴 / tooltip 颜色
 * 主题切换时,ChartCard 重新读取,实现 O(1) 重绘。
 * ============================================================== */

export interface ThemeColors {
  textColor: string;
  subTextColor: string;
  bgColor: string;
  axisLineColor: string;
  splitLineColor: string;
  tooltipBg: string;
  tooltipBorder: string;
}

const FALLBACK_LIGHT: ThemeColors = Object.freeze({
  textColor: '#404040',
  subTextColor: '#737373',
  bgColor: 'transparent',
  axisLineColor: '#d4d4d4',
  splitLineColor: '#eeeeee',
  tooltipBg: 'rgba(255, 255, 255, 0.97)',
  tooltipBorder: '#d4d4d4'
});

const FALLBACK_DARK: ThemeColors = Object.freeze({
  textColor: '#e5e5e5',
  subTextColor: '#a3a3a3',
  bgColor: 'transparent',
  axisLineColor: 'rgba(255,255,255,0.18)',
  splitLineColor: 'rgba(255,255,255,0.08)',
  tooltipBg: 'rgba(10,10,10,0.95)',
  tooltipBorder: 'rgba(255,255,255,0.15)'
});

function cssVar(name: string): string {
  if (typeof document === 'undefined') return '';
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function getChartColors(): ThemeColors {
  if (typeof document === 'undefined') return FALLBACK_LIGHT;
  const isDark = document.documentElement.classList.contains('dark');
  const fb = isDark ? FALLBACK_DARK : FALLBACK_LIGHT;
  return {
    textColor: cssVar('--color-text-primary') || fb.textColor,
    subTextColor: cssVar('--color-text-muted') || fb.subTextColor,
    bgColor: 'transparent',
    axisLineColor: cssVar('--color-axis-line') || fb.axisLineColor,
    splitLineColor: cssVar('--color-split-line') || fb.splitLineColor,
    tooltipBg: cssVar('--color-tooltip-bg') || fb.tooltipBg,
    tooltipBorder: cssVar('--color-tooltip-border') || fb.tooltipBorder
  };
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
