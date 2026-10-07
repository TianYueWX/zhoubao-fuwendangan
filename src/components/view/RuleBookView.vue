<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from "vue";
import QRCode from "qrcode";
import { ArrowLeft, BookOpen, Copy, Minus, MoreVertical, Plus, Search, Star, X } from "@lucide/vue";
import { navigate, routeToHash } from "@/router/hash";
import { store } from "@/store/analysis";
import { listAllRules } from "@/tools/admin/rules";
import { useVersionedResource } from "@/tools/sources/versionedCache";
import CacheSyncStatus from "@/components/CacheSyncStatus.vue";
import { buildRuleTree, matchRules } from "@/tools/admin/rulesTree";
import type { Rule } from "@/tools/admin/types";
import ReaderCardPanel from "@/components/carddex/ReaderCardPanel.vue";
import { loadPins } from "@/components/carddex/storage";
import type { ReaderCardRequest } from "@/components/carddex/reader";

type LanguageMode = "zh" | "en" | "both";
type ReaderTheme = "paper" | "warm" | "dark";
type ReaderWidth = "full" | "focused" | "wide" | "custom";
type PopupMode = "none" | "search" | "favorites" | "settings" | "share" | "cross-favorite";
interface FlatRule { item: Rule; depth: number }
interface TextPart { text: string; book?: string; number?: string }
interface Favorite { book: string; number: string }

const allRules = ref<Rule[]>([]);
const loading = ref(true);
const error = ref("");
const rulesResource = useVersionedResource("rules", listAllRules);
const query = ref("");
const searchInput = ref<HTMLInputElement | null>(null);
const popupDialog = ref<HTMLDialogElement | null>(null);
const popupMode = ref<PopupMode>("none");
const language = ref<LanguageMode>("zh");
const selected = ref<Set<string>>(new Set());
const selectionMode = ref(false);
const notice = ref("");
const favorites = ref<Favorite[]>([]);
const favoriteTarget = ref<Favorite | null>(null);
const shareUrl = ref("");
const shareQr = ref("");
const readerTheme = ref<ReaderTheme>("paper");
const fontScale = ref(1);
const readerWidth = ref<ReaderWidth>("full");
const customWidth = ref(75);
const documentWidth = computed(() => readerWidth.value === "focused" ? "860px" : readerWidth.value === "wide" ? "1200px" : readerWidth.value === "custom" ? `${customWidth.value}%` : "100%");
const readerDocument = ref<HTMLElement | null>(null);
const cardPanelOpen = ref(false);
const cardPanelMounted = ref(false);
const cardRequest = shallowRef<ReaderCardRequest | null>(null);
const pinnedCount = ref(loadPins().length);
const cardFab = ref<HTMLButtonElement | null>(null);
const mobileViewport = ref(window.innerWidth <= 900);
const textSelection = shallowRef<{ text: string; book: string; number: string; x: number; y: number } | null>(null);
let requestId = 0;
let selectionTimer: ReturnType<typeof setTimeout> | null = null;
let selectingText = false;
let readingPositionVersion = 0;
let readingAnchorActive = false;
let previousOverflowAnchor = '';
const bookName = computed(() => store.currentRuleBook);
const bookRules = computed(() => allRules.value.filter((rule) => (rule.rules_book || "（未分类）") === bookName.value));
const ruleIndexes = computed(() => {
  const byBookAndNumber = new Map<string, Rule>();
  const byNumber = new Map<string, Rule[]>();
  const bookNames = new Set<string>();
  for (const rule of allRules.value) {
    const book = rule.rules_book || "（未分类）";
    byBookAndNumber.set(`${book}\u0000${rule.rule_number}`, rule);
    bookNames.add(book);
    const sameNumber = byNumber.get(rule.rule_number) ?? [];
    sameNumber.push(rule);
    byNumber.set(rule.rule_number, sameNumber);
  }
  return { byBookAndNumber, byNumber, bookNames: [...bookNames].sort((a, b) => b.length - a.length) };
});

function flattenTree(rules: Rule[]): FlatRule[] {
  const output: FlatRule[] = [];
  const walk = (nodes: ReturnType<typeof buildRuleTree>, depth: number) => {
    for (const node of nodes) {
      output.push({ item: node.rule, depth });
      walk(node.children, depth + 1);
    }
  };
  walk(buildRuleTree(rules), 0);
  return output;
}

const flatRules = computed(() => flattenTree(bookRules.value));
const hits = computed(() => query.value.trim() ? matchRules(bookRules.value, query.value) : []);
const selectedRules = computed(() => flatRules.value.map(({ item }) => item).filter((item) => selected.value.has(item.rule_number)));
const favoriteItems = computed(() => favorites.value.map((favorite) => ({
  ...favorite,
  rule: ruleIndexes.value.byBookAndNumber.get(`${favorite.book}\u0000${favorite.number}`),
})));
const shareRule = computed(() => selectedRules.value.length === 1 ? selectedRules.value[0] : null);
const renderedRules = computed(() => flatRules.value.map(({ item, depth }) => ({
  item,
  depth,
  lines: displayLines(item).map(textParts),
})));

function displayLines(rule: Rule): string[] {
  if (language.value === "zh") return [rule.text_zh || rule.text_en || "暂无正文"];
  if (language.value === "en") return [rule.text_en || rule.text_zh || "No text available"];
  return [rule.text_zh || "暂无中文正文", rule.text_en || "No English text"];
}

function toggleSelected(number: string): void {
  const next = new Set(selected.value);
  if (next.has(number)) next.delete(number); else next.add(number);
  selected.value = next;
}

function selectRule(number: string): void {
  textSelection.value = null;
  window.getSelection()?.removeAllRanges();
  selectionMode.value = true;
  toggleSelected(number);
}

function preserveReadingPosition(change: () => void): void {
  const top = document.querySelector('.reader-controls')?.getBoundingClientRect().bottom ?? 60;
  const rows = [...(readerDocument.value?.querySelectorAll<HTMLElement>('.rule-row') ?? [])];
  const row = rows.find(element => {
    const rect = element.getBoundingClientRect();
    return rect.top >= top && rect.top < window.innerHeight;
  }) ?? rows.find(element => element.getBoundingClientRect().bottom > top);
  const offset = row?.getBoundingClientRect().top;
  const version = ++readingPositionVersion;
  if (row && !readingAnchorActive) {
    previousOverflowAnchor = document.documentElement.style.overflowAnchor;
    readingAnchorActive = true;
    document.documentElement.style.overflowAnchor = 'none';
  }
  change();
  if (row && offset !== undefined) void nextTick(() => requestAnimationFrame(() => {
    if (version !== readingPositionVersion) return;
    window.scrollBy({ top: row.getBoundingClientRect().top - offset, behavior: 'instant' });
    // content-visibility can settle rule heights on the following frame.
    requestAnimationFrame(() => {
      if (version !== readingPositionVersion) return;
      window.scrollBy({ top: row.getBoundingClientRect().top - offset, behavior: 'instant' });
      document.documentElement.style.overflowAnchor = previousOverflowAnchor;
      readingAnchorActive = false;
    });
  }));
}

function changeWidth(event: Event): void {
  preserveReadingPosition(() => { readerWidth.value = (event.target as HTMLSelectElement).value as ReaderWidth; });
  savePreferences();
}

function changeCustomWidth(event: Event): void {
  const width = Number((event.target as HTMLInputElement).value);
  if (!Number.isFinite(width)) return;
  preserveReadingPosition(() => { customWidth.value = Math.max(50, Math.min(100, Math.round(width))); });
  savePreferences();
}

function refreshTextSelection(): void {
  if (selectingText) return;
  const selection = window.getSelection();
  const text = selection?.toString().trim() ?? '';
  if (!selection?.rangeCount || selection.isCollapsed || !text || selectionMode.value || popupMode.value !== 'none') {
    textSelection.value = null;
    return;
  }
  const range = selection.getRangeAt(0);
  if (!readerDocument.value?.contains(range.startContainer) || !readerDocument.value.contains(range.endContainer)) {
    textSelection.value = null;
    return;
  }
  const start = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as Element : range.startContainer.parentElement;
  const row = start?.closest<HTMLElement>('.rule-row');
  const rect = [...range.getClientRects()].find(item => item.bottom > 60 && item.top < window.innerHeight);
  if (!row || !rect) { textSelection.value = null; return; }
  const availableRight = cardPanelOpen.value && window.innerWidth > 900
    ? document.querySelector('.reader-card-panel')?.getBoundingClientRect().left ?? window.innerWidth
    : window.innerWidth;
  textSelection.value = {
    text, book: bookName.value, number: row.dataset.ruleNumber ?? '',
    x: Math.max(116, Math.min(availableRight - 116, rect.left + rect.width / 2)),
    y: rect.top > 112 ? rect.top - 48 : Math.min(window.innerHeight - 52, rect.bottom + 8),
  };
}

function scheduleSelection(): void {
  if (selectionTimer) clearTimeout(selectionTimer);
  selectionTimer = setTimeout(refreshTextSelection, 140);
}

function onSelectionPointerDown(event: PointerEvent): void {
  if (!(event.target instanceof Element)) return;
  if (event.target.closest('.text-selection-menu')) return;
  selectingText = Boolean(event.target.closest('.rule-text'));
  textSelection.value = null;
}

function onSelectionPointerUp(): void {
  selectingText = false;
  scheduleSelection();
}

function openCardPanel(): void {
  preserveReadingPosition(() => { cardPanelMounted.value = true; cardPanelOpen.value = true; });
}

function closeCardPanel(): void {
  preserveReadingPosition(() => { cardPanelOpen.value = false; });
  void nextTick(() => cardFab.value?.focus({ preventScroll: true }));
}

function searchSelectedText(): void {
  const selection = textSelection.value;
  if (!selection) return;
  cardRequest.value = { id: ++requestId, text: selection.text, book: selection.book, number: selection.number };
  openCardPanel();
  textSelection.value = null;
  window.getSelection()?.removeAllRanges();
}

async function copySelectedText(): Promise<void> {
  const selection = textSelection.value;
  if (!selection) return;
  try { await navigator.clipboard.writeText(selection.text); notice.value = '文字已复制'; }
  catch { notice.value = '复制失败，请检查浏览器剪贴板权限'; }
  textSelection.value = null;
  window.setTimeout(() => { notice.value = ''; }, 2200);
}

function returnToSource(book: string, number: string): void {
  if (window.innerWidth <= 900) closeCardPanel();
  if (book !== bookName.value) navigate({ view: 'rulebook', ruleBook: book, ruleNumber: number });
  else void nextTick(() => scrollToRule(number));
}

function onReaderKey(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || popupMode.value !== 'none' || cardPanelOpen.value) return;
  textSelection.value = null;
  window.getSelection()?.removeAllRanges();
  if (selectionMode.value) completeSelection();
}

function onReaderResize(): void {
  mobileViewport.value = window.innerWidth <= 900;
  scheduleSelection();
}

function syncPinnedCount(event: StorageEvent): void {
  if (event.key === 'carddex:pins:v1' || event.key === null) pinnedCount.value = loadPins().length;
}

function completeSelection(): void {
  selectionMode.value = false;
  selected.value = new Set();
}

function scrollToRule(number: string): void {
  document.getElementById(ruleId(number))?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: "center" });
}

function ruleId(number: string): string { return `rule-${encodeURIComponent(number)}`; }

function textParts(text: string): TextPart[] {
  const spans: Array<{ start: number; end: number; part: TextPart }> = [];
  const { byBookAndNumber, byNumber, bookNames } = ruleIndexes.value;
  const referencePattern = /(?<![\w.])(?:(?:rules?|规则)\s*(?:第\s*)?)?(\d+(?:\.\w+)*)(?![\w]|\.\d)/gi;
  for (const match of text.matchAll(referencePattern)) {
    const number = match[1] ?? "";
    if (match.index === undefined) continue;
    const beforeNumber = text.slice(0, match.index);
    const linkedBook = bookNames.find((book) => beforeNumber.endsWith(`${book}/`));
    const start = linkedBook ? match.index - linkedBook.length - 1 : match.index;
    const target = linkedBook
      ? byBookAndNumber.get(`${linkedBook}\u0000${number}`)
      : byBookAndNumber.get(`${bookName.value}\u0000${number}`) ?? byNumber.get(number)?.[0];
    if (target) {
      let end = match.index + match[0].length;
      if (target.is_heading) {
        const tail = text.slice(end);
        const separator = tail.match(/^[.．、,，:：]?\s*/)?.[0] ?? "";
        const afterSeparator = tail.slice(separator.length);
        const heading = [target.text_zh, target.text_en]
          .map((value) => value?.trim() ?? "")
          .filter(Boolean)
          .sort((a, b) => b.length - a.length)
          .find((value) => afterSeparator.slice(0, value.length).toLocaleLowerCase() === value.toLocaleLowerCase());
        if (heading) end += separator.length + heading.length;
      }
      spans.push({
        start,
        end,
        part: { text: text.slice(start, end), book: target.rules_book || "（未分类）", number },
      });
    }
  }
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const parts: TextPart[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start < cursor) continue;
    if (span.start > cursor) parts.push({ text: text.slice(cursor, span.start) });
    parts.push(span.part);
    cursor = span.end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  return parts;
}

function openSearch(): void {
  openPopup("search");
}

function closeSearch(): void {
  closePopup();
}

function chooseSearchHit(number: string): void {
  closeSearch();
  nextTick(() => scrollToRule(number));
}

function openPopup(mode: Exclude<PopupMode, "none">): void {
  popupMode.value = mode;
  nextTick(() => {
    if (popupDialog.value && !popupDialog.value.open) popupDialog.value.showModal();
    if (mode === "search") searchInput.value?.focus();
  });
}

function closePopup(): void {
  popupMode.value = "none";
  if (popupDialog.value?.open) popupDialog.value.close();
}

function loadPreferences(): void {
  try {
    const savedFavorites = JSON.parse(localStorage.getItem("rulebook:favorites") || "[]") as unknown;
    if (Array.isArray(savedFavorites)) {
      favorites.value = savedFavorites.filter((item): item is Favorite =>
        item && typeof item.book === "string" && typeof item.number === "string",
      );
    }
    const savedTheme = localStorage.getItem("rulebook:theme");
    if (savedTheme === "paper" || savedTheme === "warm" || savedTheme === "dark") readerTheme.value = savedTheme;
    const savedScale = Number(localStorage.getItem("rulebook:font-scale"));
    if (Number.isFinite(savedScale) && savedScale >= 0.85 && savedScale <= 1.5) fontScale.value = savedScale;
    const savedWidth = localStorage.getItem('rulebook:width');
    if (savedWidth === 'full' || savedWidth === 'focused' || savedWidth === 'wide' || savedWidth === 'custom') readerWidth.value = savedWidth;
    const savedCustomWidth = Number(localStorage.getItem('rulebook:custom-width'));
    if (Number.isFinite(savedCustomWidth) && savedCustomWidth >= 50 && savedCustomWidth <= 100) customWidth.value = savedCustomWidth;
  } catch { /* 本机存储不可用时维持默认设置 */ }
}

function savePreferences(): void {
  try {
    localStorage.setItem("rulebook:favorites", JSON.stringify(favorites.value));
    localStorage.setItem("rulebook:theme", readerTheme.value);
    localStorage.setItem("rulebook:font-scale", String(fontScale.value));
    localStorage.setItem('rulebook:width', readerWidth.value);
    localStorage.setItem('rulebook:custom-width', String(customWidth.value));
  } catch { notice.value = "浏览器未允许保存本机阅读设置"; }
}

function addSelectedToFavorites(): void {
  const next = [...favorites.value];
  for (const rule of selectedRules.value) {
    const favorite = { book: rule.rules_book || "（未分类）", number: rule.rule_number };
    if (!next.some((item) => item.book === favorite.book && item.number === favorite.number)) next.push(favorite);
  }
  favorites.value = next;
  savePreferences();
  notice.value = `已收藏 ${selectedRules.value.length} 条规则`;
  window.setTimeout(() => { notice.value = ""; }, 2200);
}

function removeFavorite(book: string, number: string): void {
  favorites.value = favorites.value.filter((item) => item.book !== book || item.number !== number);
  savePreferences();
}

function openFavorite(favorite: Favorite): void {
  if (favorite.book !== bookName.value) {
    favoriteTarget.value = favorite;
    closePopup();
    nextTick(() => openPopup("cross-favorite"));
    return;
  }
  closePopup();
  nextTick(() => scrollToRule(favorite.number));
}

function jumpToFavorite(newPage: boolean): void {
  const favorite = favoriteTarget.value;
  if (!favorite) return;
  const route = { view: "rulebook", ruleBook: favorite.book, ruleNumber: favorite.number } as const;
  if (newPage) {
    const url = new URL(window.location.href);
    url.hash = routeToHash(route);
    window.open(url.toString(), "_blank", "noopener,noreferrer");
  } else {
    navigate(route);
  }
  favoriteTarget.value = null;
  closePopup();
}

async function openSharePopup(): Promise<void> {
  if (!shareRule.value) return;
  const targetBook = shareRule.value.rules_book || bookName.value;
  const url = new URL(window.location.href);
  url.hash = routeToHash({ view: "rulebook", ruleBook: targetBook, ruleNumber: shareRule.value.rule_number });
  shareUrl.value = url.toString();
  shareQr.value = "";
  openPopup("share");
  try {
    shareQr.value = await QRCode.toDataURL(shareUrl.value, { errorCorrectionLevel: "M", width: 240, margin: 2 });
  } catch { notice.value = "二维码生成失败"; }
}

async function copyShareUrl(): Promise<void> {
  try {
    await navigator.clipboard.writeText(shareUrl.value);
    notice.value = "链接已复制";
  } catch { notice.value = "复制失败，请检查剪贴板权限"; }
  window.setTimeout(() => { notice.value = ""; }, 2200);
}

function changeFont(delta: number): void {
  fontScale.value = Math.max(0.85, Math.min(1.5, Math.round((fontScale.value + delta) * 100) / 100));
  savePreferences();
}

function setTheme(theme: ReaderTheme): void {
  readerTheme.value = theme;
  savePreferences();
}

function openReference(part: TextPart): void {
  if (!part.book || !part.number) return;
  navigate({ view: "rulebook", ruleBook: part.book, ruleNumber: part.number });
  if (part.book === bookName.value) nextTick(() => scrollToRule(part.number!));
}

function onReferenceClick(event: MouseEvent, part: TextPart): void {
  if (window.getSelection()?.toString().trim()) {
    event.preventDefault();
    return;
  }
  event.stopPropagation();
  openReference(part);
}

function contentForCopy(rule: Rule): string {
  const text = displayLines(rule).join("\n");
  return `${rule.rule_number}  ${text}`;
}

async function copySelected(): Promise<void> {
  if (!selectedRules.value.length) return;
  try {
    await navigator.clipboard.writeText(selectedRules.value.map(contentForCopy).join("\n\n"));
    notice.value = `已复制 ${selectedRules.value.length} 条规则`;
  } catch {
    notice.value = "复制失败，请检查浏览器剪贴板权限";
  }
  window.setTimeout(() => { notice.value = ""; }, 2400);
}

function exportSelectedImage(): void {
  if (!selectedRules.value.length) return;
  const canvas = document.createElement("canvas");
  const width = 1200;
  const padding = 72;
  const bodyFont = "22px system-ui, sans-serif";
  const lineHeight = 38;
  canvas.width = width;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.font = bodyFont;
  const maxWidth = width - padding * 2;
  const blocks = selectedRules.value.map((rule) => {
    const source = contentForCopy(rule).split("\n");
    const lines: string[] = [];
    for (const paragraph of source) {
      let line = "";
      for (const char of paragraph) {
        if (line && ctx.measureText(line + char).width > maxWidth) {
          lines.push(line);
          line = char;
        } else line += char;
      }
      lines.push(line);
    }
    return lines;
  });
  const height = padding + 52 + blocks.reduce((sum, lines) => sum + lines.length * lineHeight + 34, 0) + padding;
  canvas.height = height;
  const draw = canvas.getContext("2d");
  if (!draw) return;
  draw.fillStyle = "#f8f5ee";
  draw.fillRect(0, 0, width, height);
  draw.fillStyle = "#6b5234";
  draw.font = "600 17px system-ui, sans-serif";
  draw.fillText(`${bookName.value} · ${language.value === "zh" ? "中文" : language.value === "en" ? "English" : "中英对照"}`, padding, padding);
  let y = padding + 58;
  draw.font = bodyFont;
  for (const block of blocks) {
    draw.fillStyle = "#27231d";
    for (const line of block) {
      draw.fillText(line, padding, y);
      y += lineHeight;
    }
    y += 30;
  }
  const link = document.createElement("a");
  link.download = `${bookName.value}-${selectedRules.value.length}条规则.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const rows = await rulesResource.load();
    allRules.value = rows ?? [];
    if (!allRules.value.some((rule) => (rule.rules_book || "（未分类）") === bookName.value)) {
      error.value = `找不到规则书“${bookName.value}”`;
    } else if (store.currentRuleTarget) {
      await nextTick();
      scrollToRule(store.currentRuleTarget);
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "规则书加载失败";
  } finally {
    loading.value = false;
  }
}

watch(rulesResource.data, (rows) => {
  if (rows) {
    allRules.value = rows;
    loading.value = false;
  }
}, { immediate: true });

async function refreshRules(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const rows = await rulesResource.load(true);
    if (rows) allRules.value = rows;
    await load();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "规则书更新失败";
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  loadPreferences();
  void load();
  document.addEventListener('selectionchange', scheduleSelection);
  document.addEventListener('pointerdown', onSelectionPointerDown);
  document.addEventListener('pointerup', onSelectionPointerUp);
  document.addEventListener('pointercancel', onSelectionPointerUp);
  window.addEventListener('scroll', scheduleSelection, { passive: true });
  window.addEventListener('resize', onReaderResize);
  window.addEventListener('keydown', onReaderKey);
  window.addEventListener('storage', syncPinnedCount);
});
onUnmounted(() => {
  readingPositionVersion++;
  if (readingAnchorActive) document.documentElement.style.overflowAnchor = previousOverflowAnchor;
  if (selectionTimer) clearTimeout(selectionTimer);
  document.removeEventListener('selectionchange', scheduleSelection);
  document.removeEventListener('pointerdown', onSelectionPointerDown);
  document.removeEventListener('pointerup', onSelectionPointerUp);
  document.removeEventListener('pointercancel', onSelectionPointerUp);
  window.removeEventListener('scroll', scheduleSelection);
  window.removeEventListener('resize', onReaderResize);
  window.removeEventListener('keydown', onReaderKey);
  window.removeEventListener('storage', syncPinnedCount);
});
watch(() => store.currentRuleTarget, (number) => {
  if (number) nextTick(() => scrollToRule(number));
});
watch(bookName, () => {
  selected.value = new Set();
  selectionMode.value = false;
  query.value = "";
  textSelection.value = null;
});
</script>

<template>
  <div class="reader-screen" :class="[`theme-${readerTheme}`, { 'card-panel-open': cardPanelOpen }]" :style="{ '--reader-font-scale': fontScale, '--reader-document-width': documentWidth }">
    <button class="reader-back" :inert="mobileViewport && cardPanelOpen" type="button" aria-label="返回规则列表" @click="navigate({ view: 'rules' })"><ArrowLeft :size="18" aria-hidden="true" /> 返回规则</button>
    <div v-if="loading" class="state-card">正在加载规则书…</div>
    <div v-else-if="error" class="state-card error" role="alert"><p>{{ error }}</p><button class="reader-retry" @click="refreshRules">重新加载规则书</button></div>
    <template v-else>
      <div class="reader-controls" :inert="mobileViewport && cardPanelOpen" aria-label="阅读设置">
        <label class="width-control"><span>{{ language === 'en' ? 'Width' : '宽度' }}</span><select :value="readerWidth" :aria-label="language === 'en' ? 'Reader width' : '阅读宽度'" @change="changeWidth"><option value="full">{{ language === 'en' ? 'Full' : '全宽' }}</option><option value="focused">{{ language === 'en' ? 'Focused' : '专注' }}</option><option value="wide">{{ language === 'en' ? 'Wide' : '宽版' }}</option><option value="custom">{{ language === 'en' ? 'Custom' : '自定义' }}</option></select></label>
        <div v-if="readerWidth === 'custom'" class="custom-width-control"><input type="range" min="50" max="100" :value="customWidth" :aria-label="language === 'en' ? 'Custom reader width' : '自定义阅读宽度'" @input="changeCustomWidth" /><input type="number" min="50" max="100" :value="customWidth" :aria-label="language === 'en' ? 'Reader width percentage' : '阅读宽度百分比'" @change="changeCustomWidth" /><span>%</span></div>
        <button class="icon-control" aria-label="搜索规则" title="搜索规则" @click="openSearch"><Search :size="18" aria-hidden="true" /></button>
        <div class="language-switch" aria-label="语言模式">
          <button v-for="option in [{ id: 'zh', label: '中' }, { id: 'en', label: '英' }, { id: 'both', label: '中英' }]" :key="option.id" :class="{ active: language === option.id }" @click="language = option.id as LanguageMode">{{ option.label }}</button>
        </div>
        <button class="icon-control" aria-label="收藏夹" title="收藏夹" @click="openPopup('favorites')"><Star :size="18" aria-hidden="true" /></button>
        <button class="icon-control settings-trigger" aria-label="页面设置" title="页面设置" @click="openPopup('settings')"><MoreVertical :size="20" aria-hidden="true" /></button>
      </div>
      <p v-if="notice" class="notice" role="status">{{ notice }}</p>
      <main ref="readerDocument" class="reader-document" :inert="mobileViewport && cardPanelOpen">
        <article
          v-for="{ item, depth, lines } in renderedRules"
          :id="ruleId(item.rule_number)"
          :key="item.id"
          :data-rule-number="item.rule_number"
          class="rule-row"
          :class="{ selected: selected.has(item.rule_number), chapter: item.is_heading }"
          :style="{ '--depth': depth }"
        >
          <div class="rule-copy">
            <p v-for="(parts, lineIndex) in lines" :key="lineIndex" class="rule-line" :class="{ 'english-line': language === 'both' && lineIndex > 0 }">
              <button v-if="lineIndex === 0" class="rule-number" :aria-label="language === 'en' ? `${selected.has(item.rule_number) ? 'Deselect' : 'Select'} rule ${item.rule_number}` : `${selected.has(item.rule_number) ? '取消选择' : '选择'}规则 ${item.rule_number}`" :aria-pressed="selected.has(item.rule_number)" :title="language === 'en' ? 'Select this rule' : '点击编号选择整条规则'" @click="selectRule(item.rule_number)">{{ item.rule_number }}</button>
              <span class="rule-text">
                <template v-for="(part, partIndex) in parts" :key="partIndex"><button v-if="part.book" class="rule-reference" @click="onReferenceClick($event, part)">{{ part.text }}</button><span v-else>{{ part.text }}</span></template>
              </span>
            </p>
          </div>
        </article>
      </main>

      <div v-if="textSelection" class="text-selection-menu" role="toolbar" :aria-label="language === 'en' ? 'Selected text actions' : '所选文字操作'" :style="{ left: `${textSelection.x}px`, top: `${textSelection.y}px` }" @pointerdown.prevent>
        <button @click="searchSelectedText"><Search :size="15" />{{ language === 'en' ? 'Search cards' : '搜索卡牌' }}</button>
        <button @click="copySelectedText"><Copy :size="14" />{{ language === 'en' ? 'Copy' : '复制' }}</button>
      </div>
      <button v-show="!cardPanelOpen" ref="cardFab" class="card-search-fab" :aria-label="language === 'en' ? 'Open card search' : '打开卡牌查询'" aria-controls="reader-card-panel" :aria-expanded="cardPanelOpen" @click="openCardPanel"><BookOpen :size="19" /><span>{{ language === 'en' ? 'Cards' : '卡牌查询' }}</span><b v-if="pinnedCount">{{ pinnedCount }}</b></button>
      <ReaderCardPanel v-if="cardPanelMounted" :open="cardPanelOpen" :mobile="mobileViewport" :locale="language === 'en' ? 'en' : 'zh'" :request="cardRequest" @close="closeCardPanel" @source="returnToSource" @pins="pinnedCount = $event" />

      <div v-if="selectionMode" class="selection-bar" :inert="mobileViewport && cardPanelOpen" role="toolbar" aria-label="已选规则操作">
        <span class="selection-count">已选 {{ selected.size }} 条</span>
        <button v-if="selected.size === 1" @click="openSharePopup">分享链接</button>
        <button @click="copySelected">复制段落</button>
        <button @click="exportSelectedImage">导出图片</button>
        <button @click="addSelectedToFavorites">收藏</button>
        <button class="finish-selection" @click="completeSelection">完成</button>
      </div>

      <dialog ref="popupDialog" class="reader-popup" :class="{ 'search-popup': popupMode === 'search' }" @close="popupMode = 'none'">
        <template v-if="popupMode === 'search'">
          <div class="popup-title-row"><h2>搜索本书</h2><button class="popup-x" aria-label="关闭" @click="closeSearch"><X :size="20" /></button></div>
          <label class="popup-search"><Search :size="17" aria-hidden="true" /><input ref="searchInput" v-model="query" type="search" placeholder="输入规则编号或正文内容" @keydown.esc="closeSearch" /></label>
          <div class="popup-results" aria-live="polite">
            <p v-if="!query.trim()" class="popup-hint">搜索当前规则书</p>
            <p v-else-if="!hits.length" class="popup-hint">没有匹配的规则</p>
            <button v-for="hit in hits.slice(0, 80)" :key="hit.id" class="popup-result" @click="chooseSearchHit(hit.rule_number)">
              <span class="popup-number">{{ hit.rule_number }}</span><span>{{ hit.text_zh || hit.text_en || '暂无正文' }}</span>
            </button>
            <p v-if="hits.length > 80" class="popup-hint">显示前 80 条，请缩小检索范围。</p>
          </div>
        </template>

        <template v-else-if="popupMode === 'favorites'">
          <div class="popup-title-row"><h2>收藏</h2><button class="popup-x" aria-label="关闭" @click="closePopup"><X :size="20" /></button></div>
          <div v-if="!favoriteItems.length" class="popup-hint empty-favorites">还没有收藏规则</div>
          <div v-else class="popup-results favorites-results">
            <div v-for="favorite in favoriteItems" :key="`${favorite.book}/${favorite.number}`" class="favorite-row">
              <button class="favorite-open" @click="openFavorite(favorite)">
                <span class="favorite-book">{{ favorite.book }}</span>
                <span class="popup-number">{{ favorite.number }}</span>
                <span class="favorite-title">{{ favorite.rule?.text_zh || favorite.rule?.text_en || '规则条目' }}</span>
              </button>
              <button class="favorite-remove" :aria-label="`移除收藏 ${favorite.number}`" @click="removeFavorite(favorite.book, favorite.number)"><X :size="16" /></button>
            </div>
          </div>
        </template>

        <template v-else-if="popupMode === 'settings'">
          <div class="popup-title-row"><h2>页面设置</h2><button class="popup-x" aria-label="关闭" @click="closePopup"><X :size="20" /></button></div>
          <section class="setting-section"><h3>主题颜色</h3><div class="theme-options">
            <button v-for="theme in [{ id: 'paper', label: '纸白' }, { id: 'warm', label: '暖纸' }, { id: 'dark', label: '深色' }]" :key="theme.id" :class="['theme-option', `sample-${theme.id}`, { active: readerTheme === theme.id }]" @click="setTheme(theme.id as ReaderTheme)">{{ theme.label }}</button>
          </div></section>
          <section class="setting-section"><h3>字体大小</h3><div class="font-setting"><button aria-label="减小字号" :disabled="fontScale <= 0.85" @click="changeFont(-0.1)"><Minus :size="16" /></button><span>{{ Math.round(fontScale * 100) }}%</span><button aria-label="增大字号" :disabled="fontScale >= 1.5" @click="changeFont(0.1)"><Plus :size="16" /></button></div></section>
          <section class="setting-section"><h3>规则资料</h3><CacheSyncStatus :checking="rulesResource.checking.value" :stale="rulesResource.stale.value" :saved-at="rulesResource.savedAt.value" :error="rulesResource.error.value" :disabled="rulesResource.loading.value" @refresh="refreshRules" /></section>
        </template>

        <template v-else-if="popupMode === 'share' && shareRule">
          <div class="popup-title-row"><h2>分享规则 {{ shareRule.rule_number }}</h2><button class="popup-x" aria-label="关闭" @click="closePopup"><X :size="20" /></button></div>
          <p class="share-rule-name">{{ shareRule.text_zh || shareRule.text_en || shareRule.rule_number }}</p>
          <div class="share-link-row"><input :value="shareUrl" readonly aria-label="规则定位链接" /><button @click="copyShareUrl">复制链接</button></div>
          <div class="share-qr-wrap"><img v-if="shareQr" :src="shareQr" :alt="`规则 ${shareRule.rule_number} 的二维码`" /><span v-else>正在生成二维码…</span></div>
        </template>

        <template v-else-if="popupMode === 'cross-favorite' && favoriteTarget">
          <div class="popup-title-row"><h2>打开收藏规则</h2><button class="popup-x" aria-label="关闭" @click="closePopup"><X :size="20" /></button></div>
          <p class="cross-book-label">{{ favoriteTarget.book }} · {{ favoriteTarget.number }}</p>
          <div class="cross-book-actions"><button @click="jumpToFavorite(false)">当前页面跳转</button><button @click="jumpToFavorite(true)">新页面打开</button></div>
        </template>
      </dialog>
    </template>
  </div>
</template>

<style scoped>
.reader-screen { --paper: #fff; --ink: #252525; --muted-ink: #626262; --reader-accent: #a33224; --reader-panel-width: clamp(340px, 28vw, 440px); --reader-border: color-mix(in srgb, var(--ink) 16%, transparent); --reader-soft: color-mix(in srgb, var(--ink) 6%, var(--paper)); min-height: 100vh; min-width: 0; padding: 8px 18px 96px; background: #f4f1ea; color: var(--ink); transition: background-color .2s, color .2s; }
.reader-screen.card-panel-open { padding-right: calc(var(--reader-panel-width) + 18px); }
.reader-screen.theme-paper { --paper: #fff; --ink: #252525; --muted-ink: #626262; background: #f4f1ea; }
.reader-screen.theme-warm { --paper: #f7f0df; --ink: #342d22; --muted-ink: #716553; background: #e9e1d0; }
.reader-screen.theme-dark { --paper: #252525; --ink: #e9e5dc; --muted-ink: #b9b2a6; --reader-accent: #e59b86; background: #191919; color-scheme: dark; }
.reader-controls { position: sticky; top: 8px; z-index: 20; display: flex; justify-content: flex-end; flex-wrap: wrap; align-items: center; gap: 8px; width: 100%; margin: 0 auto; }
.width-control { display: inline-flex; align-items: center; gap: 6px; min-height: 38px; padding: 0 10px; color: var(--muted-ink); background: var(--paper); border-radius: 20px; font-size: 12px; }
.width-control select { min-width: 62px; padding: 6px 0; color: var(--ink); background: var(--paper); cursor: pointer; }
.custom-width-control { display: flex; align-items: center; gap: 5px; padding: 5px 9px; color: var(--muted-ink); background: var(--paper); border-radius: 18px; font-size: 11px; }
.custom-width-control input[type='range'] { width: 100px; accent-color: var(--reader-accent); }
.custom-width-control input[type='number'] { width: 44px; padding: 3px; color: var(--ink); background: transparent; }
.icon-control { display: grid; place-items: center; width: 38px; height: 38px; color: var(--muted-ink); background: color-mix(in srgb, var(--paper) 90%, transparent); border-radius: 50%; font: 22px/1 system-ui, sans-serif; }
.icon-control:hover { color: var(--ink); background: var(--paper); }
.settings-trigger { font-size: 27px; }
.language-switch { display: flex; gap: 1px; padding: 3px; background: color-mix(in srgb, var(--paper) 90%, transparent); border-radius: 999px; }
.language-switch button { min-width: 34px; padding: 6px 9px; border-radius: 999px; color: var(--muted-ink); font-size: 11px; }
.language-switch button.active { color: var(--paper); background: var(--ink); }
.reader-document { width: min(100%, var(--reader-document-width, 100%)); min-height: calc(100vh - 54px); margin: 16px auto 0; padding: 40px clamp(22px, 3vw, 48px) 100px; background: var(--paper); color: var(--ink); font-size: calc(16px * var(--reader-font-scale)); transition: background-color .2s, color .2s; }
.rule-row { margin-top: 1.25em; margin-left: calc(min(var(--depth), 5) * 1.25em); padding: .12em .35em; border-radius: 2px; scroll-margin-top: 80px; content-visibility: auto; contain-intrinsic-size: auto 90px; touch-action: pan-y; cursor: text; }
.rule-row.chapter { margin-top: 2.4em; }
.rule-row.selected { background: #f7e7a7; color: #242018; }
.theme-dark .rule-row.selected { background: #594b26; color: #fff8e7; }
.rule-copy { font-family: "Noto Serif SC", "Songti SC", "Noto Serif", Georgia, serif; }
.rule-line { display: grid; grid-template-columns: 4.7em minmax(0, 1fr); align-items: baseline; margin: 0; font: 400 1em/1.95 "Noto Serif SC", "Songti SC", "Noto Serif", Georgia, serif; overflow-wrap: anywhere; white-space: pre-wrap; }
.rule-row.chapter .rule-line { font-weight: 700; }
.rule-row.chapter .rule-line:first-child { font-size: 1.12em; }
.rule-number { justify-self: start; padding: 4px 5px; margin-left: -5px; text-align: left; color: #8a7652; font: 600 .8em/1.6 ui-monospace, monospace; white-space: nowrap; cursor: pointer; user-select: none; }
.rule-number:hover { color: var(--reader-accent); background: var(--reader-soft); }
.theme-dark .rule-number { color: #cbb887; }
.rule-text { min-width: 0; font-family: inherit; user-select: text; -webkit-user-select: text; }
.rule-text > span { font-family: inherit; }
.english-line .rule-text { grid-column: 2; color: var(--muted-ink); font-size: .92em; }
.rule-row.selected .english-line .rule-text { color: inherit; }
.rule-reference { color: #a33224; font: inherit; text-decoration: underline; text-decoration-color: color-mix(in srgb, currentColor 45%, transparent); text-decoration-thickness: 1px; text-underline-offset: 3px; cursor: pointer; }
.theme-dark .rule-reference { color: #e59b86; }
.rule-reference:hover { text-decoration-color: currentColor; }
.text-selection-menu { position: fixed; z-index: 45; transform: translateX(-50%); display: flex; align-items: center; gap: 3px; padding: 4px; max-width: calc(100vw - 16px); color: var(--ink); background: var(--paper); border: 1px solid var(--reader-border); border-radius: 7px; box-shadow: 0 5px 22px #0002; }
.text-selection-menu button { display: inline-flex; align-items: center; gap: 6px; min-height: 34px; padding: 6px 10px; border-radius: 4px; font-size: 12px; white-space: nowrap; }
.text-selection-menu button:first-child { color: var(--reader-accent); }
.text-selection-menu button:hover { background: var(--reader-soft); }
.card-search-fab { position: fixed; right: max(18px, env(safe-area-inset-right)); bottom: max(18px, env(safe-area-inset-bottom)); z-index: 40; display: flex; align-items: center; gap: 8px; min-height: 48px; padding: 12px 16px; border: 1px solid var(--reader-border); border-radius: 26px; color: var(--paper); background: var(--ink); box-shadow: 0 5px 20px #0002; font-size: 13px; }
.card-search-fab:hover { background: var(--reader-accent); }
.card-search-fab b { display: grid; place-items: center; min-width: 21px; height: 21px; padding-inline: 4px; border-radius: 12px; color: var(--ink); background: var(--paper); font: 600 11px ui-monospace, monospace; }
.selection-bar { position: fixed; z-index: 40; left: 50%; bottom: max(18px, env(safe-area-inset-bottom)); transform: translateX(-50%); display: flex; align-items: center; gap: 5px; max-width: calc(100vw - 24px); padding: 7px; color: #fff; background: #292929; border-radius: 7px; box-shadow: 0 8px 28px #0003; white-space: nowrap; }
.selection-bar button { padding: 8px 10px; color: #f6f2e9; border-radius: 4px; font-size: 12px; }
.selection-bar button:hover { background: #ffffff1a; }
.selection-bar .finish-selection { color: #fff; background: #8e3428; }
.card-panel-open .selection-bar { left: calc((100vw - var(--reader-panel-width)) / 2); max-width: calc(100vw - var(--reader-panel-width) - 24px); }
.selection-count { padding: 0 8px; color: #c9c3b7; font-size: 11px; }
.state-card { width: min(100%, 760px); margin: 20vh auto 0; padding: 24px; color: var(--muted-ink); background: var(--paper); }
.state-card.error { color: #9e493b; }
.notice { position: fixed; z-index: 80; left: 50%; bottom: 78px; transform: translateX(-50%); padding: 10px 15px; color: white; background: #343b34; border-radius: 4px; font-size: 12px; }
.reader-popup { width: min(560px, calc(100vw - 28px)); max-height: min(78vh, 700px); padding: 0; border: 0; color: #292722; background: #fffefa; box-shadow: 0 18px 70px #0004; }
.reader-popup.search-popup[open] { display: flex; flex-direction: column; height: min(640px, calc(100dvh - 48px)); max-height: calc(100dvh - 48px); overflow: hidden; }
.search-popup .popup-title-row, .search-popup .popup-search { flex-shrink: 0; }
.search-popup .popup-results { flex: 1; min-height: 0; max-height: none; overscroll-behavior: contain; }
.reader-popup::backdrop { background: #17151280; backdrop-filter: blur(2px); }
.popup-title-row { display: flex; justify-content: space-between; align-items: center; padding: 20px 22px 14px; }
.popup-title-row h2 { font: 600 19px/1.4 "Noto Serif SC", "Songti SC", Georgia, serif; }
.popup-x { display: grid; place-items: center; width: 32px; height: 32px; padding: 0; color: #777166; }
.popup-search { display: flex; align-items: center; gap: 10px; margin: 0 22px 12px; padding: 0 12px; height: 46px; background: #f3f1eb; color: #8d382c; }
.popup-search > .lucide { flex: none; color: var(--muted-ink); }
.popup-search input { flex: 1; min-width: 0; height: 100%; outline: 0; background: transparent; color: #292722; font-size: 14px; }
.popup-results { max-height: min(56vh, 500px); overflow: auto; padding: 3px 12px 14px; }
.popup-hint { padding: 16px 12px; color: #8c877d; font-size: 12px; }
.popup-result { display: grid; grid-template-columns: 58px minmax(0, 1fr); gap: 12px; width: 100%; padding: 11px 10px; text-align: left; color: #48443d; font: 13px/1.7 "Noto Serif SC", "Songti SC", Georgia, serif; }
.popup-result:hover, .favorite-open:hover { background: #f5f1e8; }
.popup-number { color: #963b2d; font: 600 11px/1.8 ui-monospace, monospace; white-space: nowrap; }
.favorites-results { padding-top: 5px; }
.favorite-row { display: flex; align-items: center; gap: 6px; }
.favorite-open { display: grid; grid-template-columns: minmax(0, 1fr) 55px minmax(0, 2fr); align-items: baseline; gap: 8px; flex: 1; min-width: 0; padding: 10px; text-align: left; }
.favorite-book { overflow: hidden; color: #857d6e; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.favorite-title { overflow: hidden; color: #4c473d; font: 12px/1.6 "Noto Serif SC", "Songti SC", Georgia, serif; text-overflow: ellipsis; white-space: nowrap; }
.favorite-remove { display: grid; flex: 0 0 30px; place-items: center; width: 30px; height: 30px; padding: 0; color: #948b7d; }
.favorite-remove:hover { color: #963b2d; }
.empty-favorites { padding: 24px; }
.setting-section { padding: 8px 22px 17px; }
.setting-section + .setting-section { padding-top: 14px; border-top: 1px solid #eeece6; }
.setting-section h3 { margin-bottom: 10px; color: #80796c; font-size: 11px; font-weight: 500; }
.theme-options { display: flex; gap: 8px; }
.theme-option { min-width: 90px; padding: 10px 13px; border: 1px solid #d9d5cb; border-radius: 3px; font-size: 12px; }
.theme-option.active { outline: 2px solid #a44233; outline-offset: 1px; }
.sample-paper { color: #292722; background: #fff; }
.sample-warm { color: #342d22; background: #f7f0df; }
.sample-dark { color: #e9e5dc; background: #252525; }
.font-setting { display: flex; align-items: center; gap: 14px; }
.font-setting button { width: 34px; height: 34px; background: #f1eee7; color: #38352e; font-size: 20px; }
.font-setting button:disabled { opacity: .4; }
.font-setting span { min-width: 46px; text-align: center; color: #706a60; font: 11px ui-monospace, monospace; }
.share-rule-name { padding: 0 22px 12px; color: #676052; font: 13px/1.7 "Noto Serif SC", Georgia, serif; }
.share-link-row { display: flex; gap: 8px; padding: 0 22px; }
.share-link-row input { flex: 1; min-width: 0; padding: 10px; color: #615a4f; background: #f3f1eb; font-size: 11px; }
.share-link-row button, .cross-book-actions button { padding: 9px 13px; color: #fff; background: #37352f; font-size: 12px; white-space: nowrap; }
.share-qr-wrap { display: grid; place-items: center; min-height: 190px; padding: 18px; color: #81796c; font-size: 12px; }
.share-qr-wrap img { width: 180px; height: 180px; image-rendering: pixelated; }
.cross-book-label { padding: 2px 22px 18px; color: #736c60; font-size: 13px; }
.cross-book-actions { display: flex; gap: 9px; justify-content: flex-end; padding: 0 22px 22px; }
.cross-book-actions button:first-child { color: #39362f; background: #eeece5; }
.cross-book-actions button:hover, .share-link-row button:hover { filter: brightness(.9); }
@media (max-width: 900px) {
  .reader-screen.card-panel-open { padding-right: 18px; }
  .reader-document { width: 100%; }
  .custom-width-control { display: none; }
  .card-panel-open .selection-bar { left: 50%; max-width: calc(100vw - 24px); }
  .text-selection-menu { top: auto !important; left: 50% !important; bottom: max(82px, calc(env(safe-area-inset-bottom) + 66px)); }
}
@media (max-width: 640px) {
  .reader-screen { padding: 5px 0 105px; }
  .reader-screen.card-panel-open { padding-right: 0; }
  .reader-controls { top: 5px; padding: 0 8px; gap: 4px; }
  .width-control { padding: 0 8px; }
  .width-control > span { display: none; }
  .icon-control { width: 34px; height: 38px; }
  .language-switch button { min-width: 28px; padding: 6px; }
  .reader-document { width: 100%; min-height: calc(100vh - 48px); margin-top: 7px; padding: 28px 18px 90px; }
  .rule-row { margin-left: calc(min(var(--depth), 4) * .55em); padding-inline: .2em; }
  .rule-line { grid-template-columns: 3.8em minmax(0, 1fr); }
  .selection-bar { gap: 0; width: calc(100vw - 16px); justify-content: space-between; padding: 5px 4px; }
  .selection-bar button { padding: 9px 6px; font-size: 10px; }
  .selection-count { padding: 0 5px; font-size: 10px; }
  .selection-bar { bottom: max(74px, calc(env(safe-area-inset-bottom) + 60px)); }
  .favorite-open { grid-template-columns: minmax(0, 1fr) 45px minmax(0, 1.2fr); gap: 5px; }
  .theme-option { min-width: 0; flex: 1; }
}
.reader-back{position:fixed;left:1rem;bottom:max(1rem, env(safe-area-inset-bottom));z-index:30;display:flex;align-items:center;gap:.375rem;padding:.5rem .75rem;border:1px solid var(--reader-border);border-radius:2rem;background:var(--paper);color:var(--ink);box-shadow:0 2px 10px #0002;font-size:.875rem}.reader-retry{display:inline-block;margin-top:1rem;padding:.5rem 1rem;border:1px solid currentColor;border-radius:.375rem;font-size:.875rem}
@media (prefers-reduced-motion: reduce) { .reader-screen, .reader-document { transition: none; } }
</style>
