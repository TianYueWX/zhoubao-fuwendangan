<script setup lang="ts">
/**
 * SidebarNav.vue · 左侧导航栏
 *  - 视图切换(数据导入 / Meta 总览 / 英雄拆解 / 单卡分析 / Combo / 地域 / 卡组浏览器)
 *  - 数据状态灯 + 品牌区
 */
import { computed } from 'vue';
import { store, views } from '@/store/analysis';

const navItems = computed(() =>
  views.map((v) => ({
    ...v,
    disabled: v.id !== 'import' && !store.result
  }))
);

const toneDot = computed(
  () =>
    ({
      idle: 'bg-yellow-400',
      ready: 'bg-green-500',
      busy: 'bg-blue-500 animate-pulse',
      error: 'bg-red-500'
    })[store.statusTone]
);
</script>

<template>
  <aside
    class="w-56 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl sticky top-0 h-screen flex flex-col"
  >
    <!-- 品牌 -->
    <div class="px-5 pt-5 pb-4">
      <div class="flex items-center gap-2.5">
        <div
          class="w-9 h-9 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 flex items-center justify-center font-bold shadow-lg"
        >
          R
        </div>
        <div class="leading-tight">
          <div class="text-sm font-bold text-slate-800 dark:text-white">符文战场</div>
          <div class="text-[11px] text-slate-400">Meta 情报台 v3</div>
        </div>
      </div>
    </div>

    <!-- 导航 -->
    <nav class="flex-1 px-3 space-y-1 overflow-y-auto">
      <button
        v-for="item in navItems"
        :key="item.id"
        :disabled="item.disabled"
        @click="store.currentView = item.id"
        :class="[
          'w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-all text-left',
          store.currentView === item.id
            ? 'tab-active font-medium shadow-md'
            : item.disabled
              ? 'text-slate-300 dark:text-slate-700 cursor-not-allowed'
              : 'text-slate-500 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/5'
        ]"
      >
        <span class="text-base leading-none">{{ item.emoji }}</span>
        {{ item.label }}
      </button>
    </nav>

    <!-- 状态 -->
    <div class="p-4 border-t border-slate-200 dark:border-slate-800">
      <div class="flex items-center gap-2 text-xs text-slate-500 dark:text-gray-400">
        <span :class="['w-2 h-2 rounded-full', toneDot]"></span>
        {{ store.statusLabel }}
      </div>
      <div v-if="store.result" class="mt-1 text-[11px] text-slate-400 dark:text-slate-600">
        {{ store.result.totalDecks }} 卡组 · {{ store.result.events.length || '?' }} 赛事
      </div>
    </div>
  </aside>
</template>
