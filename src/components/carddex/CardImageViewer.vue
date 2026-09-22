<script setup lang="ts">
import { computed, ref } from "vue";
import CarddexImage from "./CarddexImage.vue";
import type { CarddexLocale, DisplayCard } from "./types";
const props = defineProps<{ item: DisplayCard; locale: CarddexLocale }>();
const scale = ref(1);
const rotation = ref(0);
const fitted = ref(true);
const imageUrl = computed(
  () => props.item.print?.imageUrl || props.item.print?.ttsUrl || "",
);
function zoom(by: number): void {
  fitted.value = false;
  scale.value = Math.max(0.35, Math.min(4, scale.value + by));
}
function fit(): void {
  fitted.value = true;
  scale.value = 1;
  rotation.value = 0;
}
function closeWindow(): void {
  window.close();
}
async function download(): Promise<void> {
  const src = imageUrl.value;
  if (!src) return;
  try {
    const res = await fetch(src);
    if (!res.ok) throw new Error();
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${props.item.print?.cardNo || props.item.base.cardNo}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    window.open(src, "_blank", "noopener,noreferrer");
  }
}
</script>
<template>
  <div class="viewer">
    <header>
      <div>
        <small>{{ item.print?.cardNo || item.base.cardNo }}</small
        ><strong
          >{{ item.base.nameCn }} <span>{{ item.base.nameEn }}</span></strong
        >
      </div>
      <nav>
        <button @click="zoom(-0.2)">−</button
        ><button @click="zoom(0.2)">＋</button
        ><button @click="rotation = (rotation + 90) % 360">↻</button
        ><button @click="fit">{{ locale === "zh" ? "适应窗口" : "Fit" }}</button
        ><button @click="download">
          {{ locale === "zh" ? "下载原图" : "Download" }}</button
        ><button @click="closeWindow">✕</button>
      </nav>
    </header>
    <main :class="{ fitted }">
      <div
        class="image-wrap"
        :style="{ transform: `scale(${scale}) rotate(${rotation}deg)` }"
      >
        <CarddexImage
          :src="item.print?.imageUrl ?? ''"
          :fallback="item.print?.ttsUrl ?? ''"
          :alt="item.base.nameCn"
          :landscape="item.base.categories.includes('战场')"
          eager
        />
      </div>
    </main>
  </div>
</template>
<style scoped>
.viewer {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  flex-direction: column;
  background: #201f1d;
  color: #f7f4ec;
}
.viewer header {
  min-height: 58px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 8px 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.14);
  background: #292724;
}
.viewer header small {
  display: block;
  color: #c59b46;
  font-size: 9px;
  letter-spacing: 0.14em;
}
.viewer header strong {
  display: block;
  font-family: "Noto Serif SC", serif;
  font-size: 15px;
}
.viewer header strong span {
  margin-left: 6px;
  color: #aaa;
  font:
    400 11px Georgia,
    serif;
}
.viewer nav {
  display: flex;
  gap: 6px;
}
.viewer nav button {
  min-width: 34px;
  padding: 6px 9px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 6px;
  color: #eee;
  font-size: 11px;
}
.viewer main {
  flex: 1;
  overflow: auto;
  display: grid;
  place-items: center;
  padding: 24px;
}
.image-wrap {
  width: min(72vw, 744px);
  transform-origin: center;
  transition: transform 0.16s;
}
.viewer main.fitted .image-wrap {
  width: min(78vw, calc((100vh - 110px) * 0.7154));
}
@media (max-width: 650px) {
  .viewer header {
    align-items: flex-start;
    flex-direction: column;
  }
  .viewer nav {
    width: 100%;
    overflow-x: auto;
  }
  .viewer main {
    padding: 12px;
  }
  .image-wrap {
    width: 88vw;
  }
}
</style>
