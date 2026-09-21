<script setup lang="ts">
import { onMounted, ref } from 'vue';
import QRCode from 'qrcode';
const props = defineProps<{ url: string; error: string }>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'export-json'): void }>();
const qr = ref('');
const qrError = ref('');
const message = ref('');
const linkField = ref<HTMLTextAreaElement | null>(null);
const closeButton = ref<HTMLButtonElement | null>(null);
onMounted(async () => {
  closeButton.value?.focus();
  if (!props.url) return;
  try { qr.value = await QRCode.toDataURL(props.url, { errorCorrectionLevel: 'L', width: 360, margin: 4 }); }
  catch { qrError.value = '内容较多，无法生成二维码。请复制链接或导出 JSON。'; }
});
async function copy(): Promise<void> {
  try { await navigator.clipboard.writeText(props.url); message.value = '链接已复制'; }
  catch { linkField.value?.focus(); linkField.value?.select(); message.value = '请按 Ctrl+C 复制已选中的链接'; }
}
</script>
<template>
  <div class="share-mask" @click.self="emit('close')">
    <section class="share-dialog" role="dialog" aria-modal="true" aria-labelledby="chain-share-title">
      <header><h3 id="chain-share-title">分享当前棋盘</h3><button ref="closeButton" aria-label="关闭分享" @click="emit('close')">×</button></header>
      <p>分享当前棋盘；包含快照历史请使用导出 JSON。</p>
      <template v-if="url">
        <label for="chain-share-link">分享链接</label>
        <textarea id="chain-share-link" ref="linkField" :value="url" readonly rows="3" />
        <button class="share-copy" @click="copy">复制链接</button>
        <img v-if="qr" class="share-qr" :src="qr" alt="当前棋盘的分享二维码" />
        <p v-else>{{ qrError || '正在生成二维码…' }}</p>
      </template>
      <p v-if="error" role="alert">{{ error }}</p>
      <p role="status">{{ message }}</p>
      <button @click="emit('export-json')">导出 JSON（含快照）</button>
    </section>
  </div>
</template>
<style scoped>
.share-mask { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; padding: 16px; background: #0006; }
.share-dialog { width: min(440px, 100%); max-height: calc(100vh - 32px); overflow: auto; padding: 20px; border: 1px solid var(--color-panel-border); border-radius: 12px; background: var(--color-panel-bg); color: var(--color-text-primary); display: flex; flex-direction: column; gap: 12px; }
header { display: flex; align-items: center; justify-content: space-between; font-weight: 700; }
header button { font-size: 20px; }
p, label { font-size: 12px; color: var(--color-text-muted); }
textarea { width: 100%; resize: vertical; padding: 8px; border: 1px solid var(--color-panel-border); border-radius: 6px; background: var(--color-card-bg); font-size: 11px; }
button { padding: 6px 10px; border: 1px solid var(--color-panel-border); border-radius: 6px; }
.share-copy { background: var(--color-brand); color: var(--color-brand-ink); }
.share-qr { width: min(360px, 100%); align-self: center; image-rendering: pixelated; }
</style>
