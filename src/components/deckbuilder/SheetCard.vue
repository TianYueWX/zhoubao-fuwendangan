<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { resolveEntry, type CardIndex, type DeckEntry } from '@/tools/deckbuilder/model';
const props = defineProps<{ entry: DeckEntry; index: CardIndex }>();
const resolved = computed(() => resolveEntry(props.entry, props.index));
const image = computed(() => resolved.value.print?.imageUrl || resolved.value.print?.ttsUrl || '');
const failed = ref(false), loaded = ref(false);
const name = computed(() => resolved.value.name || props.entry.name || props.entry.cardNo);
const subtitle = computed(() => resolved.value.record?.base.subtitleCn || resolved.value.record?.base.subtitleEn || '');
const landscape = computed(() => Boolean(resolved.value.record?.base.categories.includes('战场')));
watch(image, () => { failed.value = false; loaded.value = false; });
</script>
<template>
  <article class="sheet-card" :class="{ landscape, missing: !image || failed }" :data-card="entry.cardNo" :title="name">
    <img v-if="image && !failed" :src="image" :alt="name" loading="eager" decoding="async" @load="loaded = true" @error="failed = true" />
    <div v-if="!image || failed || !loaded" class="sheet-card-fallback">
      <strong>{{ name }}</strong>
      <small v-if="subtitle">{{ subtitle }}</small>
    </div>
    <span class="sheet-card-qty">×{{ entry.quantity }}</span>
  </article>
</template>
<style scoped>
.sheet-card {
  position: relative;
  aspect-ratio: 744 / 1040;
  overflow: hidden;
  border: 0.25mm solid var(--color-panel-border);
  border-radius: 0.5mm;
  background: #fff;
}
.sheet-card img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.sheet-card.landscape img {
  transform: rotate(-90deg) scale(0.7154);
  transform-origin: center;
}
.sheet-card-fallback {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1mm;
  padding: 1.5mm;
  text-align: center;
  background: var(--color-card-bg);
  color: var(--color-text-muted);
}
.sheet-card-fallback strong {
  display: -webkit-box;
  overflow: hidden;
  font-size: 2.7mm;
  line-height: 1.35;
  color: var(--color-text-primary);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.sheet-card-fallback small {
  display: -webkit-box;
  overflow: hidden;
  font-size: 2.15mm;
  line-height: 1.3;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 1;
}
.sheet-card-qty {
  position: absolute;
  right: 0.7mm;
  bottom: 0.7mm;
  min-width: 5mm;
  padding: 0.45mm 0.9mm;
  border-radius: 0.4mm;
  color: var(--color-brand-ink, #fff8f0);
  background: var(--color-brand, #b23a27);
  font-size: 2.6mm;
  font-weight: 700;
  line-height: 1.2;
  text-align: center;
}
</style>
