<script setup lang="ts">
/**
 * ChainZone.vue · 一个推演区域
 *
 * 落点容器带 data-chain-area 属性 —— 拖拽层靠它认领区域
 * (见 src/tools/chain/useChainDnd.ts)。属性名不可随意更改。
 */
import { computed, ref } from 'vue';
import {
  AREA_META,
  DISPLAY_MODES,
  DISPLAY_MODE_LABELS,
  RESOLVE_CAPACITY,
  type CardDisplayMode,
  type ChainAreaKey,
  type ChainCard
} from '@/tools/chain/types';
import ChainCardChip from './ChainCardChip.vue';

const props = withDefaults(
  defineProps<{
    area: ChainAreaKey;
    cards: readonly ChainCard[];
    /** 区域显示模式 */
    mode: CardDisplayMode;
    actor: 1 | 2;
    /** 编号 → 卡图 URL */
    imageOf: (cardId: string) => string;
    /** 是否禁用来料(卡表未就绪) */
    disabled?: boolean;
    /** 「结算中」容量提示用 */
    capacityHint?: number;
    /** 只读模式(演示浮层):隐藏显示模式开关、清空与卡片操作 */
    readOnly?: boolean;
  }>(),
  { disabled: false, capacityHint: 0, readOnly: false }
);

const emit = defineEmits<{
  (e: 'set-mode', mode: CardDisplayMode): void;
  (e: 'clear'): void;
  (e: 'preview', uid: string, mode: 'hover' | 'leave' | 'click'): void;
  (e: 'toggle-player', uid: string): void;
  (e: 'remove', uid: string): void;
  (e: 'rename', uid: string, name: string): void;
}>();

const meta = computed(() => AREA_META[props.area]);
const zoneElement = ref<HTMLElement | null>(null);
defineExpose({ zoneElement });

const isFull = computed(
  () => props.capacityHint > 0 && props.cards.length >= props.capacityHint
);

/** 区域内玩家分布,给标题一个「谁占多数」的小提示 */
const playerCounts = computed(() => {
  let p1 = 0;
  let p2 = 0;
  for (const c of props.cards) {
    if (c.player === 1) p1 += 1;
    else p2 += 1;
  }
  return { p1, p2 };
});

/* ── 卡片事件转发 ──
 * 用显式方法而不是模板内联箭头函数:内联写法里 emit 的解析依赖
 * 模板编译细节,显式方法在任何编译配置下都稳,也更好读。 */
function onSetMode(mode: CardDisplayMode): void {
  emit('set-mode', mode);
}
function onPreview(uid: string, mode: 'hover' | 'leave' | 'click'): void {
  emit('preview', uid, mode);
}
function onTogglePlayer(uid: string): void {
  emit('toggle-player', uid);
}
function onRemove(uid: string): void {
  emit('remove', uid);
}
function onRename(uid: string, name: string): void {
  emit('rename', uid, name);
}
</script>

<template>
  <!--
    data-chain-area 必须挂在**根元素**上。
    拖拽层的 SortableJS 实例注册在这个 section 上,onEnd 里靠 evt.to 反查区域;
    如果属性挂在内层 .zone-body 上,evt.to 就查不到区域而静默丢弃落点(踩过)。
  -->
  <section
    ref="zoneElement"
    class="chain-zone"
    :class="[`zone-${area}`, { full: isFull }]"
    :data-chain-area="area"
    :data-drop-area="area"
  >
    <header class="zone-head">
      <div class="zone-title">
        <h3>{{ meta.label }}</h3>
        <span class="zone-latin">{{ meta.latin }}</span>
        <span class="zone-count tabular-nums">{{ cards.length }}</span>
        <span v-if="capacityHint > 0" class="zone-cap tabular-nums">/ {{ capacityHint }}</span>
        <span v-if="cards.length > 0" class="zone-players" :title="`玩家1 ${playerCounts.p1} 张 · 玩家2 ${playerCounts.p2} 张`">
          <i class="dot p1-dot"></i><b class="tabular-nums">{{ playerCounts.p1 }}</b>
          <i class="dot p2-dot"></i><b class="tabular-nums">{{ playerCounts.p2 }}</b>
        </span>
      </div>

      <div v-if="!readOnly && area !== 'resolve'" class="zone-tools">
        <div class="mode-switch" role="group" :aria-label="`${meta.label}显示模式`">
          <button
            v-for="m in DISPLAY_MODES"
            :key="m"
            type="button"
            class="mode-btn"
            :class="{ active: mode === m }"
            :title="`显示模式:${DISPLAY_MODE_LABELS[m]}`"
            @click="onSetMode(m)"
          >
            {{ DISPLAY_MODE_LABELS[m] }}
          </button>
        </div>
        <button
          v-if="cards.length > 0"
          type="button"
          class="zone-clear"
          title="清空本区域"
          @click="emit('clear')"
        >
          清空
        </button>      </div>
    </header>

    <!-- 拖拽落点(区域锚点在根元素上,见模板顶部说明) -->
    <div class="zone-body" :class="{ 'is-empty': cards.length === 0, 'is-full': isFull }">
      <ChainCardChip
        v-for="card in cards"
        :key="card.uid"
        :card="card"
        :mode="area === 'resolve' ? 'both' : mode"
        :text-if-no-image="area === 'resolve'"
        :image="imageOf(card.cardId)"
        :actor="actor"
        :read-only="readOnly"
        @preview="(m) => onPreview(card.uid, m)"
        @toggle-player="onTogglePlayer(card.uid)"
        @remove="onRemove(card.uid)"
        @rename="(name) => onRename(card.uid, name)"
      />
      <p v-if="cards.length === 0" class="zone-empty">
        {{ disabled ? '卡表载入中…' : isFull ? '已满' : '把右侧卡池的卡拖到这里' }}
      </p>
    </div>
  </section>
</template>

<style scoped>
.chain-zone {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 10px 12px 12px;
  border: 1px solid var(--color-panel-border);
  border-radius: 10px;
  background: var(--color-panel-bg);
}
.zone-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.zone-title {
  display: flex;
  align-items: baseline;
  gap: 7px;
  min-width: 0;
}
.zone-title h3 {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--color-text-primary);
  letter-spacing: 0.02em;
}
.zone-latin {
  font-size: 9.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-subtle);
}
.zone-count {
  font-size: 11px;
  color: var(--color-text-subtle);
}
.zone-cap { font-size: 10px; color: var(--color-text-subtle); }
.zone-players {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  color: var(--color-text-subtle);
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: inline-block;
}
.p1-dot { background: #b45309; }
.p2-dot { background: #0369a1; }

.zone-tools {
  display: flex;
  align-items: center;
  gap: 6px;
}
/* 显示模式:三档小开关,当前档朱砂底 */
.mode-switch {
  display: inline-flex;
  border: 1px solid var(--color-panel-border);
  border-radius: 6px;
  overflow: hidden;
}
.mode-btn {
  padding: 2px 6px;
  font-size: 10px;
  color: var(--color-text-subtle);
  background: var(--color-card-bg);
  border-right: 1px solid var(--color-panel-border);
}
.mode-btn:last-child { border-right: none; }
.mode-btn:hover { color: var(--color-brand); }
.mode-btn.active {
  background: var(--color-brand);
  color: var(--color-brand-ink);
  font-weight: 600;
}
.zone-clear {
  font-size: 10px;
  padding: 2px 6px;
  border: 1px solid var(--color-panel-border);
  border-radius: 6px;
  color: var(--color-text-subtle);
  background: var(--color-card-bg);
}
.zone-clear:hover { border-color: var(--color-brand); color: var(--color-brand); }

.zone-body {
  margin-top: 8px;
  min-height: 84px;
  display: flex;
  flex-direction: row;
  gap: 6px;
  padding: 6px;
  border: 1px dashed transparent;
  border-radius: 8px;
  transition: border-color 140ms, background-color 140ms;
}
.zone-body.is-empty {
  border-color: var(--color-panel-border);
}
.zone-body.is-full { background: var(--color-brand-soft); }
.zone-empty {
  margin: auto;
  font-size: 10.5px;
  color: var(--color-text-subtle);
  text-align: center;
  padding: 14px 8px;
}

/* 结算链与结算中并排时,内部卡横向铺开 */
.zone-chain .zone-body {
  flex-direction: row;
  flex-wrap: wrap;
  align-items: flex-start;
}
.zone-chain :deep(.chain-card) { width: 180px; }
.zone-chain :deep(.chain-card.mode-image),
.zone-chain :deep(.chain-card.mode-both) { width: 96px; }
.zone-resolve .zone-body { min-height: 104px; }
.zone-resolve :deep(.chain-card) { width: 100%; }
.zone-resolve :deep(.card-name) { font-size: 12px; }
.zone-resolve .zone-body { padding: 0; }
.zone-resolve .zone-head { align-items: stretch; flex-direction: column; }
.zone-resolve .zone-title { gap: 4px; }
.zone-resolve .zone-latin,
.zone-resolve .zone-players { display: none; }
/* 拖拽落点高亮:类名由 useChainDnd 在 dragover 时挂上 */
.chain-zone.chain-drop-active { border-color: var(--color-brand); }
.chain-zone.chain-drop-active .zone-body {
  border-color: var(--color-brand);
  background: var(--color-brand-soft);
}
</style>
