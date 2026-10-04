<script setup lang="ts">
/**
 * RankLadderView.vue · 积分榜速查(小工具)
 *
 * 官方玩家端积分排行榜的只读查询台:
 *   · 首屏一次请求(pageSize=200)出榜,之后无限滚动逐批追加;
 *   · 昵称 / uid 模糊搜 + 段位多选筛选 + 列排序;
 *   · 快照只落本机 localStorage,不做服务端缓存,不需要 token。
 *
 * 接口与实测口径见 src/tools/rank/api.ts 与 docs/rank-ladder.md。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RefreshCw } from '@lucide/vue';
import SectionHeading from '@/components/SectionHeading.vue';
import { PAGE_SIZE_MAX, MAX_PAGES } from '@/tools/rank/api';
import type { RankRow } from '@/tools/rank/api';
import {
  abortRankFetch,
  canLoadMore,
  coverageText,
  ensureFirstBatch,
  fetchedAtText,
  fetchNextBatch,
  filteredRankRows,
  hasSnapshot,
  initRankStore,
  rankNameOptions,
  rankRows,
  rankState,
  resyncRank
} from '@/tools/rank/store';

/* ── 搜索(本地防抖,输入稳定 200ms 后才筛) ── */
const searchInput = ref(rankState.ui.search);
let searchTimer: ReturnType<typeof setTimeout> | null = null;
watch(searchInput, (v) => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    rankState.ui.search = v;
  }, 200);
});

/* ── 段位多选 ── */
function toggleRankName(name: string): void {
  const picked = rankState.ui.rankNames;
  const i = picked.indexOf(name);
  if (i >= 0) picked.splice(i, 1);
  else picked.push(name);
}

const allRanksPicked = computed(
  () => rankState.ui.rankNames.length === 0
);

/* ── 抓取动作 ── */
/**
 * 重建期间保留上一份渲染结果。
 *
 * `resyncRank()` 会把快照置空再重抓;若直接渲染 filteredRankRows,表格会在
 * 重建的一两秒里闪成空白。这里留住最后的行,只在真正抓到新数据后替换。
 */
const lastRenderedRows = ref<readonly RankRow[]>([]);

async function runResync(): Promise<void> {
  if (rankState.snapshot?.rows.length) lastRenderedRows.value = rankState.snapshot.rows;
  try {
    await resyncRank();
  } catch {
    /* 失败原因已写入 rankState.batchError,由错误条呈现 */
  } finally {
    lastRenderedRows.value = [];
  }
}

async function loadMore(): Promise<void> {
  if (!canLoadMore.value) return;
  try {
    await fetchNextBatch();
  } catch {
    /* 同上 */
  }
}

/* ── 无限滚动 ── */
const sentinel = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;

/**
 * 只 observe **一次**,绝不在每次加载后重新 observe。
 *
 * 这里踩过一个坑:先前写成「watch(canLoadMore) → 重新 observe」,结果一次滚到底
 * 就连抓 6 批(200 → 1400 行)。原因是 `observe()` 会立刻用当前交叉状态回调一次,
 * 而加载完一页后哨兵若仍在视野内(内容还不够高),这个初始回调就自我触发成级联,
 * 一路抓到护栏为止 —— 完全绕过「用户滚到底才加载」的意图,也把上游当自家数据库刷。
 *
 * 现在依赖 IntersectionObserver 的本义:交叉状态**发生变化**时才回调。
 * 哨兵一直可见时不会重复触发;用户滚走再滚回来才会,那正是我们想要的。
 */
onMounted(() => {
  const el = sentinel.value;
  if (!el || typeof IntersectionObserver === 'undefined') return;
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) void loadMore();
    },
    // 提前 400px 触发,滚动到底时数据已经接上,不出现明显空窗
    { rootMargin: '400px 0px' }
  );
  observer.observe(el);
});

/* ── 头像加载失败降级为首字色块 ── */
const brokenAvatars = ref(new Set<string>());
function markAvatarBroken(uid: string): void {
  brokenAvatars.value = new Set(brokenAvatars.value).add(uid);
}

/**
 * 把界面态复位到默认值。
 *
 * rankState 是模块级单例(与 store/analysis.ts 同一套路),离开再回来时
 * 上一轮的排序与段位筛选会原样留着 —— 而搜索框是以 ui.search 为初值重建的,
 * 于是「框里是空的、列表却还筛着上次的段位」。这既是状态泄漏也是自相矛盾的界面。
 * 快照本身要留(那是用户抓来的数据),选择态不留给下一次。
 */
function resetUiState(): void {
  rankState.ui.search = '';
  rankState.ui.rankNames = [];
  searchInput.value = '';
}

/* ── 生命周期 ── */
onMounted(() => {
  initRankStore();
  resetUiState();
  /*
   * 回到页面顶部。
   *
   * 从别的工具跳进来时,浏览器会保留上一个页面的滚动位置;#/rank 也是 SPA 内
   * hash 跳转,同样不会自动归零。若停在底部,无限滚动的哨兵一挂载就可见,
   * 于是「刚进来什么都没点就自动抓了一批」。挂载即归顶,顺带保证首屏从第 1 名看起。
   */
  window.scrollTo(0, 0);
  void ensureFirstBatch();
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
  if (searchTimer) clearTimeout(searchTimer);
  abortRankFetch();
});

/* ── 展示派生 ── */
// 重建期间回退到最后一份渲染结果,避免闪空白
// 顺序即上游名次顺序 —— 本工具刻意不提供排序
const rows = computed(() =>
  rankState.snapshot ? filteredRankRows.value : lastRenderedRows.value
);
const totalFetched = computed(() =>
  rankState.snapshot ? rankRows.value.length : lastRenderedRows.value.length
);
const filteredEmpty = computed(
  () => (hasSnapshot.value || lastRenderedRows.value.length > 0) && rows.value.length === 0
);
const nextBatchHint = computed(() => `${PAGE_SIZE_MAX} 行 / 批`);

/*
 * 只读测试钩子:把 store 的响应式对象挂到 window,供 scripts/verify-rank.mjs
 * 直接从页面内断言状态(而不是只靠 DOM 推断)。只暴露既有引用,不新增任何能力,
 * 对生产行为无影响;去掉它会让排序/筛选这类故障只能靠猜。
 */
if (typeof window !== 'undefined') {
  (window as unknown as { __rankStore?: unknown }).__rankStore = {
    state: rankState,
    filteredRows: filteredRankRows,
    resetUiState
  };
}
</script>

<template>
  <section class="space-y-4">
    <SectionHeading
      eyebrow="Quick Ladder"
      title="积分榜速查"
      note="官方玩家端积分排行榜的只读查询台。首屏一次请求出前 200 名,继续下滑自动续抓;数据只存在你自己的浏览器里,不经过本站服务器,也不需要登录。"
    >
      <template #actions>
        <button
          class="btn-ghost px-3 py-1.5 text-xs font-medium whitespace-nowrap"
          :disabled="rankState.loading"
          title="清空本地快照,从第 1 页重新抓取"
          @click="runResync"
        >
          <RefreshCw :size="14" aria-hidden="true" />
          {{ rankState.loading ? '抓取中…' : '重新抓取' }}
        </button>
      </template>
    </SectionHeading>

    <!-- 快照覆盖面:始终如实说明「抓到了哪里」,不谎称完整 -->
    <div class="card px-4 py-3 flex items-center justify-between gap-3 flex-wrap text-xs">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="snap-dot" :class="rows.length ? 'snap-dot-live' : 'snap-dot-idle'" aria-hidden="true"></span>
        <span class="text-ink-muted">
          {{ rankState.snapshot ? coverageText : (rankState.loading ? '正在重建快照…' : '尚未抓取') }}
        </span>
        <span v-if="fetchedAtText" class="text-ink-faint">· 数据为 {{ fetchedAtText }} 快照</span>
        <span v-if="rankState.capped" class="text-accent">
          · 已达本站抓取上限({{ PAGE_SIZE_MAX }} × {{ MAX_PAGES }} 行),如有需要请提 issue
        </span>
      </div>
      <span class="text-ink-faint">
        并列名次照原样展示(官方跳号) · {{ nextBatchHint }}
      </span>
    </div>

    <!-- 本批失败:不擦除已抓到的行,但要说清「这不是完整的榜」 -->
    <div
      v-if="rankState.batchError"
      class="card px-4 py-3 text-xs border-l-2 border-l-delta-down"
      role="alert"
    >
      <span class="text-delta-down font-medium">本批抓取失败</span>
      <span class="text-ink-muted"> — {{ rankState.batchError.message }}</span>
      <span class="text-ink-faint">。已抓到的 {{ totalFetched }} 行照常可查,未被清空。</span>
      <button class="btn-ghost ml-2 px-2 py-0.5 text-xs" @click="loadMore">重试本批</button>
    </div>

    <!-- 筛选条 -->
    <div class="flex items-center gap-2 flex-wrap">
      <input
        v-model="searchInput"
        type="text"
        class="filter-select !py-2 placeholder-ink-faint max-w-xs"
        placeholder="搜昵称或 uid…"
        aria-label="按昵称或 uid 搜索"
      />
      <button
        class="rank-chip"
        :class="{ 'rank-chip-active': allRanksPicked }"
        @click="rankState.ui.rankNames = []"
      >
        全部段位
      </button>
      <button
        v-for="opt in rankNameOptions"
        :key="opt.name"
        class="rank-chip"
        :class="{ 'rank-chip-active': rankState.ui.rankNames.includes(opt.name) }"
        :title="`筛选「${opt.name}」`"
        @click="toggleRankName(opt.name)"
      >
        {{ opt.name }}
        <span class="rank-chip-count">{{ opt.count }}</span>
      </button>
      <span class="text-xs text-ink-faint ml-auto">
        命中 {{ rows.length }} / {{ totalFetched }} 行
      </span>
    </div>

    <!-- 榜单 -->
    <div class="card overflow-hidden">
      <!--
        刻意**不设 max-height**:早期版本给它套了 max-h-[70vh],结果 200 行全在
        容器内部滚动(实测容器 scrollHeight 9033px 而文档只有 1239px),页面本身
        不滚动,无限滚动的哨兵永远卡在容器下方,滚到底也触发不了。
        内层滚动区与无限滚动天生打架,这里只保留横向溢出处理,纵向交给页面。
      -->
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="sticky-thead">
            <!--
              表头**刻意不可点**:本工具不提供排序。
              榜单顺序就是官方名次顺序,让人按积分或昵称重排只会诱导误读
              (「谁积分高」在上游是并列跳号的,重排后名次列会显得毫无规律)。
            -->
            <tr class="text-ink-faint border-b border-panel-border text-xs">
              <th class="py-2 px-3 text-right">名次</th>
              <th class="py-2 px-3 text-left">召唤师</th>
              <th class="py-2 px-3 text-right">积分</th>
              <th class="py-2 px-3 text-left">段位</th>
              <th class="py-2 px-3 text-left">uid</th>
            </tr>
          </thead>
          <tbody class="text-ink-muted">
            <tr
              v-for="row in rows"
              :key="row.uid"
              class="border-b border-[rgba(59,74,90,0.08)] hover:bg-brand-soft/40"
            >
              <td class="py-2 px-3 text-right tabular-nums font-medium text-ink whitespace-nowrap">
                {{ row.ranking }}
              </td>
              <td class="py-2 px-3">
                <div class="flex items-center gap-2 min-w-0">
                  <img
                    v-if="row.avatar && !brokenAvatars.has(row.uid)"
                    :src="row.avatar"
                    alt=""
                    width="28"
                    height="28"
                    loading="lazy"
                    decoding="async"
                    referrerpolicy="no-referrer"
                    class="w-7 h-7 rounded-full object-cover shrink-0 border border-card-border"
                    @error="markAvatarBroken(row.uid)"
                  />
                  <span v-else class="avatar-fallback shrink-0" aria-hidden="true">
                    {{ (row.name || '?').slice(0, 1) }}
                  </span>
                  <span class="truncate max-w-[16rem]" :title="row.name">{{ row.name || '(未命名)' }}</span>
                </div>
              </td>
              <td class="py-2 px-3 text-right tabular-nums whitespace-nowrap">
                {{ row.totalIntegral }}
              </td>
              <td class="py-2 px-3 whitespace-nowrap">
                <span class="inline-flex items-center gap-1.5">
                  <img
                    v-if="row.rankIcon"
                    :src="row.rankIcon"
                    alt=""
                    width="20"
                    height="20"
                    loading="lazy"
                    decoding="async"
                    referrerpolicy="no-referrer"
                    class="w-5 h-5 object-contain shrink-0"
                  />
                  <span class="text-xs">{{ row.rankName || '—' }}</span>
                </span>
              </td>
              <td class="py-2 px-3 text-ink-faint text-xs font-mono whitespace-nowrap">
                {{ row.uid }}
              </td>
            </tr>

            <!-- 空态分两种成因,不能混为一谈 -->
            <tr v-if="filteredEmpty">
              <td colspan="5" class="py-10 text-center text-ink-faint">
                <p>已抓取的 {{ totalFetched }} 行里没有匹配「{{ rankState.ui.search }}」的玩家。</p>
                <p class="mt-1 text-xs">
                  这不等于该玩家不存在 —— 本快照只覆盖到第
                  {{ rankState.snapshot?.coverage ?? 0 }} 名。继续下滑可再抓
                  {{ PAGE_SIZE_MAX }} 行,或点右上角「重新抓取」重来一遍。
                </p>
              </td>
            </tr>
            <tr v-else-if="!hasSnapshot && !rankState.loading">
              <td colspan="5" class="py-10 text-center text-ink-faint">
                尚无本地快照。点右上角「重新抓取」开始。
              </td>
            </tr>
            <tr v-else-if="rankState.loading && !rows.length">
              <td colspan="5" class="py-10 text-center text-ink-faint">正在抓取第 1 页…</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 无限滚动哨兵 + 抓取态 -->
      <div ref="sentinel" class="px-4 py-3 text-center text-xs text-ink-faint border-t border-panel-border">
        <template v-if="rankState.loading">
          <span class="inline-flex items-center gap-2">
            <span class="snap-dot snap-dot-live" aria-hidden="true"></span>
            正在抓取第 {{ rankState.snapshot?.nextPage ?? 1 }} 批…
          </span>
        </template>
        <template v-else-if="rankState.reachedEnd">
          已到榜单末尾 · 共 {{ totalFetched }} 行
        </template>
        <template v-else-if="rankState.capped">
          已达本站抓取上限,不再继续
        </template>
        <template v-else-if="canLoadMore">
          继续下滑加载更多(下一批 {{ PAGE_SIZE_MAX }} 行)
        </template>
        <template v-else-if="rankState.batchError">
          本批未成功,已停止加载
        </template>
      </div>
    </div>

    <p class="text-xs text-ink-faint leading-relaxed">
      数据来自官方玩家端小程序接口,按原样展示,本站不做加工与推断;榜单随时可能变动,
      页面内显示的是本机快照而非实时值。段位筛选选项由已抓数据动态生成,不硬编码段位名。
    </p>
  </section>
</template>

<style scoped>
.rank-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.25rem 0.6rem;
  border-radius: 0.5rem;
  border: 1px solid var(--color-card-border);
  background: var(--color-card-bg);
  font-size: 0.75rem;
  color: var(--color-text-muted);
  transition: all 0.15s;
}
.rank-chip:hover {
  border-color: var(--color-brand-faint);
  color: var(--color-brand);
}
.rank-chip-active {
  background: var(--color-brand);
  border-color: var(--color-brand);
  color: var(--color-brand-ink);
}
.rank-chip-count {
  font-size: 0.65rem;
  opacity: 0.7;
  font-variant-numeric: tabular-nums;
}
.avatar-fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 9999px;
  background: var(--color-brand-soft);
  border: 1px solid var(--color-card-border);
  color: var(--color-brand);
  font-size: 0.75rem;
  font-weight: 600;
}
.snap-dot {
  display: inline-block;
  width: 0.4rem;
  height: 0.4rem;
  border-radius: 9999px;
  flex-shrink: 0;
}
.snap-dot-live {
  background: var(--color-brand);
  box-shadow: 0 0 0 3px var(--color-brand-soft);
}
.snap-dot-idle {
  background: var(--color-text-subtle);
}
</style>
