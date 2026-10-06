<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import BuilderModal from '@/components/deckbuilder/BuilderModal.vue';
import type { ChainSnapshot } from '@/tools/chain/types';
import { AREA_ORDER } from '@/tools/chain/types';
import { renderFrame } from '@/tools/chain/renderFrame';
const props = defineProps<{ history: readonly ChainSnapshot[]; imageOf: (id: string) => string; name: string }>();
const emit = defineEmits<{ close: [] }>();
const steps = ref(props.history.map((s) => ({ snapshot: JSON.parse(JSON.stringify(s)) as ChainSnapshot, included: true })));
const format = ref<'gif' | 'mp4'>('mp4'), width = ref(1920), previewIndex = ref(0);
const canvas = ref<HTMLCanvasElement>(), busy = ref(false), progress = ref(0), status = ref(''), error = ref(''), url = ref(''), exportedFormat = ref('');
const images = new Map<string, HTMLImageElement>();
let worker: Worker | undefined, previewTimer: ReturnType<typeof setTimeout> | undefined;
const playing = ref(false);
const selected = computed(() => steps.value.filter((s) => s.included).map((s) => s.snapshot));
const duration = computed(() => selected.value.reduce((sum, s) => sum + (s.duration ?? 2), 0));
watch(format, (value) => { width.value = value === 'gif' ? 960 : 1920; });
function reorder(index: number, offset: number): void { const target = index + offset; if (target < 0 || target >= steps.value.length) return; const [step] = steps.value.splice(index, 1); steps.value.splice(target, 0, step!); }
async function preview(): Promise<void> {
  await nextTick(); const ctx = canvas.value?.getContext('2d');
  const snap = selected.value[previewIndex.value]; if (ctx && snap) renderFrame(ctx, snap, props.name, previewIndex.value, selected.value.length, images, selected.value[previewIndex.value - 1]);
}
function stopPreview(): void { playing.value = false; clearTimeout(previewTimer); }
function playPreview(): void {
  if (playing.value) { stopPreview(); return; }
  if (!selected.value.length) return;
  previewIndex.value = 0; playing.value = true;
  function advance(): void {
    void preview();
    previewTimer = setTimeout(() => { if (previewIndex.value + 1 >= selected.value.length) stopPreview(); else { previewIndex.value++; advance(); } }, (selected.value[previewIndex.value]?.duration ?? 2) * 1000);
  } advance();
}
watch([previewIndex, selected], () => { if (previewIndex.value >= selected.value.length) previewIndex.value = Math.max(0, selected.value.length - 1); void preview(); }, { deep: true });
function cancel(): void { worker?.terminate(); worker = undefined; busy.value = false; status.value = '已取消，可重新导出'; }
function close(): void { cancel(); stopPreview(); emit('close'); }
function start(): void {
  if (!selected.value.length || busy.value) return;
  stopPreview(); error.value = ''; status.value = '正在启动导出…'; progress.value = 0; busy.value = true;
  if (url.value) { URL.revokeObjectURL(url.value); url.value = ''; }
  worker = new Worker(new URL('../../tools/chain/export.worker.ts', import.meta.url), { type: 'module' });
  const fail = (): void => { cancel(); error.value = '没能生成动画。请重试，或降低分辨率后导出；也可以改选 GIF。'; };
  worker.onerror = fail;
  worker.onmessage = (event: MessageEvent) => {
    if (event.data.error) { fail(); return; }
    if (event.data.complete) {
      const blob = new Blob([event.data.complete], { type: format.value === 'gif' ? 'image/gif' : 'video/mp4' });
      url.value = URL.createObjectURL(blob); exportedFormat.value = format.value;
      worker?.terminate(); worker = undefined; busy.value = false; progress.value = 1;
      status.value = `导出完成${event.data.missing ? `；${event.data.missing} 张卡图无法读取，已显示卡名和效果` : ''}`;
    } else { progress.value = event.data.progress; status.value = event.data.label; }
  };
  const imageUrls: Record<string, string> = {};
  selected.value.forEach((s) => AREA_ORDER.forEach((a) => s.board.areas[a].cards.forEach((c) => { if (c.cardId) imageUrls[c.cardId] = props.imageOf(c.cardId); })));
  worker.postMessage({ snapshots: JSON.parse(JSON.stringify(selected.value)), name: props.name, format: format.value, width: width.value, images: imageUrls });
}
onMounted(async () => {
  await preview();
  const ids = new Set(props.history.flatMap((s) => AREA_ORDER.flatMap((a) => s.board.areas[a].cards.map((c) => c.cardId))));
  await Promise.all([...ids].map(async (id) => {
    const src = props.imageOf(id); if (!src) return;
    const img = new Image(); img.crossOrigin = 'anonymous'; img.src = src;
    try { await img.decode(); images.set(id, img); } catch { /* Card text remains available. */ }
  })); await preview();
});
onBeforeUnmount(() => { cancel(); stopPreview(); if (url.value) URL.revokeObjectURL(url.value); });
</script>
<template>
  <BuilderModal title="从历史快照导出动画" wide @close="close">
    <p class="export-note">选择要讲的步骤，调整顺序和停留时间。这里的修改只影响这次导出。</p>
    <p v-if="!steps.length">还没有历史快照。关闭此窗口，摆好棋盘后点击“保存快照”，再来导出。</p>
    <template v-else>
      <fieldset :disabled="busy" class="export-settings">
        <label>格式 <select v-model="format"><option value="mp4">MP4 视频</option><option value="gif">GIF 动图</option></select></label>
        <label>分辨率 <select v-model.number="width"><option :value="960">960 × 540</option><option :value="1280">1280 × 720</option><option :value="1920">1920 × 1080</option></select></label>
        <span>{{ selected.length }} 个步骤 · {{ duration.toFixed(1) }} 秒 · 16:9</span>
      </fieldset>
      <ol class="export-steps">
        <li v-for="(step, i) in steps" :key="step.snapshot.id">
          <input v-model="step.included" type="checkbox" :disabled="busy" :aria-label="`导出步骤 ${i + 1}`" />
          <label class="step-description">步骤 {{ i + 1 }}<input v-model="step.snapshot.action" maxlength="200" :disabled="busy" :aria-label="`步骤 ${i + 1} 说明`" /></label>
          <label class="step-duration">秒<input v-model.number="step.snapshot.duration" type="number" min=".5" max="30" step=".5" :placeholder="'2'" :disabled="busy" @change="step.snapshot.duration = Math.max(.5, Math.min(30, Number(step.snapshot.duration) || 2))" /></label>
          <button class="b-btn" :disabled="busy || i === 0" :aria-label="`步骤 ${i + 1} 上移`" @click="reorder(i, -1)">↑</button><button class="b-btn" :disabled="busy || i === steps.length - 1" :aria-label="`步骤 ${i + 1} 下移`" @click="reorder(i, 1)">↓</button>
        </li>
      </ol>
      <div v-if="selected.length" class="export-preview">
        <canvas ref="canvas" width="960" height="540" aria-label="导出画面预览" />
        <div class="preview-controls"><button class="b-btn" :disabled="busy" @click="playPreview">{{ playing ? '暂停预览' : '播放预览' }}</button><label>预览步骤 <input v-model.number="previewIndex" type="range" min="0" :max="selected.length - 1" @input="stopPreview" /></label><span>{{ previewIndex + 1 }} / {{ selected.length }}</span></div>
      </div>
      <progress v-if="busy" :value="progress" max="1" aria-label="导出进度" />
      <p role="status">{{ status }}{{ busy ? `（${Math.round(progress * 100)}%）` : '' }}</p>
      <p v-if="error" class="b-error" role="alert">{{ error }}</p>
      <video v-if="url && exportedFormat === 'mp4'" :src="url" controls class="export-result" aria-label="生成的视频" />
      <img v-else-if="url" :src="url" alt="生成的 GIF 动图" class="export-result" />
    </template>
    <template #footer>
      <button class="b-btn" @click="busy ? cancel() : close()">{{ busy ? '取消导出' : '关闭' }}</button>
      <a v-if="url" class="b-btn b-primary" :href="url" :download="`${name}.${exportedFormat}`">下载 {{ exportedFormat.toUpperCase() }}</a>
      <button class="b-btn b-primary" :disabled="busy || !selected.length" @click="start">{{ error ? '重试导出' : '开始导出' }}</button>
    </template>
  </BuilderModal>
</template>
<style scoped>
.export-note{margin-bottom:1rem;font-size:.875rem;color:var(--color-text-muted)}.export-settings{display:flex;gap:1rem;align-items:center;flex-wrap:wrap;margin-bottom:1rem}.export-settings label{display:flex;gap:.5rem;align-items:center}.export-steps{max-height:16rem;overflow:auto;display:flex;flex-direction:column;gap:.5rem}.export-steps li{display:flex;align-items:center;gap:.5rem}.export-steps input[type=checkbox]{width:1.25rem;height:1.25rem}.step-description{flex:1;min-width:0;font-size:.875rem}.step-description input{display:block;width:100%}.step-duration{width:4.5rem;font-size:.875rem}.step-duration input{width:100%}.export-preview{margin-top:1rem}.export-preview canvas,.export-result{width:100%;aspect-ratio:16/9;background:#f8f4eb}.preview-controls{display:flex;align-items:center;gap:.75rem;flex-wrap:wrap}.preview-controls label{display:flex;gap:.5rem;flex:1;align-items:center}.preview-controls input{flex:1;min-width:0}progress{width:100%;margin-top:1rem}button:disabled{opacity:.45;cursor:not-allowed}
</style>
