<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  ArrowLeft,
  ArrowUpDown,
  Copy,
  Pencil,
  Share2,
  Trash2,
  UploadCloud
} from '@lucide/vue';
import { CARD_COLOR_LABELS } from '@/types';
import { store } from '@/store/analysis';
import { navigate } from '@/router/hash';
import { isEditorialAdmin } from '@/tools/sources/auth';
import { readSupabaseConfig } from '@/tools/sources/config';
import CarddexImage from '@/components/carddex/CarddexImage.vue';
import CardEffectText from '@/components/carddex/CardEffectText.vue';
import RuneSeal from '@/components/RuneSeal.vue';
import BuilderModal from '@/components/deckbuilder/BuilderModal.vue';
import DeckEntryView from '@/components/deckbuilder/DeckEntry.vue';
import DeckSortDialog from '@/components/deckbuilder/DeckSortDialog.vue';
import ShareDeck from '@/components/deckbuilder/ShareDeck.vue';
import { useBuilderCatalog } from '@/tools/deckbuilder/catalog';
import { buildHeldIndex, deckHolding } from '@/tools/collection/model';
import { useHeld } from '@/tools/collection/useHeld';
import {
  LABELS,
  LIMITS,
  copyDeck,
  countDeck,
  countZone,
  entryKey,
  fullName,
  hasNeeko,
  kind,
  resolveEntry,
  validateDeck,
  type BuilderDeck,
  type DeckEntry,
  type Zone
} from '@/tools/deckbuilder/model';
import { clearDraft, deleteLocal, readLibrary, saveDraft, saveLocal } from '@/tools/deckbuilder/storage';
import { cloudIdentity, deleteCloud, loadCloud, saveCloud, type CloudDeck } from '@/tools/deckbuilder/cloud';
import { runeColorCounts } from '@/tools/deckbuilder/sheet';
import { deckStats } from '@/tools/deckbuilder/stats';
import {
  DEFAULT_DECK_SORT,
  describeSort,
  loadDeckSort,
  saveDeckSort,
  sortDeckEntries,
  type DeckSortRule
} from '@/tools/deckbuilder/sort';
import type { CardPrint } from '@/components/carddex/types';

const { records, index, icons, loading: catalogLoading } = useBuilderCatalog();

const isCloud = computed(() => store.currentDeckScope === 'cloud');
const deck = ref<BuilderDeck | null>(null);
const cloudRow = ref<CloudDeck | null>(null);
const owner = ref('');
const recovered = ref(false);
const busy = ref(false);
const status = ref('');
const error = ref('');
const tab = ref<'info' | 'stats' | 'checks'>('info');
const graphic = ref(true);
const includeSide = ref(false);
const sortOpen = ref(false);
const showShare = ref(false);
const confirmDelete = ref(false);
const uploaded = ref(false);
const sortRules = ref<DeckSortRule[]>(loadDeckSort());
const inspect = ref<{ zone: Zone; entry: DeckEntry } | null>(null);
const previewPrint = ref<CardPrint | null>(null);

let scope = '';
let baseline = '';
let timer: ReturnType<typeof setTimeout> | undefined;
const message = (reason: unknown): string => (reason instanceof Error ? reason.message : String(reason));

const problems = computed(() => (deck.value ? validateDeck(deck.value, index.value) : []));
const neeko = computed(() => Boolean(deck.value && hasNeeko(deck.value, index.value)));
const runes = computed(() => (deck.value ? runeColorCounts(deck.value, index.value) : []));
const runeTotal = computed(() => (deck.value ? countZone(deck.value, 'rune') : 0));
const total = computed(() => (deck.value ? countDeck(deck.value) : 0));
/* 持有完成度:只在管理员登录后出现,其余情况不改变既有信息。 */
const held = useHeld(records);
const heldReady = computed(() => isEditorialAdmin.value && held.ready.value);
const holding = computed(() => {
  if (!deck.value || !heldReady.value) return null;
  return deckHolding(deck.value, records.value, buildHeldIndex(held.entries.value, records.value));
});
onMounted(() => { void held.load(); });
watch(heldReady, (ready) => { if (ready) void held.load(); });
const stats = computed(() => (deck.value ? deckStats(deck.value, index.value, includeSide.value) : null));
const fingerprint = (value: BuilderDeck): string => JSON.stringify([value.name, value.description]);
const dirty = computed(() =>
  Boolean(deck.value && (!deck.value.savedAt || fingerprint(deck.value) !== baseline))
);

const identity = computed(() => {
  const current = deck.value;
  if (!current) return [];
  return (['legend', 'champion'] as const).map((zone) => {
    const entry = current.zones[zone][0] ?? null;
    return {
      zone,
      label: zone === 'legend' ? '传奇' : '英雄',
      entry,
      resolved: entry ? resolveEntry(entry, index.value) : null
    };
  });
});

const feed = computed(() => {
  const current = deck.value;
  if (!current) return [];
  return (['battlefield', 'main', 'side', 'additional'] as const)
    .map((zone) => ({
      zone,
      label: LABELS[zone],
      count: countZone(current, zone),
      limit: LIMITS[zone],
      entries: sortDeckEntries(current.zones[zone], index.value, sortRules.value)
    }))
    .filter((section) => section.zone !== 'additional' || neeko.value || section.entries.length);
});

const inspectInfo = computed(() => {
  if (!inspect.value) return null;
  const resolved = resolveEntry(inspect.value.entry, index.value);
  const prints = resolved.record?.prints.filter((print) => print.language === 'SC') ?? [];
  return {
    resolved,
    prints: prints.length ? prints : (resolved.record?.prints ?? []),
    preview: previewPrint.value ?? resolved.print
  };
});

const stateLabel = computed(() => {
  if (!deck.value) return '';
  const family = isCloud.value ? '云端卡组' : '本机卡组';
  return `${family} · ${status.value || (dirty.value ? '尚未正式保存' : '已保存')}`;
});

function date(value: string): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
}

async function load(): Promise<void> {
  if (timer) clearTimeout(timer);
  deck.value = null;
  cloudRow.value = null;
  recovered.value = false;
  uploaded.value = false;
  status.value = '';
  error.value = '';
  const id = store.currentDeckId;
  if (!id) {
    navigate({ view: 'builder' }, true);
    return;
  }
  busy.value = true;
  try {
    let saved: BuilderDeck | undefined;
    if (isCloud.value) {
      if (!isEditorialAdmin.value) throw new Error('云端卡组需要管理员账号：请先登录后再打开。');
      owner.value = await cloudIdentity();
      const row = await loadCloud(id, owner.value);
      saved = row.document;
      cloudRow.value = row;
      scope = `cloud:${readSupabaseConfig()?.url}:${owner.value}:${row.id}`;
    } else {
      saved = readLibrary().decks.find((item) => item.id === id);
      scope = `local:${id}`;
    }
    const draft = readLibrary().drafts[scope];
    if (!saved && !draft) throw new Error('找不到这份卡组，可能已经被删除。');
    const source = draft ?? saved;
    deck.value = JSON.parse(JSON.stringify(source)) as BuilderDeck;
    recovered.value = Boolean(draft);
    baseline = fingerprint(deck.value);
  } catch (reason) {
    error.value = message(reason);
  } finally {
    busy.value = false;
  }
}

function persist(): void {
  const current = deck.value;
  if (!current || !scope) return;
  try {
    const hasDraft = Boolean(readLibrary().drafts[scope]);
    if (isCloud.value || hasDraft || !current.savedAt) {
      current.updatedAt = new Date().toISOString();
      saveDraft(current, scope);
      status.value = isCloud.value ? '改动已存为本机草稿，尚未上传云端' : '改动已存为草稿';
      return;
    }
    const next = saveLocal(current);
    deck.value = next;
    baseline = fingerprint(next);
    status.value = '已保存';
  } catch (reason) {
    error.value = message(reason);
  }
}

function flush(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
  if (deck.value && fingerprint(deck.value) !== baseline) persist();
}

function schedulePersist(): void {
  if (timer) clearTimeout(timer);
  status.value = '正在保存…';
  timer = setTimeout(() => {
    timer = undefined;
    persist();
  }, 400);
}

watch(
  () => (deck.value ? fingerprint(deck.value) : ''),
  (value) => {
    if (!deck.value || value === baseline) return;
    schedulePersist();
  }
);

watch(
  [() => store.currentDeckId, () => store.currentDeckScope],
  () => {
    void load();
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  flush();
});

function backToLibrary(): void {
  flush();
  navigate({ view: 'builder' });
}

function editInBuilder(): void {
  flush();
  navigate({
    view: 'builder',
    builderPage: isCloud.value ? 'cloud' : 'edit',
    builderId: store.currentDeckId
  });
}

function duplicate(): void {
  if (!deck.value) return;
  flush();
  const next = copyDeck(deck.value);
  saveDraft(next);
  navigate({ view: 'deck', deckId: next.id, deckScope: 'local' });
}

async function upload(): Promise<void> {
  if (!deck.value) return;
  flush();
  busy.value = true;
  try {
    if (!isEditorialAdmin.value) throw new Error('需要管理员账号才能上传到云端。');
    const who = owner.value || (await cloudIdentity());
    await saveCloud(deck.value, who, null);
    uploaded.value = true;
    status.value = '已保存到云端，可在卡组库的云端页打开';
  } catch (reason) {
    error.value = message(reason);
  } finally {
    busy.value = false;
  }
}

async function remove(): Promise<void> {
  confirmDelete.value = false;
  busy.value = true;
  try {
    if (isCloud.value && cloudRow.value) {
      await deleteCloud(cloudRow.value, owner.value || (await cloudIdentity()));
    } else {
      deleteLocal(store.currentDeckId);
    }
    navigate({ view: 'builder' });
  } catch (reason) {
    error.value = message(reason);
  } finally {
    busy.value = false;
  }
}

function discardDraft(): void {
  if (!scope) return;
  try {
    clearDraft(scope);
    void load();
  } catch (reason) {
    error.value = message(reason);
  }
}

function applySort(next: DeckSortRule[]): void {
  sortRules.value = next.length ? next : DEFAULT_DECK_SORT.map((rule) => ({ ...rule }));
  saveDeckSort(sortRules.value);
  sortOpen.value = false;
}

function openInspect(zone: Zone, entry: DeckEntry): void {
  previewPrint.value = resolveEntry(entry, index.value).print;
  inspect.value = { zone, entry };
}

function colorLabel(color: string): string {
  return CARD_COLOR_LABELS[color as keyof typeof CARD_COLOR_LABELS] ?? color;
}
</script>

<template>
  <div class="deck-detail">
    <div v-if="recovered && deck" class="detail-banner" role="status">
      <span>已恢复上次未正式保存的草稿。</span>
      <button type="button" @click="discardDraft">放弃草稿，回到正式版本</button>
    </div>
    <div class="detail-columns">
      <aside class="detail-rail" aria-label="卡组信息">
        <div class="rail-nav">
          <button type="button" class="rail-back" @click="backToLibrary">
            <ArrowLeft :size="17" /><span>卡组库</span>
          </button>
          <button type="button" class="rail-share" :disabled="!deck" @click="showShare = true">
            <Share2 :size="16" /><span>分享</span>
          </button>
        </div>

        <p v-if="busy && !deck" class="rail-note">正在打开卡组…</p>
        <div v-else-if="error" class="rail-error" role="alert">
          <p>{{ error }}</p>
          <button type="button" @click="backToLibrary">返回卡组库</button>
        </div>
        <template v-else-if="deck">
          <input v-model="deck.name" class="rail-name" aria-label="卡组名称" maxlength="200" placeholder="卡组名称" />
          <p class="rail-meta">
            {{ stateLabel }} · 共 {{ total }} 张
            <span v-if="holding" class="rail-held">持有 {{ holding.owned }} / {{ holding.total }}</span>
          </p>

          <nav class="rail-tabs" role="tablist">
            <button type="button" role="tab" :aria-selected="tab === 'info'" :class="{ active: tab === 'info' }" @click="tab = 'info'">信息</button>
            <button type="button" role="tab" :aria-selected="tab === 'stats'" :class="{ active: tab === 'stats' }" @click="tab = 'stats'">统计</button>
            <button type="button" role="tab" :aria-selected="tab === 'checks'" :class="{ active: tab === 'checks' }" @click="tab = 'checks'">检查</button>
          </nav>

          <div v-if="tab === 'info'" class="rail-panel">
            <label class="rail-label" for="deck-note">说明</label>
            <textarea id="deck-note" v-model="deck.description" aria-label="卡组说明" placeholder="记录思路、测试结果，或赛事来源" />
            <dl class="rail-facts">
              <div><dt>状态</dt><dd>{{ dirty ? '有未保存的改动' : '已保存' }}</dd></div>
              <div><dt>创建</dt><dd>{{ date(deck.createdAt) }}</dd></div>
              <div><dt>最后修改</dt><dd>{{ date(deck.updatedAt) }}</dd></div>
              <div><dt>主牌堆</dt><dd>{{ countZone(deck, 'main') }} / {{ LIMITS.main }}</dd></div>
              <div><dt>构筑问题</dt><dd>{{ problems.length }} 项</dd></div>
            </dl>
          </div>

          <div v-else-if="tab === 'stats'" class="rail-panel">
            <label class="rail-check"><input v-model="includeSide" type="checkbox" />统计包含备牌</label>
            <template v-if="stats">
              <h3>费用曲线</h3>
              <div class="cost-chart">
                <div v-for="[cost, count] in stats.costs" :key="cost" class="cost-column">
                  <span>{{ count }}</span>
                  <i :style="{ height: `${(count / stats.maximum) * 110}px` }" />
                  <b>{{ cost }}</b>
                </div>
                <p v-if="!stats.costs.length" class="rail-note">加入英雄或主牌后显示分布。</p>
              </div>
              <h3>类型</h3>
              <p v-for="[type, count] in stats.types" :key="type" class="stat-row"><span>{{ type }}</span><b>{{ count }} 张</b></p>
              <h3>颜色</h3>
              <p v-for="[color, count] in stats.colors" :key="color" class="stat-row"><span>{{ colorLabel(color) }}</span><b>{{ count }} 张</b></p>
            </template>
            <p v-if="catalogLoading" class="rail-note">正在载入卡表…</p>
          </div>

          <div v-else class="rail-panel">
            <ul v-if="problems.length" class="check-list">
              <li v-for="(problem, i) in problems" :key="i">{{ problem.message }}</li>
            </ul>
            <p v-else class="check-pass">构筑检查通过。<br />允许实验构筑，检查结果不影响保存和分享。</p>
          </div>

          <div class="rail-actions">
            <button type="button" title="在构筑器里编辑" @click="editInBuilder">
              <Pencil :size="17" /><span>编辑</span>
            </button>
            <button type="button" title="复制为新卡组" @click="duplicate">
              <Copy :size="17" /><span>复制</span>
            </button>
            <button
              v-if="!isCloud && isEditorialAdmin"
              type="button"
              :disabled="busy || uploaded"
              title="上传到云端"
              @click="upload"
            >
              <UploadCloud :size="17" /><span>{{ uploaded ? '已上传' : '上传' }}</span>
            </button>
            <button type="button" class="danger" title="删除卡组" @click="confirmDelete = true">
              <Trash2 :size="17" /><span>删除</span>
            </button>
          </div>
          <p v-if="status" class="rail-status" role="status">{{ status }}</p>
        </template>
      </aside>

      <main class="detail-feed" aria-label="卡表">
        <template v-if="deck">
          <div class="feed-toolbar">
            <div class="b-tabs">
              <button type="button" :class="{ active: !graphic }" @click="graphic = false">文字</button>
              <button type="button" :class="{ active: graphic }" @click="graphic = true">卡图</button>
            </div>
            <button type="button" class="sort-btn" @click="sortOpen = true">
              <ArrowUpDown :size="15" /><span>排序 · {{ describeSort(sortRules) }}</span>
            </button>
          </div>

          <section class="identity-strip" aria-label="传奇、英雄与符文">
            <div v-for="slot in identity" :key="slot.zone" class="identity-card">
              <span class="identity-tag">{{ slot.label }}</span>
              <button v-if="slot.entry" type="button" class="identity-art" @click="openInspect(slot.zone, slot.entry)">
                <CarddexImage
                  :src="slot.resolved?.print?.imageUrl || ''"
                  :fallback="slot.resolved?.print?.ttsUrl || ''"
                  :alt="slot.resolved?.name || slot.label"
                />
              </button>
              <div v-else class="identity-art identity-empty">未选择{{ slot.label }}</div>
              <strong :title="slot.resolved?.name">{{ slot.resolved?.name || '—' }}</strong>
            </div>
            <div class="identity-runes">
              <span class="identity-tag">符文 {{ runeTotal }} 张</span>
              <div v-if="runes.length" class="rune-chips">
                <span v-for="rune in runes" :key="rune.color" class="rune-chip" :title="`${rune.label} ${rune.count} 张`">
                  <RuneSeal :only="rune.color" :size="22" /><b>×{{ rune.count }}</b>
                </span>
              </div>
              <p v-else class="rail-note">没有符文</p>
            </div>
          </section>

          <section v-for="section in feed" :key="section.zone" class="detail-section" :data-zone="section.zone">
            <header>
              <h3>{{ section.label }}<small>{{ section.count }} / {{ section.limit }}</small></h3>
            </header>
            <p v-if="!section.entries.length" class="section-empty">暂无卡牌</p>
            <div v-else class="entry-grid" :class="{ graphic, text: !graphic }">
              <DeckEntryView
                v-for="entry in section.entries"
                :key="entryKey(entry)"
                :entry="entry"
                :zone="section.zone"
                :index="index"
                :graphic="graphic"
                readonly
                :additional-enabled="neeko"
                @inspect="openInspect(section.zone, entry)"
              />
            </div>
          </section>
        </template>
        <p v-else-if="busy" class="rail-note">正在载入卡表…</p>
      </main>
    </div>

    <DeckSortDialog v-if="sortOpen" :rules="sortRules" @close="sortOpen = false" @apply="applySort" />
    <ShareDeck v-if="showShare && deck" :deck="deck" :index="index" :problems="problems.length" @close="showShare = false" />
    <BuilderModal v-if="confirmDelete && deck" title="删除卡组" @close="confirmDelete = false">
      <p class="rail-note">确定删除「{{ deck.name }}」{{ isCloud ? '及云端副本' : '及它的草稿' }}？删除后无法恢复。</p>
      <template #footer>
        <button type="button" class="b-btn" @click="confirmDelete = false">取消</button>
        <button type="button" class="b-btn danger" :disabled="busy" @click="remove">{{ busy ? '处理中…' : '确认删除' }}</button>
      </template>
    </BuilderModal>
    <BuilderModal v-if="inspect && inspectInfo" :title="inspectInfo.resolved.name" wide @close="inspect = null">
      <div v-if="inspectInfo.resolved.record" class="card-detail-layout">
        <CarddexImage
          :src="inspectInfo.preview?.imageUrl || ''"
          :fallback="inspectInfo.preview?.ttsUrl || ''"
          :alt="fullName(inspectInfo.resolved.record)"
          :landscape="kind(inspectInfo.resolved.record) === '战场'"
          eager
        />
        <div>
          <p class="rail-note">
            {{ inspectInfo.resolved.record.base.cardNo }} ·
            {{ inspectInfo.resolved.record.base.categories.join(' / ') }} ·
            费用 {{ inspectInfo.resolved.record.base.energy ?? '—' }} ·
            战力 {{ inspectInfo.resolved.record.base.power ?? '—' }}
          </p>
          <CardEffectText :base="inspectInfo.resolved.record.base" :icons="icons" />
          <p v-if="inspectInfo.resolved.record.base.banned" class="rail-error-inline">禁卡：可用于实验构筑，会显示检查提示。</p>
          <h3>简中印版</h3>
          <p class="rail-note">点击印版预览大图。</p>
          <div v-if="inspectInfo.prints.length" class="print-options">
            <button
              v-for="print in inspectInfo.prints"
              :key="print.id"
              type="button"
              class="b-btn"
              :class="{ active: inspectInfo.preview?.id === print.id }"
              @click="previewPrint = print"
            >
              {{ print.cardNo }} · {{ print.language }}
            </button>
          </div>
          <p v-else class="rail-note">暂无可用的简中印版，当前条目已保留。</p>
        </div>
      </div>
      <p v-else class="rail-note">暂时无法在卡表中找到 {{ inspect.entry.cardNo }}，此条目仍保留在卡组里。</p>
    </BuilderModal>
  </div>
</template>

<style scoped>
.deck-detail {
  width: 100%;
  min-width: 0;
  color: var(--color-text-primary);
  background: var(--color-page-bg);
}
.detail-banner {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 9px 20px;
  background: var(--color-brand-soft);
  font-size: 0.9375rem;
}
.detail-banner button {
  color: var(--color-brand);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.detail-columns {
  display: grid;
  grid-template-columns: minmax(0, 320px) minmax(0, 1fr);
  align-items: start;
}
.detail-rail {
  position: sticky;
  top: 0;
  max-height: 100dvh;
  overflow: auto;
  padding: 18px 18px 40px;
  border-right: 1px solid var(--color-panel-border);
  background: var(--color-card-bg);
  scrollbar-width: thin;
}
.rail-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.rail-nav button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 11px;
  border: 1px solid var(--color-panel-border);
  border-radius: 999px;
  background: var(--color-page-bg);
  font-size: 0.875rem;
}
.rail-nav button:hover {
  border-color: var(--color-brand);
  color: var(--color-brand);
}
.rail-nav button:disabled {
  opacity: 0.45;
}
.rail-name {
  width: 100%;
  margin: 16px 0 5px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: 700 24px "Noto Serif SC", serif;
  overflow-wrap: anywhere;
}
.rail-name:focus-visible {
  outline: 2px solid var(--color-brand);
  outline-offset: 3px;
}
.rail-held { display: inline-block; margin-left: 8px; color: var(--color-brand); font-variant-numeric: tabular-nums; }
.rail-meta {
  margin: 0 0 14px;
  color: var(--color-text-muted);
  font-size: 0.8125rem;
}
.rail-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--color-panel-border);
  margin-bottom: 14px;
}
.rail-tabs button {
  flex: 1;
  padding: 8px 6px;
  border-bottom: 2px solid transparent;
  color: var(--color-text-muted);
  font-size: 0.9375rem;
}
.rail-tabs button.active {
  color: var(--color-brand);
  border-bottom-color: var(--color-brand);
}
.rail-panel {
  min-height: 200px;
  font-size: 0.9375rem;
}
.rail-label {
  display: block;
  margin-bottom: 6px;
  color: var(--color-text-muted);
  font-size: 0.8125rem;
}
.rail-panel textarea {
  width: 100%;
  min-height: 112px;
  padding: 9px;
  border: 1px solid var(--color-card-border);
  border-radius: 8px;
  background: var(--color-page-bg);
  color: inherit;
  font: inherit;
  line-height: 1.6;
  resize: vertical;
}
.rail-panel h3 {
  margin: 16px 0 8px;
  font: 700 15px "Noto Serif SC", serif;
}
.rail-check {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--color-text-muted);
  font-size: 0.8125rem;
}
.rail-check input {
  accent-color: var(--color-brand);
}
.rail-facts {
  display: grid;
  gap: 6px;
  margin: 16px 0 0;
}
.rail-facts > div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 5px;
  border-bottom: 1px dashed var(--color-panel-border);
}
.rail-facts dt {
  color: var(--color-text-muted);
}
.rail-facts dd {
  margin: 0;
  text-align: right;
}
.rail-actions {
  display: flex;
  gap: 6px;
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--color-panel-border);
}
.rail-actions button {
  flex: 1;
  display: grid;
  place-items: center;
  gap: 5px;
  padding: 10px 4px;
  border: 1px solid var(--color-panel-border);
  border-radius: 9px;
  background: var(--color-page-bg);
  font-size: 0.8125rem;
}
.rail-actions button:hover {
  border-color: var(--color-brand);
  color: var(--color-brand);
}
.rail-actions button:disabled {
  opacity: 0.45;
}
.rail-actions .danger:hover {
  border-color: #b42318;
  color: #b42318;
}
.b-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 36px;
  padding: 8px 12px;
  border: 1px solid var(--color-panel-border);
  background: var(--color-card-bg);
  color: inherit;
  font-size: 0.9375rem;
  cursor: pointer;
}
.b-btn:hover {
  border-color: var(--color-brand);
  color: var(--color-brand);
}
.b-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.b-btn.danger {
  color: #b42318;
}
.b-btn.danger:hover {
  border-color: #b42318;
}
.rail-status {
  margin-top: 10px;
  color: var(--color-text-muted);
  font-size: 0.8125rem;
}
.rail-note {
  color: var(--color-text-muted);
  font-size: 0.875rem;
  line-height: 1.7;
  margin: 10px 0;
}
.rail-error {
  margin-top: 14px;
  padding: 12px;
  border: 1px solid var(--color-brand);
  border-radius: 8px;
  color: var(--color-brand);
  font-size: 0.9375rem;
}
.rail-error button {
  margin-top: 8px;
  text-decoration: underline;
}
.rail-error-inline {
  color: var(--color-brand);
  font-size: 0.9375rem;
  margin: 10px 0;
}
.cost-chart {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  min-height: 150px;
  padding: 12px 0;
  overflow: auto;
}
.cost-column {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  min-width: 26px;
  font-size: 0.8125rem;
}
.cost-column i {
  display: block;
  width: 24px;
  min-height: 2px;
  background: var(--color-brand);
  border-radius: 2px 2px 0 0;
}
.stat-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin: 7px 0;
  font-size: 0.875rem;
}
.check-list {
  margin: 0;
  padding-left: 18px;
  list-style: disc;
  line-height: 1.75;
}
.check-pass {
  margin-top: 12px;
  color: var(--color-text-muted);
  line-height: 1.8;
}
.detail-feed {
  min-width: 0;
  padding: 20px 26px 72px;
}
.feed-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 16px;
}
.b-tabs {
  display: flex;
  gap: 4px;
}
.b-tabs button {
  padding: 6px 13px;
  border: 1px solid var(--color-panel-border);
  border-radius: 999px;
  background: var(--color-page-bg);
  font-size: 0.875rem;
}
.b-tabs button.active {
  border-color: var(--color-brand);
  background: var(--color-brand);
  color: var(--color-brand-ink);
}
.sort-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border: 1px solid var(--color-panel-border);
  border-radius: 999px;
  color: var(--color-text-muted);
  font-size: 0.8125rem;
}
.sort-btn:hover {
  border-color: var(--color-brand);
  color: var(--color-brand);
}
.identity-strip {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding-bottom: 18px;
  margin-bottom: 20px;
  border-bottom: 2px solid var(--color-panel-border);
}
.identity-card {
  width: 150px;
  display: grid;
  gap: 6px;
  min-width: 0;
}
.identity-tag {
  color: var(--color-brand);
  font-size: 0.75rem;
  letter-spacing: 0.12em;
}
.identity-art {
  display: block;
  border-radius: 9px;
  overflow: hidden;
  background: var(--color-brand-soft);
}
.identity-art:hover {
  outline: 2px solid var(--color-brand);
  outline-offset: -2px;
}
.identity-empty {
  display: grid;
  place-items: center;
  aspect-ratio: 744 / 1040;
  color: var(--color-text-subtle);
  font-size: 0.8125rem;
  border: 1px dashed var(--color-panel-border);
}
.identity-card strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.875rem;
  font-weight: 600;
}
.identity-runes {
  flex: 1;
  min-width: 0;
}
.rune-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}
.rune-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  border: 1px solid var(--color-panel-border);
  border-radius: 999px;
  background: var(--color-card-bg);
}
.rune-chip b {
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
}
.detail-section + .detail-section {
  margin-top: 24px;
}
.detail-section header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding-bottom: 7px;
  margin-bottom: 10px;
  border-bottom: 1px solid var(--color-panel-border);
}
.detail-section h3 {
  font: 700 18px "Noto Serif SC", serif;
}
.detail-section h3 small {
  margin-left: 7px;
  color: var(--color-text-muted);
  font: 500 12px system-ui, sans-serif;
}
.section-empty {
  padding: 10px;
  border: 1px dashed var(--color-panel-border);
  color: var(--color-text-subtle);
  font-size: 0.875rem;
}
.entry-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 112px), 1fr));
  gap: 6px;
  align-items: start;
}
.entry-grid.text {
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 270px), 1fr));
  gap: 4px;
}
.detail-section[data-zone="battlefield"] .entry-grid {
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 176px), 1fr));
}
.detail-section[data-zone="battlefield"] :deep(.deck-entry.graphic .entry-art) {
  aspect-ratio: 1040 / 744;
}
.card-detail-layout {
  display: grid;
  grid-template-columns: minmax(0, 300px) minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}
.print-options {
  display: grid;
  gap: 6px;
  margin: 12px 0;
}
.print-options .b-btn {
  justify-content: flex-start;
  font-size: 0.875rem;
}
.print-options .b-btn.active {
  border-color: var(--color-brand);
  background: var(--color-brand-soft);
  color: var(--color-brand);
}
@media (max-width: 900px) {
  .detail-columns {
    grid-template-columns: minmax(0, 1fr);
  }
  .detail-rail {
    position: static;
    max-height: none;
    overflow: visible;
    padding: 14px 14px 18px;
    border-right: 0;
    border-bottom: 1px solid var(--color-panel-border);
  }
  .rail-panel {
    min-height: 0;
  }
  .detail-feed {
    padding: 16px 12px 56px;
  }
  .identity-card {
    width: 104px;
  }
  .identity-strip {
    flex-wrap: wrap;
    gap: 10px;
  }
  .identity-runes {
    flex-basis: 100%;
  }
  .card-detail-layout {
    grid-template-columns: 1fr;
    gap: 16px;
  }
  .card-detail-layout > :first-child {
    width: 100%;
    max-width: 280px;
    margin: auto;
  }
}
</style>
