<script setup lang="ts">
/**
 * FileDrop.vue · 槽位上传(deck CSV / rank JSON / shop JSON)
 *  - 可一次选择多个文件,按文件名关键词自动识别槽位、对号入座
 *  - CSV:PapaParse 解析;JSON:text() + Worker 解析(rank/shop 大 JSON)
 *  - 按文件名关键词自动归类槽位,失败回退到当前槽位
 *  - cards_base / card_prints 已内置预加载,拖入时静默跳过
 *  - 多文件串行读取(避免大文件并发读取导致浏览器内存压力)
 *  - NotReadableError 等浏览器级读取失败 → 可操作的中文提示 + 一键重试
 */
import { computed, ref } from 'vue';
import {
  parseCSVFile,
  detectSlotFromFilename
} from '@/utils/dataParser';
import { parseJsonAuto } from '@/utils/streamJson';
import { store, loadSlotFile, SLOT_KINDS } from '@/store/analysis';
import type { RawRow, RankRow, ShopRow } from '@/types';

interface Props {
  /** 槽位序号:0 deck / 1 rank / 2 shop */
  slotIndex: number;
  label: string;
  hint?: string;
}

const props = defineProps<Props>();

const parsing = ref(false);
const error = ref('');
/** 最近一次读取失败的文件,供「重试」 */
const lastFailed = ref<File | null>(null);

const slot = computed(() => store.slots[props.slotIndex]);
const isLoaded = computed(() => !!slot.value?.rows);

/** 浏览器级读取失败 → 可操作文案 */
function friendlyReadError(err: unknown, fileName: string): string {
  const e = err as { name?: string; message?: string };
  const msg = e?.message ?? String(err);
  if (
    e?.name === 'NotReadableError' ||
    e?.name === 'NotFoundError' ||
    msg.includes('could not be read') ||
    msg.includes('size') ||
    msg.includes('NotReadableError')
  ) {
    return `${fileName} 无法读取。请将文件复制到 ~/Downloads 后重试，或使用 Firefox。`;
  }
  return `${fileName}:${msg}`;
}

async function processOne(file: File): Promise<void> {
  console.log('[FileDrop] processOne START', file.name, 'size:', file.size, 'type:', file.type);

  // Chrome Flatpak/Snap sandbox: file.size === 0 means Chrome can't read the file
  if (file.size === 0) {
    const msg = `${file.name}: 文件大小显示为 0，Chrome 无法读取。\n\n` +
      `可能原因：\n` +
      `1. Flatpak/Snap 版 Chrome（沙箱限制）\n` +
      `2. 文件在符号链接/特殊挂载点\n\n` +
      `解决方法：\n` +
      `• 将文件复制到 ~/Downloads 后重试\n` +
      `• 或使用 Firefox 上传\n` +
      `• Flatpak 用户：flatpak override --filesystem=home com.google.Chrome`;
    throw new Error(msg);
  }

  const auto = detectSlotFromFilename(file.name);
  console.log('[FileDrop] detectSlotFromFilename:', auto);
  // 卡表/印刷已内置预加载(随站点发布),拖入/选中时静默跳过
  if (auto === 'base' || auto === 'prints') {
    // eslint-disable-next-line no-console
    console.info(`[FileDrop] ${file.name} 已内置预加载,无需上传`);
    return;
  }
  const target =
    auto === null ? props.slotIndex : Math.max(0, SLOT_KINDS.indexOf(auto));
  console.log('[FileDrop] target slot:', target, 'slotIndex:', props.slotIndex);

  if (target >= 1 || file.name.toLowerCase().endsWith('.json')) {
    // JSON 槽位:使用流式解析避免 Chrome NotReadableError (大文件不一次性读入内存)
    try {
      console.log('[FileDrop] CALLING parseJsonAuto...');
      const data = await parseJsonAuto(file) as RawRow[] | RankRow[] | ShopRow[];
      console.log('[FileDrop] parseJsonAuto RETURNED', data?.length, 'items');
      if (Array.isArray(data)) {
        loadSlotFile(target, data as RawRow[], file.name, auto !== null);
        console.log('[FileDrop] loadSlotFile DONE');
      } else {
        throw new Error(`${file.name}:无法识别的 JSON 结构(应为数组)`);
      }
    } catch (err: unknown) {
      console.error('[FileDrop] ERROR in processOne:', err);
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
      :accept="'.csv,.json'"
      multiple
      class="hidden"
      @change="handleFile"
    />
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
      <template v-if="parsing">解析中…</template>
      <template v-else-if="error">{{ error }}</template>
      <template v-else-if="isLoaded">
        {{ slot?.fileName }} ({{
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
      重试 {{ lastFailed.name }}
    </button>
  </label>
</template>
