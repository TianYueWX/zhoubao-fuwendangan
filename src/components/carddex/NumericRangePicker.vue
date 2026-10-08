<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import type { CarddexLocale, NumberRange } from "./types";

const props = defineProps<{
  label: string;
  locale: CarddexLocale;
  range: NumberRange;
  bounds: NumberRange;
  initialEdge: "min" | "max";
}>();
const emit = defineEmits<{ confirm: [range: NumberRange]; close: [] }>();
const dialog = ref<HTMLDialogElement>();
const selected = ref({ ...props.range });
const highlighted = ref({ ...props.range });
const edges = ["min", "max"] as const;
type Edge = (typeof edges)[number];
const wheels: Partial<Record<Edge, HTMLElement>> = {};
const timers: Partial<Record<Edge, ReturnType<typeof setTimeout>>> = {};
const rowHeight = 44;
let previousFocus: HTMLElement | null = null;
let previousOverflow = "";

const values = computed(() =>
  Array.from(
    { length: props.bounds.max - props.bounds.min + 1 },
    (_, index) => props.bounds.min + index,
  ),
);
const title = computed(() => `${props.label}${props.locale === "zh" ? "范围" : " range"}`);
function edgeLabel(edge: Edge): string {
  return props.locale === "zh"
    ? edge === "min" ? "最小值" : "最大值"
    : edge === "min" ? "Minimum" : "Maximum";
}
function limits(edge: Edge): NumberRange {
  return edge === "min"
    ? { min: props.bounds.min, max: selected.value.max }
    : { min: selected.value.min, max: props.bounds.max };
}
function allowed(edge: Edge, value: number): boolean {
  const { min, max } = limits(edge);
  return value >= min && value <= max;
}
function align(edge: Edge): void {
  wheels[edge]?.scrollTo({ top: (selected.value[edge] - props.bounds.min) * rowHeight });
  highlighted.value[edge] = selected.value[edge];
}
function choose(edge: Edge, value: number): void {
  clearTimeout(timers[edge]);
  const { min, max } = limits(edge);
  selected.value[edge] = Math.max(min, Math.min(max, value));
  align(edge);
}
function wheelValue(edge: Edge): number {
  return props.bounds.min + Math.round((wheels[edge]?.scrollTop ?? 0) / rowHeight);
}
function settle(edge: Edge): void {
  choose(edge, wheelValue(edge));
}
function scroll(edge: Edge): void {
  highlighted.value[edge] = wheelValue(edge);
  clearTimeout(timers[edge]);
  timers[edge] = setTimeout(() => settle(edge), 140);
}
function keydown(event: KeyboardEvent, edge: Edge): void {
  const { min, max } = limits(edge);
  const targets: Partial<Record<string, number>> = {
    ArrowUp: selected.value[edge] + 1,
    ArrowDown: selected.value[edge] - 1,
    Home: min,
    End: max,
  };
  const next = targets[event.key];
  if (next === undefined) return;
  event.preventDefault();
  choose(edge, next);
}
function confirm(): void {
  // Read both wheels immediately so confirming during momentum uses visible values.
  for (const edge of edges) settle(edge);
  emit("confirm", { ...selected.value });
}
function backdrop(event: MouseEvent): void {
  if (event.target !== dialog.value) return;
  const rect = dialog.value.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right ||
      event.clientY < rect.top || event.clientY > rect.bottom) emit("close");
}
onMounted(async () => {
  previousFocus = document.activeElement as HTMLElement | null;
  previousOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  dialog.value?.showModal();
  await nextTick();
  for (const edge of edges) align(edge);
  wheels[props.initialEdge]?.focus({ preventScroll: true });
});
onBeforeUnmount(() => {
  for (const edge of edges) clearTimeout(timers[edge]);
  dialog.value?.close();
  if (document.body.style.overflow === "hidden") {
    document.body.style.overflow = previousOverflow;
  }
  if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
});
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="numeric-range-picker"
      :aria-label="title"
      @cancel.prevent="emit('close')"
      @click="backdrop"
      @keydown.stop
    >
      <header class="picker-head">
        <button type="button" class="picker-cancel" @click="emit('close')">
          {{ locale === "zh" ? "取消" : "Cancel" }}
        </button>
        <h2>{{ title }}</h2>
        <button type="button" class="picker-confirm" @click="confirm">
          {{ locale === "zh" ? "确定" : "Done" }}
        </button>
      </header>
      <div class="picker-columns">
        <section v-for="edge in edges" :key="edge" class="picker-column">
          <h3>{{ edgeLabel(edge) }}</h3>
          <div class="wheel-viewport">
            <div
              :ref="(el) => { if (el) wheels[edge] = el as HTMLElement; }"
              class="number-wheel"
              role="spinbutton"
              tabindex="0"
              :aria-label="`${label} ${edgeLabel(edge)}`"
              :aria-valuemin="limits(edge).min"
              :aria-valuemax="limits(edge).max"
              :aria-valuenow="selected[edge]"
              @scroll.passive="scroll(edge)"
              @keydown="keydown($event, edge)"
            >
              <div
                v-for="value in values"
                :key="value"
                class="wheel-number"
                :class="{ selected: highlighted[edge] === value, unavailable: !allowed(edge, value) }"
                aria-hidden="true"
                @click="allowed(edge, value) && choose(edge, value)"
              >{{ value }}</div>
            </div>
          </div>
        </section>
      </div>
      <p class="picker-hint">
        {{ locale === "zh" ? "上下滑动选择，也可点选数字" : "Swipe up or down, or tap a number" }}
      </p>
    </dialog>
  </Teleport>
</template>

<style scoped>
.numeric-range-picker {
  width: min(100%, 480px);
  max-width: 100vw;
  max-height: calc(100dvh - 16px);
  inset: auto 0 0;
  margin: 0 auto;
  padding: 0 0 env(safe-area-inset-bottom, 0px);
  overflow: auto;
  border: 1px solid var(--color-panel-border);
  border-bottom: 0;
  border-radius: 16px 16px 0 0;
  background: var(--color-card-bg);
  color: var(--color-text-primary);
  box-shadow: 0 -10px 40px var(--color-shadow);
}
.numeric-range-picker::backdrop {
  background: rgba(35, 32, 28, 0.48);
}
.picker-head {
  display: grid;
  grid-template-columns: 64px 1fr 64px;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-panel-border);
}
.picker-head h2 {
  margin: 0;
  text-align: center;
  font-size: 17px;
  font-weight: 700;
}
.picker-head button {
  min-height: 44px;
  border: 0;
  padding: 0;
  background: transparent;
  font-size: 15px;
}
.picker-cancel { color: var(--color-text-muted); }
.picker-confirm { color: var(--color-brand); font-weight: 700; }
.picker-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  padding: 18px 24px 0;
}
.picker-column { min-width: 0; }
.picker-column h3 {
  margin: 0 0 8px;
  text-align: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-muted);
}
.wheel-viewport { position: relative; }
.wheel-viewport::before {
  position: absolute;
  inset: 88px 0 auto;
  height: 44px;
  border-block: 1px solid var(--color-panel-border);
  border-radius: 6px;
  background: var(--color-brand-soft);
  content: "";
  pointer-events: none;
}
.wheel-viewport::after {
  position: absolute;
  inset: 0;
  background: linear-gradient(var(--color-card-bg), transparent 35%, transparent 65%, var(--color-card-bg));
  content: "";
  pointer-events: none;
}
.number-wheel {
  position: relative;
  height: 220px;
  box-sizing: border-box;
  overflow-y: auto;
  padding: 88px 0;
  scroll-snap-type: y mandatory;
  overscroll-behavior: contain;
  touch-action: pan-y;
  scrollbar-width: none;
}
.number-wheel::-webkit-scrollbar { display: none; }
.number-wheel:focus-visible, .picker-head button:focus-visible {
  outline: 2px solid var(--color-brand);
  outline-offset: -2px;
  border-radius: 6px;
}
.wheel-number {
  height: 44px;
  display: grid;
  place-items: center;
  scroll-snap-align: center;
  color: var(--color-text-muted);
  font-size: 21px;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  user-select: none;
  cursor: pointer;
}
.wheel-number.selected { color: var(--color-brand); font-size: 25px; font-weight: 700; }
.wheel-number.unavailable { opacity: 0.22; cursor: default; }
.picker-hint {
  margin: 12px 16px 18px;
  text-align: center;
  color: var(--color-text-subtle);
  font-size: 12px;
}
@media (max-height: 500px) {
  .number-wheel { height: 132px; padding-block: 44px; }
  .wheel-viewport::before { top: 44px; }
  .picker-columns { padding-top: 8px; }
  .picker-hint { margin-block: 6px; }
}
</style>
