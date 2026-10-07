<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { ArrowLeft, ArrowUp, Bookmark, BookmarkCheck, Maximize2, Minus, X } from '@lucide/vue';
import CarddexImage from './CarddexImage.vue';
import CardEffectText from './CardEffectText.vue';
import { buildDisplayCards, DEFAULT_QUERY } from './query';
import { printKey } from './data';
import { loadPins, savePins } from './storage';
import { useBuilderCatalog } from '@/tools/deckbuilder/catalog';
import type { CarddexLocale, DisplayCard, PinnedPrint } from './types';
import type { ReaderCardRequest } from './reader';

const props = defineProps<{ open: boolean; mobile: boolean; locale: CarddexLocale; request: ReaderCardRequest | null }>();
const emit = defineEmits<{ close: []; source: [book: string, number: string]; pins: [count: number] }>();
const { records, icons, loading, sourceNote, reload } = useBuilderCatalog();
const zh = computed(() => props.locale === 'zh');
const labels = computed(() => zh.value ? {
  title: '卡牌查询', search: '查询', pinned: '已标记', close: '关闭卡牌查询', minimize: '收起卡牌查询',
  placeholder: '卡名、编号或效果…', submit: '搜索卡牌', empty: '输入卡名、编号或效果，或选中规则正文查找卡牌。',
  noPins: '还没有标记卡牌。打开卡牌详情，点击「标记卡牌」。', noResults: '没有匹配的卡牌。试试更短的卡名或关键词。',
  loading: '正在载入卡牌…', unavailable: '卡牌资料暂不可用', retry: '重新加载', back: '返回结果',
  pin: '标记卡牌', unpin: '取消标记', prints: '印版', more: '加载更多', from: '来自规则',
  expand: '展开卡牌面板', collapse: '恢复面板高度', energy: '费用', power: '战力', banned: '禁卡',
} : {
  title: 'Card search', search: 'Search', pinned: 'Pinned', close: 'Close card search', minimize: 'Minimize card search',
  placeholder: 'Card name, number, or effect…', submit: 'Search cards', empty: 'Search a name, number, or effect, or select text in the rulebook.',
  noPins: 'No pinned cards yet. Open a card and choose “Pin card.”', noResults: 'No matching cards. Try a shorter name or keyword.',
  loading: 'Loading cards…', unavailable: 'Card data is unavailable', retry: 'Reload', back: 'Back to results',
  pin: 'Pin card', unpin: 'Unpin card', prints: 'Print', more: 'Load more', from: 'From rule',
  expand: 'Expand card panel', collapse: 'Restore panel height', energy: 'Cost', power: 'Power', banned: 'Banned',
});
const tab = ref<'search' | 'pins'>('search');
const draft = ref('');
const history = ref<Array<{ id: number; text: string; book: string; number: string; limit: number }>>([]);
const pins = ref<PinnedPrint[]>(loadPins());
const detail = ref<DisplayCard | null>(null);
const pinLimit = ref(24);
const expanded = ref(false);
const input = ref<HTMLInputElement | null>(null);
const scroll = ref<HTMLElement | null>(null);
const host = ref<HTMLElement | null>(null);
let nextId = 0;

const searchHistory = computed(() => history.value.map(entry => ({
  ...entry,
  results: buildDisplayCards(records.value, { ...DEFAULT_QUERY, banned: 'all', search: entry.text }),
})));
const printIndex = computed(() => new Map(records.value.flatMap(record => record.prints.map(print =>
  [printKey(print), { key: printKey(print), base: record.base, print }] as const,
))));
const pinnedCards = computed(() => pins.value.flatMap(pin => {
  const card = printIndex.value.get(pin.key);
  return card ? [card] : [];
}));
const detailRecord = computed(() => records.value.find(record => record.base.id === detail.value?.base.id));
const detailPinned = computed(() => {
  const print = detail.value?.print;
  return Boolean(print && pins.value.some(pin => pin.key === printKey(print)));
});

function cardName(card: DisplayCard): string {
  return zh.value ? card.base.nameCn || card.base.nameEn : card.base.nameEn || card.base.nameCn;
}
function subtitle(card: DisplayCard): string {
  return zh.value ? card.base.subtitleCn || card.base.subtitleEn : card.base.subtitleEn || card.base.subtitleCn;
}
function cardTitle(card: DisplayCard): string {
  const sub = subtitle(card);
  return `${cardName(card)}${sub ? ` - ${sub}` : ''}`;
}
async function search(text = draft.value, source?: ReaderCardRequest): Promise<void> {
  const value = text.trim();
  if (!value) return;
  detail.value = null;
  tab.value = 'search';
  draft.value = value;
  history.value.push({ id: ++nextId, text: value, book: source?.book ?? '', number: source?.number ?? '', limit: 12 });
  await nextTick();
  scroll.value?.querySelector('.query-block:last-child')?.scrollIntoView({ block: 'start' });
}
function togglePin(): void {
  const print = detail.value?.print;
  if (!print) return;
  const key = printKey(print);
  pins.value = pins.value.some(pin => pin.key === key)
    ? pins.value.filter(pin => pin.key !== key)
    : [...pins.value, { key, cardNo: print.cardNo, language: print.language }];
  savePins(pins.value);
}
function selectPrint(event: Event): void {
  const print = detailRecord.value?.prints.find(item => printKey(item) === (event.target as HTMLSelectElement).value);
  if (detail.value && print) detail.value = { ...detail.value, print, key: printKey(print) };
}
function more(id: number): void {
  const entry = history.value.find(item => item.id === id);
  if (entry) entry.limit += 24;
}
function changeTab(value: 'search' | 'pins'): void {
  detail.value = null;
  tab.value = value;
}
function syncPins(event?: StorageEvent): void {
  if (!event || event.key === 'carddex:pins:v1' || event.key === null) pins.value = loadPins();
}
function onKey(event: KeyboardEvent): void {
  if (!props.open || event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
  event.preventDefault();
  if (detail.value) detail.value = null;
  else emit('close');
}
function trapMobileFocus(event: KeyboardEvent): void {
  if (event.key !== 'Tab' || !props.mobile) return;
  const controls = [...(host.value?.querySelectorAll<HTMLElement>('button, input, select, [tabindex="0"]') ?? [])]
    .filter(element => element.checkVisibility() && !element.hasAttribute('disabled'));
  const first = controls[0], last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}
watch(() => props.request, request => { if (request) void search(request.text, request); }, { immediate: true });
watch(() => props.open, async open => {
  if (open) { syncPins(); await nextTick(); input.value?.focus({ preventScroll: true }); }
}, { immediate: true });
watch(pins, value => emit('pins', value.length), { immediate: true });
onMounted(() => { window.addEventListener('storage', syncPins); window.addEventListener('keydown', onKey); });
onUnmounted(() => { window.removeEventListener('storage', syncPins); window.removeEventListener('keydown', onKey); });
</script>

<template>
  <div v-show="open" class="card-panel-backdrop" aria-hidden="true" @click="emit('close')"></div>
  <aside v-show="open" id="reader-card-panel" ref="host" class="reader-card-panel" :class="{ expanded }" :role="mobile ? 'dialog' : 'complementary'" :aria-modal="mobile ? true : undefined" :aria-label="labels.title" @keydown="trapMobileFocus">
    <header class="panel-header">
      <h2>{{ labels.title }}</h2>
      <div class="panel-actions">
        <button class="expand-panel" :aria-label="expanded ? labels.collapse : labels.expand" :aria-pressed="expanded" @click="expanded = !expanded"><Maximize2 :size="17" /></button>
        <button :aria-label="labels.minimize" @click="emit('close')"><Minus :size="18" /></button>
        <button :aria-label="labels.close" @click="emit('close')"><X :size="18" /></button>
      </div>
    </header>
    <nav class="panel-tabs" :aria-label="labels.title">
      <button :class="{ active: tab === 'search' }" :aria-pressed="tab === 'search'" @click="changeTab('search')">{{ labels.search }}</button>
      <button :class="{ active: tab === 'pins' }" :aria-pressed="tab === 'pins'" @click="changeTab('pins')"><Bookmark :size="14" /> {{ labels.pinned }} <span>{{ pins.length }}</span></button>
    </nav>
    <div ref="scroll" class="panel-scroll">
      <div v-if="loading" class="panel-state" role="status">{{ labels.loading }}</div>
      <div v-else-if="!records.length" class="panel-state" role="status"><p>{{ labels.unavailable }}</p><button class="panel-button" @click="reload(true)">{{ labels.retry }}</button></div>
      <section v-else-if="detail" class="panel-detail">
        <div class="detail-toolbar">
          <button class="detail-back" @click="detail = null"><ArrowLeft :size="15" /> {{ labels.back }}</button>
          <button class="panel-button pin-action" :class="{ pinned: detailPinned }" :disabled="!detail.print" :aria-pressed="detailPinned" @click="togglePin"><BookmarkCheck v-if="detailPinned" :size="16" /><Bookmark v-else :size="16" />{{ detailPinned ? labels.unpin : labels.pin }}</button>
        </div>
        <CarddexImage :src="detail.print?.imageUrl || ''" :fallback="detail.print?.ttsUrl || ''" :alt="cardTitle(detail)" :landscape="detail.base.categories.includes('战场')" eager />
        <h3>{{ cardTitle(detail) }}</h3>
        <p class="detail-meta">{{ detail.print?.cardNo || detail.base.cardNo }} · {{ detail.base.categories.join(' / ') }}<br />{{ labels.energy }} {{ detail.base.energy ?? '—' }} · {{ labels.power }} {{ detail.base.power ?? '—' }}<span v-if="detail.base.banned"> · {{ labels.banned }}</span></p>
        <label v-if="detailRecord?.prints.length" class="print-picker">{{ labels.prints }}<select :value="detail.print ? printKey(detail.print) : ''" @change="selectPrint"><option v-for="print in detailRecord.prints" :key="printKey(print)" :value="printKey(print)">{{ print.cardNo }} · {{ print.language }}</option></select></label>
        <CardEffectText :base="detail.base" :icons="icons" :locale="locale" />
      </section>
      <template v-else-if="tab === 'search'">
        <p v-if="!history.length" class="panel-state">{{ labels.empty }}</p>
        <section v-for="entry in searchHistory" :key="entry.id" class="query-block">
          <button v-if="entry.number" class="query-source" :title="entry.book" @click="emit('source', entry.book, entry.number)">{{ labels.from }} {{ entry.number }}</button>
          <div class="query-quote">{{ entry.text }}</div>
          <p class="result-count" role="status">{{ entry.results.length }} {{ zh ? '张卡牌' : 'cards' }}</p>
          <p v-if="!entry.results.length" class="panel-state no-results">{{ labels.noResults }}</p>
          <div class="panel-card-grid">
            <button v-for="card in entry.results.slice(0, entry.limit)" :key="card.key" class="reader-card-tile" :aria-label="cardTitle(card)" @click="detail = card">
              <CarddexImage :src="card.print?.imageUrl || ''" :fallback="card.print?.ttsUrl || ''" :alt="cardTitle(card)" :landscape="card.base.categories.includes('战场')" />
              <span>{{ cardTitle(card) }}</span>
            </button>
          </div>
          <button v-if="entry.results.length > entry.limit" class="panel-button load-more" @click="more(entry.id)">{{ labels.more }} ({{ Math.min(entry.limit, entry.results.length) }} / {{ entry.results.length }})</button>
        </section>
      </template>
      <template v-else>
        <p v-if="!pinnedCards.length" class="panel-state">{{ labels.noPins }}</p>
        <div class="panel-card-grid pinned-grid">
          <button v-for="card in pinnedCards.slice(0, pinLimit)" :key="card.key" class="reader-card-tile" :aria-label="cardTitle(card)" @click="detail = card">
            <CarddexImage :src="card.print?.imageUrl || ''" :fallback="card.print?.ttsUrl || ''" :alt="cardTitle(card)" :landscape="card.base.categories.includes('战场')" />
            <span>{{ cardTitle(card) }}</span>
          </button>
        </div>
        <button v-if="pinnedCards.length > pinLimit" class="panel-button load-more" @click="pinLimit += 24">{{ labels.more }}</button>
      </template>
    </div>
    <form class="panel-query" @submit.prevent="search()">
      <label class="sr-only" for="reader-card-query">{{ labels.submit }}</label>
      <input id="reader-card-query" ref="input" v-model="draft" type="search" :placeholder="labels.placeholder" autocomplete="off" />
      <button type="submit" :disabled="!draft.trim()" :aria-label="labels.submit"><ArrowUp :size="19" /></button>
    </form>
    <p class="panel-data-note">{{ sourceNote }}</p>
  </aside>
</template>

<style scoped>
.reader-card-panel { position: fixed; inset: 0 0 0 auto; z-index: 50; display: flex; flex-direction: column; width: var(--reader-panel-width, 400px); background: var(--paper); color: var(--ink); border-left: 1px solid var(--reader-border); --color-text-primary: var(--ink); --color-text-muted: var(--muted-ink); --color-text-subtle: var(--muted-ink); --color-brand: var(--reader-accent); --color-panel-border: var(--reader-border); --color-brand-faint: var(--reader-border); }
.card-panel-backdrop { display: none; }
.panel-header { display: flex; justify-content: space-between; align-items: center; padding: 17px 20px 11px; }
.panel-header h2 { font: 600 19px/1.4 'Noto Serif SC', Georgia, serif; }
.panel-actions { display: flex; gap: 2px; }
.panel-actions button { display: grid; place-items: center; width: 34px; height: 34px; color: var(--muted-ink); border-radius: 5px; }
.panel-actions button:hover { background: var(--reader-soft); }
.expand-panel { display: none !important; }
.panel-tabs { display: flex; gap: 16px; padding: 0 20px; border-bottom: 1px solid var(--reader-border); }
.panel-tabs button { display: flex; align-items: center; gap: 5px; padding: 10px 1px; color: var(--muted-ink); border-bottom: 2px solid transparent; font-size: 13px; }
.panel-tabs button.active { color: var(--reader-accent); border-bottom-color: currentColor; }
.panel-tabs span { font: 11px ui-monospace, monospace; }
.panel-scroll { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 18px 20px; scroll-padding-top: 18px; }
.panel-state { color: var(--muted-ink); font-size: 13px; line-height: 1.8; padding: 22px 0; }
.no-results { padding: 0 0 14px; }
.query-block + .query-block { margin-top: 26px; padding-top: 20px; border-top: 1px solid var(--reader-border); }
.query-source { margin-bottom: 7px; color: var(--reader-accent); font-size: 11px; text-decoration: underline; text-underline-offset: 3px; }
.query-quote { margin-left: auto; width: fit-content; max-width: 100%; padding: 8px 12px; border-radius: 9px 9px 2px 9px; background: var(--reader-soft); overflow-wrap: anywhere; font-size: 13px; line-height: 1.7; white-space: pre-wrap; }
.result-count { padding: 12px 0 9px; color: var(--muted-ink); font: 11px/1.7 system-ui, sans-serif; }
.panel-card-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; gap: 15px 12px; }
.reader-card-tile { min-width: 0; text-align: left; }
.reader-card-tile :deep(.carddex-image) { border-radius: 5px; }
.reader-card-tile > span { display: block; margin-top: 7px; color: var(--ink); font: 500 12px/1.65 system-ui, sans-serif; overflow-wrap: anywhere; }
.reader-card-tile:hover > span { color: var(--reader-accent); }
.panel-button { display: inline-flex; justify-content: center; align-items: center; gap: 6px; padding: 7px 10px; border: 1px solid var(--reader-border); border-radius: 5px; font-size: 12px; }
.panel-button:disabled { opacity: .45; }
.load-more { width: 100%; margin-top: 16px; color: var(--muted-ink); }
.panel-query { display: flex; align-items: center; gap: 7px; margin: 10px 16px 0; padding: 7px 7px 7px 12px; border: 1px solid var(--reader-border); border-radius: 9px; }
.panel-query:focus-within { border-color: var(--reader-accent); }
.panel-query input { flex: 1; min-width: 0; background: transparent; font-size: 14px; outline: none; }
.panel-query input::placeholder { color: var(--muted-ink); }
.panel-query button { display: grid; place-items: center; width: 34px; height: 34px; flex: none; border-radius: 7px; background: var(--reader-accent); color: var(--paper); }
.panel-query button:disabled { opacity: .35; }
.panel-data-note { padding: 5px 20px max(10px, env(safe-area-inset-bottom)); color: var(--muted-ink); font-size: 10px; }
.detail-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 18px; }
.detail-back { display: inline-flex; align-items: center; gap: 4px; color: var(--muted-ink); font-size: 12px; }
.pin-action.pinned { color: var(--reader-accent); border-color: currentColor; }
.panel-detail > :deep(.carddex-image) { max-width: 270px; margin: 0 auto 17px; border-radius: 6px; }
.panel-detail h3 { font: 600 17px/1.6 'Noto Serif SC', Georgia, serif; }
.detail-meta { margin-top: 7px; color: var(--muted-ink); font-size: 12px; line-height: 1.8; }
.print-picker { display: flex; align-items: center; gap: 10px; margin-top: 16px; color: var(--muted-ink); font-size: 12px; }
.print-picker select { flex: 1; min-width: 0; padding: 7px; color: var(--ink); background: var(--paper); border: 1px solid var(--reader-border); border-radius: 4px; }
@media (max-width: 900px) {
  .card-panel-backdrop { display: block; position: fixed; inset: 0; z-index: 49; background: #17151245; }
  .reader-card-panel { inset: auto 0 0; width: 100%; height: 68dvh; border-left: 0; border-top: 1px solid var(--reader-border); border-radius: 15px 15px 0 0; box-shadow: 0 -8px 32px #0002; }
  .reader-card-panel.expanded { height: 92dvh; }
  .expand-panel { display: grid !important; }
  .panel-header { padding-top: 13px; }
  .panel-scroll { padding-top: 14px; }
  .panel-card-grid { grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); }
  .panel-query input { font-size: 16px; }
}
</style>
