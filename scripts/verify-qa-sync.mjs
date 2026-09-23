/* ================================================================
 * scripts/verify-qa-sync.mjs
 *
 * QA 同步纯逻辑验收（无网络、无数据库）：
 *   - 真实接口卡号归一化（OGN·021/298 → OGN-021、令牌 UNL-T06 原样）
 *   - 归一化后不在卡库的编号不建关联，只记 unmatched
 *   - new / update / same / blocked 判定与勾选字段
 *   - 写入计划：仅勾选字段、关联增删、位置
 *
 *   node --experimental-strip-types --import ./scripts/register-hooks.mjs scripts/verify-qa-sync.mjs
 * ================================================================ */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildQaIncoming, buildQaPlan, createQaReview, normalizeQaCardNo, qaState, segmentQaText, summarizeQa
} from '../src/tools/sync/qa.ts';
import { getCardCommonQaList, qaApiBase, RIFTBOUND_API_BASE } from '../src/tools/sync/riftboundApi.ts';
import { fetchUpstream, onRequestPost } from '../functions/api/riftbound/cardCommonQa/getCardCommonQaList.ts';

let passed = 0;
function test(label, fn) {
  try { fn(); } catch (e) { console.error(`✗ ${label}\n  ${e.message}`); process.exitCode = 1; return; }
  passed++;
  console.log(`✓ ${label}`);
}

async function asyncTest(label, fn) {
  try { await fn(); } catch (e) { console.error(`✗ ${label}\n  ${e.message}`); process.exitCode = 1; return; }
  passed++;
  console.log(`✓ ${label}`);
}

const cardNos = new Set(['OGN-021', 'UNL-074', 'UNL-T06', 'OGN-096']);
const nameByNo = new Map([['OGN-021', '太阳圆盘'], ['UNL-T06', '映像'], ['OGN-096', '警觉的哨兵']]);
const item = (over = {}) => ({
  id: 81, code: null, sort: null, cardNo: [], cardName: [], question: 'Q：?', answer: 'A：。', ...over
});
const migration = readFileSync(new URL('../supabase/migrations/20260923_create_qa_entries.sql', import.meta.url), 'utf8');

test('卡号归一化：·→-、去 /总数、令牌原样', () => {
  assert.equal(normalizeQaCardNo('OGN·021/298'), 'OGN-021');
  assert.equal(normalizeQaCardNo('UNL-074/219'), 'UNL-074');
  assert.equal(normalizeQaCardNo('UNL-T06'), 'UNL-T06');
});

test('归一化后命中的编号进入 card_no_list，缺失的进 unmatched', () => {
  const inc = buildQaIncoming(item({ cardNo: ['OGN·021/298', 'XXX-999/1', 'UNL-T06'] }), cardNos, nameByNo);
  assert.deepEqual(inc.card_no_list, ['OGN-021', 'UNL-T06']);
  assert.deepEqual(inc.card_name_list, ['太阳圆盘', '映像']);
  assert.deepEqual(inc.unmatched, ['XXX-999/1']);
  assert.deepEqual(inc.card_no_raw, ['OGN·021/298', 'XXX-999/1', 'UNL-T06']);
});

test('重复编号按首次出现去重', () => {
  const inc = buildQaIncoming(item({ cardNo: ['OGN·021/298', 'OGN-021'] }), cardNos, nameByNo);
  assert.deepEqual(inc.card_no_list, ['OGN-021']);
});

test('cardName 与 cardNo 不等长也不影响（令牌无名仍可关联）', () => {
  const inc = buildQaIncoming(item({ id: 102, cardNo: ['OGN·096/298', 'UNL-T06'], cardName: ['警觉的哨兵'] }), cardNos, nameByNo);
  assert.deepEqual(inc.card_no_list, ['OGN-096', 'UNL-T06']);
  assert.deepEqual(inc.card_name_list, ['警觉的哨兵', '映像']);
});

test('本轮新卡保留关联意图并标记等待提交', () => {
  const pending = new Set(['SFD-999']);
  const names = new Map([...nameByNo, ['SFD-999', '本轮新卡']]);
  const inc = buildQaIncoming(item({ cardNo: ['SFD·999/999'] }), cardNos, names, pending);
  assert.deepEqual(inc.card_no_list, ['SFD-999']);
  assert.deepEqual(inc.pending_card_no_list, ['SFD-999']);
  assert.deepEqual(inc.unmatched, []);
  const row = createQaReview([inc], [], new Map())[0];
  assert.equal(qaState(row).kind, 'blocked');
  assert.match(qaState(row).reason, /等待卡牌提交/);
});

test('新条目判定为 new', () => {
  const inc = buildQaIncoming(item(), cardNos, nameByNo);
  const rows = createQaReview([inc], [], new Map());
  assert.equal(qaState(rows[0]).kind, 'new');
});

test('完全相同判定为 same', () => {
  const inc = buildQaIncoming(item({ cardNo: ['OGN·021/298'] }), cardNos, nameByNo);
  const db = { id: 'q1', source_id: '81', question: 'Q：?', answer: 'A：。', question_en: null, answer_en: null };
  const rows = createQaReview([inc], [db], new Map([['q1', ['OGN-021']]]));
  assert.equal(qaState(rows[0]).kind, 'same');
});

test('答案变化判定为 update，只列出变化的字段', () => {
  const inc = buildQaIncoming(item({ cardNo: ['OGN·021/298'] }), cardNos, nameByNo);
  const db = { id: 'q1', source_id: '81', question: 'Q：?', answer: 'A：旧', question_en: null, answer_en: null };
  const rows = createQaReview([inc], [db], new Map([['q1', ['OGN-021']]]));
  const st = qaState(rows[0]);
  assert.equal(st.kind, 'update');
  assert.deepEqual(st.changed, ['answer']);
});

test('空问题或空答案判定为 blocked', () => {
  const inc = buildQaIncoming(item({ question: '' }), cardNos, nameByNo);
  const rows = createQaReview([inc], [], new Map());
  assert.equal(qaState(rows[0]).kind, 'blocked');
});

test('新增计划：insert 载荷 + 关联位置，unmatched 不进入关联', () => {
  const inc = buildQaIncoming(item({ cardNo: ['OGN·021/298', 'XXX-999/1', 'UNL-T06'] }), cardNos, nameByNo);
  const rows = createQaReview([inc], [], new Map());
  const plan = buildQaPlan(rows[0]);
  assert.equal(plan.entry.kind, 'insert');
  assert.equal(plan.entry.payload.source, 'xcx');
  assert.equal(plan.entry.payload.source_id, '81');
  assert.deepEqual(plan.linkAdds, [{ card_no: 'OGN-021', position: 0 }, { card_no: 'UNL-T06', position: 1 }]);
  assert.deepEqual(plan.linkRemoves, []);
});

test('更新计划：仅写入勾选字段，并计算关联增删', () => {
  const inc = buildQaIncoming(item({ answer: 'A：新', cardNo: ['OGN·021/298'] }), cardNos, nameByNo);
  const db = { id: 'q1', source_id: '81', question: 'Q：?', answer: 'A：旧', question_en: null, answer_en: null };
  const rows = createQaReview([inc], [db], new Map([['q1', ['UNL-074']]]));
  rows[0].selected = ['answer'];
  const plan = buildQaPlan(rows[0]);
  assert.equal(plan.entry.kind, 'update');
  assert.deepEqual(plan.entry.payload, { answer: 'A：新' });
  assert.deepEqual(plan.linkAdds, [{ card_no: 'OGN-021', position: 0 }]);
  assert.deepEqual(plan.linkRemoves, ['UNL-074']);
});

test('未勾选字段时不产生正文更新计划（仅关联变化返回 null 或纯关联）', () => {
  const inc = buildQaIncoming(item({ cardNo: ['OGN·021/298'] }), cardNos, nameByNo);
  const db = { id: 'q1', source_id: '81', question: 'Q：?', answer: 'A：。', question_en: null, answer_en: null };
  const rows = createQaReview([inc], [db], new Map([['q1', ['UNL-074']]]));
  const plan = buildQaPlan(rows[0]);
  assert.equal(plan.entry.kind, 'update');
  assert.deepEqual(plan.entry.payload, {});
  assert.deepEqual(plan.linkAdds, [{ card_no: 'OGN-021', position: 0 }]);
  assert.deepEqual(plan.linkRemoves, ['UNL-074']);
});

test('只有正文差异但未勾选任何字段时，不会误报提交成功', () => {
  const inc = buildQaIncoming(item({ answer: 'A：新', cardNo: ['OGN·021/298'] }), cardNos, nameByNo);
  const db = { id: 'q1', source_id: '81', question: 'Q：?', answer: 'A：旧', question_en: null, answer_en: null };
  const row = createQaReview([inc], [db], new Map([['q1', ['OGN-021']]]))[0];
  assert.equal(buildQaPlan(row), null);
});

test('summary 统计各状态并汇总 unmatched', () => {
  const a = buildQaIncoming(item({ id: 1, cardNo: ['OGN·021/298'] }), cardNos, nameByNo);
  const b = buildQaIncoming(item({ id: 2, cardNo: ['XXX-999/1'] }), cardNos, nameByNo);
  const rows = createQaReview([a, b], [], new Map());
  const s = summarizeQa(rows);
  assert.equal(s.total, 2);
  assert.equal(s.newCount, 2);
  assert.deepEqual(s.unmatched, ['XXX-999/1']);
});

test('QA 展示分段保留原文和换行，并将三类标记连括号加粗', () => {
  const raw = 'Q：【远古巨龙】支付 [2]\r\n获得<急速>吗？';
  const segments = segmentQaText(raw);
  assert.equal(segments.map((s) => s.text).join(''), raw);
  assert.deepEqual(segments.filter((s) => s.bold).map((s) => s.text), ['【远古巨龙】', '[2]', '<急速>']);
});

test('QA migration 含显式 Data API 授权、RLS、外键反查索引和发布版本行', () => {
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /grant select on table public\.qa_entries, public\.qa_entry_cards to anon, authenticated/i);
  assert.match(migration, /grant insert, update, delete on table public\.qa_entries, public\.qa_entry_cards to authenticated/i);
  assert.match(migration, /create index qa_entry_cards_card_no_idx/i);
  assert.match(migration, /values \('qa', now\(\)\)/i);
});

test('默认官方 QA 地址切换到同源代理，自定义地址保持不变', () => {
  assert.equal(qaApiBase(), '/api/riftbound');
  assert.equal(qaApiBase(`${RIFTBOUND_API_BASE}/`), '/api/riftbound');
  assert.equal(qaApiBase('https://example.com/xcx/'), 'https://example.com/xcx');
});

await asyncTest('Pages Function 只向固定上游转发经校验的 QA 分页参数', async () => {
  const originalFetch = globalThis.fetch;
  let call;
  globalThis.fetch = async (input, init) => {
    call = { input: String(input), init };
    return Response.json({ code: 0, message: '操作成功', result: [] });
  };
  try {
    const response = await onRequestPost({
      request: new Request('https://site.example/api/riftbound/cardCommonQa/getCardCommonQaList', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageNum: 2, pageSize: 30, searchContent: '', ignored: 'drop-me' })
      })
    });
    assert.equal(response.status, 200);
    assert.equal(call.input, 'https://lol-api.playloltcg.com/xcx/cardCommonQa/getCardCommonQaList');
    assert.deepEqual(JSON.parse(call.init.body), { pageNum: 2, pageSize: 30, searchContent: '' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await asyncTest('Pages Function 在转发前拒绝超出范围的分页请求', async () => {
  const response = await onRequestPost({
    request: new Request('https://site.example/api/riftbound/cardCommonQa/getCardCommonQaList', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageNum: 1, pageSize: 1000, searchContent: '' })
    })
  });
  assert.equal(response.status, 400);
});

await asyncTest('上游超时时 fetchUpstream 抛出且已挂上中止信号', async () => {
  const originalFetch = globalThis.fetch;
  let sawSignal = false;
  globalThis.fetch = async (_url, init) => {
    sawSignal = init.signal instanceof AbortSignal;
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  };
  try {
    await assert.rejects(
      fetchUpstream({ pageNum: 1, pageSize: 30, searchContent: '' }, 1000, 1),
      (e) => e?.name === 'TimeoutError'
    );
    assert.equal(sawSignal, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await asyncTest('上游首次失败后 fetchUpstream 会重试并成功', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) throw new DOMException('timeout', 'TimeoutError');
    return Response.json({ code: 0, message: '操作成功', result: [] });
  };
  try {
    const result = await fetchUpstream({ pageNum: 1, pageSize: 30, searchContent: '' }, 1000, 2);
    assert.equal(result.status, 200);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await asyncTest('Pages Function 在上游持续不可用时返回 504 而非挂死', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new DOMException('timeout', 'TimeoutError'); };
  try {
    const response = await onRequestPost({
      request: new Request('https://site.example/api/riftbound/cardCommonQa/getCardCommonQaList', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageNum: 1, pageSize: 30, searchContent: '' })
      })
    });
    assert.equal(response.status, 504);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await asyncTest('客户端把 524 视为可重试并最终成功', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return new Response('', { status: 524 });
    return Response.json({ code: 0, message: '操作成功', result: [] });
  };
  try {
    const rows = await getCardCommonQaList({}, { baseUrl: 'https://example.com/xcx' });
    assert.equal(calls, 2);
    assert.deepEqual(rows, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

console.log(`\n${passed} passed`);
