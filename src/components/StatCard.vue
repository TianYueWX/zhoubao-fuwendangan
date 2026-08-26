<script setup lang="ts">
/** StatCard.vue · 报刊数据行(v3:支持环比 Δ 徽章)——扁平、无卡片感 */
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
  <div class="py-4 px-5 first:pl-0 last:pr-0 flex flex-col gap-1.5 border-l border-slate-200 dark:border-slate-800 first:border-l-0">
    <div class="text-[11px] tracking-[0.14em] text-slate-400 dark:text-slate-500">
      {{ label }}
    </div>
    <div class="flex items-baseline gap-2 flex-wrap">
      <div
        :class="[
          'text-[26px] font-bold tabular-nums leading-none',
          tone === 'good'
            ? 'text-green-600 dark:text-green-400'
            : tone === 'warn'
              ? 'text-amber-500 dark:text-amber-400'
              : tone === 'bad'
                ? 'text-red-500'
                : tone === 'accent'
                  ? 'text-brand'
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
