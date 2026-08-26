/* 全量数据包端到端冒烟测试(仅本地验证,不进入构建) */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Papa from 'papaparse';
import { runAnalysis } from '@/core';

const PKG = 'C:/Users/Lenovo/Downloads/LOL符文战场卡图/第四赛季/state/城市赛第四赛季第三周_全量数据包';

function csv(name: string): Record<string, string | null>[] {
  const text = readFileSync(resolve(PKG, name), 'utf8');
  return (Papa.parse(text, { header: true, skipEmptyLines: true }).data ?? []) as Record<string, string | null>[];
}

const t0 = Date.now();
const result = runAnalysis({
  deckRows: csv('城市赛第四赛季第三周_decks_data_with_TTS.csv'),
  baseRows: csv('cards_base_rows.csv'),
  printRows: csv('card_prints_rows.csv'),
  rankRows: JSON.parse(readFileSync(resolve(PKG, '城市赛第四赛季第三周_rank_data.json'), 'utf8')),
  shopRows: JSON.parse(readFileSync(resolve(PKG, '城市赛第四赛季第三周_shop_data.json'), 'utf8')),
  cacheData: JSON.parse(readFileSync(resolve(PKG, '城市赛第四赛季第三周_decks_cache.json'), 'utf8'))
});
const ms = Date.now() - t0;

console.log('== 分析耗时', ms, 'ms ==');
console.log('totalDecks:', result.totalDecks);
console.log('sampleSize(Top15%):', result.sampleSize);
console.log('hasWinData:', result.hasWinData, '| winMatched:', result.winMatchedDecks);
console.log('events:', result.events.length, '| shopMatched:', result.shopMatchedEvents);
console.log('images:', result.imageCount);

const heroes = Array.from(result.heroes.entries()).sort((a, b) => b[1].total - a[1].total);
console.log('\n== Tier 排行(前10)==');
for (const [name, s] of heroes.slice(0, 10)) {
  console.log(
    `${s.tier ?? '-'} | ${name} | n=${s.total} pop=${s.popularity.toFixed(1)}% win=${s.winRate?.toFixed(1)}% top8=${s.top8Rate.toFixed(1)}% score=${s.tierScore}`
  );
}

const cs = result.colorStats;
console.log('\n== 域对 Top6 ==');
cs?.pairs.slice(0, 6).forEach((p) => console.log(`${p.label}: ${p.decks}套 ${p.share.toFixed(1)}%`));
console.log('identifiedDecks:', cs?.identifiedDecks);

const d0 = result.uniqueSampleDecks[0];
if (d0) {
  console.log('\n== 样本卡组 ==');
  console.log(d0.playerName, '|', d0.hero, '| rank', d0.rank, '| wins', d0.wins, '/', d0.eventRounds, '| city', d0.city, '| shop', d0.shopName, '| gid', d0.cardGroupId);
  const imgs = [...d0.cards.keys()].filter((id) => result.catalog.cardImg.has(id)).length;
  console.log('卡表', d0.cards.size, '种 · 有图', imgs, '种');
}

// 精确城市验证
const cities = new Set(result.allDecks.map((d) => d.city));
console.log('\n城市数:', cities.size, '| 未知:', result.allDecks.filter((d) => d.city === '未知').length);
console.log('combos:', result.combos.length, '| top1:', JSON.stringify(result.combos[0]?.nameA), '+', JSON.stringify(result.combos[0]?.nameB), 'lift', result.combos[0]?.lift.toFixed(2));
