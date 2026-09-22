/* ================================================================
 * src/tools/catalog.ts
 *
 * 工具注册表 —— 站点唯一的「有什么工具」事实来源。
 *
 * 设计约束(可扩展性优先):
 *   1. 工具 = 一个自描述记录(id / code / 分组 / 数据源 / 能力要求 / 状态),
 *      新增工具只需在此登记 + 提供一个视图组件,不必改导航、路由或首页。
 *   2. **路由由 code 派生**:code 'overview' → #/overview,'rules' → #/rules。
 *      历史路径 #/tool/overview 仍可解析(见 src/router/hash.ts),向后兼容。
 *   3. **数据源与工具解耦**:tool.source 声明数据从哪来
 *      (local = 本机分析 / supabase = 云端内容 / static = 随站点发布),
 *      视图不关心取数细节;加载状态由 src/tools/state.ts 统一承载。
 *   4. 期刊(journal)也是一个工具 —— 首页只是工具台,不特殊对待任何一个工具。
 * ============================================================== */

import type { ToolName } from "@/store/analysis";

/**
 * 工具分组 = 一级栏目。
 * 层级关系:栏目(分组) → 工具 → 工具页面。
 * 「本地分析工具」不是一个栏目,而是**期刊栏目下的工具** —— 它们服务的是已载入的数据包。
 */
export type ToolGroupId = "journal" | "cloud" | "reference" | "editorial";

export interface ToolGroup {
  id: ToolGroupId;
  label: string;
  /** 分区副标(英文铭文,报刊语言) */
  latin: string;
  desc: string;
  /**
   * 隐藏栏目:仅在对当前访客解锁后出现。
   * 注册表仍是唯一事实来源 —— 可见性由调用方把 unlocked 传进
   * navGroups() / visibleGroups(),本文件保持纯函数、不读运行时状态。
   */
  hidden?: boolean;
}

export const TOOL_GROUPS: readonly ToolGroup[] = Object.freeze([
  {
    id: "journal",
    label: "周报期刊",
    latin: "Journal",
    desc: "按期归档的赛事周报,及其全部分析工具(作用于已载入的数据包,离线可用)",
  },
  {
    id: "cloud",
    label: "云端内容",
    latin: "Cloud Content",
    desc: "从云端读取的报道与资料库(按需联网)",
  },
  {
    id: "reference",
    label: "参考资料",
    latin: "Reference",
    desc: "规则、卡表等随站点发布的静态资料",
  },
  {
    id: "editorial",
    label: "编辑部",
    latin: "Editorial Desk",
    desc: "档案内容校勘与发布 —— 卡表、规则书、资源与同步(需管理员登录)",
    hidden: true,
  },
]);

/** 数据来源:视图不关心实现,只声明事实 */
export type ToolSource =
  /** 本机内存中的已载入数据包(离线) */
  | "local"
  /** 云端内容库(如 Supabase:报道 blog / QA / 规则) */
  | "supabase"
  /** 随站点发布的静态资源 */
  | "static";

/** 工具状态:由 state.ts 的机器回写,首页与导航据此渲染徽章 */
export type ToolStatus =
  | "idle"
  | "loading"
  | "ready"
  | "empty"
  | "error"
  | "unconfigured";

export interface ToolDef {
  /** 路由标识,全局唯一;同时是 hash 路由的第二段 */
  code: string;
  label: string;
  /** 栏目条内的短标签;不填则用 label */
  short?: string;
  /** 卡片上的一句话说明 */
  desc: string;
  group: ToolGroupId;
  source: ToolSource;
  /** 徽章文字(如「数据」「云端」),不填则用分组的默认徽章 */
  badge?: string;
  /**
   * 是否要求已载入数据包。
   * true  → 未载入时降级为引导态(可点,但页面内提示先载入数据)
   * false → 与本地数据无关
   */
  needsData?: boolean;
  /** 是否在导航栏(报头)中显示;工具台始终显示全部 */
  inNav?: boolean;
  /** 是否需要管理员登录(编辑部工具);未登录时视图内部降级为门禁页 */
  requiresAuth?: boolean;
  /**
   * 是否为站点主入口(首页 = 工具台)。
   * 首页是**所有工具的入口**,本身不是工具,因此当前没有工具标记此项。
   */
  home?: boolean;
  /** 数据源未配置时的说明(云端工具用) */
  unavailableHint?: string;
}

/**
 * 内置工具注册表。
 *
 * 顺序即首页分区内的展示顺序。
 * 说明:英雄与传奇共用一个视图(HeroLegendView),'heroes' 保留为兼容值,不单独登记。
 */
export const TOOLS: readonly ToolDef[] = Object.freeze([
  {
    code: "journal",
    label: "周报期刊",
    desc: "本期头条与往期归档,按数据包分期",
    group: "journal",
    source: "local",
    needsData: true,
    inNav: true,
  },
  {
    code: "overview",
    short: "总览",
    label: "Meta 总览",
    desc: "本期 meta 全貌、Tier 榜与环境阶梯",
    group: "journal",
    source: "local",
    badge: "数据",
    needsData: true,
    inNav: true,
  },
  {
    code: "cards",
    short: "单卡",
    label: "单卡分析",
    desc: "万金油单卡携带率与对照 Δ",
    group: "journal",
    source: "local",
    needsData: true,
    inNav: true,
  },
  {
    code: "legendary",
    short: "传奇",
    label: "传奇构筑",
    desc: "英雄与传奇的构筑对比、Core 卡与 Combo",
    group: "journal",
    source: "local",
    needsData: true,
    inNav: true,
  },
  {
    code: "region",
    short: "地域",
    label: "地域差异",
    desc: "城市与省份热度、赛事一览",
    group: "journal",
    source: "local",
    needsData: true,
    inNav: true,
  },
  {
    code: "decks",
    short: "卡组",
    label: "卡组浏览器",
    desc: "逐套卡组构筑与 TTS 码",
    group: "journal",
    source: "local",
    needsData: true,
    inNav: true,
  },
  {
    code: "import",
    short: "数据",
    label: "数据管理",
    desc: "上传数据包、生成期刊、管理多包",
    group: "journal",
    source: "local",
    badge: "入口",
    needsData: false,
    inNav: true,
  },
  /* ── 以下为云端/静态工具的登记位:数据源未配置时以「未配置」出现,不报错 ── */
  {
    code: "blog",
    label: "赛事报道",
    desc: "云端报道与赛后分析合集",
    group: "cloud",
    source: "supabase",
    badge: "云端",
    unavailableHint: "配置 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 后可用",
  },
  {
    code: "qa",
    label: "QA 查询",
    desc: "规则与判例问答检索",
    group: "cloud",
    source: "supabase",
    badge: "云端",
    unavailableHint: "配置 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 后可用",
  },
  {
    code: "rules",
    label: "规则查询",
    desc: "官方规则与裁定条文",
    group: "reference",
    source: "static",
    badge: "资料",
  },
  {
    code: "carddex",
    label: "卡牌查询",
    desc: "全卡检索与卡图浏览",
    group: "reference",
    source: "supabase",
    badge: "资料",
    unavailableHint: "需要配置公开只读的 Supabase 卡牌数据源",
  },
  {
    code: "chain",
    short: "结算链",
    label: "结算链推演",
    desc: "双人对局结算链推演板:六区拖拽、快照历史、多盘位保存与分享",
    group: "reference",
    source: "static",
    badge: "小工具",
    // 卡池来自随站点预加载的内置卡表,因此不依赖数据包
    needsData: false,
  },

  /* ── 编辑部(隐藏栏目:连点报头刊名解锁,且必须管理员登录) ──
   * editorial 是栏目首页(hub),其余 5 个工具各自独立成页。
   * 路由形态 #/editorial 与 #/editorial/{cards|batch|rules|resources|sync},
   * 由 src/router/hash.ts 做二级映射 —— 注册表里仍是扁平的 code。
   */
  {
    code: "editorial",
    label: "编辑部",
    desc: "后台总管:卡表、规则书、资源与数据同步的入口",
    group: "editorial",
    source: "supabase",
    badge: "后台",
    requiresAuth: true,
    inNav: true,
  },
  {
    code: "editorial-cards",
    short: "卡牌",
    label: "卡牌校勘",
    desc: "单卡全字段编辑与印刷版本子表",
    group: "editorial",
    source: "supabase",
    badge: "校勘",
    requiresAuth: true,
    inNav: true,
  },
  {
    code: "editorial-batch",
    short: "批量",
    label: "批量校勘",
    desc: "类表格内联编辑、批量禁限与数值调整",
    group: "editorial",
    source: "supabase",
    badge: "校勘",
    requiresAuth: true,
    inNav: true,
  },
  {
    code: "editorial-rules",
    short: "规则",
    label: "规则校勘",
    desc: "规则书树形编辑与全文检索定位",
    group: "editorial",
    source: "supabase",
    badge: "校勘",
    requiresAuth: true,
    inNav: true,
  },
  {
    code: "editorial-resources",
    short: "资源",
    label: "资源与发布",
    desc: "系列、图标库与版本发布标记",
    group: "editorial",
    source: "supabase",
    badge: "校勘",
    requiresAuth: true,
    inNav: true,
  },
  {
    code: "editorial-sync",
    short: "同步",
    label: "数据同步",
    desc: "官方接口拉取、差异比对与三种落地方式",
    group: "editorial",
    source: "supabase",
    badge: "管道",
    requiresAuth: true,
    inNav: true,
  },
]);

/* ──────────────────────────── 查询辅助 ──────────────────────────── */

export function findTool(code: string): ToolDef | null {
  return TOOLS.find((t) => t.code === code) ?? null;
}

/**
 * 某分组下的全部已登记工具。
 * 注意:不判断隐藏栏目 —— 调用方应先确认该分组对当前访客可见。
 */
export function toolsOf(group: ToolGroupId): ToolDef[] {
  return TOOLS.filter((t) => t.group === group);
}

export function navTools(): ToolDef[] {
  return TOOLS.filter((t) => t.inNav);
}

/** 某分组下在导航栏显示的工具(栏目内二级导航用) */
export function sectionBarTools(group: ToolGroupId): ToolDef[] {
  return TOOLS.filter((t) => t.group === group && t.inNav);
}

/**
 * 出现在导航栏的一级栏目(有 inNav 工具的分组),顺序按 TOOL_GROUPS。
 * @param unlocked 隐藏栏目(编辑部)是否已解锁;默认 false = 对访客完全不可见
 */
export function navGroups(unlocked = false): ToolGroup[] {
  return TOOL_GROUPS.filter(
    (g) =>
      (!g.hidden || unlocked) && TOOLS.some((t) => t.group === g.id && t.inNav),
  );
}

/** 工具台用:全部对当前访客可见的栏目(含无 inNav 工具的分组) */
export function visibleGroups(unlocked = false): ToolGroup[] {
  return TOOL_GROUPS.filter((g) => !g.hidden || unlocked);
}

/** 栏目对当前访客是否可见 */
export function isGroupVisible(group: ToolGroupId, unlocked = false): boolean {
  const g = TOOL_GROUPS.find((x) => x.id === group);
  return !!g && (!g.hidden || unlocked);
}

/** 工具所属栏目 */
export function groupIdOf(code: string): ToolGroupId | null {
  return findTool(code)?.group ?? null;
}

/** 站点主入口(工具台)的视图 code —— 首页不是工具,故为固定值 */
export const HOME_CODE = "home";

/** 历史兼容:曾把某个工具当首页 */
export function homeTool(): ToolDef {
  return TOOLS.find((t) => t.home) ?? TOOLS[0]!;
}

/** 该 code 是否已登记(路由校验用) */
export function isKnownTool(code: string): boolean {
  return TOOLS.some((t) => t.code === code);
}

/** 分组元信息 */
export function groupOf(id: ToolGroupId): ToolGroup {
  return TOOL_GROUPS.find((g) => g.id === id) ?? TOOL_GROUPS[0]!;
}

/* ─────────────────────── 与视图层的映射 ─────────────────────── */

/**
 * 工具 code → 视图名。
 * 目前一一对应;若某工具复用其他视图(如云端工具暂用占位视图),在此收口映射。
 */
export function viewOf(code: string): ToolName | null {
  return isKnownTool(code) ? (code as ToolName) : null;
}
