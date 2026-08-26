<script setup lang="ts">
/**
 * TierBadge.vue · Tier 分级徽章(S/A/B/C)
 */
import { computed } from 'vue';
import type { TierRating } from '@/types';
import { TIER_COLORS } from '@/utils/palette';

const props = defineProps<{ tier: TierRating | null; size?: 'sm' | 'md' }>();

const style = computed(() => {
  if (!props.tier) return { bg: '', text: '' };
  return TIER_COLORS[props.tier] ?? { bg: '', text: '' };
});
</script>

<template>
  <span
    v-if="tier"
    :class="[
      'inline-flex items-center justify-center font-bold rounded-lg border',
      size === 'sm' ? 'w-6 h-6 text-xs' : 'w-8 h-8 text-sm',
      style.bg,
      style.text
    ]"
    :title="`Tier ${tier}`"
  >
    {{ tier }}
  </span>
  <span
    v-else
    :class="[
      'inline-flex items-center justify-center rounded-lg border border-card-border text-ink-faint',
      size === 'sm' ? 'w-6 h-6 text-xs' : 'w-8 h-8 text-sm'
    ]"
  >
    –
  </span>
</template>
