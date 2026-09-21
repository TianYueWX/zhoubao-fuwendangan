/* ================================================================
 * src/components/chain/cardText.ts
 *
 * 卡牌效果文本的标记解析(纯函数)。
 *
 * 数据源约定:cards_base.effect_cn 里用双花括号标注两类东西 ——
 *   1. 能力关键字与状态:{{横置}} {{迅捷}} {{反应}} {{待命}} {{法盾}} {{游走}} …
 *   2. 符文与费用符号:{{S}}(战力){{A}} {{1}} {{红色}} {{紫色}} …
 *   3. 条件前缀:{{已强化>}} 这类带 '>' 的,表示它修饰后面的整段
 *   实测 971 张卡里共 1910 处标记、124 种不同标记。
 *
 * 上游 rune-chain-tools 直接把这些标记原样显示成 {{横置}},
 * 在牌桌上很难读。这里解析成片段,由组件渲染成高亮小片,
 * 既保留原文信息量,又让卡面可读。
 * ============================================================== */

import type { CardColor } from '@/types';

export type CardTextSegmentKind =
  /** 普通文本 */
  | 'text'
  /** 能力关键字(横置 / 迅捷 / 反应 …) */
  | 'keyword'
  /** 符文或费用符号(S / A / 1 / 2) */
  | 'symbol'
  /** 颜色域名(红色 / 紫色 …) */
  | 'domain'
  /** 条件前缀(已强化> …) */
  | 'condition';

export interface CardTextSegment {
  kind: CardTextSegmentKind;
  text: string;
  /** kind === 'domain' 时的颜色域,供着色 */
  color?: CardColor;
}

/** 颜色域中文名 → 色 token(与 src/types 的 CARD_COLOR_LABELS 反向对应) */
const DOMAIN_BY_LABEL: Readonly<Record<string, CardColor>> = Object.freeze({
  红色: 'red',
  绿色: 'green',
  蓝色: 'blue',
  黄色: 'yellow',
  紫色: 'purple',
  橙色: 'orange',
  无色: 'colorless'
});

/** 纯符号:单个大写字母或数字 */
const SYMBOL_RE = /^[A-Z]$|^\d+$/;

const MARKUP_RE = /\{\{(.*?)\}\}/g;

/** 解析卡牌效果文本为可渲染片段 */
export function parseCardText(raw: string): CardTextSegment[] {
  if (!raw) return [];

  const segments: CardTextSegment[] = [];
  let last = 0;
  MARKUP_RE.lastIndex = 0;

  let match: RegExpExecArray | null = MARKUP_RE.exec(raw);
  while (match !== null) {
    const inner = (match[1] ?? '').trim();
    const start = match.index;
    if (start > last) {
      pushText(segments, raw.slice(last, start));
    }
    if (inner) {
      segments.push(classify(inner));
    }
    last = start + match[0].length;
    match = MARKUP_RE.exec(raw);
  }

  if (last < raw.length) pushText(segments, raw.slice(last));
  return segments;
}

/** 普通文本也要处理换行,否则多段效果会挤成一行 */
function pushText(segments: CardTextSegment[], text: string): void {
  if (!text) return;
  const parts = text.split(/\r?\n/);
  parts.forEach((part, i) => {
    if (i > 0) segments.push({ kind: 'text', text: '\n' });
    if (part) segments.push({ kind: 'text', text: part });
  });
}

function classify(inner: string): CardTextSegment {
  // 条件前缀:{{已强化>}} —— 带 '>' 的标记修饰后续整段
  if (inner.endsWith('>')) {
    return { kind: 'condition', text: inner.slice(0, -1) };
  }
  const domain = DOMAIN_BY_LABEL[inner];
  if (domain) {
    return { kind: 'domain', text: inner, color: domain };
  }
  if (SYMBOL_RE.test(inner)) {
    return { kind: 'symbol', text: inner };
  }
  return { kind: 'keyword', text: inner };
}

/**
 * 效果文本的纯文本摘要(卡池列表、悬浮提示用)。
 * 把标记拆掉、压平换行,便于单行展示。
 */
export function plainText(raw: string, maxLength = 120): string {
  const flat = raw
    .replace(MARKUP_RE, (_all, inner: string) => String(inner).replace(/>$/, ''))
    .replace(/\s*\r?\n\s*/g, ' ')
    .trim();
  if (flat.length <= maxLength) return flat;
  return `${flat.slice(0, maxLength)}…`;
}
