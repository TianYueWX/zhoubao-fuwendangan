/* ================================================================
 * scripts/verify-editorial.mjs
 *
 * 编辑部 P0 验收:暗门解锁 + 门禁拦截 + 隐藏性。
 * CDP 驱动 headless chromium(与 verify-ui.mjs 同一套设施),用**全新**
 * user-data-dir 保证 localStorage 干净,否则解锁状态会污染「访客态」用例。
 *
 * 前置:构建产物已在 dist/,且 `npm run preview` 在 :4173 运行。
 *   npm run build:fast && npm run preview &
 *   node scripts/verify-editorial.mjs
 * ================================================================ */
import { spawn } from 'node:child_process';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';

const SHOTS = process.env.SHOTS === '1';
const SHOT_DIR = 'shots';

const CHROME =
  process.env.HOME +
  '/.cache/ms-playwright/chromium_headless_shell-1200/chrome-headless-shell-linux64/chrome-headless-shell';
const PORT = 9334;
const APP = 'http://localhost:4173/';
const PROFILE = '/tmp/rune-editorial-profile';

rmSync(PROFILE, { recursive: true, force: true }); // 干净档案 = 干净 localStorage

const chrome = spawn(
  CHROME,
  [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
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
    } catch {
      /* 等 CDP 起来 */
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
/** 全程收集未捕获异常 —— 改动了 catalog / App / HomeView 这些共用骨架,必须证明没改坏 */
const pageErrors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params?.exceptionDetails;
    pageErrors.push(d?.exception?.description ?? d?.text ?? 'unknown');
  }
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

async function evalJs(expression) {
  // awaitPromise 必须开:否则传入 async 函数时拿到的是 Promise 而非结果,
  // 断言会静默地对 "undefined" 做判断 —— 假通过比失败更危险。
  const r = await cdp('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  if (r.result?.exceptionDetails) {
    throw new Error('JS error: ' + JSON.stringify(r.result.exceptionDetails));
  }
  return r.result?.result?.value;
}

let navSeq = 0;

/**
 * 导航并**强制真重载**。
 *
 * 注意:只改 hash 属于同文档导航,浏览器不会重新执行模块脚本 —— 那样
 * onMounted / bootstrapAuth 都不会重跑,「刷新后仍…」这类断言会**假通过**。
 * 因此每次都在 hash 前挂一个自增查询参数,确保是一次完整加载。
 */
async function goto(hash = '') {
  navSeq += 1;
  await cdp('Page.navigate', { url: `${APP}?nav=${navSeq}${hash}` });
  await sleep(1800);
}

/** 截图(仅 SHOTS=1 时),产物落在 gitignore 的 shots/ 下,用于人工核对视觉 */
if (SHOTS) mkdirSync(SHOT_DIR, { recursive: true });
async function shot(name) {
  if (!SHOTS) return;
  const r = await cdp('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(r.result.data, 'base64');
  writeFileSync(`${SHOT_DIR}/${name}.png`, buf);
  console.log(`  · 截图 shots/${name}.png (${(buf.length / 1024).toFixed(0)} KB)`);
}

/* ──────────────────────── 断言 ──────────────────────── */
let pass = 0;
let fail = 0;
function check(label, ok, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${label}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/** 报头一级栏目导航里的文字 */
const NAV = `[...document.querySelectorAll('header nav:first-of-type button')].map(b => b.textContent.trim())`;
/** 工具台正文里的栏目名 */
const GROUPS_ON_HOME = `[...document.querySelectorAll('main section h2')].map(h => h.textContent.trim())`;

await cdp('Page.enable');
await cdp('Runtime.enable');

/* ══════════ 1. 访客态:编辑部完全不可见 ══════════ */
console.log('\n== 1. 访客态(未解锁、未登录)==');
await goto();
const nav1 = await evalJs(NAV);
check('导航里没有「编辑部」', !nav1.includes('编辑部'), JSON.stringify(nav1));
const homeText = await evalJs(`document.body.innerText`);
check('工具台正文不含「编辑部」', !homeText.includes('编辑部'));
check('工具台正文不含「卡牌校勘」', !homeText.includes('卡牌校勘'));
check('周报期刊等原有栏目仍在', nav1.includes('周报期刊'), JSON.stringify(nav1));
await shot('editorial-00-home-visitor');

/* ══════════ 2. 深链拦截:未登录不能进后台 ══════════ */
console.log('\n== 2. 深链 #/editorial(未登录)==');
await goto('#/editorial');
const gateText = await evalJs(`document.body.innerText`);
check('显示门禁页「编务门禁」', gateText.includes('编务门禁'));
check('未泄漏工具清单(无「卡牌校勘」)', !gateText.includes('卡牌校勘'));
check('未泄漏工具清单(无「数据同步」)', !gateText.includes('数据同步'));
check(
  '存在邮箱 / 密码输入框',
  (await evalJs(`document.querySelectorAll('input[type="email"], input[type="password"]').length`)) >= 2
);
check('存在登入按钮', gateText.includes('登入编务'));
check('未配置提示未出现(说明 .env 已注入)', !gateText.includes('云端连接缺失'));
await shot('editorial-01-gate');

console.log('\n== 2b. 深链 #/editorial/cards(未登录)==');
await goto('#/editorial/cards');
const cardsText = await evalJs(`document.body.innerText`);
check('仍被门禁拦住', cardsText.includes('编务门禁'));
check('未渲染校勘台', !cardsText.includes('目标表'));

/* ══════════ 2c. 风格合规(宣纸档案:只用既有 tokens)══════════ */
console.log('\n== 2c. 风格合规(计算样式核对色板与字体)==');
await goto('#/editorial');
const css = await evalJs(`(() => {
  const g = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el) : null; };
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('登入编务'));
  const card = document.querySelector('.card');
  const eyebrow = document.querySelector('.eyebrow');
  const h1 = document.querySelector('h1');
  const input = document.querySelector('input[type="email"]');
  return {
    pageBg: getComputedStyle(document.body).backgroundColor,
    btnBg: btn ? getComputedStyle(btn).backgroundColor : null,
    btnRadius: btn ? getComputedStyle(btn).borderRadius : null,
    cardShadow: card ? getComputedStyle(card).boxShadow : null,
    eyebrowColor: eyebrow ? getComputedStyle(eyebrow).color : null,
    h1Font: h1 ? getComputedStyle(h1).fontFamily : null,
    inputRadius: (() => { const el = document.querySelector('input[type="password"]'); return el ? getComputedStyle(el).borderRadius : null; })(),
    svgCount: document.querySelectorAll('svg').length,
    // .hairline 本身就是规范认可的渐变分隔线,不计入「额外装饰」
    gradientCount: [...document.querySelectorAll('main *')].filter(e => !e.classList.contains('hairline') && /gradient/.test(getComputedStyle(e).backgroundImage)).length
  };
})()`);
check('页面底为宣纸白 #F4F1EA', css.pageBg === 'rgb(244, 241, 234)', String(css.pageBg));
check('主按钮为朱砂 #B23A27', css.btnBg === 'rgb(178, 58, 39)', String(css.btnBg));
check('眉题为朱砂', css.eyebrowColor === 'rgb(178, 58, 39)', String(css.eyebrowColor));
check('标题走衬线刊名族(Noto Serif SC)', /Noto Serif SC/.test(css.h1Font || ''), String(css.h1Font));
check('卡片无投影(风格规范禁投影)', css.cardShadow === 'none', String(css.cardShadow));
check('输入控件 8px 圆角(非聚焦态)', /8px/.test(css.inputRadius || ''), String(css.inputRadius));
check('除 hairline 外无渐变装饰', css.gradientCount === 0, `命中 ${css.gradientCount} 处`);
check('未引入图标(svg 数应为 0)', css.svgCount === 0, `svg ${css.svgCount} 个`);

/* ══════════ 3. 暗门:连点刊名 5 次 ══════════ */
console.log('\n== 3. 暗门(连点报头刊名 5 次)==');
await goto();
const brandSel = `[...document.querySelectorAll('header button')].find(b => b.querySelector('h1'))`;
const clicked = await evalJs(`(() => {
  const b = ${brandSel};
  if (!b) return 'no brand button';
  for (let i = 0; i < 5; i++) b.click();
  return 'clicked x5';
})()`);
check('找到刊名按钮并点击', clicked === 'clicked x5', clicked);
await sleep(900);
const hashAfter = await evalJs(`window.location.hash`);
check('跳转到 #/editorial', hashAfter === '#/editorial', hashAfter);
const nav2 = await evalJs(NAV);
check('导航出现「编辑部」', nav2.includes('编辑部'), JSON.stringify(nav2));
await shot('editorial-02-unlocked-nav');

/* ══════════ 4. 解锁持久化 ══════════ */
console.log('\n== 4. 解锁持久化(刷新)==');
await goto();
const nav3 = await evalJs(NAV);
check('刷新后「编辑部」仍在导航', nav3.includes('编辑部'), JSON.stringify(nav3));
const groups3 = await evalJs(GROUPS_ON_HOME);
check('工具台出现「编辑部」分区', groups3.includes('编辑部'), JSON.stringify(groups3));

/* ══════════ 5. 解锁 ≠ 授权 ══════════ */
console.log('\n== 5. 解锁只代表「看得见入口」,不代表有权限 ==');
await goto('#/editorial');
const afterUnlock = await evalJs(`document.body.innerText`);
check('仍显示门禁页', afterUnlock.includes('编务门禁'));
check('仍未泄漏工具清单', !afterUnlock.includes('卡牌校勘'));
check(
  '未持有会话令牌',
  (await evalJs(`localStorage.getItem('riftbound-editorial-session')`)) === null
);
check(
  '解锁标记已落盘',
  (await evalJs(`localStorage.getItem('riftbound-editorial-unlocked')`)) === '1'
);

/* ══════════ 6. 栏目条 ══════════ */
console.log('\n== 6. 编辑部栏目条(未通过门禁)==');
const sectionBar = await evalJs(
  `[...document.querySelectorAll('header nav')].slice(1).map(n => n.innerText.replace(/\\s+/g,' ').trim()).join(' | ')`
);
check('只留栏目首页,不列出 5 个工具', !sectionBar.includes('卡牌'), sectionBar || '(空)');
check('栏目首页「编辑部」在', sectionBar.includes('编辑部'), sectionBar || '(空)');

/* ══════════ 7. 认证端点连通性 ══════════ */
/* 没有管理员口令也能验证一半:错误口令必须得到**业务错误**而非网络/CORS 错误,
 * 这同时证明 GoTrue 端点可达、CORS 放行、错误映射生效。 */
console.log('\n== 7. GoTrue 端点连通性(故意用错口令)==');
const setInput = (sel, val) => `(() => {
  const el = document.querySelector('${sel}');
  if (!el) return 'no input';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, ${JSON.stringify(val)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return el.value;
})()`;
await evalJs(setInput('input[type="email"]', 'nobody@example.invalid'));
await evalJs(setInput('input[type="password"]', 'definitely-not-the-password'));
await sleep(200);
await evalJs(
  `[...document.querySelectorAll('button')].find(b => b.textContent.includes('登入编务'))?.click()`
);
await sleep(4000);
const loginErr = await evalJs(`document.body.innerText`);
const gotBusinessError =
  loginErr.includes('邮箱或密码不正确') ||
  loginErr.includes('不是管理员') ||
  /rate limit|too many/i.test(loginErr);
check(
  '得到业务级错误(证明端点可达 + CORS 放行),而非网络/CORS 失败',
  gotBusinessError,
  loginErr.includes('Failed to fetch') ? 'Failed to fetch = CORS/网络问题' : '错误文案未识别'
);
check('登录失败后仍未持有会话', (await evalJs(`localStorage.getItem('riftbound-editorial-session')`)) === null);
check('登录失败后仍被门禁拦住', loginErr.includes('编务门禁'));

/* ══════════ 8. 编辑部 5 条二级路由 ══════════ */
console.log('\n== 8. 编辑部 5 条二级路由(未登录一律撞门禁)==');
for (const sub of ['cards', 'batch', 'rules', 'resources', 'sync']) {
  await goto(`#/editorial/${sub}`);
  const t = await evalJs(`document.body.innerText`);
  check(`#/editorial/${sub} 被门禁拦住`, t.includes('编务门禁') && !t.includes('目标表'));
}

/* ══════════════════════════════════════════════════════════════
 * 9. P1 卡牌校勘(注入伪会话)
 *
 * 读走 anon key(公开 SELECT 策略),写必须带用户 JWT —— 利用这个不对称:
 *   · 伪会话足以让门禁放行 → 可以验证**真实渲染与真实取数**
 *   · 伪令牌是无效 JWT → 写操作必然被拒 → 正好验证「未授权写入不会假装成功」
 * ══════════════════════════════════════════════════════════════ */
console.log('\n== 9. P1 卡牌校勘(注入伪会话,读走 anon、写必被拒)==');
await goto();
const injected = await evalJs(`(() => {
  localStorage.setItem('riftbound-editorial-unlocked', '1');
  localStorage.setItem('riftbound-editorial-session', JSON.stringify({
    accessToken: 'not-a-real-jwt',
    refreshToken: 'not-a-real-refresh',
    expiresAt: Date.now() + 3600 * 1000,
    email: 'verify@local',
    role: 'admin'
  }));
  return 'ok';
})()`);
check('伪会话已注入', injected === 'ok');

await goto('#/editorial/cards');
await sleep(3500); // 等列表从真实库拉回来
const editorText = await evalJs(`document.body.innerText`);
check('门禁放行,渲染出「卡牌校勘」', editorText.includes('卡牌校勘'));
check('渲染出检索条', editorText.includes('全部系列') && editorText.includes('全部稀有度'));
check('渲染出主从两栏', editorText.includes('卡牌列表'));

const listInfo = await evalJs(`(() => {
  const rows = [...document.querySelectorAll('aside button')].filter(b => b.querySelector('.font-mono'));
  const pager = document.body.innerText.match(/共\\s*(\\d+)\\s*行/);
  return { count: rows.length, total: pager ? Number(pager[1]) : null, first: rows[0]?.innerText ?? '' };
})()`);
check('从真实库拉到了卡牌列表', listInfo.count > 0, JSON.stringify(listInfo));
check('服务端返回了总行数', listInfo.total !== null && listInfo.total > 100, `total=${listInfo.total}`);
check('首行为真实卡号', /[A-Z]{2,4}-\d/.test(listInfo.first), listInfo.first);

/* 选中第一张 → 详情表单与印刷子表 */
await evalJs(`(() => {
  const rows = [...document.querySelectorAll('aside button')].filter(b => b.querySelector('.font-mono'));
  rows[0]?.click();
})()`);
await sleep(2500);
const detail = await evalJs(`(() => {
  const inputs = [...document.querySelectorAll('section input')];
  const val = (ph) => inputs.find(i => i.placeholder && i.placeholder.includes(ph))?.value ?? null;
  return {
    text: document.body.innerText,
    cardNo: inputs[0]?.value ?? null,
    hasPrintTable: document.body.innerText.includes('印刷版本'),
    tagInputs: document.querySelectorAll('datalist').length,
    effectMarks: document.querySelectorAll('.effect-mark').length
  };
})()`);
check('详情表单已载入卡号', !!detail.cardNo && detail.cardNo.length > 0, String(detail.cardNo));
check('渲染出印刷版本子表', detail.hasPrintTable);
check('五个数组字段都是标签输入器', detail.tagInputs >= 5, `datalist ${detail.tagInputs} 个`);
check('效果文本 {{标记}} 渲染为高亮标签', detail.effectMarks > 0, `命中 ${detail.effectMarks} 个`);

/* 未授权写入:必须报错,绝不能假装成功 */
const before = detail.cardNo;
const writeResult = await evalJs(`(async () => {
  const inputs = [...document.querySelectorAll('section input')];
  const el = inputs[0];
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, 'ZZZ-SHOULD-NOT-PERSIST');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 400));

  const dirtyHint = document.body.innerText.match(/(\\d+) 个字段待保存/);
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '保存修改');
  const disabled = btn ? btn.disabled : null;
  if (btn && !btn.disabled) {
    btn.click();
    await new Promise(r => setTimeout(r, 6000));
  }
  return {
    found: !!btn,
    disabled,
    dirtyHint: dirtyHint ? dirtyHint[1] : null,
    inputValue: el.value,
    text: document.body.innerText
  };
})()`);
check(
  '未授权写入被拒绝并就地报错',
  /保存失败|权限|过期|未被写入/.test(writeResult.text),
  `button=${writeResult.found} disabled=${writeResult.disabled} 待保存字段=${writeResult.dirtyHint} val=${writeResult.inputValue}`
);
check('失败提示未谎称成功', !/已保存/.test(writeResult.text));

/* 复查库里那一行确实没被改动(证明拒绝是真的,而不是界面骗人) */
await goto('#/editorial/cards');
await sleep(3000);
const reread = await evalJs(`(() => {
  const rows = [...document.querySelectorAll('aside button')].filter(b => b.querySelector('.font-mono'));
  return rows.map(r => r.innerText).join(' | ');
})()`);
check('库中未出现被写入的脏值', !reread.includes('ZZZ-SHOULD-NOT-PERSIST'), '脏值出现在列表里');
check('原卡号仍在', reread.includes(before), `原卡号 ${before}`);

/* ══════════════════════════════════════════════════════════════
 * 10. P2 批量校勘
 * 会话已在第 9 节注入,且 goto 会真重载而 localStorage 持久 —— 直接进。
 * ══════════════════════════════════════════════════════════════ */
console.log('\n== 10. P2 批量校勘 ==');
await goto('#/editorial/batch');
await sleep(3500);

const batch = await evalJs(`(() => {
  const trs = [...document.querySelectorAll('tbody tr')].filter(tr => tr.querySelectorAll('td').length > 5);
  return {
    rows: trs.length,
    total: (document.body.innerText.match(/共\\s*(\\d+)\\s*行/) || [])[1] ?? null,
    header: document.body.innerText.includes('批量校勘'),
    editableCells: document.querySelectorAll('tbody td button').length
  };
})()`);
check('渲染出批量校勘表', batch.header && batch.rows > 0, JSON.stringify(batch));
check('服务端返回总行数', Number(batch.total) > 100, `total=${batch.total}`);
check('单元格可点击编辑', batch.editableCells > 10, `可点单元格 ${batch.editableCells}`);

/* 表头排序:点击「能量」后该列应呈非降序 */
const sortProbe = await evalJs(`(async () => {
  const th = [...document.querySelectorAll('thead button')].find(b => b.textContent.includes('能量'));
  if (!th) return { err: 'no sort header' };
  const read = () => [...document.querySelectorAll('tbody tr')]
    .filter(tr => tr.querySelectorAll('td').length > 5)
    .map(tr => { const t = tr.querySelectorAll('td')[4].innerText.trim(); return t === '—' ? null : Number(t); });
  th.click();
  await new Promise(r => setTimeout(r, 2500));
  const asc = read();
  th.click();
  await new Promise(r => setTimeout(r, 2500));
  const desc = read();
  const nonNull = a => a.filter(v => v !== null && !Number.isNaN(v));
  const sorted = a => { const v = nonNull(a); return v.every((x, i) => i === 0 || v[i-1] <= x); };
  const sortedDesc = a => { const v = nonNull(a); return v.every((x, i) => i === 0 || v[i-1] >= x); };
  return { asc, desc, ascOk: sorted(asc), descOk: sortedDesc(desc) };
})()`);
check('点表头升序生效', sortProbe.ascOk === true, JSON.stringify(sortProbe.asc?.slice(0, 6)));
check('再点一次转降序', sortProbe.descOk === true, JSON.stringify(sortProbe.desc?.slice(0, 6)));

/* 勾选 → 批量工具栏出现 */
const sel = await evalJs(`(async () => {
  const box = document.querySelector('tbody input[type="checkbox"]');
  if (!box) return { err: 'no checkbox' };
  box.click();
  await new Promise(r => setTimeout(r, 400));
  const t = document.body.innerText;
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '批量调整数值');
  return { selCount: (t.match(/已选\\s*(\\d+)\\s*行/) || [])[1] ?? null, hasOps: !!btn };
})()`);
check('勾选后显示已选行数', sel.selCount === '1', JSON.stringify(sel));
check('勾选后出现批量操作按钮', sel.hasOps === true, JSON.stringify(sel));

/* 打开批量调数值 → 出现差异预览(不弹模态框,是内联条) */
const panel = await evalJs(`(async () => {
  [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '批量调整数值')?.click();
  await new Promise(r => setTimeout(r, 500));
  const t = document.body.innerText;
  return {
    hasPreview: t.includes('变更差异预览'),
    hasGroup: /能量 → -?\\d+/.test(t),
    hasAffected: /影响\\s*1\\s*行/.test(t),
    hasPublish: t.includes('同时发布'),
    noDialog: document.querySelectorAll('[role="dialog"]').length === 0
  };
})()`);
check('批量配置是内联条而非模态框', panel.noDialog === true, JSON.stringify(panel));
check('给出差异预览', panel.hasPreview && panel.hasAffected, JSON.stringify(panel));
check('预览按目标值分组显示', panel.hasGroup === true, JSON.stringify(panel));
check('提供「同时发布」选项', panel.hasPublish === true);

/* 脏行标记 + 回退 */
const dirty = await evalJs(`(async () => {
  // 关掉批量面板,避免干扰
  [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '收起')?.click();
  await new Promise(r => setTimeout(r, 300));
  const cell = document.querySelector('tbody td button');
  cell.click();
  await new Promise(r => setTimeout(r, 300));
  const input = document.querySelector('tbody td input.filter-select');
  if (!input) return { err: 'cell did not become editable' };
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, 'ZZZ-P2-DIRTY');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 300));
  const dirtyRow = document.querySelector('tbody tr.dirty-row');
  const saveBtn = [...document.querySelectorAll('tbody button')].find(b => b.textContent.trim() === '保存');
  const revertBtn = [...document.querySelectorAll('tbody button')].find(b => b.textContent.trim() === '回退');
  const before = {
    dirty: !!dirtyRow,
    saveEnabled: saveBtn ? !saveBtn.disabled : null,
    revertEnabled: revertBtn ? !revertBtn.disabled : null
  };
  revertBtn?.click();
  await new Promise(r => setTimeout(r, 300));
  return { ...before, dirtyAfterRevert: !!document.querySelector('tbody tr.dirty-row') };
})()`);
check('改动后该行标记为脏行', dirty.dirty === true, JSON.stringify(dirty));
check('脏行的保存/回退按钮可用', dirty.saveEnabled === true && dirty.revertEnabled === true, JSON.stringify(dirty));
check('回退后脏行标记消失', dirty.dirtyAfterRevert === false, JSON.stringify(dirty));

/* 未授权批量写入必须被拒 */
const batchWrite = await evalJs(`(async () => {
  // 用表头全选:上一节已选中首行,若再点该行复选框会变成取消选择
  const all = document.querySelector('thead input[type="checkbox"]');
  if (!all) return { err: 'no select-all box' };
  if (!all.checked) all.click();
  await new Promise(r => setTimeout(r, 500));
  const selCount = (document.body.innerText.match(/已选\\s*(\\d+)\\s*行/) || [])[1] ?? null;
  const opBtn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '批量设禁限');
  if (!opBtn) return { err: 'no op button', selCount };
  opBtn.click();
  await new Promise(r => setTimeout(r, 600));
  const exec = [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith('执行'));
  if (!exec) return { err: 'no exec button', selCount };
  exec.click();
  await new Promise(r => setTimeout(r, 6000));
  return { selCount, text: document.body.innerText };
})()`);
check(
  '未授权批量写入被拒并就地报错',
  /未能写入|批量操作异常|权限|过期/.test(batchWrite.text || ''),
  JSON.stringify(batchWrite).slice(0, 200)
);
check('未谎称批量完成', !/批量操作完成/.test(batchWrite.text || ''));

/* ══════════════════════════════════════════════════════════════
 * 11. P3 规则校勘
 * ══════════════════════════════════════════════════════════════ */
console.log('\n== 11. P3 规则校勘 ==');
await goto('#/editorial/rules');
await sleep(6000); // 2381 条规则全量载入

const bookStep = await evalJs(`(() => {
  const cards = [...document.querySelectorAll('main button.card')];
  return {
    title: document.body.innerText.includes('选择规则书'),
    cards: cards.length,
    names: cards.map(c => c.innerText.replace(/\\s+/g, ' ').trim()).slice(0, 4),
    hasAll: document.body.innerText.includes('全部规则书')
  };
})()`);
check('先要求选择规则书', bookStep.title && bookStep.hasAll, JSON.stringify(bookStep));
check('列出真实规则书', bookStep.cards >= 2, JSON.stringify(bookStep.names));

/* 进「全部规则书」 */
await evalJs(`(() => {
  const b = [...document.querySelectorAll('main button.card')].find(x => x.innerText.includes('全部规则书'));
  b?.click();
})()`);
await sleep(2500);
const tree = await evalJs(`(() => {
  const rows = [...document.querySelectorAll('aside button')].filter(b => b.querySelector('.font-mono'));
  return {
    rows: rows.length,
    first: rows.slice(0, 3).map(r => r.innerText.replace(/\\s+/g, ' ').trim()),
    realNumbers: rows.filter(r => /^\\d/.test(r.innerText.trim())).length,
    guides: document.querySelectorAll('aside span.border-l').length
  };
})()`);
check('树渲染出真实规则节点', tree.rows > 5 && tree.realNumbers > 5, JSON.stringify(tree.first));
check('未展开时顶层无缩进导线(depth=0)', tree.guides === 0, `导线 ${tree.guides} 条`);

/* 展开全部 → 出现嵌套节点与缩进导线 */
const expandProbe = await evalJs(`(async () => {
  const count = () => [...document.querySelectorAll('aside button')].filter(b => b.querySelector('.font-mono')).length;
  const before = count();
  [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '展开全部')?.click();
  await new Promise(r => setTimeout(r, 1600));
  const afterExpand = count();
  const guides = document.querySelectorAll('aside span.border-l').length;
  const depths = new Set([...document.querySelectorAll('aside button')]
    .filter(b => b.querySelector('.font-mono'))
    .map(b => b.querySelectorAll('span.border-l').length));
  [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '收起全部')?.click();
  await new Promise(r => setTimeout(r, 900));
  const afterCollapse = count();
  return { before, afterExpand, afterCollapse, guides, depths: [...depths].sort((a, b) => a - b).slice(0, 6) };
})()`);
check('展开全部显示更多节点', expandProbe.afterExpand > expandProbe.before, JSON.stringify(expandProbe));
check('展开后绘制出缩进导线', expandProbe.guides > 0, `导线 ${expandProbe.guides} 条`);
check(
  '导线层数随节点层级递增',
  expandProbe.depths.length >= 3,
  `出现的层级 ${JSON.stringify(expandProbe.depths)}`
);
check('收起全部后节点减少', expandProbe.afterCollapse < expandProbe.afterExpand, JSON.stringify(expandProbe));

/* 中文子串检索:这是相对后台 FTS 的关键改进 */
const searchProbe = await evalJs(`(async () => {
  const input = document.querySelector('aside input.filter-select');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, '法术');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 900));
  const t = document.body.innerText;
  const total = (t.match(/共\\s*(\\d+)\\s*条,仅显示前 200 条/) || [])[1];
  const items = [...document.querySelectorAll('aside button')].filter(b => b.querySelector('.font-mono'));
  return { total: total ? Number(total) : items.length, items: items.length, sample: items[0]?.innerText.replace(/\\s+/g,' ').trim() ?? '' };
})()`);
check(
  '中文子串检索召回到位(实测后台 FTS 只有 11 条)',
  searchProbe.total > 200,
  `命中 ${searchProbe.total} 条,样本「${searchProbe.sample}」`
);

/* 点结果定位:退出检索态并选中 */
const locateProbe = await evalJs(`(async () => {
  const first = [...document.querySelectorAll('aside button')].find(b => b.querySelector('.font-mono'));
  first?.click();
  await new Promise(r => setTimeout(r, 900));
  const t = document.body.innerText;
  const input = document.querySelector('aside input.filter-select');
  return {
    searchCleared: input ? input.value === '' : null,
    selected: t.includes('条目字段'),
    hasParentField: t.includes('候选已排除自身及其全部后代,防止成环'),
    ruleNo: (t.match(/规则编号/) ? (document.querySelector('section input')?.value ?? '') : '')
  };
})()`);
check('点检索结果后退出检索态', locateProbe.searchCleared === true, JSON.stringify(locateProbe));
check('定位后右侧编辑器载入条目', locateProbe.selected === true, JSON.stringify(locateProbe));
check('父规则下拉声明了防环', locateProbe.hasParentField === true);
check('载入真实规则编号', /^[0-9]/.test(String(locateProbe.ruleNo)), String(locateProbe.ruleNo));

/* 叶子判定与新增子规则预填 */
const childProbe = await evalJs(`(async () => {
  const t0 = document.body.innerText;
  const leafHint = /叶子节点,可删除/.test(t0);
  const branchHint = /含子节点,不可删除/.test(t0);
  [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '新增子规则')?.click();
  await new Promise(r => setTimeout(r, 700));
  const t1 = document.body.innerText;
  const sel = [...document.querySelectorAll('section select')][0];
  return {
    leafHint, branchHint,
    newBadge: t1.includes('未保存'),
    parentPrefilled: sel ? sel.value : null,
    deleteDisabled: [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '删除节点')?.disabled ?? null
  };
})()`);
check('明确标注是否可删', childProbe.leafHint || childProbe.branchHint, JSON.stringify(childProbe));
check('新增子规则进入未保存态', childProbe.newBadge === true, JSON.stringify(childProbe));
check('新增时预填父规则', !!childProbe.parentPrefilled, `父=${childProbe.parentPrefilled}`);
check('未保存的新增条目不可删除', childProbe.deleteDisabled === true, JSON.stringify(childProbe));

/* 未授权保存必须被拒 */
const ruleWrite = await evalJs(`(async () => {
  const inputs = [...document.querySelectorAll('section input')];
  const numInput = inputs.find(i => !i.type || i.type === 'text');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(numInput, 'ZZZ-P3-RULE');
  numInput.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 400));
  [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '保存修改')?.click();
  await new Promise(r => setTimeout(r, 6000));
  const t = document.body.innerText;
  return { text: t, saved: /已新增|已保存/.test(t) };
})()`);
check(
  '未授权保存被拒并就地报错',
  /保存失败|权限|未被写入|过期/.test(ruleWrite.text),
  JSON.stringify(ruleWrite.text.slice(0, 160))
);
check('未谎称规则已保存', ruleWrite.saved === false);

/* ══════════════════════════════════════════════════════════════
 * 12. P4 资源与发布
 * ══════════════════════════════════════════════════════════════ */
console.log('\n== 12. P4 资源与发布 ==');
await goto('#/editorial/resources');
await sleep(5000);

const res = await evalJs(`(() => {
  const t = document.body.innerText;
  const tabs = [...document.querySelectorAll('main button')]
    .map(b => b.textContent.trim())
    .filter(x => ['系列管理', '图标库', '版本发布'].includes(x));
  const rows = [...document.querySelectorAll('tbody tr')].filter(tr => tr.querySelectorAll('td').length > 5);
  return {
    header: t.includes('资源与发布'),
    tabs,
    seriesRows: rows.length,
    codes: rows.map(tr => tr.querySelector('td')?.innerText.trim()).filter(Boolean),
    usage: rows.map(tr => tr.querySelectorAll('td')[6]?.innerText.trim()).filter(Boolean),
    covers: document.querySelectorAll('tbody img').length
  };
})()`);
check('渲染出资源与发布页', res.header === true);
check('三个页签齐全', res.tabs.length === 3, JSON.stringify(res.tabs));
check('系列表载入真实数据', res.seriesRows >= 5, `${res.seriesRows} 行:${JSON.stringify(res.codes)}`);
check('系列代码是真实的(FND/OGN 等)', res.codes.some((c) => /^(FND|OGN|ARC|OGS|SFD|UNL|VEN)$/.test(c)), JSON.stringify(res.codes));
check('引用卡牌数已统计(删除前提示的依据)', res.usage.some((u) => /^\d+$/.test(u) && Number(u) > 0), JSON.stringify(res.usage));

/* 图标库页签 */
const iconTab = await evalJs(`(async () => {
  [...document.querySelectorAll('main button')].find(b => b.textContent.trim() === '图标库')?.click();
  await new Promise(r => setTimeout(r, 4500));
  const imgs = [...document.querySelectorAll('main img')];
  const t = document.body.innerText;
  const count = (t.match(/图标库（(\\d+)）/) || [])[1];
  return {
    count: count ? Number(count) : null,
    imgs: imgs.length,
    withSrc: imgs.filter(i => i.getAttribute('src')).length,
    lazy: imgs.filter(i => i.getAttribute('loading') === 'lazy').length,
    loadedImgs: imgs.filter(i => i.src && i.naturalWidth > 0).length,
    hasWhiteBadge: t.includes('白描'),
    hasStorage: t.includes('online') || t.includes('local')
  };
})()`);
check('图标库载入真实数据', (iconTab.count ?? 0) > 50, `icons=${iconTab.count}`);
check('每个图标都有 src', iconTab.withSrc === iconTab.imgs && iconTab.imgs > 50, JSON.stringify(iconTab));
check(
  '图标图片启用懒加载(100+ 张外链,不能全部立即拉取)',
  iconTab.lazy === iconTab.imgs,
  `lazy ${iconTab.lazy}/${iconTab.imgs}`
);
check(
  '可见区域的图标已真正加载出来',
  iconTab.loadedImgs >= 5,
  `已加载 ${iconTab.loadedImgs}/${iconTab.imgs}`
);
check('显示存储类型与白描标记', iconTab.hasStorage && iconTab.hasWhiteBadge, JSON.stringify(iconTab));

/* 版本发布页签 */
const verTab = await evalJs(`(async () => {
  [...document.querySelectorAll('main button')].find(b => b.textContent.trim() === '版本发布')?.click();
  await new Promise(r => setTimeout(r, 1500));
  const t = document.body.innerText;
  const rows = [...document.querySelectorAll('tbody tr')].filter(tr => tr.querySelectorAll('td').length === 3);
  return {
    rows: rows.length,
    body: rows.map(r => r.innerText.replace(/\\s+/g, ' ').trim()),
    hasAll: t.includes('发布全部'),
    allFive: ['cards', 'prints', 'icons', 'rules', 'series'].every(k => t.includes(k))
  };
})()`);
check('版本表列出全部分类', verTab.allFive && verTab.rows >= 5, JSON.stringify(verTab.body.slice(0, 5)));
check('提供「发布全部」', verTab.hasAll === true);

/* 未授权触碰必须被拒 */
const touchProbe = await evalJs(`(async () => {
  const btn = [...document.querySelectorAll('tbody button')].find(b => b.textContent.trim() === '触碰发布');
  if (!btn) return { err: 'no touch button' };
  btn.click();
  await new Promise(r => setTimeout(r, 6000));
  const t = document.body.innerText;
  return { failed: /发布失败|权限|未被写入|过期/.test(t), lied: /已发布「/.test(t) };
})()`);
check('未授权发布被拒并就地报错', touchProbe.failed === true, JSON.stringify(touchProbe));
check('未谎称发布成功', touchProbe.lied === false);

/* 未授权新增系列必须被拒 */
const seriesWrite = await evalJs(`(async () => {
  // 上一节停在「版本发布」页签,而新增系列按钮只存在于系列页签 —— 先切回去
  [...document.querySelectorAll('main button')].find(b => b.textContent.trim() === '系列管理')?.click();
  await new Promise(r => setTimeout(r, 1200));
  const add = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '新增系列');
  if (!add) return { err: 'no add button' };
  add.click();
  await new Promise(r => setTimeout(r, 600));
  const codeInput = [...document.querySelectorAll('main input')].find(i => i.placeholder === '如 FND');
  if (!codeInput) return { err: 'no code input' };
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(codeInput, 'ZZZ');
  codeInput.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 400));
  [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '保存')?.click();
  await new Promise(r => setTimeout(r, 6000));
  const t = document.body.innerText;
  return { failed: /保存失败|权限|未被写入|过期/.test(t), lied: /已新增/.test(t) };
})()`);
check('未授权新增系列被拒并就地报错', seriesWrite.failed === true, JSON.stringify(seriesWrite));
check('未谎称系列已新增', seriesWrite.lied === false);

/* 非法系列代码应在本地就被拦下(不打网络) */
const localGuard = await evalJs(`(async () => {
  const codeInput = [...document.querySelectorAll('main input')].find(i => i.placeholder === '如 FND');
  if (!codeInput) return { err: 'no code input' };
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(codeInput, 'bad code!');
  codeInput.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 300));
  [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '保存')?.click();
  await new Promise(r => setTimeout(r, 1200));
  return { warned: /系列代码只允许字母数字与连字符/.test(document.body.innerText) };
})()`);
check('非法系列代码在本地被拦下', localGuard.warned === true, JSON.stringify(localGuard));

/* ══════════════════════════════════════════════════════════════
 * 13. P5 数据同步 + P5b 快照闭环
 *
 * 刻意**不触发外部接口拉取**(那会向上游打上百次请求),
 * 改为验证:界面装配、禁限字段不参与同步、以及点一次「导出快照」
 * 把 loadSnapshotRows → 生成 CSV → 自检 这条闭环对真实库跑通。
 * ══════════════════════════════════════════════════════════════ */
console.log('\n== 13. P5 数据同步 + P5b 快照闭环 ==');
await goto('#/editorial/sync');
await sleep(6000);

const syncView = await evalJs(`(() => {
  const t = document.body.innerText;
  const boxes = [...document.querySelectorAll('input[type="checkbox"]')];
  const banBox = boxes.find(b => b.closest('label')?.innerText.includes('is_banned'));
  return {
    header: t.includes('数据同步'),
    source: t.includes('公开只读接口') || t.includes('lol-api.playloltcg.com'),
    modes: t.includes('快速模式') && t.includes('深度模式'),
    hasFetchBtn: [...document.querySelectorAll('button')].some(b => b.textContent.trim() === '开始拉取'),
    banExists: !!banBox,
    banChecked: banBox ? banBox.checked : null,
    snapshotSection: t.includes('导出站点卡表快照'),
    paths: t.includes('public/data/cards_base_rows.csv') && t.includes('public/data/card_prints_rows.csv')
  };
})()`);
check('渲染出数据同步页', syncView.header && syncView.source, JSON.stringify(syncView));
check('提供 fast / deep 两种模式', syncView.modes === true);
check('提供拉取入口', syncView.hasFetchBtn === true, JSON.stringify(syncView));
check(
  '同步不提供 is_banned 覆盖入口（仅允许基础卡勘误）',
  syncView.banExists === false,
  `存在=${syncView.banExists} 已勾选=${syncView.banChecked}`
);
check('快照闭环区块存在并给出落盘路径', syncView.snapshotSection && syncView.paths, JSON.stringify(syncView));

/* 导出快照:真实读取全库 → 生成 → 自检 */
const snap = await evalJs(`(async () => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '导出快照');
  if (!btn) return { err: 'no snapshot button' };
  btn.click();
  await new Promise(r => setTimeout(r, 25000));
  const t = document.body.innerText;
  return {
    text: t,
    passed: /自检通过/.test(t),
    failed: /自检未通过/.test(t),
    // 不用正则:这段表达式整体位于模板字符串内,反斜杠会被外层先吃一遍
    counts: (() => {
      const seg = (t.split('自检通过')[1] || '').slice(0, 80);
      const digits = seg.split('').filter((ch) => (ch >= '0' && ch <= '9') || ch === '/').join('');
      return digits.split('/').filter(Boolean).slice(0, 2);
    })(),
    lied: /快照导出失败/.test(t),
    probe: (() => { const i = t.indexOf('自检'); return i < 0 ? '(未出现自检字样)' : JSON.stringify(t.slice(i, i + 90)); })()
  };
})()`);
check('快照导出对真实库跑通', snap.passed === true || snap.failed === true, JSON.stringify(snap).slice(0, 240));
check('快照自检通过(格式与站点文件一致)', snap.passed === true, `counts=${JSON.stringify(snap.counts)} probe=${snap.probe}`);
check(
  '快照覆盖了全量卡表(近千张卡 / 两千余印刷版本)',
  Number(snap.counts?.[0]) > 500 && Number(snap.counts?.[1]) > 1000,
  `counts=${JSON.stringify(snap.counts)} probe=${snap.probe}`
);

/* ══════════ 14. 既有视图回归 ══════════ */
console.log('\n== 14. 既有视图回归 ==');
/*
 * mode='full'  → 未载入数据包时也应有引导态(main 有内容)
 * mode='shell' → 这三个视图的模板整体挂在 v-if="store.result" 上,
 *                无数据包时 main 为空 —— 这是**既有缺口**(与 style-spec §5.6
 *                「空态绝不整页空白」相悖),非本次改动引入,故只验外壳不崩。
 */
const routes = [
  ['#/', '工具台', 'full'],
  ['#/journal', '期刊', 'full'],
  ['#/overview', '总览', 'full'],
  ['#/cards', '单卡', 'full'],
  ['#/import', '数据管理', 'full'],
  ['#/legendary', '传奇', 'shell'],
  ['#/region', '地域', 'shell'],
  ['#/decks', '卡组', 'shell']
];
for (const [hash, label, mode] of routes) {
  await goto(hash);
  const shellOk = await evalJs(
    `!!document.querySelector('header') && !!document.querySelector('footer')`
  );
  if (mode === 'full') {
    const len = await evalJs(`document.querySelector('main')?.innerText.trim().length ?? 0`);
    check(`${hash} 渲染出内容(${label})`, len > 30, `main 文本长度 ${len}`);
  } else {
    check(`${hash} 外壳正常·空态为既有缺口(${label})`, shellOk, 'header/footer 缺失');
  }
}

/* ══════════ 15. 无异常 ══════════ */
console.log('\n== 15. 未捕获异常 ==');
check('全程无 JS 异常', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

console.log(`\n──────── 结果:${pass} 通过 / ${fail} 失败 ────────`);
ws.close();
chrome.kill();
process.exit(fail === 0 ? 0 : 1);
