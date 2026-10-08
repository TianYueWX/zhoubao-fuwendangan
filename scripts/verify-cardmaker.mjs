import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Papa from 'papaparse';
import { buildCarddexData } from '../src/components/carddex/data.ts';
import {
  artBox,
  clone,
  dimensions,
  documentFromCard,
  imageLayer,
  newDocument,
  parseDocument,
  parseProject,
} from '../src/tools/cardmaker/model.ts';
import { translateTags } from '../src/tools/cardmaker/translations.ts';
import { effectTokens } from '../src/tools/cardmaker/render.ts';
import { cardImageUrl, handleCardImage } from '../functions/api/cardmaker/_image.ts';
let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('✓ ' + name);
}
const asset = {
  id: 'asset-1',
  name: 'fixture.png',
  data: 'data:image/png;base64,iVBORw0KGgo=',
  width: 1000,
  height: 600,
};
test('六种模板、横竖比例与配图覆盖', () => {
  for (const type of ['unit', 'spell', 'gear', 'legend', 'battlefield', 'rune']) {
    const d = newDocument(type);
    assert.deepEqual(parseDocument(d), d);
    const l = imageLayer(asset, type),
      b = artBox(type);
    assert(l.width >= b.width && l.height >= b.height);
    assert.equal(l.rotation, 0);
    assert.equal(dimensions(type).width > dimensions(type).height, type === 'battlefield');
  }
});
test('实际内置卡库载入英雄、专属、传奇、战场、符文；原卡保持独立', () => {
  const rows = Papa.parse(readFileSync('public/data/cards_base_rows.csv', 'utf8'), {
    header: true,
    skipEmptyLines: true,
  }).data;
  const records = buildCarddexData(rows, [], [], [], []).records;
  for (const [category, type, subtype] of [
    ['英雄单位', 'unit', 'champion'],
    ['专属单位', 'unit', 'signature'],
    ['法术', 'spell', ''],
    ['装备', 'gear', ''],
    ['传奇', 'legend', ''],
    ['战场', 'battlefield', ''],
    ['符文', 'rune', ''],
  ]) {
    const record = records.find((r) => r.base.categories.includes(category));
    assert(record, category);
    const original = clone(record),
      d = documentFromCard(record);
    assert.equal(d.type, type);
    assert.equal(d.subtype, subtype);
    assert.equal(d.copy.en.name, record.base.nameEn);
    assert.deepEqual(
      d.domains,
      record.base.colors.map((c) => (c === 'colorless' ? 'neutral' : c)),
    );
    d.copy.zh.name = '修改后的卡名';
    assert.deepEqual(record, original);
  }
});
test('JSON 完整保留双语、图片变换、裁剪与透明度，导入不共享对象', () => {
  const d = newDocument();
  d.copy.zh.name = '重铸';
  d.copy.en.name = 'Reforge';
  const l = imageLayer(asset, 'unit');
  Object.assign(l, {
    rotation: 27,
    opacity: 0.6,
    overlay: true,
    crop: { x: 0.1, y: 0.2, width: 0.7, height: 0.8 },
  });
  d.layers = [l];
  const exported = { format: 'rune-cardmaker', version: 1, document: d, assets: [asset] };
  const result = parseProject(JSON.stringify(exported));
  assert.deepEqual(result, exported);
  result.document.copy.zh.name = '独立编辑';
  assert.equal(d.copy.zh.name, '重铸');
});
test('拒绝坏版本、缺失图片、SVG、重复资产、非法裁剪和非有限变换', () => {
  const d = newDocument();
  d.layers = [imageLayer(asset, 'unit')];
  const project = { format: 'rune-cardmaker', version: 1, document: d, assets: [asset] };
  for (const mutate of [
    (p) => (p.version = 2),
    (p) => (p.assets = []),
    (p) => p.assets.push(p.assets[0]),
    (p) => (p.assets[0].data = 'data:image/svg+xml;base64,PHN2Zz4='),
    (p) => (p.document.layers[0].crop.x = 0.8),
    (p) => (p.document.layers[0].width = -1),
    (p) => (p.document.energy = null),
  ]) {
    const p = clone(project);
    mutate(p);
    assert.throws(() => parseProject(JSON.stringify(p)));
  }
  d.layers[0].rotation = Infinity;
  assert.throws(() => parseDocument(d));
});
test('官方双语关键词映射保留未知标签；格式标记及中英文图标不丢字', () => {
  const result = translateTags('英雄 · 迅捷 · 狩猎2 · 自定义势力');
  assert.equal(result.text, 'Champion · Action · Hunt 2 · 自定义势力');
  assert.deepEqual(result.unknown, ['自定义势力']);
  const tokens = effectTokens('**重铸**\n_Ready_ {{怒}} [Reaction] :rb_might:');
  assert(tokens.find((t) => t.text === '重')?.bold);
  assert(tokens.find((t) => t.text === 'Ready')?.italic);
  assert(tokens.some((t) => t.icon === '怒'));
  assert(tokens.some((t) => t.icon === 'Reaction'));
  assert(tokens.some((t) => t.icon === 'rb_might'));
  assert(tokens.some((t) => t.text === '\n'));
});
for (const url of [
  'https://example.com/card.png',
  'http://cdn.playloltcg.com/card.png',
  'https://user:pass@cdn.playloltcg.com/card.png',
  'https://cdn.playloltcg.com:9443/card.png',
  'https://127.0.0.1/card.png',
])
  assert.equal(cardImageUrl(url), null);
const png = new Uint8Array([137, 80, 78, 71]);
const request = new Request(
  'https://archive.test/api/cardmaker/image?url=' +
    encodeURIComponent('https://cdn.playloltcg.com/lol/card/fixture.png'),
);
const response = await handleCardImage(request, async (url, options) => {
  assert.equal(new URL(url).hostname, 'cdn.playloltcg.com');
  assert.equal(options.redirect, 'manual');
  assert.equal(new Headers(options.headers).get('authorization'), null);
  return new Response(png, { headers: { 'content-type': 'image/png' } });
});
assert.equal(response.status, 200);
assert.deepEqual(new Uint8Array(await response.arrayBuffer()), png);
assert(response.headers.get('cache-control').includes('86400'));
assert.equal(
  (
    await handleCardImage(
      request,
      async () => new Response('<html>', { headers: { 'content-type': 'text/html' } }),
    )
  ).status,
  502,
);
assert.equal(
  (
    await handleCardImage(
      request,
      async () =>
        new Response(png, {
          headers: { 'content-type': 'image/png', 'content-length': String(21 * 1024 * 1024) },
        }),
    )
  ).status,
  413,
);
assert.equal(
  (
    await handleCardImage(
      request,
      async () =>
        new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/private' } }),
    )
  ).status,
  502,
);
const blocked = new Request(
  'https://archive.test/api/cardmaker/image?url=https://example.com/card.png',
);
assert.equal(
  (
    await handleCardImage(blocked, async () => {
      throw new Error('Should never fetch');
    })
  ).status,
  400,
);
passed++;
console.log('✓ 同源卡图读取限定公开 CDN，拒绝外部跳转、非图片和超大响应');
console.log(`${passed} 项卡牌工坊数据验收通过。`);
