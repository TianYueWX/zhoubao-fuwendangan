<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ChevronDown } from "@lucide/vue";
import type { ActiveFilter, FilterMode, FilterType } from "@/components/carddex/types";
import { languageLabel, printVersion, type CollectionVersion } from "@/tools/collection/model";

const props = withDefaults(
  defineProps<{
    languages: string[];
    versions: CollectionVersion[];
    options: Record<FilterType, string[]>;
    activeLanguages: string[];
    activeVersions: string[];
    filters: ActiveFilter[];
    sections: Record<string, boolean>;
  }>(),
  { sections: () => ({}) },
);

const emit = defineEmits<{
  languages: [value: string[]];
  versions: [value: string[]];
  filters: [value: ActiveFilter[]];
  section: [id: string, open: boolean];
  clear: [];
}>();

const FACETS: { id: FilterType; label: string }[] = [
  { id: "series", label: "系列" },
  { id: "category", label: "类别" },
  { id: "color", label: "颜色" },
  { id: "rarity", label: "稀有度" },
  { id: "region", label: "地区" },
  { id: "tag", label: "标签" },
  { id: "keyword", label: "关键词" },
  { id: "advancedTag", label: "进阶标签" },
];

const localOpen = ref<Record<string, boolean>>({});
watch(
  () => props.sections,
  (value) => {
    localOpen.value = { ...value };
  },
  { immediate: true, deep: true },
);

const LANGUAGE_SECTION = "language";
const VERSION_SECTION = "version";

function isOpen(id: string, fallback = false): boolean {
  const value = localOpen.value[id];
  return typeof value === "boolean" ? value : fallback;
}

function toggle(id: string, fallback = false): void {
  const next = !isOpen(id, fallback);
  localOpen.value = { ...localOpen.value, [id]: next };
  emit("section", id, next);
}

function facetMode(type: FilterType, value: string): FilterMode | null {
  const hit = props.filters.filter((f) => f.type === type && f.value === value).at(-1);
  return hit ? hit.mode : null;
}

function cycleFacet(type: FilterType, value: string): void {
  const current = facetMode(type, value);
  const next: FilterMode | null =
    current === null ? "include" : current === "include" ? "require" : current === "require" ? "exclude" : null;
  const rest = props.filters.filter((f) => !(f.type === type && f.value === value));
  emit("filters", next ? [...rest, { type, value, mode: next }] : rest);
}

function toggleLanguage(code: string): void {
  const set = new Set(props.activeLanguages);
  if (set.has(code)) set.delete(code);
  else set.add(code);
  emit("languages", [...set]);
}

function toggleVersion(version: CollectionVersion): void {
  const set = new Set(props.activeVersions);
  if (set.has(version)) set.delete(version);
  else set.add(version);
  emit("versions", [...set]);
}

function facetCount(type: FilterType): number {
  return props.filters.filter((f) => f.type === type).length;
}

const total = computed(
  () => props.activeLanguages.length + props.activeVersions.length + props.filters.length,
);
</script>

<template>
  <aside class="collection-filters" aria-label="卡池筛选">
    <header class="filter-top">
      <strong>筛选</strong>
      <button type="button" :disabled="!total" @click="emit('clear')">清空</button>
    </header>

    <section class="filter-group">
      <button type="button" class="filter-head" :aria-expanded="isOpen(LANGUAGE_SECTION, true)" @click="toggle(LANGUAGE_SECTION, true)">
        <span>语言</span>
        <small>{{ activeLanguages.length || "" }}</small>
        <ChevronDown :size="13" :class="['chev', { open: isOpen(LANGUAGE_SECTION, true) }]" aria-hidden="true" />
      </button>
      <div v-if="isOpen(LANGUAGE_SECTION, true)" class="filter-body">
        <button
          v-for="code in languages"
          :key="code"
          type="button"
          class="chip"
          :class="{ include: activeLanguages.includes(code) }"
          :aria-pressed="activeLanguages.includes(code)"
          @click="toggleLanguage(code)"
        >
          {{ languageLabel(code) }}
        </button>
        <p v-if="!languages.length" class="filter-empty">卡表载入后出现</p>
      </div>
    </section>

    <section class="filter-group">
      <button type="button" class="filter-head" :aria-expanded="isOpen(VERSION_SECTION, true)" @click="toggle(VERSION_SECTION, true)">
        <span>版本</span>
        <small>{{ activeVersions.length || "" }}</small>
        <ChevronDown :size="13" :class="['chev', { open: isOpen(VERSION_SECTION, true) }]" aria-hidden="true" />
      </button>
      <div v-if="isOpen(VERSION_SECTION, true)" class="filter-body">
        <button
          v-for="version in versions"
          :key="version"
          type="button"
          class="chip"
          :class="{ include: activeVersions.includes(version) }"
          :aria-pressed="activeVersions.includes(version)"
          @click="toggleVersion(version)"
        >
          {{ version }}
        </button>
        <p v-if="!versions.length" class="filter-empty">卡表载入后出现</p>
      </div>
    </section>

    <section v-for="facet in FACETS" :key="facet.id" class="filter-group">
      <button type="button" class="filter-head" :aria-expanded="isOpen(facet.id)" @click="toggle(facet.id)">
        <span>{{ facet.label }}</span>
        <small>{{ facetCount(facet.id) || "" }}</small>
        <ChevronDown :size="13" :class="['chev', { open: isOpen(facet.id) }]" aria-hidden="true" />
      </button>
      <div v-if="isOpen(facet.id)" class="filter-body">
        <button
          v-for="value in options[facet.id] ?? []"
          :key="value"
          type="button"
          class="chip"
          :class="facetMode(facet.id, value)"
          :aria-pressed="!!facetMode(facet.id, value)"
          :title="'点击切换 包含 / 必须 / 排除'"
          @click="cycleFacet(facet.id, value)"
        >
          {{ value }}
        </button>
        <p v-if="!(options[facet.id] ?? []).length" class="filter-empty">无可用值</p>
      </div>
    </section>

    <p class="filter-hint">点一次＝包含，再点＝必须，第三次＝排除。</p>
  </aside>
</template>

<style scoped>
.collection-filters {
  position: sticky;
  top: calc(var(--collection-top, 104px) + 8px);
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: calc(100vh - var(--collection-top, 104px) - 32px);
  overflow-y: auto;
  padding-left: 18px;
  border-left: 1px solid var(--color-row-line);
  scrollbar-width: thin;
}

.filter-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding: 2px 0 10px;
}

.filter-top strong {
  font-family: var(--font-display);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.08em;
}

.filter-top button {
  border: 0;
  background: transparent;
  color: var(--color-text-subtle);
  font-size: 10px;
  cursor: pointer;
}

.filter-top button:hover:not(:disabled) {
  color: var(--color-brand);
}

.filter-top button:disabled {
  opacity: 0.4;
  cursor: default;
}

.filter-group {
  border-top: 1px solid var(--color-row-line);
}

.filter-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 9px 0;
  border: 0;
  background: transparent;
  color: var(--color-text-muted);
  font-size: 11px;
  letter-spacing: 0.06em;
  text-align: left;
  cursor: pointer;
}

.filter-head small {
  color: var(--color-brand);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.filter-head .chev {
  margin-left: auto;
  color: var(--color-text-subtle);
  transition: transform 160ms ease;
}

.filter-head .chev.open {
  transform: rotate(180deg);
}

.filter-body {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 0 12px;
}

.chip {
  padding: 4px 8px;
  border: 1px solid var(--color-card-border);
  border-radius: 6px;
  background: var(--color-card-bg);
  color: var(--color-text-muted);
  font-size: 10px;
  line-height: 1.4;
  cursor: pointer;
  transition:
    border-color 140ms ease,
    background-color 140ms ease,
    color 140ms ease;
}

.chip:hover {
  border-color: var(--color-brand);
}

.chip.include,
.chip.require,
.chip.exclude {
  color: var(--color-card-bg);
  background: var(--color-brand);
  border-color: var(--color-brand);
}

.chip.require {
  background: #315b96;
  border-color: #315b96;
}

.chip.exclude {
  background: #953f38;
  border-color: #953f38;
  text-decoration: line-through;
}

.filter-empty {
  margin: 0;
  color: var(--color-text-subtle);
  font-size: 10px;
}

.filter-hint {
  margin: 10px 0 0;
  padding-top: 10px;
  border-top: 1px solid var(--color-row-line);
  color: var(--color-text-subtle);
  font-size: 10px;
  line-height: 1.6;
}

@media (max-width: 1023px) {
  .collection-filters {
    position: static;
    max-height: none;
    padding-left: 0;
    border-left: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .filter-head .chev,
  .chip {
    transition: none;
  }
}
</style>
