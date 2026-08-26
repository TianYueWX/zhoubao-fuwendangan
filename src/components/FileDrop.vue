<script setup lang="ts">
/**
 * FileDrop.vue · 槽位上传(6 类文件)
 *  - CSV:PapaParse 解析;JSON:text() + JSON.parse(cache 约 40MB)
 *  - 按文件名关键词自动归类槽位,失败回退到当前槽位
 */
import { computed, ref } from 'vue';
import {
  parseCSVFile,
  parseJSONFile,
  detectSlotFromFilename
} from '@/utils/dataParser';
import { store, loadSlotFile, SLOT_KINDS } from '@/store/analysis';
import type { RawRow, RankRow, ShopRow, DeckCacheData } from '@/types';

interface Props {
  /** 槽位序号:0 deck / 1 base / 2 prints / 3 rank / 4 shop / 5 cache */
  slotIndex: number;
  label: string;
  emoji: string;
  hint?: string;
}

const props = defineProps<Props>();

const parsing = ref(false);
const error = ref('');

const isJsonSlot = computed(() => props.slotIndex >= 3);
const slot = computed(() => store.slots[props.slotIndex]);
const isLoaded = computed(() => !!slot.value?.rows);

function handleFile(e: Event): void {
  const input = e.target as HTMLInputElement;
  const files = input.files;
  if (!files || files.length === 0) return;

  error.value = '';
  for (const file of Array.from(files)) {
    const auto = detectSlotFromFilename(file.name);
    const target =
      auto === null ? props.slotIndex : Math.max(0, SLOT_KINDS.indexOf(auto));

    if (target >= 3) {
      // JSON 槽位
      parsing.value = true;
      parseJSONFile<unknown>(
        file,
        (data) => {
          parsing.value = false;
          if (Array.isArray(data)) {
            loadSlotFile(target, data as RawRow[], file.name, auto !== null);
          } else if (data && typeof data === 'object') {
            loadSlotFile(target, data as DeckCacheData, file.name, auto !== null);
          } else {
            error.value = '无法识别的 JSON 结构';
          }
        },
        (err) => {
          parsing.value = false;
          error.value = `解析失败:${err.message}`;
        }
      );
    } else if (file.name.toLowerCase().endsWith('.json')) {
      // rank/shop JSON 也可能是数组结构,走 JSON 分支
      parsing.value = true;
      parseJSONFile<RankRow[] | ShopRow[]>(
        file,
        (rows) => {
          parsing.value = false;
          loadSlotFile(target, rows, file.name, auto !== null);
        },
        (err) => {
          parsing.value = false;
          error.value = `解析失败:${err.message}`;
        }
      );
    } else {
      parseCSVFile<RawRow>(
        file,
        (rows) => {
          loadSlotFile(target, rows as RawRow[], file.name, auto !== null);
        },
        (err) => {
          error.value = `解析失败:${err.message}`;
        }
      );
    }
  }
  input.value = '';
}
</script>

<template>
  <label
    :class="[
      'dropzone rounded-xl p-4 text-center cursor-pointer block transition-all relative',
      isLoaded ? 'loaded' : '',
      parsing ? 'animate-pulse' : ''
    ]"
  >
    <input
      type="file"
      :accept="isJsonSlot ? '.json' : '.csv'"
      multiple
      class="hidden"
      @change="handleFile"
    />
    <div class="text-xl mb-1">{{ emoji }}</div>
    <div class="text-xs font-medium text-slate-700 dark:text-gray-200">{{ label }}</div>
    <div class="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{{ hint }}</div>
    <div
      class="text-[11px] mt-1 truncate px-1"
      :class="
        error
          ? 'text-red-500'
          : isLoaded
            ? 'text-green-600 dark:text-green-400'
            : 'text-slate-400 dark:text-gray-500'
      "
    >
      <template v-if="parsing">⏳ 解析中…</template>
      <template v-else-if="error">{{ error }}</template>
      <template v-else-if="isLoaded">
        ✅ {{ slot?.fileName }} ({{
          Array.isArray(slot?.rows) ? `${slot.rows.length} 行` : '已加载'
        }})
      </template>
      <template v-else>未上传</template>
    </div>
  </label>
</template>
