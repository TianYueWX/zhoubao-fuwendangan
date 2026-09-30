/* ================================================================
 * scripts/verify-print-defaults.mjs
 *
 * 纯函数验收:「重设默认印刷」的规划器(src/tools/admin/printDefaults.ts)。
 *
 * 为什么单独验:规则是 1016 张基础卡 × 3241 行印刷版本的取舍逻辑,一旦错了
 * 会**静默写错 800 多行** is_default —— 而这个字段决定卡牌图鉴给每张卡显示
 * 哪张图(超编版还是平卡版)。这是本功能唯一容易出错的地方。
 *
 * 用例全部取自线上真实数据(卡号、画师、稀有度都是抄下来的),不是编的。
 *
 *   node --experimental-strip-types scripts/verify-print-defaults.mjs
 * ================================================================ */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, '../src/tools/admin/printDefaults.ts');

const runner = `
import { planPrintDefaults } from ${JSON.stringify(target)};

const results = [];
function expect(label, actual, wanted) {
  const ok = JSON.stringify(actual) === JSON.stringify(wanted);
  results.push({ label, ok, actual, wanted });
}
function expectTrue(label, cond, detail) {
  results.push({ label, ok: !!cond, actual: detail, wanted: 'truthy' });
}

/** 造一行印刷版本;只写用例关心的字段 */
let seq = 0;
const P = (card_id, card_no_extend, language, rarity, is_default = false, print_order = null) => ({
  id: 'p' + (++seq), card_id, card_no_extend, extend_rarity_name: rarity,
  language, is_default, print_order
});
const C = (id, card_no) => ({ id, card_no });

/** 规划单张卡,只关心那一条结论 */
const one = (card, prints) => planPrintDefaults([card], prints).items[0];

/* ══════════════ ① 主路径:一个候选,置默认 ══════════════ */
{
  const it = one(C('c1', 'OGN-007'), [
    P('c1', 'OGN-007', 'SC', '平卡'),
    P('c1', 'OGN-007a', 'SC', '异画'),
    P('c1', 'OGN-007', 'EN', '平卡')
  ]);
  expect('单候选 → kind=set', it.kind, 'set');
  expect('单候选 → 选中那一行', it.target.card_no_extend, 'OGN-007');
  expect('单候选 → 不算多候选', it.pickedFromMany, false);
}

/* ══════════════ ② 已正确:不动 ══════════════ */
{
  const it = one(C('c2', 'OGN-007'), [
    P('c2', 'OGN-007', 'SC', '平卡', true),
    P('c2', 'OGN-007a', 'SC', '异画')
  ]);
  expect('已是 SC 平卡 → kind=already', it.kind, 'already');
  expect('已是 SC 平卡 → 不产出写入目标', it.target, null);
  expect('已是 SC 平卡 → 说明', it.note, '已是 SC 平卡');
}

/* ══════════════ ③ 只补缺失:默认是异画时绝不改写 ══════════════ */
{
  const it = one(C('c3', 'VEN-136'), [
    P('c3', 'VEN-136a', 'SC', '异画', true),
    P('c3', 'VEN-136', 'SC', '平卡')
  ]);
  expect('默认是异画 → kind=conflict(不改)', it.kind, 'conflict');
  expect('默认是异画 → 不产出写入目标', it.target, null);
  expectTrue('默认是异画 → 说明里点出两个卡号',
    it.note.includes('VEN-136a') && it.note.includes('VEN-136'), it.note);
}

/* ══════════════ ④ 多默认:目标在其中 → already 但要提示未清理 ══════════════ */
{
  const it = one(C('c4', 'OGN-030'), [
    P('c4', 'OGN-030', 'SC', '平卡', true),
    P('c4', 'OGN-030a', 'SC', '异画', true)
  ]);
  expect('多默认且含目标 → kind=already', it.kind, 'already');
  expectTrue('多默认 → 提示还有别的默认未清理', it.note.includes('还有 1 个默认'), it.note);
}
{
  // 关键:平卡候选必须存在,否则会走 no-candidate 而不是 conflict
  const it = one(C('c5', 'OGN-030'), [
    P('c5', 'OGN-030a', 'SC', '异画', true),
    P('c5', 'VEN-168', 'SC', '超编', true),
    P('c5', 'OGN-030', 'SC', '平卡') // ← 候选在,但没被设成默认
  ]);
  expect('多默认且都不含目标 → kind=conflict', it.kind, 'conflict');
  expect('多默认且都不含目标 → 不产出写入目标', it.target, null);
}
{
  // 反例:连平卡候选都没有时,多默认也只能是 no-candidate(与本用例区分开)
  const it = one(C('c5b', 'OGN-031'), [
    P('c5b', 'OGN-031a', 'SC', '异画', true),
    P('c5b', 'VEN-169', 'SC', '超编', true)
  ]);
  expect('没有平卡候选时即使有默认也是 no-candidate', it.kind, 'no-candidate');
}

/* ══════════════ ⑤ 无候选:ARC-001~006 真实情形(只有 SC 异画) ══════════════ */
{
  const it = one(C('c6', 'ARC-001'), [P('c6', 'ARC-001', 'SC', '异画')]);
  expect('只有 SC 异画 → kind=no-candidate', it.kind, 'no-candidate');
  expect('只有 SC 异画 → 不产出写入目标', it.target, null);
  expectTrue('说明里写清该卡的组合', it.note.includes('SC/异画'), it.note);
}
{
  const it = one(C('c7', 'OGN-999'), []);
  expect('完全没有印刷版本 → no-candidate', it.kind, 'no-candidate');
  expect('完全没有印刷版本 → 说明区分于「有但不是平卡」', it.note, '这张卡没有任何印刷版本');
}

/* ══════════════ ⑥ 多候选:RAD-155 德玛西亚皇子(线上唯一一例) ══════════════ */
{
  const it = one(C('c8', 'RAD-155'), [
    P('c8', 'RAD-176', 'SC', '平卡'),   // 画师 Herman Ng
    P('c8', 'RAD-155', 'SC', '平卡')    // 画师 Grafit Studio
  ]);
  expect('多候选 → 取卡号与基础卡一致的', it.target.card_no_extend, 'RAD-155');
  expect('多候选 → 标记 pickedFromMany', it.pickedFromMany, true);
  expectTrue('多候选 → 说明里点出候选数与取舍', it.note.includes('2 个') && it.note.includes('RAD-155'), it.note);
}

/* ══════════════ ⑦ 多候选且没有一个卡号一致 → 落到图鉴同款排序 ══════════════ */
{
  // 卡号短的优先(RAD-180 与 SFD-082 同为 7 字符时,才不会走到这一步;
  // 这里构造两个都不等于基础卡号、长度不同的情况)
  const it = one(C('c9', 'OGN-100'), [
    P('c9', 'OGN-100a', 'SC', '平卡'),
    P('c9', 'OGN-100b', 'SC', '平卡')
  ]);
  expect('都不一致 → 卡号短的优先', it.target.card_no_extend, 'OGN-100a');
  expect('都不一致 → 仍然标记多候选', it.pickedFromMany, true);
}
{
  // 长度打平时看 print_order,大的优先(与 chooseDefaultPrint 的 b.printOrder - a.printOrder 一致)
  const it = one(C('c10', 'OGN-100'), [
    P('c10', 'OGN-100a', 'SC', '平卡', false, 1),
    P('c10', 'OGN-100b', 'SC', '平卡', false, 5)
  ]);
  expect('长度打平 → print_order 大的优先', it.target.card_no_extend, 'OGN-100b');
}

/* ══════════════ ⑧ 语言严格匹配(与图鉴 chooseDefaultPrint 的 === "SC" 对齐) ══════════════ */
{
  const it = one(C('c11', 'OGN-101'), [P('c11', 'OGN-101', 'sc', '平卡')]);
  expect('小写 sc 不算 SC(与图鉴严格匹配保持一致)', it.kind, 'no-candidate');
}

/* ══════════════ ⑨ 别的语言的平卡不能当候选 ══════════════ */
{
  const it = one(C('c12', 'OGN-102'), [
    P('c12', 'OGN-102', 'EN', '平卡'),
    P('c12', 'OGN-102', 'KR', '平卡')
  ]);
  expect('只有 EN/KR 平卡 → no-candidate', it.kind, 'no-candidate');
}

/* ══════════════ ⑩ 分组与顺序 ══════════════ */
{
  const plan = planPrintDefaults(
    [C('a', 'AAA-001'), C('b', 'BBB-002'), C('c', 'CCC-003'), C('d', 'DDD-004')],
    [
      P('a', 'AAA-001', 'SC', '平卡'),           // set
      P('b', 'BBB-002', 'SC', '平卡', true),     // already
      P('c', 'CCC-003', 'SC', '异画'),           // no-candidate
      P('d', 'DDD-004a', 'SC', '异画', true),    // conflict
      P('a', 'AAA-001', 'EN', '平卡')
    ]
  );
  expect('分组:toWrite', plan.toWrite.map((i) => i.cardNo), ['AAA-001']);
  expect('分组:already', plan.already.map((i) => i.cardNo), ['BBB-002']);
  expect('分组:skipped 含无候选与冲突', plan.skipped.map((i) => i.cardNo), ['CCC-003', 'DDD-004']);
  expect('items 保持传入顺序', plan.items.map((i) => i.cardNo), ['AAA-001', 'BBB-002', 'CCC-003', 'DDD-004']);
  expect('printCount 记录参与判定的行数', plan.printCount, 5);
}

/* ══════════════ ⑪ 边界 ══════════════ */
{
  const plan = planPrintDefaults([], []);
  expect('空输入 → 空计划', [plan.toWrite.length, plan.already.length, plan.skipped.length], [0, 0, 0]);
}
{
  // 印刷版本属于不在范围内的卡 → 不能串台
  const plan = planPrintDefaults([C('x', 'XXX-001')], [P('y', 'YYY-001', 'SC', '平卡')]);
  expect('别的卡的印刷版本不会串台', plan.toWrite.length, 0);
  expect('别的卡的印刷版本 → 无候选', plan.items[0].kind, 'no-candidate');
}
{
  const it = one(C('c13', null), [P('c13', 'ZZZ-001', 'SC', '平卡')]);
  expect('基础卡无卡号时仍能选出候选', it.kind, 'set');
  expect('基础卡无卡号 → 显示占位', it.cardNo, '(无卡号)');
}

for (const r of results) {
  console.log(\`  \${r.ok ? '✓' : '✗'} \${r.label}\`);
  if (!r.ok) console.log(\`      got: \${JSON.stringify(r.actual)}\\n      want: \${JSON.stringify(r.wanted)}\`);
}
const failed = results.filter(r => !r.ok).length;
console.log(\`\\n──────── 结果:\${results.length - failed} 通过 / \${failed} 失败 ────────\`);
process.exit(failed === 0 ? 0 : 1);
`;

const out = spawnSync(
  process.execPath,
  ['--experimental-strip-types', '--input-type=module', '-e', runner],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
);

const stdout = (out.stdout || '').replace(/ExperimentalWarning[^\n]*\n?/g, '');
process.stdout.write(stdout);
if (out.status !== 0) {
  process.stderr.write((out.stderr || '').replace(/ExperimentalWarning[^\n]*\n?/g, ''));
}
process.exit(out.status ?? 1);
