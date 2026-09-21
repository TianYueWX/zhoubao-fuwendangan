/* ================================================================
 * scripts/verify-chain-ui.mjs
 *
 * 结算链推演的无头验收(CDP 驱动 headless chromium,与 verify-ui.mjs 同一套设施)。
 *
 * 拖拽验收要点(这里曾经翻过车,务必看清):
 *   早期版本用 CDP 的 Input.setInterceptDrags + dispatchDragEvent 验收 HTML5
 *   原生拖拽,结果"全过"但实际完全拖不动 —— 因为那条链路绕过了浏览器原生
 *   拖拽机制,只验证了 drop 处理逻辑,从未验证真实手势能否触发 dragstart。
 *
 *   现在拖拽是纯 Pointer Events 手势,验收就直接用 **真实鼠标事件**
 *   (Input.dispatchMouseEvent 的 mousePressed → mouseMoved → mouseReleased),
 *   与用户操作完全同路。事件类型与被测机制一一对应,不再有失真空间。
 *
 * 覆盖:
 *   1. 首页小按钮入口       2. 深链 #/chain 与六区
 *   3. 卡池平卡口径与卡图    4. 拖拽(卡池→区域 / 区域间 / 容量 / 拖回卡池 / 区内重排)
 *   5. 显示模式三态         6. 撤销/重做/快照
 *   7. 演示模式(整块推演台,六区同屏)
 *   8. 未保存拦截           9. 多盘位保存与切换
 *  10. 导出与分享          11. 刷新恢复
 *  12. 分享链接落地(接收端还原)  13. 导出 JSON 含快照并可再导入
 *  14. 大棋盘二维码超限降级
 *
 * 曾经"看起来验过了"的三处盲区(现已补上,别再退回):
 *   · 分享只验了「弹窗里有链接」,从没打开过那条链接 —— 接收端还原逻辑等于没测;
 *   · 导出只验了「按钮存在」,从没真的下载并解析 —— 快照有没有进 JSON 无从得知;
 *   · 二维码只验了「小盘能生成」,超限降级那条分支从没走过。
 *
 * 用法(已接入 npm scripts;构建版是默认口径):
 *   1) npx vite build
 *   2) npx vite preview --port 4173
 *   3) npm run verify:chain-ui          (已包含在 npm run verify:all 里)
 *   开发版也必须验收(模板根注释会影响组件 $el,仅测构建版会漏报):
 *   npx vite --host 127.0.0.1 --port 5173
 *   npm run verify:chain-ui:dev
 *   截图输出到 shots/chain/(已在 .gitignore 中)。
 * ============================================================== */

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CHROME =
  process.env.HOME +
  '/.cache/ms-playwright/chromium_headless_shell-1200/chrome-headless-shell-linux64/chrome-headless-shell';
const PORT = 9777;
const APP = process.env.CHAIN_APP ?? 'http://localhost:4173/';
const SHOT_DIR = new URL('../shots/chain/', import.meta.url).pathname;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(
  CHROME,
  [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${mkdtempSync('/tmp/rune-chain-verify-')}`,
    '--hide-scrollbars',
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
      /* retry */
    }
    await sleep(500);
  }
  throw new Error('CDP not ready: ' + url);
}

const tabs = await getJson(`http://127.0.0.1:${PORT}/json/list`);
const tab = tabs.find((t) => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});

let msgId = 0;
const pending = new Map();
const notices = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  } else if (m.method) {
    notices.push(m);
    // 刷新/关页时若有未保存改动,应用会触发 beforeunload 原生确认框;
    // 不自动应答的话 Page.navigate 会一直等,脚本静默卡死。
    // 这本身也是一条隐性的功能验证:对话框出现 = 关页拦截确实生效了。
    if (m.method === 'Page.javascriptDialogOpening') {
      const dlg = notices.filter((n) => n.method === 'Page.javascriptDialogOpening');
      if (dlg.length === 1) console.log('  (已自动应答关页确认框 —— 未保存拦截生效)');
      void cdp('Page.handleJavaScriptDialog', { accept: true });
    }
  }
};
function cdp(method, params = {}) {
  const id = ++msgId;
  return new Promise((res) => {
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

await cdp('Page.enable');
await cdp('Runtime.enable');
// headless 默认报告 (hover: none);显式关掉触摸模拟,按桌面语义跑
await cdp('Emulation.setTouchEmulationEnabled', { enabled: false });

async function evalJs(expression) {
  const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) {
    throw new Error('JS error: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  }
  return r.result?.result?.value;
}

mkdirSync(SHOT_DIR, { recursive: true });
const shots = (name) =>
  cdp('Page.captureScreenshot', { format: 'png' }).then((r) => {
    writeFileSync(`${SHOT_DIR}/${name}.png`, Buffer.from(r.result.data, 'base64'));
  });

let pass = 0;
let fail = 0;
function check(label, ok, extra = '') {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${label}${extra ? ' — ' + extra : ''}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${label}${extra ? ' — ' + extra : ''}`);
  }
}

/* ──────────────── 拖拽工具(真实鼠标手势) ──────────────── */

function rectOf(sel, fx = 0.5, fy = 0.5) {
  return evalJs(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { x: Math.round(r.left + r.width * ${fx}), y: Math.round(r.top + r.height * ${fy}) };
  })()`);
}

/**
 * 一次完整的拖拽手势:按下 → 逐步移动 → 抬起。
 * 全程使用 Input.dispatchMouseEvent,与真实鼠标完全同路。
 */
async function drag(fromSel, toSel, fromFx = 0.5, fromFy = 0.5, toFx = 0.5, toFy = 0.5) {
  const from = await rectOf(fromSel, fromFx, fromFy);
  const to = await rectOf(toSel, toFx, toFy);
  if (!from) return `找不到拖拽源:${fromSel}`;
  if (!to) return `找不到落点:${toSel}`;

  const base = { button: 'left', buttons: 1, clickCount: 1 };
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, ...base });

  // 先小步移动越过 6px 阈值,再分步走向目标
  const steps = 14;
  for (let i = 1; i <= steps; i++) {
    await cdp('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(from.x + ((to.x - from.x) * i) / steps),
      y: Math.round(from.y + ((to.y - from.y) * i) / steps),
      ...base
    });
    await sleep(28);
  }
  await sleep(60);
  await cdp('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: to.x,
    y: to.y,
    button: 'left',
    buttons: 0,
    clickCount: 1
  });
  await sleep(420);
  return 'ok';
}

/** 拖拽过程中途取一次状态(用于断言落点高亮等过程反馈) */
async function dragAndProbe(fromSel, toSel, probe, fromFx = 0.5, fromFy = 0.5, toFx = 0.5, toFy = 0.5) {
  const from = await rectOf(fromSel, fromFx, fromFy);
  const to = await rectOf(toSel, toFx, toFy);
  if (!from || !to) return { error: '缺少坐标' };
  const base = { button: 'left', buttons: 1, clickCount: 1 };
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, ...base });
  const steps = 14;
  for (let i = 1; i <= steps; i++) {
    await cdp('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(from.x + ((to.x - from.x) * i) / steps),
      y: Math.round(from.y + ((to.y - from.y) * i) / steps),
      ...base
    });
    await sleep(28);
  }
  await sleep(80);
  const probed = await evalJs(probe);
  await cdp('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: to.x,
    y: to.y,
    button: 'left',
    buttons: 0,
    clickCount: 1
  });
  await sleep(420);
  return { probed };
}

const count = (sel) => evalJs(`document.querySelectorAll(${JSON.stringify(sel)}).length`);

/** 轮询等待某个条件成立。卡表是异步载入的,固定 sleep 会偶发落空 */
async function waitFor(expression, tries = 40) {
  for (let i = 0; i < tries; i++) {
    if (await evalJs(expression)) return true;
    await sleep(250);
  }
  return false;
}

/* ════════════ 1. 首页入口 ════════════ */

console.log('\n== 1. 首页小按钮入口 ==');
await cdp('Page.navigate', { url: APP });
await sleep(2600);

check('首页出现小工具入口条', await evalJs(`!!document.querySelector('.home-shortcuts')`));
check(
  '入口按钮文案为「结算链推演」',
  (await evalJs(`document.querySelector('.shortcut-btn')?.textContent.trim()`)) === '结算链推演'
);
check('大卡片仍为 3 张', (await count('.entry-card')) === 3);
check(
  '小按钮排未溢出视口',
  await evalJs(`(() => {
    const el = document.querySelector('.home-shortcuts');
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.bottom <= window.innerHeight + 1 && r.top >= 0;
  })()`)
);
await shots('01-home-light');

/* ════════════ 2. 进入工具 ════════════ */

console.log('\n== 2. 进入 #/chain ==');
await evalJs(`document.querySelector('.shortcut-btn').click()`);
await waitFor(`document.querySelectorAll('.pool-list .pool-item').length > 0`);
await sleep(400);

check('hash 为 #/chain', (await evalJs(`location.hash`)) === '#/chain');
check('六个区域齐全', (await count('[data-chain-area]')) === 6);
check(
  '区域名称与顺序正确',
  (await evalJs(
    `[...document.querySelectorAll('.chain-zone h3')].map(h => h.textContent.trim()).join('|')`
  )) === '结算链|结算中|待处理效果|弃牌堆|基地|战场'
);
check('六个区域都是有效落点', (await count('.chain-zone[data-drop-area]')) === 6);

const poolCount = await count('.pool-list .pool-item');
check('卡池首批已渲染', poolCount > 0, `${poolCount} 张(首批;平卡口径共 965)`);
check(
  '卡池显示卡名与编号',
  await evalJs(`(() => {
    const t = document.querySelector('.pool-list .pool-item')?.textContent ?? '';
    return /[\\u4e00-\\u9fa5]/.test(t) && /[A-Z]{3}-\\d{3}/.test(t);
  })()`)
);
check(
  '卡图来自本站内置卡表(非已失效的原项目 CDN)',
  await evalJs(`(() => {
    const img = document.querySelector('.pool-list .pool-thumb img');
    return !!img && /playloltcg|steamusercontent|rgpub/.test(img.src);
  })()`)
);
check(
  '首个区域默认为图案模式',
  (await evalJs(
    `document.querySelector('[data-chain-area="chain"] .mode-btn.active')?.textContent.trim()`
  )) === '图案'
);
await shots('02-chain-light');

/* ════════════ 3. 拖拽:卡池 → 结算链 ════════════ */

console.log('\n== 3. 拖拽:卡池 → 结算链 ==');
let r = await drag('.pool-list .pool-item .pool-thumb', '[data-drop-area="chain"]', 0.5, 0.5, 0.2, 0.6);
check('拖拽执行', r === 'ok', r);
check('结算链收到 1 张卡', (await count('[data-chain-area="chain"] .chain-card')) === 1);
check('卡池数量不变(拖出是复制)', (await count('.pool-list .pool-item')) === poolCount);
check(
  '拖入的卡按当前玩家染色(p1)',
  await evalJs(`!!document.querySelector('[data-chain-area="chain"] .chain-card.p1')`)
);

r = await drag('.pool-list .pool-item:nth-child(2)', '[data-drop-area="chain"]', 0.5, 0.5, 0.7, 0.6);
check('拖拽第二张', r === 'ok', r);
check('结算链累计 2 张', (await count('[data-chain-area="chain"] .chain-card')) === 2);

console.log('\n== 3b. 拖拽过程反馈(拖影与落点高亮)==');
const dragging = await dragAndProbe(
  '.pool-list .pool-item',
  '[data-drop-area="pending"]',
  `({
    ghost: !!document.querySelector('.chain-touch-ghost'),
    highlight: !!document.querySelector('[data-drop-area="pending"].chain-drop-active'),
    cursor: document.documentElement.classList.contains('chain-dragging-active')
  })`
);
check('拖拽中出现跟随拖影', dragging.probed?.ghost === true);
check('拖拽中高亮落点区域', dragging.probed?.highlight === true);
check('拖拽中切换全局光标', dragging.probed?.cursor === true);
check('拖拽落点生效', (await count('[data-chain-area="pending"] .chain-card')) === 1);

/* ════════════ 4. 区域间拖拽 + 容量 ════════════ */

console.log('\n== 4. 区域间拖拽与「结算中」容量 ==');
// Let a real hover preview open before pressing, as a user inspecting a card would.
await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2, buttons: 0 });
await sleep(1200);
const hoverPoint = await rectOf('[data-chain-area="chain"] .chain-card');
await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...hoverPoint, buttons: 0 });
await sleep(650);
check('普通悬停不弹详情', await count('.card-overlay') === 0);
await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...hoverPoint, button: 'left', buttons: 1, clickCount: 1 });
await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', ...hoverPoint, button: 'left', buttons: 0, clickCount: 1 });
check('普通单击不弹详情', await count('.card-overlay') === 0);
await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18, modifiers: 1 });
await sleep(100);
check('指向卡牌后按 Alt 显示详情', await count('.card-overlay') === 1);
check('预览不拦截卡片指针', await evalJs(`document.elementFromPoint(${hoverPoint.x}, ${hoverPoint.y})?.closest('.chain-card') !== null`));
await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18, modifiers: 0 });
await sleep(100);
check('松开 Alt 立即关闭详情', await count('.card-overlay') === 0);
check('区域图片卡宽度不超过 100px', await evalJs(`document.querySelector('[data-chain-area="chain"] .chain-card').getBoundingClientRect().width <= 100`));
r = await drag('[data-chain-area="chain"] .chain-card', '[data-drop-area="resolve"]');
check('拖拽执行', r === 'ok', r);
check('结算中得到 1 张', (await count('[data-chain-area="resolve"] .chain-card')) === 1);
check('结算链减少为 1 张', (await count('[data-chain-area="chain"] .chain-card')) === 1);
check('结算中不显示清空或模式控件', await count('[data-chain-area="resolve"] .zone-tools') === 0);
check('结算中卡牌比普通卡牌宽', await evalJs(`document.querySelector('[data-chain-area="resolve"] .chain-card').getBoundingClientRect().width > 150`));
await evalJs(`document.querySelector('[data-chain-area="resolve"] .card-face img')?.dispatchEvent(new Event('error'))`);
await sleep(100);
check('结算中缺图时只显示名称文本', await count('[data-chain-area="resolve"] .card-face') === 0 && await count('[data-chain-area="resolve"] .card-name') === 1);


// 提示语 2.6 秒后自动消失,所以拖完立刻取值,不能等到后面再查
r = await drag('[data-chain-area="chain"] .chain-card', '[data-drop-area="resolve"]');
const noticeText = await evalJs(`document.querySelector('.chain-toast span')?.textContent.trim() ?? ''`);
check('拖拽执行(应被容量退回)', r === 'ok', r);
check('超出容量时给出提示', noticeText.includes('已满'), noticeText.slice(0, 40) || '(无提示)');
check('结算中仍只有 1 张', (await count('[data-chain-area="resolve"] .chain-card')) === 1);
check('被退回的卡留在结算链', (await count('[data-chain-area="chain"] .chain-card')) === 1);

const resolveUid = await evalJs(`document.querySelector('[data-chain-area="resolve"] .chain-card').dataset.uid`);
await drag('[data-chain-area="resolve"] .chain-card', '[data-drop-area="resolve"]', 0.5, 0.5, 0.8, 0.8);
check('满区内拖动不改变卡片', await evalJs(`document.querySelector('[data-chain-area="resolve"] .chain-card').dataset.uid`) === resolveUid);
const actionSel = '[data-chain-area="resolve"] .chain-card .act';
const actionBefore = await evalJs(`document.querySelector(${JSON.stringify(actionSel)}).textContent`);
const actionPoint = await rectOf(actionSel);
await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...actionPoint, button: 'left', buttons: 1, clickCount: 1 });
await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', ...actionPoint, button: 'left', buttons: 0, clickCount: 1 });
await sleep(100);
check('真实点击卡片操作按钮生效', await evalJs(`document.querySelector(${JSON.stringify(actionSel)}).textContent`) !== actionBefore);

console.log('\n== 4b. 拖回卡池 = 移出棋盘 ==');
// Start away from the action buttons, including when the card falls back to text.
r = await drag('[data-chain-area="resolve"] .chain-card', '.pool-list', 0.15, 0.5);
check('拖拽执行', r === 'ok', r);
check('结算中被清空', (await count('[data-chain-area="resolve"] .chain-card')) === 0);
check('结算链仍为 1 张', (await count('[data-chain-area="chain"] .chain-card')) === 1);

console.log('\n== 4c. 区内重排 ==');
await drag('.pool-list .pool-item:nth-child(3)', '[data-drop-area="chain"]', 0.5, 0.5, 0.85, 0.6);
const orderBefore = await evalJs(
  `[...document.querySelectorAll('[data-chain-area="chain"] .chain-card')].map(c=>c.dataset.uid).join(',')`
);
r = await drag('[data-chain-area="chain"] .chain-card', '[data-drop-area="chain"]', 0.5, 0.5, 0.97, 0.6);
const orderAfter = await evalJs(
  `[...document.querySelectorAll('[data-chain-area="chain"] .chain-card')].map(c=>c.dataset.uid).join(',')`
);
check('区内重排改变了顺序', r === 'ok' && orderBefore !== orderAfter, `${orderBefore} → ${orderAfter}`);

/* ════════════ 5. 显示模式 ════════════ */

console.log('\n== 5. 显示模式 ==');
const modeBefore = await evalJs(`window.__chainStore.working.board.areas.base.mode`);
const modeClicked = await evalJs(`(() => {
  const zone = document.querySelector('[data-chain-area="base"]');
  const btn = [...zone.querySelectorAll('.mode-btn')].find(b => b.textContent.trim() === '文本');
  if (!btn) return false; btn.click(); return true;
})()`);
await sleep(400);
check(
  '可切换区域显示模式为「文本」',
  modeClicked &&
    (await evalJs(
      `document.querySelector('[data-chain-area="base"] .mode-btn.active')?.textContent.trim()`
    )) === '文本'
);

/* ════════════ 6. 撤销 / 重做 / 快照 ════════════ */

console.log('\n== 6. 撤销 / 重做 / 快照 ==');
const undoOk = await evalJs(`(() => {
  const b = [...document.querySelectorAll('.tb-btn')].find(x => x.textContent.trim() === '↶');
  if (!b || b.disabled) return false; b.click(); return true;
})()`);
await sleep(400);
check('撤销可用且已点击', undoOk);
check(
  '撤销后 base 模式回到改动前',
  (await evalJs(`window.__chainStore.working.board.areas.base.mode`)) === modeBefore,
  `${modeBefore} ← 期望`
);

const redoOk = await evalJs(`(() => {
  const b = [...document.querySelectorAll('.tb-btn')].find(x => x.textContent.trim() === '↷');
  if (!b || b.disabled) return false; b.click(); return true;
})()`);
await sleep(400);
check('重做可用且已点击', redoOk);
check(
  '重做后 base 模式回到 text',
  (await evalJs(`window.__chainStore.working.board.areas.base.mode`)) === 'text',
  `实际 ${await evalJs(`window.__chainStore.working.board.areas.base.mode`)}`
);

const snapBefore = await evalJs(`window.__chainStore.working.history.length`);
check('普通操作与撤销重做不自动创建快照', snapBefore === 0);
await evalJs(
  `[...document.querySelectorAll('.tb-btn')].find(x => x.textContent.trim() === '保存快照')?.click()`
);
await sleep(300);
const snapAfter = await evalJs(`window.__chainStore.working.history.length`);
check('快照条数 +1', snapAfter === snapBefore + 1, `${snapBefore} → ${snapAfter}`);
await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 's', code: 'KeyS', windowsVirtualKeyCode: 83, modifiers: 2 });
await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 's', code: 'KeyS', windowsVirtualKeyCode: 83, modifiers: 0 });
check('Ctrl+S 新增一条快照', await evalJs(`window.__chainStore.working.history.length`) === snapAfter + 1);


console.log('\n== 6b. 悬浮快照窗口 ==');
await evalJs(`[...document.querySelectorAll('.tb-btn')].find(b => b.textContent.trim() === '快照历史').click()`);
await sleep(150);
const panelBefore = await rectOf('.history-panel');
check('工具栏打开悬浮快照窗口', !!panelBefore);
await drag('.hp-head', '.actor-bar', 0.3, 0.5);
const panelAfter = await rectOf('.history-panel');
check('拖动标题栏移动窗口', panelAfter && panelBefore && Math.abs(panelAfter.x - panelBefore.x) > 20);
await evalJs(`document.querySelector('.hp-close').click()`);
await sleep(100);
check('关闭快照窗口', await rectOf('.history-panel') === null);
await evalJs(`[...document.querySelectorAll('.tb-btn')].find(b => b.textContent.trim() === '快照历史').click()`);
await sleep(100);
check('重新打开保留快照与位置', await count('.hp-item') === snapAfter + 1 && Math.abs((await rectOf('.history-panel')).x - panelAfter.x) < 1);
await evalJs(`document.querySelector('.hp-close').click()`);

/* ════════════ 7. 演示模式 ════════════ */

console.log('\n== 7. 演示模式(整块推演台)==');
const realCards = await count('main .chain-card');
await evalJs(
  `[...document.querySelectorAll('.tb-btn')].find(x => x.textContent.trim() === '演示')?.click()`
);
await sleep(700);
check('演示浮层已打开', await evalJs(`!!document.querySelector('.present-overlay')`));
check('演示模式下六个区域同屏', (await count('.present-overlay [data-chain-area]')) === 6);
check(
  '演示模式卡片数与真实棋盘一致',
  (await count('.present-overlay .chain-card')) === realCards,
  `${await count('.present-overlay .chain-card')} / ${realCards}`
);
check(
  '演示模式不显示管理操作',
  !(await evalJs(`!!document.querySelector('.present-overlay .tb-btn, .present-overlay .zone-tools')`))
);
await shots('03-presentation');

await evalJs(
  `(() => { const b=[...document.querySelectorAll('.present-tools button')].find(x=>x.textContent.includes('退出演示')); b?.click(); })()`
);
await sleep(400);
check('可退出演示模式', !(await evalJs(`!!document.querySelector('.present-overlay')`)));

/* ════════════ 8. 未保存拦截 ════════════ */

console.log('\n== 8. 未保存拦截 ==');
check('当前处于未保存状态', await evalJs(`!!document.querySelector('.tb-stat .dirty')`));

const triggerOk = await evalJs(`(() => {
  const trigger = document.querySelector('.play-current');
  if (!trigger) return 'no trigger';
  // 面板已展开时不要再点,否则会把它收起来
  if (!document.querySelector('.play-panel')) trigger.click();
  return 'ok';
})()`);
// Vue 是异步渲染:面板要等一次 tick 才会出现,不能在同一次 evaluate 里连着点
await sleep(350);
const newClicked = await evalJs(`(() => {
  const neu = document.querySelector('[data-action="create-play"]');
  if (!neu) return 'no button';
  neu.click();
  return 'ok';
})()`);
await sleep(400);
void triggerOk;
const maskShown = await evalJs(`!!document.querySelector('.unsaved-mask')`);
check(
  '点「新建」触发未保存对话框',
  newClicked === 'ok' && maskShown,
  `click=${newClicked} mask=${maskShown} dirty=${await evalJs(`!!document.querySelector('.tb-stat .dirty')`)}`
);
await shots('04-unsaved-dialog');

const playsBefore = await evalJs(`window.__chainStore.plays.length`);
await evalJs(
  `[...document.querySelectorAll('.unsaved-actions button')].find(x => x.textContent.includes('取消'))?.click()`
);
await sleep(300);
check('点「取消」后不新建盘位', (await evalJs(`window.__chainStore.plays.length`)) === playsBefore);
check('对话框已关闭', !(await evalJs(`!!document.querySelector('.unsaved-mask')`)));

/* ════════════ 9. 保存 / 多盘位 ════════════ */

console.log('\n== 9. 保存 / 多盘位 ==');
await evalJs(
  `[...document.querySelectorAll('.tb-btn')].find(x => x.textContent.trim() === '保存')?.click()`
);
await sleep(400);
check('保存后不再显示未保存', !(await evalJs(`!!document.querySelector('.tb-stat .dirty')`)));
check(
  'localStorage 已写入盘位',
  await evalJs(`(() => {
    const raw = localStorage.getItem('rune.chain.v1');
    if (!raw) return false;
    const obj = JSON.parse(raw);
    return obj.version === 1 && Array.isArray(obj.plays) && obj.plays.length >= 1;
  })()`)
);

const cardsBeforeNew = await count('.chain-card');
// 上一步若留下未保存状态,新建会先弹拦截框;这里统一走「保存并继续」
if (await evalJs(`!!document.querySelector('.unsaved-mask')`)) {
  await evalJs(`[...document.querySelectorAll('.unsaved-actions button')].find(x=>x.textContent.includes('保存'))?.click()`);
  await sleep(400);
}
await evalJs(`(() => {
  if (!document.querySelector('.play-panel')) document.querySelector('.play-current')?.click();
})()`);
await sleep(350);
await evalJs(`document.querySelector('[data-action="create-play"]')?.click()`);
await sleep(500);
check('新建盘位成功', (await evalJs(`window.__chainStore.plays.length`)) >= 2);
check('新盘位是空的', (await count('.chain-card')) === 0);

await evalJs(`(() => {
  if (!document.querySelector('.play-panel')) document.querySelector('.play-current')?.click();
})()`);
await sleep(350);
await evalJs(`document.querySelectorAll('.play-open')[0]?.click()`);
await sleep(600);
check(
  '切回第一个盘位后卡片恢复',
  (await count('.chain-card')) === cardsBeforeNew,
  `${await count('.chain-card')} / ${cardsBeforeNew}`
);

/* ════════════ 10. 导出与分享 ════════════ */

console.log('\n== 10. 导出与分享 ==');
check(
  '导出按钮存在',
  await evalJs(`[...document.querySelectorAll('.tb-btn')].some(b => b.textContent.trim() === '导出')`)
);
check(
  '导入入口存在(隐藏的 file input)',
  await evalJs(`!!document.querySelector('input[type="file"][accept*="json"]')`)
);
await evalJs(
  `[...document.querySelectorAll('.tb-btn')].find(x => x.textContent.trim() === '分享')?.click()`
);
await sleep(600);
check('分享打开弹窗', await count('.share-dialog') === 1);
check('分享弹窗包含链接', (await evalJs(`document.querySelector('#chain-share-link')?.value ?? ''`)).includes('#/chain?s='));
await waitFor(`!!document.querySelector('.share-qr')`, 120);
check('分享二维码已生成', await count('.share-qr') === 1);
check('提供复制链接按钮', await count('.share-copy') === 1);
await evalJs(`document.querySelector('[aria-label="关闭分享"]').click()`);

/* ════════════ 11. 刷新恢复 ════════════ */

console.log('\n== 11. 刷新恢复 ==');
await evalJs(
  `[...document.querySelectorAll('.tb-btn')].find(x => x.textContent.trim() === '保存')?.click()`
);
await sleep(400);
// 注意:多行对象字面量必须写成单行,否则会被解析成「函数体 + 顶层对象字面量」
// 而报语法错误 —— 那种错误只会让脚本静默卡死,不报错,极难查。
const before = await evalJs(`(function () {
  var st = window.__chainStore;
  var cur = null;
  for (var i = 0; i < st.plays.length; i++) { if (st.plays[i].id === st.currentId) cur = st.plays[i]; }
  return { plays: st.plays.length, cards: document.querySelectorAll('.chain-card').length, name: cur ? cur.name : '' };
})()`);

// 必须真的重新加载文档:只改 hash 属于同文档导航,App 根本不会重新挂载,
// 「刷新恢复」就成了一句空话 —— 这条曾经就是这么假过的。
const hashBeforeReload = await evalJs(`window.location.hash`);
check('刷新前地址栏停在结算链深链上', String(hashBeforeReload).includes('chain'), String(hashBeforeReload));
await cdp('Page.reload');
// 开发版重新加载要重走一遍模块图(实测约 30 秒,构建版毫秒级),给足预算再判定;
// 条件一旦满足立刻返回,构建版不会因此变慢。
await waitFor(
  `!!window.__chainStore && window.__chainStore.plays.length > 0 &&
   document.querySelectorAll('.pool-list .pool-item').length > 0`,
  240
);
await sleep(400);
const after = await evalJs(`(function () {
  var st = window.__chainStore;
  if (!st) return { plays: 0, cards: 0, name: '' };
  var cur = null;
  for (var i = 0; i < st.plays.length; i++) { if (st.plays[i].id === st.currentId) cur = st.plays[i]; }
  return { plays: st.plays.length, cards: document.querySelectorAll('.chain-card').length, name: cur ? cur.name : '' };
})()`);
check('盘位数量一致', after.plays === before.plays, `${before.plays} → ${after.plays}`);
check('卡片数量一致', after.cards === before.cards, `${before.cards} → ${after.cards}`);
check('盘名一致', after.name === before.name, `${before.name} → ${after.name}`);
check('深链下六区仍齐全', (await count('[data-chain-area]')) === 6);
check('深链下卡池仍就绪', await waitFor(`document.querySelectorAll('.pool-list .pool-item').length > 0`, 40));
// 浮窗位置存在 localStorage,刷新后应当回到 6b 里拖到的那个位置
await evalJs(`[...document.querySelectorAll('.tb-btn')].find(b => b.textContent.trim() === '快照历史').click()`);
await sleep(250);
const panelAfterReload = await rectOf('.history-panel');
check('刷新后快照浮窗回到拖动后的位置',
  !!panelAfterReload && !!panelAfter && Math.abs(panelAfterReload.x - panelAfter.x) < 1,
  panelAfterReload && panelAfter ? `x ${panelAfter.x} → ${panelAfterReload.x}` : '未打开');
await evalJs(`document.querySelector('.hp-close')?.click()`);
await shots('05-chain-after-reload');

/* ════════════ 12. 分享链接落地(接收端) ════════════ */

console.log('\n== 12. 分享链接落地 ==');
const boardCardCount = () =>
  evalJs(`(function () {
    var a = window.__chainStore.working.board.areas, n = 0;
    for (var k in a) n += a[k].cards.length;
    return n;
  })()`);

const shareSource = await evalJs(`(function () {
  var areas = window.__chainStore.working.board.areas;
  for (var k in areas) {
    var c = areas[k].cards[0];
    if (c) return { id: c.cardId, name: c.name, text: c.text, count: 0 };
  }
  return null;
})()`);
check('分享前本地卡带完整效果正文', !!shareSource && shareSource.text.length > 0, shareSource ? `${shareSource.text.length} 字` : '无卡');
const shareSourceCount = await boardCardCount();

await evalJs(`[...document.querySelectorAll('.tb-btn')].find(x => x.textContent.trim() === '分享')?.click()`);
await waitFor(`!!document.querySelector('#chain-share-link')`);
const shareLink = await evalJs(`document.querySelector('#chain-share-link')?.value ?? ''`);
check('分享链接为压缩格式', shareLink.includes('#/chain?s=z'), `长度 ${shareLink.length} 字符`);
await evalJs(`document.querySelector('[aria-label="关闭分享"]').click()`);
await sleep(150);

// 真的把链接打开一次 —— 接收端的还原逻辑只有走到这里才算验过。
// 先离开当前文档:只改 hash 是同文档导航,链视图不会重新挂载,
// 那样测到的是「自家页面切了个路由」,而不是「接收方打开分享链接」。
await cdp('Page.navigate', { url: 'about:blank' });
await sleep(300);
await cdp('Page.navigate', { url: shareLink });
await waitFor(`document.querySelectorAll('.chain-card').length > 0`, 240);
await sleep(400);
check('分享链接落在结算链视图(没有回落到工具台)', (await count('.chain-view')) === 1);
check('打开分享链接落在临时盘', (await count('.temp-banner')) === 1);
check('落地后地址栏清掉长参数(避免刷新重复导入)',
  !(await evalJs(`window.location.hash`)).includes('?s='), await evalJs(`window.location.hash`));
const recvCount = await boardCardCount();
check('接收端卡片数与分享方一致', recvCount === shareSourceCount, `${shareSourceCount} → ${recvCount}`);
const received = await evalJs(`(function () {
  var areas = window.__chainStore.working.board.areas;
  for (var k in areas) {
    var c = areas[k].cards[0];
    if (c) return { id: c.cardId, name: c.name, text: c.text };
  }
  return null;
})()`);
check('接收端卡名与编号无损', !!received && received.id === shareSource.id && received.name === shareSource.name,
  received ? `${received.id} ${received.name}` : '无卡');
check('链接不带效果正文(体积就是从这里省出来的)', !!received && received.text === '',
  received ? `${shareSource.text.length} 字 → ${received.text.length} 字` : '无卡');

// 正文虽然没进链接,但接收端应当能用内置卡表按编号回填(Alt 详情浮层)
const recvPoint = (await rectOf('[data-chain-area="chain"] .chain-card')) ?? (await rectOf('.chain-card'));
await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2, buttons: 0 });
await sleep(200);
await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...recvPoint, buttons: 0 });
await sleep(300);
await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18, modifiers: 1 });
await sleep(200);
check('接收端按 Alt 能看回效果正文(卡表回填)',
  await evalJs(`(document.querySelector('.card-overlay .overlay-text')?.textContent ?? '').trim().length > 0`));
await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18, modifiers: 0 });
await sleep(150);
await shots('06-shared-landing');

/* ════════════ 13. 导出 JSON(含快照)与再导入 ════════════ */

console.log('\n== 13. JSON 导出与再导入 ==');
const FIXTURE_DIR = mkdtempSync('/tmp/rune-chain-fixture-');

await evalJs(`[...document.querySelectorAll('.tb-btn')].find(x => x.textContent.trim() === '保存快照')?.click()`);
await sleep(300);
const snapsBefore = await evalJs(`window.__chainStore.working.history.length`);
const cardsBefore = await boardCardCount();
const playsBeforeExport = await evalJs(`window.__chainStore.plays.length`);
check('导出前已有一条快照', snapsBefore >= 1, `${snapsBefore} 条`);

// 在页面内截获导出的 blob,而不是等浏览器落盘:无头 shell 的下载行为不可靠,
// 而这里要验的是「导出的内容里到底有没有快照」,不是浏览器的下载器。
const exportedText = await evalJs(`(async () => {
  var orig = HTMLAnchorElement.prototype.click;
  var captured = '';
  HTMLAnchorElement.prototype.click = function () {
    if (typeof this.href === 'string' && this.href.indexOf('blob:') === 0) { captured = this.href; return; }
    return orig.call(this);
  };
  try {
    var btn = [...document.querySelectorAll('.tb-btn')].find(x => x.textContent.trim() === '导出');
    if (btn) btn.click();
    if (!captured) return '';
    return await (await fetch(captured)).text();
  } catch (e) {
    return '';
  } finally {
    HTMLAnchorElement.prototype.click = orig;
  }
})()`);
check('导出产出 JSON 内容', typeof exportedText === 'string' && exportedText.length > 0, `${exportedText.length} 字符`);

let exported = null;
try {
  exported = JSON.parse(exportedText);
} catch {
  exported = null;
}
check('导出 JSON 可解析且含快照列表',
  !!exported && Array.isArray(exported.history) && exported.history.length === snapsBefore,
  `history ${exported?.history?.length ?? '解析失败'} 条`);
check('导出 JSON 含棋盘六区',
  !!exported && !!exported.board && Object.keys(exported.board.areas).length === 6);
check('导出 JSON 里的快照带棋盘快照体',
  !!exported && !!exported.history?.[0]?.board?.areas);

// 把刚导出的内容原样写回磁盘,再走真实的导入入口读进来
const exportedPath = join(FIXTURE_DIR, 'round-trip.json');
writeFileSync(exportedPath, exportedText);

await cdp('DOM.enable');
const doc = await cdp('DOM.getDocument', { depth: -1 });
const fileInput = await cdp('DOM.querySelector', {
  nodeId: doc.result.root.nodeId,
  selector: 'input[type="file"][accept*="json"]'
});
check('找到导入用的隐藏 file input', !!fileInput.result?.nodeId);
await cdp('DOM.setFileInputFiles', { files: [exportedPath], nodeId: fileInput.result.nodeId });
await waitFor(`window.__chainStore.plays.length > ${playsBeforeExport}`, 120);
await sleep(500);
const afterImport = await evalJs(`(function () {
  var st = window.__chainStore;
  return { plays: st.plays.length, cards: 0, history: st.working.history.length,
    areas: (function () { var a = st.working.board.areas, n = 0; for (var k in a) n += a[k].cards.length; return n; })() };
})()`);
check('再导入生成新盘位', afterImport.plays === playsBeforeExport + 1, `${playsBeforeExport} → ${afterImport.plays}`);
check('再导入后卡片数一致', afterImport.areas === cardsBefore, `${cardsBefore} → ${afterImport.areas}`);
check('再导入后快照一并恢复', afterImport.history === snapsBefore, `${snapsBefore} → ${afterImport.history}`);

/* ════════════ 14. 大棋盘:二维码超限降级 ════════════ */

console.log('\n== 14. 二维码超限降级 ==');
// 210 张的盘:编码后约 3.5k 字符,越过二维码容量(约 2.9k)但仍在长度闸门内。
// 用导入路径造盘,顺带覆盖「大文件导入」。
const bigAreas = {};
let bigIndex = 0;
for (const key of ['chain', 'resolve', 'pending', 'trash', 'base', 'battlefield']) {
  bigAreas[key] = { cards: [] };
  for (let i = 0; i < 35; i++) {
    bigAreas[key].cards.push({
      uid: `big-${bigIndex}`,
      cardId: `BIG-${String(bigIndex).padStart(3, '0')}`,
      name: `压力测试卡${bigIndex}`,
      subtitle: `副标题${bigIndex}`,
      text: '这段正文用于撑大分享载荷。'.repeat(3),
      category: '单位',
      colors: ['blue'],
      energy: 3,
      power: 4,
      player: (bigIndex % 2) + 1,
      custom: false
    });
    bigIndex += 1;
  }
}
const bigPath = join(FIXTURE_DIR, 'big-board.json');
writeFileSync(bigPath, JSON.stringify({ areas: bigAreas, updatedAt: Date.now() }));
await cdp('DOM.setFileInputFiles', { files: [bigPath], nodeId: fileInput.result.nodeId });
await waitFor(`document.querySelectorAll('.chain-card').length > 100`, 240);
await sleep(600);
check('导入大棋盘成功', (await boardCardCount()) === 210, `${await boardCardCount()} 张`);

await evalJs(`[...document.querySelectorAll('.tb-btn')].find(x => x.textContent.trim() === '分享')?.click()`);
await waitFor(`!!document.querySelector('.share-dialog')`, 120);
await sleep(1200);
const bigLink = await evalJs(`document.querySelector('#chain-share-link')?.value ?? ''`);
check('大棋盘仍在闸门内、链接照常生成', bigLink.includes('#/chain?s=z'), `长度 ${bigLink.length} 字符`);
check('二维码超限时不再渲染二维码', (await count('.share-qr')) === 0);
check('二维码超限时给出降级说明',
  /无法生成二维码/.test(await evalJs(`document.querySelector('.share-dialog')?.textContent ?? ''`)));
check('降级后复制链接仍然可用', (await count('.share-copy')) === 1);
await shots('07-share-qr-fallback');

/* ════════════ 汇总 ════════════ */

console.log(`\n${'═'.repeat(52)}`);
console.log(`通过 ${pass} 项,失败 ${fail} 项`);
console.log('═'.repeat(52));

chrome.kill();
process.exit(fail === 0 ? 0 : 1);
