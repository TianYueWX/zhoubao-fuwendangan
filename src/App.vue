<script setup lang="ts">
/**
 * App.vue · 根组件(符文档案·周报 报刊头版式)
 *  - 报头 Masthead(单条 sticky):衬线刊名 + 拉丁铭文 | 刊号行(真实日期区间) + 状态
 *  - FilterBar:全局范围条(周次选择,数据包可含一周或多周)
 *  - 内容区:杂志式留白,全宽(上限 1720px);总览即「头版」
 */
import { computed } from 'vue';
import { store, runStoredAnalysis, views, type ViewName } from '@/store/analysis';
import { getISOWeek } from '@/utils/isoWeek';
import FilterBar from '@/components/FilterBar.vue';
import { ViewComponents } from '@/components/view';

const activeViewComponent = computed(() => ViewComponents[store.currentView as ViewName]);

/** 栏目条:短标签(报刊栏目名),未载入数据时仅「数据」可入 */
const NAV_SHORT: Record<string, string> = {
  import: '数据',
  overview: '总览',
  heroes: '英雄',
  cards: '单卡',
  combo: 'Combo',
  legendary: '传奇',
  region: '地域',
  decks: '卡组'
};

const navItems = computed(() =>
  views.map((v) => ({
    ...v,
    short: NAV_SHORT[v.id] ?? v.label,
    disabled: v.id !== 'import' && !store.result
  }))
);

/** 刊号行:优先使用数据来源刊名(预设包),否则取数据包内最新 ISO 周 */
const issue = computed(() => {
  const r = store.result;
  const dates = r
    ? (r.events.map((e) => e.date).filter(Boolean) as string[]).sort()
    : [];
  const wk = dates.length ? getISOWeek(dates[dates.length - 1] ?? '') : null;
  const label =
    store.sourceLabel ||
    (wk ? `${wk.year}-W${String(wk.week).padStart(2, '0')}` : '');
  const range =
    dates.length >= 2 ? `${dates[0]} — ${dates[dates.length - 1]}` : dates[0] ?? '';
  return { label, range };
});
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <!-- 报头 + 栏目条(单块 sticky) -->
    <header class="masthead-solid sticky top-0 z-50 shrink-0">
      <!-- 第一行:刊名 + 刊号 -->
      <div class="px-4 lg:px-8 h-14 flex items-center gap-4">
        <div class="flex items-baseline gap-3 min-w-0">
          <h1 class="font-display text-[22px] font-black text-ink truncate">
            符文档案<span class="text-brand mx-0.5">·</span>周报
          </h1>
          <span
            class="hidden lg:inline font-latin text-[9px] tracking-[0.32em] text-ink-faint uppercase"
            >Riftbound Rune Archive</span
          >
        </div>

        <div class="ml-auto flex items-center gap-4 shrink-0">
          <span
            class="text-[11px] text-ink-faint tabular-nums truncate hidden sm:inline"
            :class="issue.label ? '' : 'opacity-60'"
          >
            <template v-if="issue.label">本期 {{ issue.label }}</template>
            <template v-else>未载入数据</template>
            <template v-if="issue.range"> · {{ issue.range }}</template>
          </span>
          <button
            v-if="store.isReady && !store.result"
            @click="runStoredAnalysis()"
            :disabled="store.isAnalyzing"
            class="btn-brand px-4 py-1.5 text-sm disabled:opacity-40"
          >
            {{ store.isAnalyzing ? '⏳ 分析中…' : '🚀 启动分析' }}
          </button>
          <span class="text-xs text-ink-faint hidden sm:inline">{{ store.statusLabel }}</span>
        </div>
      </div>

      <div class="hairline"></div>

      <!-- 第二行:纯文字栏目条 -->
      <nav class="px-4 lg:px-8 h-11 flex items-center gap-5 overflow-x-auto" aria-label="卷宗导航">
        <button
          v-for="v in navItems"
          :key="v.id"
          :disabled="v.disabled"
          @click="store.currentView = v.id"
          :title="v.label"
          :class="[
            'relative shrink-0 h-full px-1 transition-colors text-[13px] tracking-[0.08em]',
            store.currentView === v.id
              ? 'text-brand font-semibold'
              : v.disabled
                ? 'text-ink-faint/50 cursor-not-allowed'
                : 'text-ink-muted hover:text-brand'
          ]"
        >
          {{ v.short }}
          <span
            v-if="store.currentView === v.id"
            class="absolute left-0 right-0 bottom-0 h-[3px] bg-brand rounded-t-sm"
            aria-hidden="true"
          ></span>
        </button>
      </nav>

      <div class="hairline"></div>
    </header>

    <FilterBar />

    <!-- 周刊正文:杂志式留白,全宽 -->
    <main class="flex-1 w-full max-w-[1720px] mx-auto px-4 lg:px-8 py-8">
      <component :is="activeViewComponent" />
    </main>

    <!-- 页脚:档案落款 -->
    <footer class="px-4 lg:px-8 pb-8 max-w-[1720px] mx-auto w-full">
      <div class="rune-rule mb-5"></div>
      <div class="text-center text-[11px] text-ink-faint space-y-1">
        <p class="font-display">符文档案 · 周报 — Riftbound 城市挑战赛赛事 Meta 情报</p>
        <p>数据仅供竞技参考 · Riot Games 与本工具无关</p>
      </div>
    </footer>
  </div>
</template>
