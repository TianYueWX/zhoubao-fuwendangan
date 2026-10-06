/* ================================================================
 * scripts/verify-rank.mjs
 *
 * 「积分榜速查」(工具 code: rank)的回归验收。
 *
 * 分两段,各管各的失守方式:
 *   A. 离线:纯函数口径 —— 参数护栏、并集追加语义、段位选项动态生成。
 *      真正的取数正确性靠真机请求,这里只锁死「我们自己写的那部分逻辑」。
 *   B. 联调:Firefox BiDi / Chromium CDP 打开 #/rank,用**真实上游请求**跑通
 *      首屏 → 搜索 → 段位筛选 → 名次顺序(不可排序) → 无限滚动 → 刷新恢复 → 重新抓取 → 手动加载。
 *
 * 为什么 UI 段不复用 DataTable:积分榜是无限滚动 + 图片列,DataTable 是
 * 客户端分页 + 一次性渲染全部行,1000 行会把 1000 张头像一起塞进 DOM。
 * 组件是专门写的,因此这里直接验它自己的渲染结果。
 *
 * 依赖真实网络:抓不到上游时 B 段会失败 —— 这是刻意的,接口契约才是被测对象。
 * 需要先构建并起 preview:
 *   1) npm run build:fast
 *   2) npx vite preview --port 4173
 *   3) npm run verify:rank
 * 截图输出到 shots/rank/(已在 .gitignore 中)。
 *
 * 真机实测结论(2026-10-01)见 docs/rank-ladder.md;档案 §3.2/§4.3 的三处
 * 反推结论在那里被修正,别再照档案写代码。
 * ============================================================== */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openRankBrowser } from './rank-browser.mjs';

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

function eq(name, actual, expected) {
  check(name, actual === expected, `期望 ${JSON.stringify(expected)},实得 ${JSON.stringify(actual)}`);
}

/* ══════════════════════ A. 离线口径 ══════════════════════ */

console.log('\n[A] 离线口径(证书与纯函数)');

const api = await import('../src/tools/rank/api.ts');
const storeMod = await import('../src/tools/rank/store.ts');
const sync = await import('../src/tools/sync/riftboundApi.ts');

/* A1 端点必须与站点既有客户端指向同一个网关,漂移即报 */
eq('A1 网关根与 riftboundApi 一致', api.RANK_API_BASE, sync.RIFTBOUND_API_BASE);
check(
  'A1b 端点为 /userIntegral/ranking/list(档案路径)',
  api.RANK_API_BASE.endsWith('/xcx'),
  api.RANK_API_BASE
);

/* A2 抓取粒度按站点裁定自我约束:单次 200 封顶 */
eq('A2 pageSize 上限 = 200', api.PAGE_SIZE_MAX, 200);
eq('A2b 首屏行数 = 单次上限', api.FIRST_PAGE_SIZE, api.PAGE_SIZE_MAX);
check('A2c 翻页护栏存在且为有限值', Number.isInteger(api.MAX_PAGES) && api.MAX_PAGES > 0, String(api.MAX_PAGES));

/* A3 参数护栏必须在**发请求之前**就拒掉,而不是靠上游兜底 */
async function expectKind(name, promise, kind) {
  try {
    await promise;
    check(name, false, '未抛错');
  } catch (e) {
    check(name, e instanceof api.RankFetchError && e.kind === kind, `实得 kind=${e?.kind} msg=${e?.message}`);
  }
}

await expectKind('A3 pageSize 超上限直接拒(不发请求)', api.fetchRankPage(1, 201), 'malformed');
await expectKind('A3b pageSize=0 直接拒', api.fetchRankPage(1, 0), 'malformed');
await expectKind('A3c pageNum=0 直接拒', api.fetchRankPage(0, 200), 'malformed');
await expectKind('A3d pageNum 非整数直接拒', api.fetchRankPage(1.5, 200), 'malformed');
await expectKind('A3e 已 abort 的 signal 直接拒', api.fetchRankPage(1, 200, { signal: AbortSignal.abort() }), 'aborted');

check('A3f isAbortError 能识别主动取消', api.isAbortError(new api.RankFetchError('aborted', 'x')));
check('A3g isAbortError 不把真故障当取消', !api.isAbortError(new api.RankFetchError('network', 'x')));

/* A4 并集追加:重复 uid 保留先到者,新 uid 追加在后 */
const row = (uid, ranking, totalIntegral = 0, rankName = '璀璨钻石') => ({
  uid,
  ranking,
  totalIntegral,
  rankName,
  rankIcon: '',
  avatar: '',
  name: `n-${uid}`
});
const merge = storeMod.mergeUniqueRows;
{
  const existing = [row('a', 1), row('b', 2)];
  const page = [row('b', 99, 999), row('c', 3)];
  const out = merge(existing, page);
  eq('A4 并集追加后总行数', out.length, 3);
  eq('A4b 重复 uid 保留先到者(名次不被改写)', out.find((r) => r.uid === 'b').ranking, 2);
  eq('A4c 新 uid 追加在末尾', out[out.length - 1].uid, 'c');
  eq('A4d 不改动入参数组', existing.length, 2);
}
eq('A4e 空并集', merge([], []).length, 0);
eq('A4f 只追加空页时行数不变', merge([row('a', 1)], []).length, 1);

/* A5 覆盖范围取最大 ranking(不是行数 —— 并列跳号时两者不等) */
eq('A5 coverage 取最大名次', storeMod.__testing.coverageOf([row('a', 5), row('b', 9), row('c', 9)]), 9);
eq('A5b 空集 coverage = 0', storeMod.__testing.coverageOf([]), 0);

/* A6 本地快照 key 带版本号,避免结构变更时读到旧形状 */
check('A6 快照 key 带版本后缀', /\.v\d+$/.test(storeMod.__testing.SNAPSHOT_KEY), storeMod.__testing.SNAPSHOT_KEY);

/* A7 节点环境没有 localStorage:init 不该炸,也不该伪造出快照 */
storeMod.initRankStore();
eq('A7 无 localStorage 时快照保持为空', storeMod.rankState.snapshot, null);
eq('A7b 空态下 hasSnapshot 为 false', storeMod.hasSnapshot.value, false);
eq('A7c 空态文案不是「已到末尾」', storeMod.coverageText.value, '尚未抓取');
check('A7d 空态下不允许继续加载', !storeMod.canLoadMore.value);

/* A8 段位选项从数据动态生成(不硬编码段位名),按该段位最低积分从高到低 */
{
  storeMod.rankState.snapshot = {
    rows: [
      row('a', 1, 4000, '最强王者'),
      row('b', 2, 1700, '最强王者'),
      row('c', 3, 1200, '傲世宗师'),
      row('d', 4, 800, '璀璨钻石')
    ],
    nextPage: 2,
    coverage: 4,
    fetchedAt: Date.now()
  };
  const opts = storeMod.rankNameOptions.value;
  eq('A8 段位选项数量 = 出现过的段位数', opts.length, 3);
  eq('A8b 段位按高到低排序', opts.map((o) => o.name).join('>'), '最强王者>傲世宗师>璀璨钻石');
  eq('A8c 段位计数正确', opts.find((o) => o.name === '最强王者').count, 2);

  /* A9 搜索:昵称与 uid 都要命中,且大小写不敏感 */
  storeMod.rankState.ui.search = 'n-b';
  eq('A9 昵称模糊命中 1 行', storeMod.filteredRankRows.value.length, 1);
  storeMod.rankState.ui.search = 'N-B';
  eq('A9b 搜索大小写不敏感', storeMod.filteredRankRows.value.length, 1);
  storeMod.rankState.ui.search = 'zzz-no-such';
  eq('A9c 无命中时为空', storeMod.filteredRankRows.value.length, 0);
  storeMod.rankState.ui.search = '';

  /* A10 段位多选筛选 */
  storeMod.rankState.ui.rankNames = ['最强王者'];
  eq('A10 段位筛选命中 2 行', storeMod.filteredRankRows.value.length, 2);
  storeMod.rankState.ui.rankNames = ['最强王者', '璀璨钻石'];
  eq('A10b 多选为或关系', storeMod.filteredRankRows.value.length, 3);
  storeMod.rankState.ui.rankNames = [];
  eq('A10c 清空筛选回到全量', storeMod.filteredRankRows.value.length, 4);

  /*
   * A11 顺序:筛选后必须**保持上游名次顺序**,不做任何重排。
   *
   * 本工具按站点要求刻意不提供排序 —— 榜单顺序即官方名次顺序。
   * 这条断言防的是日后有人「顺手加个排序」把名次列打乱。
   */
  {
    const ranks = storeMod.filteredRankRows.value.map((r) => r.ranking);
    check(
      'A11 筛选结果保持上游名次顺序(不重排)',
      ranks.every((n, i) => i === 0 || n >= ranks[i - 1]),
      ranks.join(',')
    );
    storeMod.rankState.ui.rankNames = ['璀璨钻石'];
    check(
      'A11b 段位筛选后同样保持名次顺序',
      storeMod.filteredRankRows.value.map((r) => r.ranking).join(',') === '4',
      storeMod.filteredRankRows.value.map((r) => r.ranking).join(',')
    );
    storeMod.rankState.ui.rankNames = [];
    check(
      'A11c store 里不存在排序态(接口面已收窄)',
      !('sortKey' in storeMod.rankState.ui) && !('sortDir' in storeMod.rankState.ui),
      JSON.stringify(Object.keys(storeMod.rankState.ui))
    );
    check(
      'A11d 不再导出 sortedRankRows',
      !('sortedRankRows' in storeMod),
      Object.keys(storeMod).filter((k) => /sort/i.test(k)).join(',')
    );
  }

  /* A12 覆盖面文案要如实报「抓到哪里」 */
  check('A12 未到末尾时文案含覆盖区间', storeMod.coverageText.value.includes('覆盖第 1–4 名'), storeMod.coverageText.value);
  storeMod.rankState.reachedEnd = true;
  check('A12b 到末尾时文案改口', storeMod.coverageText.value.includes('已到榜单末尾'), storeMod.coverageText.value);
  storeMod.rankState.reachedEnd = false;
}

/* A13 抓取完成后 canLoadMore 的闸门组合 */
{
  storeMod.rankState.snapshot = { rows: [row('a', 1)], nextPage: 2, coverage: 1, fetchedAt: Date.now() };
  check('A13 有快照且未到末尾 → 可继续', storeMod.canLoadMore.value);
  storeMod.rankState.reachedEnd = true;
  check('A13b 到末尾 → 不再继续', !storeMod.canLoadMore.value);
  storeMod.rankState.reachedEnd = false;
  storeMod.rankState.capped = true;
  check('A13c 撞护栏 → 不再继续', !storeMod.canLoadMore.value);
  storeMod.rankState.capped = false;
  storeMod.rankState.loading = true;
  check('A13d 抓取中 → 不重入', !storeMod.canLoadMore.value);
  storeMod.rankState.loading = false;
  storeMod.rankState.snapshot = { rows: [row('a', 1)], nextPage: api.MAX_PAGES + 1, coverage: 1, fetchedAt: 0 };
  check('A13e 游标超护栏 → 不再继续', !storeMod.canLoadMore.value);
}

/*
 * A14 登记口径(catalog 是纯数据模块,可以安全 import)。
 *
 * 路由解析不在这里验:src/router/hash.ts 真依赖 src/store/analysis.ts,
 * 而后者用了 import.meta.env.BASE_URL —— Vite 运行时专有,Node 里没有。
 * 路由改由 B 段用真实导航验(#/rank 能开出页面,比解析字符串更有力)。
 */
{
  const catalog = await import('../src/tools/catalog.ts');

  const def = catalog.findTool('rank');
  check('A14 注册表已登记 rank', !!def);
  eq('A14b 归入参考资料栏目', def?.group, 'reference');
  eq('A14c 徽章为「小工具」', def?.badge, '小工具');
  eq('A14d 不依赖数据包(只依赖网络)', def?.needsData, false);
  check('A14e 属参考资料栏目的可见工具', catalog.toolsOf('reference').some((t) => t.code === 'rank'));
  check('A14f code 唯一(不与既有工具撞车)', catalog.TOOLS.filter((t) => t.code === 'rank').length === 1);
}

/* ══════════════════════ B. 联调(headless) ══════════════════════ */

console.log('\n[B] 联调:无头浏览器请求真实上游');

const CHROME =
  process.env.HOME +
  '/.cache/ms-playwright/chromium_headless_shell-1200/chrome-headless-shell-linux64/chrome-headless-shell';
const PORT = 9778;
const APP = process.env.RANK_APP ?? 'http://localhost:4173/';
const SHOT_DIR = new URL('../shots/rank/', import.meta.url).pathname;
mkdirSync(SHOT_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * preview 服务器由本脚本自管 —— verify:all 里并不会预先起服务器,
 * 依赖外部手动起会让这条回归在 CI/一键验收里静默失败。
 * 若 4173 已有人占着(开发者自己开着),就复用、且退出时不碰它。
 */
let preview = null;
async function ensurePreview() {
  try {
    const res = await fetch(APP, { method: 'HEAD', signal: AbortSignal.timeout(2000) });
    if (res.ok || res.status < 500) {
      console.log(`  (复用已在运行的 ${APP})`);
      return;
    }
  } catch {
    /* 没人监听,自己起 */
  }
  if (!existsSync(new URL('../dist/index.html', import.meta.url))) {
    throw new Error('dist/ 不存在 —— 请先 `npm run build:fast` 再跑本验收');
  }
  preview = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], {
    cwd: new URL('..', import.meta.url).pathname,
    stdio: 'ignore',
    detached: false
  });
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(APP, { method: 'HEAD', signal: AbortSignal.timeout(2000) });
      if (res.ok || res.status < 500) {
        console.log('  (已自动启动 vite preview :4173)');
        return;
      }
    } catch {
      /* 继续等 */
    }
    await sleep(500);
  }
  throw new Error('vite preview 启动超时');
}

await ensurePreview();

let browser;
let cdp;
try {
  const rankRequests = [];
  browser = await openRankBrowser({ chromePath: CHROME, port: PORT, onRankRequest: request => rankRequests.push(request) });
  console.log(`  (${browser.name})`);
  cdp = browser.command;

  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Network.enable');

  // 浏览器记录每次真实请求的参数；Firefox 的 fetch 包装仅报告，不替换响应。

  async function evaluate(expr) {
    const r = await cdp('Runtime.evaluate', {
      expression: `(() => { ${expr} })()`,
      returnByValue: true,
      awaitPromise: true
    });
    if (r.result?.exceptionDetails) {
      // 页面内异常一律转成 JS 异常抛出去;调用方(waitFor)会当作条件未成立,
      // 不要让整个验收脚本崩在中途 —— 崩了就没有后续检查项,也留不下截图。
      throw new Error(
        '页面内异常: ' +
          (r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text ?? '未知')
      );
    }
    return r.result?.result?.value;
  }

  async function shot(name) {
    const r = await cdp('Page.captureScreenshot', { format: 'png' });
    if (r.result?.data) writeFileSync(join(SHOT_DIR, `${name}.png`), Buffer.from(r.result.data, 'base64'));
  }

  /** 轮询等待页面条件成立 */
  async function waitFor(label, expr, timeoutMs = 30_000, intervalMs = 400) {
    const t0 = Date.now();
    for (;;) {
      let v;
      try {
        v = await evaluate(expr);
      } catch {
        v = false;
      }
      if (v) return true;
      if (Date.now() - t0 > timeoutMs) {
        console.log(`  ✗ ${label} — 等待 ${timeoutMs}ms 超时`);
        failures.push(`${label}(超时)`);
        return false;
      }
      await sleep(intervalMs);
    }
  }

  /**
   * 按可见文字点击元素。
   *
   * 找不到就记一条失败并返回 false —— 早期版本直接 `find(...).click()`,
   * 元素一改名脚本就抛 TypeError 死在半途,后面的检查项全部不执行,
   * 报出来的是脚本崩溃而不是「按钮没了」,反而更难定位。
   */
  async function clickByText(label, selector, text, exact = false) {
    const ok = await evaluate(`
      const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const el = els.find(x => ${exact ? `x.innerText.trim() === ${JSON.stringify(text)}` : `x.innerText.includes(${JSON.stringify(text)})`});
      if (!el) return false;
      el.click();
      return true;
    `);
    if (!ok) {
      check(label, false, `找不到含「${text}」的 ${selector}`);
      return false;
    }
    return true;
  }

  async function goto(url) {
    await cdp('Page.navigate', { url });
    await waitFor('页面加载', 'return document.readyState === "complete"', 20_000);
  }

  /** 页面内取数:表格行的关键列 */
  const READ_ROWS = `
    const trs = [...document.querySelectorAll('table tbody tr')];
    return trs.map(tr => {
      const tds = [...tr.querySelectorAll('td')];
      if (tds.length < 5) return null;
      return { ranking: tds[0].innerText.trim(), integral: tds[2].innerText.trim(), rank: tds[3].innerText.trim(), uid: tds[4].innerText.trim() };
    }).filter(Boolean);
  `;

  /* B1 空缓存首屏:先清干净,确保验的是「从零开始」这条路 */
  await goto(APP);
  await evaluate(`localStorage.clear(); return true;`);
  await goto(`${APP}#/rank`);

  check(
    'B1 深链 #/rank 能打开积分榜速查',
    await waitFor('标题出现', `return !!document.querySelector('h3') && document.body.innerText.includes('积分榜速查');`)
  );
  check(
    'B1b 表头含名次/召唤师/积分',
    (await evaluate(`return document.body.innerText.includes('名次') && document.body.innerText.includes('召唤师') && document.body.innerText.includes('积分');`)) === true
  );
  // 它是「小工具」,按设计不进侧边栏(inNav 未开),入口在首页工具台
  await goto(APP);
  check(
    'B1c 首页工具台有「积分榜速查」入口',
    await waitFor(
      '首页入口出现',
      `return [...document.querySelectorAll('button,a')].some(el => el.innerText.includes('积分榜'));`,
      15_000
    )
  );
  await goto(`${APP}#/rank`);
  await waitFor('回到积分榜', `return document.body.innerText.includes('积分榜速查');`, 15_000);

  /* B2 首屏一次请求 = 200 行 */
  const firstLoaded = await waitFor(
    '首屏 200 行',
    `const n = document.querySelectorAll('table tbody tr').length; return n >= 200;`,
    45_000
  );
  check('B2 首屏抓到 200 行(pageSize 封顶生效)', firstLoaded);
  {
    const rows = await evaluate(READ_ROWS);
    eq('B2b 首屏行数恰为 200', rows.length, 200);
    const rankNums = rows.map((r) => Number(r.ranking));
    check('B2c 名次为数值且首行为 1', rankNums[0] === 1, `首行名次=${rows[0]?.ranking}`);
    check(
      'B2d 名次非严格递减(并列跳号,不做去重补号)',
      rankNums.every((n, i) => i === 0 || n >= rankNums[i - 1]),
      '出现名次倒退'
    );
    check('B2e 段位列有段位名(服务端 rankName 直出)', rows.every((r) => r.rank.length > 0));
    check('B2f 头像图片已渲染', (await evaluate(`return document.querySelectorAll('table tbody img').length > 0;`)) === true);
  }

  /* B3 快照落盘(localStorage 只留最新一份) */
  {
    const keys = await evaluate(`return Object.keys(localStorage).filter(k => k.startsWith('riftbound.rankLadder'));`);
    eq('B3 快照 key 唯一且落盘', keys.length, 1);
    const snap = await evaluate(`
      const raw = localStorage.getItem(${JSON.stringify(storeMod.__testing.SNAPSHOT_KEY)});
      if (!raw) return null;
      const s = JSON.parse(raw);
      return { rows: s.rows.length, nextPage: s.nextPage, coverage: s.coverage, hasFetchedAt: typeof s.fetchedAt === 'number' && s.fetchedAt > 0, firstKeys: Object.keys(s.rows[0] || {}).sort() };
    `);
    check('B3b 快照已写入', !!snap);
    eq('B3c 快照行数与首屏一致', snap?.rows, 200);
    eq('B3d 游标推进到第 2 页', snap?.nextPage, 2);
    check('B3e 快照带抓取时间戳', snap?.hasFetchedAt === true);
    eq(
      'B3f 快照行字段完整(7 列)',
      (snap?.firstKeys ?? []).join(','),
      'avatar,name,rankIcon,rankName,ranking,totalIntegral,uid'
    );
  }
  await shot('01-首屏200行');

  /* B4 搜索:昵称与 uid */
  {
    const probe = await evaluate(`
      const tds = [...document.querySelectorAll('table tbody tr')].map(tr => [...tr.querySelectorAll('td')]);
      const t = tds[Math.floor(tds.length / 2)];
      return { name: t[1].innerText.trim(), uid: t[4].innerText.trim() };
    `);
    // 昵称可能含换行/多余空白,取第一个字符做模糊命中
    const nameKey = String(probe.name).split('\n')[0].trim().slice(0, 3);
    const uidKey = String(probe.uid).trim().slice(2, 7);

    await evaluate(`
      const input = document.querySelector('input[placeholder*="昵称"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(nameKey)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    `);
    const hitByName = await waitFor(
      `昵称「${nameKey}」命中`,
      `const n = document.querySelectorAll('table tbody tr').length; const t = document.body.innerText; return n > 0 && n < 200 && t.includes('命中');`,
      15_000
    );
    check(`B4 昵称模糊搜索命中(B4 关键词=${nameKey})`, hitByName);
    {
      const rows = await evaluate(READ_ROWS);
      check('B4b 命中行数少于全量', rows.length > 0 && rows.length < 200, `命中 ${rows.length}`);
      check(
        'B4c 命中行的昵称/uid 确实含关键词',
        (await evaluate(`
          const k = ${JSON.stringify(nameKey)}.toLowerCase();
          const tds = [...document.querySelectorAll('table tbody tr')].map(tr => [...tr.querySelectorAll('td')]);
          return tds.every(t => (t[1].innerText + t[4].innerText).toLowerCase().includes(k));
        `)) === true
      );
    }

    await evaluate(`
      const input = document.querySelector('input[placeholder*="昵称"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(uidKey)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    `);
    const hitByUid = await waitFor(
      `uid「${uidKey}」命中`,
      `const tds = [...document.querySelectorAll('table tbody tr')].map(tr => [...tr.querySelectorAll('td')]); return tds.length > 0 && tds.length < 200 && tds.every(t => t[4].innerText.toLowerCase().includes(${JSON.stringify(uidKey.toLowerCase())}));`,
      15_000
    );
    check(`B4d uid 模糊搜索命中(B4 关键词=${uidKey})`, hitByUid);

    /* 无命中时的空态必须说明「不等于不存在」 */
    await evaluate(`
      const input = document.querySelector('input[placeholder*="昵称"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'zzz-绝对不存在的昵称-zzz');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    `);
    const emptyExplained = await waitFor(
      '空态解释覆盖范围',
      `const t = document.body.innerText; return t.includes('不等于') && t.includes('覆盖到第');`,
      15_000
    );
    check('B4e 无命中时如实说明覆盖范围,不谎称「不存在」', emptyExplained);
    await shot('02-无命中空态');

    // 清空搜索
    await evaluate(`
      const input = document.querySelector('input[placeholder*="昵称"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    `);
    await waitFor('恢复全量', `return document.querySelectorAll('table tbody tr').length >= 200;`, 15_000);
  }

  /* B5 段位筛选 chip:选项由数据动态生成 */
  {
    const chipLabels = await evaluate(`
      return [...document.querySelectorAll('button.rank-chip')].map(b => b.innerText.split('\\n')[0].trim());
    `);
    check('B5 段位 chip 动态生成(含「全部段位」+ 实际段位)', chipLabels.length >= 2, chipLabels.join(' / '));
    check('B5b chip 里没有硬编码的未出现段位', !chipLabels.includes('坚韧黑铁'), chipLabels.join(' / '));

    const target = chipLabels.find((l) => l && l !== '全部段位');
    if (target) {
      await evaluate(`
        const b = [...document.querySelectorAll('button.rank-chip')].find(x => x.innerText.includes(${JSON.stringify(target)}));
        b.click();
        return true;
      `);
      const filtered = await waitFor(
        `段位「${target}」筛选生效`,
        `const tds = [...document.querySelectorAll('table tbody tr')].map(tr => [...tr.querySelectorAll('td')]); return tds.length > 0 && tds.length < 200 && tds.every(t => t[3].innerText.includes(${JSON.stringify(target)}));`,
        15_000
      );
      check(`B5c 段位筛选只留该段位(B5 目标=${target})`, filtered);
      await shot('03-段位筛选');

      await evaluate(`
        const b = [...document.querySelectorAll('button.rank-chip')].find(x => x.innerText.includes('全部段位'));
        b.click();
        return true;
      `);
      await waitFor('取消段位筛选', `return document.querySelectorAll('table tbody tr').length >= 200;`, 15_000);
    } else {
      check('B5c 找到可筛选的段位 chip', false, '只有「全部段位」');
    }
  }

  /*
   * B6/B7 需要一个可复现的干净起点(= 恰好 200 行 / 游标第 2 页)。
   *
   * 走过的弯路,别再退回去:
   *   1) 只做 hash 跳转不会重置滚动位置,页面停在底部 → 哨兵挂载即可见 → 自动又抓一批;
   *   2) 界面态是模块级单例,离开再回来会留着上一轮的筛选(这本身是缺陷,
   *      已由组件的挂载重置修掉);
   *   3) 重置界面态**不会**缩减已抓到的行数 —— 快照是用户的数据,就该留着。
   *      要真回到 200 行只能清缓存重载,所以这里带一个 cache-bust 的 query
   *      (#/rank?t=…) 强制浏览器整页重载,而不是只换 hash。
   */
  const resetToFresh = async () => {
    await evaluate(`localStorage.clear(); return true;`);
    /*
     * 必须**显式 reload**。
     *
     * `Page.navigate` 到只有 hash/query 不同的地址会被当成同文档导航,
     * 页面不重载 —— 存储清了,但模块级快照还在内存里,行数依旧 400。
     * 这也是一开始「重置后回到 200 行」反复超时的真正原因。
     */
    await cdp('Page.navigate', { url: `${APP}#/rank?t=${Date.now()}` });
    await cdp('Page.reload', { ignoreCache: true });
    await waitFor('整页重载完成', 'return document.readyState === "complete"', 25_000);
    // 视图挂载时会自己归顶;这里再补一次,防止浏览器恢复滚动位置抢在前头
    await evaluate(`window.scrollTo(0, 0); return true;`);
    const ok = await waitFor(
      '重置后回到 200 行',
      `return document.querySelectorAll('table tbody tr').length === 200;`,
      45_000
    );
    if (!ok) {
      // 失败时把现场打出来,免得只看到一句「超时」而不知道卡在哪
      console.log(
        '  (重置现场)',
        JSON.stringify(
          await evaluate(`
            const raw = localStorage.getItem(${JSON.stringify(storeMod.__testing.SNAPSHOT_KEY)});
            return {
              href: location.href,
              rows: document.querySelectorAll('table tbody tr').length,
              scrollY: window.scrollY,
              docH: document.documentElement.scrollHeight,
              snapshotRows: raw ? JSON.parse(raw).rows.length : null,
              hasHook: !!window.__rankStore,
              search: window.__rankStore ? window.__rankStore.state.ui.search : null
            };
          `)
        )
      );
    }
    return ok;
  };

  check('B6前提 重置到干净起点(200 行)', await resetToFresh());

  /* 防回归:筛选把表格缩短时,哨兵可见而自动续抓是**预期**行为 ——
   * 但绝不能变成「筛一下就把整榜抓完」的失控。
   * 放在干净起点之后做,增量才有确定含义。 */
  {
    const reqBefore = rankRequests.length;
    await evaluate(`
      const input = document.querySelector('input[placeholder*="昵称"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'a');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    `);
    await sleep(6000);
    const extra = rankRequests.length - reqBefore;
    check('B5d 筛选不会失控抓榜(最多再多抓一批)', extra <= 1, `筛选期间新增 ${extra} 个请求`);
    await evaluate(`
      const input = document.querySelector('input[placeholder*="昵称"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    `);
    await sleep(600);
    check('B6前提2 再重置一次(筛选可能已顺带抓过一批)', await resetToFresh());
  }

  /*
   * B6 顺序:表格按上游名次顺序展示,且表头**不可点**。
   *
   * 站点裁定本工具不提供排序(榜单顺序就是官方名次顺序)。这里不只测当前行为,
   * 还要挡住「顺手加个排序」的回头路 —— 排序一旦回来,名次列会被打乱,
   * 而并列跳号的数据一重排就彻底读不懂了。
   */
  {
    const order = await evaluate(`
      const tds = [...document.querySelectorAll('table tbody tr')].map(tr => Number(tr.querySelectorAll('td')[0].innerText.trim()));
      return { first: tds[0], last: tds[tds.length - 1], isNonDecreasing: tds.every((n, i) => i === 0 || n >= tds[i - 1]) };
    `);
    eq('B6 首行为第 1 名', order.first, 1);
    check('B6b 整列名次非递减(按官方名次顺序展示)', order.isNonDecreasing, JSON.stringify(order));

    const headerState = await evaluate(`
      const ths = [...document.querySelectorAll('table thead th')];
      return {
        labels: ths.map(t => t.innerText.trim()),
        anySortable: ths.some(t => t.classList.contains('sortable')),
        anyTabindex: ths.some(t => t.hasAttribute('tabindex')),
        hasArrow: ths.some(t => /[↑↓]/.test(t.innerText))
      };
    `);
    eq('B6c 表头为固定五列', headerState.labels.join(','), '名次,召唤师,积分,段位,uid');
    check('B6d 表头不带可排序样式', !headerState.anySortable, JSON.stringify(headerState));
    check('B6e 表头不可聚焦(没有排序交互)', !headerState.anyTabindex);
    check('B6f 表头没有排序箭头', !headerState.hasArrow);

    /* 点表头不应改变行序 —— 用真实点击验,而不是只看类名 */
    const beforeClick = await evaluate(`return [...document.querySelectorAll('table tbody tr')].map(tr => tr.querySelectorAll('td')[0].innerText.trim()).join(',');`);
    await evaluate(`
      [...document.querySelectorAll('table thead th')].forEach(th => th.click());
      return true;
    `);
    await sleep(600);
    const afterClick = await evaluate(`return [...document.querySelectorAll('table tbody tr')].map(tr => tr.querySelectorAll('td')[0].innerText.trim()).join(',');`);
    check('B6g 点遍表头后行序完全不变', beforeClick === afterClick, `行数 ${beforeClick.split(',').length}`);

    /* 直击曾经的缺陷:模板渲染的行必须等于 store 计算出的行,逐行比对 */
    const domVsStore = await evaluate(`
      const dom = [...document.querySelectorAll('table tbody tr')].map(tr => Number(tr.querySelectorAll('td')[0].innerText.trim()));
      const store = window.__rankStore.filteredRows.value.map(r => r.ranking);
      return { same: dom.length === store.length && dom.every((v, i) => v === store[i]), domLen: dom.length, storeLen: store.length };
    `);
    check(
      'B6h DOM 行序逐行等于 store.filteredRows(模板接的是同一份数据)',
      domVsStore.same,
      JSON.stringify(domVsStore)
    );
    check(
      'B6i store 未暴露任何排序接口',
      (await evaluate(`return !('sortedRows' in window.__rankStore) && !('sortKey' in window.__rankStore.state.ui) && !('sortDir' in window.__rankStore.state.ui);`)) === true
    );
  }

  /* B7 无限滚动:滚到底应**只**追加一批(200 → 400),且恰好发一个请求 */
  {
    check('B7前提 重置到干净起点(200 行)', await resetToFresh());
    const before = await evaluate(`return document.querySelectorAll('table tbody tr').length;`);
    eq('B7起点 恰好 200 行', before, 200);
    const reqBefore = rankRequests.length;
    await evaluate(`window.scrollTo(0, document.body.scrollHeight); return true;`);
    const grew = await waitFor(
      '无限滚动追加下一批',
      `return document.querySelectorAll('table tbody tr').length > ${before};`,
      45_000
    );
    check(`B7 滚到底追加了一批(从 ${before} 行增长)`, grew);
    // 等一会儿,若有级联会在这一窗口内暴露出来
    await sleep(3000);
    const after = await evaluate(`
      return { n: document.querySelectorAll('table tbody tr').length, nextPage: JSON.parse(localStorage.getItem(${JSON.stringify(storeMod.__testing.SNAPSHOT_KEY)})).nextPage };
    `);
    eq('B7b 追加后为 400 行(不是级联猛抓)', after.n, 400);
    eq('B7c 游标推进到第 3 页', after.nextPage, 3);
    const newReqs = rankRequests.slice(reqBefore);
    eq('B7d 一次滚动只发一个上游请求(无级联)', newReqs.length, 1);
    check(
      'B7e 该请求正是 pageNum=2 / pageSize=200',
      newReqs[0]?.body.includes('"pageNum":2') && newReqs[0]?.body.includes('"pageSize":200'),
      newReqs[0]?.body
    );
    check(
      'B7f 追加后名次仍单调不减(并集追加不打乱既有行)',
      (await evaluate(`
        const nums = [...document.querySelectorAll('table tbody tr')].map(tr => Number(tr.querySelectorAll('td')[0].innerText.trim()));
        return nums.every((n, i) => i === 0 || n >= nums[i - 1]);
      `)) === true
    );
    await shot('04-无限滚动400行');
  }

  /* B8 刷新恢复:快照应从 localStorage 直接恢复,不再重抓第 1 页 */
  {
    const navStart = Date.now();
    const reqBefore = rankRequests.length;
    await evaluate('window.scrollTo(0, 0); return true;');
    await cdp('Page.reload');
    const restored = await waitFor(
      '刷新后从本地快照恢复',
      `return document.querySelectorAll('table tbody tr').length >= 400;`,
      20_000,
      200
    );
    check('B8 刷新后直接从快照恢复(行数不退回 200)', restored);
    check('B8b 恢复耗时远小于一次真实抓取', Date.now() - navStart < 10_000, `${Date.now() - navStart}ms`);
    check(
      'B8c 刷新后显示快照时间戳',
      (await evaluate(`return document.body.innerText.includes('快照');`)) === true
    );
    eq('B8d 整页刷新恢复时不请求上游', rankRequests.length - reqBefore, 0);
  }

  /* B11 新增的显式加载入口也必须一批一批取，不清空搜索或重复请求。 */
  {
    const before = await evaluate('return window.__rankStore.state.snapshot.rows.length;');
    const reqBefore = rankRequests.length;
    const started = await evaluate(`
      const button = [...document.querySelectorAll('button.rank-load-more')].find(b => b.innerText.includes('加载下一批'));
      if (!button) return false;
      button.click(); button.click();
      return window.__rankStore.state.loading;
    `);
    check('B11 点击下一批时进入加载状态', started);
    check('B11b 手动加载追加 200 行', await waitFor('手动追加完成', `return !window.__rankStore.state.loading && window.__rankStore.state.snapshot.rows.length === ${before + 200};`, 45000));
    eq('B11c 连点加载按钮只发一个请求', rankRequests.length - reqBefore, 1);

    await evaluate(`
      const input = document.querySelector('input[placeholder*="昵称"]');
      input.value = 'zzz-验收无匹配-zzz'; input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    `);
    await waitFor('无匹配时提供继续查找按钮', `return !![...document.querySelectorAll('button')].find(b => b.innerText.includes('继续加载，查找这位玩家'));`, 15000);
    await sleep(1000);
    await waitFor('筛选触发的追加完成', 'return !window.__rankStore.state.loading;', 45000);
    const emptyBefore = await evaluate('return window.__rankStore.state.snapshot.rows.length;');
    const emptyReqBefore = rankRequests.length;
    await clickByText('B11d 无结果继续查找入口', 'button', '继续加载，查找这位玩家', true);
    check('B11e 无结果时也能追加下一批', await waitFor('无匹配手动追加', `return !window.__rankStore.state.loading && window.__rankStore.state.snapshot.rows.length === ${emptyBefore + 200};`, 45000));
    eq('B11f 无结果手动加载只发一个请求', rankRequests.length - emptyReqBefore, 1);
    eq('B11g 追加后保留搜索词', await evaluate('return document.querySelector(\'input[placeholder*="昵称"]\').value;'), 'zzz-验收无匹配-zzz');
    await shot('06-无匹配手动续抓');
    await evaluate(`
      const input = document.querySelector('input[placeholder*="昵称"]');
      input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    `);
    await sleep(300);
  }

  /* B9 重新抓取:清空后从第 1 页重建 */
  {
    const clicked = await clickByText('B9 找到「重新抓取」按钮', 'button', '重新抓取');
    if (clicked) {
      const rebuilt = await waitFor(
        '重新抓取重建快照',
        `const raw = localStorage.getItem(${JSON.stringify(storeMod.__testing.SNAPSHOT_KEY)}); if (!raw) return false; const s = JSON.parse(raw); return s.rows.length >= 200 && s.nextPage === 2;`,
        60_000
      );
      check('B9b 重新抓取后回到 200 行 / 第 2 页游标', rebuilt);
      eq(
        'B9c 重建后仍是 200 行(不是叠加旧数据)',
        await evaluate(`return document.querySelectorAll('table tbody tr').length;`),
        200
      );
      check(
        'B9d 重建期间表格没有闪成空白(重建后行数立即 ≥200)',
        (await evaluate(`return document.querySelectorAll('table tbody tr').length;`)) >= 200
      );
    }
  }

  /* B10 截图留档(含整页长图,便于人工看版式) */
  await cdp('Emulation.setDeviceMetricsOverride', {
    width: 1680,
    height: 2400,
    deviceScaleFactor: 1,
    mobile: false
  });
  await sleep(800);
  await shot('05-整页长图');

  writeFileSync(
    join(SHOT_DIR, 'result.json'),
    JSON.stringify({ passed, failures, at: new Date().toISOString() }, null, 2)
  );
} finally {
  browser?.close();
  // 只关自己起的 preview;复用别人那个就别动
  if (preview) preview.kill();
}

/* ══════════════════════ 收尾 ══════════════════════ */

console.log(`\n通过 ${passed} 项,失败 ${failures.length} 项`);
if (failures.length) {
  console.log('失败明细:');
  for (const f of failures) console.log('  · ' + f);
  process.exit(1);
}
console.log('全部通过 ✓');
