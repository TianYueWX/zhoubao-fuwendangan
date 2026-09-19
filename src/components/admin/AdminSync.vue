<script setup lang="ts">
/** Official API fetch, reviewed sync editor, and site snapshot export. */
import { computed, onMounted, ref } from 'vue';
import SyncReview from './SyncReview.vue';
import { identity } from '@/tools/sync/review';
import EditorialShell from './EditorialShell.vue';
import SectionHeading from '../SectionHeading.vue';
import { navigate } from '@/router/hash';
import { errorText, notifyError, notifyOk, notifyWarn } from '@/tools/admin/notice';
import { loadExisting, loadSnapshotRows, type ExistingSnapshot } from '@/tools/admin/sync';
import { isSupabaseConfigured } from '@/tools/sources/config';
import { RIFTBOUND_API_BASE, type ApiCardDetail } from '@/tools/sync/riftboundApi';
import { fetchDataset, type SyncDataset, type SyncPhase } from '@/tools/sync/run';
import { cacheCount, clearDetailCache, loadDetailCache, saveDetailCache } from '@/tools/sync/cache';
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
const fetching = ref(false);
const phase = ref<SyncPhase>('idle');
const phaseLabel = ref('');
const progressDone = ref(0);
const progressTotal = ref(0);
const fetchError = ref('');
const dataset = ref<SyncDataset | null>(null);
const incomingIdentityCount = computed(() => new Set((dataset.value?.cards ?? []).map(c => identity(c.card_name_cn, c.sub_title_cn))).size);
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

async function startFetch(): Promise<void> {
  if (fetching.value || reviewBusy.value) return;
  fetching.value = true;
  fetchError.value = '';
  dataset.value = null;
  controller = new AbortController();
  try {
    const loaded = await loadExistingRows(true);
    if (!loaded || !existing.value) throw new Error('请先成功读取库内现状，再拉取并比对');
    const ds = await fetchDataset({
      baseUrl: apiBase.value,
      mode: mode.value,
      existingSeriesCodes: existing.value?.seriesCodes ?? [],
      seriesByPrefix: existing.value?.seriesByPrefix ?? {},
      existingCardKeys: existing.value.cards.map(c => identity(c.card_name_cn, c.sub_title_cn)),
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
      `拉取完成:${incomingIdentityCount.value} 个基础卡身份、${ds.prints.length} 个印刷版本、${ds.icons.length} 个图标`,
      ds.stats.enriched ? `其中补拉详情 ${ds.stats.enriched} 张` : undefined
    );
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
          从官方接口拉取印刷版本，按名字和副标题关联基础卡。逐条编辑并勾选更新字段，基础卡仅同步勘误效果。
        </p>
        <div class="hairline mt-7"></div>
      </header>

      <!-- ══════════════════ 其一:拉取 ══════════════════ -->
      <section class="mb-10">
        <SectionHeading
          eyebrow="其一 · 拉取"
          title="数据源"
          note="公开只读接口,无需鉴权;接口有网关限流,已内置指数退避与本地缓存续跑"
        />

        <div class="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
          <input v-model="apiBase" :disabled="fetching" class="filter-select w-full font-mono disabled:opacity-50" />
          <button v-if="!fetching" class="btn-brand px-5 py-1.5 text-xs" :disabled="reviewBusy || existingLoading" @click="startFetch">
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
                ? '分页拉取列表，并补拉新基础卡、勘误卡和未知系列的详情'
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

      <SyncReview v-if="dataset && existing" :dataset="dataset" :existing="existing" :loading="existingLoading"
        @reload="loadExistingRows(true)" @busy="reviewBusy = $event" />

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
