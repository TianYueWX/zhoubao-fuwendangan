<script setup lang="ts">
/** 官网卡表（playriftbound.com）同步的逐条审核面板（独立于小程序同步）。 */
import { computed, nextTick, ref, watch } from 'vue';
import { applyReviewOperation, type ExistingSnapshot } from '@/tools/admin/sync';
import { touchVersions, type VersionCategory } from '@/tools/sources/rest';
import { errorText, notifyError, notifyOk, notifyWarn } from '@/tools/admin/notice';
import { downloadText } from '@/tools/sync/exporters';
import {
  buildGalleryOperation,
  createGalleryReview,
  galleryBaseCandidates,
  galleryState,
  type GalleryReviewRow
} from '@/tools/sync/galleryReview';
import type { GalleryDataset } from '@/tools/sync/galleryRun';
import {
  ARRAY_FIELDS,
  BOOL_FIELDS,
  NUMBER_FIELDS,
  reviewCsv,
  reviewSql,
  type ReviewOperation,
  type ReviewState,
  type Values
} from '@/tools/sync/review';
import { indexExisting, type ReviewIndex } from '@/tools/sync/reviewIndex';

const props = defineProps<{
  dataset: GalleryDataset;
  existing: ExistingSnapshot;
  loading: boolean;
  /** 韩/繁中列尚未迁移时只允许提交 en/zh 文本 */
  localizedColumnsReady: boolean;
}>();
const emit = defineEmits<{ reload: []; busy: [value: boolean] }>();

const readOnly = computed(() => props.dataset.readOnly);
const rows = ref<GalleryReviewRow[]>(createGalleryReview(props.dataset));
const snapshot = ref(props.existing);
const snapshotRevision = ref(0);
const tab = ref<'card_prints' | 'cards_base'>('card_prints');
const search = ref('');
const statusFilter = ref('pending');
const page = ref(1);
const editorKey = ref('');
const editorPanel = ref<HTMLElement | null>(null);
const busy = ref(false);
const progress = ref('');
const publish = ref(true);
const errors = ref<Record<string, string>>({});
const inputErrors = ref<Record<string, string>>({});

const stages: { table: 'card_prints' | 'cards_base'; label: string }[] = [
  { table: 'card_prints', label: '印刷版本' },
  { table: 'cards_base', label: '基础卡' }
];

const labels: Record<string, string> = {
  card_no: '基础编号', card_name_en: '英文名', sub_title_en: '英文副标题', effect_en: '英文效果',
  card_name_cn: '中文名', sub_title_cn: '中文副标题', effect_cn: '中文效果',
  card_name_kr: '韩文名', sub_title_kr: '韩文副标题', effect_kr: '韩文效果',
  card_name_tw: '繁中名', sub_title_tw: '繁中副标题', effect_tw: '繁中效果',
  card_no_extend: '印刷编号', language: '语言', card_id: '关联基础卡 ID', rarity_name: '稀有度',
  extend_rarity_name: '扩展稀有度', img_cdn: '卡图', artist: '画师', series: '系列',
  series_name: '系列', energy: '费用', card_category: '类别', is_promo: '促销版本'
};

/** 只读语区仍可比较，但不能提交；韩/繁中列未迁移时对应文本也按只读处理。 */
const textWritable = computed(() => {
  if (readOnly.value) return false;
  const target = props.dataset.option.target;
  if ((target === 'kr' || target === 'tw') && !props.localizedColumnsReady) return false;
  return true;
});

const existingIndex = computed(() => {
  void snapshotRevision.value;
  return indexExisting(snapshot.value);
});
const draftRows = computed(() => new Map(rows.value.map((r) => [r.key, r])));
const index = computed<ReviewIndex>(() => ({
  ...existingIndex.value,
  rows: draftRows.value as never,
  baseCounts: new Map(),
  printCounts: new Map()
}));
const state = (r: GalleryReviewRow): ReviewState => galleryState(r, rows.value, snapshot.value, index.value);

const tableRows = computed(() => rows.value.filter((r) => r.table === tab.value));
const filtered = computed(() => tableRows.value.filter((r) => {
  const s = state(r);
  const statusOk =
    statusFilter.value === 'all' ||
    (statusFilter.value === 'pending' ? s.kind !== 'same' : s.kind === statusFilter.value);
  const q = search.value.trim().toLowerCase();
  const hay = `${r.label} ${r.draft.card_name_en ?? ''} ${r.draft.card_name_cn ?? ''} ${r.draft.card_name_kr ?? ''} ${r.draft.card_name_tw ?? ''} ${r.draft.card_no_extend ?? ''}`.toLowerCase();
  return statusOk && (!q || hay.includes(q));
}));
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / 30)));
const visibleRows = computed(() => filtered.value.slice((page.value - 1) * 30, page.value * 30));
const active = computed(() => (editorKey.value ? draftRows.value.get(editorKey.value) : undefined));
const activeState = computed(() => (active.value ? state(active.value) : null));
const activeCandidates = computed(() =>
  active.value?.table === 'card_prints' ? galleryBaseCandidates(active.value, snapshot.value, index.value) : []
);
const editorFields = computed(() => activeState.value?.fields.filter((f) => f !== 'card_id') ?? []);
const stageCounts = computed(() => {
  const counts: Record<string, number> = { card_prints: 0, cards_base: 0 };
  for (const row of rows.value) if (state(row).kind !== 'same') counts[row.table] = (counts[row.table] ?? 0) + 1;
  return counts;
});
const readyCount = computed(() => tableRows.value.filter((r) => r.included && ready(r)).length);
const submitDisabled = computed(() => readOnly.value || props.loading || busy.value);
const rowName = (r: GalleryReviewRow): string => {
  const target = r.target;
  const name = r.draft[`card_name_${target}`];
  if (name) return String(name);
  return String(r.draft.card_name_en ?? r.draft.card_name_cn ?? r.draft.card_name_kr ?? r.draft.card_name_tw ?? '');
};

watch([tab, search, statusFilter], () => { page.value = 1; });
watch(pageCount, (count) => { page.value = Math.min(page.value, count); });
watch(() => props.existing, (ex) => {
  snapshot.value = ex;
  for (const row of rows.value) row.selected = [];
});
watch(() => props.dataset, (ds) => {
  rows.value = createGalleryReview(ds);
  editorKey.value = '';
  errors.value = {};
  inputErrors.value = {};
});
watch(busy, (value) => emit('busy', value));

function show(v: unknown): string {
  if (v == null || v === '') return '∅';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}
function inputValue(v: unknown): string {
  return v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
}
function inputKey(row: GalleryReviewRow, field: string): string {
  return `${row.key}:${field}`;
}
function setField(row: GalleryReviewRow, field: string, event: Event): void {
  const raw = (event.target as HTMLInputElement).value;
  const key = inputKey(row, field);
  try {
    let value: unknown = raw || null;
    if (ARRAY_FIELDS.includes(field)) {
      value = raw.trim() ? JSON.parse(raw) : [];
      if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) throw new Error('请输入字符串 JSON 数组，如 ["法术"]');
    } else if (NUMBER_FIELDS.includes(field)) {
      value = raw.trim() ? Number(raw) : null;
      if (value !== null && !Number.isInteger(value)) throw new Error('请输入整数或留空');
    }
    row.draft[field] = value;
    delete inputErrors.value[key];
    delete errors.value[row.key];
  } catch (e) {
    inputErrors.value[key] = errorText(e);
  }
}
function rowInputError(row: GalleryReviewRow): string {
  return Object.entries(inputErrors.value).find(([k]) => k.startsWith(`${row.key}:`))?.[1] ?? '';
}
function operation(row: GalleryReviewRow): ReviewOperation | null {
  const error = rowInputError(row);
  if (error) throw new Error(error);
  return buildGalleryOperation(row, rows.value, snapshot.value, index.value);
}
function ready(row: GalleryReviewRow): boolean {
  if (!textWritable.value && row.table === 'cards_base') return false;
  try {
    return !!operation(row);
  } catch {
    return false;
  }
}
function submissionError(row: GalleryReviewRow): string {
  if (!textWritable.value && row.table === 'cards_base') {
    return readOnly.value ? '该语区只支持预览，不写库' : '请先执行韩/繁中列迁移 SQL';
  }
  try {
    operation(row);
    return '';
  } catch (e) {
    return errorText(e);
  }
}
const statusName = (r: GalleryReviewRow): string => ({
  new: '新增', update: '待更新', same: '无变更', blocked: '待处理'
})[state(r).kind];

async function openEditor(row: GalleryReviewRow): Promise<void> {
  editorKey.value = row.key;
  await nextTick();
  editorPanel.value?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function acceptResult(row: GalleryReviewRow, result: Values): void {
  const ex = snapshot.value;
  const list = (row.table === 'cards_base' ? ex.cards : ex.prints) as unknown as Values[];
  const at = list.findIndex((r) => r.id === result.id);
  if (at >= 0) list[at] = result;
  else list.push(result);
  snapshotRevision.value++;
  if (row.table === 'cards_base') row.chosenBaseId = String(result.id);
  row.selected = [];
  delete errors.value[row.key];
}

async function submit(single?: GalleryReviewRow): Promise<void> {
  if (submitDisabled.value) return;
  const selectedRows = single ? [single] : tableRows.value.filter((r) => r.included && ready(r));
  if (!selectedRows.length) return;
  busy.value = true;
  let done = 0;
  const categories = new Set<VersionCategory>();
  try {
    for (const row of selectedRows) {
      try {
        const op = operation(row);
        if (!op) continue;
        progress.value = `${done + 1} / ${selectedRows.length} · ${row.label}`;
        const result = await applyReviewOperation(op);
        acceptResult(row, result);
        categories.add(row.table === 'cards_base' ? 'cards' : 'prints');
        done++;
      } catch (e) {
        errors.value[row.key] = errorText(e);
        notifyError(`已成功 ${done} 条；${row.label} 提交失败`, errorText(e));
        break;
      }
    }
    if (publish.value && categories.size) {
      const results = await touchVersions([...categories]);
      const failed = results.filter((r) => !r.ok);
      if (failed.length) notifyWarn('数据已写入，部分分类发布失败', failed.map((r) => r.error).join('；'));
    }
    if (done) notifyOk(`已提交 ${done} 条`, '其他阶段需由你分别点击提交');
  } catch (e) {
    notifyError('提交后的发布失败', errorText(e));
  } finally {
    busy.value = false;
    progress.value = '';
  }
}

function exportReviewed(format: 'sql' | 'csv'): void {
  const selectedRows = tableRows.value.filter((r) => r.included && ready(r));
  try {
    const ops = selectedRows.map(operation).filter((o): o is ReviewOperation => o !== null);
    if (!ops.length) {
      notifyWarn('当前阶段没有可导出的已选操作');
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    if (format === 'sql') downloadText(`${tab.value}-${stamp}.sql`, reviewSql(ops, { publish: publish.value }), 'application/sql');
    else {
      for (const kind of ['insert', 'update'] as const) {
        if (ops.some((o) => o.kind === kind)) {
          downloadText(`${tab.value}-${kind === 'insert' ? 'insert' : 'update-patches'}-${stamp}.csv`, reviewCsv(ops, kind), 'text/csv');
        }
      }
    }
    notifyOk(`已导出当前阶段 ${ops.length} 条操作`);
  } catch (e) {
    notifyError('导出失败', errorText(e));
  }
}

function hasUnsavedReview(): boolean {
  return rows.value.some((row) => state(row).kind !== 'same');
}

defineExpose({ hasUnsavedReview });
</script>

<template>
  <section class="mb-10">
    <div class="flex justify-between gap-4 items-start mb-4">
      <div>
        <h2 class="font-display text-xl font-bold">逐条审核官网卡表差异</h2>
        <p class="text-xs text-ink-muted mt-2">
          更新字段默认不勾选；星号/SP/超编号印刷会回找原作基础卡，多个候选时需手选。
          <span v-if="readOnly" class="text-accent">当前语区只支持预览，不能写库。</span>
          <span v-else-if="dataset.option.target === 'kr' || dataset.option.target === 'tw'" class="text-ink-faint">
            韩/繁中文本仅在库内已有对应列时才能提交。
          </span>
        </p>
      </div>
      <button class="btn-ghost px-3 py-2 text-xs" :disabled="busy || loading" @click="emit('reload')">
        {{ loading ? '读取中…' : '重读库内现状' }}
      </button>
    </div>
    <fieldset :disabled="busy || loading" class="min-w-0">
      <div class="flex gap-2 flex-wrap mb-4">
        <button v-for="stage in stages" :key="stage.table" class="btn-ghost px-3 py-2 text-xs"
          :class="tab === stage.table ? 'tab-active' : ''" @click="tab = stage.table">
          {{ stage.label }} · {{ stageCounts[stage.table] }}
        </button>
      </div>
      <div class="flex gap-3 flex-wrap mb-4">
        <input v-model="search" aria-label="搜索卡号或卡名" class="filter-select min-w-[230px]" placeholder="搜索卡号、名字" />
        <select v-model="statusFilter" aria-label="筛选状态" class="filter-select">
          <option value="pending">全部待处理</option><option value="new">新增</option><option value="update">更新</option>
          <option value="blocked">需要处理</option><option value="all">全部（含无变更）</option>
        </select>
        <span class="text-xs text-ink-faint self-center">{{ filtered.length }} 条 · 当前阶段可提交 {{ readyCount }} 条</span>
      </div>
      <div v-if="!readOnly" class="flex gap-4 flex-wrap text-xs mb-3">
        <button class="text-brand hover:underline" @click="tableRows.forEach(r => r.included = false)">清空本阶段批量选择</button>
        <button class="text-brand hover:underline" @click="filtered.forEach(r => r.included = true)">包含当前筛选结果</button>
        <span class="text-ink-faint">仅选择记录，不会勾选更新字段。</span>
      </div>
      <div class="border border-card-border rounded-xl overflow-x-auto">
        <table class="w-full text-xs">
          <thead class="text-left text-ink-faint bg-panel-bg"><tr>
            <th class="p-3">批量包含</th><th class="p-3">状态</th><th class="p-3">卡牌 / 记录</th><th class="p-3">差异 / 等待原因</th><th class="p-3">操作</th>
          </tr></thead>
          <tbody>
            <tr v-for="row in visibleRows" :key="row.key" class="border-t border-card-border align-top">
              <td class="p-3"><input v-model="row.included" type="checkbox" :disabled="readOnly" :aria-label="`批量包含 ${row.label}`" /></td>
              <td class="p-3 whitespace-nowrap">{{ statusName(row) }}</td>
              <td class="p-3">
                <span class="font-mono">{{ row.label }}</span>
                <p v-if="row.table === 'cards_base'" class="mt-1">{{ rowName(row) }} {{ row.draft[`sub_title_${row.target}`] }}</p>
              </td>
              <td class="p-3 max-w-[420px] break-words">
                <span v-if="state(row).reason" class="text-accent">{{ state(row).reason }}</span>
                <span v-else-if="state(row).kind === 'update'">{{ state(row).changed.map(f => labels[f] ?? f).join('、') }} · 已勾选 {{ state(row).changed.filter(f => row.selected.includes(f)).length }} 项</span>
                <span v-else>{{ state(row).kind === 'new' ? '审核后可单独 Insert' : '无可同步差异' }}</span>
                <p v-if="errors[row.key]" class="mt-1 text-delta-down">{{ errors[row.key] }}</p>
              </td>
              <td class="p-3 whitespace-nowrap"><button class="text-brand hover:underline" @click="openEditor(row)">查看 / 编辑</button></td>
            </tr>
            <tr v-if="!visibleRows.length"><td colspan="5" class="p-8 text-center text-ink-faint">没有符合条件的记录</td></tr>
          </tbody>
        </table>
      </div>
      <div class="flex gap-4 justify-end items-center mt-3 text-xs">
        <button class="btn-ghost px-3 py-1" :disabled="page <= 1" @click="page--">上一页</button>
        <span>{{ page }} / {{ pageCount }}</span>
        <button class="btn-ghost px-3 py-1" :disabled="page >= pageCount" @click="page++">下一页</button>
      </div>

      <div v-if="active && activeState" ref="editorPanel" class="card p-4 sm:p-6 mt-5 scroll-mt-20" data-testid="gallery-editor">
        <div class="flex justify-between items-start gap-4">
          <h3 class="text-lg font-bold">{{ active.label }} <span class="text-xs font-normal text-ink-faint">· {{ statusName(active) }}</span></h3>
          <button class="btn-ghost px-3 py-1 text-xs" @click="editorKey = ''">收起</button>
        </div>

        <div v-if="active.table === 'card_prints'" class="my-4 p-3 border border-card-border rounded-lg text-xs">
          <p>关联基础卡：{{ active.baseCardNo }}</p>
          <label v-if="activeCandidates.length > 1" class="block mt-2">有多个同名候选，请选择关联记录
            <select v-model="active.chosenBaseId" class="filter-select w-full mt-2" @change="active.selected = []">
              <option value="">请选择，不会自动选择</option>
              <option v-for="candidate in activeCandidates" :key="String(candidate.id)" :value="candidate.id">
                {{ candidate.card_no }} · {{ candidate.card_name_en }} {{ candidate.sub_title_en }} · {{ candidate.id }}
              </option>
            </select>
          </label>
          <p v-else-if="activeCandidates.length === 1" class="mt-2 font-mono">
            {{ activeCandidates[0]?.card_no }} · {{ activeCandidates[0]?.id }}
          </p>
          <p v-else class="mt-2 text-accent">库内没有可直接关联的基础卡，请先创建或人工确认。</p>
        </div>

        <p v-if="submissionError(active)" class="text-sm text-accent my-3">{{ submissionError(active) }}</p>
        <p v-if="active.table === 'cards_base' && active.untranslated" class="text-xs text-ink-muted my-3">
          官网该卡在所选语区没有译文（英文回退），不会写入任何文本。
        </p>
        <div class="overflow-x-auto">
          <table class="w-full text-xs min-w-[680px]">
            <thead class="text-left text-ink-faint"><tr><th class="p-2">更新</th><th class="p-2">字段</th><th class="p-2 w-1/4">数据库值</th><th class="p-2 w-1/4">API 映射值</th><th class="p-2 w-1/3">待提交值</th></tr></thead>
            <tbody>
              <tr v-for="field in editorFields" :key="`${active.key}:${field}`" class="border-t border-card-border align-top">
                <td class="p-2">
                  <input v-if="activeState.before" v-model="active.selected" type="checkbox" :value="field" :disabled="readOnly || !activeState.changed.includes(field)" :aria-label="`更新 ${field}`" />
                  <span v-else>新增</span>
                </td>
                <td class="p-2">{{ labels[field] ?? field }}<span class="block text-ink-faint font-mono mt-1">{{ field }}</span></td>
                <td class="p-2 whitespace-pre-wrap break-all">{{ show(activeState.before?.[field]) }}</td>
                <td class="p-2 whitespace-pre-wrap break-all">{{ show(active.source[field]) }}</td>
                <td class="p-2">
                  <input v-if="BOOL_FIELDS.includes(field)" v-model="active.draft[field]" type="checkbox" :disabled="readOnly" :aria-label="`编辑 ${field}`" />
                  <textarea v-else :key="`${active.key}:${field}`" :value="inputValue(active.draft[field])" :disabled="readOnly" :aria-label="`编辑 ${field}`"
                    class="filter-select w-full min-h-[72px] font-mono text-xs" @input="setField(active, field, $event)"></textarea>
                  <p v-if="inputErrors[inputKey(active, field)]" class="text-delta-down mt-1">{{ inputErrors[inputKey(active, field)] }}</p>
                </td>
              </tr>
              <tr v-if="active.table === 'card_prints'" class="border-t border-card-border align-top">
                <td class="p-2"><input v-if="activeState.before" v-model="active.selected" type="checkbox" value="card_id" :disabled="readOnly || !activeState.changed.includes('card_id')" aria-label="更新 card_id" /><span v-else>新增</span></td>
                <td class="p-2">关联基础卡<br />card_id</td>
                <td class="p-2 break-all">{{ show(activeState.before?.card_id) }}</td>
                <td class="p-2">按编号 / 英文身份匹配</td>
                <td class="p-2 break-all">{{ activeState.parentId ?? '等待创建 / 选择基础卡' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="flex items-center gap-4 mt-4">
          <button class="btn-brand px-4 py-2 text-xs" :disabled="readOnly || !ready(active)" @click="submit(active)">
            {{ activeState.before ? '提交勾选字段' : 'Insert 此条记录' }}
          </button>
          <p class="text-xs text-ink-faint">编辑内容会同时用于单条提交、批量提交和导出。</p>
        </div>
        <p v-if="errors[active.key]" class="text-delta-down text-xs mt-3">{{ errors[active.key] }}</p>
      </div>

      <div class="card p-5 mt-5">
        <p class="text-sm font-semibold">当前阶段：{{ stages.find(s => s.table === tab)?.label }}</p>
        <p class="text-xs text-ink-muted mt-2">批量仅处理本阶段已包含且可提交的 {{ readyCount }} 条。</p>
        <div class="flex gap-3 flex-wrap mt-4">
          <button class="btn-brand px-4 py-2 text-xs" :disabled="!readyCount || submitDisabled" @click="submit()">提交本阶段 {{ readyCount }} 条</button>
          <button class="btn-ghost px-4 py-2 text-xs" :disabled="!readyCount || readOnly" @click="exportReviewed('sql')">导出本阶段 SQL</button>
          <button class="btn-ghost px-4 py-2 text-xs" :disabled="!readyCount || readOnly" @click="exportReviewed('csv')">导出本阶段 CSV</button>
          <label class="text-xs flex items-center gap-2"><input v-model="publish" type="checkbox" :disabled="readOnly" />提交或执行 SQL 后发布已修改的分类</label>
        </div>
        <p class="text-xs text-ink-faint mt-3">SQL/CSV 与小程序同步共用一套校验；只读语区禁用导出。</p>
      </div>
    </fieldset>
    <p v-if="busy" role="status" class="text-sm text-brand mt-4">提交中… {{ progress }}</p>
  </section>
</template>
