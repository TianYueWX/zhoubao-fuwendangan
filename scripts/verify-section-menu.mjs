/* ================================================================
 * scripts/verify-section-menu.mjs
 *
 * 报头栏目菜单(纯逻辑)回归:activeGroupOf / sectionMenuItems。
 * 不依赖浏览器 —— 直接跑 src/tools/catalog.ts 的纯函数。
 *   node --experimental-strip-types --import ./scripts/register-hooks.mjs scripts/verify-section-menu.mjs
 * ================================================================ */
import { activeGroupOf, backTargetOf, sectionMenuItems, TOOLS } from '@/tools/catalog';

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
const keys = (items) => items.map((i) => i.key);
const labelOf = (items, key) => items.find((i) => i.key === key)?.label;

console.log('== 1. activeGroupOf:视图 → 栏目 ==');
const groupCases = {
  home: null,
  journal: 'journal',
  archive: 'journal',
  issue: 'journal',
  import: 'journal',
  overview: 'journal',
  cards: 'journal',
  legendary: 'journal',
  region: 'journal',
  decks: 'journal',
  blog: 'cloud',
  qa: 'cloud',
  builder: 'reference',
  rules: 'reference',
  carddex: 'reference',
  chain: 'reference',
  rank: 'reference',
  games: 'reference',
  booster: 'reference',
  editorial: 'editorial',
  'editorial-cards': 'editorial',
  'editorial-sync': 'editorial',
};
for (const [view, expected] of Object.entries(groupCases)) {
  check(`#/${view} → ${expected ?? 'null'}`, activeGroupOf(view) === expected, String(activeGroupOf(view)));
}

console.log('\n== 2. 期刊栏目菜单(未载入数据包)==');
const journal = sectionMenuItems('overview', { hasPackages: false, isEditorialAdmin: false });
check('8 条:本期/往期 + 6 工具', journal.length === 8, JSON.stringify(keys(journal)));
check('顺序 = 本期/往期 + 注册表顺序(总览…卡组,数据管理收尾)',
  JSON.stringify(keys(journal)) === JSON.stringify(['journal', 'archive', 'overview', 'cards', 'legendary', 'region', 'decks', 'import']),
  JSON.stringify(keys(journal)));
check('inNav 未开的经典短标签仍取自 short', labelOf(journal, 'legendary') === '传奇' && labelOf(journal, 'region') === '地域', `${labelOf(journal, 'legendary')}/${labelOf(journal, 'region')}`);
check('「数据管理」入口在,且未置灰(needsData=false)', labelOf(journal, 'import') && journal.find((i) => i.key === 'import').dimmed === false);
check('无数据包时分析工具置灰可点', journal.filter((i) => ['overview', 'cards', 'legendary', 'region', 'decks'].includes(i.key)).every((i) => i.dimmed === true));
check('总览为当前项', journal.find((i) => i.key === 'overview').active === true && journal.filter((i) => i.active).length === 1);

console.log('\n== 3. 期刊当前项归属 ==');
check('在 #/issue 时「本期」高亮', sectionMenuItems('issue', { hasPackages: true, isEditorialAdmin: false }).find((i) => i.key === 'journal').active === true);
check('在 #/archive 时「往期」高亮', sectionMenuItems('archive', { hasPackages: true, isEditorialAdmin: false }).find((i) => i.key === 'archive').active === true);
check('有数据包时不再置灰', sectionMenuItems('overview', { hasPackages: true, isEditorialAdmin: false }).every((i) => i.dimmed === false));

console.log('\n== 4. 参考资料栏目菜单 ==');
const ref = sectionMenuItems('carddex', { hasPackages: false, isEditorialAdmin: false });
check('列全部 7 个已登记工具(含未进 inNav 的小工具)',
  JSON.stringify(keys(ref)) === JSON.stringify(['builder', 'rules', 'carddex', 'chain', 'rank', 'games', 'booster']),
  JSON.stringify(keys(ref)));
check('当前项 carddex 高亮', ref.find((i) => i.key === 'carddex').active === true && ref.filter((i) => i.active).length === 1);

console.log('\n== 5. 云端栏目菜单 ==');
const cloud = sectionMenuItems('qa', { hasPackages: false, isEditorialAdmin: false });
check('列 赛事报道 + QA', JSON.stringify(keys(cloud)) === JSON.stringify(['blog', 'qa']), JSON.stringify(keys(cloud)));

console.log('\n== 6. 编辑部门禁 ==');
const edGuest = sectionMenuItems('editorial-cards', { hasPackages: false, isEditorialAdmin: false });
check('未登录只留「编辑部」首页(不列会撞门禁的死链)', JSON.stringify(keys(edGuest)) === JSON.stringify(['editorial']), JSON.stringify(keys(edGuest)));
const edAdmin = sectionMenuItems('editorial-cards', { hasPackages: false, isEditorialAdmin: true });
check('已登录列出全部 7 个编辑部页面',
  JSON.stringify(keys(edAdmin)) === JSON.stringify(TOOLS.filter((t) => t.group === 'editorial').map((t) => t.code)),
  JSON.stringify(keys(edAdmin)));

console.log('\n== 7. 工具台无栏目菜单 ==');
check('home → 空', sectionMenuItems('home', { hasPackages: true, isEditorialAdmin: true }).length === 0);

console.log('\n== 8. backTargetOf:上下文返回 ==');
const sameTarget = (view, expected) => {
  const t = backTargetOf(view);
  return t.view === expected.view && t.label === expected.label;
};
check('期刊系子页 → 返回期刊 #/journal', ['archive', 'issue', 'import', 'overview', 'cards', 'legendary', 'region', 'decks'].every((v) => sameTarget(v, { view: 'journal', label: '返回期刊' })));
check('编辑部子页 → 返回编辑部 #/editorial', sameTarget('editorial-cards', { view: 'editorial', label: '返回编辑部' }));
check('期刊首页 → 返回首页(栏目首页之上是工具台)', sameTarget('journal', { view: 'home', label: '返回首页' }));
check('编辑部首页 → 返回首页(栏目首页之上是工具台)', sameTarget('editorial', { view: 'home', label: '返回首页' }));
check('参考资料(含构筑卡组) → 返回首页', ['builder', 'rules', 'carddex', 'chain', 'rank', 'games', 'booster'].every((v) => sameTarget(v, { view: 'home', label: '返回首页' })));
check('云端 → 返回首页', sameTarget('qa', { view: 'home', label: '返回首页' }));
check('工具台 → 返回首页(自我)', sameTarget('home', { view: 'home', label: '返回首页' }));

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
