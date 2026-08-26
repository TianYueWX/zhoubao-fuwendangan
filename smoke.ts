/* 全量数据包端到端冒烟测试(仅本地验证,不进入构建) */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Papa from 'papaparse';
import { runAnalysis, legendaryRows, sortLegendaryRows, shrinkWinRate, envPriorWinRate } from '@/core';

const PKG = resolve(process.cwd(), '城市赛第四赛季第三周_全量数据包');

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

/* ── 传奇排行引擎验证 ── */
const legs = legendaryRows(result.allDecks, result.catalog, result.totalDecks);
const covered = legs.reduce((s, r) => s + r.total, 0);
console.log('\n== 传奇排行(新引擎)==');
console.log('传奇种类:', legs.length, '| 识别卡组:', covered, '/', result.totalDecks, '| 覆盖:', (covered / result.totalDecks * 100).toFixed(1) + '%');
console.log('-- 按出场率 Top5 --');
sortLegendaryRows(legs, 'popularity')
  .slice(0, 5)
  .forEach((r, i) =>
    console.log(`#${i + 1} ${r.name}(${r.cardNo}) n=${r.total} pop=${r.popularity.toFixed(1)}% win=${r.winRate?.toFixed(1)}% top8=${r.top8Rate.toFixed(1)}% hero=${r.topHero}(${r.topHeroRate.toFixed(0)}%) 域=${r.colors.join('+')}`)
  );
console.log('-- 按真实胜率 Top5 --');
sortLegendaryRows(legs, 'winRate')
  .slice(0, 5)
  .forEach((r, i) =>
    console.log(`#${i + 1} ${r.name}(${r.cardNo}) n=${r.total} win=${r.winRate?.toFixed(1)}% top8=${r.top8Rate.toFixed(1)}% pop=${r.popularity.toFixed(1)}% hero=${r.topHero}`)
  );
// 与 colorStats 域对口径一致性:同一范围(Top 样本)下,传奇按颜色域归并后的 decks 数应等于域对 decks 数
const legsSample = legendaryRows(result.uniqueSampleDecks, result.catalog, result.sampleSize);
const legByColors = new Map<string, number>();
for (const r of legsSample) {
  const key = [...r.colors].sort().join('|');
  legByColors.set(key, (legByColors.get(key) ?? 0) + r.total);
}
const csPairs = new Map(result.colorStats.pairs.map((p) => [p.colors.join('|'), p.decks]));
let pairOk = 0;
let pairMiss = 0;
for (const [key, n] of legByColors) {
  if (csPairs.get(key) === n) pairOk += 1;
  else pairMiss += 1;
}
console.log(`域对口径一致性(Top 样本 ${result.sampleSize} 套,${legByColors.size} 个域对): ${pairOk} 一致 / ${pairMiss} 不一致`);
console.log('平均每套卡组传奇数:', (covered / result.totalDecks).toFixed(4));

/* ── 贝叶斯收缩验证 ── */
console.log('\n== 贝叶斯收缩 ==');
const prior = envPriorWinRate(result.allDecks);
console.log('环境先验胜率:', prior != null ? (prior * 100).toFixed(2) + '%' : 'null');
// 纯函数断言
const u1 = shrinkWinRate(9, 9, 0.5); // 100% → 73.68%
const u2 = shrinkWinRate(100, 200, 0.5); // 50% 大样本 → ≈50.48%
console.log(`shrinkWinRate(9/9, prior=0.5) = ${u1.toFixed(2)}% (期望 73.68%) | (100/200) = ${u2.toFixed(2)}% (期望 50.00%)`);
if (Math.abs(u1 - 73.68) > 0.1 || Math.abs(u2 - 50.0) > 0.1) {
  console.error('✗ 收缩公式校验失败');
  process.exitCode = 1;
} else {
  console.log('✓ 收缩公式校验通过');
}
// 修正后胜率排行:小样本(影流之主 n=9)应被环境均值拉低
const byWinAdj = sortLegendaryRows(legs, 'winRate');
console.log('-- 按修正胜率 Top5 --');
byWinAdj.slice(0, 5).forEach((r, i) =>
  console.log(`#${i + 1} ${r.name}(${r.cardNo}) n=${r.total} 修正=${r.winRateAdj?.toFixed(1)}% 原始=${r.winRate?.toFixed(1)}% rounds=${r.rounds}`)
);
const shadow = legs.find((r) => r.cardNo === 'VEN-191');
const shadowRank = byWinAdj.findIndex((r) => r.cardNo === 'VEN-191') + 1;
console.log(`影流之主(VEN-191):原始#1 → 修正后第 ${shadowRank} 名(修正 ${shadow?.winRateAdj?.toFixed(1)}% / 原始 ${shadow?.winRate?.toFixed(1)}%)`);
console.log('英雄榜(Tier)是否同步收缩:', result.heroes ? '(分析管线仍为原始口径,视图层 quickStats 已收缩)' : '');
