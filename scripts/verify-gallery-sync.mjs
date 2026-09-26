/* ================================================================
 * scripts/verify-gallery-sync.mjs
 *
 * 官网卡表同步纯逻辑验收（无真实网络、无数据库）：
 *   - 编号归一化（字母版本 / 星号 / SP / 指示物）
 *   - 副标题拆分（独立字段优先，逗号兜底：다리우스, 트리파르 / 達瑞斯, 特菲利安）
 *   - 稀有度映射（showcase → 异画 / 超编 / 签名超编）
 *   - 中/韩/繁 HTML + :rb_ 标记 → 纯文本 + {{标记}}
 *   - 未翻译条目绝不写文本；韩/繁中按英文身份回找基础卡
 *   - 分页去重、系列过滤、ko/tw 英文基线卡图比对
 *   - 提交字段白名单与 operation 载荷
 *
 *   node --experimental-strip-types --import ./scripts/register-hooks.mjs scripts/verify-gallery-sync.mjs
 * ================================================================ */
import assert from 'node:assert/strict';
import {
  splitNameSubtitle, normalizeGalleryCode, mapGalleryRarity, mapGalleryCategories,
  parseEnglishIdentity, convertGalleryEffect, cardTextForTarget, printLanguageOf
} from '../src/tools/sync/galleryNormalize.ts';
import { toGalleryCard, fetchAllGalleryCards, galleryPath } from '../src/tools/sync/galleryApi.ts';
import { parseRetryAfterMs } from '../src/tools/sync/riftboundApi.ts';
import { fetchGalleryDataset } from '../src/tools/sync/galleryRun.ts';
import {
  createGalleryReview, galleryState, buildGalleryOperation, galleryBaseCandidates, TARGET_FIELDS
} from '../src/tools/sync/galleryReview.ts';
import { indexExisting } from '../src/tools/sync/reviewIndex.ts';
import { normalizeCardNo, baseCardNo } from '../src/tools/sync/normalize.ts';
import { validateOperation, reviewSql, reviewCsv } from '../src/tools/sync/review.ts';
import {
  parseGalleryQuery, galleryUpstreamUrl, GALLERY_LOCALES
} from '../functions/api/riftbound/gallery/_upstream.ts';

let passed = 0;
function test(label, fn) {
  try {
    fn();
  } catch (e) {
    console.error(`✗ ${label}\n  ${e.message}`);
    process.exitCode = 1;
    return;
  }
  passed++;
  console.log(`✓ ${label}`);
}

async function asyncTest(label, fn) {
  try {
    await fn();
  } catch (e) {
    console.error(`✗ ${label}\n  ${e.message}`);
    process.exitCode = 1;
    return;
  }
  passed++;
  console.log(`✓ ${label}`);
}

/* ────────────── 编号 ────────────── */

test('编号归一化：去总数、保留字母/星号/SP/T 形态', () => {
  assert.equal(normalizeGalleryCode('UNL-131/219').extend, 'UNL-131');
  assert.equal(normalizeGalleryCode('OGN-066a/298').extend, 'OGN-066a');
  assert.equal(normalizeGalleryCode('OGN-066a/298').base, 'OGN-066');
  assert.equal(normalizeGalleryCode('SFD-227*/221').extend, 'SFD-227*');
  assert.equal(normalizeGalleryCode('SFD-227*/221').base, 'SFD-227');
  assert.equal(normalizeGalleryCode('VEN-SP3/006').extend, 'VEN-SP3');
  assert.equal(normalizeGalleryCode('UNL-T04').extend, 'UNL-T04');
  assert.equal(normalizeGalleryCode('UNL-T04').base, 'UNL-T04');
  assert.equal(normalizeGalleryCode('UNL-T04').error, undefined);
});

test('库内 normalizeCardNo 接受星号/SP/指示物编号', () => {
  assert.equal(normalizeCardNo('OGN-300*').extend, 'OGN-300*');
  assert.equal(normalizeCardNo('OGN-300*').error, undefined);
  assert.equal(normalizeCardNo('VEN-SP3').extend, 'VEN-SP3');
  assert.equal(normalizeCardNo('VEN-SP3').error, undefined);
  assert.equal(normalizeCardNo('UNL-T04').extend, 'UNL-T04');
  assert.equal(normalizeCardNo('UNL·074/219').extend, 'UNL-074');
  assert.equal(baseCardNo('OGN-066a'), 'OGN-066');
});

/* ────────────── 副标题 ────────────── */

test('副标题：独立字段优先，逗号兜底（韩/繁中示例）', () => {
  assert.deepEqual(splitNameSubtitle('다리우스', '트리파르'), { name: '다리우스', subtitle: '트리파르' });
  assert.deepEqual(splitNameSubtitle('達瑞斯', '特菲利安'), { name: '達瑞斯', subtitle: '特菲利安' });
  assert.deepEqual(splitNameSubtitle('Heisho, Shell of the World', ''), {
    name: 'Heisho',
    subtitle: 'Shell of the World'
  });
  assert.deepEqual(splitNameSubtitle('艾蕾，头号拥趸', null), { name: '艾蕾', subtitle: '头号拥趸' });
  assert.deepEqual(splitNameSubtitle('Abandon', ''), { name: 'Abandon', subtitle: null });
});

test('英文身份解析：accessibilityText 在任意语区都保留英文名', () => {
  assert.deepEqual(
    parseEnglishIdentity('Riftbound Unit: Darius, Trifarian. 한 턴에 두 번째 카드를…'),
    { name: 'Darius', subtitle: 'Trifarian' }
  );
  assert.deepEqual(parseEnglishIdentity('Riftbound Legend: Relentless Storm.'), {
    name: 'Relentless Storm',
    subtitle: null
  });
  assert.deepEqual(parseEnglishIdentity(''), { name: null, subtitle: null });
});

/* ────────────── 稀有度 ────────────── */

test('稀有度映射：常规 + 超编 + 签名超编', () => {
  assert.deepEqual(mapGalleryRarity('common', 'OGN-001', 1, 298), { rarity_name: '普通', extend_rarity_name: '平卡' });
  assert.deepEqual(mapGalleryRarity('uncommon', 'UNL-131', 131, 219), { rarity_name: '不凡', extend_rarity_name: '平卡' });
  assert.deepEqual(mapGalleryRarity('rare', 'OGN-027', 27, 298), { rarity_name: '稀有', extend_rarity_name: '平卡' });
  assert.deepEqual(mapGalleryRarity('epic', 'OGN-119', 119, 298), { rarity_name: '史诗', extend_rarity_name: '平卡' });
  assert.deepEqual(mapGalleryRarity('showcase', 'OGN-066a', 66, 298), { rarity_name: '异画', extend_rarity_name: '异画' });
  assert.deepEqual(mapGalleryRarity('showcase', 'OGN-300', 300, 298), { rarity_name: '异画', extend_rarity_name: '超编' });
  assert.deepEqual(mapGalleryRarity('showcase', 'OGN-300*', 300, 298), { rarity_name: '异画', extend_rarity_name: '签名超编' });
});

test('类别映射：英雄单位/专属/指示物', () => {
  const unit = { cardType: [{ id: 'unit', label: 'Unit' }], superType: [{ id: 'champion', label: 'Champion' }] };
  assert.deepEqual(mapGalleryCategories(unit, 'OGN-027'), ['英雄单位']);
  assert.deepEqual(
    mapGalleryCategories({ cardType: [{ id: 'gear', label: 'Gear' }], superType: [] }, 'SFD-T03'),
    ['指示物装备']
  );
  assert.deepEqual(
    mapGalleryCategories({ cardType: [{ id: 'battlefield', label: 'Battlefield' }], superType: [] }, 'UNL-T01'),
    ['指示物战场']
  );
});

/* ────────────── 效果文本 ────────────── */

test('中文效果：HTML + [关键词] + :rb_ 标记 → 纯文本 + {{标记}}', () => {
  const html = '<p>[急速]（你可以选择额外支付:rb_energy_1:和:rb_rune_fury:，让我以活跃状态进场。）<br />当我进攻时，如果你控制的符文数量不超过四枚，则对此处的所有敌方单位各造成2点伤害。</p>';
  const out = convertGalleryEffect(html);
  assert.equal(
    out.text,
    '{{急速}}（你可以选择额外支付{{1}}和{{红色}}，让我以活跃状态进场。）\n当我进攻时，如果你控制的符文数量不超过四枚，则对此处的所有敌方单位各造成2点伤害。'
  );
  assert.deepEqual(out.unmapped, []);
});

test('全部已知标记都有映射；未知标记会被点名', () => {
  const known = convertGalleryEffect(
    '<p>:rb_might: :rb_exhaust: :rb_rune_mind: :rb_rune_calm: :rb_rune_order: :rb_rune_chaos: :rb_rune_body: :rb_rune_rainbow: :rb_energy_8:</p>'
  );
  assert.equal(known.text, '{{S}} {{横置}} {{蓝色}} {{绿色}} {{黄色}} {{紫色}} {{橙色}} {{A}} {{8}}');
  assert.deepEqual(known.unmapped, []);
  const unknown = convertGalleryEffect('<p>:rb_mystery_keyword:</p>');
  assert.deepEqual(unknown.unmapped, [':rb_mystery_keyword:']);
  assert.match(unknown.text, /:rb_mystery_keyword:/);
});

test('HTML 实体解码与空段落处理', () => {
  const out = convertGalleryEffect('<p>A &amp; B<br />C&nbsp;D</p><p></p>');
  assert.equal(out.text, 'A & B\nC D');
  assert.equal(convertGalleryEffect('').text, null);
});

test('未翻译条目：中文/韩文/繁中都不产出文本，但保留英文身份', () => {
  const card = {
    id: 'k1', collectorNumber: 1, name: 'Abandon', subtitle: null, publicCode: 'UNL-131/219',
    set: { id: 'UNL', label: 'Unleashed' }, rarity: { id: 'uncommon', label: 'Uncommon' },
    cardType: [{ id: 'spell', label: 'Spell' }], superType: [],
    domains: [], image: { url: 'x', accessibilityText: 'Riftbound Spell: Abandon.' },
    illustrator: null, textHtml: '<p>[Reaction] Counter a spell.</p>', energy: 2, might: null, power: null, tags: []
  };
  const cn = cardTextForTarget(card, 'cn');
  assert.equal(cn.localized, false);
  assert.equal(cn.name, null);
  assert.equal(cn.effect, null);
  assert.equal(cn.nameEn, 'Abandon');

  const kr = cardTextForTarget({ ...card, name: '아리', subtitle: '황홀', textHtml: '<p>:rb_might:</p>', image: { url: 'x', accessibilityText: 'Riftbound Unit: Ahri, Alluring.' } }, 'kr');
  assert.equal(kr.localized, true);
  assert.equal(kr.name, '아리');
  assert.equal(kr.subtitle, '황홀');
  assert.equal(kr.effect, '{{S}}');
  assert.equal(kr.nameEn, 'Ahri');
  assert.equal(kr.subtitleEn, 'Alluring');
});

test('英文效果保持原始 HTML（与库内 effect_en 约定一致）', () => {
  const out = cardTextForTarget({
    id: 'e1', collectorNumber: 1, name: 'Abandon', subtitle: null, publicCode: 'UNL-131/219',
    set: { id: 'UNL', label: '' }, rarity: { id: 'uncommon', label: '' }, cardType: [], superType: [],
    domains: [], image: { url: null, accessibilityText: null }, illustrator: null,
    textHtml: '<p>Counter a spell.<br />Draw a card.</p>', energy: null, might: null, power: null, tags: []
  }, 'en');
  assert.equal(out.effect, '<p>Counter a spell.<br />Draw a card.</p>');
  assert.equal(out.localized, true);
});

/* ────────────── 上游结构映射 ────────────── */

test('toGalleryCard：真实结构取字段，缺字段降级不抛错', () => {
  const raw = {
    id: 'ogn-027-298', collectorNumber: 27, name: 'Darius', subtitle: 'Trifarian', publicCode: 'OGN-027/298',
    set: { value: { id: 'OGN', label: 'Origins' } },
    rarity: { value: { id: 'rare', label: 'Rare' } },
    cardType: { type: [{ id: 'unit', label: 'Unit' }], superType: [{ id: 'champion', label: 'Champion' }] },
    domain: { values: [{ id: 'fury', label: 'Fury' }] },
    cardImage: { url: 'https://x/y.png', accessibilityText: 'Riftbound Unit: Darius, Trifarian.', dimensions: { width: 744, height: 1039 } },
    illustrator: { values: [{ label: 'League Splash Team' }] },
    text: { richText: { body: '<p>:rb_might:</p>' } },
    energy: { value: { id: 5 } }, might: { value: { id: 5 } }, power: { value: { id: 1 } },
    tags: { tags: ['Trifarian'] }
  };
  const card = toGalleryCard(raw);
  assert.equal(card.id, 'ogn-027-298');
  assert.equal(card.subtitle, 'Trifarian');
  assert.equal(card.set.id, 'OGN');
  assert.equal(card.rarity.id, 'rare');
  assert.equal(card.superType[0].id, 'champion');
  assert.equal(card.image.url, 'https://x/y.png');
  assert.equal(card.illustrator, 'League Splash Team');
  assert.equal(card.energy, 5);
  assert.equal(toGalleryCard({}), null);
});

/* ────────────── 分页与代理 ────────────── */

test('代理参数白名单与固定上游 URL', () => {
  assert.deepEqual(parseGalleryQuery(new URLSearchParams('locale=ko_KR&from=0&limit=200')), {
    locale: 'ko_KR', from: 0, limit: 200
  });
  assert.equal(parseGalleryQuery(new URLSearchParams('locale=xx_XX')), null);
  assert.equal(parseGalleryQuery(new URLSearchParams('locale=en_US&from=9999')), null);
  assert.equal(parseGalleryQuery(new URLSearchParams('locale=en_US&limit=500')), null);
  assert.equal(GALLERY_LOCALES.length, 9);
  assert.equal(
    galleryUpstreamUrl('cards', { locale: 'zh_CN', from: 200, limit: 200 }),
    'https://content.publishing.riotgames.com/publishing-content/v2.0/public/channel/riftbound_website/list/riftbound_gallery_cards?locale=zh_CN&from=200&limit=200'
  );
  assert.equal(parseRetryAfterMs('2'), 2000);
});

await asyncTest('分页拉取按 id 去重且页序漂移不丢卡', async () => {
  const mk = (id, image = 'x') => ({
    id, publicCode: `OGN-${id}/298`, name: id, set: { value: { id: 'OGN', label: 'Origins' } },
    rarity: { value: { id: 'common', label: 'Common' } }, cardType: { type: [{ id: 'unit', label: 'Unit' }] },
    domain: { values: [] }, cardImage: { url: image }, text: { richText: { body: '' } }
  });
  const pages = [
    { data: [mk('a'), mk('b')], metadata: { totalItems: 3 } },
    { data: [mk('b'), mk('c')], metadata: { totalItems: 3 } },
    { data: [mk('c')], metadata: { totalItems: 3 } },
    { data: [], metadata: { totalItems: 3 } }
  ];
  const original = globalThis.fetch;
  let i = 0;
  globalThis.fetch = async () => new Response(JSON.stringify(pages[Math.min(i++, pages.length - 1)]), {
    status: 200, headers: { 'content-type': 'application/json' }
  });
  try {
    const out = await fetchAllGalleryCards('en_US', { minGapMs: 0 });
    assert.equal(out.cards.length, 3);
    assert.equal(out.reportedTotal, 3);
    assert.equal(i, 2);
  } finally {
    globalThis.fetch = original;
  }
});

/* ────────────── 数据集编排（ko 基线） ────────────── */

function rawCard(over = {}) {
  return {
    id: 'ogn-001-298', collectorNumber: 1, name: '테스트', subtitle: null, publicCode: 'OGN-001/298',
    set: { value: { id: 'OGN', label: 'Origins' } }, rarity: { value: { id: 'common', label: 'Common' } },
    cardType: { type: [{ id: 'unit', label: 'Unit' }] }, domain: { values: [] },
    cardImage: { url: 'ko1.png', accessibilityText: 'Riftbound Unit: Test, First.' },
    illustrator: { values: [{ label: 'Artist' }] }, text: { richText: { body: '<p>:rb_might:</p>' } },
    energy: { value: { id: 1 } }, ...over
  };
}

await asyncTest('ko 拉取：只收录卡图本地化的印刷，未翻译条目标记', async () => {
  const sets = { data: [{ id: 'OGN', name: 'Origins', collectorNumberMax: 298 }], metadata: { totalItems: 1 } };
  const koCards = {
    data: [
      rawCard(),
      rawCard({ id: 'ogn-002-298', publicCode: 'OGN-002/298', collectorNumber: 2, name: 'Untranslated', cardImage: { url: 'en2.png', accessibilityText: 'Riftbound Unit: Untranslated.' }, text: { richText: { body: '<p>English only.</p>' } } })
    ],
    metadata: { totalItems: 2 }
  };
  const enCards = {
    data: [
      rawCard({ name: 'Test', cardImage: { url: 'en1.png', accessibilityText: 'Riftbound Unit: Test, First.' } }),
      rawCard({ id: 'ogn-002-298', publicCode: 'OGN-002/298', collectorNumber: 2, name: 'Untranslated', cardImage: { url: 'en2.png', accessibilityText: 'Riftbound Unit: Untranslated.' } })
    ],
    metadata: { totalItems: 2 }
  };
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    const body = u.includes('/gallery/sets') ? sets : u.includes('locale=en_US') ? enCards : koCards;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const ds = await fetchGalleryDataset({ locale: 'ko_KR', seriesIds: [], minGapMs: 0 });
    assert.equal(ds.language, 'KR');
    assert.equal(ds.readOnly, false);
    assert.equal(ds.bases.length, 1);
    assert.equal(ds.bases[0].name, '테스트');
    assert.equal(ds.bases[0].subtitle, null);
    assert.equal(ds.prints.length, 1);
    assert.equal(ds.prints[0].img_cdn, 'ko1.png');
    assert.equal(ds.stats.untranslated, 1);
    assert.equal(ds.stats.skippedImages, 1);

    const filtered = await fetchGalleryDataset({ locale: 'ko_KR', seriesIds: ['SFD'], minGapMs: 0 });
    assert.equal(filtered.bases.length, 0);
    assert.equal(filtered.prints.length, 0);
  } finally {
    globalThis.fetch = original;
  }
});

/* ────────────── 审核逻辑 ────────────── */

function existingSnapshot(over = {}) {
  const base = {
    id: 'base-1', card_no: 'UNL-131', card_name_cn: '遗弃', card_name_en: 'Abandon',
    card_name_kr: null, card_name_tw: null,
    sub_title_cn: null, sub_title_en: null, sub_title_kr: null, sub_title_tw: null,
    effect_cn: '旧中文', effect_en: '<p>old</p>', effect_kr: null, effect_tw: null,
    series_name: 'UNL', rarity_name: '不凡', energy: 2, card_category: ['法术'],
    card_color_list: [], region: [], tag: [], champion_tag: null,
    flavor_text_cn: null, flavor_text_en: null, return_energy: null, power: null, is_banned: false
  };
  return {
    cards: [base, {
      ...base, id: 'base-2', card_no: 'OGN-119', card_name_cn: '阿狸', card_name_en: 'Ahri',
      sub_title_en: 'Inquisitive', effect_en: '<p>old ahri</p>'
    }, {
      ...base, id: 'base-3', card_no: 'OGN-066', card_name_cn: '阿狸', card_name_en: 'Ahri',
      sub_title_en: 'Alluring', effect_en: '<p>old ahri 2</p>'
    }],
    prints: [],
    icons: [],
    seriesCodes: ['OGN', 'UNL'],
    seriesByPrefix: {},
    localizedColumnsReady: true,
    ...over
  };
}

function makeIndex(ex, rows) {
  return {
    ...indexExisting(ex),
    rows: new Map(rows.map((r) => [r.key, r])),
    baseCounts: new Map(),
    printCounts: new Map()
  };
}

function baseDataset(over = {}) {
  return {
    locale: 'en_US',
    option: { id: 'en_US', label: 'English', target: 'en', writable: true },
    language: 'EN',
    readOnly: false,
    bases: [{
      card_no: 'UNL-131', name: 'Abandon', subtitle: null, effect: '<p>new</p>',
      card_name_en: 'Abandon', sub_title_en: null, series_name: 'UNL', rarity_name: '不凡',
      energy: 2, card_category: ['法术'], localized: true, source_id: 'unl-131-219'
    }],
    prints: [{
      base_card_no: 'UNL-131', card_no_extend: 'UNL-131', language: 'EN',
      rarity_name: '不凡', extend_rarity_name: '平卡', img_cdn: 'https://cdn/new.png',
      artist: 'Artist', series: 'UNL', is_promo: false, name: 'Abandon', subtitle: null,
      name_en: 'Abandon', subtitle_en: null
    }],
    series: [{ id: 'UNL', name: 'Unleashed', collectorNumberMax: 219 }],
    selectedSeries: [],
    stats: { cards: 1, bases: 1, prints: 1, untranslated: 0, skippedImages: 0 },
    ...over
  };
}

test('基础卡按 card_no 更新：只比较目标语言列', () => {
  const ex = existingSnapshot();
  const rows = createGalleryReview(baseDataset());
  const index = makeIndex(ex, rows);
  const base = rows.find((r) => r.table === 'cards_base');
  const st = galleryState(base, rows, ex, index);
  assert.equal(st.kind, 'update');
  assert.deepEqual(st.changed, ['effect_en']);
  base.selected = ['effect_en'];
  const op = buildGalleryOperation(base, rows, ex, index);
  assert.equal(op.kind, 'update');
  assert.equal(op.id, 'base-1');
  assert.deepEqual(op.payload, { effect_en: '<p>new</p>' });
  assert.deepEqual(op.expected, { effect_en: '<p>old</p>' });
  validateOperation(op);
});

test('印刷版本更新：卡图差异进入 changed，白名单放行导出', () => {
  const ex = existingSnapshot({
    prints: [{
      id: 'print-1', card_id: 'base-1', card_no_extend: 'UNL-131', language: 'EN',
      rarity_name: '不凡', extend_rarity_name: '平卡', img_cdn: 'https://cdn/old.png',
      artist: 'Artist', series: 'UNL', flavor_text_cn: null, flavor_text_en: null, is_promo: false
    }]
  });
  const rows = createGalleryReview(baseDataset());
  const index = makeIndex(ex, rows);
  const print = rows.find((r) => r.table === 'card_prints');
  const st = galleryState(print, rows, ex, index);
  assert.equal(st.kind, 'update');
  assert.deepEqual(st.changed, ['img_cdn']);
  print.selected = ['img_cdn'];
  const op = buildGalleryOperation(print, rows, ex, index);
  assert.deepEqual(op.payload, { img_cdn: 'https://cdn/new.png' });
  assert.match(reviewSql([op]), /img_cdn/);
  assert.match(reviewCsv([op], 'update'), /img_cdn/);
});

test('韩文基础卡：新列可写；未翻译（无 target 名）不可新增', () => {
  const dataset = baseDataset({
    locale: 'ko_KR',
    option: { id: 'ko_KR', label: '한국어', target: 'kr', writable: true },
    language: 'KR',
    bases: [{
      card_no: 'UNL-131', name: '버림', subtitle: null, effect: '{{反应}}',
      card_name_en: 'Abandon', sub_title_en: null, series_name: 'UNL', rarity_name: '不凡',
      energy: 2, card_category: ['法术'], localized: true, source_id: 'x'
    }]
  });
  const ex = existingSnapshot();
  const rows = createGalleryReview(dataset);
  const index = makeIndex(ex, rows);
  const base = rows.find((r) => r.table === 'cards_base');
  const st = galleryState(base, rows, ex, index);
  assert.equal(st.kind, 'update');
  assert.deepEqual(st.changed, ['card_name_kr', 'effect_kr']);
  base.selected = ['card_name_kr', 'effect_kr'];
  const op = buildGalleryOperation(base, rows, ex, index);
  assert.deepEqual(op.payload, { card_name_kr: '버림', effect_kr: '{{反应}}' });
  validateOperation(op);

  const untranslated = createGalleryReview(baseDataset({
    locale: 'ko_KR',
    option: { id: 'ko_KR', label: '한국어', target: 'kr', writable: true },
    language: 'KR',
    bases: [{
      card_no: 'UNL-999', name: null, subtitle: null, effect: null,
      card_name_en: 'Something', sub_title_en: null, series_name: 'UNL', rarity_name: null,
      energy: null, card_category: [], localized: false, source_id: 'x'
    }]
  })).find((r) => r.table === 'cards_base');
  const st2 = galleryState(untranslated, [untranslated], existingSnapshot(), makeIndex(existingSnapshot(), [untranslated]));
  assert.equal(st2.kind, 'blocked');
  assert.match(st2.reason, /未翻译|缺少卡名/);
});

test('新增仅英文基础卡：card_no + 英文名为必填，且放行 kr/tw 列之外的授权字段', () => {
  const dataset = baseDataset({
    bases: [{
      card_no: 'VEN-999', name: 'Brand New', subtitle: null, effect: '<p>x</p>',
      card_name_en: 'Brand New', sub_title_en: null, series_name: 'VEN', rarity_name: '稀有',
      energy: 1, card_category: ['单位'], localized: true, source_id: 'x'
    }],
    prints: []
  });
  const ex = existingSnapshot();
  const rows = createGalleryReview(dataset);
  const index = makeIndex(ex, rows);
  const base = rows.find((r) => r.table === 'cards_base');
  const st = galleryState(base, rows, ex, index);
  assert.equal(st.kind, 'new');
  const op = buildGalleryOperation(base, rows, ex, index);
  assert.equal(op.kind, 'insert');
  assert.equal(op.payload.card_no, 'VEN-999');
  assert.equal(op.payload.card_name_en, 'Brand New');
  validateOperation(op);
  assert.throws(() => validateOperation({ ...op, payload: { ...op.payload, evil: 1 } }), /未授权/);
});

test('星号印刷：按英文名＋副标题回找原作基础卡', () => {
  const dataset = baseDataset({
    bases: [],
    prints: [{
      base_card_no: 'SFD-227', card_no_extend: 'SFD-227*', language: 'EN',
      rarity_name: '异画', extend_rarity_name: '签名超编', img_cdn: 'https://cdn/star.png',
      artist: 'Wild Rift', series: 'SFD', is_promo: false, name: 'Ahri', subtitle: 'Inquisitive',
      name_en: 'Ahri', subtitle_en: 'Inquisitive'
    }]
  });
  const ex = existingSnapshot();
  const rows = createGalleryReview(dataset);
  const index = makeIndex(ex, rows);
  const print = rows.find((r) => r.table === 'card_prints');
  const st = galleryState(print, rows, ex, index);
  assert.equal(st.kind, 'new');
  assert.equal(st.parentId, 'base-2');
  const op = buildGalleryOperation(print, rows, ex, index);
  assert.equal(op.payload.card_id, 'base-2');
  validateOperation(op);
});

test('英文身份多个候选时必须手选，手选后可提交', () => {
  const dataset = baseDataset({
    bases: [],
    prints: [{
      base_card_no: 'UNL-999', card_no_extend: 'UNL-999', language: 'EN',
      rarity_name: '异画', extend_rarity_name: '异画', img_cdn: 'https://cdn/x.png',
      artist: null, series: 'UNL', is_promo: false, name: 'Ahri', subtitle: null,
      name_en: 'Ahri', subtitle_en: null
    }]
  });
  const ex = existingSnapshot();
  const rows = createGalleryReview(dataset);
  const index = makeIndex(ex, rows);
  const print = rows.find((r) => r.table === 'card_prints');
  assert.equal(index.basesByEnName.get('Ahri').length, 2);
  const candidates = galleryBaseCandidates(print, ex, index);
  assert.equal(candidates.length, 2);
  let st = galleryState(print, rows, ex, index);
  assert.equal(st.kind, 'blocked');
  assert.match(st.reason, /选择关联基础卡/);
  print.chosenBaseId = 'base-3';
  st = galleryState(print, rows, ex, index);
  assert.equal(st.kind, 'new');
  assert.equal(st.parentId, 'base-3');
});

test('印刷编号语言非法时阻断', () => {
  const dataset = baseDataset({
    bases: [],
    prints: [{
      base_card_no: 'UNL-131', card_no_extend: 'UNL-131', language: 'FR',
      rarity_name: null, extend_rarity_name: null, img_cdn: null, artist: null,
      series: null, is_promo: false, name: null, subtitle: null, name_en: null, subtitle_en: null
    }]
  });
  const ex = existingSnapshot();
  const rows = createGalleryReview(dataset);
  const index = makeIndex(ex, rows);
  const print = rows.find((r) => r.table === 'card_prints');
  const st = galleryState(print, rows, ex, index);
  assert.equal(st.kind, 'blocked');
  assert.match(st.reason, /语言/);
});

test('TARGET_FIELDS 与 printLanguageOf 对齐', () => {
  assert.equal(printLanguageOf('en_US'), 'EN');
  assert.equal(printLanguageOf('zh_CN'), 'SC');
  assert.equal(printLanguageOf('ko_KR'), 'KR');
  assert.equal(printLanguageOf('zh_TW'), 'TC');
  assert.equal(TARGET_FIELDS.kr.name, 'card_name_kr');
  assert.equal(TARGET_FIELDS.kr.subtitle, 'sub_title_kr');
  assert.equal(TARGET_FIELDS.kr.effect, 'effect_kr');
  assert.equal(TARGET_FIELDS.tw.name, 'card_name_tw');
});

test('galleryPath 使用同源代理且带白名单参数', () => {
  assert.equal(
    galleryPath('cards', 'zh_CN', 200, 200),
    '/api/riftbound/gallery/cards?locale=zh_CN&from=200&limit=200'
  );
});

console.log(`\n──────── 结果：${passed} 通过 ────────`);
