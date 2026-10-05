import { getCodeFromDeck, getDeckFromCode } from '@piltoverarchive/riftbound-deck-codes';
import type { Deck as CodeDeck } from '@piltoverarchive/riftbound-deck-codes';
import type { Deck as EventDeck } from '@/types';
import { zoneAtTokenIndex } from '@/utils/parseTTS';
import { ZONES, LABELS, newDeck, parseDeck, addEntry, entryFromCode, normalizeCode, defaultZone, resolveEntry, fullName, type BuilderDeck, type CardIndex, type Zone, type DeckEntry } from './model';

const MAX_BYTES = 1_000_000;
function codecCode(raw: string): string { return raw.trim().replace(/\*$/, 's').replace(/([a-z])$/i, value => value.toLowerCase()); }
function codeCards(entries: DeckEntry[]): CodeDeck {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const code = codecCode(entry.printNo);
    counts.set(code, (counts.get(code) ?? 0) + entry.quantity);
  }
  return [...counts].map(([cardCode, count]) => ({ cardCode, count }));
}
export function exportCode(deck: BuilderDeck): string {
  const main = ['legend', 'champion', 'main', 'battlefield', 'rune'].flatMap(z => deck.zones[z as Zone]);
  if (!main.length && !deck.zones.side.length && !deck.zones.additional.length) throw new Error('请先加入卡牌');
  return getCodeFromDeck(codeCards(main), codeCards(deck.zones.side), deck.zones.champion[0] ? codecCode(deck.zones.champion[0].printNo) : undefined, deck.zones.additional.flatMap(e => Array.from({ length: e.quantity }, () => codecCode(e.printNo))));
}
export function importCode(raw: string, index: CardIndex): BuilderDeck {
  const decoded = getDeckFromCode(raw.trim(), { signedSuffix: '*' });
  let deck = newDeck('导入的卡组');
  let championTaken = false;
  for (const item of decoded.mainDeck) {
    let quantity = item.count;
    if (!championTaken && decoded.chosenChampion && normalizeCode(item.cardCode) === normalizeCode(decoded.chosenChampion)) {
      deck = addEntry(deck, 'champion', entryFromCode(item.cardCode, index));
      championTaken = true;
      quantity -= 1;
    }
    if (quantity > 0) {
      const entry = entryFromCode(item.cardCode, index, quantity);
      const record = resolveEntry(entry, index).record;
      deck = addEntry(deck, record ? defaultZone(record) : 'main', entry);
    }
  }
  if (!championTaken && decoded.chosenChampion) deck = addEntry(deck, 'champion', entryFromCode(decoded.chosenChampion, index));
  for (const item of decoded.sideboard) deck = addEntry(deck, 'side', entryFromCode(item.cardCode, index, item.count));
  for (const code of decoded.additionalLegends ?? []) deck = addEntry(deck, 'additional', entryFromCode(code, index));
  return deck;
}
export function exportText(deck: BuilderDeck): string {
  return ['RUNE-DECK/1', `Name: ${JSON.stringify(deck.name)}`, `Description: ${JSON.stringify(deck.description)}`, ...ZONES.flatMap(z => [`\n${LABELS[z]}:`, ...deck.zones[z].map(e => `${e.quantity} ${JSON.stringify(e.name)} [${e.cardNo}] [${e.printNo}/${e.language}]`)])].join('\n');
}
const SECTIONS: Record<string, Zone> = { '传奇': 'legend', '传奇卡': 'legend', 'legend': 'legend', '英雄': 'champion', '选定': 'champion', 'champion': 'champion', 'chosen champion': 'champion', '主牌': 'main', '主牌堆': 'main', 'main deck': 'main', 'maindeck': 'main', '战场': 'battlefield', 'battlefields': 'battlefield', 'battlefield': 'battlefield', '符文': 'rune', 'runes': 'rune', 'rune pool': 'rune', '备牌': 'side', 'sideboard': 'side', '额外传奇': 'additional', 'additional legends': 'additional' };
function findByName(name: string, index: CardIndex): DeckEntry {
  const normalized = (s: string): string => s.trim().replace(/[·,，\-]+/g, ' ').replace(/\s+/g, ' ').toLocaleLowerCase();
  const matches = [...new Set(index.values())].filter(record => [fullName(record), record.base.nameCn, record.base.nameEn, [record.base.nameEn, record.base.subtitleEn].filter(Boolean).join(', '), [record.base.championTag, record.base.nameCn].filter(Boolean).join(', ')].some(v => normalized(v) === normalized(name)));
  if (matches.length === 1) return entryFromCode(matches[0]!.base.cardNo, index);
  return { cardNo: `?${name}`, printNo: `?${name}`, language: 'SC', quantity: 1, name };
}
export function importText(raw: string, index: CardIndex): BuilderDeck {
  let deck = newDeck('导入的卡组');
  let zone: Zone = 'main';
  for (const [i, original] of raw.split(/\r?\n/).entries()) {
    const line = original.trim();
    if (!line || line === 'RUNE-DECK/1') continue;
    const metadata = line.match(/^(Name|Description):\s*(.*)$/i);
    if (metadata) {
      let value: unknown;
      try { value = JSON.parse(metadata[2] ?? ''); } catch { value = metadata[2]; }
      if (typeof value !== 'string') throw new Error(`第 ${i + 1} 行的名称或备注格式不正确`);
      if (metadata[1]?.toLowerCase() === 'name') deck.name = value; else deck.description = value;
      continue;
    }
    const section = line.replace(/[:：]\s*$/, '').toLowerCase();
    if (SECTIONS[section]) { zone = SECTIONS[section]!; continue; }
    if (/^(单位|法术|装备)[:：]?$/.test(line)) { zone = 'main'; continue; }
    const own = line.match(/^(\d+)\s+("(?:[^"\\]|\\.)*")\s+\[([^\]]+)\]\s+\[([^\]]+)\/([^/\]]+)\]$/);
    const common = line.match(/^(\d+)\s+(.+?)(?:\s+\[([^\]]+)\])?$/);
    if (!own && !common) throw new Error(`第 ${i + 1} 行无法识别，请使用「数量 卡名 [卡号]」或分区标题`);
    const quantity = Number((own ?? common)![1]);
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 100000) throw new Error(`第 ${i + 1} 行的数量不正确`);
    let entry: DeckEntry;
    if (own) entry = { quantity, name: JSON.parse(own[2]!) as string, cardNo: own[3]!, printNo: own[4]!, language: own[5]! };
    else entry = { ...(common![3] ? entryFromCode(common![3]!, index) : findByName(common![2]!, index)), quantity };
    deck = addEntry(deck, zone, entry);
  }
  return deck;
}
export function exportTTS(deck: BuilderDeck): string {
  let total = 0;
  for (const zone of ZONES) for (const entry of deck.zones[zone]) {
    if (!/^[A-Z0-9]+-(?:R|SP)?\d+[A-Z*]?$/i.test(entry.printNo)) throw new Error(`${entry.name} 的卡号不能生成 TTS 码，请先匹配卡牌，或使用快照／文字清单。`);
    total += entry.quantity;
  }
  if (total > 10000) throw new Error('卡牌数量过多，请使用快照或文字清单分享');
  return (['legend', 'champion', 'main', 'battlefield', 'rune', 'additional', 'side'] as Zone[]).flatMap(z => deck.zones[z].flatMap(e => Array.from({ length: e.quantity }, () => `${normalizeCode(e.printNo)}-1`))).join(' ');
}
export function importTTS(raw: string, index: CardIndex): BuilderDeck {
  let deck = newDeck('TTS 导入的卡组');
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  const taken = new Map<string, number>();
  tokens.forEach((token, i) => {
    const code = token.replace(/-\d+$/, '');
    if (!/^[A-Z0-9]+-(?:R|SP)?\d+[A-Z*]?$/i.test(code)) throw new Error(`无法识别 TTS 项：${token}`);
    const entry = entryFromCode(code, index);
    const record = resolveEntry(entry, index).record;
    let zone: Zone = i === 1 ? 'champion' : zoneAtTokenIndex(i) === 'main' ? 'main' : zoneAtTokenIndex(i);
    // 外部 TTS 没有分区字段：明确的传奇／符文／战场优先按卡牌类型归区。
    if (record) {
      const typed = defaultZone(record);
      if (typed !== 'main') zone = typed === 'legend' && (taken.get('legend') ?? 0) >= 1 ? 'additional' : typed;
      else if (i !== 1 && !['main', 'side'].includes(zone)) zone = 'main';
    }
    deck = addEntry(deck, zone, entry);
    taken.set(zone, (taken.get(zone) ?? 0) + 1);
  });
  return deck;
}
export function fromEventDeck(event: EventDeck, index: CardIndex): BuilderDeck {
  let deck = newDeck(`${event.hero} · ${event.playerName}`);
  deck.description = [event.activityName, event.date, `选手：${event.playerName}`, `名次：${event.rank}`].filter(Boolean).join('\n');
  if (event.cardTokens?.length) {
    event.cardTokens.forEach((code, i) => { deck = addEntry(deck, i === 1 ? 'champion' : zoneAtTokenIndex(i), entryFromCode(code, index)); });
  } else {
    for (const [code, count] of event.cards) {
      let quantity = count;
      if (event.mainHeroCardNo && normalizeCode(code) === normalizeCode(event.mainHeroCardNo)) {
        deck = addEntry(deck, 'champion', entryFromCode(code, index)); quantity -= 1;
      }
      if (quantity > 0) {
        const entry = entryFromCode(code, index, quantity);
        const record = resolveEntry(entry, index).record;
        deck = addEntry(deck, event.cardZones?.get(code) ?? (record ? defaultZone(record) : 'main'), entry);
      }
    }
  }
  return deck;
}
async function bytesOf(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > MAX_BYTES) { await reader.cancel(); throw new Error('分享内容过大，请改用文字清单'); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } return bytes;
}
export async function encodeSnapshot(deck: BuilderDeck): Promise<string> {
  parseDeck(deck);
  const content = JSON.stringify([1, deck.name, deck.description, ...ZONES.map(z => deck.zones[z].map(e => [e.cardNo, e.printNo, e.language, e.quantity, e.name]))]);
  if (new TextEncoder().encode(content).length > MAX_BYTES) throw new Error('分享内容过大，请改用文字清单');
  const zipped = typeof CompressionStream !== 'undefined';
  const bytes = zipped ? await bytesOf(new Blob([content]).stream().pipeThrough(new CompressionStream('deflate-raw'))) : new TextEncoder().encode(content);
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  return `${zipped ? 'DB1z.' : 'DB1.'}${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}
export async function decodeSnapshot(payload: string): Promise<BuilderDeck> {
  if (payload.length > MAX_BYTES * 2 || !/^DB1z?\.[A-Za-z0-9_-]+$/.test(payload)) throw new Error('分享链接格式不正确或版本不受支持');
  const [prefix, encoded] = payload.split('.');
  const binary = atob(encoded!.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  const content = prefix === 'DB1z' ? await bytesOf(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))) : bytes;
  if (content.length > MAX_BYTES) throw new Error('分享内容过大');
  const data: unknown = JSON.parse(new TextDecoder().decode(content));
  if (!Array.isArray(data) || data[0] !== 1 || data.length !== ZONES.length + 3 || typeof data[1] !== 'string' || typeof data[2] !== 'string') throw new Error('分享卡组结构不正确');
  const deck = newDeck(data[1]); deck.description = data[2];
  ZONES.forEach((z, i) => {
    const rows: unknown = data[i + 3];
    if (!Array.isArray(rows)) throw new Error('分享分区数据不正确');
    deck.zones[z] = rows.map((v: unknown) => { if (!Array.isArray(v) || v.length !== 5) throw new Error('分享卡牌数据不正确'); return { cardNo: v[0], printNo: v[1], language: v[2], quantity: v[3], name: v[4] } as DeckEntry; });
  });
  return parseDeck(deck);
}
export async function importAny(raw: string, index: CardIndex): Promise<{ deck: BuilderDeck; note: string }> {
  const text = raw.trim();
  if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error('导入内容过大，请缩小卡组清单');
  if (!text) throw new Error('请粘贴分享链接、TTS 码、卡组代码或文字清单');
  const payload = text.startsWith('DB1') ? text : new URLSearchParams(text.includes('?') ? text.slice(text.indexOf('?') + 1) : '').get('s');
  if (payload) return { deck: await decodeSnapshot(payload), note: '本站分享快照：保留全部分区、印版与语言。' };
  if (/^[A-Z2-7]+$/i.test(text)) return { deck: importCode(text, index), note: '卡组代码保留额外传奇；印刷语言按可用印版恢复。请核对所选英雄与各分区。' };
  if (/^[A-Z0-9]+-(?:R|SP)?\d+[A-Z*]?-\d+(?:\s|$)/i.test(text)) return { deck: importTTS(text, index), note: 'TTS 码按原工具的每项一张解析，末段为生成参数。分区根据顺序和类型推断，请核对主牌、备牌和额外传奇。' };
  return { deck: importText(text, index), note: '文字清单已解析。未知编号或歧义卡名保留在预览中，可重新匹配。' };
}
