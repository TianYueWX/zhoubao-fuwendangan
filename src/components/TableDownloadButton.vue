<script setup lang="ts">
/**
 * TableDownloadButton.vue · 表格长图下载(PNG)
 *
 * 点按后把目标 <table> 按当前筛选/排序结果画成一张带报头与口径说明的分享长图。
 *  - target 用**取值函数**而非元素:表格常在同级插槽里条件渲染,点按时再取更稳
 *  - variant='text' 供期号正文等印刷版式使用(文字链,不打断版面)
 */
import { ref } from 'vue';
import { downloadTableImage } from '@/utils/tableImage';
import { useExportMeta } from '@/composables/useExportMeta';

const props = withDefaults(
  defineProps<{
    /** 取目标表格元素 */
    target: () => HTMLTableElement | null | undefined;
    /** 图片标题(通常与节标题一致) */
    title: string;
    /** 朱砂眉题 */
    eyebrow?: string;
    /** 口径说明 */
    note?: string;
    variant?: 'button' | 'text';
  }>(),
  { eyebrow: '', note: '', variant: 'button' }
);

const meta = useExportMeta();
const busy = ref(false);

async function run(): Promise<void> {
  if (busy.value) return;
  const el = props.target();
  if (!el) return;
  busy.value = true;
  try {
    await downloadTableImage(el, {
      eyebrow: props.eyebrow,
      title: props.title,
      note: props.note,
      ...meta.value
    });
  } catch (e: unknown) {
    window.alert(`导出图片失败:${e instanceof Error ? e.message : String(e)}`);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <button
    v-if="variant === 'button'"
    class="btn-ghost px-3 py-1.5 text-xs font-medium whitespace-nowrap"
    :disabled="busy"
    :title="`把「${title}」存成一张 PNG 长图(含报头/期号/口径说明,卡图为色块占位)`"
    @click="run"
  >
    <span aria-hidden="true">⤓</span>
    {{ busy ? '生成中…' : '下载长图' }}
  </button>
  <button
    v-else
    class="text-[11px] text-ink-faint hover:text-brand transition-colors whitespace-nowrap"
    :disabled="busy"
    :title="`把本表存成 PNG 长图`"
    @click="run"
  >
    {{ busy ? '生成中…' : '⤓ 下载本表长图' }}
  </button>
</template>
