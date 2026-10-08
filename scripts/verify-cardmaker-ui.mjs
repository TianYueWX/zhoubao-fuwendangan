// Browser acceptance with local catalog/image fixtures. No requests write to a live service.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Papa from 'papaparse';
const root = process.cwd(),
  dist = join(root, 'dist'),
  debugPort = 40000 + Math.floor(Math.random() * 10000);
const app = `file://${dist}/index.html`,
  artifacts = mkdtempSync('/tmp/rune-cardmaker-ui-');
const chrome = spawn(
  process.env.CHROME_PATH ??
    `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1200/chrome-headless-shell-linux64/chrome-headless-shell`,
  [
    '--headless',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-sandbox',
    '--no-proxy-server',
    '--allow-file-access-from-files',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${join(artifacts, 'profile')}`,
    '--window-size=1480,980',
    'about:blank',
  ],
  { stdio: 'ignore' },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws,
  count = 0;
const bases = Papa.parse(readFileSync('public/data/cards_base_rows.csv', 'utf8'), {
  header: true,
  skipEmptyLines: true,
}).data;
const prints = Papa.parse(readFileSync('public/data/card_prints_rows.csv', 'utf8'), {
  header: true,
  skipEmptyLines: true,
}).data;
const localFiles = Object.fromEntries(
  readdirSync(join(dist, 'cardmaker/frames')).map((name) => [
    name,
    readFileSync(join(dist, 'cardmaker/frames', name), 'utf8'),
  ]),
);
const setup = `(() => {
  const localFiles=${JSON.stringify(localFiles)};
  const canvas=document.createElement('canvas');canvas.width=745;canvas.height=1040;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#418faf';ctx.fillRect(0,0,745,1040);ctx.fillStyle='#183638';ctx.fillRect(220,230,230,300);ctx.fillStyle='#f2e9c4';ctx.beginPath();ctx.arc(320,170,65,0,7);ctx.fill();
  const data=canvas.toDataURL('image/png');window.__fixtureImage=data;
  const original=window.fetch.bind(window),cards=${JSON.stringify(bases)},prints=${JSON.stringify(prints)}.map(p=>({...p,img_cdn:data,tts_cdn:data}));
  window.__requests=[];window.fetch=async(input,options={})=>{const url=new URL(typeof input==='string'?input:input.url,location.href);if(url.pathname.includes('/cardmaker/frames/'))return new Response(localFiles[url.pathname.split('/').pop()],{status:200,headers:{'Content-Type':'image/svg+xml'}});if(!url.pathname.includes('/rest/v1/'))return original(input,options);const method=options.method||'GET';window.__requests.push(method);if(method!=='GET')throw new Error('Live writes forbidden in cardmaker');const table=url.pathname.split('/').pop(),source=table==='cards_base'?cards:table==='card_prints'?prints:[],offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||1000),rows=source.slice(offset,offset+limit);return new Response(JSON.stringify(rows),{status:200,headers:{'content-range':offset+'-'+Math.max(offset,offset+rows.length-1)+'/'+source.length}});};
  window.__downloads=[];const create=URL.createObjectURL.bind(URL),blobs=new Map();URL.createObjectURL=b=>{const url=create(b);blobs.set(url,b);return url;};const click=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download){window.__downloads.push({name:this.download,blob:blobs.get(this.href)});return;}click.call(this);};
})()`;
try {
  let tabs;
  for (let i = 0; i < 40; i++) {
    try {
      tabs = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      break;
    } catch {
      await sleep(200);
    }
  }
  if (!tabs) throw new Error('Chrome not available');
  ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let sequence = 0;
  const pending = new Map(),
    exceptions = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id) {
      pending.get(m.id)?.(m);
      pending.delete(m.id);
    } else if (m.method === 'Runtime.exceptionThrown')
      exceptions.push(
        m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text,
      );
  };
  const cdp = (method, params = {}) =>
    new Promise((r, j) => {
      const id = ++sequence,
        timer = setTimeout(() => {
          pending.delete(id);
          j(new Error('CDP timeout: ' + method));
        }, 20000);
      pending.set(id, (m) => {
        clearTimeout(timer);
        m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result);
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const js = async (expression) => {
    const r = await cdp('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails)
      throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result?.value;
  };
  const wait = async (expression) => {
    for (let i = 0; i < 100; i++) {
      try {
        if (await js(expression)) return;
      } catch {
        /* reload */
      }
      await sleep(150);
    }
    throw new Error(
      `Wait failed: ${expression}\n${await js('document.body.innerText.slice(0,1500)')}\n${exceptions.join('\n')}`,
    );
  };
  const test = async (name, fn) => {
    await fn();
    count++;
    console.log('✓ ' + name);
  };
  const click = async (selector) => {
    assert(await js(`!!document.querySelector(${JSON.stringify(selector)})`), selector);
    await js(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await sleep(100);
  };
  const text = async (label) => {
    await wait(
      `[...document.querySelectorAll('button')].some(b=>b.checkVisibility()&&!b.disabled&&b.textContent.trim()===${JSON.stringify(label)})`,
    );
    const found = await js(
      `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.checkVisibility()&&!b.disabled&&b.textContent.trim()===${JSON.stringify(label)});b?.click();return !!b})()`,
    );
    assert(found, label);
    await sleep(100);
  };
  const input = async (selector, value, kind = 'input') => {
    await js(
      `(()=>{const i=document.querySelector(${JSON.stringify(selector)});if(!i)throw new Error('Input not found');i.value=${JSON.stringify(value)};i.dispatchEvent(new Event(${JSON.stringify(kind)},{bubbles:true}));})()`,
    );
    await sleep(100);
  };
  const close = () => click('dialog>header button');
  const shot = async (name) => {
    const r = await cdp('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(artifacts, name + '.png'), Buffer.from(r.data, 'base64'));
  };
  const work = async () =>
    js(
      `new Promise((resolve,reject)=>{const r=indexedDB.open('rune.cardmaker.v1');r.onsuccess=()=>{const d=r.result,tx=d.transaction(['works','meta']),m=tx.objectStore('meta').get('current');m.onsuccess=()=>{const q=tx.objectStore('works').get(m.result);q.onsuccess=()=>resolve(q.result?.document);};tx.oncomplete=()=>d.close();};r.onerror=()=>reject(r.error);})`,
    );
  const saved = () =>
    wait("document.querySelector('.maker-work-name span')?.textContent==='已保存到本机'");
  const json = async () => {
    await text('导出');
    await text('下载 JSON 项目');
    await close();
    return js(
      "(async()=>{const d=window.__downloads.filter(d=>d.name.endsWith('.json')).at(-1);return JSON.parse(await d.blob.text())})()",
    );
  };
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Network.enable');
  await cdp('Network.setBlockedURLs', {
    urls: ['https://fonts.googleapis.com/*', 'https://fonts.gstatic.com/*'],
  });
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: setup });
  await cdp('Page.navigate', { url: app + '#/cardmaker' });
  await wait(
    "document.querySelector('.maker-canvas canvas') && document.querySelector('.cardmaker')?.getAttribute('aria-busy')==='false'",
  );
  await test('中文文字即时绘制，双语独立编辑与撤销重做', async () => {
    const before = await js("document.querySelector('.maker-canvas canvas').toDataURL()");
    await input('.maker-fields input', '风暴使者');
    await input('textarea[aria-label="卡牌效果"]', '**迅捷**\n{{怒}} 获得 +2 战力。');
    await saved();
    assert.notEqual(await js("document.querySelector('.maker-canvas canvas').toDataURL()"), before);
    await text('English');
    await input('.maker-fields input', 'Storm Herald');
    await saved();
    await text('中文');
    await saved();
    assert.equal(await js("document.querySelector('.maker-fields input').value"), '风暴使者');
    await input('.maker-fields input', '变化后的卡名');
    await sleep(600);
    await click('[aria-label="撤销"]');
    assert.equal(await js("document.querySelector('.maker-fields input').value"), '风暴使者');
    await click('[aria-label="重做"]');
    assert.equal(await js("document.querySelector('.maker-fields input').value"), '变化后的卡名');
    await saved();
  });
  await test('多图层上传、复制、位置/旋转/透明度、裁剪和锁定', async () => {
    await js(
      `(async()=>{const blob=await(await fetch(window.__fixtureImage)).blob(),file=new File([blob],'测试配图.png',{type:'image/png'}),dt=new DataTransfer();dt.items.add(file);const i=document.querySelector('input[type=file][multiple]');i.files=dt.files;i.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
    await wait("document.querySelector('.maker-edit .maker-layers input')?.value==='测试配图.png'");
    await saved();
    await input('.maker-edit .ml-grid label:nth-child(5) input', 23, 'change');
    await input('.maker-edit .ml-grid label:nth-child(6) input', 63, 'change');
    await click('.maker-edit details summary');
    await input('.maker-edit details .ml-grid label:nth-child(1) input', 10, 'change');
    await input('.maker-edit details .ml-grid label:nth-child(3) input', 75, 'change');
    await text('复制');
    await saved();
    let d = await work();
    assert.equal(d.layers.length, 2);
    assert.equal(d.layers[0].rotation, 23);
    assert.equal(d.layers[0].opacity, 0.63);
    assert.equal(d.layers[0].crop.width, 0.75);
    await text('图层');
    await click('.maker-edit .ml-row [aria-label="锁定图层"]');
    await saved();
    d = await work();
    assert(d.layers.at(-1).locked);
    await click('.maker-edit .ml-row [aria-label="解锁图层"]');
    await shot('desktop');
  });
  let project;
  await test('JSON 包含双语和图片；PNG 为 1490×2080，预览与导出颜色一致', async () => {
    project = await json();
    assert.equal(project.assets.length, 1);
    assert.equal(project.document.layers.length, 2);
    assert.equal(project.document.copy.en.name, 'Storm Herald');
    await text('导出');
    await text('下载 PNG');
    await wait("window.__downloads.some(d=>d.name.endsWith('.png'))");
    const result = await js(
      `(async()=>{const image=await createImageBitmap(window.__downloads.find(d=>d.name.endsWith('.png')).blob),preview=document.querySelector('.maker-canvas canvas'),c=document.createElement('canvas');c.width=preview.width;c.height=preview.height;const ctx=c.getContext('2d');ctx.drawImage(image,0,0,c.width,c.height);const a=ctx.getImageData(0,0,c.width,c.height).data,b=preview.getContext('2d').getImageData(0,0,c.width,c.height).data;let delta=0,n=0;for(let y=10;y<c.height-10;y+=17)for(let x=10;x<c.width-10;x+=17){const i=(y*c.width+x)*4;for(let k=0;k<3;k++){delta+=Math.abs(a[i+k]-b[i+k]);n++;}}return{width:image.width,height:image.height,difference:delta/n};})()`,
    );
    assert.equal(result.width, 1490);
    assert.equal(result.height, 2080);
    assert(result.difference < 8, JSON.stringify(result));
  });
  await test('刷新恢复图层与双语；JSON 导入生成独立作品，图层资产完整', async () => {
    await saved();
    const previous = await work();
    await cdp('Page.reload');
    await wait("document.querySelector('.maker-canvas canvas')");
    await saved();
    assert.deepEqual((await work()).layers, previous.layers);
    await js(
      `(()=>{const file=new File([${JSON.stringify(JSON.stringify(project))}],'roundtrip.json',{type:'application/json'}),dt=new DataTransfer();dt.items.add(file);const i=document.querySelector('input[type=file]:not([multiple])');i.files=dt.files;i.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
    await wait("document.body.innerText.includes('项目与图片已导入')");
    await saved();
    const after = await json();
    assert.notEqual(after.document.id, previous.id);
    assert.notEqual(after.assets[0].id, project.assets[0].id);
    assert.equal(after.assets[0].data, project.assets[0].data);
    assert.deepEqual(after.document.copy, project.document.copy);
  });
  await test('作品库打开、复制、改名与删除，复制作品保留共享图片', async () => {
    await text('作品库');
    await wait("document.querySelectorAll('.mk-work-grid article').length>=2");
    const before = await js("document.querySelectorAll('.mk-work-grid article').length");
    await click('.mk-work-actions button');
    await wait("!document.querySelector('dialog')");
    await saved();
    await text('作品库');
    assert.equal(await js("document.querySelectorAll('.mk-work-grid article').length"), before + 1);
    await click('.mk-work-actions button:nth-child(2)');
    await input('[aria-label="新的作品名称"]', '图层备份');
    await text('保存名称');
    await wait("document.querySelector('.mk-open-work strong')?.textContent==='图层备份'");
    await click('.mk-work-actions button:nth-child(3)');
    await text('删除作品');
    await wait("document.querySelectorAll('.mk-work-grid article').length===" + before);
    await click('.mk-open-work');
    await saved();
    assert.equal((await json()).assets.length, 1);
  });
  await test('所有模板、稀有度与横版 PNG 可以加载、导出', async () => {
    for (const [label, type] of [
      ['单位', 'unit'],
      ['法术', 'spell'],
      ['装备', 'gear'],
      ['传奇', 'legend'],
      ['战场', 'battlefield'],
      ['符文', 'rune'],
    ]) {
      await text('新建');
      await js(
        `(()=>{const b=[...document.querySelectorAll('.mk-template-grid button')].find(b=>b.querySelector('strong')?.textContent===${JSON.stringify(label)});if(!b)throw new Error('Template not found');b.click()})()`,
      );
      await saved();
      await text('数值');
      for (const rarity of ['common', 'uncommon', 'rare', 'epic']) {
        await input(
          '.maker-fields label:nth-of-type(' + (type === 'unit' ? 3 : 2) + ') select',
          rarity,
          'change',
        );
        await sleep(200);
        await text('导出');
        await wait(
          "[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='下载 PNG'&&!b.disabled)",
        );
        await text('下载 PNG');
        await wait("!document.querySelector('dialog')");
      }
      await shot('template-' + type);
    }
    const dims = await js(
      "(async()=>{const last=window.__downloads.filter(d=>d.name.endsWith('.png')).at(-5),image=await createImageBitmap(last.blob);return [image.width,image.height]})()",
    );
    assert.deepEqual(dims, [2080, 1490]);
  });
  await test('卡库载入英雄、双语、费用及配图，全部网络请求保持只读', async () => {
    await text('从卡库载入');
    await input('.mk-search', 'OGN-');
    await wait("document.querySelectorAll('.mk-card-grid button').length>0");
    await click('.mk-card-grid button');
    await text('以此卡制作');
    await saved();
    await wait(
      "document.body.innerText.includes('改编自') && document.querySelector('.maker-canvas canvas')",
    );
    await wait("document.querySelector('.maker-work-name span')?.textContent==='已保存到本机'");
    const d = await work();
    assert(d.source.startsWith('OGN-'));
    assert(d.copy.zh.name);
    assert(d.copy.en.name);
    assert.equal(d.layers.length, 1);
    assert((await js('window.__requests')).every((m) => m === 'GET'));
  });
  await cdp('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await sleep(200);
  await test('手机完整面板和窄屏布局；按钮调整、两指缩放、图层排序', async () => {
    await text('图层');
    await click('.maker-edit .ml-select');
    await text('图片');
    await text('铺满配图区');
    await saved();
    const beforeGesture = await work(),
      start = beforeGesture.layers[0];
    const rect = await js(
      "(()=>{const r=document.querySelector('.maker-canvas canvas').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()",
    );
    const cx = rect.x + rect.width / 2,
      cy = rect.y + rect.height * 0.35;
    await cdp('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: cx - 25, y: cy, id: 0 },
        { x: cx + 25, y: cy, id: 1 },
      ],
    });
    for (let i = 1; i <= 6; i++) {
      await cdp('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: cx - 25 - i * 4, y: cy - i * 3, id: 0 },
          { x: cx + 25 + i * 4, y: cy + i * 3, id: 1 },
        ],
      });
      await sleep(40);
    }
    await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await saved();
    const after = (await work()).layers[0];
    assert(after.width > start.width * 1.3);
    assert(after.rotation > 15);
    const centerX = (beforeGesture.type === 'battlefield' ? 1040 : 745) / 2;
    const centerY = (beforeGesture.type === 'battlefield' ? 745 : 1040) * 0.35;
    const localX = ((centerX - start.x) / start.width) * after.width;
    const localY = ((centerY - start.y) / start.height) * after.height;
    const angle = (after.rotation * Math.PI) / 180;
    assert(Math.abs(after.x + localX * Math.cos(angle) - localY * Math.sin(angle) - centerX) < 2);
    assert(Math.abs(after.y + localX * Math.sin(angle) + localY * Math.cos(angle) - centerY) < 2);
    await click('.maker-edit .ml-nudge button:nth-child(4)');
    await saved();
    await shot('mobile');
    for (const width of [320, 390, 768, 1024]) {
      await cdp('Emulation.setDeviceMetricsOverride', {
        width,
        height: 844,
        deviceScaleFactor: 1,
        mobile: width < 700,
      });
      await sleep(100);
      assert(await js('document.documentElement.scrollWidth <= innerWidth+1'), `overflow ${width}`);
    }
  });
  await test('手机竖版卡牌放大预览、独立面板滚动及键盘高度适配', async () => {
    await cdp('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await sleep(150);
    await text('数值');
    await input('.maker-fields label:first-of-type select', 'unit', 'change');
    await text('图片');
    await text('铺满配图区');
    await saved();
    await text('放大预览');
    assert.equal(
      await js("getComputedStyle(document.querySelector('.maker-edit')).display"),
      'none',
    );
    await shot('mobile-expanded');
    await text('返回编辑');
    await text('文字');
    assert(
      await js(
        "document.querySelector('.maker-edit-scroll').scrollHeight>document.querySelector('.maker-edit-scroll').clientHeight",
      ),
    );
    await cdp('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 480,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await sleep(200);
    assert(await js("document.querySelector('.maker-edit-scroll').clientHeight>90"));
    assert(
      await js(
        "parseFloat(getComputedStyle(document.querySelector('.maker-fields input')).fontSize)>=16",
      ),
    );
    await shot('mobile-keyboard');
    await cdp('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await sleep(150);
    await shot('mobile-portrait');
  });
  await test('卡库详情入口跳转到独立工坊作品', async () => {
    await cdp('Page.navigate', { url: app + '#/carddex' });
    await wait("document.querySelector('.card-open')");
    await click('.card-open');
    await wait("document.querySelector('.detail-maker-button')");
    await click('.detail-maker-button');
    await wait(
      "document.querySelector('.maker-canvas canvas') && document.body.innerText.includes('改编自')",
    );
    await saved();
    assert((await work()).source);
    // Route entry also remains discoverable on the homepage.
    await cdp('Page.navigate', { url: app + '#/' });
    await wait(
      "[...document.querySelectorAll('.shortcut-btn')].some(b=>b.textContent.includes('卡牌工坊'))",
    );
    await text('卡牌工坊');
    await wait("document.querySelector('.maker-canvas canvas')");
  });
  await test('修改后立即离开并返回，仍恢复最后的文字编辑', async () => {
    await text('文字');
    await wait(
      "document.querySelector('.maker-fields input') && document.querySelector('.cardmaker')?.getAttribute('aria-busy')==='false'",
    );
    await js(
      `(()=>{const i=document.querySelector('.maker-fields input');i.value='离开前最后编辑';i.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.maker-back').click()})()`,
    );
    await wait("document.querySelector('.home-shortcuts')");
    await text('卡牌工坊');
    await wait("document.querySelector('.maker-fields input')?.value==='离开前最后编辑'");
    await saved();
  });
  await test('删除最后一件作品后作品库为空，刷新不会生成多余空白作品', async () => {
    await text('作品库');
    while (await js("document.querySelectorAll('.mk-work-grid article').length")) {
      const before = await js("document.querySelectorAll('.mk-work-grid article').length");
      await click('.mk-work-actions button:nth-child(3)');
      await text('删除作品');
      await wait("document.querySelectorAll('.mk-work-grid article').length===" + (before - 1));
    }
    await close();
    await cdp('Page.reload');
    await wait(
      "document.querySelector('.maker-canvas canvas') && document.querySelector('.cardmaker')?.getAttribute('aria-busy')==='false'",
    );
    await text('作品库');
    assert.equal(await js("document.querySelectorAll('.mk-work-grid article').length"), 0);
    await close();
  });
  assert.deepEqual(exceptions, []);
  console.log(`\n${count} 项卡牌工坊浏览器验收通过；截图：${artifacts}`);
} finally {
  ws?.close();
  chrome.kill();
}
