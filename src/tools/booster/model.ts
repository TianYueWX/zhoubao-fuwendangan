import { restSelectAll } from "@/tools/sources/rest";

export const BOOSTER_SETS = ["OGN", "SFD", "UNL", "VEN"] as const;
export type BoosterSet = (typeof BOOSTER_SETS)[number];
export type BoosterFinish = "base" | "alt" | "overnumber" | "signature" | "ultimate";
export type BoosterRarity = "common" | "uncommon" | "rare" | "epic" | "showcase" | "token";

export interface BoosterCard {
  key: string;
  series: BoosterSet;
  cardId: string;
  cardNo: string;
  name: string;
  rarity: BoosterRarity;
  finish: BoosterFinish;
  categories: string[];
  imageUrl: string;
  fallbackUrl: string;
  language: string;
}

export interface DrawnCard extends BoosterCard {
  slot: string;
  revealed: boolean;
}

export interface OpenedPack {
  packNumber: number;
  openedAt: string;
  cards: DrawnCard[];
}

export interface OpeningRecord {
  id: string;
  series: BoosterSet;
  kind: "pack" | "box";
  createdAt: string;
  status: "inProgress" | "complete";
  packs: OpenedPack[];
}

type Row = Record<string, unknown>;

const SET_NAMES: Record<BoosterSet, string> = {
  OGN: "Origins",
  SFD: "Spiritforged",
  UNL: "Unleashed",
  VEN: "Vendetta",
};

export function setName(set: BoosterSet): string {
  return SET_NAMES[set];
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function bool(value: unknown): boolean {
  return value === true || value === 1 || String(value).toLowerCase() === "true";
}

function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  const source = text(value);
  if (!source) return [];
  try {
    const parsed: unknown = JSON.parse(source);
    if (Array.isArray(parsed)) return parsed.map(text).filter(Boolean);
  } catch { /* accept comma separated database values too */ }
  return source.split(",").map((item) => item.trim()).filter(Boolean);
}

function finishOf(row: Row): BoosterFinish {
  const finish = text(row.extend_rarity_name);
  if (finish.includes("签名")) return "signature";
  if (finish.includes("超编")) return "overnumber";
  if (finish.includes("异画")) return "alt";
  return "base";
}

function rarityOf(row: Row, categories: string[]): BoosterRarity {
  const name = text(row.rarity_name);
  if (categories.some((item) => item.includes("指示物"))) return "token";
  if (name.includes("普通") || name.toLowerCase() === "common") return "common";
  if (name.includes("不凡") || name.toLowerCase() === "uncommon") return "uncommon";
  if (name.includes("稀有") || name.toLowerCase() === "rare") return "rare";
  if (name.includes("史诗") || name.toLowerCase() === "epic") return "epic";
  return "showcase";
}

function languageRank(language: string): number {
  if (language === "SC") return 0;
  if (language === "EN") return 1;
  return 2;
}

export async function loadBoosterBases(): Promise<Row[]> {
  return restSelectAll<Row>("cards_base", { order: "id.asc" });
}

export async function loadBoosterPrints(): Promise<Row[]> {
  return restSelectAll<Row>("card_prints", { order: "id.asc" });
}

export function buildBoosterCards(bases: Row[], prints: Row[]): BoosterCard[] {
  const baseById = new Map(bases.map((base) => [text(base.id), base]));
  const printGroups = new Map<string, { base: Row; prints: Row[]; series: BoosterSet; cardId: string; finish: BoosterFinish; cardNo: string }>();

  for (const print of prints) {
    if (bool(print.is_promo)) continue;
    const cardId = text(print.card_id);
    const base = baseById.get(cardId);
    if (!base) continue;
    const series = (text(print.series) || text(base.series_name)) as BoosterSet;
    if (!BOOSTER_SETS.includes(series)) continue;
    const cardNo = text(print.card_no_extend) || text(base.card_no);
    const finish = finishOf(print);
    const key = `${series}:${cardId}:${cardNo}:${finish}`;
    const group = printGroups.get(key) ?? { base, prints: [], series, cardId, finish, cardNo };
    group.prints.push(print);
    printGroups.set(key, group);
  }

  const cards: BoosterCard[] = [];
  for (const [key, group] of printGroups) {
    group.prints.sort((a, b) => languageRank(text(a.language).toUpperCase()) - languageRank(text(b.language).toUpperCase()));
    const preferred = group.prints.find((print) => text(print.language).toUpperCase() === "SC") ?? group.prints[0]!;
    const imagePrint = group.prints.find((print) => text(print.img_cdn)) ?? preferred;
    const categories = list(group.base.card_category);
    const rarity = rarityOf(preferred, categories);
    let finish = group.finish;
    if (finish === "overnumber" && group.series === "UNL" && group.cardNo.includes("238")) finish = "ultimate";
    cards.push({
      key,
      series: group.series,
      cardId: group.cardId,
      cardNo: group.cardNo,
      name: text(group.base.card_name_cn) || text(group.base.card_name_en) || group.cardNo,
      rarity,
      finish,
      categories,
      imageUrl: text(imagePrint.img_cdn),
      fallbackUrl: text(imagePrint.tts_cdn),
      language: text(preferred.language).toUpperCase(),
    });
  }
  return cards;
}

export async function loadBoosterCards(): Promise<BoosterCard[]> {
  const [bases, prints] = await Promise.all([loadBoosterBases(), loadBoosterPrints()]);
  return buildBoosterCards(bases, prints);
}

export function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function pick<T>(pool: readonly T[]): T | null {
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)] ?? null;
}

type Pools = {
  common: BoosterCard[];
  uncommon: BoosterCard[];
  rare: BoosterCard[];
  epic: BoosterCard[];
  alt: BoosterCard[];
  overnumber: BoosterCard[];
  signature: BoosterCard[];
  ultimate: BoosterCard[];
  tokenRune: BoosterCard[];
};

function poolsFor(cards: readonly BoosterCard[], series: BoosterSet): Pools {
  const setCards = cards.filter((card) => card.series === series);
  const tokenRune = setCards.filter((card) => card.finish === "base" && card.categories.some((category) => category.includes("符文") || category.includes("指示物")));
  const playable = setCards.filter((card) => !card.categories.some((category) => category.includes("符文") || category.includes("指示物")));
  return {
    common: playable.filter((card) => card.finish === "base" && card.rarity === "common"),
    uncommon: playable.filter((card) => card.finish === "base" && card.rarity === "uncommon"),
    rare: playable.filter((card) => card.finish === "base" && card.rarity === "rare"),
    epic: playable.filter((card) => card.finish === "base" && card.rarity === "epic"),
    alt: setCards.filter((card) => card.finish === "alt"),
    overnumber: setCards.filter((card) => card.finish === "overnumber"),
    signature: setCards.filter((card) => card.finish === "signature"),
    ultimate: setCards.filter((card) => card.finish === "ultimate"),
    tokenRune,
  };
}

function makeDraw(card: BoosterCard, slot: string): DrawnCard {
  return { ...card, slot, revealed: false };
}

function drawFrom(pool: readonly BoosterCard[], fallback: readonly BoosterCard[], slot: string): DrawnCard {
  const selected = pick(pool) ?? pick(fallback);
  if (!selected) throw new Error(`这个系列没有可用于「${slot}」的卡牌数据。`);
  return makeDraw(selected, slot);
}

function foilCard(pools: Pools): BoosterCard | null {
  const roll = Math.random() * 100;
  if (roll < 85) return pick(pools.common);
  if (roll < 97) return pick(pools.uncommon);
  if (roll < 99.7) return pick(pools.rare);
  return pick(pools.epic);
}

export function drawPack(cards: readonly BoosterCard[], series: BoosterSet, packNumber: number): OpenedPack {
  const pools = poolsFor(cards, series);
  if (!pools.common.length || !pools.uncommon.length || !pools.rare.length || !pools.epic.length || !pools.tokenRune.length)
    throw new Error(`${series} 卡池资料不完整，暂时无法开包。`);

  const packCards: DrawnCard[] = [];
  for (let i = 0; i < 7; i += 1) packCards.push(drawFrom(pools.common, pools.uncommon, "普通"));
  for (let i = 0; i < 3; i += 1) packCards.push(drawFrom(pools.uncommon, pools.common, "不凡"));

  const rareSlotIndices: number[] = [];
  for (let i = 0; i < 2; i += 1) {
    const epic = Math.random() < 0.13;
    const card = drawFrom(epic ? pools.epic : pools.rare, epic ? pools.rare : pools.epic, "稀有以上");
    rareSlotIndices.push(packCards.length);
    packCards.push(card);
  }

  const foil = Math.random() < 1 / 720 && pools.signature.length
    ? pick(pools.signature)
    : foilCard(pools);
  packCards.push(makeDraw(foil ?? pick(pools.common)!, foil && pools.signature.includes(foil) ? "Signature" : "闪卡"));
  packCards.push(drawFrom(pools.tokenRune, pools.tokenRune, "Token／符文"));

  const replaceRareSlot = (pool: readonly BoosterCard[], slot: string): void => {
    if (!pool.length) return;
    const eligible = rareSlotIndices.filter((index) => packCards[index]?.finish === "base");
    const index = pick(eligible);
    if (index === null) return;
    packCards[index] = drawFrom(pool, pool, slot);
  };

  // Alt Art ~1/12 packs; Overnumbered ~1/72. UNL's 1/72 branch includes its
  // Ultimate Baron Nashor estimate (~1/1,368 packs, or 1/19 of that branch).
  if (Math.random() < 1 / 12) replaceRareSlot(pools.alt, "异画");
  if (Math.random() < 1 / 72) {
    const ultimateHit = series === "UNL" && pools.ultimate.length > 0 && Math.random() < 1 / 19;
    replaceRareSlot(ultimateHit ? pools.ultimate : pools.overnumber, ultimateHit ? "Ultimate" : "超编");
  }

  return { packNumber, openedAt: new Date().toISOString(), cards: packCards };
}

export const RARITY_LABELS: Record<BoosterRarity, string> = {
  common: "普通",
  uncommon: "不凡",
  rare: "稀有",
  epic: "史诗",
  showcase: "异画",
  token: "Token／符文",
};

export const FINISH_LABELS: Record<BoosterFinish, string> = {
  base: "平卡",
  alt: "异画",
  overnumber: "超编",
  signature: "签名超编",
  ultimate: "Ultimate",
};
