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
  <div class="py-4 px-5 first:pl-0 last:pr-0 flex flex-col gap-1.5 border-l border-panel-border first:border-l-0">
    <div class="text-[11px] tracking-[0.14em] text-ink-faint">
      {{ label }}
    </div>
    <div class="flex items-baseline gap-2 flex-wrap">
      <div
        :class="[
          'text-[26px] font-bold tabular-nums leading-none',
          tone === 'good'
            ? 'text-delta-up'
            : tone === 'warn'
              ? 'text-accent'
              : tone === 'bad'
                ? 'text-delta-down'
                : tone === 'accent'
                  ? 'text-brand'
                  : 'text-ink'
        ]"
      >
        {{ value }}
      </div>
      <DeltaBadge v-if="delta != null" :delta="delta" :suffix="deltaSuffix" />
    </div>
    <div v-if="sub" class="text-[11px] text-ink-faint">{{ sub }}</div>
  </div>
</template>
