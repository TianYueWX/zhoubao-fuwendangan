<script setup lang="ts">
/**
 * HeroLegendView.vue · 传奇构筑页(英雄·传奇融合;流派聚类已剔除,Combo 并入本页)
 *  - 英雄与传奇 1:1 对应(每套卡组 1 传奇,传奇名 = 英雄名),选择器两者同源
 *  - 顶部:选择器(搜索+下拉)+ 传奇卡图/双色域 + 指标卡(数量/Top8/Top4/冠亚/Tier/核心卡数)
 *  - 中部:周际趋势 → 核心卡 Top20 │ Combo 羁绊(双栏)
 *  - 下部:构筑(候选卡组表 + 对比矩阵,按区域分组:选定英雄/主牌堆/备牌/战场)
 *  - 入口兼容:currentView 'heroes' / 'legendary' 均渲染本页(焦点英雄由 store.focusHero 定位)
 */
import { computed, ref, watch } from 'vue';
import { store, applyGlobalFilters } from '@/store/analysis';
import StatCard from '@/components/StatCard.vue';
import TierBadge from '@/components/TierBadge.vue';
import CardThumb from '@/components/CardThumb.vue';
import RuneSeal from '@/components/RuneSeal.vue';
import { quickHeroRows, legendaryRows } from '@/core';
import type { LegendaryRow } from '@/core/legendaryStats';
import { CARD_COLOR_LABELS } from '@/types';
import HeroStatsTab from './HeroStatsTab.vue';
import HeroCoreCards from './HeroCoreCards.vue';
import HeroComboTab from './HeroComboTab.vue';
import HeroBuildsTab from './HeroBuildsTab.vue';

/* ── 过滤后的卡组集合(全局周次筛选) ── */
const filteredDecks = computed(() =>
  store.result ? applyGlobalFilters(store.result.allDecks) : []
);

const heroRows = computed(() => {
  if (!store.result) return [];
  return quickHeroRows(filteredDecks.value, store.result.totalDecks);
});

/* ── 选中英雄(store.focusHero 持久,兼容总览页下钻) ── */
const search = ref('');
const selected = computed({
  get: () => store.focusHero || heroRows.value[0]?.hero || '',
  set: (v: string) => {
    store.focusHero = v;
  }
});

const options = computed(() => {
  const q = search.value.trim().toLowerCase();
  return heroRows.value.filter((r) => !q || r.hero.toLowerCase().includes(q));
});

watch(
  () => store.focusHero,
  () => {
    search.value = '';
  }
);

const row = computed(() => heroRows.value.find((r) => r.hero === selected.value));

/* ── 英雄 → 传奇映射(传奇行.topHero 即对应英雄名,数据上 1:1) ── */
const legByHero = computed(() => {
  const r = store.result;
  if (!r) return new Map<string, LegendaryRow>();
  const map = new Map<string, LegendaryRow>();
  for (const l of legendaryRows(filteredDecks.value, r.catalog, r.totalDecks)) {
    if (l.topHero && l.topHero !== '—' && !map.has(l.topHero)) {
      map.set(l.topHero, l);
    }
  }
  return map;
});

const selectedLegRow = computed(() => legByHero.value.get(selected.value) ?? null);

const selectedLegKey = computed(() => {
  const l = selectedLegRow.value;
  if (!l || !store.result) return null;
  return store.result.catalog.canonicalById.get(l.cardNo) ?? l.cardNo;
});
</script>

<template>
  <div class="fade-in space-y-8">
    <template v-if="row && store.result">
      <!-- 选择器 + 传奇信息 + 指标卡 -->
      <section class="space-y-4">
        <div class="flex items-center gap-3 flex-wrap">
          <div class="relative flex-1 min-w-[220px] max-w-sm">
            <input
              v-model="search"
              type="text"
              placeholder="搜索英雄 / 传奇(如 凯南 / 易 …)"
              class="filter-select w-full !py-2 placeholder-ink-faint"
            />
            <!-- 下拉候选 -->
            <div
              v-if="search && options.length > 0"
              class="absolute z-30 mt-1 w-full card p-1 max-h-64 overflow-y-auto shadow-xl"
            >
              <button
                v-for="o in options.slice(0, 12)"
                :key="o.hero"
                @click="selected = o.hero"
                class="w-full text-left px-3 py-1.5 rounded-lg hover:bg-brand-soft text-sm flex justify-between"
              >
                <span>{{ o.hero }}</span>
                <span class="text-xs text-ink-faint">{{ o.total }} 套</span>
              </button>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <TierBadge :tier="row.tier" />
            <span class="text-lg font-display font-bold text-ink">{{ row.hero }}</span>
          </div>
          <select v-model="selected" class="mini-select ml-auto max-w-[240px]">
            <option v-for="r in heroRows" :key="r.hero" :value="r.hero">
              {{ r.hero }} ({{ r.total }})
            </option>
          </select>
        </div>

        <!-- 传奇卡信息(与选中英雄对应的传奇卡) -->
        <div v-if="selectedLegRow" class="flex items-center gap-3">
          <CardThumb
            :id="selectedLegRow.cardNo"
            :name="selectedLegRow.name"
            :catalog="store.result.catalog"
            size="sm"
            :show-name="false"
          />
          <div class="text-xs text-ink-muted leading-relaxed">
            <span class="flex items-center gap-1.5">
              <RuneSeal
                v-for="c in selectedLegRow.colors"
                :key="c"
                :size="9"
                :only="c"
              />
              {{ selectedLegRow.colors.map((c) => CARD_COLOR_LABELS[c]).join(' · ') }}
            </span>
            <span class="tabular-nums">
              {{ selectedLegRow.cardNo }} · {{ selectedLegRow.total }} 套 ·
              转化分 {{ selectedLegRow.convert.toFixed(1) }} ·
              Top8 {{ selectedLegRow.top8Rate.toFixed(1) }}% ·
              Top4 {{ selectedLegRow.top4Rate.toFixed(1) }}% ·
              冠 {{ selectedLegRow.champions }} 亚 {{ selectedLegRow.runnersUp }}
            </span>
          </div>
        </div>

        <!-- 指标卡 -->
        <div class="grid grid-cols-2 lg:grid-cols-6 divide-x divide-panel-border">
          <StatCard label="数量" :value="row.total" :sub="`出场率 ${row.popularity.toFixed(1)}%`" />
          <StatCard label="Top8 率" :value="`${row.top8Rate.toFixed(1)}%`" tone="accent" />
          <StatCard label="Top4 率" :value="`${row.top4Rate.toFixed(1)}%`" tone="accent" />
          <StatCard
            label="冠军 / 亚军"
            :value="`${row.champions} / ${row.runnersUp}`"
            :sub="`冠率 ${row.championRate.toFixed(1)}% · 亚率 ${row.runnerUpRate.toFixed(1)}%`"
          />
          <StatCard label="Tier" :value="row.tier ?? '—'" :sub="row.tierScore != null ? `综合分 ${row.tierScore}` : '数量不足未评级'" />
          <StatCard
            label="核心卡数"
            :value="store.result.heroes.get(row.hero)?.cards.length ?? 0"
            sub="高排名卡组内出现过的卡牌"
          />
        </div>
      </section>

      <div class="hairline"></div>

      <!-- 周际趋势 -->
      <HeroStatsTab :hero="row.hero" />

      <div class="hairline"></div>

      <!-- 核心卡 Top20 │ Combo 羁绊 -->
      <section class="grid grid-cols-1 xl:grid-cols-2 gap-8 xl:divide-x xl:divide-panel-border">
        <div class="xl:pr-8 min-w-0">
          <HeroCoreCards :hero="row.hero" />
        </div>
        <div class="xl:pl-8 min-w-0">
          <HeroComboTab :hero="row.hero" />
        </div>
      </section>

      <div class="hairline"></div>

      <!-- 构筑:候选卡组 / 对比矩阵 -->
      <HeroBuildsTab :hero="row.hero" :leg-key="selectedLegKey" />
    </template>

    <div v-else class="py-16 text-center text-ink-faint">
      当前过滤条件下无英雄数据
    </div>
  </div>
</template>
