/* ================================================================
 * scripts/verify-carddex-query.mjs
 *
 * 卡牌搜索查询逻辑验收（无网络、无数据库）：
 *   - 系列筛选按模式区分：按卡牌只认 cards_base.series_name，
 *     按印本才看每个 card_prints.series
 *   - 按印本模式：同一 card_no_extend 的多语言只出一张 tile，SC 优先
 *   - 系列 facet 选项随模式切换
 *   - 回归：按卡牌模式下稀有度等其他 facet 仍按可命中印本的并集
 *
 *   node --experimental-strip-types --import ./scripts/register-hooks.mjs scripts/verify-carddex-query.mjs
 * ================================================================ */
import assert from 'node:assert/strict';
import { buildDisplayCards, facetOptions } from '../src/components/carddex/query.ts';

let passed = 0;
function test(label, fn) {
  try { fn(); } catch (e) { console.error(`✗ ${label}\n  ${e.message}`); process.exitCode = 1; return; }
  passed++;
  console.log(`✓ ${label}`);
}

function base(over = {}) {
  return {
    id: 'base-1', cardNo: 'SFD-176', nameCn: '赵信', nameEn: 'Xin Zhao',
    nameKr: '', nameTw: '', subtitleCn: '', subtitleEn: '', subtitleKr: '', subtitleTw: '',
    colors: [], regions: [], tags: [], keywords: [], advancedTags: [],
    championTag: '', effectCn: '', effectEn: '', effectKr: '', effectTw: '',
    energy: 0, returnEnergy: 0, power: 0, rarity: '稀有', series: 'SFD',
    flavorCn: '', flavorEn: '', banned: false, categories: ['英雄单位'], deckLimit: null,
    ...over,
  };
}

function print(over = {}) {
  return {
    id: 'print-1', cardId: 'base-1', cardNo: 'SFD-176', rarity: '稀有',
    extendedRarity: '平卡', language: 'SC', imageUrl: '', ttsUrl: '', artist: '',
    printOrder: 0, isDefault: false, isPromo: false, series: 'SFD',
    flavorCn: '', flavorEn: '', ...over,
  };
}

function state(over = {}) {
  return {
    search: '', mode: 'base', banned: 'hide', filters: [],
    numeric: {
      energy: { min: 0, max: 99 },
      returnEnergy: { min: 0, max: 99 },
      power: { min: 0, max: 99 },
    },
    sort: [{ id: 'default-card-no', field: 'cardNo', asc: true }],
    ...over,
  };
}

const seriesFilter = (value) => ({ type: 'series', value, mode: 'include' });

// SFD 基础卡：SC/EN 平卡 + 一张 T1S-002 异画印本
const sfBase = base();
const sfPrints = [
  print({ id: 'p-sc', cardNo: 'SFD-176', language: 'SC', series: 'SFD' }),
  print({ id: 'p-en', cardNo: 'SFD-176', language: 'EN', series: 'SFD' }),
  print({
    id: 'p-t1s', cardNo: 'T1S-002', language: 'SC', series: 'T1S',
    rarity: '异画', extendedRarity: '异画', isPromo: true,
  }),
];
const record = { base: sfBase, prints: sfPrints };

test('按卡牌模式：系列筛选只看基础卡系列（T1S 印本不算数）', () => {
  const out = buildDisplayCards([record], state({ filters: [seriesFilter('T1S')] }));
  assert.equal(out.length, 0);
});

test('按卡牌模式：系列筛选命中基础卡系列', () => {
  const out = buildDisplayCards([record], state({ filters: [seriesFilter('SFD')] }));
  assert.equal(out.length, 1);
  assert.equal(out[0].print.cardNo, 'SFD-176');
});

test('按印本模式：系列筛选命中对应印本系列', () => {
  const out = buildDisplayCards([record], state({ mode: 'print', filters: [seriesFilter('T1S')] }));
  assert.equal(out.length, 1);
  assert.equal(out[0].print.cardNo, 'T1S-002');
});

test('按印本模式：同编号多语言只出一张 tile，语言取 SC', () => {
  const out = buildDisplayCards([record], state({ mode: 'print' }));
  assert.deepEqual(out.map((i) => i.print.cardNo).sort(), ['SFD-176', 'T1S-002']);
  const p176 = out.find((i) => i.print.cardNo === 'SFD-176');
  assert.equal(p176.print.language, 'SC');
});

test('按印本模式：SC 优先于 is_default 的其他语言', () => {
  const r = {
    base: base(),
    prints: [
      print({ id: 'en', cardNo: 'OGN-001', language: 'EN', isDefault: true }),
      print({ id: 'sc', cardNo: 'OGN-001', language: 'SC', isDefault: false }),
    ],
  };
  const out = buildDisplayCards([r], state({ mode: 'print' }));
  assert.equal(out.length, 1);
  assert.equal(out[0].print.language, 'SC');
});

test('按印本模式：无 SC 时回退 is_default → 其他语言', () => {
  const r = {
    base: base(),
    prints: [
      print({ id: 'kr', cardNo: 'VEN-001', language: 'KR', isDefault: false }),
      print({ id: 'en', cardNo: 'VEN-001', language: 'EN', isDefault: true }),
    ],
  };
  const out = buildDisplayCards([r], state({ mode: 'print' }));
  assert.equal(out.length, 1);
  assert.equal(out[0].print.language, 'EN');
});

test('系列 facet 选项随模式切换', () => {
  assert.deepEqual(facetOptions([record], 'base').series, ['SFD']);
  assert.deepEqual(facetOptions([record], 'print').series, ['SFD', 'T1S']);
});

test('回归：按卡牌模式稀有度仍按印本并集命中，并展示命中的异画印本', () => {
  const out = buildDisplayCards([record], state({
    filters: [{ type: 'rarity', value: '异画', mode: 'include' }],
  }));
  assert.equal(out.length, 1);
  assert.equal(out[0].print.cardNo, 'T1S-002');
});

test('回归：按卡牌模式搜索印本编号仍能命中基础卡', () => {
  const out = buildDisplayCards([record], state({ search: 'T1S-002' }));
  assert.equal(out.length, 1);
  assert.equal(out[0].base.id, sfBase.id);
});

test('回归：禁用/禁卡模式与印本展开互不干扰', () => {
  const banned = { base: base({ banned: true, id: 'base-banned' }), prints: [print({ cardId: 'base-banned' })] };
  assert.equal(buildDisplayCards([banned], state()).length, 0);
  assert.equal(buildDisplayCards([banned], state({ mode: 'print' })).length, 0);
  assert.equal(buildDisplayCards([banned], state({ banned: 'only' })).length, 1);
});

console.log(`\n${passed} passed`);
