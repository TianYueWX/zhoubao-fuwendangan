<script setup lang="ts">
/** StatCard.vue · 指标卡(v3:支持环比 Δ 徽章) */
import DeltaBadge from './DeltaBadge.vue';

withDefaults(
  defineProps<{
    label: string;
    value: string | number;
    sub?: string;
    tone?: 'default' | 'good' | 'warn' | 'bad' | 'accent';
    /** 环比差值(百分点),传入后显示 Δ 徽章 */
    delta?: number | null;
    /** Δ 徽章数值后缀,默认 '%' */
    deltaSuffix?: string;
  }>(),
  { sub: undefined, tone: 'default', delta: null, deltaSuffix: '%' }
);
</script>

<template>
  <div class="card p-4 flex flex-col gap-1">
    <div class="text-xs text-slate-400 dark:text-slate-500">{{ label }}</div>
    <div class="flex items-baseline gap-2 flex-wrap">
      <div
        :class="[
          'text-2xl font-bold tabular-nums leading-tight',
          tone === 'good'
            ? 'text-green-600 dark:text-green-400'
            : tone === 'warn'
              ? 'text-amber-500'
              : tone === 'bad'
                ? 'text-red-500'
                : tone === 'accent'
                  ? 'text-indigo-500 dark:text-indigo-400'
                  : 'text-slate-800 dark:text-white'
        ]"
      >
        {{ value }}
      </div>
      <DeltaBadge v-if="delta != null" :delta="delta" :suffix="deltaSuffix" />
    </div>
    <div v-if="sub" class="text-[11px] text-slate-400 dark:text-slate-500">{{ sub }}</div>
  </div>
</template>
