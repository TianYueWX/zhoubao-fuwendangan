// 卡池浏览器验收:云端表用内存夹具(不写真库),覆盖门禁、记账、同步、筛选、手机版与构筑联动。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import Papa from 'papaparse';
const root=process.cwd(),dist=join(root,'dist'),port=4199,debugPort=9799,app=`http://127.0.0.1:${port}/`,shots=join(root,'shots/collection');
mkdirSync(shots,{recursive:true});
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.csv':'text/csv','.svg':'image/svg+xml','.png':'image/png','.json':'application/json','.woff2':'font/woff2'};
const server=createServer((req,res)=>{const path=resolve(dist,'.'+new URL(req.url,app).pathname);let file=path.startsWith(dist+'/')&&existsSync(path)&&!statSync(path).isDirectory()?path:join(dist,'index.html');res.setHeader('Content-Type',mime[extname(file)]??'application/octet-stream');res.end(readFileSync(file));});
await new Promise(r=>server.listen(port,'127.0.0.1',r));
const chrome=spawn(process.env.CHROME_PATH??`${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1200/chrome-headless-shell-linux64/chrome-headless-shell`,['--headless','--disable-gpu','--no-sandbox',`--remote-debugging-port=${debugPort}`,`--user-data-dir=${mkdtempSync('/tmp/rune-collection-ui-')}`,'--window-size=1680,1050','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let ws,passed=0;
const bases=Papa.parse(readFileSync('public/data/cards_base_rows.csv','utf8'),{header:true,skipEmptyLines:true}).data;
const prints=Papa.parse(readFileSync('public/data/card_prints_rows.csv','utf8'),{header:true,skipEmptyLines:true}).data;
const seedRows=[
  {id:'row-1',owner_id:'11111111-1111-4111-8111-111111111111',card_no:'VEN-188',language:'SC',quantity:1,created_at:'2026-10-20T00:00:00Z',updated_at:'2026-10-20T00:00:00Z'},
  {id:'row-2',owner_id:'11111111-1111-4111-8111-111111111111',card_no:'OGN-308',language:'EN',quantity:2,created_at:'2026-10-21T00:00:00Z',updated_at:'2026-10-21T00:00:00Z'},
];
const seedDeck={
  formatVersion:1,id:'deck-fixture',name:'卡池联动验收',description:'',
  zones:{legend:[],champion:[],main:[
    {cardNo:'VEN-188',printNo:'VEN-188',language:'SC',quantity:3,name:'测试主牌'},
    {cardNo:'OGN-308',printNo:'OGN-308',language:'EN',quantity:1,name:'已有两张'},
  ],battlefield:[],rune:[],side:[],additional:[]},
  createdAt:'2026-10-20T00:00:00.000Z',updatedAt:'2026-10-20T00:00:00.000Z',savedAt:'2026-10-20T00:00:00.000Z',
};
const setup=`(() => {
  const original=window.fetch.bind(window), cards=${JSON.stringify(bases)}, prints=${JSON.stringify(prints)};
  window.__collectionRequests=[];
  if(!localStorage.getItem('__test_seeded')){
    localStorage.setItem('__test_seeded','1');
    localStorage.setItem('__test_collection',JSON.stringify(${JSON.stringify(seedRows)}));
    localStorage.setItem('rune.deckbuilder.v1',JSON.stringify({formatVersion:1,decks:[${JSON.stringify(seedDeck)}],drafts:{}}));
  }
  if(localStorage.getItem('__test_guest')){localStorage.removeItem('riftbound-editorial-session');}
  const owner=()=>localStorage.getItem('__test_owner')||'11111111-1111-4111-8111-111111111111';
  const rows=()=>JSON.parse(localStorage.getItem('__test_collection')||'[]');
  const save=list=>localStorage.setItem('__test_collection',JSON.stringify(list));
  const filterValue=url=>key=>{const v=url.searchParams.get(key);return v?v.replace(/^eq\\./,''):'';};
  window.fetch=async (input,options={})=>{
    const url=new URL(typeof input==='string'?input:input.url,location.href),method=options.method||'GET';
    if(!url.pathname.includes('/rest/v1/')&&!url.pathname.includes('/auth/v1/'))return original(input,options);
    const table=url.pathname.split('/').pop();
    if(url.pathname.includes('/auth/v1/user'))return new Response(JSON.stringify({id:owner(),app_metadata:{role:'admin'}}),{status:200,headers:{'content-type':'application/json'}});
    if(table==='web_collection'){
      const get=filterValue(url),body=options.body?JSON.parse(options.body):null;
      window.__collectionRequests.push({method,card_no:get('card_no'),language:get('language'),auth:Boolean(new Headers(options.headers).get('Authorization')),body});
      let list=rows();
      if(method==='GET'){
        if(get('owner_id'))list=list.filter(r=>r.owner_id===get('owner_id'));
        const offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||1000);
        const page=list.slice(offset,offset+limit);
        return new Response(JSON.stringify(page),{status:200,headers:{'content-type':'application/json','content-range':offset+'-'+Math.max(offset,offset+page.length-1)+'/'+list.length}});
      }
      if(!new Headers(options.headers).get('Authorization'))return new Response(JSON.stringify({message:'forbidden'}),{status:403});
      if(method==='POST'){
        const incoming=Array.isArray(body)?body:[body];
        for(const row of incoming){
          const hit=list.find(r=>r.owner_id===row.owner_id&&r.card_no===row.card_no&&r.language===row.language);
          if(hit)Object.assign(hit,row);else list.push({created_at:new Date().toISOString(),...row,id:row.id||('row-'+(list.length+1))});
        }
        save(list);return new Response(JSON.stringify(incoming),{status:201,headers:{'content-type':'application/json'}});
      }
      if(method==='PATCH'){
        const hit=list.filter(r=>(!get('owner_id')||r.owner_id===get('owner_id'))&&(!get('card_no')||r.card_no===get('card_no'))&&(!get('language')||r.language===get('language')));
        hit.forEach(r=>Object.assign(r,body));save(list);
        return new Response(JSON.stringify(hit),{status:200,headers:{'content-type':'application/json'}});
      }
      if(method==='DELETE'){
        const keep=list.filter(r=>!((!get('owner_id')||r.owner_id===get('owner_id'))&&(!get('card_no')||r.card_no===get('card_no'))&&(!get('language')||r.language===get('language'))));
        localStorage.setItem('__test_collection',JSON.stringify(keep));
        return new Response(null,{status:204});
      }
    }
    const source=table==='cards_base'?cards:table==='card_prints'?prints:[];
    const offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||1000),page=source.slice(offset,offset+limit);
    return new Response(JSON.stringify(page),{status:200,headers:{'content-type':'application/json','content-range':offset+'-'+Math.max(offset,offset+page.length-1)+'/'+source.length}});
  };
})()`;
try {
  let tabs;for(let i=0;i<40;i++){try{tabs=await(await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();break;}catch{await sleep(250);}}
  if(!tabs)throw new Error('Browser CDP not available');ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  let sequence=0;const pending=new Map(),exceptions=[];
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}else if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails.text);};
  const cdp=(method,params={})=>new Promise((r,j)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);j(new Error('CDP timeout: '+method));},20000);pending.set(id,m=>{clearTimeout(timer);if(m.error)j(new Error(JSON.stringify(m.error)));else r(m.result);});ws.send(JSON.stringify({id,method,params}));});
  await cdp('Page.enable');await cdp('Runtime.enable');await cdp('Network.enable');await cdp('Network.setBlockedURLs',{urls:['https://fonts.googleapis.com/*','https://fonts.gstatic.com/*']});await cdp('Page.addScriptToEvaluateOnNewDocument',{source:setup});
  const js=async expression=>{const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result?.value;};
  const wait=async(expression)=>{for(let i=0;i<80;i++){try{if(await js(expression))return;}catch{}await sleep(150);}throw new Error('Wait failed: '+expression+'\n'+JSON.stringify({page:await js("({url:location.href,text:document.body?.innerText.slice(0,1200)})"),exceptions}));};
  const test=async(name,fn)=>{await fn();passed++;console.log('✓ '+name);};
  const click=async(selector)=>{assert(await js(`Boolean(document.querySelector(${JSON.stringify(selector)}))`),selector);await js(`document.querySelector(${JSON.stringify(selector)}).click()`);await sleep(200);};
  const clickText=async(text)=>{assert(await js(`(()=>{const el=[...document.querySelectorAll('button,label,summary')].find(e=>e.checkVisibility()&&!e.disabled&&e.textContent.trim()===${JSON.stringify(text)});if(!el)return false;el.click();return true})()`),'Button '+text);await sleep(250);};
  const viewport=async(width,height)=>{await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await sleep(250);};
  const shot=async(name)=>{const image=await cdp('Page.captureScreenshot',{format:'png'});writeFileSync(join(shots,name+'.png'),Buffer.from(image.data,'base64'));};
  const rows=()=>js("JSON.parse(localStorage.getItem('__test_collection'))");
  await cdp('Page.navigate',{url:app});
  await wait("document.querySelectorAll('.home-entries .entry-card').length===4");
  await test('访客进卡池先撞门禁,不展示任何持有数据',async()=>{
    await js("localStorage.setItem('__test_guest','1')");
    await js("location.hash='#/collection'");
    await wait("document.querySelector('.collection-gate input[type=email]')");
    assert(await js("document.body.innerText.includes('卡池门禁')"));
    assert.equal(await js("document.querySelectorAll('.collection-tile').length"),0);
    await shot('guest-gate');
    await js("localStorage.removeItem('__test_guest')");
    await js("localStorage.setItem('riftbound-editorial-session',JSON.stringify({accessToken:'fixture-admin',refreshToken:'fixture-refresh',expiresAt:Date.now()+3600000,email:'fixture@example.org',role:'admin'}))");
    await cdp('Page.reload');
    await wait("document.querySelectorAll('.collection-tile').length>0");
  });
  await test('默认「我有的」:只列持有过的印本,云行为只读拉取',async()=>{
    const tiles=await js("[...document.querySelectorAll('.collection-tile')].map(t=>t.querySelector('.tile-caption small').textContent.trim())");
    assert.equal(tiles.length,2,tiles.join(' | '));
    assert(tiles.every(t=>t.endsWith('简中')||t.endsWith('英文')),tiles.join(' | '));
    assert(await js("window.__collectionRequests.some(r=>r.method==='GET'&&r.auth)"));
    assert(await js("[...document.querySelectorAll('.tile-stepper b')].map(e=>e.textContent).includes('1')"));
    await shot('desktop-owned');
  });
  await test('点＋立刻加一(乐观),300ms 后写回云端行',async()=>{
    await click('.collection-tile .tile-stepper button:last-child');
    assert.equal(await js("document.querySelector('.collection-tile .tile-stepper b').textContent"),'2');
    await wait("window.__collectionRequests.some(r=>r.method==='POST'&&r.body&&JSON.stringify(r.body).includes('\"quantity\":2'))");
    const stored=await rows();
    assert.equal(stored.find(r=>r.card_no==='OGN-308'||r.card_no==='VEN-188').quantity,2);
    await wait("document.querySelector('.sync-label')?.textContent.includes('云端已同步')");
  });
  await test('减到 0 删除该行,不留 quantity=0 的脏数据',async()=>{
    await click('.collection-tile .tile-stepper button:first-child');
    await click('.collection-tile .tile-stepper button:first-child');
    await click('.collection-tile .tile-stepper button:first-child');
    await wait("window.__collectionRequests.some(r=>r.method==='DELETE')");
    await sleep(400);
    assert.equal((await rows()).length,1,JSON.stringify(await rows()));
    assert.equal(await js("document.querySelectorAll('.collection-tile').length"),1);
  });
  await test('切到全部卡:整张卡表逐印本成格,搜索与多条件排序可用',async()=>{
    await clickText('全部卡');
    await wait("document.querySelectorAll('.collection-tile').length>10");
    const total=await js("Number(document.querySelector('.result-count').textContent.replace(/[^0-9]/g,''))");
    assert(total>1000,`total=${total}`);
    await js("(()=>{const el=document.querySelector('.search-box input');el.value='OGN-308';el.dispatchEvent(new Event('input',{bubbles:true}))})()");
    await sleep(500);
    assert.equal(await js("document.querySelectorAll('.collection-tile').length"),1);
    await js("(()=>{const el=document.querySelector('.search-box input');el.value='';el.dispatchEvent(new Event('input',{bubbles:true}))})()");
    await sleep(400);
    await js("[...document.querySelectorAll('.tool-btn')].find(b=>b.textContent.includes('排序')).click()");
    await wait("document.querySelector('dialog.dialog')");
    assert(await js("document.querySelector('dialog.dialog').innerText.includes('多条件排序')"));
    await js("(()=>{const s=document.querySelector('.rule select');s.value='name';s.dispatchEvent(new Event('change',{bubbles:true}))})()");
    await click('dialog.dialog .add');
    assert.equal(await js("document.querySelectorAll('dialog.dialog .rule').length"),2);
    await click('dialog.dialog footer .primary');
    await wait("!document.querySelector('dialog.dialog')");
    assert(await js("document.querySelectorAll('.collection-tile').length>10"));
    assert.equal(await js("[...document.querySelectorAll('.tool-btn')].find(b=>b.textContent.includes('排序')).querySelector('b').textContent"),'2');
    await shot('desktop-all');
  });
  await test('刷新后记住「全部卡」与排序规则,读的是本机 UI 偏好',async()=>{
    await cdp('Page.reload');
    await wait("document.querySelectorAll('.collection-tile').length>10");
    assert(await js("document.querySelector('.mode-switch button:last-child').classList.contains('active')"));
    assert(await js("JSON.parse(localStorage.getItem('rune.collection.ui.v1')).view==='all'"));
    assert(await js("(()=>{const u=JSON.parse(localStorage.getItem('rune.collection.ui.v1'));return Array.isArray(u.sort)&&u.sort.length===2&&u.sort[0].field==='name'})()"));
  });
  await test('筛选面板与卡牌查询同一套:语言 toggle + 数值范围 + 应用生效',async()=>{
    await wait("document.querySelectorAll('.desktop-filter .facet').length>0");
    assert.equal(await js("document.querySelectorAll('.desktop-filter .numeric-section input[type=number]').length"),6,'三个数值范围各两个输入框');
    const before=await js("Number(document.querySelector('.result-count').textContent.replace(/[^0-9]/g,''))");
    await js("[...document.querySelectorAll('.desktop-filter .facet')].find(b=>b.textContent.trim()==='简中').click()");
    assert(await js("!!document.querySelector('.desktop-filter .facet.include')"),'点选后进入 include 态');
    assert.equal(await js("Number(document.querySelector('.result-count').textContent.replace(/[^0-9]/g,''))"),before,'草稿未应用时不改动结果');
    await js("[...document.querySelectorAll('.desktop-filter .filter-foot button')].find(b=>b.textContent.includes('应用')).click()");
    await sleep(300);
    const after=await js("Number(document.querySelector('.result-count').textContent.replace(/[^0-9]/g,''))");
    assert(after>0&&after<before,`before=${before} after=${after}`);
    assert(await js("(()=>{const u=JSON.parse(localStorage.getItem('rune.collection.ui.v1'));return u.languages.length===1&&u.languages[0]==='SC'})()"));
    await shot('desktop-filtered');
    await click('.active-clear');
    await sleep(300);
    assert.equal(await js("Number(document.querySelector('.result-count').textContent.replace(/[^0-9]/g,''))"),before);
  });
  await test('手机 390/430:单列工具条不溢出,筛选变抽屉',async()=>{
    for(const width of [390,430]){
      await viewport(width,932);
      assert((await js('document.documentElement.scrollWidth'))<=width,`${width} overflow`);
      assert.equal(await js("getComputedStyle(document.querySelector('.workspace')).gridTemplateColumns.split(' ').length"),1);
    }
    await js("[...document.querySelectorAll('.tool-btn')].find(b=>b.textContent.includes('筛选')).click()");
    await wait("document.querySelector('.mobile-filter')");
    assert(await js("document.querySelector('.mobile-filter').innerText.includes('语言')"));
    assert(await js("document.querySelector('.mobile-filter').innerText.includes('筛选卡池')"));
    await shot('mobile-drawer');
    await click('.mobile-filter .mobile-close');
    await wait("!document.querySelector('.mobile-filter')");
    assert((await js('document.documentElement.scrollWidth'))<=430);
    await shot('mobile');
    await viewport(1680,1050);
  });
  await test('构筑页:持 N 徽章、只看我有的、缺卡清单、完成度',async()=>{
    await js("location.hash='#/builder'");
    await wait("document.querySelector('.builder-library')");
    assert(await js("document.querySelector('.library-meta').innerText.includes('持有 ')"));await js("document.querySelector('.deck-title').click()");
    await wait("document.querySelector('.pool-grid .pool-card')");
    await wait("document.querySelector('.pool-owned')||document.querySelector('.pool-card')");
    assert(await js("document.querySelectorAll('.pool-held').length>0"));
    assert(await js("document.querySelector('.hold-status').textContent.includes('持有 1 / 4')"),await js("document.querySelector('.hold-status')?.textContent"));
    assert(await js("document.querySelector('.deck-shortfall summary').textContent.includes('缺卡清单 · 1 张')"));
    const shortfall=await js("document.querySelector('.deck-shortfall li button').textContent");
    assert(shortfall.includes('需 3')&&shortfall.includes('持 1')&&shortfall.includes('缺 2'),shortfall);
    assert(shortfall.includes('另有 0 张')===false);
    const before=await js("document.querySelectorAll('.pool-card').length");
    await js("[...document.querySelectorAll('.pool-settings label')].find(l=>l.textContent.includes('只看我有的')).click()");
    await sleep(300);
    const after=await js("document.querySelectorAll('.pool-card').length");
    assert(after>0&&after<before,`${before} → ${after}`);
    assert.equal(await js("document.querySelectorAll('.pool-card:not(.pool-card-dim)').length"),after);
    await shot('builder-linked');
  });
  await test('非管理员看不到卡池入口,构筑页也不出现持有量',async()=>{
    await js("localStorage.removeItem('riftbound-editorial-session')");
    await js("location.hash='#/cards'");
    await cdp('Page.reload');
    await wait("document.querySelector('.section-menu, .section-bar')");
    assert(!(await js("document.body.innerText.includes('我的卡池')")));
    await js("location.hash='#/builder'");
    await wait("document.querySelector('.builder-library')");
    assert.equal(await js("document.querySelectorAll('.pool-held, .hold-status, .deck-shortfall').length"),0);
    assert(!(await js("document.body.innerText.includes('只看我有的')")));
  });
  assert.deepEqual(exceptions.filter(e=>!e.includes('favicon')),[]);console.log(`\n${passed} 项浏览器验收通过；截图位于 shots/collection/。`);
} finally {ws?.close();chrome.kill();server.close();}
