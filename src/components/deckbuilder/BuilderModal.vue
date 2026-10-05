<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue';
defineProps<{ title: string; wide?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLDialogElement>();
let previous: HTMLElement | null = null;
onMounted(() => { previous = document.activeElement as HTMLElement; dialog.value?.showModal(); });
onBeforeUnmount(() => { dialog.value?.close(); previous?.focus(); });
function backdrop(event: MouseEvent): void {
  if (event.target !== dialog.value) return;
  const rect = dialog.value.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) emit('close');
}
</script>
<template>
  <Teleport to="body"><dialog ref="dialog" class="builder-modal" :class="{ wide }" :aria-label="title" @cancel.prevent="emit('close')" @click="backdrop">
    <header><h2>{{ title }}</h2><button type="button" aria-label="关闭" @click="emit('close')">×</button></header>
    <div class="modal-content"><slot /></div><footer v-if="$slots.footer"><slot name="footer" /></footer>
  </dialog></Teleport>
</template>
<style>
.builder-modal{margin:auto;width:min(720px,calc(100% - 32px));max-height:90dvh;padding:0;border:1px solid var(--color-panel-border);background:var(--color-page-bg);color:var(--color-text-primary);box-shadow:0 18px 90px #0004;overflow:auto}.builder-modal.wide{width:min(1040px,calc(100% - 32px))}.builder-modal::backdrop{background:#24201dcc;backdrop-filter:blur(3px)}.builder-modal>header{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;background:var(--color-card-bg);padding:14px 22px;border-bottom:1px solid var(--color-panel-border)}.builder-modal h2{font:700 22px "Noto Serif SC",serif}.builder-modal>header button{width:44px;height:44px;font-size:28px}.modal-content{padding:22px}.builder-modal>footer{padding:14px 22px;border-top:1px solid var(--color-panel-border);background:var(--color-card-bg);display:flex;justify-content:flex-end;gap:10px;position:sticky;bottom:0}.builder-modal button:focus-visible,.builder-modal input:focus-visible,.builder-modal textarea:focus-visible,.builder-modal select:focus-visible{outline:2px solid var(--color-brand);outline-offset:2px}.builder-modal .b-btn{padding:9px 14px;border:1px solid var(--color-panel-border);min-height:40px}.builder-modal .b-primary{background:var(--color-brand);color:var(--color-brand-ink);border-color:var(--color-brand)}.builder-modal input,.builder-modal textarea,.builder-modal select{border:1px solid var(--color-panel-border);padding:9px;background:var(--color-card-bg);color:inherit}.builder-modal .b-error{color:var(--color-brand);white-space:pre-wrap;overflow-wrap:anywhere}.builder-modal .b-hint{color:var(--color-text-muted);font-size:13px;line-height:1.7;margin:12px 0}.builder-modal .b-tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px}.builder-modal .b-tabs .active{background:var(--color-brand);color:var(--color-brand-ink)}@media(max-width:700px){.builder-modal,.builder-modal.wide{width:100%;max-width:none;height:100dvh;max-height:100dvh;border:0}.modal-content{padding:16px}.builder-modal>header{padding:8px 16px}}
</style>
