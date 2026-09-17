/* ================================================================
 * scripts/verify-admin-sync.mjs
 *
 * 同步导出层验收(sync/exporters.ts,零运行时依赖,可直接跑)。
 *
 * 两件必须证明的事:
 *   ① is_banned 默认**不出现**在任何产出里 —— 搬迁前它是被静默覆盖的,
 *      这个修复如果失效,编务手工调的禁限表会在一次同步后消失。
 *   ② 列与值**不错位** —— exporters 用「列名 → 字面量」映射代替数组,
 *      正是为了杜绝错位;这里用带特征的取值逐列核对。
 *
 *   node --experimental-strip-types scripts/verify-admin-sync.mjs
 * ================================================================ */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, '../src/tools/sync/exporters.ts');

const runner = `
import {
  CARDS_BASE_COLUMNS, CARDS_BASE_OPTIONAL_COLUMNS, cardsBaseColumns,
  buildCardsBaseSql, cardsBaseCsv, buildCardPrintsSql, cardPrintsCsv,
  buildCardIconsSql, buildSeriesPresetSql, buildSyncSql, sqlStr
} from ${JSON.stringify(target)};

const out = [];
const eq = (label, actual, wanted) =>
  out.push({ label, ok: JSON.stringify(actual) === JSON.stringify(wanted), actual, wanted });
const ok = (label, cond, detail = '') =>
  out.push({ label, ok: !!cond, actual: detail, wanted: 'truthy' });
const notOk = (label, cond, detail = '') =>
  out.push({ label, ok: !cond, actual: detail, wanted: 'falsy' });

/* 一行取值都带特征,便于逐列核对不错位 */
const card = {
  card_no: 'AAA-001',
  card_name_cn: 'CN名字',
  sub_title_cn: 'CN副题',
  card_color_list: ['red', 'blue'],
  region: ['地区A'],
  tag: ['标签A'],
  champion_tag: 'CHAMP',
  effect_cn: 'CN效果',
  flavor_text_cn: 'CN风味',
  energy: 1, return_energy: 2, power: 3,
  rarity_name: '稀有度A',
  series_name: 'SERIES_A',
  card_category: ['单位'],
  is_banned: true
};

/* ────────── ① is_banned 默认被排除 ────────── */
notOk('CARDS_BASE_COLUMNS 不含 is_banned',
  CARDS_BASE_COLUMNS.includes('is_banned'));
eq('可选列就是 is_banned', CARDS_BASE_OPTIONAL_COLUMNS, ['is_banned']);
notOk('默认列集不含 is_banned', cardsBaseColumns(false).includes('is_banned'));
ok('勾选后含 is_banned', cardsBaseColumns(true).includes('is_banned'));
eq('勾选后列数 +1', cardsBaseColumns(true).length, cardsBaseColumns(false).length + 1);

const sqlDefault = buildCardsBaseSql([card]);
const sqlWithBan = buildCardsBaseSql([card], { includeBanList: true });
notOk('默认 SQL 不含 is_banned 列', sqlDefault.includes('"is_banned"'));
notOk('默认 SQL 不含 true 字面量(卡本身是禁卡)', /,\\s*true\\s*\\)/.test(sqlDefault));
ok('勾选后 SQL 含 is_banned 列', sqlWithBan.includes('"is_banned"'));
ok('勾选后写入 true', /true/.test(sqlWithBan.split('values')[1] ?? ''));

const csvDefault = cardsBaseCsv([card]);
const csvWithBan = cardsBaseCsv([card], { includeBanList: true });
notOk('默认 CSV 表头不含 is_banned', csvDefault.split('\\n')[0].includes('is_banned'));
ok('勾选后 CSV 表头含 is_banned', csvWithBan.split('\\n')[0].includes('is_banned'));

/* ────────── ② 列与值不错位 ────────── */
/* 同步 CSV 是 BOM + CRLF(给 Table Editor 导入),切行后必须去掉 \r 与 BOM,
   否则最后一个列名会变成 "card_category\r" 而 indexOf 查不到。 */
ok('同步 CSV 带 BOM + CRLF(与 snapshot 的无 BOM + LF 刻意不同)',
  csvDefault.startsWith('\\uFEFF') && csvDefault.includes('\\r\\n'));
const header = csvDefault.split('\\n')[0].replace(/^\\uFEFF/, '').split(',')
  .map((s) => s.replace(/\\r$/, ''));
const cells = csvDefault.split('\\n')[1].replace(/\\r$/, '');
const cells2 = (() => {
  const out2 = []; let cur = ''; let q = false;
  for (let i = 0; i < cells.length; i++) {
    const ch = cells[i];
    if (q) { if (ch === '"') { if (cells[i+1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { out2.push(cur); cur = ''; }
    else cur += ch;
  }
  out2.push(cur); return out2;
})();
const at = (name) => cells2[header.indexOf(name)];
eq('card_no 对位', at('card_no'), 'AAA-001');
eq('card_name_cn 对位', at('card_name_cn'), 'CN名字');
eq('sub_title_cn 对位', at('sub_title_cn'), 'CN副题');
eq('champion_tag 对位', at('champion_tag'), 'CHAMP');
eq('effect_cn 对位', at('effect_cn'), 'CN效果');
eq('flavor_text_cn 对位', at('flavor_text_cn'), 'CN风味');
eq('energy 对位', at('energy'), '1');
eq('return_energy 对位', at('return_energy'), '2');
eq('power 对位', at('power'), '3');
eq('rarity_name 对位', at('rarity_name'), '稀有度A');
eq('series_name 对位', at('series_name'), 'SERIES_A');
/* 注意:同步 CSV 用 **PG 数组格式**(给 Table Editor / SQL 导入),
   与 snapshot.ts 的 **JSON 格式**(给周报站 JSON.parse)刻意不同。
   两者混用会导致一侧静默失效,见 snapshot.ts 顶部注释。 */
eq('数组列对位(PG 格式 {red,blue})', at('card_color_list'), '{red,blue}');
eq('数组列对位(region 中文)', at('region'), '{地区A}');
eq('数组列对位(card_category)', at('card_category'), '{单位}');
eq('空数组编码为 {}', at('tag'), '{标签A}');
eq('总格数等于列表头数', cells2.length, header.length);

/* 两条产出线格式必须不同 —— 这是刻意设计,不是疏漏 */
{
  const snap = await import(${JSON.stringify(resolve(here, '../src/tools/sync/snapshot.ts'))});
  const snapCsv = snap.cardsBaseSnapshotCsv([{
    card_no: 'AAA-001', card_color_list: ['red', 'blue'], region: ['地区A'],
    tag: [], keyword: [], advanced_tag: [], card_category: ['单位']
  }]);
  const snapCells = snap.splitCsvLine(snapCsv.split('\\n')[1]);
  const snapHeader = snapCsv.split('\\n')[0].split(',');
  eq('snapshot 用 JSON 数组(站点要 JSON.parse)',
    snapCells[snapHeader.indexOf('card_color_list')], '["red","blue"]');
  ok('同一份数据两条线产出不同格式(刻意)',
    at('card_color_list') === '{red,blue}' &&
    snapCells[snapHeader.indexOf('card_color_list')] === '["red","blue"]');
}

/* SQL 里的列顺序与值顺序必须一一对应 */
{
  // 用**单元素数组**做对位检查:array['a', 'b'] 内部的 ", " 会打乱朴素切分,
  // 那是切分器的局限,不是列值错位。
  const plain = {
    ...card,
    card_color_list: ['red'],
    region: ['地区A'],
    tag: ['标签A'],
    card_category: ['单位']
  };
  const sql = buildCardsBaseSql([plain]);
  const cols = sql.match(/insert into public\\.cards_base \\(([^)]+)\\)/)[1]
    .split(',').map((s) => s.trim().replace(/"/g, ''));
  const vals = sql.split('values')[1].split('\\n')[1].trim().replace(/^\\(/, '').replace(/\\),?$/, '');
  const parts = vals.split(', ');
  eq('SQL 列数与列表头数一致', cols.length, header.length);
  eq('SQL 值个数与列数一致', parts.length, cols.length);
  eq('card_name_cn 对位', parts[cols.indexOf('card_name_cn')], "'CN名字'");
  eq('champion_tag 对位', parts[cols.indexOf('champion_tag')], "'CHAMP'");
  eq('energy 对位', parts[cols.indexOf('energy')], '1');
  eq('rarity_name 对位', parts[cols.indexOf('rarity_name')], "'稀有度A'");
  eq('series_name 对位', parts[cols.indexOf('series_name')], "'SERIES_A'");
  eq('card_category 对位', parts[cols.indexOf('card_category')], "array['单位']::text[]");
}

/* ────────── ③ 人工维护列永不出现 ────────── */
for (const col of ['keyword', 'advanced_tag', 'deck_limit', 'effect_en', 'card_name_en', 'flavor_text_en', 'sub_title_en']) {
  notOk(\`默认 SQL 不含人工维护列 \${col}\`, sqlDefault.includes(\`"\${col}"\`));
  notOk(\`默认 CSV 不含人工维护列 \${col}\`, csvDefault.split('\\n')[0].includes(col));
}

/* ────────── ④ 转义 ────────── */
eq('单引号被转义', sqlStr("O'Brien"), "'O''Brien'");
eq('null 输出 NULL', sqlStr(null), 'NULL');
ok('含单引号的卡名在 SQL 里安全',
  buildCardsBaseSql([{ ...card, card_name_cn: "a'b" }]).includes("'a''b'"));

/* ────────── ⑤ 印刷版本 / 图标 / 系列 ────────── */
const printSql = buildCardPrintsSql([{
  base_card_no: 'AAA-001', card_no_extend: 'AAA-001a', language: 'SC',
  rarity_name: 'R', extend_rarity_name: null, img_cdn: 'https://x/y.png',
  back_image: '', artist: 'A', series: 'SERIES_A', flavor_text_cn: null, is_promo: false
}]);
ok('印刷版本用子查询解析 card_id',
  printSql.includes('(select id from public.cards_base where card_no = \\'AAA-001\\')'));
ok('印刷版本 on conflict 用 (card_no_extend, language)',
  printSql.includes('on conflict ("card_no_extend", "language")'));
notOk('印刷版本不含 tts_cdn(人工维护列)', printSql.includes('"tts_cdn"'));
notOk('印刷版本不含 print_order(人工维护列)', printSql.includes('"print_order"'));
notOk('印刷版本不含 is_default(人工维护列)', printSql.includes('"is_default"'));

const iconSql = buildCardIconsSql([{
  name_zh: '待命', name_en: '', url: 'https://x/y.png', storage_type: 'online', isWhite: false
}]);
ok('图标 on conflict 用 (name_zh)', iconSql.includes('on conflict ("name_zh")'));
notOk('图标更新时不覆盖 name_en(人工维护列)',
  /update set[\\s\\S]*"name_en" = excluded/.test(iconSql));

const seriesSql = buildSeriesPresetSql([{ code: 'ZZZ', name_cn: 'ZZZ', name_en: 'ZZZ', release_order: 0 }]);
ok('系列预置 on conflict do nothing', seriesSql.includes('on conflict ("code") do nothing'));

/* ────────── ⑥ 整包 SQL 的头部声明 ────────── */
const pkgDefault = buildSyncSql({ cards: [card], includeBanList: false });
const pkgWithBan = buildSyncSql({ cards: [card], includeBanList: true });
ok('默认整包声明「不含 is_banned」', pkgDefault.includes('本次不含 is_banned'));
ok('默认整包不含 is_banned 列', !pkgDefault.includes('"is_banned"'));
ok('勾选后整包显式告警', pkgWithBan.includes('本次包含 is_banned'));
ok('整包是事务包裹', pkgDefault.includes('begin;') && pkgDefault.includes('commit;'));
ok('整包末尾触碰 version', pkgDefault.includes("name in ('cards','prints','icons')"));

for (const r of out) {
  console.log(\`  \${r.ok ? '✓' : '✗'} \${r.label}\`);
  if (!r.ok) console.log(\`      got: \${JSON.stringify(r.actual)}\\n      want: \${JSON.stringify(r.wanted)}\`);
}
const bad = out.filter(r => !r.ok).length;
console.log(\`\\n──────── 结果:\${out.length - bad} 通过 / \${bad} 失败 ────────\`);
process.exit(bad === 0 ? 0 : 1);
`;

const res = spawnSync(
  process.execPath,
  ['--experimental-strip-types', '--input-type=module', '-e', runner],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
);
process.stdout.write((res.stdout || '').replace(/ExperimentalWarning[^\n]*\n?/g, ''));
if (res.status !== 0) {
  process.stderr.write((res.stderr || '').replace(/ExperimentalWarning[^\n]*\n?/g, ''));
}
process.exit(res.status ?? 1);
