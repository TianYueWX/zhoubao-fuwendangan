<script setup lang="ts">
/**
 * App.vue · 根组件(符文档案·周报 报刊头版式)
 *  - 报头 Masthead(单行 sticky):刊名(点击回总览,完整刊号入 tooltip)+ 栏目导航 + 范围(周次/数量)
 *  - 内容区:杂志式留白,全宽(上限 1720px);总览即「头版」
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  store,
  runStoredAnalysis,
  loadCardData,
  applyGlobalFilters,
  weekBuckets,
  views,
  type ViewName
} from '@/store/analysis';
import { getISOWeek } from '@/utils/isoWeek';
import { ViewComponents } from '@/components/view';

onMounted(() => {
  // 内置卡表(cards_base × card_prints)预加载,失败由导入页兜底
  void loadCardData();
  window.addEventListener('scroll', onScroll, { passive: true });
});
onUnmounted(() => {
  window.removeEventListener('scroll', onScroll);
});

/* ── 回到顶部 FAB:滚动超过阈值显示;切换页面自动回顶 ── */
const showTop = ref(false);
function onScroll(): void {
  showTop.value = window.scrollY > 400;
}
function scrollToTop(): void {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
watch(
  () => store.currentView,
  () => {
    window.scrollTo({ top: 0 });
  }
);

const activeViewComponent = computed(() => ViewComponents[store.currentView as ViewName]);

/** 栏目条:短标签(报刊栏目名),未载入数据时仅「数据」可入 */
const NAV_SHORT: Record<string, string> = {
  import: '数据',
  overview: '总览',
  cards: '单卡',
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

/** 刊号行:优先使用数据来源刊名,否则取数据包内最新 ISO 周 */
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

/** 完整刊号(挂刊名 tooltip,不占行内空间) */
const issueTitle = computed(() => {
  const parts = [issue.value.label, issue.value.range].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : '未载入数据';
});

/* ── 范围(并入报头一行):周次选择 + 当前范围数量 ── */
const weeks = computed(() => weekBuckets());

const sampleCount = computed(() => {
  if (!store.result) return 0;
  return applyGlobalFilters(store.result.allDecks).length;
});

function onWeekChange(e: Event): void {
  store.filterWeek = (e.target as HTMLSelectElement).value;
}
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <!-- 报头(单行:刊名 | 导航 | 范围+状态) -->
    <header class="masthead-solid sticky top-0 z-50 shrink-0">
      <div class="px-4 lg:px-8 h-14 flex items-center gap-3 lg:gap-5">
        <!-- 左:刊名(点击回总览;完整刊号在 tooltip) -->
        <button
          class="flex items-baseline gap-3 min-w-0 shrink-0"
          :title="issueTitle"
          @click="store.currentView = 'overview'"
        >
          <h1 class="font-display text-[20px] lg:text-[22px] font-black text-ink truncate">
            符文档案<span class="text-brand mx-0.5">·</span>周报
          </h1>
          <span
            class="hidden xl:inline font-latin text-[9px] tracking-[0.32em] text-ink-faint uppercase"
            >Riftbound Rune Archive</span
          >
        </button>

        <!-- 中:栏目导航(横向滚动) -->
        <nav
          class="flex-1 min-w-0 h-full flex items-center gap-5 overflow-x-auto"
          aria-label="卷宗导航"
        >
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

        <!-- 右:范围(周次 + 数量)+ 启动/状态 -->
        <div class="flex items-center gap-2.5 lg:gap-3 shrink-0">
          <template v-if="store.result">
            <label
              class="flex items-center gap-1.5"
              :title="weeks.length <= 1 ? '当前数据包仅含单周' : ''"
            >
              <span class="hidden md:inline text-[11px] text-ink-faint">周次</span>
              <select
                :value="store.filterWeek"
                class="filter-select !py-1 text-xs max-w-[130px]"
                aria-label="选择周次"
                @change="onWeekChange"
              >
                <option value="">全部周</option>
                <option v-for="w in weeks" :key="w.label" :value="w.label">
                  {{ w.label }}
                </option>
              </select>
            </label>
            <span class="text-[11px] text-ink-faint tabular-nums whitespace-nowrap">
              <span class="hidden sm:inline">数量 </span>
              <b class="text-ink-muted">{{ sampleCount }}</b>/{{ store.result.totalDecks }}
            </span>
          </template>
          <button
            v-if="store.isReady && !store.result"
            @click="runStoredAnalysis()"
            :disabled="store.isAnalyzing"
            class="btn-brand px-3.5 py-1.5 text-sm disabled:opacity-40 whitespace-nowrap"
          >
            {{ store.isAnalyzing ? '分析中…' : '启动分析' }}
          </button>
          <span v-if="store.result" class="text-xs text-ink-faint hidden sm:inline">
            {{ store.statusLabel }}
          </span>
        </div>
      </div>
      <div class="hairline"></div>
    </header>

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

    <!-- 回到顶部 FAB -->
    <button
      v-if="showTop"
      class="fixed bottom-6 right-6 z-50 w-11 h-11 rounded-full bg-brand text-brand-ink shadow-lg flex items-center justify-center text-lg leading-none transition-transform hover:scale-110 fade-in"
      aria-label="回到顶部"
      title="回到顶部"
      @click="scrollToTop"
    >
      ↑
    </button>
  </div>
</template>
