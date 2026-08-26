<script setup lang="ts">
/**
 * ComboView.vue · 🔗 Combo 羁绊
 *  - Lift / 基础携带率双阈值实时调节
 *  - 结果表(分页 + 搜索)
 *  - 行点击 → 抽屉查看卡对详情
 */
import { computed, ref } from 'vue';
import { store, applyGlobalFilters } from '@/store/analysis';
import DataTable from '@/components/DataTable.vue';
import Drawer from '@/components/Drawer.vue';
import CardThumb from '@/components/CardThumb.vue';
import SectionHeading from '@/components/SectionHeading.vue';
import { computeCombos } from '@/core';
import type { ChartOptionInput } from '@/types';
import type { ComboResult } from '@/types';

type Scope = 'allTop' | string;
const scope = ref<Scope>('allTop');

const scopeOptions = computed(() => {
  if (!store.result) return [];
  const opts: Array<{ value: Scope; label: string }> = [
    { value: 'allTop', label: '全部高排名样本' }
  ];
  const heroes = Array.from(store.result.heroes.entries()).sort(
    (a, b) => b[1].total - a[1].total
  );
  for (const [name, stat] of heroes) {
    opts.push({ value: name, label: `${name} (Top ${stat.topCount})` });
  }
  return opts;
});

const decks = computed(() => {
  const r = store.result;
  if (!r) return [];
  if (scope.value === 'allTop') return applyGlobalFilters(r.uniqueSampleDecks);
  const stat = r.heroes.get(scope.value);
  return stat ? stat.topDecks : [];
});

/* 阈值滑块 → 实时重算(debounce 由 computed 天然节流;数据量可控) */
const minLift = ref(store.comboMinLift);
const minBasePercent = ref(Math.round(store.comboMinBase * 100));

const combos = computed<ComboResult[]>(() => {
  const r = store.result;
  if (!r || decks.value.length === 0) return [];
  return computeCombos(decks.value, r.catalog, {
    minLift: minLift.value,
    minBase: minBasePercent.value / 100,
    // 控制结果规模:基础率低于 5% 的卡对噪声大
    minCount: Math.max(3, Math.floor(decks.value.length * 0.02))
  });
});

interface ComboRow extends Record<string, unknown> {
  a: string;
  b: string;
  pair: string;
  nameA: string;
  nameB: string;
  lift: number;
  coRate: number;
  coRateReverse: number;
  count: number;
}

const rows = computed<ComboRow[]>(() =>
  combos.value.slice(0, 200).map((c) => ({
    ...c,
    pair: `${c.nameA} + ${c.nameB}`,
    lift: Math.round(c.lift * 100) / 100,
    coRate: Math.round(c.coRate * 10) / 10,
    coRateReverse: Math.round(c.coRateReverse * 10) / 10
  }))
);

const columns = [
  { key: 'pair', label: '卡对', type: 'text' as const, sortable: true },
  { key: 'lift', label: 'Lift 提升度', type: 'number' as const, sortable: true, align: 'right' as const },
  { key: 'coRate', label: 'P(B|A)%', type: 'number' as const, sortable: true, align: 'right' as const },
  { key: 'count', label: '同现套数', type: 'number' as const, sortable: true, align: 'right' as const }
];

/* ── 详情抽屉 ── */
const drawerOpen = ref(false);
const selected = ref<ComboRow | null>(null);

function openDetail(row: Record<string, unknown>): void {
  selected.value = row as unknown as ComboRow;
  drawerOpen.value = true;
}
</script>

<template>
  <div class="fade-in space-y-5">
    <section class="panel rounded-2xl p-5">
      <div class="flex items-start justify-between flex-wrap gap-4 mb-4">
        <SectionHeading
          title="Combo 羁绊挖掘"
          note="Lift = P(A∩B) / (P(A)×P(B)):>1 正相关(真实配合),≈1 独立。已剔除符文卡;万金油污染由「最低携带率」门槛过滤。调高 Lift 找独家配合,调低找泛用搭配。"
        />
        <select v-model="scope" class="mini-select max-w-[240px]">
          <option v-for="o in scopeOptions" :key="String(o.value)" :value="o.value">{{ o.label }}</option>
        </select>
      </div>

      <!-- 参数滑块 -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <label class="card p-3 block">
          <div class="flex justify-between text-xs mb-2">
            <span class="text-slate-500 dark:text-gray-400">最低 Lift</span>
            <b class="tabular-nums text-brand">{{ minLift.toFixed(2) }}</b>
          </div>
          <input
            type="range"
            min="1"
            max="2.5"
            step="0.05"
            v-model.number="minLift"
            class="w-full"
            style="accent-color: var(--color-brand)"
          />
        </label>
        <label class="card p-3 block">
          <div class="flex justify-between text-xs mb-2">
            <span class="text-slate-500 dark:text-gray-400">最低携带率门槛</span>
            <b class="tabular-nums text-brand">{{ minBasePercent }}%</b>
          </div>
          <input
            type="range"
            min="5"
            max="35"
            step="1"
            v-model.number="minBasePercent"
            class="w-full"
            style="accent-color: var(--color-brand)"
          />
        </label>
      </div>

      <p class="text-xs text-slate-400 mb-3">
        样本 {{ decks.length }} 套 · 命中 <b>{{ rows.length }}</b> 组卡对 · 点击行查看详情
      </p>

      <DataTable
        :rows="rows"
        :columns="columns"
        :page-size="15"
        search-placeholder="搜索卡名…"
        max-height="520px"
        @row-click="openDetail"
      >
        <template #cell-lift="{ row }">
          <span class="font-bold tabular-nums" :class="(row as ComboRow).lift >= 1.5 ? 'text-green-600 dark:text-green-400' : ''">
            {{ (row as ComboRow).lift }}
          </span>
        </template>
      </DataTable>
    </section>

    <!-- 详情抽屉 -->
    <Drawer v-model:open="drawerOpen" :title="selected ? `卡对详情` : ''">
      <template v-if="selected && store.result">
        <div class="grid grid-cols-2 gap-4 mb-5">
          <div
            v-for="k in ['a', 'b'] as const"
            :key="k"
            class="flex flex-col items-center gap-2 card p-4"
          >
            <CardThumb
              :id="String(selected[k])"
              :name="k === 'a' ? selected.nameA : selected.nameB"
              :catalog="store.result.catalog"
              size="lg"
            />
          </div>
        </div>
        <div class="space-y-2 text-sm">
          <div class="flex justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
            <span class="text-slate-400">同现套数</span><b class="tabular-nums">{{ selected.count }} 套</b>
          </div>
          <div class="flex justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
            <span class="text-slate-400">Lift</span><b class="tabular-nums text-brand">{{ selected.lift }}</b>
          </div>
          <div class="flex justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
            <span class="text-slate-400">带 {{ selected.nameA }} 时也带 {{ selected.nameB }}</span>
            <b class="tabular-nums">{{ selected.coRate }}%</b>
          </div>
          <div class="flex justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
            <span class="text-slate-400">反向条件概率</span>
            <b class="tabular-nums">{{ selected.coRateReverse }}%</b>
          </div>
          <p class="text-[11px] text-slate-400 pt-2 leading-relaxed">
            解读:Lift {{ selected.lift }} 表示同时携带两卡的倾向是随机情况 {{
              selected.lift.toFixed(1)
            }} 倍。
            {{ selected.lift >= 1.8 ? '强绑定,大概率是核心战术组件。' : selected.lift >= 1.4 ? '明显正相关,值得留意这套配合。' : '弱正相关,可能是环境泛用搭配。' }}
          </p>
        </div>
      </template>
    </Drawer>
  </div>
</template>
