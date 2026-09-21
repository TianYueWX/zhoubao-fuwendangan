/* ================================================================
 * src/components/view/index.ts
 *
 * 工具 code → 视图组件。
 *
 * 新增工具的两步:
 *   1) 在 src/tools/catalog.ts 登记(code/分组/数据源/是否需要数据)
 *   2) 在此把该 code 映射到组件(未实现内容时先用 ToolPlaceholder)
 * 导航、首页工具台、路由、状态徽章都会自动跟上。
 * ================================================================ */

import HomeView from './HomeView.vue';
import JournalView from './JournalView.vue';
import ArchiveView from './ArchiveView.vue';
import IssueView from './IssueView.vue';
import ImportView from './ImportView.vue';
import OverviewView from './OverviewView.vue';
import HeroLegendView from './HeroLegendView.vue';
import CardsView from './CardsView.vue';
import RegionView from './RegionView.vue';
import DecksView from './DecksView.vue';
import ChainBoardView from './ChainBoardView.vue';
import ToolPlaceholder from './ToolPlaceholder.vue';
import EditorialHub from '../admin/EditorialHub.vue';
import AdminCardEditor from '../admin/AdminCardEditor.vue';
import AdminBatchOps from '../admin/AdminBatchOps.vue';
import AdminRulesEditor from '../admin/AdminRulesEditor.vue';
import AdminResources from '../admin/AdminResources.vue';
import AdminSync from '../admin/AdminSync.vue';

/** 需要 props.code 的占位视图(云端/资料类工具的架构位) */
const placeholder = ToolPlaceholder;

export const ViewComponents: Record<string, unknown> = {
  /* 首页:工具台(所有工具的入口) */
  home: HomeView,

  /* 期刊栏目:期刊本体与其次级路由 */
  journal: JournalView,
  archive: ArchiveView,
  issue: IssueView,

  /* 本地数据工具 */
  import: ImportView,
  overview: OverviewView,
  cards: CardsView,
  legendary: HeroLegendView,
  heroes: HeroLegendView, // 兼容:英雄与传奇同一视图
  region: RegionView,
  decks: DecksView,

  /* 云端内容(待接入 Supabase) */
  blog: placeholder,
  qa: placeholder,

  /* 静态资料(随站点发布) */
  rules: placeholder,
  carddex: placeholder,

  /* 小工具:结算链推演(卡池来自内置卡表,无需数据包) */
  chain: ChainBoardView,

  /* 编辑部(隐藏栏目:连点报头刊名解锁 + 管理员门禁) */
  editorial: EditorialHub,
  'editorial-cards': AdminCardEditor,
  'editorial-batch': AdminBatchOps,
  'editorial-rules': AdminRulesEditor,
  'editorial-resources': AdminResources,
  'editorial-sync': AdminSync
};

export {
  HomeView,
  JournalView,
  ArchiveView,
  IssueView,
  ImportView,
  OverviewView,
  HeroLegendView,
  CardsView,
  RegionView,
  DecksView,
  ChainBoardView,
  ToolPlaceholder,
  EditorialHub,
  AdminCardEditor,
  AdminBatchOps,
  AdminRulesEditor,
  AdminResources,
  AdminSync
};
