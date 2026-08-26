<script setup lang="ts">
/**
 * FilterBar.vue · 全局过滤条
 *  Top 阈值 / 日期范围 / 英雄 / 城市,作用于所有分析视图。
 *  改变 Top 阈值需要重跑分析(影响样本切分),其余为即时过滤。
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
</script>

<template>
  <div
    v-if="store.result"
    class="sticky top-0 z-40 panel rounded-none border-x-0 border-t-0 px-6 py-2.5"
  >
    <div class="flex items-center gap-3 flex-wrap text-sm">
      <span class="text-xs font-medium text-slate-400 uppercase tracking-wider">范围</span>

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

      <button
        v-if="hasActiveFilter"
        @click="resetFilters"
        class="text-xs px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-red-500 transition-colors"
      >
        ✕ 清除筛选
      </button>

      <!-- 过滤后样本提示 -->
      <span
        v-if="hasActiveFilter && store.result"
        class="ml-auto text-xs text-slate-400"
      >
        样本 {{ store.result.totalDecks }} →
        <b class="text-slate-600 dark:text-gray-300">{{
          store.result.allDecks.filter(
            (d) =>
              (!store.filterHero || d.hero === store.filterHero) &&
              (!store.filterCity || d.city === store.filterCity) &&
              (!store.filterDateFrom || (d.date && d.date >= store.filterDateFrom)) &&
              (!store.filterDateTo || (d.date && d.date <= store.filterDateTo))
          ).length
        }}</b>
      </span>
    </div>
  </div>
</template>

<style scoped>
.filter-select {
  background: var(--color-card-bg);
  border: 1px solid var(--color-card-border);
  border-radius: 0.5rem;
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  color: var(--color-text-primary);
}
</style>
