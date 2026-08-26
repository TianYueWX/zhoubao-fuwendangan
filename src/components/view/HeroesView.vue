<script setup lang="ts">
/**
 * HeroesView.vue · 英雄拆解
 *  - 全英雄搜索选择器(48 个全量,不再截断)
 *  - 指标卡(含真实胜率)
 *  - Jaccard 流派聚类
 *  - 核心卡 Top20 表
 */
import { computed, ref, watch } from 'vue';
import { store, applyGlobalFilters } from '@/store/analysis';
import StatCard from '@/components/StatCard.vue';
import TierBadge from '@/components/TierBadge.vue';
import ChartCard from '@/components/ChartCard.vue';
import { buildArchetypes, quickHeroRows } from '@/core';
import { pickChartColor, CHART_PALETTE } from '@/utils/palette';
import type { ArchetypeResult } from '@/types';
import type { Deck } from '@/types';

function archColor(i: number): string {
  return pickChartColor(i);
}

/* ── 周际趋势(所选英雄)── */
interface TrendPoint {
  label: string;
  sample: number;
  winRate: number | null;
  popularity: number;
  top8Rate: number;
  total: number;
}

const heroTrend = computed<TrendPoint[] | null>(() => {
  const r = store.result;
  if (!r || !selected.value) return null;
  const hero = selected.value;
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
    const rows = quickHeroRows(decks, decks.length, r.hasWinData);
    const h = rows.find((x) => x.hero === hero);
    return {
      label,
      sample: decks.length,
      winRate: h?.winRate ?? null,
      popularity: h?.popularity ?? 0,
      top8Rate: h?.top8Rate ?? 0,
      total: h?.total ?? 0
    };
  });
});

/** 最近两周环比(v3:周报口径) */
const heroDelta = computed<{ popularity: number; winRate: number | null; top8Rate: number } | null>(() => {
  const t = heroTrend.value;
  if (!t || t.length < 2) return null;
  const prev = t[t.length - 2]!;
  const curr = t[t.length - 1]!;
  return {
    popularity: curr.popularity - prev.popularity,
    winRate: curr.winRate != null && prev.winRate != null ? curr.winRate - prev.winRate : null,
    top8Rate: curr.top8Rate - prev.top8Rate
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
      { name: '胜率(收缩)', type: 'line', smooth: true, symbolSize: 6, data: t.map((p) => p.winRate), itemStyle: { color: CHART_PALETTE[1] } },
      { name: 'Top8 率', type: 'line', smooth: true, symbolSize: 6, data: t.map((p) => p.top8Rate), itemStyle: { color: CHART_PALETTE[2] } }
    ]
  };
});

/* ── 过滤后的英雄行 + 选择器 ── */
const filteredDecks = computed(() =>
  store.result ? applyGlobalFilters(store.result.allDecks) : []
);

const heroRows = computed(() => {
  if (!store.result) return [];
  return quickHeroRows(filteredDecks.value, store.result.totalDecks, store.result.hasWinData);
});

const search = ref('');
const selected = computed({
  get: () => store.filterHero || heroRows.value[0]?.hero || '',
  set: (v: string) => {
    store.filterHero = v;
  }
});

const options = computed(() => {
  const q = search.value.trim().toLowerCase();
  return heroRows.value.filter((r) => !q || r.hero.toLowerCase().includes(q));
});

watch(
  () => store.filterHero,
  () => {
    search.value = '';
  }
);

const row = computed(() => heroRows.value.find((r) => r.hero === selected.value));

/* ── 流派聚类(基于该英雄 Top 样本) ── */
const archetypes = computed<ArchetypeResult | null>(() => {
  if (!store.result || !selected.value) return null;
  const stat = store.result.heroes.get(selected.value);
  if (!stat) return null;
  return buildArchetypes(stat, store.result.catalog);
});

/* ── 核心卡表 ── */
interface CoreCardRow extends Record<string, unknown> {
  rank: number;
  name: string;
  id: string;
  rarity: string;
  rate: number;
  avg: number;
}
const coreCards = computed<CoreCardRow[]>(() => {
  if (!row.value) return [];
  const stat = store.result?.heroes.get(row.value.hero);
  if (!stat) return [];
  return stat.cards.slice(0, 20).map((c, i) => ({
    rank: i + 1,
    name: c.name,
    id: c.id,
    rarity: c.rarity,
    rate: Math.round(c.rate * 10) / 10,
    avg: Math.round(c.avg * 100) / 100,
    energy: c.energy
  }));
});
</script>

<template>
  <div class="fade-in space-y-6">
    <!-- 英雄选择器 -->
    <section class="panel rounded-2xl p-4">
      <div class="flex items-center gap-3 flex-wrap">
        <div class="relative flex-1 min-w-[220px] max-w-sm">
          <input
            v-model="search"
            type="text"
            placeholder="搜索英雄(如 凯南 / 易 …)"
            class="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl px-4 py-2 text-sm text-slate-800 dark:text-white placeholder-slate-400"
          />
          <!-- 下拉候选 -->
          <div
            v-if="search && options.length > 0"
            class="absolute z-30 mt-1 w-full card p-1 max-h-64 overflow-y-auto shadow-xl"
          >
            <button
              v-for="o in options.slice(0, 12)"
              :key="o.hero"
              @click="
                () => {
                  selected = o.hero;
                }
              "
              class="w-full text-left px-3 py-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-sm flex justify-between"
            >
              <span>{{ o.hero }}</span>
              <span class="text-xs text-slate-400">{{ o.total }} 套</span>
            </button>
          </div>
        </div>
        <div v-if="row" class="flex items-center gap-2">
          <TierBadge :tier="row.tier" />
          <span class="text-lg font-bold text-slate-800 dark:text-white">{{ row.hero }}</span>
        </div>
        <select
          v-model="selected"
          class="ml-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 text-sm max-w-[240px] text-slate-800 dark:text-white"
        >
          <option v-for="r in heroRows" :key="r.hero" :value="r.hero">
            {{ r.hero }} ({{ r.total }})
          </option>
        </select>
      </div>
    </section>

    <template v-if="row && store.result">
      <!-- 指标卡(带周环比 Δ) -->
      <div class="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard label="样本卡组" :value="row.total" :sub="`出场率 ${row.popularity.toFixed(1)}%`" />
        <StatCard
          label="Top8 率"
          :value="`${row.top8Rate.toFixed(1)}%`"
          tone="accent"
          :delta="heroDelta?.top8Rate ?? null"
          delta-suffix="pp"
        />
        <StatCard
          v-if="row.winRate !== null"
          label="真实胜率"
          :value="`${row.winRate.toFixed(1)}%`"
          :tone="row.winRate >= 50 ? 'good' : 'warn'"
          :sub="`平均胜场 ${row.avgWins?.toFixed(2) ?? '—'}`"
          :delta="heroDelta?.winRate ?? null"
          delta-suffix="pp"
        />
        <StatCard
          v-else
          label="真实胜率"
          value="—"
          sub="导入 rank_data.json 解锁"
        />
        <StatCard label="Tier" :value="row.tier ?? '—'" :sub="row.tierScore != null ? `综合分 ${row.tierScore}` : '样本不足未评级'" />
        <StatCard
          label="核心卡数"
          :value="store.result?.heroes.get(row.hero)?.cards.length ?? 0"
          sub="Top 样本内出现过的卡牌"
        />
      </div>

      <!-- 周际趋势(v3) -->
      <section class="panel rounded-2xl p-5">
        <div class="flex items-baseline justify-between mb-1 flex-wrap gap-2">
          <h3 class="text-lg font-bold text-slate-800 dark:text-white">📈 {{ row.hero }} 周际趋势</h3>
          <span v-if="heroDelta" class="text-[11px] text-slate-400 tabular-nums">
            环比:胜率
            {{ heroDelta.winRate != null ? `${heroDelta.winRate > 0 ? '+' : ''}${heroDelta.winRate.toFixed(1)}pp` : '—' }}
            · 出场率
            {{ `${heroDelta.popularity > 0 ? '+' : ''}${heroDelta.popularity.toFixed(1)}pp` }}
          </span>
        </div>
        <p class="text-xs text-slate-400 mb-2">
          出场率 / 胜率(贝叶斯收缩修正)/ Top8 率 · 数据包内周次
        </p>
        <ChartCard v-if="trendOption" :option="trendOption" height="300px" />
        <div v-else class="h-40 flex items-center justify-center text-slate-400 text-sm">
          暂无周际数据
        </div>
      </section>

      <div class="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <!-- 流派聚类 -->
        <section class="panel rounded-2xl p-5">
          <h3 class="text-lg font-bold text-slate-800 dark:text-white mb-1">🧬 流派自动聚类</h3>
          <p class="text-xs text-slate-400 mb-4">
            Jaccard 卡组相似度 ≥ 0.55 贪心聚类,最多 3 流派 + 其他
          </p>
          <div v-if="archetypes" class="space-y-4">
            <div
              v-for="(a, i) in archetypes.list"
              :key="a.name"
              class="card p-4"
              :style="{ borderLeft: `4px solid ${archColor(i)}` }"
            >
              <div class="flex items-center justify-between mb-2 flex-wrap gap-2">
                <div class="font-semibold text-slate-800 dark:text-white">
                  {{ a.name === '其他' ? '🔹 其他构筑' : `${i + 1} 号流派 · ${a.count} 套` }}
                  <span class="text-xs font-normal text-slate-400 ml-2">{{ a.share.toFixed(0) }}%</span>
                </div>
                <div
                  v-if="a.avgRank !== null"
                  class="text-xs text-slate-400 tabular-nums"
                >
                  平均名次 {{ a.avgRank }}
                </div>
              </div>
              <div class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-gray-400">
                <span v-for="cc in a.coreCards.slice(0, 6)" :key="cc.id" class="inline-flex items-center gap-1">
                  {{ cc.name }}
                  <b class="text-slate-400">{{ cc.rate.toFixed(0) }}%</b>
                </span>
              </div>
            </div>
          </div>
          <div v-else class="py-10 text-center text-slate-400 text-sm">
            该英雄 Top 样本不足 6 套,无法聚类
          </div>
        </section>

        <!-- 核心卡 -->
        <section class="panel rounded-2xl p-5">
          <h3 class="text-lg font-bold text-slate-800 dark:text-white mb-1">🧾 核心卡 Top 20</h3>
          <p class="text-xs text-slate-400 mb-3">按高排名样本携带率排序;条形为携带率</p>
          <div class="overflow-y-auto max-h-[420px]">
            <table class="w-full text-sm">
              <thead class="sticky-thead">
                <tr class="text-slate-400 border-b border-slate-200 dark:border-slate-700 text-xs">
                  <th class="py-2 px-2 text-left bg-white dark:bg-slate-900">#</th>
                  <th class="py-2 px-2 text-left bg-white dark:bg-slate-900">卡牌</th>
                  <th class="py-2 px-2 text-right bg-white dark:bg-slate-900">稀有度</th>
                  <th class="py-2 px-2 text-right bg-white dark:bg-slate-900">平均张数</th>
                  <th class="py-2 px-2 text-right bg-white dark:bg-slate-900 w-[38%]">携带率</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="c in coreCards"
                  :key="String(c.id)"
                  class="border-b border-slate-100 dark:border-slate-800/50"
                >
                  <td class="py-1.5 px-2 text-slate-400 tabular-nums">{{ c.rank }}</td>
                  <td class="py-1.5 px-2 font-medium text-slate-700 dark:text-gray-200">
                    {{ c.name }}
                    <span class="text-[10px] text-slate-300 dark:text-slate-600 ml-1">{{ c.id }}</span>
                  </td>
                  <td class="py-1.5 px-2 text-right text-xs text-slate-400">{{ c.rarity }}</td>
                  <td class="py-1.5 px-2 text-right tabular-nums">{{ c.avg }}</td>
                  <td class="py-1.5 px-2">
                    <div class="flex items-center gap-2 justify-end">
                      <span class="tabular-nums text-xs w-11 text-right">{{ c.rate }}%</span>
                      <div class="h-1.5 w-24 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                        <div
                          class="h-full bg-indigo-400 rounded-full"
                          :style="{ width: `${Math.min(100, c.rate)}%` }"
                        ></div>
                      </div>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </template>

    <div v-else class="panel rounded-2xl p-16 text-center text-slate-400">
      当前过滤条件下无英雄数据
    </div>
  </div>
</template>
