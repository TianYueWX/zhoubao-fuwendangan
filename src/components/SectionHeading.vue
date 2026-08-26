<script setup lang="ts">
/**
 * SectionHeading.vue · 卷目标题(极简报刊式)
 *  - 金色 kicker 短线 + 大号衬线标题 + 注脚,右侧可挂操作区(actions 插槽)
 *  - small 变体用于图表小节标题
 */
withDefaults(
  defineProps<{
    title: string;
    note?: string;
    small?: boolean;
  }>(),
  { note: '', small: false }
);
</script>

<template>
  <div class="flex items-start justify-between gap-3 flex-wrap" :class="small ? 'mb-3' : 'mb-5'">
    <div class="min-w-0">
      <span class="sec-kicker" :class="small ? 'mb-1.5' : 'mb-2.5'"></span>
      <h3
        class="font-display font-bold text-slate-800 dark:text-white leading-snug"
        :class="small ? 'text-base' : 'text-xl'"
      >
        {{ title }}
      </h3>
      <p v-if="note" class="text-xs text-slate-400 mt-1.5 leading-relaxed">{{ note }}</p>
    </div>
    <div v-if="$slots.actions" class="flex items-center gap-2 flex-wrap shrink-0">
      <slot name="actions" />
    </div>
  </div>
</template>
