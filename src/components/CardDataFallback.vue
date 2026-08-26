<script setup lang="ts">
/**
 * CardDataFallback.vue · 内置卡表兜底上传
 *  - 仅当预加载失败(file:// 直开 / 网络异常)时展示
 *  - 手动上传 cards_base / card_prints CSV 写入 store 预加载态
 */
import { ref } from 'vue';
import { parseCSVFile } from '@/utils/dataParser';
import { store, setCardData } from '@/store/analysis';
import type { RawCardBaseRow, RawCardPrintRow } from '@/types';

const loading = ref(false);
const error = ref('');

function pick(kind: 'base' | 'prints', ev: Event): void {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  loading.value = true;
  error.value = '';
  parseCSVFile<RawCardBaseRow | RawCardPrintRow>(
    file,
    (rows) => {
      setCardData(kind, rows);
      loading.value = false;
    },
    (err) => {
      error.value = err instanceof Error ? err.message : String(err);
      loading.value = false;
    }
  );
}
</script>

<template>
  <div class="mt-3 rounded-lg bg-accent/10 border border-accent/30 px-4 py-3">
    <p class="text-xs text-ink-muted mb-2">
      手动上传静态卡表(两份都传齐后才能分析;正常部署时无需上传):
    </p>
    <div class="flex flex-wrap gap-2">
      <label
        class="btn-ghost cursor-pointer px-3 py-1.5 text-xs rounded-lg border border-card-border hover:border-brand"
      >
        卡牌基础 cards_base*.csv
        <input type="file" accept=".csv" class="hidden" @change="pick('base', $event)" />
      </label>
      <label
        class="btn-ghost cursor-pointer px-3 py-1.5 text-xs rounded-lg border border-card-border hover:border-brand"
      >
        卡牌印刷 card_prints*.csv
        <input type="file" accept=".csv" class="hidden" @change="pick('prints', $event)" />
      </label>
    </div>
    <p v-if="loading" class="text-[11px] text-ink-faint mt-2">解析中…</p>
    <p v-else-if="error" class="text-[11px] text-delta-down mt-2">{{ error }}</p>
    <p v-else class="text-[11px] mt-2">
      <span v-if="store.cardBase" class="text-delta-up">卡牌基础已就绪</span>
      <span v-if="store.cardPrints" class="text-delta-up ml-2">卡牌印刷已就绪</span>
    </p>
  </div>
</template>
