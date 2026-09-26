/* ================================================================
 * scripts/verify-admin-logic.mjs
 *
 * 编辑部纯逻辑验收:±N 分组、变更字段计算、deck_limit 三态映射。
 *
 * 这些函数决定了「批量操作到底会写什么」—— 分组错了会把 A 行的
 * 目标值写到 B 行,而 PostgREST 的 PATCH 不会有任何报错。所以必须单测。
 *
 *   node --experimental-strip-types scripts/verify-admin-logic.mjs
 * ================================================================ */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const logic = resolve(here, '../src/tools/admin/batchLogic.ts');
const types = resolve(here, '../src/tools/admin/types.ts');
const validate = resolve(here, '../src/tools/admin/validate.ts');

const runner = `
import {
  changedBatchFields, groupByDelta, deltaPreview, deltaWarnings, BATCH_FIELDS
} from ${JSON.stringify(logic)};
import { deckLimitToMode, modeToDeckLimit, deckLimitLabel } from ${JSON.stringify(types)};
import { isUsableIconUrl, isUsableSeriesCode, isUsableRuleNumber } from ${JSON.stringify(validate)};

const out = [];
const eq = (label, actual, wanted) =>
  out.push({ label, ok: JSON.stringify(actual) === JSON.stringify(wanted), actual, wanted });

/* ────────── ±N 分组 ────────── */
{
  // A=1, B=4, C=1 → +1 后:A→2, B→5, C→2 ⇒ 两组
  const cur = new Map([['A', 1], ['B', 4], ['C', 1]]);
  const g = groupByDelta(cur, ['A', 'B', 'C'], 1);
  eq('结果相同的行归为一组', g.map(x => [x.target, x.ids.length]), [[2, 2], [5, 1]]);
  eq('组内保留全部 id', g[0].ids.sort(), ['A', 'C']);
  eq('分组按键值升序', g.map(x => x.target), [2, 5]);
}
{
  // null 视为 0:null+3 = 3,与「本来就是 0」的行同组
  const cur = new Map([['X', null], ['Y', 0]]);
  const g = groupByDelta(cur, ['X', 'Y'], 3);
  eq('null 按 0 参与加减并归入同组', g.length, 1);
  eq('null 行与 0 值行同组', g[0].ids.sort(), ['X', 'Y']);
  eq('目标值正确', g[0].target, 3);
  // 反例:null 与 3 相加后是 3 与 6,不该同组
  eq('null 行不会与已为 3 的行同组',
    groupByDelta(new Map([['X', null], ['Y', 3]]), ['X', 'Y'], 3).length, 2);
}
{
  // 减到负数仍会生成组(由 warnings 提醒,不由分组拦截)
  const cur = new Map([['A', 1]]);
  eq('负结果照样成组', groupByDelta(cur, ['A'], -5), [{ target: -4, ids: ['A'] }]);
  eq('负结果给出提醒', deltaWarnings(cur, ['A'], -5).length, 1);
}
{
  const cur = new Map([['A', null]]);
  eq('无值行给出提醒', deltaWarnings(cur, ['A'], 1).length, 1);
  eq('一切正常时无提醒', deltaWarnings(new Map([['A', 5]]), ['A'], 1), []);
}
{
  eq('空选择返回空分组', groupByDelta(new Map(), [], 1), []);
}
{
  const g = groupByDelta(new Map([['A', 1], ['B', 2]]), ['A', 'B'], 0);
  eq('delta=0 时按当前值分组', g.map(x => [x.target, x.ids.length]), [[1, 1], [2, 1]]);
}
{
  eq('预览文案含字段名与目标值',
    deltaPreview(groupByDelta(new Map([['A', 1]]), ['A'], 2), '能量'),
    [{ label: '能量 → 3', count: 1 }]);
}

/* ────────── 变更字段计算 ────────── */
{
  const before = { card_no: 'A-1', energy: 1, is_banned: false, rarity_name: null };
  eq('无改动返回空补丁', changedBatchFields(before, { ...before }), {});
  eq('只挑出改动的字段',
    changedBatchFields(before, { ...before, energy: 2 }),
    { energy: 2 });
  eq('多个字段同时改动都挑出来',
    Object.keys(changedBatchFields(before, { ...before, energy: 2, is_banned: true })).sort(),
    ['energy', 'is_banned']);
  eq('null → 有值 算改动',
    changedBatchFields(before, { ...before, rarity_name: '稀有' }),
    { rarity_name: '稀有' });
  eq('有值 → null 算改动',
    changedBatchFields({ ...before, rarity_name: '稀有' }, before),
    { rarity_name: null });
  eq('undefined 与 null 等价,不算改动',
    changedBatchFields({ ...before, rarity_name: null }, { ...before, rarity_name: undefined }), {});
  eq('数组字段不在批量可改范围',
    changedBatchFields({ tag: ['a'] }, { tag: ['b'] }), {});
  eq('可改字段清单固定为 11 个', BATCH_FIELDS.length, 11);
}

/* ────────── deck_limit 三态 ────────── */
{
  eq('null → 默认3张', deckLimitToMode(null), 'default');
  eq('0 → 不限', deckLimitToMode(0), 'unlimited');
  eq('N → 限N张', deckLimitToMode(2), 'limited');
  eq('default → null', modeToDeckLimit('default', 1), null);
  eq('unlimited → 0', modeToDeckLimit('unlimited', 1), 0);
  eq('limited → N', modeToDeckLimit('limited', 4), 4);
  eq('三态往返稳定(default)', modeToDeckLimit(deckLimitToMode(null), 9), null);
  eq('三态往返稳定(unlimited)', modeToDeckLimit(deckLimitToMode(0), 9), 0);
  // 注意:deckLimitToMode 只返回模式,N 由调用方另外持有,
  // 所以「mode → limit」的往返**本来就不保 N** —— 这不是 bug,别去"修"它。
  eq('mode 往返会丢掉 N(设计如此,N 由界面单独持有)',
    modeToDeckLimit(deckLimitToMode(3), 9), 9);
  eq('N 由调用方传入时才正确', modeToDeckLimit(deckLimitToMode(3), 3), 3);
  eq('标签:默认', deckLimitLabel(null), '默认 3 张');
  eq('标签:不限', deckLimitLabel(0), '不限');
  eq('标签:限N', deckLimitLabel(2), '限 2 张');
}

/* ────────── 输入校验 ────────── */
{
  eq('图标:https 通过', isUsableIconUrl('https://a.com/x.svg'), true);
  eq('图标:http 通过', isUsableIconUrl('http://a.com/x.png'), true);
  eq('图标:站内绝对路径通过', isUsableIconUrl('/runes/blue.svg'), true);
  eq('图标:协议相对通过', isUsableIconUrl('//cdn.a.com/x.svg'), true);
  eq('图标:data:image 通过', isUsableIconUrl('data:image/svg+xml;base64,AAA'), true);
  eq('图标:空值拒绝', isUsableIconUrl(''), false);
  eq('图标:null 拒绝', isUsableIconUrl(null), false);
  eq('图标:空白拒绝', isUsableIconUrl('   '), false);
  eq('图标:裸文件名拒绝', isUsableIconUrl('blue.svg'), false);
  eq('图标:javascript: 拒绝', isUsableIconUrl('javascript:alert(1)'), false);
  eq('图标:data:text/html 拒绝', isUsableIconUrl('data:text/html,<script>x</script>'), false);
}
{
  eq('系列代码:FND 通过', isUsableSeriesCode('FND'), true);
  eq('系列代码:含连字符通过', isUsableSeriesCode('S4-W3'), true);
  eq('系列代码:小写通过(库内大小写混用)', isUsableSeriesCode('ogn'), true);
  eq('系列代码:空拒绝', isUsableSeriesCode(''), false);
  eq('系列代码:含空格拒绝', isUsableSeriesCode('FND 1'), false);
  eq('系列代码:超长拒绝', isUsableSeriesCode('A'.repeat(17)), false);
  eq('系列代码:数字开头通过', isUsableSeriesCode('4TH'), true);
}
{
  eq('规则编号:053.1 通过', isUsableRuleNumber('053.1'), true);
  eq('规则编号:133.4.b 通过', isUsableRuleNumber('133.4.b'), true);
  eq('规则编号:000 通过', isUsableRuleNumber('000'), true);
  eq('规则编号:空拒绝', isUsableRuleNumber(''), false);
  eq('规则编号:字母开头拒绝', isUsableRuleNumber('A1'), false);
  eq('规则编号:含空格拒绝', isUsableRuleNumber('1 2'), false);
  eq('规则编号:超长拒绝', isUsableRuleNumber('1'.repeat(25)), false);
}

for (const r of out) {
  console.log(\`  \${r.ok ? '✓' : '✗'} \${r.label}\`);
  if (!r.ok) console.log(\`      got: \${JSON.stringify(r.actual)}\\n      want: \${JSON.stringify(r.wanted)}\`);
}
const bad = out.filter(r => !r.ok).length;
console.log(\`\\n──────── 结果:\${out.length - bad} 通过 / \${bad} 失败 ────────\`);
process.exit(bad === 0 ? 0 : 1);
`;

const out = spawnSync(
  process.execPath,
  ['--experimental-strip-types', '--input-type=module', '-e', runner],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
);
process.stdout.write((out.stdout || '').replace(/ExperimentalWarning[^\n]*\n?/g, ''));
if (out.status !== 0) {
  process.stderr.write((out.stderr || '').replace(/ExperimentalWarning[^\n]*\n?/g, ''));
}
process.exit(out.status ?? 1);
