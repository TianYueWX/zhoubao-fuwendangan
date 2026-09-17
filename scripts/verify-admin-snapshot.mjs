/* ================================================================
 * scripts/verify-admin-snapshot.mjs
 *
 * 卡表快照导出验收 —— 这是编辑部与周报站之间唯一的交付物,
 * 格式错一处,站点侧是**静默失效**(颜色丢失、卡图关联落空),不会有任何报错。
 *
 * 因此这里直接把生成的表头与仓库里现有文件逐字比对,而不是只测自己的常量。
 *
 *   node --experimental-strip-types scripts/verify-admin-snapshot.mjs
 * ================================================================ */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const target = resolve(root, 'src/tools/sync/snapshot.ts');

/*
 * 仓库现有文件由 runner 自己读,不从这里传 ——
 * 单个命令行参数上限是 MAX_ARG_STRLEN(128KB),而 cards CSV 有 0.58MB,
 * 塞进 -e 会直接 E2BIG 失败(且不报错,只留一个空输出)。
 */
const rootArg = JSON.stringify(root);

const runner = `
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CARDS_BASE_SNAPSHOT_COLUMNS, CARD_PRINTS_SNAPSHOT_COLUMNS,
  SNAPSHOT_JSON_ARRAY_FIELDS, cardsBaseSnapshotCsv, cardPrintsSnapshotCsv, checkSnapshot,
  splitCsvLine, splitCsvRecords
} from ${JSON.stringify(target)};

const ROOT = ${rootArg};
const REAL_CARDS_RAW = readFileSync(resolve(ROOT, 'public/data/cards_base_rows.csv'), 'utf8');
const REAL_PRINTS_RAW = readFileSync(resolve(ROOT, 'public/data/card_prints_rows.csv'), 'utf8');
const REAL_CARDS_HEADER = REAL_CARDS_RAW.split('\\n')[0];
const REAL_PRINTS_HEADER = REAL_PRINTS_RAW.split('\\n')[0];

const out = [];
const eq = (label, actual, wanted) =>
  out.push({ label, ok: JSON.stringify(actual) === JSON.stringify(wanted), actual, wanted });

/* ────────── 表头必须与仓库现有文件逐字一致 ────────── */
eq('cards_base 表头与现有文件逐字一致',
  CARDS_BASE_SNAPSHOT_COLUMNS.join(','), REAL_CARDS_HEADER);
eq('card_prints 表头与现有文件逐字一致',
  CARD_PRINTS_SNAPSHOT_COLUMNS.join(','), REAL_PRINTS_HEADER);
eq('现有 cards 文件确实无 BOM', REAL_CARDS_RAW.startsWith('\\uFEFF'), false);
eq('现有 cards 文件确实用 LF', REAL_CARDS_RAW.includes('\\r\\n'), false);

/* ────────── 生成结果的格式 ────────── */
const cardRow = {
  id: 'uuid-1', card_no: 'UNL-122', card_name_cn: '新月禁卫',
  card_color_list: ['purple'], region: ['巨神峰'], tag: [],
  keyword: [], advanced_tag: ['费用·可选额外', '状态·以活跃进场'],
  card_category: ['单位'], energy: 4, power: 4, is_banned: false,
  flavor_text_cn: null, created_at: '2026-06-18 15:11:45.821819+00',
  updated_at: '2026-08-23 07:53:09+00', deck_limit: null
};
const cardsCsv = cardsBaseSnapshotCsv([cardRow]);
eq('生成的 cards 表头与现有文件一致',
  cardsCsv.split('\\n')[0], REAL_CARDS_HEADER);
eq('生成结果无 BOM', cardsCsv.startsWith('\\uFEFF'), false);
eq('生成结果用 LF', cardsCsv.includes('\\r'), false);
eq('末尾有且只有一个换行',
  cardsCsv.endsWith('\\n') && !cardsCsv.endsWith('\\n\\n'), true);

const cells = splitCsvLine(cardsCsv.split('\\n')[1]);

/* ────────── 数组列必须是 JSON(站点用 JSON.parse 读)────────── */
for (const f of SNAPSHOT_JSON_ARRAY_FIELDS) {
  const idx = CARDS_BASE_SNAPSHOT_COLUMNS.indexOf(f);
  const raw = cells[idx];
  let ok = false, parsed = null;
  try { parsed = JSON.parse(raw); ok = Array.isArray(parsed); } catch { ok = false; }
  eq(\`\${f} 是合法 JSON 数组\`, ok, true);
}
eq('card_color_list 编码为 ["purple"]',
  cells[CARDS_BASE_SNAPSHOT_COLUMNS.indexOf('card_color_list')], '["purple"]');
eq('region 编码为 ["巨神峰"]',
  cells[CARDS_BASE_SNAPSHOT_COLUMNS.indexOf('region')], '["巨神峰"]');
eq('空数组编码为 []',
  cells[CARDS_BASE_SNAPSHOT_COLUMNS.indexOf('tag')], '[]');
eq('null 编码为空单元格',
  cells[CARDS_BASE_SNAPSHOT_COLUMNS.indexOf('flavor_text_cn')], '');
eq('boolean 编码为 true/false 小写',
  cells[CARDS_BASE_SNAPSHOT_COLUMNS.indexOf('is_banned')], 'false');
eq('含逗号/引号的数组元素被正确转义',
  JSON.parse(cells[CARDS_BASE_SNAPSHOT_COLUMNS.indexOf('advanced_tag')]),
  ['费用·可选额外', '状态·以活跃进场']);

/* ────────── 与现有文件的真实行对拍 ────────── */
const realCells = splitCsvLine(REAL_CARDS_RAW.split('\\n')[1]);
eq('现有文件首行能按同样规则拆出 26 格', realCells.length, 26);
eq('现有文件 card_color_list 也是 JSON',
  Array.isArray(JSON.parse(realCells[CARDS_BASE_SNAPSHOT_COLUMNS.indexOf('card_color_list')])), true);

/* ────────── prints ────────── */
const printCsv = cardPrintsSnapshotCsv([{
  id: 'p1', card_id: 'uuid-1', card_no_extend: 'OGN-308', rarity_name: '异画',
  extend_rarity_name: '超编', back_image: '', language: 'EN', img_cdn: 'https://x/y.png',
  tts_cdn: null, artist: 'Rudy, S.', print_order: 0, is_default: false,
  created_at: '2026-06-18 16:41:39+00', updated_at: '2026-08-23 07:53:09+00',
  is_promo: false, series: 'OGN', flavor_text_cn: null, flavor_text_en: null
}]);
eq('生成的 prints 表头与现有文件一致', printCsv.split('\\n')[0], REAL_PRINTS_HEADER);
eq('prints 里含逗号的画师名被加引号',
  printCsv.split('\\n')[1].includes('"Rudy, S."'), true);

/* ────────── 自检函数 ────────── */
const good = checkSnapshot(cardsCsv, printCsv);
eq('合规快照通过自检', good.ok, true);
eq('自检无问题项', good.problems, []);

const withBom = checkSnapshot('\\uFEFF' + cardsCsv, printCsv);
eq('带 BOM 被自检拦下', withBom.ok, false);
eq('BOM 问题被点名', withBom.problems.some(p => p.includes('BOM')), true);

// 直接替换文本,别走 split→join:那会丢掉引号,反而先触发格数检查
const pgArrayStyle = cardsCsv.replace('"[""purple""]"', '{purple}');
eq('坏样例确实含 PG 风格数组', pgArrayStyle.includes('{purple}'), true);
const badArr = checkSnapshot(pgArrayStyle, printCsv);
eq('PG 数组格式被自检拦下(站点会解析失败)', badArr.ok, false);
eq('数组问题被点名', badArr.problems.some(p => p.includes('JSON')), true);

eq('行数统计正确', good.cards, 1);
const crCsv = cardsCsv.split('\\n').join('\\r\\n');
eq('CR 换行被自检拦下',
  checkSnapshot(crCsv, printCsv).problems.some(p => p.includes('CR')), true);

/* ────────── 记录内的换行:必须按记录切分而不是按物理行 ────────── */
{
  const multi = {
    ...cardRow,
    card_no: 'MULTI-1',
    effect_cn: '第一行\\n第二行\\n第三行',
    effect_en: '<p>a</p>\\n<p>b</p>'
  };
  const csv = cardsBaseSnapshotCsv([multi]);
  eq('含换行的值被引号包住(不会撑破记录)', /"第一行\\n第二行\\n第三行"/.test(csv), true);
  // 3 个内嵌换行(effect_cn 两个 + effect_en 一个)+ 表头行 + 末尾换行 = 5 个 \\n
  eq('按物理行切会多出 3 行', csv.split('\\n').length - 1, 5);
  eq('按 CSV 记录切只有 1 条', splitCsvRecords(csv).filter(r => r !== '').length, 2);
  const rec = splitCsvRecords(csv).filter(r => r !== '')[1];
  eq('切回后格数仍然正确', splitCsvLine(rec).length, 26);
  eq('换行内容完整保留',
    splitCsvLine(rec)[CARDS_BASE_SNAPSHOT_COLUMNS.indexOf('effect_cn')],
    '第一行\\n第二行\\n第三行');
  const chk = checkSnapshot(csv, printCsv);
  eq('含换行的快照自检通过', chk.ok, true);
  eq('记录数统计正确(按记录而非物理行)', chk.cards, 1);
}

/* ────────── CRLF 归一化 ────────── */
{
  const crlfRow = { ...cardRow, card_no: 'CRLF-1', effect_cn: '甲\\r\\n乙\\r丙' };
  const csv = cardsBaseSnapshotCsv([crlfRow]);
  eq('库里的 CRLF 被归一为 LF', csv.includes('\\r'), false);
  const rec = splitCsvRecords(csv).filter(r => r !== '')[1];
  eq('归一后内容为 LF', splitCsvLine(rec)[CARDS_BASE_SNAPSHOT_COLUMNS.indexOf('effect_cn')], '甲\\n乙\\n丙');
  eq('归一后自检通过', checkSnapshot(csv, printCsv).ok, true);
}

/* ────────── 列错位必须被检出 ────────── */
{
  const recs = splitCsvRecords(cardsCsv).filter(r => r !== '');
  const broken = recs[0] + '\\n' + recs[1].replace(',', ',,') + '\\n';
  const chk = checkSnapshot(broken, printCsv);
  eq('格数错位被自检拦下', chk.ok, false);
  eq('错位问题被点名', chk.problems.some(p => p.includes('格数')), true);
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
