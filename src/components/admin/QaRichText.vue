<script setup lang="ts">
/** QA 安全文本展示：保留原始换行，仅对约定标记加粗。 */
import { computed } from 'vue';
import { segmentQaText } from '@/tools/sync/qa';

const props = defineProps<{ text: string }>();
const segments = computed(() => segmentQaText(props.text));
</script>

<template>
  <span class="whitespace-pre-wrap">
    <template v-for="(segment, index) in segments" :key="index">
      <strong v-if="segment.bold" class="font-semibold text-ink">{{ segment.text }}</strong>
      <template v-else>{{ segment.text }}</template>
    </template>
  </span>
</template>
