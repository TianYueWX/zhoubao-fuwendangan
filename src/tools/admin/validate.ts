/* ================================================================
 * src/tools/admin/validate.ts
 *
 * 编辑部输入校验(纯函数,零依赖,可在 Node 里直接单测)。
 * 抽出来是因为这些判断必须一致:界面上拦不住的值,写进库就是脏数据。
 * ============================================================== */

/**
 * 图标 URL 是否可用。
 * 允许:http(s) 外链、站内绝对路径(/runes/xx.svg)、data:image 内联。
 * 拒绝:空值、裸文件名、javascript: 等协议 —— 图标最终会进 <img src>, 
 * 放行任意协议等于给自己留一个注入口。
 */
export function isUsableIconUrl(url: string | null | undefined): boolean {
  const u = (url ?? '').trim();
  if (!u) return false;
  if (/^data:image\//i.test(u)) return true;
  if (u.startsWith('//')) return true; // 协议相对
  if (u.startsWith('/')) return true; // 站内绝对路径
  return /^https?:\/\//i.test(u);
}

/** 系列代码:大写字母数字,可含连字符;长度 1–16 */
export function isUsableSeriesCode(code: string | null | undefined): boolean {
  const c = (code ?? '').trim();
  return /^[A-Za-z0-9][A-Za-z0-9-]{0,15}$/.test(c);
}

/** 规则编号:数字开头、可含点与字母(如 053.1 / 133.4.b),长度 ≤ 24 */
export function isUsableRuleNumber(num: string | null | undefined): boolean {
  const n = (num ?? '').trim();
  return n.length > 0 && n.length <= 24 && /^[0-9][0-9A-Za-z.\-]*$/.test(n);
}
