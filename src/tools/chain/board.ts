/* ================================================================
 * src/tools/chain/board.ts
 *
 * 结算链推演 —— 纯函数层(零副作用、零 DOM、零 Vue)。
 *
 * 为什么要把棋盘操作全部做成纯函数:
 *   1. 拖拽是「人手改 DOM」的操作,必须有一层状态真相来收敛它——
 *      SortableJS 的结果最终都要翻译成这里的函数调用,单向数据流。
 *   2. 撤销/重做依赖深拷贝快照,纯函数天然可枚举、可测试。
 *   3. 外部输入(导入文件、URL 分享链接)必须经过 validateBoard 校验,
 *      非法输入一律拒绝,绝不让坏数据进入响应式状态。
 *
 * 约定:所有返回 ChainBoard 的函数都**返回新对象**,不就地修改入参。
 * ============================================================== */

import {
  AREA_ORDER,
  CHAIN_SCHEMA_VERSION,
  DEFAULT_AREA_MODES,
  MAX_HISTORY,
  type CardDisplayMode,
  type ChainAreaKey,
  type ChainAreaState,
  type ChainBoard,
  type ChainCard,
  type ChainCustomCard,
  type ChainCustomEffect,
  type ChainPersisted,
  type ChainPlay,
  type ChainPlayer,
  type ChainSnapshot
} from './types';

/* ──────────────────────── 基础工具 ──────────────────────── */

/** 深拷贝棋盘(快照用)。structuredClone 在卡表字段上足够,但这里用 JSON 兜底更稳 */
export function cloneBoard(board: ChainBoard): ChainBoard {
  return JSON.parse(JSON.stringify(board)) as ChainBoard;
}

/** 生成唯一 id。用时间戳 + 随机后缀,避免同毫秒内碰撞 */
export function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}

/** 盘内卡实例的下一个 uid */
function nextUid(board: ChainBoard): string {
  let max = 0;
  for (const key of AREA_ORDER) {
    for (const card of board.areas[key].cards) {
      const m = /^c-(\d+)$/.exec(card.uid);
      if (m && m[1]) max = Math.max(max, Number(m[1]));
    }
  }
  return `c-${max + 1}`;
}

/** 安全取区域状态(noUncheckedIndexedAccess 下 Record 索引仍可能 undefined) */
export function areaOf(board: ChainBoard, key: ChainAreaKey): ChainAreaState {
  return board.areas[key];
}

/** 清空棋盘的所有卡片,保留各区域显示模式 */
export function emptyBoard(): ChainBoard {
  const areas = {} as Record<ChainAreaKey, ChainAreaState>;
  for (const key of AREA_ORDER) {
    areas[key] = { cards: [], mode: DEFAULT_AREA_MODES[key] };
  }
  return { areas, updatedAt: Date.now() };
}

/** 新建一个盘位(尚未保存;savedAt = null) */
export function newPlay(name: string): ChainPlay {
  return {
    id: makeId('play'),
    name,
    createdAt: Date.now(),
    savedAt: null,
    savedBoard: null,
    board: emptyBoard(),
    history: []
  };
}

/** 统计一盘总卡数(顶栏与盘位列表展示用) */
export function countCards(board: ChainBoard): number {
  let n = 0;
  for (const key of AREA_ORDER) n += board.areas[key].cards.length;
  return n;
}

/* ──────────────────────── 增删 ──────────────────────── */

/**
 * 把一张卡牌定义克隆成盘内实例并放入目标区。
 * 用于「从卡池拖入」——卡池里的卡是模板,拖入即生成新实例。
 */
export function cloneCardFromPool(
  board: ChainBoard,
  source: Omit<ChainCard, 'uid' | 'player' | 'custom'>,
  toArea: ChainAreaKey,
  toIndex: number | null,
  player: ChainPlayer
): ChainBoard {
  const card: ChainCard = { ...source, uid: nextUid(board), player, custom: false };
  return insertCard(board, card, toArea, toIndex);
}

/** 把一张自定义卡(模板)克隆成盘内实例并放入目标区 */
export function customCardFromPool(
  board: ChainBoard,
  source: ChainCustomCard,
  toArea: ChainAreaKey,
  toIndex: number | null,
  player: ChainPlayer
): ChainBoard {
  const card: ChainCard = {
    uid: nextUid(board),
    cardId: '',
    name: source.name,
    subtitle: '',
    text: source.text,
    category: '自定义',
    colors: [],
    energy: 0,
    power: 0,
    player,
    custom: true
  };
  return insertCard(board, card, toArea, toIndex);
}

/** 生成一个纯文本条目作为盘内卡实例(自定义待处理效果用) */
export function textCard(
  board: ChainBoard,
  text: string,
  player: ChainPlayer
): ChainCard {
  return {
    uid: nextUid(board),
    cardId: '',
    name: text,
    subtitle: '',
    text: '',
    category: '自定义',
    colors: [],
    energy: 0,
    power: 0,
    player,
    custom: true
  };
}

/** 插入一张已构造好的实例卡 */
export function insertCard(
  board: ChainBoard,
  card: ChainCard,
  toArea: ChainAreaKey,
  toIndex: number | null
): ChainBoard {
  const next = cloneBoard(board);
  const list = next.areas[toArea].cards;
  const index = toIndex === null || toIndex < 0 || toIndex > list.length ? list.length : toIndex;
  list.splice(index, 0, card);
  next.updatedAt = Date.now();
  return next;
}

/** 从任意区域移除一张卡(按 uid 全局查找,不要求调用方知道它在哪个区) */
export function removeCard(board: ChainBoard, uid: string): ChainBoard {
  const next = cloneBoard(board);
  for (const key of AREA_ORDER) {
    const list = next.areas[key].cards;
    const i = list.findIndex((c) => c.uid === uid);
    if (i >= 0) {
      list.splice(i, 1);
      next.updatedAt = Date.now();
      return next;
    }
  }
  return next;
}

/** 清空指定区域 */
export function clearArea(board: ChainBoard, area: ChainAreaKey): ChainBoard {
  const next = cloneBoard(board);
  next.areas[area].cards = [];
  next.updatedAt = Date.now();
  return next;
}

/** 清空整盘 */
export function clearBoard(board: ChainBoard): ChainBoard {
  const next = cloneBoard(board);
  for (const key of AREA_ORDER) next.areas[key].cards = [];
  next.updatedAt = Date.now();
  return next;
}

/* ──────────────────────── 移动与重排 ──────────────────────── */

export interface MoveResult {
  board: ChainBoard;
  /** 是否真的发生了变化(拖回原位时为 false,用于决定要不要记历史) */
  changed: boolean;
  /** 被容量限制退回的卡名(结算中溢出时非空,供 toast 提示) */
  rejected: string | null;
}

/**
 * 盘内移动 / 重排 / 换玩家。
 *
 * @param uid      被移动卡的实例 id
 * @param toArea   目标区域
 * @param toIndex  目标位置(SortableJS 的 newIndex);null = 追加到末尾
 * @param capacity 目标区容量上限;超出时该卡原样退回(不报错,由调用方提示)
 */
export function moveCard(
  board: ChainBoard,
  uid: string,
  toArea: ChainAreaKey,
  toIndex: number | null,
  capacity = Number.POSITIVE_INFINITY
): MoveResult {
  let fromArea: ChainAreaKey | null = null;
  let card: ChainCard | null = null;
  let fromIndex = -1;

  for (const key of AREA_ORDER) {
    const i = board.areas[key].cards.findIndex((c) => c.uid === uid);
    if (i >= 0) {
      fromArea = key;
      fromIndex = i;
      card = board.areas[key].cards[i] ?? null;
      break;
    }
  }
  if (!fromArea || !card) return { board, changed: false, rejected: null };

  const next = cloneBoard(board);
  const list = next.areas[toArea].cards;

  // 同区内的「落回原位」判定:移除自身后,目标下标要相应左移一位,
  // 否则从前往后拖会差一位(经典 off-by-one)。
  if (fromArea === toArea) {
    const sameList = next.areas[toArea].cards;
    const selfIndex = sameList.findIndex((c) => c.uid === uid);
    let index = toIndex === null ? sameList.length - 1 : toIndex;
    if (index > selfIndex) index -= 1;
    if (index === selfIndex) return { board, changed: false, rejected: null };
    const [moved] = sameList.splice(selfIndex, 1);
    if (!moved) return { board, changed: false, rejected: null };
    sameList.splice(Math.max(0, Math.min(index, sameList.length)), 0, moved);
    next.updatedAt = Date.now();
    return { board: next, changed: true, rejected: null };
  }

  // 跨区容量检查:超出则原样退回
  if (list.length >= capacity) {
    return { board, changed: false, rejected: card.name };
  }

  next.areas[fromArea].cards.splice(fromIndex, 1);
  const index = toIndex === null || toIndex < 0 || toIndex > list.length ? list.length : toIndex;
  list.splice(index, 0, card);
  next.updatedAt = Date.now();
  return { board: next, changed: true, rejected: null };
}

/** 按 DOM 顺序重排某区域(拖拽结束后,以用户看到的顺序为准) */
export function reorderArea(board: ChainBoard, area: ChainAreaKey, uids: readonly string[]): ChainBoard {
  const next = cloneBoard(board);
  const byUid = new Map(next.areas[area].cards.map((c) => [c.uid, c]));
  const ordered: ChainCard[] = [];
  for (const uid of uids) {
    const card = byUid.get(uid);
    if (card) {
      ordered.push(card);
      byUid.delete(uid);
    }
  }
  // 兜底:DOM 里没出现但状态里有的卡(理论上不该发生)保持原相对顺序追加,
  // 保证「重排」永远不会丢卡。
  for (const rest of byUid.values()) ordered.push(rest);
  next.areas[area].cards = ordered;
  next.updatedAt = Date.now();
  return next;
}

/** 改单张卡的归属玩家 */
export function setCardPlayer(board: ChainBoard, uid: string, player: ChainPlayer): ChainBoard {
  const next = cloneBoard(board);
  for (const key of AREA_ORDER) {
    const card = next.areas[key].cards.find((c) => c.uid === uid);
    if (card) {
      card.player = player;
      next.updatedAt = Date.now();
      return next;
    }
  }
  return next;
}

/** 重命名自定义卡(仅自定义卡允许) */
export function renameCard(board: ChainBoard, uid: string, name: string): ChainBoard {
  const next = cloneBoard(board);
  for (const key of AREA_ORDER) {
    const card = next.areas[key].cards.find((c) => c.uid === uid);
    if (card && card.custom) {
      card.name = name;
      next.updatedAt = Date.now();
      return next;
    }
  }
  return next;
}

/** 设置某区域显示模式 */
export function setAreaMode(
  board: ChainBoard,
  area: ChainAreaKey,
  mode: CardDisplayMode
): ChainBoard {
  const next = cloneBoard(board);
  next.areas[area].mode = mode;
  next.updatedAt = Date.now();
  return next;
}

/** 批量设置全部区域显示模式 */
export function setAllAreaModes(board: ChainBoard, mode: CardDisplayMode): ChainBoard {
  const next = cloneBoard(board);
  for (const key of AREA_ORDER) next.areas[key].mode = mode;
  next.updatedAt = Date.now();
  return next;
}

/* ──────────────────────── 快照历史 ──────────────────────── */

export interface HistoryResult {
  history: ChainSnapshot[];
  historyIndex: number;
}

/**
 * 记录一个快照。
 * 语义:快照代表「该动作执行完之后」的棋盘状态;
 * 历史数组被截断到当前游标处再追加(标准的撤销栈行为)。
 */
export function pushSnapshot(
  history: readonly ChainSnapshot[],
  historyIndex: number,
  board: ChainBoard,
  action: string,
  actor: ChainPlayer
): HistoryResult {
  const kept = history.slice(0, historyIndex + 1);
  kept.push({
    id: makeId('snap'),
    action,
    actor,
    ts: Date.now(),
    board: cloneBoard(board)
  });
  // 超上限时丢弃最旧的
  const trimmed = kept.length > MAX_HISTORY ? kept.slice(kept.length - MAX_HISTORY) : kept;
  return { history: trimmed, historyIndex: trimmed.length - 1 };
}

/**
 * 游标移动(撤销 = -1,重做 = +1)。
 * 返回新的游标与对应棋盘;越界时返回 null 表示不可移动。
 */
export function stepHistory(
  history: readonly ChainSnapshot[],
  historyIndex: number,
  delta: number
): { index: number; board: ChainBoard } | null {
  const target = historyIndex + delta;
  const snap = history[target];
  if (!snap) return null;
  return { index: target, board: cloneBoard(snap.board) };
}

/* ──────────────────── 外部输入校验 ──────────────────── */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function asNumber(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function asPlayer(v: unknown): ChainPlayer {
  return v === 2 ? 2 : 1;
}

function asMode(v: unknown, fallback: CardDisplayMode): CardDisplayMode {
  return v === 'text' || v === 'image' || v === 'both' ? v : fallback;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function validateCard(raw: unknown): ChainCard | null {
  if (!isRecord(raw)) return null;
  const uid = asString(raw.uid);
  const name = asString(raw.name);
  // uid 与 name 是渲染的最小必需字段,缺一不可
  if (!uid || !name) return null;
  return {
    uid,
    cardId: asString(raw.cardId),
    name,
    subtitle: asString(raw.subtitle),
    text: asString(raw.text),
    category: asString(raw.category, '其他'),
    colors: asStringArray(raw.colors),
    energy: asNumber(raw.energy),
    power: asNumber(raw.power),
    player: asPlayer(raw.player),
    custom: raw.custom === true || asString(raw.cardId) === ''
  };
}

/**
 * 校验并归一化一个棋盘。
 *
 * 严格程度:结构不对(非对象 / 区域不是对象)→ 返回 null 拒绝;
 * 单张卡有问题 → 跳过该卡而不是整盘拒绝(容错优于全废)。
 * uid 重复 → 保留首个,避免同 uid 导致移动错卡。
 */
export function validateBoard(raw: unknown): ChainBoard | null {
  if (!isRecord(raw)) return null;
  const rawAreas = raw.areas;
  if (!isRecord(rawAreas)) return null;

  const areas = {} as Record<ChainAreaKey, ChainAreaState>;
  for (const key of AREA_ORDER) {
    const rawArea = rawAreas[key];
    const fallbackMode = DEFAULT_AREA_MODES[key];
    if (!isRecord(rawArea)) {
      areas[key] = { cards: [], mode: fallbackMode };
      continue;
    }
    const rawCards = Array.isArray(rawArea.cards) ? rawArea.cards : [];
    const seen = new Set<string>();
    const cards: ChainCard[] = [];
    for (const rc of rawCards) {
      const card = validateCard(rc);
      if (!card || seen.has(card.uid)) continue;
      seen.add(card.uid);
      cards.push(card);
    }
    areas[key] = { cards, mode: asMode(rawArea.mode, fallbackMode) };
  }
  return { areas, updatedAt: asNumber(raw.updatedAt, Date.now()) };
}

function validateCustomCards(raw: unknown): ChainCustomCard[] {
  if (!Array.isArray(raw)) return [];
  const out: ChainCustomCard[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const name = asString(item.name);
    if (!name) continue;
    out.push({ id: asString(item.id, makeId('cc')), name, text: asString(item.text) });
  }
  return out;
}

function validateCustomEffects(raw: unknown): ChainCustomEffect[] {
  if (!Array.isArray(raw)) return [];
  const out: ChainCustomEffect[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const text = asString(item.text ?? item.name);
    if (!text) continue;
    out.push({ id: asString(item.id, makeId('ce')), text });
  }
  return out;
}

function validatePlay(raw: unknown, index: number): ChainPlay | null {
  if (!isRecord(raw)) return null;
  const board = validateBoard(raw.board);
  if (!board) return null;
  return {
    id: asString(raw.id, `play-imported-${index}`),
    name: asString(raw.name, `推演 ${index + 1}`),
    createdAt: asNumber(raw.createdAt, Date.now()),
    savedAt: typeof raw.savedAt === 'number' ? raw.savedAt : null,
    // 落盘时 savedBoard 被剥掉;读回后由 store 用 board 重建,
    // 于是「刚打开时一定是干净的」。
    savedBoard: null,
    board,
    history: validateSnapshots(raw.history)
  };
}

/** localStorage 内容校验:整体非法时回退为 null,由 store 决定建默认盘 */
export function validatePersisted(raw: unknown): ChainPersisted | null {
  if (!isRecord(raw)) return null;
  if (raw.version !== CHAIN_SCHEMA_VERSION) return null;

  const rawPlays = Array.isArray(raw.plays) ? raw.plays : [];
  const plays: ChainPlay[] = [];
  rawPlays.forEach((p, i) => {
    const play = validatePlay(p, i);
    if (play) plays.push(play);
  });

  const currentId = asString(raw.currentId);
  return {
    version: CHAIN_SCHEMA_VERSION,
    plays,
    currentId: plays.some((p) => p.id === currentId) ? currentId : (plays[0]?.id ?? ''),
    defaultMode: asMode(raw.defaultMode, 'image'),
    customCards: validateCustomCards(raw.customCards),
    customEffects: validateCustomEffects(raw.customEffects)
  };
}

/* ──────────────────────── 导入 / 导出 ──────────────────────── */

/** 导出文件格式标识,避免用户把别的 JSON 拖进来 */
export const CHAIN_EXPORT_KIND = 'rune-chain-board';

export interface ChainExportFile {
  kind: typeof CHAIN_EXPORT_KIND;
  version: 1;
  exportedAt: string;
  name: string;
  board: ChainBoard;
  customCards: ChainCustomCard[];
  customEffects: ChainCustomEffect[];
  history: ChainSnapshot[];
}

export function buildExportFile(
  name: string,
  board: ChainBoard,
  customCards: readonly ChainCustomCard[],
  customEffects: readonly ChainCustomEffect[],
  history: readonly ChainSnapshot[] = []
): ChainExportFile {
  return {
    kind: CHAIN_EXPORT_KIND,
    version: CHAIN_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    name,
    board: cloneBoard(board),
    customCards: [...customCards],
    customEffects: [...customEffects],
    history: history.map(snap => ({ ...snap, board: cloneBoard(snap.board) }))
  };
}

export interface ImportResult {
  ok: boolean;
  /** 失败原因(直接可展示给用户) */
  error: string;
  name: string;
  board: ChainBoard | null;
  customCards: ChainCustomCard[];
  customEffects: ChainCustomEffect[];
  history: ChainSnapshot[];
}

function validateSnapshots(raw: unknown): ChainSnapshot[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(-MAX_HISTORY).flatMap((value, index) => {
    if (!isRecord(value)) return [];
    const board = validateBoard(value.board);
    if (!board) return [];
    return [{ id: `import-snapshot-${index}`, actor: value.actor === 2 ? 2 : 1,
      action: asString(value.action, '手动快照'),
      ts: typeof value.ts === 'number' && Number.isFinite(value.ts) ? value.ts : Date.now(), board }];
  });
}

/**
 * 解析导入文件。
 * 同时接受三种形态,尽量不挑食:
 *   1. 本工具导出的完整文件({ kind, version, board, ... })
 *   2. 裸棋盘({ areas: {...} })
 *   3. 裸盘位数组([{ name, board }]) —— 取第一个
 */
export function parseImport(text: string): ImportResult {
  const fail = (error: string): ImportResult => ({
    ok: false,
    error,
    name: '',
    board: null,
    customCards: [],
    customEffects: [],
    history: []
  });

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail('不是合法的 JSON 文件');
  }

  if (Array.isArray(raw)) {
    raw = raw[0];
  }
  if (!isRecord(raw)) return fail('文件结构无法识别');

  // 形态 1:完整导出文件
  if (raw.kind === CHAIN_EXPORT_KIND || isRecord(raw.board)) {
    const board = validateBoard(raw.board);
    if (!board) return fail('文件里的棋盘数据已损坏');
    return {
      ok: true,
      error: '',
      name: asString(raw.name, '导入的推演'),
      board,
      customCards: validateCustomCards(raw.customCards),
      customEffects: validateCustomEffects(raw.customEffects),
      history: validateSnapshots(raw.history)
    };
  }

  // 形态 2:裸棋盘
  const board = validateBoard(raw);
  if (!board) return fail('文件里没有可识别的棋盘数据(需要 areas 字段)');
  return {
    ok: true,
    error: '',
    name: '导入的推演',
    board,
    customCards: [],
    customEffects: [],
    history: []
  };
}

/* ──────────────────────── URL 分享 ──────────────────────── */

/**
 * 压缩标记。
 *
 * 压缩前的旧链接是「无前缀的纯 base64url(JSON)」——JSON 必然以 `{"` 开头,
 * 编码后必然以 `eyJ` 开头;新链接一律以 `z` 开头。两者不可能撞车,
 * 所以不必引入版本号,老链接继续可用。
 */
const SHARE_ZIP_PREFIX = 'z';

/**
 * 棋盘 → 分享载荷对象。
 *
 * 省掉**非自定义卡**的效果正文:正文动辄上百字,是链接体积的大头,
 * 而接收端可以用编号在内置卡表里原样还原(见 ChainBoardView 的池内回填)。
 * 自定义卡不在卡表里,正文只能自己带着。
 */
function boardForShare(board: ChainBoard): ChainBoard {
  const areas: Record<string, unknown> = {};
  for (const key of AREA_ORDER) {
    const area = board.areas[key];
    areas[key] = {
      ...area,
      cards: area.cards.map((card) => (card.custom ? card : { ...card, text: '' }))
    };
  }
  return { areas, updatedAt: board.updatedAt } as ChainBoard;
}

function buildSharePayload(board: ChainBoard, history: readonly ChainSnapshot[]): string {
  return JSON.stringify({
    v: 2,
    board: boardForShare(board),
    history: history.map((snapshot) => ({
      actor: snapshot.actor,
      action: snapshot.action,
      ts: snapshot.ts,
      board: boardForShare(snapshot.board)
    }))
  });
}

/**
 * 棋盘 → URL 安全字符串(deflate-raw + base64url)。
 *
 * 压缩不是装饰:不压缩时十几张卡的盘就有数千字符,而二维码上限约 2900 字节,
 * 结果就是「二维码永远生成不出来」。环境不支持 CompressionStream 时退回
 * 不压缩,链接照样能用,只是更长。
 */
export async function encodeShare(
  board: ChainBoard,
  history: readonly ChainSnapshot[] = []
): Promise<string> {
  const json = buildSharePayload(board, history);
  const zipped = await deflateRaw(json);
  return zipped ? SHARE_ZIP_PREFIX + base64UrlEncodeBytes(zipped) : base64UrlEncode(json);
}

export interface DecodedShare {
  board: ChainBoard;
  history: ChainSnapshot[];
}

/** URL 字符串 → 当前棋盘与快照。旧版只含裸棋盘的链接继续兼容。 */
export async function decodeShare(encoded: string): Promise<DecodedShare | null> {
  let json: string | null;
  if (encoded.startsWith(SHARE_ZIP_PREFIX)) {
    const bytes = base64UrlDecodeBytes(encoded.slice(SHARE_ZIP_PREFIX.length));
    json = bytes ? await inflateRaw(bytes) : null;
  } else {
    json = base64UrlDecode(encoded); // 加压缩之前的旧链接
  }
  if (json === null) return null;
  try {
    const raw: unknown = JSON.parse(json);
    if (isRecord(raw) && isRecord(raw.board)) {
      const board = validateBoard(raw.board);
      return board ? { board, history: validateSnapshots(raw.history) } : null;
    }
    const board = validateBoard(raw);
    return board ? { board, history: [] } : null;
  } catch {
    return null;
  }
}

/** deflate-raw 压缩;环境不支持或压缩失败时返回 null,由调用方退回不压缩 */
async function deflateRaw(text: string): Promise<Uint8Array | null> {
  if (typeof CompressionStream !== 'function') return null;
  try {
    const source = new Blob([new TextEncoder().encode(text)]).stream();
    const stream = source.pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

async function inflateRaw(bytes: Uint8Array): Promise<string | null> {
  if (typeof DecompressionStream !== 'function') return null;
  try {
    const stream = new Blob([Uint8Array.from(bytes)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return await new Response(stream).text();
  } catch {
    return null;
  }
}

/** 包含中文的 UTF-8 base64url 编码(盘名/卡名都是中文,不能直接 btoa) */
function base64UrlEncode(text: string): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(text));
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecodeBytes(encoded: string): Uint8Array | null {
  try {
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  } catch {
    return null;
  }
}

function base64UrlDecode(encoded: string): string | null {
  const bytes = base64UrlDecodeBytes(encoded);
  return bytes ? new TextDecoder().decode(bytes) : null;
}
