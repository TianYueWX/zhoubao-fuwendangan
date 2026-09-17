/* ================================================================
 * src/tools/admin/text.ts
 *
 * 档案文本处理(纯函数,可单测)。
 *
 * 背景:库里的 effect_en 存着**真实 HTML**(如 `<p>If you've played…</p>`),
 * 而 effect_cn 多为纯文本 + `{{标记}}`。校对时需要把标记渲染成可视标签,
 * 但又不能对库内容直接 v-html —— 那等于给自己开一个存储型 XSS 口子。
 *
 * 约定:
 *   1. 先按标签白名单过滤(只留段落/强调类标签),并**丢弃全部属性**;
 *   2. 再把 `{{标记}}` 换成高亮 span,标记内部文本做转义;
 *   3. 输出可以安全地交给 v-html。
 * ============================================================== */

const ALLOWED_TAGS = new Set(['p', 'br', 'b', 'strong', 'i', 'em', 'span', 'sub', 'sup', 'u']);

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 标签白名单过滤。
 * 丢弃所有属性 —— 仅此一步就消灭了 on* 事件处理器与 javascript: 协议,
 * 无需再维护属性黑名单。
 */
export function sanitizeCardText(input: string | null | undefined): string {
  if (!input) return '';
  // 连同内容一起去掉 script / style
  let s = input.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  // 必须同时捕获斜杠,否则开标签会被误写成闭标签(<p> → </p>)
  s = s.replace(
    /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g,
    (_m, slash: string, rawTag: string) => {
      const tag = rawTag.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) return '';
      return `<${slash}${tag}>`;
    }
  );
  return s;
}

/**
 * 效果文本预览:白名单过滤 + `{{标记}}` 高亮。
 * 返回值可安全用于 v-html。
 */
export function renderEffectPreview(input: string | null | undefined): string {
  const safe = sanitizeCardText(input);
  return safe.replace(/\{\{([^{}]+)\}\}/g, (_m, inner: string) => {
    return `<span class="effect-mark">${escapeHtml(inner.trim())}</span>`;
  });
}

/** 提取文本里的全部 `{{标记}}`(去重、保序) */
export function extractMarks(input: string | null | undefined): string[] {
  if (!input) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /\{\{([^{}]+)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) {
    const t = (m[1] ?? '').trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/** 单行截断(列表与节点标签用) */
export function truncate(text: string | null | undefined, max = 28): string {
  if (!text) return '';
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** ISO 时间 → 本地可读;空值给破折号 */
export function formatTime(ts: string | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toLocaleString('zh-CN', { hour12: false });
}
