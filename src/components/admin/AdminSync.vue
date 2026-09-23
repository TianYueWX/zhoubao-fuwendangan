<script setup lang="ts">
/** Official API fetch, reviewed sync editor, and site snapshot export. */
import { computed, onMounted, reactive, ref } from 'vue';
import SyncReview from './SyncReview.vue';
import AdminQaSync from './AdminQaSync.vue';
import { identity } from '@/tools/sync/review';
import EditorialShell from './EditorialShell.vue';
import SectionHeading from '../SectionHeading.vue';
import { errorText, notifyError, notifyOk, notifyWarn } from '@/tools/admin/notice';
import { loadExisting, loadSnapshotRows, type ExistingSnapshot } from '@/tools/admin/sync';
import { isSupabaseConfigured } from '@/tools/sources/config';
import { RIFTBOUND_API_BASE, type ApiCardDetail } from '@/tools/sync/riftboundApi';
import { fetchDataset, type SyncDataset, type SyncPhase } from '@/tools/sync/run';
import { cacheCount, clearDetailCache, loadDetailCache } from '@/tools/sync/cache';
import { downloadText } from '@/tools/sync/exporters';
import {
  SNAPSHOT_TARGET,
  cardPrintsSnapshotCsv,
  cardsBaseSnapshotCsv,
  checkSnapshot
} from '@/tools/sync/snapshot';

const configured = computed(() => isSupabaseConfigured());

/* ══════════════════ 拉取 ══════════════════ */

const apiBase = ref(RIFTBOUND_API_BASE);
const mode = ref<'fast' | 'deep'>('fast');
const pullCards = ref(false);
const pullQa = ref(false);
const fetching = ref(false);
const phase = ref<SyncPhase>('idle');
const phaseLabel = ref('');
const progressDone = ref(0);
const progressTotal = ref(0);
const fetchError = ref('');
const dataset = ref<SyncDataset | null>(null);
const confirmDiscard = ref(false);
const incomingIdentityCount = computed(() => new Set((dataset.value?.cards ?? []).map(c => identity(c.card_name_cn, c.sub_title_cn))).size);
let controller: AbortController | null = null;
const qaBusy = ref(false);
const syncReview = ref<{ hasUnsavedReview: () => boolean } | null>(null);
const qaSync = ref<{
  runFetch: (options: {
    signal: AbortSignal;
    fetchedCards?: ReadonlyMap<string, string>;
    onProgress?: (label: string) => void;
  }) => Promise<{ total: number; newCount: number; updateCount: number; sameCount: number }>;
  reset: () => void;
  hasUnsavedReview: () => boolean;
} | null>(null);

type PullTask = 'cards' | 'qa';
type PullStatus = 'idle' | 'queued' | 'running' | 'success' | 'error' | 'cancelled';
const taskState = reactive<Record<PullTask, { status: PullStatus; detail: string }>>({
  cards: { status: 'idle', detail: '' },
  qa: { status: 'idle', detail: '' }
});
const hasSelection = computed(() => pullCards.value || pullQa.value);
const statusLabel: Record<PullStatus, string> = {
  idle: '尚未运行', queued: '等待中', running: '拉取中', success: '已完成', error: '失败', cancelled: '已取消'
};

const detailCache: Record<string, ApiCardDetail> = loadDetailCache();
const cacheSize = ref(cacheCount(detailCache));

const progressPercent = computed(() => {
  if (!progressTotal.value) return fetching.value ? 30 : 0;
  return Math.min(100, Math.round((progressDone.value / progressTotal.value) * 100));
});

/* ══════════════════ 差异 ══════════════════ */

const existing = ref<ExistingSnapshot | null>(null);
const existingLoading = ref(false);

const reviewBusy = ref(false);
async function loadExistingRows(force = false): Promise<boolean> {
  if (existing.value && !force) return true;
  existingLoading.value = true;
  try {
    existing.value = await loadExisting();
    return true;
  } catch (e) {
    notifyError(`读取库内现状失败:${errorText(e)}`);
    return false;
  } finally {
    existingLoading.value = false;
  }
}

/* ══════════════════ 拉取动作 ══════════════════ */

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function resetRunState(): void {
  dataset.value = null;
  qaSync.value?.reset();
  fetchError.value = '';
  phase.value = 'idle';
  phaseLabel.value = '';
  progressDone.value = 0;
  progressTotal.value = 0;
  taskState.cards = { status: pullCards.value ? 'queued' : 'idle', detail: '' };
  taskState.qa = { status: pullQa.value ? 'queued' : 'idle', detail: '' };
  clearCache(false);
}

async function runCardFetch(signal: AbortSignal): Promise<SyncDataset> {
  const loaded = await loadExistingRows(true);
  if (!loaded || !existing.value) throw new Error('请先成功读取库内现状，再拉取并比对');
  return fetchDataset({
    baseUrl: apiBase.value,
    mode: mode.value,
    existingSeriesCodes: existing.value.seriesCodes,
    seriesByPrefix: existing.value.seriesByPrefix,
    existingCardKeys: existing.value.cards.map(c => identity(c.card_name_cn, c.sub_title_cn)),
    detailCache,
    signal,
    onProgress: (p) => {
      phase.value = p.phase;
      phaseLabel.value = p.label;
      progressDone.value = p.done;
      progressTotal.value = p.total;
      taskState.cards.detail = p.label;
    }
  });
}

function requestFetch(): void {
  if (fetching.value || reviewBusy.value || qaBusy.value || !hasSelection.value) return;
  const hasOldReview = Boolean(syncReview.value?.hasUnsavedReview()) || Boolean(qaSync.value?.hasUnsavedReview());
  if (hasOldReview) {
    confirmDiscard.value = true;
    return;
  }
  void startFetch();
}

async function startFetch(): Promise<void> {
  if (fetching.value || reviewBusy.value || qaBusy.value || !hasSelection.value) return;
  confirmDiscard.value = false;
  resetRunState();
  fetching.value = true;
  controller = new AbortController();
  const signal = controller.signal;
  let fetchedCards = new Map<string, string>();

  try {
    if (pullCards.value) {
      taskState.cards = { status: 'running', detail: '准备读取卡牌数据' };
      try {
        const ds = await runCardFetch(signal);
        dataset.value = ds;
        fetchedCards = new Map(ds.cards.map((card) => [card.card_no, card.card_name_cn ?? card.card_no]));
        taskState.cards = {
          status: 'success',
          detail: `${incomingIdentityCount.value} 个基础卡身份 · ${ds.prints.length} 个印刷版本 · ${ds.icons.length} 个图标`
        };
      } catch (e) {
        if (isAbortError(e)) throw e;
        fetchError.value = errorText(e);
        taskState.cards = { status: 'error', detail: fetchError.value };
        notifyError(`卡牌与关键词图标拉取失败:${fetchError.value}`, pullQa.value ? '将继续拉取 QA' : undefined);
      }
    }

    if (pullQa.value) {
      if (signal.aborted) throw new DOMException('已取消', 'AbortError');
      taskState.qa = { status: 'running', detail: '准备读取 QA' };
      try {
        if (!qaSync.value) throw new Error('QA 审核组件尚未就绪');
        const result = await qaSync.value.runFetch({
          signal,
          fetchedCards,
          onProgress: (label) => { taskState.qa.detail = label; }
        });
        taskState.qa = {
          status: 'success',
          detail: `${result.total} 条 · 新增 ${result.newCount} · 更新 ${result.updateCount} · 无变更 ${result.sameCount}`
        };
      } catch (e) {
        if (isAbortError(e)) throw e;
        const message = errorText(e);
        taskState.qa = { status: 'error', detail: message };
        notifyError(`QA 拉取失败:${message}`);
      }
    }

    const successes = [taskState.cards, taskState.qa].filter((task) => task.status === 'success').length;
    const failures = [taskState.cards, taskState.qa].filter((task) => task.status === 'error').length;
    if (successes) notifyOk(`本轮拉取完成:${successes} 项成功${failures ? `，${failures} 项失败` : ''}`);
  } catch (e) {
    if (isAbortError(e)) {
      for (const key of ['cards', 'qa'] as const) {
        if (taskState[key].status === 'running' || taskState[key].status === 'queued') {
          taskState[key] = { status: 'cancelled', detail: '用户取消了整轮拉取' };
        }
      }
      phase.value = 'idle';
      notifyWarn('已取消整轮拉取');
    } else {
      notifyError(`拉取失败:${errorText(e)}`);
    }
  } finally {
    fetching.value = false;
    controller = null;
    cacheSize.value = cacheCount(detailCache);
  }
}

function cancelFetch(): void {
  controller?.abort();
}

function clearCache(notify = true): void {
  clearDetailCache();
  for (const k of Object.keys(detailCache)) delete detailCache[k];
  cacheSize.value = 0;
  if (notify) notifyOk('已清空详情缓存');
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


onMounted(async () => {
  if (configured.value) await loadExistingRows();
});
</script>

<template>
  <EditorialShell code="editorial-sync">
    <div class="max-w-[1500px] mx-auto">
      <!-- ══════════ 刊头 ══════════ -->
      <header class="mb-7">
        <h1 class="font-display font-black text-ink leading-tight text-[28px] lg:text-[38px]">
          数据同步
        </h1>
        <div class="hairline mt-7"></div>
      </header>

      <!-- ══════════════════ 其一:拉取 ══════════════════ -->
      <section class="mb-10">
        <SectionHeading
          plain
          title="数据源"
          note="先选择本轮要拉取的内容；同时选择时会按卡牌与图标 → QA 串行执行"
        />

        <div class="card p-4 sm:p-5">
          <p class="text-sm font-semibold">选择拉取内容</p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
            <label class="flex items-start gap-3 p-3 rounded-lg border border-card-border cursor-pointer" :class="pullCards ? 'bg-panel-bg' : ''">
              <input v-model="pullCards" type="checkbox" class="mt-0.5" :disabled="fetching" />
              <span><b class="block text-sm">卡牌与关键词图标</b><span class="block text-[11px] text-ink-faint mt-1">包含基础卡、印刷版本、缺失系列与图标</span></span>
            </label>
            <label class="flex items-start gap-3 p-3 rounded-lg border border-card-border cursor-pointer" :class="pullQa ? 'bg-panel-bg' : ''">
              <input v-model="pullQa" type="checkbox" class="mt-0.5" :disabled="fetching" />
              <span><b class="block text-sm">QA</b><span class="block text-[11px] text-ink-faint mt-1">拉取卡牌常见问答，并保留本轮新卡的关联</span></span>
            </label>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 mt-4">
          <input v-model="apiBase" :disabled="fetching" aria-label="官方 API 地址" class="filter-select w-full font-mono disabled:opacity-50" />
          <button v-if="!fetching" class="btn-brand px-5 py-1.5 text-xs" :disabled="!hasSelection || !configured || reviewBusy || qaBusy || existingLoading" @click="requestFetch">
            开始拉取
          </button>
          <button v-else class="btn-ghost px-5 py-1.5 text-xs !text-brand !border-brand" @click="cancelFetch">
            取消
          </button>
        </div>

        <div v-if="confirmDiscard" role="alert" class="mt-3 rounded-lg border border-accent/40 bg-panel-bg p-3 flex items-center justify-between gap-4 flex-wrap">
          <p class="text-xs text-ink-muted">开始新一轮会清空当前未提交的卡牌与 QA 审核结果，并清理详情缓存。</p>
          <div class="flex items-center gap-3">
            <button class="text-xs text-ink-faint hover:text-ink-muted" @click="confirmDiscard = false">取消</button>
            <button class="btn-brand px-3 py-1.5 text-xs" @click="startFetch">确认清空并拉取</button>
          </div>
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
              :disabled="fetching || !pullCards"
              @click="mode = m.id"
            >
              {{ m.label }}
            </button>
          </div>
          <span class="text-[11px] text-ink-faint leading-relaxed max-w-[560px]">
            {{
              mode === 'fast'
                ? '分页拉取列表，并补拉新基础卡、勘误卡和未知系列的详情'
                : '逐卡拉详情(约 1200+ 次)，单并发、每次随机间隔 0.5–1.2 秒，每轮从头拉取'
            }}
          </span>
          <span v-if="!pullCards" class="text-[11px] text-ink-faint">模式仅适用于「卡牌与关键词图标」。</span>
        </div>

        <div class="flex items-center gap-3 flex-wrap mt-3 text-[11px] text-ink-faint">
          <span>详情缓存 {{ cacheSize }} 条（开始新一轮时会自动清空）</span>
          <button v-if="cacheSize" class="text-brand hover:underline" @click="clearCache()">清空缓存</button>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-5">
          <div v-for="item in ([{ key: 'cards', label: '卡牌与关键词图标' }, { key: 'qa', label: 'QA' }] as const)" :key="item.key" class="rounded-lg border border-card-border p-3">
            <div class="flex items-center justify-between gap-3">
              <span class="text-xs font-semibold">{{ item.label }}</span>
              <span class="text-[11px]" :class="taskState[item.key].status === 'error' ? 'text-delta-down' : taskState[item.key].status === 'success' ? 'text-delta-up' : 'text-ink-faint'">
                {{ statusLabel[taskState[item.key].status] }}
              </span>
            </div>
            <p v-if="taskState[item.key].detail" class="text-[11px] text-ink-faint mt-1.5 leading-relaxed">{{ taskState[item.key].detail }}</p>
          </div>
        </div>

        <div v-if="fetching && taskState.cards.status === 'running'" class="mt-5">
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
            基础卡身份 {{ incomingIdentityCount }}
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

      <SyncReview v-if="dataset && existing" ref="syncReview" :dataset="dataset" :existing="existing" :loading="existingLoading"
        @reload="loadExistingRows(true)" @busy="reviewBusy = $event" />

      <AdminQaSync ref="qaSync" :api-base="apiBase" @busy="qaBusy = $event" />

      <!-- 站点卡表快照 -->
      <section>
        <SectionHeading
          plain
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
