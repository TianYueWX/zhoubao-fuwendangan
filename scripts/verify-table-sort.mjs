/* 表头点击排序验证:上传预设数据包 → 逐个视图点击表头 → 校验 aria-sort/指示符/实际行序
 * 用法:先 `npm run build && npm run preview`,再 `node scripts/verify-table-sort.mjs`
 * 通过 APP_URL 覆盖地址(默认 http://localhost:4174/)
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const CHROME =
  process.env.HOME +
  '/.cache/ms-playwright/chromium_headless_shell-1200/chrome-headless-shell-linux64/chrome-headless-shell';
const PORT = 9337;
const APP = process.env.APP_URL || 'http://localhost:4174/';
const ROOT = '/home/TianYue/Documents/zhoubao-fuwendangan';
const DATA = `${ROOT}/public/data/s4-w3`;
const SHOTS = `${ROOT}/shots`;
const FILES = [
  `${DATA}/城市赛第四赛季第三周_decks_data_with_TTS.csv`,
  `${DATA}/城市赛第四赛季第三周_rank_data.json`,
  `${DATA}/城市赛第四赛季第三周_shop_data.json`
];

mkdirSync(SHOTS, { recursive: true });
const chrome = spawn(
  CHROME,
  [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    `--remote-debugging-port=${PORT}`,
    '--user-data-dir=/tmp/rune-sort-profile',
    '--hide-scrollbars',
    '--window-size=1680,1050',
    'about:blank'
  ],
  { stdio: 'ignore' }
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function httpJson(path, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}${path}`);
      if (r.ok) return await r.json();
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error('CDP 未就绪');
}

const targets = await httpJson('/json/list');
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});

let nextId = 1;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
};
function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evalJs(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('eval 失败: ' + JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(r.data, 'base64'));
}
async function waitFor(expr, label, timeoutMs = 45000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await evalJs(expr)) return true;
    await sleep(500);
  }
  console.log(`  !! 超时等待:${label}`);
  return false;
}

/* ── 表头定位 / 读取 ── */
const ARROW = '[\\u2191\\u2193]';
const thExpr = (label) =>
  `[...document.querySelectorAll('thead th')].find(t => t.textContent.replace(/${ARROW}/g,'').trim() === ${JSON.stringify(label)})`;
const READ = (label) => `(() => {
  const th = ${thExpr(label)};
  if (!th) return { error: 'no-th' };
  const table = th.closest('table');
  const idx = [...th.parentElement.children].indexOf(th);
  const rows = [...table.querySelectorAll('tbody tr')].filter(r => r.cells.length > 1);
  const vals = rows.map(r => (r.cells[idx] ? r.cells[idx].textContent.replace(/\\s+/g,' ').trim() : ''));
  return {
    ariaSort: th.getAttribute('aria-sort'),
    tabindex: th.getAttribute('tabindex'),
    indicator: th.textContent.includes('\\u2191') ? 'up' : th.textContent.includes('\\u2193') ? 'down' : 'none',
    n: vals.length,
    vals
  };
})()`;

const num = (s) => {
  const m = /-?\d+(\.\d+)?/.exec(String(s).replace(/,/g, ''));
  return m ? parseFloat(m[0]) : null;
};
function monotonic(vals, dir) {
  const xs = vals.map(num).filter((x) => x !== null);
  if (xs.length < 2) return { ok: false, why: '样本不足' };
  for (let i = 1; i < xs.length; i++) {
    if (dir === 'desc' && xs[i] > xs[i - 1] + 1e-9) return { ok: false, why: `第 ${i + 1} 行逆序` };
    if (dir === 'asc' && xs[i] < xs[i - 1] - 1e-9) return { ok: false, why: `第 ${i + 1} 行逆序` };
  }
  return { ok: true, why: '' };
}

let pass = 0;
let fail = 0;
function verdict(ok, msg) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${msg}`);
  ok ? pass++ : fail++;
}

async function goto(view) {
  await evalJs(`location.hash = '#/${view}'`);
  await sleep(1400);
}

/** 点击表头 → 校验 aria/指示符/行序;连点两次验升降切换 */
async function sortTest(view, label, firstDir, { kind = 'number', shotName } = {}) {
  await goto(view);
  const exists = await evalJs(`!!${thExpr(label)}`);
  if (!exists) {
    verdict(false, `[${view}] 找不到表头「${label}」`);
    return null;
  }
  for (const [i, dir] of [firstDir, firstDir === 'desc' ? 'asc' : 'desc'].entries()) {
    await evalJs(`(() => { const th = ${thExpr(label)}; th.click(); return true; })()`);
    await sleep(500);
    const r = await evalJs(READ(label));
    if (r.error) {
      verdict(false, `[${view}] ${label} 第 ${i + 1} 次点击失败`);
      continue;
    }
    const wantAria = dir === 'desc' ? 'descending' : 'ascending';
    const wantMark = dir === 'desc' ? 'down' : 'up';
    // 文本列用页内 localeCompare 校验(与排序实现同口径),数字列按数值单调
    const order =
      kind === 'text'
        ? await evalJs(`(() => {
            const th = ${thExpr(label)};
            const idx = [...th.parentElement.children].indexOf(th);
            const rows = [...th.closest('table').querySelectorAll('tbody tr')].filter(r => r.cells.length > 1);
            const vals = rows.map(r => r.cells[idx].textContent.replace(/\\s+/g,' ').trim());
            for (let i = 1; i < vals.length; i++) {
              const c = vals[i-1].localeCompare(vals[i]);
              if (${dir === 'asc' ? 'c > 0' : 'c < 0'}) return { ok: false, why: '第 ' + (i+1) + ' 行 ' + vals[i-1] + ' vs ' + vals[i] };
            }
            return { ok: true, why: '' };
          })()`)
        : monotonic(r.vals, dir);
    const ok = r.ariaSort === wantAria && r.indicator === wantMark && order.ok && r.n > 0;
    verdict(
      ok,
      `[${view}] ${label} 第 ${i + 1} 击 → aria=${r.ariaSort}/指示=${r.indicator}/期望 ${wantAria}·${wantMark}` +
        ` 行序=${dir} ${order.ok ? 'OK' : '✗ ' + order.why} n=${r.n} head=[${r.vals.slice(0, 4).join(' | ')}]`
    );
    if (i === 0 && shotName) await shot(shotName);
  }
  return true;
}

/* ══════════ 启动 ══════════ */
await send('Page.enable');
await send('Runtime.enable');
await send('DOM.enable');
await send('Page.navigate', { url: `${APP}#/import` });
await sleep(4000);

console.log('== A. 载入数据包 ==');
// headless shell 下 DOM.setFileInputFiles 不派发 change,改为页内 DataTransfer 造 File 再派发。
// 注意:走槽位 FileDrop(handleFiles 先 Array.from 快照),批量入口会先清空 input.value 再遍历,合成上传会丢文件。
const upload = await evalJs(`(async () => {
  const files = ${JSON.stringify(
    FILES.map((f) => {
      const name = f.split('/').pop();
      return { url: '/data/s4-w3/' + encodeURIComponent(name), name };
    })
  )};
  const inputs = [...document.querySelectorAll('.dropzone input[type=file]')];
  if (inputs.length < 3) return '槽位输入框不足: ' + inputs.length;
  const out = [];
  for (let i = 0; i < files.length; i++) {
    const res = await fetch(files[i].url);
    if (!res.ok) { out.push(files[i].name + ' HTTP ' + res.status); continue; }
    const blob = await res.blob();
    const dt = new DataTransfer();
    dt.items.add(new File([blob], files[i].name));
    const n = dt.files.length;
    const input = inputs[i] || inputs[0];
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    out.push(files[i].name.slice(-22) + ' → ' + n + ' 个文件');
  }
  return out;
})()`);
console.log('  上传结果:', JSON.stringify(upload));
// 三个槽位都要解析完(rank JSON 868KB,慢于必需的 deck CSV;不等它会丢胜场数据)
const slotsLoaded = await waitFor(
  `document.querySelectorAll('.dropzone.loaded').length >= 3`,
  '三个槽位解析完成',
  120000
);
verdict(slotsLoaded, 'deck CSV + rank/shop JSON 三槽位均已载入');
const ready = await waitFor(
  `(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('分析并入档')); return !!b && !b.disabled; })()`,
  '分析按钮可用',
  30000
);
verdict(ready, '「分析并入档」可用');
await evalJs(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('分析并入档')); b && b.click(); return true; })()`);
await waitFor(`!!document.querySelector('input[type=file]')`, '分析启动', 5000);
await sleep(12000);
console.log('  分析后 hash:', await evalJs('location.hash'));

/* ══════════ 逐个视图验证 ══════════ */
console.log('\n== B1. Meta 总览 › 传奇 Tier List ==');
await sortTest('overview', '数量', 'desc', { shotName: 'sort-overview-tier' });
await sortTest('overview', '评分', 'desc');
await sortTest('overview', '英雄', 'asc', { kind: 'text' });

console.log('\n== B2. Meta 总览 › 趋势对比 › 转化变化榜 ==');
const hasReport = await evalJs(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '趋势对比');
  if (!b) return false;
  b.click(); return true;
})()`);
await sleep(1500);
if (hasReport && (await evalJs(`!!${thExpr('本期转化')}`))) {
  await sortTest('overview', '本期转化', 'desc');
} else {
  console.log('  SKIP 当前数据包无周际环比(单周),表格未生成');
}

console.log('\n== B3. 单卡分析 › 万金油单卡 ==');
await goto('cards');
const rankBefore = await evalJs(`(() => {
  const th = ${thExpr('携带率')};
  if (!th) return null;
  const table = th.closest('table');
  const out = {};
  for (const r of [...table.querySelectorAll('tbody tr')].filter(x => x.cells.length > 1)) {
    const name = r.cells[1].textContent.replace(/\\s+/g,' ').trim();
    out[name] = r.cells[0].textContent.trim();
  }
  return out;
})()`);
await sortTest('cards', '均张', 'desc', { shotName: 'sort-cards-staples' });
const rankAfter = await evalJs(`(() => {
  const th = ${thExpr('均张')};
  const table = th.closest('table');
  const pairs = [];
  for (const r of [...table.querySelectorAll('tbody tr')].filter(x => x.cells.length > 1)) {
    pairs.push([r.cells[1].textContent.replace(/\\s+/g,' ').trim(), r.cells[0].textContent.trim()]);
  }
  return pairs;
})()`);
if (rankBefore && rankAfter) {
  const bad = rankAfter.filter(([name, rank]) => rankBefore[name] !== rank);
  verdict(bad.length === 0, `[cards] 排序后 # 仍为原始携带率名次(不重编号);不符 ${bad.length} 行`);
  const idx = rankAfter.map(([, r]) => Number(r));
  const renumbered = idx.length > 2 && idx.every((v, i) => v === i + 1);
  verdict(!renumbered, `[cards] # 列未被重排为 1..N(样例 ${idx.slice(0, 6).join(',')})`);
}
await sortTest('cards', '卡牌', 'asc', { kind: 'text' });
await sortTest('cards', '对照Δ', 'desc');

console.log('\n== B4. 地域差异 › 赛事一览 ==');
await sortTest('region', '卡组数', 'desc', { shotName: 'sort-region-events' });
await sortTest('region', '日期', 'asc', { kind: 'text' });

console.log('\n== B5. 传奇构筑 › 核心卡 Top 20 ==');
await sortTest('legendary', '平均张数', 'desc', { shotName: 'sort-legendary-core' });

console.log('\n== A1. 卡组浏览器 › 胜场(DataTable 路径)==');
await goto('decks');
console.log('  表头:', JSON.stringify(await evalJs(`[...document.querySelectorAll('thead th')].map(t => t.textContent.replace(/[\\u2191\\u2193]/g,'').trim())`)));
console.log('  行数:', await evalJs(`document.querySelectorAll('tbody tr').length`));
await sortTest('decks', '胜场', 'desc', { shotName: 'sort-decks-wins' });

console.log('\n== C. 回归:Tier 行点击下钻仍可用 ==');
await goto('overview');
await evalJs(`(() => { const th = ${thExpr('数量')}; th && th.click(); return true; })()`);
await sleep(400);
const rowClicked = await evalJs(`(() => {
  const tr = [...document.querySelectorAll('tbody tr')].find(r => r.cells.length > 1 && r.className.includes('cursor-pointer'));
  if (!tr) return false;
  tr.click(); return true;
})()`);
await sleep(1200);
const hashNow = await evalJs('location.hash');
verdict(rowClicked && hashNow.includes('legendary'), `Tier 行点击下钻 → hash=${hashNow}`);

console.log('\n== D. 回归:B6 矩阵未接入排序 ==');
await goto('legendary');
await evalJs(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '前 3'); b && b.click(); return true; })()`);
await sleep(1200);
const matrixHead = await evalJs(`(() => {
  const table = [...document.querySelectorAll('table')].find(t => t.querySelector('tbody td[colspan]'));
  if (!table) return 'no-matrix';
  const ths = [...table.querySelectorAll('thead th')];
  return { cols: ths.length, sorted: ths.filter(t => t.getAttribute('aria-sort') !== null || t.getAttribute('tabindex') !== null).length };
})()`);
verdict(
  matrixHead === 'no-matrix' || matrixHead.sorted === 0,
  `构筑对比矩阵表头未接入排序(${JSON.stringify(matrixHead)})`
);

console.log(`\n结果:PASS ${pass} / FAIL ${fail}`);
ws.close();
chrome.kill();
process.exit(fail > 0 ? 1 : 0);
