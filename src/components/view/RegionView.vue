<script setup lang="ts">
import AnalysisDetail from '@/components/AnalysisDetail.vue';
/**
 * RegionView.vue · 地域差异
 *   1. 城市 × 英雄 出场率分组柱状图(点击城市 → 全局过滤)
 *   2. 城市站点气泡地图
 *   3. 省份热度地图
 *   4. 城市 × 英雄热力图(Top8率 / Top4率 切换)
 *   5. 赛事一览表(精确城市 / 门店 / 规模)
 */
import { computed, onMounted, ref } from 'vue';
import ChartCard from '@/components/ChartCard.vue';
import SectionHeading from '@/components/SectionHeading.vue';
import SortableTh from '@/components/SortableTh.vue';
import TableDownloadButton from '@/components/TableDownloadButton.vue';
import { useTableSort, type SortableColumn } from '@/composables/useTableSort';
import { store, applyGlobalFilters } from '@/store/analysis';
import { computeRegionStats } from '@/core/region';
import { normalizeEventKey } from '@/utils/dataParser';
import { ensureChinaMap, CITY_COORDS } from '@/utils/chinaMap';
import { CHART_PALETTE } from '@/utils/palette';
import { themedAxes, getChartColors, getBrandColor } from '@/utils/theme';
import type { ChartOptionInput } from '@/types';

onMounted(() => {
  ensureChinaMap();
});

const cityLimit = ref(10), heroLimit = ref(5), minimumSamples = ref(1);
const scopedDecks = computed(() => applyGlobalFilters(store.result?.allDecks ?? []));
const regional = computed(() => computeRegionStats(scopedDecks.value));
const regionalCounts = computed(() => new Map([...regional.value.regionHeat].map(([city, heroes]) => [city, new Map([...heroes].map(([hero, cell]) => [hero, cell.n]))])));
const shownCities = computed(() => cityLimit.value ? sortedCities.value.slice(0, cityLimit.value) : sortedCities.value);
const shownHeroes = computed(() => heroLimit.value ? sortedHeroes.value.slice(0, heroLimit.value) : sortedHeroes.value);
const chartWidth = computed(() => `${Math.max(500, shownCities.value.length * Math.max(70, shownHeroes.value.length * 10))}px`);
const heatHeight = computed(() => `${Math.max(380, shownHeroes.value.length * 38 + 110)}px`);
const scopeEvents = computed(() => new Set(scopedDecks.value.map((d) => normalizeEventKey(d.activityName))));
const heatMode = ref<'top8' | 'top4'>('top8');

const sortedCities = computed(() => {
  if (!store.result) return [] as string[];
  const rs = regionalCounts.value;
  return Array.from(rs.entries())
    .map(([city, heroes]) => ({
      city,
      total: Array.from(heroes.values()).reduce((a, b) => a + b, 0)
    }))
    .sort((a, b) => b.total - a.total)
    .map((x) => x.city);
});

const sortedHeroes = computed(() => {
  if (!store.result) return [] as Array<[string, number]>;
  const counts = new Map<string, number>();
  for (const d of scopedDecks.value) counts.set(d.hero || '未知', (counts.get(d.hero || '未知') ?? 0) + 1);
  return [...counts].sort((a,b) => b[1]-a[1]);
});

/** 本页本地选中的城市(表格行点击高亮用,不做全局过滤) */
const selectedCity = ref('');

function setCity(city: string): void {
  selectedCity.value = selectedCity.value === city ? '' : city;
}

const regionBarOption = computed<ChartOptionInput | null>(() => {
  if (!store.result) return null;
  const cities = shownCities.value;
  const heroes = shownHeroes.value;
  const rs = regionalCounts.value;
  const series = heroes.map(([name], idx) => ({
    name: name,
    type: 'bar',
    data: cities.map((c) => {
      const cityHeroes = rs.get(c);
      if (!cityHeroes) return 0;
      const total = Array.from(cityHeroes.values()).reduce((a, b) => a + b, 0);
      if (total === 0) return 0;
      return +(((cityHeroes.get(name) ?? 0) / total) * 100).toFixed(1);
    }),
    itemStyle: { color: CHART_PALETTE[idx % CHART_PALETTE.length], borderRadius: [4, 4, 0, 0] }
  }));
  const { axisBase } = themedAxes();
  return {
    legend: { type: 'scroll', data: heroes.map(([n]) => n), top: 0 },
    grid: { left: 50, right: 30, top: 50, bottom: 40 },
    xAxis: { type: 'category', data: cities, triggerEvent: true, ...axisBase },
    yAxis: { type: 'value', name: '出场率(%)', nameGap: 14, ...axisBase },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true },
    series
  };
});

const cityMapOption = computed<ChartOptionInput | null>(() => {
  if (!store.result) return null;
  if (!ensureChinaMap()) return null;
  const rs = regionalCounts.value;
  const pts: Array<{ name: string; value: [number, number, number] }> = [];
  for (const city of sortedCities.value) {
    const coord = CITY_COORDS[city];
    if (!coord) continue;
    const cityHeroes = rs.get(city);
    if (!cityHeroes) continue;
    const total = Array.from(cityHeroes.values()).reduce((a, b) => a + b, 0);
    pts.push({ name: city, value: [coord[0], coord[1], total] });
  }
  const maxSize = Math.max(1, ...pts.map((p) => p.value[2]));
  const cc = getChartColors();
  return {
    geo: {
      map: 'china',
      roam: true,
      zoom: 1.15,
      label: { show: false },
      itemStyle: { areaColor: cc.mapArea, borderColor: cc.mapBorder },
      emphasis: { label: { show: true }, itemStyle: { areaColor: cc.mapEmphasis } },
      select: { disabled: true }
    },
    tooltip: {
      confine: true,
      formatter: (p: unknown) => {
        const datum = p as { name: string; value: [number, number, number] };
        return `<b>${datum.name}</b><br/>参赛卡组: ${datum.value[2]} 套`;
      }
    },
    series: [
      {
        type: 'effectScatter',
        coordinateSystem: 'geo',
        data: pts,
        symbolSize: (v: unknown) => {
          const arr = v as [number, number, number];
          return 10 + Math.sqrt((arr[2] ?? 0) / maxSize) * 22;
        },
        rippleEffect: { brushType: 'stroke', scale: 2.2 },
        itemStyle: { color: getBrandColor(), shadowBlur: 8, shadowColor: 'rgba(197,155,70,.35)' },
        label: { show: true, position: 'right', fontSize: 11 },
        zlevel: 2
      }
    ]
  };
});

const provinceMapOption = computed<ChartOptionInput | null>(() => {
  if (!store.result) return null;
  if (!ensureChinaMap()) return null;
  const prov = regional.value.provinceStats;
  const data = Array.from(prov.entries()).map(([name, value]) => ({ name, value }));
  const maxPv = Math.max(1, ...data.map((d) => d.value));
  const cc = getChartColors();
  return {
    visualMap: {
      min: 0,
      max: maxPv,
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: 6,
      inRange: { color: [...cc.mapRamp] }
    },
    tooltip: {
      formatter: (p: unknown) => {
        const datum = p as { name: string; value?: number };
        if (datum.value == null) return `<b>${datum.name}</b><br/>暂无数据`;
        return `<b>${datum.name}</b><br/>参赛卡组: ${datum.value} 套`;
      }
    },
    series: [
      {
        type: 'map',
        map: 'china',
        roam: true,
        zoom: 1.15,
        data,
        label: { show: false },
        itemStyle: { borderColor: '#fbf9f3' },
        emphasis: { label: { show: true } },
        select: { disabled: true }
      }
    ]
  };
});

const heatOption = computed<ChartOptionInput | null>(() => {
  if (!store.result) return null;
  const heat = regional.value.regionHeat;
  const cities = shownCities.value;
  const heroes = shownHeroes.value;
  const heroNames = heroes.map(([n]) => n);
  const cells: Array<[number, number, number]> = [];
  let maxVal = 0;

  for (let y = 0; y < heroes.length; y++) {
    const heroFull = heroes[y]![0];
    for (let x = 0; x < cities.length; x++) {
      const c = cities[x]!;
      const cell = heat.get(c)?.get(heroFull);
      if (!cell || cell.n < minimumSamples.value) continue;
      let v: number;
      if (heatMode.value === 'top4') {
        v = +((cell.top4 / cell.n) * 100).toFixed(1);
      } else {
        v = +((cell.top8 / cell.n) * 100).toFixed(1);
      }
      cells.push([x, y, v]);
      maxVal = Math.max(maxVal, v);
    }
  }

  const { axisBase } = themedAxes();
  const cc = getChartColors();
  const suffix = '%';
  return {
    grid: { left: 110, right: 60, top: 30, bottom: 70 },
    xAxis: { type: 'category', data: cities, splitArea: { show: true }, ...axisBase },
    yAxis: { type: 'category', data: heroNames, splitArea: { show: true }, ...axisBase },
    visualMap: {
      min: 0,
      max: Math.max(10, Math.ceil(maxVal)),
      calculable: false,
      orient: 'horizontal',
      left: 'center',
      bottom: 6,
      inRange: { color: [...cc.heatRamp] },
      formatter: (v: unknown) => `${Number(v) || 0}${suffix}`
    },
    tooltip: {
      confine: true,
      formatter: (p: unknown) => {
        const datum = p as { value: [number, number, number] };
        const city = cities[datum.value[0]] ?? '';
        const hero = heroes[datum.value[1]]?.[0] ?? '';
        const cell = heat.get(city)?.get(hero);
        return (
          `<b>${city} · ${hero}</b><br/>` +
          `${heatMode.value === 'top4' ? 'Top4 率' : 'Top8 率'}: ${datum.value[2]}%<br/>` +
          `数量:${cell?.n ?? 0} 套`
        );
      }
    },
    series: [
      {
        type: 'heatmap',
        data: cells,
        label: {
          show: true,
          formatter: (p: unknown) => String((p as { value: [number, number, number] }).value[2]),
          fontSize: 10
        },
        itemStyle: { borderColor: cc.mapBorder, borderWidth: 1, borderRadius: 3 }
      }
    ]
  };
});

/* ── 赛事一览 ── */
interface EventRow extends Record<string, unknown> {
  date: string;
  name: string;
  city: string;
  shopName: string;
  deckCount: number;
  playerMax: number | null;
  rounds: number | null;
}
const eventRows = computed<EventRow[]>(() =>
  (store.result?.events ?? []).filter((e) => scopeEvents.value.has(normalizeEventKey(e.name))).map((e) => ({
    date: e.date || '—',
    name: e.name.replace(/^【[^】]*】\s*/, ''),
    city: e.city,
    shopName: e.shopName || '—',
    deckCount: e.deckCount,
    playerMax: e.playerMax,
    rounds: e.rounds
  }))
);

/* ── 表头点击排序(默认保持赛事原始顺序) ── */
const EVENT_COLUMNS: readonly SortableColumn<EventRow>[] = [
  { key: 'date', type: 'text' },
  { key: 'name', type: 'text' },
  { key: 'city', type: 'text' },
  { key: 'shopName', type: 'text' },
  { key: 'deckCount', type: 'number' },
  { key: 'playerMax', type: 'number' },
  { key: 'rounds', type: 'number' }
];
const eventSort = useTableSort(eventRows, EVENT_COLUMNS);
const eventRowsSorted = eventSort.sorted;

/* ── 长图导出 ── */
const eventTableEl = ref<HTMLTableElement | null>(null);
</script>

<template>
  <div class="fade-in space-y-8" v-if="store.result">
    <div class="region-controls"><label>城市 <select v-model.number="cityLimit"><option :value="10">前10城</option><option :value="20">前20城</option><option :value="50">前50城</option><option :value="0">全部城市</option></select></label><label>英雄 <select v-model.number="heroLimit"><option :value="5">前5种</option><option :value="10">前10种</option><option :value="20">前20种</option><option :value="0">全部英雄</option></select></label><label>每格最低样本 <select v-model.number="minimumSamples"><option :value="1">1套（全部组合）</option><option :value="5">5套</option><option :value="10">10套</option></select></label><span>{{ store.filterWeek || '全部周次' }} · {{ scopedDecks.length }} 套 · {{ sortedCities.length }} 城</span></div>
    <div class="grid grid-cols-1 xl:grid-cols-2 gap-8 xl:divide-x xl:divide-panel-border">
      <section class="xl:pr-8 min-w-0">
        <SectionHeading
          small
          title="城市×英雄 出场率"
          :note="`显示 ${shownCities.length} 城 × ${shownHeroes.length} 英雄；点击城市名称高亮赛事表`"
        />
        <div class="region-chart-scroll"><div :style="{ minWidth: chartWidth }"><ChartCard :key="`${store.activePackageId}-${store.filterWeek}-${cityLimit}-${heroLimit}`" :option="regionBarOption" height="380px" @chart-click="(p) => p.componentType === 'xAxis' && setCity(String(p.value))" /></div></div>
      </section>

      <section class="xl:pl-8 min-w-0">
        <div class="flex items-center justify-between mb-2 flex-wrap gap-2">
          <SectionHeading small title="城市×英雄 强度热力" />
          <div class="flex gap-1 text-xs mt-1">
            <button
              :class="['px-2.5 py-1 rounded-lg transition-all', heatMode === 'top8' ? 'tab-active font-medium' : 'card text-ink-muted']"
              @click="heatMode = 'top8'"
            >
              Top8 率
            </button>
            <button
              :class="['px-2.5 py-1 rounded-lg transition-all', heatMode === 'top4' ? 'tab-active font-medium' : 'card text-ink-muted']"
              @click="heatMode = 'top4'"
            >
              Top4 率
            </button>
          </div>
        </div>
        <p class="text-[11px] text-ink-faint mb-1">每格至少 {{ minimumSamples }} 套；小样本比例波动大。图表可横向滚动，图例可翻页。</p>
        <div class="region-chart-scroll"><div :style="{ minWidth: chartWidth }"><ChartCard :key="`${store.activePackageId}-${store.filterWeek}-${cityLimit}-${heroLimit}-${minimumSamples}`" :option="heatOption" :height="heatHeight" /></div></div>
      </section>
    </div>

    <div class="hairline"></div>

    <div class="grid grid-cols-1 xl:grid-cols-2 gap-8 xl:divide-x xl:divide-panel-border">
      <section class="xl:pr-8 min-w-0">
        <SectionHeading
          small
          title="城市站点地图"
          note="气泡大小 = 参赛卡组数"
        />
        <ChartCard v-if="cityMapOption" :option="cityMapOption" height="420px" />
        <div v-else class="h-[300px] flex items-center justify-center text-ink-faint text-sm">地图数据未加载</div>
      </section>

      <section class="xl:pl-8 min-w-0">
        <SectionHeading small title="省份热度分布" />
        <ChartCard v-if="provinceMapOption" :option="provinceMapOption" height="420px" />
        <div v-else class="h-[300px] flex items-center justify-center text-ink-faint text-sm">地图数据未加载</div>
      </section>
    </div>

    <div class="hairline"></div>

    <!-- 赛事一览 -->
    <section>
      <SectionHeading eyebrow="赛事志 · Events" small title="赛事一览">
        <template #actions>
          <TableDownloadButton
            :target="() => eventTableEl"
            title="赛事一览"
            eyebrow="赛事志 · Events"
            note="门店/规模/轮次来自 shop_data.json;卡组数为实际参赛套数"
          />
        </template>
      </SectionHeading>
      <div class="overflow-x-auto max-h-[360px] overflow-y-auto">
        <table ref="eventTableEl" class="w-full text-sm">
          <thead class="sticky-thead">
            <tr class="text-ink-faint border-b border-panel-border text-xs">
              <SortableTh :sort="eventSort" col-key="date" label="日期" align="left" />
              <SortableTh :sort="eventSort" col-key="name" label="赛事" align="left" />
              <SortableTh :sort="eventSort" col-key="city" label="城市" align="left" />
              <SortableTh :sort="eventSort" col-key="shopName" label="门店" align="left" />
              <SortableTh :sort="eventSort" col-key="deckCount" label="卡组数" align="right" />
              <SortableTh :sort="eventSort" col-key="playerMax" label="上限" align="right" />
              <SortableTh :sort="eventSort" col-key="rounds" label="轮次" align="right" />
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="e in eventRowsSorted"
              :key="String(e.date) + String(e.name)"
              class="table-row border-b border-[rgba(59,74,90,0.08)] cursor-pointer"
              :class="selectedCity && e.city === selectedCity ? 'bg-brand-soft' : ''"
              @click="setCity(String(e.city))"
            >
              <td class="py-1.5 px-2 tabular-nums text-ink-muted">{{ e.date }}</td>
              <td class="py-1.5 px-2 text-ink">{{ e.name }}</td>
              <td class="py-1.5 px-2">{{ e.city }}</td>
              <td class="py-1.5 px-2 text-xs text-ink-faint">{{ e.shopName }}</td>
              <td class="py-1.5 px-2 text-right tabular-nums font-semibold">{{ e.deckCount }}</td>
              <td class="py-1.5 px-2 text-right tabular-nums text-ink-faint">{{ e.playerMax ?? '—' }}</td>
              <td class="py-1.5 px-2 text-right tabular-nums text-ink-faint">{{ e.rounds ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
    <AnalysisDetail kind="region" />
  </div>
</template>

<style scoped>.region-controls{display:flex;align-items:center;gap:1rem;flex-wrap:wrap;font-size:.875rem}.region-controls label{display:flex;gap:.5rem;align-items:center}.region-controls select{border:1px solid var(--color-panel-border);padding:.375rem;border-radius:.375rem;background:var(--color-card-bg)}.region-chart-scroll{overflow:auto;max-height:44rem}</style>
