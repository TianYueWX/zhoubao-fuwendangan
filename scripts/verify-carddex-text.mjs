/* ================================================================
 * scripts/verify-carddex-text.mjs
 *
 * 卡牌效果文本渲染(richText.ts)的离线回归。
 *
 * 锁的是一个**双重转义**事故:先整串转义、再在已转义的串上切 {{标记}},
 * 标记内层被转义两遍 —— `{{绝念>}}` 在详情弹窗里显示成字面的 `绝念&gt;`。
 * 连带损失更隐蔽:card_icons 里有 9 个名字自带 `>` 的条件变体图标
 * (绝念> / 迅捷> / 已强化> / 反应> / 等级3> / 等级6> / 等级11> / 等级16> / 鼓舞>),
 * 键被转义成 `绝念&gt;` 就一个都命中不了,69 张卡的条件变体图标集体退化成乱码文本。
 *
 * 运行:node --experimental-strip-types --import ./scripts/register-hooks.mjs scripts/verify-carddex-text.mjs
 * ============================================================== */

import { readFileSync } from 'node:fs';
import Papa from 'papaparse';

import {
  decodeHtmlEntities,
  escapeHtmlText,
  richEffectText
} from '../src/components/carddex/richText.ts';

let passed = 0;
const failures = [];

function check(name, cond, detail = '') {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function eq(name, actual, expected) {
  check(name, actual === expected, `期望 ${JSON.stringify(expected)},实得 ${JSON.stringify(actual)}`);
}

/** 把一段安全 HTML 还原成**屏幕上真正显示的文字**(剥标签 + 解实体一次) */
function visibleText(html) {
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, ''));
}

/* ── 条件变体图标:取自 card_icons(名字自带 '>')。URL 用占位符,只验查找键 ── */
const GT_ICONS = ['绝念>', '迅捷>', '已强化>', '反应>', '等级3>', '等级6>', '等级11>', '等级16>', '鼓舞>'];
const ICONS = [
  ...GT_ICONS.map((name) => ({ name, url: `https://icons.test/${encodeURIComponent(name)}.png`, isWhite: false })),
  { name: '绝念', url: 'https://icons.test/deathknell.png', isWhite: false },
  { name: '迅捷', url: 'https://icons.test/accelerate.png', isWhite: true }
];

console.log('\n[A] 基础转义');

eq('A1 纯文本 & < > " \' 各转义一次', escapeHtmlText(`a&b<c>d"e'f`), 'a&amp;b&lt;c&gt;d&quot;e&#39;f');
eq('A2 实体单趟还原,不解两次', decodeHtmlEntities('&amp;gt;'), '&gt;');
eq('A3 还原是真的还原', decodeHtmlEntities('绝念&gt;'), '绝念>');

console.log('\n[B] 条件标记 {{绝念>}}(本次事故的核心)');

const withIcon = richEffectText('{{绝念>}} 对一名敌方单位造成4点伤害。', ICONS);
check('B1 命中「绝念>」条件变体图标', withIcon.includes('icons.test/%E7%BB%9D%E5%BF%B5%3E.png'), withIcon);
check('B2 alt 是保真的 绝念>(单次转义)', withIcon.includes('alt="绝念&gt;"'), withIcon);
check('B3 输出里不存在二次转义 &amp;gt;', !withIcon.includes('&amp;gt;'), withIcon);
eq('B4 屏幕可见文字保真', visibleText(withIcon), ' 对一名敌方单位造成4点伤害。');

const noIcon = richEffectText('{{等级6>}} 若你控制六枚符文…', []);
check('B5 查不到图标时退回高亮文字,仍然保真', noIcon.includes('<strong>等级6&gt;</strong>'), noIcon);
check('B6 退回路径同样没有二次转义', !noIcon.includes('&amp;gt;'), noIcon);

console.log('\n[C] 双端写法与普通标记不受影响');

eq('C1 {{>绝念>}} 显示成 >绝念>', visibleText(richEffectText('{{>绝念>}} 召出两枚休眠的符文。', ICONS)), '>绝念> 召出两枚休眠的符文。');
eq('C2 {{绝念}} 仍走普通图标', (richEffectText('{{绝念}} 抽一张牌。', ICONS).match(/<img /g) ?? []).length, 1);
check('C3 白色图标带 white-source 类', richEffectText('{{迅捷}}', ICONS).includes('effect-icon white-source'));
eq('C4 无标记文本原样显示', visibleText(richEffectText('普通文本，无标记。', ICONS)), '普通文本，无标记。');
eq('C5 换行变 <br>', richEffectText('第一行\n第二行', ICONS), '第一行<br>第二行');
eq('C6 空输入返回空串', richEffectText('', ICONS), '');

console.log('\n[D] XSS 面:标记内层与图标 URL 都必须被转义');

const evil = richEffectText('{{"><script>alert(1)</script>}}', []);
check('D1 标记内层不含可执行标签', !/<script/i.test(evil), evil);
check('D2 尖括号被转义', evil.includes('&lt;script&gt;'), evil);
const evilIcon = richEffectText('{{绝念}}', [{ name: '绝念', url: 'x" onerror="alert(1)', isWhite: false }]);
check('D3 图标 URL 里的引号被转义', !/onerror="alert/.test(evilIcon), evilIcon);

console.log('\n[E] 全量回归:971 张真实卡面文本');

const csv = readFileSync(new URL('../public/data/cards_base_rows.csv', import.meta.url), 'utf8');
const { data } = Papa.parse(csv, { header: true, skipEmptyLines: true });
const cards = data.filter((r) => r.effect_cn);

let doubleEscaped = [];
let unconsumed = [];
let gtMarks = 0;
let gtMarksWithIcon = 0;
let gtMarksExpectedIcon = 0;

for (const row of cards) {
  const html = richEffectText(row.effect_cn, ICONS);
  const text = visibleText(html);
  // 二次转义的指纹:可见文字里出现字面量 &gt; / &lt; / &amp;
  if (/&(gt|lt|amp|quot|#39);/.test(text)) doubleEscaped.push(row.card_no);
  // 标记必须全部被消费掉
  if (text.includes('{{') || text.includes('}}')) unconsumed.push(row.card_no);
  for (const m of row.effect_cn.match(/\{\{[^{}]*>\}\}/g) ?? []) {
    gtMarks++;
    const mark = m.slice(2, -2).trim();
    if (!GT_ICONS.includes(mark)) continue;
    gtMarksExpectedIcon++;
    if (html.includes(`icons.test/${encodeURIComponent(mark)}.png`)) gtMarksWithIcon++;
  }
}

check('E1 没有一张卡出现字面量实体(双重转义指纹)', doubleEscaped.length === 0, `命中 ${doubleEscaped.length} 张: ${doubleEscaped.slice(0, 8).join(', ')}`);
check('E2 没有残留未消费的 {{标记}}', unconsumed.length === 0, `命中 ${unconsumed.length} 张: ${unconsumed.slice(0, 8).join(', ')}`);
check('E3 带 > 的标记确实存在(样本有效)', gtMarks >= 60, `实测 ${gtMarks} 处`);
check(
  'E4 有对应条件变体图标的标记,一处不漏地命中图标',
  gtMarksExpectedIcon > 0 && gtMarksWithIcon === gtMarksExpectedIcon,
  `${gtMarksWithIcon}/${gtMarksExpectedIcon} 处命中(全量 ${gtMarks} 处带 > 标记)`
);

console.log('\n[F] 事故实例逐张核对');

const CASES = [
  ['UNL-067', '破败大鲨炮', '绝念>'],
  ['UNL-031', '实战经验', '等级6>'],
  ['VEN-050', '凶暴的岩熊', '已强化>'],
  ['VEN-078', '枯爪巴凯', '绝念>']
];
for (const [cardNo, name, mark] of CASES) {
  const row = cards.find((r) => r.card_no === cardNo);
  if (!row) {
    check(`F ${cardNo} ${name} 在卡表里`, false, '未找到该卡号');
    continue;
  }
  const html = richEffectText(row.effect_cn, ICONS);
  check(`F ${cardNo} ${name} 显示为 ${mark} 而非 ${mark.replace('>', '&gt;')}`, !visibleText(html).includes('&gt;'), visibleText(html).slice(0, 40));
}

console.log('\n== 结果 ==');
if (failures.length) {
  for (const f of failures) console.log('  ✗', f);
  console.log(`${passed}/${passed + failures.length} 项通过`);
  process.exitCode = 1;
} else {
  console.log(`${passed}/${passed} 项通过`);
}
