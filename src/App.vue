<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { ArrowLeft, ArrowUp } from "@lucide/vue";
import {
  store,
  runStoredAnalysis,
  loadCardData,
  applyGlobalFilters,
  weekBuckets,
} from "@/store/analysis";
import { navigate, startRouter, syncUrl } from "@/router/hash";
import { findTool, HOME_CODE } from "@/tools/catalog";
import { setSourceState, setToolState } from "@/tools/state";
import { probeSupabase } from "@/tools/sources/supabase";
import { bootstrapAuth } from "@/tools/sources/auth";
import { loadEditorialUnlock } from "@/tools/editorialAccess";
import { ViewComponents } from "@/components/view";

let stopRouter: (() => void) | null = null;

onMounted(async () => {
  // 恢复编辑部状态与会话,不阻塞首页导航
  loadEditorialUnlock();
  void bootstrapAuth();
  stopRouter = startRouter();

  // 内置卡表(cards_base × card_prints)预加载;结果写入工具状态机
  setSourceState("local", { status: "loading", message: "卡表加载中" });
  const cardsOk = await loadCardData();
  setSourceState("local", {
    status: cardsOk ? "ready" : "error",
    message: cardsOk ? "卡表已就绪" : "卡表加载失败",
  });
  setToolState("import", { status: cardsOk ? "ready" : "error" });

  window.addEventListener("scroll", onScroll, { passive: true });

  // 云端数据源探测(未配置 → unconfigured,不是错误;不阻塞首屏)
  void probeSupabase().then((r) => {
    if (!r.configured) {
      setSourceState("supabase", {
        status: "unconfigured",
        message: "未配置云端连接",
      });
      return;
    }
    setSourceState("supabase", {
      status: r.ok ? "ready" : "error",
      message: r.ok ? `已连接(${r.latencyMs}ms)` : `连接失败:${r.error}`,
    });
  });
});
onUnmounted(() => {
  stopRouter?.();
  window.removeEventListener("scroll", onScroll);
});

/** 数据包变化 → 刷新本地工具状态(卡片徽章即时反映) */
watch(
  () => [store.packages.length, store.activePackageId] as const,
  () => {
    setToolState("journal", {
      status: store.hasPackages ? "ready" : "empty",
      count: store.packages.length,
      message: store.hasPackages
        ? `已载入 ${store.packages.length} 期`
        : "尚无数据包",
    });
    setSourceState("local", {
      status: store.cardBase ? "ready" : "idle",
      message: store.hasPackages ? `活动包:${store.sourceLabel}` : "等待数据包",
    });
  },
  { immediate: true },
);

/* ── 视图 ⇄ URL 同步(下钻直接改 store.currentView,这里统一回写 hash) ── */
watch(
  () => [store.currentView, store.currentIssueId] as const,
  () => {
    syncUrl();
    window.scrollTo({ top: 0 });
  },
);

/* ── 回到顶部 FAB ── */
const showTop = ref(false);
function onScroll(): void {
  showTop.value = window.scrollY > 400;
}
function scrollToTop(): void {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ── 视图分发 ── */
const activeViewComponent = computed(
  () =>
    ViewComponents[store.currentView] ??
    ViewComponents[HOME_CODE] ??
    ViewComponents.journal,
);

/** 占位/云端工具需要 code 作为 prop(其余视图忽略) */
const PLACEHOLDER_CODES = ["blog"];
const needsCodeProp = computed(() =>
  PLACEHOLDER_CODES.includes(store.currentView),
);

const homeCode = HOME_CODE;
const isHome = computed(() => store.currentView === homeCode);
const isCarddex = computed(() => store.currentView === "carddex");
const isBuilder = computed(() => store.currentView === "builder");

const isJournalSection = computed(
  () =>
    store.currentView === "archive" ||
    store.currentView === "issue" ||
    findTool(store.currentView)?.group === "journal",
);

/* ── 期刊次级条:周次 + 样本数 ── */
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
  <!--
    全站统一文档流滚动：carddex 不再自建 h-screen 内滚骨架。
    任一祖先出现 overflow:hidden 都会吃掉后代的 position:sticky，
    所以这里的 overflow 一律不加。
  -->
  <div class="flex flex-col min-h-screen" :class="{ 'ux-readable': ['chain', 'overview', 'cards', 'legendary', 'region', 'decks', 'builder', 'games', 'rank'].includes(store.currentView) }">
    <header
      v-if="!isHome && !isBuilder && store.currentView !== 'cardmaker' && store.currentView !== 'chain' && store.currentView !== 'rulebook'"
      class="masthead-solid sticky top-0 z-50 shrink-0"
    >
      <div class="px-4 lg:px-8 h-14 flex items-center justify-between gap-3">
        <button
          class="text-sm text-ink-muted hover:text-brand transition-colors"
          @click="navigate({ view: homeCode })"
        >
          <ArrowLeft :size="15" aria-hidden="true" /> 返回首页
        </button>
        <div
          id="global-page-actions"
          class="min-w-0 flex items-center justify-end"
        ></div>
      </div>

      <!-- 期刊数据范围(仅活动包存在时) -->
      <div
        v-if="isJournalSection && store.result"
        class="px-4 lg:px-8 h-12 flex items-center justify-end gap-3 lg:gap-4 border-t border-panel-border"
      >
        <div class="flex items-center gap-2.5 shrink-0">
          <label
            class="flex items-center gap-1.5"
            :title="weeks.length <= 1 ? '当前数据包仅含单周' : ''"
          >
            <span class="hidden md:inline text-[11px] text-ink-faint"
              >周次</span
            >
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
          <span
            class="hidden lg:inline text-[11px] text-ink-faint tabular-nums whitespace-nowrap"
          >
            样本 <b class="text-ink-muted">{{ sampleCount }}</b
            >/{{ store.result.totalDecks }}
          </span>
          <button
            v-if="store.isReady && store.draftPending"
            class="btn-brand px-3 py-1.5 text-xs whitespace-nowrap"
            :disabled="store.isAnalyzing"
            @click="runStoredAnalysis()"
          >
            {{ store.isAnalyzing ? "分析中…" : "分析新数据包" }}
          </button>
        </div>
      </div>

      <div class="hairline"></div>
    </header>

    <!-- ══════════ 内容区 ══════════ -->
    <main
      :class="
        isHome
          ? 'w-full'
          : isBuilder || store.currentView === 'cardmaker' || store.currentView === 'rulebook'
            ? 'flex-1 w-full min-w-0'
          : isCarddex
            ? 'flex-1 w-full max-w-[1720px] mx-auto px-4 lg:px-8 py-4'
            : 'flex-1 w-full max-w-[1720px] mx-auto px-4 lg:px-8 py-8'
      "
    >
      <component
        :is="activeViewComponent"
        v-bind="needsCodeProp ? { code: store.currentView } : {}"
      />
    </main>

    <!-- ══════════ 页脚 ══════════ -->
    <footer
      v-if="!isHome && !isCarddex && !isBuilder && store.currentView !== 'cardmaker' && store.currentView !== 'rulebook'"
      class="px-4 lg:px-8 pb-8 max-w-[1720px] mx-auto w-full"
    >
      <div class="rune-rule mb-5"></div>
      <div class="text-center text-[11px] text-ink-faint space-y-1">
        <p class="font-display">
          符文档案 · 周报 — Riftbound 城市挑战赛赛事 Meta 情报
        </p>
        <p>数据仅供竞技参考 · Riot Games 与本工具无关</p>
      </div>
    </footer>

    <!-- 规则书使用书内回顶，其余页面共用全局 FAB。 -->
    <button
      v-if="!isHome && !isBuilder && store.currentView !== 'cardmaker' && store.currentView !== 'rulebook' && showTop"
      class="fixed bottom-6 right-6 z-50 w-11 h-11 rounded-full bg-brand text-brand-ink shadow-lg flex items-center justify-center text-lg leading-none transition-transform hover:scale-110 fade-in"
      aria-label="回到顶部"
      title="回到顶部"
      @click="scrollToTop"
    >
      <ArrowUp :size="19" aria-hidden="true" />
    </button>
  </div>
</template>
