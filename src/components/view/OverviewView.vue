<script setup lang="ts">
/**
 * OverviewView.vue · Meta 总览
 *  - KPI 行
 *  - 英雄 Tier List(可点击 → 英雄拆解)
 *  - 出场率 × 胜率象限散点(点选联动过滤)
 *  - 域对(Domain Identity)占比环图
 */
import { computed, ref } from 'vue';
import { store, applyGlobalFilters } from '@/store/analysis';
import ChartCard from '@/components/ChartCard.vue';
import StatCard from '@/components/StatCard.vue';
import TierBadge from '@/components/TierBadge.vue';
import { quickHeroRows } from '@/core';
import { CARD_COLOR_HEX } from '@/utils/palette';
import { CARD_COLOR_LABELS } from '@/types';
import type { CardColor } from '@/types';

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

/* ── KPI ── */
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
            ({ S: '#f59e0b', A: '#f43f5e', B: '#0ea5e9', C: '#94a3b8' })[
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
const drillHint = ref('');
function gotoHero(hero: string): void {
  store.filterHero = hero === store.filterHero ? '' : hero;
  store.currentView = 'heroes';
}
</script>

<template>
  <div class="fade-in space-y-6">
    <!-- KPI -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <StatCard v-for="k in kpis" :key="k.label" :label="k.label" :value="k.value" :sub="k.sub" />
    </div>

    <div class="grid grid-cols-1 xl:grid-cols-5 gap-5">
      <!-- Tier List -->
      <section class="panel rounded-2xl p-5 xl:col-span-3">
        <div class="flex items-baseline justify-between mb-1 flex-wrap gap-2">
          <h3 class="text-lg font-bold text-slate-800 dark:text-white">🏅 英雄 Tier List</h3>
          <span class="text-[11px] text-slate-400">
            {{ store.result?.hasWinData ? '基于真实胜场 · 样本≥15' : '未导入胜场 · 按 Top8+热度评级' }}
          </span>
        </div>
        <p class="text-xs text-slate-400 mb-3">综合分 = 胜率55% + Top8率20% + 出场率25%,点击行下钻英雄拆解</p>
        <div class="overflow-x-auto max-h-[430px] overflow-y-auto">
          <table class="w-full text-sm">
            <thead class="sticky-thead">
              <tr class="text-slate-400 border-b border-slate-200 dark:border-slate-700 text-xs">
                <th class="py-2 px-2 text-left bg-white dark:bg-slate-900">Tier</th>
                <th class="py-2 px-2 text-left bg-white dark:bg-slate-900">英雄</th>
                <th class="py-2 px-2 text-right bg-white dark:bg-slate-900">样本</th>
                <th class="py-2 px-2 text-right bg-white dark:bg-slate-900">出场率</th>
                <th class="py-2 px-2 text-right bg-white dark:bg-slate-900">
                  {{ store.result?.hasWinData ? '真实胜率' : 'Top8 率' }}
                </th>
                <th class="py-2 px-2 text-right bg-white dark:bg-slate-900">评分</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="r in tierRows"
                :key="r.hero"
                class="table-row border-b border-slate-100 dark:border-slate-800/50 cursor-pointer"
                @click="gotoHero(r.hero)"
              >
                <td class="py-1.5 px-2"><TierBadge :tier="r.tier" size="sm" /></td>
                <td class="py-1.5 px-2 font-medium text-slate-700 dark:text-gray-200">{{ r.hero }}</td>
                <td class="py-1.5 px-2 text-right tabular-nums">{{ r.total }}</td>
                <td class="py-1.5 px-2 text-right tabular-nums">{{ r.popularity.toFixed(1) }}%</td>
                <td
                  class="py-1.5 px-2 text-right tabular-nums font-semibold"
                  :class="(r.winRate ?? 0) >= 50 ? 'text-green-600 dark:text-green-400' : 'text-slate-500'"
                >
                  {{ (r.winRate ?? r.top8Rate).toFixed(1) }}%
                </td>
                <td class="py-1.5 px-2 text-right tabular-nums text-slate-400">{{ r.tierScore }}</td>
              </tr>
              <tr v-if="tierRows.length === 0">
                <td colspan="6" class="py-8 text-center text-slate-400 text-sm">
                  暂无足够样本评级(需要 ≥15 卡组且 ≥4 个英雄)
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- 域对分布 -->
      <section class="panel rounded-2xl p-5 xl:col-span-2">
        <h3 class="text-lg font-bold text-slate-800 dark:text-white mb-1">🎨 传奇域对分布</h3>
        <p class="text-xs text-slate-400 mb-3">
          每套卡组的传奇定义双色域;共识别 {{ store.result?.colorStats?.identifiedDecks ?? 0 }} /
          {{ filteredDecks.length }} 套
        </p>
        <ChartCard v-if="pairOption" :option="pairOption" height="380px" :show-toolbox="false" />
        <div v-else class="h-[380px] flex items-center justify-center text-slate-400 text-sm">
          无域对数据
        </div>
        <!-- 六色图例 -->
        <div class="flex items-center justify-center gap-3 mt-1 flex-wrap">
          <span
            v-for="(label, c) in CARD_COLOR_LABELS"
            :key="c"
            class="inline-flex items-center gap-1 text-[10px] text-slate-500"
            v-show="c !== 'colorless'"
          >
            <i class="w-2.5 h-2.5 rounded-full inline-block" :style="{ background: CARD_COLOR_HEX[c as CardColor] }"></i>
            {{ label }}
          </span>
        </div>
      </section>
    </div>

    <!-- 象限散点 -->
    <section class="panel rounded-2xl p-5">
      <div class="flex items-baseline justify-between mb-1 flex-wrap gap-2">
        <h3 class="text-lg font-bold text-slate-800 dark:text-white">🎯 环境 ladder:热度 × 强度</h3>
        <span class="text-xs text-slate-400">{{ drillHint }}</span>
      </div>
      <p class="text-xs text-slate-400 mb-2">
        右上 = 主流且强势;气泡大小 = 样本数;虚线为环境均值。颜色即 Tier。支持框选缩放。
      </p>
      <ChartCard
        v-if="scatterOption"
        :option="scatterOption"
        height="440px"
        @chart-click="(p) => p.name && gotoHero(String(p.name))"
      />
      <div v-else class="h-[300px] flex items-center justify-center text-slate-400 text-sm">
        当前过滤条件下无样本
      </div>
    </section>
  </div>
</template>
