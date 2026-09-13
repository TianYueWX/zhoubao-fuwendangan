<script setup lang="ts">
/**
 * CardsView.vue · 单卡分析(万金油单卡)
 *  - 范围切换 + 类型/颜色/费用/稀有度筛选
 *  - 携带率 Top 表(缩略图、禁卡标记、全局对照列)
 */
import { computed, ref, watch } from 'vue';
import { store } from '@/store/analysis';
import CardThumb from '@/components/CardThumb.vue';
import SectionHeading from '@/components/SectionHeading.vue';
import SortableTh from '@/components/SortableTh.vue';
import TableDownloadButton from '@/components/TableDownloadButton.vue';
import { useTableSort, type SortableColumn } from '@/composables/useTableSort';
import { countCards } from '@/core';
import { CARD_COLOR_HEX } from '@/utils/palette';
import type { CardCategory } from '@/types';

const scope = ref<string>('');

/**
 * 单卡页只看单个英雄的 Top 样本,不提供「全部高排名卡组」等全量范围:
 * 全量遍历(数千套卡组)会让携带率统计明显变慢,且对单卡分析意义有限。
 */
const scopeOptions = computed(() => {
  if (!store.result) return [];
  const heroes = Array.from(store.result.heroes.entries()).sort((a, b) => b[1].total - a[1].total);
  return heroes.map(([name, stat]) => ({
    value: name,
    label: `${name} (Top ${stat.topCount})`
  }));
});

// 默认选中出场最高的英雄;范围失效时自动回落到第一个
watch(
  scopeOptions,
  (opts) => {
    if (opts.length > 0 && !opts.some((o) => o.value === scope.value)) {
      scope.value = opts[0]!.value;
    }
  },
  { immediate: true }
);

const decks = computed(() => {
  const r = store.result;
  if (!r) return [];
  const stat = r.heroes.get(scope.value);
  return stat ? stat.topDecks : [];
});

const globalCounts = computed(() =>
  store.result ? store.result.globalAllCards : new Map<string, number>()
);

/* ── 筛选 ── */
const filterType = ref('');
const filterColor = ref('');
const filterEnergy = ref('');

const typeOptions = ['单位', '英雄单位', '法术', '装备'] as const;

interface StapleRow {
  id: string;
  name: string;
  category: string;
  colors: readonly string[];
  energy: number;
  rarity: string;
  banned: boolean;
  rate: number;
  avgCopies: number;
  globalRate: number;
  diff: number;
  /** 原始位次(按携带率排定的 Top N 名次);排序后不重编号 */
  rank: number;
}

const rows = computed<StapleRow[]>(() => {
  const r = store.result;
  if (!r || decks.value.length === 0) return [];
  const counts = countCards(decks.value, r.catalog);
  const n = decks.value.length;

  // 单次遍历聚合:规范键 → 总张数(替代 O(卡种×卡组×卡张) 的三重循环,大数据量下提速数百倍)
  const copiesByKey = new Map<string, number>();
  for (const d of decks.value) {
    for (const [cid, ccount] of d.cards) {
      const key = r.catalog.canonicalById.get(cid) ?? cid;
      copiesByKey.set(key, (copiesByKey.get(key) ?? 0) + ccount);
    }
  }

  const list: Array<Omit<StapleRow, 'rank'>> = [];

  for (const [key, deckCount] of counts) {
    // 规范键 → 代表编号(同名+副标题归并,优先有卡图)
    const repId = r.catalog.canonicalId.get(key) ?? key;
    const meta = r.catalog.byId.get(repId);
    if (!meta) continue;
    // 传奇是结构性卡牌(每套卡组必有 1 张),携带率恒为出场率本身,不进万金油表
    if (meta.category === '传奇') continue;
    if (filterType.value && meta.category !== filterType.value) continue;
    if (filterColor.value && !meta.colors.includes(filterColor.value as never)) continue;
    if (filterEnergy.value !== '') {
      const e = Number(filterEnergy.value);
      if (!Number.isFinite(e)) continue;
      // 7 表示 7+
      if (e >= 7 ? meta.energy < 7 : Math.floor(meta.energy) !== e) continue;
    }

    const g = globalCounts.value.get(key) ?? 0;
    const gRate = r.totalDecks > 0 ? (g / r.totalDecks) * 100 : 0;
    const rate = (deckCount / n) * 100;
    const copies = copiesByKey.get(key) ?? 0;
    list.push({
      id: repId,
      name: meta.name,
      category: meta.category,
      colors: meta.colors,
      energy: meta.energy,
      rarity: meta.rarity,
      banned: meta.isBanned,
      rate,
      avgCopies: Math.round((copies / deckCount) * 100) / 100,
      globalRate: Math.round(gRate * 10) / 10,
      diff: Math.round((rate - gRate) * 10) / 10
    });
  }

  list.sort((a, b) => b.rate - a.rate || a.name.localeCompare(b.name));
  // 位次在截断后固定下来:表头排序只换行序,不重编号(仍代表原始 Top 名次)
  return list.slice(0, 60).map((c, i) => ({ ...c, rank: i + 1 }));
});

/* ── 表头点击排序(默认保持携带率降序) ── */
const STAPLE_COLUMNS: readonly SortableColumn<StapleRow>[] = [
  { key: 'rank', type: 'number' },
  { key: 'name', type: 'text' },
  { key: 'category', type: 'text' },
  { key: 'colors', type: 'text', value: (r) => r.colors.join('') },
  { key: 'energy', type: 'number' },
  { key: 'avgCopies', type: 'number' },
  { key: 'rate', type: 'number' },
  { key: 'diff', type: 'number' }
];
const stapleSort = useTableSort(rows, STAPLE_COLUMNS);
const sortedRows = stapleSort.sorted;

/* ── 长图导出 ── */
const stapleTableEl = ref<HTMLTableElement | null>(null);
const STAPLE_NOTE = '携带率 = 使用该卡的卡组占比;"对照"为全环境口径差值';
</script>

<template>
  <div class="fade-in space-y-5">
    <section>
      <div class="flex items-start justify-between gap-3 flex-wrap mb-4">
        <SectionHeading
          eyebrow="常备单卡 · Staples"
          title="万金油单卡"
          note='携带率 = 使用该卡的卡组占比;"对照"为全环境口径差值'
        >
          <template #actions>
            <TableDownloadButton
              :target="() => stapleTableEl"
              title="万金油单卡"
              eyebrow="常备单卡 · Staples"
              :note="`${scope} · ${STAPLE_NOTE}`"
            />
          </template>
        </SectionHeading>
        <select v-model="scope" class="mini-select max-w-[260px] mt-1">
          <option v-for="o in scopeOptions" :key="String(o.value)" :value="o.value">
            {{ o.label }}
          </option>
        </select>
      </div>

      <!-- 筛选条 -->
      <div class="flex items-center gap-2 flex-wrap text-sm mb-4">
        <select v-model="filterType" class="mini-select">
          <option value="">全部类型</option>
          <option v-for="t in typeOptions" :key="t" :value="t">{{ t }}</option>
        </select>
        <select v-model="filterColor" class="mini-select">
          <option value="">全部颜色</option>
          <option value="red">狂怒</option>
          <option value="green">平静</option>
          <option value="blue">心灵</option>
          <option value="yellow">躯体</option>
          <option value="purple">混沌</option>
          <option value="orange">秩序</option>
        </select>
        <select v-model="filterEnergy" class="mini-select">
          <option value="">全部费用</option>
          <option v-for="i in 8" :key="i" :value="String(i - 1)">
            {{ i - 1 === 7 ? '7+费' : `${i - 1} 费` }}
          </option>
        </select>
        <span class="ml-auto text-xs text-ink-faint">{{ rows.length }} 张卡</span>
      </div>

      <div class="overflow-x-auto max-h-[640px] overflow-y-auto">
        <table ref="stapleTableEl" class="w-full text-sm">
          <thead class="sticky-thead">
            <tr class="text-ink-faint border-b border-panel-border text-xs">
              <SortableTh :sort="stapleSort" col-key="rank" label="#" align="left" />
              <SortableTh :sort="stapleSort" col-key="name" label="卡牌" align="left" />
              <SortableTh :sort="stapleSort" col-key="category" label="类型" align="left" />
              <SortableTh :sort="stapleSort" col-key="colors" label="色域" align="center" />
              <SortableTh :sort="stapleSort" col-key="energy" label="费" align="right" />
              <SortableTh :sort="stapleSort" col-key="avgCopies" label="均张" align="right" />
              <SortableTh
                :sort="stapleSort"
                col-key="rate"
                label="携带率"
                align="right"
                class-name="w-[26%]"
              />
              <SortableTh :sort="stapleSort" col-key="diff" label="对照Δ" align="right" />
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="c in sortedRows"
              :key="c.id"
              class="table-row border-b border-[rgba(59,74,90,0.08)]"
            >
              <td class="py-1.5 px-2 text-ink-faint tabular-nums">{{ c.rank }}</td>
              <td class="py-1.5 px-2">
                <div class="flex items-center gap-2.5">
                  <CardThumb
                    :id="c.id"
                    :name="c.name"
                    :catalog="store.result!.catalog"
                    size="sm"
                    :show-name="false"
                  />
                  <div class="min-w-0">
                    <div class="font-medium text-ink-muted truncate">
                      {{ c.name }}
                      <span
                        v-if="c.banned"
                        class="ml-1 px-1 rounded bg-brand text-brand-ink text-[9px] font-bold align-middle"
                        >禁</span
                      >
                    </div>
                    <div class="text-[10px] text-ink-faint">{{ c.id }}</div>
                  </div>
                </div>
              </td>
              <td class="py-1.5 px-2 text-xs">{{ c.category }}</td>
              <td class="py-1.5 px-2">
                <div class="flex justify-center gap-0.5">
                  <span
                    v-for="col in c.colors"
                    :key="col"
                    class="w-2.5 h-2.5 rounded-full inline-block"
                    :style="{ background: CARD_COLOR_HEX[col as keyof typeof CARD_COLOR_HEX] }"
                  ></span>
                </div>
              </td>
              <td class="py-1.5 px-2 text-right tabular-nums">{{ c.energy }}</td>
              <td class="py-1.5 px-2 text-right tabular-nums">{{ c.avgCopies }}</td>
              <td class="py-1.5 px-2">
                <div class="flex items-center gap-2 justify-end">
                  <span class="tabular-nums text-xs w-12 text-right font-semibold">{{
                    c.rate.toFixed(1)
                  }}%</span>
                  <div class="h-1.5 w-24 bg-panel-border rounded-full overflow-hidden">
                    <div
                      class="h-full bg-brand rounded-full"
                      :style="{ width: `${Math.min(100, c.rate)}%` }"
                    ></div>
                  </div>
                </div>
              </td>
              <td
                class="py-1.5 px-2 text-right tabular-nums text-xs"
                :class="
                  c.diff >= 15
                    ? 'text-delta-up'
                    : c.diff <= -15
                      ? 'text-delta-down'
                      : 'text-ink-faint'
                "
              >
                {{ c.diff >= 0 ? '+' : '' }}{{ c.diff }}pp
              </td>
            </tr>
            <tr v-if="rows.length === 0">
              <td colspan="8" class="py-10 text-center text-ink-faint">当前筛选无数据</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
