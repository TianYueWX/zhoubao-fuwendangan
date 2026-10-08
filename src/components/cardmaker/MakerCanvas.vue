<script setup lang="ts">
import {
  computed,
  markRaw,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from 'vue';
import {
  Stage as VStage,
  Layer as VLayer,
  Group as VGroup,
  Image as VImage,
  Shape as VShape,
  Transformer as VTransformer,
  type VueKonvaRef,
} from 'vue-konva';
import type Konva from 'konva';
import type { CardIcon } from '@/components/carddex/types';
import {
  dimensions,
  type ImageAsset,
  type ImageLayer,
  type MakerDocument,
} from '@/tools/cardmaker/model';
import { basicIcons, loadFonts, loadFrame, loadImage } from '@/tools/cardmaker/assets';
import {
  drawBase,
  drawFrame,
  drawText,
  effectLayout,
  profile,
  renderCard,
  type RenderResources,
} from '@/tools/cardmaker/render';
const props = defineProps<{
  document: MakerDocument;
  assets: ImageAsset[];
  selected: string;
  icons: CardIcon[];
  readOnly?: boolean;
}>();
const emit = defineEmits<{
  select: [id: string];
  transform: [id: string, patch: Partial<ImageLayer>];
  ready: [value: boolean];
  error: [message: string];
  overflow: [value: boolean];
}>();
const host = ref<HTMLElement>(),
  stage = ref<VueKonvaRef>(),
  transformer = ref<VueKonvaRef>();
const resources = shallowRef<RenderResources>();
const bounds = ref({ width: 400, height: 620 });
const size = computed(() => dimensions(props.document.type));
const scale = computed(() =>
  Math.min(
    (bounds.value.width - 36) / size.value.width,
    (bounds.value.height - 36) / size.value.height,
  ),
);
const stageConfig = computed(() => ({
  width: Math.max(1, size.value.width * scale.value),
  height: Math.max(1, size.value.height * scale.value),
  scaleX: scale.value,
  scaleY: scale.value,
}));
const imageConfig = (l: ImageLayer) => {
  const image = resources.value?.images.get(l.assetId);
  return {
    id: l.id,
    image,
    x: l.x,
    y: l.y,
    width: l.width,
    height: l.height,
    rotation: l.rotation,
    opacity: l.opacity,
    visible: l.visible,
    draggable: !l.locked && !props.readOnly,
    listening: !l.locked && !props.readOnly,
    crop: image
      ? {
          x: l.crop.x * image.naturalWidth,
          y: l.crop.y * image.naturalHeight,
          width: l.crop.width * image.naturalWidth,
          height: l.crop.height * image.naturalHeight,
        }
      : undefined,
  };
};
let observer: ResizeObserver | undefined,
  request = 0;
let pinch:
  | {
      id: string;
      x: number;
      y: number;
      width: number;
      height: number;
      rotation: number;
      distance: number;
      angle: number;
      centerX: number;
      centerY: number;
      node: Konva.Node;
    }
  | undefined;
function gesture(event: TouchEvent): void {
  if (event.touches.length !== 2 || props.readOnly) return;
  const l = props.document.layers.find((l) => l.id === props.selected && !l.locked && l.visible),
    s = stage.value?.getNode() as Konva.Stage | undefined;
  if (!l || !s) return;
  const node = s.findOne((n: Konva.Node) => n.id() === l.id);
  if (!node) return;
  event.preventDefault();
  const a = event.touches[0]!,
    b = event.touches[1]!;
  const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
    angle = Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX);
  const rect = s.container().getBoundingClientRect(),
    centerX = ((a.clientX + b.clientX) / 2 - rect.left) / scale.value,
    centerY = ((a.clientY + b.clientY) / 2 - rect.top) / scale.value;
  if (!pinch) {
    node.stopDrag();
    pinch = { ...l, distance, angle, centerX, centerY, node };
    return;
  }
  const zoom = Math.max(0.1, Math.min(10, distance / Math.max(1, pinch.distance))),
    rotation = pinch.rotation + ((angle - pinch.angle) * 180) / Math.PI;
  const dx = (pinch.x - pinch.centerX) * zoom,
    dy = (pinch.y - pinch.centerY) * zoom;
  const turn = angle - pinch.angle;
  node.position({
    x: centerX + dx * Math.cos(turn) - dy * Math.sin(turn),
    y: centerY + dx * Math.sin(turn) + dy * Math.cos(turn),
  });
  node.width(Math.max(1, pinch.width * zoom));
  node.height(Math.max(1, pinch.height * zoom));
  node.rotation(rotation);
  transformer.value?.getNode().getLayer()?.batchDraw();
}
function endGesture(): void {
  if (!pinch) return;
  const { id, node } = pinch;
  pinch = undefined;
  emit('transform', id, {
    x: node.x(),
    y: node.y(),
    width: node.width(),
    height: node.height(),
    rotation: node.rotation(),
  });
}
function updateTransformer(): void {
  const s = stage.value?.getNode() as Konva.Stage | undefined,
    t = transformer.value?.getNode() as Konva.Transformer | undefined;
  if (!s || !t) return;
  const layer = props.readOnly
    ? undefined
    : props.document.layers.find((l) => l.id === props.selected && l.visible && !l.locked);
  const node = layer ? s.findOne((n: Konva.Node) => n.id() === layer.id) : undefined;
  t.nodes(node ? [node] : []);
  t.getLayer()?.batchDraw();
}
async function prepare(): Promise<void> {
  const version = ++request;
  emit('ready', false);
  try {
    const [frame, pairs] = await Promise.all([
      loadFrame(props.document.type, props.document.rarity),
      Promise.all(props.assets.map(async (a) => [a.id, markRaw(await loadImage(a.data))] as const)),
      loadFonts(),
    ]);
    const icons = await basicIcons(profile(props.document).dark);
    await Promise.all(
      ['red', 'blue', 'purple', 'green', 'orange', 'yellow'].map(async (color) => {
        icons.set(color, markRaw(await loadImage(`${import.meta.env.BASE_URL}runes/${color}.svg`)));
      }),
    );
    // Only icons used in this effect are fetched; unavailable symbols remain visible as text.
    const effect = props.document.copy[props.document.language].effect;
    const selectedIcons = new Map<string, CardIcon>();
    for (const i of props.icons.filter((i) => effect.includes(i.name))) {
      if (!selectedIcons.has(i.name) || i.isWhite === profile(props.document).dark)
        selectedIcons.set(i.name, i);
    }
    await Promise.all(
      [...selectedIcons.values()].slice(0, 40).map(async (i) => {
        try {
          icons.set(i.name, markRaw(await loadImage(i.url)));
        } catch {
          /* readable fallback */
        }
      }),
    );
    if (version !== request) return;
    resources.value = { frame: markRaw(frame), images: new Map(pairs), icons };
    await nextTick();
    updateTransformer();
    emit('ready', true);
  } catch (error) {
    if (version === request) emit('error', error instanceof Error ? error.message : String(error));
  }
}
watch(
  () => [
    props.document.type,
    props.document.rarity,
    props.assets.map((a) => a.id).join(','),
    props.icons.length,
    props.document.copy[props.document.language].effect.match(/\{\{[^{}]+\}\}/g)?.join(','),
  ],
  () => {
    void prepare();
  },
);
watch(
  () => [props.selected, props.document.layers, props.readOnly],
  () => {
    void nextTick(updateTransformer);
  },
  { deep: true },
);
watch(
  () => [props.document, resources.value],
  () => {
    if (resources.value) {
      const ctx = document.createElement('canvas').getContext('2d');
      if (ctx) emit('overflow', effectLayout(ctx, props.document, resources.value).overflow);
    }
    void nextTick(() => {
      const s = stage.value?.getNode() as Konva.Stage | undefined;
      s?.getLayers().forEach((l) => l.batchDraw());
    });
  },
  { deep: true },
);
onMounted(() => {
  observer = new ResizeObserver((entries) => {
    const r = entries[0]?.contentRect;
    if (r) bounds.value = { width: Math.max(80, r.width), height: Math.max(80, r.height) };
  });
  if (host.value) {
    observer.observe(host.value);
    host.value.addEventListener('touchstart', gesture, { passive: false });
    host.value.addEventListener('touchmove', gesture, { passive: false });
    host.value.addEventListener('touchend', endGesture);
    host.value.addEventListener('touchcancel', endGesture);
  }
  void prepare();
});
onBeforeUnmount(() => {
  request++;
  observer?.disconnect();
  host.value?.removeEventListener('touchstart', gesture);
  host.value?.removeEventListener('touchmove', gesture);
  host.value?.removeEventListener('touchend', endGesture);
  host.value?.removeEventListener('touchcancel', endGesture);
});
function transform(event: Konva.KonvaEventObject<Event>): void {
  if (pinch) return;
  const n = event.target;
  const patch = {
    x: n.x(),
    y: n.y(),
    width: Math.max(1, n.width() * n.scaleX()),
    height: Math.max(1, n.height() * n.scaleY()),
    rotation: n.rotation(),
  };
  n.scaleX(1);
  n.scaleY(1);
  emit('transform', n.id(), patch);
}
function canvas(pixelRatio = 2): HTMLCanvasElement {
  if (!resources.value) throw new Error('卡面正在加载，请稍后再试。');
  return renderCard(props.document, resources.value, pixelRatio);
}
function baseScene(c: Konva.Context): void {
  drawBase(c._context, props.document);
}
function frameScene(c: Konva.Context): void {
  if (resources.value) drawFrame(c._context, props.document, resources.value);
}
function textScene(c: Konva.Context): void {
  if (resources.value) drawText(c._context, props.document, resources.value);
}
function boundBox(
  oldBox: { x: number; y: number; width: number; height: number; rotation: number },
  newBox: { x: number; y: number; width: number; height: number; rotation: number },
) {
  return Math.abs(newBox.width) < 12 || Math.abs(newBox.height) < 12 ? oldBox : newBox;
}
defineExpose({ canvas, retry: prepare });
</script>
<template>
  <div
    ref="host"
    class="maker-canvas"
    aria-label="卡面预览，点击图片可选择图层，拖动可移动，两指可缩放旋转"
  >
    <VStage
      v-if="resources"
      ref="stage"
      :config="stageConfig"
      @mousedown="
        (e) => {
          if (e.target === e.target.getStage()) emit('select', '');
        }
      "
      @touchstart="
        (e) => {
          if (e.target === e.target.getStage()) emit('select', '');
        }
      "
    >
      <VLayer>
        <VShape :config="{ listening: false, sceneFunc: baseScene }" />
        <VGroup :config="{ clipX: 0, clipY: 0, clipWidth: size.width, clipHeight: size.height }">
          <VImage
            v-for="l in document.layers.filter((l) => !l.overlay)"
            :key="l.id"
            :config="imageConfig(l)"
            @mousedown="emit('select', l.id)"
            @touchstart="emit('select', l.id)"
            @dragend="transform"
            @transformend="transform"
          />
        </VGroup>
        <VShape :config="{ listening: false, sceneFunc: frameScene }" />
        <VGroup :config="{ clipX: 0, clipY: 0, clipWidth: size.width, clipHeight: size.height }">
          <VImage
            v-for="l in document.layers.filter((l) => l.overlay)"
            :key="l.id"
            :config="imageConfig(l)"
            @mousedown="emit('select', l.id)"
            @touchstart="emit('select', l.id)"
            @dragend="transform"
            @transformend="transform"
          />
        </VGroup>
        <VShape :config="{ listening: false, sceneFunc: textScene }" />
      </VLayer>
      <VLayer
        ><VTransformer
          ref="transformer"
          :config="{
            keepRatio: true,
            flipEnabled: false,
            rotateEnabled: true,
            anchorSize: 14,
            anchorCornerRadius: 2,
            padding: 2,
            borderStroke: '#f5f2e7',
            anchorStroke: '#222',
            anchorFill: '#f5f2e7',
            enabledAnchors: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
            boundBoxFunc: boundBox,
          }"
      /></VLayer>
    </VStage>
    <p v-else class="canvas-loading" role="status">正在准备卡框和字体…</p>
  </div>
</template>
<style scoped>
.maker-canvas {
  width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  touch-action: none;
}
.maker-canvas :deep(.konvajs-content) {
  box-shadow: 0 12px 36px #0007;
}
.canvas-loading {
  color: #d4d8da;
  font-size: 14px;
}
</style>
