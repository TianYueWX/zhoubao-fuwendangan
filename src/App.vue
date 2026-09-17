<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { store, runStoredAnalysis, loadCardData, applyGlobalFilters, weekBuckets } from '@/store/analysis';
import { navigate, startRouter, syncUrl } from '@/router/hash';
import {
  sectionBarTools,
  groupOf,
  findTool,
  isGroupVisible,
  HOME_CODE,
  type ToolGroupId
} from '@/tools/catalog';
import { setSourceState, setToolState } from '@/tools/state';
import { probeSupabase } from '@/tools/sources/supabase';
import { bootstrapAuth, isEditorialAdmin } from '@/tools/sources/auth';
import { editorialUnlocked, loadEditorialUnlock } from '@/tools/editorialAccess';
import { ViewComponents } from '@/components/view';

let stopRouter: (() => void) | null = null;

onMounted(async () => {
  // 恢复编辑部状态与会话,不阻塞首页导航
  loadEditorialUnlock();
  void bootstrapAuth();
  stopRouter = startRouter();

  // 内置卡表(cards_base × card_prints)预加载;结果写入工具状态机
  setSourceState('local', { status: 'loading', message: '卡表加载中' });
  const cardsOk = await loadCardData();
  setSourceState('local', {
    status: cardsOk ? 'ready' : 'error',
    message: cardsOk ? '卡表已就绪' : '卡表加载失败'
  });
  setToolState('import', { status: cardsOk ? 'ready' : 'error' });

  window.addEventListener('scroll', onScroll, { passive: true });

  // 云端数据源探测(未配置 → unconfigured,不是错误;不阻塞首屏)
  void probeSupabase().then((r) => {
    if (!r.configured) {
      setSourceState('supabase', { status: 'unconfigured', message: '未配置云端连接' });
      return;
    }
    setSourceState('supabase', {
      status: r.ok ? 'ready' : 'error',
      message: r.ok ? `已连接(${r.latencyMs}ms)` : `连接失败:${r.error}`
    });
  });
});
onUnmounted(() => {
  stopRouter?.();
  window.removeEventListener('scroll', onScroll);
});

/** 数据包变化 → 刷新本地工具状态(卡片徽章即时反映) */
watch(
  () => [store.packages.length, store.activePackageId] as const,
  () => {
    setToolState('journal', {
      status: store.hasPackages ? 'ready' : 'empty',
      count: store.packages.length,
      message: store.hasPackages ? `已载入 ${store.packages.length} 期` : '尚无数据包'
    });
    setSourceState('local', {
      status: store.cardBase ? 'ready' : 'idle',
      message: store.hasPackages ? `活动包:${store.sourceLabel}` : '等待数据包'
    });
  },
  { immediate: true }
);

/* ── 视图 ⇄ URL 同步(下钻直接改 store.currentView,这里统一回写 hash) ── */
watch(
  () => [store.currentView, store.currentIssueId] as const,
  () => {
    syncUrl();
    window.scrollTo({ top: 0 });
  }
);

/* ── 回到顶部 FAB ── */
const showTop = ref(false);
function onScroll(): void {
  showTop.value = window.scrollY > 400;
}
function scrollToTop(): void {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ── 视图分发 ── */
const activeViewComponent = computed(
  () => ViewComponents[store.currentView] ?? ViewComponents[HOME_CODE] ?? ViewComponents.journal
);

/** 占位/云端工具需要 code 作为 prop(其余视图忽略) */
const PLACEHOLDER_CODES = ['blog', 'qa', 'rules', 'carddex'];
const needsCodeProp = computed(() => PLACEHOLDER_CODES.includes(store.currentView));

const homeCode = HOME_CODE;
const isHome = computed(() => store.currentView === homeCode);

/**
 * 当前所在的**一级栏目**。
 * 期刊栏目含:期刊本体、往期、期号正文、数据管理与全部本地分析工具。
 */
const activeGroup = computed<ToolGroupId | null>(() => {
  const v = store.currentView;
  if (v === HOME_CODE) return null; // 工具台不属于任何栏目
  if (v === 'archive' || v === 'issue') return 'journal';
  return findTool(v)?.group ?? null;
});

/**
 * 栏目内二级导航条:
 *   期刊 → 「本期 · 往期」+ 数据管理与 5 个分析工具
 *   云端内容 / 参考资料 → 该栏目下登记的工具
 * 未载入数据时本地工具仍可进入(页面内给引导),只是样式降级。
 */
const sectionTools = computed(() => {
  const g = activeGroup.value;
  if (!g) return [];
  // 隐藏栏目(编辑部)未解锁时,栏目条一并收起 —— 深链进来的访客只看到门禁页
  if (!isGroupVisible(g, editorialUnlocked.value)) return [];
  // 期刊本体与往期已由「本期 / 往期」两个按钮承载,不重复出现在工具位
  const tools = sectionBarTools(g).filter((t) => t.code !== 'journal' && t.code !== 'archive');
  // 需登录的栏目:未通过门禁时只留栏目首页(code === 栏目 id),
  // 否则会列出 5 个点了就撞门禁的死链
  if (tools.some((t) => t.requiresAuth) && !isEditorialAdmin.value) {
    return tools.filter((t) => t.code === g);
  }
  return tools;
});
const showSectionBar = computed(() => activeGroup.value !== null && sectionTools.value.length > 0);
const isJournalSection = computed(() => activeGroup.value === 'journal');

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
  <div class="min-h-screen flex flex-col">
    <header v-if="!isHome" class="masthead-solid sticky top-0 z-50 shrink-0">
      <div class="px-4 lg:px-8 h-14 flex items-center">
        <button class="text-sm text-ink-muted hover:text-brand transition-colors"
          @click="navigate({ view: homeCode })">
          <span aria-hidden="true">←</span> 返回首页
        </button>
      </div>

      <!-- 栏目内二级导航条(栏目驱动) -->
      <nav
        v-if="showSectionBar"
        class="px-4 lg:px-8 h-12 flex items-center gap-3 lg:gap-4 border-t border-panel-border"
        :aria-label="`${groupOf(activeGroup ?? 'journal').label}导航`"
      >
        <div class="flex-1 min-w-0 flex items-center gap-4 lg:gap-5 overflow-x-auto">
          <!-- 期刊栏目:正文入口(本期 / 往期) -->
          <template v-if="isJournalSection">
            <button
              class="relative shrink-0 h-12 px-0.5 text-[12.5px] tracking-[0.06em] transition-colors"
              :class="
                store.currentView === 'journal'
                  ? 'text-brand font-semibold'
                  : 'text-ink-muted hover:text-brand'
              "
              title="本期周报"
              @click="navigate({ view: 'journal' })"
            >
              本期
              <span
                v-if="store.currentView === 'journal'"
                class="absolute left-0 right-0 bottom-0 h-[2px] bg-brand"
                aria-hidden="true"
              ></span>
            </button>
            <button
              class="relative shrink-0 h-12 px-0.5 text-[12.5px] tracking-[0.06em] transition-colors"
              :class="
                store.currentView === 'archive'
                  ? 'text-brand font-semibold'
                  : 'text-ink-muted hover:text-brand'
              "
              title="往期归档"
              @click="navigate({ view: 'archive' })"
            >
              往期
              <span
                v-if="store.currentView === 'archive'"
                class="absolute left-0 right-0 bottom-0 h-[2px] bg-brand"
                aria-hidden="true"
              ></span>
            </button>
            <span class="w-px h-4 bg-panel-border shrink-0" aria-hidden="true"></span>
          </template>

          <!-- 栏目内工具(期刊栏目下即数据管理与 5 个分析工具) -->
          <button
            v-for="t in sectionTools"
            :key="t.code"
            class="relative shrink-0 h-12 px-0.5 transition-colors text-[12.5px] tracking-[0.06em]"
            :class="[
              store.currentView === t.code
                ? 'text-brand font-semibold'
                : t.needsData && !store.hasPackages && t.source === 'local'
                  ? 'text-ink-faint/60 hover:text-brand'
                  : 'text-ink-muted hover:text-brand'
            ]"
            :data-code="t.code"
            :title="t.needsData && !store.hasPackages ? `${t.label} · 需先载入数据包` : t.label"
            @click="navigate({ view: t.code })"
          >
            {{ t.short ?? t.label }}
            <span
              v-if="store.currentView === t.code"
              class="absolute left-0 right-0 bottom-0 h-[2px] bg-brand"
              aria-hidden="true"
            ></span>
          </button>
        </div>

        <!-- 范围(仅活动包存在时;期刊栏目专用) -->
        <div v-if="isJournalSection && store.result" class="flex items-center gap-2.5 shrink-0">
          <label class="flex items-center gap-1.5" :title="weeks.length <= 1 ? '当前数据包仅含单周' : ''">
            <span class="hidden md:inline text-[11px] text-ink-faint">周次</span>
            <select
              :value="store.filterWeek"
              class="filter-select !py-1 text-xs max-w-[130px]"
              aria-label="选择周次"
              @change="onWeekChange"
            >
              <option value="">全部周</option>
              <option v-for="w in weeks" :key="w.label" :value="w.label">{{ w.label }}</option>
            </select>
          </label>
          <span class="hidden lg:inline text-[11px] text-ink-faint tabular-nums whitespace-nowrap">
            样本 <b class="text-ink-muted">{{ sampleCount }}</b>/{{ store.result.totalDecks }}
          </span>
          <button
            v-if="store.isReady && store.draftPending"
            class="btn-brand px-3 py-1.5 text-xs whitespace-nowrap"
            :disabled="store.isAnalyzing"
            @click="runStoredAnalysis()"
          >
            {{ store.isAnalyzing ? '分析中…' : '分析新数据包' }}
          </button>
        </div>
      </nav>

      <div class="hairline"></div>
    </header>

    <!-- ══════════ 内容区 ══════════ -->
    <main :class="isHome ? 'w-full' : 'flex-1 w-full max-w-[1720px] mx-auto px-4 lg:px-8 py-8'">
      <component :is="activeViewComponent" v-bind="needsCodeProp ? { code: store.currentView } : {}" />
    </main>

    <!-- ══════════ 页脚 ══════════ -->
    <footer v-if="!isHome" class="px-4 lg:px-8 pb-8 max-w-[1720px] mx-auto w-full">
      <div class="rune-rule mb-5"></div>
      <div class="text-center text-[11px] text-ink-faint space-y-1">
        <p class="font-display">符文档案 · 周报 — Riftbound 城市挑战赛赛事 Meta 情报</p>
        <p>数据仅供竞技参考 · Riot Games 与本工具无关</p>
      </div>
    </footer>

    <!-- 回到顶部 FAB -->
    <button
      v-if="!isHome && showTop"
      class="fixed bottom-6 right-6 z-50 w-11 h-11 rounded-full bg-brand text-brand-ink shadow-lg flex items-center justify-center text-lg leading-none transition-transform hover:scale-110 fade-in"
      aria-label="回到顶部"
      title="回到顶部"
      @click="scrollToTop"
    >
      ↑
    </button>
  </div>
</template>
