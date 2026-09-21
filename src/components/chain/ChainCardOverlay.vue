<script setup lang="ts">
/**
 * ChainCardOverlay.vue · 卡牌大图浮层
 *
 * 触发方式(桌面):
 *   悬停 500ms 自动弹出,鼠标移开自动关闭
 *   单击钉住 —— 移开鼠标不关,需点空白处或按 Esc
 * 两种行为的差别就在 pin 上。
 */
import { computed } from 'vue';
import { CARD_COLOR_HEX } from '@/utils/palette';
import type { ChainCard } from '@/tools/chain/types';
import ChainCardText from './ChainCardText.vue';

const props = defineProps<{
  card: ChainCard;
  image: string;
  /** true = 单击钉住,需手动关闭;false = 悬停预览,移开即关 */
  pinned: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'toggle-pin'): void;
}>();

const title = computed(() =>
  props.card.subtitle ? `${props.card.name} · ${props.card.subtitle}` : props.card.name
);

const fallbackBackground = computed(() => {
  const hexes = props.card.colors
    .map((c) => CARD_COLOR_HEX[c as keyof typeof CARD_COLOR_HEX])
    .filter((h): h is string => typeof h === 'string');
  return hexes.length
    ? `linear-gradient(135deg, ${hexes.join(', ')})`
    : 'linear-gradient(135deg, #94a3b8, #64748b)';
});

const hasImage = computed(() => !!props.image);
</script>

<template>
  <div
    class="card-overlay"
    :class="{ pinned }"
    role="dialog"
    :aria-label="`卡牌详情:${title}`"
    @click.self="emit('close')"
    @mouseleave="pinned ? undefined : emit('close')"
  >
    <div class="overlay-panel" @click.self="emit('close')">
      <div class="overlay-art">
        <img v-if="hasImage" :src="image" :alt="card.name" />
        <div v-else class="overlay-fallback" :style="{ background: fallbackBackground }">
          <span>{{ card.name }}</span>
        </div>
      </div>

      <div class="overlay-info">
        <header class="overlay-head">
          <h3>{{ card.name }}</h3>
          <span class="overlay-player" :class="`p${card.player}`">
            {{ card.player === 1 ? '玩家 1' : '玩家 2' }}
          </span>
        </header>
        <p v-if="card.subtitle" class="overlay-subtitle">{{ card.subtitle }}</p>

        <dl class="overlay-stats">
          <div><dt>编号</dt><dd class="tabular-nums">{{ card.cardId || '自定义' }}</dd></div>
          <div><dt>类型</dt><dd>{{ card.category }}</dd></div>
          <div v-if="card.energy"><dt>费用</dt><dd class="tabular-nums">{{ card.energy }}</dd></div>
          <div v-if="card.power"><dt>战力</dt><dd class="tabular-nums">{{ card.power }}</dd></div>
        </dl>

        <div v-if="card.text" class="overlay-text">
          <ChainCardText :text="card.text" />
        </div>
        <p v-else class="overlay-empty">这张卡没有记录效果文本。</p>

        <footer class="overlay-foot">
          <span v-if="pinned" class="pin-hint">已钉住 · 点空白处或按 Esc 关闭</span>
          <span v-else class="pin-hint">按住 Alt 查看 · 松开或移开鼠标关闭</span>
          <div v-if="pinned" class="foot-actions">
            <button v-if="!pinned" type="button" @click="emit('toggle-pin')">钉住</button>
            <button type="button" @click="emit('close')">关闭</button>
          </div>
        </footer>
      </div>
    </div>
  </div>
</template>

<style scoped>
.card-overlay {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: 24px;
  background: color-mix(in srgb, var(--color-text-primary) 42%, transparent);
  backdrop-filter: blur(2px);
}
/* Hover previews must leave the source card available for clicking and dragging. */
.card-overlay:not(.pinned) {
  pointer-events: none;
  background: transparent;
  backdrop-filter: none;
}
.overlay-panel {
  display: grid;
  grid-template-columns: minmax(0, 300px) minmax(0, 380px);
  gap: 18px;
  max-width: 100%;
  max-height: 88vh;
  padding: 16px;
  border: 1px solid var(--color-card-border);
  border-radius: 14px;
  background: var(--color-card-bg);
  box-shadow: 0 30px 60px -30px rgba(0, 0, 0, 0.5);
  overflow: auto;
}
.overlay-art {
  border-radius: 9px;
  overflow: hidden;
  border: 1px solid var(--color-card-border);
  background: var(--color-page-bg);
  align-self: start;
}
.overlay-art img { width: 100%; display: block; }
.overlay-fallback {
  aspect-ratio: 5 / 7;
  display: grid;
  place-items: center;
  padding: 18px;
  text-align: center;
}
.overlay-fallback span {
  font-size: 18px;
  font-weight: 700;
  color: #fff;
  text-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
}

.overlay-info { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.overlay-head {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-wrap: wrap;
}
.overlay-head h3 {
  font-size: 19px;
  font-weight: 800;
  color: var(--color-text-primary);
}
.overlay-player {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid var(--color-brand-faint);
  color: var(--color-brand);
}
.overlay-player.p2 {
  border-color: var(--color-panel-border);
  color: var(--color-map-ramp-3);
}
.overlay-subtitle { font-size: 12.5px; color: var(--color-text-subtle); }

.overlay-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 8px 0;
  border-top: 1px solid var(--color-panel-border);
  border-bottom: 1px solid var(--color-panel-border);
}
.overlay-stats div { display: flex; align-items: baseline; gap: 4px; }
.overlay-stats dt { font-size: 10px; color: var(--color-text-subtle); }
.overlay-stats dd { font-size: 12px; font-weight: 600; color: var(--color-text-primary); }

.overlay-text { max-height: 34vh; overflow-y: auto; }
.overlay-empty { font-size: 11.5px; color: var(--color-text-subtle); }

.overlay-foot {
  margin-top: auto;
  padding-top: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border-top: 1px solid var(--color-panel-border);
}
.pin-hint { font-size: 10px; color: var(--color-text-subtle); }
.foot-actions { display: flex; gap: 6px; }
.foot-actions button {
  font-size: 11px;
  padding: 3px 10px;
  border: 1px solid var(--color-panel-border);
  border-radius: 6px;
  color: var(--color-text-muted);
}
.foot-actions button:hover { border-color: var(--color-brand); color: var(--color-brand); }

</style>
