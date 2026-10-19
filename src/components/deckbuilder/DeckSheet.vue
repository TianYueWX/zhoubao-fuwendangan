<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { CardColor } from '@/types';
import { resolveEntry, type BuilderDeck, type CardIndex, type DeckEntry } from '@/tools/deckbuilder/model';
import { buildDeckSheet, chooseSheetColumns, SHEET_SORTS, type SheetSort } from '@/tools/deckbuilder/sheet';
import SheetCard from './SheetCard.vue';
const props = defineProps<{ deck: BuilderDeck; index: CardIndex }>();
const assetBase = import.meta.env.BASE_URL;
const sort = ref<SheetSort>('type');
const sheet = computed(() => buildDeckSheet(props.deck, props.index, sort.value));
const columns = computed(() => chooseSheetColumns(sheet.value.sections));

function identity(entry: DeckEntry | null, empty: string): { name: string; image: string; subtitle: string } {
  if (!entry) return { name: empty, image: '', subtitle: '' };
  const resolved = resolveEntry(entry, props.index);
  return {
    name: resolved.name,
    image: resolved.print?.imageUrl || resolved.print?.ttsUrl || '',
    subtitle: resolved.record?.base.subtitleCn || resolved.record?.base.subtitleEn || ''
  };
}
const legend = computed(() => identity(sheet.value.legend, '未选传奇'));
const champion = computed(() => identity(sheet.value.champion, '未选英雄'));
const legendFailed = ref(false), championFailed = ref(false);
watch(() => legend.value.image, () => { legendFailed.value = false; });
watch(() => champion.value.image, () => { championFailed.value = false; });
const runeIcon = (color: CardColor): string => `${assetBase}runes/${color}.svg`;

const today = new Date();
const todayText = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

const stage = ref<HTMLElement>();
const zoom = ref(1);
const SHEET_WIDTH_PX = 210 / 25.4 * 96;
let observer: ResizeObserver | null = null;
function fit(): void {
  const width = stage.value?.clientWidth ?? 0;
  zoom.value = width > 0 ? Math.min(1, width / SHEET_WIDTH_PX) : 1;
}
onMounted(() => {
  document.body.classList.add('printing-deck-sheet');
  fit();
  if (stage.value) {
    observer = new ResizeObserver(fit);
    observer.observe(stage.value);
  }
});
onBeforeUnmount(() => {
  observer?.disconnect();
  document.body.classList.remove('printing-deck-sheet');
});
</script>
<template>
  <div class="deck-sheet-view">
    <div class="sheet-toolbar" role="group" aria-label="卡牌排序">
      <span class="sheet-toolbar-label">排序</span>
      <button v-for="option in SHEET_SORTS" :key="option.id" type="button" class="sheet-sort" :class="{ active: sort === option.id }" :aria-pressed="sort === option.id" @click="sort = option.id">{{ option.label }}</button>
      <span class="sheet-size">A4 · 210×297mm</span>
    </div>
    <div ref="stage" class="sheet-stage">
      <article class="deck-sheet" :style="{ zoom, '--sheet-cols': String(columns) }" aria-label="卡组一页">
        <header class="sheet-head"><h2 :title="deck.name">{{ deck.name }}</h2></header>
        <div class="sheet-identity">
          <div class="sheet-identity-card" :class="{ empty: !legend.image || legendFailed }">
            <img v-if="legend.image && !legendFailed" :src="legend.image" :alt="legend.name" @error="legendFailed = true" />
            <span v-else>{{ legend.name }}</span>
          </div>
          <div class="sheet-identity-card" :class="{ empty: !champion.image || championFailed }">
            <img v-if="champion.image && !championFailed" :src="champion.image" :alt="champion.name" @error="championFailed = true" />
            <span v-else>{{ champion.name }}</span>
          </div>
          <div v-if="sheet.runes.length" class="sheet-runes" :class="{ compact: sheet.runes.length > 2 }">
            <div v-for="rune in sheet.runes" :key="rune.color" class="sheet-rune" :title="`${rune.label} ×${rune.count}`">
              <img v-if="rune.color !== 'colorless'" :src="runeIcon(rune.color)" :alt="rune.label" />
              <i v-else class="sheet-rune-colorless" aria-hidden="true"></i>
              <b>×{{ rune.count }}</b>
            </div>
          </div>
        </div>
        <div class="sheet-sections">
          <section v-for="section in sheet.sections" :key="section.zone" class="sheet-section" :data-zone="section.zone">
            <h3><span>{{ section.label }}</span><b>{{ section.count }}</b></h3>
            <div class="sheet-grid">
              <SheetCard v-for="entry in section.entries" :key="`${section.zone}-${entry.cardNo}-${entry.printNo}-${entry.language}`" :entry="entry" :index="index" />
            </div>
          </section>
          <p v-if="!sheet.sections.length" class="sheet-empty">暂无卡牌</p>
        </div>
        <footer class="sheet-foot"><span>符文档案 · 构筑</span><time>{{ todayText }}</time></footer>
      </article>
    </div>
  </div>
</template>
<style scoped>
.deck-sheet-view { display: flex; flex-direction: column; gap: 10px; }
.sheet-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.sheet-toolbar-label { color: var(--color-text-muted); font-size: 13px; }
.sheet-sort { padding: 6px 11px; border: 1px solid var(--color-panel-border); background: var(--color-card-bg); color: var(--color-text-primary); font-size: 13px; cursor: pointer; }
.sheet-sort.active { border-color: var(--color-brand); background: var(--color-brand); color: var(--color-brand-ink); }
.sheet-size { margin-left: auto; color: var(--color-text-subtle); font-size: 11px; }
.sheet-stage { display: flex; justify-content: center; width: 100%; overflow: hidden; }
.deck-sheet {
  flex: 0 0 auto;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: 210mm;
  height: 297mm;
  padding: 10mm;
  overflow: hidden;
  border: 1px solid var(--color-panel-border);
  background: var(--color-card-bg);
  color: var(--color-text-primary);
  box-shadow: 0 12px 40px #0002;
}
.sheet-head { flex: 0 0 16mm; height: 16mm; display: flex; align-items: center; border-bottom: 0.5mm solid var(--color-brand); }
.sheet-head h2 { width: 100%; margin: 0; overflow: hidden; font: 700 6mm/1.15 "Noto Serif SC", serif; white-space: nowrap; text-overflow: ellipsis; }
.sheet-identity { flex: 0 0 52mm; height: 52mm; display: flex; align-items: center; gap: 4mm; }
.sheet-identity-card { flex: 0 0 36mm; width: 36mm; aspect-ratio: 744 / 1040; display: flex; align-items: center; justify-content: center; overflow: hidden; border: 0.3mm solid var(--color-panel-border); background: #fff; color: var(--color-text-subtle); font-size: 2.6mm; text-align: center; }
.sheet-identity-card img { width: 100%; height: 100%; object-fit: contain; }
.sheet-identity-card.empty { border-style: dashed; background: var(--color-page-bg); }
.sheet-runes { flex: 1; min-width: 0; height: 100%; display: flex; align-items: center; justify-content: center; gap: 8mm; }
.sheet-rune { display: flex; align-items: center; gap: 2mm; }
.sheet-rune img { width: 14mm; height: 14mm; object-fit: contain; }
.sheet-rune b { font-size: 5mm; font-variant-numeric: tabular-nums; }
.sheet-runes.compact { flex-wrap: wrap; align-content: center; gap: 3mm 6mm; }
.sheet-runes.compact .sheet-rune img { width: 9mm; height: 9mm; }
.sheet-runes.compact .sheet-rune b { font-size: 3.6mm; }
.sheet-rune-colorless { display: block; width: 12mm; height: 12mm; border-radius: 50%; background: #94a3b8; }
.sheet-runes.compact .sheet-rune-colorless { width: 8mm; height: 8mm; }
.sheet-sections { display: flex; flex: 1; flex-direction: column; gap: 3mm; min-height: 0; margin-top: 3mm; }
.sheet-section { flex: 0 0 auto; }
.sheet-section h3 { box-sizing: border-box; display: flex; align-items: baseline; justify-content: space-between; gap: 3mm; height: 6mm; margin: 0; padding-bottom: 1mm; border-bottom: 0.25mm solid var(--color-panel-border); font-size: 3.2mm; line-height: 1; }
.sheet-section h3 b { color: var(--color-brand); font-size: 3mm; }
.sheet-grid { display: grid; grid-template-columns: repeat(var(--sheet-cols, 7), minmax(0, 1fr)); gap: 2mm; }
.sheet-empty { display: grid; flex: 1; place-items: center; margin: 0; color: var(--color-text-subtle); font-size: 4mm; }
.sheet-foot { flex: 0 0 8mm; height: 8mm; display: flex; align-items: flex-end; justify-content: space-between; gap: 3mm; border-top: 0.25mm solid var(--color-panel-border); color: var(--color-text-subtle); font-size: 2.4mm; }
</style>
<style>
@page { size: A4 portrait; margin: 0; }
@media print {
  html, body { background: #fff !important; }
  body.printing-deck-sheet * { visibility: hidden !important; }
  body.printing-deck-sheet .deck-sheet,
  body.printing-deck-sheet .deck-sheet * { visibility: visible !important; }
  body.printing-deck-sheet .builder-modal { position: static !important; width: auto !important; height: auto !important; max-height: none !important; overflow: visible !important; border: 0 !important; box-shadow: none !important; }
  body.printing-deck-sheet .builder-modal > header,
  body.printing-deck-sheet .builder-modal > footer,
  body.printing-deck-sheet .builder-modal::backdrop,
  body.printing-deck-sheet .sheet-toolbar,
  body.printing-deck-sheet .b-tabs,
  body.printing-deck-sheet .b-hint { display: none !important; }
  body.printing-deck-sheet .modal-content { padding: 0 !important; }
  body.printing-deck-sheet .deck-sheet { position: fixed !important; top: 0 !important; left: 0 !important; width: 210mm !important; height: 297mm !important; margin: 0 !important; border: 0 !important; box-shadow: none !important; zoom: 1 !important; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
}
</style>
