/** Offline regression checks: no real database writes or credentials needed. */
import assert from 'node:assert/strict';
import { normalizeCardNo, buildCardsBase, buildPrintFromSearch } from '../src/tools/sync/normalize.ts';
import { createReview, reviewState, buildOperation, reviewSql, reviewCsv, equivalent, identity, printIdentity } from '../src/tools/sync/review.ts';
import {
  allFieldsSelected, applyFieldSelection, clearFieldSelection, fieldSelectionPlan, selectableFields, selectedFieldCount
} from '../src/tools/sync/fieldSelection.ts';
import { executeOperation } from '../src/tools/sync/write.ts';
import { indexExisting, indexDrafts } from '../src/tools/sync/reviewIndex.ts';
import { DEFAULT_FETCH_POLICY, fetchDataset } from '../src/tools/sync/run.ts';
import {
  MAX_PACER_GAP_MS, SEARCH_PAGE_SIZE, createRequestPacer, parseRetryAfterMs, randomGapMs, searchAllCards
} from '../src/tools/sync/riftboundApi.ts';

let passed = 0;
function test(label, fn) { fn(); passed++; console.log(`✓ ${label}`); }
const detail = { cardNo: 'ARC·001a·SC', cardName: '蔚', subTitle: '铲除者', cardEffect: '原效果',
  errata: '', attachEffect: '装配效果', craftList: [], cardColorList: ['red'], cardCategoryNameList: ['单位'], energy: 0 };
const base = buildCardsBase(detail, false);
const print = buildPrintFromSearch({ ...detail, frontImage: 'new.png', backImage: 'never.png', artist: '新画师', rarityName: '异画' }, 'ARC');
const dataset = (cards = [base], prints = [print]) => ({ cards, prints, icons: [], seriesPresets: [] });
const existing = (cards = [], prints = []) => ({ cards, prints, icons: [], seriesCodes: ['ARC'], seriesByPrefix: { ARC: 'ARC' } });
const oldBase = { ...base, id: 'base-1', card_no: 'OGN-036', effect_cn: '库内效果', energy: 9 };
const oldPrint = { ...print, id: 'print-1', card_id: 'base-1', img_cdn: 'old.png', artist: '旧画师', back_image: 'preserve.png' };

test('快速/深度拉取都默认单并发与慢节奏随机间隔', () => {
  assert.deepEqual(DEFAULT_FETCH_POLICY.fast, { concurrency: 1, minGapMs: 400, maxGapMs: 900 });
  assert.deepEqual(DEFAULT_FETCH_POLICY.deep, { concurrency: 1, minGapMs: 800, maxGapMs: 1600 });
  assert.equal(randomGapMs(400, 900, () => 0), 400);
  assert.equal(randomGapMs(400, 900, () => 1), 900);
  assert.equal(randomGapMs(800, 1600, () => 0), 800);
  assert.equal(randomGapMs(800, 1600, () => 1), 1600);
});
test('节流器可被重试自动降速，并有间隔上限', () => {
  const pacer = createRequestPacer(100, 200);
  assert.deepEqual(pacer.gapRange(), { min: 100, max: 200 });
  pacer.slowDown();
  assert.deepEqual(pacer.gapRange(), { min: 200, max: 400 });
  pacer.slowDown(1.5);
  assert.deepEqual(pacer.gapRange(), { min: 300, max: 600 });
  pacer.slowDown(100);
  assert.deepEqual(pacer.gapRange(), { min: MAX_PACER_GAP_MS, max: MAX_PACER_GAP_MS });
  const zero = createRequestPacer(0, 0);
  zero.slowDown();
  assert.deepEqual(zero.gapRange(), { min: 0, max: 0 }, '测试用零间隔不应被降速放大');
});
test('Retry-After 同时支持秒数和 HTTP 日期', () => {
  const now = Date.UTC(2026, 8, 23, 0, 0, 0);
  assert.equal(parseRetryAfterMs('3', now), 3000);
  assert.equal(parseRetryAfterMs(new Date(now + 4000).toUTCString(), now), 4000);
  assert.equal(parseRetryAfterMs('invalid', now), null);
});

test('编号保留版本后缀，拆出语言、总数和促销标记', () => {
  for (const text of ['ARC-001a-SC', 'ARC·001a·SC', 'ARC.001a.SC']) assert.deepEqual(normalizeCardNo(text), { extend: 'ARC-001a', language: 'SC', isPromo: false, error: undefined });
  assert.equal(normalizeCardNo('OGN·001/298·P·SC').extend, 'OGN-001');
  assert.equal(normalizeCardNo('OGN·001/298·P·SC').isPromo, true);
  assert.equal(normalizeCardNo('UNL·R03').extend, 'UNL-R03');
  assert.equal(normalizeCardNo('ARC-001-EN').language, 'EN');
  assert.ok(normalizeCardNo('ARC-001-XX').error);
});
test('按名字副标题关联已有基础卡，不按印刷编号新增', () => {
  const rows = createReview(dataset()); const ex = existing([oldBase]);
  assert.equal(reviewState(rows[0], rows, ex).kind, 'same');
  const op = buildOperation(rows[1], rows, ex);
  assert.equal(op.payload.card_id, 'base-1');
  assert.equal(op.payload.card_no_extend, 'ARC-001a');
  assert.ok(!('back_image' in op.payload));
});
test('无 errata 不更新基础卡任何字段', () => {
  const rows = createReview(dataset()); rows[0].selected = ['effect_cn', 'energy'];
  assert.equal(buildOperation(rows[0], rows, existing([oldBase])), null);
});
test('勘误更新只发送勾选的 effect_cn，并保留装配效果', () => {
  const corrected = buildCardsBase({ ...detail, errata: '勘误效果' }, false);
  const rows = createReview(dataset([corrected])); const ex = existing([oldBase]);
  assert.equal(buildOperation(rows[0], rows, ex), null);
  rows[0].selected = ['effect_cn', 'energy'];
  assert.deepEqual(buildOperation(rows[0], rows, ex).payload, { effect_cn: '勘误效果\n装配效果' });
});
test('换行格式和空副标题不产生伪差异', () => {
  assert.ok(equivalent('一\r\n二 ', '一\n二'));
  const rows = createReview(dataset([{ ...base, sub_title_cn: '' }], []));
  assert.equal(reviewState(rows[0], rows, existing([{ ...oldBase, sub_title_cn: null }])).kind, 'same');
});
test('重复基础卡必须手选，关联变更也需要勾选 card_id', () => {
  const rows = createReview(dataset()); const ex = existing([oldBase, { ...oldBase, id: 'base-2' }], [oldPrint]);
  assert.equal(reviewState(rows[1], rows, ex).kind, 'blocked');
  assert.throws(() => buildOperation(rows[1], rows, ex));
  rows[0].chosenBaseId = 'base-2';
  rows[1].selected = ['artist'];
  assert.deepEqual(buildOperation(rows[1], rows, ex).payload, { artist: '新画师' });
  rows[1].selected = ['card_id'];
  assert.deepEqual(buildOperation(rows[1], rows, ex).payload, { card_id: 'base-2' });
});
test('同名多印刷只生成一个新基础卡，必须分两次提交', () => {
  const rows = createReview(dataset([base, { ...base, card_no: 'ALT-001' }], [print, { ...print, card_no_extend: 'ALT-001' }]));
  const ex = existing();
  assert.equal(rows.filter((r) => r.table === 'cards_base').length, 1);
  assert.equal(buildOperation(rows[0], rows, ex).kind, 'insert');
  assert.equal(reviewState(rows[1], rows, ex).kind, 'blocked');
  ex.cards.push({ ...rows[0].draft, id: 'created-base' });
  assert.equal(buildOperation(rows[1], rows, ex).payload.card_id, 'created-base');
  assert.equal(buildOperation(rows[2], rows, ex).payload.card_id, 'created-base');
});
test('缺详情、编号占用、多个勘误来源都会阻止基础卡提交', () => {
  let rows = createReview(dataset([{ ...base, sync_detail_complete: false }]));
  assert.equal(reviewState(rows[0], rows, existing()).kind, 'blocked');
  rows = createReview(dataset());
  assert.equal(reviewState(rows[0], rows, existing([{ ...oldBase, card_no: base.card_no, card_name_cn: '其他卡' }])).kind, 'blocked');
  rows = createReview(dataset([{ ...base, sync_errata: 'A' }, { ...base, effect_cn: 'B', sync_errata: 'B' }]));
  assert.equal(reviewState(rows[0], rows, existing([oldBase])).kind, 'blocked');
});
test('背面图不参与差异，即使勾选伪造字段也不会进入 payload', () => {
  const rows = createReview(dataset()); const ex = existing([oldBase], [{ ...print, id: 'p1', card_id: 'base-1', back_image: 'different' }]);
  assert.equal(reviewState(rows[1], rows, ex).kind, 'same');
  rows[1].selected = ['back_image'];
  assert.equal(buildOperation(rows[1], rows, ex), null);
});
test('库内点号编号能匹配，新语言不会覆盖 SC 版本', () => {
  const rows = createReview(dataset());
  assert.equal(reviewState(rows[1], rows, existing([oldBase], [{ ...oldPrint, card_no_extend: 'ARC·001a' }])).kind, 'update');
  assert.equal(reviewState(rows[1], rows, existing([oldBase], [{ ...oldPrint, language: 'EN' }])).kind, 'new');
});
test('索引与逐行扫描的匹配、冲突、字段勾选结果完全一致', () => {
  const corrected = buildCardsBase({ ...detail, errata: '新勘误' }, false);
  const scenarios = [
    existing(),
    existing([oldBase], [oldPrint]),
    existing([oldBase, { ...oldBase, id: 'base-2' }], [oldPrint]),
    existing([oldBase], [oldPrint, { ...oldPrint, id: 'print-2' }]),
    existing([oldBase], [{ ...oldPrint, card_no_extend: 'ARC·001a' }])
  ];
  let compared = 0;
  for (const ex of scenarios) {
    const rows = createReview(dataset([corrected]));
    const index = { ...indexExisting(ex), ...indexDrafts(rows) };
    for (const row of rows) {
      assert.deepEqual(reviewState(row, rows, ex, index), reviewState(row, rows, ex), `索引状态应与扫描一致：${row.key}`);
      compared++;
      if (reviewState(row, rows, ex).kind !== 'blocked') {
        row.selected = ['artist', 'effect_cn'];
        assert.deepEqual(buildOperation(row, rows, ex, index), buildOperation(row, rows, ex), `索引操作应与扫描一致：${row.key}`);
      }
    }
  }
  assert.ok(compared >= 10, `必须真的比较过足够多的记录，否则此测试会空跑（实际 ${compared}）`);
});
test('索引确实参与判断：篡改索引必须改变结论', () => {
  // Guards the test above from silently passing because both paths run the same code.
  const rows = createReview(dataset()); const ex = existing([oldBase], [oldPrint]);
  const honest = { ...indexExisting(ex), ...indexDrafts(rows) };
  const scanned = reviewState(rows[1], rows, ex);
  assert.deepEqual(reviewState(rows[1], rows, ex, honest), scanned);
  assert.equal(scanned.kind, 'update');
  assert.equal(scanned.parentId, 'base-1');
  const emptied = { ...honest, bases: new Map(), prints: new Map(), baseNumbers: new Set(), icons: new Map(), series: new Set(), rows: new Map(), baseCounts: new Map(), printCounts: new Map() };
  const mutated = reviewState(rows[1], rows, ex, emptied);
  assert.notDeepEqual(mutated, scanned, '索引被清空后结果必须变化，否则索引根本没被使用');
  assert.equal(mutated.kind, 'blocked');
  assert.equal(mutated.parentId, undefined);
  assert.equal(reviewState(rows[0], rows, ex, emptied).kind, 'new');
});
test('索引覆盖草稿冲突、编号占用与 series 主键', () => {
  const withIndex = (rows, ex) => ({ rows, ex, index: { ...indexExisting(ex), ...indexDrafts(rows) } });
  // 同名同副标题的两个草稿必须互相阻止（走 baseCounts）。createReview 会把同身份的官方卡
  // 归并成一行，所以这里模拟用户在编辑面板里把两条草稿改成同名。
  const twinRows = createReview(dataset([base, { ...base, card_no: 'ALT-001', card_name_cn: '另一张' }], []));
  assert.equal(twinRows.filter((r) => r.table === 'cards_base').length, 2);
  twinRows[1].draft.card_name_cn = base.card_name_cn;
  twinRows[1].draft.sub_title_cn = base.sub_title_cn;
  const twin = withIndex(twinRows, existing());
  assert.equal(twin.index.baseCounts.get(identity(base.card_name_cn, base.sub_title_cn)), 2);
  assert.equal(reviewState(twin.rows[0], twin.rows, twin.ex, twin.index).reason, '另一个草稿使用了相同名字和副标题，请先处理该草稿');
  assert.equal(reviewState(twin.rows[1], twin.rows, twin.ex, twin.index).reason, '另一个草稿使用了相同名字和副标题，请先处理该草稿');
  // 相同原始印刷编号＋语言的两个草稿必须互相阻止（走 printCounts；父卡需先能解析，否则先报等待基础卡）。
  const dup = withIndex(createReview(dataset([base], [print, { ...print, card_no_extend: 'ARC-001a' }])), existing([oldBase], []));
  assert.equal(dup.index.printCounts.get(printIdentity('ARC-001a', 'SC')), 2);
  assert.equal(reviewState(dup.rows[1], dup.rows, dup.ex, dup.index).reason, '另一个草稿使用了相同印刷编号和语言');
  assert.equal(reviewState(dup.rows[2], dup.rows, dup.ex, dup.index).reason, '另一个草稿使用了相同印刷编号和语言');
  // baseNumbers 阻止新增时占用已存在的 card_no。
  const occupied = withIndex(createReview(dataset()), existing([{ ...oldBase, card_no: base.card_no, card_name_cn: '其他卡' }]));
  assert.ok(occupied.index.baseNumbers.has(base.card_no));
  assert.equal(reviewState(occupied.rows[0], occupied.rows, occupied.ex, occupied.index).reason, '基础编号已被另一张卡占用，请修改新增编号');
  // series 走 Set，icons 走首个匹配（与 find 一致）。
  const seriesRows = createReview({ cards: [], prints: [], icons: [], seriesPresets: [{ code: 'ARC', name_cn: '起源' }] });
  const seriesIndex = { ...indexExisting(existing()), ...indexDrafts(seriesRows) };
  assert.equal(reviewState(seriesRows[0], seriesRows, existing(), seriesIndex).kind, 'same');
  const iconRows = createReview({ cards: [], prints: [], icons: [{ name_zh: '急速', url: 'new.png', storage_type: 'cdn', isWhite: false }], seriesPresets: [] });
  const iconEx = { cards: [], prints: [], icons: [{ id: 'i1', name_zh: '急速', url: 'old.png' }, { id: 'i2', name_zh: '急速', url: 'other.png' }], seriesCodes: [], seriesByPrefix: {} };
  const iconIndex = { ...indexExisting(iconEx), ...indexDrafts(iconRows) };
  assert.equal(iconIndex.icons.get('急速').id, 'i1', '重复图标必须取第一条，与 find 一致');
  assert.equal(reviewState(iconRows[0], iconRows, iconEx, iconIndex).before.id, 'i1');
  assert.equal(reviewState(iconRows[0], iconRows, iconEx, iconIndex).kind, 'update');
});
test('整库规模下索引保持线性：2400 条记录的状态计算不超时', () => {
  const cards = Array.from({ length: 900 }, (_, i) => ({ ...base, card_no: `BASE-${String(i + 1).padStart(3, '0')}`, card_name_cn: `性能卡${i}`, sub_title_cn: null }));
  const prints = Array.from({ length: 1500 }, (_, i) => ({ ...print, card_no_extend: `ARC-${String(i + 1).padStart(4, '0')}` }));
  const ds = { cards, prints, icons: [], seriesPresets: [] };
  const rows = createReview(ds);
  assert.equal(rows.length, 2400);
  const ex = {
    cards: cards.map((c, i) => ({ ...c, id: `base-${i}` })),
    prints: prints.map((p, i) => ({ ...p, id: `print-${i}`, card_id: `base-${i % 900}` })),
    icons: [], seriesCodes: ['ARC'], seriesByPrefix: { ARC: 'ARC' }
  };
  const index = { ...indexExisting(ex), ...indexDrafts(rows) };
  const start = performance.now();
  for (let pass = 0; pass < 3; pass++) for (const row of rows) reviewState(row, rows, ex, index);
  const ms = performance.now() - start;
  assert.ok(ms < 2000, `索引路径应远快于全量扫描：2400 条 ×3 用时 ${Math.round(ms)} ms`);
  // 同一批数据在没有索引时必须明显更慢，证明索引确实省掉了扫描。
  const scanStart = performance.now();
  for (const row of rows.slice(0, 60)) reviewState(row, rows, ex);
  const scanMs = performance.now() - scanStart;
  assert.ok(scanMs > ms / 20, `无索引的扫描路径应当明显更慢（索引 ${Math.round(ms)} ms / 60 条扫描 ${Math.round(scanMs)} ms）`);
});
let chosenOp;
test('编辑值被单条、批量与 SQL/CSV 导出共用，未选字段不存在', () => {
  const rows = createReview(dataset()); const ex = existing([oldBase], [oldPrint]);
  rows[1].draft.artist = "编辑 O'Brien $sync$";
  rows[1].selected = ['artist'];
  chosenOp = buildOperation(rows[1], rows, ex);
  assert.deepEqual(chosenOp.payload, { artist: "编辑 O'Brien $sync$" });
  const sql = reviewSql([chosenOp]);
  assert.match(sql, /UPDATE public.card_prints/);
  assert.ok(!sql.includes('"img_cdn"'));
  assert.ok(!sql.includes('"back_image"'));
  assert.ok(!sql.includes('ON CONFLICT'));
  assert.ok(!sql.includes('DO $sync$'));
  assert.ok(sql.includes('RAISE EXCEPTION'));
  assert.ok(sql.includes("WHERE name IN ('prints')"));
  assert.ok(!reviewSql([chosenOp], { publish: false }).includes('UPDATE public.version'));
  const csv = reviewCsv([chosenOp], 'update');
  assert.match(csv, /attribute,value_json/);
  assert.ok(!csv.includes('img_cdn'));
  assert.ok(csv.includes('artist'));
});
test('插入只使用允许列，不泄漏同步元数据或禁限字段', () => {
  const rows = createReview(dataset()); const op = buildOperation(rows[0], rows, existing());
  assert.equal(op.payload.energy, 0);
  for (const f of ['sync_errata', 'sync_detail_complete', 'is_banned', 'id']) assert.ok(!(f in op.payload));
  assert.ok(!reviewSql([op]).includes('ON CONFLICT'));
  assert.ok(reviewCsv([op], 'insert').includes('card_name_cn'));
});

const writes = [];
const transport = {
  select: async () => [{ ...oldPrint, updated_at: '2026-01-01T00:00:00Z' }],
  insert: async (table, payload) => { writes.push({ table, payload }); return [{ id: 'new', ...payload }]; },
  update: async (table, payload, filters) => { writes.push({ table, payload, filters }); return [{ ...oldPrint, ...payload }]; }
};
await executeOperation(chosenOp, transport);
test('真实写入边界仅 PATCH 选中字段，按 ID 和时间戳定位', () => {
  assert.deepEqual(Object.keys(writes[0].payload).sort(), ['artist', 'updated_at']);
  assert.deepEqual(writes[0].filters.map((f) => f.column), ['id', 'updated_at']);
});
await assert.rejects(executeOperation(chosenOp, { ...transport, select: async () => [{ ...oldPrint, artist: '并发修改' }] }), /其他操作修改/);
passed++; console.log('✓ 并发变更不会被旧审核覆盖');
await assert.rejects(executeOperation(chosenOp, { ...transport, update: async () => [] }), /未返回唯一/);
passed++; console.log('✓ 服务端零行返回不能报告成功');
await assert.rejects(executeOperation({ ...chosenOp, payload: { back_image: 'bad' } }, transport), /未授权/);
passed++; console.log('✓ 写入边界拒绝背面图字段');
const newRows = createReview(dataset());
const newBaseOp = buildOperation(newRows[0], newRows, existing());
await assert.rejects(executeOperation(newBaseOp, { ...transport, select: async () => [oldBase] }), /基础卡已存在/);
passed++; console.log('✓ 提交前再次检查基础卡，防止重复插入');
const newPrintOp = buildOperation(newRows[1], newRows, existing([oldBase]));
await assert.rejects(executeOperation(newPrintOp, { ...transport, select: async () => [{ ...oldPrint, card_no_extend: 'ARC·001a' }] }), /印刷版本已存在/);
passed++; console.log('✓ 提交前检查规范化印刷编号，防止重复插入');

// Exercise fetch orchestration: fresh errata invalidates old details and print images come from the list version.
const seriesOp = { table: 'series', kind: 'insert', payload: { code: 'NEW', name_cn: '新系列' }, expected: {} };
const seriesResult = await executeOperation(seriesOp, { ...transport, insert: async (_table, payload) => [payload] });
test('series 使用 code 主键，成功返回不需要 id', () => {
  assert.equal(seriesResult.code, 'NEW');
  assert.equal(seriesResult.id, undefined);
});
await assert.rejects(executeOperation(seriesOp, { ...transport, insert: async () => [{}] }), /未返回唯一/);
passed++; console.log('✓ series 返回缺少 code 时不能报告成功');

const savedFetch = globalThis.fetch;
let detailCalls = 0;
globalThis.fetch = async (url, opts) => {
  if (String(url).includes('searchCardCraft')) {
    const body = JSON.parse(opts.body);
    return Response.json({ code: 0, result: body.pageNum === 1 ? [{ ...detail, errata: '新勘误', frontImage: 'list-image', rarityName: '异画' }] : [] });
  }
  if (String(url).includes('cardDetail')) { detailCalls++; return Response.json({ code: 0, result: { ...detail, errata: '新勘误', cardSeries: 'ARC', craftList: [{ frontImage: 'wrong-first-craft' }] } }); }
  return Response.json({ code: 0, result: [] });
};
try {
  const ds = await fetchDataset({ existingCardKeys: ['["蔚","铲除者"]'], existingSeriesCodes: ['ARC'], seriesByPrefix: { ARC: 'ARC' },
    detailCache: { [detail.cardNo]: { ...detail, errata: '旧勘误' } }, minGapMs: 0 });
  test('勘误补拉详情、保留装配效果，印刷图片来自对应列表版本', () => {
    assert.equal(detailCalls, 1);
    assert.equal(ds.cards[0].effect_cn, '新勘误\n装配效果');
    assert.equal(ds.prints[0].img_cdn, 'list-image');
  });
} finally { globalThis.fetch = savedFetch; }

/* ────────────── 卡牌列表分页（25 条/批） ────────────── */

const pageCalls = [];
globalThis.fetch = async (_url, opts) => {
  const body = JSON.parse(opts.body);
  pageCalls.push({ pageNum: body.pageNum, pageSize: body.pageSize });
  const all = Array.from({ length: 60 }, (_, i) => ({ ...detail, cardNo: `ARC·${String(i + 1).padStart(3, '0')}·SC` }));
  const start = (body.pageNum - 1) * body.pageSize;
  return Response.json({ code: 0, result: all.slice(start, start + body.pageSize) });
};
try {
  const rows = await searchAllCards();
  assert.equal(SEARCH_PAGE_SIZE, 25);
  assert.equal(rows.length, 60);
  assert.deepEqual(pageCalls.map((c) => c.pageSize), [25, 25, 25, 25]);
  assert.deepEqual(pageCalls.map((c) => c.pageNum), [1, 2, 3, 4], '60 条 ÷ 25 必须在第 4 页用空页收工');
  passed++; console.log('✓ 列表按 25 条/批翻页，直到空页才结束');
} finally { globalThis.fetch = savedFetch; }

globalThis.fetch = async () => Response.json({
  code: 0,
  result: Array.from({ length: 25 }, (_, i) => ({ ...detail, cardNo: `DUP·${String(i + 1).padStart(3, '0')}·SC` }))
});
try {
  await assert.rejects(searchAllCards(), /分页未推进/);
  passed++; console.log('✓ 服务端忽略 pageNum（整页重复）时抛错，不静默漏卡');
} finally { globalThis.fetch = savedFetch; }

/* ────────────── 批量勾选更新字段（fieldSelection） ────────────── */

test('行内计数只算仍存在的差异，草稿改回原值后不虚报', () => {
  const corrected = buildCardsBase({ ...detail, errata: '勘误效果' }, false);
  const rows = createReview(dataset([corrected]));
  const ex = existing([oldBase]);
  const st = reviewState(rows[0], rows, ex);
  assert.equal(st.kind, 'update');
  assert.deepEqual(st.changed, ['effect_cn']);
  rows[0].selected = ['effect_cn', 'energy'];
  assert.equal(selectedFieldCount(rows[0], st), 1);
  assert.equal(allFieldsSelected(rows[0], st), true);
  assert.deepEqual(selectableFields(st), ['effect_cn']);
});
test('新增行与待处理行没有可批量勾选的字段', () => {
  const rows = createReview(dataset());
  const ex = existing();
  const index = { ...indexExisting(ex), ...indexDrafts(rows) };
  const stateOf = (r) => reviewState(r, rows, ex, index);
  assert.equal(stateOf(rows[0]).kind, 'new');
  assert.equal(stateOf(rows[1]).kind, 'blocked');
  assert.deepEqual(selectableFields(stateOf(rows[0])), []);
  assert.deepEqual(fieldSelectionPlan(rows, stateOf), { rows: 0, fields: 0 });
  assert.deepEqual(applyFieldSelection(rows, stateOf).written, []);
  assert.deepEqual(rows.map((r) => r.selected), [[], []]);
});
test('批量勾选差异字段后，补丁与逐条勾选完全一致，清空即回到未选', () => {
  const rows = createReview(dataset());
  const ex = existing([oldBase], [oldPrint]);
  const index = { ...indexExisting(ex), ...indexDrafts(rows) };
  const stateOf = (r) => reviewState(r, rows, ex, index);
  const changed = stateOf(rows[1]).changed;
  assert.deepEqual(changed, ['img_cdn', 'artist']);
  assert.equal(stateOf(rows[0]).kind, 'same');
  assert.equal(fieldSelectionPlan(rows, stateOf).rows, 1);
  assert.equal(buildOperation(rows[1], rows, ex, index), null);
  const applied = applyFieldSelection(rows, stateOf);
  assert.equal(applied.rows, 1);
  assert.equal(applied.fields, 2);
  assert.deepEqual(applied.written, [rows[1]]);
  assert.deepEqual(rows[1].selected, changed);
  const op = buildOperation(rows[1], rows, ex, index);
  assert.deepEqual(Object.keys(op.payload).sort(), [...changed].sort());
  assert.equal(clearFieldSelection(rows), 2);
  assert.equal(buildOperation(rows[1], rows, ex, index), null);
});
test('批量勾选整体替换旧选择，陈旧字段不会被带走', () => {
  const rows = createReview(dataset());
  const ex = existing([oldBase], [oldPrint]);
  const index = { ...indexExisting(ex), ...indexDrafts(rows) };
  const stateOf = (r) => reviewState(r, rows, ex, index);
  rows[1].selected = ['img_cdn', 'card_id', 'is_promo'];
  applyFieldSelection(rows, stateOf);
  assert.deepEqual(rows[1].selected, ['img_cdn', 'artist']);
});
console.log(`\n${passed} sync review checks passed.`);
