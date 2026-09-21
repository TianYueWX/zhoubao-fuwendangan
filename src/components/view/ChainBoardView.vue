<script setup lang="ts">
import ChainShareDialog from '../chain/ChainShareDialog.vue';
/**
 * ChainBoardView.vue · 结算链推演(主视图)
 *
 * 这是「小工具」的宿主页:站点通过 catalog 的 code 'chain' 路由到这里。
 * 职责边界:
 *   视图层只做「接线」——把 DOM 事件翻译成 store/纯函数调用,把状态映射成
 *   界面。棋盘操作本身全在 src/tools/chain/*.ts 里,与 Vue 无关。
 *
 * 三个入口进来的方式:
 *   1. 首页小按钮 / 导航 → #/chain,打开上次的盘位
 *   2. 分享链接 → #/chain?s=...,导入为临时盘(不自动落盘,不污染对方盘位列表)
 *   3. 深链刷新 → 卡表随站点预加载,因此无数据包也能用
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch, type Ref } from 'vue';
import { navigate } from '@/router/hash';
import { store } from '@/store/analysis';
import {
  AREA_META,
  AREA_ORDER,
  RESOLVE_CAPACITY,
  type CardDisplayMode,
  type ChainAreaKey,
  type ChainCard,
  type ChainCustomCard,
  type ChainCustomEffect,
  type ChainPlayer
} from '@/tools/chain/types';
import {
  cloneCardFromPool,
  clearArea,
  clearBoard,
  customCardFromPool,
  decodeShare,
  buildExportFile,
  parseImport,
  removeCard,
  renameCard,
  reorderArea,
  setAllAreaModes,
  setAreaMode,
  setCardPlayer,
  textCard,
  insertCard,
  countCards
} from '@/tools/chain/board';
import {
  addCustomCard,
  addCustomEffect,
  boardCardCount,
  canRedo,
  canUndo,
  chainStore,
  clearHistory,
  commitBoard,
  createPlay,
  currentPlay,
  deletePlay,
  dirty,
  duplicatePlay,
  hasUnsavedChanges,
  importBoardAsNewPlay,
  initChainStore,
  jumpToSnapshot,
  mergeCustomPools,
  notify,
  pushManualSnapshot,
  buildShareLink,
  redo,
  removeCustomCard,
  removeCustomEffect,
  renamePlay,
  savePlay,
  setActor,
  setDefaultMode,
  switchPlay,
  undo
} from '@/tools/chain/store';
import { poolItemToCardSource, type ChainPoolItem } from '@/tools/chain/pool';
import { useChainPool } from '@/tools/chain/useChainPool';
import { useChainDnd } from '@/tools/chain/useChainDnd';
import { useChainShortcuts } from '@/tools/chain/useChainShortcuts';
import { useUnsavedGuard } from '@/tools/chain/useUnsavedGuard';
import ChainToolbar from '@/components/chain/ChainToolbar.vue';
import ChainPlayList from '@/components/chain/ChainPlayList.vue';
import ChainZone from '@/components/chain/ChainZone.vue';
import ChainCardPool from '@/components/chain/ChainCardPool.vue';
import ChainHistoryPanel from '@/components/chain/ChainHistoryPanel.vue';
import ChainCardOverlay from '@/components/chain/ChainCardOverlay.vue';
import ChainUnsavedDialog from '@/components/chain/ChainUnsavedDialog.vue';
import ChainPresentationOverlay from '@/components/chain/ChainPresentationOverlay.vue';

/* ──────────────────────── 卡池与状态 ──────────────────────── */

const { pool, status, imageOf } = useChainPool();
const guard = useUnsavedGuard();

const board = computed(() => chainStore.working.board);
const actor = computed<ChainPlayer>(() => chainStore.working.actor);

function findCard(uid: string): ChainCard | null {
  for (const key of AREA_ORDER) {
    const card = board.value.areas[key].cards.find((c) => c.uid === uid);
    if (card) return card;
  }
  return null;
}

/* ──────────────────────── 拖拽 ──────────────────────── */

/**
 * 六个区域的容器 DOM。
 * 显式写成 HTMLElement | null(而不是 ReturnType<typeof ref<...>>)——
 * 后者会带上 | undefined,与 useChainDnd 的入参类型对不上。
 */
const zoneRefs: Record<ChainAreaKey, Ref<HTMLElement | null>> = {
  chain: ref<HTMLElement | null>(null),
  resolve: ref<HTMLElement | null>(null),
  pending: ref<HTMLElement | null>(null),
  trash: ref<HTMLElement | null>(null),
  base: ref<HTMLElement | null>(null),
  battlefield: ref<HTMLElement | null>(null)
};

/**
 * 模板 ref 回调里不做类型断言 —— 模板表达式里写 `as` 会让 Vue 的
 * 模板编译解析失败(实测 TS1109)。改成在脚本里收口成 HTMLElement。
 */
function toElement(el: unknown): HTMLElement | null {
  // In development, preserved root comments make $el a fragment anchor.
  // Read the actual section exposed by ChainZone in both build modes.
  const candidate = el as { zoneElement?: unknown } | null;
  const node = candidate?.zoneElement ?? el;
  return node instanceof HTMLElement ? node : null;
}

function setZoneRef(area: ChainAreaKey, el: unknown): void {
  zoneRefs[area].value = toElement(el);
}

/* 卡池的两个真实拖拽容器由 ChainCardPool 通过 defineExpose 暴露 */
const poolComponent = ref<{
  poolListRef: Element | null;
  customListRef: Element | null;
} | null>(null);

const poolListRef = computed<Element | null>(() => poolComponent.value?.poolListRef ?? null);
const customListRef = computed<Element | null>(() => poolComponent.value?.customListRef ?? null);

/**
 * 传给拖拽层的必须是 **ref 本身** 而不是它的当前值。
 *
 * 踩过的坑:Vue 3.5 下子组件用模板 ref 时,该 ref 在子组件 setup 期间是 null,
 * 挂载后才被赋值。若在这里先取值(computed.value)传进去,拖拽层拿到的是
 * 一个永远不会更新的 null,于是「卡池拖不出来」且没有任何报错 ——
 * 静默失效。这里包一层 computed 再交给拖拽层,由它在挂载时读取当下值。
 */
const poolEl = computed<HTMLElement | null>(() =>
  poolListRef.value instanceof HTMLElement ? poolListRef.value : null
);
const customPoolEl = computed<HTMLElement | null>(() =>
  customListRef.value instanceof HTMLElement ? customListRef.value : null
);

function onThumbModeChange(mode: 'image' | 'text'): void {
  thumbMode.value = mode;
}

/**
 * 顶栏的显示模式开关:同时作用于全部区域。
 * 只改「默认值」的话点了没反应,用户会以为坏了;而且六个区逐个点太烦。
 * 区域级仍保留自己的小开关做单个覆盖。
 */
function onSetDefaultMode(mode: CardDisplayMode): void {
  setDefaultMode(mode);
  commitBoard(setAllAreaModes(board.value, mode), '切换全部区域显示模式');
}

function onClearHistory(): void {
  if (!window.confirm('清空全部快照记录?(棋盘内容不受影响)')) return;
  clearHistory();
}

/** 区域容量:只有「结算中」有上限 */
function capacityOf(area: ChainAreaKey): number {
  return area === 'resolve' ? RESOLVE_CAPACITY : Number.POSITIVE_INFINITY;
}
function canAccept(area: ChainAreaKey): boolean {
  const cap = capacityOf(area);
  return !Number.isFinite(cap) || board.value.areas[area].cards.length < cap;
}

function moveBoardCard(uid: string, toArea: ChainAreaKey, toIndex: number | null): void {
  const card = findCard(uid);
  if (!card) return;
  if (!canAccept(toArea)) {
    notify(`「${card.name}」无法放入:该区域已满`, true);
    return;
  }
  // 先摘出再插入:moveCard 的「同区差一位」问题由调用方给准下标来规避
  // (拖拽层传来的 newIndex 已经是 Sortable 计算过的最终位置)
  const next = insertCard(removeCard(board.value, uid), card, toArea, toIndex);
  commitBoard(next, `移动「${card.name}」`);
}

const dnd = useChainDnd({
  zoneRefs,
  customPoolRef: customPoolEl,
  handlers: {
    /** 区内重排:按拖拽结束后的 uid 顺序重建 */
    reorder: (area, order) => {
      const before = board.value.areas[area].cards.map((c) => c.uid).join(',');
      if (before === order.join(',')) return;
      commitBoard(reorderArea(board.value, area, order), '调整顺序');
    },

    /** 盘内已有卡跨区移动 */
    move: (uid, toArea, toIndex) => moveBoardCard(uid, toArea, toIndex),

    /** 从卡池 / 自定义池拖入 → 克隆一张新实例 */
    clone: (sourceUid, toArea, toIndex) => {
      if (!sourceUid) return;

      if (sourceUid.startsWith('pool:')) {
        const cardId = sourceUid.slice('pool:'.length);
        const item = pool.value.find((p) => p.id === cardId);
        if (!item) return;
        commitBoard(
          cloneCardFromPool(board.value, poolItemToCardSource(item), toArea, toIndex, actor.value),
          `放入「${item.name}」`
        );
        return;
      }

      if (sourceUid.startsWith('custom:')) {
        const id = sourceUid.slice('custom:'.length);
        const card = chainStore.customCards.find((c) => c.id === id);
        if (!card) return;
        commitBoard(
          customCardFromPool(board.value, card, toArea, toIndex, actor.value),
          `放入「${card.name}」`
        );
        return;
      }

      if (sourceUid.startsWith('effect:')) {
        const id = sourceUid.slice('effect:'.length);
        const effect = chainStore.customEffects.find((e) => e.id === id);
        if (!effect) return;
        const card = textCard(board.value, effect.text, actor.value);
        commitBoard(insertCard(board.value, card, toArea, toIndex), `放入效果「${effect.text}」`);
      }
    },

    /** 拖回卡池 = 移出棋盘 */
    remove: (uid) => onRemoveCard(uid),

    canAccept,
    onRejected: (area) => notify(`「${AREA_META[area].label}」已满,无法再放入`, true)
  },
  onError: (message) => notify(`拖拽功能未能启用:${message}`, true)
});

/* ──────────────────────── 卡片操作 ──────────────────────── */

function onTogglePlayer(uid: string): void {
  const card = findCard(uid);
  if (!card) return;
  const next: ChainPlayer = card.player === 1 ? 2 : 1;
  commitBoard(setCardPlayer(board.value, uid, next), `「${card.name}」归属改为玩家${next}`);
}

function onRemoveCard(uid: string): void {
  const card = findCard(uid);
  if (!card) return;
  commitBoard(removeCard(board.value, uid), `移出「${card.name}」`);
}

function onRenameCard(uid: string, name: string): void {
  commitBoard(renameCard(board.value, uid, name), `重命名「${name}」`);
}

function onSetAreaMode(area: ChainAreaKey, mode: CardDisplayMode): void {
  commitBoard(setAreaMode(board.value, area, mode), `「${area}」显示模式改为 ${mode}`);
}

function onClearArea(area: ChainAreaKey): void {
  if (board.value.areas[area].cards.length === 0) return;
  commitBoard(clearArea(board.value, area), `清空该区域`);
}

function onSwitchActor(player: ChainPlayer): void {
  setActor(player);
  notify(`当前行动:玩家 ${player}`);
}

/* ──────────────────────── 大图浮层 ──────────────────────── */

const overlayUid = ref('');
const hoveredUid = ref('');
const altHeld = ref(false);

/** 池内按编号索引:分享链接为压缩体积不带效果正文,接收端靠它还原 */
const poolById = computed(() => new Map(pool.value.map((item) => [item.id, item])));

const overlayCard = computed<ChainCard | null>(() => {
  if (!overlayUid.value) return null;
  const card = findCard(overlayUid.value);
  if (!card || card.text || card.custom) return card;
  const item = poolById.value.get(card.cardId);
  return item ? { ...card, text: item.text } : card;
});

function syncPreview(): void {
  overlayUid.value = altHeld.value && !dnd.isDragging.value ? hoveredUid.value : '';
}
watch(() => dnd.isDragging.value, syncPreview);

function onPreview(uid: string, mode: 'hover' | 'leave' | 'click'): void {
  if (mode === 'hover') hoveredUid.value = uid;
  else if (mode === 'leave' && hoveredUid.value === uid) hoveredUid.value = '';
  syncPreview();
}

function onPreviewKey(e: KeyboardEvent): void {
  altHeld.value = e.altKey;
  syncPreview();
}
function onPreviewPointer(e: PointerEvent): void {
  altHeld.value = e.altKey;
  syncPreview();
}
function closeOverlay(): void { overlayUid.value = ''; }
function resetPreview(): void {
  altHeld.value = false;
  hoveredUid.value = '';
  closeOverlay();
}

/* ──────────────────────── 文件导入导出 ──────────────────────── */

function onExportJson(): void {
  const play = currentPlay.value;
  if (!play) return;
  const payload = buildExportFile(
    play.name,
    board.value,
    chainStore.customCards,
    chainStore.customEffects,
    chainStore.working.history
  );
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const a = document.createElement('a');
  a.href = url;
  a.download = `结算链推演-${play.name}-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify('已导出 JSON 文件');
}

const fileInput = ref<HTMLInputElement | null>(null);

function onPickImportFile(): void {
  fileInput.value?.click();
}

function onImportFile(e: Event): void {
  const input = e.target;
  if (!(input instanceof HTMLInputElement)) return;
  const file = input.files?.[0];
  input.value = ''; // 允许连续导入同一个文件
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    const text = typeof reader.result === 'string' ? reader.result : '';
    const parsed = parseImport(text);
    if (!parsed.ok || !parsed.board) {
      notify(parsed.error || '导入失败', true);
      return;
    }
    const id = importBoardAsNewPlay(parsed.name, parsed.board, false, parsed.history);
    if (parsed.customCards.length > 0 || parsed.customEffects.length > 0) {
      mergeCustomPools(parsed.customCards, parsed.customEffects);
    }
    notify(`已导入为新盘位(共 ${countCards(parsed.board)} 张卡)`);
    void id;
  };
  reader.onerror = () => notify('文件读取失败', true);
  reader.readAsText(file, 'utf-8');
}

/* ──────────────────────── 分享链接 ──────────────────────── */

const shareOpen = ref(false);
const shareUrl = ref('');
const shareError = ref('');
async function onShare(): Promise<void> {
  const result = await buildShareLink();
  shareUrl.value = result.url;
  shareError.value = result.reason;
  shareOpen.value = true;
}

/* ──────────────────────── 全屏 / 演示 ──────────────────────── */

const isFullscreen = ref(false);
function onFullscreenChange(): void {
  isFullscreen.value = document.fullscreenElement !== null;
}
async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    notify('浏览器拒绝了全屏请求', true);
  }
}

const presenting = ref(false);
function togglePresentation(): void {
  presenting.value = !presenting.value;
}

/* ──────────────────────── 自定义池 ──────────────────────── */

function onAddCustomCard(): void {
  const name = window.prompt('自定义卡名称:');
  if (name === null) return;
  const text = window.prompt('效果文本(可留空):') ?? '';
  const created = addCustomCard(name, text);
  if (!created) {
    notify('名称不能为空', true);
    return;
  }
  notify(`已添加自定义卡「${created.name}」`);
}

function onAddCustomEffect(): void {
  const text = window.prompt('待处理效果文本:');
  if (text === null) return;
  const created = addCustomEffect(text);
  if (!created) {
    notify('内容不能为空', true);
    return;
  }
  notify('已添加自定义效果');
}

/* ──────────────────────── 盘位动作(全部经过未保存拦截) ──────────────────────── */

function onSwitchPlay(id: string): void {
  const target = chainStore.plays.find((p) => p.id === id);
  guard.guard(`切换到「${target?.name ?? '另一个盘位'}」`, () => switchPlay(id));
}

function onCreatePlay(): void {
  guard.guard('新建一个盘位', () => createPlay());
}

function onDuplicatePlay(): void {
  guard.guard('把当前棋盘复制为新盘位', () => duplicatePlay());
}

function onDeletePlay(id: string): void {
  const target = chainStore.plays.find((p) => p.id === id);
  if (!target) return;
  if (!window.confirm(`删除盘位「${target.name}」?该操作不可撤销。`)) return;
  // 删的不是当前盘位时无需拦截
  guard.guard(id === chainStore.currentId ? '删除当前盘位' : null, () => deletePlay(id));
}

function onRenamePlay(name: string): void {
  renamePlay(chainStore.currentId, name);
}

function onClearBoard(): void {
  if (!window.confirm('清空整盘?此操作可以用「撤销」恢复。')) return;
  commitBoard(clearBoard(board.value), '清空整盘');
}

function goHome(): void {
  guard.guard('返回首页', () => navigate({ view: 'home' }));
}

/* ──────────────────────── 分享链接落地 ──────────────────────── */

async function loadSharedFromHash(): Promise<void> {
  const hash = window.location.hash;
  const qIndex = hash.indexOf('?');
  if (qIndex < 0) return;
  const params = new URLSearchParams(hash.slice(qIndex + 1));
  const encoded = params.get('s');
  if (!encoded) return;

  const decoded = await decodeShare(encoded);
  if (!decoded) {
    notify('分享链接已损坏或版本不兼容,无法解析', true);
    return;
  }
  importBoardAsNewPlay('分享的推演', decoded, true);
  notify('已打开分享的推演(临时盘,点「保存」才会留在本机)');

  // 清掉地址栏里的长参数,避免刷新时重复导入;盘已进内存,不影响使用
  const cleanHash = hash.slice(0, qIndex);
  window.history.replaceState(null, '', `${window.location.pathname}${cleanHash}`);
}

/* ──────────────────────── 快捷键与生命周期 ──────────────────────── */

useChainShortcuts({
  onSnapshot: () => pushManualSnapshot(),
  onUndo: () => undo(),
  onRedo: () => redo(),
  onTogglePresentation: () => togglePresentation(),
  onExport: () => onExportJson(),
  onToggleFullscreen: () => void toggleFullscreen()
});

/** Esc:优先关浮层,其次退出演示 */
function onEscKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  if (shareOpen.value) { shareOpen.value = false; return; }
  if (overlayUid.value) {
    closeOverlay();
    return;
  }
  if (presenting.value) presenting.value = false;
}

let unbindBeforeUnload: (() => void) | null = null;

onMounted(async () => {
  initChainStore();
  await loadSharedFromHash();
  document.addEventListener('fullscreenchange', onFullscreenChange);
  window.addEventListener('keydown', onEscKey);
  window.addEventListener('keydown', onPreviewKey);
  window.addEventListener('keyup', onPreviewKey);
  window.addEventListener('blur', resetPreview);
  document.addEventListener('pointermove', onPreviewPointer);
  unbindBeforeUnload = bindBeforeUnloadSafely();

  // 等 DOM 就绪后再挂拖拽(SortableJS 需要真实节点)
  await nextTick();
  tryMountDnd();
});

onUnmounted(() => {
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  window.removeEventListener('keydown', onEscKey);
  window.removeEventListener('keydown', onPreviewKey);
  window.removeEventListener('keyup', onPreviewKey);
  window.removeEventListener('blur', resetPreview);
  document.removeEventListener('pointermove', onPreviewPointer);
  unbindBeforeUnload?.();
});

function bindBeforeUnloadSafely(): () => void {
  // 动态引入避免循环依赖:store 不依赖视图层,这里只借用它的实现
  const handler = (e: BeforeUnloadEvent): void => {
    if (!hasUnsavedChanges()) return;
    e.preventDefault();
    e.returnValue = '';
  };
  window.addEventListener('beforeunload', handler);
  return () => window.removeEventListener('beforeunload', handler);
}

/**
 * 挂载拖拽 —— 唯一的入口,内部判定容器是否就绪。
 *
 * 为什么需要「尝试」而不是直接 mount:
 *   六个区域在首屏就有,但**卡池容器要等内置卡表异步载入后才渲染**
 *   (加载中时那块是状态文案,没有 .pool-list)。如果在 onMounted 里
 *   无条件挂一次,卡池往往还没出现,拖拽源就永久缺失 ——
 *   而且没有任何报错,是典型的静默失效。
 *   所以:容器没齐就不挂,等卡表就绪的状态变化再试一次。
 *
 * 宽窄断点切换同理:pull→push 时需要补挂。
 */
function tryMountDnd(): void {
  if (dnd.isMounted()) return;
  // 六个区域是拖拽的最小前提;卡池晚到不影响挂载(拖拽是事件委托)
  if (!zoneRefs.chain.value) return;
  void dnd.mount();
}

/* 卡表就绪 → 卡池渲染出来 → 补挂一次(捕获容器,便于后续扩展) */
watch(status, () => {
  void nextTick().then(tryMountDnd);
});

/* (卡表就绪的补挂已并入上面的 tryMountDnd,这里不再重复注册 watcher) */

/* ──────────────────────── 视图辅助 ──────────────────────── */
/* 说明:本工具为桌面场景设计(拖拽 + 多区并排),不做窄屏适配。
 * 窄屏下浏览器会正常横向滚动,不额外降级。 */

const thumbMode = ref<'image' | 'text'>('image');
const historyOpen = ref(false);

const playName = computed(() => currentPlay.value?.name ?? '未命名推演');

const unsavedHint = computed(() =>
  dirty.value ? '有未保存的改动' : '已保存到本机'
);

/** 六个区域的网格布局:结算链与结算中并排,其余按行 */
const layoutRows = computed<ChainAreaKey[][]>(() => [
  ['chain', 'resolve'],
  ['pending'],
  ['trash', 'base', 'battlefield']
]);

function cardsOf(area: ChainAreaKey): readonly ChainCard[] {
  return board.value.areas[area].cards;
}
function modeOf(area: ChainAreaKey): CardDisplayMode {
  return board.value.areas[area].mode;
}
</script>

<template>
  <div class="chain-view">
    <!-- 分享临时盘横幅 -->
    <div v-if="chainStore.sharedTemp" class="temp-banner" role="status">
      <span>
        这是**分享链接打开的临时盘**,改动不会自动留在本机。
        想保留请点右上角「保存」,它才会进入你的盘位列表。
      </span>
      <button type="button" @click="savePlay()">保存为新盘位</button>
    </div>

    <ChainToolbar
      :play-name="playName"
      :dirty="dirty"
      :card-count="boardCardCount"
      :can-undo="canUndo"
      :can-redo="canRedo"
      :default-mode="chainStore.defaultMode"
      :is-fullscreen="isFullscreen"
      :history-open="historyOpen"
      @toggle-history="historyOpen = !historyOpen"
      @save="savePlay()"
      @rename="onRenamePlay"
      @snapshot="pushManualSnapshot()"
      @undo="undo()"
      @redo="redo()"
      @export-json="onExportJson"
      @import-json="onPickImportFile"
      @share="onShare"
      @toggle-presentation="togglePresentation"
      @toggle-fullscreen="toggleFullscreen"
      @set-default-mode="onSetDefaultMode"
      @clear-board="onClearBoard"
    >
      <template #playlist>
        <ChainPlayList
          :plays="chainStore.plays"
          :current-id="chainStore.currentId"
          :dirty="dirty"
          @switch="onSwitchPlay"
          @create="onCreatePlay"
          @rename="onRenamePlay"
          @duplicate="onDuplicatePlay"
          @delete="onDeletePlay"
        />
      </template>
    </ChainToolbar>

    <p class="view-sub">
      <span class="tabular-nums">{{ chainStore.plays.length }}</span> 个盘位 ·
      {{ unsavedHint }} ·
      把右侧卡池的卡拖进任一区域;区域之间也可以直接拖
    </p>

    <div class="chain-layout">
      <!-- ── 主棋盘 ── -->
      <main class="chain-board">
        <!-- 玩家切换 -->
        <div class="actor-bar">
          <span class="actor-label">当前行动</span>
          <div class="actor-switch" role="group" aria-label="当前行动玩家">
            <button
              v-for="p in ([1, 2] as const)"
              :key="p"
              type="button"
              :class="[`p${p}`, { active: actor === p }]"
              @click="onSwitchActor(p)"
            >
              玩家 {{ p }}
            </button>
          </div>
          <span class="actor-note">
            拖入的卡会按当前玩家染色(玩家一 橙色 / 玩家二 蓝色),可用卡片上的按钮改归属
          </span>
        </div>

        <!-- 六个区域 -->
        <div v-for="(row, i) in layoutRows" :key="i" class="board-row" :class="`row-${row.length}`">
          <ChainZone
            v-for="area in row"
            :key="area"
            :ref="(el) => setZoneRef(area, el)"
            :area="area"
            :cards="cardsOf(area)"
            :mode="modeOf(area)"
            :actor="actor"
            :image-of="imageOf"
            :capacity-hint="area === 'resolve' ? RESOLVE_CAPACITY : 0"
            :disabled="status !== 'ready'"
            @set-mode="(m) => onSetAreaMode(area, m)"
            @clear="onClearArea(area)"
            @preview="onPreview"
            @toggle-player="onTogglePlayer"
            @remove="onRemoveCard"
            @rename="onRenameCard"
          />
        </div>
      </main>

      <!-- ── 侧栏 ── -->
      <aside class="chain-side">
        <ChainCardPool
          ref="poolComponent"
          :pool="pool"
          :custom-cards="chainStore.customCards"
          :custom-effects="chainStore.customEffects"
          :image-of="imageOf"
          :thumb-mode="thumbMode"
          :status="status"
          @update:thumb-mode="onThumbModeChange"
          @add-custom-card="onAddCustomCard"
          @add-custom-effect="onAddCustomEffect"
          @remove-custom-card="removeCustomCard"
          @remove-custom-effect="removeCustomEffect"
        />

        <p class="side-foot">
          卡池来自随站点发布的<b>内置卡表</b>(平卡口径,{{ pool.length }} 张),
          因此<b>不需要上传数据包</b>即可使用。卡图缺失时降级为颜色域色块。
        </p>
      </aside>
    </div>

        <ChainHistoryPanel
          v-show="historyOpen"
          @close="historyOpen = false"
          :history="chainStore.working.history"
          :history-index="chainStore.working.historyIndex"
          @jump="jumpToSnapshot"
          @undo="undo()"
          @redo="redo()"
          @snapshot="pushManualSnapshot()"
          @clear="onClearHistory"
          @export-json="onExportJson"
          @import-json="onPickImportFile"
        />

    <ChainShareDialog v-if="shareOpen" :url="shareUrl" :error="shareError" @close="shareOpen = false" @export-json="onExportJson" />

    <!-- 浮层 -->
    <ChainCardOverlay
      v-if="overlayCard"
      :card="overlayCard"
      :image="imageOf(overlayCard.cardId)"
      :pinned="false"
      @close="closeOverlay"
    />

    <ChainPresentationOverlay
      v-if="presenting"
      :cards-of="cardsOf"
      :mode-of="modeOf"
      :actor="actor"
      :image-of="imageOf"
      @close="presenting = false"
      @preview="onPreview"
      @toggle-player="onTogglePlayer"
    />

    <ChainUnsavedDialog
      :open="guard.open.value"
      :action="guard.action.value"
      :play-name="playName"
      @save="guard.onSaveAndContinue"
      @discard="guard.onDiscardAndContinue"
      @cancel="guard.onCancel"
    />

    <input
      ref="fileInput"
      type="file"
      accept="application/json,.json"
      class="hidden-file"
      @change="onImportFile"
    />

    <!-- 操作反馈 -->
    <div class="chain-toast" role="status" aria-live="polite">
      <span v-if="chainStore.notice" :class="{ error: chainStore.noticeIsError }">
        {{ chainStore.notice }}
      </span>
    </div>

    <!-- 返回首页:带上未保存拦截 -->
    <button type="button" class="back-home" title="返回首页" @click="goHome">← 首页</button>
  </div>
</template>

<style scoped>
.chain-view {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.temp-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 9px 13px;
  border: 1px solid var(--color-brand-faint);
  border-radius: 10px;
  background: var(--color-brand-soft);
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-text-muted);
}
.temp-banner button {
  font-size: 11.5px;
  padding: 4px 12px;
  border: 1px solid var(--color-brand);
  border-radius: 7px;
  background: var(--color-brand);
  color: var(--color-brand-ink);
  font-weight: 600;
}

.view-sub {
  font-size: 11px;
  color: var(--color-text-subtle);
  padding: 0 2px;
}
.view-sub b { color: var(--color-brand); }

.chain-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 16px;
  align-items: start;
}

.chain-board { display: flex; flex-direction: column; gap: 12px; min-width: 0; }

.actor-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 8px 12px;
  border: 1px solid var(--color-panel-border);
  border-radius: 10px;
  background: var(--color-panel-bg);
}
.actor-label { font-size: 11.5px; font-weight: 600; color: var(--color-text-muted); }
.actor-switch { display: inline-flex; border: 1px solid var(--color-panel-border); border-radius: 7px; overflow: hidden; }
.actor-switch button {
  font-size: 11.5px;
  padding: 3px 12px;
  color: var(--color-text-subtle);
  background: var(--color-card-bg);
  border-right: 1px solid var(--color-panel-border);
}
.actor-switch button:last-child { border-right: none; }
.actor-switch button.p1.active { background: #b45309; color: #fff; font-weight: 600; }
.actor-switch button.p2.active { background: #0369a1; color: #fff; font-weight: 600; }
.actor-note { font-size: 10px; color: var(--color-text-subtle); }

.board-row { display: grid; gap: 12px; min-width: 0; }
.row-2 { grid-template-columns: minmax(0, 1fr) 188px; }
.row-1 { grid-template-columns: minmax(0, 1fr); }
.row-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.row-resolve { min-height: 0; }

.chain-side {
  display: flex;
  flex-direction: column;
  gap: 12px;
  position: sticky;
  top: 76px;
  max-height: calc(100vh - 96px);
  overflow-y: auto;
  padding-right: 2px;
}
.pool-anchor { display: none; }

.side-foot {
  font-size: 10px;
  line-height: 1.6;
  color: var(--color-text-subtle);
  padding: 0 2px 8px;
}
.side-foot b { color: var(--color-text-muted); }

.hidden-file { display: none; }

.chain-toast {
  position: fixed;
  bottom: 22px;
  right: 22px;
  z-index: 70;
  pointer-events: none;
}
.chain-toast span {
  display: inline-block;
  padding: 8px 16px;
  border: 1px solid var(--color-brand-faint);
  border-radius: 10px;
  background: var(--color-card-bg);
  color: var(--color-brand);
  font-size: 12px;
  box-shadow: 0 12px 28px -18px var(--color-shadow);
}
.chain-toast span.error { border-color: var(--color-brand); color: var(--color-brand); }

.back-home {
  position: fixed;
  left: 22px;
  bottom: 22px;
  z-index: 50;
  font-size: 11.5px;
  padding: 5px 12px;
  border: 1px solid var(--color-panel-border);
  border-radius: 999px;
  background: var(--color-card-bg);
  color: var(--color-text-muted);
}
.back-home:hover { border-color: var(--color-brand); color: var(--color-brand); }

</style>
