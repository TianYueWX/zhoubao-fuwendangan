<script setup lang="ts">
/**
 * FilterBar.vue · 全局范围条(周次选择)
 *
 * 数据包可含一周或多周赛事数据:
 *   - 默认聚焦最新一周(分析完成后自动选中)
 *   - 「全部周」= 跨周汇总口径
 *   - 趋势对比页不受此筛选影响(始终跨周计算)
 */
import { computed } from 'vue';
import { store, applyGlobalFilters, weekBuckets } from '@/store/analysis';

const weeks = computed(() => weekBuckets());

const sampleCount = computed(() => {
  if (!store.result) return 0;
  return applyGlobalFilters(store.result.allDecks).length;
});

function onWeekChange(e: Event): void {
  store.filterWeek = (e.target as HTMLSelectElement).value;
}
</script>

<template>
  <div
    v-if="store.result"
    class="masthead-solid lg:sticky lg:top-[92px] z-40 shrink-0"
  >
    <div class="px-4 lg:px-8 py-2.5 flex items-center gap-3 flex-wrap text-sm">
      <span class="eyebrow !tracking-[0.3em]">范围</span>

      <label class="flex items-center gap-1.5">
        <span class="text-xs text-ink-faint">周次</span>
        <select
          :value="store.filterWeek"
          class="filter-select"
          aria-label="选择周次"
          @change="onWeekChange"
        >
          <option value="">全部周</option>
          <option v-for="w in weeks" :key="w.label" :value="w.label">
            {{ w.label }}
          </option>
        </select>
      </label>

      <span v-if="weeks.length <= 1" class="text-[11px] text-ink-faint">
        当前数据包仅含单周
      </span>

      <span class="ml-auto text-xs text-ink-faint tabular-nums">
        样本 <b class="text-ink-muted">{{ sampleCount }}</b> / {{ store.result.totalDecks }}
      </span>
    </div>
    <div class="hairline"></div>
  </div>
</template>
