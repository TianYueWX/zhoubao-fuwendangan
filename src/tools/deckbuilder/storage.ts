import { cloneDeck, parseDeck, type BuilderDeck } from './model';

export const STORAGE_KEY = 'rune.deckbuilder.v1';
interface Library { formatVersion: 1; decks: BuilderDeck[]; drafts: Record<string, BuilderDeck> }
export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }
const browserStorage = (): StorageLike => localStorage;
export function readLibrary(storage: StorageLike = browserStorage()): Library {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return { formatVersion: 1, decks: [], drafts: {} };
  const value = JSON.parse(raw) as Partial<Library>;
  if (value.formatVersion !== 1 || !Array.isArray(value.decks) || !value.drafts || typeof value.drafts !== 'object') throw new Error('本机卡组数据无法读取，请先备份浏览器中的卡组数据');
  return { formatVersion: 1, decks: value.decks.map(parseDeck), drafts: Object.fromEntries(Object.entries(value.drafts).map(([key, deck]) => [key, parseDeck(deck)])) };
}
function writeLibrary(library: Library, storage: StorageLike): void {
  try { storage.setItem(STORAGE_KEY, JSON.stringify(library)); }
  catch { throw new Error('本机保存失败：浏览器存储空间不足或已禁用存储'); }
}
export function saveDraft(deck: BuilderDeck, scope = `local:${deck.id}`, storage: StorageLike = browserStorage()): void {
  const library = readLibrary(storage);
  library.drafts[scope] = cloneDeck(parseDeck(deck));
  writeLibrary(library, storage);
}
export function clearDraft(scope: string, storage: StorageLike = browserStorage()): void {
  const library = readLibrary(storage);
  delete library.drafts[scope];
  writeLibrary(library, storage);
}
export function saveLocal(deck: BuilderDeck, storage: StorageLike = browserStorage()): BuilderDeck {
  const library = readLibrary(storage);
  const now = new Date().toISOString();
  const saved = { ...cloneDeck(parseDeck(deck)), name: deck.name.trim() || '未命名卡组', updatedAt: now, savedAt: now };
  library.decks = [saved, ...library.decks.filter(d => d.id !== deck.id)];
  delete library.drafts[`local:${deck.id}`];
  writeLibrary(library, storage);
  return saved;
}
export function deleteLocal(id: string, storage: StorageLike = browserStorage()): void {
  const library = readLibrary(storage);
  library.decks = library.decks.filter(d => d.id !== id);
  delete library.drafts[`local:${id}`];
  writeLibrary(library, storage);
}
export function listLocal(storage: StorageLike = browserStorage()): BuilderDeck[] {
  const library = readLibrary(storage);
  const items = new Map(library.decks.map(d => [d.id, d]));
  for (const [key, deck] of Object.entries(library.drafts)) if (key.startsWith('local:') && !items.has(deck.id)) items.set(deck.id, deck);
  return [...items.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
