<script setup lang="ts">
/**
 * PresetLoader.vue · 内置预设数据包(v3 新增)
 *  - 读取 public/data/manifest.json,一键加载官方预设包(5 槽位全填)
 *  - 进度展示;file:// 环境 fetch 失败时提示改用上传
 */
import { onMounted, ref } from 'vue';
import { store, loadSlotFile, runStoredAnalysis, SLOT_KINDS } from '@/store/analysis';
import { loadPresetManifest, fetchPresetFiles, type PresetProgress } from '@/utils/preset';
import { parseCSVText } from '@/utils/dataParser';
import SectionHeading from '@/components/SectionHeading.vue';
import type { PresetManifest, PresetPackageMeta } from '@/types';

const manifest = ref<PresetManifest | null>(null);
const fetchFailed = ref(false);
const loadingId = ref<string | null>(null);
const progress = ref<PresetProgress | null>(null);
const error = ref('');

onMounted(async () => {
  const m = await loadPresetManifest();
  manifest.value = m;
  fetchFailed.value = m === null;
});

const isLoaded = (pkg: PresetPackageMeta): boolean =>
  store.isReady &&
  pkg.files.every((f) => {
    const idx = SLOT_KINDS.indexOf(f.slot);
    return idx >= 0 && idx < 3 ? store.slots[idx]?.rows !== null : true;
  });

async function loadPreset(pkg: PresetPackageMeta): Promise<void> {
  if (loadingId.value) return;
  loadingId.value = pkg.id;
  error.value = '';
  progress.value = null;
  try {
    const files = await fetchPresetFiles(pkg, (p) => (progress.value = p));
    for (const f of files) {
      const idx = SLOT_KINDS.indexOf(f.slot);
      if (idx < 0) continue;
      if (f.slot === 'rank' || f.slot === 'shop') {
        loadSlotFile(idx, JSON.parse(f.text) as never, f.fileName, true);
      } else {
        loadSlotFile(idx, parseCSVText<Record<string, string | null>>(f.text), f.fileName, true);
      }
    }
    if (runStoredAnalysis()) {
      store.sourceLabel = pkg.label;
      store.currentView = 'overview';
    } else {
      error.value = '预设数据已填充,但启动分析失败,请检查文件完整性';
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loadingId.value = null;
    progress.value = null;
  }
}
</script>

<template>
  <section class="panel rounded-2xl p-6">
    <SectionHeading title="内置预设数据包" note="免上传,一键加载随站点发布的全量数据包(5 个槽位自动填充)">
      <template #actions>
        <span v-if="store.isReady" class="text-[11px] text-green-600 dark:text-green-400">
          ✅ 基础数据已就绪
        </span>
      </template>
    </SectionHeading>

    <!-- file:// 环境降级提示 -->
    <div
      v-if="fetchFailed"
      class="rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 px-4 py-3 text-sm text-amber-700 dark:text-amber-400"
    >
      ⚠️ 无法读取内置数据包(当前为 file:// 直开或部署环境不含数据)。请通过
      <code class="text-xs">npm run dev</code> 或部署到 Cloudflare Pages 后使用;或直接在上方手动上传。
    </div>

    <!-- 包列表 -->
    <div v-else-if="manifest && manifest.packages.length" class="space-y-3">
      <div
        v-for="pkg in manifest.packages"
        :key="pkg.id"
        class="card p-4 flex items-center justify-between gap-4 flex-wrap"
      >
        <div class="min-w-0">
          <div class="font-semibold text-sm text-slate-800 dark:text-white">{{ pkg.label }}</div>
          <div class="text-[11px] text-slate-400 mt-0.5 tabular-nums">
            {{ pkg.id }} · {{ pkg.fileCount }} 个文件
            <template v-if="pkg.files.length">
              · 槽位:{{
                pkg.files
                  .map((f) => ({ deck: '卡组', base: '卡表', prints: '印刷', rank: '胜场', shop: '门店' })[f.slot] ?? f.slot)
                  .join(' / ')
              }}
            </template>
          </div>
          <div v-if="loadingId === pkg.id && progress" class="mt-2 flex items-center gap-2">
            <div class="flex-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div
                class="h-full rounded-full bg-brand transition-all duration-300"
                :style="{ width: `${Math.round(progress.ratio * 100)}%` }"
              ></div>
            </div>
            <span class="text-[10px] text-slate-400 tabular-nums whitespace-nowrap"
              >{{ progress.done }}/{{ progress.total }} · {{ progress.fileName.split('/').pop() }}</span
            >
          </div>
        </div>
        <button
          :disabled="loadingId !== null || isLoaded(pkg)"
          class="px-5 py-2 text-sm rounded-xl font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow"
          :class="
            isLoaded(pkg)
              ? 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400'
              : 'btn-brand'
          "
          @click="loadPreset(pkg)"
        >
          {{ loadingId === pkg.id ? '⏳ 加载中…' : isLoaded(pkg) ? '✅ 已加载' : '🚀 一键加载' }}
        </button>
      </div>
      <p v-if="error" class="text-sm text-red-500">❌ {{ error }}</p>
    </div>

    <div v-else-if="!fetchFailed" class="text-sm text-slate-400">⏳ 读取预设清单…</div>
  </section>
</template>
