import type { CardCatalog, Deck } from '@/types';
import { compareWeekBucket } from '@/utils/isoWeek';
export function hasRank(deck: Deck): boolean { return deck.rank > 0 && deck.rank < Number.MAX_SAFE_INTEGER; }
function percent(n: number, total: number): number { return total ? n / total * 100 : 0; }
export function heroDetails(decks: readonly Deck[]) {
  const groups = new Map<string, Deck[]>();
  for (const d of decks) { const key = d.hero || '未知英雄'; const group = groups.get(key) ?? []; group.push(d); groups.set(key, group); }
  return [...groups].map(([name, group]) => {
    const ranked = group.filter(hasRank), wins = group.filter((d) => d.winRate != null);
    return { name, total: group.length, share: percent(group.length, decks.length), ranked: ranked.length,
      top8: ranked.filter((d) => d.rank <= 8).length, top4: ranked.filter((d) => d.rank <= 4).length, champions: ranked.filter((d) => d.rank === 1).length,
      top8Rate: ranked.length ? percent(ranked.filter((d) => d.rank <= 8).length, ranked.length) : null,
      top4Rate: ranked.length ? percent(ranked.filter((d) => d.rank <= 4).length, ranked.length) : null,
      winSamples: wins.length, winRate: wins.length ? wins.reduce((sum, d) => sum + d.winRate!, 0) / wins.length : null };
  }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}
function usages(decks: readonly Deck[], catalog: CardCatalog) {
  const counts = new Map<string, { n: number; copies: number }>();
  for (const d of decks) {
    const merged = new Map<string, number>();
    for (const [id, qty] of d.cards) { if (qty <= 0) continue; const key = catalog.canonicalById.get(id) ?? id; merged.set(key, (merged.get(key) ?? 0) + qty); }
    for (const [key, qty] of merged) { const stat = counts.get(key) ?? { n: 0, copies: 0 }; stat.n++; stat.copies += qty; counts.set(key, stat); }
  } return counts;
}
export function cardDetails(decks: readonly Deck[], catalog: CardCatalog, previous?: readonly Deck[]) {
  const listed = decks.filter((d) => d.cards.size > 0), high = listed.filter((d) => hasRank(d) && d.rank <= 8);
  if (!listed.length) return [];
  const before = previous?.filter((d) => d.cards.size > 0) ?? [], now = usages(listed, catalog), top = usages(high, catalog), old = usages(before, catalog);
  return [...new Set([...now.keys(), ...old.keys()])].map((key) => {
    const id = catalog.canonicalId.get(key) ?? key, meta = catalog.byId.get(id), stat = now.get(key), rate = percent(stat?.n ?? 0, listed.length);
    const oldRate = before.length ? percent(old.get(key)?.n ?? 0, before.length) : null;
    return { id, name: meta?.name ?? id, category: meta?.category ?? '未知类型', energy: meta?.energy ?? null, count: stat?.n ?? 0,
      rate, avgCopies: stat?.n ? stat.copies / stat.n : 0, highRate: high.length ? percent(top.get(key)?.n ?? 0, high.length) : null,
      advantage: high.length ? percent(top.get(key)?.n ?? 0, high.length) - rate : null, previousRate: oldRate, change: oldRate == null ? null : rate - oldRate,
      role: rate >= 80 ? '核心（≥80%）' : rate >= 20 ? '可替换（20–80%）' : '少见（<20%）', trend: oldRate == null ? '无对照' : !old.has(key) && now.has(key) ? '本周新出现' : !now.has(key) ? '本周未出现' : rate > oldRate ? '上升' : rate < oldRate ? '下降' : '持平' };
  }).sort((a, b) => b.rate - a.rate || a.name.localeCompare(b.name));
}
export function comparisonWeeks(decks: readonly Deck[], selectedWeek: string) {
  const buckets = new Map(decks.map((d) => [d.week.label, d.week]));
  const weeks = [...buckets.values()].sort(compareWeekBucket);
  const index = selectedWeek ? weeks.findIndex((w) => w.label === selectedWeek) : weeks.length - 1;
  const current = weeks[index], previous = weeks[index - 1];
  return { current: current?.label ?? '', previous: previous?.label ?? '', weeks };
}
export function heroTrends(decks: readonly Deck[], current: string, previous: string) {
  const now = heroDetails(decks.filter((d) => d.week.label === current)), old = heroDetails(decks.filter((d) => d.week.label === previous));
  const n = new Map(now.map((r) => [r.name, r])), o = new Map(old.map((r) => [r.name, r]));
  return [...new Set([...n.keys(), ...o.keys()])].map((name) => {
    const a = n.get(name), b = o.get(name);
    return { name, count: a?.total ?? 0, previousCount: previous ? b?.total ?? 0 : null, share: a?.share ?? 0, previousShare: previous ? b?.share ?? 0 : null,
      change: previous ? (a?.share ?? 0) - (b?.share ?? 0) : null, trend: !previous ? '无对照' : !b ? '本周新出现' : !a ? '本周未出现' : a.share > b.share ? '上升' : a.share < b.share ? '下降' : '持平' };
  }).sort((a, b) => (b.change ?? 0) - (a.change ?? 0));
}
export function regionDetails(decks: readonly Deck[]) {
  const groups = new Map<string, Deck[]>(); for (const d of decks) { const key = d.city || '未知'; const g = groups.get(key) ?? []; g.push(d); groups.set(key, g); }
  return [...groups].map(([city, group]) => { const heroes = heroDetails(group), ranked = group.filter(hasRank);
    return { city, total: group.length, events: new Set(group.map((d) => `${d.date}|${d.activityName}`)).size, heroes: heroes.length, leader: heroes[0]?.name ?? '—', leaderShare: heroes[0]?.share ?? 0,
      top8: ranked.filter((d) => d.rank <= 8).length, top4: ranked.filter((d) => d.rank <= 4).length, champions: ranked.filter((d) => d.rank === 1).length, ranked: ranked.length,
      top8Rate: ranked.length ? percent(ranked.filter((d) => d.rank <= 8).length, ranked.length) : null, top4Rate: ranked.length ? percent(ranked.filter((d) => d.rank <= 4).length, ranked.length) : null };
  }).sort((a, b) => b.total - a.total);
}
export function regionHeroDetails(decks: readonly Deck[]) {
  const groups = new Map<string, Deck[]>();
  for (const d of decks) { const city = d.city || '未知'; const group = groups.get(city) ?? []; group.push(d); groups.set(city, group); }
  return [...groups].flatMap(([city, group]) => heroDetails(group).map((row) => ({ city, ...row }))).sort((a,b) => b.total-a.total);
}
export function buildDetails(decks: readonly Deck[], catalog: CardCatalog) {
  const listed = decks.filter((d) => d.cards.size > 0), costs = new Map<number, number>(), types = new Map<string, number>(), variants = new Map<string, { count: number; top8: number; example: string }>();
  const cardSets: Map<string, number>[] = [];
  let totalCards = 0, unknown = 0;
  for (const d of listed) {
    const main = new Map<string, number>();
    for (const [id, n] of d.cards) {
      const meta = catalog.byId.get(id); if (!meta) { unknown += n; continue; }
      if (!['单位', '英雄单位', '法术', '装备'].includes(meta.category)) continue;
      const key = catalog.canonicalById.get(id) ?? id; main.set(key, (main.get(key) ?? 0) + n);
      const cost = Math.min(7, Math.floor(meta.energy)); costs.set(cost, (costs.get(cost) ?? 0) + n);
      types.set(meta.category, (types.get(meta.category) ?? 0) + n); totalCards += n;
    }
    const signature = [...main].sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => `${k}:${n}`).join('|');
    if (signature) cardSets.push(main);
    if (signature) { const v = variants.get(signature) ?? { count: 0, top8: 0, example: d.playerName }; v.count++; if (hasRank(d) && d.rank <= 8) v.top8++; variants.set(signature, v); }
  }
  const common = [...variants].sort((a, b) => b[1].count - a[1].count)[0]?.[0];
  const reference = cardSets.find((cards) => [...cards].sort(([a], [b]) => a.localeCompare(b)).map(([k,n]) => `${k}:${n}`).join('|') === common);
  const similarities = reference ? cardSets.map((cards) => {
    let same = 0, union = 0;
    for (const key of new Set([...cards.keys(), ...reference.keys()])) { same += Math.min(cards.get(key) ?? 0, reference.get(key) ?? 0); union += Math.max(cards.get(key) ?? 0, reference.get(key) ?? 0); }
    return union ? same / union * 100 : 0;
  }) : [];
  const base = new Map<string, number>(); for (const cards of cardSets) for (const key of cards.keys()) base.set(key, (base.get(key) ?? 0) + 1);
  const eligible = new Set([...base].filter(([, n]) => n / Math.max(1, cardSets.length) >= .2).map(([key]) => key));
  const pairs = new Map<string, { a: string; b: string; count: number }>();
  for (const cards of cardSets) {
    const keys = [...cards.keys()].filter((k) => eligible.has(k)).sort();
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
      const a = keys[i]!, b = keys[j]!, key = JSON.stringify([a,b]); const pair = pairs.get(key) ?? { a, b, count: 0 }; pair.count++; pairs.set(key, pair);
    }
  }
  const nameOf = (key: string): string => catalog.byId.get(catalog.canonicalId.get(key) ?? key)?.name ?? key;
  return { samples: listed.length, unknown, similarity: similarities.length ? similarities.reduce((a,b)=>a+b,0)/similarities.length : null,
    pairs: [...pairs.values()].map((p) => ({ name: `${nameOf(p.a)} + ${nameOf(p.b)}`, count: p.count, share: percent(p.count, cardSets.length), lift: p.count * cardSets.length / ((base.get(p.a) ?? 1) * (base.get(p.b) ?? 1)) })).sort((a,b)=>b.count-a.count || b.lift-a.lift),
    curve: Array.from({ length: 8 }, (_, i) => ({ name: i === 7 ? '7费及以上' : `${i}费`, copies: costs.get(i) ?? 0, average: listed.length ? (costs.get(i) ?? 0) / listed.length : 0, share: percent(costs.get(i) ?? 0, totalCards) })),
    types: [...types].map(([name, copies]) => ({ name, copies, average: listed.length ? copies / listed.length : 0, share: percent(copies, totalCards) })),
    variants: [...variants.values()].sort((a, b) => b.count - a.count).map((v, i) => ({ name: `相同牌表 ${i + 1}`, ...v, share: percent(v.count, listed.length) })) };
}
