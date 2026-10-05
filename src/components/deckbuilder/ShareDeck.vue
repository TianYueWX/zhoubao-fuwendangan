<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import BuilderModal from './BuilderModal.vue';
import { encodeSnapshot, exportCode, exportText, exportTTS } from '@/tools/deckbuilder/formats';
import { buildDeckImage } from '@/tools/deckbuilder/image';
import { ZONES, normalizeCode, resolveEntry, type BuilderDeck, type CardIndex } from '@/tools/deckbuilder/model';
const props = defineProps<{ deck: BuilderDeck; index: CardIndex; problems: number }>();
const emit = defineEmits<{ close: [] }>();
const tabs = ['快照链接', '卡组图片', 'TTS 码', '通用卡组码', '文字清单'];
const tab = ref(0), output = ref(''), error = ref(''), status = ref(''), busy = ref(false), imageUrl = ref('');
const missingSC = computed(() => [...new Set(ZONES.flatMap(z=>props.deck.zones[z]).filter(e=>!resolveEntry(e,props.index).record?.prints.some(p=>normalizeCode(p.cardNo)===normalizeCode(e.printNo)&&p.language==='SC')).map(e=>`${e.name}（${e.printNo}）`))]);
let generation = 0;
watch(tab, async () => {
  const current = ++generation; error.value = ''; status.value = ''; output.value = ''; busy.value = true;
  try {
    let text = '';
    if (tab.value === 0) { const snapshot = await encodeSnapshot(props.deck); const url = new URL(location.href); url.hash = `/builder/share?s=${snapshot}`; text = url.href; }
    if (tab.value === 1 && !imageUrl.value) { const result = await buildDeckImage(props.deck, props.index, props.problems); if (generation !== current) return; imageUrl.value = URL.createObjectURL(result.blob); status.value = result.missing ? `${result.missing} 张卡图未能下载，图片保留卡名和编号。` : '图片已生成，可预览后下载。'; }
    if (tab.value === 2) text = exportTTS(props.deck);
    if (tab.value === 3) text = exportCode(props.deck);
    if (tab.value === 4) text = exportText(props.deck);
    if (generation === current) output.value = text;
  } catch (e) { if (generation === current) error.value = e instanceof Error ? e.message : String(e); }
  finally { if (generation === current) busy.value = false; }
}, { immediate: true });
async function copy(): Promise<void> {
  try { await navigator.clipboard.writeText(output.value); status.value = '已复制'; }
  catch { status.value = '请选中文字后手动复制'; }
}
onBeforeUnmount(() => { generation++; if (imageUrl.value) URL.revokeObjectURL(imageUrl.value); });
</script>
<template><BuilderModal title="分享构筑" wide @close="emit('close')">
  <div class="b-tabs"><button v-for="(label,i) in tabs" :key="label" class="b-btn" :class="{active:tab===i}" @click="tab=i">{{ label }}</button></div>
  <p class="b-hint">分享的是当前构筑，包含未保存的修改。{{ problems ? `当前有 ${problems} 项构筑问题，仍可分享。` : '' }}</p>
  <p v-if="tab===0" class="b-hint">链接包含卡组快照，无需登录。接收者先浏览，再复制到自己的卡组库；你的后续修改不会改变这个链接。</p>
  <p v-if="tab===2" class="b-hint">TTS 按传奇、英雄、主牌、战场、符文、额外传奇、备牌排序，每张牌一个 token。TTS 不能记录语言；不完整分区或额外传奇可能需要在目标软件中调整位置。</p>
  <p v-if="tab===2&&missingSC.length" class="b-error">以下印版暂无可匹配的简中记录，请核对目标 TTS 卡表：{{missingSC.join('、')}}。导出保留所选卡号。</p>
  <p v-if="tab===3" class="b-hint">使用社区通用格式，额外传奇使用 v6。此格式不记录名称、说明或语言，也无法保留任意实验分区；完整保存请用快照或文字清单。</p>
  <p v-if="busy" class="b-hint">{{ tab===1 ? '正在生成卡组图片…' : '正在准备…' }}</p><p v-if="error" role="alert" class="b-error">{{ error }}</p>
  <textarea v-if="tab!==1 && output" :value="output" readonly aria-label="分享内容" class="share-output" @focus="($event.target as HTMLTextAreaElement).select()" />
  <img v-if="tab===1 && imageUrl" class="share-image" :src="imageUrl" alt="卡组图片预览" />
  <p v-if="status" role="status" class="b-hint">{{ status }}</p>
  <template #footer><button class="b-btn" @click="emit('close')">关闭</button><a v-if="tab===1 && imageUrl" class="b-btn b-primary" :href="imageUrl" :download="`${deck.name}.png`">下载图片</a><button v-if="tab!==1" class="b-btn b-primary" :disabled="!output || busy" @click="copy">复制{{ tab===0?'链接':'内容' }}</button></template>
</BuilderModal></template>
<style scoped>.share-output{width:100%;min-height:260px;resize:vertical;font:13px/1.7 monospace;overflow-wrap:anywhere}.share-image{width:100%;height:auto;border:1px solid var(--color-panel-border)}</style>
