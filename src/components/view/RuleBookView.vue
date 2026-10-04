<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { navigate } from "@/router/hash";
import { store } from "@/store/analysis";
import { listAllRules } from "@/tools/admin/rules";
import { buildRuleTree, matchRules } from "@/tools/admin/rulesTree";
import type { Rule } from "@/tools/admin/types";

type LanguageMode = "zh" | "en" | "both";
interface FlatRule { item: Rule; depth: number }
interface TextPart { text: string; book?: string; number?: string }

const allRules = ref<Rule[]>([]);
const loading = ref(true);
const error = ref("");
const query = ref("");
const searchOpen = ref(false);
const searchDialog = ref<HTMLDialogElement | null>(null);
const searchInput = ref<HTMLInputElement | null>(null);
const language = ref<LanguageMode>("zh");
const selected = ref<Set<string>>(new Set());
const notice = ref("");
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

function scrollToRule(number: string): void {
  document.getElementById(ruleId(number))?.scrollIntoView({ behavior: "smooth", block: "center" });
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
  query.value = "";
  searchOpen.value = true;
  nextTick(() => {
    searchDialog.value?.showModal();
    searchInput.value?.focus();
  });
}

function closeSearch(): void {
  searchOpen.value = false;
  if (searchDialog.value?.open) searchDialog.value.close();
}

function chooseSearchHit(number: string): void {
  closeSearch();
  nextTick(() => scrollToRule(number));
}

function openReference(part: TextPart): void {
  if (!part.book || !part.number) return;
  navigate({ view: "rulebook", ruleBook: part.book, ruleNumber: part.number });
  if (part.book === bookName.value) nextTick(() => scrollToRule(part.number!));
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
    allRules.value = await listAllRules();
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

onMounted(() => void load());
watch(() => store.currentRuleTarget, (number) => {
  if (number) nextTick(() => scrollToRule(number));
});
watch(bookName, () => {
  selected.value = new Set();
  query.value = "";
});
</script>

<template>
  <div class="rulebook-page">
    <header class="rulebook-head">
      <div>
        <button class="back-link" type="button" @click="navigate({ view: 'rules' })">← 返回规则目录</button>
        <p class="rulebook-kicker">RIFTBOUND · OFFICIAL RULES</p>
        <h1>{{ bookName }}</h1>
        <p class="book-description">按原有章节与规则编号编排 · 共 {{ flatRules.length.toLocaleString() }} 条</p>
      </div>
      <div class="language-switch" aria-label="语言模式">
        <button v-for="option in [{ id: 'zh', label: '中文' }, { id: 'en', label: 'English' }, { id: 'both', label: '中英对照' }]" :key="option.id" :class="{ active: language === option.id }" @click="language = option.id as LanguageMode">{{ option.label }}</button>
      </div>
    </header>

    <div v-if="loading" class="state-card">正在加载规则书…</div>
    <div v-else-if="error" class="state-card error">{{ error }}</div>
    <template v-else>
      <section class="reader-tools" aria-label="规则书工具">
        <button class="search-launch" @click="openSearch"><span aria-hidden="true">⌕</span> 搜索规则</button>
        <span class="match-count">{{ flatRules.length.toLocaleString() }} 条</span>
        <span class="tool-spacer"></span>
        <button class="tool-action" :disabled="!selected.size" @click="copySelected">复制选中条目 <b v-if="selected.size">{{ selected.size }}</b></button>
        <button class="tool-action" :disabled="!selected.size" @click="exportSelectedImage">导出图片</button>
      </section>
      <p v-if="notice" class="notice" role="status">{{ notice }}</p>
      <main class="book-stage">
        <div class="book-page">
          <div class="running-head"><span>{{ bookName }}</span><span>规则书 · {{ language === 'zh' ? '中文版' : language === 'en' ? 'ENGLISH EDITION' : '中英对照' }}</span></div>
          <div class="book-rule-list">
            <article v-for="{ item, depth, lines } in renderedRules" :id="ruleId(item.rule_number)" :key="item.id" class="rule-entry" :class="{ selected: selected.has(item.rule_number), chapter: item.is_heading }" :style="{ '--depth': depth }">
              <label class="select-entry" :aria-label="`选择规则 ${item.rule_number}`"><input type="checkbox" :checked="selected.has(item.rule_number)" @change="toggleSelected(item.rule_number)" /></label>
              <div class="entry-copy">
                <h2 :class="{ heading: item.is_heading }"><span class="entry-number">{{ item.rule_number }}</span></h2>
                <p v-for="(parts, lineIndex) in lines" :key="lineIndex" class="entry-text">
                  <template v-for="(part, partIndex) in parts" :key="partIndex"><button v-if="part.book" class="rule-reference" @click="openReference(part)">{{ part.text }}</button><span v-else>{{ part.text }}</span></template>
                </p>
              </div>
            </article>
          </div>
          <footer class="book-folio"><span>符文战场 · 规则档案</span><span>{{ flatRules.length }} 条</span></footer>
        </div>
      </main>

      <dialog ref="searchDialog" class="search-dialog" @close="searchOpen = false">
        <div class="search-modal-head"><div><span class="modal-kicker">本书检索</span><h2>查找规则</h2></div><button class="modal-close" aria-label="关闭搜索" @click="closeSearch">×</button></div>
        <label class="modal-search-field"><span aria-hidden="true">⌕</span><input ref="searchInput" v-model="query" type="search" placeholder="输入规则编号或正文内容" @keydown.esc="closeSearch" /><kbd>ESC</kbd></label>
        <div class="search-results" aria-live="polite">
          <p v-if="!query.trim()" class="search-prompt">搜索范围：{{ bookName }}</p>
          <p v-else-if="!hits.length" class="search-prompt">没有找到匹配的规则</p>
          <button v-for="hit in hits.slice(0, 80)" :key="hit.id" class="search-result" @click="chooseSearchHit(hit.rule_number)">
            <span class="result-number">{{ hit.rule_number }}</span><span class="result-copy"><strong>{{ hit.is_heading ? '章节' : '规则' }}</strong>{{ hit.text_zh || hit.text_en || '暂无正文' }}</span><span class="result-arrow">↗</span>
          </button>
          <p v-if="hits.length > 80" class="search-limit">显示前 80 条，请输入更具体的编号或内容。</p>
        </div>
      </dialog>
    </template>
  </div>
</template>

<style scoped>
.rulebook-page { width: min(100%, 1340px); margin: 0 auto; padding: 0 20px 70px; color: var(--color-text-primary); }
.rulebook-head { display: flex; justify-content: space-between; align-items: end; gap: 24px; padding: 22px 0 20px; }
.back-link { color: var(--color-text-muted); font-size: 12px; }
.back-link:hover { color: var(--color-brand); }
.rulebook-kicker { margin-top: 19px; color: var(--color-brand); font: 10px ui-monospace, monospace; letter-spacing: .18em; }
h1 { margin-top: 6px; font: 700 clamp(28px, 4vw, 42px)/1.2 "Noto Serif SC", "Songti SC", Georgia, serif; letter-spacing: .035em; }
.book-description { margin-top: 7px; color: var(--color-text-subtle); font: 11px/1.5 ui-monospace, monospace; }
.language-switch { display: flex; gap: 2px; padding: 3px; border: 1px solid var(--color-card-border); background: #ede8db; }
.language-switch button { padding: 8px 12px; color: var(--color-text-muted); font-size: 12px; white-space: nowrap; }
.language-switch button.active { color: #fff8f0; background: var(--color-brand); }
.state-card { width: min(100%, 900px); margin: 28px auto; padding: 32px; border: 1px solid var(--color-card-border); background: var(--color-card-bg); color: var(--color-text-muted); }
.state-card.error { color: #9e493b; }
.reader-tools { display: flex; align-items: center; gap: 10px; min-height: 54px; border-top: 1px solid var(--color-panel-border); border-bottom: 1px solid var(--color-panel-border); }
.search-launch { display: inline-flex; align-items: center; gap: 9px; padding: 8px 12px; border: 1px solid var(--color-card-border); background: var(--color-card-bg); color: var(--color-text-muted); font-size: 12px; }
.search-launch > span { color: var(--color-brand); font-size: 20px; line-height: .8; }
kbd { padding: 2px 5px; border: 1px solid var(--color-card-border); color: var(--color-text-subtle); font: 10px ui-monospace, monospace; }
.match-count { color: var(--color-text-subtle); font: 11px ui-monospace, monospace; white-space: nowrap; }
.tool-spacer { flex: 1; }
.tool-action { padding: 8px 11px; border: 1px solid var(--color-card-border); color: var(--color-text-muted); font-size: 11px; white-space: nowrap; }
.tool-action:not(:disabled):hover { border-color: var(--color-brand-faint); color: var(--color-brand); }
.tool-action:disabled { opacity: .4; cursor: not-allowed; }
.tool-action b { margin-left: 4px; color: var(--color-brand); }
.notice { position: fixed; z-index: 80; right: 24px; bottom: 24px; padding: 12px 16px; color: white; background: #343b34; box-shadow: 0 8px 30px #0002; font-size: 13px; }
.book-stage { width: min(100%, 1040px); margin: 24px auto 0; padding-left: 9px; background: linear-gradient(90deg, #9c8765 0 5px, #d8c8a9 5px 9px, transparent 9px); filter: drop-shadow(0 12px 22px rgba(49, 39, 22, .13)); }
.book-page { position: relative; min-height: 75vh; padding: 40px clamp(24px, 7vw, 86px) 28px; background: #fffdf6; border: 1px solid #e7dfce; border-left: 0; }
.book-page::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 22px; background: linear-gradient(90deg, rgba(67, 49, 27, .08), transparent); pointer-events: none; }
.running-head { display: flex; justify-content: space-between; gap: 12px; padding-bottom: 13px; border-bottom: 1px solid #d9cfbc; color: #857a68; font: 10px/1.4 ui-monospace, monospace; letter-spacing: .08em; }
.book-rule-list { width: min(100%, 72ch); margin: 22px auto 50px; }
.rule-entry { position: relative; display: grid; grid-template-columns: 24px minmax(0, 1fr); gap: 10px; padding: 8px 8px 8px calc(8px + min(var(--depth), 5) * 15px); scroll-margin-top: 100px; content-visibility: auto; contain-intrinsic-size: auto 112px; }
.rule-entry.selected { background: rgba(178, 58, 39, .07); }
.rule-entry.chapter { margin-top: 24px; padding-top: 18px; border-top: 1px solid #c7b89e; }
.select-entry { padding-top: 3px; opacity: .24; transition: opacity .15s; }
.rule-entry:hover .select-entry, .rule-entry.selected .select-entry, .select-entry:focus-within { opacity: 1; }
.select-entry input { accent-color: var(--color-brand); width: 14px; height: 14px; cursor: pointer; }
.entry-copy h2 { min-height: 18px; line-height: 1.6; }
.entry-number { color: #927a55; font: 600 11px ui-monospace, monospace; }
.entry-copy h2.heading .entry-number { color: var(--color-brand); font-weight: 800; font-size: 14px; }
.entry-text { margin-top: 3px; color: #37332b; font: 15px/2 "Noto Serif SC", "Songti SC", "Noto Serif", Georgia, serif; white-space: pre-wrap; overflow-wrap: anywhere; }
.entry-copy h2.heading + .entry-text { margin-top: 7px; font-size: 17px; font-weight: 700; line-height: 1.8; }
.rule-reference { color: #9f3021; font: inherit; text-decoration: underline; text-decoration-color: rgba(159, 48, 33, .45); text-decoration-thickness: 1px; text-underline-offset: 3px; }
.rule-reference:hover { color: #6f2118; text-decoration-color: currentColor; }
.book-folio { display: flex; justify-content: space-between; width: min(100%, 72ch); margin: 0 auto; padding-top: 12px; border-top: 1px solid #d9cfbc; color: #8d826f; font: 10px ui-monospace, monospace; }
.search-dialog { width: min(650px, calc(100vw - 30px)); max-height: min(76vh, 760px); padding: 0; border: 1px solid #c9bca5; background: #fbf8ef; color: var(--color-text-primary); box-shadow: 0 28px 90px rgba(25, 20, 12, .32); }
.search-dialog::backdrop { background: rgba(35, 31, 25, .54); backdrop-filter: blur(3px); }
.search-modal-head { display: flex; align-items: center; justify-content: space-between; padding: 22px 24px 15px; }
.modal-kicker { color: var(--color-brand); font: 10px ui-monospace, monospace; letter-spacing: .15em; }
.search-modal-head h2 { margin-top: 4px; font: 700 24px/1.25 "Noto Serif SC", Georgia, serif; }
.modal-close { width: 34px; height: 34px; color: #756c5c; font-size: 25px; line-height: 1; }
.modal-search-field { display: flex; align-items: center; gap: 10px; height: 50px; margin: 0 24px; padding: 0 12px; border: 1px solid #c9bca5; background: #fffdf7; color: var(--color-brand); }
.modal-search-field:focus-within { outline: 2px solid rgba(178, 58, 39, .18); border-color: var(--color-brand); }
.modal-search-field > span { font-size: 25px; }
.modal-search-field input { flex: 1; min-width: 0; outline: none; background: transparent; color: var(--color-text-primary); font-size: 14px; }
.search-results { max-height: calc(min(76vh, 760px) - 140px); overflow-y: auto; margin-top: 12px; border-top: 1px solid #ded5c5; }
.search-prompt, .search-limit { padding: 18px 24px; color: #827969; font-size: 12px; }
.search-result { display: flex; align-items: flex-start; gap: 14px; width: 100%; padding: 13px 24px; border-bottom: 1px solid #e8e0d2; text-align: left; }
.search-result:hover { background: #f0eadc; }
.result-number { flex: 0 0 68px; color: var(--color-brand); font: 700 12px ui-monospace, monospace; }
.result-copy { display: grid; gap: 3px; color: #4c463c; font: 13px/1.6 "Noto Serif SC", Georgia, serif; }
.result-copy strong { color: #978a74; font: 10px ui-monospace, monospace; }
.result-arrow { margin-left: auto; color: #a39884; }
@media (max-width: 650px) { .rulebook-page { padding-inline: 12px; } .rulebook-head { align-items: flex-start; flex-direction: column; } .language-switch { align-self: stretch; } .language-switch button { flex: 1; } .reader-tools { flex-wrap: wrap; padding: 9px 0; } .tool-spacer { display: none; } .search-launch { flex: 1; } .book-stage { margin-top: 14px; } .book-page { padding: 24px 14px 22px 20px; } .running-head { font-size: 8px; } .rule-entry { padding-left: 5px; padding-right: 4px; } .entry-text { font-size: 14px; } .result-number { flex-basis: 48px; } .search-result { gap: 8px; padding-inline: 15px; } .search-modal-head { padding-inline: 16px; } .modal-search-field { margin-inline: 16px; } }
</style>
