<script setup lang="ts">
/**
 * AdminBatchOps.vue · 批量校勘(P2)
 *
 * 对应后台「方案 B · 表格化批量运维」。
 *
 * 与后台的差异(遵循站点风格规范):
 *   - 批量操作配置不弹模态框,改为**表格上方的内联批注条**;
 *     翻页/排序遇脏行也不弹窗,改用就地确认条。
 *   - 脏行不用黄色背景,改为藤黄 8% 底 + 左侧 2px 藤黄竖线
 *     (规范:层级靠排版与细线承载,不靠色块)。
 *
 * 保持不变的核心逻辑:
 *   - 行内编辑,保存只提交变更字段
 *   - ±N 按「目标绝对值相同」分组,每组一次 .in() 请求
 *   - 执行前给差异预览;失败行保留勾选以便重试
 *   - 可选「同时发布」触碰 version.cards
 */
import { computed, onMounted, reactive, ref, watch } from 'vue';
import EditorialShell from './EditorialShell.vue';
import AdminPager from './AdminPager.vue';
import SectionHeading from '../SectionHeading.vue';
import { debounce } from '@/utils/debounce';
import { errorText, notifyError, notifyOk, notifyWarn } from '@/tools/admin/notice';
import { publishCards, loadRarityOptions, loadSeriesOptions, type SeriesOption } from '@/tools/admin/cards';
import {
  changedBatchFields,
  deltaPreview,
  deltaWarnings,
  groupByDelta,
  listBatchRows,
  saveRow,
  updateMany,
  valuePreview,
  type BatchRow,
  type SortField
} from '@/tools/admin/batch';
import { deckLimitLabel, modeToDeckLimit, type DeckMode } from '@/tools/admin/types';

const PAGE_SIZE = 20;

/* ──────────────────────── 行模型 ──────────────────────── */

interface Row {
  id: string;
  data: BatchRow;
  orig: BatchRow;
}

const rows = ref<Row[]>([]);
const total = ref<number | null>(null);
const loading = ref(false);

const search = ref('');
const filterSeries = ref('');
const filterRarity = ref('');
const sortField = ref<SortField>('card_no');
const sortAsc = ref(true);
const page = ref(1);

const seriesOptions = ref<SeriesOption[]>([]);
const rarityOptions = ref<string[]>([]);

function toRow(raw: BatchRow): Row {
  const d = JSON.parse(JSON.stringify(raw)) as BatchRow;
  return { id: raw.id, data: d, orig: JSON.parse(JSON.stringify(raw)) as BatchRow };
}

async function loadRows(restoreIds: string[] = []): Promise<void> {
  loading.value = true;
  try {
    const res = await listBatchRows({
      search: search.value,
      series: filterSeries.value,
      rarity: filterRarity.value,
      sortField: sortField.value,
      sortAsc: sortAsc.value,
      page: page.value,
      pageSize: PAGE_SIZE
    });
    rows.value = res.rows.map(toRow);
    total.value = res.total;
    // 失败行若仍在当前页,恢复勾选以便重试
    if (restoreIds.length) {
      selected.value = new Set(restoreIds.filter((id) => rows.value.some((r) => r.id === id)));
    }
  } catch (e) {
    notifyError(`加载失败:${errorText(e)}`);
    rows.value = [];
    total.value = null;
  } finally {
    loading.value = false;
  }
}

/* ──────────────────────── 脏行与就地确认 ──────────────────────── */

function isDirty(row: Row): boolean {
  return Object.keys(changedBatchFields(row.orig, row.data)).length > 0;
}
const dirtyCount = computed(() => rows.value.filter(isDirty).length);

/** 挂起的导航动作:存在脏行时先就地确认再执行 */
const pendingNav = ref<{ label: string; run: () => void } | null>(null);

function guardDirty(label: string, run: () => void): void {
  if (!dirtyCount.value) {
    run();
    return;
  }
  pendingNav.value = { label, run };
}

function discardAndContinue(): void {
  const p = pendingNav.value;
  pendingNav.value = null;
  rows.value.forEach((r) => (r.data = JSON.parse(JSON.stringify(r.orig)) as BatchRow));
  p?.run();
}

function revertRow(row: Row): void {
  row.data = JSON.parse(JSON.stringify(row.orig)) as BatchRow;
}

async function saveOne(row: Row): Promise<void> {
  const patch = changedBatchFields(row.orig, row.data);
  if (!Object.keys(patch).length) return;
  busyRow.value = row.id;
  try {
    const res = await saveRow(row.id, patch);
    if (!res.ok) throw new Error('未被写入(0 行受影响)');
    row.orig = JSON.parse(JSON.stringify(row.data)) as BatchRow;
    notifyOk(`已保存「${row.data.card_no ?? row.id}」的 ${res.changed} 个字段`);
  } catch (e) {
    notifyError(`保存失败:${errorText(e)}`);
  } finally {
    busyRow.value = null;
  }
}

const busyRow = ref<string | null>(null);

/* ──────────────────────── 行内编辑 ──────────────────────── */

const editing = reactive<{ id: string | null; field: string | null }>({ id: null, field: null });

function isEditing(id: string, field: string): boolean {
  return editing.id === id && editing.field === field;
}
function startEdit(id: string, field: string): void {
  editing.id = id;
  editing.field = field;
}
function stopEdit(): void {
  editing.id = null;
  editing.field = null;
}

/** 数值字段:清空给 '' 时必须归成 null,否则写进 int 列会被拒 */
function setNum(row: Row, field: 'energy' | 'return_energy' | 'power', v: string): void {
  const n = v === '' ? null : Number(v);
  row.data[field] = n === null || Number.isNaN(n) ? null : n;
}

function setText(row: Row, field: 'card_no' | 'card_name_cn' | 'card_name_en', v: string): void {
  row.data[field] = v;
}

function setStr(row: Row, field: 'rarity_name' | 'series_name', v: string): void {
  row.data[field] = v === '' ? null : v;
}

/* ──────────────────────── 排序 ──────────────────────── */

function toggleSort(f: SortField): void {
  guardDirty('切换排序', () => {
    if (sortField.value === f) sortAsc.value = !sortAsc.value;
    else {
      sortField.value = f;
      sortAsc.value = true;
    }
    page.value = 1;
    void loadRows();
  });
}

/* ──────────────────────── 筛选与分页 ──────────────────────── */

const debouncedSearch = debounce(() => {
  guardDirty('搜索', () => {
    page.value = 1;
    void loadRows();
  });
}, 320);

function onFilterChange(): void {
  guardDirty('切换筛选', () => {
    page.value = 1;
    void loadRows();
  });
}

watch(page, (next, prev) => {
  if (pendingNav.value) return;
  if (!dirtyCount.value) return;
  // 页码已被 AdminPager 改动;拦下来先问,确认后才真正拉数据
  page.value = prev;
  pendingNav.value = { label: `跳到第 ${next} 页`, run: () => (page.value = next) };
});

/* ──────────────────────── 批量操作 ──────────────────────── */

const selected = ref<Set<string>>(new Set());
const selectedCount = computed(() => selected.value.size);
const allChecked = computed(
  () => rows.value.length > 0 && rows.value.every((r) => selected.value.has(r.id))
);

function toggleAll(): void {
  selected.value = allChecked.value ? new Set() : new Set(rows.value.map((r) => r.id));
}
function toggleOne(id: string): void {
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}

type OpId = 'ban' | 'deck' | 'num' | 'series';

const OP_LABEL: Record<OpId, string> = {
  ban: '批量设禁限',
  deck: '批量改构筑上限',
  num: '批量调整数值',
  series: '批量改所属系列'
};

const op = ref<OpId | null>(null);
const publishTogether = ref(false);
const executing = ref(false);

const banValue = ref(true);
const deckMode = ref<DeckMode>('default');
const deckN = ref(1);
const numField = ref<'energy' | 'return_energy' | 'power'>('energy');
const numDelta = ref(0);
const batchSeries = ref('');

const NUM_LABEL: Record<string, string> = {
  energy: '能量',
  return_energy: '返还能量',
  power: '战力'
};

function openOp(id: OpId): void {
  if (!selectedCount.value) {
    notifyWarn('请先勾选要处理的行');
    return;
  }
  if (dirtyCount.value) {
    notifyWarn('当前页有未保存的修改,请先保存或回退后再执行批量操作');
    return;
  }
  op.value = id;
}

function closeOp(): void {
  op.value = null;
}

/** 差异预览:影响行数 + 分组摘要 */
const preview = computed<{ affected: number; groups: { label: string; count: number }[] } | null>(
  () => {
    const ids = [...selected.value];
    if (!op.value || !ids.length) return null;
    const byId = new Map(rows.value.map((r) => [r.id, r.data]));

    if (op.value === 'num') {
      const current = new Map<string, number | null>(
        ids.map((id) => [id, byId.get(id)?.[numField.value] ?? null])
      );
      return {
        affected: ids.length,
        groups: deltaPreview(groupByDelta(current, ids, numDelta.value), NUM_LABEL[numField.value]!)
      };
    }
    const label =
      op.value === 'ban'
        ? `禁用 → ${banValue.value ? '是' : '否'}`
        : op.value === 'deck'
          ? `构筑上限 → ${deckLimitLabel(modeToDeckLimit(deckMode.value, deckN.value))}`
          : `所属系列 → ${batchSeries.value || '（清空）'}`;
    return { affected: ids.length, groups: valuePreview(label, ids.length) };
  }
);

/** 预览里需要显式提示的边界情形(纯函数,见 batchLogic.ts) */
const previewNotes = computed<string[]>(() => {
  if (op.value !== 'num') return [];
  const ids = [...selected.value];
  const byId = new Map(rows.value.map((r) => [r.id, r.data]));
  const current = new Map<string, number | null>(
    ids.map((id) => [id, byId.get(id)?.[numField.value] ?? null])
  );
  return deltaWarnings(current, ids, numDelta.value);
});

async function execute(): Promise<void> {
  if (!op.value || !selectedCount.value) return;
  const ids = [...selected.value];
  executing.value = true;
  let failed: string[] = [];
  try {
    if (op.value === 'num') {
      const byId = new Map(rows.value.map((r) => [r.id, r.data]));
      const current = new Map<string, number | null>(
        ids.map((id) => [id, byId.get(id)?.[numField.value] ?? null])
      );
      // 按目标绝对值分组,每组一次请求
      for (const g of groupByDelta(current, ids, numDelta.value)) {
        const res = await updateMany(g.ids, {
          [numField.value]: g.target,
          updated_at: new Date().toISOString()
        });
        failed.push(...res.failedIds);
      }
    } else {
      const patch: Record<string, unknown> =
        op.value === 'ban'
          ? { is_banned: banValue.value }
          : op.value === 'deck'
            ? { deck_limit: modeToDeckLimit(deckMode.value, deckN.value) }
            : { series_name: batchSeries.value || null };
      const res = await updateMany(ids, { ...patch, updated_at: new Date().toISOString() });
      failed = res.failedIds;
    }

    if (publishTogether.value && !failed.length) {
      await publishCards();
    }

    if (!failed.length) {
      notifyOk(
        `批量操作完成(${ids.length} 行)${publishTogether.value ? ',已发布' : ''}`,
        publishTogether.value ? 'version.cards 已触碰' : undefined
      );
      selected.value = new Set();
      op.value = null;
      await loadRows();
    } else {
      notifyError(
        `${failed.length} 行未能写入`,
        '已保留这些行的勾选,排除原因后可直接重试'
      );
      op.value = null;
      await loadRows(failed);
    }
  } catch (e) {
    notifyError(`批量操作异常:${errorText(e)}`);
  } finally {
    executing.value = false;
  }
}

/* ──────────────────────── 启动 ──────────────────────── */

onMounted(async () => {
  await loadRows();
  try {
    const [series, rarity] = await Promise.all([loadSeriesOptions(), loadRarityOptions()]);
    seriesOptions.value = series;
    rarityOptions.value = rarity;
  } catch (e) {
    notifyWarn(`筛选项加载失败:${errorText(e)}`);
  }
});
</script>

<template>
  <EditorialShell code="editorial-batch">
    <div class="max-w-[1720px] mx-auto">
      <!-- ══════════ 刊头 ══════════ -->
      <header class="mb-7">
        <h1 class="font-display font-black text-ink leading-tight text-[28px] lg:text-[38px]">
          批量校勘
        </h1>
        <div class="hairline mt-7"></div>
      </header>

      <!-- ══════════ 检索与批量工具栏 ══════════ -->
      <div class="flex items-center gap-2.5 flex-wrap mb-4">
        <input
          v-model="search"
          placeholder="卡号 / 中文名 / 英文名"
          class="filter-select w-[220px]"
          @input="debouncedSearch"
        />
        <select v-model="filterSeries" class="filter-select w-[140px]" @change="onFilterChange">
          <option value="">全部系列</option>
          <option v-for="s in seriesOptions" :key="s.code" :value="s.code">
            {{ s.name_cn || s.code }}
          </option>
        </select>
        <select v-model="filterRarity" class="filter-select w-[130px]" @change="onFilterChange">
          <option value="">全部稀有度</option>
          <option v-for="r in rarityOptions" :key="r" :value="r">{{ r }}</option>
        </select>

        <span class="text-[11px] text-ink-faint tabular-nums">
          {{ total === null ? '' : `${total} 行` }}
          <template v-if="dirtyCount">
            · <span class="text-accent">{{ dirtyCount }} 行待保存</span>
          </template>
        </span>

        <span class="flex-1"></span>

        <template v-if="selectedCount">
          <span class="text-[11px] text-brand font-semibold tabular-nums">
            已选 {{ selectedCount }} 行
          </span>
          <div class="flex rounded-lg overflow-hidden border border-card-border">
            <button
              v-for="(label, id) in OP_LABEL"
              :key="id"
              class="px-3 py-1.5 text-xs text-ink-muted hover:text-brand transition-colors border-l border-card-border first:border-l-0"
              :class="{ 'tab-active': op === id }"
              @click="openOp(id as OpId)"
            >
              {{ label }}
            </button>
          </div>
          <button class="text-[12px] text-ink-faint hover:text-brand transition-colors" @click="selected = new Set()">
            清空选择
          </button>
        </template>
      </div>

      <!-- ══════════ 就地确认条(脏行拦截) ══════════ -->
      <div
        v-if="pendingNav"
        class="flex items-center gap-3 flex-wrap mb-4 pl-3 border-l-2 border-accent"
      >
        <span class="text-[13px] text-ink-muted">
          {{ pendingNav.label }}将丢弃 {{ dirtyCount }} 行的未保存修改
        </span>
        <button class="text-[12px] font-semibold text-brand hover:underline" @click="discardAndContinue">
          丢弃并继续
        </button>
        <button
          class="text-[12px] text-ink-faint hover:text-ink-muted"
          @click="pendingNav = null"
        >
          取消
        </button>
      </div>

      <!-- ══════════ 批量操作批注条(内联面板) ══════════ -->
      <div v-if="op && preview" class="card p-5 mb-5">
        <div class="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <span class="text-xs font-semibold">批量操作 · {{ OP_LABEL[op] }}</span>
            <p class="text-[11px] text-ink-faint mt-1.5">
              影响 {{ preview.affected }} 行;确认无误后执行
            </p>
          </div>
          <button class="text-[12px] text-ink-faint hover:text-brand" @click="closeOp">收起</button>
        </div>

        <!-- 操作参数 -->
        <div class="flex items-center gap-3 flex-wrap mt-4">
          <template v-if="op === 'ban'">
            <div class="flex rounded-lg overflow-hidden border border-card-border">
              <button
                class="px-3 py-1.5 text-xs border-l border-card-border first:border-l-0 transition-colors"
                :class="banValue ? 'tab-active' : 'text-ink-muted hover:text-brand'"
                @click="banValue = true"
              >
                设为禁用
              </button>
              <button
                class="px-3 py-1.5 text-xs border-l border-card-border transition-colors"
                :class="!banValue ? 'tab-active' : 'text-ink-muted hover:text-brand'"
                @click="banValue = false"
              >
                设为启用
              </button>
            </div>
          </template>

          <template v-else-if="op === 'deck'">
            <div class="flex rounded-lg overflow-hidden border border-card-border">
              <button
                v-for="o in ([
                  { id: 'default', label: '默认 3 张' },
                  { id: 'unlimited', label: '不限' },
                  { id: 'limited', label: '限 N 张' }
                ] as const)"
                :key="o.id"
                class="px-3 py-1.5 text-xs border-l border-card-border first:border-l-0 transition-colors"
                :class="deckMode === o.id ? 'tab-active' : 'text-ink-muted hover:text-brand'"
                @click="deckMode = o.id"
              >
                {{ o.label }}
              </button>
            </div>
            <input
              v-if="deckMode === 'limited'"
              v-model.number="deckN"
              type="number"
              min="1"
              class="filter-select w-[70px] tabular-nums"
            />
          </template>

          <template v-else-if="op === 'num'">
            <select v-model="numField" class="filter-select w-[120px]">
              <option value="energy">能量</option>
              <option value="return_energy">返还能量</option>
              <option value="power">战力</option>
            </select>
            <input v-model.number="numDelta" type="number" class="filter-select w-[80px] tabular-nums" />
            <span class="text-[11px] text-ink-faint">在当前值上加减</span>
          </template>

          <template v-else-if="op === 'series'">
            <select v-model="batchSeries" class="filter-select w-[180px]">
              <option value="">（清空系列）</option>
              <option v-for="s in seriesOptions" :key="s.code" :value="s.code">
                {{ s.name_cn || s.code }}
              </option>
            </select>
          </template>
        </div>

        <!-- 差异预览 -->
        <div class="mt-5 pt-4 border-t border-panel-border">
          <p class="text-[10px] tracking-[0.16em] text-ink-faint mb-2.5">变更差异预览</p>
          <div class="flex items-center gap-3 flex-wrap">
            <span
              v-for="g in preview.groups"
              :key="g.label"
              class="text-[12px] text-ink-muted px-2 py-1 rounded border border-card-border tabular-nums"
            >
              {{ g.label }} · <b class="font-semibold">{{ g.count }}</b> 行
            </span>
          </div>
          <ul v-if="previewNotes.length" class="mt-3 space-y-1">
            <li v-for="n in previewNotes" :key="n" class="text-[11px] text-accent">注意 · {{ n }}</li>
          </ul>
        </div>

        <div class="flex items-center justify-between gap-4 flex-wrap mt-5">
          <label class="flex items-center gap-2 text-[12px] text-ink-muted">
            <input v-model="publishTogether" type="checkbox" class="accent-[var(--color-brand)]" />
            同时发布(触碰 version.cards)
          </label>
          <div class="flex items-center gap-3">
            <button class="btn-ghost px-3 py-1.5 text-xs" @click="closeOp">取消</button>
            <button class="btn-brand px-4 py-1.5 text-xs" :disabled="executing" @click="execute">
              {{ executing ? '执行中…' : `执行(${preview.affected} 行)` }}
            </button>
          </div>
        </div>
      </div>

      <!-- ══════════ 表格 ══════════ -->
      <SectionHeading
        plain
        small
        title="卡牌总表"
        note="点击表头排序;点击单元格编辑;仅标量字段可改,数组与长文本请到卡牌校勘"
      />

      <div class="border border-card-border rounded-xl overflow-x-auto">
        <table class="w-full text-sm min-w-[1240px]">
          <thead class="sticky-thead text-[11px] text-ink-faint">
            <tr class="border-b border-card-border">
              <th class="px-2.5 py-2 w-[40px]">
                <input
                  type="checkbox"
                  class="accent-[var(--color-brand)]"
                  :checked="allChecked"
                  title="全选本页"
                  @change="toggleAll"
                />
              </th>
              <th
                v-for="col in ([
                  { key: 'card_no', label: '卡号', w: '110px' },
                  { key: 'card_name_cn', label: '中文名', w: '150px' },
                  { key: 'card_name_en', label: '英文名', w: '150px' },
                  { key: 'energy', label: '能量', w: '80px' },
                  { key: 'return_energy', label: '返还能量', w: '90px' },
                  { key: 'power', label: '战力', w: '80px' },
                  { key: 'rarity_name', label: '稀有度', w: '110px' },
                  { key: 'series_name', label: '系列', w: '120px' }
                ] as const)"
                :key="col.key"
                class="px-2.5 py-2 text-left font-normal"
                :style="{ width: col.w }"
              >
                <button
                  class="sortable inline-flex items-center gap-1"
                  :class="{ 'sortable-active': sortField === col.key }"
                  @click="toggleSort(col.key)"
                >
                  {{ col.label }}
                  <span v-if="sortField === col.key" class="text-[9px]">{{ sortAsc ? '▲' : '▼' }}</span>
                </button>
              </th>
              <th class="px-2.5 py-2 text-left font-normal w-[100px]">构筑上限</th>
              <th class="px-2.5 py-2 text-center font-normal w-[70px]">禁用</th>
              <th class="px-2.5 py-2 text-right font-normal w-[130px]">操作</th>
            </tr>
          </thead>
          <tbody :class="{ 'opacity-50': loading }">
            <tr
              v-for="row in rows"
              :key="row.id"
              class="border-b border-panel-border/30 last:border-0"
              :class="isDirty(row) ? 'dirty-row' : 'table-row'"
            >
              <td class="px-2.5 py-1.5">
                <input
                  type="checkbox"
                  class="accent-[var(--color-brand)]"
                  :checked="selected.has(row.id)"
                  @change="toggleOne(row.id)"
                />
              </td>

              <!-- 卡号 -->
              <td class="px-2.5 py-1.5">
                <input
                  v-if="isEditing(row.id, 'card_no')"
                  :value="row.data.card_no ?? ''"
                  class="filter-select w-full font-mono"
                  @input="setText(row, 'card_no', ($event.target as HTMLInputElement).value)"
                  @blur="stopEdit"
                  @keyup.enter="stopEdit"
                />
                <button
                  v-else
                  class="w-full text-left font-mono text-[12px] hover:text-brand transition-colors"
                  @click="startEdit(row.id, 'card_no')"
                >
                  {{ row.data.card_no || '—' }}
                </button>
              </td>

              <!-- 中文名 -->
              <td class="px-2.5 py-1.5">
                <input
                  v-if="isEditing(row.id, 'card_name_cn')"
                  :value="row.data.card_name_cn ?? ''"
                  class="filter-select w-full"
                  @input="setText(row, 'card_name_cn', ($event.target as HTMLInputElement).value)"
                  @blur="stopEdit"
                  @keyup.enter="stopEdit"
                />
                <button
                  v-else
                  class="w-full text-left text-[13px] hover:text-brand transition-colors truncate"
                  @click="startEdit(row.id, 'card_name_cn')"
                >
                  {{ row.data.card_name_cn || '—' }}
                </button>
              </td>

              <!-- 英文名 -->
              <td class="px-2.5 py-1.5">
                <input
                  v-if="isEditing(row.id, 'card_name_en')"
                  :value="row.data.card_name_en ?? ''"
                  class="filter-select w-full"
                  @input="setText(row, 'card_name_en', ($event.target as HTMLInputElement).value)"
                  @blur="stopEdit"
                  @keyup.enter="stopEdit"
                />
                <button
                  v-else
                  class="w-full text-left text-[13px] hover:text-brand transition-colors truncate"
                  @click="startEdit(row.id, 'card_name_en')"
                >
                  {{ row.data.card_name_en || '—' }}
                </button>
              </td>

              <!-- 三个数值 -->
              <td v-for="f in (['energy', 'return_energy', 'power'] as const)" :key="f" class="px-2.5 py-1.5">
                <input
                  v-if="isEditing(row.id, f)"
                  type="number"
                  :value="row.data[f] ?? ''"
                  class="filter-select w-full text-right tabular-nums"
                  @input="setNum(row, f, ($event.target as HTMLInputElement).value)"
                  @blur="stopEdit"
                  @keyup.enter="stopEdit"
                />
                <button
                  v-else
                  class="w-full text-right tabular-nums hover:text-brand transition-colors"
                  @click="startEdit(row.id, f)"
                >
                  {{ row.data[f] ?? '—' }}
                </button>
              </td>

              <!-- 稀有度 -->
              <td class="px-2.5 py-1.5">
                <select
                  :value="row.data.rarity_name ?? ''"
                  class="filter-select w-full"
                  @change="setStr(row, 'rarity_name', ($event.target as HTMLSelectElement).value)"
                >
                  <option value="">—</option>
                  <option v-for="r in rarityOptions" :key="r" :value="r">{{ r }}</option>
                </select>
              </td>

              <!-- 系列 -->
              <td class="px-2.5 py-1.5">
                <select
                  :value="row.data.series_name ?? ''"
                  class="filter-select w-full"
                  @change="setStr(row, 'series_name', ($event.target as HTMLSelectElement).value)"
                >
                  <option value="">—</option>
                  <option v-for="s in seriesOptions" :key="s.code" :value="s.code">
                    {{ s.name_cn || s.code }}
                  </option>
                </select>
              </td>

              <td class="px-2.5 py-1.5 text-[12px] text-ink-faint">
                {{ deckLimitLabel(row.data.deck_limit) }}
              </td>

              <td class="px-2.5 py-1.5 text-center">
                <input
                  type="checkbox"
                  class="accent-[var(--color-brand)]"
                  :checked="row.data.is_banned"
                  @change="row.data.is_banned = ($event.target as HTMLInputElement).checked"
                />
              </td>

              <td class="px-2.5 py-1.5">
                <div class="flex items-center justify-end gap-3">
                  <button
                    class="text-[12px] text-brand hover:underline disabled:opacity-40 disabled:no-underline"
                    :disabled="!isDirty(row) || busyRow === row.id"
                    @click="saveOne(row)"
                  >
                    保存
                  </button>
                  <button
                    class="text-[12px] text-ink-faint hover:text-brand transition-colors disabled:opacity-40"
                    :disabled="!isDirty(row)"
                    @click="revertRow(row)"
                  >
                    回退
                  </button>
                </div>
              </td>
            </tr>

            <tr v-if="!rows.length && !loading">
              <td colspan="13" class="px-3 py-8 text-center text-xs text-ink-faint">
                没有匹配的卡牌
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="mt-3">
        <AdminPager v-model:page="page" :page-size="PAGE_SIZE" :total="total" :disabled="loading" />
      </div>
    </div>
  </EditorialShell>
</template>

<style scoped>
/* 脏行:藤黄 8% 底 + 左侧 2px 藤黄竖线(规范:层级靠细线,不靠色块) */
table :deep(.dirty-row > td) {
  background: rgba(197, 155, 70, 0.08);
}
table :deep(.dirty-row > td:first-child) {
  box-shadow: inset 2px 0 0 var(--color-accent);
}
table :deep(.dirty-row:hover > td) {
  background: rgba(197, 155, 70, 0.14);
}
</style>
