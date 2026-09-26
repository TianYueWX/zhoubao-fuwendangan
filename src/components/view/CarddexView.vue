<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from "vue";
import CarddexTile from "@/components/carddex/CarddexTile.vue";
import CarddexFilters from "@/components/carddex/CarddexFilters.vue";
import CarddexSortDialog from "@/components/carddex/CarddexSortDialog.vue";
import CardDetailModal from "@/components/carddex/CardDetailModal.vue";
import PinnedCardsModal from "@/components/carddex/PinnedCardsModal.vue";
import CardImageViewer from "@/components/carddex/CardImageViewer.vue";
import { loadCarddexData, printKey } from "@/components/carddex/data";
import {
  buildDisplayCards,
  DEFAULT_QUERY,
  facetOptions,
  numericBounds,
} from "@/components/carddex/query";
import { clearCardImageCache } from "@/components/carddex/imageCache";
import {
  decodeSharedState,
  encodeSharedState,
  loadPins,
  loadQuery,
  loadUi,
  savePins,
  saveQuery,
  saveUi,
} from "@/components/carddex/storage";
import type {
  ActiveFilter,
  CardIcon,
  CardPrint,
  CardQa,
  CardRecord,
  CarddexQueryState,
  DisplayCard,
  FilterType,
  NumericFilters,
  PinnedPrint,
  SortRule,
} from "@/components/carddex/types";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const loading = ref(true);
const error = ref("");
const records = ref<CardRecord[]>([]);
const icons = ref<CardIcon[]>([]);
const qaByCardNo = ref<Map<string, CardQa[]>>(new Map());
const query = reactive<CarddexQueryState>(loadQuery(clone(DEFAULT_QUERY)));
const ui = reactive(loadUi());
const searchInput = ref(query.search);
const visibleCount = ref(48);
const sortOpen = ref(false);
const mobileFilterOpen = ref(false);
const pinnedOpen = ref(false);
const pins = ref<PinnedPrint[]>(loadPins());
const detailItem = ref<DisplayCard | null>(null);
const detailList = ref<DisplayCard[]>([]);
const teleportReady = ref(false);
const shareCopied = ref(false);
const incoming = ref<CarddexQueryState | null>(null);
const showTop = ref(false);
const viewerKey = ref("");
const suggestionIndex = ref(-1);
const detailFromPins = ref(false);
const resultsScroll = ref<HTMLElement | null>(null);
let sentinelObserver: IntersectionObserver | null = null;

const zh = computed(() => ui.locale === "zh");
const labels = computed(() =>
  zh.value
    ? {
        title: "卡牌查询",
        subtitle: "CARD ARCHIVE",
        placeholder: "搜索卡名、效果、编号或英雄标签…",
        base: "按卡牌",
        print: "按印本",
        sort: "排序",
        filter: "筛选",
        count: "张结果",
        noResult: "没有符合条件的卡牌",
        loading: "正在读取卡牌资料…",
        retry: "重新加载",
        pinned: "已标记",
        share: "分享",
        cache: "清理缓存",
        filters: "项条件",
        expand: "展开条件",
        collapse: "收起条件",
      }
    : {
        title: "Card Search",
        subtitle: "CARD ARCHIVE",
        placeholder: "Search names, text, numbers, or champions…",
        base: "Cards",
        print: "Prints",
        sort: "Sort",
        filter: "Filters",
        count: "results",
        noResult: "No matching cards",
        loading: "Loading card catalog…",
        retry: "Retry",
        pinned: "Pinned",
        share: "Share",
        cache: "Clear cache",
        filters: "filters",
        expand: "Show filters",
        collapse: "Hide filters",
      },
);

const options = computed(() => facetOptions(records.value, query.mode));
const bounds = computed(() => numericBounds(records.value));
const results = computed(() => buildDisplayCards(records.value, query));
const visible = computed(() => results.value.slice(0, visibleCount.value));
const hasMore = computed(() => visibleCount.value < results.value.length);
const recordById = computed(
  () => new Map(records.value.map((r) => [r.base.id, r])),
);
const printIndex = computed(() => {
  const map = new Map<string, { record: CardRecord; print: CardPrint }>();
  for (const record of records.value)
    for (const print of record.prints)
      map.set(printKey(print), { record, print });
  return map;
});
const pinSet = computed(() => new Set(pins.value.map((p) => p.key)));
const pinnedItems = computed<DisplayCard[]>(() =>
  pins.value.flatMap((pin) => {
    const found = printIndex.value.get(pin.key);
    return found
      ? [{ key: pin.key, base: found.record.base, print: found.print }]
      : [];
  }),
);
const currentDetailIndex = computed(() =>
  detailItem.value
    ? detailList.value.findIndex((i) => i.key === detailItem.value?.key)
    : -1,
);
const detailRecord = computed(() =>
  detailItem.value
    ? (recordById.value.get(detailItem.value.base.id) ?? null)
    : null,
);
const detailQa = computed(() =>
  detailItem.value
    ? (qaByCardNo.value.get(detailItem.value.base.cardNo) ?? [])
    : [],
);
const viewerItem = computed(() => {
  if (!viewerKey.value) return null;
  const found = printIndex.value.get(viewerKey.value);
  return found
    ? { key: viewerKey.value, base: found.record.base, print: found.print }
    : null;
});
const activeCount = computed(
  () =>
    query.filters.length +
    (["energy", "returnEnergy", "power"] as const).filter((k) => {
      const a = query.numeric[k],
        b = bounds.value[k];
      return a.min !== b.min || a.max !== b.max;
    }).length,
);
const suggestions = computed(() => {
  const q = searchInput.value.trim().toLocaleLowerCase();
  if (!q) return [];
  const types: FilterType[] = ["tag", "keyword", "advancedTag", "region"];
  const seen = new Set<string>();
  const out: Array<{ type: FilterType; value: string }> = [];
  for (const type of types)
    for (const value of options.value[type])
      if (value.toLocaleLowerCase().includes(q) && !seen.has(value)) {
        seen.add(value);
        out.push({ type, value });
        if (out.length === 8) return out;
      }
  return out;
});

watch(query, () => saveQuery(clone(query)), { deep: true });
watch(ui, () => saveUi(clone(ui)), { deep: true });
watch(pins, (v) => savePins(v), { deep: true });
watch(results, () => {
  visibleCount.value = 48;
  showTop.value = false;
  resultsScroll.value?.scrollTo({ top: 0 });
  nextTick(observeSentinel);
});
watch(suggestions, () => {
  suggestionIndex.value = -1;
});
watch(
  () => [detailItem.value, pinnedOpen.value, mobileFilterOpen.value],
  ([detail, pinned, filter]) => {
    document.body.style.overflow = detail || pinned || filter ? "hidden" : "";
  },
);

function isPinned(print: CardPrint): boolean {
  return pinSet.value.has(printKey(print));
}
function togglePin(print: CardPrint | null): void {
  if (!print) return;
  const key = printKey(print);
  const i = pins.value.findIndex((p) => p.key === key);
  if (i >= 0) pins.value.splice(i, 1);
  else pins.value.push({ key, cardNo: print.cardNo, language: print.language });
}
function toggleItemPin(item: DisplayCard): void {
  togglePin(item.print);
}
function openDetail(
  item: DisplayCard,
  list: DisplayCard[] = results.value,
  fromPins = false,
): void {
  detailItem.value = item;
  detailList.value = list;
  detailFromPins.value = fromPins;
}
function closeDetail(): void {
  detailItem.value = null;
  if (detailFromPins.value) {
    detailFromPins.value = false;
    pinnedOpen.value = true;
  }
}
function stepDetail(by: number): void {
  const i = currentDetailIndex.value + by;
  if (i >= 0 && i < detailList.value.length)
    detailItem.value = detailList.value[i] ?? null;
}
function reorderPins(keys: string[]): void {
  const byKey = new Map(pins.value.map((p) => [p.key, p]));
  pins.value = keys.flatMap((k) => {
    const p = byKey.get(k);
    return p ? [p] : [];
  });
}
function submitSearch(): void {
  query.search = searchInput.value.trim();
}
function searchKeydown(e: KeyboardEvent): void {
  if (e.key === "ArrowDown" && suggestions.value.length) {
    e.preventDefault();
    suggestionIndex.value =
      (suggestionIndex.value + 1) % suggestions.value.length;
    return;
  }
  if (e.key === "ArrowUp" && suggestions.value.length) {
    e.preventDefault();
    suggestionIndex.value =
      (suggestionIndex.value - 1 + suggestions.value.length) %
      suggestions.value.length;
    return;
  }
  if (e.key === "Escape") {
    suggestionIndex.value = -1;
    (e.currentTarget as HTMLInputElement).blur();
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    const s = suggestions.value[suggestionIndex.value];
    if (s) addSuggestion(s);
    else submitSearch();
  }
}
function addSuggestion(s: { type: FilterType; value: string }): void {
  query.filters = query.filters.filter(
    (f) => !(f.type === s.type && f.value === s.value),
  );
  query.filters.push({ ...s, mode: "include" });
  searchInput.value = "";
  query.search = "";
}
function removeFilter(f: ActiveFilter): void {
  query.filters = query.filters.filter(
    (x) => !(x.type === f.type && x.value === f.value),
  );
}
function resetNumeric(k: "energy" | "returnEnergy" | "power"): void {
  query.numeric[k] = { ...bounds.value[k] };
}
function numericName(k: "energy" | "returnEnergy" | "power"): string {
  return k === "energy"
    ? zh.value
      ? "法力"
      : "Energy"
    : k === "returnEnergy"
      ? zh.value
        ? "符能"
        : "Rune"
      : zh.value
        ? "战力"
        : "Power";
}
function applyFilters(filters: ActiveFilter[], numeric: NumericFilters): void {
  query.filters = filters.map((f) => ({ ...f }));
  query.numeric = clone(numeric);
  mobileFilterOpen.value = false;
}
function applySort(rules: SortRule[]): void {
  query.sort = rules.length
    ? rules.map((r) => ({ ...r }))
    : [{ id: "default-card-no", field: "cardNo", asc: true }];
  sortOpen.value = false;
}
function cycleBanned(): void {
  query.banned =
    query.banned === "hide" ? "all" : query.banned === "all" ? "only" : "hide";
}
function toggleFilterPanel(): void {
  if (window.innerWidth >= 1024) ui.sidebarOpen = !ui.sidebarOpen;
  else mobileFilterOpen.value = true;
}
function bannedLabel(): string {
  return query.banned === "hide"
    ? zh.value
      ? "隐藏禁卡"
      : "Banned hidden"
    : query.banned === "all"
      ? zh.value
        ? "显示禁卡"
        : "Show banned"
      : zh.value
        ? "只看禁卡"
        : "Banned only";
}
function toggleSection(type: string, open: boolean): void {
  ui.sections[type] = open;
}
function openViewer(print: CardPrint): void {
  const url = `${location.origin}${location.pathname}${location.search}#/carddex?viewer=${encodeURIComponent(printKey(print))}`;
  window.open(url, "_blank", "noopener,noreferrer");
}
function cleanHashQuery(): void {
  history.replaceState(
    null,
    "",
    `${location.pathname}${location.search}#/carddex`,
  );
}
async function share(): Promise<void> {
  const state = encodeSharedState(clone(query));
  const url = `${location.origin}${location.pathname}${location.search}#/carddex?state=${state}`;
  try {
    await navigator.clipboard.writeText(url);
    shareCopied.value = true;
    setTimeout(() => (shareCopied.value = false), 1800);
  } catch {
    prompt(zh.value ? "复制分享链接" : "Copy share link", url);
  }
}
function acceptShare(): void {
  if (!incoming.value) return;
  Object.assign(query, clone(incoming.value));
  searchInput.value = query.search;
  incoming.value = null;
  cleanHashQuery();
}
function declineShare(): void {
  incoming.value = null;
  cleanHashQuery();
}
async function clearImages(): Promise<void> {
  if (confirm(zh.value ? "清除已经缓存的卡图？" : "Clear cached card images?"))
    await clearCardImageCache();
}
function backTop(): void {
  resultsScroll.value?.scrollTo({ top: 0, behavior: "smooth" });
}
function onResultsScroll(): void {
  showTop.value = (resultsScroll.value?.scrollTop ?? 0) > 550;
}
function keydown(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    document.getElementById("carddex-search")?.focus();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
    e.preventDefault();
    if (innerWidth >= 1024) ui.sidebarOpen = !ui.sidebarOpen;
    else mobileFilterOpen.value = !mobileFilterOpen.value;
  }
}
function observeSentinel(): void {
  sentinelObserver?.disconnect();
  const el = document.getElementById("carddex-sentinel");
  if (!el) return;
  sentinelObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting) && hasMore.value)
        visibleCount.value += 48;
    },
    { root: resultsScroll.value, rootMargin: "500px 0px" },
  );
  sentinelObserver.observe(el);
}
async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const data = await loadCarddexData();
    records.value = data.records;
    icons.value = data.icons;
    qaByCardNo.value = data.qaByCardNo;
    const b = numericBounds(data.records);
    for (const k of ["energy", "returnEnergy", "power"] as const) {
      if (query.numeric[k].max === 99) query.numeric[k] = { ...b[k] };
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
    await nextTick();
    observeSentinel();
  }
}

onMounted(() => {
  teleportReady.value = true;
  window.addEventListener("keydown", keydown);
  const raw = location.hash.split("?")[1] ?? "";
  const params = new URLSearchParams(raw);
  viewerKey.value = params.get("viewer") ?? "";
  const shared = params.get("state");
  if (shared) incoming.value = decodeSharedState(shared);
  void load();
});
onBeforeUnmount(() => {
  sentinelObserver?.disconnect();
  window.removeEventListener("keydown", keydown);
  document.body.style.overflow = "";
});
</script>

<template>
  <CardImageViewer v-if="viewerItem" :item="viewerItem" :locale="ui.locale" />
  <div v-else class="carddex-page fade-in">
    <Teleport v-if="teleportReady" to="#global-page-actions">
      <div class="global-actions">
        <button @click="pinnedOpen = true">
          ◆ <span>{{ labels.pinned }}</span
          ><b>{{ pins.length }}</b>
        </button>
        <button @click="share">
          ↗
          <span>{{
            shareCopied ? (zh ? "已复制" : "Copied") : labels.share
          }}</span>
        </button>
        <button @click="ui.locale = ui.locale === 'zh' ? 'en' : 'zh'">
          {{ ui.locale === "zh" ? "EN" : "中" }}
        </button>
        <button :title="labels.cache" @click="clearImages">
          ⌫ <span class="cache-text">{{ labels.cache }}</span>
        </button>
      </div>
    </Teleport>

    <div class="workspace" :class="{ collapsed: !ui.sidebarOpen }">
      <main class="result-column">
        <div class="search-tools">
          <div class="search-row">
            <div class="search-box">
              <span>⌕</span
              ><input
                id="carddex-search"
                v-model="searchInput"
                :placeholder="labels.placeholder"
                autocomplete="off"
                @keydown="searchKeydown"
              />
              <button
                v-if="searchInput"
                @click="
                  searchInput = '';
                  query.search = '';
                "
              >
                ×
              </button>
              <div v-if="suggestions.length" class="suggestions">
                <button
                  v-for="(s, i) in suggestions"
                  :key="`${s.type}:${s.value}`"
                  :class="{ active: i === suggestionIndex }"
                  @mouseenter="suggestionIndex = i"
                  @mousedown.prevent="addSuggestion(s)"
                >
                  <span>{{ s.value }}</span
                  ><small>{{ zh ? "回车添加为筛选" : "Add as filter" }}</small>
                </button>
              </div>
            </div>
            <span class="result-count"
              >{{ results.length }} {{ labels.count }}</span
            >
            <div class="mode-switch">
              <button
                :class="{ active: query.mode === 'base' }"
                @click="query.mode = 'base'"
              >
                {{ labels.base }}</button
              ><button
                :class="{ active: query.mode === 'print' }"
                @click="query.mode = 'print'"
              >
                {{ labels.print }}
              </button>
            </div>
            <button class="tool-btn" @click="cycleBanned">
              ⊘ {{ bannedLabel() }}
            </button>
            <button class="tool-btn" @click="sortOpen = true">
              ↕ {{ labels.sort }} <b>{{ query.sort.length }}</b>
            </button>
            <button class="tool-btn filter-trigger" @click="toggleFilterPanel">
              ☷ {{ labels.filter }} <b v-if="activeCount">{{ activeCount }}</b>
            </button>
          </div>
          <div
            v-if="query.search || query.filters.length || activeCount"
            class="active-strip"
          >
            <button class="chips-toggle" @click="ui.chipsOpen = !ui.chipsOpen">
              {{ ui.chipsOpen ? labels.collapse : labels.expand }} ·
              {{ activeCount + (query.search ? 1 : 0) }} {{ labels.filters }}
            </button>
            <div v-if="ui.chipsOpen" class="active-chips">
              <button
                v-if="query.search"
                @click="
                  query.search = '';
                  searchInput = '';
                "
                @contextmenu.prevent="
                  query.search = '';
                  searchInput = '';
                "
              >
                “{{ query.search }}” ×
              </button>
              <button
                v-for="f in query.filters"
                :key="`${f.type}:${f.value}`"
                :class="f.mode"
                @click="removeFilter(f)"
                @contextmenu.prevent="removeFilter(f)"
              >
                {{
                  f.mode === "include" ? "○" : f.mode === "require" ? "●" : "×"
                }}
                {{ f.value }} ×
              </button>
              <template
                v-for="k in ['energy', 'returnEnergy', 'power'] as const"
                :key="k"
                ><button
                  v-if="
                    query.numeric[k].min !== bounds[k].min ||
                    query.numeric[k].max !== bounds[k].max
                  "
                  @click="resetNumeric(k)"
                  @contextmenu.prevent="resetNumeric(k)"
                >
                  {{ numericName(k) }} {{ query.numeric[k].min }}–{{
                    query.numeric[k].max
                  }}
                  ×
                </button></template
              >
            </div>
          </div>
        </div>

        <div
          ref="resultsScroll"
          class="results-scroll"
          @scroll.passive="onResultsScroll"
        >
          <div v-if="loading" class="state">
            <i></i>
            <p>{{ labels.loading }}</p>
          </div>
          <div v-else-if="error" class="state error">
            <p>{{ error }}</p>
            <button @click="load">{{ labels.retry }}</button>
          </div>
          <template v-else>
            <div v-if="visible.length" class="card-grid">
              <CarddexTile
                v-for="item in visible"
                :key="item.key"
                :item="item"
                :locale="ui.locale"
                :pinned="!!item.print && isPinned(item.print)"
                @open="openDetail(item)"
                @pin="toggleItemPin(item)"
              />
            </div>
            <div v-else class="state">
              <p>{{ labels.noResult }}</p>
            </div>
            <div id="carddex-sentinel" class="sentinel">
              <span v-if="hasMore">···</span
              ><span v-else-if="visible.length"
                >— {{ zh ? "已经到底" : "End" }} —</span
              >
            </div>
          </template>
        </div>
        <button
          v-if="showTop"
          class="inside-top"
          :aria-label="zh ? '回到顶部' : 'Back to top'"
          @click="backTop"
        >
          ↑
        </button>
      </main>

      <div v-if="ui.sidebarOpen" class="desktop-filter">
        <CarddexFilters
          :locale="ui.locale"
          :filters="query.filters"
          :numeric="query.numeric"
          :options="options"
          :bounds="bounds"
          :sections="ui.sections"
          @apply="applyFilters"
          @section="toggleSection"
        />
      </div>
    </div>

    <Teleport to="body"
      ><div v-if="mobileFilterOpen" class="mobile-filter">
        <CarddexFilters
          :locale="ui.locale"
          :filters="query.filters"
          :numeric="query.numeric"
          :options="options"
          :bounds="bounds"
          :sections="ui.sections"
          @apply="applyFilters"
          @section="toggleSection"
          @close="mobileFilterOpen = false"
        /></div
    ></Teleport>
    <CarddexSortDialog
      :open="sortOpen"
      :locale="ui.locale"
      :rules="query.sort"
      @close="sortOpen = false"
      @apply="applySort"
    />
    <PinnedCardsModal
      :open="pinnedOpen"
      :locale="ui.locale"
      :items="pinnedItems"
      :main-sort="query.sort"
      @close="pinnedOpen = false"
      @open-card="
        (item, context) => {
          pinnedOpen = false;
          openDetail(item, context, true);
        }
      "
      @unpin="toggleItemPin"
      @reorder="reorderPins"
      @clear="pins = []"
    />
    <CardDetailModal
      :item="detailItem"
      :record="detailRecord"
      :locale="ui.locale"
      :icons="icons"
      :qa="detailQa"
      :is-pinned="isPinned"
      :can-prev="currentDetailIndex > 0"
      :can-next="
        currentDetailIndex >= 0 && currentDetailIndex < detailList.length - 1
      "
      @close="closeDetail"
      @prev="stepDetail(-1)"
      @next="stepDetail(1)"
      @pin="togglePin"
      @viewer="openViewer"
    />

    <Teleport to="body"
      ><div v-if="incoming" class="share-backdrop">
        <section>
          <small>{{ zh ? "分享查询" : "SHARED SEARCH" }}</small>
          <h2>{{ zh ? "应用分享的查询条件？" : "Apply shared search?" }}</h2>
          <p>
            {{
              zh
                ? `搜索词：${incoming.search || "无"} · ${incoming.filters.length} 项筛选 · ${incoming.sort.length} 项排序`
                : `Query: ${incoming.search || "none"} · ${incoming.filters.length} filters · ${incoming.sort.length} sort keys`
            }}
          </p>
          <div>
            <button @click="declineShare">
              {{ zh ? "保留我的条件" : "Keep mine" }}</button
            ><button class="primary" @click="acceptShare">
              {{ zh ? "应用并保存" : "Apply and save" }}
            </button>
          </div>
        </section>
      </div></Teleport
    >
  </div>
</template>

<style scoped>
.carddex-page {
  height: 100%;
  min-height: 0;
}
.workspace {
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) clamp(300px, 30%, 420px);
  gap: 22px;
  align-items: stretch;
}
.workspace.collapsed {
  grid-template-columns: minmax(0, 1fr);
}
.result-column {
  position: relative;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.desktop-filter {
  min-height: 0;
}
.desktop-filter :deep(.filter-panel) {
  height: 100%;
}
.search-tools {
  position: relative;
  flex: none;
  z-index: 30;
  margin-bottom: 12px;
  padding: 0;
}
.results-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  padding-right: 7px;
}
.search-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.search-box {
  position: relative;
  flex: 1;
  min-width: 220px;
  height: 38px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 11px;
  border: 1px solid var(--color-card-border);
  border-radius: 9px;
  background: var(--color-card-bg);
  box-shadow: 0 5px 18px -18px var(--color-shadow);
}
.search-box > span {
  color: var(--color-brand);
  font-size: 18px;
}
.search-box input {
  width: 100%;
  min-width: 0;
  background: transparent;
  color: var(--color-text-primary);
  font-size: 12px;
  outline: 0;
}
.search-box > button {
  color: var(--color-text-subtle);
  font-size: 17px;
}
.result-count {
  flex: none;
  color: var(--color-text-subtle);
  font-size: 10px;
  white-space: nowrap;
}
.suggestions {
  position: absolute;
  top: calc(100% + 5px);
  left: 0;
  right: 0;
  z-index: 40;
  overflow: hidden;
  border: 1px solid var(--color-panel-border);
  border-radius: 9px;
  background: var(--color-card-bg);
  box-shadow: 0 15px 35px -18px rgba(30, 20, 10, 0.35);
}
.suggestions button {
  width: 100%;
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 11px;
  text-align: left;
  color: var(--color-text-muted);
  font-size: 11px;
}
.suggestions button:hover,
.suggestions button.active {
  background: var(--color-brand-soft);
  color: var(--color-brand);
}
.suggestions small {
  color: var(--color-text-subtle);
  font-size: 9px;
}
.mode-switch {
  display: flex;
  white-space: nowrap;
}
.mode-switch button,
.tool-btn {
  height: 38px;
  padding: 0 10px;
  border: 1px solid var(--color-card-border);
  color: var(--color-text-muted);
  background: var(--color-card-bg);
  font-size: 10px;
}
.mode-switch button:first-child {
  border-radius: 8px 0 0 8px;
}
.mode-switch button:last-child {
  border-left: 0;
  border-radius: 0 8px 8px 0;
}
.mode-switch .active {
  color: var(--color-brand-ink);
  background: var(--color-brand);
  border-color: var(--color-brand);
}
.tool-btn {
  border-radius: 8px;
  white-space: nowrap;
}
.tool-btn:hover {
  color: var(--color-brand);
  border-color: var(--color-brand);
}
.tool-btn b {
  display: inline-grid;
  min-width: 17px;
  height: 17px;
  place-items: center;
  margin-left: 3px;
  border-radius: 999px;
  background: var(--color-brand-soft);
  color: var(--color-brand);
  font-size: 9px;
}
.active-strip {
  margin-top: 8px;
  display: flex;
    column-gap: 5px;
    align-items: center;
    align-content: center;
}
.chips-toggle {
  color: var(--color-text-muted);
  font-size: 10px;
  font-weight: 650;
}
.active-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.active-chips button {
  padding: 3px 7px;
  border: 1px solid var(--color-card-border);
  border-radius: 999px;
  color: var(--color-text-muted);
  background: var(--color-card-bg);
  font-size: 11px;
  font-weight: 650;
}
.active-chips .include {
  border-color: #2f6f5e;
  color: #fff;
  background: #2f6f5e;
}
.active-chips .require {
  border-color: #315b96;
  color: #fff;
  background: #315b96;
}
.active-chips .exclude {
  border-color: #953f38;
  color: #fff;
  background: #953f38;
}
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(118px, 1fr));
  align-items: start;
  gap: 22px 14px;
}
.state {
  min-height: 380px;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 12px;
  color: var(--color-text-subtle);
  font-size: 12px;
}
.state i {
  width: 24px;
  height: 24px;
  border: 2px solid var(--color-panel-border);
  border-top-color: var(--color-brand);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
.state button {
  padding: 7px 12px;
  border: 1px solid var(--color-brand);
  border-radius: 7px;
  color: var(--color-brand);
}
.error {
  color: var(--color-brand);
}
.sentinel {
  min-height: 70px;
  display: grid;
  place-items: center;
  color: var(--color-text-subtle);
  font-size: 10px;
  letter-spacing: 0.12em;
}
.inside-top {
  position: absolute;
  z-index: 45;
  right: 20px;
  bottom: 18px;
  width: 40px;
  height: 40px;
  border-radius: 999px;
  background: var(--color-brand);
  color: var(--color-brand-ink);
  box-shadow: 0 7px 22px rgba(30, 20, 10, 0.25);
}
.global-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.global-actions button {
  height: 30px;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 0 8px;
  border: 1px solid var(--color-card-border);
  border-radius: 7px;
  color: var(--color-text-muted);
  font-size: 10px;
}
.global-actions button:hover {
  color: var(--color-brand);
  border-color: var(--color-brand);
}
.global-actions b {
  min-width: 16px;
  height: 16px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: var(--color-brand);
  color: var(--color-brand-ink);
  font-size: 8px;
}
.mobile-filter {
  position: fixed;
  inset: 0;
  z-index: 120;
  background: var(--color-card-bg);
}
.share-backdrop {
  position: fixed;
  inset: 0;
  z-index: 150;
  display: grid;
  place-items: center;
  padding: 18px;
  background: rgba(35, 32, 28, 0.52);
  backdrop-filter: blur(4px);
}
.share-backdrop section {
  width: min(470px, 94vw);
  padding: 23px;
  border: 1px solid var(--color-panel-border);
  border-radius: 12px;
  background: var(--color-card-bg);
  box-shadow: 0 25px 70px rgba(20, 15, 10, 0.3);
}
.share-backdrop small {
  color: var(--color-brand);
  font-size: 9px;
  letter-spacing: 0.17em;
}
.share-backdrop h2 {
  margin-top: 5px;
  font-family: "Noto Serif SC", serif;
  font-size: 20px;
  font-weight: 850;
}
.share-backdrop p {
  margin-top: 13px;
  color: var(--color-text-muted);
  font-size: 11px;
}
.share-backdrop section > div {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}
.share-backdrop button {
  padding: 8px 13px;
  border: 1px solid var(--color-card-border);
  border-radius: 8px;
  font-size: 11px;
}
.share-backdrop .primary {
  color: var(--color-brand-ink);
  background: var(--color-brand);
  border-color: var(--color-brand);
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (min-width: 1500px) {
  .card-grid {
    grid-template-columns: repeat(auto-fill, minmax(138px, 1fr));
  }
}
@media (max-width: 1023px) {
  .workspace {
    display: block;
  }
  .result-column {
    height: 100%;
  }
  .desktop-filter {
    display: none;
  }
  .search-row {
    flex-wrap: wrap;
  }
  .search-box {
    flex-basis: 100%;
  }
  .mode-switch {
    flex: 1;
  }
  .mode-switch button {
    flex: 1;
  }
  .tool-btn {
    flex: 1;
  }
  .card-grid {
    grid-template-columns: repeat(auto-fill, minmax(125px, 1fr));
  }
  .filter-trigger {
    display: block;
  }
}
@media (max-width: 600px) {
  .search-tools {
    padding-top: 7px;
  }
  .search-row {
    gap: 6px;
  }
  .tool-btn {
    padding: 0 6px;
    font-size: 9px;
  }
  .card-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 18px 10px;
  }
  .global-actions {
    gap: 3px;
  }
  .global-actions button {
    padding: 0 6px;
  }
  .global-actions button span,
  .cache-text {
    display: none;
  }
  .global-actions button:nth-child(1) span {
    display: none;
  }
}
</style>
