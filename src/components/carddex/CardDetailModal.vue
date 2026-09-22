<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import CarddexImage from "./CarddexImage.vue";
import { printKey } from "./data";
import type {
  CardIcon,
  CardPrint,
  CardRecord,
  CarddexLocale,
  DisplayCard,
} from "./types";

const props = defineProps<{
  item: DisplayCard | null;
  record: CardRecord | null;
  locale: CarddexLocale;
  icons: CardIcon[];
  isPinned: (p: CardPrint) => boolean;
  canPrev: boolean;
  canNext: boolean;
}>();
const emit = defineEmits<{
  close: [];
  prev: [];
  next: [];
  pin: [print: CardPrint];
  viewer: [print: CardPrint];
}>();
const selectedKey = ref("");
const selected = computed(
  () =>
    props.record?.prints.find((p) => printKey(p) === selectedKey.value) ??
    props.item?.print ??
    null,
);
const landscape = computed(
  () => props.item?.base.categories.includes("战场") ?? false,
);
const versionGroups = computed(() => {
  const groups = new Map<string, CardPrint[]>();
  const ordered = [...(props.record?.prints ?? [])].sort(
    (a, b) =>
      b.printOrder - a.printOrder ||
      a.cardNo.localeCompare(b.cardNo, undefined, { numeric: true }) ||
      (a.language === "SC"
        ? -1
        : b.language === "SC"
          ? 1
          : a.language.localeCompare(b.language)),
  );
  for (const print of ordered) {
    const group = groups.get(print.cardNo) ?? [];
    group.push(print);
    groups.set(print.cardNo, group);
  }
  return [...groups.entries()].map(([cardNo, prints]) => ({ cardNo, prints }));
});
const currentVersion = computed(
  () =>
    versionGroups.value.find(
      (group) => group.cardNo === selected.value?.cardNo,
    ) ??
    versionGroups.value[0] ??
    null,
);
const languagePrints = computed(() => currentVersion.value?.prints ?? []);

function chooseVersion(group: { cardNo: string; prints: CardPrint[] }): void {
  const language = selected.value?.language;
  const next =
    group.prints.find((p) => p.language === language) ??
    group.prints.find((p) => p.language === "SC") ??
    group.prints.find((p) => p.isDefault) ??
    group.prints[0];
  if (next) selectedKey.value = printKey(next);
}

function versionPreview(group: {
  cardNo: string;
  prints: CardPrint[];
}): CardPrint {
  return (
    group.prints.find((p) => p.language === selected.value?.language) ??
    group.prints.find((p) => p.language === "SC") ??
    group.prints[0]!
  );
}

watch(
  () => props.item?.key,
  () => {
    selectedKey.value = props.item?.print ? printKey(props.item.print) : "";
  },
  { immediate: true },
);

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] ?? c,
  );
}
function rich(raw: string): string {
  if (!raw) return "";
  const iconMap = new Map(props.icons.map((i) => [i.name, i]));
  const hasHtml = /<\/?[a-z][\s\S]*>/i.test(raw);
  let safe = esc(raw).replace(/\n/g, "<br>");
  if (hasHtml) {
    const doc = new DOMParser().parseFromString(raw, "text/html");
    const allowed = new Set([
      "P",
      "BR",
      "STRONG",
      "EM",
      "B",
      "I",
      "UL",
      "OL",
      "LI",
    ]);
    for (const el of [...doc.body.querySelectorAll("*")]) {
      if (!allowed.has(el.tagName))
        el.replaceWith(document.createTextNode(el.textContent ?? ""));
      else for (const attr of [...el.attributes]) el.removeAttribute(attr.name);
    }
    safe = doc.body.innerHTML;
  }
  safe = safe.replace(/\{\{([^}]+)\}\}/g, (_m, name: string) => {
    const clean = name.trim();
    const icon = iconMap.get(clean);
    const iconClass = icon?.isWhite
      ? "effect-icon white-source"
      : "effect-icon";
    return icon
      ? `<img class="${iconClass}" src="${esc(icon.url)}" alt="${esc(clean)}">`
      : `<strong>${esc(clean)}</strong>`;
  });
  return safe;
}

function onKey(e: KeyboardEvent): void {
  if (!props.item) return;
  if (e.key === "Escape") emit("close");
  else if (e.key === "ArrowLeft" && props.canPrev) emit("prev");
  else if (e.key === "ArrowRight" && props.canNext) emit("next");
}
onMounted(() => window.addEventListener("keydown", onKey));
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <Teleport to="body">
    <div
      v-if="item && record"
      class="detail-backdrop"
      role="presentation"
      @mousedown.self="emit('close')"
    >
      <section
        class="detail-dialog"
        role="dialog"
        aria-modal="true"
        :aria-label="item.base.nameCn"
      >
        <header class="detail-mobile-head">
          <button type="button" @click="emit('close')">←</button>
          <strong>{{
            locale === "zh"
              ? item.base.nameCn
              : item.base.nameEn || item.base.nameCn
          }}</strong>
          <button
            v-if="selected"
            type="button"
            :class="{ pinned: isPinned(selected) }"
            @click="emit('pin', selected)"
          >
            ◆
          </button>
        </header>

        <div class="detail-art-column">
          <button
            v-if="selected"
            class="detail-art"
            type="button"
            @click="emit('viewer', selected)"
          >
            <CarddexImage
              :src="selected.imageUrl"
              :fallback="selected.ttsUrl"
              :alt="item.base.nameCn"
              :landscape="landscape"
              eager
            />
            <!-- <span>{{
              locale === "zh" ? "新标签页查看原图" : "Open image in new tab"
            }}</span> -->
          </button>
          <div v-else class="detail-no-art">No image</div>
          <div
            v-if="languagePrints.length"
            class="language-switch"
            :aria-label="locale === 'zh' ? '卡图语言' : 'Card language'"
          >
            <button
              v-for="p in languagePrints"
              :key="printKey(p)"
              type="button"
              :class="{ active: printKey(p) === selectedKey }"
              @click="selectedKey = printKey(p)"
            >
              {{ p.language }}
            </button>
          </div>
          <div v-if="versionGroups.length > 1" class="print-versions">
            <div class="print-strip">
              <button
                v-for="group in versionGroups"
                :key="group.cardNo"
                type="button"
                :class="{ active: group.cardNo === currentVersion?.cardNo }"
                :title="group.cardNo"
                @click="chooseVersion(group)"
              >
                <CarddexImage
                  :src="versionPreview(group).imageUrl"
                  :fallback="versionPreview(group).ttsUrl"
                  :alt="group.cardNo"
                  :landscape="landscape"
                />
                <small>{{ group.cardNo }}</small>
              </button>
            </div>
          </div>
        </div>

        <div class="detail-info">
          <div class="detail-actions">
            <button type="button" :disabled="!canPrev" @click="emit('prev')">
              ← {{ locale === "zh" ? "上一张" : "Previous" }}
            </button>
            <button
              v-if="selected"
              type="button"
              :class="{ pinned: isPinned(selected) }"
              @click="emit('pin', selected)"
            >
              ◆
              {{
                isPinned(selected)
                  ? locale === "zh"
                    ? "已标记"
                    : "Pinned"
                  : "点击标记"
              }}
            </button>
            <button type="button" :disabled="!canNext" @click="emit('next')">
              {{ locale === "zh" ? "下一张" : "Next" }} →
            </button>
            <button class="close" type="button" @click="emit('close')">
              ✕
            </button>
          </div>
          <div class="detail-summary">
            <div class="detail-heading">
              <div class="detail-title">
                <p>{{ selected?.cardNo || item.base.cardNo }}</p>
                <h2>
                  {{ item.base.nameCn }}
                  <small>{{ item.base.subtitleCn }}</small>
                </h2>
                <h3>
                  {{ item.base.nameEn }}
                  <small>{{ item.base.subtitleEn }}</small>
                </h3>
              </div>
              <div class="chips">
                <span v-if="selected?.series || item.base.series">{{
                  selected?.series || item.base.series
                }}</span>
                <span v-if="selected?.rarity || item.base.rarity"
                  >{{ selected?.rarity || item.base.rarity
                  }}<template v-if="selected?.extendedRarity">
                    · {{ selected.extendedRarity }}</template
                  ></span
                >
                <span v-for="c in item.base.categories" :key="c">{{ c }}</span>
                <span v-for="c in item.base.colors" :key="`color-${c}`">{{
                  c
                }}</span>
                <span v-for="r in item.base.regions" :key="r">{{ r }}</span>
                <span v-if="item.base.championTag"
                  >{{ locale === "zh" ? "英雄" : "Champion" }} ·
                  {{ item.base.championTag }}</span
                >
                <span v-if="item.base.deckLimit != null"
                  >{{ locale === "zh" ? "构筑上限" : "Deck limit" }} ·
                  {{
                    item.base.deckLimit === 0 ? "∞" : item.base.deckLimit
                  }}</span
                >
                <span v-if="selected?.isPromo">Promo</span>
                <span v-if="item.base.banned" class="danger">{{
                  locale === "zh" ? "禁用中" : "Banned"
                }}</span>
              </div>
            </div>
            <dl class="stats">
              <div>
                <dt>{{ locale === "zh" ? "法力" : "Energy" }}</dt>
                <dd>{{ item.base.energy ?? "—" }}</dd>
              </div>
              <div>
                <dt>{{ locale === "zh" ? "符能" : "Rune" }}</dt>
                <dd>{{ item.base.returnEnergy ?? "—" }}</dd>
              </div>
              <div>
                <dt>{{ locale === "zh" ? "战力" : "Power" }}</dt>
                <dd>{{ item.base.power ?? "—" }}</dd>
              </div>
            </dl>
          </div>
          <section
            v-if="item.base.effectCn || item.base.effectEn"
            class="copy-block"
          >
            <h4>{{ locale === "zh" ? "卡牌效果" : "Card text" }}</h4>
            <div
              v-if="item.base.effectCn"
              class="effect"
              v-html="rich(item.base.effectCn)"
            ></div>
            <div
              v-if="item.base.effectEn"
              class="effect secondary"
              v-html="rich(item.base.effectEn)"
            ></div>
          </section>
          <section
            v-if="
              item.base.tags.length ||
              item.base.keywords.length ||
              item.base.advancedTags.length
            "
            class="copy-block"
          >
            <h4>
              {{ locale === "zh" ? "标签与关键词" : "Tags and keywords" }}
            </h4>
            <div class="chips subtle">
              <span
                v-for="x in [
                  ...item.base.keywords,
                  ...item.base.tags,
                  ...item.base.advancedTags,
                ]"
                :key="x"
                >{{ x }}</span
              >
            </div>
          </section>
          <section
            v-if="
              selected?.flavorCn ||
              item.base.flavorCn ||
              selected?.flavorEn ||
              item.base.flavorEn
            "
            class="copy-block flavor"
          >
            <h4>{{ locale === "zh" ? "风味文本" : "Flavor text" }}</h4>
            <p>{{ selected?.flavorCn || item.base.flavorCn }}</p>
            <p class="secondary">
              {{ selected?.flavorEn || item.base.flavorEn }}
            </p>
          </section>
          <footer class="print-meta">
            <span v-if="selected?.artist"
              >{{ locale === "zh" ? "画师" : "Artist" }} ·
              {{ selected.artist }}</span
            >
            <span v-if="selected"
              >{{ selected.language }} · {{ selected.cardNo }}</span
            >
          </footer>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.detail-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  padding: 22px;
  background: rgba(35, 32, 28, 0.52);
  backdrop-filter: blur(5px);
}
.detail-dialog {
  width: min(1060px, 96vw);
  max-height: 92vh;
  display: grid;
  grid-template-columns: minmax(270px, 36%) 1fr;
  overflow: hidden;
  background: var(--color-card-bg);
  border: 1px solid var(--color-panel-border);
  border-radius: 14px;
  box-shadow: 0 26px 80px rgba(25, 20, 15, 0.3);
  animation: appear 0.2s ease-out;
}
.detail-art-column {
  padding: 22px;
  overflow-y: auto;
}
.detail-art {
  width: 100%;
  padding: 0;
  border-radius: 9px;
  overflow: hidden;
  box-shadow: 0 14px 34px -14px rgba(0, 0, 0, 0.78);
}
.detail-art :deep(.carddex-image) {
  background: #17191a;
}
.detail-art > span {
  display: block;
  padding: 8px;
  font-size: 10px;
}
.detail-no-art {
  min-height: 360px;
  display: grid;
  place-items: center;
}
.language-switch {
  display: flex;
  justify-content: center;
  gap: 5px;
  margin-top: 13px;
}
.language-switch button {
  min-width: 48px;
  min-height: 30px;
  padding: 5px 11px;
  border: 1px solid #5a5e62;
  border-radius: 999px;
  /*color: #d3d5d6;*/
  font-size: 11px;
  font-weight: 750;
  letter-spacing: 0.06em;
}
.language-switch button:hover {
  border-color: #d88b79;
  /*color: #fff;*/
}
.language-switch button.active {
  border-color: #d88b79;
  color: #fff;
  background: #8f3e32;
  box-shadow: 0 0 0 1px rgba(216, 139, 121, 0.2);
}
.print-versions {
  margin-top: 16px;
  padding-top: 13px;
  border-top: 1px solid #3b3e41;
}
.print-versions > p {
  margin-bottom: 8px;
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.print-strip {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 1px 1px 8px;
  scrollbar-width: thin;
}
.print-strip button {
  flex: 0 0 58px;
  padding: 3px;
  opacity: 0.7;
  overflow: hidden;
}
.print-strip button:hover {
  opacity: 1;
  border-color: #85898c;
}
.print-strip button.active {
  opacity: 1;
  font-weight: bold;
}
.print-strip small {
  display: block;
  padding: 4px 1px 1px;
  font-size: 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.print-strip button.active small {
  background-color: #d88b79;
  border-radius: 7px;
  margin-top: 4px;
  padding-top: 0px;
}

.detail-info {
  padding: 22px 28px 30px;
  overflow-y: auto;
}
.detail-actions {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 22px;
  justify-content: right;
}
.detail-actions button {
  padding: 6px 10px;
  border: 1px solid var(--color-card-border);
  border-radius: 8px;
  color: var(--color-text-muted);
  font-size: 11px;
}
.detail-actions button:disabled {
  opacity: 0.35;
}
/*.detail-actions .close {
  margin-left: auto;
}*/
.detail-actions .pinned,
.detail-mobile-head .pinned {
  color: var(--color-brand);
  border-color: var(--color-brand);
  background: var(--color-brand-soft);
}
.detail-summary {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: 24px;
}
.detail-heading {
  min-width: 0;
}
.detail-title p {
  margin: 0 0 5px;
  color: var(--color-brand);
  font:
    600 10px/1.4 ui-monospace,
    monospace;
  letter-spacing: 0.12em;
}
.detail-title h2 {
  font-family: "Noto Serif SC", "Songti SC", serif;
  font-size: 27px;
  line-height: 1.3;
  font-weight: 900;
}
.detail-title h2 small {
  font-size: 16px;
  color: var(--color-text-muted);
}
.detail-title h3 {
  margin-top: 4px;
  color: var(--color-text-subtle);
  font:
    500 14px/1.45 Georgia,
    serif;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 15px;
}
.chips span {
  padding: 3px 7px;
  border: 1px solid var(--color-card-border);
  border-radius: 999px;
  color: var(--color-text-muted);
  font-size: 10px;
}
.chips .danger {
  color: var(--color-brand);
  border-color: var(--color-brand);
}
.stats {
  min-width: 108px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding-left: 20px;
  border-left: 1px solid var(--color-panel-border);
}
.stats div {
  min-height: 31px;
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: baseline;
  gap: 12px;
  padding: 4px 0;
}
.stats dt {
  color: var(--color-text-muted);
  font-size: 11px;
  font-weight: 650;
  white-space: nowrap;
}
.stats dt::after {
  content: ":";
}
.stats dd {
  margin: 0;
  font:
    700 19px/1 Georgia,
    serif;
  text-align: right;
}
.copy-block {
  padding-top: 19px;
  margin-top: 19px;
  /*border-top: 1px solid var(--color-panel-border);*/
}
.copy-block h4 {
  margin-bottom: 9px;
  color: var(--color-brand);
  font-size: 10px;
  letter-spacing: 0.16em;
}
.effect {
  color: var(--color-text-primary);
  font-size: 15px;
  font-weight: 560;
  line-height: 1.82;
  letter-spacing: 0.01em;
}
.effect.secondary {
  margin-top: 10px;
  color: var(--color-text-muted);
  font:
    500 14px/1.75 Georgia,
    serif;
}
.effect :deep(strong) {
  color: var(--color-brand);
  font-weight: 800;
}
.effect :deep(.effect-icon) {
  margin-inline: 2px;
  height: 19px;
  display: inline-block;
  vertical-align: -4px;
  object-fit: contain;
}
.effect :deep(.effect-icon.white-source) {
  filter: invert(1);
}
.secondary {
  margin-top: 8px;
  color: var(--color-text-subtle);
  font-family: Georgia, serif;
}
.flavor {
  color: var(--color-text-subtle);
  font-size: 11px;
  line-height: 1.65;
  font-style: italic;
}
.flavor .secondary {
  margin-top: 5px;
  font-size: 10.5px;
}
.print-meta {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding-top: 20px;
  margin-top: auto;
  /*border-top: 1px solid var(--color-panel-border);*/
  color: var(--color-text-subtle);
  font-size: 10px;
}
.detail-mobile-head {
  display: none;
}
@keyframes appear {
  from {
    opacity: 0;
    transform: translateY(15px) scale(0.99);
  }
}
@media (max-width: 700px) {
  .detail-backdrop {
    padding: 0;
    display: block;
    background: var(--color-card-bg);
  }
  .detail-dialog {
    width: 100%;
    max-height: none;
    height: 100dvh;
    display: block;
    border: 0;
    border-radius: 0;
    overflow-y: auto;
  }
  .detail-mobile-head {
    position: sticky;
    top: 0;
    z-index: 5;
    height: 54px;
    display: grid;
    grid-template-columns: 42px 1fr 42px;
    align-items: center;
    gap: 8px;
    padding: 0 10px;
    background: var(--color-header-bg);
    backdrop-filter: blur(10px);
    border-bottom: 1px solid var(--color-panel-border);
  }
  .detail-mobile-head strong {
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .detail-art-column {
    padding: 16px;
    border: 0;
    overflow: visible;
  }
  .detail-art {
    width: min(82vw, 390px);
    margin: auto;
  }
  .detail-info {
    padding: 4px 18px 32px;
    overflow: visible;
  }
  .detail-actions {
    display: none;
  }
  .detail-title h2 {
    font-size: 23px;
  }
  .detail-summary {
    gap: 14px;
  }
  .stats {
    min-width: 84px;
    padding-left: 12px;
  }
  .stats div {
    gap: 8px;
  }
  .stats dt {
    font-size: 10px;
  }
  .stats dd {
    font-size: 17px;
  }
}
</style>
