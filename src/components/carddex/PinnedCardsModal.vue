<script setup lang="ts">
import { computed, ref, watch } from "vue";
import CarddexTile from "./CarddexTile.vue";
import CarddexSortDialog from "./CarddexSortDialog.vue";
import { sortDisplayCards } from "./query";
import type { CarddexLocale, DisplayCard, SortRule } from "./types";

const props = defineProps<{
  open: boolean;
  locale: CarddexLocale;
  items: DisplayCard[];
  mainSort: SortRule[];
}>();
const emit = defineEmits<{
  close: [];
  openCard: [item: DisplayCard, context: DisplayCard[]];
  unpin: [item: DisplayCard];
  reorder: [keys: string[]];
  clear: [];
}>();
const mode = ref<"auto" | "manual">("auto");
const rules = ref<SortRule[]>([]);
const sortOpen = ref(false);
const dragKey = ref("");
watch(
  () => props.open,
  (v) => {
    if (v) {
      mode.value = "auto";
      rules.value = props.mainSort.map((r) => ({ ...r }));
    }
  },
);
const shown = computed(() =>
  mode.value === "auto"
    ? sortDisplayCards(props.items, rules.value)
    : props.items,
);
function drop(target: string): void {
  if (mode.value !== "manual" || !dragKey.value || dragKey.value === target)
    return;
  const keys = props.items.map((i) => i.key);
  const from = keys.indexOf(dragKey.value);
  const to = keys.indexOf(target);
  if (from < 0 || to < 0) return;
  const [key] = keys.splice(from, 1);
  if (key) keys.splice(to, 0, key);
  emit("reorder", keys);
  dragKey.value = "";
}
function clearAll(): void {
  if (
    confirm(
      props.locale === "zh"
        ? "确定清空全部标记吗？"
        : "Clear every pinned card?",
    )
  )
    emit("clear");
}
</script>
<template>
  <Teleport to="body"
    ><div v-if="open" class="pin-backdrop" @mousedown.self="emit('close')">
      <section class="pin-dialog" role="dialog" aria-modal="true">
        <header>
          <div>
            <small>{{ locale === "zh" ? "个人卡册" : "PERSONAL BOARD" }}</small>
            <h2>
              {{ locale === "zh" ? "已标记卡牌" : "Pinned cards" }}
              <b>{{ items.length }}</b>
            </h2>
          </div>
          <button @click="emit('close')">✕</button>
        </header>
        <nav>
          <div class="segments">
            <button :class="{ active: mode === 'auto' }" @click="mode = 'auto'">
              {{ locale === "zh" ? "主页排序" : "Page sort" }}</button
            ><button
              :class="{ active: mode === 'manual' }"
              @click="mode = 'manual'"
            >
              {{ locale === "zh" ? "手动顺序" : "Manual" }}
            </button>
          </div>
          <button v-if="mode === 'auto'" @click="sortOpen = true">
            {{ locale === "zh" ? "调整临时排序" : "Temporary sort" }}</button
          ><button class="clear" @click="clearAll">
            {{ locale === "zh" ? "清空" : "Clear" }}
          </button>
        </nav>
        <div v-if="shown.length" class="pin-grid">
          <div
            v-for="item in shown"
            :key="item.key"
            draggable="true"
            @dragstart="mode === 'manual' && (dragKey = item.key)"
            @dragover.prevent
            @drop="drop(item.key)"
          >
            <CarddexTile
              :item="item"
              :locale="locale"
              pinned
              @open="emit('openCard', item, shown)"
              @pin="emit('unpin', item)"
            />
          </div>
        </div>
        <div v-else class="empty">
          <b>◇</b>
          <p>
            {{ locale === "zh" ? "还没有标记卡牌" : "No pinned cards yet" }}
          </p>
        </div>
        <CarddexSortDialog
          :open="sortOpen"
          :locale="locale"
          :rules="rules"
          @close="sortOpen = false"
          @apply="
            (v) => {
              rules = v;
              sortOpen = false;
            }
          "
        />
      </section></div
  ></Teleport>
</template>
<style scoped>
.pin-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(35, 32, 28, 0.5);
  backdrop-filter: blur(5px);
}
.pin-dialog {
  width: min(1180px, 96vw);
  height: min(88vh, 850px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--color-page-bg);
  border: 1px solid var(--color-panel-border);
  border-radius: 14px;
  box-shadow: 0 28px 85px rgba(20, 15, 10, 0.3);
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 17px 21px;
  background: var(--color-card-bg);
  border-bottom: 1px solid var(--color-panel-border);
}
header small {
  color: var(--color-brand);
  font-size: 9px;
  letter-spacing: 0.18em;
}
h2 {
  font-family: "Noto Serif SC", serif;
  font-size: 20px;
  font-weight: 850;
}
h2 b {
  margin-left: 6px;
  color: var(--color-text-subtle);
  font: 500 12px/1 sans-serif;
}
nav {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  border-bottom: 1px solid var(--color-panel-border);
}
nav > button,
.segments button {
  padding: 6px 10px;
  border: 1px solid var(--color-card-border);
  border-radius: 7px;
  color: var(--color-text-muted);
  font-size: 10px;
}
.segments {
  display: flex;
}
.segments button {
  border-radius: 0;
}
.segments button:first-child {
  border-radius: 7px 0 0 7px;
}
.segments button:last-child {
  border-radius: 0 7px 7px 0;
}
.segments .active {
  background: var(--color-brand);
  border-color: var(--color-brand);
  color: var(--color-brand-ink);
}
nav .clear {
  margin-left: auto;
  color: var(--color-brand);
}
.pin-grid {
  flex: 1;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(135px, 1fr));
  align-content: start;
  gap: 18px 14px;
  padding: 20px;
}
.pin-grid > div[draggable="true"] {
  cursor: grab;
}
.empty {
  flex: 1;
  display: grid;
  place-content: center;
  text-align: center;
  color: var(--color-text-subtle);
}
.empty b {
  font-size: 34px;
  font-weight: 400;
}
.empty p {
  margin-top: 8px;
  font-size: 12px;
}
@media (max-width: 700px) {
  .pin-backdrop {
    padding: 0;
  }
  .pin-dialog {
    width: 100%;
    height: 100dvh;
    border: 0;
    border-radius: 0;
  }
  .pin-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px 10px;
    padding: 14px;
  }
  nav {
    overflow-x: auto;
  }
}
</style>
