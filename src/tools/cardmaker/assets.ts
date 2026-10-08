import { artBox, uid, type CardType, type ImageAsset } from './model';
const images = new Map<string, Promise<HTMLImageElement>>();
export function loadImage(url: string): Promise<HTMLImageElement> {
  const cached = images.get(url);
  if (cached) return cached;
  const result = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    if (!url.startsWith('data:') && !url.startsWith('blob:')) image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => {
      images.delete(url);
      reject(new Error('图片无法加载，请上传本机图片重试。'));
    };
    image.src = url;
  });
  images.set(url, result);
  if (images.size > 64) {
    const oldest = images.keys().next().value;
    if (oldest) images.delete(oldest);
  }
  return result;
}
let fonts: Promise<void> | undefined;
export function loadFonts(): Promise<void> {
  if (!fonts)
    fonts = Promise.all([
      new FontFace(
        'MakerCN',
        `url(${import.meta.env.BASE_URL}cardmaker/fonts/NotoSansSC.woff2)`,
      ).load(),
      new FontFace(
        'MakerEN',
        `url(${import.meta.env.BASE_URL}cardmaker/fonts/RobotoCondensed.woff2)`,
        { weight: '100 900' },
      ).load(),
    ])
      .then((loaded) => {
        loaded.forEach((f) => document.fonts.add(f));
      })
      .catch((error) => {
        fonts = undefined;
        throw new Error(`卡面字体加载失败，请重新打开工坊。${String(error)}`);
      });
  return fonts;
}
export function frameName(type: CardType, rarity: string): string {
  const r =
    rarity === 'epic'
      ? 'Epic'
      : rarity === 'rare' && type !== 'battlefield' && type !== 'rune'
        ? 'Rare'
        : 'CommonUncommon';
  return `${type}${r}.svg`;
}
export async function loadFrame(type: CardType, rarity: string): Promise<HTMLImageElement> {
  // Only recolor the known, checked-in frame, never user-supplied SVG.
  const path = `${import.meta.env.BASE_URL}cardmaker/frames/${frameName(type, rarity)}`;
  const text = await fetch(path).then((r) => {
    if (!r.ok) throw new Error('卡框加载失败。');
    return r.text();
  });
  const color = rarity === 'uncommon' ? '#989898' : rarity === 'common' ? '#9f5f15' : '#d89e3c';
  const svg = text.replace(
    /(\.rarityColor(?:Fill|Stroke)?\s*\{\s*(?:fill|stroke):\s*)#[0-9a-f]+/gi,
    `$1${color}`,
  );
  return loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
}
export async function rasterAsset(file: Blob, name: string): Promise<ImageAsset> {
  if (file.size > 20 * 1024 * 1024) throw new Error('单张图片请控制在 20 MB 内。');
  if (!/^image\/(?:png|jpeg|webp|gif)$/.test(file.type))
    throw new Error('请选择 PNG、JPG、WebP 或 GIF 图片。');
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url),
      scale = Math.min(1, 2400 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx || !canvas.width || !canvas.height) throw new Error('图片无法解码。');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return {
      id: uid(),
      name: name.slice(0, 200),
      data: canvas.toDataURL('image/png'),
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    URL.revokeObjectURL(url);
    images.delete(url);
  }
}
export async function cardArt(url: string, type: CardType): Promise<ImageAsset> {
  const host = new URL(url).hostname;
  const known = [
    'cdn.playloltcg.com',
    'cmsassets.rgpub.io',
    'steamusercontent-a.akamaihd.net',
  ].includes(host);
  const source =
    known && location.protocol !== 'file:'
      ? `${import.meta.env.BASE_URL}api/cardmaker/image?url=${encodeURIComponent(url)}`
      : url;
  const response = await fetch(source, {
    mode: 'cors',
    credentials: 'omit',
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error('卡图读取失败，可自行上传配图。');
  const asset = await rasterAsset(await response.blob(), '卡库配图（可见区域）'),
    image = await loadImage(asset.data),
    box = artBox(type);
  const landscape = image.naturalWidth > image.naturalHeight;
  const canvas = document.createElement('canvas');
  const sx = image.naturalWidth / (landscape ? 1040 : 745),
    sy = image.naturalHeight / (landscape ? 745 : 1040);
  canvas.width = Math.round(box.width * sx);
  canvas.height = Math.round(box.height * sy);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法裁剪卡图。');
  ctx.drawImage(
    image,
    box.x * sx,
    box.y * sy,
    box.width * sx,
    box.height * sy,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return {
    ...asset,
    data: canvas.toDataURL('image/png'),
    width: canvas.width,
    height: canvas.height,
  };
}
export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export function fileName(title: string): string {
  return (title.trim() || '卡牌作品').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 100);
}

export async function basicIcons(white: boolean): Promise<Map<string, HTMLImageElement>> {
  const color = white ? '#fff' : '#111c25';
  const shapes: Record<string, string> = {
    exhaust:
      '<path d="M8 5H26V23H8Z" fill="none" stroke="COLOR" stroke-width="3" transform="rotate(18 17 14)"/><path d="M24 4C34 13 30 25 18 29L21 22M18 29L27 30" fill="none" stroke="COLOR" stroke-width="3"/>',
    might:
      '<path d="M4 3L12 6L29 24L26 28L9 10ZM30 3L22 6L5 24L8 28L25 10Z"/><path d="M4 21L13 30M21 30L30 21" stroke="COLOR" stroke-width="3"/>',
    neutral: '<path d="M17 2L30 17L17 31L3 17Z" fill="none" stroke="COLOR" stroke-width="3"/>',
    energy: '<circle cx="17" cy="17" r="14" fill="none" stroke="COLOR" stroke-width="3"/>',
  };
  const icons = new Map<string, HTMLImageElement>();
  await Promise.all(
    Object.entries(shapes).map(async ([key, shape]) => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 34 34" fill="${color}">${shape.replace(/COLOR/g, color)}</svg>`;
      icons.set(key, await loadImage(`data:image/svg+xml,${encodeURIComponent(svg)}`));
    }),
  );
  return icons;
}
