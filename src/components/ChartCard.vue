<script setup lang="ts">
/**
 * ChartCard.vue · 通用 ECharts 容器
 *  - 监听 props.option 变化 → setOption
 *  - 默认开启 toolbox:dataZoom + restore + saveAsImage
 *  - ResizeObserver 监听容器尺寸
 */
import { onMounted, onUnmounted, ref, watch } from 'vue';
import * as echarts from 'echarts';
import type { EChartsOption } from 'echarts';
import { injectTheme, getChartColors } from '@/utils/theme';
import type { ChartOptionInput } from '@/composables/useChart';

const props = withDefaults(
  defineProps<{
    /** ECharts option;支持 deep watch。为兼容上层字面量推断放宽为 record */
    option: ChartOptionInput | null;
    /** 容器高度(默认 400px) */
    height?: string;
    /** 是否显示底部 toolbox(默认 true) */
    showToolbox?: boolean;
  }>(),
  {
    height: '400px',
    showToolbox: true
  }
);

const elRef = ref<HTMLDivElement | null>(null);
let instance: echarts.ECharts | null = null;
let observer: ResizeObserver | null = null;

const emit = defineEmits<{
  (e: 'chart-click', params: Record<string, unknown>): void;
}>();

/** 把主题色与 toolbox 注入 option;不覆盖调用方已有的同名键 */
function decorateOption(opt: ChartOptionInput): EChartsOption {
  const cc = getChartColors();
  const optRecord = opt as Record<string, unknown>;

  const tooltip = {
    backgroundColor: cc.tooltipBg,
    borderColor: cc.tooltipBorder,
    textStyle: { color: cc.textColor },
    ...((opt.tooltip as object) ?? {})
  };

  const toolbox = props.showToolbox
    ? {
        feature: {
          dataZoom: { yAxisIndex: 'none' as const },
          restore: {},
          saveAsImage: {}
        },
        right: 10,
        iconStyle: { borderColor: cc.subTextColor },
        ...((opt.toolbox as object) ?? {})
      }
    : (optRecord.toolbox as object | undefined);

  // 默认 dataZoom(若未指定)
  const dataZoom = (optRecord.dataZoom as object[] | undefined) ?? [{ type: 'inside' as const }];

  return injectTheme({
    ...optRecord,
    tooltip,
    ...(toolbox ? { toolbox } : {}),
    ...(dataZoom ? { dataZoom } : {})
  });
}

function refresh(): void {
  if (!instance) return;
  if (!props.option) return;
  instance.setOption(decorateOption(props.option), false);
}

onMounted(() => {
  if (!elRef.value) return;
  instance = echarts.init(elRef.value);
  instance.on('click', (params) => {
    emit('chart-click', params as Record<string, unknown>);
  });
  refresh();
  observer = new ResizeObserver(() => instance?.resize());
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

// option deep-watch
watch(
  () => props.option,
  () => refresh(),
  { deep: true }
);
</script>

<template>
  <div
    ref="elRef"
    :style="{ width: '100%', height: props.height }"
  />
</template>
