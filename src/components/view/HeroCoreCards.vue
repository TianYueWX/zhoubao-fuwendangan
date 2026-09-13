<script setup lang="ts">
/**
 * HeroCoreCards.vue · 核心卡 Top 20(并入传奇构筑页)
 * 仅统计 maindeck(单位/法术/装备)+ chosen champion(英雄单位)+ battlefield(战场),
 * 不含符文/传奇(结构性卡,携带率恒为 100%)。
 */
import { computed, ref } from 'vue';
import { store } from '@/store/analysis';
import SectionHeading from '@/components/SectionHeading.vue';
import SortableTh from '@/components/SortableTh.vue';
import TableDownloadButton from '@/components/TableDownloadButton.vue';
import { useTableSort, type SortableColumn } from '@/composables/useTableSort';

const props = defineProps<{ hero: string }>();

interface CoreCardRow extends Record<string, unknown> {
  rank: number;
  name: string;
  id: string;
  rarity: string;
  rate: number;
  avg: number;
}
const coreCards = computed<CoreCardRow[]>(() => {
  if (!props.hero) return [];
  const stat = store.result?.heroes.get(props.hero);
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

/* ── 表头点击排序(默认保持携带率降序;rank 为原始 Top 名次,排序后不重编号) ── */
const CORE_COLUMNS: readonly SortableColumn<CoreCardRow>[] = [
  { key: 'rank', type: 'number' },
  { key: 'name', type: 'text' },
  { key: 'rarity', type: 'text' },
  { key: 'avg', type: 'number' },
  { key: 'rate', type: 'number' }
];
const coreSort = useTableSort(coreCards, CORE_COLUMNS);
const coreCardsSorted = coreSort.sorted;

/* ── 长图导出 ── */
const coreTableEl = ref<HTMLTableElement | null>(null);
</script>

<template>
  <section>
    <SectionHeading eyebrow="装备单 · Loadout" title="核心卡 Top 20" note="按高排名卡组携带率排序;仅统计主卡组 + 英雄 + 战场(不含符文/传奇)">
      <template #actions>
        <TableDownloadButton
          :target="() => coreTableEl"
          :title="`${hero} · 核心卡 Top 20`"
          eyebrow="装备单 · Loadout"
          :note="`按高排名卡组携带率排序;仅统计主卡组 + 英雄 + 战场(不含符文/传奇)`"
        />
      </template>
    </SectionHeading>
    <div class="overflow-y-auto max-h-[580px]">
      <table ref="coreTableEl" class="w-full text-sm">
        <thead class="sticky-thead">
          <tr class="text-ink-faint border-b border-panel-border text-xs">
            <SortableTh :sort="coreSort" col-key="rank" label="#" align="left" />
            <SortableTh :sort="coreSort" col-key="name" label="卡牌" align="left" />
            <SortableTh :sort="coreSort" col-key="rarity" label="稀有度" align="right" />
            <SortableTh :sort="coreSort" col-key="avg" label="平均张数" align="right" />
            <SortableTh
              :sort="coreSort"
              col-key="rate"
              label="携带率"
              align="right"
              class-name="w-[38%]"
            />
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in coreCardsSorted" :key="String(c.id)" class="border-b border-[rgba(59,74,90,0.08)]">
            <td class="py-1.5 px-2 text-ink-faint tabular-nums">{{ c.rank }}</td>
            <td class="py-1.5 px-2 font-medium text-ink-muted">
              {{ c.name }}
              <span class="text-[10px] text-ink-faint ml-1">{{ c.id }}</span>
            </td>
            <td class="py-1.5 px-2 text-right text-xs text-ink-faint">{{ c.rarity }}</td>
            <td class="py-1.5 px-2 text-right tabular-nums">{{ c.avg }}</td>
            <td class="py-1.5 px-2">
              <div class="flex items-center gap-2 justify-end">
                <span class="tabular-nums text-xs w-11 text-right">{{ c.rate }}%</span>
                <div class="h-1.5 w-24 bg-panel-border rounded-full overflow-hidden">
                  <div class="h-full bg-brand rounded-full" :style="{ width: `${Math.min(100, c.rate)}%` }"></div>
                </div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
