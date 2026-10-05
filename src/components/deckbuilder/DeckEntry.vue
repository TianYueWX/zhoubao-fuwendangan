<script setup lang="ts">
import { computed, ref, nextTick } from 'vue';
import CarddexImage from '@/components/carddex/CarddexImage.vue';
import { LABELS, ZONES, resolveEntry, type DeckEntry, type CardIndex, type Zone } from '@/tools/deckbuilder/model';
const props = defineProps<{ entry: DeckEntry; zone: Zone; index: CardIndex; graphic: boolean; readonly?: boolean; additionalEnabled: boolean }>();
const emit = defineEmits<{ quantity: [quantity: number]; inspect: []; move: [to: Zone]; remove: [] }>();
const resolved = computed(() => resolveEntry(props.entry, props.index));
const destinations = computed(() => ZONES.filter(z => z !== props.zone && (z !== 'additional' || props.additionalEnabled)));
const menu = ref<HTMLDivElement>(), menuStyle = ref<Record<string,string>>({});
async function openMenu(event:MouseEvent):Promise<void> {
  const rect=(event.currentTarget as HTMLElement).getBoundingClientRect();
  menuStyle.value={left:`${Math.max(8,Math.min(window.innerWidth-200,rect.right-190))}px`,top:`${rect.bottom+4}px`};
  await nextTick();menu.value?.showPopover();
  const height=menu.value?.getBoundingClientRect().height??300;
  menuStyle.value.top=`${Math.max(8,Math.min(window.innerHeight-height-8,rect.bottom+4))}px`;
  menu.value?.querySelector('button')?.focus();
}
function closeMenu():void {menu.value?.hidePopover();}
</script>

<template>
  <article class="deck-entry" :class="{ graphic, unresolved: !resolved.record }" :data-card="entry.cardNo">
    <button class="entry-art" type="button" :aria-label="`查看 ${resolved.name} 的印版和详情`" @click="emit('inspect')">
      <CarddexImage :src="resolved.print?.imageUrl || ''" :fallback="resolved.print?.ttsUrl || ''" :alt="resolved.name" :landscape="resolved.record?.base.categories.includes('战场')" />
      <span v-if="graphic" class="art-count">×{{ entry.quantity }}</span>
    </button>
    <button class="entry-label" type="button" @click="emit('inspect')">
      <strong :title="resolved.name">{{ resolved.name }}</strong>
    </button>
    <div v-if="!readonly" class="quantity-controls">
      <button type="button" :aria-label="`减少 ${resolved.name}`" @click="emit('quantity', entry.quantity - 1)">−</button>
      <span class="tabular-nums">{{ entry.quantity }}</span>
      <button type="button" :aria-label="`增加 ${resolved.name}`" @click="emit('quantity', entry.quantity + 1)">＋</button>
      <div class="entry-menu">
        <button type="button" :aria-label="`${resolved.name} 的操作`" aria-haspopup="true" @click="openMenu">⋯</button>
        <div ref="menu" popover="auto" class="entry-menu-items" :style="menuStyle">
          <button type="button" @click="closeMenu();emit('inspect')">选择印版／查看详情</button>
          <button v-for="to in destinations" :key="to" type="button" @click="closeMenu();emit('move', to)">移到{{ LABELS[to] }}</button>
          <button type="button" class="remove" @click="closeMenu();emit('remove')">移除全部 {{ entry.quantity }} 张</button>
        </div>
      </div>
    </div>
    <span v-else class="readonly-count">×{{ entry.quantity }}</span>
  </article>
</template>

<style scoped>
.deck-entry {
  position: relative;
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) auto;
  gap: 6px;
  align-items: center;
  min-width: 0;
  padding: 3px 6px;
  border: 1px solid var(--color-panel-border);
  border-radius: 4px;
  background: var(--color-card-bg);
}
.entry-art { width: 26px; overflow: hidden; border-radius: 2px; text-align: left; }
.entry-label { min-width: 0; text-align: left; }
.entry-label strong {
  display: block;
  overflow: hidden;
  font-size: 12px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.quantity-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; }
.quantity-controls > button, .entry-menu > button {
  display: grid;
  place-items: center;
  width: 24px;
  flex-shrink: 0;
  min-height: 30px;
  border-radius: 3px;
  font-size: 15px;
}
.quantity-controls > button:hover, .entry-menu > button:hover {
  color: var(--color-brand);
  background: var(--color-brand-soft);
}
.quantity-controls > span { min-width: 18px; flex-shrink: 0; font-size: 12px; font-weight: 700; text-align: center; }
.entry-menu { flex-shrink: 0; }
.entry-menu-items {
  position: fixed;
  inset: auto;
  display: none;
  width: 190px;
  margin: 0;
  padding: 5px;
  border: 1px solid var(--color-panel-border);
  border-radius: 5px;
  color: var(--color-text-primary);
  background: var(--color-card-bg);
  box-shadow: 0 8px 30px var(--color-shadow);
}
.entry-menu-items:popover-open { display: grid; }
.entry-menu-items button { padding: 9px 10px; font-size: 12px; text-align: left; }
.entry-menu-items button:hover { background: var(--color-brand-soft); }
.remove { color: var(--color-brand); }
.unresolved { border-style: dashed; }
.graphic { display: flex; flex-direction: column; align-items: stretch; gap: 0; padding: 0; }
.graphic .entry-art {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
  aspect-ratio: 744 / 1040;
  border-radius: 3px 3px 0 0;
}
.graphic .entry-art :deep(.carddex-image) { width: 100%; }
.graphic .entry-label { padding: 4px 5px 1px; }
.graphic .entry-label strong { font-size: 11px; }
.graphic .quantity-controls { justify-content: center; padding: 0 3px 2px; }
.art-count {
  position: absolute;
  top: 4px;
  right: 4px;
  padding: 2px 4px;
  border-radius: 2px;
  color: var(--color-brand-ink);
  background: var(--color-brand);
  font-size: 11px;
  font-weight: 700;
}
.readonly-count { font-size: 12px; font-weight: 700; }
.graphic .readonly-count { padding: 0 5px 4px; }
@media (max-width: 900px) {
  .quantity-controls > button, .entry-menu > button { min-height: 36px; }
  .entry-menu-items button { min-height: 44px; }
}
</style>
