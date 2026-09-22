<script setup lang="ts">
import { computed } from "vue";
import CarddexImage from "./CarddexImage.vue";
import type { CarddexLocale, DisplayCard } from "./types";

const props = defineProps<{
  item: DisplayCard;
  locale: CarddexLocale;
  pinned: boolean;
}>();
const emit = defineEmits<{ open: []; pin: [] }>();
const landscape = computed(() => props.item.base.categories.includes("战场"));
const name = computed(() =>
  props.locale === "en"
    ? props.item.base.nameEn || props.item.base.nameCn
    : props.item.base.nameCn || props.item.base.nameEn,
);
</script>

<template>
  <article class="card-tile" :class="{ banned: item.base.banned }">
    <button class="card-open" type="button" @click="emit('open')">
      <CarddexImage
        :src="item.print?.imageUrl ?? ''"
        :fallback="item.print?.ttsUrl ?? ''"
        :alt="name"
        :landscape="landscape"
      />
      <span v-if="item.base.banned" class="banned-mark">{{
        locale === "zh" ? "禁" : "BANNED"
      }}</span>
    </button>
    <button
      class="pin-button"
      :class="{ active: pinned }"
      type="button"
      :aria-label="pinned ? 'Unpin' : 'Pin'"
      :aria-pressed="pinned"
      @click.stop="emit('pin')"
    >
      <span aria-hidden="true">◆</span>
    </button>
    <button class="tile-caption" type="button" @click="emit('open')">
      <strong :title="name">{{ name }}</strong>
      <small>{{ item.print?.cardNo || item.base.cardNo }}</small>
    </button>
  </article>
</template>

<style scoped>
.card-tile {
  position: relative;
  min-width: 0;
  align-self: start;
}
.card-open {
  position: relative;
  display: block;
  width: 100%;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--color-card-border);
  border-radius: 10px;
  background: var(--color-card-bg);
  box-shadow: 0 6px 18px -14px var(--color-shadow);
  transition:
    transform 0.18s,
    border-color 0.18s,
    box-shadow 0.18s;
}
.card-open:hover {
  transform: translateY(-2px);
  border-color: var(--color-brand-faint);
  box-shadow: 0 12px 28px -17px var(--color-shadow);
}
.banned .card-open :deep(img) {
  filter: grayscale(0.82);
}
.banned-mark {
  position: absolute;
  top: 7px;
  left: 7px;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--color-brand);
  color: var(--color-brand-ink);
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.08em;
}
.pin-button {
  position: absolute;
  z-index: 3;
  top: 7px;
  right: 7px;
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  color: white;
  background: rgba(44, 44, 44, 0.72);
  opacity: 0;
  transform: translateY(-3px);
  transition: 0.16s;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
}
.card-tile:hover .pin-button,
.pin-button:focus-visible,
.pin-button.active {
  opacity: 1;
  transform: none;
}
.pin-button.active {
  color: var(--color-brand-ink);
  background: var(--color-brand);
}
.tile-caption {
  width: 100%;
  padding: 8px 3px 0;
  text-align: left;
  min-width: 0;
}
.tile-caption strong {
  display: block;
  color: var(--color-text-muted);
  font-size: 12px;
  line-height: 1.35;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tile-caption small {
  display: block;
  margin-top: 2px;
  color: var(--color-text-subtle);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
@media (hover: none) {
  .pin-button {
    opacity: 1;
    transform: none;
  }
}
</style>
