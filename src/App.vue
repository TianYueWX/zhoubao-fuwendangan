<script setup lang="ts">
/**
 * App.vue · 根组件(侧边栏仪表盘布局)
 *  - SidebarNav:左侧固定导航
 *  - FilterBar:全局范围过滤条(Top 阈值 / 英雄 / 城市 / 日期)
 *  - 内容区:7 个视图页面
 */
import { computed } from 'vue';
import { store, runStoredAnalysis, views, type ViewName } from '@/store/analysis';
import ThemeSwitcher from '@/components/ThemeSwitcher.vue';
import SidebarNav from '@/components/layout/SidebarNav.vue';
import FilterBar from '@/components/FilterBar.vue';
import { ViewComponents } from '@/components/view';

const activeViewComponent = computed(() => ViewComponents[store.currentView as ViewName]);

/** 移动端横向导航(<lg 时替代侧边栏) */
const mobileNav = computed(() =>
  views.map((v) => ({ ...v, disabled: v.id !== 'import' && !store.result }))
);
</script>

<template>
  <div class="flex min-h-screen">
    <SidebarNav />

    <div class="flex-1 flex flex-col min-w-0">
      <!-- 顶栏 -->
      <header
        class="sticky top-0 z-50 panel rounded-none border-x-0 border-t-0 backdrop-blur-xl"
      >
        <div class="px-6 py-3 flex items-center justify-between gap-4">
          <h1 class="text-sm font-bold text-slate-700 dark:text-gray-200 truncate">
            符文战场 · Meta 情报台
            <span class="hidden md:inline text-xs font-normal text-slate-400 ml-2"
              >Riftbound City Tournament Analytics</span
            >
          </h1>
          <div class="flex items-center gap-3 shrink-0">
            <button
              v-if="store.isReady && !store.result"
              @click="runStoredAnalysis()"
              :disabled="store.isAnalyzing"
              class="px-4 py-1.5 text-sm bg-neutral-900 hover:bg-neutral-700 dark:bg-neutral-100 dark:hover:bg-neutral-300 text-white dark:text-neutral-900 font-medium rounded-lg transition-all disabled:opacity-40 shadow"
            >
              🚀 启动分析
            </button>
            <span class="text-xs text-slate-400 hidden sm:inline">{{ store.statusLabel }}</span>
            <ThemeSwitcher />
          </div>
        </div>
      </header>

      <FilterBar />

      <!-- 移动端横向导航(<lg 替代侧边栏) -->
      <nav
        class="lg:hidden sticky top-[56px] z-40 panel rounded-none border-x-0 border-t-0 flex gap-1.5 overflow-x-auto px-4 py-2"
      >
        <button
          v-for="v in mobileNav"
          :key="v.id"
          :disabled="v.disabled"
          @click="store.currentView = v.id"
          :class="[
            'shrink-0 px-3 py-1.5 rounded-lg text-xs transition-all whitespace-nowrap',
            store.currentView === v.id
              ? 'tab-active font-medium'
              : v.disabled
                ? 'text-slate-300 dark:text-slate-700 cursor-not-allowed'
                : 'text-slate-500 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/5'
          ]"
        >
          {{ v.emoji }} {{ v.label }}
        </button>
      </nav>

      <main class="flex-1 px-4 lg:px-6 py-6">
        <component :is="activeViewComponent" />
      </main>

      <footer class="text-center py-5 text-[11px] text-slate-400 dark:text-slate-600">
        数据仅供竞技参考 · Riot Games 与本工具无关
      </footer>
    </div>
  </div>
</template>
