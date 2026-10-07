// Browser regression coverage for reader navigation, widths, selection, and shared card pins.
// All remote reads use fixtures; requests that could write remotely are rejected.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const dist = resolve('dist');
const shots = mkdtempSync('/tmp/rulebook-ui-shots-');
const chromeProfile = mkdtempSync('/tmp/rulebook-ui-browser-');
let debugPort = 0;
// File navigation avoids Chromium's isolated HTTP network service in managed environments.
// The browser profile is disposable, and every remote data request is replaced below.
const app = pathToFileURL(join(dist, 'index.html')).href;
const chrome = spawn(process.env.CHROME_PATH ?? `${process.env.HOME}/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome`, [
  '--headless', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server', '--allow-file-access-from-files', '--disable-web-security', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${chromeProfile}`, '--window-size=1680,1050', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let browserLog = '';
chrome.stderr.on('data', data => { browserLog += data.toString(); });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const rules = Array.from({ length: 100 }, (_, i) => ({
  id: `r-${i}`, rule_number: String(100 + i), parent_number: null, level: 0, is_heading: i === 0,
  text_zh: i === 0 ? '规则书阅读' : `艾希与卡牌效果：${'这是用于验证阅读位置与文本选择的规则正文。'.repeat(8)}`,
  text_en: i === 0 ? 'Rulebook reader' : `Ashe and card effects. ${'Example text for checking selection and reading position. '.repeat(6)}`,
  sort_order: i, rules_book: '验收规则书', updated_at: null,
}));
const cards = [
  { id: 'c-1', card_no: 'OGN-001', card_name_cn: '艾希', card_name_en: 'Ashe', sub_title_cn: '寒冰射手', sub_title_en: 'Frost Archer', card_category: ['英雄单位'], energy: 3, power: 4, effect_cn: '测试效果：迅捷。', effect_en: 'Example card effect.', is_banned: false },
  { id: 'c-2', card_no: 'OGN-002', card_name_cn: '艾希的箭', card_name_en: 'Ashe’s Arrow', sub_title_cn: '', sub_title_en: '', card_category: ['法术'], energy: 1, effect_cn: '另一张卡牌。', is_banned: true },
];
const prints = cards.map((card, i) => ({ id: `p-${i}`, card_id: card.id, card_no_extend: card.card_no, language: 'SC', is_default: true, img_cdn: 'data:image/svg+xml;base64,' + readFileSync(join(dist, 'runes/blue.svg')).toString('base64') }));
prints.push({ ...prints[0], id: 'p-en', language: 'EN' });
const setup = `(() => {
  const original = window.fetch.bind(window);
  const tables = ${JSON.stringify({ rules, cards_base: cards, card_prints: prints, version: ['rules', 'cards', 'prints', 'icons'].map(name => ({ name, updated_at: 'fixture-v1' })) })};
  window.__remoteWrites = [];
  window.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (!url.pathname.includes('/rest/v1/') && !url.pathname.includes('/auth/v1/')) return original(input, options);
    const method = options.method || 'GET';
    if (method !== 'GET') { window.__remoteWrites.push(method); throw Error('Remote mutation blocked by reader test'); }
    const rows = tables[url.pathname.split('/').pop()] || [];
    const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 1000);
    return new Response(JSON.stringify(rows.slice(offset, offset + limit)), { status: 200, headers: { 'content-range': offset + '-' + Math.max(offset, Math.min(rows.length, offset + limit) - 1) + '/' + rows.length } });
  };
})()`;

let ws, passed = 0;
try {
  let tabs;
  for (let i = 0; i < 60; i++) {
    try {
      debugPort = Number(readFileSync(join(chromeProfile, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
      tabs = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json(); break;
    } catch { await sleep(150); }
  }
  if (!tabs) throw new Error('Browser CDP unavailable\n' + browserLog);
  ws = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let sequence = 0;
  const pending = new Map(), exceptions = [], browserRequests = [];
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
    else if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    else if (message.method === 'Network.requestWillBeSent') browserRequests.push(message.params.request.url.split('?')[0]);
  };
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method + '\n' + JSON.stringify({ app, browserRequests, exceptions, browserLog }))); }, 20000);
    pending.set(id, message => { clearTimeout(timer); message.error ? reject(Error(JSON.stringify(message.error))) : resolve(message.result); });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const js = async expression => {
    const response = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
    return response.result?.value;
  };
  const wait = async expression => {
    for (let i = 0; i < 80; i++) { try { if (await js(expression)) return; } catch {} await sleep(100); }
    throw Error('Wait failed: ' + expression + '\n' + await js('document.body.innerText.slice(0,2000)'));
  };
  const click = async selector => { assert(await js(`Boolean(document.querySelector(${JSON.stringify(selector)}))`), selector); await js(`document.querySelector(${JSON.stringify(selector)}).click()`); await sleep(150); };
  const mouseClick = async selector => {
    const rect = await js(`(() => { const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2} })()`);
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...rect, button: 'left', clickCount: 1 });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', ...rect, button: 'left', clickCount: 1 });
    await sleep(150);
  };
  const input = async (selector, value, event = 'input') => {
    await js(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true })); })()`);
    await sleep(150);
  };
  const test = async (name, fn) => { await fn(); passed++; console.log('✓ ' + name); };
  const viewport = async (width, height = 1050, mobile = false) => { await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }); await sleep(150); };
  const shot = async name => { const result = await cdp('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(shots, name + '.png'), Buffer.from(result.data, 'base64')); };
  const settleScroll = async () => {
    let previous = NaN, stable = 0;
    for (let i = 0; i < 50; i++) {
      const current = await js('scrollY');
      stable = Math.abs(current - previous) < 0.5 ? stable + 1 : 0;
      if (stable >= 4) return;
      previous = current;
      await sleep(80);
    }
    throw Error('Reader scrolling did not settle');
  };
  const assertRuleCentered = async number => {
    await settleScroll();
    const position = await js(`(() => { const e=document.querySelector('[data-rule-number="${number}"]'), r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,center:r.top+r.height/2,expected:(innerHeight+parseFloat(getComputedStyle(e).scrollMarginTop))/2,controls:document.querySelector('.reader-controls').getBoundingClientRect().bottom,height:innerHeight}; })()`);
    assert(Math.abs(position.center - position.expected) < 3, `Rule ${number} landed incorrectly: ${JSON.stringify(position)}`);
    assert(position.top >= position.controls && position.bottom <= position.height, `Rule ${number} is not fully visible`);
  };
  const selectText = async (number = '101') => {
    await js(`(() => { const row = document.querySelector('[data-rule-number="${number}"]'); row.scrollIntoView({block:'center'}); const text = row.querySelector('.rule-text > span').firstChild; const range = new Range(); range.setStart(text, 0); range.setEnd(text, 2); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); })()`);
    await wait("document.querySelector('.text-selection-menu')");
  };

  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable');
  await cdp('Network.setBlockedURLs', { urls: ['https://fonts.googleapis.com/*', 'https://fonts.gstatic.com/*'] });
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: setup });
  await cdp('Page.navigate', { url: app + '#/rules/' + encodeURIComponent('验收规则书') });
  await wait("document.querySelectorAll('.rule-row').length === 100");

  await test('First search jumps reach distant rules at full, focused, and mobile widths', async () => {
    for (const [width, height, preset] of [[1680, 1050, 'full'], [1680, 1050, 'focused'], [390, 844, 'full']]) {
      await viewport(width, height, width < 900);
      await cdp('Page.reload'); await wait("document.querySelectorAll('.rule-row').length === 100");
      await input('.width-control select', preset, 'change');
      await mouseClick('.reader-controls [aria-label="搜索规则"]');
      await wait("document.querySelector('.reader-popup').open");
      const emptyHeight = await js("document.querySelector('.reader-popup').getBoundingClientRect().height");
      await input('.popup-search input', '180');
      await wait("document.querySelectorAll('.popup-result').length === 1");
      assert.equal(await js("document.querySelector('.reader-popup').getBoundingClientRect().height"), emptyHeight);
      await mouseClick('.popup-result');
      await assertRuleCentered('180');
      assert.equal(await js("document.querySelector('.reader-popup').open"), false);
      await mouseClick('.reader-controls [aria-label="搜索规则"]');
      await wait("document.querySelector('.reader-popup').open");
      assert.equal(await js("document.querySelector('.popup-search input').value"), '180');
      await click('.reader-popup .popup-x');
    }
    await viewport(1680);
    await cdp('Page.reload'); await wait("document.querySelectorAll('.rule-row').length === 100");
  });
  await test('Book-local back-to-top stays clear of card search and follows the book container', async () => {
    for (const [width, height, preset] of [[1680, 1050, 'full'], [1680, 1050, 'focused'], [390, 844, 'full']]) {
      await viewport(width, height, width < 900);
      await input('.width-control select', preset, 'change');
      await js("document.querySelector('[data-rule-number=\"160\"]').scrollIntoView({block:'center',behavior:'instant'})");
      await wait("document.querySelector('.reader-top-button').checkVisibility()");
      assert.equal(await js("document.querySelectorAll('[aria-label=\"回到顶部\"]').length"), 1);
      assert(await js("document.querySelector('.reader-document').contains(document.querySelector('.reader-top-button'))"));
      const layout = await js("(() => {const b=document.querySelector('.reader-top-button').getBoundingClientRect(),d=document.querySelector('.reader-document').getBoundingClientRect(),f=document.querySelector('.card-search-fab').getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,bookLeft:d.left,bookRight:d.right,fabTop:f.top};})()");
      assert(layout.left >= layout.bookLeft && layout.right <= layout.bookRight);
      assert(layout.top >= 0 && layout.bottom < layout.fabTop - 12, JSON.stringify(layout));
      await shot('back-top-' + width + '-' + preset);
      await mouseClick('.card-search-fab');
      await wait("document.querySelector('.reader-card-panel').checkVisibility()");
      if (width > 900) {
        assert(await js("document.querySelector('.reader-top-button').getBoundingClientRect().right < document.querySelector('.reader-card-panel').getBoundingClientRect().left"));
      } else {
        assert.equal(await js("document.querySelector('.reader-top-button').checkVisibility()"), false);
      }
      await click('.panel-actions button:last-child');
      await mouseClick('.reader-top-button');
      await settleScroll();
      assert.equal(await js('scrollY'), 0);
      assert.equal(await js("document.querySelector('.reader-top-button').checkVisibility()"), false);
    }
    await viewport(1680);
    await cdp('Page.reload'); await wait("document.querySelectorAll('.rule-row').length === 100");
  });
  await test('Cold rule deep links land correctly after the book mounts', async () => {
    await js("location.hash='#/rules/' + encodeURIComponent('验收规则书') + '/180'");
    await cdp('Page.reload'); await wait("document.querySelectorAll('.rule-row').length === 100");
    await assertRuleCentered('180');
    await js("location.hash='#/rules/' + encodeURIComponent('验收规则书')");
    await cdp('Page.reload'); await wait("document.querySelectorAll('.rule-row').length === 100");
  });

  await test('Full width fills 1680px and 2560px screens without overflow', async () => {
    for (const width of [1680, 2560]) {
      await viewport(width);
      const available = await js('document.documentElement.clientWidth');
      assert((await js("document.querySelector('.reader-document').getBoundingClientRect().width")) >= available - 40);
      assert((await js('document.documentElement.scrollWidth')) <= width);
    }
    await viewport(1680);
  });
  await test('Width presets and custom percentage persist after reload', async () => {
    await input('.width-control select', 'focused', 'change');
    assert.equal(Math.round(await js("document.querySelector('.reader-document').getBoundingClientRect().width")), 860);
    await input('.width-control select', 'wide', 'change');
    assert.equal(Math.round(await js("document.querySelector('.reader-document').getBoundingClientRect().width")), 1200);
    await input('.width-control select', 'custom', 'change');
    await input('.custom-width-control input[type=number]', '80', 'change');
    assert.equal(await js("localStorage.getItem('rulebook:custom-width')"), '80');
    await cdp('Page.reload'); await wait("document.querySelectorAll('.rule-row').length === 100");
    assert.equal(await js("document.querySelector('.width-control select').value"), 'custom');
    assert.equal(await js("document.querySelector('.custom-width-control input[type=number]').value"), '80');
    await input('.width-control select', 'full', 'change');
  });
  await test('Width changes keep the visible rule at its reading position', async () => {
    await js("document.querySelector('[data-rule-number=\"140\"]').scrollIntoView({block:'start'})"); await sleep(200);
    const before = await js("document.querySelector('[data-rule-number=\"140\"]').getBoundingClientRect().top");
    await input('.width-control select', 'focused', 'change');
    const after = await js("document.querySelector('[data-rule-number=\"140\"]').getBoundingClientRect().top");
    assert(Math.abs(after - before) < 3, `Reading position moved from ${before} to ${after}`);
    await input('.width-control select', 'full', 'change');
  });
  await test('Native text selection shows a menu and searches without selecting a whole rule', async () => {
    const rect = await js("(() => { const row=document.querySelector('[data-rule-number=\"101\"]');row.scrollIntoView({block:'center'});const r=new Range();r.setStart(row.querySelector('.rule-text > span').firstChild,0);r.setEnd(r.startContainer,2);const b=r.getBoundingClientRect();return {left:b.left,right:b.right,y:b.top+b.height/2}; })()");
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.left + 0.1, y: rect.y, button: 'left', clickCount: 1 });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.right, y: rect.y, button: 'left', buttons: 1 });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.right, y: rect.y, button: 'left', clickCount: 1 });
    await wait("document.querySelector('.text-selection-menu')");
    assert.equal(await js("getSelection().toString()"), '艾希');
    assert.equal(await js("document.querySelectorAll('.rule-row.selected').length"), 0);
    await shot('selection');
    await mouseClick('.text-selection-menu button:first-child');
    await wait("document.querySelectorAll('.query-block .reader-card-tile').length === 2");
    assert.equal(await js("document.querySelector('#reader-card-query').value"), '艾希');
    assert(await js("document.querySelector('.query-source').textContent.includes('101')"));
    assert(await js("[...document.querySelectorAll('.reader-card-tile')].every(tile => tile.children.length === 2 && tile.firstElementChild.classList.contains('carddex-image'))"));
    assert.deepEqual(await js("[...document.querySelectorAll('.reader-card-tile > span')].map(e => e.textContent)"), ['艾希 - 寒冰射手', '艾希的箭']);
    const layout = await js("(() => { const r=document.querySelector('.reader-document').getBoundingClientRect(), p=document.querySelector('.reader-card-panel').getBoundingClientRect(); return [r.right,p.left,document.documentElement.scrollWidth,innerWidth] })()");
    assert(layout[0] <= layout[1]); assert(layout[2] <= layout[3]);
    await shot('desktop');
  });
  await test('Search source links return to the rule without leaving the reader', async () => {
    await js("document.querySelector('[data-rule-number=\"140\"]').scrollIntoView({block:'start'})");
    await click('.query-source');
    await wait("document.querySelector('[data-rule-number=\"101\"]').getBoundingClientRect().top >= 0 && document.querySelector('[data-rule-number=\"101\"]').getBoundingClientRect().top < innerHeight");
    assert(await js("document.querySelector('.reader-card-panel').checkVisibility()"));
  });
  await test('Card details pin exact prints, and pins survive minimizing and reload', async () => {
    await click('.reader-card-tile'); await wait("document.querySelector('.panel-detail')");
    assert(await js("document.querySelector('.panel-detail').textContent.includes('测试效果')"));
    await input('.print-picker select', 'OGN-001\u0000EN', 'change');
    await click('.pin-action');
    assert.equal(await js("JSON.parse(localStorage.getItem('carddex:pins:v1')).length"), 1);
    assert.equal(await js("JSON.parse(localStorage.getItem('carddex:pins:v1'))[0].language"), 'EN');
    await click('.panel-tabs button:last-child'); assert.equal(await js("document.querySelectorAll('.pinned-grid .reader-card-tile').length"), 1);
    await click('.panel-actions button:last-child'); await click('.card-search-fab');
    assert.equal(await js("document.querySelectorAll('.pinned-grid .reader-card-tile').length"), 1);
    await cdp('Page.reload'); await wait("document.querySelectorAll('.rule-row').length === 100");
    assert.equal(await js("document.querySelector('.card-search-fab b').textContent"), '1');
    await click('.card-search-fab'); await wait("!document.querySelector('.panel-scroll').textContent.includes('正在载入卡牌')");
    await click('.panel-tabs button:last-child'); await wait("document.querySelectorAll('.pinned-grid .reader-card-tile').length === 1");
  });
  await test('Queries keep history; no-result searches can be edited and resubmitted', async () => {
    await input('#reader-card-query', 'missing-card'); await js("document.querySelector('.panel-query').requestSubmit()"); await wait("document.querySelector('.no-results')");
    await input('#reader-card-query', 'OGN-001'); await js("document.querySelector('.panel-query').requestSubmit()"); await wait("document.querySelectorAll('.query-block').length === 2");
    assert.equal(await js("document.querySelectorAll('.query-block:last-child .reader-card-tile').length"), 1);
    await click('.panel-actions button:last-child');
  });
  await test('Rule numbers retain whole-rule selection, copy/share/favorite actions', async () => {
    await js('scrollTo(0,0)'); await click('[data-rule-number="101"] .rule-number');
    assert.equal(await js("document.querySelectorAll('.rule-row.selected').length"), 1);
    assert(await js("document.querySelector('.selection-bar').textContent.includes('分享链接')"));
    await click('[data-rule-number="102"] .rule-number'); assert.equal(await js("document.querySelectorAll('.rule-row.selected').length"), 2);
    await click('.finish-selection'); assert.equal(await js("document.querySelectorAll('.rule-row.selected').length"), 0);
  });
  await test('The card panel follows dark mode and the reader language', async () => {
    await click('.settings-trigger'); await click('.theme-options .sample-dark'); await click('.reader-popup .popup-x');
    await click('.language-switch button:nth-child(2)'); await click('.card-search-fab');
    assert.equal(await js("getComputedStyle(document.querySelector('.reader-card-panel')).backgroundColor"), 'rgb(37, 37, 37)');
    assert.equal(await js("document.querySelector('.panel-header h2').textContent"), 'Card search');
    await click('.panel-tabs button:last-child');
    assert.equal(await js("document.querySelector('.pinned-grid .reader-card-tile > span').textContent"), 'Ashe - Frost Archer');
    await shot('desktop-dark');
    await click('.panel-actions button:last-child');
    await click('.language-switch button:first-child'); await click('.settings-trigger'); await click('.theme-options .sample-paper'); await click('.reader-popup .popup-x');
  });
  await test('320px and 390px mobile layouts fit; selection actions and expanded sheet remain usable', async () => {
    for (const width of [320, 390]) {
      await viewport(width, 844, true);
      assert((await js('document.documentElement.scrollWidth')) <= width);
      await selectText();
      const menu = await js("(() => { const r=document.querySelector('.text-selection-menu').getBoundingClientRect();return [r.left,r.right,r.top,r.bottom,innerWidth,innerHeight] })()");
      assert(menu[0] >= 0 && menu[1] <= menu[4] && menu[2] >= 0 && menu[3] <= menu[5]);
      await click('.text-selection-menu button:first-child'); await wait("document.querySelector('.reader-card-panel').checkVisibility()");
      assert.equal(await js("document.querySelector('.reader-card-panel').getAttribute('aria-modal')"), 'true');
      assert(await js("document.querySelector('.reader-document').inert"));
      const sheet = await js("document.querySelector('.reader-card-panel').getBoundingClientRect().height");
      assert(sheet > 500 && sheet < 650);
      await click('.expand-panel'); assert((await js("document.querySelector('.reader-card-panel').getBoundingClientRect().height")) > 750);
      assert((await js('document.documentElement.scrollWidth')) <= width);
      await shot('mobile-' + width);
      await click('.panel-actions button:last-child');
      // Restore compact height for the next viewport.
      await click('.card-search-fab'); await click('.expand-panel'); await click('.panel-actions button:last-child');
    }
  });
  await test('Reader pins appear in the existing card archive', async () => {
    await viewport(1680);
    await js("location.hash='#/carddex'"); await wait("document.querySelector('.carddex-page') && document.querySelector('.global-actions')");
    await js("[...document.querySelectorAll('.global-actions button')].find(e=>e.querySelector('span')?.textContent==='已标记').click()");
    await wait("document.querySelectorAll('.pin-grid .carddex-tile').length === 1 || document.querySelectorAll('.pin-grid > div').length === 1");
  });
  assert.deepEqual(await js('window.__remoteWrites'), []);
  assert.deepEqual(exceptions, []);
  console.log(`\n${passed} browser checks passed. Screenshots: ${shots}`);
} finally {
  ws?.close(); chrome.kill();
}
