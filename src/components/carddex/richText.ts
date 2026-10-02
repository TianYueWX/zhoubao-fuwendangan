/* ================================================================
 * src/components/carddex/richText.ts
 *
 * 卡牌效果文本 → 可交给 v-html 的安全 HTML(纯函数,可单测)。
 *
 * 与 admin/text.ts 的分工:
 *   那份服务编辑部校对预览,只认「白名单标签 + {{标记}} → 高亮 span」;
 *   这份服务卡牌详情弹窗,标记要换成**卡图图标**(card_icons),没有图标才退化成高亮文字。
 *
 * ⚠ 顺序是这里唯一的坑,也是 2026-10-02 修的那个 bug:
 *   必须**先按原文切标记,再对每一段各转义一次**。
 *   先整串转义、再在已转义的串上切标记,标记内层就会被转义两遍 ——
 *   `{{绝念>}}` 会在屏幕上显示成字面的 `绝念&gt;`。
 *   更隐蔽的代价是图标查找:card_icons 里有 9 个**名字自带 `>` 的条件变体图标**
 *   (绝念> / 迅捷> / 已强化> / 反应> / 等级3> / 等级6> / 等级11> / 等级16> / 鼓舞>),
 *   键被转义成 `绝念&gt;` 就一个都命中不了,条件变体图标集体退化成乱码文本。
 * ============================================================== */

/** 渲染 `{{标记}}` 需要的图标信息(card_icons 的一行) */
export interface RichIcon {
  name: string;
  url: string;
  isWhite: boolean;
}

/** effect_en 这类「库里存着真 HTML」的文本,只放行段落与强调类标签 */
const ALLOWED_TAGS = new Set([
  "P",
  "BR",
  "STRONG",
  "EM",
  "B",
  "I",
  "UL",
  "OL",
  "LI",
]);

const MARKUP_RE = /\{\{([^{}]+)\}\}/g;

const ESCAPES: Readonly<Record<string, string>> = Object.freeze({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
});

const ENTITIES: Readonly<Record<string, string>> = Object.freeze({
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
});

/** 把一段**纯文本**转义成可安全入 HTML 的形式 */
export function escapeHtmlText(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

/**
 * 还原一段已经被转义过的文本。
 * 单趟替换:所以 `&amp;gt;` 只会解成 `&gt;`(字面量),不会被解两次。
 */
export function decodeHtmlEntities(text: string): string {
  return text.replace(
    /&(amp|lt|gt|quot|#39);/g,
    (all, name: string) => ENTITIES[name] ?? all,
  );
}

/**
 * 标签白名单过滤:只留段落与强调,属性一律丢弃。
 * 仅这一步就消灭了 on* 事件处理器与 javascript: 协议,无需维护属性黑名单。
 */
function whitelistTags(raw: string): string {
  // 非浏览器环境(离线单测)没有 DOMParser —— 退化成「全部转义」,方向是更安全
  if (typeof DOMParser === "undefined") return escapeHtmlText(raw);
  const doc = new DOMParser().parseFromString(raw, "text/html");
  for (const el of [...doc.body.querySelectorAll("*")]) {
    if (!ALLOWED_TAGS.has(el.tagName))
      el.replaceWith(doc.createTextNode(el.textContent ?? ""));
    else for (const attr of [...el.attributes]) el.removeAttribute(attr.name);
  }
  return doc.body.innerHTML;
}

/**
 * 效果文本 → 安全 HTML。
 * @param raw   库里的原文(effect_cn 是纯文本 + `{{标记}}`;effect_en 是真 HTML)
 * @param icons card_icons 全量,用于把标记换成图标
 */
export function richEffectText(
  raw: string,
  icons: readonly RichIcon[] = [],
): string {
  if (!raw) return "";
  const iconMap = new Map(icons.map((i) => [i.name, i]));
  const isHtml = /<\/?[a-z][\s\S]*>/i.test(raw);
  // 换行只在纯文本路径转 <br>:HTML 路径原样交给浏览器排版(与改造前一致)
  const safe = isHtml
    ? whitelistTags(raw)
    : escapeHtmlText(raw).replace(/\r?\n/g, "<br>");

  return safe.replace(MARKUP_RE, (_all, inner: string) => {
      // safe 已经是转义过的文本,所以这里取到的标记要先还原成字面量,
      // 否则 `绝念>` 会以 `绝念&gt;` 的形态去查图标表,必然落空。
      const mark = decodeHtmlEntities(inner.trim());
      const icon = iconMap.get(mark);
      if (icon) {
        const cls = icon.isWhite ? "effect-icon white-source" : "effect-icon";
        return `<img class="${cls}" src="${escapeHtmlText(icon.url)}" alt="${escapeHtmlText(mark)}">`;
      }
      return `<strong>${escapeHtmlText(mark)}</strong>`;
    });
}
