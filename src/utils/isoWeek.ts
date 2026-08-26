/* ================================================================
 * src/utils/isoWeek.ts
 *
 * ISO 8601 Week-of-Year 计算 + 滚动窗口周次聚类
 *
 * 修复原版硬编码 WEEK_GAP_DAYS = 4 的问题:
 *   - ISO Week 模式按国际标准"包含该年首个周四的周为第 1 周",
 *     跨年数据可比、可合并。
 *   - Rolling 模式保留旧的"相邻比赛日期间隔超过 N 天即切新周",
 *     适合赛季内多批次、需要按赛事实际节奏切分周次的场景。
 * ============================================================== */

import type { WeekBucket } from '@/types';

/**
 * 把任意日期字符串(优先 'YYYY-MM-DD',也兼容 ISO 时间戳)解析为 ISO Week。
 * 解析失败时返回 null,调用方应使用 '未知' 兜底。
 */
export function getISOWeek(input: string | Date): WeekBucket | null {
  const d =
    typeof input === 'string'
      ? new Date(input.length >= 10 ? input.slice(0, 10) : input)
      : new Date(input);

  if (Number.isNaN(d.getTime())) return null;

  // 1. 复制日期并把"本周"平移到 Thursday —— Thursday 所在 ISO 年 = 本周所在年
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7; // Monday=0 ... Sunday=6
  target.setDate(target.getDate() - dayNr + 3);

  // 2. 找到该 ISO 年的第 1 周(取 1 月 4 日所在周)
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const firstDayNr = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstDayNr + 3);

  const diffMs = target.valueOf() - firstThursday.valueOf();
  const week = 1 + Math.ceil(diffMs / (7 * 24 * 3600 * 1000));
  const year = target.getFullYear();

  if (week < 1 || week > 53) return null;

  return {
    year,
    week,
    label: `${year}-W${String(week).padStart(2, '0')}`
  };
}

/* ============================================================
 * Rolling window 模式
 * ============================================================ */

/** 两个 'YYYY-MM-DD' 日期之间的天数差(闭区间为 0) */
export function daysBetween(a: string, b: string): number {
  const ta = new Date(a.length >= 10 ? a.slice(0, 10) : a).getTime();
  const tb = new Date(b.length >= 10 ? b.slice(0, 10) : b).getTime();
  if (Number.isNaN(ta) || Number.isNaN(tb)) return Number.MAX_SAFE_INTEGER;
  return Math.round(Math.abs(tb - ta) / 86_400_000);
}

/**
 * 把一组有序日期(已 dedupe + sort)按滚动窗口切分。
 *  - 相邻日期之间间隔 > gapDays 时,切到下一周。
 *  - 输出 label 形如 '第1周'、'第2周'...,week 从 1 起算。
 */
export function bucketByRollingWindow(
  dates: readonly string[],
  gapDays: number
): { dateToLabel: Map<string, string>; list: readonly string[] } {
  const sorted = Array.from(new Set(dates.filter((d) => !!d))).sort();
  const dateToLabel = new Map<string, string>();
  const list: string[] = [];

  let bucketIdx = 0;
  let prev: string | null = null;

  for (const d of sorted) {
    if (prev !== null && daysBetween(prev, d) >= gapDays) {
      bucketIdx++;
    }
    const label = `第${bucketIdx + 1}周`;
    dateToLabel.set(d, label);
    if (list[list.length - 1] !== label) list.push(label);
    prev = d;
  }

  return { dateToLabel, list };
}

/**
 * 把'第N周'字符串转为 WeekBucket 对象。
 */
export function rollingLabelToBucket(label: string, order: number): WeekBucket {
  return { year: 0, week: order, label };
}

/* ============================================================
 * 排序辅助
 * ============================================================ */

export function compareWeekBucket(a: WeekBucket, b: WeekBucket): number {
  if (a.year !== b.year) return a.year - b.year;
  return a.week - b.week;
}
