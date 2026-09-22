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
    landscape?: boolean;
    eager?: boolean;
  }>(),
  { fallback: "", landscape: false, eager: false },
);

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
  <div ref="host" class="carddex-image" :class="{ landscape }">
    <div v-if="!visible" class="image-placeholder"><span></span></div>
    <div v-else-if="failedAll || !remote" class="image-empty">
      {{ alt.slice(0, 8) }}
    </div>
    <img
      v-else
      :src="resolved"
      :alt="alt"
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
.carddex-image.landscape {
  aspect-ratio: 1040 / 744;
}
.landscape img {
  /*
   * Battlefield art is stored as the same portrait canvas as regular cards.
   * `cover` crops that canvas before rotation, so the left/right edges vanish.
   * Fit the complete portrait first, then scale by the portrait/landscape
   * ratio so the rotated result fills the 1040×744 frame.
   */
  object-fit: contain;
  transform: rotate(-90deg) scale(1.39785);
  transform-origin: center;
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
