/* ================================================================
 * src/tools/chain/types.ts
 *
 * 结算链推演 —— 纯数据模型(无 DOM / Vue / 存储依赖)。
 *
 * 设计约束:
 *   1. 本文件只描述「一盘推演长什么样」,不关心怎么渲染、怎么存。
 *      因此可被纯函数层(board.ts)、存储层(store.ts)、视图层共同引用。
 *   2. **所有跨层数据都必须可 JSON 序列化** —— 因为同一份盘要能进
 *      localStorage、进导出文件、进 URL 分享链接三处。
 *   3. 字段全部显式可选值收窄,便于 validateBoard() 做外部输入校验。
 *
 * 与上游 rune-chain-tools 的对应关系:
 *   上游六个拖拽容器 chain / resolve / pendingItems / trash / base / battlefield
 *   → 这里收敛为 ChainAreaKey 六个区域,顺序即界面上下顺序(见 AREA_ORDER)。
 * ============================================================== */

/** 六个推演区域。顺序 = 界面从上到下的排布顺序 */
export type ChainAreaKey =
  /** 结算链(主链,上游 #chain) */
  | 'chain'
  /** 结算中(上游 #resolve,限 1 张) */
  | 'resolve'
  /** 待处理效果(上游 #pendingItems) */
  | 'pending'
  /** 弃牌堆(上游 #trash) */
  | 'trash'
  /** 基地(上游 #base) */
  | 'base'
  /** 战场(上游 #battlefield) */
  | 'battlefield';

/** 区域顺序:界面按此排布,序列化也按此顺序,保证导出文件可读 */
export const AREA_ORDER: readonly ChainAreaKey[] = Object.freeze([
  'chain',
  'resolve',
  'pending',
  'trash',
  'base',
  'battlefield'
]);

/** 区域展示元信息(i18n 文案收口在此,组件不硬编码标题) */
export const AREA_META: Readonly<
  Record<ChainAreaKey, { label: string; hint: string; latin: string }>
> = Object.freeze({
  chain: { label: '结算链', latin: 'Chain', hint: '本回合待结算的连锁序列' },
  resolve: { label: '结算中', latin: 'Resolving', hint: '正在结算的那一张(限 1 张)' },
  pending: { label: '待处理效果', latin: 'Pending', hint: '已触发、等待结算的效果' },
  trash: { label: '弃牌堆', latin: 'Trash', hint: '本回合已进入弃牌堆的卡' },
  base: { label: '基地', latin: 'Base', hint: '场上的基地卡' },
  battlefield: { label: '战场', latin: 'Battlefield', hint: '场上的战场卡' }
});

/** 玩家:上游是 1 / 2 两个单选,这里保持同样的两方模型 */
export type ChainPlayer = 1 | 2;

export const PLAYERS: readonly ChainPlayer[] = Object.freeze([1, 2]);

export const PLAYER_META: Readonly<Record<ChainPlayer, { label: string; short: string }>> =
  Object.freeze({
    1: { label: '玩家 1', short: 'P1' },
    2: { label: '玩家 2', short: 'P2' }
  });

/** 卡片显示模式(上游的「显示模式」:文本 / 图案 / 文本+图案) */
export type CardDisplayMode = 'text' | 'image' | 'both';

export const DISPLAY_MODES: readonly CardDisplayMode[] = Object.freeze(['text', 'image', 'both']);

export const DISPLAY_MODE_LABELS: Readonly<Record<CardDisplayMode, string>> = Object.freeze({
  text: '文本',
  image: '图案',
  both: '文本+图案'
});

/* ──────────────────────── 盘内卡片 ──────────────────────── */

/**
 * 盘内的一张卡(实例,不是卡牌定义)。
 *
 * 之所以把 name / text / category 等「卡牌定义字段」冗余进实例:
 *   - 盘要能离线导出与分享,不能依赖卡表是否已加载;
 *   - 自定义卡没有卡牌定义,必须有自带文本;
 *   - 同卡多实例(卡池拖两次)需要各自独立的 player / uid。
 */
export interface ChainCard {
  /** 盘内唯一实例 id,如 'c-17';不随重排/换区改变 */
  uid: string;
  /** 卡牌编号,如 'OGN-308';自定义卡为 '' */
  cardId: string;
  /** 中文卡名 */
  name: string;
  /** 副标题(sub_title_cn),无则 '' */
  subtitle: string;
  /** 效果文本(只读,供查看;也是控制标记的搜索源) */
  text: string;
  /** 归一化类型:单位 / 法术 / 装备 / 战场 / 传奇 / 符文 … */
  category: string;
  /** 颜色域(red / green / blue / yellow / purple / orange / colorless) */
  colors: readonly string[];
  /** 费用 */
  energy: number;
  /** 战力 */
  power: number;
  /** 所属玩家:决定染色与「结算中」归属 */
  player: ChainPlayer;
  /** 是否为卡库之外的自定义卡(仅自定义卡允许就地改名) */
  custom: boolean;
}

/** 区域状态:卡片列表 + 该区域独立的显示模式 */
export interface ChainAreaState {
  cards: ChainCard[];
  /** 该区独立的显示模式(上游每个容器各有 data-mode) */
  mode: CardDisplayMode;
}

/** 一盘推演的棋盘 */
export interface ChainBoard {
  areas: Record<ChainAreaKey, ChainAreaState>;
  /** 最后修改时间(ms) */
  updatedAt: number;
}

/* ──────────────────────── 盘位(多盘) ──────────────────────── */

/**
 * 一个「盘位」= 一份可命名、可保存的推演。
 *
 * 与上游的差异:上游只有一条隐式记录 + 一份 history;
 * 这里升级为多盘位,因此需要 id / name / savedAt。
 */
export interface ChainPlay {
  id: string;
  name: string;
  createdAt: number;
  /** 最近一次「保存」的时间;null = 从未保存过(仅存在于内存) */
  savedAt: number | null;
  /**
   * 最近一次「保存」时的棋盘。
   *
   * 为什么要把已保存副本随盘位一起留着:
   *   未保存判定需要拿「当前编辑中的棋盘」与「上次保存的棋盘」逐字段比对。
   *   有了它,任何操作(拖拽/删除/改名/改显示模式)都会自动被识别为改动,
   *   无需在每个操作里手动 setDirty(true),也就不会漏标。
   */
  savedBoard: ChainBoard | null;
  board: ChainBoard;
}

/** 盘位内的快照条目(上游的 chain_history 单条) */
export interface ChainSnapshot {
  id: string;
  /** 快照时正在行动的玩家 */
  actor: ChainPlayer;
  /** 动作描述(如「拖入 结算链」),历史列表展示用 */
  action: string;
  /** 快照时刻(ms) */
  ts: number;
  /** 深拷贝的棋盘;历史条目自身即完整状态,不存增量 */
  board: ChainBoard;
}

/** 快照历史上限(上游 MAX_HISTORY = 100) */
export const MAX_HISTORY = 100;

/** 一个盘位的完整工作集(棋盘 + 历史 + 工作态) */
export interface ChainWorkspace {
  board: ChainBoard;
  history: ChainSnapshot[];
  /** 当前处于历史中的位置;位于末尾时 redo 不可用 */
  historyIndex: number;
  /** 当前行动的玩家(上游 currentPlayer) */
  actor: ChainPlayer;
}

/* ──────────────────── 自定义卡池与自定义效果 ──────────────────── */

/** 自定义卡(不属于卡库,纯文本,可拖入任意区域) */
export interface ChainCustomCard {
  id: string;
  name: string;
  /** 可选的效果文本 */
  text: string;
}

/** 自定义「待处理效果」条目(上游 addCustomPending) */
export interface ChainCustomEffect {
  id: string;
  text: string;
}

/* ──────────────────────── 持久化结构 ──────────────────────── */

/** localStorage 顶层结构。带 version 以便未来迁移 */
export interface ChainPersisted {
  version: 1;
  /** 全部盘位(含未保存盘位的空壳) */
  plays: ChainPlay[];
  /** 当前打开的盘位 id */
  currentId: string;
  /** 新区域的默认显示模式(上游初始值:结算链 image,其余 text/both) */
  defaultMode: CardDisplayMode;
  /** 跨盘共享的自定义卡池 */
  customCards: ChainCustomCard[];
  /** 跨盘共享的自定义待处理效果 */
  customEffects: ChainCustomEffect[];
}

/** 当前持久化版本号 */
export const CHAIN_SCHEMA_VERSION = 1 as const;

/** localStorage 键 */
export const CHAIN_STORAGE_KEY = 'rune.chain.v1';

/**
 * 各区域初始显示模式 —— 对齐上游 index.html 里每个容器的 data-mode:
 *   chain=image / resolve=both / pending=text / trash=text / base=text / battlefield=text
 */
export const DEFAULT_AREA_MODES: Readonly<Record<ChainAreaKey, CardDisplayMode>> = Object.freeze({
  chain: 'image',
  resolve: 'both',
  pending: 'text',
  trash: 'text',
  base: 'text',
  battlefield: 'text'
});

/** 「结算中」区域容量上限(上游 maxItems = 1) */
export const RESOLVE_CAPACITY = 1;

/* ──────────────────────── 分享链接 ──────────────────────── */

/** 分享链接参数名:#/chain?s=... */
export const SHARE_PARAM = 's';

/**
 * 分享链接长度闸门。
 * 超过此长度不再生成链接(浏览器/聊天工具会截断,产生打不开的死链),
 * 改为提示「盘太大,请改用导出文件」。
 */
export const SHARE_MAX_LENGTH = 12000;
