<script setup lang="ts">
/**
 * AdminPager.vue · 服务端分页控件
 *
 * 与 DataTable 的客户端分页同规格(28px 方形、8px 圆角、激活朱砂),
 * 区别是本组件不持有数据 —— 翻页只 emit,由视图去请求下一页。
 */
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    page: number;
    pageSize: number;
    /** null = 服务端未返回总数,此时只显示前后翻页 */
    total: number | null;
    disabled?: boolean;
  }>(),
  { disabled: false }
);

const emit = defineEmits<{ (e: 'update:page', v: number): void }>();

const totalPages = computed(() =>
  props.total === null ? null : Math.max(1, Math.ceil(props.total / props.pageSize))
);

/** 最多 5 个页码,当前页居中(与 DataTable 同策略) */
const pagerRange = computed<number[]>(() => {
  const t = totalPages.value;
  if (t === null) return [];
  const count = Math.min(5, t);
  const start = Math.max(1, Math.min(props.page - 2, t - count + 1));
  return Array.from({ length: count }, (_, i) => start + i);
});

function go(p: number): void {
  if (props.disabled) return;
  const max = totalPages.value ?? Number.POSITIVE_INFINITY;
  const next = Math.min(Math.max(1, p), max);
  if (next !== props.page) emit('update:page', next);
}
</script>

<template>
  <div class="flex items-center justify-between gap-3 text-xs text-ink-faint flex-wrap">
    <span class="tabular-nums">
      <template v-if="total !== null">
        共 {{ total }} 行 · 第 {{ page }}/{{ totalPages }} 页
      </template>
      <template v-else>第 {{ page }} 页</template>
    </span>
    <div class="flex items-center gap-1">
      <button class="page-btn" :disabled="disabled || page <= 1" title="上一页" @click="go(page - 1)">
        ‹
      </button>
      <button
        v-for="p in pagerRange"
        :key="p"
        class="page-btn"
        :class="{ 'page-btn-active': p === page }"
        :disabled="disabled"
        @click="go(p)"
      >
        {{ p }}
      </button>
      <button
        class="page-btn"
        :disabled="disabled || (totalPages !== null && page >= totalPages)"
        title="下一页"
        @click="go(page + 1)"
      >
        ›
      </button>
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
