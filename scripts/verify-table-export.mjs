/* 表格长图导出验证:走真实下载链路(allow download → 落盘 shots/exports/),
 * 逐表点击「下载长图」,校验文件存在、体积、PNG 像素尺寸,并捕获 alert 报错。
 * 用法:先 `npm run build && npm run preview`,再 `node scripts/verify-table-export.mjs`
 * 通过 APP_URL 覆盖地址(默认 http://localhost:4174/)
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';

const CHROME =
  process.env.HOME +
  '/.cache/ms-playwright/chromium_headless_shell-1200/chrome-headless-shell-linux64/chrome-headless-shell';
const PORT = 9340;
const APP = process.env.APP_URL || 'http://localhost:4174/';
const ROOT = '/home/TianYue/Documents/zhoubao-fuwendangan';
const DATA = `${ROOT}/public/data/s4-w3`;
const OUT = `${ROOT}/shots/exports`;
const FILES = [
  `${DATA}/城市赛第四赛季第三周_decks_data_with_TTS.csv`,
  `${DATA}/城市赛第四赛季第三周_rank_data.json`,
  `${DATA}/城市赛第四赛季第三周_shop_data.json`
];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const chrome = spawn(
  CHROME,
  [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    `--remote-debugging-port=${PORT}`,
    '--user-data-dir=/tmp/rune-export-profile',
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
  if (r.exceptionDetails) throw new Error('eval 失败: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result.value;
}
async function waitFor(expr, label, timeoutMs = 45000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await evalJs(expr)) return true;
    await sleep(400);
  }
  console.log(`  !! 超时等待:${label}`);
  return false;
}

let pass = 0;
let fail = 0;
function verdict(ok, msg) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${msg}`);
  ok ? pass++ : fail++;
}

/** PNG 尺寸:IHDR 宽高(大端) */
function pngSize(file) {
  const b = readFileSync(file);
  if (b.length < 24 || b.toString('ascii', 1, 4) !== 'PNG') return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), bytes: b.length };
}

/* ══════════ 启动 ══════════ */
await send('Page.enable');
await send('Runtime.enable');
await send('DOM.enable');
try {
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT });
} catch {
  await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT });
}
// 捕获 alert(导出异常会走 window.alert)
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.__alerts = []; window.alert = (m) => window.__alerts.push(String(m));`
});
await send('Page.navigate', { url: `${APP}#/import` });
await sleep(5000);

console.log('== A. 载入数据包 ==');
const upload = await evalJs(`(async () => {
  const files = ${JSON.stringify(
    FILES.map((f) => {
      const name = f.split('/').pop();
      return { url: '/data/s4-w3/' + encodeURIComponent(name), name };
    })
  )};
  const inputs = [...document.querySelectorAll('.dropzone input[type=file]')];
  const out = [];
  for (let i = 0; i < files.length; i++) {
    const res = await fetch(files[i].url);
    if (!res.ok) { out.push('HTTP ' + res.status); continue; }
    const blob = await res.blob();
    const dt = new DataTransfer();
    dt.items.add(new File([blob], files[i].name));
    const input = inputs[i] || inputs[0];
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    out.push(files[i].name.slice(-20));
  }
  return out;
})()`);
console.log('  上传:', JSON.stringify(upload));
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
await sleep(12000);

/* ══════════ 逐表导出 ══════════ */
/* 用真实鼠标事件点击(带用户激活,否则浏览器会拦掉 blob 下载) */
async function realClick(expr) {
  const rect = await evalJs(`(() => {
    const b = ${expr};
    if (!b) return null;
    b.scrollIntoView({ block: 'center' });
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (!rect) return 'no-button';
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y });
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: rect.x,
    y: rect.y,
    button: 'left',
    clickCount: 1
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: rect.x,
    y: rect.y,
    button: 'left',
    clickCount: 1
  });
  return 'clicked';
}

const byTitle = (sub) =>
  `[...document.querySelectorAll('button')].find(x => {
     const t = x.getAttribute('title') || '';
     return t.startsWith('把「') && t.includes(${JSON.stringify(sub)});
   })`;

/* 页内捕获导出产物:headless shell 不落盘,但能证明渲染→blob→下载链路都走到了 */
await evalJs(`(() => {
  window.__exports = [];
  window.__downloads = [];
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download) window.__downloads.push(this.download);
    return origClick.apply(this, arguments);
  };
  const origCreate = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => {
    const url = origCreate(blob);
    if (blob && blob.type === 'image/png') {
      fetch(url)
        .then((r) => r.blob())
        .then((b) => new Promise((res) => {
          const fr = new FileReader();
          fr.onload = () => { window.__exports.push({ size: b.size, data: fr.result }); res(); };
          fr.readAsDataURL(b);
        }))
        .catch(() => {});
    }
    return url;
  };
  return true;
})()`);

const CASES = [
  { id: 'B1', view: 'overview', title: '传奇 Tier List' },
  {
    id: 'B2',
    view: 'overview',
    prep: `(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '趋势对比'); b && b.click(); return true; })()`,
    title: '转化变化榜'
  },
  { id: 'B3', view: 'cards', title: '万金油单卡' },
  { id: 'B4', view: 'region', title: '赛事一览' },
  { id: 'B5', view: 'legendary', title: '核心卡 Top 20' },
  { id: 'A2', view: 'legendary', title: 'Combo 羁绊' },
  {
    id: 'A3',
    view: 'legendary',
    prep: `(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '前 3'); b && b.click(); return true; })()`,
    title: '候选卡组'
  },
  { id: 'B6', view: 'legendary', title: '构筑对比' },
  { id: 'A1', view: 'decks', title: '卡组浏览器' },
  {
    id: 'B7',
    view: 'journal',
    prep: `(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('阅读本期周报')); b && b.click(); return true; })()`,
    label: '下载本表长图',
    title: null
  }
];

console.log('\n== B. 逐表导出长图 ==');
let n = 0;
for (const c of CASES) {
  await evalJs(`location.hash = '#/${c.view}'`);
  await sleep(1800);
  if (c.prep) {
    await evalJs(c.prep);
    await sleep(1600);
  }
  const click = c.title
    ? await realClick(byTitle(c.title))
    : await realClick(
        `[...document.querySelectorAll('button')].find(x => x.textContent.includes(${JSON.stringify(c.label)}))`
      );
  if (click !== 'clicked') {
    verdict(false, `[${c.id}] 找不到下载按钮(${c.title ?? c.label})`);
    continue;
  }
  // 等渲染产出 PNG blob(卡组浏览器 809 行离屏渲染最慢,给足时间)
  const produced = await waitFor(`(window.__exports || []).length > ${n}`, `${c.id} 渲染产出`, 90000);
  if (!produced) {
    verdict(false, `[${c.id}] 未产出 PNG`);
    continue;
  }
  n += 1;
  const shot = await evalJs(
    `(() => { const e = window.__exports[window.__exports.length - 1]; return { size: e.size, data: e.data }; })()`
  );
  const name = await evalJs('window.__downloads[window.__downloads.length - 1] || ""');
  const file = `${c.id}-${String(name || 'export.png').replace(/^符文档案_?/, '')}`;
  const path = `${OUT}/${file}`;
  writeFileSync(path, Buffer.from(String(shot.data).split(',')[1], 'base64'));
  const size = statSync(path).size;
  const dim = pngSize(path);
  const ok = size > 12_000 && dim && dim.w > 600 && dim.h > 200;
  verdict(
    ok,
    `[${c.id}] ${file} · ${(size / 1024).toFixed(0)}KB · ${dim ? `${dim.w}×${dim.h}px` : '非 PNG'} · 下载名「${name}」`
  );
}

const alerts = await evalJs(`window.__alerts || []`);
verdict(alerts.length === 0, `导出期间无弹窗报错${alerts.length ? ':' + JSON.stringify(alerts) : ''}`);

const files = readdirSync(OUT).filter((f) => f.endsWith('.png'));
verdict(files.length === CASES.length, `产出 ${files.length}/${CASES.length} 张长图`);
console.log('\n导出目录:', OUT);
console.log(files.map((f) => '  ' + f).join('\n'));

console.log(`\n结果:PASS ${pass} / FAIL ${fail}`);
ws.close();
chrome.kill();
process.exit(fail > 0 ? 1 : 0);
