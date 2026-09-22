<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type {
  ActiveFilter,
  CarddexLocale,
  FilterMode,
  FilterType,
  NumericFilters,
} from "./types";

const props = defineProps<{
  locale: CarddexLocale;
  filters: ActiveFilter[];
  numeric: NumericFilters;
  options: Record<FilterType, string[]>;
  bounds: Record<
    "energy" | "returnEnergy" | "power",
    { min: number; max: number }
  >;
  sections: Record<string, boolean>;
}>();
const emit = defineEmits<{
  apply: [filters: ActiveFilter[], numeric: NumericFilters];
  section: [type: string, open: boolean];
  close: [];
}>();
const assetBase = import.meta.env.BASE_URL;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const draftFilters = ref<ActiveFilter[]>([]);
const draftNumeric = ref<NumericFilters>(clone(props.numeric));
watch(
  () => [props.filters, props.numeric],
  () => {
    draftFilters.value = props.filters.map((f) => ({ ...f }));
    draftNumeric.value = clone(props.numeric);
  },
  { immediate: true, deep: true },
);

const labels: Record<FilterType, [string, string]> = {
  color: ["颜色", "Color"],
  category: ["类别", "Category"],
  series: ["系列", "Series"],
  rarity: ["稀有度", "Rarity"],
  region: ["地区", "Region"],
  tag: ["标签", "Tag"],
  keyword: ["关键词", "Keyword"],
  advancedTag: ["进阶标签", "Advanced tag"],
};
const order: FilterType[] = [
  "color",
  "category",
  "series",
  "rarity",
  "region",
  "tag",
  "keyword",
  "advancedTag",
];
const modeOrder: Array<FilterMode | null> = [
  "include",
  "require",
  "exclude",
  null,
];
function mode(type: FilterType, value: string): FilterMode | null {
  return (
    draftFilters.value.find((f) => f.type === type && f.value === value)
      ?.mode ?? null
  );
}
function cycle(type: FilterType, value: string): void {
  const current = mode(type, value);
  const next =
    modeOrder[(modeOrder.indexOf(current) + 1) % modeOrder.length] ?? null;
  draftFilters.value = draftFilters.value.filter(
    (f) => !(f.type === type && f.value === value),
  );
  if (next) draftFilters.value.push({ type, value, mode: next });
}
function clearMode(type: FilterType, value: string): void {
  draftFilters.value = draftFilters.value.filter(
    (f) => !(f.type === type && f.value === value),
  );
}
function reset(): void {
  draftFilters.value = [];
  draftNumeric.value = clone(props.bounds);
}
function selectedCount(type: FilterType): number {
  return draftFilters.value.filter((f) => f.type === type).length;
}
function isOpen(type: string): boolean {
  return props.sections[type] !== false;
}
function filterSignature(filters: readonly ActiveFilter[]): string {
  return filters
    .map((f) => `${f.type}:${f.value}:${f.mode}`)
    .sort()
    .join("|");
}
const filtersDirty = computed(
  () => filterSignature(draftFilters.value) !== filterSignature(props.filters),
);
const numericDirty = computed(() =>
  (["energy", "returnEnergy", "power"] as const).some((k) => {
    const draft = draftNumeric.value[k];
    const applied = props.numeric[k];
    return draft.min !== applied.min || draft.max !== applied.max;
  }),
);
const dirtyCount = computed(
  () =>
    (filtersDirty.value
      ? Math.max(draftFilters.value.length, props.filters.length, 1)
      : 0) + (numericDirty.value ? 1 : 0),
);
function applyDraft(): void {
  if (!dirtyCount.value) return;
  emit("apply", clone(draftFilters.value), clone(draftNumeric.value));
}
</script>

<template>
  <aside class="filter-panel" @keydown.shift.enter.prevent="applyDraft">
    <header class="filter-head">
      <div>
        <p>{{ locale === "zh" ? "检索条件" : "Filters" }}</p>
        <strong>{{ locale === "zh" ? "筛选卡牌" : "Refine cards" }}</strong>
      </div>
      <div class="legend">
        <span class="include"
          ><b>○</b>{{ locale === "zh" ? "可有" : "Any" }}</span
        >
        <span class="require"
          ><b>●</b>{{ locale === "zh" ? "必有" : "All" }}</span
        >
        <span class="exclude"
          ><b>×</b>{{ locale === "zh" ? "排除" : "Exclude" }}</span
        >
      </div>
      <button type="button" class="mobile-close" @click="emit('close')">
        ✕
      </button>
    </header>
    <div class="filter-scroll">
      <section v-for="type in order" :key="type" class="filter-section">
        <button
          class="section-toggle"
          type="button"
          @click="emit('section', type, !isOpen(type))"
        >
          <span>{{ labels[type][locale === "zh" ? 0 : 1] }}</span>
          <small v-if="selectedCount(type)">{{ selectedCount(type) }}</small>
          <b>{{ isOpen(type) ? "−" : "+" }}</b>
        </button>
        <div v-if="isOpen(type)" class="filter-options">
          <button
            v-for="option in options[type]"
            :key="option"
            type="button"
            :class="[
              'facet',
              mode(type, option),
              { 'color-facet': type === 'color' },
            ]"
            :title="
              type === 'color'
                ? option === 'colorless'
                  ? locale === 'zh'
                    ? '无色'
                    : 'Colorless'
                  : option
                : undefined
            "
            :aria-label="
              type === 'color'
                ? option === 'colorless'
                  ? locale === 'zh'
                    ? '无色'
                    : 'Colorless'
                  : option
                : undefined
            "
            @click="cycle(type, option)"
            @contextmenu.prevent="clearMode(type, option)"
          >
            <img
              v-if="type === 'color' && option !== 'colorless'"
              :src="`${assetBase}runes/${option}.svg`"
              alt=""
            />
            <span v-if="type !== 'color'">{{ option }}</span>
            <span
              v-else-if="option === 'colorless'"
              class="colorless-mark"
              aria-hidden="true"
              >◌</span
            >
            <em v-if="mode(type, option) && type !== 'color'">{{
              mode(type, option) === "include"
                ? "○"
                : mode(type, option) === "require"
                  ? "●"
                  : "×"
            }}</em>
          </button>
        </div>
      </section>
      <section class="filter-section numeric-section">
        <h3>{{ locale === "zh" ? "数值范围" : "Numeric ranges" }}</h3>
        <div
          v-for="k in ['energy', 'returnEnergy', 'power'] as const"
          :key="k"
          class="range-row"
        >
          <label>{{
            k === "energy"
              ? locale === "zh"
                ? "法力"
                : "Energy"
              : k === "returnEnergy"
                ? locale === "zh"
                  ? "符能"
                  : "Rune"
                : locale === "zh"
                  ? "战力"
                  : "Power"
          }}</label>
          <div class="range-values">
            <input
              v-model.number="draftNumeric[k].min"
              type="number"
              :min="bounds[k].min"
              :max="draftNumeric[k].max"
            /><span>—</span
            ><input
              v-model.number="draftNumeric[k].max"
              type="number"
              :min="draftNumeric[k].min"
              :max="bounds[k].max"
            />
          </div>
          <div class="range-sliders">
            <input
              v-model.number="draftNumeric[k].min"
              type="range"
              :min="bounds[k].min"
              :max="bounds[k].max"
              step="1"
            />
            <input
              v-model.number="draftNumeric[k].max"
              type="range"
              :min="bounds[k].min"
              :max="bounds[k].max"
              step="1"
            />
          </div>
        </div>
      </section>
    </div>
    <footer class="filter-foot">
      <button type="button" class="reset" @click="reset">
        {{ locale === "zh" ? "重置" : "Reset" }}
      </button>
      <button type="button" class="apply" @click="applyDraft">
        {{
          locale === "zh"
            ? `应用 ${dirtyCount ? `(${dirtyCount})` : ""}`
            : `Apply ${dirtyCount ? `(${dirtyCount})` : ""}`
        }}
      </button>
    </footer>
  </aside>
</template>

<style scoped>
.filter-panel {
  height: calc(100vh - 130px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--color-panel-border);
  background: var(--color-card-bg);
}
.filter-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 16px 17px 12px;
  border-bottom: 1px solid var(--color-panel-border);
}
.filter-head > div:first-child {
  min-width: 0;
  flex: 1 1 auto;
}
.filter-head p {
  color: var(--color-brand);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.16em;
}
.filter-head strong {
  display: block;
  margin-top: 3px;
  font-family: "Noto Serif SC", serif;
  font-size: 18px;
}
.legend {
  display: flex;
  gap: 7px;
  flex: 0 0 auto;
  padding: 0;
}
.legend span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  border-radius: 999px;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
}
.legend b {
  font-size: 13px;
  line-height: 1;
}
.legend .include {
  background: #2f6f5e;
}
.legend .require {
  background: #315b96;
}
.legend .exclude {
  background: #953f38;
}
.filter-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 0 16px 14px;
}
.filter-section {
  border-bottom: 1px solid var(--color-panel-border);
}
.section-toggle {
  width: 100%;
  min-height: 46px;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text-primary);
  font-size: 13px;
  font-weight: 700;
  text-align: left;
}
.section-toggle small {
  min-width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: var(--color-brand-soft);
  color: var(--color-brand);
  font-size: 10px;
}
.section-toggle b {
  margin-left: auto;
  font-size: 18px;
  font-weight: 400;
}
.filter-options {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  padding: 0 0 15px;
}
.facet {
  min-height: 34px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid var(--color-card-border);
  border-radius: 7px;
  color: var(--color-text-primary);
  background: transparent;
  font-size: 12px;
  font-weight: 560;
  line-height: 1.25;
  transition:
    background-color 0.15s,
    border-color 0.15s,
    color 0.15s,
    transform 0.15s;
}
.facet:hover {
  border-color: var(--color-text-subtle);
  background: var(--color-page-bg);
}
.facet:focus-visible {
  outline: 2px solid var(--color-brand);
  outline-offset: 2px;
}
.facet img {
  width: 17px;
  height: 17px;
}
.facet.color-facet {
  width: 38px;
  min-width: 38px;
  justify-content: center;
  padding-inline: 6px;
}
.facet.color-facet img {
  width: 21px;
  height: 21px;
}
.colorless-mark {
  display: inline-grid;
  width: 21px;
  height: 21px;
  place-items: center;
  border: 1.5px solid currentColor;
  border-radius: 50%;
  font-size: 16px;
  line-height: 1;
}
.facet em {
  margin-left: 1px;
  font-size: 14px;
  line-height: 1;
  font-style: normal;
  font-weight: 850;
}
.facet.include {
  color: #fff;
  background: #2f6f5e;
  border-color: #2f6f5e;
}
.facet.require {
  color: #fff;
  background: #315b96;
  border-color: #315b96;
}
.facet.exclude {
  color: #fff;
  background: #953f38;
  border-color: #953f38;
}
.facet:is(.include, .require, .exclude) img {
  filter: brightness(0) invert(1);
}
.numeric-section {
  padding: 15px 0 2px;
}
.numeric-section h3 {
  margin-bottom: 14px;
  color: var(--color-text-primary);
  font-size: 13px;
  font-weight: 700;
}
.range-row {
  margin-bottom: 20px;
}
.range-row > label {
  font-size: 12px;
  font-weight: 650;
  color: var(--color-text-muted);
}
.range-values {
  float: right;
  display: flex;
  align-items: center;
  gap: 5px;
}
.range-values input {
  width: 49px;
  padding: 3px 4px;
  border: 1px solid var(--color-card-border);
  border-radius: 5px;
  background: var(--color-page-bg);
  text-align: center;
  font-size: 12px;
}
.range-sliders {
  clear: both;
  display: grid;
  gap: 2px;
  padding-top: 6px;
}
.range-sliders input {
  width: 100%;
  accent-color: var(--color-brand);
}
.filter-foot {
  display: grid;
  grid-template-columns: 1fr 1.5fr;
  gap: 9px;
  padding: 12px 16px;
  border-top: 1px solid var(--color-panel-border);
  background: var(--color-card-bg);
}
.filter-foot button {
  min-height: 39px;
  padding: 9px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 700;
}
.reset {
  border: 1px solid var(--color-card-border);
  color: var(--color-text-muted);
}
.apply {
  background: var(--color-brand);
  color: var(--color-brand-ink);
}
.mobile-close {
  display: none;
}
@media (max-width: 1023px) {
  .filter-panel {
    height: 100dvh;
    border: 0;
  }
  .mobile-close {
    display: block;
  }
  .filter-head .legend {
    order: 3;
    flex-basis: 100%;
  }
}
</style>
