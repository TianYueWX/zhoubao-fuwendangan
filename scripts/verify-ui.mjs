/* 临时验证脚本:CDP 驱动 headless chromium 跑通 预设加载 → 头版总览 → 传奇对比 → 周报叙事(宣纸单主题) */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const CHROME =
  process.env.HOME +
  '/.cache/ms-playwright/chromium_headless_shell-1200/chrome-headless-shell-linux64/chrome-headless-shell';
const PORT = 9333;
const APP = 'http://localhost:4173/';

const chrome = spawn(
  CHROME,
  [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    `--remote-debugging-port=${PORT}`,
    '--user-data-dir=/tmp/rune-cdp-profile',
    '--hide-scrollbars',
    '--window-size=1680,1050',
    'about:blank'
  ],
  { stdio: 'ignore' }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 30) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch {}
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
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
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
await cdp('Page.navigate', { url: APP });
await sleep(2500);

async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error('JS error: ' + JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
}
const shots = (name) =>
  cdp('Page.captureScreenshot', { format: 'png' }).then((r) => {
    const buf = Buffer.from(r.result.data, 'base64');
    writeFileSync(`/home/TianYue/Downloads/state/shots/${name}.png`, buf);
    console.log('shot:', name, buf.length, 'bytes');
  });

mkdirSync('/home/TianYue/Downloads/state/shots', { recursive: true });

console.log('== 1. 首屏(导入页)==');
console.log('title:', await evalJs('document.title'));
console.log('html class(应为空):', JSON.stringify(await evalJs('document.documentElement.className')));
console.log('刊名:', await evalJs(`document.querySelector('h1')?.textContent`));
console.log('页面底色(宣纸白):', await evalJs('getComputedStyle(document.body).backgroundColor'));
console.log('无主题切换按钮:', await evalJs(`!document.body.textContent.includes('跟随系统')`));
await shots('01-import-light');

console.log('\n== 2. 点击一键加载预设包 ==');
const clicked = await evalJs(`(() => {
  const btns = [...document.querySelectorAll('button')];
  const b = btns.find(x => x.textContent.includes('一键加载'));
  if (!b) return 'no button';
  b.click(); return 'clicked';
})()`);
console.log('click:', clicked);
await sleep(9000); // worker 解析 + 分析
console.log('== 3. 头版检查 ==');
console.log('刊号行:', await evalJs(`[...document.querySelectorAll('header div')].map(d => d.textContent?.trim()).find(t => t && t.startsWith('本期'))`));
console.log('头条存在:', await evalJs(`!!document.body.textContent.includes('本期头条')`));
console.log('头条大标题(综合分口径):', await evalJs(`(() => { const h = [...document.querySelectorAll('h2')].find(x => x.className.includes('headline-xl')); return h ? h.textContent.trim() : 'none'; })()`));
console.log('头条含冠军转化:', await evalJs(`document.body.textContent.includes('夺冠') && document.body.textContent.includes('Top8 转化')`));
console.log('报眼 KPI 行数:', await evalJs(`[...document.querySelectorAll('aside .py-3')].length`));
console.log('Tier 榜存在:', await evalJs(`document.body.textContent.includes('英雄 Tier List')`));
console.log('域对存在:', await evalJs(`document.body.textContent.includes('传奇域对分布')`));
console.log('散点存在:', await evalJs(`document.body.textContent.includes('环境阶梯')`));
console.log('范围条存在:', await evalJs(`document.body.textContent.includes('范围')`));
console.log('周次选择器默认选中最新周:', await evalJs(`(() => { const s = document.querySelector('select[aria-label="选择周次"]'); return s ? s.value : 'no select'; })()`));
console.log('周次选项数(含全部周):', await evalJs(`(() => { const s = document.querySelector('select[aria-label="选择周次"]'); return s ? s.options.length : 0; })()`));
console.log('栏目条项数:', await evalJs(`document.querySelectorAll('nav[aria-label="卷宗导航"] button').length`));
console.log('栏目条短标签:', await evalJs(`[...document.querySelectorAll('nav[aria-label="卷宗导航"] button')].map(b => b.textContent.trim()).join('|')`));
console.log('总览图例符文数:', await evalJs(`[...document.querySelectorAll('section svg[role="img"]')].length`));
await shots('02-overview-light');

console.log('\n== 3.5 传奇卡组对比页 ==');
const toLeg = await evalJs(`(() => {
  const btns = [...document.querySelectorAll('nav[aria-label="卷宗导航"] button')];
  const b = btns.find(x => x.textContent.trim() === '传奇');
  if (!b) return 'no nav';
  b.click(); return 'ok';
})()`);
console.log('click 传奇栏目:', toLeg);
await sleep(1200);
console.log('页面标题:', await evalJs(`document.body.textContent.includes('传奇卡组对比')`));
console.log('矩阵分类行:', await evalJs(`[...document.querySelectorAll('tbody tr td[colspan]')].map(t => t.textContent.trim()).filter(Boolean).join('|')`));
console.log('矩阵行数(卡牌):', await evalJs(`document.querySelectorAll('tbody tr').length`));
console.log('共通/独有图例:', await evalJs(`document.body.textContent.includes('共通') && document.body.textContent.includes('独有')`));
// Top N 向下取
const top5 = await evalJs(`(() => {
  const btns = [...document.querySelectorAll('button')];
  const b = btns.find(x => x.textContent.trim() === '前 5');
  if (!b) return 'no btn';
  b.click(); return 'ok';
})()`);
console.log('click 前5:', top5);
await sleep(800);
// 周过滤
const wk = await evalJs(`(() => {
  const btns = [...document.querySelectorAll('button')];
  const b = btns.find(x => /W\\d+/.test(x.textContent) && x.textContent.trim().length <= 12);
  if (!b) return 'none';
  b.click(); return b.textContent.trim();
})()`);
console.log('周过滤 click:', wk);
await sleep(800);
console.log('周过滤后矩阵仍渲染:', await evalJs(`document.querySelectorAll('tbody tr').length > 5`));
await shots('05-legendary-compare');

console.log('\n== 4. 回到头版并切到趋势对比叙事 ==');
const backOv = await evalJs(`(() => {
  const b = [...document.querySelectorAll('nav[aria-label="卷宗导航"] button')].find(x => x.textContent.trim() === '总览');
  b?.click(); return !!b;
})()`);
console.log('click 总览栏目:', backOv);
await sleep(1000);
const rep = await evalJs(`(() => {
  const btns = [...document.querySelectorAll('button')];
  const b = btns.find(x => x.textContent.trim() === '趋势对比');
  if (!b) return 'no button';
  b.click(); return 'ok';
})()`);
console.log('click:', rep);
await sleep(1500);
console.log('胜率变化榜:', await evalJs(`document.body.textContent.includes('胜率变化榜')`));
console.log('复制趋势报告按钮:', await evalJs(`document.body.textContent.includes('复制趋势报告 Markdown')`));
console.log('热度上升榜:', await evalJs(`document.body.textContent.includes('热度上升')`));
await shots('04-report-light');

console.log('\n== 5. 单卡页:传奇/符文不应出现在万金油表 ==');
const toCards = await evalJs(`(() => {
  const b = [...document.querySelectorAll('nav[aria-label="卷宗导航"] button')].find(x => x.textContent.trim() === '单卡');
  b?.click(); return !!b;
})()`);
console.log('click 单卡栏目:', toCards);
await sleep(1500);
console.log('表内无「传奇」类型行:', await evalJs(`![...document.querySelectorAll('tbody tr')].map(r => r.cells[2]?.textContent?.trim()).includes('传奇')`));
console.log('表内无符文卡(如 翠意符文):', await evalJs(`!document.body.textContent.includes('翠意符文')`));

ws.close();
chrome.kill();
console.log('\nDONE');
