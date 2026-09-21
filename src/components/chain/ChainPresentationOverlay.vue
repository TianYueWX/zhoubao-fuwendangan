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
 * 差别只在于:去掉管理界面、把卡片放大、区域不再接受编辑操作。
 */
import { onMounted, onUnmounted, ref } from 'vue';
import { AREA_ORDER, type CardDisplayMode, type ChainAreaKey, type ChainCard } from '@/tools/chain/types';
import { chainStore } from '@/tools/chain/store';
import ChainZone from './ChainZone.vue';

const props = defineProps<{
  cardsOf: (area: ChainAreaKey) => readonly ChainCard[];
  modeOf: (area: ChainAreaKey) => CardDisplayMode;
  actor: 1 | 2;
  imageOf: (cardId: string) => string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'preview', uid: string, mode: 'hover' | 'leave' | 'click'): void;
  (e: 'toggle-player', uid: string): void;
}>();

const isFullscreen = ref(false);

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
  }
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
        <span class="present-actor" :class="`p${actor}`">
          当前行动:玩家 {{ actor }}
        </span>
      </div>
      <div class="present-tools">
        <span class="present-hint">按 Esc 退出</span>
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
          :cards="cardsOf(area)"
          :mode="modeOf(area)"
          :actor="actor"
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
.present-tools button {
  font-size: 12px;
  padding: 4px 13px;
  border: 1px solid var(--color-panel-border);
  border-radius: 7px;
  color: var(--color-text-muted);
  background: var(--color-card-bg);
}
.present-tools button:hover { border-color: var(--color-brand); color: var(--color-brand); }
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

/* 演示模式:卡片放大,卡面更清楚 */
.present-board :deep(.chain-card) { width: 300px; }
.present-board :deep(.zone-chain .chain-card) { width: 280px; }
.present-board :deep(.card-name) { font-size: 14px; }
.present-board :deep(.chain-card-text) { font-size: 12.5px; }
.present-board :deep(.zone-checkbox) { display: none; }
</style>
