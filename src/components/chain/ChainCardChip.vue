<script setup lang="ts">
/**
 * ChainCardChip.vue · 盘内一张卡
 *
 * 重要:外层元素的 data-uid 是拖拽层的唯一锚点,SortableJS 靠它
 * 认领节点(见 src/tools/chain/useChainDnd.ts)。不要改成动态属性名。
 *
 * 三种显示模式(上游的「显示模式」):
 *   text  → 名字－副标题
 *   image → 卡图(无图时降级为色块 + 卡名)
 *   both  → 上方卡图、下方名字－副标题
 */
import { computed, ref, watch } from 'vue';
import { CARD_COLOR_HEX } from '@/utils/palette';
import type { ChainCard } from '@/tools/chain/types';

const props = withDefaults(
  defineProps<{
    card: ChainCard;
    mode: 'text' | 'image' | 'both';
    image: string;
    actor: 1 | 2;
    /** 只读(演示浮层):隐藏卡片上的操作条 */
    readOnly?: boolean;
    textIfNoImage?: boolean;
  }>(),
  { readOnly: false, textIfNoImage: false }
);

const emit = defineEmits<{
  (e: 'preview', mode: 'hover' | 'leave' | 'click'): void;
  (e: 'toggle-player'): void;
  (e: 'remove'): void;
  (e: 'rename', name: string): void;
}>();

const imgFailed = ref(false);



const showImage = computed(() => props.mode !== 'text' && !props.card.custom);
const hasImage = computed(() => showImage.value && !!props.image && !imgFailed.value);

watch(() => props.image, () => { imgFailed.value = false; });
const displayMode = computed(() => props.textIfNoImage && !hasImage.value ? 'text' : props.mode);
const showText = computed(() => displayMode.value !== 'image');

const colorList = computed(() => props.card.colors);

/** 无卡图时的降级底色:按颜色域渐变 */
const fallbackBackground = computed(() => {
  const colors = colorList.value;
  if (colors.length === 0) return 'linear-gradient(135deg, #94a3b8, #64748b)';
  const hexes = colors
    .map((c) => CARD_COLOR_HEX[c as keyof typeof CARD_COLOR_HEX])
    .filter((h): h is string => typeof h === 'string');
  return `linear-gradient(135deg, ${hexes.join(', ') || '#94a3b8, #64748b'})`;
});

const title = computed(() =>
  props.card.subtitle ? `${props.card.name}－${props.card.subtitle}` : props.card.name
);

// The board gates previews on Alt; entering alone never opens a popup.
function onEnter(): void { emit('preview', 'hover'); }
function onLeave(): void { emit('preview', 'leave'); }

function onRename(): void {
  const next = window.prompt('重命名这张自定义卡:', props.card.name);
  if (next !== null && next.trim()) emit('rename', next.trim());
}


</script>

<template>
  <div
    class="chain-card"
    :class="[`p${card.player}`, `mode-${displayMode}`, { custom: card.custom }]"
    :data-uid="card.uid"
    :aria-label="`${title} · 按住 Alt 查看详情`"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
  >
    <span class="player-label">{{ card.player === 1 ? '玩家一' : '玩家二' }}</span>

    <!-- 卡图 -->
    <div v-if="displayMode !== 'text'" class="card-face">
      <img
        v-if="hasImage"
        :src="image"
        :alt="card.name"
        loading="lazy"
        draggable="false"
        @error="imgFailed = true"
      />
      <div v-else class="card-fallback" :style="{ background: fallbackBackground }">
        <span>{{ card.name }}</span>
      </div>
    </div>

    <!-- 文本 -->
    <div v-if="showText" class="card-body">
      <span class="card-name">{{ title }}</span>
    </div>

    <!-- 悬停操作条(桌面) -->
    <div v-if="!readOnly" class="card-actions" @click.stop>
      <button type="button" class="act" title="切换玩家归属" @click="emit('toggle-player')">
        {{ card.player === 1 ? 'P1→P2' : 'P2→P1' }}
      </button>
      <button v-if="card.custom" type="button" class="act" title="重命名" @click="onRename">改名</button>
      <button type="button" class="act act-danger" title="移出棋盘" @click="emit('remove')">移除</button>
    </div>

  </div>
</template>

<style scoped>
.chain-card {
  position: relative;
  display: flex;
  gap: 6px;
  padding: 5px 6px;
  border: 1px solid var(--color-card-border);
  border-radius: 6px;
  background: transparent;
  cursor: grab;
  overflow: hidden;
  /* 拖拽是纯指针手势:不能选中文字/图片,触屏下也不能触发页面滚动 */
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
  transition: border-color 140ms, box-shadow 140ms, transform 140ms;
}
.chain-card:hover {
  border-color: var(--color-brand-faint);
  box-shadow: 0 6px 16px -12px var(--color-shadow);
}
.chain-card:active { cursor: grabbing; }

.p1 { --player-color: #b45309; }
.p2 { --player-color: #0369a1; }
.player-label {
  position: absolute;
  top: 5px;
  left: 5px;
  pointer-events: none;
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--player-color);
  color: #fff;
  font-size: 9px;
  line-height: 16px;
  font-weight: 700;
}

.card-face {
  flex: 0 0 auto;
  width: 46px;
  aspect-ratio: 5 / 7;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid var(--color-card-border);
  background: var(--color-page-bg);
}
.card-face img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.card-fallback {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  padding: 4px;
  text-align: center;
}
.card-fallback span {
  font-size: 10px;
  font-weight: 600;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
  line-height: 1.3;
}

.card-body {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.card-name {
  font-weight: 600;
  font-size: 11px;
  line-height: 1.5;
  color: var(--color-text-primary);
  overflow-wrap: anywhere;
}

/* 操作条:默认透明隐藏,hover 时淡入 */
.card-actions {
  position: absolute;
  z-index: 1;
  top: 4px;
  right: 4px;
  display: flex;
  gap: 3px;
  opacity: 0;
  transition: opacity 140ms;
}
.chain-card:hover .card-actions { opacity: 1; }
.act {
  font-size: 9.5px;
  line-height: 1.4;
  padding: 1px 5px;
  border: 1px solid var(--color-panel-border);
  border-radius: 4px;
  background: var(--color-card-bg);
  color: var(--color-text-muted);
}
.act:hover { border-color: var(--color-brand); color: var(--color-brand); }
.act-danger:hover { border-color: var(--color-brand); color: var(--color-brand); }


/* 图片模式保持缩略图尺寸,图文模式在图片下方显示名称。 */
.mode-image, .mode-both {
  flex-direction: column;
  width: 96px;
  align-self: flex-start;
  gap: 4px;
  padding: 4px;
}
.mode-image .card-face, .mode-both .card-face { width: 100%; }
.mode-text { align-items: center; min-height: 30px; padding-left: 46px; }
.mode-image .card-body { display: none; }
</style>
