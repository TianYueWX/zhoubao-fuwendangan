<script setup lang="ts">
/**
 * FileDrop.vue · 槽位上传(6 类文件)
 *  - CSV:PapaParse 解析;JSON:text() + Worker 解析(cache 约 40MB)
 *  - 按文件名关键词自动归类槽位,失败回退到当前槽位
 *  - 多文件串行读取(避免大文件并发读取导致浏览器内存压力)
 *  - NotReadableError 等浏览器级读取失败 → 可操作的中文提示 + 一键重试
 */
import { computed, ref } from 'vue';
import {
  parseCSVFile,
  detectSlotFromFilename
} from '@/utils/dataParser';
import { parseInWorker } from '@/utils/workerParse';
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
/** 最近一次读取失败的文件,供「重试」 */
const lastFailed = ref<File | null>(null);

const isJsonSlot = computed(() => props.slotIndex >= 3);
const slot = computed(() => store.slots[props.slotIndex]);
const isLoaded = computed(() => !!slot.value?.rows);

/** 浏览器级读取失败 → 可操作文案 */
function friendlyReadError(err: unknown, fileName: string): string {
  const e = err as { name?: string; message?: string };
  const msg = e?.message ?? String(err);
  if (
    e?.name === 'NotReadableError' ||
    e?.name === 'NotFoundError' ||
    msg.includes('could not be read')
  ) {
    return `${fileName} 无法读取:文件可能已被移动/删除、位于未同步的云端或网络目录,或超出浏览器可读大小。请确认文件已保存在本地磁盘后重试。`;
  }
  return `${fileName}:${msg}`;
}

async function processOne(file: File): Promise<void> {
  const auto = detectSlotFromFilename(file.name);
  const target =
    auto === null ? props.slotIndex : Math.max(0, SLOT_KINDS.indexOf(auto));

  if (target >= 3 || file.name.toLowerCase().endsWith('.json')) {
    // JSON 槽位(v3:大文件走 Web Worker 解析,主线程不卡顿)
    try {
      const text = await file.text();
      const data = (await parseInWorker(text, 'json')) as
        | RawRow[]
        | RankRow[]
        | ShopRow[]
        | DeckCacheData
        | null;
      if (Array.isArray(data)) {
        loadSlotFile(target, data as RawRow[], file.name, auto !== null);
      } else if (data && typeof data === 'object') {
        loadSlotFile(target, data as DeckCacheData, file.name, auto !== null);
      } else {
        throw new Error(`${file.name}:无法识别的 JSON 结构`);
      }
    } catch (err: unknown) {
      throw new Error(friendlyReadError(err, file.name));
    }
  } else {
    // CSV:PapaParse 直接消费 File,内部错误经回调抛出
    await new Promise<void>((resolve, reject) => {
      parseCSVFile<RawRow>(
        file,
        (rows) => {
          loadSlotFile(target, rows as RawRow[], file.name, auto !== null);
          resolve();
        },
        (err) => {
          reject(new Error(friendlyReadError(err, file.name)));
        }
      );
    });
  }
}

async function handleFiles(files: FileList): Promise<void> {
  error.value = '';
  lastFailed.value = null;
  parsing.value = true;
  for (const file of Array.from(files)) {
    try {
      await processOne(file);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      error.value = `解析失败:${msg}`;
      lastFailed.value = file;
      break; // 串行:失败即停,保留后续文件给用户手动重试
    }
  }
  parsing.value = false;
}

function handleFile(e: Event): void {
  const input = e.target as HTMLInputElement;
  const files = input.files;
  if (!files || files.length === 0) return;
  void handleFiles(files);
  input.value = '';
}

function retry(): void {
  const f = lastFailed.value;
  if (!f || parsing.value) return;
  // DataTransfer 复用 File 对象,走同一管线
  const dt = new DataTransfer();
  dt.items.add(f);
  void handleFiles(dt.files);
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
    <div class="text-xl mb-1 drop-shadow-sm">{{ emoji }}</div>
    <div class="text-xs font-semibold tracking-wide text-ink-muted">
      {{ label }}
    </div>
    <div class="text-[10px] text-ink-faint mt-0.5 font-mono">{{ hint }}</div>
    <div
      class="text-[11px] mt-1 truncate px-1"
      :class="
        error
          ? 'text-delta-down'
          : isLoaded
            ? 'text-delta-up'
            : 'text-ink-faint'
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
    <button
      v-if="error && lastFailed && !parsing"
      type="button"
      class="btn-ghost mt-2 px-3 py-1 text-xs"
      @click.prevent="retry()"
    >
      ↻ 重试 {{ lastFailed.name }}
    </button>
  </label>
</template>
