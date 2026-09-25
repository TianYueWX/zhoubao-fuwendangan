/* ================================================================
 * scripts/verify-lua-export.mjs
 *
 * TTS mod Lua 导出验收(纯逻辑,不连库)。
 *
 *   node --experimental-strip-types --import ./scripts/register-hooks.mjs scripts/verify-lua-export.mjs
 *
 * 重点是三件容易静默出错的事:
 *   ① 换行 / 引号 / 反斜杠的 Lua 转义(库里的 effect_cn 是 CRLF);
 *   ② rarity_name 必须取基础卡,不能被异画印刷版的「异画」覆盖;
 *   ③ is_promo 必须是布尔字面量,不能变成字符串或 nil。
 * ================================================================ */
import assert from 'node:assert/strict';
import {
  buildAllCardsLua,
  buildLuaEntries,
  escapeLuaString,
  luaValue,
  renderAllCardsLua
} from '../src/tools/admin/luaExport.ts';

let passed = 0;
function test(label, fn) {
  fn();
  passed++;
  console.log(`✓ ${label}`);
}

/* ────────── 转义 ────────── */
test('Lua 转义:反斜杠 / 双引号 / CRLF·CR·LF 统一为 \\n', () => {
  assert.equal(escapeLuaString('a\\b'), 'a\\\\b');
  assert.equal(escapeLuaString('say "hi"'), 'say \\"hi\\"');
  assert.equal(escapeLuaString('甲\r\n乙\r丙\n丁'), '甲\\n乙\\n丙\\n丁');
});

test('null / undefined / 空串 → nil,其余加引号', () => {
  assert.equal(luaValue(null), 'nil');
  assert.equal(luaValue(undefined), 'nil');
  assert.equal(luaValue(''), 'nil');
  assert.equal(luaValue('蔚'), '"蔚"');
});

/* ────────── fixtures ────────── */
const baseA = {
  id: 'a1',
  card_name_cn: '蔚',
  sub_title_cn: '铲除者',
  effect_cn: '第一行\r\n第二行 "引号" \\反斜杠',
  card_category: ['英雄单位'],
  rarity_name: '异画',
  series_name: 'ARC'
};
const baseB = {
  id: 'b1',
  card_name_cn: '炽烈符文',
  sub_title_cn: null,
  effect_cn: null,
  card_category: ['符文'],
  rarity_name: '普通',
  series_name: 'OGN'
};
const printA = {
  card_id: 'a1',
  card_no_extend: 'ARC-001',
  img_cdn: 'https://cdn/arc-001.png',
  back_image: 'https://back/arc.png',
  extend_rarity_name: '异画',
  series: null,
  is_promo: false
};
const printB = {
  card_id: 'b1',
  card_no_extend: 'OGN-007a',
  img_cdn: 'https://cdn/ogn-007a.png',
  back_image: 'https://back/ogn.png',
  extend_rarity_name: '异画',
  series: 'OGN',
  is_promo: true
};

/* ────────── 字段映射与排序 ────────── */
test('字段映射:图取印刷版、稀有度取基础卡、条目按 card_no 排序', () => {
  const { entries } = buildLuaEntries([baseA, baseB], [printB, printA]);
  assert.equal(entries.length, 2);
  const [a, b] = entries;
  assert.equal(a.card_no, 'ARC-001');
  assert.equal(a.card_name, '蔚');
  assert.equal(a.sub_title, '铲除者');
  assert.equal(a.front_image_en, 'https://cdn/arc-001.png');
  assert.equal(a.back_image, 'https://back/arc.png');
  assert.equal(a.card_category, '英雄单位');
  assert.equal(a.rarity_name, '异画');
  assert.equal(a.extend_rarity_name, '异画');
  assert.equal(a.series_name, 'ARC');
  assert.equal(a.is_promo, false);
  assert.equal(b.sub_title, null);
  assert.equal(b.card_effect, null);
  assert.equal(b.rarity_name, '普通', '异画印刷版不能污染基础卡稀有度');
  assert.equal(b.series_name, 'OGN');
  assert.equal(b.is_promo, true);
});

test('series_name 回退到印刷版 series', () => {
  const base = { ...baseA, series_name: null };
  const { entries } = buildLuaEntries([base], [{ ...printA, series: 'ARC' }]);
  assert.equal(entries[0].series_name, 'ARC');
});

test('空 card_category / 空图片 → nil', () => {
  const base = { ...baseA, card_category: [] };
  const { entries } = buildLuaEntries([base], [{ ...printA, img_cdn: null }]);
  assert.equal(entries[0].card_category, null);
  assert.equal(entries[0].front_image_en, null);
});

test('缺基础卡 / 缺卡号的印刷版被跳过并计数', () => {
  const orphan = { ...printA, card_id: 'ghost', card_no_extend: 'XXX-001' };
  const noNo = { ...printA, card_no_extend: null };
  const r = buildLuaEntries([baseA], [printA, orphan, noNo]);
  assert.equal(r.total, 1);
  assert.equal(r.skippedNoBase, 1);
  assert.equal(r.skippedNoCardNo, 1);
});

/* ────────── 文本格式 ────────── */
test('渲染文本与 TTS 模板逐字一致(缩进 / 字段顺序 / nil / 布尔)', () => {
  const { entries } = buildLuaEntries([baseA, baseB], [printA, printB]);
  const expected = [
    'local all_cards = {',
    '    {',
    '        ["card_no"] = "ARC-001",',
    '        ["card_name"] = "蔚",',
    '        ["sub_title"] = "铲除者",',
    '        ["card_effect"] = "第一行\\n第二行 \\"引号\\" \\\\反斜杠",',
    '        ["front_image_en"] = "https://cdn/arc-001.png",',
    '        ["back_image"] = "https://back/arc.png",',
    '        ["card_category"] = "英雄单位",',
    '        ["rarity_name"] = "异画",',
    '        ["extend_rarity_name"] = "异画",',
    '        ["series_name"] = "ARC",',
    '        ["is_promo"] = false,',
    '    },',
    '    {',
    '        ["card_no"] = "OGN-007a",',
    '        ["card_name"] = "炽烈符文",',
    '        ["sub_title"] = nil,',
    '        ["card_effect"] = nil,',
    '        ["front_image_en"] = "https://cdn/ogn-007a.png",',
    '        ["back_image"] = "https://back/ogn.png",',
    '        ["card_category"] = "符文",',
    '        ["rarity_name"] = "普通",',
    '        ["extend_rarity_name"] = "异画",',
    '        ["series_name"] = "OGN",',
    '        ["is_promo"] = true,',
    '    },',
    '}',
    ''
  ].join('\n');
  assert.equal(renderAllCardsLua(entries), expected);
});

test('buildAllCardsLua 汇总统计与头尾', () => {
  const r = buildAllCardsLua([baseA, baseB], [printA, printB]);
  assert.equal(r.total, 2);
  assert.equal(r.skippedNoBase, 0);
  assert.equal(r.skippedNoCardNo, 0);
  assert.ok(r.text.startsWith('local all_cards = {\n'));
  assert.ok(r.text.endsWith('}\n'));
});

test('无卡可导时输出空表', () => {
  const r = buildAllCardsLua([], []);
  assert.equal(r.total, 0);
  assert.equal(r.text, 'local all_cards = {\n}\n');
});

console.log(`\n──────── 结果:${passed} 通过 / 0 失败 ────────`);
