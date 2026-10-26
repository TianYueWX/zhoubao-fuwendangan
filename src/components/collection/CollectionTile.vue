<script setup lang="ts">
import { computed } from "vue";
import CarddexImage from "@/components/carddex/CarddexImage.vue";
import { languageLabel, printVersion, QUANTITY_MAX } from "@/tools/collection/model";
import type { CollectionItem } from "@/tools/collection/query";

const props = defineProps<{ item: CollectionItem; dim?: boolean }>();
const emit = defineEmits<{ open: []; change: [delta: number] }>();

const print = computed(() => props.item.print);
const landscape = computed(() => props.item.base.categories.includes("战场"));
const version = computed(() => (print.value ? printVersion(print.value) : "平卡"));
const owned = computed(() => props.item.quantity > 0);
const meta = computed(() => {
  if (!print.value) return "";
  const parts = [print.value.cardNo, languageLabel(print.value.language)];
  if (version.value !== "平卡") parts.push(version.value);
  return parts.join(" · ");
});
const label = computed(
  () => `${props.item.base.nameCn}，${meta.value}，持有 ${props.item.quantity} 张`,
);
</script>

<template>
  <article class="collection-tile" :class="{ dim: props.dim }">
    <button type="button" class="tile-art" :aria-label="`查看 ${label}`" @click="emit('open')">
      <CarddexImage
        v-if="print"
        :src="print.imageUrl"
        :fallback="print.ttsUrl"
        :alt="item.base.nameCn"
        :landscape="landscape"
      />
      <span v-else class="tile-no-art">无卡图</span>
    </button>

    <div class="tile-caption">
      <strong>{{ item.base.nameCn }}</strong>
      <small>{{ meta }}</small>
    </div>

    <div class="tile-stepper">
      <button
        type="button"
        :disabled="!owned"
        :aria-label="`${item.base.nameCn} 减少一张`"
        @click="emit('change', -1)"
      >
        −
      </button>
      <b :class="{ none: !owned }">{{ item.quantity }}</b>
      <button
        type="button"
        :disabled="item.quantity >= QUANTITY_MAX"
        :aria-label="`${item.base.nameCn} 增加一张`"
        @click="emit('change', 1)"
      >
        ＋
      </button>
    </div>
  </article>
</template>

<style scoped>
.collection-tile {
  display: flex;
  flex-direction: column;
  min-width: 0;
  border: 1px solid var(--color-card-border);
  border-radius: 10px;
  background: var(--color-card-bg);
  overflow: hidden;
  transition:
    transform 160ms ease,
    box-shadow 160ms ease,
    border-color 160ms ease;
}

.collection-tile:hover {
  transform: translateY(-2px);
  border-color: var(--color-panel-border);
  box-shadow: 0 10px 22px -18px var(--color-shadow);
}

.collection-tile.dim .tile-art :deep(img) {
  filter: grayscale(0.6);
  opacity: 0.55;
}

.tile-art {
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  border-bottom: 1px solid var(--color-card-border);
  background: var(--color-card-bg);
  cursor: pointer;
}

.tile-art:focus-visible {
  outline: 2px solid var(--color-brand);
  outline-offset: -2px;
}

.tile-no-art {
  display: grid;
  place-items: center;
  aspect-ratio: 5 / 7;
  color: var(--color-text-subtle);
  font-size: 10px;
}

.tile-caption {
  padding: 6px 8px 4px;
  min-width: 0;
}

.tile-caption strong {
  display: block;
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tile-caption small {
  display: block;
  overflow: hidden;
  margin-top: 1px;
  color: var(--color-text-subtle);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tile-stepper {
  display: grid;
  grid-template-columns: 28px 1fr 28px;
  align-items: stretch;
  height: 28px;
  margin-top: auto;
  border-top: 1px solid var(--color-card-border);
}

.tile-stepper button {
  display: grid;
  place-items: center;
  border: 0;
  background: transparent;
  color: var(--color-text-muted);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  transition: background-color 140ms ease;
}

.tile-stepper button:hover:not(:disabled) {
  background: var(--color-brand-soft);
  color: var(--color-brand);
}

.tile-stepper button:focus-visible {
  outline: 2px solid var(--color-brand);
  outline-offset: -2px;
}

.tile-stepper button:disabled {
  color: var(--color-text-subtle);
  opacity: 0.45;
  cursor: default;
}

.tile-stepper b {
  display: grid;
  place-items: center;
  color: var(--color-brand);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  border-left: 1px solid var(--color-card-border);
  border-right: 1px solid var(--color-card-border);
}

.tile-stepper b.none {
  color: var(--color-text-subtle);
  font-weight: 400;
}

@media (max-width: 600px) {
  .tile-stepper {
    height: 32px;
    grid-template-columns: 32px 1fr 32px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .collection-tile,
  .collection-tile:hover {
    transform: none;
    transition: none;
  }
}
</style>
