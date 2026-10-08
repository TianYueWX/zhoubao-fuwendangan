import type { CardPrint, CardRecord } from '@/components/carddex/types';
import { translateTags } from './translations';

export const TYPES = {
  unit: '单位',
  spell: '法术',
  gear: '装备',
  legend: '传奇',
  battlefield: '战场',
  rune: '符文',
} as const;
export type CardType = keyof typeof TYPES;
export type Domain = 'red' | 'blue' | 'purple' | 'green' | 'orange' | 'yellow' | 'neutral';
export const DOMAINS: Record<Domain, { label: string; en: string; color: string }> = {
  red: { label: '怒', en: 'Fury', color: '#e81528' },
  blue: { label: '静', en: 'Calm', color: '#2578ba' },
  purple: { label: '思', en: 'Mind', color: '#773ca2' },
  green: { label: '韧', en: 'Body', color: '#289857' },
  orange: { label: '乱', en: 'Chaos', color: '#ef8131' },
  yellow: { label: '序', en: 'Order', color: '#dac83e' },
  neutral: { label: '无色', en: 'Neutral', color: '#a6a5a2' },
};
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic';
export const RARITIES: Record<Rarity, string> = {
  common: '普通',
  uncommon: '罕见',
  rare: '稀有',
  epic: '史诗',
};
export interface CardCopy {
  name: string;
  subtitle: string;
  effect: string;
  flavor: string;
  tags: string;
}
export interface ImageAsset {
  id: string;
  name: string;
  data: string;
  width: number;
  height: number;
}
export interface ImageLayer {
  id: string;
  name: string;
  assetId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  overlay: boolean;
  crop: { x: number; y: number; width: number; height: number };
}
export interface MakerDocument {
  version: 1;
  id: string;
  title: string;
  updatedAt: string;
  type: CardType;
  subtype: '' | 'champion' | 'signature';
  rarity: Rarity;
  domains: Domain[];
  language: 'zh' | 'en';
  copy: { zh: CardCopy; en: CardCopy };
  energy: number;
  recycle: number;
  might: number;
  fontSize: number;
  lineHeight: number;
  autoFit: boolean;
  background: string;
  artist: string;
  setInfo: string;
  source: string;
  layers: ImageLayer[];
}
export interface MakerProject {
  format: 'rune-cardmaker';
  version: 1;
  document: MakerDocument;
  assets: ImageAsset[];
}
export function uid(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `maker-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
export function newDocument(type: CardType = 'unit'): MakerDocument {
  const copy = (): CardCopy => ({ name: '', subtitle: '', effect: '', flavor: '', tags: '' });
  return {
    version: 1,
    id: uid(),
    title: '未命名作品',
    updatedAt: new Date().toISOString(),
    type,
    subtype: '',
    rarity: 'uncommon',
    domains:
      type === 'legend'
        ? ['red', 'blue']
        : [type === 'battlefield' || type === 'gear' ? 'neutral' : 'red'],
    language: 'zh',
    copy: { zh: copy(), en: copy() },
    energy: 3,
    recycle: 1,
    might: 3,
    fontSize: 33,
    lineHeight: 1.22,
    autoFit: true,
    background: '#343b42',
    artist: '',
    setInfo: '自制 · 001',
    source: '',
    layers: [],
  };
}
export function dimensions(type: CardType): { width: number; height: number } {
  return type === 'battlefield' ? { width: 1040, height: 745 } : { width: 745, height: 1040 };
}
export function artBox(type: CardType): { x: number; y: number; width: number; height: number } {
  if (type === 'battlefield') return { x: 52, y: 48, width: 936, height: 398 };
  return { x: 58, y: 48, width: 629, height: type === 'legend' || type === 'rune' ? 604 : 480 };
}
export function imageLayer(asset: ImageAsset, type: CardType): ImageLayer {
  const box = artBox(type),
    scale = Math.max(box.width / asset.width, box.height / asset.height);
  const width = asset.width * scale,
    height = asset.height * scale;
  return {
    id: uid(),
    name: asset.name,
    assetId: asset.id,
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    overlay: false,
    crop: { x: 0, y: 0, width: 1, height: 1 },
  };
}
export function plainEffect(html: string): string {
  // Catalog text is HTML; projects use a small, explicit formatting language.
  return html
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|li)>\s*(?=\S)/gi, '\n')
    .replace(/<(?:strong|b)>/gi, '**')
    .replace(/<\/(?:strong|b)>/gi, '**')
    .replace(/<(?:em|i)>/gi, '_')
    .replace(/<\/(?:em|i)>/gi, '_')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}
export function documentFromCard(record: CardRecord, print?: CardPrint | null): MakerDocument {
  const b = record.base;
  const type =
    (Object.keys(TYPES) as CardType[]).find((t) =>
      b.categories.some((c) => c.includes(TYPES[t])),
    ) ?? 'unit';
  const d = newDocument(type);
  d.title = b.nameCn || b.nameEn || b.cardNo;
  d.source = b.cardNo;
  d.copy.zh = {
    name: b.nameCn,
    subtitle: b.subtitleCn,
    effect: plainEffect(b.effectCn),
    flavor: print?.flavorCn || b.flavorCn,
    tags: b.tags.join(' · '),
  };
  d.copy.en = {
    name: b.nameEn,
    subtitle: b.subtitleEn,
    effect: plainEffect(b.effectEn),
    flavor: print?.flavorEn || b.flavorEn,
    tags: translateTags(b.tags.join(' · ')).text,
  };
  d.subtype =
    b.categories.some((c) => c.includes('英雄')) || b.tags.includes('英雄')
      ? 'champion'
      : b.categories.some((c) => c.includes('专属')) || b.tags.includes('专属')
        ? 'signature'
        : '';
  d.energy = b.energy ?? 0;
  d.recycle = b.returnEnergy ?? 0;
  d.might = b.power ?? 0;
  const aliases: Record<string, Domain> = {
    怒: 'red',
    静: 'blue',
    思: 'purple',
    韧: 'green',
    乱: 'orange',
    序: 'yellow',
    无色: 'neutral',
  };
  d.domains = b.colors
    .map((c) => aliases[c] ?? (c in DOMAINS ? (c as Domain) : 'neutral'))
    .slice(0, 2);
  if (!d.domains.length) d.domains = ['neutral'];
  const rarity = print?.rarity || b.rarity;
  d.rarity = (Object.keys(RARITIES) as Rarity[]).find((r) => RARITIES[r] === rarity) ?? 'uncommon';
  d.artist = print?.artist ?? '';
  d.setInfo = print?.cardNo || b.cardNo;
  return d;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('项目结构不正确。');
  return value as Record<string, unknown>;
}
function str(value: unknown, limit = 10000): string {
  if (typeof value !== 'string' || value.length > limit)
    throw new Error('项目文字字段不正确或过长。');
  return value;
}
function num(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw new Error('项目数值超出范围。');
  return value;
}
function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('项目开关字段不正确。');
  return value;
}
function choice<T extends string>(value: unknown, choices: readonly T[]): T {
  if (typeof value !== 'string' || !choices.includes(value as T))
    throw new Error('项目包含不支持的模板或版本。');
  return value as T;
}
export function parseDocument(value: unknown): MakerDocument {
  const o = object(value);
  if (o.version !== 1) throw new Error('暂不支持此项目版本。');
  const copies = object(o.copy);
  const copy = (value: unknown): CardCopy => {
    const c = object(value);
    return {
      name: str(c.name, 200),
      subtitle: str(c.subtitle, 200),
      effect: str(c.effect),
      flavor: str(c.flavor, 2000),
      tags: str(c.tags, 500),
    };
  };
  if (
    !Array.isArray(o.layers) ||
    o.layers.length > 30 ||
    !Array.isArray(o.domains) ||
    !o.domains.length ||
    o.domains.length > 2
  )
    throw new Error('图层或符能数量不正确。');
  const ids = new Set<string>();
  const layers = o.layers.map((value) => {
    const l = object(value),
      c = object(l.crop),
      id = str(l.id, 100);
    if (!id || ids.has(id)) throw new Error('图层编号重复。');
    ids.add(id);
    const crop = {
      x: num(c.x, 0, 1),
      y: num(c.y, 0, 1),
      width: num(c.width, 0.001, 1),
      height: num(c.height, 0.001, 1),
    };
    if (crop.x + crop.width > 1.000001 || crop.y + crop.height > 1.000001)
      throw new Error('裁剪超出图片范围。');
    return {
      id,
      name: str(l.name, 200),
      assetId: str(l.assetId, 100),
      x: num(l.x, -100000, 100000),
      y: num(l.y, -100000, 100000),
      width: num(l.width, 1, 50000),
      height: num(l.height, 1, 50000),
      rotation: num(l.rotation, -36000, 36000),
      opacity: num(l.opacity, 0, 1),
      visible: bool(l.visible),
      locked: bool(l.locked),
      overlay: bool(l.overlay),
      crop,
    };
  });
  const background = str(o.background, 7);
  if (!/^#[0-9a-f]{6}$/i.test(background)) throw new Error('背景颜色不正确。');
  const id = str(o.id, 100);
  if (!id) throw new Error('作品缺少编号。');
  return {
    version: 1,
    id,
    title: str(o.title, 200),
    updatedAt: str(o.updatedAt, 50),
    type: choice(o.type, Object.keys(TYPES) as CardType[]),
    subtype: choice(o.subtype, ['', 'champion', 'signature']),
    rarity: choice(o.rarity, Object.keys(RARITIES) as Rarity[]),
    domains: o.domains.map((c) => choice(c, Object.keys(DOMAINS) as Domain[])),
    language: choice(o.language, ['zh', 'en']),
    copy: { zh: copy(copies.zh), en: copy(copies.en) },
    energy: num(o.energy, 0, 999),
    recycle: num(o.recycle, 0, 20),
    might: num(o.might, 0, 999),
    fontSize: num(o.fontSize, 16, 60),
    lineHeight: num(o.lineHeight, 1, 2),
    autoFit: bool(o.autoFit),
    background,
    artist: str(o.artist, 200),
    setInfo: str(o.setInfo, 200),
    source: str(o.source, 100),
    layers,
  };
}
export function parseProject(text: string): MakerProject {
  if (text.length > 90 * 1024 * 1024) throw new Error('项目文件超过 90 MB。');
  const o = object(JSON.parse(text));
  if (
    o.format !== 'rune-cardmaker' ||
    o.version !== 1 ||
    !Array.isArray(o.assets) ||
    o.assets.length > 30
  )
    throw new Error('请选择卡牌工坊导出的 JSON 项目。');
  const document = parseDocument(o.document),
    ids = new Set<string>();
  let total = 0;
  const assets: ImageAsset[] = o.assets.map((value) => {
    const a = object(value),
      id = str(a.id, 100),
      data = str(a.data, 30 * 1024 * 1024);
    total += data.length;
    if (
      !id ||
      ids.has(id) ||
      !/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(data) ||
      total > 80 * 1024 * 1024
    )
      throw new Error('项目图片无效、重复或过大。');
    ids.add(id);
    return {
      id,
      name: str(a.name, 200),
      data,
      width: num(a.width, 1, 6000),
      height: num(a.height, 1, 6000),
    };
  });
  if (document.layers.some((l) => !ids.has(l.assetId))) throw new Error('项目缺少图层图片。');
  return { format: 'rune-cardmaker', version: 1, document, assets };
}
