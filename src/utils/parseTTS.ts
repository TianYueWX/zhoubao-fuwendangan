/* ================================================================
 * src/utils/parseTTS.ts
 *
 * TTS_code 字符串解析 + 卡牌类型归一化
 *
 * TTS_code 形如 'OGN-308-2 VEN-197-1',空格分隔的 三元组 (系列-编号-张数),
 * 本文件产出:
 *   parseTTSCode → Map<cardId, count>  (cardId = 系列 + '-' + 编号)
 *   normalizeCategory → '单位' | '法术' | '装备' | '符文' | '战场' | '其他'
 * ============================================================== */

import type { CardCategory } from '@/types';

/**
 * 解析 TTS_code 字符串为"编号 → 张数"Map。
 * - 容错处理空、空白、单项异常(JUNK 输入不会抛错)
 * - 容许尾部 '*'(原 index.html 中 'card_no_extend.replace(/\*$/, "")' 兼容)
 */
export function parseTTSCode(input: string | null | undefined): Map<string, number> {
  const result = new Map<string, number>();
  if (!input) return result;
  const parts = input.trim().split(/\s+/);
  for (const part of parts) {
    if (!part) continue;
    const segs = part.split('-');
    if (segs.length < 2) continue;
    const series = segs[0];
    const no = (segs[1] ?? '').replace(/\*$/, '').trim();
    if (!series || !no) continue;
    const id = `${series}-${no}`;
    result.set(id, (result.get(id) ?? 0) + 1);
  }
  return result;
}

/* ============================================================
 * 卡牌类型归一化
 * 原版 card_category 是 JSON 数组字符串,如 ["单位"] / ["英雄", "专属", "单位"]
 * 第一项为'英雄'/'专属'/'指示物'时剥去该前缀,统一映射到 6 大基础类型。
 * ============================================================ */

const CATEGORY_PREFIX_STRIP = /^(专属|指示物)/u;

const ALLOWED: ReadonlySet<CardCategory> = new Set<CardCategory>([
  '传奇',
  '英雄单位',
  '单位',
  '法术',
  '装备',
  '符文',
  '战场',
  '其他'
]);

export function normalizeCategory(raw: string | null | undefined): CardCategory {
  let s: string = '其他';
  if (raw) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && typeof arr[0] === 'string') s = arr[0];
    } catch {
      /* 不是合法 JSON,例如某些人工改写后的 CSV '单位' 单值,直接用 */
      if (/^[\u4e00-\u9fa5]+$/.test(raw.trim())) s = raw.trim();
    }
  }

  s = s.replace(CATEGORY_PREFIX_STRIP, '');

  // '传奇' 与 '英雄单位' 作为独立类型保留(域对识别 / UI 徽章需要)
  return (ALLOWED.has(s as CardCategory) ? (s as CardCategory) : '其他');
}
