<script setup lang="ts">
import { computed } from 'vue';
import { richEffectText } from './richText';
import type { CardBase, CardIcon, CarddexLocale } from './types';

const props = withDefaults(defineProps<{
  base: Pick<CardBase, 'effectCn' | 'effectEn' | 'effectKr' | 'effectTw'>;
  icons: readonly CardIcon[];
  locale?: CarddexLocale;
}>(), { locale: 'zh' });

const languages = [
  { field: 'effectCn', lang: 'zh-Hans' },
  { field: 'effectEn', lang: 'en' },
  { field: 'effectKr', lang: 'ko' },
  { field: 'effectTw', lang: 'zh-Hant' },
] as const;
const effects = computed(() => languages
  .filter(({ field }) => props.base[field])
  .map(({ field, lang }) => ({ field, lang, html: richEffectText(props.base[field], props.icons) })));
</script>

<template>
  <section v-if="effects.length" class="copy-block card-effect-text">
    <h4>{{ locale === 'zh' ? '卡牌效果' : 'Card text' }}</h4>
    <div
      v-for="effect in effects"
      :key="effect.field"
      class="effect"
      :class="{ secondary: effect.field !== 'effectCn' }"
      :lang="effect.lang"
      v-html="effect.html"
    ></div>
  </section>
</template>

<style scoped>
.copy-block {
  padding-top: 19px;
  margin-top: 19px;
}
.copy-block h4 {
  margin-bottom: 9px;
  color: var(--color-brand);
  font-size: 10px;
  letter-spacing: 0.16em;
}
.effect {
  color: var(--color-text-primary);
  font-size: 15px;
  font-weight: 560;
  line-height: 1.82;
  letter-spacing: 0.01em;
}
.effect.secondary {
  margin-top: 10px;
  color: var(--color-text-muted);
  font: 500 14px/1.75 Georgia, serif;
}
.effect :deep(strong) {
  color: var(--color-brand);
  font-weight: 800;
}
.effect :deep(.effect-icon) {
  margin-inline: 2px;
  height: 19px;
  display: inline-block;
  vertical-align: -4px;
  object-fit: contain;
}
.effect :deep(.effect-icon.white-source) {
  filter: invert(1);
}
</style>
