<script setup lang="ts">
/**
 * ImportView.vue · 数据导入页
 *  - 6 个槽位:3 必需 CSV + 3 可选增强 JSON
 *  - 分析按钮 + 增强数据质量报告 + 城市映射修正
 */
import { computed } from 'vue';
import { store, runStoredAnalysis } from '@/store/analysis';
import { SLOT_META } from '@/store/analysis';
import FileDrop from '@/components/FileDrop.vue';
import MappingPanel from '@/components/MappingPanel.vue';

function runAndGo(): void {
  if (runStoredAnalysis()) {
    store.currentView = 'overview';
  }
}

const slots = SLOT_META;
const requiredSlots = slots.filter((s) => s.required);
const optionalSlots = slots.filter((s) => !s.required);

const quality = computed(() => {
  const r = store.result;
  if (!r) return null;
  return [
    {
      label: '胜场数据匹配',
      value: r.hasWinData ? `${r.winMatchedDecks} / ${r.totalDecks}` : '未启用',
      ok: r.hasWinData,
      hint: 'rank_data.json 提供瑞士轮真实胜场'
    },
    {
      label: '精确城市匹配',
      value:
        r.shopMatchedEvents > 0 ? `${r.shopMatchedEvents} / ${r.events.length} 赛事` : '正则回退',
      ok: r.shopMatchedEvents > 0,
      hint: 'shop_data.json 提供城市/门店/规模'
    },
    {
      label: '卡牌图片索引',
      value: r.imageCount > 0 ? `${r.imageCount} 张` : '未启用',
      ok: r.imageCount > 0,
      hint: 'decks_cache.json / card_prints 提供 CDN 卡图'
    }
  ];
});
</script>

<template>
  <div class="fade-in max-w-5xl mx-auto space-y-6">
    <!-- 上传区 -->
    <section class="panel rounded-2xl p-6">
      <div class="flex flex-col md:flex-row items-start md:items-center justify-between mb-5 gap-4">
        <div>
          <h2 class="text-xl font-bold text-slate-800 dark:text-white">📥 数据导入</h2>
          <p class="text-sm text-slate-500 dark:text-gray-400 mt-1">
            上传三个必需 CSV 即可分析;拖入增强 JSON 解锁真实胜率、精确城市与卡图
          </p>
        </div>
        <button
          @click="runAndGo"
          :disabled="!store.isReady || store.isAnalyzing"
          class="px-8 py-2.5 bg-neutral-900 hover:bg-neutral-700 dark:bg-neutral-100 dark:hover:bg-neutral-300 text-white dark:text-neutral-900 font-medium rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg"
        >
          {{ store.isAnalyzing ? '⏳ 分析中…' : '🚀 启动分析' }}
        </button>
      </div>

      <p class="text-xs text-slate-400 mb-2">必需 · 基础数据</p>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <FileDrop
          v-for="(s, i) in requiredSlots"
          :key="s.id"
          :slot-index="i"
          :label="s.label"
          :emoji="s.emoji"
          :hint="s.hint"
        />
      </div>

      <p class="text-xs text-slate-400 mb-2">
        可选 · 增强
        <span class="ml-1 px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-300">推荐</span>
      </p>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <FileDrop
          v-for="(s, i) in optionalSlots"
          :key="s.id"
          :slot-index="i + 3"
          :label="s.label"
          :emoji="s.emoji"
          :hint="s.hint"
        />
      </div>

      <p v-if="store.analysisError" class="mt-4 text-sm text-red-500">
        ❌ 分析失败:{{ store.analysisError.message }}
      </p>
    </section>

    <!-- 数据质量 -->
    <section v-if="quality" class="panel rounded-2xl p-6">
      <h3 class="text-sm font-bold text-slate-800 dark:text-white mb-4">🔍 数据质量报告</h3>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div
          v-for="q in quality"
          :key="q.label"
          class="card p-4 flex items-start gap-3"
        >
          <span class="text-lg leading-none mt-0.5">{{ q.ok ? '✅' : '⚠️' }}</span>
          <div class="min-w-0">
            <div class="text-xs text-slate-400">{{ q.label }}</div>
            <div class="text-sm font-semibold text-slate-700 dark:text-gray-200">
              {{ q.value }}
            </div>
            <div class="text-[11px] text-slate-400 mt-0.5">{{ q.hint }}</div>
          </div>
        </div>
      </div>
    </section>

    <MappingPanel />
  </div>
</template>
