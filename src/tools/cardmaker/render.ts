import {
  dimensions,
  DOMAINS,
  TYPES,
  type Domain,
  type ImageAsset,
  type ImageLayer,
  type MakerDocument,
} from './model';

export interface RenderResources {
  frame: HTMLImageElement;
  images: Map<string, HTMLImageElement>;
  icons: Map<string, HTMLImageElement>;
}
export function profile(d: MakerDocument) {
  const landscape = d.type === 'battlefield',
    legend = d.type === 'legend',
    rune = d.type === 'rune';
  const dark = d.rarity === 'rare' || d.rarity === 'epic' || legend || rune;
  return {
    landscape,
    dark,
    textColor: dark ? '#fff' : '#161514',
    bar: landscape
      ? { x: 40, y: 494, width: 960, height: 84 }
      : { x: 48, y: legend ? 709 : rune ? 700 : 579, width: 648, height: legend ? 88 : 82 },
    nameY: landscape ? 515 : legend ? 733 : rune ? 721 : d.subtype ? 586 : 598,
    typeY: landscape ? 458 : legend ? 680 : rune ? 667 : 548,
    body: landscape
      ? { x: 75, y: 585, width: 890, height: 86 }
      : {
          x: 84,
          y: legend ? 808 : rune ? 800 : 680,
          width: 580,
          height: legend || rune ? 139 : 260,
        },
  };
}
function family(d: MakerDocument): string {
  return d.language === 'zh' ? 'MakerCN, sans-serif' : 'MakerEN, sans-serif';
}
function fitted(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  size: number,
  font: string,
  align: CanvasTextAlign = 'left',
  style = '700',
): void {
  ctx.save();
  ctx.textBaseline = 'top';
  ctx.textAlign = align;
  while (size > 16) {
    ctx.font = `${style} ${size}px ${font}`;
    if (ctx.measureText(text).width <= width) break;
    size -= 0.5;
  }
  ctx.font = `${style} ${size}px ${font}`;
  ctx.fillText(text, x, y, width);
  ctx.restore();
}
function rune(
  ctx: CanvasRenderingContext2D,
  r: RenderResources,
  domain: Domain,
  x: number,
  y: number,
  size: number,
): void {
  const icon = r.icons.get(domain);
  if (icon) ctx.drawImage(icon, x, y, size, size);
  else {
    ctx.save();
    ctx.fillStyle = DOMAINS[domain].color;
    ctx.beginPath();
    ctx.moveTo(x + size / 2, y);
    ctx.lineTo(x + size, y + size / 2);
    ctx.lineTo(x + size / 2, y + size);
    ctx.lineTo(x, y + size / 2);
    ctx.fill();
    ctx.restore();
  }
}
export function drawBase(ctx: CanvasRenderingContext2D, d: MakerDocument): void {
  const { width, height } = dimensions(d.type);
  ctx.fillStyle = d.background;
  ctx.fillRect(0, 0, width, height);
}
export function drawImageLayer(
  ctx: CanvasRenderingContext2D,
  l: ImageLayer,
  image: HTMLImageElement,
): void {
  if (!l.visible) return;
  ctx.save();
  ctx.globalAlpha = l.opacity;
  ctx.translate(l.x, l.y);
  ctx.rotate((l.rotation * Math.PI) / 180);
  ctx.drawImage(
    image,
    l.crop.x * image.naturalWidth,
    l.crop.y * image.naturalHeight,
    l.crop.width * image.naturalWidth,
    l.crop.height * image.naturalHeight,
    0,
    0,
    l.width,
    l.height,
  );
  ctx.restore();
}
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  d: MakerDocument,
  r: RenderResources,
): void {
  const p = profile(d),
    size = dimensions(d.type),
    b = p.bar;
  ctx.save();
  const gradient = ctx.createLinearGradient(0, b.y + b.height, 0, size.height);
  gradient.addColorStop(0, p.dark ? '#111a22ed' : '#fffcf2');
  gradient.addColorStop(1, p.dark ? '#0c1117' : '#f1e8d3');
  ctx.fillStyle = gradient;
  ctx.fillRect(35, b.y + b.height - 2, size.width - 70, size.height - b.y - b.height);
  const domain = d.domains[0] ?? 'neutral';
  const bar = ctx.createLinearGradient(b.x, b.y, b.x + b.width, b.y);
  bar.addColorStop(0, DOMAINS[domain].color);
  bar.addColorStop(0.55, DOMAINS[d.domains[1] ?? domain].color);
  bar.addColorStop(1, DOMAINS[d.domains[1] ?? domain].color);
  ctx.fillStyle = bar;
  ctx.fillRect(b.x, b.y, b.width, b.height);
  ctx.save();
  ctx.beginPath();
  ctx.rect(b.x, b.y, b.width, b.height);
  ctx.clip();
  ctx.globalAlpha = 0.14;
  for (let x = b.x + 15; x < b.x + b.width; x += 105) rune(ctx, r, domain, x, b.y - 12, 110);
  ctx.restore();
  if (['unit', 'spell', 'gear'].includes(d.type)) {
    ctx.fillStyle = d.rarity === 'epic' ? '#252525' : '#fffaf0';
    ctx.beginPath();
    ctx.arc(85, 93.5, 44, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.drawImage(r.frame, 0, 0, size.width, size.height);
  ctx.restore();
}
interface Token {
  text: string;
  bold: boolean;
  italic: boolean;
  icon: string;
  keyword: boolean;
  width?: number;
}
export function effectTokens(text: string): Token[] {
  const parts =
    text.match(
      /\*\*|_|\{\{[^{}]+\}\}|\[[^\]]+\]|:rb_[a-z0-9_]+:|\n|[a-zA-Z0-9'’\-]+|[^\S\n]+|./gu,
    ) ?? [];
  let bold = false,
    italic = false;
  return parts.flatMap((part) => {
    if (part === '**') {
      bold = !bold;
      return [];
    }
    if (part === '_') {
      italic = !italic;
      return [];
    }
    const marker = /^(?:\{\{(.*?)\}\}|\[(.*?)\]|:(rb_.*):)$/.exec(part),
      key = marker ? (marker[1] ?? marker[2] ?? marker[3] ?? '').replace(/>$/, '') : '';
    return [
      {
        text: marker ? key || '→' : part,
        bold,
        italic,
        icon: marker ? key : '',
        keyword: !!marker,
      },
    ];
  });
}
function tokenFont(t: Token, size: number, font: string): string {
  return `${t.italic ? 'italic ' : ''}${t.bold || t.keyword ? '700' : '500'} ${t.keyword ? size * 0.82 : size}px ${font}`;
}
function iconKey(text: string): string {
  const domains: Record<string, string> = {
    怒: 'red',
    静: 'blue',
    思: 'purple',
    韧: 'green',
    乱: 'orange',
    序: 'yellow',
    战力: 'might',
    横置: 'exhaust',
    S: 'exhaust',
    A: 'neutral',
    rb_exhaust: 'exhaust',
    rb_might: 'might',
    rb_rune_rainbow: 'neutral',
    rb_rune_fury: 'red',
    rb_rune_calm: 'blue',
    rb_rune_mind: 'purple',
    rb_rune_body: 'green',
    rb_rune_chaos: 'orange',
    rb_rune_order: 'yellow',
  };
  return domains[text] ?? text;
}
function layout(
  ctx: CanvasRenderingContext2D,
  tokens: Token[],
  font: string,
  size: number,
  width: number,
  r: RenderResources,
): Token[][] {
  const lines: Token[][] = [[]];
  let used = 0;
  for (const source of tokens) {
    if (source.text === '\n') {
      lines.push([]);
      used = 0;
      continue;
    }
    const t = { ...source };
    ctx.font = tokenFont(t, size, font);
    t.width =
      t.icon && r.icons.has(iconKey(t.icon))
        ? size
        : ctx.measureText(t.text.replace(/^rb_energy_/, '')).width + (t.keyword ? 14 : 0);
    if (used + t.width > width && lines[lines.length - 1]!.length) {
      lines.push([]);
      used = 0;
    }
    if (!used && /^\s+$/.test(t.text)) continue;
    lines[lines.length - 1]!.push(t);
    used += t.width;
  }
  return lines;
}
export function effectLayout(ctx: CanvasRenderingContext2D, d: MakerDocument, r: RenderResources) {
  const p = profile(d),
    copy = d.copy[d.language],
    box = p.body;
  const flavorHeight = copy.flavor ? (p.landscape ? 23 : 53) : 0,
    height = Math.max(20, box.height - flavorHeight);
  const tokens = effectTokens(copy.effect),
    font = family(d);
  let fontSize = d.fontSize;
  let lines = layout(ctx, tokens, font, fontSize, box.width, r);
  if (d.autoFit)
    while (fontSize > 16 && lines.length * fontSize * d.lineHeight > height) {
      fontSize -= 1;
      lines = layout(ctx, tokens, font, fontSize, box.width, r);
    }
  return { lines, fontSize, height, overflow: lines.length * fontSize * d.lineHeight > height + 1 };
}
export function drawText(
  ctx: CanvasRenderingContext2D,
  d: MakerDocument,
  r: RenderResources,
): boolean {
  const p = profile(d),
    copy = d.copy[d.language],
    size = dimensions(d.type),
    font = family(d),
    domain = d.domains[0] ?? 'neutral';
  ctx.save();
  ctx.fillStyle = domain === 'yellow' && d.rarity !== 'epic' ? '#121b23' : '#fff';
  const hero = d.type === 'unit' && d.subtype === 'champion';
  fitted(
    ctx,
    copy.name,
    p.landscape ? 75 : 84,
    p.nameY,
    p.landscape ? 850 : 580,
    hero ? 42 : 44,
    font,
  );
  if (copy.subtitle)
    fitted(
      ctx,
      copy.subtitle,
      p.landscape ? 535 : 85,
      p.landscape ? p.nameY + 10 : p.nameY + 42,
      p.landscape ? 430 : 570,
      22,
      font,
      'left',
      'italic 500',
    );
  ctx.fillStyle = d.rarity === 'epic' ? '#e1b656' : '#fff';
  const englishTypes: Record<string, string> = {
    unit: 'Unit',
    spell: 'Spell',
    gear: 'Gear',
    legend: 'Legend',
    battlefield: 'Battlefield',
    rune: 'Rune',
  };
  const type = d.language === 'zh' ? TYPES[d.type] : (englishTypes[d.type] ?? '');
  const subtype =
    d.type === 'unit' && d.subtype
      ? d.language === 'zh'
        ? d.subtype === 'champion'
          ? '英雄'
          : '专属'
        : d.subtype === 'champion'
          ? 'Champion'
          : 'Signature'
      : '';
  const label = [subtype, type, copy.tags].filter(Boolean).join(' · ');
  fitted(ctx, label, p.landscape ? 75 : 80, p.typeY, size.width - 158, 23, font);
  if (!p.landscape) {
    ctx.font = '700 26px MakerEN';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      d.type === 'unit'
        ? '⚔'
        : d.type === 'gear'
          ? '◆'
          : d.type === 'spell'
            ? '✦'
            : d.type === 'legend'
              ? '♛'
              : '◇',
      49,
      p.typeY + 13,
    );
    ctx.textAlign = 'left';
  }
  if (['unit', 'spell', 'gear'].includes(d.type)) {
    ctx.fillStyle = d.rarity === 'epic' ? '#fff' : '#141414';
    fitted(ctx, String(d.energy), 85, 60, 70, 62, 'MakerEN, sans-serif', 'center');
    for (let i = 0; i < Math.min(d.recycle, 6); i++) rune(ctx, r, domain, 49, 147 + i * 32, 28);
    if (d.recycle > 6) {
      ctx.fillStyle = '#fff';
      fitted(ctx, `×${d.recycle}`, 64, 147, 65, 28, font, 'center');
    }
    if (d.type === 'unit') {
      ctx.fillStyle = '#fff';
      fitted(ctx, String(d.might), 650, 60, 70, 62, 'MakerEN, sans-serif', 'center');
    }
  }
  if (d.type === 'legend')
    d.domains.forEach((c, i) => {
      ctx.fillStyle = '#20252d';
      ctx.beginPath();
      ctx.arc(94, 93 + 118 * i, 44, 0, Math.PI * 2);
      ctx.fill();
      rune(ctx, r, c, 62, 60 + 118 * i, 65);
    });
  ctx.fillStyle = p.textColor;
  const effect = effectLayout(ctx, d, r),
    lineHeight = effect.fontSize * d.lineHeight;
  const yStart = p.body.y + Math.max(0, (effect.height - effect.lines.length * lineHeight) / 2);
  ctx.save();
  ctx.beginPath();
  ctx.rect(p.body.x, p.body.y, p.body.width, effect.height);
  ctx.clip();
  effect.lines.forEach((line, i) => {
    let x = p.body.x;
    const y = yStart + i * lineHeight;
    for (const t of line) {
      const icon = t.icon ? r.icons.get(iconKey(t.icon)) : undefined;
      if (icon) ctx.drawImage(icon, x, y, effect.fontSize, effect.fontSize);
      else {
        ctx.font = tokenFont(t, effect.fontSize, font);
        ctx.textBaseline = 'top';
        if (t.keyword) {
          ctx.save();
          ctx.fillStyle = p.dark ? '#dfdfd5' : '#28343e';
          ctx.fillRect(x, y + 1, t.width ?? 0, effect.fontSize + 2);
          ctx.fillStyle = p.dark ? '#172028' : '#fff';
          ctx.fillText(t.text.replace(/^rb_energy_/, ''), x + 7, y + effect.fontSize * 0.1);
          ctx.restore();
        } else ctx.fillText(t.text, x, y);
      }
      x += t.width ?? 0;
    }
  });
  ctx.restore();
  if (copy.flavor) {
    ctx.globalAlpha = 0.8;
    fitted(
      ctx,
      copy.flavor,
      p.body.x,
      p.body.y + p.body.height - (p.landscape ? 23 : 42),
      p.body.width,
      21,
      font,
      'left',
      'italic 500',
    );
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = '#ddd6c3';
  fitted(ctx, d.setInfo, 47, size.height - 47, 310, 16, font, 'left', '500');
  if (d.artist)
    fitted(
      ctx,
      `Illus. ${d.artist}`,
      size.width - 105,
      size.height - 47,
      300,
      16,
      font,
      'right',
      '500',
    );
  d.domains
    .filter((c) => c !== 'neutral')
    .forEach((c, i) => rune(ctx, r, c, size.width - 73 - i * 32, size.height - 53, 25));
  ctx.fillStyle = d.rarity === 'common' ? '#9f5f15' : d.rarity === 'uncommon' ? '#bbb' : '#e0ab44';
  const cx = size.width / 2,
    cy = size.height - 46;
  ctx.beginPath();
  if (d.rarity === 'common') ctx.arc(cx, cy, 10, 0, 2 * Math.PI);
  else if (d.rarity === 'uncommon') {
    ctx.moveTo(cx, cy - 12);
    ctx.lineTo(cx + 12, cy + 10);
    ctx.lineTo(cx - 12, cy + 10);
  } else {
    ctx.moveTo(cx, cy - 13);
    ctx.lineTo(cx + 11, cy);
    ctx.lineTo(cx, cy + 13);
    ctx.lineTo(cx - 11, cy);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  return effect.overflow;
}
export function renderCard(d: MakerDocument, r: RenderResources, scale = 2): HTMLCanvasElement {
  const size = dimensions(d.type),
    canvas = document.createElement('canvas');
  canvas.width = size.width * scale;
  canvas.height = size.height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器无法生成卡图。');
  ctx.scale(scale, scale);
  drawBase(ctx, d);
  for (const l of d.layers.filter((l) => !l.overlay)) {
    const image = r.images.get(l.assetId);
    if (image) drawImageLayer(ctx, l, image);
    else throw new Error('图片仍在加载，请稍后再导出。');
  }
  drawFrame(ctx, d, r);
  for (const l of d.layers.filter((l) => l.overlay)) {
    const image = r.images.get(l.assetId);
    if (image) drawImageLayer(ctx, l, image);
    else throw new Error('图片仍在加载，请稍后再导出。');
  }
  drawText(ctx, d, r);
  return canvas;
}
export function projectAssets(d: MakerDocument, assets: ImageAsset[]): ImageAsset[] {
  const used = new Set(d.layers.map((l) => l.assetId));
  return assets.filter((a) => used.has(a.id));
}
