<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  cacheViewedCardImage,
  enableCardImageCache,
  imageProxyUrl,
} from "./imageCache";

const props = withDefaults(
  defineProps<{
    src: string;
    fallback?: string;
    alt: string;
    /**
     * 卡图旋转角（度，CSS 约定，负值逆时针），由 card_prints.rotate_deg 驱动。
     * ±90 时框切成 1040×744 横版，0/180 保持 744×1040 竖版。
     */
    rotate?: number;
    eager?: boolean;
  }>(),
  { fallback: "", rotate: 0, eager: false },
);

/** 横版框的宽高比（744/1040 的倒数），旋转 90° 后按此比例放大铺满。 */
const FRAME_RATIO = 1040 / 744;

const turn = computed(() => {
  const deg = Number.isFinite(props.rotate) ? props.rotate : 0;
  return ((deg % 360) + 360) % 360;
});
const quarterTurn = computed(() => turn.value % 180 === 90);
const imgStyle = computed(() => {
  if (!turn.value) return undefined;
  /*
   * Battlefield art is stored on the same portrait canvas as regular cards.
   * Contain the whole canvas first, then scale by the frame ratio so the
   * rotated result fills the landscape frame instead of leaving bars.
   */
  const scale = quarterTurn.value ? FRAME_RATIO : 1;
  return {
    transform: `rotate(${turn.value}deg) scale(${scale})`,
    transformOrigin: "center",
  };
});

const host = ref<HTMLElement | null>(null);
const visible = ref(props.eager);
const failedPrimary = ref(false);
const failedAll = ref(false);
const cacheReady = ref(false);
let observer: IntersectionObserver | null = null;

const remote = computed(() =>
  failedPrimary.value && props.fallback ? props.fallback : props.src,
);
const resolved = computed(() =>
  cacheReady.value ? imageProxyUrl(remote.value) : remote.value,
);

watch(
  () => [props.src, props.fallback],
  () => {
    failedPrimary.value = false;
    failedAll.value = false;
  },
);
watch(
  () => [visible.value, remote.value] as const,
  ([isVisible, url]) => {
    if (isVisible && url) void cacheViewedCardImage(url);
  },
  { immediate: true },
);

function onError(): void {
  if (!failedPrimary.value && props.fallback && props.fallback !== props.src)
    failedPrimary.value = true;
  else failedAll.value = true;
}

onMounted(() => {
  void enableCardImageCache().then((ready) => {
    cacheReady.value = ready;
  });
  if (props.eager || !("IntersectionObserver" in window)) {
    visible.value = true;
    return;
  }
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        visible.value = true;
        observer?.disconnect();
      }
    },
    { rootMargin: "180px 0px", threshold: 0.01 },
  );
  if (host.value) observer.observe(host.value);
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <div ref="host" class="carddex-image" :class="{ 'quarter-turn': quarterTurn }">
    <div v-if="!visible" class="image-placeholder"><span></span></div>
    <div v-else-if="failedAll || !remote" class="image-empty">
      {{ alt.slice(0, 8) }}
    </div>
    <img
      v-else
      :src="resolved"
      :alt="alt"
      :style="imgStyle"
      :loading="eager ? 'eager' : 'lazy'"
      @error="onError"
    />
  </div>
</template>

<style scoped>
.carddex-image {
  width: 100%;
  aspect-ratio: 744 / 1040;
  background: rgba(59, 74, 90, 0.07);
  overflow: hidden;
}
.carddex-image.quarter-turn {
  aspect-ratio: 1040 / 744;
}
img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
.image-placeholder,
.image-empty {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  color: var(--color-text-subtle);
  font-size: 11px;
}
.image-placeholder span {
  width: 28px;
  height: 2px;
  background: var(--color-panel-border);
  animation: pulse 1.2s ease-in-out infinite;
}
@keyframes pulse {
  50% {
    width: 52px;
    background: var(--color-brand-faint);
  }
}
</style>
