import { restSelectAll } from "@/tools/sources/rest";
import type {
  CardBase,
  CardPrint,
  CardRecord,
  CardIcon,
  CarddexData,
} from "./types";

type Row = Record<string, unknown>;

function text(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v);
}

function numberOrNull(v: unknown): number | null {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function bool(v: unknown): boolean {
  return v === true || v === 1 || String(v).toLowerCase() === "true";
}

function list(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(text).filter(Boolean);
  if (typeof v !== "string" || !v.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(v);
    return Array.isArray(parsed) ? parsed.map(text).filter(Boolean) : [];
  } catch {
    return v
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  }
}

function baseFromRow(r: Row): CardBase {
  return {
    id: text(r.id),
    cardNo: text(r.card_no),
    nameCn: text(r.card_name_cn),
    nameEn: text(r.card_name_en),
    subtitleCn: text(r.sub_title_cn),
    subtitleEn: text(r.sub_title_en),
    colors: list(r.card_color_list),
    regions: list(r.region),
    tags: list(r.tag),
    keywords: list(r.keyword),
    advancedTags: list(r.advanced_tag),
    championTag: text(r.champion_tag),
    effectCn: text(r.effect_cn),
    effectEn: text(r.effect_en),
    energy: numberOrNull(r.energy),
    returnEnergy: numberOrNull(r.return_energy),
    power: numberOrNull(r.power),
    rarity: text(r.rarity_name),
    series: text(r.series_name),
    flavorCn: text(r.flavor_text_cn),
    flavorEn: text(r.flavor_text_en),
    banned: bool(r.is_banned),
    categories: list(r.card_category),
    deckLimit: numberOrNull(r.deck_limit),
  };
}

function printFromRow(r: Row): CardPrint {
  return {
    id: text(r.id),
    cardId: text(r.card_id),
    cardNo: text(r.card_no_extend),
    rarity: text(r.rarity_name),
    extendedRarity: text(r.extend_rarity_name),
    language: text(r.language).toUpperCase(),
    imageUrl: text(r.img_cdn),
    ttsUrl: text(r.tts_cdn),
    artist: text(r.artist),
    printOrder: numberOrNull(r.print_order) ?? 0,
    isDefault: bool(r.is_default),
    isPromo: bool(r.is_promo),
    series: text(r.series),
    flavorCn: text(r.flavor_text_cn),
    flavorEn: text(r.flavor_text_en),
  };
}

export function printKey(p: Pick<CardPrint, "cardNo" | "language">): string {
  return `${p.cardNo}\u0000${p.language.toUpperCase()}`;
}

export function chooseDefaultPrint(
  prints: readonly CardPrint[],
): CardPrint | null {
  if (!prints.length) return null;
  const ordered = [...prints].sort((a, b) => {
    const rank = (p: CardPrint): number => {
      if (p.language === "SC" && p.isDefault) return 0;
      if (p.language === "SC") return 1;
      if (p.isDefault) return 2;
      return 3;
    };
    return (
      rank(a) - rank(b) ||
      a.cardNo.length - b.cardNo.length ||
      b.printOrder - a.printOrder ||
      a.cardNo.localeCompare(b.cardNo, undefined, { numeric: true })
    );
  });
  return ordered[0] ?? null;
}

export async function loadCarddexData(): Promise<CarddexData> {
  const [baseRows, printRows, iconRows] = await Promise.all([
    restSelectAll<Row>("cards_base", { order: "card_no.asc" }),
    restSelectAll<Row>("card_prints", { order: "card_no_extend.asc" }),
    restSelectAll<Row>("card_icons", { order: "name_zh.asc" }).catch(() => []),
  ]);
  const printsByCard = new Map<string, CardPrint[]>();
  for (const raw of printRows) {
    const p = printFromRow(raw);
    if (!p.cardId) continue;
    const group = printsByCard.get(p.cardId) ?? [];
    group.push(p);
    printsByCard.set(p.cardId, group);
  }
  const records: CardRecord[] = baseRows
    .map(baseFromRow)
    .filter((base) => base.id && base.cardNo)
    .map((base) => ({ base, prints: printsByCard.get(base.id) ?? [] }));
  const icons: CardIcon[] = iconRows
    .map((r) => ({
      name: text(r.name_zh ?? r.name ?? r.key),
      url: text(r.url),
      isWhite: bool(r.isWhite ?? r.is_white),
    }))
    .filter((i) => i.name && /^https?:\/\//i.test(i.url));
  return { records, icons };
}
