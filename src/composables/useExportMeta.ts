/* ================================================================
 * src/composables/useExportMeta.ts
 *
 * 表格长图导出用的报头信息(期号 / 周次 / 样本口径)。
 * 与顶部范围条同一口径:周次取 store.filterWeek,样本取全局筛选后的套数。
 * ============================================================== */
import { computed } from 'vue';
import { store, applyGlobalFilters } from '@/store/analysis';

export interface ExportMeta {
  issue: string;
  week: string;
  sample: string;
}

export function useExportMeta() {
  return computed<ExportMeta>(() => {
    const r = store.result;
    const shown = r ? applyGlobalFilters(r.allDecks).length : 0;
    return {
      issue: store.sourceLabel || '',
      week: store.filterWeek || '全部周',
      sample: r ? `${shown}/${r.totalDecks} 套` : ''
    };
  });
}
