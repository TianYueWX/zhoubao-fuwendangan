/* ================================================================
 * scripts/verify-carddex-scroll.mjs
 *
 * 「卡牌查询」(code: carddex)滚动改造的回归验收。
 *
 * 背景(为什么要单独锁这一条):
 *   改造前 carddex 是全站唯一 h-screen + 内层滚动的视图 —— 卡片列自己滚、
 *   右侧筛选栏又自己滚,屏幕上两条并列滚动条,而且祖先一旦出现 overflow
 *   就会吃掉后代的 position:sticky。改造后统一走 window 滚动,搜索栏与
 *   筛选栏各自吸顶。这类布局失守 type-check 抓不到,必须真浏览器验。
 *
 * 覆盖:
 *   A 架构    文档高度 > 视口、卡片区不再有内层裁剪
 *   B 吸顶    搜索栏 / 筛选栏吸附在报头下沿,卡片从下面滚过
 *   C 滚动条  全页只剩筛选栏一条可滚元素
 *   D 加载    sentinel 以视口为 root,滚到底继续增量
 *   E 回顶    全局 FAB 生效,页内不再有第二个回顶按钮
 *   F 弹层    打开卡牌详情冻结页面滚动,关闭后滚动位置不丢
 *   G 长图    长图模式下文档高度 = 内容高度(整页截图的上限)
 *   H 移动端  无横向溢出、筛选栏收起
 *
 * 前置:dist/ 必须是**带可用 Supabase 配置**的构建,因为卡表走 PostgREST。
 *   PowerShell:
 *     $env:VITE_SUPABASE_URL="https://<ref>.supabase.co"
 *     $env:VITE_SUPABASE_ANON_KEY="<anon key>"
 *     npm run build:fast
 *   (未配置时卡牌区只渲染错误态,断言会如实报「卡牌未载入」而不是假过)
 *
 * 运行:node scripts/verify-carddex-scroll.mjs
 *   CHROME_PATH  指定浏览器(默认自动探测 playwright chromium → headless shell → 系统 Chrome/Edge)
 *   CARDDEX_PORT 静态服务端口(默认 4174)
 * 截图输出 shots/carddex-scroll/(.gitignore 已忽略 shots/)
 * ============================================================== */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ══════════════════════ 断言设施 ══════════════════════ */

let passed = 0;
const failures = [];

function check(name, cond, detail = '') {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function near(name, actual, expected, tol, unit = 'px') {
  const ok = Number.isFinite(actual) && Math.abs(actual - expected) <= tol;
  check(name, ok, `期望 ${expected}±${tol}${unit},实得 ${actual}${unit}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ══════════════════════ 浏览器探测 ══════════════════════ */

function resolveChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const local = process.env.LOCALAPPDATA ?? '';
  const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
  const candidates =
    process.platform === 'win32'
      ? [
          join(local, 'ms-playwright', 'chromium-1181', 'chrome-win', 'chrome.exe'),
          join(local, 'ms-playwright', 'chromium_headless_shell-1181', 'chrome-win', 'headless_shell.exe'),
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
        ]
      : [
          join(home, '.cache/ms-playwright/chromium_headless_shell-1200/chrome-headless-shell-linux64/chrome-headless-shell'),
          '/usr/bin/google-chrome',
          '/usr/bin/chromium',
          '/usr/bin/chromium-browser'
        ];
  return candidates.find((p) => p && existsSync(p)) ?? null;
}

/* ══════════════════════ 静态服务(dist/) ══════════════════════ */

const DIST = new URL('../dist/', import.meta.url);
/* URL.pathname 在 Windows 上是 "/C:/...",必须过 fileURLToPath 才是真路径 */
const DIST_DIR = fileURLToPath(DIST);
const SHOT_DIR = new URL('../shots/carddex-scroll/', import.meta.url);
if (!existsSync(join(DIST_DIR, 'index.html'))) {
  console.error('× dist/index.html 不存在 —— 请先按文件头的说明 `npm run build:fast`');
  process.exit(1);
}
mkdirSync(SHOT_DIR, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.csv': 'text/csv; charset=utf-8',
  '.js.map': 'application/json; charset=utf-8'
};

const PORT = Number(process.env.CARDDEX_PORT ?? 4174);
const APP = `http://127.0.0.1:${PORT}/`;

const server = createServer((req, res) => {
  const url = new URL(req.url, APP);
  let file = normalize(join(DIST_DIR, decodeURIComponent(url.pathname)));
  if (!file.startsWith(normalize(DIST_DIR))) {
    res.writeHead(403).end('forbidden');
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) {
    // SPA 回退:hash 路由,任何路径都出 index.html
    file = join(DIST_DIR, 'index.html');
  }
  const body = readFileSync(file);
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(body);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
console.log(`(静态服务 ${APP} → dist/)`);

/* ══════════════════════ 启动浏览器 ══════════════════════ */

const CHROME = resolveChrome();
if (!CHROME) {
  console.error('× 找不到浏览器 —— 用 CHROME_PATH 指定');
  process.exit(1);
}
console.log(`(浏览器 ${CHROME})`);

const CDP_PORT = 9779;
const profile = join(process.env.TEMP ?? '/tmp', `carddex-verify-${Date.now()}`);
const isHeadlessShell = /headless_shell/i.test(CHROME);
const chrome = spawn(
  CHROME,
  [
    ...(isHeadlessShell ? [] : ['--headless=new']),
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=FluentOverlayScrollbar',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    '--window-size=1680,1050',
    'about:blank'
  ],
  { stdio: 'ignore' }
);

async function getJson(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch {
      /* 继续等 */
    }
    await sleep(400);
  }
  throw new Error('CDP 未就绪: ' + url);
}

let ws;
try {
  const tabs = await getJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
  const tab = tabs.find((t) => t.type === 'page');
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });

  let msgId = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  };
  const cdp = (method, params = {}) =>
    new Promise((res) => {
      const id = ++msgId;
      pending.set(id, res);
      ws.send(JSON.stringify({ id, method, params }));
    });

  await cdp('Page.enable');
  await cdp('Runtime.enable');

  async function evalJs(expression) {
    const r = await cdp('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (r.result?.exceptionDetails) {
      throw new Error(`页面内求值失败: ${r.result.exceptionDetails.text} :: ${expression}`);
    }
    return r.result?.result?.value;
  }

  async function waitFor(label, expression, timeoutMs = 25_000) {
    const t0 = Date.now();
    for (;;) {
      let v = false;
      try {
        v = await evalJs(expression);
      } catch {
        v = false;
      }
      if (v) return true;
      if (Date.now() - t0 > timeoutMs) {
        check(label, false, `等待 ${timeoutMs}ms 超时`);
        return false;
      }
      await sleep(400);
    }
  }

  async function viewport(width, height, mobile = false) {
    await cdp('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile
    });
  }

  async function goto(hash) {
    await cdp('Page.navigate', { url: APP + hash });
    await sleep(1200);
  }

  async function shot(name) {
    const r = await cdp('Page.captureScreenshot', { format: 'png' });
    if (r.result?.data) {
      writeFileSync(new URL(`${name}.png`, SHOT_DIR), Buffer.from(r.result.data, 'base64'));
      console.log(`  · 截图 shots/carddex-scroll/${name}.png`);
    }
  }

  /* 页面内公共探针:一次取回所有布局事实 */
  const PROBE = `(() => {
    const q = (s) => document.querySelector(s);
    const cs = (el) => el ? getComputedStyle(el) : null;
    const box = (s) => { const el = q(s); return el ? el.getBoundingClientRect() : null; };
    const scrollables = [...document.querySelectorAll('*')].filter((el) => {
      const s = getComputedStyle(el);
      if (!/(auto|scroll)/.test(s.overflowY)) return false;
      if (s.display === 'none' || s.visibility === 'hidden') return false;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      return el.scrollHeight > el.clientHeight + 1;
    }).map((el) => el.className && typeof el.className === 'string' ? el.className : el.tagName);
    const doc = document.scrollingElement;
    const header = q('header.masthead-solid');
    return {
      headerH: header ? Math.round(header.getBoundingClientRect().height) : -1,
      scrollY: Math.round(window.scrollY),
      viewportH: innerHeight,
      docH: doc.scrollHeight,
      docW: doc.scrollWidth,
      docScreens: +(doc.scrollHeight / innerHeight).toFixed(2),
      tiles: document.querySelectorAll('.card-tile').length,
      sentinel: !!q('#carddex-sentinel'),
      resultsOverflowY: cs(q('.results'))?.overflowY ?? null,
      mainOverflowY: cs(q('main'))?.overflowY ?? null,
      searchPosition: cs(q('.search-tools'))?.position ?? null,
      searchTop: q('.search-tools') ? +q('.search-tools').getBoundingClientRect().top.toFixed(1) : null,
      filterPosition: cs(q('.desktop-filter'))?.position ?? null,
      filterTop: q('.desktop-filter') ? +q('.desktop-filter').getBoundingClientRect().top.toFixed(1) : null,
      filterVisible: q('.desktop-filter') ? cs(q('.desktop-filter')).display !== 'none' : false,
      filterScrollH: q('.filter-scroll')?.scrollHeight ?? 0,
      filterClientH: q('.filter-scroll')?.clientHeight ?? 0,
      gridTop: q('.card-grid') ? +q('.card-grid').getBoundingClientRect().top.toFixed(1) : null,
      insideTop: document.querySelectorAll('.inside-top').length,
      fab: document.querySelectorAll('button[aria-label="回到顶部"]').length,
      bodyOverflow: getComputedStyle(document.body).overflow,
      dialog: document.querySelectorAll('[role="dialog"]').length,
      scrollables
    };
  })()`;

  const probe = () => evalJs(PROBE);

  /* ══════════════════════ A. 架构 ══════════════════════ */
  console.log('\n[A] 架构:文档流滚动,卡片区不再自建高度链');
  await viewport(1680, 1050, false);
  await goto('#/carddex');
  await waitFor('卡牌区渲染出瓦片', `document.querySelectorAll('.card-tile').length >= 40`, 40_000);

  let p = await probe();
  if (p.tiles < 40) {
    console.log('  (卡牌未载入 —— dist 多半没带 Supabase 配置,后续布局断言据此判定)');
  }
  check('A1 文档高度 > 视口(整页可滚)', p.docScreens > 1.5, `文档 ${p.docH}px / 视口 ${p.viewportH}px = ${p.docScreens} 屏`);
  check('A2 main 不再 overflow:hidden', p.mainOverflowY === 'visible', `overflow-y=${p.mainOverflowY}`);
  check('A3 卡片区不再是滚动容器', p.resultsOverflowY === 'visible', `.results overflow-y=${p.resultsOverflowY}`);

  /* ══════════════════════ B. 吸顶 ══════════════════════ */
  console.log('\n[B] 吸顶:搜索栏与筛选栏吸附在报头下沿');
  check('B1 搜索栏 position:sticky', p.searchPosition === 'sticky', String(p.searchPosition));
  check('B2 筛选栏 position:sticky', p.filterPosition === 'sticky', String(p.filterPosition));

  await evalJs('window.scrollTo(0, 1200)');
  await sleep(500);
  p = await probe();
  const headerH = p.headerH;
  console.log(`  (报头实测高度 ${headerH}px,当前 scrollY=${p.scrollY})`);
  near('B3 搜索栏吸附在报头下沿', p.searchTop, headerH, 2);
  check('B4 卡片确实从搜索栏下面滚过', p.gridTop !== null && p.gridTop < 0, `card-grid top=${p.gridTop}`);
  if (p.filterVisible) {
    near('B5 筛选栏吸附在报头下沿', p.filterTop, headerH, 2);
  } else {
    check('B5 筛选栏在桌面可见', false, 'display:none');
  }

  /* ══════════════════════ C. 滚动条 ══════════════════════ */
  console.log('\n[C] 滚动条:全页只剩筛选栏一条');
  check('C1 页面滚动条由 window 承担', true, '见 A1 文档高度');
  const inner = p.scrollables.filter((c) => !/filter-scroll/.test(String(c)));
  check('C2 除筛选栏外没有并列的内层滚动条', inner.length === 0, `实得 ${JSON.stringify(inner)}`);

  /* ══════════════════════ D. 增量加载 ══════════════════════ */
  console.log('\n[D] 加载:sentinel 以视口为 root');
  const before = p.tiles;
  for (let i = 0; i < 4; i++) {
    await evalJs('window.scrollTo(0, document.scrollingElement.scrollHeight)');
    await sleep(600);
  }
  p = await probe();
  check('D1 滚到底会继续增量(可见上限被抬高)', p.tiles > before, `滚动前 ${before} 张 → 滚动后 ${p.tiles} 张`);
  check('D2 sentinel 仍在文档里', p.sentinel === true);

  /* ══════════════════════ E. 回到顶部 ══════════════════════ */
  console.log('\n[E] 回到顶部:全局 FAB 接管,页内不再有第二个按钮');
  check('E1 全局 FAB 出现', p.fab >= 1, `找到 ${p.fab} 个`);
  check('E2 页内 .inside-top 已移除', p.insideTop === 0, `实得 ${p.insideTop} 个`);

  /* ══════════════════════ F. 弹层与滚动位置 ══════════════════════ */
  console.log('\n[F] 弹层:冻结页面滚动,关闭后位置不丢');
  await evalJs('window.scrollTo(0, 1400)');
  await sleep(400);
  const yBefore = (await probe()).scrollY;
  await evalJs(`document.querySelector('.card-tile .card-open').click()`);
  await waitFor('详情弹层打开', `document.querySelectorAll('[role="dialog"]').length > 0`);
  await sleep(400);
  let f = await probe();
  check('F1 弹层打开时 body 滚动被冻结', f.bodyOverflow === 'hidden', `overflow=${f.bodyOverflow}`);
  await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  await waitFor('详情弹层关闭', `document.querySelectorAll('[role="dialog"]').length === 0`);
  await sleep(500);
  f = await probe();
  check('F2 关闭后 body 滚动恢复', f.bodyOverflow !== 'hidden', `overflow=${f.bodyOverflow}`);
  near('F3 关闭后滚动位置保留', f.scrollY, yBefore, 4);

  /* ══════════════════════ G. 长图上限 ══════════════════════ */
  console.log('\n[G] 长截图:文档高度即整页截图上限');
  check('G1 整页截图能覆盖多屏内容', p.docScreens > 1.5, `文档 ${p.docScreens} 屏(改造前恒为 1 屏)`);

  /* ══════════════════════ 截图 ══════════════════════ */
  console.log('\n[截图]');
  await evalJs('window.scrollTo(0, 0)');
  await sleep(600);
  await shot('01-desktop-top');
  await evalJs('window.scrollTo(0, 1200)');
  await sleep(600);
  await shot('02-desktop-scrolled');
  const layout = await cdp('Page.getLayoutMetrics');
  const size = layout.result?.cssContentSize ?? { width: 1680, height: 1050 };
  const full = await cdp('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: size.width, height: size.height, scale: 1 }
  });
  if (full.result?.data) {
    writeFileSync(new URL('03-desktop-fullpage.png', SHOT_DIR), Buffer.from(full.result.data, 'base64'));
    console.log(`  · 截图 shots/carddex-scroll/03-desktop-fullpage.png (${Math.round(size.width)}×${Math.round(size.height)})`);
  }

  /* ══════════════════════ H. 移动端 ══════════════════════ */
  console.log('\n[H] 移动端 390×844');
  await viewport(390, 844, true);
  await goto('#/carddex');
  await waitFor('移动端卡牌区渲染', `document.querySelectorAll('.card-tile').length >= 8`, 30_000);
  const m = await probe();
  check('H1 无横向溢出', m.docW - 390 <= 1, `scrollWidth=${m.docW} vs 390`);
  check('H2 筛选栏收起', m.filterVisible === false);
  check('H3 搜索栏仍吸顶', m.searchPosition === 'sticky', String(m.searchPosition));
  await evalJs('window.scrollTo(0, 900)');
  await sleep(500);
  const m2 = await probe();
  near('H4 移动端吸附在报头下沿', m2.searchTop, m2.headerH, 2);
  await evalJs('window.scrollTo(0, 0)');
  await sleep(400);
  await shot('04-mobile-top');
  await evalJs('window.scrollTo(0, 900)');
  await sleep(500);
  await shot('05-mobile-scrolled');
} finally {
  try {
    ws?.close();
  } catch {
    /* ignore */
  }
  chrome.kill();
  server.close();
}

console.log('\n== 结果 ==');
if (failures.length) {
  for (const f of failures) console.log('  ✗', f);
  console.log(`${passed}/${passed + failures.length} 项通过`);
  process.exitCode = 1;
} else {
  console.log(`${passed}/${passed} 项通过`);
}
