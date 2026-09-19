<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { SyncDataset } from '@/tools/sync/run';
import { applyReviewOperation, type ExistingSnapshot } from '@/tools/admin/sync';
import { touchVersions, type VersionCategory } from '@/tools/sources/rest';
import { downloadText } from '@/tools/sync/exporters';
import { errorText, notifyError, notifyOk, notifyWarn } from '@/tools/admin/notice';
import {
  ARRAY_FIELDS, NUMBER_FIELDS, BOOL_FIELDS, createReview, reviewState, baseCandidates, buildOperation,
  reviewSql, reviewCsv, type ReviewRow, type ReviewTable, type Values, type ReviewOperation
} from '@/tools/sync/review';

const props = defineProps<{ dataset: SyncDataset; existing: ExistingSnapshot; loading: boolean }>();
const emit = defineEmits<{ reload: []; busy: [value: boolean] }>();
const rows = ref<ReviewRow[]>(createReview(props.dataset));
const snapshot = ref(props.existing);
const tab = ref<ReviewTable>('card_prints');
const search = ref('');
const statusFilter = ref('pending');
const page = ref(1);
const editorKey = ref('');
const editorPanel = ref<HTMLElement | null>(null);
const returnPrintKey = ref('');
const busy = ref(false);
const progress = ref('');
const publish = ref(true);
const errors = ref<Record<string, string>>({});
const inputErrors = ref<Record<string, string>>({});
const stages: { table: ReviewTable; label: string }[] = [
  { table: 'card_prints', label: '印刷版本' }, { table: 'cards_base', label: '基础卡' },
  { table: 'series', label: '缺失系列' }, { table: 'card_icons', label: '关键词图标' }
];
const labels: Record<string, string> = {
  card_no: '基础编号', card_name_cn: '名字', sub_title_cn: '副标题', effect_cn: '效果文本',
  card_no_extend: '印刷编号', language: '语言', card_id: '关联基础卡 ID', rarity_name: '稀有度',
  extend_rarity_name: '扩展稀有度', img_cdn: '卡图', artist: '画师', series: '系列',
  flavor_text_cn: '背景文本', is_promo: '促销版本', card_color_list: '颜色', region: '地区',
  tag: '标签', champion_tag: '英雄', energy: '费用', return_energy: '符能费用', power: '力量',
  series_name: '系列', card_category: '类别', name_zh: '中文名称', url: '图标地址',
  storage_type: '存储类型', isWhite: '白色图标', code: '系列代码', name_cn: '中文名称',
  name_en: '英文名称', release_order: '发行顺序', is_standard: '标准系列', is_active: '启用'
};
const state = (r: ReviewRow) => reviewState(r, rows.value, snapshot.value);
const tableRows = computed(() => rows.value.filter((r) => r.table === tab.value));
const filtered = computed(() => tableRows.value.filter((r) => {
  const s = state(r);
  return (statusFilter.value === 'all' || (statusFilter.value === 'pending' ? s.kind !== 'same' : s.kind === statusFilter.value)) &&
    `${r.label} ${r.draft.card_name_cn ?? ''} ${r.draft.sub_title_cn ?? ''} ${r.draft.card_no_extend ?? ''}`.toLowerCase().includes(search.value.toLowerCase());
}));
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / 30)));
const visibleRows = computed(() => filtered.value.slice((page.value - 1) * 30, page.value * 30));
const active = computed(() => rows.value.find((r) => r.key === editorKey.value));
const activeState = computed(() => active.value ? state(active.value) : null);
const parentRow = computed(() => active.value?.table === 'cards_base' ? active.value : rows.value.find((r) => r.key === active.value?.parentKey));
const candidates = computed(() => parentRow.value ? baseCandidates(parentRow.value, snapshot.value) : []);
const editorFields = computed(() => activeState.value?.fields.filter((f) => f !== 'card_id') ?? []);
watch([tab, search, statusFilter], () => { page.value = 1; });
watch(pageCount, (count) => { page.value = Math.min(page.value, count); });
watch(() => props.existing, (ex) => {
  snapshot.value = ex;
  // A fresh database snapshot needs a fresh field approval; keep all edited values.
  for (const row of rows.value) row.selected = [];
});
watch(busy, (value) => emit('busy', value));
function show(v: unknown): string {
  if (v == null || v === '') return '∅';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}
function inputValue(v: unknown): string { return v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); }
function inputKey(row: ReviewRow, field: string): string { return `${row.key}:${field}`; }
function setField(row: ReviewRow, field: string, event: Event): void {
  const raw = (event.target as HTMLInputElement).value;
  const key = inputKey(row, field);
  try {
    let value: unknown = raw || null;
    if (ARRAY_FIELDS.includes(field)) {
      value = raw.trim() ? JSON.parse(raw) : [];
      if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) throw new Error('请输入字符串 JSON 数组，如 ["单位"]');
    } else if (NUMBER_FIELDS.includes(field)) {
      value = raw.trim() ? Number(raw) : null;
      if (value !== null && !Number.isInteger(value)) throw new Error('请输入整数或留空');
    }
    row.draft[field] = value;
    if (['card_no_extend', 'language'].includes(field) && row.error.startsWith('无法解析')) row.error = '';
    delete inputErrors.value[key];
    delete errors.value[row.key];
  } catch (e) { inputErrors.value[key] = errorText(e); }
}
function rowInputError(row: ReviewRow): string {
  return Object.entries(inputErrors.value).find(([k]) => k.startsWith(`${row.key}:`))?.[1] ?? '';
}
function operation(row: ReviewRow): ReviewOperation | null {
  const error = rowInputError(row);
  if (error) throw new Error(error);
  return buildOperation(row, rows.value, snapshot.value);
}
function ready(row: ReviewRow): boolean {
  try { return !!operation(row); } catch { return false; }
}
function submissionError(row: ReviewRow): string {
  try { operation(row); return ''; } catch (e) { return errorText(e); }
}
const readyCount = computed(() => tableRows.value.filter((r) => r.included && ready(r)).length);
const statusName = (r: ReviewRow) => ({ new: '新增', update: '待更新', same: '无变更', blocked: '待处理' })[state(r).kind];
function chooseVariant(event: Event): void {
  const r = parentRow.value;
  if (!r) return;
  const value = (event.target as HTMLSelectElement).value;
  if (value === '') { r.variantChosen = false; return; }
  const variant = r.variants[Number(value)];
  if (!variant) return;
  r.draft.effect_cn = variant.effect_cn;
  r.source.effect_cn = variant.effect_cn;
  r.detailComplete = variant.sync_detail_complete === true;
  r.variantChosen = true;
  r.selected = [];
}
async function openEditor(row: ReviewRow): Promise<void> {
  editorKey.value = row.key;
  await nextTick();
  editorPanel.value?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}
function openParent(): void {
  if (!parentRow.value) return;
  if (active.value?.table === 'card_prints') returnPrintKey.value = active.value.key;
  void openEditor(parentRow.value);
  tab.value = 'cards_base';
}
function returnToPrint(): void {
  const row = rows.value.find((r) => r.key === returnPrintKey.value);
  if (row) { tab.value = 'card_prints'; void openEditor(row); }
}
function acceptResult(row: ReviewRow, result: Values): void {
  const ex = snapshot.value;
  if (row.table === 'series') {
    if (!ex.seriesCodes.includes(String(result.code))) ex.seriesCodes.push(String(result.code));
  } else {
    const list = (row.table === 'cards_base' ? ex.cards : row.table === 'card_prints' ? ex.prints : ex.icons) as unknown as Values[];
    const index = list.findIndex((r) => r.id === result.id);
    if (index >= 0) list[index] = result; else list.push(result);
  }
  if (row.table === 'cards_base') row.chosenBaseId = String(result.id);
  row.selected = [];
  delete errors.value[row.key];
}
async function submit(single?: ReviewRow): Promise<void> {
  if (busy.value || props.loading) return;
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
        categories.add(({ cards_base: 'cards', card_prints: 'prints', card_icons: 'icons', series: 'series' } as const)[row.table]);
        done++;
      } catch (e) {
        errors.value[row.key] = errorText(e);
        notifyError(`已成功 ${done} 条；${row.label} 提交失败`, errorText(e));
        // Stop the batch, keep all remaining edits and field selections.
        break;
      }
    }
    if (publish.value && categories.size) {
      const results = await touchVersions([...categories]);
      const failed = results.filter((r) => !r.ok);
      if (failed.length) notifyWarn('数据已写入，部分分类发布失败', failed.map((r) => r.error).join('；'));
    }
    if (done) notifyOk(`已提交 ${done} 条`, '其他阶段需由你分别点击提交');
  } catch (e) { notifyError('提交后的发布失败', errorText(e)); }
  finally { busy.value = false; progress.value = ''; }
}
function exportReviewed(format: 'sql' | 'csv'): void {
  const selectedRows = tableRows.value.filter((r) => r.included && ready(r));
  try {
    const ops = selectedRows.map(operation).filter((o): o is ReviewOperation => o !== null);
    if (!ops.length) { notifyWarn('当前阶段没有可导出的已选操作'); return; }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    if (format === 'sql') downloadText(`${tab.value}-${stamp}.sql`, reviewSql(ops, { publish: publish.value }), 'application/sql');
    else {
      for (const kind of ['insert', 'update'] as const) if (ops.some((o) => o.kind === kind)) {
        downloadText(`${tab.value}-${kind === 'insert' ? 'insert' : 'update-patches'}-${stamp}.csv`, reviewCsv(ops, kind), 'text/csv');
      }
    }
    notifyOk(`已导出当前阶段 ${ops.length} 条操作`);
  } catch (e) { notifyError('导出失败', errorText(e)); }
}
</script>

<template>
  <section class="mb-10">
    <div class="flex justify-between gap-4 items-start mb-4">
      <div>
        <p class="eyebrow">其二 · 审核与提交</p>
        <h2 class="font-display text-xl font-bold mt-2">逐条审核同步差异</h2>
        <p class="text-xs text-ink-muted mt-2">更新字段默认不勾选。缺少基础卡时，先创建基础卡，再单独提交印刷版本。</p>
      </div>
      <button class="btn-ghost px-3 py-2 text-xs" :disabled="busy || loading" @click="emit('reload')">{{ loading ? '读取中…' : '重读库内现状' }}</button>
    </div>
    <fieldset :disabled="busy || loading" class="min-w-0">
      <div class="flex gap-2 flex-wrap mb-4">
        <button v-for="stage in stages" :key="stage.table" class="btn-ghost px-3 py-2 text-xs"
          :class="tab === stage.table ? 'tab-active' : ''" @click="tab = stage.table">
          {{ stage.label }} · {{ rows.filter(r => r.table === stage.table && state(r).kind !== 'same').length }}
        </button>
      </div>
      <div class="flex gap-3 flex-wrap mb-4">
        <input v-model="search" aria-label="搜索卡号或卡名" class="filter-select min-w-[230px]" placeholder="搜索卡号、名字、副标题" />
        <select v-model="statusFilter" aria-label="筛选状态" class="filter-select">
          <option value="pending">全部待处理</option><option value="new">新增</option><option value="update">更新</option>
          <option value="blocked">需要处理</option><option value="all">全部（含无变更）</option>
        </select>
        <span class="text-xs text-ink-faint self-center">{{ filtered.length }} 条 · 当前阶段可提交 {{ readyCount }} 条</span>
      </div>
      <div class="flex gap-4 flex-wrap text-xs mb-3">
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
              <td class="p-3"><input v-model="row.included" type="checkbox" :aria-label="`批量包含 ${row.label}`" /></td>
              <td class="p-3 whitespace-nowrap">{{ statusName(row) }}</td>
              <td class="p-3"><span class="font-mono">{{ row.label }}</span><p v-if="row.table === 'cards_base'" class="mt-1">{{ row.draft.card_name_cn }} {{ row.draft.sub_title_cn }}</p></td>
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

      <div v-if="active && activeState" ref="editorPanel" class="card p-4 sm:p-6 mt-5 scroll-mt-20" data-testid="sync-editor">
        <div class="flex justify-between items-start gap-4">
          <div><p class="eyebrow">单条编辑 · {{ statusName(active) }}</p><h3 class="text-lg font-bold mt-2">{{ active.label }}</h3></div>
          <button class="btn-ghost px-3 py-1 text-xs" @click="editorKey = ''">收起</button>
        </div>
        <div v-if="parentRow" class="my-4 p-3 border border-card-border rounded-lg text-xs">
          <p>基础卡：{{ parentRow.draft.card_name_cn }} {{ parentRow.draft.sub_title_cn }}</p>
          <label v-if="candidates.length > 1" class="block mt-2">有多个同名候选，请选择关联记录
            <select v-model="parentRow.chosenBaseId" class="filter-select w-full mt-2" @change="parentRow.selected = []; active.selected = active.selected.filter(f => f !== 'card_id')">
              <option value="">请选择，不会自动选择</option>
              <option v-for="candidate in candidates" :key="String(candidate.id)" :value="candidate.id">{{ candidate.card_no }} · {{ candidate.card_name_cn }} {{ candidate.sub_title_cn }} · {{ candidate.id }}</option>
            </select>
          </label>
          <p v-else-if="candidates.length === 1" class="mt-2 font-mono">{{ candidates[0]?.card_no }} · {{ candidates[0]?.id }}</p>
          <p v-else class="mt-2 text-accent">基础卡尚未创建。</p>
          <button v-if="active.table === 'card_prints'" class="text-brand mt-2 hover:underline" @click="openParent">查看 / 创建基础卡 →</button>
          <label v-if="parentRow.variants.length > 1" class="block mt-3">不同版本含不同勘误，请选择文本来源
            <select class="filter-select w-full mt-2" @change="chooseVariant">
              <option value="">请选择勘误来源</option>
              <option v-for="(variant, index) in parentRow.variants" :key="index" :value="index">{{ variant.card_no }} · {{ variant.effect_cn }}</option>
            </select>
          </label>
        </div>
        <p v-if="submissionError(active)" class="text-sm text-accent my-3">{{ submissionError(active) }}</p>
        <p class="sm:hidden text-xs text-ink-faint my-3">左右滑动下方表格，查看并编辑待提交值。</p>
        <p v-if="active.table === 'cards_base' && activeState.before && !active.errata" class="text-xs text-ink-muted my-3">API 没有勘误，已有基础卡不提供字段更新。</p>
        <div v-else class="overflow-x-auto">
          <table class="w-full text-xs min-w-[680px]">
            <thead class="text-left text-ink-faint"><tr><th class="p-2">更新</th><th class="p-2">字段</th><th class="p-2 w-1/4">数据库值</th><th class="p-2 w-1/4">API 映射值</th><th class="p-2 w-1/3">待提交值</th></tr></thead>
            <tbody>
              <tr v-for="field in editorFields" :key="`${active.key}:${field}`" class="border-t border-card-border align-top">
                <td class="p-2"><input v-if="activeState.before" v-model="active.selected" type="checkbox" :value="field" :disabled="!activeState.changed.includes(field)" :aria-label="`更新 ${field}`" /><span v-else>新增</span></td>
                <td class="p-2">{{ labels[field] ?? field }}<span class="block text-ink-faint font-mono mt-1">{{ field }}</span></td>
                <td class="p-2 whitespace-pre-wrap break-all">{{ show(activeState.before?.[field]) }}</td>
                <td class="p-2 whitespace-pre-wrap break-all">{{ show(active.source[field]) }}</td>
                <td class="p-2">
                  <input v-if="BOOL_FIELDS.includes(field)" v-model="active.draft[field]" type="checkbox" :aria-label="`编辑 ${field}`" />
                  <textarea v-else :key="`${active.key}:${field}`" :value="inputValue(active.draft[field])" :aria-label="`编辑 ${field}`" class="filter-select w-full min-h-[72px] font-mono text-xs" @input="setField(active, field, $event)"></textarea>
                  <p v-if="inputErrors[inputKey(active, field)]" class="text-delta-down mt-1">{{ inputErrors[inputKey(active, field)] }}</p>
                </td>
              </tr>
              <tr v-if="active.table === 'card_prints'" class="border-t border-card-border align-top">
                <td class="p-2"><input v-if="activeState.before" v-model="active.selected" type="checkbox" value="card_id" :disabled="!activeState.changed.includes('card_id')" aria-label="更新 card_id" /><span v-else>新增</span></td>
                <td class="p-2">关联基础卡<br />card_id</td><td class="p-2 break-all">{{ show(activeState.before?.card_id) }}</td><td class="p-2">按名字＋副标题匹配</td><td class="p-2 break-all">{{ activeState.parentId ?? '等待创建 / 选择基础卡' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="flex items-center gap-4 mt-4">
          <button class="btn-brand px-4 py-2 text-xs" :disabled="!ready(active)" @click="submit(active)">{{ activeState.before ? '提交勾选字段' : 'Insert 此条记录' }}</button>
          <button v-if="active.table === 'cards_base' && returnPrintKey" class="btn-ghost px-3 py-2 text-xs" @click="returnToPrint">返回印刷版本</button>
          <p class="text-xs text-ink-faint">编辑内容会同时用于单条提交、批量提交和导出。</p>
        </div>
        <p v-if="errors[active.key]" class="text-delta-down text-xs mt-3">{{ errors[active.key] }}</p>
      </div>
      <div class="card p-5 mt-5">
        <p class="text-sm font-semibold">当前阶段：{{ stages.find(s => s.table === tab)?.label }}</p>
        <p class="text-xs text-ink-muted mt-2">批量仅处理本阶段已包含且可提交的 {{ readyCount }} 条；未勾选更新字段或等待关联的记录不会提交。列表筛选不改变批量包含范围。</p>
        <div class="flex gap-3 flex-wrap mt-4">
          <button class="btn-brand px-4 py-2 text-xs" :disabled="!readyCount" @click="submit()">提交本阶段 {{ readyCount }} 条</button>
          <button class="btn-ghost px-4 py-2 text-xs" :disabled="!readyCount" @click="exportReviewed('sql')">导出本阶段 SQL</button>
          <button class="btn-ghost px-4 py-2 text-xs" :disabled="!readyCount" @click="exportReviewed('csv')">导出本阶段 CSV</button>
          <label class="text-xs flex items-center gap-2"><input v-model="publish" type="checkbox" />提交或执行 SQL 后发布已修改的分类</label>
        </div>
        <p class="text-xs text-ink-faint mt-3">CSV 新增文件用于导入；update-patches 文件按「记录 ID＋字段＋JSON 值」列出更新补丁，请勿作为整行 CSV 导入。SQL 仅包含已选字段。</p>
        <p v-if="tab === 'card_prints'" class="text-xs text-ink-faint mt-2">尚未创建基础卡的印刷版本不会导出。先执行基础卡阶段，再重读库内现状。</p>
        <p v-if="tab === 'cards_base' && rows.some(r => r.table === 'series' && state(r).kind === 'new')" class="text-xs text-accent mt-2">有缺失系列，请先在「缺失系列」阶段审核并提交，避免系列外键错误。</p>
      </div>
    </fieldset>
    <p v-if="busy" role="status" class="text-sm text-brand mt-4">提交中… {{ progress }}</p>
  </section>
</template>
