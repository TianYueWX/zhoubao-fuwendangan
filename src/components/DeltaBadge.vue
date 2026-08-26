<script setup lang="ts">
/**
 * DeltaBadge.vue · 环比差值徽章(v3 新增)
 *  - delta > 0.05 显示 ▲ 绿;delta < -0.05 显示 ▼ 红;≈0 显示 ＝ 灰;null 显示 —
 *  - 用于多数据包周环比场景(StatCard / 榜单 / 表格)
 */
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    /** 差值(百分点,如 +3.2 表示 +3.2pp) */
    delta: number | null;
    /** 数值后缀,默认 '%' */
    suffix?: string;
    /** 无数据时的占位 */
    placeholder?: string;
    /** 无变化时的文本 */
    flatLabel?: string;
  }>(),
  { suffix: '%', placeholder: '—', flatLabel: '＝' }
);

const dir = computed<'up' | 'down' | 'flat' | 'none'>(() => {
  if (props.delta == null) return 'none';
  if (props.delta > 0.05) return 'up';
  if (props.delta < -0.05) return 'down';
  return 'flat';
});

const cls = computed(() => {
  switch (dir.value) {
    case 'up':
      return 'text-delta-up bg-emerald-500/10 border-emerald-500/30';
    case 'down':
      return 'text-delta-down bg-rose-500/10 border-rose-500/30';
    case 'flat':
      return 'text-delta-flat bg-slate-500/10 border-slate-500/30';
    default:
      return 'text-text-subtle bg-slate-500/10 border-slate-500/20';
  }
});

const text = computed(() => {
  if (dir.value === 'none') return props.placeholder;
  if (dir.value === 'flat') return props.flatLabel;
  const v = Math.abs(props.delta!).toFixed(1);
  return `${dir.value === 'up' ? '▲' : '▼'} ${v}${props.suffix}`;
});
</script>

<template>
  <span
    class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold tabular-nums border"
    :class="cls"
    :title="delta != null ? `环比 ${delta > 0 ? '+' : ''}${delta.toFixed(1)}${suffix}` : undefined"
  >
    {{ text }}
  </span>
</template>
