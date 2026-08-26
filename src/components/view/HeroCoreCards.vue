<script setup lang="ts">
/**
 * HeroCoreCards.vue · 核心卡 Top 20(并入传奇构筑页)
 * 仅统计 maindeck(单位/法术/装备)+ chosen champion(英雄单位)+ battlefield(战场),
 * 不含符文/传奇(结构性卡,携带率恒为 100%)。
 */
import { computed } from 'vue';
import { store } from '@/store/analysis';
import SectionHeading from '@/components/SectionHeading.vue';

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
</script>

<template>
  <section>
    <SectionHeading eyebrow="装备单 · Loadout" title="核心卡 Top 20" note="按高排名卡组携带率排序;仅统计主卡组 + 英雄 + 战场(不含符文/传奇)" />
    <div class="overflow-y-auto max-h-[580px]">
      <table class="w-full text-sm">
        <thead class="sticky-thead">
          <tr class="text-ink-faint border-b border-panel-border text-xs">
            <th class="py-2 px-2 text-left">#</th>
            <th class="py-2 px-2 text-left">卡牌</th>
            <th class="py-2 px-2 text-right">稀有度</th>
            <th class="py-2 px-2 text-right">平均张数</th>
            <th class="py-2 px-2 text-right w-[38%]">携带率</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in coreCards" :key="String(c.id)" class="border-b border-[rgba(59,74,90,0.08)]">
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
