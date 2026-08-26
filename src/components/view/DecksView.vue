<script setup lang="ts">
/**
 * DecksView.vue · 🃏 卡组浏览器
 *  - 多维筛选(名次 / 英雄搜索 / 胜场排序)
 *  - 列表分页;点击 → 抽屉查看完整构筑(按类型分组 + 卡图)
 *  - 一键复制 TTS 码
 */
import { computed, ref } from 'vue';
import { store, applyGlobalFilters } from '@/store/analysis';
import DataTable from '@/components/DataTable.vue';
import Drawer from '@/components/Drawer.vue';
import CardThumb from '@/components/CardThumb.vue';
import TierBadge from '@/components/TierBadge.vue';
import SectionHeading from '@/components/SectionHeading.vue';
import { quickHeroRows } from '@/core';
import type { Deck } from '@/types';

/* ── 过滤 ── */
const rankLimit = ref<0 | 8 | 16 | 32>(0);
const heroSearch = ref('');
const sortMode = ref<'rank' | 'wins' | 'winRate'>('rank');

const tierByHero = computed(() => {
  if (!store.result) return new Map<string, ReturnType<typeof quickHeroRows>[number]>();
  const rows = quickHeroRows(
    store.result.allDecks,
    store.result.totalDecks,
    store.result.hasWinData
  );
  return new Map(rows.map((r) => [r.hero, r]));
});

const decks = computed(() => {
  let list = store.result ? applyGlobalFilters(store.result.allDecks) : [];
  if (!list.length) return list;
  if (rankLimit.value > 0) {
    list = list.filter((d) => d.rank <= rankLimit.value);
  }
  const q = heroSearch.value.trim().toLowerCase();
  if (q) {
    list = list.filter((d) => d.hero.toLowerCase().includes(q));
  }
  return list;
});

interface DeckRow extends Record<string, unknown> {
  deck: Deck;
  rank: number | string;
  player: string;
  hero: string;
  event: string;
  date: string;
  city: string;
  wins: number | null;
  winRate: number | null;
}

const rows = computed<DeckRow[]>(() => {
  const arr = decks.value.map((d) => ({
    deck: d,
    rank: Number.isFinite(d.rank) && d.rank < Number.MAX_SAFE_INTEGER ? d.rank : '—',
    player: d.playerName,
    hero: d.hero,
    event: d.activityName.replace(/^【[^】]*】\s*/, ''),
    date: d.date || '—',
    city: d.city === '未知' ? '—' : d.city,
    wins: d.wins,
    winRate: d.winRate !== null ? Math.round(d.winRate * 10) / 10 : null
  }));
  if (sortMode.value === 'wins') {
    arr.sort((a, b) => (b.wins ?? -1) - (a.wins ?? -1));
  } else if (sortMode.value === 'winRate') {
    arr.sort((a, b) => (b.winRate ?? -1) - (a.winRate ?? -1));
  }
  return arr;
});

const columns = [
  { key: 'rank', label: '名次', type: 'number' as const, sortable: true },
  { key: 'player', label: '选手', type: 'text' as const, sortable: true },
  { key: 'hero', label: '英雄', type: 'text' as const, sortable: true },
  { key: 'city', label: '城市', type: 'text' as const, sortable: true },
  { key: 'event', label: '赛事', type: 'text' as const, sortable: true },
  { key: 'wins', label: store.result?.hasWinData ? '胜场' : '', type: 'number' as const, sortable: false, align: 'right' as const },
  { key: 'winRate', label: '胜率', type: 'number' as const, sortable: true, align: 'right' as const }
];

const visibleColumns = computed(() =>
  columns.filter((c) => !(c.key === 'wins' && !store.result?.hasWinData))
);

/* ── 详情抽屉 ── */
const drawerOpen = ref(false);
const selectedDeck = ref<Deck | null>(null);
const copied = ref(false);

function openDeck(row: Record<string, unknown>): void {
  selectedDeck.value = (row as DeckRow).deck;
  drawerOpen.value = true;
  copied.value = false;
}

/** 按类型把卡组卡牌分组 */
interface GroupedCard {
  id: string;
  name: string;
  count: number;
}
const GROUP_ORDER: ReadonlyArray<{ key: string; label: string }> = [
  { key: '传奇', label: '传奇' },
  { key: '英雄单位', label: '英雄单位' },
  { key: '单位', label: '单位' },
  { key: '专属法术', label: '专属法术' },
  { key: '法术', label: '法术' },
  { key: '装备', label: '装备' },
  { key: '战场', label: '战场' },
  { key: '符文', label: '符文' }
];

const groupedCards = computed(() => {
  const r = store.result;
  const d = selectedDeck.value;
  if (!r || !d) return [];
  const byCat = new Map<string, Map<string, GroupedCard>>();
  for (const [id, count] of d.cards) {
    // 同名+副标题归并:同一张卡的多印刷版本合并显示
    const key = r.catalog.canonicalById.get(id) ?? id;
    const repId = r.catalog.canonicalId.get(key) ?? id;
    let cat = r.catalog.cardCategory.get(repId) ?? '其他';
    // 专属法术在目录里归为法术;此处按名称细分展示价值不大,保持法术
    const group =
      GROUP_ORDER.find((g) => g.key === cat)?.key ?? (cat === '其他' ? '其他' : cat);
    let map = byCat.get(group);
    if (!map) {
      map = new Map<string, GroupedCard>();
      byCat.set(group, map);
    }
    const existing = map.get(repId);
    if (existing) {
      existing.count += count;
    } else {
      map.set(repId, {
        id: repId,
        name: r.catalog.cardDict.get(repId) ?? key,
        count
      });
    }
  }
  const arrs = [...byCat.entries()].map(([group, map]) => [
    group,
    [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  ] as const);
  const orderKeys = [...GROUP_ORDER.map((g) => g.key), '其他'];
  return orderKeys
    .filter((k) => byCat.has(k))
    .map((k) => ({
      key: k,
      label: GROUP_ORDER.find((g) => g.key === k)?.label ?? k,
      cards: arrs.find(([g]) => g === k)?.[1] ?? []
    }))
    .filter((g) => g.cards.length > 0);
});

const totalCopies = computed(() => {
  const d = selectedDeck.value;
  if (!d) return 0;
  let s = 0;
  for (const c of d.cards.values()) s += c;
  return s;
});

async function copyTTS(): Promise<void> {
  const d = selectedDeck.value;
  if (!d?.ttsCode) return;
  try {
    await navigator.clipboard.writeText(d.ttsCode);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 1500);
  } catch {
    /* 剪贴板不可用 */
  }
}
</script>

<template>
  <div class="fade-in space-y-5" v-if="store.result">
    <section class="panel rounded-2xl p-5">
      <div class="flex items-start justify-between flex-wrap gap-4 mb-4">
        <SectionHeading
          title="卡组浏览器"
          :note="`全部 ${rows.length} 套卡组 · 点击行查看完整构筑与卡图`"
        />
        <div class="flex items-center gap-2 flex-wrap text-sm">
          <input
            v-model="heroSearch"
            type="text"
            placeholder="筛选英雄…"
            class="mini-select w-36"
          />
          <select v-model.number="rankLimit" class="mini-select" title="名次上限">
            <option :value="0">全部名次</option>
            <option :value="8">Top 8</option>
            <option :value="16">Top 16</option>
            <option :value="32">Top 32</option>
          </select>
          <select v-model="sortMode" v-if="store.result?.hasWinData" class="mini-select" title="排序">
            <option value="rank">按名次</option>
            <option value="wins">按胜场</option>
            <option value="winRate">按胜率</option>
          </select>
        </div>
      </div>

      <DataTable
        :rows="rows"
        :columns="visibleColumns"
        :page-size="20"
        search-placeholder="搜索选手 / 英雄 / 赛事…"
        max-height="620px"
        @row-click="openDeck"
      >
        <template #cell-rank="{ row }">
          <b class="tabular-nums">{{ (row as DeckRow).rank }}</b>
        </template>
        <template #cell-hero="{ row }">
          <span class="inline-flex items-center gap-1.5">
            {{ (row as DeckRow).hero }}
            <TierBadge
              v-if="tierByHero.get((row as DeckRow).hero)?.tier"
              :tier="tierByHero.get((row as DeckRow).hero)!.tier"
              size="sm"
            />
          </span>
        </template>
        <template #cell-wins="{ row }">
          <span class="font-semibold tabular-nums">{{ (row as DeckRow).wins ?? '—' }}</span>
        </template>
        <template #cell-winRate="{ row }">
          <span
            class="tabular-nums"
            :class="(row as DeckRow).winRate != null && (row as DeckRow).winRate! >= 57 ? 'text-green-600 dark:text-green-400 font-semibold' : ''"
          >
            {{ (row as DeckRow).winRate != null ? `${(row as DeckRow).winRate}%` : '—' }}
          </span>
        </template>
      </DataTable>
    </section>

    <!-- 卡组详情抽屉 -->
    <Drawer :open="drawerOpen" wide :title="selectedDeck ? `${selectedDeck.playerName} · ${selectedDeck.hero}` : ''" @update:open="(v) => (drawerOpen = v)" @close="drawerOpen = false">
      <template v-if="selectedDeck && store.result">
        <!-- 头部信息 -->
        <div class="card p-4 mb-4 space-y-2">
          <div class="flex items-center justify-between flex-wrap gap-2">
            <div class="flex items-center gap-3">
              <div class="text-center">
                <div class="text-[10px] text-slate-400">名次</div>
                <div class="text-xl font-bold text-slate-800 dark:text-white tabular-nums">
                  {{
                    selectedDeck.rank < Number.MAX_SAFE_INTEGER ? selectedDeck.rank : '—'
                  }}
                </div>
              </div>
              <div class="text-center" v-if="selectedDeck.wins !== null">
                <div class="text-[10px] text-slate-400">胜场</div>
                <div class="text-xl font-bold text-green-500 tabular-nums">
                  {{ selectedDeck.wins }}<span class="text-xs text-slate-400">/{{ selectedDeck.eventRounds ?? '?' }}</span>
                </div>
              </div>
              <div class="text-center">
                <div class="text-[10px] text-slate-400">总张数</div>
                <div class="text-xl font-bold text-brand tabular-nums">{{ totalCopies }}</div>
              </div>
            </div>
            <button
              v-if="selectedDeck.ttsCode"
              @click="copyTTS"
              class="btn-brand px-3 py-1.5 text-xs"
            >
              {{ copied ? '✅ 已复制' : '📋 复制 TTS 码' }}
            </button>
          </div>
          <div class="text-xs text-slate-400 leading-relaxed">
            {{ selectedDeck.activityName }}
            <span v-if="selectedDeck.date"> · {{ selectedDeck.date }}</span>
            <span v-if="selectedDeck.city && selectedDeck.city !== '未知'"> · {{ selectedDeck.city }}</span>
            <span v-if="selectedDeck.shopName"> · {{ selectedDeck.shopName }}</span>
          </div>
        </div>

        <!-- 分组卡表 -->
        <div class="space-y-5">
          <div v-for="g in groupedCards" :key="g.key">
            <h4 class="text-xs font-bold text-slate-500 dark:text-gray-400 uppercase tracking-wider mb-2 sticky top-[60px] sticky-head-solid py-1 z-10">
              {{ g.label }}
              <span class="text-slate-300 dark:text-slate-600 ml-1">{{
                g.cards.reduce((s, c) => s + c.count, 0)
              }}</span>
            </h4>
            <div class="flex flex-wrap gap-3">
              <CardThumb
                v-for="c in g.cards"
                :key="c.id"
                :id="c.id"
                :name="c.name"
                :catalog="store.result.catalog"
                :count="c.count"
                size="md"
              />
            </div>
          </div>
        </div>
      </template>
    </Drawer>
  </div>
</template>

