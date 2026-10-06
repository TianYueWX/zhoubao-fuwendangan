<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, Plus, RotateCw, Sparkles } from "@lucide/vue";
import { restSelectAll } from "@/tools/sources/rest";
import { useVersionedResource } from "@/tools/sources/versionedCache";
import CacheSyncStatus from "@/components/CacheSyncStatus.vue";
import type { RawCardBaseRow, RawCardPrintRow } from "@/types";

type Mode = "text" | "image";
type Page = "menu" | "setup" | "play";
type GameItem = {
  printId: string;
  cardId: string;
  cardNo: string;
  name: string;
  subtitle: string;
  flavor: string;
  image: string;
  series: string;
  base: RawCardBaseRow;
};
type GameSession = {
  mode: Mode;
  series: string[];
  deck: string[];
  currentIndex: number;
  seen: string[];
  answerRevealed: boolean;
  openTiles: number[];
  clueCount: number;
  gridSize: number;
  currentGridSize: number;
  targetCount: number;
  ended: boolean;
};

const STORAGE_PREFIX = "rune-games-v1";
const mode = ref<Mode>("text");
const page = ref<Page>("menu");
const selectedSeries = ref<string[]>([]);
const gridSize = ref(4);
const rulesOpen = ref(false);
const storageTick = ref(0);
const session = ref<GameSession | null>(null);
const notice = ref("");
const imageStatus = ref<"idle" | "loading" | "loaded" | "error">("idle");
const cardDataLoading = ref(false);
const cardDataError = ref("");
const cardRows = useVersionedResource<RawCardBaseRow[]>("cards", () =>
  restSelectAll<RawCardBaseRow>("cards_base", { order: "card_no.asc,id.asc" }),
);
const printRows = useVersionedResource<RawCardPrintRow[]>("prints", () =>
  restSelectAll<RawCardPrintRow>("card_prints", { order: "card_no_extend.asc,id.asc" }),
);
const resources = [cardRows, printRows];
const cacheChecking = computed(() => resources.some((resource) => resource.checking.value));
const cacheStale = computed(() => resources.some((resource) => resource.stale.value));
const cacheSavedAt = computed(() => {
  const values = resources.map((resource) => resource.savedAt.value).filter(Boolean).sort();
  return values[values.length - 1] ?? "";
});
const cacheError = computed(() => resources.find((resource) => resource.error.value)?.error.value ?? "");
const cardItems = ref<GameItem[]>([]);

function cell(row: RawCardBaseRow | RawCardPrintRow, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function listCell(value: string): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map((item) => String(item).trim()).filter(Boolean);
  } catch {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

const allItems = computed(() => cardItems.value);

const eligibleItems = computed(() =>
  allItems.value.filter((item) =>
    mode.value === "text" ? !!item.flavor : !!item.image,
  ),
);
const allSeries = computed(() =>
  [...new Set(eligibleItems.value.map((item) => item.series))].sort((a, b) =>
    a.localeCompare(b, "zh-Hans-CN", { numeric: true }),
  ),
);
const selectedItems = computed(() => {
  const selected = new Set(selectedSeries.value);
  return eligibleItems.value.filter((item) => selected.has(item.series));
});
const currentItem = computed(() => {
  const id = session.value?.deck[session.value.currentIndex];
  return id ? allItems.value.find((item) => item.printId === id) ?? null : null;
});
const imageRetry = ref(0);
watch(() => {
  const retry = imageRetry.value;
  const item = currentItem.value;
  const shouldLoad = mode.value === "image" || (mode.value === "text" && session.value?.answerRevealed);
  return shouldLoad && item?.image ? `${retry}|${item.image}` : undefined;
}, (key) => {
  const url = key?.slice(key.indexOf('|') + 1);
  if (!url) {
    imageStatus.value = "idle";
    return;
  }
  imageStatus.value = "loading";
  const image = new Image();
  image.onload = () => {
    if (currentItem.value?.image === url && imageRetry.value === Number(key?.split('|')[0])) imageStatus.value = "loaded";
  };
  image.onerror = () => {
    if (currentItem.value?.image === url && imageRetry.value === Number(key?.split('|')[0])) imageStatus.value = "error";
  };
  image.src = url;
  if (image.complete && image.naturalWidth > 0) imageStatus.value = "loaded";
}, { immediate: true });
const currentTiles = computed(() => {
  const count = session.value?.currentGridSize ?? 4;
  return Array.from({ length: count * count }, (_, index) => index);
});
const openedCount = computed(() => session.value?.openTiles.length ?? 0);
const leftInBatch = computed(() => {
  const current = session.value;
  return current ? Math.max(0, current.targetCount - current.currentIndex - 1) : 0;
});
const remainingCount = computed(() => {
  const current = session.value;
  return current ? Math.max(0, current.deck.length - current.currentIndex - 1) : 0;
});
const clueOptions = computed(() => {
  const item = currentItem.value;
  if (!item) return [];
  const base = item.base;
  const categories = listCell(cell(base, "card_category"));
  const colors = listCell(cell(base, "card_color_list"));
  const regions = listCell(cell(base, "region"));
  const hints = [
    categories.length ? `卡牌类别：${categories.join("、")}` : "",
    colors.length ? `颜色：${colors.join(" · ")}` : "",
    regions.length ? `所属地区：${regions.join("、")}` : "",
    cell(base, "energy") ? `费用：${cell(base, "energy")}` : "",
    cell(base, "rarity_name") ? `稀有度：${cell(base, "rarity_name")}` : "",
  ];
  return hints.filter(Boolean);
});
const shownClues = computed(() => clueOptions.value.slice(0, session.value?.clueCount ?? 0));
const modeText = computed(() => mode.value === "text" ? "趣味文本" : "猜卡图");
const canResumeText = computed(() => hasStoredSession("text"));
const canResumeImage = computed(() => hasStoredSession("image"));
const cardPrintCount = computed(() => allItems.value.length);

async function loadCards(force = false): Promise<void> {
  cardDataLoading.value = cardItems.value.length === 0;
  cardDataError.value = "";
  try {
    const [bases, prints] = await Promise.all([cardRows.load(force), printRows.load(force)]);
    if (!bases || !prints) throw new Error("卡牌资料不可用");
    buildGameCards(bases, prints);
  } catch (error) {
    cardDataError.value = error instanceof Error ? error.message : String(error);
  } finally {
    cardDataLoading.value = false;
  }
}

function buildGameCards(bases: RawCardBaseRow[], prints: RawCardPrintRow[]): void {
    const baseById = new Map(bases.map((base) => [cell(base, "id"), base]));
    cardItems.value = prints.flatMap((print) => {
      if (cell(print, "language").toUpperCase() !== "SC") return [];
      const printId = cell(print, "id");
      const cardId = cell(print, "card_id");
      const base = baseById.get(cardId);
      const series = cell(print, "series") || (base ? cell(base, "series_name") : "");
      if (!printId || !base || !series) return [];
      return [{
        printId,
        cardId,
        cardNo: cell(print, "card_no_extend") || cell(base, "card_no"),
        name: cell(base, "card_name_cn"),
        subtitle: cell(base, "sub_title_cn"),
        flavor: cell(print, "flavor_text_cn"),
        image: cell(print, "img_cdn"),
        series,
        base,
      }];
    });
}

watch([cardRows.data, printRows.data], ([bases, prints]) => {
  if (bases && prints) {
    buildGameCards(bases, prints);
    cardDataLoading.value = false;
  }
}, { immediate: true });

onMounted(() => { void loadCards(); });

function sessionKey(which: Mode): string {
  return `${STORAGE_PREFIX}:session:${which}`;
}
function rulesKey(which: Mode): string {
  return `${STORAGE_PREFIX}:rules:${which}`;
}
function safeGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function hasStoredSession(which: Mode): boolean {
  void storageTick.value;
  const raw = safeGet(sessionKey(which));
  if (!raw) return false;
  try {
    const saved = JSON.parse(raw) as Partial<GameSession>;
    return saved.mode === which && Array.isArray(saved.deck) && saved.deck.length > 0 && !saved.ended;
  } catch { return false; }
}
function readSession(which: Mode): GameSession | null {
  const raw = safeGet(sessionKey(which));
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw) as GameSession;
    if (saved.mode !== which || !Array.isArray(saved.deck) || !saved.deck.length) return null;
    return saved;
  } catch { return null; }
}

watch(session, (value) => {
  if (!value) return;
  try {
    localStorage.setItem(sessionKey(value.mode), JSON.stringify(value));
    storageTick.value += 1;
  } catch { /* 浏览器禁用本地存储时，本轮仍可正常游玩 */ }
}, { deep: true, flush: "sync" });

watch(allSeries, (series) => {
  if (page.value === "setup" && !selectedSeries.value.length && series.length) {
    selectedSeries.value = [...series];
  }
});

function openMode(which: Mode, resume = false): void {
  mode.value = which;
  notice.value = "";
  if (resume) {
    const saved = readSession(which);
    if (saved) {
      session.value = saved;
      selectedSeries.value = [...saved.series];
      gridSize.value = saved.gridSize;
      page.value = "play";
      return;
    }
  }
  session.value = null;
  selectedSeries.value = [...new Set(allItems.value
    .filter((item) => which === "text" ? !!item.flavor : !!item.image)
    .map((item) => item.series))];
  gridSize.value = 4;
  if (safeGet(rulesKey(which)) !== "seen") {
    rulesOpen.value = true;
  } else {
    page.value = "setup";
  }
}

function confirmRules(): void {
  try { localStorage.setItem(rulesKey(mode.value), "seen"); } catch { /* no-op */ }
  rulesOpen.value = false;
  if (!selectedSeries.value.length && allSeries.value.length) {
    selectedSeries.value = [...allSeries.value];
  }
  page.value = "setup";
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

function startGame(): void {
  const pool = selectedItems.value;
  if (!pool.length) {
    notice.value = mode.value === "text" ? "所选系列里没有可用的趣味文本。" : "所选系列里没有可用的 SC 卡图。";
    return;
  }
  const deck = shuffle(pool.map((item) => item.printId));
  try { localStorage.removeItem(sessionKey(mode.value)); } catch { /* no-op */ }
  const firstCount = mode.value === "image" ? Math.min(10, deck.length) : deck.length;
  session.value = {
    mode: mode.value,
    series: [...selectedSeries.value],
    deck,
    currentIndex: 0,
    seen: [deck[0]!],
    answerRevealed: false,
    openTiles: [],
    clueCount: 0,
    gridSize: gridSize.value,
    currentGridSize: gridSize.value,
    targetCount: firstCount,
    ended: false,
  };
  page.value = "play";
  storageTick.value += 1;
}

function leaveToMenu(): void {
  page.value = "menu";
  rulesOpen.value = false;
}

function toggleSeries(series: string): void {
  const selected = new Set(selectedSeries.value);
  if (selected.has(series)) selected.delete(series);
  else selected.add(series);
  selectedSeries.value = [...selected];
}

function selectAllSeries(): void {
  selectedSeries.value = [...allSeries.value];
}

function clearSeries(): void {
  selectedSeries.value = [];
}

function setGridSize(value: string): void {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return;
  gridSize.value = Math.min(10, Math.max(2, Math.round(parsed)));
}

function setSessionGridSize(value: string): void {
  if (!session.value) return;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return;
  session.value.gridSize = Math.min(10, Math.max(2, Math.round(parsed)));
}

function revealAnswer(): void {
  if (!session.value) return;
  session.value.answerRevealed = true;
}

function hideAnswer(): void {
  if (!session.value) return;
  session.value.answerRevealed = false;
}

function revealClue(): void {
  if (!session.value || session.value.clueCount >= clueOptions.value.length) return;
  session.value.clueCount += 1;
}

function openTile(index: number): void {
  const current = session.value;
  if (!current || imageStatus.value !== "loaded" || current.answerRevealed || current.openTiles.includes(index)) return;
  current.openTiles.push(index);
}

function advance(): void {
  const current = session.value;
  if (!current || !current.answerRevealed) return;
  const nextIndex = current.currentIndex + 1;
  if (current.mode === "text") {
    if (nextIndex >= current.deck.length) {
      current.ended = true;
      return;
    }
    current.currentIndex = nextIndex;
    current.seen.push(current.deck[nextIndex]!);
  } else {
    if (nextIndex >= current.targetCount) {
      if (nextIndex >= current.deck.length) {
        current.ended = true;
        return;
      }
      current.targetCount = Math.min(current.targetCount + 10, current.deck.length);
    }
    current.currentIndex = nextIndex;
    current.seen.push(current.deck[nextIndex]!);
  }
  current.answerRevealed = false;
  current.openTiles = [];
  current.clueCount = 0;
  current.currentGridSize = current.gridSize;
}

function restartGame(): void {
  const which = session.value?.mode ?? mode.value;
  try { localStorage.removeItem(sessionKey(which)); } catch { /* no-op */ }
  session.value = null;
  storageTick.value += 1;
  openMode(which, false);
}

function tileStyle(index: number): Record<string, string> {
  const current = session.value;
  const item = currentItem.value;
  if (!current || !item) return {};
  const size = current.currentGridSize;
  const row = Math.floor(index / size);
  const col = index % size;
  const posX = size === 1 ? 50 : (col / (size - 1)) * 100;
  const posY = size === 1 ? 50 : (row / (size - 1)) * 100;
  return {
    backgroundImage: `url("${item.image.replace(/"/g, "%22")}")`,
    backgroundSize: `${size * 100}% ${size * 100}%`,
    backgroundPosition: `${posX}% ${posY}%`,
  };
}

const nextLabel = computed(() => {
  const current = session.value;
  if (!current) return "下一张";
  if (current.mode === "text") return current.currentIndex + 1 < current.deck.length ? "下一张" : "完成本轮";
  if (current.currentIndex + 1 < current.targetCount) return "下一张";
  return current.currentIndex + 1 < current.deck.length ? "再加 10 张" : "完成本轮";
});

</script>

<template>
  <main class="games-page">
    <div class="games-page__frame" aria-hidden="true"></div>
    <header class="games-heading">
      <CacheSyncStatus :checking="cacheChecking" :stale="cacheStale" :saved-at="cacheSavedAt" :error="cacheError" :disabled="cardDataLoading" @refresh="loadCards(true)" />
      <button v-if="page !== 'menu'" class="games-back" type="button" @click="leaveToMenu"><ArrowLeft :size="14" aria-hidden="true" /> 小游戏菜单</button>
      <p class="games-eyebrow">符文档案 · CARD PLAY</p>
      <h1 class="games-title">小游戏</h1>
      <p class="games-intro">读一段卡牌故事，或一点点揭开卡面。</p>
    </header>

    <section v-if="page === 'menu'" class="games-menu" aria-label="选择玩法">
      <article class="mode-card mode-card--text">
        <div class="mode-card__art" aria-hidden="true">
          <span class="quote-mark">“</span>
          <i></i><i></i><i></i>
          <small>FLAVOR TEXT</small>
        </div>
        <div class="mode-card__body">
          <p class="games-eyebrow">读故事 · 猜角色</p>
          <h2>趣味文本</h2>
          <p>读一段卡牌上的趣味文本，揭晓角色名称和副标题。</p>
          <div class="mode-card__actions">
            <button class="games-button games-button--primary" type="button" @click="openMode('text')">
              {{ canResumeText ? '新开一轮' : '开始玩' }} <ArrowRight :size="14" aria-hidden="true" />
            </button>
            <button v-if="canResumeText" class="games-button games-button--quiet" type="button" @click="openMode('text', true)">继续上次</button>
          </div>
        </div>
      </article>

      <article class="mode-card mode-card--image">
        <div class="mode-card__art mode-card__art--tiles" aria-hidden="true">
          <span v-for="tile in 16" :key="tile" :class="{ 'is-cut': [2, 5, 8, 11, 14].includes(tile) }"></span>
          <small>REVEAL THE CARD</small>
        </div>
        <div class="mode-card__body">
          <p class="games-eyebrow">逐块揭开 · 猜卡图</p>
          <h2>猜卡图</h2>
          <p>自己选择格子慢慢点开，也可以随时看提示或揭晓答案。</p>
          <div class="mode-card__actions">
            <button class="games-button games-button--primary" type="button" @click="openMode('image')">
              {{ canResumeImage ? '新开一轮' : '开始玩' }} <ArrowRight :size="14" aria-hidden="true" />
            </button>
            <button v-if="canResumeImage" class="games-button games-button--quiet" type="button" @click="openMode('image', true)">继续上次</button>
          </div>
        </div>
      </article>
      <p class="games-footnote"><span>{{ cardPrintCount.toLocaleString() }}</span> 张简体中文印版可用 · 进度保存在本机</p>
    </section>

    <section v-else-if="page === 'setup'" class="games-setup">
      <div class="setup-title-row">
        <div>
          <p class="games-eyebrow">开始一轮新游戏</p>
          <h2>{{ modeText }}</h2>
        </div>
        <span class="setup-locale">SC · 简体中文</span>
      </div>
      <div class="setup-section">
        <div class="setup-section__head">
          <div><h3>选择系列</h3><p>默认选择全部系列，可同时挑选多个。</p></div>
          <div class="setup-tools">
            <button type="button" @click="selectAllSeries">全选</button>
            <button type="button" @click="clearSeries">清空</button>
          </div>
        </div>
        <p v-if="cardDataLoading" class="games-empty" role="status">正在从 Supabase 读取卡牌资料…</p>
        <p v-else-if="cardDataError" class="games-empty" role="alert">读取卡牌资料失败：{{ cardDataError }} <button class="inline-retry" type="button" @click="loadCards()">重试</button></p>
        <div v-else-if="allSeries.length" class="series-list">
          <button v-for="series in allSeries" :key="series" type="button" class="series-chip"
            :class="{ 'is-selected': selectedSeries.includes(series) }" :aria-pressed="selectedSeries.includes(series)"
            @click="toggleSeries(series)">{{ series }}</button>
        </div>
        <p v-else class="games-empty">暂时没有符合条件的印版数据。</p>
        <p class="setup-selection">已选 {{ selectedSeries.length }} / {{ allSeries.length }} 个系列 · {{ selectedItems.length }} 张可用题目</p>
      </div>

      <div v-if="mode === 'image'" class="setup-section setup-section--difficulty">
        <div class="setup-section__head">
          <div><h3>卡片难度</h3><p>一张卡分成多少格；游戏中也能随时调整下一张。</p></div>
        </div>
        <div class="difficulty-options" role="group" aria-label="选择卡片网格">
          <button v-for="size in [3, 4, 5]" :key="size" type="button" :class="{ 'is-selected': gridSize === size }" @click="gridSize = size">
            <span class="difficulty-grid" :style="{ '--grid-size': size }"><i v-for="cellIndex in size * size" :key="cellIndex"></i></span>
            <strong>{{ size }} × {{ size }}</strong>
            <small>{{ size === 3 ? '轻松' : size === 4 ? '适中' : '挑战' }}</small>
          </button>
        </div>
        <label class="grid-custom">每行格数
          <input type="number" min="2" max="10" step="1" :value="gridSize" aria-label="自定义每行格数，范围 2 到 10" @input="setGridSize(($event.target as HTMLInputElement).value)" />
          <span>{{ gridSize }}×{{ gridSize }}，共 {{ gridSize * gridSize }} 格</span>
        </label>
      </div>

      <p v-if="notice" class="games-notice" role="status">{{ notice }}</p>
      <footer class="setup-footer">
        <span>趣味文本每次揭晓后继续一张；猜卡图每轮先发 10 张，可随时追加。</span>
        <button class="games-button games-button--primary" type="button" :disabled="!selectedItems.length" @click="startGame">开始游戏 <ArrowRight :size="14" aria-hidden="true" /></button>
      </footer>
    </section>

    <section v-else-if="page === 'play'" class="games-play">
      <template v-if="session && currentItem && !session.ended">
        <div class="play-topline">
          <div><button class="games-back" type="button" @click="leaveToMenu"><ArrowLeft :size="14" aria-hidden="true" /> 菜单</button><span class="play-mode">{{ modeText }}</span></div>
          <span class="play-series">{{ session.series.join(" · ") }}</span>
        </div>
        <div class="play-progress">
          <div class="play-progress__label"><span>本轮进度</span><strong>{{ session.currentIndex + 1 }} <i>/</i> {{ session.mode === 'text' ? session.deck.length : session.targetCount }}</strong></div>
          <div class="progress-track"><span :style="{ width: `${Math.min(100, ((session.currentIndex + 1) / (session.mode === 'text' ? session.deck.length : session.targetCount)) * 100)}%` }"></span></div>
          <small v-if="session.mode === 'image'">已揭开 {{ openedCount }} / {{ session.currentGridSize * session.currentGridSize }} 格 · 还可追加 {{ remainingCount }} 张</small>
          <small v-else>本 session 剩余 {{ remainingCount }} 张不重复题目</small>
        </div>

        <div class="play-layout" :class="{ 'play-layout--image': mode === 'image' }">
          <article v-if="mode === 'text'" class="question-paper">
            <div class="question-paper__top"><span>趣味文本</span><span>{{ currentItem.series }} · {{ currentItem.cardNo }}</span></div>
            <blockquote>{{ currentItem.flavor }}</blockquote>
            <div class="question-paper__bottom"><span>你觉得这段话来自谁？</span><span>SC PRINT</span></div>
          </article>

          <article v-else class="image-question">
            <div class="image-question__head">
              <div><span class="games-eyebrow">逐块揭开卡面</span><p>点击任意格子来查看局部</p></div>
              <div class="difficulty-live" role="group" aria-label="设置下一张卡的难度">
                <span>下一张</span>
                <button v-for="size in [3, 4, 5]" :key="size" type="button" :class="{ 'is-selected': session.gridSize === size }" @click="session.gridSize = size">{{ size }}×{{ size }}</button>
                <input type="number" min="2" max="10" step="1" :value="session.gridSize" aria-label="自定义下一张卡每行格数，范围 2 到 10" @input="setSessionGridSize(($event.target as HTMLInputElement).value)" />
              </div>
            </div>
            <div class="reveal-card" :style="{ '--tile-count': session.currentGridSize }" aria-label="被遮住的卡牌图片">
              <button v-for="tile in currentTiles" :key="tile" type="button" class="reveal-tile"
                :class="{ 'is-open': session.openTiles.includes(tile) || session.answerRevealed }"
                :style="tileStyle(tile)" :aria-label="session.openTiles.includes(tile) || session.answerRevealed ? `第 ${tile + 1} 格已揭开` : `揭开第 ${tile + 1} 格`"
                :disabled="imageStatus !== 'loaded' || session.openTiles.includes(tile) || session.answerRevealed" @click="openTile(tile)">
                <Plus v-if="!session.openTiles.includes(tile) && !session.answerRevealed" :size="18" aria-hidden="true" />
              </button>
              <div v-if="imageStatus !== 'loaded'" class="image-loading" role="status" aria-live="polite">
                <span v-if="imageStatus === 'error'">卡图载入失败。<button class="games-retry" @click="imageRetry++">重新加载卡图</button></span>
                <span v-else>卡图载入中…</span>
              </div>
            </div>
          </article>

          <aside class="play-side">
            <section class="clue-box">
              <div class="clue-box__head"><div><span class="games-eyebrow">小提示</span><h3>给一点线索</h3></div><span>{{ shownClues.length }}/{{ clueOptions.length }}</span></div>
              <p v-if="shownClues.length" v-for="clue in shownClues" :key="clue" class="clue-line">{{ clue }}</p>
              <p v-else class="clue-placeholder">遇到困难时，点一下看看线索。</p>
              <button class="games-button games-button--quiet clue-action" type="button" :disabled="session.clueCount >= clueOptions.length" @click="revealClue">
                {{ session.clueCount >= clueOptions.length ? '线索已全部打开' : '打开一条线索' }} <Plus :size="14" aria-hidden="true" />
              </button>
            </section>

            <section class="answer-box" :class="{ 'is-revealed': session.answerRevealed }">
              <p class="games-eyebrow">答案</p>
              <template v-if="session.answerRevealed">
                <h2>{{ currentItem.name }}</h2>
                <p v-if="currentItem.subtitle" class="answer-subtitle">{{ currentItem.subtitle }}</p>
                <p class="answer-series">{{ currentItem.series }} · {{ currentItem.cardNo }}</p>
                <div v-if="session.mode === 'text' && currentItem.image" class="answer-card-image" role="status" aria-live="polite">
                  <img v-if="imageStatus === 'loaded'" :src="currentItem.image" :alt="`${currentItem.name} 卡图`" />
                  <span v-else-if="imageStatus === 'error'">卡图载入失败 <button class="games-retry" @click="imageRetry++">重新加载卡图</button></span>
                  <span v-else>卡图载入中…</span>
                </div>
                <button class="games-button games-button--quiet answer-hide" type="button" @click="hideAnswer">收起答案</button>
              </template>
              <template v-else>
                <p class="answer-hidden">先猜一猜，再自己揭晓。</p>
            <button class="games-button games-button--primary answer-reveal" type="button" @click="revealAnswer">揭晓答案 <ArrowUpRight :size="14" aria-hidden="true" /></button>
              </template>
            </section>

            <button v-if="session.answerRevealed" class="games-button games-button--primary next-question" type="button" @click="advance">
              {{ nextLabel }} <Check v-if="nextLabel === '完成本轮'" :size="14" aria-hidden="true" /><ArrowRight v-else :size="14" aria-hidden="true" />
            </button>
            <p v-else class="answer-hint">想好了就揭晓；不需要输入答案。</p>
          </aside>
        </div>
      </template>

      <div v-else-if="session?.ended" class="session-finished">
        <span class="finish-stamp"><Check :size="24" aria-hidden="true" /></span>
        <p class="games-eyebrow">本轮结束</p>
        <h2>卡牌都看过啦</h2>
        <p>这次没有重复题目。换一轮可以重新打乱卡牌。</p>
        <div class="finish-actions">
          <button class="games-button games-button--primary" type="button" @click="restartGame">重新开始 <RotateCw :size="14" aria-hidden="true" /></button>
          <button class="games-button games-button--quiet" type="button" @click="leaveToMenu">回到小游戏菜单</button>
        </div>
      </div>
      <div v-else class="session-finished">
        <p class="games-eyebrow">卡牌资料暂不可用</p>
        <h2>这轮游戏无法继续</h2>
        <p>卡牌数据没有载入，返回菜单后稍等片刻再试。</p>
        <button class="games-button games-button--primary" type="button" @click="leaveToMenu">回到小游戏菜单</button>
      </div>
    </section>

    <Transition name="rules-fade">
      <div v-if="rulesOpen" class="rules-backdrop" role="presentation">
        <section class="rules-dialog" role="dialog" aria-modal="true" :aria-labelledby="`rules-title-${mode}`">
          <Sparkles class="rules-spark" aria-hidden="true" />
          <p class="games-eyebrow">第一次进入 · {{ modeText }}</p>
          <h2 :id="`rules-title-${mode}`">怎么玩</h2>
          <template v-if="mode === 'text'">
            <p>阅读卡牌印版上的趣味文本，想好角色后点「揭晓答案」。答案会显示角色名称和副标题，点「下一张」继续。</p>
            <p>每次只追加一张。同一轮不会重复出现同一印版。</p>
          </template>
          <template v-else>
            <p>卡图会被分成多个格子。自己挑选格子逐步揭开，也可以点开线索，或随时揭晓答案。</p>
            <p>每轮先玩 10 张。答完一批后，你可以选择再加 10 张；难度调整会从下一张卡开始生效。</p>
          </template>
          <button class="games-button games-button--primary rules-confirm" type="button" @click="confirmRules">明白，开始设置 <ArrowRight :size="14" aria-hidden="true" /></button>
          <small>这份规则只会在本机首次显示。</small>
        </section>
      </div>
    </Transition>
  </main>
</template>

<style scoped>
.games-page {
  --game-ink: #292820;
  --game-muted: #777263;
  --game-paper: #fbf8ef;
  --game-line: #d8cfbb;
  --game-cinnabar: #b23a27;
  --game-gold: #c59b46;
  position: relative;
  width: min(1120px, calc(100% - 48px));
  min-height: calc(100vh - 58px);
  margin: 0 auto;
  padding: clamp(34px, 6vh, 64px) 0 56px;
  color: var(--game-ink);
  isolation: isolate;
}
.games-page__frame { position: absolute; z-index: -1; inset: 20px 0 28px; border-top: 1px solid var(--color-panel-border); border-bottom: 1px solid var(--color-panel-border); pointer-events: none; }
.games-heading { text-align: center; margin: 0 auto 38px; position: relative; }
.games-eyebrow { margin: 0; color: var(--game-cinnabar); font-size: 0.875rem; font-weight: 700; letter-spacing: .2em; text-transform: uppercase; }
.games-title { margin: 7px 0 2px; font-family: "Noto Serif SC", "Songti SC", STSong, SimSun, serif; font-size: clamp(34px, 5vw, 50px); font-weight: 900; letter-spacing: .08em; line-height: 1.25; }
.games-intro { margin: 6px 0 0; color: var(--game-muted); font-size: 1rem; }
.games-back { border: 0; padding: 4px 0; background: transparent; color: var(--game-muted); font-size: 0.9375rem; cursor: pointer; }
.games-back:hover { color: var(--game-cinnabar); }
.games-heading > .games-back { position: absolute; left: 0; top: 0; }
.games-menu { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 22px; max-width: 980px; margin: 0 auto; }
.mode-card { display: grid; grid-template-columns: 180px minmax(0, 1fr); min-height: 254px; border: 1px solid var(--game-line); background: var(--game-paper); box-shadow: 0 14px 38px -32px rgba(50, 40, 20, .45); }
.mode-card__art { position: relative; display: grid; align-content: center; justify-items: center; gap: 8px; overflow: hidden; background: #e9dfc9; border-right: 1px solid var(--game-line); }
.mode-card--text .mode-card__art { background: #e7e0d1; }
.quote-mark { height: 76px; color: var(--game-cinnabar); font-family: Georgia, serif; font-size: 7rem; line-height: 1; opacity: .76; }
.mode-card__art > i { display: block; width: 68%; height: 2px; background: #948b78; opacity: .6; }
.mode-card__art > i:nth-of-type(2) { width: 49%; margin-left: -20px; }
.mode-card__art > i:nth-of-type(3) { width: 59%; margin-left: 8px; }
.mode-card__art small { position: absolute; bottom: 15px; left: 16px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.75rem; letter-spacing: .17em; color: #776e5d; }
.mode-card__art--tiles { grid-template-columns: repeat(4, 1fr); grid-template-rows: repeat(4, 1fr); gap: 2px; padding: 18px; background: #302f2a; }
.mode-card__art--tiles > span { width: 100%; height: 100%; background: #b9ad92; transition: transform 280ms, opacity 280ms; }
.mode-card__art--tiles > span:nth-child(3n) { background: #d3c6a8; }
.mode-card__art--tiles > span.is-cut { opacity: .16; transform: scale(.84); }
.mode-card__art--tiles small { color: #e8dfca; }
.mode-card__body { display: flex; flex-direction: column; align-items: flex-start; padding: 24px 22px 19px; }
.mode-card__body h2 { margin: 5px 0 4px; font-family: "Noto Serif SC", "Songti SC", serif; font-size: 1.5rem; font-weight: 800; }
.mode-card__body > p:not(.games-eyebrow) { max-width: 300px; min-height: 48px; margin: 0; color: var(--game-muted); font-size: 1rem; line-height: 1.75; }
.mode-card__actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: auto; padding-top: 16px; }
.games-button { display: inline-flex; min-height: 40px; align-items: center; justify-content: center; gap: 16px; border: 1px solid transparent; padding: 8px 15px; font-size: 1rem; font-weight: 700; cursor: pointer; transition: background-color 160ms, border-color 160ms, color 160ms, transform 160ms; }
.games-button > .lucide { width: 14px; height: 14px; }
.games-button--primary { background: var(--game-cinnabar); color: #fff8f0; }
.games-button--primary:hover:not(:disabled) { background: #982f20; transform: translateY(-1px); }
.games-button--primary:disabled { cursor: not-allowed; opacity: .45; }
.games-button--quiet { border-color: var(--game-line); background: transparent; color: var(--game-ink); }
.games-button--quiet:hover:not(:disabled) { border-color: var(--game-cinnabar); color: var(--game-cinnabar); }
.games-button--quiet:disabled { opacity: .45; cursor: default; }
.games-footnote { grid-column: 1 / -1; margin: 3px 0 0; text-align: center; color: var(--game-muted); font-size: 0.875rem; }
.games-footnote span { color: var(--game-ink); font-variant-numeric: tabular-nums; font-weight: 700; }
.games-setup { max-width: 890px; margin: 0 auto; border: 1px solid var(--game-line); background: var(--game-paper); padding: clamp(22px, 4vw, 38px); }
.setup-title-row { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding-bottom: 22px; border-bottom: 1px solid var(--game-line); }
.setup-title-row h2 { margin: 3px 0 0; font: 800 26px/1.35 "Noto Serif SC", "Songti SC", serif; }
.setup-locale { flex: none; border: 1px solid var(--game-line); padding: 6px 10px; color: var(--game-muted); font: 10px ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .1em; }
.setup-section { padding: 22px 0 19px; border-bottom: 1px solid var(--game-line); }
.setup-section__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
.setup-section__head h3 { margin: 0; font-size: 1rem; }
.setup-section__head p { margin: 3px 0 0; color: var(--game-muted); font-size: 0.9375rem; }
.setup-tools { display: flex; gap: 12px; }
.setup-tools button { border: 0; padding: 2px 0; background: transparent; color: var(--game-cinnabar); font-size: 0.9375rem; cursor: pointer; }
.series-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 17px; }
.series-chip { min-width: 60px; border: 1px solid var(--game-line); padding: 7px 12px; background: transparent; color: var(--game-muted); font-size: 0.9375rem; cursor: pointer; transition: .15s; }
.series-chip:hover { border-color: var(--game-cinnabar); color: var(--game-cinnabar); }
.series-chip.is-selected { border-color: var(--game-ink); background: var(--game-ink); color: #f8f4e8; }
.setup-selection { margin: 12px 0 0; color: var(--game-muted); font-size: 0.875rem; font-variant-numeric: tabular-nums; }
.games-empty { color: var(--game-muted); font-size: 1rem; }
.inline-retry { margin-left: 8px; border: 0; padding: 0; background: transparent; color: var(--game-cinnabar); text-decoration: underline; cursor: pointer; }
.setup-section--difficulty { padding-bottom: 23px; }
.difficulty-options { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 15px; }
.difficulty-options > button { display: grid; grid-template-columns: 42px auto; grid-template-rows: auto auto; align-items: center; gap: 0 11px; min-width: 130px; border: 1px solid var(--game-line); padding: 10px 13px; background: transparent; text-align: left; cursor: pointer; }
.difficulty-options > button.is-selected { border-color: var(--game-cinnabar); background: rgba(178, 58, 39, .045); }
.difficulty-grid { display: grid; grid-row: 1 / 3; grid-template-columns: repeat(var(--grid-size), 1fr); grid-template-rows: repeat(var(--grid-size), 1fr); gap: 2px; width: 37px; height: 37px; }
.difficulty-grid i { background: #b9ad92; }
.difficulty-options strong { font-size: 0.9375rem; }
.difficulty-options small { color: var(--game-muted); font-size: 0.875rem; }
.grid-custom { display: flex; align-items: center; gap: 10px; margin-top: 15px; color: var(--game-muted); font-size: 0.9375rem; }
.grid-custom input, .difficulty-live input { width: 62px; border: 1px solid var(--game-line); border-radius: 0; padding: 6px 7px; background: transparent; color: var(--game-ink); font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
.grid-custom span { color: var(--game-cinnabar); font-variant-numeric: tabular-nums; }
.games-notice { margin: 16px 0 0; color: var(--game-cinnabar); font-size: 0.9375rem; }
.setup-footer { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding-top: 20px; }
.setup-footer > span { max-width: 490px; color: var(--game-muted); font-size: 0.875rem; line-height: 1.7; }
.games-play { max-width: 1020px; margin: 0 auto; }
.play-topline { display: flex; justify-content: space-between; align-items: center; padding: 0 0 12px; border-bottom: 1px solid var(--game-line); }
.play-topline > div { display: flex; align-items: center; gap: 18px; }
.play-mode { padding-left: 17px; border-left: 1px solid var(--game-line); font-family: "Noto Serif SC", "Songti SC", serif; font-size: 1rem; font-weight: 700; }
.play-series { max-width: 50%; overflow: hidden; color: var(--game-muted); font-size: 0.875rem; text-overflow: ellipsis; white-space: nowrap; }
.play-progress { max-width: 580px; margin: 23px auto 28px; }
.play-progress__label { display: flex; justify-content: space-between; color: var(--game-muted); font-size: 0.875rem; }
.play-progress__label strong { color: var(--game-ink); font-size: 1rem; font-variant-numeric: tabular-nums; }
.play-progress__label i { color: var(--game-muted); font-style: normal; font-weight: 400; }
.progress-track { height: 3px; margin: 7px 0 5px; background: #e0d9c8; }
.progress-track span { display: block; height: 100%; background: var(--game-cinnabar); transition: width 220ms; }
.play-progress > small { color: var(--game-muted); font-size: 0.875rem; }
.play-layout { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(250px, .75fr); align-items: start; gap: 22px; }
.question-paper { min-height: 332px; display: flex; flex-direction: column; border: 1px solid var(--game-line); padding: 20px 23px; background-color: #f7f2e5; background-image: linear-gradient(rgba(146, 132, 104, .08) 1px, transparent 1px); background-size: 100% 34px; }
.question-paper__top, .question-paper__bottom { display: flex; justify-content: space-between; gap: 12px; color: var(--game-muted); font: 9px ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .09em; }
.question-paper__top span:first-child { color: var(--game-cinnabar); font-family: inherit; }
.question-paper blockquote { position: relative; flex: 1; display: grid; place-content: center; margin: 20px 0; padding: 24px min(5vw, 48px); font-family: "Noto Serif SC", "Songti SC", serif; font-size: clamp(20px, 2.3vw, 29px); font-weight: 600; line-height: 1.95; text-align: center; }
.question-paper blockquote::before { content: "“"; position: absolute; top: -4px; left: 4px; color: rgba(178, 58, 39, .36); font: 72px/1 Georgia, serif; }
.question-paper__bottom { padding-top: 13px; border-top: 1px solid var(--game-line); }
.play-side { display: grid; gap: 13px; }
.clue-box, .answer-box { border: 1px solid var(--game-line); padding: 17px; background: var(--game-paper); }
.clue-box__head { display: flex; justify-content: space-between; align-items: center; }
.clue-box__head h3 { margin: 3px 0 0; font: 700 16px "Noto Serif SC", "Songti SC", serif; }
.clue-box__head > span { color: var(--game-muted); font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; }
.clue-placeholder, .clue-line { margin: 13px 0 0; color: var(--game-muted); font-size: 0.9375rem; line-height: 1.65; }
.clue-line { border-top: 1px solid #e5dece; padding-top: 9px; color: var(--game-ink); }
.clue-action { min-height: 34px; margin-top: 13px; padding: 6px 10px; font-size: 0.875rem; }
.clue-action > span { font-size: 1rem; }
.answer-box { min-height: 133px; border-top: 2px solid var(--game-cinnabar); }
.answer-box h2 { margin: 13px 0 0; font: 800 21px/1.35 "Noto Serif SC", "Songti SC", serif; }
.answer-card-image { display: grid; min-height: 120px; place-items: center; margin-top: 13px; overflow: hidden; border: 1px solid var(--game-line); background: rgba(0, 0, 0, .04); color: var(--game-muted); font-size: 0.875rem; }
.answer-card-image img { display: block; width: auto; max-width: 100%; max-height: 290px; object-fit: contain; }
.answer-hide { width: 100%; margin-top: 14px; }
.answer-subtitle { margin: 4px 0 0; color: var(--game-cinnabar); font: 600 14px "Noto Serif SC", "Songti SC", serif; }
.answer-series { margin: 12px 0 0; color: var(--game-muted); font: 10px ui-monospace, SFMono-Regular, Menlo, monospace; }
.answer-hidden { margin: 9px 0 0; color: var(--game-muted); font-size: 0.9375rem; }
.answer-reveal { width: 100%; margin-top: 13px; }
.next-question { width: 100%; min-height: 46px; }
.answer-hint { margin: -2px 0 0; color: var(--game-muted); font-size: 0.875rem; text-align: center; }
.play-layout--image { grid-template-columns: minmax(0, 1.2fr) minmax(275px, .8fr); }
.image-question { min-width: 0; }
.image-question__head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 11px; }
.image-question__head p { margin: 3px 0 0; color: var(--game-muted); font-size: 0.875rem; }
.difficulty-live { display: flex; align-items: center; gap: 4px; white-space: nowrap; }
.difficulty-live > span { margin-right: 3px; color: var(--game-muted); font-size: 0.75rem; }
.difficulty-live button { border: 1px solid var(--game-line); padding: 4px 6px; background: transparent; color: var(--game-muted); font: 10px ui-monospace, SFMono-Regular, Menlo, monospace; cursor: pointer; }
.difficulty-live button.is-selected { border-color: var(--game-cinnabar); color: var(--game-cinnabar); }
.difficulty-live input { width: 48px; padding: 4px 3px; font-size: 0.875rem; }
.reveal-card { position: relative; display: grid; grid-template-columns: repeat(var(--tile-count), 1fr); grid-template-rows: repeat(var(--tile-count), 1fr); width: min(100%, 475px); aspect-ratio: 744 / 1039; margin: 0 auto; overflow: hidden; border: 5px solid #2c2b27; background: #3b3932; box-shadow: 0 15px 28px -19px rgba(30, 20, 10, .7); }
.image-loading { position: absolute; z-index: 2; inset: 0; display: grid; place-items: center; padding: 20px; background: rgba(39, 37, 32, .86); color: #f1ead9; font-size: 1rem; text-align: center; }
.reveal-tile { position: relative; min-width: 0; min-height: 0; border: 1px solid rgba(247, 239, 218, .18); padding: 0; background-color: #aaa084; background-repeat: no-repeat; cursor: pointer; transition: opacity 240ms, transform 240ms, filter 240ms; }
.reveal-tile:not(.is-open) { background-image: none !important; background: repeating-linear-gradient(135deg, #403e37 0 8px, #4a473f 8px 10px); color: #d3c9af; }
.reveal-tile:not(.is-open):hover { background: #5b5548; }
.reveal-tile span { font: 14px ui-monospace, SFMono-Regular, Menlo, monospace; opacity: .65; }
.reveal-tile.is-open { cursor: default; }
.session-finished { max-width: 570px; min-height: 330px; margin: 58px auto 0; border: 1px solid var(--game-line); padding: 42px 28px; background: var(--game-paper); text-align: center; }
.finish-stamp { display: grid; width: 48px; height: 48px; place-items: center; margin: 0 auto 19px; border: 1px solid var(--game-cinnabar); border-radius: 50%; color: var(--game-cinnabar); font-size: 1.5rem; }
.session-finished h2 { margin: 5px 0 8px; font: 800 27px "Noto Serif SC", "Songti SC", serif; }
.session-finished > p:not(.games-eyebrow) { margin: 0 auto; color: var(--game-muted); font-size: 1rem; }
.finish-actions { display: flex; justify-content: center; flex-wrap: wrap; gap: 9px; margin-top: 22px; }
.rules-backdrop { position: fixed; z-index: 100; inset: 0; display: grid; place-items: center; padding: 20px; background: rgba(35, 33, 27, .52); backdrop-filter: blur(5px); }
.rules-dialog { position: relative; width: min(480px, 100%); border: 1px solid #d3c5a9; padding: 35px clamp(24px, 6vw, 48px) 26px; background: var(--game-paper); box-shadow: 0 25px 90px rgba(15, 12, 8, .28); }
.rules-spark { position: absolute; top: 18px; right: 22px; color: var(--game-gold); font-size: 1.5625rem; }
.rules-dialog h2 { margin: 4px 0 14px; font: 800 28px "Noto Serif SC", "Songti SC", serif; }
.rules-dialog > p:not(.games-eyebrow) { color: var(--game-muted); font-size: 1rem; line-height: 1.9; }
.rules-confirm { width: 100%; margin-top: 11px; }
.rules-dialog > small { display: block; margin-top: 11px; color: var(--game-muted); font-size: 0.875rem; text-align: center; }
.rules-fade-enter-active, .rules-fade-leave-active { transition: opacity 180ms; }
.rules-fade-enter-from, .rules-fade-leave-to { opacity: 0; }
@media (max-width: 780px) {
  .games-page { width: min(100% - 28px, 620px); padding-top: 30px; }
  .games-page__frame { inset: 12px 0 20px; }
  .games-heading { margin-bottom: 25px; }
  .games-heading > .games-back { position: static; display: block; margin: 0 auto 12px; }
  .games-menu { grid-template-columns: 1fr; gap: 12px; }
  .mode-card { grid-template-columns: 128px minmax(0, 1fr); min-height: 206px; }
  .mode-card__body { padding: 17px 15px; }
  .mode-card__body h2 { font-size: 1.25rem; }
  .mode-card__body > p:not(.games-eyebrow) { min-height: auto; font-size: 0.9375rem; }
  .mode-card__art--tiles { padding: 14px; }
  .mode-card__actions { padding-top: 12px; }
  .games-button { min-height: 37px; padding: 7px 11px; }
  .play-layout, .play-layout--image { grid-template-columns: 1fr; }
  .play-side { grid-template-columns: 1fr 1fr; align-items: stretch; }
  .clue-box { grid-row: span 2; }
  .answer-hint, .next-question { grid-column: 2; }
  .question-paper { min-height: 285px; }
  .reveal-card { width: min(100%, 410px); }
}
@media (max-width: 480px) {
  .games-page { width: calc(100% - 22px); padding-top: 22px; }
  .games-title { font-size: 2.25rem; }
  .games-intro { font-size: 0.9375rem; }
  .mode-card { grid-template-columns: 96px minmax(0, 1fr); min-height: 198px; }
  .mode-card__art { gap: 6px; }
  .quote-mark { height: 54px; font-size: 5.25rem; }
  .mode-card__art small { left: 7px; bottom: 10px; font-size: 0.75rem; }
  .mode-card__body { padding: 14px 11px; }
  .mode-card__body h2 { font-size: 1.125rem; }
  .mode-card__body > p:not(.games-eyebrow) { font-size: 0.875rem; line-height: 1.55; }
  .mode-card__actions { gap: 4px; }
  .mode-card__actions .games-button { gap: 7px; padding-inline: 8px; font-size: 0.875rem; }
  .setup-title-row { align-items: flex-start; }
  .setup-title-row h2 { font-size: 1.375rem; }
  .setup-locale { padding: 5px 6px; font-size: 0.75rem; }
  .setup-section__head { gap: 10px; }
  .setup-footer { align-items: stretch; flex-direction: column; gap: 12px; }
  .setup-footer .games-button { align-self: stretch; }
  .play-topline { align-items: flex-start; gap: 12px; }
  .play-topline > div { gap: 8px; }
  .play-mode { padding-left: 8px; font-size: 0.9375rem; }
  .play-series { max-width: 44%; padding-top: 6px; font-size: 0.75rem; }
  .play-progress { margin: 17px auto 20px; }
  .play-side { grid-template-columns: 1fr; }
  .clue-box { grid-row: auto; }
  .answer-hint, .next-question { grid-column: auto; }
  .image-question__head { align-items: flex-start; flex-direction: column; }
  .difficulty-live { align-self: flex-end; }
  .question-paper { min-height: 250px; padding: 16px 14px; }
  .question-paper blockquote { padding: 18px 16px; font-size: 1.3125rem; }
  .question-paper__top, .question-paper__bottom { font-size: 0.75rem; }
  .games-footnote { font-size: 0.875rem; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; animation-duration: .01ms !important; }
}
.games-retry{padding:.5rem .75rem;margin:.5rem;border:1px solid var(--color-panel-border);border-radius:.375rem;background:var(--color-card-bg);color:var(--color-text-primary);font-size:.875rem}
</style>
