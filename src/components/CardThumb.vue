<script setup lang="ts">
/**
 * CardThumb.vue · 卡牌缩略图(懒加载 + 失败降级)
 *  - 图片为 CDN 地址,离线/加载失败时显示颜色域色块文字卡
 */
import { computed, ref } from 'vue';
import type { CardCatalog } from '@/types';
import { CARD_COLOR_HEX } from '@/utils/palette';

const props = withDefaults(
  defineProps<{
    id: string;
    name: string;
    catalog: CardCatalog;
    count?: number | null;
    size?: 'xs' | 'sm' | 'md' | 'lg';
    showName?: boolean;
  }>(),
  { count: null, size: 'md', showName: true }
);

const failed = ref(false);
const imgSrc = computed(() => props.catalog.cardImg.get(props.id) ?? '');
const colors = computed(() => props.catalog.cardColors.get(props.id) ?? []);
const isBanned = computed(() => props.catalog.byId.get(props.id)?.isBanned ?? false);

function onErr(): void {
  failed.value = true;
}
</script>

<template>
  <div
    class="flex flex-col items-center gap-1 group relative"
    :data-card-colors="colors.join(',')"
  >
    <div
      v-if="isBanned"
      class="absolute -top-1 -right-1 z-10 px-1 rounded bg-brand text-brand-ink text-[9px] font-bold shadow"
    >
      禁
    </div>
    <div
      :class="[
        'relative overflow-hidden rounded-md border border-card-border bg-card-bg transition-colors group-hover:border-brand-faint',
        size === 'xs'
          ? 'w-9 h-[50px]'
          : size === 'sm'
            ? 'w-11 h-[61px]'
            : size === 'lg'
              ? 'w-28 h-[156px]'
              : 'w-[74px] h-[103px]'
      ]"
    >
      <!-- 降级色块 -->
      <div
        v-if="!imgSrc || failed"
        class="absolute inset-0 flex flex-col items-center justify-center p-1 text-center"
        :style="{
          background: `linear-gradient(135deg, ${
            colors.length
              ? colors.map((c) => CARD_COLOR_HEX[c]).join(', ')
              : '#94a3b8, #64748b'
          })`
        }"
      >
        <span class="text-white text-[10px] font-medium leading-tight drop-shadow line-clamp-3">
          {{ name }}
        </span>
      </div>
      <img
        v-else
        :src="imgSrc"
        :alt="name"
        loading="lazy"
        class="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
        @error="onErr"
      />
      <div
        v-if="count != null && count > 0"
        class="absolute bottom-0 right-0 px-1.5 py-0.5 bg-ink/75 text-white text-[10px] font-bold rounded-tl-md"
      >
        ×{{ count }}
      </div>
    </div>
    <div
      v-if="showName"
      class="text-[10px] leading-tight text-ink-muted text-center line-clamp-2 max-w-[74px]"
      :title="`${name} (${id})`"
    >
      {{ name }}
    </div>
  </div>
</template>
