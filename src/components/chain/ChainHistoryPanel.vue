<script setup lang="ts">
/**
 * ChainHistoryPanel.vue · 快照历史
 *
 * 语义与上游一致:列表里每一条都是「某个动作执行完之后」的完整棋盘,
 * 点一条即回到那一刻。游标(historyIndex)决定了撤销/重做能走到哪。
 *
 * 与「保存到本机」的区别要在界面上说清楚:
 *   快照 = 过程记录,只在本会话内有效,关页即散
 *   保存 = 把当前棋盘写进盘位,落 localStorage
 */
import { onMounted, onUnmounted, ref } from 'vue';
import type { ChainSnapshot } from '@/tools/chain/types';

defineProps<{
  history: readonly ChainSnapshot[];
  historyIndex: number;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'jump', index: number): void;
  (e: 'undo'): void;
  (e: 'redo'): void;
  (e: 'snapshot'): void;
  (e: 'clear'): void;
  (e: 'export-json'): void;
  (e: 'import-json'): void;
}>();

/** 浮窗位置存在本机:关掉再开、刷新页面都回到上次拖到的地方 */
const PANEL_POS_KEY = 'rune.chain.history-panel';

function defaultPosition(): { x: number; y: number } {
  return { x: Math.max(8, window.innerWidth - 344), y: 160 };
}

function loadPosition(): { x: number; y: number } {
  try {
    const raw = localStorage.getItem(PANEL_POS_KEY);
    if (!raw) return defaultPosition();
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return defaultPosition();
    const { x, y } = parsed as { x?: unknown; y?: unknown };
    if (typeof x !== 'number' || typeof y !== 'number') return defaultPosition();
    if (!Number.isFinite(x) || !Number.isFinite(y)) return defaultPosition();
    return { x, y };
  } catch {
    return defaultPosition();
  }
}

function savePosition(): void {
  try {
    localStorage.setItem(PANEL_POS_KEY, JSON.stringify(position.value));
  } catch {
    // 存不下就算了:位置只是便利,不该因此打断使用
  }
}

const panel = ref<HTMLElement | null>(null);
const position = ref(loadPosition());
let drag: { id: number; x: number; y: number } | null = null;

function clampPosition(x: number, y: number): void {
  const rect = panel.value?.getBoundingClientRect();
  position.value = {
    x: Math.max(8, Math.min(x, window.innerWidth - (rect?.width || 320) - 8)),
    y: Math.max(8, Math.min(y, window.innerHeight - (rect?.height || 260) - 8))
  };
}
function startDrag(event: PointerEvent): void {
  if (event.button !== 0 || (event.target as Element).closest('button')) return;
  drag = { id: event.pointerId, x: event.clientX - position.value.x, y: event.clientY - position.value.y };
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  event.preventDefault();
}
function moveDrag(event: PointerEvent): void {
  if (!drag || drag.id !== event.pointerId) return;
  clampPosition(event.clientX - drag.x, event.clientY - drag.y);
}
function endDrag(event: PointerEvent): void {
  if (drag?.id !== event.pointerId) return;
  drag = null;
  const target = event.currentTarget as HTMLElement;
  if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
  savePosition();
}
function onResize(): void {
  clampPosition(position.value.x, position.value.y);
  savePosition();
}
onMounted(() => {
  // 恢复的位置可能来自更宽的窗口,进 DOM 后按当前视口再夹一次
  clampPosition(position.value.x, position.value.y);
  window.addEventListener('resize', onResize);
});
onUnmounted(() => window.removeEventListener('resize', onResize));

function timeLabel(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
</script>

<template>
  <div ref="panel" class="history-panel" role="dialog" aria-label="快照历史" :style="{ left: `${position.x}px`, top: `${position.y}px` }">
    <header class="hp-head" @pointerdown="startDrag" @pointermove="moveDrag" @pointerup="endDrag" @pointercancel="endDrag" @lostpointercapture="drag = null">
      <h3>快照历史</h3>
      <span class="hp-count tabular-nums">{{ history.length }} 条</span>
      <button type="button" class="hp-close" aria-label="关闭快照历史" @click="emit('close')">×</button>
    </header>

    <div class="hp-actions">
      <button type="button" title="撤销(Ctrl+Z)" @click="emit('undo')">↶ 撤销</button>
      <button type="button" title="重做(Ctrl+Y)" @click="emit('redo')">↷ 重做</button>
      <button type="button" title="存一个快照(Ctrl+S)" @click="emit('snapshot')">保存快照</button>
      <button type="button" :disabled="history.length === 0" title="清空过程记录" @click="emit('clear')">
        清空
      </button>
    </div>

    <p v-if="history.length === 0" class="hp-empty">
      还没有快照。按 Ctrl+S 或点击“保存快照”记录当前棋盘。
    </p>

    <ol v-else class="hp-list">
      <li
        v-for="(snap, index) in history"
        :key="snap.id"
        class="hp-item"
        :class="{ current: index === historyIndex }"
      >
        <button type="button" :title="`回到「${snap.action}」`" @click="emit('jump', index)">
          <span class="hp-dot" :class="`p${snap.actor}`" aria-hidden="true"></span>
          <span class="hp-action">{{ snap.action }}</span>
          <span class="hp-time tabular-nums">{{ timeLabel(snap.ts) }}</span>
        </button>
      </li>
    </ol>

    <footer class="hp-foot">
      <button type="button" @click="emit('export-json')">导出 JSON</button>
      <button type="button" @click="emit('import-json')">导入 JSON</button>
    </footer>
    <p class="hp-note">快照只在本会话内有效,关页即散;要长期保留请「保存到本机」或导出。</p>
  </div>
</template>

<style scoped>
.history-panel {
  position: fixed;
  z-index: 60;
  width: min(320px, calc(100vw - 16px));
  max-height: calc(100vh - 24px);
  overflow-y: auto;
  box-shadow: 0 12px 36px -12px var(--color-shadow);
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 11px 12px 12px;
  border: 1px solid var(--color-panel-border);
  border-radius: 10px;
  background: var(--color-panel-bg);
}
.hp-head {
  cursor: move;
  touch-action: none;
  user-select: none;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.hp-head h3 { font-size: 12.5px; font-weight: 700; color: var(--color-text-primary); }
.hp-close { cursor: pointer; padding: 0 5px; font-size: 20px; color: var(--color-text-muted); }
.hp-count { margin-left: auto; font-size: 10px; color: var(--color-text-subtle); }

.hp-actions { display: flex; gap: 4px; flex-wrap: wrap; }
.hp-actions button {
  font-size: 10.5px;
  padding: 2px 7px;
  border: 1px solid var(--color-panel-border);
  border-radius: 6px;
  color: var(--color-text-muted);
  background: var(--color-card-bg);
}
.hp-actions button:hover:not(:disabled) { border-color: var(--color-brand); color: var(--color-brand); }
.hp-actions button:disabled { opacity: .45; cursor: not-allowed; }

.hp-empty { font-size: 10.5px; line-height: 1.6; color: var(--color-text-subtle); padding: 6px 0; }

.hp-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 34vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.hp-item button {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 6px;
  text-align: left;
  font-size: 11px;
  color: var(--color-text-muted);
}
.hp-item button:hover { background: var(--color-dropzone-hover-bg); }
.hp-item.current button {
  background: var(--color-brand-soft);
  color: var(--color-brand);
  font-weight: 600;
}
/* 撤销之后位于「未来」的条目:虚线显示,提示可重做 */
.hp-item.future button { opacity: .5; border-left: 2px dashed var(--color-panel-border); }
.hp-dot {
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-brand);
}
.hp-dot.p2 { background: var(--color-map-ramp-3); }
.hp-action { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hp-time { flex: 0 0 auto; font-size: 9.5px; color: var(--color-text-subtle); }

.hp-foot {
  display: flex;
  gap: 5px;
  padding-top: 8px;
  border-top: 1px solid var(--color-panel-border);
}
.hp-foot button {
  flex: 1 1 0;
  font-size: 10.5px;
  padding: 3px 6px;
  border: 1px solid var(--color-panel-border);
  border-radius: 6px;
  color: var(--color-text-muted);
  background: var(--color-card-bg);
}
.hp-foot button:hover { border-color: var(--color-brand); color: var(--color-brand); }
.hp-note { font-size: 9.5px; line-height: 1.5; color: var(--color-text-subtle); }
</style>
