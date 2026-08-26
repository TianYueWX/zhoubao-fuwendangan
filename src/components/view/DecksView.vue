<script setup lang="ts">
/**
 * DecksView.vue · 卡组浏览器
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
import { zoneAtTokenIndex } from '@/utils/parseTTS';
import { normalizeEventKey } from '@/utils/dataParser';
import type { CardCatalog, Deck } from '@/types';

/* ── 过滤 ── */
const rankLimit = ref<0 | 8 | 16 | 32>(0);
const heroSearch = ref('');
const sortMode = ref<'rank' | 'wins'>('rank');

const tierByHero = computed(() => {
  if (!store.result) return new Map<string, ReturnType<typeof quickHeroRows>[number]>();
  const rows = quickHeroRows(store.result.allDecks, store.result.totalDecks);
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
    wins: d.wins
  }));
  if (sortMode.value === 'wins') {
    arr.sort((a, b) => (b.wins ?? -1) - (a.wins ?? -1));
  }
  return arr;
});

const columns = [
  { key: 'rank', label: '名次', type: 'number' as const, sortable: true },
  { key: 'player', label: '选手', type: 'text' as const, sortable: true },
  { key: 'hero', label: '英雄', type: 'text' as const, sortable: true },
  { key: 'city', label: '城市', type: 'text' as const, sortable: true },
  { key: 'event', label: '赛事', type: 'text' as const, sortable: true },
  { key: 'wins', label: store.result?.hasWinData ? '胜场' : '', type: 'number' as const, sortable: false, align: 'right' as const }
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
/** 区域分组(按 deckCardCreateType 优先,类别推断兜底) */
const ZONE_GROUPS: ReadonlyArray<{
  key: string;
  label: string;
  oneRow: boolean;
  rotate?: boolean;
}> = [
  { key: 'legend', label: '传奇', oneRow: true },
  { key: 'hero', label: '选定', oneRow: true },
  { key: 'rune', label: '符文', oneRow: true },
  { key: 'battlefield', label: '战场', oneRow: true, rotate: true },
  { key: 'main', label: '主牌堆', oneRow: false },
  { key: 'side', label: '备牌', oneRow: false }
];

/** 卡 → 区域:选定英雄(isMainHero 卡号)→ deck 级 cardZones(deckCardCreateType,CARD_TYPE_MAP)
 * → 类别推断兜底(传奇/符文/战场/主牌堆) */
function deckZoneOf(id: string, d: Deck, catalog: CardCatalog): string {
  // 1) 选定英雄:decks_data.json isMainHero=true 的卡
  if (d.mainHeroCardNo && d.mainHeroCardNo === id) return 'hero';
  // 2) deck 级区域字段(deckCardCreateType:1=legend 2=main 3=rune 4=battlefield 5=side)
  const z = d.cardZones?.get(id);
  if (z) return z;
  // 3) 类别推断兜底(含 championTag 匹配选定英雄)
  const meta = catalog.byId.get(id);
  if (meta) {
    const tag = meta.championTag;
    if (meta.category === '英雄单位' && tag && d.hero && d.hero.includes(tag)) return 'hero';
  }
  const cat = catalog.cardCategory.get(id);
  if (cat === '传奇') return 'legend';
  if (cat === '符文') return 'rune';
  if (cat === '战场') return 'battlefield';
  return 'main';
}

interface DeckZoneGroup {
  key: string;
  label: string;
  oneRow: boolean;
  rotate: boolean;
  cards: GroupedCard[];
}

const groupedCards = computed<DeckZoneGroup[]>(() => {
  const r = store.result;
  const d = selectedDeck.value;
  if (!r || !d) return [];
  const byZone = new Map<string, Map<string, GroupedCard>>();
  const add = (zone: string, rawNo: string, count: number): void => {
    // 同名+副标题归并:同一张卡的多印刷版本合并显示;符文按名字去重后合计数量
    const key = r.catalog.canonicalById.get(rawNo) ?? rawNo;
    const repId = r.catalog.canonicalId.get(key) ?? rawNo;
    let map = byZone.get(zone);
    if (!map) {
      map = new Map<string, GroupedCard>();
      byZone.set(zone, map);
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
  };
  if (d.cardTokens && d.cardTokens.length > 0) {
    // TTS 顺序固定:按 token 位置切分区域(同一卡号跨区域时按张拆分,精确)
    d.cardTokens.forEach((no, idx) => {
      add(idx === 1 ? 'hero' : zoneAtTokenIndex(idx), no, 1);
    });
  } else {
    // 无 token 序列(如 deckList 数据):按 deck 级区域 Map 分组
    for (const [id, count] of d.cards) {
      add(deckZoneOf(id, d, r.catalog), id, count);
    }
  }
  return ZONE_GROUPS.filter((g) => byZone.has(g.key)).map((g) => ({
    key: g.key,
    label: g.label,
    oneRow: g.oneRow,
    rotate: g.rotate ?? false,
    cards: [...(byZone.get(g.key)?.values() ?? [])].sort(
      (a, b) => b.count - a.count || a.name.localeCompare(b.name)
    )
  }));
});

/** 顶部一排:传奇 / 选定 / 符文 / 战场(战场卡图横置) */
const topZoneGroups = computed(() =>
  groupedCards.value.filter(
    (g) =>
      g.key === 'legend' ||
      g.key === 'hero' ||
      g.key === 'rune' ||
      g.key === 'battlefield'
  )
);

/** 主牌堆 / 备牌:卡片网格 */
const gridZoneGroups = computed(() =>
  groupedCards.value.filter((g) => g.key === 'main' || g.key === 'side')
);

const totalCopies = computed(() => {
  const d = selectedDeck.value;
  if (!d) return 0;
  let s = 0;
  for (const c of d.cards.values()) s += c;
  return s;
});

/** 赛事(归一化名)→ 参赛人数;当前选中卡组的参赛人数 */
const eventEntryByKey = computed(() => {
  const r = store.result;
  const m = new Map<string, number>();
  if (r) {
    for (const e of r.events) m.set(e.name, e.deckCount);
  }
  return m;
});
const selectedEntry = computed(() => {
  const d = selectedDeck.value;
  if (!d) return null;
  return eventEntryByKey.value.get(normalizeEventKey(d.activityName)) ?? null;
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
    <section>
      <div class="flex items-start justify-between flex-wrap gap-4 mb-4">
        <SectionHeading
          eyebrow="构筑库 · Decks"
          title="卡组浏览器"
          :note="`全部 ${rows.length} 套卡组 · 点击行查看完整构筑与卡图`"
        />
        <div class="flex items-center gap-2 flex-wrap text-sm mt-1">
          <input
            v-model="heroSearch"
            type="text"
            placeholder="筛选英雄…"
            class="mini-select w-36 placeholder-ink-faint"
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
      </DataTable>
    </section>

    <!-- 卡组详情抽屉 -->
    <Drawer :open="drawerOpen" wide :title="selectedDeck ? `${selectedDeck.playerName} · ${selectedDeck.hero}` : ''" @update:open="(v) => (drawerOpen = v)" @close="drawerOpen = false">
      <template v-if="selectedDeck && store.result">
        <!-- 头部信息(紧凑一行:名次 · 胜场 · 总张数 · 赛事 · 日期 · 城市 · 门店) -->
        <div class="card p-3 mb-3">
          <div class="flex items-center justify-between gap-3 flex-wrap">
            <div class="flex items-center gap-x-3 gap-y-0.5 text-xs text-ink-muted tabular-nums flex-wrap min-w-0">
              <span class="whitespace-nowrap">
                名次
                <b class="text-ink font-bold">{{ selectedDeck.rank < Number.MAX_SAFE_INTEGER ? selectedDeck.rank : '—' }}</b>
              </span>
              <span v-if="selectedDeck.wins !== null" class="whitespace-nowrap">
                胜场
                <b class="text-delta-up font-bold">{{ selectedDeck.wins }}<span class="text-ink-faint font-normal">/{{ selectedDeck.eventRounds ?? '?' }}</span></b>
              </span>
              <span class="whitespace-nowrap">
                总张数
                <b class="text-brand font-bold">{{ totalCopies }}</b>
              </span>
              <span class="whitespace-nowrap">
                参赛人数
                <b class="text-ink font-bold">{{ selectedEntry ?? '—' }}</b>
              </span>
              <span class="text-ink-faint truncate min-w-0">{{ selectedDeck.activityName }}</span>
              <span v-if="selectedDeck.date" class="text-ink-faint whitespace-nowrap">· {{ selectedDeck.date }}</span>
              <span v-if="selectedDeck.city && selectedDeck.city !== '未知'" class="text-ink-faint whitespace-nowrap">· {{ selectedDeck.city }}</span>
              <span v-if="selectedDeck.shopName" class="text-ink-faint whitespace-nowrap">· {{ selectedDeck.shopName }}</span>
            </div>
            <button
              v-if="selectedDeck.ttsCode"
              @click="copyTTS"
              class="btn-brand px-3 py-1 text-xs shrink-0"
            >
              {{ copied ? '已复制' : '复制 TTS 码' }}
            </button>
          </div>
        </div>

        <!-- 分组卡表(区域:传奇/选定/符文/战场 并排一行,战场横置;主牌堆/备牌 网格) -->
        <div class="space-y-5">
          <!-- 顶部一排:传奇 / 选定 / 符文 / 战场 -->
          <div
            v-if="topZoneGroups.length"
            class="flex items-start gap-6 overflow-x-auto pb-2"
          >
            <div v-for="g in topZoneGroups" :key="g.key" class="shrink-0">
              <h4 class="text-[10px] font-bold text-ink-faint uppercase tracking-[0.18em] mb-1.5">
                {{ g.label }}
                <span class="ml-1">{{
                  g.cards.reduce((s, c) => s + c.count, 0)
                }}</span>
              </h4>
              <div class="flex gap-3">
                <template v-if="g.key === 'battlefield'">
                  <div
                    v-for="c in g.cards"
                    :key="c.id"
                    class="shrink-0 -rotate-90"
                    :title="`${c.name} ×${c.count}`"
                  >
                    <CardThumb
                      :id="c.id"
                      :name="c.name"
                      :catalog="store.result.catalog"
                      :count="c.count"
                      size="md"
                      :show-name="false"
                    />
                  </div>
                </template>
                <CardThumb
                  v-else
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

          <!-- 主牌堆 / 备牌:卡片网格 -->
          <div v-for="g in gridZoneGroups" :key="g.key">
            <h4 class="text-xs font-bold text-ink-muted uppercase tracking-[0.18em] mb-2 sticky top-[60px] sticky-head-solid py-1 z-10">
              {{ g.label }}
              <span class="text-ink-faint ml-1">{{
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
