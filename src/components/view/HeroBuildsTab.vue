<script setup lang="ts">
/**
 * HeroBuildsTab.vue · 英雄·传奇融合页「构筑」页签
 *  - 候选卡组表(名次优先排序,勾选/向下取 N)
 *  - 构筑对比矩阵(共通 / 部分 / 独有着色)
 *  - 周过滤
 * 传奇(legKey)由父级按选中英雄映射传入;候选卡组口径 = 全量卡组(全局周次筛选)。
 */
import { computed, ref, watch } from 'vue';
import { store, applyGlobalFilters } from '@/store/analysis';
import DataTable from '@/components/DataTable.vue';
import CardThumb from '@/components/CardThumb.vue';
import SectionHeading from '@/components/SectionHeading.vue';
import { compareWeekBucket } from '@/utils/isoWeek';
import { normalizeEventKey } from '@/utils/dataParser';
import { DECK_ZONE_LABELS } from '@/types';
import type { CardCatalog, Deck, DeckZone } from '@/types';

const props = defineProps<{ hero: string; legKey: string | null }>();

const MAX_COMPARE = 10;

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
  if (!r || !props.legKey) return [];
  const key = props.legKey;
  const list = applyGlobalFilters(r.allDecks).filter(
    (d) => deckLegKey(d, r.catalog) === key
  );
  if (weekFilter.value) {
    return list.filter((d) => d.week.label === weekFilter.value);
  }
  return list;
});

/** 名次优先:名次升序 → 胜场 → 日期 */
function rankSort(a: Deck, b: Deck): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  if ((a.wins ?? -1) !== (b.wins ?? -1)) return (b.wins ?? -1) - (a.wins ?? -1);
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

// 切换英雄(传奇) / 周过滤时,重置为前 N 名
watch(
  [() => props.legKey, weekFilter],
  () => {
    if (props.legKey) selectTopN(topN.value);
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
  /** 比赛参赛人数(该赛事全量卡组数) */
  entry: number | null;
}

/** 赛事(归一化名)→ 参赛人数 */
const eventEntryByKey = computed(() => {
  const r = store.result;
  const m = new Map<string, number>();
  if (r) {
    for (const e of r.events) m.set(e.name, e.deckCount);
  }
  return m;
});

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
    entry: eventEntryByKey.value.get(normalizeEventKey(d.activityName)) ?? null
  }))
);

const candColumns = computed(() => [
  { key: 'sel', label: '选', type: 'text' as const, sortable: false, align: 'center' as const },
  { key: 'rank', label: '名次', type: 'number' as const, sortable: true, align: 'right' as const },
  { key: 'player', label: '选手', type: 'text' as const, sortable: true },
  { key: 'week', label: '周次', type: 'text' as const, sortable: true },
  { key: 'date', label: '日期', type: 'text' as const, sortable: true },
  { key: 'city', label: '城市', type: 'text' as const, sortable: true },
  { key: 'entry', label: '参赛人数', type: 'number' as const, sortable: true, align: 'right' as const },
  ...(store.result?.hasWinData
    ? ([
      { key: 'wins', label: '胜场', type: 'number' as const, sortable: true, align: 'right' as const }
    ] as const)
    : [])
]);

function onRowClick(row: Record<string, unknown>): void {
  toggleDeck((row as CandRow).deck);
}

/* ── 对比矩阵(按 TTS_code 固定顺序分组:传奇→选定→主牌堆→战场→符文→备牌) ── */

/** 区域分组顺序(与 TTS 位置切分一致) */
const ZONE_ORDER: ReadonlyArray<DeckZone> = ['legend', 'hero', 'main', 'battlefield', 'rune', 'side'];

/**
 * 卡 → 构筑区域:
 *   1) 选定英雄:deck 的 isMainHero 卡号(无字段时 championTag 匹配)
 *   2) deck 级 cardZones(TTS 位置切分 / deckCardCreateType,与 TTS 顺序一致)
 *   3) 类别推断兜底
 */
function zoneOf(id: string, d: Deck, catalog: CardCatalog): DeckZone {
  if (d.mainHeroCardNo && d.mainHeroCardNo === id) return 'hero';
  const z = d.cardZones?.get(id);
  if (z) return z; // legend/main/battlefield/rune/side(TTS 位置生成,备牌段覆盖优先)
  const meta = catalog.byId.get(id);
  if (meta) {
    const tag = meta.championTag;
    if (meta.category === '英雄单位' && tag && d.hero && d.hero.includes(tag)) {
      return 'hero';
    }
  }
  const cat = catalog.cardCategory.get(id);
  if (cat === '传奇') return 'legend';
  if (cat === '符文') return 'rune';
  if (cat === '战场') return 'battlefield';
  return 'main';
}

interface MatrixRow {
  key: string;
  name: string;
  id: string;
  zone: DeckZone;
  counts: Array<number | null>;
  /** 携带该卡的卡组数 */
  present: number;
}

const matrix = computed<Array<{ zone: DeckZone; label: string; rows: MatrixRow[] }> | null>(() => {
  const r = store.result;
  const decks = selectedDecks.value;
  if (!r || decks.length === 0) return null;
  const catalog = r.catalog;
  const n = decks.length;
  // 区域判定以第一套卡组为锚(同一传奇的卡组区域一致;卡号级匹配用原始 id)
  const anchor = decks[0]!;

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
          zone: zoneOf(id, anchor, catalog),
          counts: decks.map(() => null),
          present: 0
        };
        byKey.set(key, row);
      }
      row.counts[di] = (row.counts[di] ?? 0) + cnt;
      row.present += 1;
    }
  });

  const groups = new Map<DeckZone, MatrixRow[]>();
  for (const row of byKey.values()) {
    const arr = groups.get(row.zone);
    if (arr) arr.push(row);
    else groups.set(row.zone, [row]);
  }

  return ZONE_ORDER.filter((k) => groups.has(k)).map((k) => ({
    zone: k,
    label: DECK_ZONE_LABELS[k],
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
  if (present === 1) return 'bg-[rgba(178,58,39,0.2)] text-brand font-semibold';
  return 'bg-[#ecd9a8]';
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
  return '';
}
</script>

<template>
  <div class="space-y-6">
    <!-- 周过滤 + 向下取 -->
    <section class="flex items-center gap-4 flex-wrap text-sm">
      <div class="flex items-center gap-1.5">
        <span class="text-xs text-ink-faint">周次</span>
        <button
          v-for="w in [{ label: '', display: '全部' }, ...weekOptions.map(([label, bucket]) => ({ label, display: label, bucket }))]"
          :key="w.display" @click="weekFilter = w.label" :class="[
            'px-2.5 py-1 rounded-md text-xs transition-colors',
            weekFilter === w.label
              ? 'tab-active font-medium'
              : 'card text-ink-muted hover:text-brand'
          ]">
          {{ w.display }}
        </button>
      </div>

      <div class="flex items-center gap-1.5">
        <span class="text-xs text-ink-faint">向下取</span>
        <button v-for="n in TOP_N_OPTIONS" :key="n" @click="selectTopN(n)" :class="[
          'px-2.5 py-1 rounded-md text-xs tabular-nums transition-colors',
          topN === n
            ? 'tab-active font-medium'
            : 'card text-ink-muted hover:text-brand'
        ]">
          前 {{ n }}
        </button>
        <span class="text-[11px] text-ink-faint">
          已选 {{ selectedDecks.length }}/{{ MAX_COMPARE }} 套
        </span>
      </div>
    </section>

    <!-- 候选卡组 -->
    <section>
      <SectionHeading small title="候选卡组(按名次)" :note="`共 ${sortedCandidates.length} 套 · 点击行或勾选加入对比`" />
      <DataTable :rows="candRows" :columns="candColumns" :page-size="10" search-placeholder="搜索选手 / 城市 / 赛事…"
        max-height="460px" @row-click="onRowClick">
        <template #cell-sel="{ row }">
          <input type="checkbox" class="accent-[var(--color-brand)] w-4 h-4 cursor-pointer"
            :checked="(row as CandRow).sel" @click.stop @change="onRowClick(row)" />
        </template>
        <template #cell-rank="{ row }">
          <b class="tabular-nums" :class="Number((row as CandRow).rank) === 1 ? 'text-brand' : ''">{{
            (row as CandRow).rank
          }}</b>
        </template>
        <template #cell-wins="{ row }">
          <span class="tabular-nums">{{ (row as CandRow).wins ?? '—' }}</span>
        </template>
      </DataTable>
    </section>

    <!-- 对比矩阵 -->
    <section v-if="matrix && selectedDecks.length >= 1">
      <SectionHeading small title="构筑对比" :note="`${selectedDecks.length} 套卡组横向对比 · 共 ${matrix.reduce((s, g) => s + g.rows.length, 0)
        } 种卡`">
        <template #actions>
          <div class="flex items-center gap-3 text-[11px] text-ink-muted">
            <span class="inline-flex items-center gap-1">
              <i class="w-3 h-3 rounded-sm border border-card-border bg-transparent"></i>
              共通
            </span>
            <span class="inline-flex items-center gap-1">
              <i class="w-3 h-3 rounded-sm bg-[#ecd9a8]"></i>
              部分携带
            </span>
            <span class="inline-flex items-center gap-1">
              <i class="w-3 h-3 rounded-sm bg-[rgba(178,58,39,0.2)] border border-brand-faint"></i>
              独有
            </span>
          </div>
        </template>
      </SectionHeading>

      <div class="overflow-x-auto max-h-[680px] overflow-y-auto border border-card-border rounded-xl">
        <table class="w-max min-w-full text-sm border-separate border-spacing-0">
          <thead class="sticky-thead">
            <tr class="text-ink-faint text-xs">
              <th class="py-1 px-1.5 text-left font-medium whitespace-nowrap sticky left-0 z-[3] w-[100px]"
                :style="{ background: 'var(--color-thead-bg)' }">
                卡牌
              </th>
              <th v-for="(d, i) in selectedDecks" :key="keyOf(d)" class="py-1 px-1.5 text-left font-medium w-[110px]"
                :style="{ background: 'var(--color-thead-bg)' }">
                <div class="flex flex-col gap-0">
                  <div class="flex items-baseline gap-1">
                    <span class="font-display font-black tabular-nums text-[11px]"
                      :class="i === 0 ? 'text-brand' : 'text-ink-muted'">{{ rankLabel(d) }}</span>
                    <span class="text-[10px] text-ink-muted truncate">{{
                      d.playerName
                      }}</span>
                  </div>
                  <div class="text-[9px] text-ink-faint tabular-nums leading-tight">
                    {{ d.week.label }}
                    <template v-if="d.city !== '未知'"> · {{ d.city }}</template>
                    <template v-if="winLine(d)"> · {{ winLine(d) }}</template>
                  </div>
                  <div class="text-[9px] text-ink-faint tabular-nums leading-tight">
                    共 {{ totalCopies(d) }} 张
                    <template v-if="d.hero"> · {{ d.hero }}</template>
                  </div>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            <template v-for="g in matrix" :key="g.zone">
              <tr>
                <td :colspan="selectedDecks.length + 1"
                  class="px-1.5 py-0.5 text-[11px] font-bold tracking-[0.18em] text-ink-faint border-y border-panel-border"
                  :style="{ background: 'var(--color-thead-bg)' }">
                  {{ g.label }}
                </td>
              </tr>
              <tr v-for="row in g.rows" :key="row.key">
                <th
                  class="py-0.5 px-1.5 text-left font-normal whitespace-nowrap sticky left-0 z-[2] border-b border-[rgba(59,74,90,0.08)] w-[100px]"
                  :style="{ background: 'var(--color-page-bg)' }">
                  <div class="flex items-center gap-1.5">
                    <CardThumb :id="row.id" :name="row.name" :catalog="store.result!.catalog" size="sm"
                      :show-name="false" />
                    <div class="min-w-0 flex-1">
                      <div class="text-[12px] text-ink-muted truncate leading-tight">
                        {{ row.name }}
                      </div>
                      <div class="text-[9px] text-ink-faint leading-tight truncate">{{ row.id }}</div>
                    </div>
                  </div>
                </th>
                <td v-for="(c, di) in row.counts" :key="di"
                  class="py-0.5 px-1.5 text-left text-[11px] tabular-nums border-b border-[rgba(59,74,90,0.08)]"
                  :class="cellCls(row.present, selectedDecks.length)">
                  {{ c != null ? `×${c}` : '—' }}
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </section>

    <div v-else-if="legKey && sortedCandidates.length > 0" class="py-12 text-center text-sm text-ink-faint">
      请从候选卡组中勾选或「向下取」选择要对比的卡组
    </div>

    <div v-else-if="!legKey" class="py-12 text-center text-sm text-ink-faint">
      暂无该英雄的传奇构筑数据
    </div>
  </div>
</template>
