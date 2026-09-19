/** Offline regression checks: no real database writes or credentials needed. */
import assert from 'node:assert/strict';
import { normalizeCardNo, buildCardsBase, buildPrintFromSearch } from '../src/tools/sync/normalize.ts';
import { createReview, reviewState, buildOperation, reviewSql, reviewCsv, equivalent } from '../src/tools/sync/review.ts';
import { executeOperation } from '../src/tools/sync/write.ts';
import { indexExisting, indexDrafts } from '../src/tools/sync/reviewIndex.ts';
import { fetchDataset } from '../src/tools/sync/run.ts';

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
  for (const ex of [existing(), existing([oldBase], [oldPrint]), existing([oldBase, {...oldBase,id:'base-2'}], [oldPrint])]) {
    const rows = createReview(dataset([corrected]));
    const index = {...indexExisting(ex), ...indexDrafts(rows)};
    for (const row of rows) {
      assert.deepEqual(reviewState(row, rows, ex, index), reviewState(row, rows, ex));
      if (reviewState(row, rows, ex).kind !== 'blocked') {
        row.selected = ['artist', 'effect_cn'];
        assert.deepEqual(buildOperation(row, rows, ex, index), buildOperation(row, rows, ex));
      }
    }
  }
});
test('索引保留重复候选，并在身份编辑后正确重建', () => {
  const rows = createReview(dataset()); const ex = existing([oldBase, {...oldBase,id:'base-2'}], [oldPrint]);
  let index = {...indexExisting(ex), ...indexDrafts(rows)};
  assert.equal([...index.bases.values()][0].length, 2);
  rows[0].chosenBaseId = 'base-2';
  assert.equal(reviewState(rows[1], rows, ex, index).parentId, 'base-2');
  rows[1].draft.card_no_extend = 'ARC-099';
  index = {...indexExisting(ex), ...indexDrafts(rows)};
  assert.equal(reviewState(rows[1], rows, ex, index).kind, 'new');
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
  if (String(url).includes('searchCardCraft')) return Response.json({ code: 0, result: [{ ...detail, errata: '新勘误', frontImage: 'list-image', rarityName: '异画' }] });
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
console.log(`\n${passed} sync review checks passed.`);
