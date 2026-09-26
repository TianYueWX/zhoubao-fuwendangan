/** Browser integration with entirely mocked external APIs. Requires Vite on localhost:5173
 *  (override with SYNC_REVIEW_URL, e.g. http://localhost:5173 when Vite is IPv6-only). */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const perf = process.argv.includes('--perf');
const profile = mkdtempSync('/tmp/sync-review-ui-');
const chrome = spawn(process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1200/chrome-headless-shell-linux64/chrome-headless-shell', [
  '--headless', '--disable-gpu', '--no-sandbox', '--remote-debugging-port=9337', `--user-data-dir=${profile}`, '--window-size=1440,1050', 'about:blank'
], { stdio: 'ignore' });
let ws;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
try {
  let tabs;
  for (let i = 0; i < 40; i++) {
    try { tabs = await (await fetch('http://127.0.0.1:9337/json/list')).json(); break; } catch { await sleep(250); }
  }
  assert.ok(tabs, 'Chromium must start');
  ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const pending = new Map(); let seq = 0; const exceptions = [];
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
    if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
  };
  const cdp = (method, params = {}) => new Promise(resolve => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => {
    const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.result?.exceptionDetails) throw new Error(JSON.stringify(result.result.exceptionDetails));
    return result.result?.result?.value;
  };
  await cdp('Page.enable'); await cdp('Runtime.enable');
  const fixture = () => {
    localStorage.setItem('riftbound-editorial-unlocked', '1');
    localStorage.setItem('riftbound-editorial-session', JSON.stringify({ accessToken: 'mock-only', refreshToken: 'mock-only', expiresAt: Date.now()+3600000, email: 'mock@local', role: 'admin' }));
    const defaults = { cardColorList: ['red'], cardCategoryNameList: ['单位'], energy: 0, returnEnergy: 1, power: 3, cardEffect: '原效果', errata: '', artist: '新画师', rarityName: '异画', extendRarityName: '异画', frontImage: 'new.png', backImage: 'DO-NOT-SYNC', flavorText: '' };
    window.__api = [
      { ...defaults, cardNo: 'ARC·001a·SC', cardName: '蔚', subTitle: '铲除者', errata: '勘误效果' },
      { ...defaults, cardNo: 'ARC·002·SC', cardName: '凯特琳', subTitle: '' },
      { ...defaults, cardNo: 'NEW·001·SC', cardName: '新卡', subTitle: '' },
      ...Array.from({ length: 205 }, (_, i) => ({ ...defaults, cardNo: `ARC·${String(i+100).padStart(3,'0')}·SC`, cardName: '蔚', subTitle: '铲除者' }))
    ];
    // 韩/繁中列已迁移：列存在但为空，官网面板据此放行繁中文本写入。
    const base = { id: 'b1', card_no: 'OGN-036', card_name_cn: '蔚', sub_title_cn: '铲除者', effect_cn: '库内效果', card_name_tw: null, sub_title_tw: null, effect_tw: null, card_name_kr: null, sub_title_kr: null, effect_kr: null, card_color_list: ['red'], region: [], tag: [], card_category: ['单位'], energy: 0, return_energy: 1, power: 3 };
    window.__db = {
      cards_base: [base, { ...base, id: 'b2', card_no: 'OGN-002', card_name_cn: '凯特琳', sub_title_cn: null }, { ...base, id: 'b3', card_no: 'ARC-002', card_name_cn: '凯特琳', sub_title_cn: null }],
      card_prints: [{ id: 'p1', card_id: 'b1', card_no_extend: 'ARC-001a', language: 'SC', artist: '旧画师', img_cdn: 'old.png', rarity_name: '异画', extend_rarity_name: '异画', series: 'ARC', flavor_text_cn: null, is_promo: false, back_image: 'preserve.png' },
        { id: 'p2', card_id: 'b1', card_no_extend: 'ARC-100', language: 'SC', artist: '旧画师100', img_cdn: 'old100.png', rarity_name: '异画', extend_rarity_name: '异画', series: 'ARC', flavor_text_cn: null, is_promo: false, back_image: 'preserve.png' }],
      card_icons: [], series: [{ code: 'ARC' }, { code: 'OGN' }], version: ['cards','prints','icons','series'].map((name,i)=>({id:i,name}))
    };
    // 官网卡表（繁中）夹具：一张有繁中文本与独立繁中卡图的 OGN-036，用于审核面板的繁中三列。
    const galleryCard = (image) => ({
      id: 'ogn-036-tw', publicCode: 'OGN-036', collectorNumber: 36, name: '蔚', subtitle: '鏟除者',
      set: { value: { id: 'OGN', label: 'Origins' } }, rarity: { value: { id: 'rare', label: 'Rare' } },
      cardType: { type: [{ id: 'unit', label: '單位' }] }, domain: { values: [{ id: 'chaos', label: '混沌' }] },
      cardImage: { url: image, accessibilityText: 'Riftbound Origins: Vi, Destructive.' },
      illustrator: { values: [{ label: '繁中畫師' }] },
      text: { richText: { body: '<p>當此單位造成傷害時，{{S}}。</p>' } },
      energy: { value: { id: '3' } }, might: { value: { id: '5' } }, tags: { tags: [] }
    });
    window.__gallerySets = [{ id: 'OGN', name: 'Origins', collectorNumberMax: 298 }];
    window.__galleryTw = [galleryCard('https://cdn/tw-036.png')];
    window.__galleryEn = [galleryCard('https://cdn/en-036.png')];
    if (window.__perfCount) {
      const count = window.__perfCount;
      window.__api = Array.from({length: count}, (_,i) => ({...defaults, cardNo: `ARC·${String(i+1).padStart(4,'0')}·SC`, cardName: `性能卡${i%900}`, subTitle: ''}));
      window.__db.cards_base = Array.from({length: 900}, (_,i) => ({...base, id:`base-${i}`, card_no:`BASE-${String(i+1).padStart(3,'0')}`, card_name_cn:`性能卡${i}`, sub_title_cn: null}));
      window.__db.card_prints = window.__api.map((r,i) => ({...window.__db.card_prints[0], id:`print-${i}`, card_id:`base-${i%900}`, card_no_extend:r.cardNo.replaceAll('·','-').replace('-SC','')}));
    }
    window.__writes = []; window.__downloads = []; window.__failNext = false;
    URL.createObjectURL = (blob) => { blob.text().then(text => window.__downloads.push(text)); return 'blob:mock'; };
    HTMLAnchorElement.prototype.click = function() {};
    const original = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (url.pathname.startsWith('/api/riftbound/gallery/')) {
        if (url.pathname.endsWith('/sets')) return Response.json({ data: window.__gallerySets });
        const locale = url.searchParams.get('locale');
        const from = Number(url.searchParams.get('from') ?? 0);
        const data = from > 0 ? [] : locale === 'zh_TW' ? window.__galleryTw : locale === 'en_US' ? window.__galleryEn : [];
        return Response.json({ data, metadata: { totalItems: data.length } });
      }
      if (url.origin === location.origin) return original(input, init);
      if (url.pathname.includes('/xcx/')) {
        if (url.pathname.endsWith('searchCardCraft')) { const {pageNum=1,pageSize=1000}=JSON.parse(init.body); return Response.json({ code: 0, result: window.__api.slice((pageNum-1)*pageSize,pageNum*pageSize) }); }
        if (url.pathname.endsWith('cardDetail')) {
          const cardNo = JSON.parse(init.body).cardNo;
          const row = window.__api.find(r => r.cardNo === cardNo);
          return Response.json({ code: 0, result: { ...row, cardSeries: row.cardNo.split('·')[0], attachEffect: '装配效果', craftList: [{ frontImage: 'wrong.png' }] } });
        }
        return Response.json({ code: 0, result: [] });
      }
      if (url.pathname.includes('/rest/v1/')) {
        const table = url.pathname.split('/').pop();
        if (table === 'series' && /\bid\b/.test([url.searchParams.get('order'), url.searchParams.get('select')].join(','))) return Response.json({message: 'column series.id does not exist'}, {status: 400});
        const list = window.__db[table] ?? [];
        const method = init.method ?? 'GET';
        const matching = list.filter(r => [...url.searchParams].every(([k,v]) => !v.startsWith('eq.') || String(r[k]) === v.slice(3)));
        if (method === 'GET') { const offset=Number(url.searchParams.get('offset')??0); const limit=Number(url.searchParams.get('limit')??matching.length); return Response.json(matching.slice(offset,offset+limit)); }
        const payload = JSON.parse(init.body ?? '{}');
        window.__writes.push({ table, method, payload });
        if (window.__failNext) { window.__failNext = false; return Response.json({ message: '模拟失败，保留编辑' }, { status: 500 }); }
        if (method === 'POST') { const row = table === 'series' ? { ...payload } : { id: `new-${window.__writes.length}`, ...payload }; list.push(row); window.__db[table] = list; return Response.json([row]); }
        if (method === 'PATCH') { for (const row of matching) Object.assign(row, payload); return Response.json(matching); }
      }
      return Response.json([]);
    };
  };
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `window.__perfCount=${perf ? 1500 : 0}; (${fixture.toString()})()` });
  await cdp('Page.navigate', { url: new URL('/#/editorial/sync', process.env.SYNC_REVIEW_URL ?? 'http://127.0.0.1:5173').href });
  const waitFor = async (expression) => {
    for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await sleep(150); }
    throw new Error(`Timed out: ${expression}\n${await evaluate('document.body?.innerText')}`);
  };
  const click = async (text) => { await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)})?.click()`); await sleep(100); };
  const open = async (label) => { await evaluate(`[...document.querySelectorAll('tbody tr')].find(r => r.innerText.includes(${JSON.stringify(label)}))?.querySelector('[data-testid="row-open"]')?.click()`); await sleep(100); };
  const checkField = async (field) => { await evaluate(`document.querySelector('[aria-label="更新 ${field}"]').click()`); await sleep(100); };
  const edit = async (field, value) => { await evaluate(`(() => {const el=document.querySelector('[aria-label="编辑 ${field}"]'); el.value=${JSON.stringify(value)}; el.dispatchEvent(new Event('input',{bubbles:true}));})()`); await sleep(100); };
  const filter = async (value) => { await evaluate(`(() => { const el=document.querySelector('[data-testid="sync-review"] [aria-label="搜索卡号或卡名"]'); el.value=${JSON.stringify(value)}; el.dispatchEvent(new Event('input',{bubbles:true})); })()`); await sleep(100); };
  const gallery = (selector) => `document.querySelector('[data-testid="gallery-review"]').querySelector(${JSON.stringify(selector)})`;
  const galleryAll = (selector) => `[...document.querySelector('[data-testid="gallery-review"]').querySelectorAll(${JSON.stringify(selector)})]`;
  await waitFor(`document.body?.innerText.includes('选择拉取内容')`);
  // 小程序面板必须先勾选「卡牌与关键词图标」；官网面板那只按钮文案同样是「开始拉取」，
  // 所以按 testid 定位，避免点到未启用的一只。
  await evaluate(`(() => { const label=[...document.querySelectorAll('label')].find(l=>l.innerText.includes('卡牌与关键词图标')); label.querySelector('input[type="checkbox"]').click(); })()`);
  await sleep(100);
  await waitFor(`!document.querySelector('[data-testid="sync-pull"]').disabled`);
  const startLoad = performance.now();
  await evaluate(`document.querySelector('[data-testid="sync-pull"]').click()`);
  await waitFor(`document.body.innerText.includes('逐条审核同步差异')`);
  if (perf) {
    console.log(`PERF initial load ${Math.round(performance.now()-startLoad)} ms`);
    await cdp('HeapProfiler.collectGarbage');
    const beforeHeap = await cdp('Runtime.getHeapUsage');
    await cdp('Profiler.enable'); await cdp('Profiler.start');
    const measured = async (name, action) => {
      const ms = await evaluate(`(async()=>{const start=performance.now(); ${action}; await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); return performance.now()-start;})()`);
      console.log(`PERF ${name}: ${Math.round(ms)} ms`);
      return ms;
    };
    const timings = [];
    timings.push(await measured('open editor', `document.body.querySelector('[data-testid="row-open"]').click()`));
    timings.push(await measured('select attribute', `document.querySelector('[aria-label="更新 artist"]').click()`));
    timings.push(await measured('edit artist', `const el=document.querySelector('[aria-label="编辑 artist"]'); el.value='性能测试画师'; el.dispatchEvent(new Event('input',{bubbles:true}))`));
    timings.push(await measured('toggle record', `document.querySelector('tbody tr input[type="checkbox"]').click()`));
    timings.push(await measured('bulk select fields', `document.querySelector('[data-testid="bulk-select-fields"]').click(); await new Promise(r=>setTimeout(r,0)); document.querySelector('[data-testid="bulk-select-fields-confirm"]').click()`));
    timings.push(await measured('switch tab', `[...document.querySelectorAll('[data-testid="sync-review"] button')].find(b=>b.textContent.trim().startsWith('基础卡 ·')).click()`));
    const cpu = await cdp('Profiler.stop');
    writeFileSync('/tmp/sync-review-performance.cpuprofile', JSON.stringify(cpu.result.profile));
    const top = [...cpu.result.profile.nodes].sort((a,b)=>(b.hitCount??0)-(a.hitCount??0)).slice(0,12).map(n=>({name:n.callFrame.functionName,url:n.callFrame.url.split('/').slice(-2).join('/'),hits:n.hitCount}));
    await cdp('HeapProfiler.collectGarbage');
    const afterHeap = await cdp('Runtime.getHeapUsage');
    console.log(JSON.stringify({timings,heapBeforeMB:Math.round(beforeHeap.result.usedSize/1048576),heapAfterMB:Math.round(afterHeap.result.usedSize/1048576),top},null,2));
    if(process.argv.includes('--assert-fast')) assert.ok(Math.max(...timings)<500, 'each interaction must finish within 500 ms for 1500 print records');
  } else {

  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith('缺失系列 ·')).click()`);
  await sleep(100); await open('NEW'); await click('Insert 此条记录');
  await waitFor(`window.__db.series.some(s=>s.code==='NEW')`);
  await waitFor(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='缺失系列 · 0')`);
  assert.equal(await evaluate(`window.__db.series.find(s=>s.code==='NEW').id`), undefined);
  assert.ok(!(await evaluate('document.body.innerText')).includes('未返回唯一'));
  console.log('✓ series 无 id：库内读取和单条新增都正常');
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith('印刷版本 ·')).click()`);
  await sleep(100);
  assert.ok((await evaluate('document.body.innerText')).includes('1 / 7'), 'All records are paginated');
  await click('下一页');
  assert.ok((await evaluate('document.body.innerText')).includes('2 / 7'));
  console.log('✓ 差异表分页可访问 200 行限制外的记录');
  await filter('ARC-001a'); await open('ARC-001a');
  assert.equal(await evaluate(`document.querySelectorAll('[aria-label^="更新 "]:checked').length`), 0);
  assert.ok(!(await evaluate(`document.querySelector('[data-testid="sync-editor"]').innerText`)).includes('back_image'));
  assert.equal(await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='提交勾选字段').disabled`), true);
  await edit('artist', '人工编辑画师'); await checkField('artist');
  await click('导出本阶段 SQL');
  await waitFor('window.__downloads.length > 0');
  const sql = await evaluate('window.__downloads.at(-1)');
  const updateSql = sql.slice(sql.indexOf('UPDATE public.card_prints'), sql.indexOf('IF NOT FOUND'));
  assert.ok(updateSql.includes('artist') && !updateSql.includes('img_cdn') && !sql.includes('back_image'));
  await click('提交勾选字段');
  await waitFor(`window.__writes.some(w=>w.table==='card_prints')`);
  const first = await evaluate(`window.__writes.find(w=>w.table==='card_prints')`);
  assert.deepEqual(Object.keys(first.payload).sort(), ['artist','updated_at']);
  assert.equal(first.payload.artist, '人工编辑画师');
  assert.equal(await evaluate('window.__db.card_prints[0].back_image'), 'preserve.png');
  console.log('✓ 字段默认不勾选，手动编辑值用于 SQL 和单条 PATCH，背面图保持不变');
  await filter('ARC-002'); await open('ARC-002');
  assert.ok((await evaluate(`document.querySelector('[data-testid="sync-editor"]').innerText`)).includes('请选择关联记录'));
  await evaluate(`(() => {const el=document.querySelector('[data-testid="sync-editor"] select'); el.value='b3'; el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await sleep(100); await click('Insert 此条记录');
  await waitFor(`window.__writes.some(w=>w.method==='POST' && w.payload.card_no_extend==='ARC-002')`);
  assert.equal(await evaluate(`window.__writes.find(w=>w.payload.card_no_extend==='ARC-002').payload.card_id`), 'b3');
  console.log('✓ 重复基础卡手选后才可创建关联的印刷版本');
  await filter('NEW-001'); await open('NEW-001');
  await click('查看 / 创建基础卡 →');
  const before = await evaluate('window.__writes.length');
  await click('Insert 此条记录');
  await waitFor(`window.__writes.slice(${before}).some(w=>w.table==='cards_base' && w.method==='POST')`);
  assert.equal(await evaluate(`window.__writes.slice(${before}).some(w=>w.table==='card_prints')`), false);
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith('印刷版本 ·')).click()`);
  await sleep(100); await open('NEW-001');
  await click('Insert 此条记录');
  await waitFor(`window.__writes.some(w=>w.payload.card_no_extend==='NEW-001')`);
  console.log('✓ 新基础卡和印刷版本分别点击提交，没有自动连写');
  await filter('ARC-001a'); await open('ARC-001a');
  await edit('img_cdn', 'edited.png'); await checkField('img_cdn');
  await evaluate('window.__failNext = true');
  await click('提交勾选字段');
  await waitFor(`document.body.innerText.includes('模拟失败')`);
  assert.equal(await evaluate(`document.querySelector('[aria-label="编辑 img_cdn"]').value`), 'edited.png');
  assert.equal(await evaluate(`document.querySelector('[aria-label="更新 img_cdn"]').checked`), true);
  console.log('✓ 提交失败保留编辑值和字段选择');
  await click('清空本阶段批量选择');
  await click('包含当前筛选结果');
  const countBeforeBatch = await evaluate('window.__writes.length');
  await click('提交本阶段 1 条');
  await waitFor(`window.__writes.slice(${countBeforeBatch}).some(w=>w.table==='card_prints')`);
  const batchWrites = await evaluate(`window.__writes.slice(${countBeforeBatch}).filter(w=>w.table==='card_prints')`);
  assert.equal(batchWrites.length, 1);
  assert.deepEqual(Object.keys(batchWrites[0].payload).sort(), ['img_cdn','updated_at']);
  console.log('✓ 批量提交只包含所选记录和所选字段');

  // ── 一键勾选更新字段：行内全选 + 当前筛选批量全选 ──
  await filter('ARC-100');
  assert.ok((await evaluate(`document.querySelector('[data-testid="sync-review"]').innerText`)).includes('已勾选 0 项'));
  assert.equal(await evaluate(`document.querySelector('[data-testid="row-select-fields"]').textContent.trim()`), '全选 2 项');
  assert.match(await evaluate(`document.querySelector('[data-testid="bulk-select-fields"]').textContent.trim()`), /1 行 · 2 个字段/);
  await evaluate(`document.querySelector('[data-testid="row-select-fields"]').click()`);
  await sleep(100);
  assert.equal(await evaluate(`document.querySelector('[data-testid="row-clear-fields"]').textContent.trim()`), '取消勾选');
  await evaluate(`document.querySelector('[data-testid="row-open"]').click()`);
  await sleep(150);
  assert.equal(await evaluate(`document.querySelectorAll('[data-testid="sync-editor"] [aria-label^="更新 "]:checked').length`), 2);
  console.log('✓ 行内「全选 2 项」一次勾完差异字段，编辑器同步勾选');
  await evaluate(`document.querySelector('[data-testid="editor-toggle-fields"]').click()`);
  await sleep(100);
  assert.equal(await evaluate(`document.querySelectorAll('[data-testid="sync-editor"] [aria-label^="更新 "]:checked').length`), 0);
  // 两步确认：第一次点击只进入确认态，不会先斩后奏
  await evaluate(`document.querySelector('[data-testid="bulk-select-fields"]').click()`);
  await sleep(100);
  assert.equal(await evaluate(`document.querySelectorAll('[data-testid="sync-editor"] [aria-label^="更新 "]:checked').length`), 0);
  assert.match(await evaluate(`document.querySelector('[data-testid="bulk-select-fields-confirm"]').textContent.trim()`), /确认勾选 2 个字段/);
  await evaluate(`document.querySelector('[data-testid="bulk-select-fields-confirm"]').click()`);
  await sleep(100);
  assert.equal(await evaluate(`document.querySelectorAll('[data-testid="sync-editor"] [aria-label^="更新 "]:checked').length`), 2);
  console.log('✓ 批量「包含并勾选」二次确认后一次勾完当前筛选的差异字段');
  await evaluate(`document.querySelector('[data-testid="bulk-clear-fields"]').click()`);
  await sleep(100);
  assert.equal(await evaluate(`document.querySelectorAll('[data-testid="sync-editor"] [aria-label^="更新 "]:checked').length`), 0);
  console.log('✓ 「清空本阶段字段勾选」回到默认不勾选状态');
  await evaluate(`document.querySelector('[data-testid="bulk-select-fields"]').click()`);
  await sleep(100);
  await evaluate(`document.querySelector('[data-testid="bulk-select-fields-confirm"]').click()`);
  await sleep(100);
  // 该行此前被「清空本阶段批量选择」排除，批量勾选要顺带把它包含进来，否则提交会静默跳过。
  assert.equal(await evaluate(`[...document.querySelectorAll('[data-testid="sync-review"] button')].find(b=>b.textContent.trim().startsWith('提交本阶段'))?.textContent.trim()`), '提交本阶段 1 条');
  const countBeforeFields = await evaluate('window.__writes.length');
  await click('提交本阶段 1 条');
  await waitFor(`window.__writes.slice(${countBeforeFields}).some(w=>w.table==='card_prints')`);
  const fieldWrites = await evaluate(`window.__writes.slice(${countBeforeFields}).filter(w=>w.table==='card_prints')`);
  assert.equal(fieldWrites.length, 1);
  assert.deepEqual(Object.keys(fieldWrites[0].payload).sort(), ['artist','img_cdn','updated_at']);
  console.log('✓ 一键勾选后的差异字段按补丁提交，未勾选字段不进 payload');

  await evaluate(`document.querySelector('[data-testid="sync-editor"]').scrollIntoView({block:'start'})`);
  await sleep(250);
  await cdp('Page.captureScreenshot', { format: 'png' }).then(r => writeFileSync('/tmp/sync-review-desktop.png', Buffer.from(r.result.data,'base64')));
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate(`document.querySelector('[data-testid="sync-editor"]').scrollIntoView({block:'start'})`);
  await sleep(250);
  await cdp('Page.captureScreenshot', { format: 'png' }).then(r => writeFileSync('/tmp/sync-review-mobile.png', Buffer.from(r.result.data,'base64')));

  // ── 官网卡表面板：繁中三列（用户实际卡点） ──
  await evaluate(`(() => { const el=document.querySelector('[data-testid="gallery-locale"]'); el.value='zh_TW'; el.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await sleep(200);
  await waitFor(`!document.querySelector('[data-testid="gallery-fetch"]').disabled`);
  await evaluate(`document.querySelector('[data-testid="gallery-fetch"]').click()`);
  await waitFor(`Boolean(document.querySelector('[data-testid="gallery-review"]'))`);
  await evaluate(`${galleryAll('button')}.find(b=>b.textContent.trim().startsWith('基础卡 ·')).click()`);
  await sleep(150);
  const galleryRow = await evaluate(`${gallery('tbody tr')}.innerText`);
  assert.match(galleryRow, /繁中名、繁中副标题、繁中效果/);
  assert.match(galleryRow, /已勾选 0 项/);
  assert.equal(await evaluate(`${gallery('[data-testid="row-select-fields"]')}.textContent.trim()`), '全选 3 项');
  await evaluate(`${gallery('[data-testid="row-select-fields"]')}.click()`);
  await sleep(100);
  assert.match(await evaluate(`${gallery('tbody tr')}.innerText`), /已勾选 3 项/);
  await evaluate(`${gallery('[data-testid="row-open"]')}.click()`);
  await sleep(150);
  assert.equal(await evaluate(`document.querySelectorAll('[data-testid="gallery-editor"] [aria-label^="更新 "]:checked').length`), 3);
  console.log('✓ 官网繁中面板：行内一次勾完繁中名/繁中副标题/繁中效果');
  await evaluate(`${gallery('[data-testid="bulk-clear-fields"]')}.click()`);
  await sleep(100);
  assert.equal(await evaluate(`document.querySelectorAll('[data-testid="gallery-editor"] [aria-label^="更新 "]:checked').length`), 0);
  await evaluate(`${gallery('[data-testid="bulk-select-fields"]')}.click()`);
  await sleep(100);
  assert.match(await evaluate(`${gallery('[data-testid="bulk-select-fields-confirm"]')}.textContent.trim()`), /确认勾选 3 个字段/);
  await evaluate(`${gallery('[data-testid="bulk-select-fields-confirm"]')}.click()`);
  await sleep(100);
  assert.equal(await evaluate(`document.querySelectorAll('[data-testid="gallery-editor"] [aria-label^="更新 "]:checked').length`), 3);
  const countBeforeGallery = await evaluate('window.__writes.length');
  await evaluate(`${galleryAll('button')}.find(b=>b.textContent.trim().startsWith('提交本阶段')).click()`);
  await waitFor(`window.__writes.slice(${countBeforeGallery}).some(w=>w.table==='cards_base')`);
  const galleryWrite = await evaluate(`window.__writes.slice(${countBeforeGallery}).find(w=>w.table==='cards_base')`);
  assert.deepEqual(Object.keys(galleryWrite.payload).sort(), ['card_name_tw','effect_tw','sub_title_tw','updated_at']);
  console.log('✓ 官网繁中面板：批量勾选后按繁中三列补丁提交，其他语言列不动');
  assert.deepEqual(exceptions, []);
  console.log('✓ 浏览器无未捕获异常；已保存桌面和手机截图');
  }
} finally { ws?.close(); chrome.kill(); }
