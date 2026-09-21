/* ================================================================
 * src/tools/chain/store.ts
 *
 * 结算链推演 —— 盘位与持久化层。
 *
 * 保存语义(经用户确认的方案):
 *   任何操作只改「编辑中的棋盘」(working.board),
 *   是否「未保存」由 working 与盘位的 savedBoard **内容比对**自动判定,
 *   而不是靠每个操作手动打脏标记 —— 这样不会漏标,也不会误标。
 *   用户按「保存」才把 working 写进盘位并落 localStorage。
 *
 * 多盘位:
 *   全部盘位常驻本机 localStorage(键 rune.chain.v1)。
 *   新建盘位立即落盘一个空壳,保证盘位列表在刷新后依然稳定存在。
 *
 * 历史(撤销/重做):
 *   与上游一致 —— 快照记录「动作执行完之后」的棋盘,游标可前后移动。
 *   历史上限 MAX_HISTORY = 100。历史是过程数据,不落 localStorage。
 * ============================================================== */

import { computed, reactive, readonly } from 'vue';
import {
  CHAIN_STORAGE_KEY,
  SHARE_PARAM,
  SHARE_MAX_LENGTH,
  type CardDisplayMode,
  type ChainAreaKey,
  type ChainBoard,
  type ChainCustomCard,
  type ChainCustomEffect,
  type ChainPersisted,
  type ChainPlayer,
  type ChainPlay,
  type ChainSnapshot,
  type ChainWorkspace
} from './types';
import {
  cloneBoard,
  countCards,
  emptyBoard,
  encodeShare,
  makeId,
  moveCard,
  newPlay,
  pushSnapshot,
  stepHistory,
  validatePersisted
} from './board';

/* ──────────────────────── 响应式状态 ──────────────────────── */

export interface ChainStoreState {
  /** 是否已完成初始化(localStorage 读取只做一次) */
  ready: boolean;
  /** 全部盘位 */
  plays: ChainPlay[];
  /** 当前打开的盘位 id */
  currentId: string;
  /** 跨盘共享的自定义卡池 */
  customCards: ChainCustomCard[];
  /** 跨盘共享的自定义待处理效果 */
  customEffects: ChainCustomEffect[];
  /** 新区域的默认显示模式 */
  defaultMode: CardDisplayMode;
  /** 编辑中的工作集 */
  working: ChainWorkspace;
  /** 操作撤销记录独立于用户手动保存的快照。 */
  undoHistory: ChainSnapshot[];
  undoIndex: number;
  /** 最近一次操作反馈(toast 文案) */
  notice: string;
  /** 提示语是否属于错误(红色显示) */
  noticeIsError: boolean;
  /** 当前盘位是否来自分享链接(顶部显示「临时盘」横幅) */
  sharedTemp: boolean;
}

const state = reactive<ChainStoreState>({
  ready: false,
  plays: [],
  currentId: '',
  customCards: [],
  customEffects: [],
  defaultMode: 'image',
  working: {
    board: emptyBoard(),
    history: [],
    historyIndex: -1,
    actor: 1
  },
  undoHistory: [],
  undoIndex: -1,
  notice: '',
  noticeIsError: false,
  sharedTemp: false
});

/**
 * 组件只读入口。
 * 运行时用 readonly() 包一层真拦截,类型上用显式断言保持可读性 ——
 * 组件永远只调本文件导出的动作函数,不直接改 state。
 */
export const chainStore = readonly(state) as ChainStoreState;

/* ──────────────────────── 提示语 ──────────────────────── */

let noticeTimer: ReturnType<typeof setTimeout> | null = null;

export function notify(message: string, isError = false): void {
  state.notice = message;
  state.noticeIsError = isError;
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    state.notice = '';
    state.noticeIsError = false;
    noticeTimer = null;
  }, 2600);
}

/* ──────────────────────── 派生量 ──────────────────────── */

export const currentPlay = computed<ChainPlay | null>(
  () => state.plays.find((p) => p.id === state.currentId) ?? null
);

/**
 * 未保存判定。
 *
 * 逐字段比对而不是打脏标记,因此「自定义卡就地改名」「区域显示模式切换」
 * 这类不经过拖拽的改动同样能被捕捉到。
 * 尚未有保存副本的盘(理论上只有分享临时盘会走到)则以「是否有内容」判定。
 */
export const dirty = computed<boolean>(() => {
  const play = currentPlay.value;
  if (!play) return false;
  if (!play.savedBoard) return countCards(play.board) > 0;
  return JSON.stringify(play.board) !== JSON.stringify(play.savedBoard);
});

/** 模板层友好命名 */
export function hasUnsavedChanges(): boolean {
  return dirty.value;
}

/** 当前盘位的总卡数(顶栏展示) */
export const boardCardCount = computed<number>(() => countCards(state.working.board));

/** 撤销/重做可用性 */
export const canUndo = computed<boolean>(() => state.undoIndex > 0);
export const canRedo = computed<boolean>(() => state.undoIndex >= 0 && state.undoIndex < state.undoHistory.length - 1);

/* ──────────────────────── localStorage ──────────────────────── */

function snapshotForPersist(): ChainPersisted {
  return {
    version: 1,
    plays: state.plays.map(
      (p): ChainPlay => ({
        id: p.id,
        name: p.name,
        createdAt: p.createdAt,
        savedAt: p.savedAt,
        // 已保存副本落盘无意义且占空间,读回时按 board 重建
        savedBoard: null,
        board: p.board
      })
    ),
    currentId: state.currentId,
    defaultMode: state.defaultMode,
    customCards: state.customCards,
    customEffects: state.customEffects
  };
}

function persist(): boolean {
  try {
    localStorage.setItem(CHAIN_STORAGE_KEY, JSON.stringify(snapshotForPersist()));
    return true;
  } catch (err) {
    // 配额溢出是最可能的失败原因,给出可执行的建议而不是静默失败
    const isQuota =
      err instanceof DOMException &&
      (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED');
    notify(
      isQuota
        ? '本机存储已满,无法保存:请删除不用的盘位,或导出 JSON 后清空'
        : '本机存储写入失败:浏览器可能禁用了 localStorage',
      true
    );
    return false;
  }
}

/** 造一个「已保存且干净」的空盘位 */
function pristinePlay(name: string): ChainPlay {
  const play = newPlay(name);
  play.savedAt = Date.now();
  play.savedBoard = cloneBoard(play.board);
  return play;
}

/** 从 localStorage 装载。首次进入或数据损坏时建一个默认盘位 */
export function initChainStore(): void {
  if (state.ready) return;

  let persisted: ChainPersisted | null = null;
  try {
    const raw = localStorage.getItem(CHAIN_STORAGE_KEY);
    if (raw) persisted = validatePersisted(JSON.parse(raw) as unknown);
  } catch {
    persisted = null;
  }

  if (persisted && persisted.plays.length > 0) {
    // 读回的盘位没有 savedBoard(落盘时被剥掉),用其 board 自身重建 ——
    // 于是「刚打开时一定是干净的」,符合直觉。
    state.plays = persisted.plays.map((p): ChainPlay => ({ ...p, savedBoard: cloneBoard(p.board) }));
    state.currentId = persisted.currentId || (state.plays[0]?.id ?? '');
    state.customCards = persisted.customCards;
    state.customEffects = persisted.customEffects;
    state.defaultMode = persisted.defaultMode;
  } else {
    const play = pristinePlay('第一局推演');
    state.plays = [play];
    state.currentId = play.id;
    persist();
  }

  const play = currentPlay.value;
  if (play) state.working.board = cloneBoard(play.board);
  state.ready = true;
}

/* ──────────────────────── 盘位操作 ──────────────────────── */

/** 盘位名去重:重名时自动补序号,避免列表里出现两个同名盘 */
function uniqueName(base: string): string {
  const names = new Set(state.plays.map((p) => p.name));
  if (!names.has(base)) return base;
  let i = 2;
  while (names.has(`${base} ${i}`)) i += 1;
  return `${base} ${i}`;
}

/** 切换盘位。调用方**必须**先用 hasUnsavedChanges() 确认,本函数不做拦截 */
export function switchPlay(id: string): void {
  if (id === state.currentId) return;
  const target = state.plays.find((p) => p.id === id);
  if (!target) return;
  state.currentId = id;
  state.working.board = cloneBoard(target.board);
  state.working.history = [];
  state.working.historyIndex = -1;
  state.working.actor = 1;
  state.undoHistory = [];
  state.undoIndex = -1;
  state.sharedTemp = false;
  notify(`已切换到「${target.name}」`);
}

/** 新建盘位(立即落盘空壳,使列表在刷新后稳定存在) */
export function createPlay(name?: string): string {
  const play = pristinePlay(uniqueName(name?.trim() || `推演 ${state.plays.length + 1}`));
  state.plays.push(play);
  persist();
  switchPlay(play.id);
  notify(`已新建「${play.name}」`);
  return play.id;
}

/** 把当前编辑中的棋盘另存为一个新盘位 */
export function duplicatePlay(id = state.currentId): string {
  const src = state.plays.find((p) => p.id === id);
  if (!src) return '';
  const board = cloneBoard(state.working.board);
  const copy: ChainPlay = {
    id: makeId('play'),
    name: uniqueName(`${src.name} 副本`),
    createdAt: Date.now(),
    savedAt: Date.now(),
    savedBoard: board,
    board: cloneBoard(board)
  };
  state.plays.push(copy);
  persist();
  switchPlay(copy.id);
  notify(`已复制为「${copy.name}」`);
  return copy.id;
}

/** 重命名盘位(不立即落盘,属于「未保存改动」的一部分) */
export function renamePlay(id: string, name: string): void {
  const play = state.plays.find((p) => p.id === id);
  const trimmed = name.trim();
  if (!play || !trimmed) return;
  play.name = trimmed;
}

/**
 * 保存当前盘位:把编辑中的棋盘与盘名写进盘位,并同步 savedBoard。
 * 这是唯一会「消除未保存状态」的动作(放弃改动除外)。
 */
export function savePlay(): boolean {
  const play = currentPlay.value;
  if (!play) return false;
  // 盘名在编辑期可能被改成空或与他人重名,统一收口
  play.name = uniqueName(play.name.trim() || '未命名推演');
  play.board = cloneBoard(state.working.board);
  play.savedBoard = cloneBoard(state.working.board);
  play.savedAt = Date.now();
  const ok = persist();
  if (ok) {
    state.sharedTemp = false;
    notify('已保存到本机');
  }
  return ok;
}

/** 放弃未保存改动(回滚到上次保存的状态) */
export function discardChanges(): void {
  const play = currentPlay.value;
  if (!play) return;
  const restore = cloneBoard(play.savedBoard ?? play.board);
  state.working.board = restore;
  play.board = cloneBoard(restore);
  state.working.history = [];
  state.working.historyIndex = -1;
  state.undoHistory = [];
  state.undoIndex = -1;
  notify('已放弃未保存的改动');
}

/** 删除盘位。删的是最后一盘时自动补一个空盘,避免出现「无盘可用」 */
export function deletePlay(id: string): void {
  const idx = state.plays.findIndex((p) => p.id === id);
  if (idx < 0) return;
  const wasCurrent = state.currentId === id;
  const [removed] = state.plays.splice(idx, 1);

  if (state.plays.length === 0) {
    const play = pristinePlay('第一局推演');
    state.plays.push(play);
    state.currentId = play.id;
    state.working.board = cloneBoard(play.board);
  } else if (wasCurrent) {
    const fallback = state.plays[Math.max(0, idx - 1)] ?? state.plays[0];
    if (fallback) {
      state.currentId = fallback.id;
      state.working.board = cloneBoard(fallback.board);
    }
  }
  state.working.history = [];
  state.working.historyIndex = -1;
  state.undoHistory = [];
  state.undoIndex = -1;
  persist();
  notify(`已删除「${removed?.name ?? '盘位'}」`);
}

/* ──────────────────────── 工作集与历史 ──────────────────────── */

/**
 * 统一的「改动入口」。
 *
 * 所有棋盘变更都必须经过这里,好处有三:
 *   1. 自动把改动写进 working.board 与盘位的 board(未保存状态随之出现);
 *   2. 将操作记入独立的撤销栈,不向手动快照列表添加记录。
 *
 * @param next   变更后的棋盘(由 board.ts 的纯函数产出)
 * @param action 动作描述,用于撤销反馈
 */
export function commitBoard(next: ChainBoard, action: string): void {
  const play = currentPlay.value;
  if (!play) return;

  if (state.undoHistory.length === 0) {
    const base = pushSnapshot([], -1, state.working.board, '初始状态', state.working.actor);
    state.undoHistory = base.history;
    state.undoIndex = base.historyIndex;
  }
  const result = pushSnapshot(state.undoHistory, state.undoIndex, next, action, state.working.actor);
  state.undoHistory = result.history;
  state.undoIndex = result.historyIndex;
  state.working.historyIndex = -1;

  state.working.board = next;
  play.board = next;
}

/** 撤销 */
export function undo(): boolean {
  const stepped = stepHistory(state.undoHistory, state.undoIndex, -1);
  if (!stepped) {
    notify('已经是最早的状态');
    return false;
  }
  state.undoIndex = stepped.index;
  state.working.historyIndex = -1;
  applyWorkingBoard(stepped.board);
  notify(`已撤销:${state.undoHistory[stepped.index]?.action ?? ''}`);
  return true;
}

/** 重做 */
export function redo(): boolean {
  const stepped = stepHistory(state.undoHistory, state.undoIndex, 1);
  if (!stepped) {
    notify('没有可重做的操作');
    return false;
  }
  state.undoIndex = stepped.index;
  state.working.historyIndex = -1;
  applyWorkingBoard(stepped.board);
  notify(`已重做:${state.undoHistory[stepped.index]?.action ?? ''}`);
  return true;
}

function applyWorkingBoard(board: ChainBoard): void {
  state.working.board = board;
  const play = currentPlay.value;
  if (play) play.board = board;
}

/**
 * 手动存一个快照(Ctrl+S)。
 * 与「保存到本机」是两件事:快照进历史列表,保存进 localStorage。
 */
export function pushManualSnapshot(label = '手动快照'): void {
  const result = pushSnapshot(
    state.working.history,
    state.working.history.length - 1,
    state.working.board,
    label,
    state.working.actor
  );
  state.working.history = result.history;
  state.working.historyIndex = result.historyIndex;
  notify(`已存快照(共 ${state.working.history.length} 条)`);
}

/** 跳到历史中的某一条 */
export function jumpToSnapshot(index: number): void {
  const snap: ChainSnapshot | undefined = state.working.history[index];
  if (!snap) return;
  commitBoard(cloneBoard(snap.board), `恢复快照「${snap.action}」`);
  state.working.historyIndex = index;
  notify(`已回到「${snap.action}」`);
}

/** 清空当前盘位的历史(不影响棋盘内容) */
export function clearHistory(): void {
  state.working.history = [];
  state.working.historyIndex = -1;
  state.undoHistory = [];
  state.undoIndex = -1;
  notify('已清空历史记录');
}

/** 切换当前行动玩家 */
export function setActor(player: ChainPlayer): void {
  state.working.actor = player;
}

/** 设置默认显示模式(新区域的初始值) */
export function setDefaultMode(mode: CardDisplayMode): void {
  state.defaultMode = mode;
}

/* ──────────────────────── 自定义卡 / 自定义效果 ──────────────────────── */

export function addCustomCard(name: string, text = ''): ChainCustomCard | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const card: ChainCustomCard = { id: makeId('cc'), name: trimmed, text: text.trim() };
  state.customCards.push(card);
  persist();
  return card;
}

export function removeCustomCard(id: string): void {
  const i = state.customCards.findIndex((c) => c.id === id);
  if (i >= 0) {
    state.customCards.splice(i, 1);
    persist();
  }
}

export function addCustomEffect(text: string): ChainCustomEffect | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const effect: ChainCustomEffect = { id: makeId('ce'), text: trimmed };
  state.customEffects.push(effect);
  persist();
  return effect;
}

export function removeCustomEffect(id: string): void {
  const i = state.customEffects.findIndex((e) => e.id === id);
  if (i >= 0) {
    state.customEffects.splice(i, 1);
    persist();
  }
}

/** 合并导入文件带来的自定义池(按文本去重) */
export function mergeCustomPools(
  cards: readonly ChainCustomCard[],
  effects: readonly ChainCustomEffect[]
): void {
  const cardNames = new Set(state.customCards.map((c) => c.name));
  for (const c of cards) {
    if (cardNames.has(c.name)) continue;
    state.customCards.push({ id: makeId('cc'), name: c.name, text: c.text });
    cardNames.add(c.name);
  }
  const effectTexts = new Set(state.customEffects.map((e) => e.text));
  for (const e of effects) {
    if (effectTexts.has(e.text)) continue;
    state.customEffects.push({ id: makeId('ce'), text: e.text });
    effectTexts.add(e.text);
  }
  persist();
}

/* ──────────────────────── 导入 / 分享 ──────────────────────── */

/**
 * 把外部棋盘导入为**新盘位**(不动当前盘,避免覆盖用户正在做的事)。
 * @param shared 是否来自分享链接;是则标记为临时盘,顶部显示提示横幅
 */
export function importBoardAsNewPlay(name: string, board: ChainBoard, shared = false, history: readonly ChainSnapshot[] = []): string {
  const copied = cloneBoard(board);
  const play: ChainPlay = {
    id: makeId('play'),
    name: uniqueName(name.trim() || '导入的推演'),
    createdAt: Date.now(),
    savedAt: shared ? null : Date.now(),
    savedBoard: copied,
    board: cloneBoard(copied)
  };
  state.plays.push(play);
  state.currentId = play.id;
  state.working.board = cloneBoard(copied);
  state.working.history = history.map(snap => ({ ...snap, board: cloneBoard(snap.board) }));
  state.working.historyIndex = -1;
  state.undoHistory = [];
  state.undoIndex = -1;
  state.sharedTemp = shared;
  persist();
  return play.id;
}

export interface ShareLinkResult {
  ok: boolean;
  url: string;
  /** 失败原因(直接可展示) */
  reason: string;
}

/**
 * 生成分享链接。
 *
 * 长度闸门:编码后超过 SHARE_MAX_LENGTH 时不生成链接 ——
 * 超长 URL 会被聊天工具与浏览器截断,产生「打不开的死链」,
 * 那比直接告诉用户「请改用导出文件」更糟。
 */
export async function buildShareLink(): Promise<ShareLinkResult> {
  const encoded = await encodeShare(state.working.board);
  const url = `${window.location.origin}${window.location.pathname}#/chain?${SHARE_PARAM}=${encoded}`;
  if (url.length > SHARE_MAX_LENGTH) {
    return {
      ok: false,
      url: '',
      reason: `盘太大(链接 ${url.length} 字符,上限 ${SHARE_MAX_LENGTH}),请改用「导出 JSON」发给对方`
    };
  }
  return { ok: true, url, reason: '' };
}

/* ──────────────────────── 离开页面保护 ──────────────────────── */

let beforeUnloadBound = false;

/**
 * 绑定「关页/刷新」原生拦截,只在有未保存改动时真正弹确认框
 * (浏览器只允许给通用文案,无法自定义)。
 * 返回解绑函数。
 */
export function bindBeforeUnload(): () => void {
  if (beforeUnloadBound) return () => undefined;
  beforeUnloadBound = true;
  const handler = (e: BeforeUnloadEvent): void => {
    if (!hasUnsavedChanges()) return;
    e.preventDefault();
    e.returnValue = '';
  };
  window.addEventListener('beforeunload', handler);
  return () => {
    window.removeEventListener('beforeunload', handler);
    beforeUnloadBound = false;
  };
}

/* ──────────────────────── 视图层用的动作转发 ──────────────────────── */

/**
 * 移动卡并提交。
 * 容量限制的提示在这里收口(视图不必重复判断),未发生实际变化时不记历史。
 */
export function commitMove(
  uid: string,
  toArea: ChainAreaKey,
  toIndex: number | null,
  capacity: number
): void {
  const result = moveCard(state.working.board, uid, toArea, toIndex, capacity);
  if (result.rejected) {
    notify(`「${result.rejected}」无法放入:该区域已满`, true);
    return;
  }
  if (!result.changed) return;
  commitBoard(result.board, `移动卡牌至 ${toArea}`);
}
