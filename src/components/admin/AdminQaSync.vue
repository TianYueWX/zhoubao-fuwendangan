<script setup lang="ts">
/** 卡牌常见问题（QA）同步：拉取官方接口、逐条审核编辑、写入 qa_entries / qa_entry_cards。 */
import { computed, nextTick, ref, watch } from 'vue';
import SectionHeading from '../SectionHeading.vue';
import QaRichText from './QaRichText.vue';
import { errorText, notifyError, notifyOk, notifyWarn } from '@/tools/admin/notice';
import { applyQaPlan, loadQaExisting, type QaApplyResult, type QaExisting } from '@/tools/admin/qa';
import { touchVersions } from '@/tools/sources/rest';
import {
  buildQaIncoming,
  buildQaPlan,
  createQaReview,
  qaState,
  summarizeQa,
  type QaIncoming,
  type QaPlan,
  type QaReviewRow
} from '@/tools/sync/qa';
import { createRequestPacer, searchAllCommonQa, type RetryInfo } from '@/tools/sync/riftboundApi';

const props = defineProps<{ apiBase: string }>();
const emit = defineEmits<{ busy: [value: boolean] }>();

const fetching = ref(false);
const fetchError = ref('');
const rows = ref<QaReviewRow[]>([]);
const existing = ref<QaExisting | null>(null);
const existingLoading = ref(false);
const fetchedCardNames = ref<Map<string, string>>(new Map());

const busy = ref(false);
const progress = ref('');
const publish = ref(true);
const errors = ref<Record<string, string>>({});
const inputErrors = ref<Record<string, string>>({});
const search = ref('');
const statusFilter = ref('pending');
const page = ref(1);
const editorKey = ref('');
const editorPanel = ref<HTMLElement | null>(null);

const summary = computed(() => summarizeQa(rows.value));
const active = computed(() => (editorKey.value ? rows.value.find((r) => r.key === editorKey.value) : undefined));
const activeState = computed(() => (active.value ? qaState(active.value) : null));
const filtered = computed(() => rows.value.filter((r) => {
  const s = qaState(r);
  const statusOk = statusFilter.value === 'all' ||
    (statusFilter.value === 'pending' ? s.kind !== 'same' : s.kind === statusFilter.value);
  const q = search.value.trim().toLowerCase();
  const hay = `${r.incoming.source_id} ${r.draft.question} ${r.draft.answer} ${r.draft.card_no_list.join(' ')}`.toLowerCase();
  return statusOk && (!q || hay.includes(q));
}));
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / 30)));
const visibleRows = computed(() => filtered.value.slice((page.value - 1) * 30, page.value * 30));
const readyCount = computed(() => rows.value.filter((r) => r.included && ready(r)).length);
const cardNoSet = computed(() => existing.value?.cardNos ?? new Set<string>());
const availableCardNos = computed(() => new Set([...cardNoSet.value, ...fetchedCardNames.value.keys()]));
const attemptCount = computed(() => rows.value.filter((r) => r.included && canAttempt(r)).length);

watch([fetching, busy], ([pulling, writing]) => emit('busy', pulling || writing), { immediate: true });

function linksMap(ex: QaExisting): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const l of ex.links) {
    const arr = map.get(l.qa_id) ?? [];
    arr.push(l.card_no);
    map.set(l.qa_id, arr);
  }
  return map;
}

async function loadExistingRows(force = false): Promise<boolean> {
  if (existing.value && !force) return true;
  existingLoading.value = true;
  try {
    existing.value = await loadQaExisting();
    return true;
  } catch (e) {
    notifyError(`读取库内 QA 失败:${errorText(e)}`);
    return false;
  } finally {
    existingLoading.value = false;
  }
}

interface QaFetchProgress {
  label: string;
  done: number;
  total: number;
  retry: RetryInfo | null;
}

interface QaFetchOptions {
  signal: AbortSignal;
  fetchedCards?: ReadonlyMap<string, string>;
  onProgress?: (p: QaFetchProgress) => void;
}

function reset(): void {
  fetchError.value = '';
  rows.value = [];
  errors.value = {};
  inputErrors.value = {};
  search.value = '';
  statusFilter.value = 'pending';
  page.value = 1;
  editorKey.value = '';
  fetchedCardNames.value = new Map();
}

function hasUnsavedReview(): boolean {
  return rows.value.some((row) => qaState(row).kind !== 'same');
}

async function runFetch(options: QaFetchOptions): Promise<{ total: number; newCount: number; updateCount: number; sameCount: number }> {
  if (fetching.value || busy.value) throw new Error('QA 正在处理中');
  fetching.value = true;
  fetchError.value = '';
  rows.value = [];
  fetchedCardNames.value = new Map(options.fetchedCards ?? []);
  try {
    const loaded = await loadExistingRows(true);
    if (!loaded || !existing.value) throw new Error('请先成功读取库内现状，再拉取并比对');
    const ex = existing.value;
    const pendingCardNos = new Set([...fetchedCardNames.value.keys()].filter((n) => !ex.cardNos.has(n)));
    const nameByNo = new Map(ex.nameByNo);
    for (const [cardNo, name] of fetchedCardNames.value) if (!nameByNo.has(cardNo)) nameByNo.set(cardNo, name);
    let total = 0;
    let label = '拉取问答…';
    const emit = (retry: RetryInfo | null): void => options.onProgress?.({ label, done: total, total: 0, retry });
    const pacer = createRequestPacer(500, 1000, options.signal);
    const items = await searchAllCommonQa({
      baseUrl: props.apiBase,
      signal: options.signal,
      beforeRequest: pacer,
      onPage: (page, _got, accumulated) => {
        label = `拉取问答…第 ${page} 页（累计 ${accumulated} 条）`;
        total = accumulated;
        emit(null);
      },
      onRetry: (info) => {
        pacer.slowDown();
        emit({ ...info, gapRange: pacer.gapRange() });
      }
    });
    if (!items.length) throw new Error('接口未返回任何问答');
    const incoming: QaIncoming[] = items.map((item) => buildQaIncoming(item, ex.cardNos, nameByNo, pendingCardNos));
    rows.value = createQaReview(incoming, ex.entries, linksMap(ex));
    const s = summary.value;
    return s;
  } catch (e) {
    if (!(e instanceof DOMException && e.name === 'AbortError')) fetchError.value = errorText(e);
    throw e;
  } finally {
    fetching.value = false;
  }
}

function show(v: unknown): string {
  if (v == null || v === '') return '∅';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}
function inputValue(v: unknown): string {
  return v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
}
function beforeValue(row: QaReviewRow, field: string): unknown {
  return row.before ? (row.before as unknown as Record<string, unknown>)[field] : undefined;
}
function draftValue(row: QaReviewRow, field: string): unknown {
  return (row.draft as unknown as Record<string, unknown>)[field];
}
function incomingValue(row: QaReviewRow, field: string): unknown {
  if (field === 'question') return row.incoming.question;
  if (field === 'answer') return row.incoming.answer;
  if (field === 'card_no_list') return row.incoming.card_no_list;
  return undefined;
}
function inputKey(row: QaReviewRow, field: string): string {
  return `${row.key}:${field}`;
}
function setField(row: QaReviewRow, field: string, event: Event): void {
  const raw = (event.target as HTMLInputElement).value;
  const key = inputKey(row, field);
  try {
    let value: unknown = raw || null;
    if (field === 'card_no_list') {
      const parsed = raw.trim() ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed) || !parsed.every((v) => typeof v === 'string')) {
        throw new Error('请输入字符串 JSON 数组，如 ["OGN-021"]');
      }
      const bad = (parsed as string[]).filter((n) => !availableCardNos.value.has(n));
      if (bad.length) throw new Error(`编号不在卡库或本轮卡牌中，无法关联：${bad.join('、')}`);
      row.pendingCardNos = (parsed as string[]).filter((n) => !cardNoSet.value.has(n));
      value = parsed;
    }
    (row.draft as unknown as Record<string, unknown>)[field] = value;
    delete inputErrors.value[key];
    delete errors.value[row.key];
  } catch (e) {
    inputErrors.value[key] = errorText(e);
  }
}
function rowInputError(row: QaReviewRow): string {
  return Object.entries(inputErrors.value).find(([k]) => k.startsWith(`${row.key}:`))?.[1] ?? '';
}
function operation(row: QaReviewRow): QaPlan | null {
  const error = rowInputError(row);
  if (error) throw new Error(error);
  return buildQaPlan(row);
}
function ready(row: QaReviewRow): boolean {
  try { return !!operation(row); } catch { return false; }
}
function canAttempt(row: QaReviewRow): boolean {
  if (rowInputError(row)) return false;
  if (!row.draft.question.trim() || !row.draft.answer.trim()) return false;
  const waiting = row.pendingCardNos.some((cardNo) => row.draft.card_no_list.includes(cardNo));
  return waiting || ready(row);
}
function submissionError(row: QaReviewRow): string {
  try { operation(row); return ''; } catch (e) { return errorText(e); }
}
function statusName(row: QaReviewRow): string {
  return ({ new: '新增', update: '待更新', same: '无变更', blocked: '待处理' })[qaState(row).kind];
}

async function openEditor(row: QaReviewRow): Promise<void> {
  editorKey.value = row.key;
  await nextTick();
  editorPanel.value?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function acceptResult(row: QaReviewRow, result: QaApplyResult, plan: QaPlan): void {
  const ex = existing.value;
  if (!ex) return;
  const idx = ex.entries.findIndex((e) => e.id === result.entry.id);
  if (idx >= 0) ex.entries[idx] = result.entry;
  else ex.entries.push(result.entry);
  row.before = result.entry;
  const current = new Set(row.existingLinks);
  for (const r of plan.linkRemoves) current.delete(r);
  for (const a of plan.linkAdds) current.add(a.card_no);
  row.existingLinks = [...current];
  ex.links = ex.links.filter((l) => !(l.qa_id === result.entry.id && plan.linkRemoves.includes(l.card_no)));
  for (const a of plan.linkAdds) {
    if (!ex.links.some((l) => l.qa_id === result.entry.id && l.card_no === a.card_no)) {
      ex.links.push({ qa_id: result.entry.id, card_no: a.card_no, position: a.position });
    }
  }
  row.selected = [];
  row.pendingCardNos = [];
  delete errors.value[row.key];
}

/** 卡牌审核可能在 QA 拉取之后完成；提交 QA 前始终重查真实外键。 */
async function refreshPendingDependencies(): Promise<void> {
  if (!rows.value.some((row) => row.pendingCardNos.length)) return;
  const fresh = await loadQaExisting();
  existing.value = fresh;
  for (const row of rows.value) {
    row.pendingCardNos = row.draft.card_no_list.filter((cardNo) => !fresh.cardNos.has(cardNo));
  }
}

async function submit(single?: QaReviewRow): Promise<void> {
  if (busy.value || existingLoading.value) return;
  busy.value = true;
  let done = 0;
  try {
    await refreshPendingDependencies();
    const candidates = single ? [single] : rows.value.filter((r) => r.included);
    const selected = candidates.filter((r) => ready(r));
    if (!selected.length) {
      const waiting = candidates.flatMap((row) => row.pendingCardNos);
      if (waiting.length) notifyWarn('卡牌尚未提交，QA 已保留关联并继续等待', [...new Set(waiting)].join('、'));
      else notifyWarn('没有可提交的 QA');
      return;
    }
    for (const row of selected) {
      try {
        const plan = operation(row);
        if (!plan) continue;
        progress.value = `${done + 1} / ${selected.length} · ${row.incoming.source_id}`;
        const result = await applyQaPlan(plan);
        acceptResult(row, result, plan);
        done++;
      } catch (e) {
        errors.value[row.key] = errorText(e);
        notifyError(`已成功 ${done} 条；QA ${row.incoming.source_id} 提交失败`, errorText(e));
        break;
      }
    }
    if (publish.value && done) {
      const results = await touchVersions(['qa']);
      const failed = results.filter((result) => !result.ok);
      if (failed.length) notifyWarn('QA 已写入，发布标记更新失败', failed.map((result) => result.error).join('；'));
    }
    if (done) notifyOk(`已提交 ${done} 条 QA`);
  } finally {
    busy.value = false;
    progress.value = '';
  }
}

defineExpose({ runFetch, reset, hasUnsavedReview });
</script>

<template>
  <section class="mb-10">
    <SectionHeading
      plain
      title="同步卡牌问答"
      note="拉取由上方统一启动；按 source_id 幂等写入，本轮新卡会保留关联并等待卡牌先提交"
    />

    <div class="flex items-center gap-3 flex-wrap">
      <button v-if="rows.length" class="btn-ghost px-3 py-1.5 text-xs" :disabled="fetching || busy" @click="loadExistingRows(true)">
        {{ existingLoading ? '读取中…' : '重读库内现状' }}
      </button>
      <span v-if="rows.length" class="text-[11px] text-ink-muted tabular-nums">
        共 {{ summary.total }} · 新增 {{ summary.newCount }} · 更新 {{ summary.updateCount }} · 无变更 {{ summary.sameCount }}
      </span>
      <span v-if="!rows.length && !fetching" class="text-[11px] text-ink-faint">尚未拉取 QA。</span>
    </div>

    <p v-if="fetchError" class="mt-4 text-[13px] text-delta-down leading-relaxed pl-3 border-l-2 border-brand">
      {{ fetchError }}
    </p>

    <div v-if="summary.unmatched.length" class="mt-4 pl-3 border-l-2 border-accent">
      <p class="text-[12px] text-ink-muted">
        以下 {{ summary.unmatched.length }} 个卡号不在 cards_base，已跳过关联:
        <span class="font-mono">{{ summary.unmatched.map((n) => n.replace(/·/g, '-')).join('、') }}</span>
      </p>
    </div>

    <fieldset v-if="rows.length" :disabled="busy" class="min-w-0 mt-5">
      <div class="flex gap-3 flex-wrap mb-4">
        <input v-model="search" aria-label="搜索问答" class="filter-select min-w-[230px]" placeholder="搜索问题、答案或卡号" />
        <select v-model="statusFilter" aria-label="筛选状态" class="filter-select">
          <option value="pending">全部待处理</option><option value="new">新增</option><option value="update">更新</option>
          <option value="blocked">需要处理</option><option value="all">全部（含无变更）</option>
        </select>
        <span class="text-xs text-ink-faint self-center">{{ filtered.length }} 条 · 可提交 {{ readyCount }} 条</span>
      </div>

      <div class="border border-card-border rounded-xl overflow-x-auto">
        <table class="w-full text-xs">
          <thead class="text-left text-ink-faint bg-panel-bg"><tr>
            <th class="p-3">批量包含</th><th class="p-3">状态</th><th class="p-3">问题</th><th class="p-3">涉及卡牌</th><th class="p-3">操作</th>
          </tr></thead>
          <tbody>
            <tr v-for="row in visibleRows" :key="row.key" class="border-t border-card-border align-top">
              <td class="p-3"><input v-model="row.included" type="checkbox" :aria-label="`批量包含 QA ${row.incoming.source_id}`" /></td>
              <td class="p-3 whitespace-nowrap">{{ statusName(row) }}</td>
              <td class="p-3 max-w-[460px] break-words">
                <p><QaRichText :text="row.draft.question" /></p>
                <p class="mt-2 text-ink-muted"><QaRichText :text="row.draft.answer" /></p>
                <p class="text-ink-faint font-mono mt-1">#{{ row.incoming.source_id }}</p>
                <p v-if="errors[row.key]" class="mt-1 text-delta-down">{{ errors[row.key] }}</p>
              </td>
              <td class="p-3 max-w-[240px] break-words">
                <span v-if="row.draft.card_no_list.length" class="font-mono">{{ row.draft.card_no_list.join('、') }}</span>
                <span v-else class="text-ink-faint">—</span>
                <p v-if="row.pendingCardNos.length" class="text-accent mt-1">等待卡牌提交：{{ row.pendingCardNos.join('、') }}</p>
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

      <div v-if="active && activeState" ref="editorPanel" class="card p-4 sm:p-6 mt-5 scroll-mt-20">
        <div class="flex justify-between items-start gap-4">
          <h3 class="text-lg font-bold">#{{ active.incoming.source_id }} <span class="text-xs font-normal text-ink-faint">· {{ statusName(active) }}</span></h3>
          <button class="btn-ghost px-3 py-1 text-xs" @click="editorKey = ''">收起</button>
        </div>

        <p v-if="submissionError(active)" class="text-sm text-accent my-3">{{ submissionError(active) }}</p>

        <div class="overflow-x-auto">
          <table class="w-full text-xs min-w-[680px]">
            <thead class="text-left text-ink-faint"><tr><th class="p-2">更新</th><th class="p-2">字段</th><th class="p-2 w-1/4">数据库值</th><th class="p-2 w-1/4">接口值</th><th class="p-2 w-1/3">待提交值</th></tr></thead>
            <tbody>
              <tr v-for="field in ['question', 'answer', 'question_en', 'answer_en', 'card_no_list']" :key="`${active.key}:${field}`" class="border-t border-card-border align-top">
                <td class="p-2">
                  <input v-if="active.before" v-model="active.selected" type="checkbox" :value="field"
                    :disabled="!activeState.changed.includes(field)" :aria-label="`更新 ${field}`" />
                  <span v-else>新增</span>
                </td>
                <td class="p-2">{{ field }}<span class="block text-ink-faint font-mono mt-1">{{ field }}</span></td>
                <td class="p-2 whitespace-pre-wrap break-all">
                  <QaRichText v-if="field === 'question' || field === 'answer'" :text="show(beforeValue(active, field))" />
                  <template v-else>{{ show(beforeValue(active, field)) }}</template>
                </td>
                <td class="p-2 whitespace-pre-wrap break-all">
                  <QaRichText v-if="field === 'question' || field === 'answer'" :text="show(incomingValue(active, field))" />
                  <template v-else>{{ show(incomingValue(active, field)) }}</template>
                </td>
                <td class="p-2">
                  <textarea :key="`${active.key}:${field}`" :value="inputValue(draftValue(active, field))"
                    :aria-label="`编辑 ${field}`" class="filter-select w-full min-h-[72px] font-mono text-xs"
                    @input="setField(active, field, $event)"></textarea>
                  <p v-if="inputErrors[inputKey(active, field)]" class="text-delta-down mt-1">{{ inputErrors[inputKey(active, field)] }}</p>
                  <p v-if="field === 'card_no_list' && active.draft.card_no_list.length" class="text-ink-faint mt-1">
                    {{ active.draft.card_no_list.map((n) => `${n} ${cardNoSet.has(n) ? '' : '(等待卡牌提交)'}`).join('、') }}
                  </p>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="flex items-center gap-4 mt-4">
          <button class="btn-brand px-4 py-2 text-xs" :disabled="!canAttempt(active)" @click="submit(active)">
            {{ active.before ? '提交勾选字段' : 'Insert 此条' }}
          </button>
          <p class="text-xs text-ink-faint">编辑内容会同时用于单条提交与批量提交。</p>
        </div>
        <p v-if="errors[active.key]" class="text-delta-down text-xs mt-3">{{ errors[active.key] }}</p>
      </div>

      <div class="card p-5 mt-5">
        <p class="text-sm font-semibold">批量提交</p>
        <p class="text-xs text-ink-muted mt-2">提交前会自动重查待提交卡牌；仍未入库的 QA 会保留并跳过。当前可直接提交 {{ readyCount }} 条。</p>
        <div class="flex gap-3 flex-wrap mt-4">
          <button class="btn-brand px-4 py-2 text-xs" :disabled="!attemptCount" @click="submit()">检查并提交选中 {{ attemptCount }} 条</button>
          <button class="btn-ghost px-4 py-2 text-xs" :disabled="busy" @click="rows.forEach((r) => (r.included = true))">全选</button>
          <label class="text-xs flex items-center gap-2"><input v-model="publish" type="checkbox" />提交后发布「问答」分类</label>
        </div>
      </div>
    </fieldset>

    <p v-if="busy" role="status" class="text-sm text-brand mt-4">提交中… {{ progress }}</p>
  </section>
</template>
