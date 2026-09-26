<script setup lang="ts">
/** 官网卡表同步面板：选择语言与系列，拉取 playriftbound.com 官方数据并逐条审核。 */
import { computed, onMounted, reactive, ref, watch } from 'vue';
import SectionHeading from '../SectionHeading.vue';
import GalleryReview from './GalleryReview.vue';
import { errorText, notifyError, notifyOk, notifyWarn } from '@/tools/admin/notice';
import { isSupabaseConfigured } from '@/tools/sources/config';
import type { ExistingSnapshot } from '@/tools/admin/sync';
import {
  GALLERY_LOCALE_OPTIONS,
  fetchGallerySets,
  galleryLocaleOption,
  type GalleryLocale,
  type RetryInfo
} from '@/tools/sync/galleryApi';
import { fetchGalleryDataset, type GalleryDataset, type GallerySeriesOption } from '@/tools/sync/galleryRun';

const props = defineProps<{
  existing: ExistingSnapshot | null;
  existingLoading: boolean;
  configured: boolean;
}>();
const emit = defineEmits<{ reload: []; busy: [value: boolean] }>();

const locale = ref<GalleryLocale>('en_US');
const option = computed(() => galleryLocaleOption(locale.value));
const seriesOptions = ref<GallerySeriesOption[]>([]);
const seriesIds = ref<string[]>([]);
const seriesLoading = ref(false);
const seriesError = ref('');

const fetching = ref(false);
const fetchError = ref('');
const dataset = ref<GalleryDataset | null>(null);
const confirmDiscard = ref(false);
const reviewBusy = ref(false);
const controller = ref<AbortController | null>(null);
const review = ref<{ hasUnsavedReview: () => boolean } | null>(null);

const progress = reactive<{ label: string; done: number; total: number; retry: RetryInfo | null }>({
  label: '',
  done: 0,
  total: 0,
  retry: null
});

const busyAll = computed(() => fetching.value || reviewBusy.value);
watch(busyAll, (value) => emit('busy', value), { immediate: true });

const allSeriesSelected = computed(() => !seriesIds.value.length);
const selectedSeriesLabel = computed(() => {
  if (allSeriesSelected.value) return '全部系列';
  return seriesOptions.value
    .filter((s) => seriesIds.value.includes(s.id))
    .map((s) => `${s.id} ${s.name}`)
    .join('、');
});

function toggleAllSeries(): void {
  seriesIds.value = [];
}

function toggleSeries(id: string, checked: boolean): void {
  const set = new Set(seriesIds.value);
  if (checked) set.add(id);
  else set.delete(id);
  seriesIds.value = [...set];
}

async function loadSeries(): Promise<void> {
  seriesLoading.value = true;
  seriesError.value = '';
  try {
    const sets = await fetchGallerySets(locale.value);
    seriesOptions.value = sets.map((s) => ({ id: s.id, name: s.name, collectorNumberMax: s.collectorNumberMax }));
    const valid = new Set(sets.map((s) => s.id));
    seriesIds.value = seriesIds.value.filter((id) => valid.has(id));
  } catch (e) {
    seriesError.value = errorText(e);
  } finally {
    seriesLoading.value = false;
  }
}

watch(locale, () => {
  dataset.value = null;
  fetchError.value = '';
  confirmDiscard.value = false;
  void loadSeries();
});

function percent(): number {
  return progress.total ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function requestFetch(): void {
  if (busyAll.value || !props.configured) return;
  if (review.value?.hasUnsavedReview()) {
    confirmDiscard.value = true;
    return;
  }
  void startFetch();
}

async function startFetch(): Promise<void> {
  if (busyAll.value || !props.configured) return;
  confirmDiscard.value = false;
  fetchError.value = '';
  dataset.value = null;
  fetching.value = true;
  controller.value = new AbortController();
  progress.label = '准备中…';
  progress.done = 0;
  progress.total = 0;
  progress.retry = null;
  try {
    const ds = await fetchGalleryDataset({
      locale: locale.value,
      seriesIds: seriesIds.value,
      signal: controller.value.signal,
      onProgress: (p) => {
        progress.label = p.label;
        progress.done = p.done;
        progress.total = p.total;
        progress.retry = p.retry;
      },
      onRetry: (info) => {
        progress.retry = info;
      }
    });
    dataset.value = ds;
    notifyOk(
      `官网卡表拉取完成：${ds.stats.bases} 张基础卡 · ${ds.stats.prints} 个印刷版本`,
      ds.stats.untranslated ? `${ds.stats.untranslated} 条官网未翻译，已跳过文本写入` : undefined
    );
  } catch (e) {
    if (isAbortError(e)) notifyWarn('已取消官网卡表拉取');
    else {
      fetchError.value = errorText(e);
      notifyError(`官网卡表拉取失败：${fetchError.value}`);
    }
  } finally {
    fetching.value = false;
    controller.value = null;
  }
}

function cancelFetch(): void {
  controller.value?.abort();
}

onMounted(() => {
  if (isSupabaseConfigured()) void loadSeries();
});
</script>

<template>
  <section class="mb-10">
    <SectionHeading
      plain
      title="官网卡表（playriftbound.com）"
      note="直接读取 Riot 官网卡表：英文 / 简体中文 / 韩文 / 繁中可写库，其余语区只能预览"
    />

    <div class="card p-4 sm:p-5">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label class="block">
          <span class="text-sm font-semibold block mb-2">拉取语言</span>
          <select v-model="locale" class="filter-select w-full" :disabled="busyAll">
            <option v-for="o in GALLERY_LOCALE_OPTIONS" :key="o.id" :value="o.id">{{ o.label }}</option>
          </select>
        </label>
        <div>
          <span class="text-sm font-semibold block mb-2">系列（可多选）</span>
          <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
            <label class="flex items-center gap-1.5">
              <input type="checkbox" :checked="allSeriesSelected" :disabled="busyAll" @change="toggleAllSeries" />
              全部
            </label>
            <label v-for="s in seriesOptions" :key="s.id" class="flex items-center gap-1.5">
              <input type="checkbox" :checked="seriesIds.includes(s.id)" :disabled="busyAll" @change="toggleSeries(s.id, ($event.target as HTMLInputElement).checked)" />
              {{ s.id }} · {{ s.name }}
            </label>
            <span v-if="seriesLoading" class="text-ink-faint">读取系列…</span>
          </div>
          <p v-if="seriesError" class="text-[11px] text-accent mt-1">系列列表读取失败：{{ seriesError }}</p>
        </div>
      </div>

      <div class="flex items-center gap-3 flex-wrap mt-4">
        <button v-if="!fetching" class="btn-brand px-5 py-1.5 text-xs" :disabled="busyAll || !configured || existingLoading || !existing" @click="requestFetch">
          开始拉取
        </button>
        <button v-else class="btn-ghost px-5 py-1.5 text-xs !text-brand !border-brand" @click="cancelFetch">取消</button>
        <span class="text-[11px] text-ink-faint">当前：{{ option.label }} · {{ selectedSeriesLabel }}</span>
        <span v-if="!configured" class="text-[11px] text-accent">未配置 Supabase，无法审核写入</span>
        <span v-else-if="!existing" class="text-[11px] text-ink-faint">等待库内现状读取完成…</span>
      </div>

      <p v-if="option.writable === false" class="mt-3 text-[11px] text-accent leading-relaxed">
        该语区没有卡牌级本地化（卡名/效果/卡图为英文回退），只支持拉取预览，不写库。
      </p>
      <p v-if="existing && !existing.localizedColumnsReady && (option.target === 'kr' || option.target === 'tw')" class="mt-3 text-[11px] text-accent leading-relaxed">
        库内还没有韩/繁中列（card_name_kr / effect_kr / card_name_tw / effect_tw 等），
        请先在 Supabase 执行迁移 SQL；在此之前韩/繁中文本不会提交，卡图印刷仍可同步。
      </p>

      <div v-if="confirmDiscard" role="alert" class="mt-3 rounded-lg border border-accent/40 bg-panel-bg p-3 flex items-center justify-between gap-4 flex-wrap">
        <p class="text-xs text-ink-muted">重新拉取会清空当前未提交的官网审核结果。</p>
        <div class="flex items-center gap-3">
          <button class="text-xs text-ink-faint hover:text-ink-muted" @click="confirmDiscard = false">取消</button>
          <button class="btn-brand px-3 py-1.5 text-xs" @click="startFetch">确认清空并拉取</button>
        </div>
      </div>

      <div v-if="fetching" class="mt-4">
        <div
          class="h-2 rounded-full bg-panel-bg border border-card-border overflow-hidden"
          role="progressbar"
          aria-label="官网卡表拉取进度"
          :aria-valuemin="0"
          :aria-valuemax="100"
          :aria-valuenow="progress.total ? percent() : undefined"
        >
          <div v-if="progress.total" class="h-full bg-brand transition-all duration-200" :style="{ width: `${percent()}%` }"></div>
          <div v-else class="h-full w-2/5 bg-brand animate-indeterminate motion-reduce:animate-none"></div>
        </div>
        <p class="text-[11px] text-ink-faint mt-1.5 tabular-nums" aria-live="polite">
          {{ progress.label }}
          <span v-if="progress.total"> · {{ progress.done }} / {{ progress.total }}</span>
        </p>
        <p v-if="progress.retry" class="text-[11px] text-accent mt-1" role="status">
          接口抖动，重试 {{ progress.retry.attempt }} / {{ progress.retry.maxAttempts }}…
        </p>
      </div>

      <p v-if="fetchError" class="mt-4 text-[13px] text-delta-down leading-relaxed pl-3 border-l-2 border-brand">
        {{ fetchError }}
      </p>

      <div v-if="dataset" class="flex items-center gap-2.5 flex-wrap mt-5">
        <span class="text-[11px] px-2 py-1 rounded border border-card-border text-ink-muted tabular-nums">
          官网卡 {{ dataset.stats.cards }}
        </span>
        <span class="text-[11px] px-2 py-1 rounded border border-card-border text-ink-muted tabular-nums">
          基础卡草稿 {{ dataset.stats.bases }}
        </span>
        <span class="text-[11px] px-2 py-1 rounded border border-card-border text-ink-muted tabular-nums">
          印刷草稿 {{ dataset.stats.prints }}
        </span>
        <span v-if="dataset.stats.untranslated" class="text-[11px] px-2 py-1 rounded border border-accent/40 text-accent tabular-nums">
          未翻译 {{ dataset.stats.untranslated }}
        </span>
        <span v-if="dataset.stats.skippedImages" class="text-[11px] px-2 py-1 rounded border border-card-border text-ink-faint tabular-nums">
          沿用英文卡图 {{ dataset.stats.skippedImages }}
        </span>
      </div>
    </div>

    <GalleryReview
      v-if="dataset && existing"
      ref="review"
      :dataset="dataset"
      :existing="existing"
      :loading="existingLoading"
      :localized-columns-ready="existing.localizedColumnsReady"
      @reload="emit('reload')"
      @busy="reviewBusy = $event"
    />
  </section>
</template>
