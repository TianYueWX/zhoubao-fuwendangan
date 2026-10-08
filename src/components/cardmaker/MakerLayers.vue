<script setup lang="ts">
import { computed } from 'vue';
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, Lock, Unlock, Trash2 } from '@lucide/vue';
import {
  artBox,
  type ImageAsset,
  type ImageLayer,
  type MakerDocument,
} from '@/tools/cardmaker/model';
const props = defineProps<{
  document: MakerDocument;
  assets: ImageAsset[];
  selected: string;
  mode: 'images' | 'layers';
  compact?: boolean;
}>();
const emit = defineEmits<{
  select: [id: string];
  upload: [];
  duplicate: [id: string];
  remove: [id: string];
}>();
const layer = computed(() => props.document.layers.find((l) => l.id === props.selected));
const ordered = computed(() => [...props.document.layers].reverse());
const selectedAsset = computed(() => props.assets.find((a) => a.id === layer.value?.assetId));
function move(id: string, direction: number): void {
  const list = props.document.layers,
    index = list.findIndex((l) => l.id === id),
    next = index + direction;
  if (index >= 0 && next >= 0 && next < list.length) {
    const [item] = list.splice(index, 1);
    if (item) list.splice(next, 0, item);
  }
}
function resize(factor: number): void {
  const l = layer.value;
  if (!l || l.locked) return;
  const w = Math.max(1, Math.min(50000, l.width * factor)),
    h = Math.max(1, Math.min(50000, l.height * factor));
  l.x -= (w - l.width) / 2;
  l.y -= (h - l.height) / 2;
  l.width = w;
  l.height = h;
}
function fit(contain = false): void {
  const l = layer.value,
    a = selectedAsset.value;
  if (!l || !a || l.locked) return;
  const b = artBox(props.document.type),
    w = a.width * l.crop.width,
    h = a.height * l.crop.height,
    s = (contain ? Math.min : Math.max)(b.width / w, b.height / h);
  Object.assign(l, {
    x: b.x + (b.width - w * s) / 2,
    y: b.y + (b.height - h * s) / 2,
    width: w * s,
    height: h * s,
    rotation: 0,
  });
}
function position(dx: number, dy: number): void {
  if (layer.value && !layer.value.locked) {
    layer.value.x += dx;
    layer.value.y += dy;
  }
}
function number(key: 'x' | 'y' | 'width' | 'height' | 'rotation' | 'opacity', event: Event): void {
  if (!layer.value || layer.value.locked) return;
  const n = Number((event.target as HTMLInputElement).value);
  if (!Number.isFinite(n)) return;
  layer.value[key] =
    key === 'opacity'
      ? Math.max(0, Math.min(1, n / 100))
      : key === 'width' || key === 'height'
        ? Math.max(1, Math.min(50000, n))
        : Math.max(-36000, Math.min(36000, n));
}
function crop(key: keyof ImageLayer['crop'], event: Event): void {
  const l = layer.value;
  if (!l || l.locked) return;
  const n = Number((event.target as HTMLInputElement).value) / 100;
  if (!Number.isFinite(n)) return;
  const c = l.crop;
  c[key] = Math.max(key === 'width' || key === 'height' ? 0.001 : 0, Math.min(1, n));
  c.width = Math.min(c.width, 1 - c.x);
  c.height = Math.min(c.height, 1 - c.y);
  if (c.width <= 0) {
    c.x = 0.999;
    c.width = 0.001;
  }
  if (c.height <= 0) {
    c.y = 0.999;
    c.height = 0.001;
  }
}
</script>
<template>
  <div class="maker-layers">
    <header>
      <h2>{{ mode === 'layers' ? '图层' : '图片调整' }}</h2>
      <span>{{ document.layers.length }} / 30</span>
    </header>
    <button
      class="ml-add"
      type="button"
      :disabled="document.layers.length >= 30"
      @click="emit('upload')"
    >
      ＋ 添加图片
    </button>
    <p v-if="!document.layers.length" class="ml-hint">
      上传配图，从卡库载入，或添加透明 PNG 叠在卡框上。
    </p>
    <div v-if="mode === 'layers' || !layer" class="ml-stack" aria-label="图层列表，从上到下排列">
      <div v-for="l in ordered" :key="l.id" class="ml-row" :class="{ selected: selected === l.id }">
        <button type="button" class="ml-select" @click="emit('select', l.id)">
          <img :src="assets.find((a) => a.id === l.assetId)?.data" alt="" /><span
            >{{ l.name
            }}<small
              >{{ l.overlay ? '卡框上方' : '配图' }}{{ l.locked ? ' · 已锁定' : '' }}</small
            ></span
          >
        </button>
        <button
          type="button"
          :aria-label="l.visible ? '隐藏图层' : '显示图层'"
          @click="l.visible = !l.visible"
        >
          <Eye v-if="l.visible" :size="16" /><EyeOff v-else :size="16" />
        </button>
        <button
          type="button"
          :aria-label="l.locked ? '解锁图层' : '锁定图层'"
          @click="l.locked = !l.locked"
        >
          <Lock v-if="l.locked" :size="16" /><Unlock v-else :size="16" />
        </button>
      </div>
      <div class="ml-fixed">卡框与卡面文字 <Lock :size="12" /></div>
    </div>
    <template v-if="layer && !compact">
      <label>图层名称<input v-model="layer.name" maxlength="200" /></label>
      <div class="ml-actions">
        <button
          type="button"
          :disabled="document.layers.indexOf(layer) === document.layers.length - 1"
          @click="move(layer.id, 1)"
        >
          <ArrowUp :size="16" />上移</button
        ><button
          type="button"
          :disabled="document.layers.indexOf(layer) === 0"
          @click="move(layer.id, -1)"
        >
          <ArrowDown :size="16" />下移</button
        ><button
          type="button"
          :disabled="document.layers.length >= 30"
          @click="emit('duplicate', layer.id)"
        >
          <Copy :size="16" />复制</button
        ><button type="button" @click="emit('remove', layer.id)"><Trash2 :size="16" />删除</button>
      </div>
      <label
        >叠放位置<select v-model="layer.overlay" :disabled="layer.locked">
          <option :value="false">配图区（卡框下方）</option>
          <option :value="true">卡框上方（文字下方）</option>
        </select></label
      >
      <fieldset :disabled="layer.locked" class="ml-properties">
        <div class="ml-fit">
          <button type="button" @click="fit()">铺满配图区</button
          ><button type="button" @click="fit(true)">显示整张图片</button>
        </div>
        <div class="ml-nudge" aria-label="移动图片">
          <button type="button" @click="position(-5, 0)">←</button
          ><button type="button" @click="position(0, -5)">↑</button
          ><button type="button" @click="position(0, 5)">↓</button
          ><button type="button" @click="position(5, 0)">→</button
          ><button type="button" @click="resize(0.95)">－</button
          ><button type="button" @click="resize(1.05)">＋</button>
        </div>
        <div class="ml-grid">
          <label
            v-for="(name, key) in {
              x: '横向位置',
              y: '纵向位置',
              width: '宽度',
              height: '高度',
              rotation: '旋转角度',
              opacity: '不透明度 %',
            }"
            :key="key"
            >{{ name
            }}<input
              type="number"
              :step="key === 'rotation' ? 1 : 5"
              :value="Math.round(key === 'opacity' ? layer.opacity * 100 : layer[key])"
              @change="number(key, $event)"
          /></label>
        </div>
        <details>
          <summary>裁剪图片</summary>
          <div class="ml-crop-preview" v-if="selectedAsset">
            <img :src="selectedAsset.data" alt="完整原图" />
            <div
              :style="{
                left: `${layer.crop.x * 100}%`,
                top: `${layer.crop.y * 100}%`,
                width: `${layer.crop.width * 100}%`,
                height: `${layer.crop.height * 100}%`,
              }"
            />
          </div>
          <div class="ml-grid">
            <label
              v-for="(name, key) in {
                x: '左侧起点 %',
                y: '顶部起点 %',
                width: '保留宽度 %',
                height: '保留高度 %',
              }"
              :key="key"
              >{{ name
              }}<input
                type="number"
                min="0"
                max="100"
                :value="Math.round(layer.crop[key] * 100)"
                @change="crop(key, $event)"
            /></label>
          </div>
          <button
            type="button"
            class="ml-reset"
            @click="layer.crop = { x: 0, y: 0, width: 1, height: 1 }"
          >
            恢复完整图片
          </button>
        </details>
      </fieldset>
      <p class="ml-hint">
        {{
          layer.locked
            ? '图层已锁定，先在图层列表中解锁。'
            : '拖动配图可移动；两指缩放旋转，也可使用上面的精确调整。'
        }}
      </p>
    </template>
  </div>
</template>
<style scoped>
.maker-layers {
  display: grid;
  gap: 14px;
}
.maker-layers header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.maker-layers h2 {
  font-size: 17px;
  font-weight: 700;
}
.maker-layers header > span,
.ml-hint {
  color: var(--color-text-muted);
  font-size: 12px;
  line-height: 1.7;
}
.maker-layers button {
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.maker-layers button:disabled {
  opacity: 0.35;
}
.ml-add {
  border: 1px dashed var(--color-panel-border);
  font-size: 13px;
}
.ml-stack {
  display: grid;
  gap: 3px;
}
.ml-row {
  display: flex;
  align-items: center;
  border: 1px solid transparent;
  gap: 1px;
}
.ml-row.selected {
  border-color: var(--color-brand);
  background: var(--color-card-bg);
}
.ml-row > button:not(.ml-select) {
  min-width: 36px;
}
.ml-select {
  min-width: 0;
  flex: 1;
  text-align: left !important;
  justify-content: flex-start !important;
  padding: 5px;
  gap: 8px !important;
}
.ml-select img {
  width: 34px;
  height: 42px;
  object-fit: cover;
  background: #ccc;
}
.ml-select span {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ml-select small {
  display: block;
  color: var(--color-text-muted);
  font-size: 10px;
  margin-top: 4px;
}
.ml-fixed {
  display: flex;
  justify-content: space-between;
  border-block: 1px solid var(--color-panel-border);
  padding: 10px 8px;
  font-size: 11px;
  color: var(--color-text-muted);
}
label {
  display: grid;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
}
input,
select {
  min-width: 0;
  width: 100%;
  min-height: 44px;
  padding: 9px;
  border: 1px solid var(--color-panel-border);
  background: var(--color-card-bg);
  font-size: 13px;
  color: inherit;
}
.ml-actions {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 3px;
}
.ml-actions button {
  border: 1px solid var(--color-panel-border);
  font-size: 11px;
  flex-wrap: wrap;
}
.ml-properties {
  display: grid;
  gap: 14px;
  min-width: 0;
}
.ml-fit {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.ml-fit button,
.ml-reset {
  border: 1px solid var(--color-panel-border);
  font-size: 12px;
}
.ml-nudge {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 4px;
}
.ml-nudge button {
  background: var(--color-card-bg);
  border: 1px solid var(--color-panel-border);
  font-size: 18px;
}
.ml-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
summary {
  font-size: 12px;
  cursor: pointer;
  min-height: 40px;
  padding-top: 10px;
}
details[open] {
  display: grid;
}
.ml-crop-preview {
  position: relative;
  margin: 4px 0 12px;
  background: #292d33;
}
.ml-crop-preview img {
  width: 100%;
  display: block;
}
.ml-crop-preview > div {
  position: absolute;
  border: 2px solid #fbf7e6;
  box-shadow:
    0 0 0 1px #111,
    inset 0 0 0 1px #111;
  pointer-events: none;
}
.ml-reset {
  width: 100%;
  margin-top: 12px;
}
button:focus-visible,
input:focus-visible,
select:focus-visible,
summary:focus-visible {
  outline: 2px solid var(--color-brand);
  outline-offset: 2px;
}
@media (max-width: 700px) {
  input,
  textarea,
  select {
    font-size: 16px;
  }
}
</style>
