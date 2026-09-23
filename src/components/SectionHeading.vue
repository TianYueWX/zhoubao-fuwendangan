<script setup lang="ts">
/**
 * SectionHeading.vue · 版面标题(报刊头版式)
 *  - 可选眉题 + 衬线标题 + 注脚,右侧可挂操作区(actions 插槽)
 *  - plain 用于编辑部，完全不显示眉题或 kicker
 *  - small 变体用于图表小节标题
 */
withDefaults(
  defineProps<{
    eyebrow?: string;
    title: string;
    note?: string;
    small?: boolean;
    plain?: boolean;
  }>(),
  { eyebrow: '', note: '', small: false, plain: false }
);
</script>

<template>
  <div class="flex items-start justify-between gap-3 flex-wrap" :class="small ? 'mb-3' : 'mb-5'">
    <div class="min-w-0">
      <span v-if="!plain && eyebrow" class="eyebrow block" :class="small ? 'mb-1' : 'mb-1.5'">{{ eyebrow }}</span>
      <span v-else-if="!plain" class="sec-kicker" :class="small ? 'mb-1.5' : 'mb-2.5'"></span>
      <h3
        class="font-display font-bold text-ink leading-snug"
        :class="small ? 'text-base' : 'text-xl'"
      >
        {{ title }}
      </h3>
      <p v-if="note" class="text-xs text-ink-faint mt-1.5 leading-relaxed">{{ note }}</p>
    </div>
    <div v-if="$slots.actions" class="flex items-center gap-2 flex-wrap shrink-0">
      <slot name="actions" />
    </div>
  </div>
</template>
