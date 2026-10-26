<script setup lang="ts">
/**
 * 唯一的筛选面板：卡牌查询与我的卡池共用。
 *
 * 草稿制：面板里的改动只写进 draft，必须按「应用」才回传父级；重置只清 draft。
 * 分面组由 groups 描述——卡牌查询用标准八面（颜色/类别/系列/…），
 * 卡池在最前面多两个 toggle 组（语言/版本）。
 * 数值范围固定三行（法力/符能/战力），位置由 numericAfter 决定。
 */
import { computed, ref, watch } from "vue";
import {
  ChevronDown,
  Circle,
  CircleDashed,
  CircleDot,
  CircleX,
  Minus,
  Plus,
  X,
} from "@lucide/vue";
import NumericRangePicker from "./NumericRangePicker.vue";
import { standardFacetGroups } from "./facets";
import type {
  ActiveFilter,
  CarddexLocale,
  FacetGroupDef,
  FilterMode,
  FilterType,
  NumericFilters,
} from "./types";

const props = withDefaults(
  defineProps<{
    locale: CarddexLocale;
    filters: ActiveFilter[];
    numeric: NumericFilters;
    options: Record<FilterType, string[]>;
    bounds: Record<
      "energy" | "returnEnergy" | "power",
      { min: number; max: number }
    >;
    sections: Record<string, boolean>;
    /** 不传 = 标准八面 */
    groups?: FacetGroupDef[];
    /** toggle 组的已选值 */
    selections?: Record<string, string[]>;
    /** 数值范围插在第几组之前，默认 0（最上） */
    numericAfter?: number;
    title?: string;
    eyebrow?: string;
  }>(),
  {
    groups: () => [],
    selections: () => ({}),
    numericAfter: 0,
  },
);
const emit = defineEmits<{
  apply: [
    filters: ActiveFilter[],
    numeric: NumericFilters,
    selections: Record<string, string[]>,
  ];
  section: [id: string, open: boolean];
  close: [];
}>();
const assetBase = import.meta.env.BASE_URL;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const groups = computed<FacetGroupDef[]>(() =>
  props.groups.length ? props.groups : standardFacetGroups(props.options),
);

const draftFilters = ref<ActiveFilter[]>([]);
const draftNumeric = ref<NumericFilters>(clone(props.numeric));
const draftSelections = ref<Record<string, string[]>>({});
const rangePicker = ref<{ type: keyof NumericFilters; edge: "min" | "max" } | null>(
  null,
);
watch(
  () => [props.filters, props.numeric, props.selections],
  () => {
    draftFilters.value = props.filters.map((f) => ({ ...f }));
    draftNumeric.value = clone(props.numeric);
    draftSelections.value = clone(props.selections);
  },
  { immediate: true, deep: true },
);

const modeOrder: Array<FilterMode | null> = [
  "include",
  "require",
  "exclude",
  null,
];

function modeOf(groupId: string, value: string): FilterMode | null {
  return (
    draftFilters.value.find((f) => f.type === groupId && f.value === value)
      ?.mode ?? null
  );
}
function cycle(groupId: string, value: string): void {
  const current = modeOf(groupId, value);
  const next =
    modeOrder[(modeOrder.indexOf(current) + 1) % modeOrder.length] ?? null;
  draftFilters.value = draftFilters.value.filter(
    (f) => !(f.type === groupId && f.value === value),
  );
  if (next) {
    draftFilters.value.push({ type: groupId as FilterType, value, mode: next });
  }
}
function clearMode(groupId: string, value: string): void {
  draftFilters.value = draftFilters.value.filter(
    (f) => !(f.type === groupId && f.value === value),
  );
}
function isPicked(groupId: string, value: string): boolean {
  return (draftSelections.value[groupId] ?? []).includes(value);
}
function togglePick(groupId: string, value: string): void {
  const set = new Set(draftSelections.value[groupId] ?? []);
  if (set.has(value)) set.delete(value);
  else set.add(value);
  draftSelections.value = { ...draftSelections.value, [groupId]: [...set] };
}
function groupOptions(group: FacetGroupDef): string[] {
  return group.options ?? props.options[group.id as FilterType] ?? [];
}
function optionLabel(group: FacetGroupDef, value: string): string {
  return group.display?.[value] ?? value;
}
function colorLabel(value: string): string {
  if (value !== "colorless") return value;
  return props.locale === "zh" ? "无色" : "Colorless";
}
interface FacetIcon {
  url: string;
  white: boolean;
}
function iconOf(group: FacetGroupDef, value: string): FacetIcon | null {
  if (group.icon !== "rune") return null;
  if (value === "colorless") return null;
  return { url: `${assetBase}runes/${value}.svg`, white: false };
}
function localeText(zh: string, en: string): string {
  return props.locale === "zh" ? zh : en;
}
function groupCount(group: FacetGroupDef): number {
  if (group.kind === "toggle") return (draftSelections.value[group.id] ?? []).length;
  return draftFilters.value.filter((f) => f.type === group.id).length;
}
function isOpen(id: string): boolean {
  return props.sections[id] !== false;
}

const numericIndex = computed(() =>
  Math.max(0, Math.min(props.numericAfter, Math.max(groups.value.length - 1, 0))),
);
function membershipSignature(list: readonly ActiveFilter[]): string {
  return list
    .map((f) => `${f.type}:${f.value}:${f.mode}`)
    .sort()
    .join("|");
}
const filtersDirty = computed(
  () => membershipSignature(draftFilters.value) !== membershipSignature(props.filters),
);
const numericDirty = computed(() =>
  (["energy", "returnEnergy", "power"] as const).some((k) => {
    const draft = draftNumeric.value[k];
    const applied = props.numeric[k];
    return draft.min !== applied.min || draft.max !== applied.max;
  }),
);
function pickSignature(values: readonly string[] | undefined): string {
  return [...(values ?? [])].sort().join(",");
}
const selectionsDirtyCount = computed(
  () =>
    groups.value.filter(
      (group) =>
        group.kind === "toggle" &&
        pickSignature(draftSelections.value[group.id]) !==
          pickSignature(props.selections[group.id]),
    ).length,
);
const dirtyCount = computed(
  () =>
    (filtersDirty.value
      ? Math.max(draftFilters.value.length, props.filters.length, 1)
      : 0) +
    (numericDirty.value ? 1 : 0) +
    selectionsDirtyCount.value,
);

function reset(): void {
  draftFilters.value = [];
  draftNumeric.value = clone(props.bounds);
  draftSelections.value = {};
}
function normalizeRange(type: keyof NumericFilters, edge: "min" | "max"): void {
  const range = draftNumeric.value[type];
  const bounds = props.bounds[type];
  for (const key of ["min", "max"] as const) {
    const value = Number.isFinite(range[key]) ? Math.round(range[key]) : bounds[key];
    range[key] = Math.min(bounds.max, Math.max(bounds.min, value));
  }
  if (range.min > range.max) range[edge] = range[edge === "min" ? "max" : "min"];
}
function scrollRange(event: WheelEvent, type: keyof NumericFilters, edge: "min" | "max"): void {
  if (!event.deltaY) return;
  event.preventDefault();
  normalizeRange(type, edge);
  draftNumeric.value[type][edge] += event.deltaY < 0 ? 1 : -1;
  normalizeRange(type, edge);
}
function openRangePicker(type: keyof NumericFilters, edge: "min" | "max"): void {
  normalizeRange(type, edge);
  rangePicker.value = { type, edge };
}
function numericLabel(type: "energy" | "returnEnergy" | "power"): string {
  if (type === "energy") return localeText("法力", "Energy");
  if (type === "returnEnergy") return localeText("符能", "Rune");
  return localeText("战力", "Power");
}
function applyDraft(): void {
  for (const type of ["energy", "returnEnergy", "power"] as const) {
    normalizeRange(type, "min");
  }
  emit(
    "apply",
    clone(draftFilters.value),
    clone(draftNumeric.value),
    clone(draftSelections.value),
  );
}
</script>

<template>
  <aside class="filter-panel" @keydown.shift.enter.prevent="applyDraft">
    <header class="filter-head">
      <div>
        <p>{{ eyebrow ?? (locale === "zh" ? "检索条件" : "Filters") }}</p>
        <strong>{{ title ?? (locale === "zh" ? "筛选卡牌" : "Refine cards") }}</strong>
      </div>
      <div class="legend">
        <span class="include"
          ><b><Circle :size="13" /></b>{{ locale === "zh" ? "可有" : "Any" }}</span
        >
        <span class="require"
          ><b><CircleDot :size="13" /></b>{{ locale === "zh" ? "必有" : "All" }}</span
        >
        <span class="exclude"
          ><b><CircleX :size="13" /></b>{{ locale === "zh" ? "排除" : "Exclude" }}</span
        >
      </div>
      <button type="button" class="mobile-close" @click="emit('close')">
        <X :size="18" aria-hidden="true" />
      </button>
    </header>
    <div class="filter-scroll">
      <template v-for="(group, index) in groups" :key="group.id">
        <section v-if="index === numericIndex" class="filter-section numeric-section">
          <div
            v-for="k in ['energy', 'returnEnergy', 'power'] as const"
            :key="k"
            class="range-row"
          >
            <span class="range-label">{{ numericLabel(k) }}</span>
            <div class="range-values">
              <input
                v-model.number="draftNumeric[k].min"
                class="desktop-range-input"
                type="number"
                inputmode="numeric"
                :aria-label="`${numericLabel(k)} ${localeText('最小值', 'minimum')}`"
                :title="localeText('滚轮调整，也可直接输入', 'Scroll to adjust or type a number')"
                :min="bounds[k].min"
                :max="draftNumeric[k].max"
                step="1"
                @change="normalizeRange(k, 'min')"
                @wheel="scrollRange($event, k, 'min')"
              />
              <button
                type="button"
                class="touch-range-input"
                :aria-label="`${numericLabel(k)} ${localeText('最小值', 'minimum')} ${draftNumeric[k].min}`"
                aria-haspopup="dialog"
                @click="openRangePicker(k, 'min')"
              >
                <span>{{ draftNumeric[k].min }}</span><ChevronDown :size="14" aria-hidden="true" />
              </button>
              <span aria-hidden="true">—</span
              ><input
                v-model.number="draftNumeric[k].max"
                class="desktop-range-input"
                type="number"
                inputmode="numeric"
                :aria-label="`${numericLabel(k)} ${localeText('最大值', 'maximum')}`"
                :title="localeText('滚轮调整，也可直接输入', 'Scroll to adjust or type a number')"
                :min="draftNumeric[k].min"
                :max="bounds[k].max"
                step="1"
                @change="normalizeRange(k, 'max')"
                @wheel="scrollRange($event, k, 'max')"
              />
              <button
                type="button"
                class="touch-range-input"
                :aria-label="`${numericLabel(k)} ${localeText('最大值', 'maximum')} ${draftNumeric[k].max}`"
                aria-haspopup="dialog"
                @click="openRangePicker(k, 'max')"
              >
                <span>{{ draftNumeric[k].max }}</span><ChevronDown :size="14" aria-hidden="true" />
              </button>
            </div>
          </div>
        </section>
        <section class="filter-section">
          <button
            class="section-toggle"
            type="button"
            @click="emit('section', group.id, !isOpen(group.id))"
          >
            <span>{{ group.label[locale === "zh" ? 0 : 1] }}</span>
            <small v-if="groupCount(group)">{{ groupCount(group) }}</small>
            <b><Minus v-if="isOpen(group.id)" :size="14" /><Plus v-else :size="14" /></b>
          </button>
          <div v-if="isOpen(group.id)" class="filter-options">
            <button
              v-for="option in groupOptions(group)"
              :key="option"
              type="button"
              :class="[
                'facet',
                group.kind === 'toggle'
                  ? isPicked(group.id, option)
                    ? 'include'
                    : null
                  : modeOf(group.id, option),
                {
                  'color-facet': group.icon === 'rune',
                  'icon-facet': !!iconOf(group, option),
                },
              ]"
              :title="
                group.icon === 'rune'
                  ? colorLabel(option)
                  : optionLabel(group, option)
              "
              :aria-label="
                group.icon === 'rune'
                  ? colorLabel(option)
                  : optionLabel(group, option)
              "
              :aria-pressed="
                group.kind === 'toggle'
                  ? isPicked(group.id, option)
                  : !!modeOf(group.id, option)
              "
              @click="
                group.kind === 'toggle'
                  ? togglePick(group.id, option)
                  : cycle(group.id, option)
              "
              @contextmenu.prevent="
                group.kind === 'cycle' && clearMode(group.id, option)
              "
            >
              <img
                v-if="iconOf(group, option)"
                :src="iconOf(group, option)!.url"
                :class="{ white: iconOf(group, option)!.white }"
                alt=""
              />
              <span
                v-else-if="group.icon === 'rune' && option === 'colorless'"
                class="colorless-mark"
                aria-hidden="true"
                ><CircleDashed :size="14" aria-hidden="true" /></span
              >
              <span v-else>{{ optionLabel(group, option) }}</span>
              <em
                v-if="
                  group.kind === 'cycle' &&
                  modeOf(group.id, option) &&
                  !iconOf(group, option)
                "
                ><Circle
                  v-if="modeOf(group.id, option) === 'include'"
                  :size="12" /><CircleDot
                  v-else-if="modeOf(group.id, option) === 'require'"
                  :size="12" /><CircleX v-else :size="12"
              /></em>
            </button>
          </div>
        </section>
      </template>
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
  <NumericRangePicker
    v-if="rangePicker"
    :label="numericLabel(rangePicker.type)"
    :locale="locale"
    :range="draftNumeric[rangePicker.type]"
    :bounds="bounds[rangePicker.type]"
    :initial-edge="rangePicker.edge"
    @confirm="(range) => { if (rangePicker) draftNumeric[rangePicker.type] = range; rangePicker = null; }"
    @close="rangePicker = null"
  />
</template>

<style scoped>
.filter-panel {
  /* 高度由父级给：桌面是 sticky 的 .desktop-filter，移动端是 100dvh 全屏浮层 */
  height: 100%;
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
  min-height: 0;
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
/* 图标表里的白色素材放到宣纸底色上会看不见，与卡牌详情同一套反色。 */
.facet img.white {
  filter: invert(1);
}
.facet.color-facet,
.facet.icon-facet {
  min-width: 38px;
  justify-content: center;
  padding-inline: 6px;
}
.facet.color-facet img {
  width: 21px;
  height: 21px;
}
.facet.icon-facet img {
  width: 100%;
  height: 20px;
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
.color-facet:is(.include, .require, .exclude) img {
  filter: brightness(0) invert(1);
}
/* 已经反过色的白图标落到实底芯片上要还原，否则会变成黑块。 */
.facet:is(.include, .require, .exclude) img.white {
  filter: none;
}
.numeric-section {
  padding: 15px 0 9px;
}
.range-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px 12px;
  margin-bottom: 13px;
}
.range-label {
  grid-column: 1;
  font-size: 12px;
  font-weight: 650;
  color: var(--color-text-muted);
}
.range-values {
  grid-column: 2;
  display: flex;
  align-items: center;
  gap: 5px;
}
.range-values input,
.touch-range-input {
  width: 60px;
  height: 34px;
  padding: 5px;
  border: 1px solid var(--color-card-border);
  border-radius: 5px;
  background: var(--color-page-bg);
  text-align: center;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.range-values input:focus-visible,
.touch-range-input:focus-visible {
  border-color: var(--color-brand);
  outline: 2px solid var(--color-brand-soft);
  outline-offset: 1px;
}
.touch-range-input {
  display: none;
}
@media (max-width: 1023px), (pointer: coarse) {
  .range-values .desktop-range-input {
    display: none;
  }
  .touch-range-input {
    display: inline-flex;
    align-items: center;
    justify-content: space-between;
    width: 72px;
    height: 44px;
    padding: 8px 10px;
    color: var(--color-text-primary);
    font-size: 16px;
  }
  .range-label {
    font-size: 14px;
  }
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
