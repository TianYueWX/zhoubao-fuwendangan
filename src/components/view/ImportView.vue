<script setup lang="ts">
/**
 * ImportView.vue · 数据导入页
 *  - 3 个上传槽位:1 必需 CSV(赛事卡组)+ 2 可选增强 JSON(胜场/门店)
 *  - 卡表(cards_base × card_prints)内置预加载,失败时手动上传兜底
 *  - 分析按钮 + 增强数据质量报告 + 城市映射修正
 */
import { computed, ref } from 'vue';
import { store, runStoredAnalysis, loadCardData, loadSlotFile, SLOT_KINDS } from '@/store/analysis';
import { SLOT_META } from '@/store/analysis';
import { detectSlotFromFilename, parseCSVFile } from '@/utils/dataParser';
import { parseInWorker } from '@/utils/workerParse';
import FileDrop from '@/components/FileDrop.vue';
import CardDataFallback from '@/components/CardDataFallback.vue';
import MappingPanel from '@/components/MappingPanel.vue';
import type { RawRow } from '@/types';

function runAndGo(): void {
  if (runStoredAnalysis()) {
    store.currentView = 'overview';
  }
}

/* ── 批量上传:一次选择多个文件,按文件名自动对号入座 ── */
const batchParsing = ref(false);
const batchSummary = ref<{ slot: string; fileName: string; ok: boolean }[]>([]);

async function handleBatch(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const files = input.files;
  if (!files || files.length === 0) return;
  input.value = '';
  batchParsing.value = true;
  batchSummary.value = [];
  const results: { slot: string; fileName: string; ok: boolean }[] = [];
  for (const file of Array.from(files)) {
    const auto = detectSlotFromFilename(file.name);
    if (auto === 'base' || auto === 'prints') {
      // 卡表已内置预加载,静默跳过
      continue;
    }
    if (!auto) {
      results.push({ slot: '未识别', fileName: file.name, ok: false });
      continue;
    }
    const target = SLOT_KINDS.indexOf(auto);
    try {
      if (file.name.toLowerCase().endsWith('.json')) {
        const text = await file.text();
        const data = (await parseInWorker(text, 'json')) as RawRow[] | null;
        if (!Array.isArray(data)) throw new Error('JSON 应为数组');
        loadSlotFile(target, data, file.name, true);
      } else {
        await new Promise<void>((resolve, reject) => {
          parseCSVFile<RawRow>(
            file,
            (rows) => {
              loadSlotFile(target, rows, file.name, true);
              resolve();
            },
            (err) => {
              reject(new Error(String(err)));
            }
          );
        });
      }
      results.push({ slot: auto, fileName: file.name, ok: true });
    } catch (err: unknown) {
      results.push({ slot: auto, fileName: file.name, ok: false });
    }
  }
  batchSummary.value = results;
  batchParsing.value = false;
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
    }
  ];
});
</script>

<template>
  <div class="fade-in max-w-5xl mx-auto space-y-10">
    <!-- 上传区 -->
    <section>
      <div class="flex flex-col md:flex-row items-start md:items-center justify-between mb-5 gap-4">
        <div>
          <p class="eyebrow mb-1.5">投稿箱 · Submissions</p>
          <h3 class="font-display font-bold text-xl text-ink">上传赛事数据包</h3>
          <p class="text-xs text-ink-faint mt-1.5">
            卡表与卡图索引已内置预加载(随站点发布);上传赛事卡组 CSV 即可分析,可选
            JSON 解锁胜场明细与精确城市。文件按名称自动识别槽位;若浏览器提示无法读取,请确认文件已保存在本地磁盘。
          </p>
          <div class="mt-3 card p-3 flex items-center gap-3 flex-wrap">
            <label
              class="btn-brand px-4 py-2 text-sm cursor-pointer shrink-0"
              :class="batchParsing ? 'opacity-60 pointer-events-none' : ''"
            >
              {{ batchParsing ? '解析中…' : '选择多个文件(自动对号入座)' }}
              <input type="file" accept=".csv,.json" multiple class="hidden" @change="handleBatch" />
            </label>
            <span class="text-xs text-ink-faint">
              一次选择 赛事卡组 CSV + rank/shop JSON,按文件名自动分槽
            </span>
          </div>
          <div v-if="batchSummary.length" class="mt-2 space-y-1 text-xs">
            <div v-for="s in batchSummary" :key="s.fileName" class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full shrink-0" :class="s.ok ? 'bg-delta-up' : 'bg-delta-down'"></span>
              <span class="text-ink-muted truncate">{{ s.fileName }}</span>
              <span class="text-ink-faint ml-auto shrink-0">
                {{ s.ok ? '已载入' : '失败' }} → {{ s.slot }}
              </span>
            </div>
          </div>
        </div>
        <button @click="runAndGo" :disabled="!store.isReady || store.isAnalyzing"
          class="btn-brand px-8 py-2.5 shrink-0">
          {{ store.isAnalyzing ? '分析中…' : '启动分析' }}
        </button>
      </div>

      <!-- 内置卡表预加载状态 -->
      <div v-if="store.cardDataStatus !== 'ok'"" class=" mb-5 rounded-lg border border-card-border bg-card-bg px-4
        py-2.5 flex items-center gap-2 flex-wrap">
        <template v-if="store.cardDataStatus === 'loading'">
          <span class="text-xs text-ink-faint">内置卡表与卡图索引加载中…</span>
        </template>
        <!-- <template v-else-if="store.cardDataStatus === 'ok'">
          <span class="text-xs text-delta-up">内置卡表已就绪</span>
          <span class="text-[10px] text-ink-faint">
            cards_base × card_prints(含 CDN 卡图索引,共 {{ store.cardBase?.length ?? 0 }} /
            {{ store.cardPrints?.length ?? 0 }} 行)
          </span>
        </template> -->
        <template v-else-if="store.cardDataStatus === 'failed'">
          <span class="text-xs text-delta-down">
            内置卡表加载失败(file:// 直开或网络异常),可重试或手动上传
          </span>
          <button @click="loadCardData()"
            class="text-[11px] px-2 py-0.5 rounded border border-card-border hover:border-brand">
            重试
          </button>
        </template>
      </div>
      <!-- 预加载失败时的手动兜底上传 -->
      <CardDataFallback v-if="store.cardDataStatus === 'failed'" class="mb-5" />

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <p class="text-xs text-ink-faint mb-2 tracking-[0.14em]">必需 · 赛事数据</p>
          <div class="grid grid-cols-1 gap-3 mb-5">
            <FileDrop v-for="(s, i) in requiredSlots" :key="s.id" :slot-index="i" :label="s.label"
              :hint="s.hint" />
          </div>

        </div>

        <div>
          <p class="text-xs text-ink-faint mb-2 tracking-[0.14em]">
            可选 · 增强
            <span class="ml-1 px-1.5 py-0.5 rounded bg-brand-soft text-brand">推荐</span>
          </p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FileDrop v-for="(s, i) in optionalSlots" :key="s.id" :slot-index="i + 1" :label="s.label"
              :hint="s.hint" />
          </div>
        </div>

      </div>


      <p v-if="store.analysisError" class="mt-4 text-sm text-delta-down">
        分析失败:{{ store.analysisError.message }}
      </p>
    </section>

    <!-- 数据质量 -->
    <template v-if="quality">
      <div class="hairline"></div>
      <section>
        <SectionHeading eyebrow="校对记 · Fact Check" title="数据质量报告" />
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div v-for="q in quality" :key="q.label" class="card p-4 flex items-start gap-3">
            <span class="w-1.5 h-6 rounded-full mt-0.5 shrink-0" :class="q.ok ? 'bg-delta-up' : 'bg-delta-down'"></span>
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
