export interface CardRect { x: number; y: number; width: number; height: number }

/** 从矩形边缘连接，箭头不会被卡面遮盖。屏幕和导出共用。 */
export function arrowGeometry(from: CardRect, to: CardRect) {
  const ax = from.x + from.width / 2, ay = from.y + from.height / 2;
  const bx = to.x + to.width / 2, by = to.y + to.height / 2;
  const dx = bx - ax, dy = by - ay;
  const edge = (r: CardRect) => Math.min(Math.abs(dx) > 0.01 ? r.width / 2 / Math.abs(dx) : Infinity,
    Math.abs(dy) > 0.01 ? r.height / 2 / Math.abs(dy) : Infinity, 0.45);
  const a = edge(from), b = edge(to);
  return { x1: ax + dx * a, y1: ay + dy * a, x2: bx - dx * b, y2: by - dy * b,
    labelX: (ax + bx) / 2, labelY: (ay + by) / 2 - 8 };
}
