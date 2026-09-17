/* ================================================================
 * scripts/verify-admin-rules.mjs
 *
 * 规则树纯逻辑验收(零依赖,直接跑 TS 源码)。
 *
 * 重点验**环**:库里改父规则没有数据库层约束,一旦把某节点的父设成
 * 自己的后代就成环,而递归渲染会栈溢出。buildRuleTree 必须对已存在的
 * 环免疫,parentOptions 必须阻止新环产生。
 *
 *   node --experimental-strip-types scripts/verify-admin-rules.mjs
 * ================================================================ */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, '../src/tools/admin/rulesTree.ts');

const runner = `
import {
  buildRuleTree, hasChildren, nextSortOrder, collectDescendants, wouldCreateCycle,
  ancestorPath, filterByBook, bookCounts, matchRules, defaultExpanded
} from ${JSON.stringify(target)};

const out = [];
const eq = (label, actual, wanted) =>
  out.push({ label, ok: JSON.stringify(actual) === JSON.stringify(wanted), actual, wanted });

const R = (rule_number, parent_number = null, extra = {}) => ({
  id: 'id-' + rule_number, rule_number, parent_number,
  level: null, is_heading: false, text_zh: null, text_en: null,
  sort_order: 0, rules_book: '核心规则_260717', ...extra
});
const shape = (nodes) => nodes.map(n => [
  n.rule.rule_number,
  n.children.length ? shape(n.children) : 0
]);

/* ────────── 基本建树 ────────── */
{
  const rules = [R('1'), R('1.1', '1'), R('1.2', '1'), R('2')];
  eq('按 parent_number 归位', shape(buildRuleTree(rules)), [['1', [['1.1', 0], ['1.2', 0]]], ['2', 0]]);
}
{
  // 父不在集合内(例如父属于另一本规则书)→ 当根
  const rules = [R('9.1', '9')];
  eq('父缺失的节点降级为根', shape(buildRuleTree(rules)), [['9.1', 0]]);
}
{
  const rules = [R('A', 'A')];
  eq('父指向自己 → 当根(不成环)', shape(buildRuleTree(rules)), [['A', 0]]);
}
{
  // 两节点环
  const rules = [R('A', 'B'), R('B', 'A')];
  eq('两节点环被拆开,两者都成根', shape(buildRuleTree(rules)), [['A', 0], ['B', 0]]);
}
{
  // 三节点环
  const rules = [R('A', 'B'), R('B', 'C'), R('C', 'A')];
  eq('三节点环被拆开', shape(buildRuleTree(rules)).length, 3);
}
{
  // 环外挂一个正常子节点:不能因为环而丢节点,也不能死循环
  const rules = [R('A', 'B'), R('B', 'A'), R('D', 'A')];
  const t = buildRuleTree(rules);
  const flat = [];
  const walk = (ns) => ns.forEach(n => { flat.push(n.rule.rule_number); walk(n.children); });
  walk(t);
  eq('环外节点不丢失', flat.sort(), ['A', 'B', 'D']);
}
{
  const rules = [R('1'), R('1.2', '1', { sort_order: 2 }), R('1.1', '1', { sort_order: 1 })];
  eq('兄弟按 sort_order 排序', shape(buildRuleTree(rules)), [['1', [['1.1', 0], ['1.2', 0]]]]);
}
{
  const rules = [R('1'), R('1.b', '1', { sort_order: 5 }), R('1.a', '1', { sort_order: 5 })];
  eq('排序号相同则按编号兜底', shape(buildRuleTree(rules)), [['1', [['1.a', 0], ['1.b', 0]]]]);
}
{
  eq('空集合返回空树', buildRuleTree([]), []);
}

/* ────────── 关系判定 ────────── */
{
  const rules = [R('1'), R('1.1', '1'), R('1.1.1', '1.1'), R('2')];
  eq('hasChildren: 有子', hasChildren(rules, '1'), true);
  eq('hasChildren: 叶子', hasChildren(rules, '2'), false);
  eq('collectDescendants 取全部层级', collectDescendants(rules, '1').sort(), ['1.1', '1.1.1']);
  eq('collectDescendants: 叶子为空', collectDescendants(rules, '2'), []);
  eq('ancestorPath 从根到父', ancestorPath(rules, '1.1.1'), ['1', '1.1']);
  eq('ancestorPath: 根为空', ancestorPath(rules, '1'), []);
  eq('nextSortOrder = 兄弟最大 + 1', nextSortOrder(rules, '1'), 1);
  eq('nextSortOrder: 新父下的第一个', nextSortOrder(rules, '2'), 1);
}

/* ────────── 防环 ────────── */
{
  const rules = [R('1'), R('1.1', '1'), R('1.1.1', '1.1'), R('1.2', '1')];
  eq('不能把自己设为父', wouldCreateCycle(rules, '1', '1'), true);
  eq('不能把子设为父', wouldCreateCycle(rules, '1', '1.1'), true);
  eq('不能把孙设为父', wouldCreateCycle(rules, '1', '1.1.1'), true);
  eq('不能把父设成自己的子(1.1 → 1.1.1)', wouldCreateCycle(rules, '1.1', '1.1.1'), true);
  eq('可以挂到无关节点', wouldCreateCycle(rules, '1.1.1', '2'), false);
  eq('父置空永远合法', wouldCreateCycle(rules, '1', null), false);
  eq('真兄弟之间不成环', wouldCreateCycle(rules, '1.1', '1.2'), false);
}

/* ────────── 检索(中文子串,替代不可用的 FTS)────────── */
{
  const rules = [
    R('107.1', null, { text_zh: '基地', text_en: 'Bases' }),
    R('133.4.b', null, { text_zh: '如果你在本回合打出过法术,则…', text_en: 'If you played a spell' }),
    R('200', null, { text_zh: '伤害与治疗', text_en: 'Damage and Healing' })
  ];
  eq('中文子串命中句中', matchRules(rules, '法术').map(r => r.rule_number), ['133.4.b']);
  eq('中文子串命中词首', matchRules(rules, '伤害').map(r => r.rule_number), ['200']);
  eq('编号子串命中', matchRules(rules, '107').map(r => r.rule_number), ['107.1']);
  eq('英文大小写不敏感', matchRules(rules, 'SPELL').map(r => r.rule_number), ['133.4.b']);
  eq('无匹配返回空', matchRules(rules, '不存在的词'), []);
  eq('空查询返回空(不返回全量)', matchRules(rules, '   '), []);
}
{
  const rules = [R('1', null, { rules_book: '核心规则_A' }), R('2', null, { rules_book: '核心规则_B' })];
  eq('按规则书过滤', filterByBook(rules, '核心规则_A').map(r => r.rule_number), ['1']);
  eq("'' 表示全部", filterByBook(rules, '').length, 2);
  eq('书计数', bookCounts(rules), [{ name: '核心规则_A', count: 1 }, { name: '核心规则_B', count: 1 }]);
  eq('无 rules_book 归入未分类',
    bookCounts([R('3', null, { rules_book: null })]), [{ name: '（未分类）', count: 1 }]);
}
{
  const rules = [R('1', null, { level: 0 }), R('1.1', '1', { level: 1 }), R('1.1.1', '1.1', { level: 2 })];
  eq('默认只展开顶层', defaultExpanded(rules, 1), ['1']);
  eq('depth=2 时展开两层', defaultExpanded(rules, 2), ['1', '1.1']);
  eq('叶子不入展开集合', defaultExpanded([R('9')], 3), []);
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
