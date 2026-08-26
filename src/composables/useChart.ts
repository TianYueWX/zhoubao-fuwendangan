/* ================================================================
 * src/composables/useChart.ts
 * ECharts 实例生命周期 hook
 *   - 自动注入主题色(tooltip / text / axis)
 *   - 监听 option 变化 → setOption
 *   - 容器尺寸变化 → ResizeObserver 通知 instance
 *   - 组件卸载 → dispose
 * ============================================================== */

import { onMounted, onUnmounted, ref, watch, type Ref } from 'vue';
import * as echarts from 'echarts';
import type { EChartsOption } from 'echarts';
import { injectTheme } from '@/utils/theme';

/**
 * 图表 option 类型采用宽口径 `Record<string, unknown>` 而不是 `EChartsOption`。
 * 因为 ECharts 在 5.x 里 `SeriesOption` 是一个超长的判别联合(line/bar/scatter/...) ,
 * 上游 chart-data computed 返回的对象字面量里的 `type: 'line'` 等会被推断成 `string`,
 * 不直接满足 `SeriesOption`,此处放宽类型,
 * 由运行时的 `setOption` 承担实际校验,让上层不必逐个 `as const`。
 */
export type ChartOptionInput = EChartsOption | Record<string, unknown>;

export function useChart(
  getOption: () => ChartOptionInput | null,
  height = '400px'
): { elRef: Ref<HTMLElement | null> } {
  const elRef = ref<HTMLElement | null>(null);
  let instance: echarts.ECharts | null = null;
  let observer: ResizeObserver | null = null;

  function refresh(): void {
    if (!instance) return;
    const opt = getOption();
    if (!opt) return;
    // 注入主题后再断言成 EChartsOption:见 ChartOptionInput 的注释
    instance.setOption(injectTheme(opt) as EChartsOption, false);
  }

  onMounted(() => {
    if (!elRef.value) return;
    instance = echarts.init(elRef.value);
    refresh();

    observer = new ResizeObserver(() => {
      instance?.resize();
    });
    observer.observe(elRef.value);
  });

  onUnmounted(() => {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (instance) {
      instance.dispose();
      instance = null;
    }
  });

  // 监听 option 变化
  watch(getOption, refresh, { deep: true });

  return { elRef };
}
