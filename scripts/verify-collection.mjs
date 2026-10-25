/* ================================================================
 * scripts/verify-collection.mjs
 *
 * 卡池纯逻辑回归:key 归一、数量夹取、快照往返、版本判定、
 * 持有索引、缺卡清单(按印版精确 + 同语言其它印版提示)、本机缓存。
 * 不依赖浏览器 —— 直接跑 src/tools/collection/*.ts 的纯函数。
 *   node --experimental-strip-types --import ./scripts/register-hooks.mjs scripts/verify-collection.mjs
 * ================================================================ */
import {
  buildHeldIndex,
  clampQuantity,
  COLLECTION_VERSIONS,
  collectionKey,
  countEntries,
  deckHolding,
  entriesFromRows,
  entriesFromSnapshot,
  heldOfBase,
  heldOfBaseLanguage,
  heldOfPrint,
  languageLabel,
  languageRank,
  printVersion,
  toSnapshot,
  totalQuantity,
} from '@/tools/collection/model';
import { readCache, readUi, writeCache, writeUi } from '@/tools/collection/storage';
import { buildCollectionItems, collectionAxes, collectionFacets, sortItems } from '@/tools/collection/query';
import { buildCarddexData } from '@/components/carddex/data';
import { readFileSync } from 'node:fs';
import Papa from 'papaparse';

let pass = 0;
let fail = 0;
function check(label, ok, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${label}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/* Node 里没有 localStorage:补一个内存版,供 storage.ts 的 window.localStorage 路径使用。 */
const bucket = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => (bucket.has(key) ? bucket.get(key) : null),
    setItem: (key, value) => bucket.set(key, String(value)),
    removeItem: (key) => bucket.delete(key),
  },
};

const print = (cardNo, language, extendedRarity = '平卡') => ({ cardNo, language, extendedRarity });
const record = (cardNo, nameCn, prints) => ({
  base: { cardNo, nameCn, nameEn: '', series: 'ARC' },
  prints,
});
const records = [
  record('ARC-001', '测试一', [
    print('ARC-001', 'SC'),
    print('ARC-001', 'EN'),
    print('ARC-001a', 'SC', '异画'),
    print('ARC-001b', 'SC', '超编'),
  ]),
  record('UNL-233*', '测试二', [print('UNL-233*', 'SC')]),
];

console.log('== 1. key 归一 ==');
check('cardNo 去空格大写 + 语言大写', collectionKey(' arc-001a ', 'sc') === 'ARC-001A\u0000SC');
check('星号印本保持原样,不折成 S', collectionKey('UNL-233*', 'SC') !== collectionKey('UNL-233S', 'SC'));

console.log('\n== 2. 数量夹取 ==');
check('负数视为 0(0 表示删行)', clampQuantity(-5) === 0);
check('0 保持 0', clampQuantity(0) === 0);
check('超过 999 夹到 999', clampQuantity(1200) === 999);
check('正常值原样', clampQuantity(3) === 3);

console.log('\n== 3. 行 → 集合 → 快照 ==');
const map = entriesFromRows([
  { card_no: 'ARC-001', language: 'SC', quantity: 2, updated_at: '2026-10-26T00:00:00Z' },
  { card_no: 'ARC-001a', language: 'SC', quantity: 1 },
]);
check('两行两条记录', map.size === 2 && countEntries(map) === 2, String(map.size));
check('总持有数', totalQuantity(map) === 3, String(totalQuantity(map)));
const snapshot = toSnapshot(map);
check('快照按 key 排序', snapshot[0].cardNo === 'ARC-001' && snapshot[1].cardNo === 'ARC-001a');
const restored = entriesFromSnapshot(snapshot);
check('快照往返一致', restored.size === 2 && totalQuantity(restored) === 3);

console.log('\n== 4. 版本与语言 ==');
check('版本四值固定', COLLECTION_VERSIONS.join('/') === '平卡/异画/超编/签名超编');
check('平卡', printVersion(print('X-1', 'SC')) === '平卡');
check('异画', printVersion(print('X-1a', 'SC', '异画')) === '异画');
check('超编', printVersion(print('X-1b', 'SC', '超编')) === '超编');
check('签名超编优先于超编', printVersion(print('X-1c', 'SC', '签名超编')) === '签名超编');
check('语言标签', languageLabel('SC') === '简中' && languageLabel('EN') === '英文' && languageLabel('XX') === 'XX');
check('语言排序 简中在前', languageRank('SC') < languageRank('EN'));

console.log('\n== 5. 持有索引 ==');
const held = buildHeldIndex(
  entriesFromRows([
    { card_no: 'ARC-001a', language: 'SC', quantity: 1 },
    { card_no: 'ARC-001b', language: 'SC', quantity: 2 },
    { card_no: 'ARC-001', language: 'EN', quantity: 5 },
  ]),
  records,
);
check('按印版读:ARC-001a/SC = 1', heldOfPrint(held, 'ARC-001a', 'SC') === 1);
check('按印版读:大小写不敏感', heldOfPrint(held, 'arc-001a', 'sc') === 1);
check('按基础卡汇总 = 8', heldOfBase(held, 'ARC-001') === 8, String(heldOfBase(held, 'ARC-001')));
check('同卡同语言 = 3(不含英文)', heldOfBaseLanguage(held, 'ARC-001', 'SC') === 3);
check('星号印本可查', heldOfPrint(held, 'UNL-233*', 'SC') === 0);

console.log('\n== 6. 缺卡清单按印版精确 ==');
const deck = {
  zones: {
    main: [{ cardNo: 'ARC-001', printNo: 'ARC-001a', language: 'SC', quantity: 3, name: '测试一' }],
    side: [{ cardNo: 'ARC-001', printNo: 'ARC-001', language: 'EN', quantity: 2, name: '测试一' }],
  },
};
const summary = deckHolding(deck, records, held);
check('总需求 5', summary.total === 5, String(summary.total));
check('已有 3(1 张异画 + 2 张英文平卡)', summary.owned === 3, String(summary.owned));
check('缺 2', summary.missing === 2, String(summary.missing));
check('清单只有主牌堆一行', summary.shortfall.length === 1, JSON.stringify(summary.shortfall));
const row = summary.shortfall[0] ?? {};
check('缺卡行:需 3 / 持 1 / 缺 2', row.need === 3 && row.have === 1 && row.missing === 2, JSON.stringify(row));
check('提示同卡同语言其它印版另有 2 张', row.alternative === 2, String(row.alternative));
check('清单行带分区与条目 key', row.zone === 'main' && typeof row.key === 'string' && row.key.includes('ARC-001A'));

console.log('\n== 7. 本机缓存 ==');
const owner = '11111111-1111-4111-8111-111111111111';
writeCache(owner, map, '2026-10-26T04:20:00.000Z', entriesFromRows([{ card_no: 'ARC-001', language: 'EN', quantity: 4 }]));
const cache = readCache(owner);
check('缓存可读回', cache !== null && cache.entries.length === 2);
check('其它账号读不到', readCache('22222222-2222-4222-8222-222222222222') === null);
check('待保存项一并存下', cache.pending.length === 1 && cache.pending[0].quantity === 4);
bucket.set('rune.collection.v1', '{坏掉');
check('坏数据静默丢弃', readCache(owner) === null);

writeUi({ ...readUi(), view: 'all' });
check('默认视图是「我有的」', readUi().view === 'all');
check('UI 默认排序 default', readUi().sort === 'default');

console.log('\n== 8. 真实卡表数据通路 ==');
const csv = (file) => Papa.parse(readFileSync(file, 'utf8'), { header: true, skipEmptyLines: true }).data;
const baseRows = csv('public/data/cards_base_rows.csv');
const printRows = csv('public/data/card_prints_rows.csv');
const liveRecords = buildCarddexData(baseRows, printRows, [], [], []).records;
check('卡表装载出基础卡与印本', liveRecords.length > 500 && printRows.length > 2200, `${liveRecords.length} / ${printRows.length}`);
const liveAxes = collectionAxes(liveRecords);
check('语言轴来自卡表本身(简中/英文)', liveAxes.languages.includes('SC') && liveAxes.languages.includes('EN'), liveAxes.languages.join(','));
check('版本轴恰为四值', liveAxes.versions.length === 4 && liveAxes.versions.every((v) => COLLECTION_VERSIONS.includes(v)), liveAxes.versions.join(','));
const liveFacets = collectionFacets(liveRecords);
check('分面选项与数值边界非空', Object.values(liveFacets.options).every((list) => list.length > 0) && liveFacets.bounds.energy.max > 0);
const numeric = { energy: { min: 0, max: 99 }, returnEnergy: { min: 0, max: 99 }, power: { min: 0, max: 99 } };
const query = (overrides = {}) => ({
  search: '', view: 'all', sort: 'default', filters: [], numeric,
  languages: [], versions: [], ...overrides,
});
const seedNo = printRows[0].card_no_extend;
const seedLanguage = printRows[0].language;
const liveEntries = entriesFromRows([
  { card_no: seedNo, language: seedLanguage, quantity: 2 },
  { card_no: printRows[1].card_no_extend, language: printRows[1].language, quantity: 1 },
]);
const allItems = buildCollectionItems(liveRecords, query(), liveEntries);
check('全部卡:每个印本单独一格', allItems.length === printRows.length, `${allItems.length} vs ${printRows.length}`);
check('每格都带 print(能按印本记账)', allItems.every((item) => item.print && item.print.cardNo && item.print.language));
const ownedItems = buildCollectionItems(liveRecords, query({ view: 'owned' }), liveEntries);
check('我有的:只留持有过的印本', ownedItems.length === 2 && ownedItems.every((item) => item.quantity > 0), ownedItems.map((i) => `${i.print.cardNo}/${i.print.language}:${i.quantity}`).join(' '));
const searched = buildCollectionItems(liveRecords, query({ search: seedNo }), liveEntries);
check('搜索按印本号命中并回带数量', searched.some((item) => item.print.cardNo === seedNo && item.quantity === 2));
const sortedByQuantity = sortItems(ownedItems, 'quantity');
check('按持有数量排序:多的在前', sortedByQuantity[0].quantity === 2, String(sortedByQuantity[0].quantity));

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
