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
import PresetLoader from '@/components/PresetLoader.vue';

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
  <div class="fade-in max-w-5xl mx-auto space-y-10">
    <!-- 内置预设数据包(v3) -->
    <section>
      <PresetLoader />
    </section>

    <div class="hairline"></div>

    <!-- 上传区 -->
    <section>
      <div class="flex flex-col md:flex-row items-start md:items-center justify-between mb-5 gap-4">
        <div>
          <p class="eyebrow mb-1.5">投稿箱 · Submissions</p>
          <h3 class="font-display font-bold text-xl text-ink">上传赛事数据包</h3>
          <p class="text-xs text-ink-faint mt-1.5">
            上传三个必需 CSV 即可分析;可选 JSON 解锁真实胜率、精确城市与卡图。文件按名称自动识别槽位;若浏览器提示无法读取,请确认文件已保存在本地磁盘。
          </p>
        </div>
        <button
          @click="runAndGo"
          :disabled="!store.isReady || store.isAnalyzing"
          class="btn-brand px-8 py-2.5 shrink-0"
        >
          {{ store.isAnalyzing ? '⏳ 分析中…' : '🚀 启动分析' }}
        </button>
      </div>

      <p class="text-xs text-ink-faint mb-2 tracking-[0.14em]">必需 · 基础数据</p>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <FileDrop
          v-for="(s, i) in requiredSlots"
          :key="s.id"
          :slot-index="i"
          :label="s.label"
          :emoji="s.emoji"
          :hint="s.hint"
        />
      </div>

      <p class="text-xs text-ink-faint mb-2 tracking-[0.14em]">
        可选 · 增强
        <span class="ml-1 px-1.5 py-0.5 rounded bg-brand-soft text-brand">推荐</span>
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

      <p v-if="store.analysisError" class="mt-4 text-sm text-delta-down">
        ❌ 分析失败:{{ store.analysisError.message }}
      </p>
    </section>

    <!-- 数据质量 -->
    <template v-if="quality">
      <div class="hairline"></div>
      <section>
        <SectionHeading eyebrow="校对记 · Fact Check" title="数据质量报告" />
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div
            v-for="q in quality"
            :key="q.label"
            class="card p-4 flex items-start gap-3"
          >
            <span class="text-lg leading-none mt-0.5">{{ q.ok ? '✅' : '⚠️' }}</span>
            <div class="min-w-0">
              <div class="text-xs text-ink-faint">{{ q.label }}</div>
              <div class="text-sm font-semibold text-ink-muted">
                {{ q.value }}
              </div>
              <div class="text-[11px] text-ink-faint mt-0.5">{{ q.hint }}</div>
            </div>
          </div>
        </div>
      </section>
    </template>

    <MappingPanel />
  </div>
</template>
