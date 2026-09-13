<script setup lang="ts">
/**
 * OverviewView.vue · Meta 总览 ——「头版」
 *
 * 本期聚焦(玩家叙事):
 *   - 传奇综合表现榜(metaScore = 转化综合分 × log₁₀(数量+10) × 名次权重),
 *     卡片点击下钻传奇构筑页
 *   - 报眼:KPI 数据行(数量 / 赛事 / 英雄 / Top4 转化)
 *   - 多栏版面:英雄 Tier List │ 传奇对分布(栏间竖细线)
 *   - 全宽:环境阶梯散点(热度 × 强度)
 * 趋势对比(创作者叙事):环比 Δ、升降榜、周际时间线、一键复制 Markdown
 * 数据范围由全局「周次」筛选决定(默认最新一周),文案统一用「本期」。
 */
import { computed, ref } from 'vue';
import { store, applyGlobalFilters } from '@/store/analysis';
import ChartCard from '@/components/ChartCard.vue';
import StatCard from '@/components/StatCard.vue';
import TierBadge from '@/components/TierBadge.vue';
import DeltaBadge from '@/components/DeltaBadge.vue';
import SectionHeading from '@/components/SectionHeading.vue';
import CardThumb from '@/components/CardThumb.vue';
import SortableTh from '@/components/SortableTh.vue';
import TableDownloadButton from '@/components/TableDownloadButton.vue';
import { useTableSort, type SortableColumn } from '@/composables/useTableSort';
import { quickHeroRows, buildWeeklyReport, legendaryRows, sortLegendaryRows, MIN_LEGEND_SAMPLE } from '@/core';
import type { DeltaItem } from '@/core';
import type { QuickHeroRow } from '@/core/quickStats';
import type { LegendaryRow } from '@/core/legendaryStats';
import { reportToMarkdown } from '@/utils/reportMarkdown';
import { CHART_PALETTE } from '@/utils/palette';

/* ── 双叙事切换:本期聚焦 / 趋势对比 ── */
const narrative = ref<'focus' | 'report'>('focus');

/* ── 过滤后的卡组集合 ── */
const filteredDecks = computed(() =>
  store.result ? applyGlobalFilters(store.result.allDecks) : []
);

const heroRows = computed(() => {
  if (!store.result) return [];
  return quickHeroRows(filteredDecks.value, store.result.totalDecks);
});

const tierOrder = { S: 0, A: 1, B: 2, C: 3, null: 4 } as const;

/** 英雄 Tier List:全量展示(样本数量不限),按 Tier → 综合分 → 数量排序 */
const tierRows = computed(() => {
  const rows = heroRows.value.slice();
  return rows.sort(
    (a, b) =>
      tierOrder[(a.tier ?? 'null') as keyof typeof tierOrder] -
      tierOrder[(b.tier ?? 'null') as keyof typeof tierOrder] ||
      (b.tierScore ?? -1) - (a.tierScore ?? -1) ||
      b.total - a.total
  );
});

/* ── 表头点击排序(默认保持上面的原始顺序) ── */
const TIER_COLUMNS: readonly SortableColumn<QuickHeroRow>[] = [
  // Tier 按等级序(S→A→B→C→未评级),而非字母序
  { key: 'tier', type: 'number', value: (r) => tierOrder[(r.tier ?? 'null') as keyof typeof tierOrder] },
  { key: 'hero', type: 'text' },
  { key: 'total', type: 'number' },
  { key: 'popularity', type: 'number' },
  { key: 'top8Rate', type: 'number' },
  { key: 'top4Rate', type: 'number' },
  { key: 'champions', type: 'number' },
  { key: 'runnersUp', type: 'number' },
  { key: 'tierScore', type: 'number' }
];
const tierSort = useTableSort(tierRows, TIER_COLUMNS);
/** 模板用:排序后的行(顶层 ref 自动解包) */
const tierRowsSorted = tierSort.sorted;

/* ── 传奇综合表现榜(metaScore = 转化综合分 × log10(数量+10) × 名次权重) ──
 * 转化只代表「强」;乘上对数热度(又主流)与名次权重(又稳定)才是 T0 定义。
 * 名次权重 R_weight:平均名次越好越高(0.5~1.5,按全榜百分位归一化)。
 */
const metaMinSample = computed(() => {
  const n = filteredDecks.value.length;
  return Math.max(MIN_LEGEND_SAMPLE, Math.floor(n * 0.02));
});
const metaTop = computed<LegendaryRow[]>(() => {
  const r = store.result;
  if (!r || filteredDecks.value.length === 0) return [];
  return sortLegendaryRows(
    legendaryRows(filteredDecks.value, r.catalog, r.totalDecks),
    'metaScore',
    metaMinSample.value
  ).slice(0, 10);
});
const avgRankText = (r: LegendaryRow): string => (r.avgRank != null ? r.avgRank.toFixed(1) : '—');

/** 传奇展示名:hero + legend name(如「易 无极剑圣」);无英雄数据时退回传奇卡名 */
function heroLegendName(r: LegendaryRow): string {
  return r.topHero && r.topHero !== '—' ? r.topHero : r.name;
}

/** 下钻传奇/英雄融合页:以传奇最常见的搭档英雄为焦点,进入「构筑」页签 */
function gotoLegendary(row?: LegendaryRow): void {
  const l = row;
  if (l && l.topHero && l.topHero !== '—') store.focusHero = l.topHero;
  store.currentView = 'legendary';
}

/* ── 趋势对比叙事 ── */
const report = computed(() => {
  const r = store.result;
  if (!r) return null;
  return buildWeeklyReport(r.allDecks, r.catalog);
});

/** 周际热度线图(MetaTimeline) */
const timelineOption = computed(() => {
  const rep = report.value;
  if (!rep || rep.heroTimeline.length === 0) return null;
  return {
    grid: { left: 48, right: 24, top: 36, bottom: 60 },
    legend: { type: 'scroll', bottom: 8, textStyle: { fontSize: 10 } },
    tooltip: { trigger: 'axis', confine: true, valueFormatter: (v: number | null) => (v == null ? '—' : `${v.toFixed(1)}%`) },
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

const copied = ref(false);
async function copyReport(): Promise<void> {
  const rep = report.value;
  if (!rep) return;
  try {
    await navigator.clipboard.writeText(reportToMarkdown(rep));
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  } catch {
    // 剪贴板不可用(如非安全上下文):降级提示
    copied.value = false;
    window.alert('复制失败:当前环境不支持剪贴板 API,请手动复制');
  }
}

const rankText = (it: DeltaItem<string>): string => {
  if (it.prevRank == null || it.currRank == null) return '';
  return `名次 ${it.prevRank}→${it.currRank}`;
};

/** 转化变化榜(趋势叙事):可点表头排序,默认保持引擎给出的顺序 */
const convertRows = computed<readonly DeltaItem<string>[]>(
  () => report.value?.convertMovers ?? []
);
const CONVERT_COLUMNS: readonly SortableColumn<DeltaItem<string>>[] = [
  { key: 'key', type: 'text' },
  { key: 'prev', type: 'number' },
  { key: 'curr', type: 'number' },
  { key: 'delta', type: 'number' },
  // 名次变动:rankChange 为「上期名次 - 本期名次」,升序 = 上升最多在前
  { key: 'rankChange', type: 'number' },
  { key: 'currSample', type: 'number' }
];
const convertSort = useTableSort(convertRows, CONVERT_COLUMNS);
/** 模板用:排序后的行 */
const convertRowsSorted = convertSort.sorted;

/* ── 长图导出:目标表格元素(点按时取值) ── */
const tierTableEl = ref<HTMLTableElement | null>(null);
const convertTableEl = ref<HTMLTableElement | null>(null);

/* ── KPI(报眼) ── */
const kpis = computed(() => {
  const r = store.result;
  const decks = filteredDecks.value;
  const events = new Set(decks.map((d) => d.activityName)).size;
  return [
    { label: '卡组数量', value: decks.length, sub: `全量 ${r?.totalDecks ?? 0}` },
    { label: '赛事数', value: events, sub: r?.events.length ? `数据包 ${r.events.length} 场` : '' },
    { label: '英雄数', value: heroRows.value.length, sub: '' },
    {
      label: 'Top4 转化',
      value: heroRows.value.length > 0
        ? `${(heroRows.value.reduce((s, x) => s + x.top4, 0) / Math.max(1, heroRows.value.reduce((s, x) => s + x.total, 0)) * 100).toFixed(1)}%`
        : '—',
      sub: '全环境 Top4 卡组占比'
    }
  ];
});

/* ── 散点:出场率 × 转化综合分 ── */
const scatterOption = computed(() => {
  const rows = heroRows.value.filter((r) => r.popularity >= 0.5);
  if (rows.length === 0) return null;

  const points = rows.map((r) => ({
    value: [Number(r.popularity.toFixed(2)), Number(r.convert.toFixed(2))] as [number, number],
    name: r.hero,
    tier: r.tier,
    total: r.total,
    top8Rate: Number(r.top8Rate.toFixed(1)),
    top4Rate: Number(r.top4Rate.toFixed(1)),
    convert: Number(r.convert.toFixed(1))
  }));

  const meanX = points.reduce((s, p) => s + (p.value[0] ?? 0), 0) / points.length;
  const meanY = points.reduce((s, p) => s + (p.value[1] ?? 0), 0) / points.length;

  return {
    grid: { left: 60, right: 30, top: 40, bottom: 45 },
    legend: { show: false },
    xAxis: {
      type: 'value',
      name: '出场率 %',
      nameLocation: 'middle',
      nameGap: 28,
      axisLabel: { formatter: '{value}%' }
    },
    yAxis: {
      type: 'value',
      name: '转化综合分',
      axisLabel: { formatter: '{value}' }
    },
    series: [
      {
        type: 'scatter',
        data: points,
        symbolSize: (val: number[]) => Math.max(10, Math.min(46, 6 + Math.sqrt(val[0] ?? 0) * 4.5)),
        label: {
          show: true,
          position: 'top',
          formatter: (p: { data: { name: string } }) => p.data.name,
          fontSize: 10,
          color: '#94a3b8'
        },
        itemStyle: {
          color: (p: { data: { tier: string | null } }) =>
            ({ S: '#b23a27', A: '#c59b46', B: '#3b4a5a', C: '#94a3b8' })[
            p.data.tier ?? ''
            ] ?? '#94a3b8'
        }
      },
      {
        type: 'line',
        data: [],
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { type: 'dashed', color: '#9ca3af' },
          label: { show: false },
          data: [
            { xAxis: meanX },
            { yAxis: meanY }
          ]
        }
      }
    ],
    tooltip: {
      confine: true,
      formatter: (p: { data: { name: string; total: number; value: number[]; top8Rate: number; top4Rate: number; convert: number; tier: string | null } }) =>
        `<b>${p.data.name}</b>${p.data.tier ? ` · Tier ${p.data.tier}` : ''}<br/>` +
        `数量:${p.data.total}<br/>` +
        `出场率:${p.data.value[0]}%<br/>` +
        `转化综合分:${p.data.convert}<br/>` +
        `Top8 率:${p.data.top8Rate}% · Top4 率:${p.data.top4Rate}%<br/>` +
        `<span style="color:#94a3b8">点击查看英雄拆解</span>`
    }
  };
});

/* ── 传奇对分布饼图(ECharts 纯色实心饼;尾部累计 20% 合并为 others;外侧标签) ── */
const LEGEND_OTHERS_TAIL = 0.2;
const legDistOption = computed(() => {
  const r = store.result;
  if (!r || filteredDecks.value.length === 0) return null;
  const rows = legendaryRows(filteredDecks.value, r.catalog, r.totalDecks);
  if (rows.length === 0) return null;
  // 尾部长尾截断:从最小传奇向前累计,合计达到总数 20% 的部分归 others(饼图保留头部 80%)
  const tailTarget = filteredDecks.value.length * LEGEND_OTHERS_TAIL;
  let tailSum = 0;
  let tailCount = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    tailSum += rows[i]!.total;
    tailCount += 1;
    if (tailSum >= tailTarget) break;
  }
  let keep = rows.slice(0, rows.length - tailCount);
  let others = tailSum;
  if (keep.length === 0 && rows.length > 0) {
    // 保护:极端数据下至少保留一个头部传奇,others 不吃掉全部
    keep = [rows[0]!];
    others = tailSum - rows[0]!.total;
  }
  const data: Array<{
    name: string;
    value: number;
    decks: number;
    itemStyle: { color: string };
  }> = keep.map((x, i) => ({
    // 展示名统一为 hero + legend name(如「易 无极剑圣」)
    name: heroLegendName(x),
    value: x.total,
    decks: x.total,
    itemStyle: { color: CHART_PALETTE[i % CHART_PALETTE.length] ?? '#6366f1' }
  }));
  if (others > 0) {
    data.push({ name: 'others', value: others, decks: others, itemStyle: { color: '#94a3b8' } });
  }
  return {
    tooltip: {
      confine: true,
      formatter: (p: { name: string; percent: number; data: { decks: number } }) =>
        `<b>${p.name}</b><br/>${p.data.decks} 套 · ${p.percent}%`
    },
    legend: { show: false },
    series: [
      {
        type: 'pie',
        radius: '62%',
        center: ['50%', '52%'],
        itemStyle: { borderRadius: 5, borderColor: '#f4f1ea', borderWidth: 2 },
        label: {
          show: true,
          position: 'outside',
          fontSize: 11,
          color: '#3b4a5a',
          formatter: (p: { name: string; percent: number }) => `${p.name} ${p.percent}%`
        },
        labelLine: { length: 12, length2: 8, lineStyle: { color: '#b9b3a8' } },
        data
      }
    ]
  };
});

/** 饼图点击 → 下钻传奇构筑页(others 不响应) */
function onLegPieClick(p: { name?: string }): void {
  if (!p.name || p.name === 'others') return;
  const r = store.result;
  if (!r) return;
  const row = legendaryRows(filteredDecks.value, r.catalog, r.totalDecks).find(
    (x) => (x.topHero && x.topHero !== '—' ? x.topHero : x.name) === p.name
  );
  if (row) gotoLegendary(row);
}

/* ── 下钻:英雄/传奇融合页(构筑视角,统一走传奇栏目) ── */
function gotoHero(hero: string): void {
  store.focusHero = hero;
  store.currentView = 'legendary';
}
</script>
<template>
  <div class="fade-in space-y-10">
    <!-- 双叙事切换 -->
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <div class="inline-flex items-center gap-1 text-sm" role="tablist" aria-label="叙事切换">
        <button role="tab" :aria-selected="narrative === 'focus'" class="px-3 py-1.5 rounded-lg transition-colors"
          :class="narrative === 'focus' ? 'bg-brand text-brand-ink font-semibold' : 'text-ink-muted hover:bg-brand-soft'"
          @click="narrative = 'focus'">
          本期聚焦
        </button>
        <button role="tab" :aria-selected="narrative === 'report'" class="px-3 py-1.5 rounded-lg transition-colors"
          :class="narrative === 'report' ? 'bg-brand text-brand-ink font-semibold' : 'text-ink-muted hover:bg-brand-soft'"
          @click="narrative = 'report'">
          趋势对比
        </button>
      </div>
      <div class="flex items-center gap-3 flex-wrap">
        <span v-if="report && narrative === 'report'" class="text-[11px] text-ink-faint tabular-nums">
          对比 {{ report.prevLabel }} → {{ report.currLabel }}(数据包内按周分组 · 始终跨全量数据计算,不受周次筛选影响)
        </span>
        <button v-if="report && narrative === 'report'" @click="copyReport"
          class="btn-ghost px-3 py-1.5 text-xs font-medium">
          {{ copied ? "已复制" : "复制趋势报告 Markdown" }}
        </button>
      </div>
    </div>

    <!-- ══════════ 头版(本期聚焦) ══════════ -->
    <template v-if="narrative === 'focus'">
      <!-- 传奇综合表现榜 + 报眼 -->
      <section class="grid grid-cols-1 xl:grid-cols-3 gap-8">
        <!-- 传奇综合表现榜(metaScore = 转化综合分 × log₁₀(数量+10) × 名次权重) -->
        <div class="xl:col-span-2 min-w-0">
          <SectionHeading eyebrow="第二版 · 综合表现" title="传奇综合表现榜"
            :note="`综合分 = 转化综合分 × log₁₀(数量+10) × 名次权重 —— 又强、又主流、又稳定才是 T0 · 数量≥${metaMinSample}`" />
          <div v-if="metaTop.length > 0" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
            <button v-for="(r, i) in metaTop" :key="r.cardNo"
              class="group rounded-xl border border-panel-border bg-panel-bg p-3 text-left transition-colors hover:border-brand-faint"
              @click="gotoLegendary(r)">
              <div class="flex items-center gap-2.5">
                <span
                  class="shrink-0 w-6 h-6 rounded-md flex items-center justify-center font-display font-bold text-xs tabular-nums"
                  :class="i === 0 ? 'bg-brand-soft text-brand' : 'bg-[rgba(59,74,90,0.1)] text-ink-faint'">
                  {{ i + 1 }}
                </span>
                <CardThumb :id="r.cardNo" :name="r.name" :catalog="store.result!.catalog" size="sm"
                  :show-name="false" />
                <div class="min-w-0">
                  <p class="font-display text-sm font-bold text-ink truncate">{{ heroLegendName(r) }}</p>
                  <p class="text-[10px] text-ink-faint tabular-nums">
                    数量 {{ r.total }} · 均名次 {{ avgRankText(r) }}
                  </p>
                </div>
              </div>
              <div class="mt-2 flex items-end justify-between gap-2">
                <span class="font-display font-bold text-lg text-brand tabular-nums leading-none">
                  {{ r.metaScore?.toFixed(0) }}
                </span>
                <span class="text-[10px] text-ink-faint tabular-nums">
                  转化 {{ r.convert.toFixed(1) }}
                </span>
              </div>
            </button>
          </div>
          <div v-else class="py-12 text-center text-ink-faint text-sm">
            暂无足够数据生成综合表现榜(数量≥{{ metaMinSample }})
          </div>
        </div>

        <!-- 报眼:KPI 数据行 -->
        <aside class="xl:border-l xl:border-panel-border xl:pl-8">
          <p class="eyebrow mb-2">本报数据 · By the Numbers</p>
          <div class="divide-y divide-panel-border">
            <div v-for="k in kpis" :key="k.label" class="py-3 first:pt-0">
              <div class="text-[11px] tracking-[0.18em] text-ink-faint">{{ k.label }}</div>
              <div class="text-[28px] font-display font-bold text-ink tabular-nums leading-tight">
                {{ k.value }}
              </div>
              <div v-if="k.sub" class="text-[11px] text-ink-faint">{{ k.sub }}</div>
            </div>
          </div>
        </aside>
      </section>

      <div class="hairline"></div>

      <!-- 多栏:Tier List │ 传奇对分布 -->
      <section class="grid grid-cols-1 xl:grid-cols-5 gap-8 xl:divide-x xl:divide-panel-border">
        <div class="xl:col-span-3 xl:pr-8 min-w-0">
          <SectionHeading eyebrow="第二版 · 强弱榜" title="传奇 Tier List"
            :note="`综合分 = Top8率35% + Top4率35% + 冠军率20% + 亚军率10% · 全量展示不限数量 · 点击行下钻英雄拆解`">
            <template #actions>
              <TableDownloadButton
                :target="() => tierTableEl"
                title="传奇 Tier List"
                eyebrow="第二版 · 强弱榜"
                note="综合分 = Top8率35% + Top4率35% + 冠军率20% + 亚军率10% · 全量展示不限数量"
              />
            </template>
          </SectionHeading>
          <div class="overflow-x-auto max-h-[430px] overflow-y-auto">
            <table ref="tierTableEl" class="w-full text-sm">
              <thead class="sticky-thead">
                <tr class="text-ink-faint border-b border-panel-border text-xs">
                  <SortableTh :sort="tierSort" col-key="tier" label="Tier" align="left" />
                  <SortableTh :sort="tierSort" col-key="hero" label="英雄" align="left" />
                  <SortableTh :sort="tierSort" col-key="total" label="数量" align="right" />
                  <SortableTh :sort="tierSort" col-key="popularity" label="出场率" align="right" />
                  <SortableTh :sort="tierSort" col-key="top8Rate" label="Top8 率" align="right" />
                  <SortableTh :sort="tierSort" col-key="top4Rate" label="Top4 率" align="right" />
                  <SortableTh :sort="tierSort" col-key="champions" label="冠军" align="right" />
                  <SortableTh :sort="tierSort" col-key="runnersUp" label="亚军" align="right" />
                  <SortableTh :sort="tierSort" col-key="tierScore" label="评分" align="right" />
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in tierRowsSorted" :key="r.hero"
                  class="table-row border-b border-[rgba(59,74,90,0.08)] cursor-pointer" @click="gotoHero(r.hero)">
                  <td class="py-1.5 px-2">
                    <TierBadge :tier="r.tier" size="sm" />
                  </td>
                  <td class="py-1.5 px-2 font-medium text-ink-muted">{{ r.hero }}</td>
                  <td class="py-1.5 px-2 text-right tabular-nums">{{ r.total }}</td>
                  <td class="py-1.5 px-2 text-right tabular-nums">{{ r.popularity.toFixed(1) }}%</td>
                  <td class="py-1.5 px-2 text-right tabular-nums text-ink-muted">{{ r.top8Rate.toFixed(1) }}%</td>
                  <td class="py-1.5 px-2 text-right tabular-nums font-semibold"
                    :class="r.top4Rate >= 20 ? 'text-delta-up' : 'text-ink-muted'">
                    {{ r.top4Rate.toFixed(1) }}%
                  </td>
                  <td class="py-1.5 px-2 text-right tabular-nums" :title="`冠军率 ${r.championRate.toFixed(1)}%`">
                    {{ r.champions }}
                  </td>
                  <td class="py-1.5 px-2 text-right tabular-nums" :title="`亚军率 ${r.runnerUpRate.toFixed(1)}%`">
                    {{ r.runnersUp }}
                  </td>
                  <td class="py-1.5 px-2 text-right tabular-nums text-ink-faint">{{ r.tierScore ?? '—' }}</td>
                </tr>
                <tr v-if="tierRows.length === 0">
                  <td colspan="9" class="py-8 text-center text-ink-faint text-sm">
                    暂无英雄数据
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="xl:col-span-2 xl:pl-8 min-w-0">
          <SectionHeading title="传奇对分布"
            :note="`按传奇卡聚合(不考虑颜色);尾部长尾合计 20% 合并为 others · 扇区为传奇卡图 · 全量 ${filteredDecks.length} 套`" />
          <ChartCard
            v-if="legDistOption"
            :option="legDistOption"
            height="380px"
            :show-toolbox="false"
            @chart-click="onLegPieClick"
          />
          <div v-else class="h-[380px] flex items-center justify-center text-ink-faint text-sm">
            无传奇数据
          </div>
        </div>
      </section>

      <div class="hairline"></div>

      <!-- 全宽:环境阶梯散点 -->
      <section>
        <SectionHeading eyebrow="第三版 · 环境阶梯" title="环境阶梯:热度 × 强度"
          note="右上 = 主流且强势;气泡大小 = 数量;虚线为环境均值。颜色即 Tier。支持框选缩放。" />
        <ChartCard v-if="scatterOption" :option="scatterOption" height="440px"
          @chart-click="(p) => p.name && gotoHero(String(p.name))" />
        <div v-else class="h-[300px] flex items-center justify-center text-ink-faint text-sm">
          当前过滤条件下无数据
        </div>
      </section>
    </template>

    <!-- ══════════ 趋势对比叙事 ══════════ -->
    <template v-else>
      <div v-if="report" class="space-y-8">
        <!-- 趋势 KPI(带环比) -->
        <section>
          <SectionHeading eyebrow="头版数据 · Week over Week" title="本期概览" />
          <div class="grid grid-cols-2 lg:grid-cols-4 divide-x divide-panel-border">
            <StatCard label="本期数量" :value="report.currSample" :sub="`上期 ${report.prevSample} 套`"
              :delta="report.sampleDelta" />
            <StatCard label="本期赛事" :value="report.currEvents" :sub="`上期 ${report.prevEvents} 场`" />
            <StatCard label="Meta 集中度 (HHI)" :value="report.hhiCurr.toFixed(0)"
              :sub="`上期 ${report.hhiPrev.toFixed(0)} · 越高越单一`" :delta="report.hhiCurr - report.hhiPrev" />
          </div>
        </section>

        <div class="hairline"></div>

        <!-- 热度升降榜 -->
        <section class="grid grid-cols-1 xl:grid-cols-2 gap-8 xl:divide-x xl:divide-panel-border">
          <div class="xl:pr-8 min-w-0">
            <SectionHeading small eyebrow="▲ 升" title="热度上升" />
            <ul class="space-y-1">
              <li v-for="it in report.popUp" :key="it.key"
                class="flex items-center justify-between gap-2 py-1.5 border-b border-[rgba(59,74,90,0.08)] last:border-0">
                <div class="min-w-0">
                  <div class="text-sm font-medium text-ink-muted truncate">
                    {{ it.key }}
                  </div>
                  <div class="text-[11px] text-ink-faint tabular-nums">
                    {{ it.prev?.toFixed(1) }}% → {{ it.curr?.toFixed(1) }}%
                    <template v-if="rankText(it)"> · {{ rankText(it) }}</template>
                  </div>
                </div>
                <DeltaBadge :delta="it.delta" />
              </li>
            </ul>
          </div>
          <div class="xl:pl-8 min-w-0">
            <SectionHeading small eyebrow="▼ 降" title="热度下降" />
            <ul class="space-y-1">
              <li v-for="it in report.popDown" :key="it.key"
                class="flex items-center justify-between gap-2 py-1.5 border-b border-[rgba(59,74,90,0.08)] last:border-0">
                <div class="min-w-0">
                  <div class="text-sm font-medium text-ink-muted truncate">
                    {{ it.key }}
                  </div>
                  <div class="text-[11px] text-ink-faint tabular-nums">
                    {{ it.prev?.toFixed(1) }}% → {{ it.curr?.toFixed(1) }}%
                    <template v-if="rankText(it)"> · {{ rankText(it) }}</template>
                  </div>
                </div>
                <DeltaBadge :delta="it.delta" />
              </li>
            </ul>
          </div>
        </section>

        <div class="hairline"></div>

        <!-- 周际热度时间线 -->
        <section>
          <SectionHeading small title="周际热度时间线" note="Top 英雄出场率 · 周际迁移" />
          <ChartCard v-if="timelineOption" :option="timelineOption" height="320px" :show-toolbox="false" />
          <div v-else class="h-40 flex items-center justify-center text-ink-faint text-sm">
            无时间线数据
          </div>
        </section>

        <div class="hairline"></div>

        <!-- 传奇 / 域对 movers -->
        <section class="grid grid-cols-1 xl:grid-cols-2 gap-8 xl:divide-x xl:divide-panel-border">
          <div class="xl:pr-8 min-w-0">
            <SectionHeading small title="传奇热度变化" />
            <ul class="space-y-1">
              <li v-for="it in report.legMovers" :key="it.key"
                class="flex items-center justify-between gap-2 py-1.5 border-b border-[rgba(59,74,90,0.08)] last:border-0">
                <div class="min-w-0">
                  <div class="text-sm font-medium text-ink-muted truncate">
                    {{ it.key }}
                  </div>
                  <div class="text-[11px] text-ink-faint tabular-nums">
                    {{ it.prev?.toFixed(1) }}% → {{ it.curr?.toFixed(1) }}%
                  </div>
                </div>
                <DeltaBadge :delta="it.delta" />
              </li>
            </ul>
          </div>
          <div class="xl:pl-8 min-w-0">
            <SectionHeading small title="域对热度变化" />
            <ul class="space-y-1">
              <li v-for="it in report.domainMovers" :key="it.key"
                class="flex items-center justify-between gap-2 py-1.5 border-b border-[rgba(59,74,90,0.08)] last:border-0">
                <div class="min-w-0">
                  <div class="text-sm font-medium text-ink-muted truncate">
                    {{ it.key }}
                  </div>
                  <div class="text-[11px] text-ink-faint tabular-nums">
                    {{ it.prev?.toFixed(1) }}% → {{ it.curr?.toFixed(1) }}%
                  </div>
                </div>
                <DeltaBadge :delta="it.delta" />
              </li>
            </ul>
          </div>
        </section>

        <div class="hairline"></div>

        <!-- 转化变化榜 -->
        <section>
          <SectionHeading small title="转化变化榜">
            <template #actions>
              <TableDownloadButton
                :target="() => convertTableEl"
                title="转化变化榜"
                eyebrow="趋势对比"
                note="周际对比 · 转化综合分 = Top8率35% + Top4率35% + 冠军率20% + 亚军率10%"
              />
            </template>
          </SectionHeading>
          <div class="overflow-x-auto">
            <table ref="convertTableEl" class="w-full text-sm">
              <thead class="sticky-thead">
                <tr class="text-ink-faint border-b border-panel-border text-xs">
                  <SortableTh :sort="convertSort" col-key="key" label="英雄" align="left" />
                  <SortableTh :sort="convertSort" col-key="prev" label="上期转化" align="right" />
                  <SortableTh :sort="convertSort" col-key="curr" label="本期转化" align="right" />
                  <SortableTh :sort="convertSort" col-key="delta" label="Δ" align="right" />
                  <SortableTh :sort="convertSort" col-key="rankChange" label="名次变动" align="right" />
                  <SortableTh :sort="convertSort" col-key="currSample" label="本期数量" align="right" />
                </tr>
              </thead>
              <tbody>
                <tr v-for="it in convertRowsSorted" :key="it.key"
                  class="border-b border-[rgba(59,74,90,0.08)] last:border-0">
                  <td class="py-1.5 px-2 font-medium text-ink-muted">{{ it.key }}</td>
                  <td class="py-1.5 px-2 text-right tabular-nums">{{ it.prev?.toFixed(1) }}</td>
                  <td class="py-1.5 px-2 text-right tabular-nums">{{ it.curr?.toFixed(1) }}</td>
                  <td class="py-1.5 px-2 text-right">
                    <DeltaBadge :delta="it.delta" />
                  </td>
                  <td class="py-1.5 px-2 text-right tabular-nums text-ink-faint">
                    {{ rankText(it) || '—' }}
                  </td>
                  <td class="py-1.5 px-2 text-right tabular-nums text-ink-faint">
                    {{ it.currSample }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <p class="text-[11px] text-ink-faint">
          口径:周际对比基于数据包内周次分组,始终使用全量数据(不受「范围·周次」筛选影响);转化综合分 = Top8率35% + Top4率35% + 冠军率20% + 亚军率10%;热度=威尔逊下界(95% 置信)。
        </p>
      </div>
      <div v-else class="py-16 text-center text-sm text-ink-faint">
        需 ≥2 个周次分组才能生成趋势对比
      </div>
    </template>

  </div>
</template>
