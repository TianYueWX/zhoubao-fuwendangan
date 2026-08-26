<script setup lang="ts">
/**
 * LegendaryCompareView.vue · 传奇卡组对比(独立页面)
 *  - 同一张传奇,其所有卡组按「名次优先」排序(最佳 = 短时间窗口内成绩最好)
 *  - 向下取前 N 名(1/2/3/5/10)或表格勾选自由组合,横向对比多套卡组
 *  - 卡牌矩阵着色:共通(全部携带)/ 部分(部分携带)/ 独有(仅一套,朱砂高亮)
 *  - 每列标注 周次/名次/胜场/城市,卡组差异一目了然
 */
import { computed, ref, watch } from 'vue';
import { store, applyGlobalFilters } from '@/store/analysis';
import DataTable from '@/components/DataTable.vue';
import CardThumb from '@/components/CardThumb.vue';
import SectionHeading from '@/components/SectionHeading.vue';
import RuneSeal from '@/components/RuneSeal.vue';
import { legendaryRows } from '@/core';
import type { LegendaryRow } from '@/core/legendaryStats';
import { compareWeekBucket } from '@/utils/isoWeek';
import { CARD_COLOR_LABELS } from '@/types';
import type { CardCatalog, Deck } from '@/types';

const MAX_COMPARE = 10;

/* ── 传奇候选(选择器数据源) ── */
const legendaries = computed<LegendaryRow[]>(() => {
  const r = store.result;
  if (!r) return [];
  return legendaryRows(r.allDecks, r.catalog, r.totalDecks).sort(
    (a, b) => b.total - a.total
  );
});

const selectedCardNo = ref<string>('');
const selectedRow = computed<LegendaryRow | null>(() => {
  if (!selectedCardNo.value) return null;
  return legendaries.value.find((l) => l.cardNo === selectedCardNo.value) ?? null;
});

/** 传奇规范键(同名+副标题归并) */
const selectedLegKey = computed(() => {
  const row = selectedRow.value;
  if (!row || !store.result) return '';
  return store.result.catalog.canonicalById.get(row.cardNo) ?? row.cardNo;
});

// 默认选中出场率最高的传奇,矩阵即时可用(immediate:挂载时即触发)
watch(
  legendaries,
  (ls) => {
    if (!selectedCardNo.value && ls.length > 0) {
      selectedCardNo.value = ls[0]!.cardNo;
    }
  },
  { immediate: true }
);

/** 卡组 → 其传奇规范键(与 legendaryStats 口径一致) */
function deckLegKey(d: Deck, catalog: CardCatalog): string | null {
  for (const id of d.cards.keys()) {
    if (catalog.cardCategory.get(id) === '传奇') {
      return catalog.canonicalById.get(id) ?? id;
    }
  }
  return null;
}

/* ── 候选卡组:全局过滤 + 传奇 + 周过滤,名次优先排序 ── */
const weekFilter = ref('');

const candidates = computed<Deck[]>(() => {
  const r = store.result;
  if (!r || !selectedLegKey.value) return [];
  const key = selectedLegKey.value;
  const list = applyGlobalFilters(r.allDecks).filter(
    (d) => deckLegKey(d, r.catalog) === key
  );
  if (weekFilter.value) {
    return list.filter((d) => d.week.label === weekFilter.value);
  }
  return list;
});

/** 名次优先:名次升序 → 胜场 → 胜率 → 日期 */
function rankSort(a: Deck, b: Deck): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  if ((a.wins ?? -1) !== (b.wins ?? -1)) return (b.wins ?? -1) - (a.wins ?? -1);
  if ((a.winRate ?? -1) !== (b.winRate ?? -1)) return (b.winRate ?? -1) - (a.winRate ?? -1);
  return (a.date || '').localeCompare(b.date || '');
}

const sortedCandidates = computed(() => [...candidates.value].sort(rankSort));

const weekOptions = computed(() => {
  const set = new Map<string, Deck['week']>();
  for (const d of candidates.value) set.set(d.week.label, d.week);
  return [...set.entries()].sort((a, b) => compareWeekBucket(a[1], b[1]));
});

/* ── 对比选择:向下取前 N + 表格勾选 ── */
const TOP_N_OPTIONS = [1, 2, 3, 5, 10] as const;
const topN = ref(2);

function keyOf(d: Deck): string {
  return (
    d.cardGroupId != null
      ? `g${d.cardGroupId}`
      : `${d.playerName}|${d.activityName}|${d.rank}|${d.date}`
  );
}

const selectedKeys = ref<Set<string>>(new Set());

function selectTopN(n: number): void {
  topN.value = n;
  selectedKeys.value = new Set(sortedCandidates.value.slice(0, n).map(keyOf));
}

function toggleDeck(d: Deck): void {
  const k = keyOf(d);
  const next = new Set(selectedKeys.value);
  if (next.has(k)) {
    next.delete(k);
  } else {
    if (next.size >= MAX_COMPARE) return;
    next.add(k);
  }
  selectedKeys.value = next;
}

// 切换传奇 / 周过滤时,重置为前 N 名
watch(
  [selectedLegKey, weekFilter],
  () => {
    if (selectedLegKey.value) selectTopN(topN.value);
  },
  { immediate: true }
);

const selectedDecks = computed<Deck[]>(() =>
  sortedCandidates.value.filter((d) => selectedKeys.value.has(keyOf(d)))
);

/* ── 候选表 ── */
interface CandRow extends Record<string, unknown> {
  deck: Deck;
  sel: boolean;
  rank: number | string;
  player: string;
  week: string;
  date: string;
  city: string;
  wins: number | null;
  winRate: number | null;
}

const candRows = computed<CandRow[]>(() =>
  sortedCandidates.value.map((d) => ({
    deck: d,
    sel: selectedKeys.value.has(keyOf(d)),
    rank: Number.isFinite(d.rank) && d.rank < Number.MAX_SAFE_INTEGER ? d.rank : '—',
    player: d.playerName,
    week: d.week.label,
    date: d.date || '—',
    city: d.city === '未知' ? '—' : d.city,
    wins: d.wins,
    winRate: d.winRate !== null ? Math.round(d.winRate * 10) / 10 : null
  }))
);

const candColumns = computed(() => [
  { key: 'sel', label: '选', type: 'text' as const, sortable: false, align: 'center' as const },
  { key: 'rank', label: '名次', type: 'number' as const, sortable: true, align: 'right' as const },
  { key: 'player', label: '选手', type: 'text' as const, sortable: true },
  { key: 'week', label: '周次', type: 'text' as const, sortable: true },
  { key: 'date', label: '日期', type: 'text' as const, sortable: true },
  { key: 'city', label: '城市', type: 'text' as const, sortable: true },
  ...(store.result?.hasWinData
    ? ([
        { key: 'wins', label: '胜场', type: 'number' as const, sortable: true, align: 'right' as const },
        { key: 'winRate', label: '胜率', type: 'number' as const, sortable: true, align: 'right' as const }
      ] as const)
    : [])
]);

function onRowClick(row: Record<string, unknown>): void {
  toggleDeck((row as CandRow).deck);
}

/* ── 对比矩阵 ── */
const GROUP_ORDER: ReadonlyArray<{ key: string; label: string }> = [
  { key: '传奇', label: '传奇' },
  { key: '英雄单位', label: '英雄单位' },
  { key: '单位', label: '单位' },
  { key: '专属法术', label: '专属法术' },
  { key: '法术', label: '法术' },
  { key: '装备', label: '装备' },
  { key: '战场', label: '战场' },
  { key: '符文', label: '符文' },
  { key: '其他', label: '其他' }
];

interface MatrixRow {
  key: string;
  name: string;
  id: string;
  cat: string;
  counts: Array<number | null>;
  /** 携带该卡的卡组数 */
  present: number;
}

const matrix = computed<Array<{ cat: string; rows: MatrixRow[] }> | null>(() => {
  const r = store.result;
  const decks = selectedDecks.value;
  if (!r || decks.length === 0) return null;
  const catalog = r.catalog;
  const n = decks.length;

  const byKey = new Map<string, MatrixRow>();
  decks.forEach((d, di) => {
    for (const [id, cnt] of d.cards) {
      const key = catalog.canonicalById.get(id) ?? id;
      const repId = catalog.canonicalId.get(key) ?? id;
      let row = byKey.get(key);
      if (!row) {
        row = {
          key,
          name: catalog.cardDict.get(repId) ?? key,
          id: repId,
          cat: catalog.cardCategory.get(repId) ?? '其他',
          counts: decks.map(() => null),
          present: 0
        };
        byKey.set(key, row);
      }
      row.counts[di] = (row.counts[di] ?? 0) + cnt;
      row.present += 1;
    }
  });

  const groups = new Map<string, MatrixRow[]>();
  for (const row of byKey.values()) {
    const arr = groups.get(row.cat);
    if (arr) arr.push(row);
    else groups.set(row.cat, [row]);
  }

  const orderKeys = [...GROUP_ORDER.map((g) => g.key)];
  return orderKeys
    .filter((k) => groups.has(k))
    .map((k) => ({
      cat: GROUP_ORDER.find((g) => g.key === k)?.label ?? k,
      rows: (groups.get(k) ?? [])
        .sort(
          (a, b) =>
            b.present - a.present ||
            b.counts.reduce<number>((s, c) => s + (c ?? 0), 0) -
              a.counts.reduce<number>((s, c) => s + (c ?? 0), 0)
        )
    }));
});

function cellCls(present: number, n: number): string {
  if (present === n) return '';
  if (present === 1) return 'bg-brand-soft text-brand font-semibold';
  return 'bg-amber-100/80 dark:bg-amber-500/10';
}

function rankLabel(d: Deck): string {
  return Number.isFinite(d.rank) && d.rank < Number.MAX_SAFE_INTEGER ? `#${d.rank}` : '—';
}

function totalCopies(d: Deck): number {
  let s = 0;
  for (const c of d.cards.values()) s += c;
  return s;
}

function winLine(d: Deck): string {
  if (d.wins !== null && d.eventRounds !== null && d.eventRounds > 0) {
    return `${d.wins}胜/${d.eventRounds}轮`;
  }
  if (d.winRate !== null) return `胜率 ${d.winRate.toFixed(1)}%`;
  return '';
}
</script>

<template>
  <div class="fade-in space-y-8" v-if="store.result">
    <SectionHeading
      title="传奇卡组对比"
      note="同一张传奇的所有卡组,按名次优先排序(最佳 = 短时间窗口内成绩最好);向下取前 N 名或勾选自由组合,横向对比构筑差异。"
    />

    <!-- 传奇选择 -->
    <section class="space-y-3">
      <div class="flex items-center gap-4 flex-wrap">
        <label class="flex items-center gap-2 text-sm">
          <span class="text-xs text-slate-400">传奇</span>
          <select v-model="selectedCardNo" class="mini-select min-w-[220px]">
            <option v-for="l in legendaries" :key="l.cardNo" :value="l.cardNo">
              {{ l.name }} ({{ l.total }} 套)
            </option>
          </select>
        </label>

        <div v-if="selectedRow" class="flex items-center gap-3">
          <CardThumb
            :id="selectedRow.cardNo"
            :name="selectedRow.name"
            :catalog="store.result.catalog"
            size="sm"
            :show-name="false"
          />
          <div class="text-xs text-slate-500 dark:text-gray-400 leading-relaxed">
            <span class="flex items-center gap-1.5">
              <RuneSeal
                v-for="c in selectedRow.colors"
                :key="c"
                :size="9"
                :only="c"
              />
              {{ selectedRow.colors.map((c) => CARD_COLOR_LABELS[c]).join(' · ') }}
            </span>
            <span class="tabular-nums">
              {{ selectedRow.total }} 套 · 常用英雄 {{ selectedRow.topHero }}
              ({{ selectedRow.topHeroRate.toFixed(0) }}%)
            </span>
          </div>
        </div>
      </div>

      <!-- 周过滤 + 向下取 -->
      <div class="flex items-center gap-4 flex-wrap text-sm">
        <div class="flex items-center gap-1.5">
          <span class="text-xs text-slate-400">周次</span>
          <button
            v-for="w in [{ label: '', display: '全部' }, ...weekOptions.map(([label, bucket]) => ({ label, display: label, bucket }))]"
            :key="w.display"
            @click="weekFilter = w.label"
            :class="[
              'px-2.5 py-1 rounded-md text-xs transition-colors',
              weekFilter === w.label
                ? 'tab-active font-medium'
                : 'card text-slate-500 hover:text-brand'
            ]"
          >
            {{ w.display }}
          </button>
        </div>

        <div class="flex items-center gap-1.5">
          <span class="text-xs text-slate-400">向下取</span>
          <button
            v-for="n in TOP_N_OPTIONS"
            :key="n"
            @click="selectTopN(n)"
            :class="[
              'px-2.5 py-1 rounded-md text-xs tabular-nums transition-colors',
              topN === n
                ? 'tab-active font-medium'
                : 'card text-slate-500 hover:text-brand'
            ]"
          >
            前 {{ n }}
          </button>
          <span class="text-[11px] text-slate-400">
            已选 {{ selectedDecks.length }}/{{ MAX_COMPARE }} 套
          </span>
        </div>
      </div>
    </section>

    <!-- 候选卡组 -->
    <section>
      <SectionHeading
        small
        title="候选卡组(按名次)"
        :note="`共 ${sortedCandidates.length} 套 · 点击行或勾选加入对比`"
      />
      <DataTable
        :rows="candRows"
        :columns="candColumns"
        :page-size="10"
        search-placeholder="搜索选手 / 城市 / 赛事…"
        max-height="460px"
        @row-click="onRowClick"
      >
        <template #cell-sel="{ row }">
          <input
            type="checkbox"
            class="accent-[var(--color-brand)] w-4 h-4 cursor-pointer"
            :checked="(row as CandRow).sel"
            @click.stop
            @change="onRowClick(row)"
          />
        </template>
        <template #cell-rank="{ row }">
          <b class="tabular-nums" :class="Number((row as CandRow).rank) === 1 ? 'text-brand' : ''">{{
            (row as CandRow).rank
          }}</b>
        </template>
        <template #cell-wins="{ row }">
          <span class="tabular-nums">{{ (row as CandRow).wins ?? '—' }}</span>
        </template>
        <template #cell-winRate="{ row }">
          <span class="tabular-nums">{{ (row as CandRow).winRate ?? '—' }}</span>
        </template>
      </DataTable>
    </section>

    <!-- 对比矩阵 -->
    <section v-if="matrix && selectedDecks.length >= 1">
      <SectionHeading
        small
        title="构筑对比"
        :note="`${selectedDecks.length} 套卡组横向对比 · 共 ${
          matrix.reduce((s, g) => s + g.rows.length, 0)
        } 种卡`"
      >
        <template #actions>
          <div class="flex items-center gap-3 text-[11px] text-slate-500">
            <span class="inline-flex items-center gap-1">
              <i class="w-3 h-3 rounded-sm border border-slate-300 dark:border-slate-600 bg-transparent"></i>
              共通
            </span>
            <span class="inline-flex items-center gap-1">
              <i class="w-3 h-3 rounded-sm bg-amber-200/80 dark:bg-amber-500/20"></i>
              部分携带
            </span>
            <span class="inline-flex items-center gap-1">
              <i class="w-3 h-3 rounded-sm bg-brand-soft border border-brand-faint"></i>
              独有
            </span>
          </div>
        </template>
      </SectionHeading>

      <div class="overflow-x-auto max-h-[680px] overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-xl">
        <table class="w-full text-sm border-separate border-spacing-0">
          <thead class="sticky-thead">
            <tr class="text-slate-400 text-xs">
              <th
                class="py-2 px-3 text-left font-medium min-w-[230px] sticky left-0 z-[3]"
                :style="{ background: 'var(--color-thead-bg)' }"
              >
                卡牌
              </th>
              <th
                v-for="(d, i) in selectedDecks"
                :key="keyOf(d)"
                class="py-2 px-3 text-left font-medium min-w-[150px]"
                :style="{ background: 'var(--color-thead-bg)' }"
              >
                <div class="flex flex-col gap-0.5">
                  <div class="flex items-baseline gap-1.5">
                    <span
                      class="font-display font-black tabular-nums"
                      :class="i === 0 ? 'text-brand' : 'text-slate-700 dark:text-gray-200'"
                      >{{ rankLabel(d) }}</span
                    >
                    <span class="text-[11px] text-slate-500 dark:text-gray-400 truncate">{{
                      d.playerName
                    }}</span>
                  </div>
                  <div class="text-[10px] text-slate-400 dark:text-slate-500 tabular-nums">
                    {{ d.week.label }}
                    <template v-if="d.city !== '未知'"> · {{ d.city }}</template>
                    <template v-if="winLine(d)"> · {{ winLine(d) }}</template>
                  </div>
                  <div class="text-[10px] text-slate-400 dark:text-slate-500 tabular-nums">
                    共 {{ totalCopies(d) }} 张
                    <template v-if="d.hero"> · {{ d.hero }}</template>
                  </div>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            <template v-for="g in matrix" :key="g.cat">
              <tr>
                <td
                  :colspan="selectedDecks.length + 1"
                  class="px-3 py-1.5 text-[11px] font-bold tracking-[0.18em] text-slate-400 dark:text-slate-500 border-y border-slate-200 dark:border-slate-800"
                  :style="{ background: 'var(--color-panel-bg)' }"
                >
                  {{ g.cat }}
                </td>
              </tr>
              <tr v-for="row in g.rows" :key="row.key">
                <th
                  class="py-1 px-3 text-left font-normal min-w-[230px] sticky left-0 z-[2] border-b border-slate-100 dark:border-slate-800/60"
                  :style="{ background: 'var(--color-page-bg)' }"
                >
                  <div class="flex items-center gap-2.5">
                    <CardThumb
                      :id="row.id"
                      :name="row.name"
                      :catalog="store.result.catalog"
                      size="sm"
                      :show-name="false"
                    />
                    <div class="min-w-0">
                      <div class="text-[13px] text-slate-700 dark:text-gray-200 truncate">
                        {{ row.name }}
                      </div>
                      <div class="text-[10px] text-slate-300 dark:text-slate-600">{{ row.id }}</div>
                    </div>
                  </div>
                </th>
                <td
                  v-for="(c, di) in row.counts"
                  :key="di"
                  class="py-1 px-1 text-center text-xs tabular-nums border-b border-slate-100 dark:border-slate-800/60"
                  :class="cellCls(row.present, selectedDecks.length)"
                >
                  {{ c != null ? `×${c}` : '—' }}
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </section>

    <div
      v-else-if="selectedLegKey && sortedCandidates.length > 0"
      class="panel p-10 text-center text-sm text-slate-400"
    >
      请从候选卡组中勾选或「向下取」选择要对比的卡组
    </div>

    <div v-else-if="!selectedLegKey" class="panel p-10 text-center text-sm text-slate-400">
      暂无传奇数据(需导入赛事卡组与卡牌基础)
    </div>
  </div>
</template>
