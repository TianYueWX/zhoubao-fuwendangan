<script setup lang="ts">
/**
 * MappingPanel.vue · 城市映射修正面板
 *   - 显示所有未能识别城市的赛事
 *   - 下拉选择已有城市(从 regionStats 自动收集)+ 自定义输入
 *   - 修改后点击"应用并重新分析"触发 runStoredAnalysis
 */
import { computed } from 'vue';
import { store, runStoredAnalysis, setCityOverride, type SlotFile } from '@/store/analysis';

const knownCities = computed(() => {
  if (!store.result) return [] as string[];
  const set = new Set<string>();
  for (const city of store.result.regionStats.keys()) set.add(city);
  for (const event of store.result.cityUnknown) {
    const ov = store.cityOverrides.get(event);
    if (ov) set.add(ov);
  }
  return Array.from(set).sort();
});

function onChange(ev: string, e: Event): void {
  const val = (e.target as HTMLSelectElement).value;
  setCityOverride(ev, val || null);
}

const unknownEvents = computed<string[]>(() => store.result?.cityUnknown ?? []);
</script>

<template>
  <section
    v-if="store.result && unknownEvents.length > 0"
    class="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700"
  >
    <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
      <div>
        <h3 class="text-sm font-bold text-slate-800 dark:text-white">
          🧭 赛事城市映射修正
        </h3>
        <p class="text-xs text-slate-500 dark:text-gray-400">
          以下 {{ unknownEvents.length }} 个赛事未能自动识别城市,指定后点击"重新分析"生效
        </p>
      </div>
      <button
        @click="runStoredAnalysis"
        class="px-4 py-1.5 bg-neutral-900 hover:bg-neutral-700 dark:bg-neutral-100 dark:hover:bg-neutral-300 text-white dark:text-neutral-900 text-sm font-medium rounded-lg transition-all"
      >
        🔄 应用并重新分析
      </button>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-4 gap-y-2 max-h-[240px] overflow-y-auto">
      <div v-for="ev in unknownEvents" :key="ev" class="space-y-1">
        <div class="truncate text-xs text-slate-500 dark:text-gray-400" :title="ev">
          {{ ev }}
        </div>
        <select
          :value="store.cityOverrides.get(ev) ?? ''"
          @change="(e: Event) => onChange(ev, e)"
          class="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-md px-2 py-1 text-xs text-slate-800 dark:text-white"
        >
          <option value="">— 未指定 —</option>
          <option
            v-for="city in knownCities"
            :key="city"
            :value="city"
          >{{ city }}</option>
        </select>
      </div>
    </div>
  </section>
</template>
