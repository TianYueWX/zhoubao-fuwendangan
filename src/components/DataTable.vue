<script setup lang="ts">
/**
 * DataTable.vue · 通用表格
 *  - 类型感知排序:number / percent / text
 *  - 内置防抖搜索(200ms)
 *  - 客户端分页
 *  - sticky 表头 + 行点击事件
 */
import { computed, nextTick, ref, watch } from 'vue';
import { useDebouncedRef } from '@/composables/useDebouncedRef';
import { compareSortValues, sortValue } from '@/composables/useTableSort';
import { useExportMeta } from '@/composables/useExportMeta';
import { downloadTableImage } from '@/utils/tableImage';
import type { TableColumn } from '@/types';

interface Props {
  rows: ReadonlyArray<Record<string, unknown>>;
  columns: ReadonlyArray<TableColumn>;
  searchPlaceholder?: string;
  emptyText?: string;
  maxHeight?: string;
  /** 每页行数;0 = 不分页 */
  pageSize?: number;
  searchable?: boolean;
  /** 长图导出的标题;为空则不显示「下载长图」按钮 */
  exportTitle?: string;
  exportNote?: string;
  exportEyebrow?: string;
}

const props = withDefaults(defineProps<Props>(), {
  searchPlaceholder: '搜索...',
  emptyText: '无数据',
  maxHeight: '600px',
  pageSize: 0,
  searchable: true,
  exportTitle: '',
  exportNote: '',
  exportEyebrow: ''
});

const emit = defineEmits<{
  (e: 'row-click', row: Record<string, unknown>): void;
}>();

const search = useDebouncedRef('', 200);
const sortKey = ref<string | null>(null);
const sortDir = ref<'asc' | 'desc'>('desc');
const page = ref(1);

function toRawVal(row: Record<string, unknown>, col: TableColumn): string | number {
  const v = col.render ? col.render(row) : row[col.key];
  if (v == null) return '';
  if (col.type === 'percent' && typeof v === 'string') {
    return parseFloat(v.replace('%', ''));
  }
  return v as string | number;
}

function toggleSort(col: TableColumn): void {
  if (!col.sortable) return;
  if (sortKey.value === col.key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
  } else {
    sortKey.value = col.key;
    sortDir.value = col.type === 'text' ? 'asc' : 'desc';
  }
}

const sortedRows = computed(() => {
  const arr = props.rows.slice();
  if (!sortKey.value) return arr;
  const col = props.columns.find((c) => c.key === sortKey.value);
  if (!col) return arr;
  const dir = sortDir.value === 'asc' ? 1 : -1;
  const type = col.type ?? 'text';
  arr.sort((a, b) =>
    compareSortValues(
      sortValue(toRawVal(a, col), type),
      sortValue(toRawVal(b, col), type),
      dir
    )
  );
  return arr;
});

const filteredRows = computed(() => {
  const q = String(search.value ?? '').trim().toLowerCase();
  if (!q) return sortedRows.value;
  return sortedRows.value.filter((r) =>
    Object.values(r).some((v) => String(v ?? '').toLowerCase().includes(q))
  );
});

/* ── 分页 ── */
const totalPages = computed(() =>
  props.pageSize > 0 ? Math.max(1, Math.ceil(filteredRows.value.length / props.pageSize)) : 1
);

const pagedRows = computed(() => {
  if (props.pageSize <= 0) return filteredRows.value;
  const start = (page.value - 1) * props.pageSize;
  return filteredRows.value.slice(start, start + props.pageSize);
});

watch([search, sortKey], () => {
  page.value = 1;
});
watch(totalPages, (t) => {
  if (page.value > t) page.value = t;
});

function goPage(p: number): void {
  page.value = Math.min(Math.max(1, p), totalPages.value);
}

/** 分页按钮范围(当前页 ±2) */
const pagerRange = computed<number[]>(() => {
  const t = totalPages.value;
  if (t <= 7) return Array.from({ length: t }, (_, i) => i + 1);
  const start = Math.max(1, Math.min(page.value - 2, t - 4));
  return Array.from({ length: 5 }, (_, i) => start + i);
});

/* ── 长图导出:临时挂载一张「全量行」离屏表,导出当前筛选+排序后的全部行 ── */
const exportMeta = useExportMeta();
const exporting = ref(false);
const exportTableEl = ref<HTMLTableElement | null>(null);

function alignClass(col: TableColumn): string {
  return col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left';
}

async function runExport(): Promise<void> {
  if (exporting.value) return;
  exporting.value = true;
  try {
    await nextTick();
    const el = exportTableEl.value;
    if (!el) return;
    await downloadTableImage(el, {
      eyebrow: props.exportEyebrow || undefined,
      title: props.exportTitle,
      note: props.exportNote || undefined,
      ...exportMeta.value
    });
  } catch (e: unknown) {
    window.alert(`导出图片失败:${e instanceof Error ? e.message : String(e)}`);
  } finally {
    exporting.value = false;
  }
}
</script>

<template>
  <div class="space-y-3">
    <div v-if="props.searchable || props.exportTitle" class="flex items-center gap-2">
      <input
        v-if="props.searchable"
        type="text"
        :value="search"
        @input="(e: Event) => (search = (e.target as HTMLInputElement).value)"
        :placeholder="props.searchPlaceholder"
        class="filter-select w-full !py-2 placeholder-ink-faint"
      />
      <button
        v-if="props.exportTitle"
        class="btn-ghost px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0"
        :disabled="exporting"
        :title="`把「${props.exportTitle}」当前筛选/排序后的全部 ${filteredRows.length} 行存成一张 PNG 长图`"
        @click="runExport"
      >
        <span aria-hidden="true">⤓</span>
        {{ exporting ? '生成中…' : '下载长图' }}
      </button>
    </div>
    <div class="overflow-x-auto" :style="{ maxHeight: props.maxHeight }">
      <table class="w-full text-sm">
        <thead class="sticky-thead">
          <tr class="text-ink-faint border-b border-panel-border text-xs">
            <th
              v-for="col in props.columns"
              :key="col.key"
              :class="[
                'py-2 px-2',
                col.align === 'right'
                  ? 'text-right'
                  : col.align === 'center'
                    ? 'text-center'
                    : 'text-left',
                col.sortable ? 'sortable' : '',
                col.sortable && sortKey === col.key ? 'sortable-active' : '',
                col.className ?? ''
              ]"
              :aria-sort="
                col.sortable
                  ? sortKey === col.key
                    ? sortDir === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : 'none'
                  : undefined
              "
              :tabindex="col.sortable ? 0 : undefined"
              :title="col.sortable ? `${col.label} · 点击排序` : undefined"
              @click="toggleSort(col)"
              @keydown.enter.prevent="toggleSort(col)"
              @keydown.space.prevent="toggleSort(col)"
            >
              {{ col.label }}
              <span
                v-if="sortKey === col.key"
                class="ml-1 text-xs"
              >{{ sortDir === 'asc' ? '↑' : '↓' }}</span>
            </th>
          </tr>
        </thead>
        <tbody class="text-ink-muted">
          <tr
            v-for="(row, idx) in pagedRows"
            :key="idx"
            class="table-row border-b border-[rgba(59,74,90,0.08)] cursor-pointer"
            @click="emit('row-click', row)"
          >
            <td
              v-for="col in props.columns"
              :key="col.key"
              :class="[
                'py-2 px-2',
                col.align === 'right'
                  ? 'text-right'
                  : col.align === 'center'
                    ? 'text-center'
                    : 'text-left'
              ]"
            >
              <slot :name="`cell-${col.key}`" :row="row" :value="toRawVal(row, col)">
                {{ toRawVal(row, col) }}
              </slot>
            </td>
          </tr>
          <tr v-if="filteredRows.length === 0">
            <td
              :colspan="props.columns.length"
              class="py-8 text-center text-ink-faint"
            >
              {{ props.emptyText }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 分页 -->
    <div
      v-if="props.pageSize > 0 && filteredRows.length > props.pageSize"
      class="flex items-center justify-between text-xs text-ink-faint"
    >
      <span>共 {{ filteredRows.length }} 行 · 第 {{ page }}/{{ totalPages }} 页</span>
      <div class="flex items-center gap-1">
        <button class="page-btn" :disabled="page <= 1" @click="goPage(page - 1)">‹</button>
        <button
          v-for="p in pagerRange"
          :key="p"
          class="page-btn"
          :class="{ 'page-btn-active': p === page }"
          @click="goPage(p)"
        >
          {{ p }}
        </button>
        <button class="page-btn" :disabled="page >= totalPages" @click="goPage(page + 1)">›</button>
      </div>
    </div>

    <!-- 离屏全量表:仅供长图导出取数(不参与布局,不进入无障碍树) -->
    <div
      v-if="exporting"
      class="fixed top-0 -left-[99999px] pointer-events-none"
      aria-hidden="true"
    >
      <table ref="exportTableEl" class="w-full text-sm">
        <thead>
          <tr>
            <th v-for="col in props.columns" :key="col.key" :class="alignClass(col)">
              {{ col.label }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, idx) in filteredRows" :key="idx">
            <td v-for="col in props.columns" :key="col.key" :class="alignClass(col)">
              <slot :name="`cell-${col.key}`" :row="row" :value="toRawVal(row, col)">
                {{ toRawVal(row, col) }}
              </slot>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.page-btn {
  min-width: 1.75rem;
  height: 1.75rem;
  padding: 0 0.4rem;
  border-radius: 0.5rem;
  font-size: 0.75rem;
  color: var(--color-text-muted);
  transition: all 0.15s;
}
.page-btn:hover:not(:disabled) {
  background: rgba(59, 74, 90, 0.08);
}
.page-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.page-btn-active {
  background: var(--color-brand);
  color: var(--color-brand-ink);
}
</style>
