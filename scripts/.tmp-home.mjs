import { spawn } from 'node:child_process';
const CHROME = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1200/chrome-headless-shell-linux64/chrome-headless-shell';
const PORT = 9840;
const log = (...a) => process.stdout.write(a.join(' ') + '\n');
const chrome = spawn(CHROME, ['--headless','--disable-gpu','--no-sandbox',`--remote-debugging-port=${PORT}`,'--user-data-dir=/tmp/rune-home','--hide-scrollbars','--window-size=1680,1050','about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tabs;
for (let i=0;i<40;i++){ try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); if (r.ok) { tabs=await r.json(); break; } } catch {} await sleep(500); }
const tab = tabs.find((t) => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  else if (m.method === 'Runtime.exceptionThrown') log('PAGE-EXC:', String(m.params.exceptionDetails?.exception?.description||'').slice(0,300)); };
const cdp = (method, params = {}) => new Promise((res) => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
await cdp('Page.enable'); await cdp('Runtime.enable');
const evalJs = async (e) => { const r = await cdp('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.result?.exceptionDetails ? 'ERR:'+JSON.stringify(r.result.exceptionDetails).slice(0,300) : r.result?.result?.value; };
await cdp('Page.navigate', { url: 'http://127.0.0.1:4173/' });
for (const w of [1500, 1500, 2000, 3000]) {
  await sleep(w);
  log(`t: shortcut-btn=${await evalJs(`document.querySelectorAll('.shortcut-btn').length`)} entry-card=${await evalJs(`document.querySelectorAll('.entry-card').length`)} home-shortcuts=${await evalJs(`!!document.querySelector('.home-shortcuts')`)} hash=${await evalJs(`location.hash`)}`);
}
log('首页文本片段:', await evalJs(`document.body.innerText.slice(0,150).replace(/\\n+/g,' | ')`));
log('小按钮存在但不可见?', await evalJs(`(() => { const el=document.querySelector('.shortcut-btn'); if(!el) return 'no el'; const r=el.getBoundingClientRect(); const s=getComputedStyle(el); return JSON.stringify({w:Math.round(r.width),h:Math.round(r.height),top:Math.round(r.top),bottom:Math.round(r.bottom),vh:window.innerHeight,display:s.display,visibility:s.visibility}); })()`));
chrome.kill();
