import { chooseDefaultPrint } from '@/components/carddex/data';
import type { CardPrint, CardRecord } from '@/components/carddex/types';

export const ZONES = ['legend', 'champion', 'main', 'battlefield', 'rune', 'side', 'additional'] as const;
export type Zone = typeof ZONES[number];
export const LABELS: Record<Zone, string> = { legend: '传奇', champion: '英雄', main: '主牌堆', battlefield: '战场', rune: '符文', side: '备牌', additional: '额外传奇' };
export const LIMITS: Record<Zone, number> = { legend: 1, champion: 1, main: 39, battlefield: 3, rune: 12, side: 10, additional: 3 };
export interface DeckEntry { cardNo: string; printNo: string; language: string; quantity: number; name: string }
export interface BuilderDeck {
  formatVersion: 1;
  id: string;
  name: string;
  description: string;
  zones: Record<Zone, DeckEntry[]>;
  createdAt: string;
  updatedAt: string;
  savedAt: string | null;
}
export interface DeckProblem { zone: Zone; message: string }
export type CardIndex = Map<string, CardRecord>;
export const normalizeCode = (code: string): string => code.trim().toUpperCase().replace(/\*/g, 'S');
export const entryKey = (e: DeckEntry): string => `${normalizeCode(e.cardNo)}|${normalizeCode(e.printNo)}|${e.language.toUpperCase()}`;
export const cloneDeck = (deck: BuilderDeck): BuilderDeck => JSON.parse(JSON.stringify(deck)) as BuilderDeck;
export const countZone = (deck: BuilderDeck, zone: Zone): number => deck.zones[zone].reduce((sum, e) => sum + e.quantity, 0);
export const countDeck = (deck: BuilderDeck): number => ZONES.reduce((sum, z) => sum + countZone(deck, z), 0);

export function newDeck(name = '未命名卡组'): BuilderDeck {
  const now = new Date().toISOString();
  return { formatVersion: 1, id: crypto.randomUUID(), name, description: '', zones: { legend: [], champion: [], main: [], battlefield: [], rune: [], side: [], additional: [] }, createdAt: now, updatedAt: now, savedAt: null };
}
export function copyDeck(deck: BuilderDeck, name = `${deck.name} · 副本`): BuilderDeck {
  return { ...cloneDeck(deck), id: crypto.randomUUID(), name, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), savedAt: null };
}
export function cardIndex(records: readonly CardRecord[]): CardIndex {
  const index: CardIndex = new Map();
  for (const r of records) {
    index.set(normalizeCode(r.base.cardNo), r);
    for (const p of r.prints) index.set(normalizeCode(p.cardNo), r);
  }
  return index;
}
export function fullName(record: CardRecord): string {
  const b = record.base;
  return [b.nameCn || b.nameEn || b.cardNo, b.subtitleCn || b.subtitleEn].filter(Boolean).join(' · ');
}
export function resolveEntry(entry: DeckEntry, index: CardIndex): { record: CardRecord | null; print: CardPrint | null; name: string } {
  const record = index.get(normalizeCode(entry.cardNo)) ?? index.get(normalizeCode(entry.printNo)) ?? null;
  const print = record?.prints.find(p => normalizeCode(p.cardNo) === normalizeCode(entry.printNo) && p.language.toUpperCase() === entry.language.toUpperCase()) ?? null;
  return { record, print, name: record ? fullName(record) : entry.name || entry.cardNo };
}
export function entryFromRecord(record: CardRecord, print: CardPrint | null = chooseDefaultPrint(record.prints), quantity = 1): DeckEntry {
  return { cardNo: record.base.cardNo, printNo: print?.cardNo || record.base.cardNo, language: print?.language || 'SC', quantity, name: fullName(record) };
}
export function entryFromCode(code: string, index: CardIndex, quantity = 1, language = 'SC'): DeckEntry {
  const record = index.get(normalizeCode(code));
  if (!record) return { cardNo: code, printNo: code, language, quantity, name: code };
  const same = record.prints.filter(p => normalizeCode(p.cardNo) === normalizeCode(code));
  const print = same.find(p => p.language === language) ?? chooseDefaultPrint(same.length ? same : record.prints);
  return entryFromRecord(record, print, quantity);
}
export function kind(record: CardRecord): '传奇' | '单位' | '法术' | '装备' | '战场' | '符文' | '其他' {
  for (const type of ['传奇', '战场', '符文', '单位', '法术', '装备'] as const) {
    if (record.base.categories.some(c => c.includes(type))) return type;
  }
  return '其他';
}
export function defaultZone(record: CardRecord): Zone {
  const type = kind(record);
  return type === '传奇' ? 'legend' : type === '战场' ? 'battlefield' : type === '符文' ? 'rune' : 'main';
}
export function matchesZone(record: CardRecord, zone: Zone): boolean {
  const type = kind(record);
  if (zone === 'legend' || zone === 'additional') return type === '传奇';
  if (zone === 'champion') return record.base.categories.some(c => c.includes('英雄') && c.includes('单位'));
  if (zone === 'battlefield') return type === '战场';
  if (zone === 'rune') return type === '符文';
  return type === '单位' || type === '法术' || type === '装备';
}
export function isNeeko(record: CardRecord | null, fallback = ''): boolean {
  const names = record ? [record.base.nameCn, record.base.nameEn] : [fallback];
  if (names.some(name => /^(妮蔻|neeko)(?:$|[\s,，·\-])/i.test(name.trim()))) return true;
  return Boolean(record && ['传奇', '单位'].includes(kind(record)) && /^(妮蔻|neeko)$/i.test(record.base.championTag.trim()));
}
export function hasNeeko(deck: BuilderDeck, index: CardIndex): boolean {
  return ZONES.some(z => deck.zones[z].some(e => isNeeko(resolveEntry(e, index).record, e.name)));
}
export function addEntry(deck: BuilderDeck, zone: Zone, entry: DeckEntry, replaceSingle = false): BuilderDeck {
  const next = cloneDeck(deck);
  if (replaceSingle && (zone === 'legend' || zone === 'champion')) next.zones[zone] = [];
  const existing = next.zones[zone].find(e => entryKey(e) === entryKey(entry));
  if (existing) existing.quantity += entry.quantity;
  else next.zones[zone].push({ ...entry });
  next.updatedAt = new Date().toISOString();
  return next;
}
export function setQuantity(deck: BuilderDeck, zone: Zone, key: string, quantity: number): BuilderDeck {
  if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > 100000) throw new Error('请输入有效的卡牌数量');
  const next = cloneDeck(deck);
  next.zones[zone] = next.zones[zone].flatMap(e => entryKey(e) !== key ? [e] : quantity ? [{ ...e, quantity }] : []);
  next.updatedAt = new Date().toISOString();
  return next;
}
export function moveEntry(deck: BuilderDeck, from: Zone, to: Zone, key: string): BuilderDeck {
  if (from === to) return deck;
  const entry = deck.zones[from].find(e => entryKey(e) === key);
  if (!entry) return deck;
  return addEntry(setQuantity(deck, from, key, 0), to, entry);
}
export function changePrint(deck: BuilderDeck, zone: Zone, key: string, print: CardPrint): BuilderDeck {
  const entry = deck.zones[zone].find(e => entryKey(e) === key);
  if (!entry) return deck;
  return addEntry(setQuantity(deck, zone, key, 0), zone, { ...entry, printNo: print.cardNo, language: print.language });
}
export function validateDeck(deck: BuilderDeck, index: CardIndex): DeckProblem[] {
  const problems: DeckProblem[] = [];
  const limits = new Map<string, { count: number; limit: number; zone: Zone }>();
  const legendNames = new Set<string>();
  const starting = deck.zones.legend.map(e => resolveEntry(e, index).name);
  const legend = deck.zones.legend[0] ? resolveEntry(deck.zones.legend[0], index).record : null;
  for (const zone of ZONES) {
    const count = countZone(deck, zone);
    if (count > LIMITS[zone]) problems.push({ zone, message: `${LABELS[zone]} ${count} 张，超过 ${LIMITS[zone]} 张` });
    if (!['side', 'additional'].includes(zone) && count < LIMITS[zone]) problems.push({ zone, message: `${LABELS[zone]}还缺 ${LIMITS[zone] - count} 张` });
    for (const entry of deck.zones[zone]) {
      const { record, print, name } = resolveEntry(entry, index);
      if (!record) { problems.push({ zone, message: `卡表中找不到 ${entry.name || entry.cardNo}（${entry.cardNo}）` }); continue; }
      if (!print && record.prints.length) problems.push({ zone, message: `${name} 的印版 ${entry.printNo} / ${entry.language} 暂不可用` });
      if (record.base.banned) problems.push({ zone, message: `${name} 是禁卡` });
      if (!matchesZone(record, zone)) problems.push({ zone, message: `${name} 的类型不适用于${LABELS[zone]}` });
      if (['champion', 'main', 'side'].includes(zone)) {
        const limit = record.base.deckLimit ?? 3;
        const previous = limits.get(name);
        limits.set(name, { count: (previous?.count ?? 0) + entry.quantity, limit: previous?.limit ?? limit, zone });
      }
      if (['champion', 'main', 'rune', 'side'].includes(zone) && legend && record.base.colors.some(c => c !== 'colorless' && c !== 'neutral' && !legend.base.colors.includes(c))) problems.push({ zone, message: `${name} 包含主传奇以外的颜色` });
      if (zone === 'champion' && legend?.base.championTag && record.base.championTag !== legend.base.championTag) problems.push({ zone, message: `${name} 与主传奇的英雄身份不同` });
      if (zone === 'additional') {
        if (entry.quantity > 1 || legendNames.has(name) || starting.includes(name)) problems.push({ zone, message: `额外传奇 ${name} 与其他传奇同名` });
        legendNames.add(name);
      }
    }
  }
  for (const [name, data] of limits) if (data.limit > 0 && data.count > data.limit) problems.push({ zone: data.zone, message: `${name} 合计 ${data.count} 张，同名上限 ${data.limit}` });
  if (deck.zones.additional.length && !hasNeeko(deck, index)) problems.push({ zone: 'additional', message: '额外传奇需要妮蔻；已选卡牌暂存，可重新加入妮蔻' });
  return problems;
}
export function parseDeck(input: unknown): BuilderDeck {
  if (!input || typeof input !== 'object') throw new Error('卡组数据格式不正确');
  const d = input as Record<string, unknown>;
  if (d.formatVersion !== 1 || typeof d.id !== 'string' || !d.id || typeof d.name !== 'string' || typeof d.description !== 'string' || typeof d.createdAt !== 'string' || typeof d.updatedAt !== 'string' || !(d.savedAt === null || typeof d.savedAt === 'string') || !d.zones || typeof d.zones !== 'object') throw new Error('卡组格式不受支持或必要信息缺失');
  const deck = { formatVersion: 1, id: d.id, name: d.name, description: d.description, createdAt: d.createdAt, updatedAt: d.updatedAt, savedAt: d.savedAt, zones: {} } as BuilderDeck;
  for (const zone of ZONES) {
    const list = (d.zones as Record<string, unknown>)[zone];
    if (!Array.isArray(list) || list.length > 10000) throw new Error(`${LABELS[zone]}的数据不正确`);
    deck.zones[zone] = list.map((value: unknown): DeckEntry => {
      if (!value || typeof value !== 'object') throw new Error('卡牌条目不正确');
      const e = value as Record<string, unknown>;
      if (typeof e.cardNo !== 'string' || !e.cardNo || typeof e.printNo !== 'string' || !e.printNo || typeof e.language !== 'string' || !e.language || typeof e.name !== 'string' || typeof e.quantity !== 'number' || !Number.isSafeInteger(e.quantity) || e.quantity <= 0 || e.quantity > 100000) throw new Error('卡牌编号、印版或数量不正确');
      return { cardNo: e.cardNo, printNo: e.printNo, language: e.language, name: e.name, quantity: e.quantity };
    });
  }
  return deck;
}
