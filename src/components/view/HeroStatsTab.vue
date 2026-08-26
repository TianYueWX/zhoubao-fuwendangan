<script setup lang="ts">
/**
 * HeroStatsTab.vue · 周际趋势(并入传奇构筑页)
 * 出场率 / Top8 率 / Top4 率 按周序列,带最近两周环比。
 */
import { computed } from 'vue';
import { store } from '@/store/analysis';
import ChartCard from '@/components/ChartCard.vue';
import SectionHeading from '@/components/SectionHeading.vue';
import { quickHeroRows } from '@/core';
import { CHART_PALETTE } from '@/utils/palette';
import type { Deck } from '@/types';

const props = defineProps<{ hero: string }>();

interface TrendPoint {
  label: string;
  sample: number;
  top8Rate: number;
  top4Rate: number;
  popularity: number;
  total: number;
}

const heroTrend = computed<TrendPoint[] | null>(() => {
  const r = store.result;
  if (!r || !props.hero) return null;
  const hero = props.hero;
  const byWeek = new Map<string, Deck[]>();
  for (const d of r.allDecks) {
    const k = d.week.label || '未知';
    const arr = byWeek.get(k);
    if (arr) arr.push(d);
    else byWeek.set(k, [d]);
  }
  const labels = [...byWeek.keys()].sort((a, b) => a.localeCompare(b));
  return labels.map((label) => {
    const decks = byWeek.get(label)!;
    const rows = quickHeroRows(decks, decks.length);
    const h = rows.find((x) => x.hero === hero);
    return {
      label,
      sample: decks.length,
      top8Rate: h?.top8Rate ?? 0,
      top4Rate: h?.top4Rate ?? 0,
      popularity: h?.popularity ?? 0,
      total: h?.total ?? 0
    };
  });
});

/** 最近两周环比(v3:周报口径) */
const heroDelta = computed<{ popularity: number; top8Rate: number; top4Rate: number } | null>(() => {
  const t = heroTrend.value;
  if (!t || t.length < 2) return null;
  const prev = t[t.length - 2]!;
  const curr = t[t.length - 1]!;
  return {
    popularity: curr.popularity - prev.popularity,
    top8Rate: curr.top8Rate - prev.top8Rate,
    top4Rate: curr.top4Rate - prev.top4Rate
  };
});

const trendOption = computed(() => {
  const t = heroTrend.value;
  if (!t || t.length === 0) return null;
  return {
    grid: { left: 48, right: 24, top: 40, bottom: 40 },
    legend: { top: 8, textStyle: { fontSize: 10 } },
    tooltip: {
      trigger: 'axis',
      confine: true,
      valueFormatter: (v: number | null) => (v == null ? '—' : `${v.toFixed(1)}%`)
    },
    xAxis: { type: 'category', data: t.map((p) => p.label), axisLabel: { fontSize: 10 } },
    yAxis: { type: 'value', name: '%', axisLabel: { formatter: '{value}%' } },
    series: [
      { name: '出场率', type: 'line', smooth: true, symbolSize: 6, data: t.map((p) => p.popularity), itemStyle: { color: CHART_PALETTE[0] } },
      { name: 'Top8 率', type: 'line', smooth: true, symbolSize: 6, data: t.map((p) => p.top8Rate), itemStyle: { color: CHART_PALETTE[1] } },
      { name: 'Top4 率', type: 'line', smooth: true, symbolSize: 6, data: t.map((p) => p.top4Rate), itemStyle: { color: CHART_PALETTE[2] } }
    ]
  };
});
</script>

<template>
  <section>
    <SectionHeading
      eyebrow="人物志 · Profile"
      :title="`${hero} 周际趋势`"
      note="出场率 / Top8 率 / Top4 率 · 数据包内周次"
    >
      <template #actions>
        <span v-if="heroDelta" class="text-[11px] text-ink-faint tabular-nums">
          环比:Top4 率
          {{ heroDelta.top4Rate != null ? `${heroDelta.top4Rate > 0 ? '+' : ''}${heroDelta.top4Rate.toFixed(1)}pp` : '—' }}
          · 出场率
          {{ `${heroDelta.popularity > 0 ? '+' : ''}${heroDelta.popularity.toFixed(1)}pp` }}
        </span>
      </template>
    </SectionHeading>
    <ChartCard v-if="trendOption" :option="trendOption" height="300px" />
    <div v-else class="h-40 flex items-center justify-center text-ink-faint text-sm">
      暂无周际趋势数据
    </div>
  </section>
</template>
