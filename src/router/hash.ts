/* ================================================================
 * src/router/hash.ts
 *
 * 极简 hash 路由(~90 行,无依赖)。
 *
 * 路由由**工具注册表派生**:#/{toolCode}
 *   #/              → 主入口工具(catalog.homeTool(),当前为期刊)
 *   #/journal       → 期刊(含往期与期号)        #/archive → 往期归档
 *   #/issue/{pkgId} → 期号正文
 *   #/editorial     → 编辑部(后台 hub)
 *   #/editorial/{sub} → 编辑部下属工具(cards/batch/rules/resources/sync)
 *   #/overview …    → 各数据工具 / 云端工具 / 资料工具(以 code 为准)
 *   #/tool/{code}   → 历史路径,仍可解析(向后兼容)
 *
 * 所有工具同层:新增工具只需在 catalog 登记 + 提供视图,路由自动生效。
 * 提供深链、刷新恢复与浏览器前进/后退;SPA 刷新会丢内存态,
 * 因此工具页在数据包缺失时由视图内部降级为引导态(不白屏)。
 * ============================================================== */

import { store } from '@/store/analysis';
import { findTool, isKnownTool, HOME_CODE, TOOLS } from '@/tools/catalog';

/**
 * 编辑部二级路由的子工具名 —— 由注册表派生,不手写清单,避免与 catalog 漂移。
 * 'editorial-cards' → 'cards'
 */
const EDITORIAL_PREFIX = 'editorial-';
const EDITORIAL_SUBS: readonly string[] = TOOLS.filter((t) => t.code.startsWith(EDITORIAL_PREFIX)).map(
  (t) => t.code.slice(EDITORIAL_PREFIX.length)
);

export interface Route {
  /** 工具 code,或内容层的 issue */
  view: string;
  /** view === 'issue' 时的数据包 id */
  issueId?: string;
}

export function parseHash(hash: string): Route {
  const raw = (hash || '').replace(/^#\/?/, '').replace(/\/+$/, '');
  if (!raw) return { view: HOME_CODE };
  const [head = '', tail] = raw.split('/');

  // 内容层特例:期号正文
  if (head === 'issue') {
    return tail ? { view: 'issue', issueId: decodeURIComponent(tail) } : { view: 'archive' };
  }
  // 内容层次级路由:往期归档不是工具 code,但合法
  if (head === 'archive') return { view: 'archive' };
  // 编辑部二级路由:#/editorial/{sub};无 sub 或 sub 非法 → 编辑部 hub
  if (head === 'editorial') {
    return tail && EDITORIAL_SUBS.includes(tail)
      ? { view: `${EDITORIAL_PREFIX}${tail}` }
      : { view: 'editorial' };
  }
  // 历史路径兼容:#/tool/{code}
  if (head === 'tool') {
    return tail && isKnownTool(tail) ? { view: tail } : { view: HOME_CODE };
  }
  // 已登记工具:直接以 code 为路由
  if (isKnownTool(head)) return { view: head };
  // 未知名 → 回工具台
  return { view: HOME_CODE };
}

export function routeToHash(route: Route): string {
  if (route.view === 'issue') {
    return route.issueId ? `#/issue/${encodeURIComponent(route.issueId)}` : '#/archive';
  }
  if (route.view === HOME_CODE) return '#/';
  // 内容层次级路由不是工具 code,需原样映射(否则会被误判为非法而回落工具台)
  if (route.view === 'archive') return '#/archive';
  // 编辑部下属工具回写成二级路径:#/editorial/cards
  if (route.view.startsWith(EDITORIAL_PREFIX)) {
    return `#/editorial/${route.view.slice(EDITORIAL_PREFIX.length)}`;
  }
  const tool = findTool(route.view);
  if (!tool) return '#/';
  return `#/${tool.code}`;
}

/** 当前 store 状态 → 路由 */
export function currentRoute(): Route {
  if (store.currentView === 'issue') {
    return { view: 'issue', issueId: store.currentIssueId };
  }
  return { view: store.currentView };
}

/** 内容层次级路由:不是工具 code,但合法 */
const CONTENT_ROUTES = new Set(['archive', 'issue']);

/** 路由 → store(带可用性校验:既非工具 code 也非内容层路由 → 回工具台) */
export function applyRoute(route: Route): void {
  if (route.view === 'issue') {
    const id = route.issueId ?? '';
    if (id && store.packages.some((p) => p.id === id)) {
      store.currentView = 'issue';
      store.currentIssueId = id;
      return;
    }
    store.currentView = HOME_CODE;
    return;
  }
  store.currentView =
    route.view === HOME_CODE || isKnownTool(route.view) || CONTENT_ROUTES.has(route.view)
      ? route.view
      : HOME_CODE;
}

/** 命令式跳转(同时推进浏览器历史) */
export function navigate(route: Route, replace = false): void {
  const hash = routeToHash(route);
  if (window.location.hash === hash) {
    applyRoute(route);
    return;
  }
  if (replace) {
    window.history.replaceState(null, '', hash);
    applyRoute(route);
  } else {
    window.location.hash = hash; // 触发 hashchange → 统一走 applyRoute
  }
}

/** 把当前 store 状态回写到地址栏(不触发 hashchange 副作用) */
export function syncUrl(): void {
  const hash = routeToHash(currentRoute());
  if (window.location.hash !== hash) window.history.replaceState(null, '', hash);
}

/** 启动路由:解析当前 hash 并监听变化。返回卸载函数 */
export function startRouter(): () => void {
  applyRoute(parseHash(window.location.hash));
  // 规范化 URL:被拒绝的深链(如刷新后数据包已不在内存)应落回工具台地址,
  // 而不是把失效 hash 留在地址栏(App 的 watcher 只在视图变化时回写)。
  syncUrl();
  const onHashChange = (): void => applyRoute(parseHash(window.location.hash));
  window.addEventListener('hashchange', onHashChange);
  return () => window.removeEventListener('hashchange', onHashChange);
}
