<script setup lang="ts">
/**
 * 我的卡池：管理员私有的持有卡台账。
 *
 * 版式沿用卡牌查询（carddex）的做法：左侧无限滚动的卡图墙，右侧常驻筛选列，
 * 顶部一条吸顶工具条。区别是每个格子是「印本 + 语言」，底部带数量步进器，
 * 改动即时上云（乐观更新 + 合并 + 失败重试）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ArrowUpDown, CircleDot, Download, RefreshCw, Search, X } from "@lucide/vue";
import EditorialGate from "@/components/admin/EditorialGate.vue";
import CardDetailModal from "@/components/carddex/CardDetailModal.vue";
import CarddexSortDialog from "@/components/carddex/CarddexSortDialog.vue";
import CollectionFilters from "@/components/collection/CollectionFilters.vue";
import CollectionTile from "@/components/collection/CollectionTile.vue";
import type { ActiveFilter, CarddexLocale, FilterType, SortRule } from "@/components/carddex/types";
import { authState, isEditorialAdmin } from "@/tools/sources/auth";
import { useBuilderCatalog } from "@/tools/deckbuilder/catalog";
import { languageLabel, printVersion } from "@/tools/collection/model";
import {
  activeFilterCount,
  buildCollectionItems,
  collectionAxes,
  collectionFacets,
  type CollectionItem,
} from "@/tools/collection/query";
import {
  DEFAULT_SORT,
  readUi,
  writeUi,
  type CollectionUi,
  type CollectionViewMode,
} from "@/tools/collection/storage";
import { useCollection } from "@/tools/collection/useCollection";

const LOCALE: CarddexLocale = "zh";
const FILTER_LABELS: Record<FilterType, string> = {
  series: "系列",
  category: "类别",
  color: "颜色",
  rarity: "稀有度",
  region: "地区",
  tag: "标签",
  keyword: "关键词",
  advancedTag: "进阶标签",
};

const catalog = useBuilderCatalog();
const collection = useCollection();
const ui = ref<CollectionUi>(readUi());

const searchText = ref("");
const search = ref("");
const sidebarOpen = ref(true);
const drawerOpen = ref(false);
const sortOpen = ref(false);
const stickyTop = ref(104);
const visibleCount = ref(48);
const detailKey = ref<string | null>(null);
const teleportReady = ref(false);
const pageEl = ref<HTMLElement | null>(null);
const sentinel = ref<HTMLElement | null>(null);

const records = computed(() => catalog.records.value);
const facets = computed(() => collectionFacets(records.value));
const axes = computed(() => collectionAxes(records.value));
const items = computed(() =>
  buildCollectionItems(
    records.value,
    {
      search: search.value,
      view: ui.value.view,
      sort: ui.value.sort,
      filters: ui.value.filters,
      numeric: ui.value.numeric,
      languages: ui.value.languages,
      versions: ui.value.versions,
    },
    collection.entries.value,
  ),
);
const visible = computed(() => items.value.slice(0, visibleCount.value));
const filterCount = computed(() =>
  activeFilterCount({
    filters: ui.value.filters,
    languages: ui.value.languages,
    versions: ui.value.versions,
    numeric: ui.value.numeric,
  }),
);
const recordByBaseId = computed(
  () => new Map(records.value.map((record) => [record.base.id, record])),
);
const detailItem = computed(() => items.value.find((item) => item.key === detailKey.value) ?? null);
const detailRecord = computed(() =>
  detailItem.value ? recordByBaseId.value.get(detailItem.value.base.id) ?? null : null,
);

const chips = computed(() => {
  const out: { id: string; label: string; remove: () => void }[] = [];
  for (const code of ui.value.languages) {
    out.push({
      id: `lang:${code}`,
      label: languageLabel(code),
      remove: () => setLanguages(ui.value.languages.filter((v) => v !== code)),
    });
  }
  for (const version of ui.value.versions) {
    out.push({
      id: `ver:${version}`,
      label: version,
      remove: () => setVersions(ui.value.versions.filter((v) => v !== version)),
    });
  }
  for (const filter of ui.value.filters) {
    out.push({
      id: `f:${filter.type}:${filter.value}`,
      label: `${FILTER_LABELS[filter.type]}：${filter.value}${filter.mode === "require" ? "（必须）" : filter.mode === "exclude" ? "（排除）" : ""}`,
      remove: () => removeFilter(filter),
    });
  }
  return out;
});

const syncLabel = computed(() => {
  if (collection.syncing.value) return "正在同步…";
  if (collection.unsavedCount.value) return `${collection.unsavedCount.value} 项待保存`;
  if (!collection.savedAt.value) return "";
  const time = new Date(collection.savedAt.value);
  if (Number.isNaN(time.getTime())) return "";
  return `云端已同步 ${time.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
});

/* ── 持久化 ── */
watch(ui, (value) => writeUi(value), { deep: true });

/* ── 搜索防抖 ── */
let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(searchText, (value) => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    search.value = value.trim();
    visibleCount.value = 48;
  }, 220);
});

watch(
  () => [ui.value.view, ui.value.filters, ui.value.languages, ui.value.versions],
  () => {
    visibleCount.value = 48;
  },
  { deep: true },
);

function setView(view: CollectionViewMode): void {
  ui.value = { ...ui.value, view };
}

function toggleDim(): void {
  ui.value = { ...ui.value, dimUnowned: !ui.value.dimUnowned };
}
function applySort(rules: SortRule[]): void {
  ui.value = {
    ...ui.value,
    sort: rules.length ? rules.map((rule) => ({ ...rule })) : DEFAULT_SORT.map((rule) => ({ ...rule })),
  };
  sortOpen.value = false;
}

function setLanguages(value: string[]): void {
  ui.value = { ...ui.value, languages: value };
}

function setVersions(value: string[]): void {
  ui.value = { ...ui.value, versions: value };
}

function setFilters(value: ActiveFilter[]): void {
  ui.value = { ...ui.value, filters: value };
}

function removeFilter(target: ActiveFilter): void {
  setFilters(ui.value.filters.filter((f) => f !== target));
}

function setSection(id: string, open: boolean): void {
  ui.value = { ...ui.value, sections: { ...ui.value.sections, [id]: open } };
}

function clearFilters(): void {
  ui.value = { ...ui.value, filters: [], languages: [], versions: [] };
}

function toggleFilters(): void {
  if (typeof window !== "undefined" && window.innerWidth < 1024) drawerOpen.value = !drawerOpen.value;
  else sidebarOpen.value = !sidebarOpen.value;
}

function change(item: CollectionItem, delta: number): void {
  if (!item.print) return;
  collection.bump(item.print.cardNo, item.print.language, delta);
}

function openDetail(item: CollectionItem): void {
  detailKey.value = item.key;
}

function openViewer(): void {
  const url = detailItem.value?.print?.imageUrl;
  if (url) window.open(url, "_blank", "noopener");
}

function exportCsv(): void {
  const index = new Map<string, { name: string; series: string; version: string }>();
  for (const record of records.value) {
    const base = { name: record.base.nameCn, series: record.base.series, version: "平卡" };
    index.set(record.base.cardNo.toUpperCase(), base);
    for (const print of record.prints) {
      index.set(print.cardNo.toUpperCase(), { ...base, version: printVersion(print) });
    }
  }
  const rows = [["卡号", "语言", "版本", "名称", "系列", "持有数"]];
  for (const entry of [...collection.entries.value.values()].sort((a, b) =>
    a.cardNo === b.cardNo ? a.language.localeCompare(b.language) : a.cardNo.localeCompare(b.cardNo),
  )) {
    const record = index.get(entry.cardNo.toUpperCase());
    rows.push([
      entry.cardNo,
      entry.language,
      record?.version ?? "",
      record?.name ?? "",
      record?.series ?? "",
      String(entry.quantity),
    ]);
  }
  const csv = rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `riftbound-collection-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

/* ── 吸顶基准 ── */
let observer: ResizeObserver | null = null;
let headerEl: HTMLElement | null = null;

function measureTop(): void {
  headerEl = document.querySelector<HTMLElement>("header.masthead-solid");
  const height = headerEl?.getBoundingClientRect().height;
  stickyTop.value = height && height > 0 ? Math.round(height) : 104;
}

/* ── 无限滚动 ── */
let io: IntersectionObserver | null = null;
watch(sentinel, (element) => {
  io?.disconnect();
  if (!element) return;
  io = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting) && visibleCount.value < items.value.length) {
        visibleCount.value += 48;
      }
    },
    { rootMargin: "500px 0px" },
  );
  io.observe(element);
});

/* ── 挂载 ── */
onMounted(() => {
  measureTop();
  if (headerEl) {
    observer = new ResizeObserver(() => measureTop());
    observer.observe(headerEl);
  }
  window.addEventListener("resize", measureTop);
  void collection.load();
  teleportReady.value = true;
});

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer);
  io?.disconnect();
  observer?.disconnect();
  window.removeEventListener("resize", measureTop);
});

watch(isEditorialAdmin, (admin) => {
  if (admin && collection.phase.value !== "ready") void collection.load();
});

function closeDrawer(): void {
  drawerOpen.value = false;
}
</script>

<template>
  <div v-if="authState.status === 'restoring'" class="collection-state">
    <span class="spinner" aria-hidden="true"></span>
    <p>正在确认管理员身份…</p>
  </div>

  <div v-else-if="!isEditorialAdmin" class="collection-gate">
    <EditorialGate
      title="卡池门禁"
      lead="卡池是管理员私有的持有台账。用管理员账号登入后，就能逐张记录自己有的卡。"
    />
  </div>

  <div v-else ref="pageEl" class="collection-page" :style="{ '--collection-top': `${stickyTop}px` }">
    <Teleport v-if="teleportReady" to="#global-page-actions">
      <div class="head-actions">
        <span v-if="syncLabel" class="sync-label">{{ syncLabel }}</span>
        <button type="button" class="head-btn" title="重新读取云端卡池" @click="collection.load(true)">
          <RefreshCw :size="14" aria-hidden="true" /><span>刷新</span>
        </button>
        <button type="button" class="head-btn" title="导出为 CSV" @click="exportCsv">
          <Download :size="14" aria-hidden="true" /><span>导出 CSV</span>
        </button>
      </div>
    </Teleport>

    <div class="workspace" :class="{ collapsed: !sidebarOpen }">
      <main class="result-column">
        <div class="collection-tools">
          <div class="tools-row">
            <label class="search-box">
              <Search :size="14" aria-hidden="true" />
              <input
                v-model="searchText"
                type="search"
                inputmode="search"
                autocomplete="off"
                aria-label="搜索卡池"
                placeholder="搜索卡名、副标题、印本号或系列"
              />
            </label>

            <span class="result-count">{{ items.length }} 项</span>

            <div class="mode-switch" role="group" aria-label="显示范围">
              <button
                type="button"
                :class="{ active: ui.view === 'owned' }"
                :aria-pressed="ui.view === 'owned'"
                @click="setView('owned')"
              >
                我有的
              </button>
              <button
                type="button"
                :class="{ active: ui.view === 'all' }"
                :aria-pressed="ui.view === 'all'"
                @click="setView('all')"
              >
                全部卡
              </button>
            </div>

            <button
              type="button"
              class="tool-btn"
              aria-haspopup="dialog"
              @click="sortOpen = true"
            >
              <ArrowUpDown :size="13" aria-hidden="true" /> 排序
              <b>{{ ui.sort.length }}</b>
            </button>

            <button
              type="button"
              class="tool-btn dim-btn"
              :class="{ on: ui.dimUnowned }"
              :aria-pressed="ui.dimUnowned"
              :title="ui.dimUnowned ? '取消突出：未持有的卡恢复正常显示' : '突出持有：把未持有的卡转为灰淡'"
              @click="toggleDim"
            >
              <CircleDot :size="13" aria-hidden="true" /><span class="dim-label">突出持有</span>
            </button>

            <button
              type="button"
              class="tool-btn"
              :class="{ on: sidebarOpen || drawerOpen }"
              :aria-expanded="sidebarOpen || drawerOpen"
              @click="toggleFilters"
            >
              筛选<b v-if="filterCount">{{ filterCount }}</b>
            </button>
          </div>

          <div v-if="chips.length" class="active-strip">
            <button
              v-for="chip in chips"
              :key="chip.id"
              type="button"
              class="active-chip"
              :title="`移除 ${chip.label}`"
              @click="chip.remove()"
            >
              {{ chip.label }}<X :size="11" aria-hidden="true" />
            </button>
            <button type="button" class="active-clear" @click="clearFilters">清空</button>
          </div>

          <div v-if="collection.error.value" class="sync-bar" role="alert">
            <span>{{ collection.error.value }}</span>
            <button type="button" @click="collection.retry()">重试</button>
          </div>
        </div>

        <div v-if="collection.phase.value === 'loading' && !items.length" class="collection-state">
          <span class="spinner" aria-hidden="true"></span>
          <p>正在读取卡池…</p>
        </div>

        <div v-else-if="collection.phase.value === 'error'" class="collection-state error">
          <p>{{ collection.error.value || "卡池读取失败。" }}</p>
          <button type="button" class="solid-btn" @click="collection.load(true)">重试</button>
        </div>

        <div v-else-if="!items.length" class="collection-state">
          <template v-if="filterCount || search">
            <p>没有符合条件的印本。</p>
            <button type="button" class="solid-btn" @click="clearFilters(); searchText = ''; search = ''">
              清空筛选
            </button>
          </template>
          <template v-else>
            <p>卡池还是空的。</p>
            <button type="button" class="solid-btn" @click="setView('all')">切到全部卡</button>
          </template>
        </div>

        <template v-else>
          <div class="collection-grid">
            <CollectionTile
              v-for="item in visible"
              :key="item.key"
              :item="item"
              :dim="ui.dimUnowned && item.quantity < 1"
              @open="openDetail(item)"
              @change="(delta) => change(item, delta)"
            />
          </div>
          <div ref="sentinel" class="sentinel">
            <span v-if="visibleCount < items.length">···</span>
            <span v-else>已经到底</span>
          </div>
        </template>
      </main>

      <CollectionFilters
        v-if="sidebarOpen"
        :languages="axes.languages"
        :versions="axes.versions"
        :options="facets.options"
        :active-languages="ui.languages"
        :active-versions="ui.versions"
        :filters="ui.filters"
        :sections="ui.sections"
        @languages="setLanguages"
        @versions="setVersions"
        @filters="setFilters"
        @section="setSection"
        @clear="clearFilters"
      />
    </div>

    <Teleport to="body">
      <div v-if="drawerOpen" class="drawer-backdrop" role="presentation" @click.self="closeDrawer">
        <section class="filter-drawer" role="dialog" aria-modal="true" aria-label="筛选">
          <header>
            <strong>筛选</strong>
            <button type="button" aria-label="关闭筛选" @click="closeDrawer"><X :size="16" /></button>
          </header>
          <div class="drawer-body">
            <CollectionFilters
              :languages="axes.languages"
              :versions="axes.versions"
              :options="facets.options"
              :active-languages="ui.languages"
              :active-versions="ui.versions"
              :filters="ui.filters"
              :sections="ui.sections"
              @languages="setLanguages"
              @versions="setVersions"
              @filters="setFilters"
              @section="setSection"
              @clear="clearFilters"
            />
          </div>
          <footer>
            <button type="button" class="solid-btn" @click="closeDrawer">查看 {{ items.length }} 项</button>
          </footer>
        </section>
      </div>
    </Teleport>

    <CarddexSortDialog
      :open="sortOpen"
      :locale="LOCALE"
      :rules="ui.sort"
      @close="sortOpen = false"
      @apply="applySort"
    />
    <CardDetailModal
      v-if="detailItem && detailRecord"
      :item="detailItem"
      :record="detailRecord"
      :locale="LOCALE"
      :icons="[]"
      :qa="[]"
      :is-pinned="() => false"
      :can-prev="false"
      :can-next="false"
      :show-pin="false"
      @close="detailKey = null"
      @viewer="openViewer"
    />
  </div>
</template>

<style scoped>
.collection-page {
  width: 100%;
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.sync-label {
  color: var(--color-text-subtle);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.head-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--color-card-border);
  border-radius: 6px;
  background: var(--color-card-bg);
  color: var(--color-text-muted);
  font-size: 10px;
  cursor: pointer;
}

.head-btn:hover {
  border-color: var(--color-brand);
  color: var(--color-brand);
}

.workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr) clamp(300px, 30%, 420px);
  gap: 22px;
  align-items: start;
}

.workspace.collapsed {
  grid-template-columns: minmax(0, 1fr);
}

.result-column {
  min-width: 0;
}

.collection-tools {
  position: sticky;
  top: var(--collection-top);
  z-index: 30;
  padding: 0 0 12px;
  background: color-mix(in srgb, var(--color-page-bg) 93%, transparent);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--color-row-line);
}

.tools-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding-bottom: 10px;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1 1 220px;
  max-width: 420px;
  height: 38px;
  padding: 0 10px;
  border: 1px solid var(--color-card-border);
  border-radius: 8px;
  background: var(--color-card-bg);
  color: var(--color-brand);
}

.search-box input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--color-text-primary);
  font-size: 12px;
  outline: none;
}

.search-box input::placeholder {
  color: var(--color-text-subtle);
}

.result-count {
  color: var(--color-text-subtle);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.mode-switch {
  display: inline-flex;
  height: 38px;
}

.mode-switch button {
  height: 38px;
  padding: 0 12px;
  border: 1px solid var(--color-card-border);
  background: var(--color-card-bg);
  color: var(--color-text-muted);
  font-size: 11px;
  cursor: pointer;
}

.mode-switch button:first-child {
  border-radius: 8px 0 0 8px;
}

.mode-switch button:last-child {
  border-radius: 0 8px 8px 0;
  border-left: 0;
}

.mode-switch button.active {
  background: var(--color-brand);
  border-color: var(--color-brand);
  color: var(--color-brand-ink);
}

.tool-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 38px;
  padding: 0 10px;
  border: 1px solid var(--color-card-border);
  border-radius: 8px;
  background: var(--color-card-bg);
  color: var(--color-text-muted);
  font-size: 11px;
  cursor: pointer;
}

.tool-btn:hover,
.tool-btn.on {
  border-color: var(--color-brand);
}

.dim-btn.on {
  border-color: var(--color-brand);
  background: var(--color-brand-soft);
  color: var(--color-brand);
}

.tool-btn b {
  display: inline-grid;
  place-items: center;
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--color-brand-soft);
  color: var(--color-brand);
  font-size: 9px;
  font-variant-numeric: tabular-nums;
}

.active-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-bottom: 10px;
}

.active-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 7px;
  border: 1px solid var(--color-card-border);
  border-radius: 999px;
  background: var(--color-card-bg);
  color: var(--color-text-muted);
  font-size: 10px;
  cursor: pointer;
}

.active-chip:hover {
  border-color: var(--color-brand);
  color: var(--color-brand);
}

.active-clear {
  border: 0;
  background: transparent;
  color: var(--color-text-subtle);
  font-size: 10px;
  cursor: pointer;
}

.active-clear:hover {
  color: var(--color-brand);
}

.sync-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 32px;
  padding: 5px 10px;
  border: 1px solid var(--color-brand);
  border-radius: 6px;
  background: var(--color-brand-soft);
  color: var(--color-brand);
  font-size: 11px;
}

.sync-bar button {
  border: 1px solid currentColor;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font-size: 10px;
  padding: 2px 8px;
  cursor: pointer;
}

.collection-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(118px, 1fr));
  gap: 22px 14px;
  padding-top: 14px;
}

.sentinel {
  display: grid;
  place-items: center;
  min-height: 70px;
  color: var(--color-text-subtle);
  font-size: 11px;
}

.collection-state {
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 12px;
  min-height: 380px;
  color: var(--color-text-muted);
  font-size: 12px;
  text-align: center;
}

.collection-state.error {
  color: var(--color-brand);
}

.spinner {
  width: 24px;
  height: 24px;
  border: 1px solid var(--color-card-border);
  border-top-color: var(--color-brand);
  border-radius: 50%;
  animation: spin 900ms linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.solid-btn {
  padding: 7px 14px;
  border: 1px solid var(--color-brand);
  border-radius: 6px;
  background: var(--color-brand);
  color: var(--color-brand-ink);
  font-size: 11px;
  cursor: pointer;
}

.collection-gate {
  max-width: 820px;
  margin: 0 auto;
}

.drawer-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: rgba(44, 44, 44, 0.28);
  display: flex;
  justify-content: flex-end;
}

.filter-drawer {
  display: flex;
  flex-direction: column;
  width: min(360px, 92vw);
  height: 100%;
  background: var(--color-page-bg);
  border-left: 1px solid var(--color-panel-border);
}

.filter-drawer > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--color-row-line);
}

.filter-drawer > header strong {
  font-family: var(--font-display);
  font-size: 13px;
  letter-spacing: 0.08em;
}

.filter-drawer > header button {
  border: 0;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
}

.drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 0 16px 16px;
}

.filter-drawer > footer {
  padding: 10px 16px;
  border-top: 1px solid var(--color-row-line);
}

.filter-drawer > footer .solid-btn {
  width: 100%;
  height: 38px;
}

@media (min-width: 1500px) {
  .collection-grid {
    grid-template-columns: repeat(auto-fill, minmax(138px, 1fr));
  }
}

@media (max-width: 1023px) {
  .workspace {
    grid-template-columns: minmax(0, 1fr);
  }

  .search-box {
    max-width: none;
    flex-basis: 100%;
  }
}

@media (max-width: 600px) {
  .collection-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 18px 10px;
  }

  .tools-row {
    gap: 6px;
  }

  .dim-label {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation: none;
  }
}
</style>
