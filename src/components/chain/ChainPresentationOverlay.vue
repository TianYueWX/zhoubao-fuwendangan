<script setup lang="ts">
/**
 * ChainPresentationOverlay.vue · 演示模式
 *
 * 与上游一致的语义:演示模式是**把整块推演台放大占满屏幕**,
 * 六个区域一次性全在视野里,方便对着牌桌讲解。
 * 一开始做成了「一屏一区、方向键翻页」,那是错的 ——
 * 讲解时最需要的是同时看到全链,而不是逐区翻页。
 *
 * 实现上是把真实的 ChainZone 组件用同样的顺序再排一遍,
 * 因此显示模式(文本/图案/两者)、玩家染色、卡图与主棋盘完全一致;
 * 差别只在于:去掉管理界面、区域不再接受编辑操作。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  type CardDisplayMode,
  type ChainAreaKey,
  type ChainCard,
  type ChainSnapshot
} from '@/tools/chain/types';
import { chainStore } from '@/tools/chain/store';
import ChainZone from './ChainZone.vue';

const props = defineProps<{
  cardsOf: (area: ChainAreaKey) => readonly ChainCard[];
  modeOf: (area: ChainAreaKey) => CardDisplayMode;
  actor: 1 | 2;
  imageOf: (cardId: string) => string;
  history: readonly ChainSnapshot[];
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'preview', uid: string, mode: 'hover' | 'leave' | 'click'): void;
  (e: 'toggle-player', uid: string): void;
}>();

const isFullscreen = ref(false);
/** history.length is a sentinel for the live board shown when presentation opens. */
const stepIndex = ref(props.history.length);

const activeSnapshot = computed(() =>
  stepIndex.value >= 0 && stepIndex.value < props.history.length
    ? props.history[stepIndex.value]
    : undefined
);
const displayActor = computed(() => activeSnapshot.value?.actor ?? props.actor);
const canStepBack = computed(() => props.history.length > 0 && stepIndex.value > 0);
const canStepForward = computed(() =>
  stepIndex.value >= 0 && stepIndex.value < props.history.length
);
const stepLabel = computed(() => {
  const snapshot = activeSnapshot.value;
  if (!snapshot) {
    return props.history.length > 0
      ? `当前棋盘 · ${props.history.length} 个快照`
      : '当前棋盘 · 暂无快照';
  }
  return `${stepIndex.value + 1} / ${props.history.length} · ${snapshot.action}`;
});

watch(
  () => props.history.length,
  (length) => {
    if (stepIndex.value < 0 || stepIndex.value > length) stepIndex.value = length;
  }
);

/** 演示模式下的排版:与主棋盘同序,结算链与结算中并排 */
const layoutRows: ChainAreaKey[][] = [
  ['chain', 'resolve'],
  ['pending'],
  ['trash', 'base', 'battlefield']
];

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault();
    emit('close');
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') {
    e.preventDefault();
    resetSteps();
    return;
  }

  if (!e.ctrlKey && !e.metaKey && !e.altKey) {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      stepBack();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      stepForward();
    }
  }
}

function stepBack(): void {
  if (canStepBack.value) stepIndex.value -= 1;
}

function stepForward(): void {
  if (canStepForward.value) stepIndex.value += 1;
}

function resetSteps(): void {
  if (props.history.length > 0) stepIndex.value = 0;
}

function presentationCardsOf(area: ChainAreaKey): readonly ChainCard[] {
  return activeSnapshot.value?.board.areas[area].cards ?? props.cardsOf(area);
}

function presentationModeOf(area: ChainAreaKey): CardDisplayMode {
  return activeSnapshot.value?.board.areas[area].mode ?? props.modeOf(area);
}

function onFullscreenChange(): void {
  isFullscreen.value = document.fullscreenElement !== null;
}

async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    // 浏览器拒绝时静默降级(演示模式本身仍然可用)
  }
  isFullscreen.value = document.fullscreenElement !== null;
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
  document.addEventListener('fullscreenchange', onFullscreenChange);
});
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
  document.removeEventListener('fullscreenchange', onFullscreenChange);
});

/** 演示模式下区域只读:这些操作在浮层里不提供 */
function noop(): void {
  /* 演示模式不允许改动棋盘 */
}
</script>

<template>
  <div class="present-overlay" role="dialog" aria-modal="true" aria-label="结算链推演演示模式">
    <header class="present-bar">
      <div class="present-title">
        <h2>结算链推演</h2>
        <span class="present-play">{{ chainStore.plays.find((p) => p.id === chainStore.currentId)?.name }}</span>
        <span class="present-actor" :class="`p${displayActor}`">
          当前行动:玩家 {{ displayActor }}
        </span>
      </div>
      <div class="present-tools">
        <div class="present-stepper" role="group" aria-label="快照播放控制">
          <button
            type="button"
            class="step-button"
            data-action="previous-step"
            :disabled="!canStepBack"
            title="上一步（←）"
            aria-label="显示上一个快照"
            @click="stepBack"
          >
            ←
          </button>
          <span class="present-step-label" aria-live="polite">{{ stepLabel }}</span>
          <button
            type="button"
            class="step-button"
            data-action="next-step"
            :disabled="!canStepForward"
            title="下一步（→）"
            aria-label="显示下一个快照"
            @click="stepForward"
          >
            →
          </button>
        </div>
        <span class="present-hint"><kbd>Ctrl</kbd>+<kbd>R</kbd> 回到开头 · Esc 退出</span>
        <button type="button" @click="toggleFullscreen">
          {{ isFullscreen ? '退出全屏' : '全屏' }}
        </button>
        <button type="button" class="primary" @click="emit('close')">退出演示</button>
      </div>
    </header>

    <div class="present-board">
      <div v-for="(row, i) in layoutRows" :key="i" class="present-row" :class="`row-${row.length}`">
        <ChainZone
          v-for="area in row"
          :key="area"
          :area="area"
          :cards="presentationCardsOf(area)"
          :mode="presentationModeOf(area)"
          :actor="displayActor"
          :image-of="imageOf"
          :capacity-hint="0"
          read-only
          @set-mode="noop"
          @clear="noop"
          @preview="(uid, m) => emit('preview', uid, m)"
          @toggle-player="(uid) => emit('toggle-player', uid)"
          @remove="noop"
          @rename="noop"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.present-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
  background: var(--color-page-bg);
}
.present-bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding: 10px 20px;
  border-bottom: 1px solid var(--color-panel-border);
  background: var(--color-card-bg);
}
.present-title { display: flex; align-items: baseline; gap: 10px; }
.present-title h2 { font-size: 18px; font-weight: 800; color: var(--color-text-primary); }
.present-play { font-size: 12.5px; color: var(--color-text-subtle); }
.present-actor {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 4px;
  border: 1px solid var(--color-brand-faint);
  color: var(--color-brand);
}
.present-actor.p2 { border-color: var(--color-panel-border); color: var(--color-map-ramp-3); }

.present-tools { display: flex; align-items: center; gap: 9px; }
.present-hint { font-size: 10.5px; color: var(--color-text-subtle); }
.present-hint kbd {
  font: inherit;
  color: var(--color-text-muted);
}
.present-stepper {
  display: flex;
  align-items: center;
  gap: 7px;
}
.present-step-label {
  min-width: 132px;
  max-width: 240px;
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: 11px;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.present-tools button {
  font-size: 12px;
  padding: 4px 13px;
  border: 1px solid var(--color-panel-border);
  border-radius: 7px;
  color: var(--color-text-muted);
  background: var(--color-card-bg);
}
.present-tools button:hover { border-color: var(--color-brand); color: var(--color-brand); }
.present-tools button:disabled {
  cursor: not-allowed;
  opacity: 0.38;
}
.present-tools button:disabled:hover {
  border-color: var(--color-panel-border);
  color: var(--color-text-muted);
}
.present-tools button.step-button {
  width: 32px;
  padding-inline: 0;
  font-size: 16px;
  line-height: 1;
}
.present-tools button.primary {
  border-color: var(--color-brand-faint);
  background: var(--color-brand-soft);
  color: var(--color-brand);
  font-weight: 600;
}

.present-board {
  flex: 1 1 auto;
  overflow: auto;
  padding: 16px 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.present-row { display: grid; gap: 14px; min-width: 0; }
.present-row.row-2 { grid-template-columns: minmax(0, 2fr) minmax(260px, 1fr); }
.present-row.row-1 { grid-template-columns: minmax(0, 1fr); }
.present-row.row-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }

.present-board :deep(.chain-card) {
  flex: 0 0 80px;
  width: 80px !important;
  height: 132px;
  align-self: flex-start;
}
.present-board :deep(.chain-card.mode-text) {
  align-items: flex-start;
  padding: 24px 5px 5px;
}
.present-board :deep(.chain-card .card-body) { overflow: hidden; }
.present-board :deep(.zone-checkbox) { display: none; }
</style>
