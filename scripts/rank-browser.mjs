// Real browser transport for rank acceptance: Firefox BiDi or Chromium CDP.
// Requests and responses are never replaced by fixtures.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function openRankBrowser({ chromePath, port, onRankRequest }) {
  const firefoxPath = process.env.FIREFOX_PATH ?? '/usr/bin/firefox';
  const firefox = process.env.RANK_BROWSER
    ? process.env.RANK_BROWSER === 'firefox'
    : existsSync(firefoxPath);
  const profile = mkdtempSync('/tmp/rune-rank-browser-');
  const browser = spawn(firefox ? firefoxPath : (process.env.CHROME_PATH ?? chromePath), firefox
    ? ['--headless', '--no-remote', '--profile', profile, '--remote-debugging-port', String(port), 'about:blank']
    : ['--headless', '--disable-gpu', '--no-sandbox', '--no-proxy-server', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1680,1050', 'about:blank'],
  { stdio: 'ignore' });
  let ws, launchError;
  browser.on('error', error => { launchError = error; });
  try {
    let endpoint;
    for (let attempt = 0; attempt < 40; attempt++) {
      if (launchError) throw launchError;
      try {
        const response = await fetch(`http://127.0.0.1:${port}/${firefox ? '' : 'json/list'}`, { signal: AbortSignal.timeout(1500) });
        if (firefox && response.status < 500) endpoint = `ws://127.0.0.1:${port}/session`;
        if (!firefox && response.ok) endpoint = (await response.json()).find(tab => tab.type === 'page')?.webSocketDebuggerUrl;
        if (endpoint) break;
      } catch { /* browser is starting */ }
      await sleep(250);
    }
    if (!endpoint) throw new Error('测试浏览器启动超时');
    ws = new WebSocket(endpoint);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('浏览器协议连接超时')), 10000);
      ws.onopen = () => { clearTimeout(timer); resolve(); };
      ws.onerror = error => { clearTimeout(timer); reject(error); };
    });
    let id = 0;
    const pending = new Map();
    ws.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        pending.get(message.id)?.(message);
        pending.delete(message.id);
      } else if (message.method === 'Network.requestWillBeSent' && message.params.request?.url.includes('userIntegral/ranking/list')) {
        onRankRequest({ at: Date.now(), body: message.params.request.postData ?? '' });
      } else if (message.method === 'script.message' && message.params.channel === 'rank-request') {
        onRankRequest(JSON.parse(message.params.data.value));
      }
    };
    const call = (method, params = {}) => new Promise((resolve, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`浏览器命令超时: ${method}`));
      }, 25000);
      pending.set(requestId, message => {
        clearTimeout(timer);
        if (message.error || message.type === 'error') reject(new Error(`${method}: ${JSON.stringify(message.error ?? message.message)}`));
        else resolve(message);
      });
      ws.send(JSON.stringify({ id: requestId, method, params }));
    });
    if (!firefox) return { command: call, name: 'Chromium CDP', close() { ws.close(); browser.kill(); } };

    await call('session.new', { capabilities: { alwaysMatch: { webSocketUrl: true } } });
    const tree = await call('browsingContext.getTree');
    const context = tree.result.contexts[0].context;
    await call('session.subscribe', { events: ['script.message'] });
    await call('script.addPreloadScript', {
      functionDeclaration: `(report) => {
        const original = window.fetch;
        window.fetch = function(input, options) {
          const url = typeof input === 'string' ? input : input?.url;
          if (url?.includes('userIntegral/ranking/list')) report(JSON.stringify({ at: Date.now(), body: options?.body ?? '' }));
          return original.call(this, input, options);
        };
      }`,
      arguments: [{ type: 'channel', value: { channel: 'rank-request' } }]
    });
    const command = async (method, params = {}) => {
      if (['Page.enable', 'Runtime.enable', 'Network.enable'].includes(method)) return { result: {} };
      if (method === 'Page.navigate') return call('browsingContext.navigate', { context, url: params.url, wait: 'interactive' });
      // Firefox rejects ignoreCache=true; a full reload still resets page modules.
      if (method === 'Page.reload') return call('browsingContext.reload', { context, wait: 'interactive' });
      if (method === 'Page.captureScreenshot') return call('browsingContext.captureScreenshot', { context, origin: 'viewport' });
      if (method === 'Emulation.setDeviceMetricsOverride') return call('browsingContext.setViewport', { context, viewport: { width: params.width, height: params.height }, devicePixelRatio: params.deviceScaleFactor ?? 1 });
      if (method === 'Runtime.evaluate') {
        const response = await call('script.evaluate', {
          expression: `(async () => JSON.stringify(await (${params.expression})))()`,
          target: { context }, awaitPromise: true
        });
        const result = response.result;
        if (result.type === 'exception') return { result: { exceptionDetails: { text: result.exceptionDetails.text } } };
        const value = result.result.type === 'undefined' ? undefined : JSON.parse(result.result.value);
        return { result: { result: { value } } };
      }
      throw new Error(`Firefox 验收不支持命令: ${method}`);
    };
    await command('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1050 });
    return { command, raw: call, context, name: 'Firefox WebDriver BiDi', close() { ws.close(); browser.kill(); } };
  } catch (error) {
    ws?.close();
    browser.kill();
    throw error;
  }
}
