import { AREA_META, AREA_ORDER, type ChainBoard, type ChainSnapshot, type ChainCard, type ChainAreaKey } from './types';
import { arrowGeometry, type CardRect } from './arrowGeometry';
type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export const FRAME_WIDTH = 1920, FRAME_HEIGHT = 1080;
const zones: Record<ChainAreaKey, CardRect> = {
  chain: { x: 36, y: 144, width: 1292, height: 290 }, resolve: { x: 1352, y: 144, width: 532, height: 290 },
  pending: { x: 36, y: 454, width: 1848, height: 228 },
  trash: { x: 36, y: 702, width: 600, height: 330 }, base: { x: 660, y: 702, width: 600, height: 330 }, battlefield: { x: 1284, y: 702, width: 600, height: 330 }
};
export function frameCardRects(board: ChainBoard): Map<string, CardRect> {
  const rects = new Map<string, CardRect>();
  for (const area of AREA_ORDER) {
    const z = zones[area], cards = board.areas[area].cards;
    let width = 136, cols = 1, rows = 1;
    while (width >= 12) {
      cols = Math.max(1, Math.floor((z.width - 32) / (width + 10)));
      rows = Math.ceil(cards.length / cols);
      if (rows * (width * 1.38 + 10) <= z.height - 58) break;
      width -= 2;
    }
    cards.forEach((c, i) => rects.set(c.uid, { x: z.x + 16 + i % cols * (width + 10), y: z.y + 48 + Math.floor(i / cols) * (width * 1.38 + 10), width, height: width * 1.38 }));
  }
  return rects;
}
function box(ctx: Context, r: CardRect, fill: string, stroke: string, radius = 10): void {
  ctx.beginPath(); ctx.roundRect(r.x, r.y, r.width, r.height, radius); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke();
}
function lines(ctx: Context, text: string, x: number, y: number, width: number, height: number, size: number): void {
  ctx.font = `${size}px sans-serif`; ctx.textBaseline = 'top';
  const clean = text.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\[.*?\]/g, '');
  let line = '', row = 0;
  for (const ch of clean) {
    if (ch === '\n' || ctx.measureText(line + ch).width > width) {
      ctx.fillText(line, x, y + row * size * 1.35); row++; line = ch === '\n' ? '' : ch;
      if ((row + 1) * size * 1.35 > height) { ctx.fillText(line + '…', x, y + row * size * 1.35, width); return; }
    } else line += ch;
  }
  ctx.fillText(line, x, y + row * size * 1.35, width);
}
function drawCard(ctx: Context, c: ChainCard, r: CardRect, mode: string, image: CanvasImageSource | undefined, changed: boolean): void {
  ctx.save(); box(ctx, r, '#fffdf8', changed ? '#bd4e27' : c.player === 1 ? '#b45309' : '#0369a1', 6);
  ctx.beginPath(); ctx.rect(r.x + 2, r.y + 2, r.width - 4, r.height - 4); ctx.clip();
  const imageHeight = mode === 'both' ? r.height * .69 : r.height;
  if (image && mode !== 'text') ctx.drawImage(image, r.x + 2, r.y + 2, r.width - 4, imageHeight - 4);
  else { ctx.fillStyle = '#f3ede3'; ctx.fillRect(r.x + 2, r.y + 2, r.width - 4, r.height - 4); }
  const size = Math.max(10, r.width * .11);
  if (!image || mode !== 'image') {
    ctx.fillStyle = '#272321'; const y = image && mode === 'both' ? r.y + imageHeight : r.y + 22;
    lines(ctx, c.name, r.x + 6, y, r.width - 12, size * 2.8, size);
    if ((!image || mode === 'text') && r.height > 100) lines(ctx, c.text, r.x + 6, y + size * 2.8, r.width - 12, r.height - size * 3.8 - 24, Math.max(10, size * .85));
  }
  ctx.fillStyle = c.player === 1 ? '#b45309' : '#0369a1'; ctx.fillRect(r.x, r.y, Math.min(r.width, 42), 20);
  ctx.fillStyle = '#fff'; ctx.font = '12px sans-serif'; ctx.textBaseline = 'top'; ctx.fillText(`P${c.player}`, r.x + 5, r.y + 3);
  ctx.restore();
}
/** Browser preview and worker exports use exactly the same layout. */
export function renderFrame(ctx: Context, snapshot: ChainSnapshot, name: string, index: number, count: number, images: ReadonlyMap<string, CanvasImageSource>, previous?: ChainSnapshot, transition = 1): void {
  ctx.save(); ctx.scale(ctx.canvas.width / FRAME_WIDTH, ctx.canvas.height / FRAME_HEIGHT);
  ctx.fillStyle = '#f8f4eb'; ctx.fillRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
  ctx.fillStyle = '#292420'; ctx.font = 'bold 36px sans-serif'; ctx.textBaseline = 'top'; ctx.fillText(name, 36, 28, 1330);
  ctx.font = '22px sans-serif'; ctx.fillText(`步骤 ${index + 1} / ${count}　·　玩家 ${snapshot.actor} 行动　·　${snapshot.duration ?? 2} 秒`, 36, 78);
  lines(ctx, snapshot.action, 800, 80, 1080, 56, 22);
  const rects = frameCardRects(snapshot.board), old = previous ? frameCardRects(previous.board) : new Map<string, CardRect>();
  const previousCards = new Map(previous ? AREA_ORDER.flatMap((a) => previous.board.areas[a].cards.map((c) => [c.uid, { card: c, area: a }] as const)) : []);
  for (const area of AREA_ORDER) {
    const z = zones[area]; box(ctx, z, '#fffdf8', '#d5cdbf'); ctx.fillStyle = '#51493e'; ctx.font = 'bold 24px sans-serif';
    ctx.fillText(`${AREA_META[area].label}　${snapshot.board.areas[area].cards.length}`, z.x + 16, z.y + 12);
    for (const card of snapshot.board.areas[area].cards) {
      let r = rects.get(card.uid)!; const before = old.get(card.uid);
      if (before && transition < 1) { r = { x: before.x + (r.x - before.x) * transition, y: before.y + (r.y - before.y) * transition, width: before.width + (r.width - before.width) * transition, height: before.height + (r.height - before.height) * transition }; rects.set(card.uid, r); }
      const prev = previousCards.get(card.uid);
      ctx.save(); if (!before) ctx.globalAlpha = transition;
      drawCard(ctx, card, r, snapshot.board.areas[area].mode, images.get(card.cardId), !!previous && (!prev || prev.area !== area || JSON.stringify(prev.card) !== JSON.stringify(card)));
      ctx.restore();
    }
  }
  for (const a of snapshot.board.arrows ?? []) {
    const from = rects.get(a.from), to = rects.get(a.to); if (!from || !to) continue;
    const g = arrowGeometry(from, to), angle = Math.atan2(g.y2 - g.y1, g.x2 - g.x1);
    ctx.strokeStyle = '#bd4e27'; ctx.fillStyle = '#bd4e27'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(g.x1, g.y1); ctx.lineTo(g.x2, g.y2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(g.x2, g.y2); ctx.lineTo(g.x2 - 18 * Math.cos(angle - .4), g.y2 - 18 * Math.sin(angle - .4)); ctx.lineTo(g.x2 - 18 * Math.cos(angle + .4), g.y2 - 18 * Math.sin(angle + .4)); ctx.closePath(); ctx.fill();
    if (a.label) { ctx.font = 'bold 20px sans-serif'; const w = Math.min(500, ctx.measureText(a.label).width + 20); box(ctx, { x: g.labelX - w / 2, y: g.labelY - 22, width: w, height: 38 }, '#fffdf8', '#bd4e27', 5); ctx.fillStyle = '#983514'; ctx.fillText(a.label, g.labelX - w / 2 + 10, g.labelY - 14, w - 20); }
  }
  ctx.restore();
}
