<script setup lang="ts">
/**
 * SortableTh.vue · 可点击排序的表头单元格
 *
 * 与 composables/useTableSort.ts 配套:表头点击 / Enter / Space 触发排序,
 * 当前排序列高亮并显示 ↑↓,同时回写 aria-sort(屏幕阅读器可读)。
 * 只负责表头,不接管表格其余结构 —— 原生 <table> 可逐处替换 <th>。
 *
 * 用法:<SortableTh :sort="sort" col-key="rate" label="携带率" align="right" class-name="w-[26%]" />
 */
import { computed } from 'vue';
import type { SortController } from '@/composables/useTableSort';

interface Props {
  /** 列标题 */
  label: string;
  /** 列键(与 useTableSort 的列声明一致) */
  colKey: string;
  /** 排序控制器 */
  sort: SortController;
  /** 对齐;缺省 left */
  align?: 'left' | 'center' | 'right';
  /** 附加类名(宽度等) */
  className?: string;
}

const props = withDefaults(defineProps<Props>(), {
  align: 'left',
  className: ''
});

const sortable = computed(() => props.sort.isSortable(props.colKey));
const active = computed(() => props.sort.isActive(props.colKey));

const alignClass = computed(
  () =>
    ({ left: 'text-left', center: 'text-center', right: 'text-right' })[props.align]
);

function onSort(): void {
  if (sortable.value) props.sort.toggle(props.colKey);
}
</script>

<template>
  <th
    class="py-2 px-2"
    :class="[
      alignClass,
      props.className,
      sortable ? 'sortable' : '',
      sortable && active ? 'sortable-active' : ''
    ]"
    :aria-sort="sortable ? sort.ariaSort(colKey) : undefined"
    :tabindex="sortable ? 0 : undefined"
    :title="sortable ? `${label} · 点击排序` : undefined"
    @click="onSort"
    @keydown.enter.prevent="onSort"
    @keydown.space.prevent="onSort"
  >
    <slot>{{ label }}</slot>
    <span v-if="sortable && active" class="ml-1 text-xs" aria-hidden="true">
      {{ sort.indicator(colKey) }}
    </span>
  </th>
</template>

<style scoped>
th.sortable:focus-visible {
  outline: 2px solid var(--color-brand);
  outline-offset: -2px;
  border-radius: 2px;
}
</style>
