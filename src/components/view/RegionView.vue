<script setup lang="ts">
/**
 * RegionView.vue · 🗺️ 地域差异
 *   1. 城市 × 英雄 出场率分组柱状图(点击城市 → 全局过滤)
 *   2. 城市站点气泡地图
 *   3. 省份热度地图
 *   4. 城市 × 英雄热力图(Top8率 / 真实胜率 切换)
 *   5. 赛事一览表(精确城市 / 门店 / 规模)
 */
import { computed, onMounted, ref } from 'vue';
import ChartCard from '@/components/ChartCard.vue';
import { store } from '@/store/analysis';
import { UNKNOWN_CITY } from '@/utils/cityRegex';
import { ensureChinaMap, CITY_COORDS } from '@/utils/chinaMap';
import { CHART_PALETTE } from '@/utils/palette';
import { themedAxes } from '@/utils/theme';
import type { ChartOptionInput } from '@/types';

onMounted(() => {
  ensureChinaMap();
});

const heatMode = ref<'top8' | 'win'>('top8');

const sortedCities = computed(() => {
  if (!store.result) return [] as string[];
  const rs = store.result.regionStats;
  return Array.from(rs.entries())
    .filter(([c]) => c !== UNKNOWN_CITY && c !== '')
    .map(([city, heroes]) => ({
      city,
      total: Array.from(heroes.values()).reduce((a, b) => a + b, 0)
    }))
    .sort((a, b) => b.total - a.total)
    .map((x) => x.city);
});

const sortedHeroes = computed(() => {
  if (!store.result) return [] as Array<[string, number]>;
  return Array.from(store.result.heroes.entries())
    .sort((a, b) => b[1].total - a[1].total)
    .map(([name, stat]) => [name, stat.total] as [string, number]);
});

function setCity(city: string): void {
  store.filterCity = store.filterCity === city ? '' : city;
}

const regionBarOption = computed<ChartOptionInput | null>(() => {
  if (!store.result) return null;
  const cities = sortedCities.value.slice(0, 10);
  const heroes = sortedHeroes.value.slice(0, 5);
  const rs = store.result.regionStats;
  const series = heroes.map(([name], idx) => ({
    name: String(name.split(' ')[0]),
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
    legend: { data: heroes.map(([n]) => String(n.split(' ')[0])), top: 0 },
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
  const rs = store.result.regionStats;
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
  return {
    geo: {
      map: 'china',
      roam: true,
      zoom: 1.15,
      label: { show: false },
      itemStyle: { areaColor: '#e8ecf5', borderColor: '#b6c2d9' },
      emphasis: { label: { show: true }, itemStyle: { areaColor: '#dbe3f5' } },
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
        itemStyle: { color: '#6366f1', shadowBlur: 8, shadowColor: 'rgba(99,102,241,.6)' },
        label: { show: true, position: 'right', fontSize: 11 },
        zlevel: 2
      }
    ]
  };
});

const provinceMapOption = computed<ChartOptionInput | null>(() => {
  if (!store.result) return null;
  if (!ensureChinaMap()) return null;
  const prov = store.result.provinceStats;
  const data = Array.from(prov.entries()).map(([name, value]) => ({ name, value }));
  const maxPv = Math.max(1, ...data.map((d) => d.value));
  return {
    visualMap: {
      min: 0,
      max: maxPv,
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: 6,
      inRange: { color: ['#e0e7ff', '#818cf8', '#4f46e5'] }
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
        itemStyle: { borderColor: '#fff' },
        emphasis: { label: { show: true } },
        select: { disabled: true }
      }
    ]
  };
});

const heatOption = computed<ChartOptionInput | null>(() => {
  if (!store.result) return null;
  const heat = store.result.regionHeat;
  const cities = sortedCities.value.slice(0, 12);
  const heroes = sortedHeroes.value.slice(0, 6);
  const heroNames = heroes.map(([n]) => String(n.split(' ')[0]));
  const cells: Array<[number, number, number]> = [];
  let maxVal = 0;

  for (let y = 0; y < heroes.length; y++) {
    const heroFull = heroes[y]![0];
    for (let x = 0; x < cities.length; x++) {
      const c = cities[x]!;
      const cell = heat.get(c)?.get(heroFull);
      if (!cell || cell.n < 5) continue;
      let v: number;
      if (heatMode.value === 'win' && cell.winsSum != null && cell.roundsSum) {
        v = +((cell.winsSum / cell.roundsSum) * 100).toFixed(1);
      } else {
        v = +((cell.top8 / cell.n) * 100).toFixed(1);
      }
      cells.push([x, y, v]);
      maxVal = Math.max(maxVal, v);
    }
  }

  const { axisBase } = themedAxes();
  const suffix = heatMode.value === 'win' ? '%' : '%';
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
      inRange: { color: ['#f5f5f4', '#c7d2fe', '#818cf8', '#4f46e5'] },
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
          `${heatMode.value === 'win' ? '真实胜率' : 'Top8 率'}: ${datum.value[2]}%<br/>` +
          `样本:${cell?.n ?? 0} 套`
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
        itemStyle: { borderColor: '#fff', borderWidth: 1, borderRadius: 3 }
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
  (store.result?.events ?? []).map((e) => ({
    date: e.date || '—',
    name: e.name.replace(/^【[^】]*】\s*/, ''),
    city: e.city,
    shopName: e.shopName || '—',
    deckCount: e.deckCount,
    playerMax: e.playerMax,
    rounds: e.rounds
  }))
);
</script>

<template>
  <div class="fade-in space-y-5" v-if="store.result">
    <div class="grid grid-cols-1 xl:grid-cols-2 gap-5">
      <section class="panel rounded-2xl p-5">
        <h4 class="text-sm font-bold text-slate-700 dark:text-gray-200 mb-2">📊 城市×英雄 出场率(Top10 城 × Top5 英雄)</h4>
        <p class="text-[11px] text-slate-400 mb-1">点击图例外的城市轴标签可全局过滤该城市</p>
        <ChartCard :option="regionBarOption" height="380px" @chart-click="(p) => p.componentType === 'xAxis' && setCity(String(p.value))" />
      </section>

      <section class="panel rounded-2xl p-5">
        <div class="flex items-center justify-between mb-2 flex-wrap gap-2">
          <h4 class="text-sm font-bold text-slate-700 dark:text-gray-200">🎯 城市×英雄 强度热力</h4>
          <div class="flex gap-1 text-xs">
            <button
              :class="['px-2.5 py-1 rounded-lg transition-all', heatMode === 'top8' ? 'tab-active font-medium' : 'card text-slate-500']"
              @click="heatMode = 'top8'"
            >
              Top8 率
            </button>
            <button
              :class="['px-2.5 py-1 rounded-lg transition-all', heatMode === 'win' ? 'tab-active font-medium' : 'card text-slate-500']"
              @click="heatMode = 'win'"
              :disabled="!store.hasWinData"
              :title="store.hasWinData ? '' : '需导入 rank_data.json'"
            >
              真实胜率{{ store.hasWinData ? '' : ' 🔒' }}
            </button>
          </div>
        </div>
        <p class="text-[11px] text-slate-400 mb-1">仅统计 ≥5 套样本的城市×英雄组合</p>
        <ChartCard :option="heatOption" height="380px" />
      </section>

      <section class="panel rounded-2xl p-5">
        <h4 class="text-sm font-bold text-slate-700 dark:text-gray-200 mb-2">🗺️ 城市站点地图(气泡 = 参赛卡组数)</h4>
        <ChartCard v-if="cityMapOption" :option="cityMapOption" height="420px" />
        <div v-else class="h-[300px] flex items-center justify-center text-slate-400 text-sm">地图数据未加载</div>
      </section>

      <section class="panel rounded-2xl p-5">
        <h4 class="text-sm font-bold text-slate-700 dark:text-gray-200 mb-2">🔥 省份热度分布</h4>
        <ChartCard v-if="provinceMapOption" :option="provinceMapOption" height="420px" />
        <div v-else class="h-[300px] flex items-center justify-center text-slate-400 text-sm">地图数据未加载</div>
      </section>
    </div>

    <!-- 赛事一览 -->
    <section class="panel rounded-2xl p-5">
      <h4 class="text-sm font-bold text-slate-700 dark:text-gray-200 mb-3">📋 赛事一览</h4>
      <div class="overflow-x-auto max-h-[360px] overflow-y-auto">
        <table class="w-full text-sm">
          <thead class="sticky-thead">
            <tr class="text-slate-400 border-b border-slate-200 dark:border-slate-700 text-xs">
              <th class="py-2 px-2 text-left bg-white dark:bg-slate-900">日期</th>
              <th class="py-2 px-2 text-left bg-white dark:bg-slate-900">赛事</th>
              <th class="py-2 px-2 text-left bg-white dark:bg-slate-900">城市</th>
              <th class="py-2 px-2 text-left bg-white dark:bg-slate-900">门店</th>
              <th class="py-2 px-2 text-right bg-white dark:bg-slate-900">卡组数</th>
              <th class="py-2 px-2 text-right bg-white dark:bg-slate-900">上限</th>
              <th class="py-2 px-2 text-right bg-white dark:bg-slate-900">轮次</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="e in eventRows"
              :key="String(e.date) + String(e.name)"
              class="table-row border-b border-slate-100 dark:border-slate-800/50 cursor-pointer"
              @click="setCity(String(e.city))"
            >
              <td class="py-1.5 px-2 tabular-nums text-slate-500">{{ e.date }}</td>
              <td class="py-1.5 px-2 text-slate-700 dark:text-gray-200">{{ e.name }}</td>
              <td class="py-1.5 px-2">{{ e.city }}</td>
              <td class="py-1.5 px-2 text-xs text-slate-400">{{ e.shopName }}</td>
              <td class="py-1.5 px-2 text-right tabular-nums font-semibold">{{ e.deckCount }}</td>
              <td class="py-1.5 px-2 text-right tabular-nums text-slate-400">{{ e.playerMax ?? '—' }}</td>
              <td class="py-1.5 px-2 text-right tabular-nums text-slate-400">{{ e.rounds ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
