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
import { ArrowLeft, ArrowRight } from '@lucide/vue';
import {
  type CardDisplayMode,
  type ChainAreaKey,
  type ChainCard,
  type ChainSnapshot
} from '@/tools/chain/types';
import { chainStore } from '@/tools/chain/store';
import ChainZone from './ChainZone.vue';
import ChainArrowLayer from './ChainArrowLayer.vue';
import type { ChainBoard } from '@/tools/chain/types';

const props = defineProps<{
  cardsOf: (area: ChainAreaKey) => readonly ChainCard[];
  modeOf: (area: ChainAreaKey) => CardDisplayMode;
  actor: 1 | 2;
  imageOf: (cardId: string) => string;
  history: readonly ChainSnapshot[];
  board: ChainBoard;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'preview-card', card: ChainCard): void;
  (e: 'preview', uid: string, mode: 'hover' | 'leave' | 'click'): void;
  (e: 'toggle-player', uid: string): void;
}>();

const isFullscreen = ref(false);
const playing = ref(false), speed = ref(1), fit = ref(true), scale = ref(1);
const viewport = ref<HTMLElement>(), scene = ref<HTMLElement>(), overlay = ref<HTMLElement>();
let timer: ReturnType<typeof setTimeout> | undefined, resize: ResizeObserver | undefined;
let previousFocus: HTMLElement | null = null;
function pause(): void { playing.value = false; clearTimeout(timer); }
function schedule(): void {
  clearTimeout(timer);
  if (!playing.value) return;
  timer = setTimeout(() => { if (stepIndex.value + 1 >= props.history.length) pause(); else stepIndex.value++; }, (activeSnapshot.value?.duration ?? 2) * 1000 / speed.value);
}
function play(): void {
  if (playing.value) { pause(); return; }
  if (!props.history.length) return;
  if (stepIndex.value >= props.history.length - 1) stepIndex.value = 0;
  playing.value = true; schedule();
}
function resizeBoard(): void {
  if (!scene.value || !viewport.value || !fit.value) return;
  scale.value = Math.min(1, (viewport.value.clientWidth - 16) / scene.value.offsetWidth, (viewport.value.clientHeight - 16) / scene.value.offsetHeight);
}
function seek(event: Event): void { pause(); stepIndex.value = Number((event.target as HTMLInputElement).value); }
function previewCard(uid: string): void {
  const displayed = activeSnapshot.value?.board ?? props.board;
  const card = Object.values(displayed.areas).flatMap((a) => a.cards).find((c) => c.uid === uid);
  if (card) emit('preview-card', card);
}

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

watch([stepIndex, speed], schedule);
watch(fit, () => { if (fit.value) resizeBoard(); else scale.value = 1; });
const displayedBoard = computed(() => activeSnapshot.value?.board ?? props.board);
const changedIds = computed(() => {
  const previous = props.history[stepIndex.value - 1]?.board;
  if (!previous) return [];
  const before = new Map(Object.entries(previous.areas).flatMap(([a, z]) => z.cards.map((c, i) => [c.uid, JSON.stringify([a, i, c])] as const)));
  return Object.entries(displayedBoard.value.areas).flatMap(([a, z]) => z.cards.filter((c, i) => before.get(c.uid) !== JSON.stringify([a, i, c])).map((c) => c.uid));
});
/** 演示模式下的排版:与主棋盘同序,结算链与结算中并排 */
const layoutRows: ChainAreaKey[][] = [
  ['chain', 'resolve'],
  ['pending'],
  ['trash', 'base', 'battlefield']
];

function onKeydown(e: KeyboardEvent): void {
  if ((e.target as Element)?.closest('dialog[open]')) return;
  if (e.key === 'Tab') { const elements = [...(overlay.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, [tabindex="0"]') ?? [])]; const first = elements[0], last = elements[elements.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } return; }
  if ((e.target as Element)?.matches('input, select, textarea')) return;
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
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
    e.preventDefault(); emit('close'); return;
  }

  if (!e.ctrlKey && !e.metaKey && !e.altKey) {
    if (e.key === ' ') { e.preventDefault(); play(); }
    else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      stepBack();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      stepForward();
    }
  }
}

function stepBack(): void {
  pause();
  if (canStepBack.value) stepIndex.value -= 1;
}

function stepForward(): void {
  pause();
  if (canStepForward.value) stepIndex.value += 1;
}

function resetSteps(): void {
  pause();
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
  previousFocus = document.activeElement as HTMLElement; overlay.value?.focus();
  resize = new ResizeObserver(resizeBoard); if (viewport.value) resize.observe(viewport.value); if (scene.value) resize.observe(scene.value); resizeBoard();
  window.addEventListener('keydown', onKeydown);
  document.addEventListener('fullscreenchange', onFullscreenChange);
});
onUnmounted(() => {
  pause(); resize?.disconnect(); previousFocus?.focus();
  window.removeEventListener('keydown', onKeydown);
  document.removeEventListener('fullscreenchange', onFullscreenChange);
});

/** 演示模式下区域只读:这些操作在浮层里不提供 */
function noop(): void {
  /* 演示模式不允许改动棋盘 */
}
</script>

<template>
  <div ref="overlay" tabindex="-1" class="present-overlay" role="dialog" aria-modal="true" aria-label="结算链推演演示模式">
    <header class="present-bar">
      <div class="present-title">
        <h2>结算链推演</h2>
        <span class="present-play">{{ chainStore.plays.find((p) => p.id === chainStore.currentId)?.name }}</span>
        <span class="present-actor" :class="`p${displayActor}`">
          当前行动:玩家 {{ displayActor }}
        </span>
      </div>
      <div class="present-tools">
        <button type="button" :disabled="!history.length" :aria-pressed="playing" @click="play">{{ playing ? '暂停' : '播放快照' }}</button>
        <label class="speed-label">速度 <select v-model.number="speed"><option :value=".5">0.5×</option><option :value="1">1×</option><option :value="1.5">1.5×</option><option :value="2">2×</option></select></label>
        <button type="button" :aria-pressed="fit" @click="fit = !fit">{{ fit ? '原始大小' : '适应屏幕' }}</button>
        <div class="present-stepper" role="group" aria-label="快照播放控制">
          <button
            type="button"
            class="step-button"
            data-action="previous-step"
            :disabled="!canStepBack"
            title="上一步"
            aria-label="显示上一个快照"
            @click="stepBack"
          >
            <ArrowLeft :size="18" aria-hidden="true" />
          </button>
          <span class="present-step-label" aria-live="polite">{{ stepLabel }}</span>
          <button
            type="button"
            class="step-button"
            data-action="next-step"
            :disabled="!canStepForward"
            title="下一步"
            aria-label="显示下一个快照"
            @click="stepForward"
          >
            <ArrowRight :size="18" aria-hidden="true" />
          </button>
        </div>
        <span class="present-hint"><kbd>Ctrl</kbd>+<kbd>R</kbd> 回到开头 · Esc 退出</span>
        <button type="button" @click="toggleFullscreen">
          {{ isFullscreen ? '退出全屏' : '全屏' }}
        </button>
        <button type="button" class="primary" @click="emit('close')">退出演示</button>
      </div>
    </header>

    <div v-if="history.length" class="present-progress"><label>步骤 <input type="range" :value="stepIndex" min="0" :max="history.length" @input="seek" /></label><span>{{ activeSnapshot ? `${activeSnapshot.duration ?? 2} 秒 · ${activeSnapshot.action}` : '当前棋盘' }}</span></div>
    <div ref="viewport" class="present-viewport">
    <div ref="scene" class="present-board" :style="{ transform: `scale(${scale})` }">
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
          :changed-ids="changedIds"
          read-only
          @pick="previewCard"
          @set-mode="noop"
          @clear="noop"
          @preview="(uid, m) => emit('preview', uid, m)"
          @toggle-player="(uid) => emit('toggle-player', uid)"
          @remove="noop"
          @rename="noop"
        />
      </div>
      <ChainArrowLayer :arrows="displayedBoard.arrows ?? []" read-only />
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
.present-title h2 { font-size: 1.125rem; font-weight: 800; color: var(--color-text-primary); }
.present-play { font-size: 0.9375rem; color: var(--color-text-subtle); }
.present-actor {
  font-size: 0.875rem;
  padding: 1px 7px;
  border-radius: 4px;
  border: 1px solid var(--color-brand-faint);
  color: var(--color-brand);
}
.present-actor.p2 { border-color: var(--color-panel-border); color: var(--color-map-ramp-3); }

.present-tools { display: flex; align-items: center; gap: 9px; }
.present-hint { font-size: 0.875rem; color: var(--color-text-subtle); }
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
  font-size: 0.875rem;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.present-tools button {
  font-size: 0.9375rem;
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
  font-size: 1rem;
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
.present-viewport{position:relative;flex:1;min-height:0;overflow:auto;padding:.5rem}.present-board{position:absolute;left:.5rem;top:.5rem;width:calc(100% - 1rem);min-width:1000px;overflow:visible;transform-origin:top left}.present-progress{display:flex;gap:1rem;align-items:center;flex-wrap:wrap;padding:.5rem 1rem;font-size:.875rem}.present-progress label{display:flex;align-items:center;gap:.5rem;flex:1}.present-progress input{flex:1;min-width:0}.present-progress>span{overflow-wrap:anywhere;flex:1}.speed-label{font-size:.875rem}.speed-label select{border:1px solid var(--color-panel-border);padding:.375rem}.present-title,.present-tools{flex-wrap:wrap}.present-play,.present-actor,.present-step-label{font-size:.875rem}.present-tools button{min-height:2.5rem;font-size:.875rem}.present-board :deep(.zone-body){flex-wrap:wrap}.present-hint{font-size:.75rem}@media(max-width:650px){.present-bar{gap:.375rem;padding:.5rem}.present-title h2{font-size:1rem}.present-play,.present-hint{display:none}.present-tools{gap:.375rem}.present-step-label{max-width:8rem;min-width:4rem}.present-tools button{padding:.375rem .5rem}.present-progress>span{flex-basis:100%;font-size:.75rem}}
</style>
