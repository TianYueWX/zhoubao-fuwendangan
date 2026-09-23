/* ================================================================
 * scripts/verify-carddex-qa.mjs
 *
 * 卡牌详情 QA 的纯逻辑验收（无网络、无数据库）：
 *   - 由 qa_entries + qa_entry_cards 聚合 card_no → 问答列表
 *   - 孤立问答（无关联卡）不出现；悬空关联（找不到条目）被忽略
 *   - 排序：position 升序 → source_id 数字序 → 无 source_id 的最后
 *   - 文本 trim、source_id 归一化为 null
 *
 *   node --experimental-strip-types --import ./scripts/register-hooks.mjs scripts/verify-carddex-qa.mjs
 * ================================================================ */
import assert from 'node:assert/strict';
import { buildQaByCardNo } from '../src/components/carddex/qa.ts';

let passed = 0;
function test(label, fn) {
  try { fn(); } catch (e) { console.error(`✗ ${label}\n  ${e.message}`); process.exitCode = 1; return; }
  passed++;
  console.log(`✓ ${label}`);
}

const entries = [
  { id: 'q2', source_id: '82', question: 'Q2', answer: 'A2', question_en: '', answer_en: '' },
  { id: 'q1', source_id: '81', question: ' Q1 ', answer: ' A1 ', question_en: 'Q1e', answer_en: 'A1e' },
  { id: 'manual', source_id: null, question: 'Qm', answer: 'Am', question_en: null, answer_en: null },
  { id: 'orphan', source_id: '99', question: 'Qo', answer: 'Ao', question_en: '', answer_en: '' },
];
const links = [
  { qa_id: 'q2', card_no: 'OGN-055', position: 1 },
  { qa_id: 'q1', card_no: 'OGN-055', position: 0 },
  { qa_id: 'manual', card_no: 'OGN-055', position: 0 },
  { qa_id: 'q1', card_no: 'OGN-079', position: 0 },
  { qa_id: 'missing', card_no: 'OGN-079', position: 0 },
  { qa_id: 'q2', card_no: '', position: 0 },
];

test('按 card_no 聚合；孤立问答与悬空关联都不出现', () => {
  const map = buildQaByCardNo(entries, links);
  assert.deepEqual([...map.keys()].sort(), ['OGN-055', 'OGN-079']);
  assert.equal(map.get('OGN-055').length, 3);
  assert.equal(map.get('OGN-079').length, 1);
  assert.ok(![...map.values()].flat().some((q) => q.id === 'orphan'));
});

test('排序：position 升序 → source_id 数字序 → 无 source_id 的最后', () => {
  const map = buildQaByCardNo(entries, links);
  assert.deepEqual(map.get('OGN-055').map((q) => q.id), ['q1', 'manual', 'q2']);
});

test('同一问答可关联多张卡', () => {
  const map = buildQaByCardNo(entries, links);
  assert.ok(map.get('OGN-055').some((q) => q.id === 'q1'));
  assert.ok(map.get('OGN-079').some((q) => q.id === 'q1'));
});

test('文本 trim，source_id 缺失归一化为 null', () => {
  const map = buildQaByCardNo(entries, links);
  const q1 = map.get('OGN-055').find((q) => q.id === 'q1');
  assert.equal(q1.question, 'Q1');
  assert.equal(q1.answer, 'A1');
  assert.equal(q1.questionEn, 'Q1e');
  const manual = map.get('OGN-055').find((q) => q.id === 'manual');
  assert.equal(manual.sourceId, null);
  assert.equal(manual.questionEn, '');
});

test('空输入返回空映射', () => {
  assert.equal(buildQaByCardNo([], []).size, 0);
});

console.log(`\n${passed} passed`);
