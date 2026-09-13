/* ================================================================
 * src/utils/tableImage.ts
 *
 * 表格 → 分享长图(PNG)。纯 Canvas 手绘,不引第三方依赖、不加载任何远程图片,
 * 因此画布永不被跨域污染,离线也能导出。
 *
 * 输入是**页面里真实的 <table> DOM**:列宽按内容实测,行序即当前筛选/排序后的
 * 视觉顺序,所见即所得。特殊单元格自动识别并还原为图形:
 *   - [data-card-colors] 卡图位置 → 颜色域渐变色块(卡图 CDN 未开 CORS,不能入画)
 *   - 小尺寸带底色 span        → 色域圆点
 *   - 内联 width:% 的进度条    → 携带率条
 *   - 带边框底色的短文本 span  → 徽章(Tier / Δ)
 *   - input[type=checkbox]     → ✓ / 空
 *
 * 报头/期号/周次/口径说明由调用方传入,版式与站点一致(宣纸底 + 朱砂强调)。
 * ============================================================== */

import { CARD_COLOR_HEX } from '@/utils/palette';
import type { CardColor } from '@/types';

export interface TableImageMeta {
  /** 朱砂眉题(如「第二版 · 强弱榜」) */
  eyebrow?: string;
  /** 标题(如「传奇 Tier List」) */
  title: string;
  /** 口径说明(小节注脚) */
  note?: string;
  /** 报头右侧:期号 / 数据包名 */
  issue?: string;
  /** 当前周次范围 */
  week?: string;
  /** 样本口径(如「809/2732 套」) */
  sample?: string;
}

export interface TableImageResult {
  blob: Blob;
  width: number;
  height: number;
  fileName: string;
  /** 因超出单图行数上限而未画入的行数(0 = 全量) */
  droppedRows: number;
}

/* ── 版面常量(CSS 像素;最终按 dpr 放大) ── */
const OUTER_PAD = 44; // 画布四周留白
const BLOCK_PAD = 22; // 表格卡片内边距
const CELL_PAD_X = 14;
const ROW_H = 34;
const HEAD_H = 40;
const GROUP_H = 32;
const FONT_SIZE = 13.5;
const MIN_COL_W = 64;
const MAX_COL_W = 420;
/** 单图最多画多少行(超出部分不画,页脚注明) */
const MAX_ROWS = 200;
/** 画布像素预算(约 30MP),超出则降低 dpr 而不是失败 */
const PIXEL_BUDGET = 30_000_000;

const FONT_SANS =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';
const FONT_DISPLAY = '"Noto Serif SC", "Songti SC", STSong, SimSun, serif';
const FONT_LATIN = 'Cinzel, Georgia, "Times New Roman", serif';
const FONT_MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const FALLBACK = {
  pageBg: '#f4f1ea',
  cardBg: '#fbf9f3',
  cardBorder: 'rgba(59,74,90,0.16)',
  panelBorder: 'rgba(59,74,90,0.18)',
  theadBg: '#f7f4ec',
  text: '#2c2c2c',
  muted: '#3b4a5a',
  faint: '#8a8478',
  brand: '#b23a27',
  brandInk: '#fff8f0',
  hairline: 'rgba(59,74,90,0.28)'
};

function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function palette() {
  return {
    pageBg: cssVar('--color-page-bg', FALLBACK.pageBg),
    cardBg: cssVar('--color-card-bg', FALLBACK.cardBg),
    cardBorder: cssVar('--color-card-border', FALLBACK.cardBorder),
    panelBorder: cssVar('--color-panel-border', FALLBACK.panelBorder),
    theadBg: cssVar('--color-thead-bg', FALLBACK.theadBg),
    text: cssVar('--color-text-primary', FALLBACK.text),
    muted: cssVar('--color-text-muted', FALLBACK.muted),
    faint: cssVar('--color-text-subtle', FALLBACK.faint),
    brand: cssVar('--color-brand', FALLBACK.brand),
    brandInk: cssVar('--color-brand-ink', FALLBACK.brandInk),
    hairline: cssVar('--color-hairline', FALLBACK.hairline),
    rowLine: 'rgba(59,74,90,0.08)'
  };
}

type Align = 'left' | 'center' | 'right';

interface CellModel {
  text: string;
  align: Align;
  color: string;
  bold: boolean;
  /** 单元格自身底色(构筑对比矩阵的共通/部分/独有着色) */
  bg?: string;
  swatch?: string[];
  dots?: string[];
  barPct?: number;
  chip?: { text: string; bg: string; border: string; color: string };
  check?: boolean;
}

interface RowModel {
  kind: 'head' | 'data' | 'group';
  cells: CellModel[];
  /** group 行:跨列的组标题 */
  label?: string;
}

interface TableModel {
  rows: RowModel[];
  cols: number;
}

/* ──────────────────────────── DOM → 模型 ──────────────────────────── */

function linesOf(el: HTMLElement): string[] {
  const raw = el.innerText || el.textContent || '';
  return raw
    .split('\n')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function textColorOf(el: HTMLElement, base: string): string {
  for (const d of Array.from(el.querySelectorAll<HTMLElement>('*'))) {
    if (!(d.textContent || '').trim()) continue;
    const c = getComputedStyle(d).color;
    if (c && c !== base) return c;
  }
  return base;
}

/** '#f4f1ea' → 'rgb(244, 241, 234)':与 getComputedStyle 的写法对齐后才好比较 */
function normalizeColor(c: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(c.trim());
  if (!m?.[1]) return c.trim();
  const n = parseInt(m[1], 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

function readCell(el: HTMLElement, ignoreBg: readonly string[] = []): CellModel {
  const cs = getComputedStyle(el);
  const align: Align =
    cs.textAlign === 'right' ? 'right' : cs.textAlign === 'center' ? 'center' : 'left';
  const base = cs.color || FALLBACK.muted;
  const cell: CellModel = {
    text: '',
    align,
    color: base,
    bold: parseInt(cs.fontWeight, 10) >= 600 || !!el.querySelector('b, strong')
  };

  // 单元格底色(排除页面/卡片/表头同色底,它们只用于 sticky 或分组)
  const bg = cs.backgroundColor;
  if (bg && bg !== 'transparent' && !/rgba?\([^)]*,\s*0\)$/.test(bg) && !ignoreBg.includes(bg)) {
    cell.bg = bg;
  }

  // 勾选框(候选卡组「选」列)
  const box = el.querySelector<HTMLInputElement>('input[type=checkbox]');
  if (box) cell.check = box.checked;

  // 卡图占位色块(CardThumb 提供 data-card-colors:色域名,需映射成十六进制)
  const sw = el.querySelector<HTMLElement>('[data-card-colors]');
  if (sw) {
    const names = (sw.dataset.cardColors || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const hexes = (names.length ? names : ['colorless']).map(
      (n) => CARD_COLOR_HEX[n as CardColor] ?? n
    );
    cell.swatch = hexes.filter((h) => /^(#|rgb|hsl)/.test(h));
    if (cell.swatch.length === 0) cell.swatch = [CARD_COLOR_HEX.colorless];
  }

  // 色域圆点 / 徽章 / 进度条
  const spans = Array.from(el.querySelectorAll<HTMLElement>('span'));
  const dots: string[] = [];
  for (const s of spans) {
    const inline = s.style.background || s.style.backgroundColor;
    if (!inline || !/^(#|rgb|hsl)/.test(inline)) continue;
    const w = s.offsetWidth;
    const h = s.offsetHeight;
    if (w === 0 || h === 0 || w > 18 || h > 18) continue;
    if ((s.textContent || '').trim()) continue;
    dots.push(inline);
  }
  if (dots.length) cell.dots = dots;

  const barEl = el.querySelector<HTMLElement>('div[style*="width"]');
  if (barEl) {
    const m = /([\d.]+)%/.exec(barEl.style.width);
    if (m?.[1]) cell.barPct = Math.max(0, Math.min(100, parseFloat(m[1])));
  }

  for (const s of spans) {
    const t = (s.textContent || '').trim();
    if (!t || t.length > 10) continue;
    const scs = getComputedStyle(s);
    if (parseFloat(scs.borderTopWidth) === 0) continue;
    const bg = scs.backgroundColor;
    if (!bg || bg === 'transparent' || /rgba?\([^)]*,\s*0\)$/.test(bg)) continue;
    cell.chip = { text: t, bg, border: scs.borderTopColor, color: scs.color };
    break;
  }

  const lines = linesOf(el);
  cell.text = lines.join(' · ');
  if (cell.chip && cell.text === cell.chip.text) cell.text = '';
  if (!cell.chip && cell.text) cell.color = textColorOf(el, base);
  return cell;
}

function readTable(
  table: HTMLTableElement,
  ignoreBg: readonly string[] = [],
  maxRows = MAX_ROWS + 1
): { model: TableModel; totalRows: number } {
  const headRow = table.querySelector('thead tr:last-child');
  const headCells = headRow
    ? Array.from(headRow.children).map((c) => readCell(c as HTMLElement, ignoreBg))
    : [];
  const cols = headCells.length;

  const rows: RowModel[] = [];
  if (headCells.length) rows.push({ kind: 'head', cells: headCells });

  const trs = Array.from(table.querySelectorAll('tbody tr'));
  let totalRows = 0;
  for (const tr of trs) {
    const kids = Array.from(tr.children) as HTMLElement[];
    if (kids.length === 0) continue;
    const span = kids.length === 1 ? kids[0]! : null;
    const isGroup = !!span?.getAttribute('colspan');
    if (!isGroup) totalRows += 1;
    // 行数上限:超出部分连 DOM 都不再读(innerText 逐格测量很贵)
    if (rows.length > maxRows) continue;
    if (isGroup && span) {
      rows.push({ kind: 'group', cells: [], label: linesOf(span).join(' · ') });
      continue;
    }
    const cells = kids.map((k) => readCell(k, ignoreBg));
    if (cells.every((c) => !c.text && !c.swatch && !c.dots && !c.chip && c.barPct == null))
      continue; // 空占位行
    rows.push({ kind: 'data', cells });
  }
  return { model: { rows, cols }, totalRows };
}

/* ──────────────────────────── 测量与排版 ──────────────────────────── */

function fontStr(size: number, weight: string, family: string): string {
  return `${weight} ${size}px ${family}`;
}

interface Layout {
  colW: number[];
  scale: number;
  width: number;
  height: number;
  dpr: number;
  contentW: number;
  headerH: number;
  tableTop: number;
  rowTops: number[];
  rowHeights: number[];
}

function cellWidth(ctx: CanvasRenderingContext2D, cell: CellModel, isHead: boolean): number {
  let w = 0;
  if (cell.swatch) w += 32 + 8;
  if (cell.check) w += 16;
  if (cell.text) {
    ctx.font = fontStr(FONT_SIZE, isHead ? '600' : cell.bold ? '700' : '400', FONT_SANS);
    w += ctx.measureText(cell.text).width;
  }
  if (cell.chip) w += ctx.measureText(cell.chip.text).width + 18;
  if (cell.dots) w += cell.dots.length * 12 + 2;
  if (cell.barPct != null) w += 66 + 8;
  return w;
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(text.slice(0, mid) + '…').width <= max) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + '…';
}

function buildLayout(
  ctx: CanvasRenderingContext2D,
  model: TableModel,
  meta: TableImageMeta,
  droppedRows: number
): Layout {
  const colW: number[] = new Array(model.cols).fill(MIN_COL_W);
  for (const row of model.rows) {
    if (row.kind === 'group') continue;
    row.cells.forEach((cell, i) => {
      if (i >= model.cols) return;
      const w = cellWidth(ctx, cell, row.kind === 'head') + CELL_PAD_X * 2;
      colW[i] = Math.min(MAX_COL_W, Math.max(colW[i]!, w));
    });
  }
  const contentW = colW.reduce((s, w) => s + w, 0);
  const maxContent = 1680 - OUTER_PAD * 2 - BLOCK_PAD * 2;
  const scale = contentW > maxContent ? maxContent / contentW : 1;

  const rowsToDraw = model.rows.slice(0, MAX_ROWS + 1);
  const rowHeights = rowsToDraw.map((r) =>
    r.kind === 'head' ? HEAD_H : r.kind === 'group' ? GROUP_H : ROW_H
  );
  const tableH = rowHeights.reduce((s, h) => s + h, 0) + 2;

  const headerH = headerHeight(meta);

  const width = contentW * scale + OUTER_PAD * 2 + BLOCK_PAD * 2;
  const height =
    headerH + tableH * scale + BLOCK_PAD * 2 + footerHeight(droppedRows) + OUTER_PAD * 2;

  const rowTops: number[] = [];
  let acc = 0;
  for (const h of rowHeights) {
    rowTops.push(acc);
    acc += h;
  }

  let dpr = 2;
  while (dpr > 1 && width * height * dpr * dpr > PIXEL_BUDGET) dpr -= 0.5;

  return {
    colW,
    scale,
    width,
    height,
    dpr,
    contentW,
    headerH,
    tableTop: headerH + BLOCK_PAD,
    rowTops,
    rowHeights
  };
}

function headerHeight(meta: TableImageMeta): number {
  let h = 30; // 报头
  h += 16; // 发丝线间距
  if (meta.eyebrow) h += 20;
  h += 36; // 标题
  if (meta.note) h += 20;
  h += 18; // 标题区与表格间距
  return h;
}

function footerHeight(droppedRows: number): number {
  return 16 + 18 + (droppedRows > 0 ? 16 : 0);
}

/* ──────────────────────────── 绘制 ──────────────────────────── */

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawSwatch(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  colors: string[],
  C: ReturnType<typeof palette>
): number {
  const w = 24;
  const h = 30;
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  const list = colors.length ? colors : ['#94a3b8'];
  list.forEach((c, i) => g.addColorStop(list.length === 1 ? 0 : i / (list.length - 1), c));
  ctx.fillStyle = g;
  roundRect(ctx, x, y, w, h, 4);
  ctx.fill();
  ctx.strokeStyle = C.cardBorder;
  ctx.lineWidth = 1;
  ctx.stroke();
  return w + 8;
}

function drawChip(
  ctx: CanvasRenderingContext2D,
  x: number,
  centerY: number,
  chip: { text: string; bg: string; border: string; color: string }
): number {
  ctx.font = fontStr(11, '700', FONT_SANS);
  const w = ctx.measureText(chip.text).width + 14;
  const h = 19;
  const y = centerY - h / 2;
  ctx.fillStyle = chip.bg;
  roundRect(ctx, x, y, w, h, 5);
  ctx.fill();
  ctx.strokeStyle = chip.border;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = chip.color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(chip.text, x + w / 2, centerY + 0.5);
  return w;
}

function drawCell(
  ctx: CanvasRenderingContext2D,
  cell: CellModel,
  x: number,
  y: number,
  w: number,
  h: number,
  isHead: boolean,
  C: ReturnType<typeof palette>
): void {
  const centerY = y + h / 2;
  const inner = w - CELL_PAD_X * 2;
  ctx.textBaseline = 'middle';

  // 单元格底色(构筑对比矩阵的共通/部分/独有)
  if (cell.bg && !isHead) {
    ctx.fillStyle = cell.bg;
    ctx.fillRect(x, y, w, h);
  }

  // 计算内容总宽,用于对齐
  let contentW = 0;
  if (cell.swatch) contentW += 32 + 8;
  if (cell.check) contentW += 16;
  if (cell.chip) {
    ctx.font = fontStr(11, '700', FONT_SANS);
    contentW += ctx.measureText(cell.chip.text).width + 14;
  }
  if (cell.dots) contentW += cell.dots.length * 12 + 2;
  if (cell.text) {
    ctx.font = fontStr(FONT_SIZE, isHead ? '600' : cell.bold ? '700' : '400', FONT_SANS);
    contentW += Math.min(inner, ctx.measureText(cell.text).width);
  }
  if (cell.barPct != null) contentW += 66 + 8;

  let cx =
    cell.align === 'right'
      ? x + w - CELL_PAD_X - contentW
      : cell.align === 'center'
        ? x + (w - contentW) / 2
        : x + CELL_PAD_X;

  if (cell.swatch) cx += drawSwatch(ctx, cx, centerY - 15, cell.swatch, C);
  if (cell.check) {
    ctx.font = fontStr(14, '700', FONT_SANS);
    ctx.fillStyle = cell.check ? C.brand : C.faint;
    ctx.textAlign = 'left';
    ctx.fillText(cell.check ? '✓' : '·', cx + 2, centerY + 0.5);
    cx += 16;
  }
  if (cell.chip) cx += drawChip(ctx, cx, centerY, cell.chip);
  if (cell.dots) {
    for (const c of cell.dots) {
      ctx.beginPath();
      ctx.fillStyle = c;
      ctx.arc(cx + 5, centerY, 5, 0, Math.PI * 2);
      ctx.fill();
      cx += 12;
    }
    cx += 2;
  }
  if (cell.text) {
    ctx.font = fontStr(FONT_SIZE, isHead ? '600' : cell.bold ? '700' : '400', FONT_SANS);
    ctx.textAlign = 'left';
    ctx.fillStyle = isHead ? C.faint : cell.color || C.muted;
    const remain = x + w - CELL_PAD_X - cx;
    const barW = cell.barPct != null ? 66 + 8 : 0;
    const avail = Math.max(0, remain - barW);
    ctx.fillText(ellipsize(ctx, cell.text, avail), cx, centerY + 0.5);
    cx += Math.min(avail, ctx.measureText(cell.text).width);
  }
  if (cell.barPct != null) {
    cx += 8;
    const bw = Math.min(66, Math.max(0, x + w - CELL_PAD_X - cx));
    const bh = 6;
    ctx.fillStyle = 'rgba(59,74,90,0.16)';
    roundRect(ctx, cx, centerY - bh / 2, bw, bh, 3);
    ctx.fill();
    ctx.fillStyle = C.brand;
    roundRect(ctx, cx, centerY - bh / 2, Math.max(2, (bw * cell.barPct) / 100), bh, 3);
    ctx.fill();
  }
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const ch of text) {
    if (ctx.measureText(cur + ch).width > maxW && cur) {
      out.push(cur);
      cur = ch;
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/* ──────────────────────────── 主入口 ──────────────────────────── */

export function tableImageFileName(meta: TableImageMeta): string {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
    now.getDate()
  ).padStart(2, '0')}`;
  const parts = ['符文档案', meta.title, meta.week && meta.week !== '全部周' ? meta.week : '', stamp]
    .filter(Boolean)
    .join('_');
  return `${parts.replace(/[\\/:*?"<>|\s]+/g, '-')}.png`;
}

export async function renderTableImage(
  table: HTMLTableElement,
  meta: TableImageMeta
): Promise<TableImageResult> {
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      /* 字体未就绪也可降级绘制 */
    }
  }

  const C = palette();
  const ignoreBg = [C.pageBg, C.cardBg, C.theadBg].map(normalizeColor);
  const { model, totalRows } = readTable(table, ignoreBg);
  const droppedRows = Math.max(0, totalRows - MAX_ROWS);

  const measure = document.createElement('canvas').getContext('2d')!;
  const L = buildLayout(measure, model, meta, droppedRows);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(L.width * L.dpr);
  canvas.height = Math.round(L.height * L.dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(L.dpr, L.dpr);

  // 纸底
  ctx.fillStyle = C.pageBg;
  ctx.fillRect(0, 0, L.width, L.height);

  /* ── 报头 ── */
  const left = OUTER_PAD;
  const right = L.width - OUTER_PAD;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = C.text;
  ctx.font = fontStr(21, '900', FONT_DISPLAY);
  const brandText = '符文档案';
  ctx.fillText(brandText, left, OUTER_PAD + 20);
  const brandW = ctx.measureText(brandText).width;
  ctx.fillStyle = C.brand;
  ctx.fillText(' · ', left + brandW, OUTER_PAD + 20);
  const dotW = ctx.measureText(' · ').width;
  ctx.fillStyle = C.text;
  ctx.fillText('周报', left + brandW + dotW, OUTER_PAD + 20);
  const titleW = brandW + dotW + ctx.measureText('周报').width;

  // 报头右侧:期号 · 周次 · 样本(先量宽度,避免与拉丁铭文打架)
  const metaLine = [meta.issue, meta.week, meta.sample].filter(Boolean).join(' · ');
  ctx.font = fontStr(11, '400', FONT_SANS);
  const metaW = metaLine ? ctx.measureText(metaLine).width : 0;

  // 拉丁铭文:放不下就整条不画(宁可留白,也不压字)
  const latin = 'RIFTBOUND RUNE ARCHIVE';
  const latinX = left + titleW + 12;
  ctx.font = fontStr(9, '600', FONT_LATIN);
  const latinW = ctx.measureText(latin).width;
  if (latinW <= Math.min(240, right - metaW - 16 - latinX)) {
    ctx.fillStyle = C.faint;
    ctx.fillText(latin, latinX, OUTER_PAD + 20);
  }

  if (metaLine) {
    ctx.textAlign = 'right';
    ctx.font = fontStr(11, '400', FONT_SANS);
    ctx.fillStyle = C.faint;
    ctx.fillText(metaLine, right, OUTER_PAD + 18);
  }

  let y = OUTER_PAD + 30;
  ctx.strokeStyle = C.hairline;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(left, y + 0.5);
  ctx.lineTo(right, y + 0.5);
  ctx.stroke();
  y += 16;

  ctx.textAlign = 'left';
  if (meta.eyebrow) {
    ctx.font = fontStr(10, '600', FONT_SANS);
    ctx.fillStyle = C.brand;
    ctx.fillText(meta.eyebrow.toUpperCase(), left, y + 10);
    y += 20;
  }
  ctx.font = fontStr(25, '900', FONT_DISPLAY);
  ctx.fillStyle = C.text;
  ctx.fillText(meta.title, left, y + 25);
  y += 36;
  if (meta.note) {
    ctx.font = fontStr(11, '400', FONT_SANS);
    ctx.fillStyle = C.faint;
    const lines = wrapText(ctx, meta.note, L.width - OUTER_PAD * 2);
    ctx.fillText(lines[0] ?? '', left, y + 10);
    y += 20;
  }
  y += 18;

  /* ── 表格卡片 ── */
  const blockX = OUTER_PAD;
  const blockY = y;
  const contentLeft = blockX + BLOCK_PAD;
  const tableH = L.rowHeights.reduce((s, h) => s + h, 0) + 2;

  ctx.fillStyle = C.cardBg;
  roundRect(ctx, blockX, blockY, L.width - OUTER_PAD * 2, tableH * L.scale + BLOCK_PAD * 2, 12);
  ctx.fill();
  ctx.strokeStyle = C.cardBorder;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.save();
  ctx.translate(contentLeft, blockY + BLOCK_PAD);
  ctx.scale(L.scale, L.scale);

  const rowsToDraw = model.rows.slice(0, MAX_ROWS + 1);
  rowsToDraw.forEach((row, ri) => {
    const top = L.rowTops[ri] ?? 0;
    const h = L.rowHeights[ri] ?? ROW_H;
    const rowW = L.contentW;

    if (row.kind === 'head') {
      ctx.fillStyle = C.theadBg;
      ctx.fillRect(0, top, rowW, h);
    } else if (row.kind === 'group') {
      ctx.fillStyle = C.theadBg;
      ctx.fillRect(0, top, rowW, h);
      ctx.font = fontStr(11, '700', FONT_SANS);
      ctx.fillStyle = C.faint;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(row.label ?? '', CELL_PAD_X, top + h / 2 + 0.5);
    }

    if (row.kind !== 'group') {
      let x = 0;
      row.cells.forEach((cell, ci) => {
        const w = L.colW[ci] ?? MIN_COL_W;
        drawCell(ctx, cell, x, top, w, h, row.kind === 'head', C);
        x += w;
      });
    }

    // 行分隔线
    if (ri < rowsToDraw.length - 1 || droppedRows > 0) {
      ctx.strokeStyle = row.kind === 'head' ? C.panelBorder : C.rowLine;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, top + h - 0.5);
      ctx.lineTo(rowW, top + h - 0.5);
      ctx.stroke();
    }
  });

  // 表头下的朱砂细线(报刊感)
  const headH = L.rowHeights[0] ?? HEAD_H;
  ctx.strokeStyle = C.brand;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, headH - 1);
  ctx.lineTo(L.contentW, headH - 1);
  ctx.stroke();

  ctx.restore();

  /* ── 页脚 ── */
  let fy = blockY + tableH * L.scale + BLOCK_PAD * 2 + 16;
  ctx.strokeStyle = C.panelBorder;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(OUTER_PAD, fy + 0.5);
  ctx.lineTo(L.width - OUTER_PAD, fy + 0.5);
  ctx.stroke();
  fy += 18;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = fontStr(10.5, '400', FONT_SANS);
  ctx.fillStyle = C.faint;
  const stamp = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const timeText = `${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())} ${pad(
    stamp.getHours()
  )}:${pad(stamp.getMinutes())}`;
  ctx.fillText(`符文档案 · 周报 · 生成于 ${timeText}`, OUTER_PAD, fy);
  ctx.textAlign = 'right';
  ctx.fillText('数据仅供竞技参考 · Riot Games 与本工具无关', L.width - OUTER_PAD, fy);
  if (droppedRows > 0) {
    fy += 16;
    ctx.textAlign = 'left';
    ctx.fillStyle = C.brand;
    ctx.fillText(
      `单图行数上限 ${MAX_ROWS} 行:本表共 ${totalRows} 行,图中为前 ${MAX_ROWS} 行(已按当前排序取前若干行)`,
      OUTER_PAD,
      fy
    );
  }

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/png')
  );
  if (!blob) throw new Error('画布导出失败(浏览器拒绝了 PNG 编码)');

  return {
    blob,
    width: canvas.width,
    height: canvas.height,
    fileName: tableImageFileName(meta),
    droppedRows
  };
}

/** 渲染并触发浏览器下载 */
export async function downloadTableImage(
  table: HTMLTableElement,
  meta: TableImageMeta
): Promise<TableImageResult> {
  const result = await renderTableImage(table, meta);
  const url = URL.createObjectURL(result.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = result.fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return result;
}
