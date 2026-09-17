<script setup lang="ts">
/**
 * JournalView.vue · 周报期刊(期刊栏目的本页)
 *
 * 博客式期刊版面:
 *   刊头(站点定位 + 刊行统计)→ 本期头条 → 本期数据行 → 往期卡片墙
 * 无数据包时:给出「先载入数据包」的引导,并指向数据管理工具(上传只在工具内)。
 */
import { computed } from 'vue';
import { store } from '@/store/analysis';
import { navigate } from '@/router/hash';
import { buildIssueArticle } from '@/core/issue';
import type { IssueBrief } from '@/core/issue';

/** 往期卡片展示条数(超出进「往期」) */
const RECENT_LIMIT = 3;

const current = computed(() => store.currentIssue);
const recent = computed<IssueBrief[]>(() => store.backIssues.slice(0, RECENT_LIMIT));
const hasMore = computed(() => store.backIssues.length > RECENT_LIMIT);

const masthead = computed(() => {
  const list = store.issueBriefs;
  if (list.length === 0) return '';
  const dates = list
    .map((b) => b.dateRangeText.split('—').pop()?.trim() ?? '')
    .filter(Boolean)
    .sort();
  const first = list[0]?.dateRangeText.split('—')[0]?.trim() ?? '';
  const last = dates[dates.length - 1] ?? '';
  const span = first && last ? `${first} — ${last}` : last;
  return `已刊行 ${list.length} 期${span ? ` · ${span}` : ''}`;
});

/** 本期正文(头条导语),仅在有当前期时构建 */
const currentArticle = computed(() => {
  const p = store.packages[store.packages.length - 1];
  if (!p) return null;
  return buildIssueArticle(p.id, p.label, p.result, { issueNo: store.packages.length });
});

function openIssue(id: string): void {
  navigate({ view: 'issue', issueId: id });
}
</script>

<template>
  <div class="fade-in">
    <!-- ══════════ 刊头 ══════════ -->
    <section class="max-w-[980px] mx-auto text-center pt-6 pb-10">
      <div class="flex items-center justify-end gap-4 text-[11px] text-ink-faint mb-6">
        <span class="font-latin tracking-[0.22em] uppercase">Journal</span>
      </div>
      <p class="eyebrow mb-3">Riftbound Meta Journal</p>
      <h1 class="font-display font-black text-ink leading-tight text-[34px] lg:text-[46px]">
        符文档案<span class="text-brand mx-1">·</span>周报
      </h1>
      <p class="standfirst mt-4 text-[15px] lg:text-base max-w-[620px] mx-auto">
        每期一个头条、一份完整数据:本期 meta、升降榜与逐层下钻的分析工具。
      </p>
      <p v-if="masthead" class="mt-4 text-[11px] tracking-[0.18em] text-ink-faint">{{ masthead }}</p>
      <div class="hairline mt-9"></div>
    </section>

    <!-- ══════════ 无数据:引导(上传在数据管理工具内) ══════════ -->
    <section v-if="!store.hasPackages" class="max-w-[620px] mx-auto text-center py-14">
      <p class="eyebrow mb-2">No Issue Yet</p>
      <h2 class="font-display font-bold text-ink text-[26px] leading-snug">还没有可读的期刊</h2>
      <p class="text-sm text-ink-muted mt-3 leading-relaxed">
        期刊由数据包生成:在「数据」工具里上传赛事数据包(卡组 CSV 必需,胜场/门店 JSON 可选),
        即可得到当期周报与全部分析工具。
      </p>
      <button class="btn-brand mt-6 px-5 py-2.5 text-sm" @click="navigate({ view: 'import' })">
        进入数据管理
        <span aria-hidden="true">→</span>
      </button>
      <p class="text-[11px] text-ink-faint mt-4">数据仅存于本机浏览器,刷新后需重新载入</p>
    </section>

    <!-- ══════════ 有数据:头条 + 数据行 + 往期 ══════════ -->
    <template v-else>
      <section v-if="current" class="max-w-[980px] mx-auto">
        <div class="flex items-baseline justify-between gap-4 flex-wrap">
          <p class="eyebrow">本期 · {{ current.issueNo }}</p>
          <p class="text-[11px] text-ink-faint tabular-nums">
            {{ current.dateRangeText }}
            <span v-if="current.pubDate"> · 发布于 {{ current.pubDate }}</span>
          </p>
        </div>
        <h2 class="font-display font-black text-ink leading-tight mt-3 text-[28px] lg:text-[40px]">
          {{ current.headline }}
        </h2>
        <p class="standfirst mt-4 text-[15px] lg:text-[17px]">
          {{ currentArticle?.lead ?? current.lead }}
        </p>
        <p
          v-if="current.deltas.length > 0"
          class="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-ink-faint tabular-nums"
        >
          <span v-for="d in current.deltas" :key="d.label">
            {{ d.label }} {{ d.prev }} → {{ d.curr }}
          </span>
        </p>
        <div class="mt-6">
          <button class="btn-brand px-5 py-2 text-sm" @click="openIssue(current.id)">
            阅读本期周报
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </section>

      <section v-if="current" class="mt-10 border-y border-panel-border">
        <div class="flex divide-x divide-panel-border">
          <div
            v-for="s in current.stats"
            :key="s.label"
            class="flex-1 min-w-0 py-4 px-4 lg:px-6 text-center"
          >
            <div
              class="font-display font-bold text-ink tabular-nums text-[22px] lg:text-[28px] leading-none"
            >
              {{ s.value }}
            </div>
            <div class="text-[11px] tracking-[0.14em] text-ink-faint mt-2">{{ s.label }}</div>
          </div>
        </div>
      </section>

      <section v-if="recent.length > 0" class="mt-12">
        <div class="flex items-end justify-between gap-4 flex-wrap mb-5">
          <div>
            <span class="sec-kicker mb-2.5"></span>
            <h3 class="font-display font-bold text-xl text-ink">往期期刊</h3>
            <p class="text-xs text-ink-faint mt-1.5">
              共 {{ store.backIssues.length }} 期 · 按期号从新到旧
            </p>
          </div>
          <button
            v-if="hasMore"
            class="btn-ghost px-3 py-1.5 text-xs"
            @click="navigate({ view: 'archive' })"
          >
            查看全部往期 →
          </button>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <article
            v-for="b in recent"
            :key="b.id"
            class="card card-hover p-5 flex flex-col cursor-pointer"
            @click="openIssue(b.id)"
          >
            <div class="flex items-baseline justify-between gap-3">
              <span class="eyebrow">{{ b.issueNo }}</span>
              <span class="text-[10px] text-ink-faint font-latin tracking-[0.18em] uppercase">
                {{ b.roman }}
              </span>
            </div>
            <h4 class="font-display font-bold text-ink text-[17px] leading-snug mt-2.5">
              {{ b.headline }}
            </h4>
            <p class="text-[11px] text-ink-faint tabular-nums mt-1.5">
              {{ b.dateRangeText }} · 样本 {{ b.sample }}
            </p>
            <ul class="mt-3.5 space-y-1.5 flex-1">
              <li
                v-for="(bl, i) in b.bullets"
                :key="i"
                class="flex items-baseline gap-2 text-[12px] text-ink-muted leading-relaxed border-b border-[rgba(59,74,90,0.08)] pb-1.5 last:border-0"
              >
                <span
                  class="shrink-0 w-3 text-center tabular-nums"
                  :class="
                    bl.delta == null
                      ? 'text-ink-faint'
                      : bl.delta > 0
                        ? 'text-delta-up'
                        : 'text-delta-down'
                  "
                  >{{ bl.mark }}</span
                >
                <span class="min-w-0">{{ bl.text }}</span>
              </li>
            </ul>
            <span class="text-[11px] text-brand font-medium mt-3">阅读本期 →</span>
          </article>
        </div>
      </section>
    </template>

    <div class="hairline mt-12"></div>
  </div>
</template>
