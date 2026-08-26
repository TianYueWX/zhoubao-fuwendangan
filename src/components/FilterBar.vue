<script setup lang="ts">
/**
 * FilterBar.vue · 全局检索条(极简报刊式)
 *  Top 阈值 / 日期范围 / 英雄 / 城市,作用于所有分析视图。
 *  改变 Top 阈值需要重跑分析(影响样本切分),其余为即时过滤。
 *  桌面吸附于报头之下(90px);移动端不吸附。
 */
import { computed } from 'vue';
import { store, runStoredAnalysis, resetFilters } from '@/store/analysis';

const heroOptions = computed(() => {
  if (!store.result) return [];
  return Array.from(store.result.heroes.entries())
    .sort((a, b) => b[1].total - a[1].total)
    .map(([name, s]) => ({ value: name, label: `${name} (${s.total})` }));
});

const cityOptions = computed(() => {
  if (!store.result) return [];
  const set = new Set<string>();
  for (const d of store.result.allDecks) {
    if (d.city) set.add(d.city);
  }
  return Array.from(set).sort();
});

const dateMin = computed(() => store.result?.events[0]?.date ?? '');
const dateMax = computed(
  () => store.result?.events[store.result.events.length - 1]?.date ?? ''
);

const hasActiveFilter = computed(
  () =>
    !!(store.filterHero || store.filterCity || store.filterDateFrom || store.filterDateTo)
);

const filteredCount = computed(() => {
  if (!store.result) return 0;
  return store.result.allDecks.filter(
    (d) =>
      (!store.filterHero || d.hero === store.filterHero) &&
      (!store.filterCity || d.city === store.filterCity) &&
      (!store.filterDateFrom || (d.date && d.date >= store.filterDateFrom)) &&
      (!store.filterDateTo || (d.date && d.date <= store.filterDateTo))
  ).length;
});
</script>

<template>
  <div
    v-if="store.result"
    class="masthead-solid lg:sticky lg:top-[90px] z-40 shrink-0"
  >
    <div class="px-4 lg:px-6 py-2.5 flex items-center gap-3 flex-wrap text-sm">
      <span class="text-xs font-medium text-brand tracking-[0.18em]">范围</span>

      <label class="flex items-center gap-1.5">
        <select
          v-model.number="store.topPercent"
          @change="runStoredAnalysis()"
          class="filter-select"
        >
          <option v-for="o in store.topPercentOptions" :key="o.value" :value="o.value">
            {{ o.label }}
          </option>
        </select>
      </label>

      <label class="flex items-center gap-1.5">
        <span class="text-xs text-slate-400">英雄</span>
        <select v-model="store.filterHero" class="filter-select max-w-[180px]">
          <option value="">全部</option>
          <option v-for="h in heroOptions" :key="h.value" :value="h.value">{{ h.label }}</option>
        </select>
      </label>

      <label class="flex items-center gap-1.5">
        <span class="text-xs text-slate-400">城市</span>
        <select v-model="store.filterCity" class="filter-select">
          <option value="">全部</option>
          <option v-for="c in cityOptions" :key="c" :value="c">{{ c }}</option>
        </select>
      </label>

      <label class="flex items-center gap-1.5">
        <span class="text-xs text-slate-400">日期</span>
        <input
          type="date"
          v-model="store.filterDateFrom"
          :min="dateMin"
          :max="dateMax"
          class="filter-select"
        />
        <span class="text-slate-300 dark:text-slate-600">–</span>
        <input
          type="date"
          v-model="store.filterDateTo"
          :min="dateMin"
          :max="dateMax"
          class="filter-select"
        />
      </label>

      <button v-if="hasActiveFilter" @click="resetFilters" class="btn-ghost text-xs px-2 py-1">
        ✕ 清除筛选
      </button>

      <span v-if="store.result" class="ml-auto text-xs text-slate-400 tabular-nums">
        样本
        <b class="text-slate-600 dark:text-gray-300">{{ filteredCount }}</b>
        <template v-if="hasActiveFilter"> / {{ store.result.totalDecks }}</template>
      </span>
    </div>
    <div class="hairline"></div>
  </div>
</template>
