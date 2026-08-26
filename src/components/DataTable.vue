<script setup lang="ts">
/**
 * DataTable.vue · 通用表格
 *  - 类型感知排序:number / percent / text
 *  - 内置防抖搜索(200ms)
 *  - 客户端分页
 *  - sticky 表头 + 行点击事件
 */
import { computed, ref, watch } from 'vue';
import { useDebouncedRef } from '@/composables/useDebouncedRef';
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
}

const props = withDefaults(defineProps<Props>(), {
  searchPlaceholder: '搜索...',
  emptyText: '无数据',
  maxHeight: '600px',
  pageSize: 0,
  searchable: true
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
  arr.sort((a, b) => {
    const va = toRawVal(a, col);
    const vb = toRawVal(b, col);
    if (typeof va === 'number' && typeof vb === 'number') {
      return (va - vb) * dir;
    }
    const sa = String(va);
    const sb = String(vb);
    return sa.localeCompare(sb) * dir;
  });
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
</script>

<template>
  <div class="space-y-3">
    <input
      v-if="props.searchable"
      type="text"
      :value="search"
      @input="(e: Event) => (search = (e.target as HTMLInputElement).value)"
      :placeholder="props.searchPlaceholder"
      class="filter-select w-full !py-2 placeholder-slate-400 dark:placeholder-slate-500"
    />
    <div class="overflow-x-auto" :style="{ maxHeight: props.maxHeight }">
      <table class="w-full text-sm">
        <thead class="sticky-thead">
          <tr class="text-slate-500 dark:text-gray-400 border-b border-slate-200 dark:border-slate-700">
            <th
              v-for="col in props.columns"
              :key="col.key"
              :class="[
                'py-2 px-2 bg-white dark:bg-slate-900',
                col.align === 'right'
                  ? 'text-right'
                  : col.align === 'center'
                    ? 'text-center'
                    : 'text-left',
                col.sortable ? 'sortable' : '',
                col.className ?? ''
              ]"
              @click="toggleSort(col)"
            >
              {{ col.label }}
              <span
                v-if="sortKey === col.key"
                class="ml-1 text-xs"
              >{{ sortDir === 'asc' ? '↑' : '↓' }}</span>
            </th>
          </tr>
        </thead>
        <tbody class="text-slate-700 dark:text-gray-300">
          <tr
            v-for="(row, idx) in pagedRows"
            :key="idx"
            class="table-row border-b border-slate-100 dark:border-slate-800/50"
            :class="{ 'cursor-pointer': true }"
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
              class="py-8 text-center text-slate-400 dark:text-slate-600"
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
      class="flex items-center justify-between text-xs text-slate-500 dark:text-gray-400"
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
  background: rgba(0, 0, 0, 0.06);
}
html.dark .page-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
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
