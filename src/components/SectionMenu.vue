<script setup lang="ts">
/**
 * SectionMenu.vue · 报头「栏目菜单」
 *
 * 报头左侧的下拉菜单:列出**当前栏目**的页面,一键在栏目内切换。
 *   − 期刊栏目:本期 / 往期 + 数据管理与 5 个分析工具
 *   − 其余栏目:该栏目下全部已登记工具(不只 inNav 的工具)
 *
 * 事实来源仍是 src/tools/catalog.ts:
 *   activeGroup 由当前视图派生 → toolsOf(group) 取条目。
 * 隐藏栏目(编辑部)未解锁时整块不渲染;需登录的栏目未过门禁时只留栏目首页,
 * 避免列出点了就撞门禁的死链。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Check, ChevronDown, Menu } from '@lucide/vue';
import { store } from '@/store/analysis';
import { navigate } from '@/router/hash';
import {
  activeGroupOf,
  groupOf,
  isGroupVisible,
  sectionMenuItems,
  type SectionMenuItem,
} from '@/tools/catalog';
import { editorialUnlocked } from '@/tools/editorialAccess';
import { isEditorialAdmin } from '@/tools/sources/auth';

/** bar = 全站报头(高 56px);compact = 自带顶栏的页面(构筑卡组) */
const props = withDefaults(defineProps<{ size?: "bar" | "compact" }>(), {
  size: "bar",
});

const open = ref(false);
const rootEl = ref<HTMLElement | null>(null);
const buttonEl = ref<HTMLButtonElement | null>(null);

const buttonClass = computed(() =>
  props.size === "compact"
    ? "flex items-center gap-1.5 h-10 text-[13px] text-ink-muted hover:text-brand transition-colors"
    : "flex items-center gap-1.5 h-14 text-sm text-ink-muted hover:text-brand transition-colors",
);

/** 当前所在栏目(内容层次级路由归档/期号正文归入期刊) */
const activeGroup = computed(() => activeGroupOf(store.currentView));

const group = computed(() =>
  activeGroup.value ? groupOf(activeGroup.value) : null,
);

const visible = computed(() => {
  const g = activeGroup.value;
  return !!g && isGroupVisible(g, editorialUnlocked.value);
});

const items = computed<SectionMenuItem[]>(() =>
  sectionMenuItems(store.currentView, {
    hasPackages: store.hasPackages,
    isEditorialAdmin: isEditorialAdmin.value,
  }),
);

function toggle(): void {
  open.value = !open.value;
}

function select(item: SectionMenuItem): void {
  open.value = false;
  navigate({ view: item.view });
}

function onPointerDown(e: PointerEvent): void {
  if (!open.value) return;
  const root = rootEl.value;
  if (root && !root.contains(e.target as Node)) open.value = false;
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && open.value) {
    open.value = false;
    buttonEl.value?.focus();
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('keydown', onKeydown);
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown);
  document.removeEventListener('keydown', onKeydown);
});

// 换页/换栏目即收起
watch(() => store.currentView, () => {
  open.value = false;
});
</script>

<template>
  <div
    v-if="group && visible && items.length"
    ref="rootEl"
    class="relative shrink-0"
  >
    <button
      ref="buttonEl"
      type="button"
      :class="buttonClass"
      aria-haspopup="menu"
      :aria-expanded="open"
      :title="`${group.label} · 页面切换`"
      @click="toggle"
    >
      <Menu :size="16" aria-hidden="true" />
      <span class="font-medium hidden sm:inline">{{ group.label }}</span>
      <ChevronDown
        :size="14"
        class="transition-transform"
        :class="open ? 'rotate-180' : ''"
        aria-hidden="true"
      />
    </button>

    <div
      v-if="open"
      role="menu"
      :aria-label="`${group.label}导航`"
      class="section-menu-pop absolute left-0 top-full z-50 min-w-[188px] py-1.5 rounded-lg border border-card-border bg-card-bg"
    >
      <button
        v-for="item in items"
        :key="item.key"
        type="button"
        role="menuitem"
        class="w-full flex items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors"
        :class="
          item.active
            ? 'text-brand font-semibold'
            : item.dimmed
              ? 'text-ink-faint hover:text-brand'
              : 'text-ink-muted hover:text-brand'
        "
        :title="item.title"
        @click="select(item)"
      >
        <Check v-if="item.active" :size="14" class="shrink-0" aria-hidden="true" />
        <span v-else class="w-[14px] shrink-0" aria-hidden="true"></span>
        <span class="min-w-0 truncate">{{ item.label }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.section-menu-pop {
  box-shadow: 0 14px 32px -18px var(--color-shadow);
  animation: sectionMenuIn 140ms ease-out;
}
@keyframes sectionMenuIn {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
