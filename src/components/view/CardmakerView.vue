<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  ArrowLeft,
  Download,
  FolderOpen,
  ImagePlus,
  Layers,
  Paintbrush,
  Plus,
  Redo2,
  Search,
  SlidersHorizontal,
  Type,
  Undo2,
  Upload,
} from '@lucide/vue';
import MakerCanvas from '@/components/cardmaker/MakerCanvas.vue';
import MakerFields from '@/components/cardmaker/MakerFields.vue';
import MakerLayers from '@/components/cardmaker/MakerLayers.vue';
import BuilderModal from '@/components/deckbuilder/BuilderModal.vue';
import { navigate } from '@/router/hash';
import { useBuilderCatalog } from '@/tools/deckbuilder/catalog';
import type { CardPrint, CardRecord } from '@/components/carddex/types';
import {
  clone,
  dimensions,
  documentFromCard,
  imageLayer,
  newDocument,
  parseDocument,
  parseProject,
  TYPES,
  uid,
  type CardType,
  type ImageAsset,
  type ImageLayer,
  type MakerDocument,
  type MakerProject,
} from '@/tools/cardmaker/model';
import { cardArt, download, fileName, loadImage, rasterAsset } from '@/tools/cardmaker/assets';
import { projectAssets } from '@/tools/cardmaker/render';
import {
  currentWork,
  deleteWork,
  listWorks,
  loadWork,
  saveWork,
  type SavedWork,
} from '@/tools/cardmaker/storage';
import { takeMakerSource } from '@/tools/cardmaker/entry';

const catalog = useBuilderCatalog(),
  document = ref(newDocument()),
  assets = ref<ImageAsset[]>([]);
const canvas = ref<InstanceType<typeof MakerCanvas>>(),
  fileInput = ref<HTMLInputElement>(),
  jsonInput = ref<HTMLInputElement>();
const selected = ref(''),
  tab = ref('text'),
  ready = ref(false),
  overflow = ref(false),
  initializing = ref(true);
const busy = ref(false),
  error = ref(''),
  message = ref(''),
  status = ref('正在打开作品库…');
const previewExpanded = ref(false),
  viewportHeight = ref(window.visualViewport?.height ?? window.innerHeight);
let previewSelection = '';
function togglePreview(): void {
  if (previewExpanded.value) {
    previewExpanded.value = false;
    selected.value = document.value.layers.some((l) => l.id === previewSelection)
      ? previewSelection
      : '';
  } else {
    previewSelection = selected.value;
    selected.value = '';
    previewExpanded.value = true;
  }
}
function viewport(): void {
  viewportHeight.value = window.visualViewport?.height ?? window.innerHeight;
  if (window.innerWidth > 700 && previewExpanded.value) togglePreview();
}
const modal = ref<'' | 'new' | 'cards' | 'library' | 'export' | 'delete'>('');
const query = ref(''),
  selectedCard = ref<CardRecord>(),
  selectedPrintId = ref(''),
  works = ref<SavedWork[]>([]),
  deleteId = ref('');
const renameId = ref(''),
  renameTitle = ref(''),
  exportScale = ref(2);
const copies = computed(() => document.value.copy[document.value.language]);
const title = computed(() => copies.value.name || document.value.title || '未命名作品');
const size = computed(() => dimensions(document.value.type));
const canvasAssets = computed(() => projectAssets(document.value, assets.value));
const searchResults = computed(() => {
  const q = query.value.trim().toLowerCase();
  return catalog.records.value
    .filter(
      (r) => !q || `${r.base.nameCn} ${r.base.nameEn} ${r.base.cardNo}`.toLowerCase().includes(q),
    )
    .slice(0, 80);
});
const selectedPrints = computed(
  () => selectedCard.value?.prints.filter((p) => ['SC', 'EN'].includes(p.language)) ?? [],
);
const selectedPrint = computed(
  () =>
    selectedPrints.value.find((p) => p.id === selectedPrintId.value) ??
    selectedPrints.value.find((p) => p.language === 'SC') ??
    selectedPrints.value[0],
);
const history = ref<MakerDocument[]>([]),
  historyIndex = ref(0);
const pendingHistory = ref(false);
let previousOverflow: string | undefined;
watch(modal, (value) => {
  if (value && previousOverflow === undefined) {
    previousOverflow = globalThis.document.body.style.overflow;
    globalThis.document.body.style.overflow = 'hidden';
  } else if (!value && previousOverflow !== undefined) {
    globalThis.document.body.style.overflow = previousOverflow;
    previousOverflow = undefined;
  }
});
let snapshotTimer: ReturnType<typeof setTimeout> | undefined,
  saveTimer: ReturnType<typeof setTimeout> | undefined,
  messageTimer: ReturnType<typeof setTimeout> | undefined;
let suppress = false,
  editVersion = 0,
  sourceRequest = 0;
let ephemeralId = '';
let writes: Promise<void> = Promise.resolve();
const thumbs = new Map<string, string>();
function flash(text: string): void {
  message.value = text;
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => {
    message.value = '';
  }, 4000);
}
function fail(value: unknown): void {
  error.value = value instanceof Error ? value.message : String(value);
}
function pushHistory(): void {
  clearTimeout(snapshotTimer);
  snapshotTimer = undefined;
  pendingHistory.value = false;
  const snapshot = clone(document.value),
    previous = history.value[historyIndex.value];
  if (
    previous &&
    JSON.stringify({ ...previous, updatedAt: '' }) ===
      JSON.stringify({ ...snapshot, updatedAt: '' })
  )
    return;
  history.value = history.value.slice(0, historyIndex.value + 1);
  history.value.push(snapshot);
  if (history.value.length > 60) history.value.shift();
  historyIndex.value = history.value.length - 1;
}
function changed(): void {
  if (suppress || initializing.value) return;
  ephemeralId = '';
  editVersion++;
  status.value = '待保存…';
  error.value = '';
  clearTimeout(snapshotTimer);
  pendingHistory.value = true;
  snapshotTimer = setTimeout(pushHistory, 450);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void persist().catch(fail);
  }, 800);
}
watch(document, changed, { deep: true, flush: 'sync' });
watch(
  () => document.value.copy.zh.name || document.value.copy.en.name,
  (name) => {
    if (name && document.value.title === '未命名作品') document.value.title = name.slice(0, 200);
  },
);
async function persist(): Promise<void> {
  clearTimeout(saveTimer);
  const version = editVersion;
  if (document.value.id === ephemeralId) {
    status.value = '空白作品';
    return;
  }
  const d = parseDocument(clone(document.value));
  d.updatedAt = new Date().toISOString();
  const images = projectAssets(d, assets.value).map((asset) => ({ ...asset }));
  let thumbnail = thumbs.get(d.id) ?? '';
  if (ready.value && canvas.value) {
    try {
      thumbnail = canvas.value.canvas(0.25).toDataURL('image/webp', 0.7);
    } catch {
      /* retain last available thumbnail */
    }
  }
  const work = { d, images, thumbnail };
  status.value = '保存中…';
  const write = saveWork(work.d, work.images, work.thumbnail);
  writes = write;
  try {
    await write;
    thumbs.set(d.id, thumbnail);
    if (document.value.id === d.id && version === editVersion) status.value = '已保存到本机';
  } catch (e) {
    if (document.value.id === d.id) status.value = '保存失败';
    throw e;
  }
}
async function replaceDocument(
  d: MakerDocument,
  images: ImageAsset[],
  savePrevious = true,
  saveNew = true,
): Promise<void> {
  if (savePrevious && !initializing.value) await persist();
  clearTimeout(snapshotTimer);
  pendingHistory.value = false;
  clearTimeout(saveTimer);
  sourceRequest++;
  suppress = true;
  assets.value = images;
  document.value = d;
  selected.value = d.layers[d.layers.length - 1]?.id ?? '';
  history.value = [clone(d)];
  historyIndex.value = 0;
  editVersion++;
  ephemeralId = saveNew ? '' : d.id;
  suppress = false;
  error.value = '';
  status.value = '待保存…';
  modal.value = '';
  await nextTick();
  await persist();
}
function travel(direction: number): void {
  pushHistory();
  const index = historyIndex.value + direction;
  if (index < 0 || index >= history.value.length) return;
  suppress = true;
  document.value = clone(history.value[index]!);
  historyIndex.value = index;
  suppress = false;
  if (!document.value.layers.some((l) => l.id === selected.value)) selected.value = '';
  changed();
}
async function makeNew(type: CardType): Promise<void> {
  busy.value = true;
  try {
    await replaceDocument(newDocument(type), []);
    tab.value = 'text';
  } catch (e) {
    fail(e);
  } finally {
    busy.value = false;
  }
}
function transform(id: string, patch: Partial<ImageLayer>): void {
  const l = document.value.layers.find((l) => l.id === id);
  if (l && !l.locked) {
    pushHistory();
    Object.assign(l, patch);
    pushHistory();
  }
}
function duplicateLayer(id: string): void {
  const l = document.value.layers.find((l) => l.id === id);
  if (!l || document.value.layers.length >= 30) return;
  pushHistory();
  const copy = {
    ...clone(l),
    id: uid(),
    name: `${l.name} 副本`.slice(0, 200),
    x: l.x + 12,
    y: l.y + 12,
    locked: false,
  };
  document.value.layers.push(copy);
  selected.value = copy.id;
  pushHistory();
}
function removeLayer(id: string): void {
  pushHistory();
  document.value.layers = document.value.layers.filter((l) => l.id !== id);
  selected.value = document.value.layers.at(-1)?.id ?? '';
  pushHistory();
}
async function upload(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement,
    files = [...(input.files ?? [])];
  input.value = '';
  if (!files.length) return;
  busy.value = true;
  error.value = '';
  pushHistory();
  const id = document.value.id;
  try {
    for (const file of files) {
      if (document.value.layers.length >= 30) {
        flash('最多添加 30 个图层。');
        break;
      }
      const asset = await rasterAsset(file, file.name);
      if (document.value.id !== id) return;
      assets.value.push(asset);
      const layer = imageLayer(asset, document.value.type);
      document.value.layers.push(layer);
      selected.value = layer.id;
    }
    tab.value = 'images';
    pushHistory();
    await persist();
  } catch (e) {
    fail(e);
  } finally {
    busy.value = false;
  }
}
function chooseCard(record: CardRecord): void {
  selectedCard.value = record;
  selectedPrintId.value = record.prints.find((p) => p.language === 'SC')?.id ?? '';
}
async function fromCard(record: CardRecord, print?: CardPrint | null): Promise<void> {
  busy.value = true;
  try {
    const d = documentFromCard(record, print);
    await replaceDocument(d, []);
    tab.value = 'text';
    const request = ++sourceRequest,
      url = print?.imageUrl || print?.ttsUrl;
    if (url) {
      try {
        const asset = await cardArt(url, d.type);
        if (request !== sourceRequest || document.value.id !== d.id) return;
        assets.value.push(asset);
        const layer = imageLayer(asset, d.type);
        document.value.layers.push(layer);
        selected.value = layer.id;
        pushHistory();
        await persist();
      } catch {
        flash('文字已载入。卡图暂时无法读取，请上传配图。');
      }
    } else flash('文字已载入，可自行上传配图。');
  } catch (e) {
    fail(e);
  } finally {
    busy.value = false;
  }
}
async function openLibrary(): Promise<void> {
  try {
    await persist();
    works.value = await listWorks();
    works.value.forEach((w) => thumbs.set(w.document.id, w.thumbnail));
    modal.value = 'library';
  } catch (e) {
    fail(e);
  }
}
async function openWork(id: string): Promise<void> {
  busy.value = true;
  try {
    const work = await loadWork(id);
    if (!work) throw new Error('作品不存在。');
    thumbs.set(id, work.thumbnail);
    await replaceDocument(work.document, work.assets);
  } catch (e) {
    fail(e);
  } finally {
    busy.value = false;
  }
}
async function copyWork(id: string): Promise<void> {
  busy.value = true;
  try {
    const work = await loadWork(id);
    if (!work) throw new Error('作品不存在。');
    work.document.id = uid();
    work.document.title = `${work.document.title} 副本`.slice(0, 200);
    thumbs.set(work.document.id, work.thumbnail);
    await replaceDocument(work.document, work.assets);
    flash('已复制为独立作品。');
  } catch (e) {
    fail(e);
  } finally {
    busy.value = false;
  }
}
async function renameWork(): Promise<void> {
  try {
    const work = await loadWork(renameId.value);
    if (!work) return;
    work.document.title = (renameTitle.value.trim() || '未命名作品').slice(0, 200);
    work.document.updatedAt = new Date().toISOString();
    if (document.value.id === renameId.value) document.value.title = work.document.title;
    else await saveWork(work.document, work.assets, thumbs.get(renameId.value) ?? '');
    renameId.value = '';
    await persist();
    works.value = await listWorks();
  } catch (e) {
    fail(e);
  }
}
async function removeWork(): Promise<void> {
  busy.value = true;
  try {
    const id = deleteId.value;
    if (document.value.id === id) {
      const next = (await listWorks()).find((w) => w.document.id !== id);
      const work = next ? await loadWork(next.document.id) : null;
      if (work) thumbs.set(work.document.id, work.thumbnail);
      await replaceDocument(work?.document ?? newDocument(), work?.assets ?? [], true, !!work);
    }
    await writes.catch(() => undefined);
    await deleteWork(id);
    works.value = await listWorks();
    modal.value = 'library';
    flash('作品已删除。');
  } catch (e) {
    fail(e);
  } finally {
    busy.value = false;
  }
}
async function importProject(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0];
  input.value = '';
  if (!file) return;
  busy.value = true;
  error.value = '';
  try {
    if (file.size > 90 * 1024 * 1024) throw new Error('项目文件超过 90 MB。');
    const project = parseProject(await file.text()),
      ids = new Map<string, string>();
    for (const a of project.assets) {
      const image = await loadImage(a.data);
      if (image.naturalWidth > 6000 || image.naturalHeight > 6000 || !image.naturalWidth)
        throw new Error('项目图片尺寸超出范围。');
      a.width = image.naturalWidth;
      a.height = image.naturalHeight;
      const id = uid();
      ids.set(a.id, id);
      a.id = id;
    }
    project.document.id = uid();
    project.document.layers.forEach((l) => {
      l.id = uid();
      l.assetId = ids.get(l.assetId)!;
    });
    await replaceDocument(project.document, project.assets);
    flash('项目与图片已导入。');
  } catch (e) {
    fail(e);
  } finally {
    busy.value = false;
  }
}
async function exportJson(): Promise<void> {
  try {
    const d = parseDocument(clone(document.value)),
      project: MakerProject = {
        format: 'rune-cardmaker',
        version: 1,
        document: d,
        assets: clone(projectAssets(d, assets.value)),
      };
    download(
      new Blob([JSON.stringify(project)], { type: 'application/json' }),
      `${fileName(title.value)}.cardmaker.json`,
    );
    await persist();
    flash('JSON 项目已导出，包含所有配图。');
  } catch (e) {
    fail(e);
  }
}
async function exportPng(): Promise<void> {
  busy.value = true;
  error.value = '';
  try {
    parseDocument(document.value);
    if (!ready.value || !canvas.value) throw new Error('卡框、字体和图片仍在加载，请稍后再导出。');
    const output = canvas.value.canvas(exportScale.value),
      blob = await new Promise<Blob>((resolve, reject) =>
        output.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG 导出失败。'))), 'image/png'),
      );
    download(blob, `${fileName(title.value)}-${document.value.language}.png`);
    modal.value = '';
    flash('PNG 已导出。');
    await persist();
  } catch (e) {
    fail(e);
  } finally {
    busy.value = false;
  }
}
function keyboard(e: KeyboardEvent): void {
  if (
    modal.value ||
    !(e.ctrlKey || e.metaKey) ||
    (e.target instanceof HTMLElement && e.target.closest('input,textarea,select,[contenteditable]'))
  )
    return;
  if (e.key.toLowerCase() === 'z') {
    e.preventDefault();
    travel(e.shiftKey ? 1 : -1);
  }
  if (e.key.toLowerCase() === 'y') {
    e.preventDefault();
    travel(1);
  }
  if (e.key.toLowerCase() === 's') {
    e.preventDefault();
    void persist().catch(fail);
  }
}
function visibility(): void {
  if (globalThis.document.hidden && !initializing.value) void persist().catch(fail);
}
function canvasReady(value: boolean): void {
  ready.value = value;
  if (value && !initializing.value && !ephemeralId) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void persist().catch(fail);
    }, 800);
  }
}
onMounted(async () => {
  window.visualViewport?.addEventListener('resize', viewport);
  window.addEventListener('resize', viewport);
  window.addEventListener('keydown', keyboard);
  globalThis.document.addEventListener('visibilitychange', visibility);
  const source = takeMakerSource();
  try {
    ephemeralId = document.value.id;
    if (!source) {
      const id = await currentWork();
      const work = id ? await loadWork(id) : null;
      if (work) {
        suppress = true;
        document.value = work.document;
        assets.value = work.assets;
        thumbs.set(work.document.id, work.thumbnail);
        ephemeralId = '';
        suppress = false;
      }
    }
    history.value = [clone(document.value)];
    historyIndex.value = 0;
    initializing.value = false;
    status.value = '已保存到本机';
    if (source) await fromCard(source.record, source.print);
    else await persist();
  } catch (e) {
    initializing.value = false;
    status.value = '本机保存不可用';
    fail(e);
    history.value = [clone(document.value)];
  }
});
onBeforeUnmount(() => {
  window.visualViewport?.removeEventListener('resize', viewport);
  window.removeEventListener('resize', viewport);
  window.removeEventListener('keydown', keyboard);
  globalThis.document.removeEventListener('visibilitychange', visibility);
  clearTimeout(snapshotTimer);
  clearTimeout(saveTimer);
  clearTimeout(messageTimer);
  if (previousOverflow !== undefined) globalThis.document.body.style.overflow = previousOverflow;
  if (!initializing.value) void persist().catch(() => undefined);
  sourceRequest++;
});
</script>
<template>
  <section
    class="cardmaker"
    :class="{ 'expanded-preview': previewExpanded, 'compact-preview': viewportHeight < 540 }"
    :style="{ '--maker-screen-height': `${viewportHeight}px` }"
    :aria-busy="busy || initializing"
  >
    <header class="maker-toolbar">
      <button
        type="button"
        class="maker-back"
        aria-label="返回首页"
        @click="navigate({ view: 'home' })"
      >
        <ArrowLeft :size="18" />
      </button>
      <div class="maker-brand">
        <Paintbrush :size="20" />
        <div>
          <h1>卡牌工坊</h1>
          <span>CARD WORKSHOP</span>
        </div>
      </div>
      <div class="maker-work-name">
        <input
          v-model="document.title"
          :disabled="initializing"
          maxlength="200"
          aria-label="作品名称"
        /><span role="status">{{ status }}</span>
      </div>
      <div class="maker-history">
        <button
          type="button"
          aria-label="撤销"
          title="撤销 Ctrl+Z"
          :disabled="historyIndex === 0 && !pendingHistory"
          @click="travel(-1)"
        >
          <Undo2 :size="18" /></button
        ><button
          type="button"
          aria-label="重做"
          title="重做 Ctrl+Shift+Z"
          :disabled="historyIndex >= history.length - 1"
          @click="travel(1)"
        >
          <Redo2 :size="18" />
        </button>
      </div>
      <div class="maker-main-actions">
        <button type="button" :disabled="busy || initializing" @click="modal = 'new'">
          <Plus :size="16" /><span>新建</span></button
        ><button
          type="button"
          :disabled="busy || initializing"
          @click="
            selectedCard = undefined;
            query = '';
            modal = 'cards';
          "
        >
          <Search :size="16" /><span>从卡库载入</span></button
        ><button type="button" :disabled="busy || initializing" @click="openLibrary">
          <FolderOpen :size="16" /><span>作品库</span></button
        ><button
          type="button"
          class="maker-export"
          :disabled="busy || initializing"
          @click="modal = 'export'"
        >
          <Download :size="16" /><span>导出</span>
        </button>
      </div>
    </header>
    <div v-if="error" class="maker-notice error" role="alert">
      <span>{{ error }}</span
      ><button type="button" @click="error = ''" aria-label="关闭提示">×</button>
    </div>
    <div v-if="message" class="maker-notice" role="status">{{ message }}</div>
    <div class="maker-workspace">
      <aside class="maker-edit" aria-label="编辑面板">
        <nav class="maker-tabs" aria-label="编辑分类">
          <button
            v-for="item in [
              { id: 'text', label: '文字', icon: Type },
              { id: 'stats', label: '数值', icon: SlidersHorizontal },
              { id: 'images', label: '图片', icon: ImagePlus },
              { id: 'layers', label: '图层', icon: Layers },
            ]"
            :key="item.id"
            type="button"
            :class="{ active: tab === item.id }"
            :aria-pressed="tab === item.id"
            @click="tab = item.id"
          >
            <component :is="item.icon" :size="16" />{{ item.label }}
          </button>
        </nav>
        <div v-if="initializing" class="maker-edit-scroll" role="status">正在打开草稿…</div>
        <div v-else class="maker-edit-scroll">
          <MakerFields
            v-if="tab === 'text' || tab === 'stats'"
            :document="document"
            :tab="tab"
            :icons="catalog.icons.value"
          /><MakerLayers
            v-else
            :document="document"
            :assets="assets"
            :selected="selected"
            :mode="tab === 'layers' ? 'layers' : 'images'"
            @select="selected = $event"
            @upload="fileInput?.click()"
            @duplicate="duplicateLayer"
            @remove="removeLayer"
          />
        </div>
      </aside>
      <div class="maker-preview">
        <div class="maker-preview-meta">
          <span
            >{{ TYPES[document.type] }} ·
            {{ document.language === 'zh' ? '简体中文' : 'ENGLISH' }}</span
          ><span>{{ size.width }} × {{ size.height }}</span>
        </div>
        <MakerCanvas
          ref="canvas"
          :document="document"
          :assets="canvasAssets"
          :selected="selected"
          :icons="catalog.icons.value"
          :read-only="previewExpanded"
          @select="selected = $event"
          @transform="transform"
          @ready="canvasReady"
          @error="fail"
          @overflow="overflow = $event"
        />
        <div class="maker-preview-footer">
          <span v-if="overflow" class="maker-overflow"
            >效果文字超出卡框，请缩小字号或精简文字。</span
          ><span v-else-if="document.source"
            >改编自 {{ document.source }} · 配图取自卡图可见区域</span
          ><span v-else>点击配图选择图层 · 修改即时预览</span
          ><button
            type="button"
            class="maker-expand-preview"
            :aria-expanded="previewExpanded"
            @click="togglePreview"
          >
            {{ previewExpanded ? '返回编辑' : '放大预览' }}</button
          ><button type="button" :disabled="busy || initializing" @click="fileInput?.click()">
            <ImagePlus :size="14" />添加图片
          </button>
        </div>
      </div>
      <aside v-if="!initializing" class="maker-layer-sidebar" aria-label="图层面板">
        <MakerLayers
          :document="document"
          :assets="assets"
          :selected="selected"
          mode="layers"
          compact
          @select="
            selected = $event;
            tab = 'images';
          "
          @upload="fileInput?.click()"
          @duplicate="duplicateLayer"
          @remove="removeLayer"
        />
      </aside>
    </div>
    <input
      ref="fileInput"
      class="maker-file"
      type="file"
      accept="image/png,image/jpeg,image/webp,image/gif"
      multiple
      @change="upload"
    />
    <input
      ref="jsonInput"
      class="maker-file"
      type="file"
      accept=".json,application/json"
      @change="importProject"
    />
    <BuilderModal v-if="modal === 'new'" title="新建卡牌" @close="modal = ''"
      ><p class="mk-hint">选择一个空白模板。当前作品会自动保存在本机。</p>
      <div class="mk-template-grid">
        <button
          v-for="(label, type) in TYPES"
          :key="type"
          type="button"
          :disabled="busy"
          @click="makeNew(type)"
        >
          <span class="mk-template-mini" :class="{ landscape: type === 'battlefield' }"
            ><Paintbrush :size="24" /></span
          ><strong>{{ label }}</strong
          ><small>{{ type === 'battlefield' ? '横版 · 1040 × 745' : '竖版 · 745 × 1040' }}</small>
        </button>
      </div>
      <div class="mk-import">
        <button type="button" :disabled="busy" @click="jsonInput?.click()">
          <Upload :size="16" />导入 JSON 项目
        </button>
      </div>
      <p v-if="error" role="alert" class="b-error">{{ error }}</p></BuilderModal
    >
    <BuilderModal v-if="modal === 'cards'" title="从卡库载入" wide @close="modal = ''"
      ><input
        v-model="query"
        class="mk-search"
        autofocus
        aria-label="搜索卡牌名称或编号"
        placeholder="搜索中文名、英文名或卡牌编号"
      />
      <p class="mk-hint">
        {{ catalog.sourceNote.value }} · 选择卡牌和印版，文字与数值会成为独立作品。
      </p>
      <div v-if="selectedCard" class="mk-card-choice">
        <div>
          <strong>{{ selectedCard.base.nameCn || selectedCard.base.nameEn }}</strong
          ><select v-model="selectedPrintId" aria-label="卡牌印版">
            <option v-for="p in selectedPrints" :key="p.id" :value="p.id">
              {{ p.cardNo }} · {{ p.language === 'SC' ? '中文' : '英文'
              }}{{ p.isDefault ? ' · 默认' : '' }}
            </option>
          </select>
        </div>
        <button
          type="button"
          class="b-btn b-primary"
          :disabled="busy"
          @click="fromCard(selectedCard, selectedPrint)"
        >
          {{ busy ? '载入中…' : '以此卡制作' }}
        </button>
      </div>
      <div class="mk-card-grid">
        <button
          v-for="r in searchResults"
          :key="r.base.id"
          type="button"
          :class="{ active: selectedCard?.base.id === r.base.id }"
          @click="chooseCard(r)"
        >
          <img
            :src="r.prints.find((p) => p.language === 'SC')?.imageUrl || r.prints[0]?.imageUrl"
            loading="lazy"
            alt=""
          /><strong>{{ r.base.nameCn || r.base.nameEn }}</strong
          ><small>{{ r.base.cardNo }}</small>
        </button>
      </div>
      <p v-if="!searchResults.length" class="mk-hint">
        {{ catalog.loading.value ? '正在读取卡表…' : '没有匹配的卡牌。' }}
      </p>
      <p v-if="error" role="alert" class="b-error">{{ error }}</p></BuilderModal
    >
    <BuilderModal v-if="modal === 'library'" title="本机作品库" wide @close="modal = ''"
      ><div class="mk-library-toolbar">
        <p class="mk-hint">{{ works.length }} 件作品 · 自动保存到当前浏览器，JSON 可备份或转移。</p>
        <button type="button" class="b-btn" :disabled="busy" @click="jsonInput?.click()">
          <Upload :size="16" />导入 JSON
        </button>
      </div>
      <div v-if="renameId" class="mk-rename">
        <input v-model="renameTitle" aria-label="新的作品名称" maxlength="200" /><button
          type="button"
          class="b-btn"
          @click="renameWork"
        >
          保存名称</button
        ><button type="button" class="b-btn" @click="renameId = ''">取消</button>
      </div>
      <div class="mk-work-grid">
        <article v-for="w in works" :key="w.document.id">
          <button
            type="button"
            class="mk-open-work"
            :disabled="busy"
            @click="openWork(w.document.id)"
          >
            <div>
              <img v-if="w.thumbnail" :src="w.thumbnail" alt="" /><Paintbrush v-else :size="40" />
            </div>
            <strong>{{ w.document.title }}</strong
            ><small>{{ new Date(w.document.updatedAt).toLocaleString('zh-CN') }}</small>
          </button>
          <div class="mk-work-actions">
            <button type="button" :disabled="busy" @click="copyWork(w.document.id)">复制</button
            ><button
              type="button"
              @click="
                renameId = w.document.id;
                renameTitle = w.document.title;
              "
            >
              改名</button
            ><button
              type="button"
              @click="
                deleteId = w.document.id;
                modal = 'delete';
              "
            >
              删除
            </button>
          </div>
        </article>
      </div>
      <p v-if="!works.length" class="mk-hint">还没有作品，从一个空白模板开始吧。</p>
      <p v-if="error" role="alert" class="b-error">{{ error }}</p></BuilderModal
    >
    <BuilderModal v-if="modal === 'delete'" title="删除作品" @close="modal = 'library'"
      ><p class="mk-hint">
        确定删除「{{
          works.find((w) => w.document.id === deleteId)?.document.title
        }}」？本机删除无法撤销。
      </p>
      <template #footer
        ><button type="button" class="b-btn" @click="modal = 'library'">取消</button
        ><button type="button" class="b-btn b-primary" :disabled="busy" @click="removeWork">
          删除作品
        </button></template
      ></BuilderModal
    >
    <BuilderModal v-if="modal === 'export'" title="导出作品" @close="modal = ''"
      ><div class="mk-export-option">
        <Download :size="26" />
        <div>
          <h3>卡牌图片 · PNG</h3>
          <p>与当前 {{ document.language === 'zh' ? '中文' : '英文' }} 预览一致。</p>
          <select v-model.number="exportScale" aria-label="PNG 分辨率">
            <option :value="2">高清 · {{ size.width * 2 }} × {{ size.height * 2 }}</option>
            <option :value="3">超清 · {{ size.width * 3 }} × {{ size.height * 3 }}</option>
            <option :value="1">原尺寸 · {{ size.width }} × {{ size.height }}</option>
          </select>
          <p v-if="overflow" class="b-error">效果文字超出卡框，建议先调整。</p>
          <button
            type="button"
            class="b-btn b-primary"
            :disabled="busy || !ready"
            @click="exportPng"
          >
            {{ busy ? '正在生成…' : ready ? '下载 PNG' : '等待图片和字体加载…' }}
          </button>
        </div>
      </div>
      <div class="mk-export-option">
        <FolderOpen :size="26" />
        <div>
          <h3>可编辑项目 · JSON</h3>
          <p>保留双语文本、图层和所有配图，可换设备继续编辑。</p>
          <button type="button" class="b-btn" :disabled="busy" @click="exportJson">
            下载 JSON 项目
          </button>
        </div>
      </div>
      <p v-if="error" role="alert" class="b-error">{{ error }}</p></BuilderModal
    >
  </section>
</template>
<style scoped>
.cardmaker {
  --maker-panel: var(--color-page-bg);
  height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--maker-panel);
  color: var(--color-text-primary);
  font-family: Inter, 'Noto Sans SC', sans-serif;
  min-width: 0;
}
.maker-toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 76px;
  padding: 12px 22px;
  border-bottom: 1px solid var(--color-panel-border);
  background: var(--color-card-bg);
  flex-shrink: 0;
}
.maker-toolbar button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 44px;
  padding: 8px 11px;
  font-size: 12px;
  white-space: nowrap;
}
.maker-toolbar button:disabled {
  opacity: 0.4;
}
.maker-back {
  border-right: 1px solid var(--color-panel-border);
  padding-left: 0 !important;
}
.maker-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--color-brand);
  white-space: nowrap;
}
.maker-brand h1 {
  font:
    700 19px 'Noto Serif SC',
    serif;
  color: var(--color-text-primary);
}
.maker-brand span {
  font: 9px monospace;
  letter-spacing: 0.12em;
}
.maker-work-name {
  flex: 1;
  min-width: 100px;
  display: grid;
  gap: 2px;
  margin-left: 10px;
}
.maker-work-name input {
  background: transparent;
  font-size: 14px;
  font-weight: 600;
  width: 100%;
  padding: 3px 0;
  border-bottom: 1px solid transparent;
  min-width: 0;
}
.maker-work-name input:focus {
  border-color: var(--color-brand);
}
.maker-work-name span {
  font-size: 10px;
  color: var(--color-text-muted);
}
.maker-history,
.maker-main-actions {
  display: flex;
  gap: 4px;
}
.maker-main-actions {
  gap: 6px;
}
.maker-main-actions button {
  border: 1px solid var(--color-panel-border);
}
.maker-export {
  background: var(--color-brand) !important;
  border-color: var(--color-brand) !important;
  color: var(--color-brand-ink);
}
.maker-workspace {
  display: grid;
  grid-template-columns: 320px minmax(240px, 1fr) 278px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.maker-edit {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--color-panel-border);
  background: var(--maker-panel);
}
.maker-tabs {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  border-bottom: 1px solid var(--color-panel-border);
  flex-shrink: 0;
}
.maker-tabs button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-height: 49px;
  font-size: 12px;
  border-bottom: 2px solid transparent;
}
.maker-tabs .active {
  color: var(--color-brand);
  border-bottom-color: var(--color-brand);
  background: var(--color-card-bg);
}
.maker-edit-scroll {
  padding: 22px;
  overflow: auto;
  overscroll-behavior: contain;
  min-height: 0;
  flex: 1;
  scrollbar-width: thin;
}
.maker-preview {
  background: #222a30;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  padding: 0 12px;
}
.maker-preview-meta,
.maker-preview-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-shrink: 0;
  color: #a8b2b8;
  min-height: 46px;
  font-size: 10px;
  padding: 8px 6px;
  letter-spacing: 0.025em;
}
.maker-preview-meta {
  font-family: monospace;
  text-transform: uppercase;
}
.maker-preview :deep(.maker-canvas) {
  flex: 1;
}
.maker-preview-footer {
  min-height: 46px;
  font-size: 11px;
  line-height: 1.4;
}
.maker-preview-footer button {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 36px;
  white-space: nowrap;
  color: #e4e8e9;
  padding: 4px 6px;
}
.maker-expand-preview {
  display: none !important;
}
.maker-layer-sidebar {
  padding: 22px 17px;
  overflow: auto;
  overscroll-behavior: contain;
  border-left: 1px solid var(--color-panel-border);
  scrollbar-width: thin;
}
.maker-notice {
  display: flex;
  gap: 12px;
  justify-content: space-between;
  background: var(--color-card-bg);
  border-bottom: 1px solid var(--color-panel-border);
  padding: 9px 22px;
  font-size: 12px;
  flex-shrink: 0;
  line-height: 1.7;
}
.maker-notice.error {
  color: var(--color-brand);
}
.maker-notice button {
  min-width: 32px;
  font-size: 20px;
}
.maker-overflow {
  color: #ffc17e;
}
.maker-file {
  display: none;
}
.mk-hint {
  font-size: 13px;
  line-height: 1.8;
  color: var(--color-text-muted);
  margin-bottom: 14px;
}
.mk-template-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}
.mk-template-grid > button {
  border: 1px solid var(--color-panel-border);
  padding: 20px 10px;
  display: grid;
  justify-items: center;
  gap: 10px;
}
.mk-template-grid > button:hover {
  border-color: var(--color-brand);
}
.mk-template-mini {
  width: 54px;
  height: 74px;
  border: 2px solid #26303a;
  background: #e4dac0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #26303a;
  box-shadow: inset 0 -18px #26303a;
}
.mk-template-mini.landscape {
  width: 74px;
  height: 54px;
  margin-block: 10px;
}
.mk-template-grid strong {
  font-size: 15px;
}
.mk-template-grid small {
  font-size: 10px;
  color: var(--color-text-muted);
}
.mk-import {
  margin-top: 24px;
  display: flex;
  justify-content: center;
}
.mk-import button {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  font-size: 13px;
}
.mk-search {
  width: 100%;
  min-height: 46px;
  margin-bottom: 12px;
}
.mk-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(105px, 1fr));
  gap: 12px;
}
.mk-card-grid > button {
  display: grid;
  gap: 5px;
  padding: 6px;
  border: 1px solid var(--color-panel-border);
  text-align: left;
}
.mk-card-grid > button.active {
  border: 2px solid var(--color-brand);
  padding: 5px;
}
.mk-card-grid img {
  aspect-ratio: 745/1040;
  object-fit: contain;
  width: 100%;
  background: #ddd4c0;
}
.mk-card-grid strong {
  font-size: 12px;
}
.mk-card-grid small {
  font-size: 10px;
  color: var(--color-text-muted);
}
.mk-card-choice {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  background: var(--color-card-bg);
  padding: 12px;
  border: 1px solid var(--color-panel-border);
  margin-bottom: 15px;
}
.mk-card-choice > div {
  display: grid;
  gap: 8px;
  flex: 1;
  min-width: 0;
}
.mk-card-choice select {
  width: 100%;
}
.mk-library-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: start;
  gap: 12px;
}
.mk-library-toolbar button {
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.mk-work-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 16px;
}
.mk-work-grid article {
  border: 1px solid var(--color-panel-border);
  min-width: 0;
}
.mk-open-work {
  width: 100%;
  display: grid;
  text-align: left;
  gap: 8px;
  padding: 10px;
}
.mk-open-work > div {
  height: 185px;
  background: #273039;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #d6d0b9;
}
.mk-open-work img {
  max-height: 165px;
  max-width: 100%;
  object-fit: contain;
}
.mk-open-work strong {
  font-size: 13px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.mk-open-work small {
  font-size: 10px;
  color: var(--color-text-muted);
}
.mk-work-actions {
  display: flex;
  border-top: 1px solid var(--color-panel-border);
}
.mk-work-actions button {
  flex: 1;
  min-height: 44px;
  font-size: 12px;
}
.mk-rename {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}
.mk-rename input {
  min-width: 0;
  flex: 1;
}
.mk-export-option {
  display: flex;
  gap: 16px;
  padding-block: 18px;
}
.mk-export-option + div {
  border-top: 1px solid var(--color-panel-border);
}
.mk-export-option > div {
  flex: 1;
  min-width: 0;
}
.mk-export-option h3 {
  font-size: 16px;
  font-weight: 700;
  margin-bottom: 8px;
}
.mk-export-option p {
  font-size: 13px;
  line-height: 1.8;
  color: var(--color-text-muted);
  margin: 10px 0;
}
.mk-export-option select {
  width: 100%;
  margin-bottom: 16px;
}
.mk-export-option button {
  min-height: 44px;
}
.cardmaker button:focus-visible,
.cardmaker input:focus-visible {
  outline: 2px solid var(--color-brand);
  outline-offset: 2px;
}
@media (min-width: 1700px) {
  .maker-workspace {
    grid-template-columns: 360px minmax(240px, 1fr) 310px;
  }
  .maker-edit-scroll {
    padding: 26px;
  }
}
@media (max-width: 1100px) {
  .maker-workspace {
    grid-template-columns: 310px minmax(240px, 1fr);
  }
  .maker-layer-sidebar {
    display: none;
  }
  .maker-toolbar {
    gap: 8px;
    padding-inline: 16px;
  }
  .maker-main-actions button {
    padding-inline: 8px;
  }
  .maker-work-name {
    margin-left: 0;
  }
  .maker-brand span {
    display: none;
  }
}
@media (max-width: 700px) {
  .cardmaker {
    height: var(--maker-screen-height, 100dvh);
    min-height: 0;
    overflow: hidden;
  }
  .maker-toolbar {
    display: grid;
    grid-template-columns: 30px 1fr auto;
    gap: 5px 8px;
    padding: 8px 12px;
    min-height: auto;
  }
  .maker-back {
    grid-row: 1;
    grid-column: 1;
    padding: 0 !important;
    border: 0;
  }
  .maker-brand {
    grid-column: 2;
    gap: 7px;
  }
  .maker-brand h1 {
    font-size: 17px;
  }
  .maker-brand > svg {
    width: 17px;
  }
  .maker-history {
    grid-column: 3;
  }
  .maker-history button {
    min-height: 36px;
    padding: 7px;
  }
  .maker-work-name {
    grid-row: 2;
    grid-column: 1/-1;
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .maker-work-name input {
    font-size: 16px;
    flex: 1;
    min-width: 0;
  }
  .maker-work-name span {
    white-space: nowrap;
    font-size: 10px;
  }
  .maker-main-actions {
    grid-row: 3;
    grid-column: 1/-1;
    display: grid;
    grid-template-columns: 0.8fr 1.4fr 1fr 0.8fr;
    gap: 5px;
  }
  .maker-main-actions button {
    font-size: 11px;
    padding: 6px 4px;
    min-height: 40px;
  }
  .maker-main-actions svg {
    width: 14px;
  }
  .maker-workspace {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    flex: 1;
    min-height: 0;
  }
  .maker-preview {
    order: 0;
    height: calc(var(--maker-screen-height, 100dvh) * 0.4);
    min-height: 190px;
    padding: 0 8px;
    flex-shrink: 0;
  }
  .maker-preview-meta {
    min-height: 30px;
    padding: 6px;
    font-size: 9px;
  }
  .maker-preview-footer {
    min-height: 36px;
    font-size: 9px;
    padding: 2px 6px;
  }
  .maker-preview-footer button {
    font-size: 10px;
    min-height: 32px;
  }
  .maker-edit {
    order: 1;
    min-height: 0;
    border-right: 0;
    flex: 1;
  }
  .maker-tabs {
    position: sticky;
    top: 0;
    z-index: 5;
    background: var(--color-page-bg);
  }
  .maker-tabs button {
    min-height: 48px;
    font-size: 12px;
    gap: 6px;
  }
  .maker-edit-scroll {
    overflow: auto;
    padding: 18px 18px calc(26px + env(safe-area-inset-bottom));
    min-height: 0;
  }
  .maker-notice {
    padding: 8px 14px;
    font-size: 11px;
  }
  .mk-template-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
  }
  .mk-template-grid > button {
    padding: 18px 8px;
  }
  .mk-card-choice {
    gap: 8px;
  }
  .mk-card-choice strong {
    font-size: 13px;
  }
  .mk-card-choice button {
    font-size: 12px;
  }
  .mk-work-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
  .mk-library-toolbar {
    flex-wrap: wrap;
  }
  .mk-open-work > div {
    height: 170px;
  }
  .mk-rename {
    flex-wrap: wrap;
  }
  .maker-expand-preview {
    display: flex !important;
  }
  .maker-preview-footer > span {
    flex: 1;
    min-width: 0;
  }
  .expanded-preview .maker-preview {
    flex: 1;
    height: auto;
    min-height: 0;
  }
  .expanded-preview .maker-edit {
    display: none;
  }
  .compact-preview:not(.expanded-preview) .maker-preview {
    height: 120px;
    min-height: 120px;
  }
  .compact-preview .maker-preview-meta {
    display: none;
  }
}
</style>
