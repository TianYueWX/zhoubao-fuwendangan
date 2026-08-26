/* 全量数据包端到端冒烟测试(仅本地验证,不进入构建) */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Papa from 'papaparse';
import { runAnalysis, legendaryRows, sortLegendaryRows, sortLeadCandidates, convertScore, wilsonLowerBound, quickHeroRows, deltasFromRows, movers, hhi, buildWeeklyReport, MIN_LEGEND_SAMPLE } from '@/core';
import { reportToMarkdown } from '@/utils/reportMarkdown';
import type { Deck } from '@/types';

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
  shopRows: JSON.parse(readFileSync(resolve(PKG, '城市赛第四赛季第三周_shop_data.json'), 'utf8'))
});
const ms = Date.now() - t0;

console.log('== 分析耗时', ms, 'ms ==');
console.log('totalDecks:', result.totalDecks);
console.log('sampleSize(Top15%):', result.sampleSize);
console.log('hasWinData:', result.hasWinData, '| winMatched:', result.winMatchedDecks);
console.log('events:', result.events.length, '| shopMatched:', result.shopMatchedEvents);

const heroes = Array.from(result.heroes.entries()).sort((a, b) => b[1].total - a[1].total);
console.log('\n== Tier 排行(前10)==');
for (const [name, s] of heroes.slice(0, 10)) {
  console.log(
    `${s.tier ?? '-'} | ${name} | n=${s.total} pop=${s.popularity.toFixed(1)}% top8=${s.top8Rate.toFixed(1)}% top4=${s.top4Rate.toFixed(1)}% 冠=${s.champions} 亚=${s.runnersUp} score=${s.tierScore}`
  );
}

const cs = result.colorStats;
console.log('\n== 域对 Top6 ==');
cs?.pairs.slice(0, 6).forEach((p) => console.log(`${p.label}: ${p.decks}套 ${p.share.toFixed(1)}%`));
console.log('identifiedDecks:', cs?.identifiedDecks);

const d0 = result.uniqueSampleDecks[0];
if (d0) {
  console.log('\n== 卡组示例 ==');
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
console.log('\n== 传奇排行(名次转化口径)==');
console.log('传奇种类:', legs.length, '| 识别卡组:', covered, '/', result.totalDecks, '| 覆盖:', (covered / result.totalDecks * 100).toFixed(1) + '%');
console.log('-- 按出场率 Top5 --');
sortLegendaryRows(legs, 'popularity')
  .slice(0, 5)
  .forEach((r, i) =>
    console.log(`#${i + 1} ${r.name}(${r.cardNo}) n=${r.total} pop=${r.popularity.toFixed(1)}% conv=${r.convert.toFixed(1)} top8=${r.top8Rate.toFixed(1)}% top4=${r.top4Rate.toFixed(1)}% hero=${r.topHero}(${r.topHeroRate.toFixed(0)}%) 域=${r.colors.join('+')}`)
  );
console.log('-- 按转化综合分 Top5 --');
sortLegendaryRows(legs, 'convert')
  .slice(0, 5)
  .forEach((r, i) =>
    console.log(`#${i + 1} ${r.name}(${r.cardNo}) n=${r.total} conv=${r.convert.toFixed(1)} top8=${r.top8Rate.toFixed(1)}% top4=${r.top4Rate.toFixed(1)}% 冠=${r.champions} 亚=${r.runnersUp} pop=${r.popularity.toFixed(1)}%`)
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
console.log(`域对口径一致性(Top 卡组 ${result.sampleSize} 套,${legByColors.size} 个域对): ${pairOk} 一致 / ${pairMiss} 不一致`);
console.log('平均每套卡组传奇数:', (covered / result.totalDecks).toFixed(4));

/* ── 转化综合分验证 ── */
console.log('\n== 转化综合分 ==');
const c1 = convertScore(50, 25, 5, 4); // 50*0.35+25*0.35+5*0.2+4*0.1 = 27.65
console.log(`convertScore(50,25,5,4) = ${c1.toFixed(2)} (期望 27.65)`);
if (Math.abs(c1 - 27.65) > 0.01) {
  console.error('✗ 转化综合分公式校验失败');
  process.exitCode = 1;
} else {
  console.log('✓ 转化综合分公式校验通过');
}
// 转化口径不依赖 rank_data:冠军率/亚军率由名次直接转化
const champOk = legs.every((r) => r.total <= 0 || r.championRate >= 0 && r.championRate <= 100);
console.log(`冠军率范围(0-100): ${champOk ? '✓' : '✗'} | 冠军总次数: ${legs.reduce((s, r) => s + r.champions, 0)} | 亚军总次数: ${legs.reduce((s, r) => s + r.runnersUp, 0)}`);
if (!champOk) process.exitCode = 1;
// 默认 minSample=MIN_LEGEND_SAMPLE(10):低于门槛的传奇不应进任何榜单
const defaultConvertTop = sortLegendaryRows(legs, 'convert');
const smallRows = legs.filter((r) => r.total < MIN_LEGEND_SAMPLE && r.total > 0);
const smallExcluded = smallRows.every((r) => !defaultConvertTop.some((t) => t.cardNo === r.cardNo));
console.log(`默认榜单 minSample=${MIN_LEGEND_SAMPLE}:低于门槛的传奇 ${smallRows.length} 个${smallExcluded ? ' ✓ 全部排除' : ' ✗ 仍有进榜'}`);
if (!smallExcluded) {
  console.error('✗ 默认最小数量门槛未生效');
  process.exitCode = 1;
}

/* ── 威尔逊区间验证(热度榜)── */
console.log('\n== 威尔逊区间(热度榜)==');
const w1 = wilsonLowerBound(50, 100); // p=50% n=100 → ≈0.4038
const w2 = wilsonLowerBound(5, 100); // p=5% n=100 → ≈0.0215
const w3 = wilsonLowerBound(100, 200); // p=50% n=200 → 应高于 w1(同占比、样本更大)
console.log(
  `wilson(50/100)=${(w1 * 100).toFixed(2)}% | wilson(5/100)=${(w2 * 100).toFixed(2)}% | wilson(100/200)=${(w3 * 100).toFixed(2)}%`
);
if (!(w3 > w1 && w1 > w2)) {
  console.error('✗ 威尔逊性质校验失败(同占比样本更大应更高;低样本应被拉低)');
  process.exitCode = 1;
} else {
  console.log('✓ 威尔逊性质校验通过');
}
console.log('-- 按威尔逊热度 Top5 --');
sortLegendaryRows(legs, 'wilson')
  .slice(0, 5)
  .forEach((r, i) =>
    console.log(`#${i + 1} ${r.name} n=${r.total} wilson=${r.wilson?.toFixed(2)}% pop=${r.popularity.toFixed(1)}%`)
  );
// 英雄热度同样换威尔逊:quickHeroRows 默认按威尔逊降序
const heroRows = quickHeroRows(result.allDecks, result.totalDecks);
console.log('-- 英雄热度 Top3(威尔逊排序)--');
heroRows.slice(0, 3).forEach((r) =>
  console.log(`${r.hero} n=${r.total} wilson=${r.wilson?.toFixed(2)}% pop=${r.popularity.toFixed(1)}%`)
);

/* ── 综合表现榜(metaScore)验证 ── */
console.log('\n== 综合表现榜(metaScore = 转化综合分 × log10(数量+10) × 名次权重)==');
const metaTop = sortLegendaryRows(legs, 'metaScore').slice(0, 5);
metaTop.forEach((r, i) =>
  console.log(
    `#${i + 1} ${r.name} n=${r.total} meta=${r.metaScore?.toFixed(1)} conv=${r.convert.toFixed(1)} avgRank=${r.avgRank?.toFixed(1)} Rw=${r.rankWeight?.toFixed(2)} pop=${r.popularity.toFixed(1)}%`
  )
);
const withRank = legs.filter((r) => r.rankWeight != null);
const rwOk = withRank.every((r) => r.rankWeight! >= 0.5 - 1e-9 && r.rankWeight! <= 1.5 + 1e-9);
const bestRank = withRank.reduce((a, b) =>
  (a.avgRank ?? Infinity) < (b.avgRank ?? Infinity) ? a : b
);
const rwMin = Math.min(...withRank.map((r) => r.rankWeight!));
const rwMax = Math.max(...withRank.map((r) => r.rankWeight!));
console.log(
  `名次权重范围 [${rwMin.toFixed(3)}, ${rwMax.toFixed(3)}] 界内 ${rwOk ? '✓' : '✗'} | 最优均名次 ${bestRank.name} avgRank=${bestRank.avgRank?.toFixed(1)} Rw=${bestRank.rankWeight?.toFixed(3)}`
);
if (!rwOk || bestRank.rankWeight! < 1) {
  console.error('✗ 名次权重异常(应在 [0.5,1.5],最优名次 ≥ 1)');
  process.exitCode = 1;
}
const metaSorted = metaTop.every(
  (r, i) => i === 0 || (metaTop[i - 1]!.metaScore ?? 0) >= (r.metaScore ?? 0)
);
console.log(`metaScore 排序单调性: ${metaSorted ? '✓' : '✗'}`);
if (!metaSorted) process.exitCode = 1;

/* ── 同名+副标题 归并验证(多稀有度卡号)── */
console.log('\n== 同名归并(规范键)==');
const mergedTotal = legs.reduce((s, r) => s + r.total, 0);
const multiVariant = legs.filter((r) => r.variants > 1);
console.log(`传奇种类(归并后):${legs.length} | 覆盖:${mergedTotal}/${result.totalDecks} | 多版本行:${multiVariant.length}`);
const kx = legs.find((r) => r.name === '虚空之女');
console.log(`虚空之女: cardNo=${kx?.cardNo} variants=${kx?.variants} n=${kx?.total} conv=${kx?.convert.toFixed(1)} (期望 variants=2, n=269)`);
if (!kx || kx.variants !== 2 || kx.total !== 269) {
  console.error('✗ 虚空之女 归并失败(期望 variants=2, n=269)');
  process.exitCode = 1;
} else {
  console.log('✓ 虚空之女 归并正确(OGN-247 + OGN-299 → 1 行)');
}
console.log(`globalAllCards 键数(规范键):${result.globalAllCards.size} | 目录卡号数:${result.catalog.byId.size}`);
// 符文剔除验证:全局携带统计中不应再出现任何「符文」类卡
let runeLeak = 0;
for (const [key] of result.globalAllCards) {
  const repId = result.catalog.canonicalId.get(key) ?? key;
  if (result.catalog.cardCategory.get(repId) === '符文') runeLeak += 1;
}
console.log(`符文泄漏到携带统计:${runeLeak} 个键 ${runeLeak === 0 ? '✓ 已剔除符文' : '✗ 符文未剔除'}`);
if (runeLeak > 0) process.exitCode = 1;

/* ── 卡图语言(SC 简体中文优先)验证 ── */
{
  const printRows = csv('card_prints_rows.csv');
  const firstImg = new Map<string, string>();
  const firstSC = new Map<string, string>();
  for (const p of printRows) {
    const no = String(p.card_no_extend ?? '').replace(/\*$/, '').trim();
    const img = String(p.img_cdn ?? '');
    if (!no || !img.startsWith('http')) continue;
    if (!firstImg.has(no)) firstImg.set(no, img);
    if (String(p.language ?? '').trim().toUpperCase() === 'SC' && !firstSC.has(no)) {
      firstSC.set(no, img);
    }
  }
  let mismatch = 0;
  for (const [no, img] of result.catalog.cardImg) {
    const expect = firstSC.get(no) ?? firstImg.get(no);
    if (expect && expect !== img) mismatch += 1;
  }
  console.log(`卡图 SC 优先:目录有图 ${result.catalog.cardImg.size} 编号,非 SC 首选 ${mismatch} 个 ${mismatch === 0 ? '✓' : '✗'}`);
  if (mismatch > 0) process.exitCode = 1;
}

/* ── 头条候选(转化综合分)验证 ── */
console.log('\n== 头条候选(转化综合分 = Top8率35% + Top4率35% + 冠军率20% + 亚军率10%)==');
const minSample = Math.max(10, Math.floor(result.totalDecks * 0.02));
const leadTop = sortLeadCandidates(legs, minSample).slice(0, 3);
leadTop.forEach((r, i) =>
  console.log(
    `#${i + 1} ${r.name}(${r.cardNo}) n=${r.total} conv=${r.convert.toFixed(2)} top8=${r.top8Rate.toFixed(1)}% top4=${r.top4Rate.toFixed(1)}% 冠=${r.champions}次(${r.championRate.toFixed(1)}%) 亚=${r.runnersUp}次(${r.runnerUpRate.toFixed(1)}%)`
  )
);
const scoreOk = leadTop.every(
  (r, i) => i === 0 || leadTop[i - 1]!.convert >= r.convert
);
console.log(`转化综合分单调性: ${scoreOk ? '✓' : '✗'} | 最小数量门槛: ${minSample}`);
if (!scoreOk || leadTop.length === 0) process.exitCode = 1;

/* ── 周环比引擎验证(包内按周分组,后两周对比)── */
console.log('\n== 周环比引擎 ==');
const byWeek = new Map<string, Deck[]>();
for (const d of result.allDecks) {
  const k = d.week.label || '未知';
  const arr = byWeek.get(k);
  if (arr) arr.push(d);
  else byWeek.set(k, [d]);
}
const weekLabels = [...byWeek.keys()].sort();
console.log('周次分布:', weekLabels.map((k) => `${k}=${byWeek.get(k)!.length}`).join(' | '));
const [prevL, currL] = weekLabels.slice(-2);
const prevDecks = byWeek.get(prevL)!;
const currDecks = byWeek.get(currL)!;

const prevHeroes = quickHeroRows(prevDecks, prevDecks.length);
const currHeroes = quickHeroRows(currDecks, currDecks.length);
const popItems = deltasFromRows(
  prevHeroes.map((r) => ({ key: r.hero, value: r.popularity, sample: r.total })),
  currHeroes.map((r) => ({ key: r.hero, value: r.popularity, sample: r.total }))
);
const convertItems = deltasFromRows(
  prevHeroes.map((r) => ({ key: r.hero, value: r.convert, sample: r.total })),
  currHeroes.map((r) => ({ key: r.hero, value: r.convert, sample: r.total }))
);
console.log(`对比期间:${prevL}(${prevDecks.length} 套) → ${currL}(${currDecks.length} 套)`);
console.log('-- 热度上升 Top4 --');
movers(popItems, { direction: 'up', topN: 4 }).forEach((it) =>
  console.log(`▲ ${it.key}: ${it.prev?.toFixed(1)}% → ${it.curr?.toFixed(1)}% (Δ${it.delta?.toFixed(1)}pp, 名次 ${it.prevRank}→${it.currRank})`)
);
console.log('-- 热度下降 Top4 --');
movers(popItems, { direction: 'down', topN: 4 }).forEach((it) =>
  console.log(`▼ ${it.key}: ${it.prev?.toFixed(1)}% → ${it.curr?.toFixed(1)}% (Δ${it.delta?.toFixed(1)}pp, 名次 ${it.prevRank}→${it.currRank})`)
);
console.log('-- 转化变化 Top3 --');
movers(convertItems, { topN: 3 }).forEach((it) =>
  console.log(`${it.delta! > 0 ? '▲' : '▼'} ${it.key}: 转化 ${it.prev?.toFixed(1)} → ${it.curr?.toFixed(1)} (Δ${it.delta?.toFixed(1)})`)
);
const hhiPrev = hhi(prevHeroes.map((r) => ({ rate: r.popularity })));
const hhiCurr = hhi(currHeroes.map((r) => ({ rate: r.popularity })));
console.log(`HHI:${hhiPrev.toFixed(0)} → ${hhiCurr.toFixed(0)}`);

/* ── 周报引擎 + Markdown 验证 ── */
console.log('\n== 周报引擎(buildWeeklyReport)==');
const rep = buildWeeklyReport(result.allDecks, result.catalog);
if (!rep) {
  console.error('✗ 周报引擎返回 null(周次不足)');
  process.exitCode = 1;
} else {
  console.log(`期间:${rep.prevLabel} → ${rep.currLabel} | 数量 ${rep.prevSample}→${rep.currSample} | HHI ${rep.hhiCurr.toFixed(0)}`);
  console.log('时间线周次:', rep.weeks.map((w) => w.label).join(' | '));
  console.log('Top 时间线英雄:', rep.heroTimeline.slice(0, 3).map((h) => `${h.hero}[${h.pickRates.map((v) => (v == null ? '—' : v.toFixed(1))).join(',')}]`).join(' '));
  console.log('传奇 movers Top3:', rep.legMovers.slice(0, 3).map((it) => `${it.key}${it.delta! > 0 ? '+' : ''}${it.delta?.toFixed(1)}pp`).join(' | '));
  console.log('域对 movers Top3:', rep.domainMovers.slice(0, 3).map((it) => `${it.key}${it.delta! > 0 ? '+' : ''}${it.delta?.toFixed(1)}pp`).join(' | '));

  const md = reportToMarkdown(rep);
  const mdLines = md.split('\n');
  console.log('\n-- Markdown 预览(前 14 行) --');
  console.log(mdLines.slice(0, 14).join('\n'));
  const checks: [string, boolean][] = [
    [`标题含当期周次 ${rep.currLabel}`, md.includes(`# 符文战场 Meta 报告 · ${rep.currLabel}`)],
    ['含热度上升榜', md.includes('## 热度上升')],
    ['含转化变化榜', md.includes('## 转化变化')],
    ['含传奇热度', md.includes('## 传奇热度')],
    ['含域对热度', md.includes('## 域对热度')],
    ['不含任何胜率字样', !md.includes('胜率')],
    ['含免责声明', md.includes('Riot Games 与本工具无关')]
  ];
  let ok = true;
  for (const [name, pass] of checks) {
    if (!pass) ok = false;
    console.log(`${pass ? '✓' : '✗'} ${name}`);
  }
  if (!ok) process.exitCode = 1;
}
