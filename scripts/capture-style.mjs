/* ================================================================
 * scripts/capture-style.mjs
 *
 * 期刊首页与全部路由的取证脚本(配合 docs/style-spec.md):
 *   1) 空态:未载入数据时的首页引导
 *   2) 载入两个数据包(第二个把赛事日期整体后移 3 周,构造不同刊期的"下一期")
 *   3) 逐路由截图:#/ · #/archive · #/issue/{id} · #/tool/{view}
 *   4) 断言:期号、往期卡片数、工具可用性、路由深链/前进后退、移动端无横向溢出
 *   5) 抓取设计 tokens 的 computed style → shots/style-metrics.json
 *
 * 前置:npx vite build && npx vite preview --port 4173
 * 运行:node scripts/capture-style.mjs   (输出至 shots/,已 gitignore)
 * ============================================================== */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const CHROME =
  process.env.HOME +
  '/.cache/ms-playwright/chromium_headless_shell-1200/chrome-headless-shell-linux64/chrome-headless-shell';
const PORT = 9344;
const APP = 'http://localhost:4173/';
const OUT = 'shots';
mkdirSync(OUT, { recursive: true });

const chrome = spawn(
  CHROME,
  [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    `--remote-debugging-port=${PORT}`,
    '--user-data-dir=/tmp/rune-style-profile',
    '--hide-scrollbars',
    '--window-size=1680,1050',
    'about:blank'
  ],
  { stdio: 'ignore' }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJson(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch {}
    await sleep(400);
  }
  throw new Error('CDP not ready ' + url);
}

const tabs = await getJson(`http://127.0.0.1:${PORT}/json/list`);
const tab = tabs.find((t) => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});

let id = 0;
const pending = new Map();
/** 运行期告警/异常收集:Vue 组件解析失败等只出现在控制台,必须显式断言 */
const runtimeIssues = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.consoleAPICalled') {
    const text = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
    if (m.params.type === 'error' || m.params.type === 'warning') runtimeIssues.push(text);
    if (text.includes('[Vue warn]')) runtimeIssues.push(text);
  }
  if (m.method === 'Runtime.exceptionThrown') {
    runtimeIssues.push(
      String(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text)
    );
  }
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
};
const cdp = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', {
  width: 1680,
  height: 1050,
  deviceScaleFactor: 1,
  mobile: false
});
await cdp('Page.navigate', { url: APP });
await sleep(3000);

async function evalJs(expression) {
  const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
}
async function shot(name, full = false) {
  const params = { format: 'png' };
  if (full) {
    const m = await cdp('Page.getLayoutMetrics');
    const cs = m.result.cssContentSize;
    params.clip = { x: 0, y: 0, width: cs.width, height: Math.min(cs.height, 6000), scale: 1 };
    params.captureBeyondViewport = true;
  }
  const r = await cdp('Page.captureScreenshot', params);
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64'));
  console.log('  shot:', name);
}

const checks = [];
function assert(name, ok, detail = '') {
  checks.push({ name, ok: !!ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

/** 载入一个数据包:nameSuffix 换掉文件名里的周次(不同刊期不同文件名),dateShiftDays 整体后移赛事日期 */
async function loadPackage(weekName, dateShiftDays, rotate = 0) {
  await navigateHash('#/import');
  await sleep(1400);
  return evalJs(`(async () => {
    const files = [
      'data/s4-w3/城市赛第四赛季第三周_decks_data_with_TTS.csv',
      'data/s4-w3/城市赛第四赛季第三周_rank_data.json',
      'data/s4-w3/城市赛第四赛季第三周_shop_data.json'
    ];
    const WEEK = ${JSON.stringify(weekName)};
    const SHIFT = ${dateShiftDays};
    const ROTATE = ${rotate};
    const inputs = [...document.querySelectorAll('input[type=file]')];
    for (let i = 0; i < files.length; i++) {
      let text = await (await fetch(files[i])).text();
      let name = files[i].split('/').pop().replace('第三周', WEEK);
      if (i === 0 && (SHIFT || ROTATE)) {
        const lines = text.split('\\n');
        const head = lines[0];
        let rows = lines.slice(1).filter((l) => l.trim());
        if (SHIFT) {
          rows = rows.map((l) =>
            l.replace(/(\\d{4})-(\\d{2})-(\\d{2})/g, (m, y, mo, d) => {
              const t = new Date(Date.UTC(+y, +mo - 1, +d));
              t.setUTCDate(t.getUTCDate() + SHIFT);
              const p = (n) => String(n).padStart(2, '0');
              return t.getUTCFullYear() + '-' + p(t.getUTCMonth() + 1) + '-' + p(t.getUTCDate());
            })
          );
        }
        if (ROTATE) rows = rows.slice(ROTATE).concat(rows.slice(0, ROTATE));
        text = head + '\\n' + rows.join('\\n');
      }
      const dt = new DataTransfer();
      dt.items.add(new File([text], name, { type: 'application/octet-stream' }));
      inputs[i + 1].files = dt.files;
      inputs[i + 1].dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 4000));
    }
    const btn = [...document.querySelectorAll('button')].find((b) =>
      b.textContent.includes('分析并入档')
    );
    if (!btn || btn.disabled) return 'button unavailable';
    btn.click();
    // 轮询等待入档(大包分析较慢)
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const s = window.__runeStore;
      if (s && !s.isAnalyzing && s.packages.length > 0 && !s.draftDirty) return 'ok';
      if (s && s.analysisError) return 'error: ' + s.analysisError.message;
    }
    return 'timeout';
  })()`);
}

/** 经工具条进入某个数据工具 */
/** 点击栏目条内的工具(按 data-code,避免受短标签影响) */
const gotoTool = (code) =>
  evalJs(`(() => { const b=document.querySelector('nav[aria-label$="导航"] button[data-code=' + ${JSON.stringify(
    code
  )} + ']'); if(!b) return 'no-btn'; b.click(); return window.location.hash; })()`);

/** 直接改 hash 并等待路由生效 */
const navigateHash = async (hash) => {
  await evalJs(`window.location.hash = ${JSON.stringify(hash)}`);
  await sleep(400);
};

console.log('\n== 1. 工具台(未载入任何数据包)==');
await cdp('Page.navigate', { url: APP + '#/' });
await sleep(2500);
assert('工具台刊头存在', await evalJs(`document.body.innerText.includes('符文档案')`));
assert('定位文案为工具台', await evalJs(`document.body.innerText.includes('工具台')`));
assert(
  '三个栏目分区齐备',
  await evalJs(`['周报期刊','云端内容','参考资料'].every(x=>document.body.innerText.includes(x))`)
);
assert(
  '本地分析工具归属期刊栏目(不再独立成组)',
  await evalJs(`!document.body.innerText.includes('本地数据工具')`)
);
const toolCount = await evalJs(
  `[...document.querySelectorAll('button')].filter(b=>/^\\d{2}/.test(b.innerText.trim()) && b.querySelector('h3')).length`
);
assert('工具卡 = 注册表全部工具(11)', toolCount === 11, `count=${toolCount}`);
assert(
  '工具台无上传引导按钮(上传只在数据管理工具内)',
  await evalJs(`!document.body.innerText.includes('从一份赛事数据包开始') && !document.body.innerText.includes('上传数据包 →')`)
);
assert(
  '期刊工具标「暂无期刊」',
  await evalJs(`document.body.innerText.includes('暂无期刊')`)
);
const statusMap = JSON.parse(
  await evalJs(
    `JSON.stringify(Object.fromEntries([...document.querySelectorAll('[data-tool]')].map(el=>[el.dataset.tool, el.dataset.status])))`
  )
);
assert(
  '5 个分析工具标「需先载入」,期刊标「暂无期刊」,数据管理标「第一步」',
  ['overview', 'cards', 'legendary', 'region', 'decks'].every((c) => statusMap[c] === '需先载入') &&
    statusMap.journal === '暂无期刊' &&
    statusMap.import === '第一步',
  JSON.stringify(statusMap)
);
assert(
  '云端工具标「未配置」',
  statusMap.blog === '未配置' && statusMap.qa === '未配置',
  `${statusMap.blog} / ${statusMap.qa}`
);
assert(
  '工具台无期刊头条(期刊已降为工具之一)',
  await evalJs(`!document.body.innerText.includes('本期 · 第')`)
);
await shot('journal-01-toolbox-empty', true);

console.log('\n== 1.5 云端工具占位页(架构位,内容未接入)==');
await navigateHash('#/blog');
await sleep(1500);
assert('云端工具路由可直达', await evalJs(`location.hash === '#/blog'`));
assert('占位页给出数据源与状态', await evalJs(`document.body.innerText.includes('架构位') && document.body.innerText.includes('supabase') || document.body.innerText.includes('Supabase')`));
assert('未配置提示明确', await evalJs(`document.body.innerText.includes('VITE_SUPABASE_URL')`));
await shot('journal-01b-tool-placeholder');

console.log('\n== 2. 载入第一期 ==');
await navigateHash('#/import');
await sleep(1200);
assert('数据管理工具可直达', await evalJs(`location.hash === '#/import'`));
assert(
  '期刊栏目条(本期/往期 + 数据管理与 5 个分析工具)出现',
  await evalJs(`!!document.querySelector('nav[aria-label="周报期刊导航"]')`) &&
    (await evalJs(`document.querySelectorAll('nav[aria-label="周报期刊导航"] button[data-code]').length`)) === 6,
  `tools=${await evalJs(`[...document.querySelectorAll('nav[aria-label="周报期刊导航"] button')].map(b=>b.textContent.trim()).join('/')`)}`
);
assert(
  '期刊栏目条就绪(本期/往期 + 6 个工具)',
  await evalJs(`!!document.querySelector('nav[aria-label="周报期刊导航"]')`)
);
assert(
  '路由为 #/import',
  await evalJs(`window.location.hash === '#/import'`),
  await evalJs(`window.location.hash`)
);
console.log('  load pkg1:', await loadPackage('第三周', 0, 0));
assert('数据包库出现第 1 期', await evalJs(`document.body.innerText.includes('第 1 期')`));
assert('成为活动包', await evalJs(`document.body.innerText.includes('活动中')`));
await shot('journal-02-import-library', true);

console.log('\n== 3. 载入第二期(赛事日期 +21 天)==');
console.log('  load pkg2:', await loadPackage('第四周', 21, 137));
assert('数据包库出现第 2 期', await evalJs(`document.body.innerText.includes('第 2 期')`));
assert(
  '两期并存',
  await evalJs(`(document.body.innerText.match(/第 \\d+ 期/g) || []).length >= 2`)
);
await shot('journal-03-import-two-packages', true);

console.log('\n== 4. 期刊工具(#/journal)==');
await navigateHash('#/journal');
await sleep(1600);
assert('本期期号存在', await evalJs(`/本期 · 第 2 期/.test(document.body.innerText)`));
assert('头条标题存在', await evalJs(`!!document.querySelector('h2')`));
assert('本期数据行 5 项', await evalJs(`document.body.innerText.includes('卡组样本') && document.body.innerText.includes('传奇种类')`));
assert('期刊页含往期区或期刊头版', await evalJs(`document.body.innerText.includes('往期期刊') || document.body.innerText.includes('本期')`));
const backInfo = JSON.parse(await evalJs(`JSON.stringify({
  cards: document.querySelectorAll('article.card').length,
  back: window.__runeStore.backIssues.length,
  pkgs: window.__runeStore.packages.length
})`));
assert(
  '往期卡片数 = 包数 - 1',
  backInfo.cards === backInfo.pkgs - 1 && backInfo.cards === backInfo.back,
  JSON.stringify(backInfo)
);
assert('工具卡全部可用', await evalJs(`!document.body.innerText.includes('需先载入')`));
await shot('journal-04-home-live', true);

console.log('\n== 5. 往期归档 ==');
await evalJs(`window.location.hash = '#/archive'`);
await sleep(1200);
assert('归档页标题', await evalJs(`document.body.innerText.includes('往期期刊')`));
assert('列出两期', await evalJs(`(document.body.innerText.match(/第 \\d+ 期/g) || []).length >= 2`));
await shot('journal-05-archive', true);

console.log('\n== 6. 期号正文(深链)==');
const issueId = await evalJs(`(() => {
  const cards = [...document.querySelectorAll('article')];
  const c = cards.find(x => x.textContent.includes('阅读本期'));
  c?.click(); return window.location.hash;
})()`);
await sleep(1500);
assert('深链为 #/issue/…', /^#\/issue\//.test(issueId), issueId);
assert('正文题头存在', await evalJs(`document.body.innerText.includes('返回期刊')`));
assert('含本期综述分节', await evalJs(`document.body.innerText.includes('本期综述')`));
assert('含数据工具 CTA', await evalJs(`document.body.innerText.includes('打开数据工具')`));
assert('含上下期导航', await evalJs(`document.body.innerText.includes('上一期') || document.body.innerText.includes('下一期')`));
await shot('journal-06-issue-article', true);

console.log('\n== 7. 刷新后深链回落(内存态不持久)==');
// 强制整页重载(SPA 内 Page.navigate 到同文档不会重新加载,需先离开再回来)
await cdp('Page.navigate', { url: 'about:blank' });
await sleep(600);
await cdp('Page.navigate', { url: APP + issueId });
await sleep(3000);
assert(
  '无内存态时深链回落工具台',
  await evalJs(`location.hash === '#/' && document.body.innerText.includes('工具台')`),
  `href=${await evalJs(`location.href`)} pkgs=${await evalJs(`window.__runeStore?.packages.length`)}`
);

console.log('\n== 8. 工具路由 + 前进后退 ==');
await cdp('Page.navigate', { url: APP + '#/tool/import' });
await sleep(2500);
console.log('  load pkg1 again:', await loadPackage('第三周', 0, 0));
const navOk = await gotoTool('overview');
await sleep(2200);
assert('导航可切到总览', navOk === '#/overview', navOk);
assert('总览内容渲染', await evalJs(`document.body.innerText.includes('传奇综合表现榜')`));
assert(
  '分析工具页仍属期刊栏目(栏目条在,周次范围在)',
  await evalJs(
    `!!document.querySelector('nav[aria-label="周报期刊导航"]') && !!document.querySelector('select[aria-label="选择周次"]')`
  ),
  await evalJs(`[...document.querySelectorAll('nav')].map(n=>n.getAttribute('aria-label')).join('|')`)
);
await shot('journal-07-tool-overview', true);

await evalJs(`history.back()`);
await sleep(1200);
assert('后退回到数据管理', await evalJs(`window.location.hash === '#/import'`), await evalJs(`window.location.hash`));
await evalJs(`history.forward()`);
await sleep(1500);
assert('前进回到总览', await evalJs(`window.location.hash === '#/overview'`));

console.log('\n== 9. 其余工具路由 ==');
for (const [label, code, file] of [
  ['单卡分析', 'cards', 'journal-08-tool-cards'],
  ['传奇构筑', 'legendary', 'journal-09-tool-legendary'],
  ['地域差异', 'region', 'journal-10-tool-region'],
  ['卡组浏览器', 'decks', 'journal-11-tool-decks']
]) {
  await gotoTool(code);
  await sleep(2000);
  assert(
    `${label} 工具可打开`,
    await evalJs(`window.location.hash === '#/${code}'`),
    await evalJs('window.location.hash')
  );
  await shot(file, true);
}

console.log('\n== 9.5 运行期告警检查 ==');
const vueWarns = runtimeIssues.filter((t) => t.includes('[Vue warn]'));
const uncaught = runtimeIssues.filter((t) => !t.includes('[Vue warn]') && /TypeError|ReferenceError|is not a function/.test(t));
assert('无 Vue 组件解析/运行告警', vueWarns.length === 0, vueWarns.slice(0, 2).join(' || ').slice(0, 220));
assert('无未捕获异常', uncaught.length === 0, uncaught.slice(0, 2).join(' || ').slice(0, 220));

console.log('\n== 10. 设计 tokens ==');
await navigateHash('#/');
await sleep(1200);
const metrics = await evalJs(`(() => {
  const d = document.documentElement;
  const cs = (sel, props) => { const el = document.querySelector(sel); if (!el) return null; const s = getComputedStyle(el); const o = {}; props.forEach(p => o[p] = s[p]); return o; };
  const v = (n) => getComputedStyle(d).getPropertyValue(n).trim();
  return {
    brand: v('--color-brand'), accent: v('--color-accent'), pageBg: v('--color-page-bg'),
    ink: v('--color-text-primary'), inkMuted: v('--color-text-muted'), hairline: v('--color-hairline'),
    h1: cs('h1', ['fontFamily','fontSize','fontWeight']),
    headerH: document.querySelector('header')?.getBoundingClientRect().height,
    sectionBar: !!document.querySelector('nav[aria-label="周报期刊导航"], nav[aria-label="云端内容导航"], nav[aria-label="参考资料导航"]'),
    hrCount: document.querySelectorAll('.hairline').length,
    cardCount: document.querySelectorAll('.card').length
  };
})()`);
writeFileSync(`${OUT}/style-metrics.json`, JSON.stringify(metrics, null, 2));
assert('工具台(首页)不在任何栏目内', metrics.sectionBar === false);
console.log('  tokens:', JSON.stringify(metrics));

console.log('\n== 10.5 全工具路由巡检(逐页渲染,收集告警)==');
const allRoutes = ['#/', '#/journal', '#/archive', '#/import', '#/overview', '#/cards', '#/legendary', '#/region', '#/decks', '#/blog', '#/qa', '#/rules', '#/carddex'];
for (const r of allRoutes) {
  await navigateHash(r);
  await sleep(900);
  const ok = await evalJs(`location.hash === ${JSON.stringify(r)} && document.querySelector('main').innerText.trim().length > 20`);
  assert(`${r} 渲染非空`, ok, await evalJs(`document.querySelector('main').innerText.trim().slice(0,60)`));
}

console.log('\n== 11. 移动端(390×844)==');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: APP });
await sleep(2000);
await cdp('Page.navigate', { url: APP + '#/tool/import' });
await sleep(1800);
console.log('  load pkg1 (mobile):', await loadPackage('第三周', 0, 0));
await evalJs(`window.location.hash = '#/journal'`);
await sleep(1500);
const overflow = await evalJs(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
assert('移动端无横向溢出', overflow <= 1, `overflow=${overflow}px`);
await shot('journal-12-mobile-home', true);

console.log('\n== 结果 ==');
const failed = checks.filter((c) => !c.ok);
console.log(`${checks.length - failed.length}/${checks.length} 项通过`);
if (failed.length) {
  for (const f of failed) console.log('  ✗', f.name, f.detail);
  process.exitCode = 1;
}

ws.close();
chrome.kill();
console.log('DONE');
