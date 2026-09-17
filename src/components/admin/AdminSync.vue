<script setup lang="ts">
/**
 * AdminSync.vue · 数据同步(P5 + P5b)
 *
 * 数据源:官方小程序后端(公开只读) → Supabase。
 * 流程:拉取(fast/deep)→ 与库内比对 → 三种落地方式。
 *
 * 与后台原版的关键差异:
 *   ① is_banned **默认不写**,需显式勾选 —— 它是人工维护列,
 *      默认写入会把编务手工调的禁限表静默覆盖掉(搬迁前就有的缺陷)。
 *   ② 新增「导出站点卡表快照」:直接产出周报站预加载用的两个 CSV,
 *      并在下载前自检格式,消灭了原先的手工导出环节。
 *   ③ 差异预览的比对列随 is_banned 开关联动 —— 不写就不该报出它的差异,
 *      否则预览里会满屏假变更。
 */
import { computed, onMounted, ref, watch } from 'vue';
import EditorialShell from './EditorialShell.vue';
import SectionHeading from '../SectionHeading.vue';
import { navigate } from '@/router/hash';
import { errorText, notifyError, notifyOk, notifyWarn } from '@/tools/admin/notice';
import { truncate, formatTime } from '@/tools/admin/text';
import { applyDataset, loadExisting, loadSnapshotRows, type ExistingSnapshot } from '@/tools/admin/sync';
import { touchVersions, VERSION_CATEGORIES } from '@/tools/sources/rest';
import { isSupabaseConfigured } from '@/tools/sources/config';
import { RIFTBOUND_API_BASE, type ApiCardDetail } from '@/tools/sync/riftboundApi';
import { fetchDataset, type SyncDataset, type SyncPhase } from '@/tools/sync/run';
import { cacheCount, clearDetailCache, loadDetailCache, saveDetailCache } from '@/tools/sync/cache';
import { diffRows, keyMap, summarize, type DiffSummary, type RowDiff } from '@/tools/sync/diff';
import {
  CARD_ICON_COLUMNS,
  CARD_PRINT_COLUMNS,
  buildSyncSql,
  cardIconsCsv,
  cardPrintsCsv,
  cardsBaseColumns,
  cardsBaseCsv,
  downloadText
} from '@/tools/sync/exporters';
import {
  SNAPSHOT_TARGET,
  cardPrintsSnapshotCsv,
  cardsBaseSnapshotCsv,
  checkSnapshot
} from '@/tools/sync/snapshot';
import type { CardIconRow, CardPrintExportRow, CardsBaseRow } from '@/tools/sync/normalize';

const configured = computed(() => isSupabaseConfigured());

/* ══════════════════ 拉取 ══════════════════ */

const apiBase = ref(RIFTBOUND_API_BASE);
const mode = ref<'fast' | 'deep'>('fast');
const fetching = ref(false);
const phase = ref<SyncPhase>('idle');
const phaseLabel = ref('');
const progressDone = ref(0);
const progressTotal = ref(0);
const fetchError = ref('');
const dataset = ref<SyncDataset | null>(null);
let controller: AbortController | null = null;

const detailCache: Record<string, ApiCardDetail> = loadDetailCache();
const cacheSize = ref(cacheCount(detailCache));

const progressPercent = computed(() => {
  if (!progressTotal.value) return fetching.value ? 30 : 0;
  return Math.min(100, Math.round((progressDone.value / progressTotal.value) * 100));
});

/* ══════════════════ 差异 ══════════════════ */

const existing = ref<ExistingSnapshot | null>(null);
const existingLoading = ref(false);

const includeBanList = ref(false);

interface Diffs {
  cards: RowDiff<CardsBaseRow>[];
  prints: RowDiff<CardPrintExportRow>[];
  icons: RowDiff<CardIconRow>[];
}
const diffs = ref<Diffs | null>(null);
const cardsSummary = ref<DiffSummary>({ total: 0, newCount: 0, updateCount: 0, sameCount: 0 });
const printsSummary = ref<DiffSummary>({ total: 0, newCount: 0, updateCount: 0, sameCount: 0 });
const iconsSummary = ref<DiffSummary>({ total: 0, newCount: 0, updateCount: 0, sameCount: 0 });

const printKey = (p: { card_no_extend: string; language: string }): string =>
  `${p.card_no_extend}\u0000${p.language}`;

async function loadExistingRows(force = false): Promise<void> {
  if (existing.value && !force) return;
  existingLoading.value = true;
  try {
    existing.value = await loadExisting();
  } catch (e) {
    notifyError(`读取库内现状失败:${errorText(e)}`);
    existing.value = null;
  } finally {
    existingLoading.value = false;
  }
}

/** 按当前 is_banned 开关重算差异(不写就不比,避免预览里满屏假变更) */
function recomputeDiffs(): void {
  const ds = dataset.value;
  const ex = existing.value;
  if (!ds || !ex) return;

  const cardFields = cardsBaseColumns(includeBanList.value) as unknown as (keyof CardsBaseRow)[];

  const cardDiffs = diffRows<CardsBaseRow>(
    ds.cards,
    keyMap(ex.cards, (r) => r.card_no),
    (r) => r.card_no,
    cardFields
  );
  const printDiffs = diffRows<CardPrintExportRow>(
    ds.prints,
    keyMap(ex.prints, printKey),
    printKey,
    CARD_PRINT_COLUMNS as unknown as (keyof CardPrintExportRow)[]
  );
  const iconDiffs = diffRows<CardIconRow>(
    ds.icons,
    keyMap(ex.icons, (r) => r.name_zh),
    (r) => r.name_zh,
    CARD_ICON_COLUMNS as unknown as (keyof CardIconRow)[]
  );

  diffs.value = { cards: cardDiffs, prints: printDiffs, icons: iconDiffs };
  cardsSummary.value = summarize(cardDiffs);
  printsSummary.value = summarize(printDiffs);
  iconsSummary.value = summarize(iconDiffs);
}

/* is_banned 开关一变就重算:不写就不该报出这一列的差异 */
watch(includeBanList, () => recomputeDiffs());

const changedCards = computed(() => (diffs.value?.cards ?? []).filter((d) => d.kind !== 'same'));
const changedPrints = computed(() => (diffs.value?.prints ?? []).filter((d) => d.kind !== 'same'));
const changedIcons = computed(() => (diffs.value?.icons ?? []).filter((d) => d.kind !== 'same'));

const totalChanges = computed(
  () =>
    cardsSummary.value.newCount +
    cardsSummary.value.updateCount +
    printsSummary.value.newCount +
    printsSummary.value.updateCount +
    iconsSummary.value.newCount +
    iconsSummary.value.updateCount
);

/** 三种行类型共用;只依赖结构,避免为联合类型做多余的类型体操 */
function changeText(d: { kind: string; changes: { field: string; from: unknown; to: unknown }[] }): string {
  if (d.kind === 'new') return '新增';
  return d.changes.map((c) => `${c.field}: ${fmtValue(c.from)} → ${fmtValue(c.to)}`).join('; ');
}
function fmtValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '∅';
  if (Array.isArray(v)) return v.join('/') || '∅';
  const s = String(v);
  return s.length > 22 ? `${s.slice(0, 22)}…` : s;
}

/* ══════════════════ 拉取动作 ══════════════════ */

async function startFetch(): Promise<void> {
  if (fetching.value) return;
  fetching.value = true;
  fetchError.value = '';
  dataset.value = null;
  diffs.value = null;
  controller = new AbortController();
  try {
    await loadExistingRows();
    const ds = await fetchDataset({
      baseUrl: apiBase.value,
      mode: mode.value,
      existingSeriesCodes: existing.value?.seriesCodes ?? [],
      seriesByPrefix: existing.value?.seriesByPrefix ?? {},
      detailCache,
      signal: controller.signal,
      onProgress: (p) => {
        phase.value = p.phase;
        phaseLabel.value = p.label;
        progressDone.value = p.done;
        progressTotal.value = p.total;
      }
    });
    dataset.value = ds;
    notifyOk(
      `拉取完成:${ds.cards.length} 张卡、${ds.prints.length} 个印刷版本、${ds.icons.length} 个图标`,
      ds.stats.enriched ? `其中补拉详情 ${ds.stats.enriched} 张` : undefined
    );
    recomputeDiffs();
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      notifyWarn('已取消拉取');
    } else {
      fetchError.value = errorText(e);
      notifyError(`拉取失败:${fetchError.value}`);
    }
    phase.value = 'idle';
  } finally {
    fetching.value = false;
    controller = null;
    if (!saveDetailCache(detailCache)) {
      notifyWarn('详情缓存超出本地存储配额,本次未写入(可重跑续拉)');
    }
    cacheSize.value = cacheCount(detailCache);
  }
}

function cancelFetch(): void {
  controller?.abort();
}

function clearCache(): void {
  clearDetailCache();
  for (const k of Object.keys(detailCache)) delete detailCache[k];
  cacheSize.value = 0;
  notifyOk('已清空详情缓存');
}

/* ══════════════════ 直接写入 ══════════════════ */

const applying = ref(false);
const applyLabel = ref('');
const publishTogether = ref(true);

async function applyDirect(): Promise<void> {
  const ds = dataset.value;
  if (!ds || !diffs.value) return;
  applying.value = true;
  applyLabel.value = '';
  try {
    const res = await applyDataset(
      {
        cards: changedCards.value.map((d) => d.after),
        prints: changedPrints.value.map((d) => d.after),
        icons: changedIcons.value.map((d) => d.after),
        seriesPresets: ds.seriesPresets
      },
      {
        includeBanList: includeBanList.value,
        onProgress: (label, done, total) => {
          applyLabel.value = `${label} ${done}/${total}`;
        }
      }
    );

    const parts = [
      res.cards ? `卡牌 ${res.cards}` : '',
      res.prints ? `印刷 ${res.prints}` : '',
      res.icons ? `图标 ${res.icons}` : '',
      res.series ? `系列 ${res.series}` : ''
    ].filter(Boolean);

    if (publishTogether.value) {
      const results = await touchVersions(['cards', 'prints', 'icons']);
      const failed = results.filter((r) => !r.ok);
      if (failed.length) {
        notifyWarn(
          `数据已写入,但 ${failed.length} 个分类发布失败`,
          failed.map((f) => f.error).filter(Boolean).join('; ')
        );
      }
    }

    if (res.orphanPrints) {
      notifyWarn(
        `${res.orphanPrints} 个印刷版本因找不到父卡未写入`,
        '通常是父卡号归一化后与库中不一致,请检查卡号格式'
      );
    }
    notifyOk(`写入完成:${parts.join('、') || '无变更'}${publishTogether.value ? ',并已发布' : ''}`);
    await loadExistingRows(true);
    recomputeDiffs();
  } catch (e) {
    const msg = errorText(e);
    notifyError(
      `写入失败:${msg}`,
      /unique|on conflict/i.test(msg)
        ? '请先在 Supabase 执行 supabase/sync-constraints.sql 建立唯一约束'
        : undefined
    );
  } finally {
    applying.value = false;
    applyLabel.value = '';
  }
}

/* ══════════════════ 导出 ══════════════════ */

function stamp(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function exportSql(): void {
  const ds = dataset.value;
  if (!ds) return;
  const sql = buildSyncSql({
    cards: ds.cards,
    prints: ds.prints,
    icons: ds.icons,
    series: ds.seriesPresets,
    includeBanList: includeBanList.value
  });
  downloadText(`riftbound-sync-${stamp()}.sql`, sql, 'application/sql');
  notifyOk('已导出 SQL', includeBanList.value ? '⚠ 含 is_banned 覆盖' : '不含 is_banned');
}

function exportCsv(kind: 'cards' | 'prints' | 'icons'): void {
  const ds = dataset.value;
  if (!ds) return;
  if (kind === 'cards') {
    downloadText(
      `cards_base-${stamp()}.csv`,
      cardsBaseCsv(ds.cards, { includeBanList: includeBanList.value }),
      'text/csv'
    );
  } else if (kind === 'prints') {
    downloadText(`card_prints-${stamp()}.csv`, cardPrintsCsv(ds.prints), 'text/csv');
  } else {
    downloadText(`card_icons-${stamp()}.csv`, cardIconsCsv(ds.icons), 'text/csv');
  }
}

/* ══════════════════ 站点卡表快照(P5b) ══════════════════ */

const snapshotBusy = ref(false);
const snapshotLabel = ref('');
const snapshotResult = ref<{
  cards: number;
  prints: number;
  ok: boolean;
  problems: string[];
} | null>(null);

async function exportSnapshot(): Promise<void> {
  snapshotBusy.value = true;
  snapshotResult.value = null;
  snapshotLabel.value = '读取中…';
  try {
    const rows = await loadSnapshotRows((label, done, total) => {
      snapshotLabel.value = `${label} ${done}/${total}`;
    });
    snapshotLabel.value = '生成并自检…';
    const cardsCsv = cardsBaseSnapshotCsv(rows.cards);
    const printsCsv = cardPrintsSnapshotCsv(rows.prints);
    const check = checkSnapshot(cardsCsv, printsCsv);
    snapshotResult.value = {
      cards: check.cards,
      prints: check.prints,
      ok: check.ok,
      problems: check.problems
    };

    if (!check.ok) {
      notifyError('快照自检未通过,已阻止下载', check.problems.join('; '));
      return;
    }

    downloadText(SNAPSHOT_TARGET.cards.split('/').pop()!, cardsCsv, 'text/csv');
    downloadText(SNAPSHOT_TARGET.prints.split('/').pop()!, printsCsv, 'text/csv');
    notifyOk(
      `已导出站点卡表快照(${check.cards} 张卡 / ${check.prints} 个印刷版本)`,
      `覆盖到 ${SNAPSHOT_TARGET.cards} 与 ${SNAPSHOT_TARGET.prints} 即可`
    );
  } catch (e) {
    notifyError(`快照导出失败:${errorText(e)}`);
  } finally {
    snapshotBusy.value = false;
    snapshotLabel.value = '';
  }
}

/* ══════════════════ 启动 ══════════════════ */

const previewTab = ref<'cards' | 'prints' | 'icons'>('cards');

onMounted(async () => {
  if (configured.value) await loadExistingRows();
});
</script>

<template>
  <EditorialShell code="editorial-sync">
    <div class="max-w-[1500px] mx-auto">
      <!-- ══════════ 刊头 ══════════ -->
      <header class="mb-7">
        <div class="flex items-center justify-between gap-4 flex-wrap text-[11px] text-ink-faint">
          <button class="hover:text-brand transition-colors" @click="navigate({ view: 'editorial' })">
            ← 返回编辑部
          </button>
          <span class="font-latin tracking-[0.22em] uppercase">Editorial Desk</span>
        </div>
        <p class="eyebrow mt-7">编辑部 · 管道</p>
        <h1 class="font-display font-black text-ink leading-tight mt-3 text-[28px] lg:text-[38px]">
          数据同步
        </h1>
        <p class="standfirst mt-4 text-[15px]">
          从官方小程序后端拉取卡表,与库内逐字段比对后落地。只写接口拥有的列 ——
          人工维护的 keyword / advanced_tag / deck_limit / *_en / tts_cdn 永不被覆盖。
        </p>
        <div class="hairline mt-7"></div>
      </header>

      <!-- ══════════════════ 同步策略(常驻) ══════════════════ -->
      <!--
        这个开关必须**常驻可见**:它决定差异比对是否包含 is_banned 列,
        若藏在「应用」区里(仅拉取后出现),编务会先看到一份不含该列的差异,
        再回头找开关 —— 顺序反了,也容易被忽略。
      -->
        <label
          class="flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-colors mb-5"
          :class="includeBanList ? 'border-brand-faint bg-brand-soft/40' : 'border-card-border'"
        >
          <input v-model="includeBanList" type="checkbox" class="mt-0.5 accent-[var(--color-brand)]" />
          <span class="min-w-0">
            <span class="block text-[13px] text-ink font-semibold">
              用官方禁限表覆盖库内 is_banned(默认关闭)
            </span>
            <span class="block text-[11px] text-ink-faint mt-1 leading-relaxed">
              is_banned 属于人工维护列 —— 赛事环境会临时禁卡,官方接口未必同步。
              <b class="font-semibold text-ink-muted">默认不勾选</b>,编务手工调整的禁限状态不受影响;
              勾选后官方标记会覆盖它,且此开关同时决定差异预览是否比对这一列。
            </span>
          </span>
        </label>


      <!-- ══════════════════ 其一:拉取 ══════════════════ -->
      <section class="mb-10">
        <SectionHeading
          eyebrow="其一 · 拉取"
          title="数据源"
          note="公开只读接口,无需鉴权;接口有网关限流,已内置指数退避与本地缓存续跑"
        />

        <div class="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
          <input v-model="apiBase" :disabled="fetching" class="filter-select w-full font-mono disabled:opacity-50" />
          <button v-if="!fetching" class="btn-brand px-5 py-1.5 text-xs" @click="startFetch">
            开始拉取
          </button>
          <button v-else class="btn-ghost px-5 py-1.5 text-xs !text-brand !border-brand" @click="cancelFetch">
            取消
          </button>
        </div>

        <div class="flex items-center gap-4 flex-wrap mt-4">
          <div class="flex rounded-lg overflow-hidden border border-card-border">
            <button
              v-for="m in ([
                { id: 'fast', label: '快速模式' },
                { id: 'deep', label: '深度模式' }
              ] as const)"
              :key="m.id"
              class="px-3 py-1.5 text-xs transition-colors border-l border-card-border first:border-l-0"
              :class="mode === m.id ? 'tab-active' : 'text-ink-muted hover:text-brand'"
              :disabled="fetching"
              @click="mode = m.id"
            >
              {{ m.label }}
            </button>
          </div>
          <span class="text-[11px] text-ink-faint leading-relaxed max-w-[560px]">
            {{
              mode === 'fast'
                ? '仅 2–3 次列表请求,只对「库内没见过的系列前缀」少量补拉详情,最稳'
                : '逐卡拉详情(约 1200+ 次),字段最全但易触发网关限流,配合缓存续跑'
            }}
          </span>
        </div>

        <div class="flex items-center gap-3 flex-wrap mt-3 text-[11px] text-ink-faint">
          <span>详情缓存 {{ cacheSize }} 条(重跑将跳过已缓存部分)</span>
          <button v-if="cacheSize" class="text-brand hover:underline" @click="clearCache">清空缓存</button>
        </div>

        <div v-if="fetching" class="mt-5">
          <p class="text-[13px] text-ink-muted mb-2">{{ phaseLabel }}</p>
          <div class="h-3 rounded-full bg-panel-bg border border-card-border overflow-hidden">
            <div class="h-full bg-brand transition-all duration-200" :style="{ width: `${progressPercent}%` }"></div>
          </div>
          <p v-if="progressTotal" class="text-[11px] text-ink-faint mt-1.5 text-right tabular-nums">
            {{ progressDone }} / {{ progressTotal }}
          </p>
        </div>

        <p v-if="fetchError" class="mt-4 text-[13px] text-delta-down leading-relaxed pl-3 border-l-2 border-brand">
          {{ fetchError }}
        </p>

        <div v-if="dataset" class="flex items-center gap-2.5 flex-wrap mt-5">
          <span class="text-[11px] px-2 py-1 rounded border border-card-border text-ink-muted tabular-nums">
            卡牌 {{ dataset.cards.length }}
          </span>
          <span class="text-[11px] px-2 py-1 rounded border border-card-border text-ink-muted tabular-nums">
            印刷 {{ dataset.prints.length }}
          </span>
          <span class="text-[11px] px-2 py-1 rounded border border-card-border text-ink-muted tabular-nums">
            图标 {{ dataset.icons.length }}
          </span>
          <span v-if="dataset.stats.enriched" class="text-[11px] px-2 py-1 rounded border border-card-border text-ink-faint tabular-nums">
            详情补拉 {{ dataset.stats.enriched }}
          </span>
          <span v-if="dataset.stats.missingDetails" class="text-[11px] px-2 py-1 rounded border border-accent/40 text-accent tabular-nums">
            详情缺失 {{ dataset.stats.missingDetails }}
          </span>
        </div>

        <div v-if="dataset && dataset.seriesPresets.length" class="mt-4 pl-3 border-l-2 border-accent">
          <p class="text-[12px] text-ink-muted">
            检测到 {{ dataset.seriesPresets.length }} 个缺失系列(名称先占位,写入后请到资源页手改):
            <span class="font-mono">{{ dataset.seriesPresets.map((s) => s.code).join('、') }}</span>
          </p>
        </div>
      </section>

      <!-- ══════════════════ 其二:差异预览 ══════════════════ -->
      <section v-if="diffs" class="mb-10">
        <SectionHeading
          eyebrow="其二 · 比对"
          :title="`差异预览（待变更 ${totalChanges} 行）`"
          :note="
            `已按「接口拥有的列」比对库内 ${existing?.cards.length ?? 0} 张卡 / ` +
            `${existing?.prints.length ?? 0} 个 SC 印刷版本 / ${existing?.icons.length ?? 0} 个图标`
          "
        >
          <template #actions>
            <button class="btn-ghost px-3 py-1.5 text-xs" :disabled="existingLoading" @click="loadExistingRows(true)">
              {{ existingLoading ? '重读中…' : '重读库内现状' }}
            </button>
          </template>
        </SectionHeading>

        <div class="flex rounded-lg overflow-hidden border border-card-border w-fit mb-4">
          <button
            v-for="t in ([
              { id: 'cards', label: `卡牌 新增 ${cardsSummary.newCount} / 变更 ${cardsSummary.updateCount}` },
              { id: 'prints', label: `印刷 新增 ${printsSummary.newCount} / 变更 ${printsSummary.updateCount}` },
              { id: 'icons', label: `图标 新增 ${iconsSummary.newCount} / 变更 ${iconsSummary.updateCount}` }
            ] as const)"
            :key="t.id"
            class="px-3.5 py-2 text-[12px] transition-colors border-l border-card-border first:border-l-0"
            :class="previewTab === t.id ? 'tab-active' : 'text-ink-muted hover:text-brand'"
            @click="previewTab = t.id"
          >
            {{ t.label }}
          </button>
        </div>

        <div class="border border-card-border rounded-xl overflow-hidden">
          <div class="max-h-[380px] overflow-y-auto">
            <table class="w-full text-sm">
              <thead class="sticky-thead text-[11px] text-ink-faint">
                <tr class="border-b border-card-border">
                  <th class="text-left font-normal px-3 py-2 w-[80px]">状态</th>
                  <th class="text-left font-normal px-3 py-2 w-[150px]">键</th>
                  <th class="text-left font-normal px-3 py-2">变更内容</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="d in (previewTab === 'cards' ? changedCards : previewTab === 'prints' ? changedPrints : changedIcons).slice(0, 200)"
                  :key="d.key"
                  class="table-row border-b border-panel-border/30 last:border-0"
                >
                  <td class="px-3 py-1.5">
                    <span
                      class="text-[10px] px-1.5 py-0.5 rounded border"
                      :class="d.kind === 'new' ? 'text-delta-up border-delta-up/40' : 'text-accent border-accent/40'"
                    >
                      {{ d.kind === 'new' ? '新增' : '变更' }}
                    </span>
                  </td>
                  <td class="px-3 py-1.5 font-mono text-[12px] text-ink-muted">{{ d.key }}</td>
                  <td class="px-3 py-1.5 text-[12px] text-ink-faint">{{ truncate(changeText(d), 160) }}</td>
                </tr>
                <tr
                  v-if="!(previewTab === 'cards' ? changedCards : previewTab === 'prints' ? changedPrints : changedIcons).length"
                >
                  <td colspan="3" class="px-3 py-8 text-center text-xs text-ink-faint">无差异</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <p
          v-if="(previewTab === 'cards' ? changedCards : previewTab === 'prints' ? changedPrints : changedIcons).length > 200"
          class="text-[11px] text-ink-faint mt-2"
        >
          仅预览前 200 行,实际写入按全部
          {{ (previewTab === 'cards' ? changedCards : previewTab === 'prints' ? changedPrints : changedIcons).length }} 行处理
        </p>
      </section>

      <!-- ══════════════════ 其三:应用 ══════════════════ -->
      <section v-if="diffs" class="mb-10">
        <SectionHeading
          eyebrow="其三 · 落地"
          title="应用"
          note="直接写入前请先执行 supabase/sync-constraints.sql;或导出后在 SQL Editor 里自行执行"
        />

        <div class="flex items-center gap-3 flex-wrap">
          <label class="flex items-center gap-2 text-[12px] text-ink-muted">
            <input v-model="publishTogether" type="checkbox" class="accent-[var(--color-brand)]" />
            写入后同时发布(触碰 cards / prints / icons)
          </label>
        </div>

        <div class="flex items-center gap-3 flex-wrap mt-5">
          <button class="btn-brand px-4 py-2 text-xs" :disabled="applying || !totalChanges" @click="applyDirect">
            {{ applying ? '写入中…' : `直接写入(${totalChanges} 行)` }}
          </button>
          <button class="btn-ghost px-4 py-2 text-xs" :disabled="applying" @click="exportSql">导出 SQL</button>
          <button class="btn-ghost px-4 py-2 text-xs" :disabled="applying" @click="exportCsv('cards')">
            cards_base.csv
          </button>
          <button class="btn-ghost px-4 py-2 text-xs" :disabled="applying" @click="exportCsv('prints')">
            card_prints.csv
          </button>
          <button class="btn-ghost px-4 py-2 text-xs" :disabled="applying" @click="exportCsv('icons')">
            card_icons.csv
          </button>
          <span v-if="applyLabel" class="text-[11px] text-ink-faint tabular-nums">{{ applyLabel }}</span>
        </div>
      </section>

      <!-- ══════════════════ 其四:站点卡表快照 ══════════════════ -->
      <section>
        <SectionHeading
          eyebrow="其四 · 闭环"
          title="导出站点卡表快照"
          note="直接产出周报站预加载用的两份 CSV —— 从此不必再手工从 Supabase 导出再提交"
        />

        <div class="card p-5">
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-3 text-[12px]">
            <div>
              <span class="text-[10px] tracking-[0.14em] text-ink-faint">卡牌主数据</span>
              <p class="font-mono text-ink-muted mt-1">{{ SNAPSHOT_TARGET.cards }}</p>
            </div>
            <div>
              <span class="text-[10px] tracking-[0.14em] text-ink-faint">印刷版本</span>
              <p class="font-mono text-ink-muted mt-1">{{ SNAPSHOT_TARGET.prints }}</p>
            </div>
            <div>
              <span class="text-[10px] tracking-[0.14em] text-ink-faint">格式约定</span>
              <p class="text-ink-muted mt-1 leading-relaxed">
                数组列 JSON 编码 · 无 BOM · LF 换行
              </p>
            </div>
          </div>

          <div class="flex items-center gap-3 flex-wrap mt-5">
            <button class="btn-brand px-4 py-2 text-xs" :disabled="snapshotBusy" @click="exportSnapshot">
              {{ snapshotBusy ? '导出中…' : '导出快照' }}
            </button>
            <span v-if="snapshotLabel" class="text-[11px] text-ink-faint">{{ snapshotLabel }}</span>
          </div>

          <div v-if="snapshotResult" class="mt-4 pl-3 border-l-2" :class="snapshotResult.ok ? 'border-delta-up' : 'border-brand'">
            <p class="text-[12px]" :class="snapshotResult.ok ? 'text-ink-muted' : 'text-delta-down'">
              自检{{ snapshotResult.ok ? '通过' : '未通过' }} ·
              {{ snapshotResult.cards }} 张卡 / {{ snapshotResult.prints }} 个印刷版本
            </p>
            <ul v-if="snapshotResult.problems.length" class="mt-2 space-y-1">
              <li v-for="p in snapshotResult.problems" :key="p" class="text-[11px] text-delta-down">· {{ p }}</li>
            </ul>
          </div>

          <p class="mt-5 text-[11px] text-ink-faint leading-relaxed max-w-[820px]">
            口径:快照是<b class="font-semibold text-ink-muted">整库导出</b>,列序与仓库现有文件逐字一致,并在下载前用与站点相同的
            JSON.parse 逐行自检 —— 格式若有偏差会直接拦截下载,因为这类错误在站点侧是静默失效
            (颜色丢失、卡图关联落空),不会报错。下载后覆盖到上表路径即可。
          </p>
        </div>
      </section>
    </div>
  </EditorialShell>
</template>
