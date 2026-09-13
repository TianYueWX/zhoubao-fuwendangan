<script setup lang="ts">
/**
 * IssueView.vue · 期号正文页(周刊体,博客 post 版式)
 *
 * 版面:期号行 → 衬线大标题 → 发丝线 → 窄栏正文(≈820px)
 * 正文分节由 core/issue.ts 生成(段落 / 榜单 / 表格 / 时间线图),
 * 数字全部来自现有统计引擎。
 */
import { computed, ref } from 'vue';
import { store } from '@/store/analysis';
import { navigate } from '@/router/hash';
import { buildIssueArticle } from '@/core/issue';
import { buildWeeklyReport } from '@/core/report';
import DeltaBadge from '@/components/DeltaBadge.vue';
import ChartCard from '@/components/ChartCard.vue';
import TableDownloadButton from '@/components/TableDownloadButton.vue';
import { CHART_PALETTE } from '@/utils/palette';

/** 正文表格(每期至多一个 table 分节)——长图导出目标 */
const articleTableEl = ref<HTMLTableElement | null>(null);

const pkg = computed(() => store.packages.find((p) => p.id === store.currentIssueId) ?? null);
const index = computed(() => store.packages.findIndex((p) => p.id === store.currentIssueId));
const article = computed(() => {
  const p = pkg.value;
  if (!p) return null;
  return buildIssueArticle(p.id, p.label, p.result, { issueNo: index.value + 1 });
});

const prevIssue = computed(() => (index.value > 0 ? store.packages[index.value - 1]! : null));
const nextIssue = computed(() =>
  index.value >= 0 && index.value < store.packages.length - 1
    ? store.packages[index.value + 1]!
    : null
);

/** 周际时间线(Top 英雄出场率),仅当正文含 chart 分节时构建 */
const hasTimeline = computed(
  () => article.value?.sections.some((s) => s.kind === 'chart') ?? false
);
const timelineOption = computed(() => {
  const p = pkg.value;
  if (!p || !hasTimeline.value) return null;
  const rep = buildWeeklyReport(p.result.allDecks, p.result.catalog);
  if (!rep || rep.heroTimeline.length === 0) return null;
  return {
    grid: { left: 48, right: 24, top: 30, bottom: 56 },
    legend: { type: 'scroll', bottom: 6, textStyle: { fontSize: 10 } },
    tooltip: {
      trigger: 'axis',
      confine: true,
      valueFormatter: (v: number | null) => (v == null ? '—' : `${v.toFixed(1)}%`)
    },
    xAxis: { type: 'category', data: rep.weeks.map((w) => w.label) },
    yAxis: { type: 'value', name: '出场率 %', axisLabel: { formatter: '{value}%' } },
    series: rep.heroTimeline.map((h, i) => ({
      name: h.hero,
      type: 'line',
      smooth: true,
      symbolSize: 6,
      data: h.pickRates,
      itemStyle: { color: CHART_PALETTE[i % CHART_PALETTE.length] }
    }))
  };
});

function pct(v: number | null): string {
  return v == null ? '—' : `${v.toFixed(1)}%`;
}
function openTool(): void {
  navigate({ view: 'overview' });
}
function openIssue(id: string): void {
  navigate({ view: 'issue', issueId: id });
}
</script>

<template>
  <div class="fade-in">
    <template v-if="article">
      <!-- ══════════ 题头 ══════════ -->
      <header class="max-w-[980px] mx-auto">
        <div class="flex items-center justify-between gap-4 flex-wrap text-[11px] text-ink-faint">
          <button class="hover:text-brand transition-colors" @click="navigate({ view: 'journal' })">
            ← 返回期刊
          </button>
          <span class="font-latin tracking-[0.22em] uppercase">{{ article.roman }}</span>
        </div>
        <p class="eyebrow mt-7">{{ article.issueNo }} · {{ article.label }}</p>
        <h1
          class="font-display font-black text-ink leading-tight mt-3 text-[30px] lg:text-[42px]"
        >
          {{ article.headline }}
        </h1>
        <p class="standfirst mt-4 text-[15px] lg:text-[17px]">{{ article.lead }}</p>
        <p class="text-[11px] text-ink-faint mt-5 tabular-nums">
          {{ article.dateRangeText }}
          <span v-if="article.pubDate"> · 发布于 {{ article.pubDate }}</span>
          <span> · 样本 {{ article.sample }} · 赛事 {{ article.eventCount }}</span>
        </p>
        <div class="hairline mt-7"></div>
      </header>

      <!-- ══════════ 正文 ══════════ -->
      <article class="max-w-[820px] mx-auto mt-9 space-y-9">
        <section v-for="(s, si) in article.sections" :key="si">
          <!-- 段落 -->
          <template v-if="s.kind === 'paragraph'">
            <h2 v-if="s.title" class="font-display font-bold text-ink text-[19px] mb-3">
              {{ s.title }}
            </h2>
            <p class="text-[15px] leading-[1.9] text-ink-muted">{{ s.text }}</p>
          </template>

          <!-- 榜单 -->
          <template v-else-if="s.kind === 'list'">
            <h2 class="font-display font-bold text-ink text-[19px]">{{ s.title }}</h2>
            <p v-if="s.note" class="text-[11px] text-ink-faint mt-1.5 mb-3">{{ s.note }}</p>
            <ul v-if="s.items.length > 0" class="mt-2">
              <li
                v-for="it in s.items"
                :key="it.key"
                class="flex items-center justify-between gap-4 py-2.5 border-b border-[rgba(59,74,90,0.08)] last:border-0"
              >
                <div class="min-w-0">
                  <div class="text-sm font-medium text-ink-muted truncate">{{ it.key }}</div>
                  <div class="text-[11px] text-ink-faint tabular-nums">
                    {{ pct(it.prev) }} → {{ pct(it.curr) }}
                    <template v-if="it.rankNote"> · {{ it.rankNote }}</template>
                  </div>
                </div>
                <DeltaBadge :delta="it.delta" />
              </li>
            </ul>
            <p v-else class="text-sm text-ink-faint py-3">本期无显著变化条目</p>
          </template>

          <!-- 表格 -->
          <template v-else-if="s.kind === 'table'">
            <h2 class="font-display font-bold text-ink text-[19px]">{{ s.title }}</h2>
            <p v-if="s.note" class="text-[11px] text-ink-faint mt-1.5 mb-3">{{ s.note }}</p>
            <div class="overflow-x-auto">
              <table
                :ref="(el) => (articleTableEl = el as HTMLTableElement | null)"
                class="w-full text-sm"
              >
                <thead class="sticky-thead">
                  <tr class="text-ink-faint border-b border-panel-border text-xs">
                    <th
                      v-for="(c, ci) in s.columns"
                      :key="c"
                      class="py-2 px-2"
                      :class="ci === 0 ? 'text-left' : 'text-right'"
                    >
                      {{ c }}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(row, ri) in s.rows"
                    :key="ri"
                    class="border-b border-[rgba(59,74,90,0.08)] last:border-0"
                  >
                    <td
                      v-for="(cell, ci) in row"
                      :key="ci"
                      class="py-1.5 px-2 tabular-nums"
                      :class="
                        ci === 0
                          ? 'text-left font-medium text-ink-muted'
                          : ci === 3
                            ? cell.startsWith('-')
                              ? 'text-right text-delta-down'
                              : 'text-right text-delta-up'
                            : 'text-right text-ink-muted'
                      "
                    >
                      {{ cell }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-if="articleTableEl" class="mt-2 text-right">
              <TableDownloadButton
                variant="text"
                :target="() => articleTableEl"
                :title="s.title"
                eyebrow="期刊正文"
                :note="s.note"
              />
            </p>
          </template>

          <!-- 图表 -->
          <template v-else-if="s.kind === 'chart'">
            <h2 class="font-display font-bold text-ink text-[19px]">{{ s.title }}</h2>
            <p v-if="s.note" class="text-[11px] text-ink-faint mt-1.5 mb-3">{{ s.note }}</p>
            <ChartCard v-if="timelineOption" :option="timelineOption" height="320px" :show-toolbox="false" />
            <p v-else class="text-sm text-ink-faint py-6">无时间线数据</p>
          </template>
        </section>

        <!-- 数据工具 CTA -->
        <section class="card p-6 text-center">
          <p class="eyebrow mb-2">Data Toolbox</p>
          <h3 class="font-display font-bold text-ink text-lg">
            本期数据可下钻到 {{ store.packages.length }} 个工具
          </h3>
          <p class="text-xs text-ink-faint mt-2">
            Meta 总览 · 单卡分析 · 传奇构筑 · 地域差异 · 卡组浏览器
          </p>
          <button class="btn-brand mt-4 px-5 py-2 text-sm" @click="openTool">
            打开数据工具
            <span aria-hidden="true">→</span>
          </button>
        </section>

        <!-- 上下期 -->
        <nav class="flex items-stretch justify-between gap-4 pt-2">
          <button
            v-if="prevIssue"
            class="flex-1 card card-hover p-4 text-left"
            @click="openIssue(prevIssue.id)"
          >
            <span class="text-[10px] text-ink-faint">← 上一期</span>
            <span class="block font-display font-bold text-ink text-sm mt-1 truncate">
              {{ prevIssue.label }}
            </span>
          </button>
          <span v-else class="flex-1"></span>
          <button
            v-if="nextIssue"
            class="flex-1 card card-hover p-4 text-right"
            @click="openIssue(nextIssue.id)"
          >
            <span class="text-[10px] text-ink-faint">下一期 →</span>
            <span class="block font-display font-bold text-ink text-sm mt-1 truncate">
              {{ nextIssue.label }}
            </span>
          </button>
        </nav>

        <p class="text-[11px] text-ink-faint leading-relaxed border-t border-panel-border pt-4">
          {{ article.footnote }}
        </p>
      </article>
    </template>

    <div v-else class="py-20 text-center text-sm text-ink-faint">
      期号不存在或数据包已移除
      <button class="btn-ghost ml-3 px-3 py-1.5 text-xs" @click="navigate({ view: 'archive' })">
        返回往期
      </button>
    </div>
  </div>
</template>
