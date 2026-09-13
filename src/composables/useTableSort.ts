/* ================================================================
 * src/composables/useTableSort.ts
 *
 * 原生 <table> 的表头点击排序(与 components/DataTable.vue 同口径):
 *   - 类型感知:number / percent / text
 *   - 首次点击按类型定方向(数字 ↓ 大在前 / 文本 ↑ 字典序),再点切换升降
 *   - 「无值」恒沉底:null / undefined / '' / '—' / NaN 不随升降翻转
 *   - 稳定排序 + 副本排序:不修改入参,未点击时即数据原始顺序
 *
 * 用法:
 *   const columns: readonly SortableColumn<Row>[] = [
 *     { key: 'name', type: 'text' },
 *     { key: 'rate', type: 'number', value: (r) => r.rate }
 *   ];
 *   const sort = useTableSort(rows, columns);
 *   // 模板:<SortableTh :sort="sort" col-key="rate" label="携带率" align="right" />
 * ============================================================== */
import { computed, ref, unref, type ComputedRef, type Ref } from 'vue';

export type TableSortType = 'text' | 'number' | 'percent';
export type TableSortDir = 'asc' | 'desc';

/** 可排序列声明(只描述怎么取值与怎么比,不涉及渲染) */
export interface SortableColumn<T> {
  /** 唯一键,与表头的 col-key 一致 */
  key: string;
  /** 排序类型;缺省 text */
  type?: TableSortType;
  /**
   * 取值器;缺省取 (row as Record<string, unknown>)[key]。
   * 返回 null / undefined / '' / '—' / NaN 视为「无值」,排序时恒沉底。
   */
  value?: (row: T) => unknown;
  /** false 时该列表头不响应点击(默认 true) */
  sortable?: boolean;
}

/** 表头组件只需要这组能力,避免把泛型带进 props */
export interface SortController {
  isSortable: (key: string) => boolean;
  isActive: (key: string) => boolean;
  ariaSort: (key: string) => 'ascending' | 'descending' | 'none';
  indicator: (key: string) => '' | '↑' | '↓';
  toggle: (key: string) => void;
}

export interface TableSort<T> extends SortController {
  sortKey: Ref<string | null>;
  sortDir: Ref<TableSortDir>;
  /** 排序后的副本(未指定排序列时 = 原始顺序) */
  sorted: ComputedRef<T[]>;
  /** 手动指定排序(null = 回到原始顺序) */
  setSort: (key: string | null, dir?: TableSortDir) => void;
}

/** 无值判定 */
function isBlank(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === 'number') return !Number.isFinite(v);
  const s = String(v).trim();
  return s === '' || s === '—' || s === '-' || s === '–';
}

/**
 * 排序取值:无值 → null(排序时恒沉底),数字/百分比 → number,文本 → string。
 * DataTable.vue 与本 composable 共用,保证两处排序口径一致。
 */
export function sortValue(v: unknown, type: TableSortType = 'text'): number | string | null {
  if (isBlank(v)) return null;
  if (type === 'text') return String(v);
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[%％]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** 统一比较器:无值恒沉底(不随升降翻转),数字按数值,其余按 localeCompare */
export function compareSortValues(
  a: number | string | null,
  b: number | string | null,
  dir: 1 | -1
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return (a - b) * dir;
  return String(a).localeCompare(String(b)) * dir;
}

/**
 * @param rows    源行(通常为 computed)
 * @param columns 列声明(普通数组或 ref 均可)
 */
export function useTableSort<T>(
  rows: Ref<readonly T[]> | ComputedRef<readonly T[]>,
  columns: readonly SortableColumn<T>[] | Ref<readonly SortableColumn<T>[]>
): TableSort<T> {
  const sortKey = ref<string | null>(null);
  const sortDir = ref<TableSortDir>('desc');

  const columnOf = (key: string): SortableColumn<T> | undefined =>
    unref(columns).find((c) => c.key === key);

  function isSortable(key: string): boolean {
    const col = columnOf(key);
    return !!col && col.sortable !== false;
  }

  function toggle(key: string): void {
    const col = columnOf(key);
    if (!col || col.sortable === false) return;
    if (sortKey.value === key) {
      sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
      return;
    }
    sortKey.value = key;
    sortDir.value = (col.type ?? 'text') === 'text' ? 'asc' : 'desc';
  }

  function setSort(key: string | null, dir?: TableSortDir): void {
    sortKey.value = key && isSortable(key) ? key : null;
    if (dir) sortDir.value = dir;
  }

  const sorted = computed<T[]>(() => {
    const arr = rows.value.slice();
    const key = sortKey.value;
    if (!key) return arr;
    const col = columnOf(key);
    if (!col) return arr;
    const type = col.type ?? 'text';
    const dir = sortDir.value === 'asc' ? 1 : -1;
    const pick = (row: T): unknown =>
      col.value ? col.value(row) : (row as Record<string, unknown>)[key];

    arr.sort((a, b) => {
      const va = sortValue(pick(a), type);
      const vb = sortValue(pick(b), type);
      return compareSortValues(va, vb, dir);
    });
    return arr;
  });

  return {
    sortKey,
    sortDir,
    sorted,
    setSort,
    toggle,
    isSortable,
    isActive: (key) => sortKey.value === key,
    ariaSort: (key) =>
      sortKey.value !== key ? 'none' : sortDir.value === 'asc' ? 'ascending' : 'descending',
    indicator: (key) => (sortKey.value !== key ? '' : sortDir.value === 'asc' ? '↑' : '↓')
  };
}
