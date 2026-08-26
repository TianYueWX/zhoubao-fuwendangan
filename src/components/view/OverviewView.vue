<script setup lang="ts">
/**
 * OverviewView.vue · Meta 总览 ——「头版」
 *
 * 本期聚焦(玩家叙事):
 *   - 头条(Lead Story):本期最佳传奇,按转化综合分(Top8 率×60% + 冠军率×40%)
 *     选取,大号衬线标题 + 导语 + 卡图照片,点击下钻传奇对比
 *   - 报眼:KPI 数据行(样本 / 赛事 / 英雄 / 环境胜率)
 *   - 多栏版面:英雄 Tier List │ 传奇域对分布(栏间竖细线)
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
import RuneSeal from '@/components/RuneSeal.vue';
import CardThumb from '@/components/CardThumb.vue';
import { quickHeroRows, buildWeeklyReport, legendaryRows, sortLeadCandidates } from '@/core';
import type { DeltaItem } from '@/core';
import type { LegendaryRow } from '@/core/legendaryStats';
import { reportToMarkdown } from '@/utils/reportMarkdown';
import { CHART_PALETTE } from '@/utils/palette';
import { CARD_COLOR_HEX } from '@/utils/palette';
import { CARD_COLOR_LABELS } from '@/types';
import type { CardColor } from '@/types';

/* ── 双叙事切换:本期聚焦 / 趋势对比 ── */
const narrative = ref<'focus' | 'report'>('focus');

/* ── 过滤后的卡组集合 ── */
const filteredDecks = computed(() =>
  store.result ? applyGlobalFilters(store.result.allDecks) : []
);

const heroRows = computed(() => {
  if (!store.result) return [];
  return quickHeroRows(filteredDecks.value, store.result.totalDecks, store.result.hasWinData);
});

const tierOrder = { S: 0, A: 1, B: 2, C: 3 } as const;

const tierRows = computed(() => {
  const withTier = heroRows.value.filter((r) => r.tier);
  return withTier.sort(
    (a, b) =>
      tierOrder[a.tier as keyof typeof tierOrder] -
        tierOrder[b.tier as keyof typeof tierOrder] ||
      b.tierScore! - a.tierScore!
  );
});

/* ── 头条:本期最佳传奇(转化综合分 = Top8 率×60% + 冠军率×40%,不看胜率) ── */
const leadStory = computed<LegendaryRow | null>(() => {
  const r = store.result;
  if (!r || filteredDecks.value.length === 0) return null;
  const minSample = Math.max(5, Math.floor(filteredDecks.value.length * 0.02));
  const rows = sortLeadCandidates(
    legendaryRows(filteredDecks.value, r.catalog, r.totalDecks),
    minSample
  );
  return rows[0] ?? null;
});

const leadHeadline = computed(() => {
  const l = leadStory.value;
  if (!l) return '';
  return `${l.name} 领跑本期传奇强度榜`;
});

const leadStandfirst = computed(() => {
  const l = leadStory.value;
  if (!l) return '';
  let s = `本期共收录 ${filteredDecks.value.length} 套卡组、${new Set(filteredDecks.value.map((d) => d.activityName)).size} 场赛事。${l.name} 出现在其中 ${l.total} 套(出场率 ${l.popularity.toFixed(1)}%),打进 Top8 ${l.top8} 次(Top8 转化 ${l.top8Rate.toFixed(1)}%)、夺冠 ${l.champions} 次(冠军转化 ${l.championRate.toFixed(1)}%)`;
  if (l.topHero && l.topHero !== '—') {
    s += `,最常与 ${l.topHero} 搭档(${l.topHeroRate.toFixed(0)}%)`;
  }
  return s + '。点击头条或右侧卡片,查看该传奇的全部构筑对比。';
});

function gotoLegendary(): void {
  store.currentView = 'legendary';
}

/* ── 趋势对比叙事 ── */
const report = computed(() => {
  const r = store.result;
  if (!r) return null;
  return buildWeeklyReport(r.allDecks, r.hasWinData, r.catalog);
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

/* ── KPI(报眼) ── */
const kpis = computed(() => {
  const r = store.result;
  const decks = filteredDecks.value;
  const events = new Set(decks.map((d) => d.activityName)).size;
  let winsSum = 0;
  let roundsSum = 0;
  for (const d of decks) {
    if (d.wins !== null && d.eventRounds !== null && d.eventRounds > 0) {
      winsSum += d.wins;
      roundsSum += d.eventRounds;
    }
  }
  return [
    { label: '卡组样本', value: decks.length, sub: `全量 ${r?.totalDecks ?? 0}` },
    { label: '赛事数', value: events, sub: r?.events.length ? `数据包 ${r.events.length} 场` : '' },
    { label: '英雄数', value: heroRows.value.length, sub: '' },
    {
      label: '环境平均胜率',
      value:
        roundsSum > 0 ? `${((winsSum / roundsSum) * 100).toFixed(1)}%` : '—',
      sub: roundsSum > 0 ? `${Math.round(roundsSum / Math.max(events, 1))} 轮/赛事均值` : '导入 rank_data 后可用'
    }
  ];
});

/* ── 散点:出场率 × 胜率 ── */
const scatterOption = computed(() => {
  const rows = heroRows.value.filter((r) => r.popularity >= 0.5);
  if (rows.length === 0) return null;
  const hasWin = rows.some((r) => r.winRate !== null);

  const points = rows.map((r) => ({
    value: [Number(r.popularity.toFixed(2)), Number((r.winRate ?? r.top8Rate).toFixed(2))] as [number, number],
    name: r.hero,
    tier: r.tier,
    total: r.total,
    top8Rate: Number(r.top8Rate.toFixed(1)),
    realWin: r.winRate !== null
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
      name: hasWin ? '真实胜率 %' : 'Top8 率 %(未导入胜场)',
      axisLabel: { formatter: '{value}%' }
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
      formatter: (p: { data: { name: string; total: number; value: number[]; top8Rate: number; realWin: boolean; tier: string | null } }) =>
        `<b>${p.data.name}</b>${p.data.tier ? ` · Tier ${p.data.tier}` : ''}<br/>` +
        `样本:${p.data.total}<br/>` +
        `出场率:${p.data.value[0]}%<br/>` +
        (p.data.realWin
          ? `真实胜率:${p.data.value[1]}%<br/>`
          : `Top8 率:${p.data.top8Rate}%<br/>(未导入胜场数据)`) +
        `<span style="color:#94a3b8">点击查看英雄拆解</span>`
    }
  };
});

/* ── 域对环图 ── */
function pairColor(colors: readonly CardColor[]): string {
  const first = colors[0];
  if (colors.length === 0 || !first) return '#94a3b8';
  if (colors.length === 1) return CARD_COLOR_HEX[first] ?? '#94a3b8';
  const second = colors[1] ?? first;
  return mixHex(CARD_COLOR_HEX[first] ?? '#94a3b8', CARD_COLOR_HEX[second] ?? '#94a3b8');
}

function hexToRgb(h: string): [number, number, number] {
  const v = h.replace('#', '');
  return [
    parseInt(v.slice(0, 2), 16) || 0,
    parseInt(v.slice(2, 4), 16) || 0,
    parseInt(v.slice(4, 6), 16) || 0
  ];
}

function mixHex(a: string, b: string): string {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  const mix = ra.map((v, i) => Math.round((v + (rb[i] ?? v)) / 2));
  return `#${mix.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const pairOption = computed(() => {
  const cs = store.result?.colorStats;
  if (!cs || cs.pairs.length === 0) return null;
  const top = cs.pairs.slice(0, 12);
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
        radius: ['52%', '78%'],
        center: ['50%', '52%'],
        itemStyle: { borderRadius: 6, borderColor: 'transparent', borderWidth: 2 },
        label: { show: true, position: 'outside', fontSize: 11, color: '#94a3b8' },
        data: top.map((p) => ({
          name: p.label,
          value: p.decks,
          decks: p.decks,
          itemStyle: { color: pairColor(p.colors), type: 'linear' }
        }))
      }
    ]
  };
});

/* ── 下钻 ── */
function gotoHero(hero: string): void {
  store.focusHero = hero;
  store.currentView = 'heroes';
}
</script>

<template>
  <div class="fade-in space-y-10">
    <!-- 双叙事切换 -->
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <div class="inline-flex items-center gap-1 text-sm" role="tablist" aria-label="叙事切换">
        <button
          role="tab"
          :aria-selected="narrative === 'focus'"
          class="px-3 py-1.5 rounded-lg transition-colors"
          :class="narrative === 'focus' ? 'bg-brand text-brand-ink font-semibold' : 'text-ink-muted hover:bg-brand-soft'"
          @click="narrative = 'focus'"
        >
          本期聚焦
        </button>
        <button
          role="tab"
          :aria-selected="narrative === 'report'"
          class="px-3 py-1.5 rounded-lg transition-colors"
          :class="narrative === 'report' ? 'bg-brand text-brand-ink font-semibold' : 'text-ink-muted hover:bg-brand-soft'"
          @click="narrative = 'report'"
        >
          趋势对比
        </button>
      </div>
      <div class="flex items-center gap-3 flex-wrap">
        <span
          v-if="report && narrative === 'report'"
          class="text-[11px] text-ink-faint tabular-nums"
        >
          对比 {{ report.prevLabel }} → {{ report.currLabel }}(数据包内按周分组 · 始终跨全量数据计算,不受周次筛选影响)
        </span>
        <button
          v-if="report && narrative === 'report'"
          @click="copyReport"
          class="btn-ghost px-3 py-1.5 text-xs font-medium"
        >
          {{ copied ? "✅ 已复制" : "📋 复制趋势报告 Markdown" }}
        </button>
      </div>
    </div>

    <!-- ══════════ 头版(本期聚焦) ══════════ -->
    <template v-if="narrative === 'focus'">
      <!-- 头条 + 报眼 -->
      <section class="grid grid-cols-1 xl:grid-cols-3 gap-8">
        <!-- 头条 Lead Story -->
        <article
          v-if="leadStory"
          class="xl:col-span-2 cursor-pointer group min-w-0"
          @click="gotoLegendary"
        >
          <p class="eyebrow mb-2">本期头条 · Lead Story</p>
          <h2 class="headline-xl text-[30px] md:text-[40px] text-ink group-hover:text-brand transition-colors">
            {{ leadHeadline }}
          </h2>
          <p class="standfirst mt-4 max-w-[62ch]">{{ leadStandfirst }}</p>
          <div class="mt-5 flex items-end gap-5 flex-wrap">
            <CardThumb
              :id="leadStory.cardNo"
              :name="leadStory.name"
              :catalog="store.result!.catalog"
              size="lg"
              :show-name="false"
            />
            <div class="text-xs text-ink-faint leading-relaxed pb-1">
              <p class="flex items-center gap-2 mb-1">
                <RuneSeal v-for="c in leadStory.colors" :key="c" :size="10" :only="c" />
                <span class="font-display text-sm font-bold text-ink-muted">{{ leadStory.name }}</span>
                <span class="font-mono">{{ leadStory.cardNo }}</span>
                <span v-if="leadStory.variants > 1">×{{ leadStory.variants }} 版本</span>
              </p>
              <p class="tabular-nums">
                样本 {{ leadStory.total }} · Top8 转化 {{ leadStory.top8Rate.toFixed(1) }}%
                · 夺冠 {{ leadStory.champions }} 次({{ leadStory.championRate.toFixed(1) }}%)
              </p>
              <p class="text-brand mt-1">→ 前往「传奇」栏目对比全部构筑</p>
            </div>
          </div>
        </article>
        <article v-else class="xl:col-span-2">
          <p class="eyebrow mb-2">本期头条 · Lead Story</p>
          <h2 class="headline-xl text-[30px] md:text-[38px] text-ink-faint">等待数据上架</h2>
          <p class="standfirst mt-4 max-w-[52ch]">
            前往「数据」栏目上传三个必需文件,或一键加载内置预设包,头条将自动生成。
          </p>
        </article>

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

      <!-- 多栏:Tier List │ 域对分布 -->
      <section class="grid grid-cols-1 xl:grid-cols-5 gap-8 xl:divide-x xl:divide-panel-border">
        <div class="xl:col-span-3 xl:pr-8 min-w-0">
          <SectionHeading
            eyebrow="第二版 · 强弱榜"
            title="英雄 Tier List"
            :note="`综合分 = 胜率55% + Top8率20% + 出场率25%,点击行下钻英雄拆解 · ${
              store.result?.hasWinData ? '基于真实胜场 · 样本≥15' : '未导入胜场 · 按 Top8+热度评级'
            }`"
          />
          <div class="overflow-x-auto max-h-[430px] overflow-y-auto">
            <table class="w-full text-sm">
              <thead class="sticky-thead">
                <tr class="text-ink-faint border-b border-panel-border text-xs">
                  <th class="py-2 px-2 text-left">Tier</th>
                  <th class="py-2 px-2 text-left">英雄</th>
                  <th class="py-2 px-2 text-right">样本</th>
                  <th class="py-2 px-2 text-right">出场率</th>
                  <th class="py-2 px-2 text-right">
                    {{ store.result?.hasWinData ? '真实胜率' : 'Top8 率' }}
                  </th>
                  <th class="py-2 px-2 text-right">评分</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="r in tierRows"
                  :key="r.hero"
                  class="table-row border-b border-[rgba(59,74,90,0.08)] cursor-pointer"
                  @click="gotoHero(r.hero)"
                >
                  <td class="py-1.5 px-2"><TierBadge :tier="r.tier" size="sm" /></td>
                  <td class="py-1.5 px-2 font-medium text-ink-muted">{{ r.hero }}</td>
                  <td class="py-1.5 px-2 text-right tabular-nums">{{ r.total }}</td>
                  <td class="py-1.5 px-2 text-right tabular-nums">{{ r.popularity.toFixed(1) }}%</td>
                  <td
                    class="py-1.5 px-2 text-right tabular-nums font-semibold"
                    :class="(r.winRate ?? 0) >= 50 ? 'text-delta-up' : 'text-ink-muted'"
                  >
                    {{ (r.winRate ?? r.top8Rate).toFixed(1) }}%
                  </td>
                  <td class="py-1.5 px-2 text-right tabular-nums text-ink-faint">{{ r.tierScore }}</td>
                </tr>
                <tr v-if="tierRows.length === 0">
                  <td colspan="6" class="py-8 text-center text-ink-faint text-sm">
                    暂无足够样本评级(需要 ≥15 卡组且 ≥4 个英雄)
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="xl:col-span-2 xl:pl-8 min-w-0">
          <SectionHeading
            title="传奇域对分布"
            :note="`每套卡组的传奇定义双色域;共识别 ${
              store.result?.colorStats?.identifiedDecks ?? 0
            } / ${filteredDecks.length} 套`"
          />
          <ChartCard v-if="pairOption" :option="pairOption" height="380px" :show-toolbox="false" />
          <div v-else class="h-[380px] flex items-center justify-center text-ink-faint text-sm">
            无域对数据
          </div>
          <!-- 六符文图例 -->
          <div class="flex items-center justify-center gap-3 mt-1 flex-wrap">
            <span
              v-for="(label, c) in CARD_COLOR_LABELS"
              :key="c"
              class="inline-flex items-center gap-1 text-[10px] text-ink-muted"
              v-show="c !== 'colorless'"
            >
              <RuneSeal :size="10" :only="c" />
              {{ label }}
            </span>
          </div>
        </div>
      </section>

      <div class="hairline"></div>

      <!-- 全宽:环境阶梯散点 -->
      <section>
        <SectionHeading
          eyebrow="第三版 · 环境阶梯"
          title="环境阶梯:热度 × 强度"
          note="右上 = 主流且强势;气泡大小 = 样本数;虚线为环境均值。颜色即 Tier。支持框选缩放。"
        />
        <ChartCard
          v-if="scatterOption"
          :option="scatterOption"
          height="440px"
          @chart-click="(p) => p.name && gotoHero(String(p.name))"
        />
        <div v-else class="h-[300px] flex items-center justify-center text-ink-faint text-sm">
          当前过滤条件下无样本
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
            <StatCard
              label="本期样本"
              :value="report.currSample"
              :sub="`上期 ${report.prevSample} 套`"
              :delta="report.sampleDelta"
            />
            <StatCard label="本期赛事" :value="report.currEvents" :sub="`上期 ${report.prevEvents} 场`" />
            <StatCard
              label="环境胜率"
              :value="report.envCurr != null ? report.envCurr.toFixed(1) + '%' : '—'"
              :sub="`上期 ${report.envPrev != null ? (report.envPrev * 100).toFixed(1) + '%' : '—'}`"
              :delta="report.envDelta"
              :tone="report.envDelta != null && report.envDelta > 0 ? 'good' : 'default'"
            />
            <StatCard
              label="Meta 集中度 (HHI)"
              :value="report.hhiCurr.toFixed(0)"
              :sub="`上期 ${report.hhiPrev.toFixed(0)} · 越高越单一`"
              :delta="report.hhiCurr - report.hhiPrev"
            />
          </div>
        </section>

        <div class="hairline"></div>

        <!-- 热度升降榜 -->
        <section class="grid grid-cols-1 xl:grid-cols-2 gap-8 xl:divide-x xl:divide-panel-border">
          <div class="xl:pr-8 min-w-0">
            <SectionHeading small eyebrow="▲ 升" title="热度上升" />
            <ul class="space-y-1">
              <li
                v-for="it in report.popUp"
                :key="it.key"
                class="flex items-center justify-between gap-2 py-1.5 border-b border-[rgba(59,74,90,0.08)] last:border-0"
              >
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
              <li
                v-for="it in report.popDown"
                :key="it.key"
                class="flex items-center justify-between gap-2 py-1.5 border-b border-[rgba(59,74,90,0.08)] last:border-0"
              >
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
          <SectionHeading
            small
            title="周际热度时间线"
            note="Top 英雄出场率 · 周际迁移"
          />
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
              <li
                v-for="it in report.legMovers"
                :key="it.key"
                class="flex items-center justify-between gap-2 py-1.5 border-b border-[rgba(59,74,90,0.08)] last:border-0"
              >
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
              <li
                v-for="it in report.domainMovers"
                :key="it.key"
                class="flex items-center justify-between gap-2 py-1.5 border-b border-[rgba(59,74,90,0.08)] last:border-0"
              >
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

        <!-- 胜率变化榜 -->
        <section>
          <SectionHeading small title="胜率变化榜" />
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="sticky-thead">
                <tr class="text-ink-faint border-b border-panel-border text-xs">
                  <th class="py-2 px-2 text-left">英雄</th>
                  <th class="py-2 px-2 text-right">上期胜率</th>
                  <th class="py-2 px-2 text-right">本期胜率</th>
                  <th class="py-2 px-2 text-right">Δpp</th>
                  <th class="py-2 px-2 text-right">名次变动</th>
                  <th class="py-2 px-2 text-right">本期样本</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="it in report.winMovers"
                  :key="it.key"
                  class="border-b border-[rgba(59,74,90,0.08)] last:border-0"
                >
                  <td class="py-1.5 px-2 font-medium text-ink-muted">{{ it.key }}</td>
                  <td class="py-1.5 px-2 text-right tabular-nums">{{ it.prev?.toFixed(1) }}%</td>
                  <td class="py-1.5 px-2 text-right tabular-nums">{{ it.curr?.toFixed(1) }}%</td>
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
          口径:周际对比基于数据包内周次分组,始终使用全量数据(不受「范围·周次」筛选影响);胜率为贝叶斯收缩修正值;热度=出场率。
        </p>
      </div>
      <div
        v-else
        class="py-16 text-center text-sm text-ink-faint"
      >
        需 ≥2 个周次分组才能生成趋势对比
      </div>
    </template>

  </div>
</template>
