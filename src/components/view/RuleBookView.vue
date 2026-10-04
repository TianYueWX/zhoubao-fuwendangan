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
const language = ref<LanguageMode>("zh");
const selected = ref<Set<string>>(new Set());
const notice = ref("");
const bookName = computed(() => store.currentRuleBook);
const bookRules = computed(() => allRules.value.filter((rule) => (rule.rules_book || "（未分类）") === bookName.value));

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

function toggleAll(): void {
  selected.value = selected.value.size === flatRules.value.length
    ? new Set()
    : new Set(flatRules.value.map(({ item }) => item.rule_number));
}

function scrollToRule(number: string): void {
  document.getElementById(ruleId(number))?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function ruleId(number: string): string { return `rule-${encodeURIComponent(number)}`; }

function textParts(text: string): TextPart[] {
  const candidates: Array<{ token: string; book: string; number: string }> = [];
  for (const rule of allRules.value) {
    const book = rule.rules_book || "（未分类）";
    const token = `${book}/${rule.rule_number}`;
    if (text.includes(token)) candidates.push({ token, book, number: rule.rule_number });
  }
  candidates.sort((a, b) => b.token.length - a.token.length);
  if (!candidates.length) return [{ text }];
  const parts: TextPart[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const found = candidates.find((candidate) => text.startsWith(candidate.token, cursor));
    if (!found) {
      const next = candidates.reduce((min, candidate) => {
        const at = text.indexOf(candidate.token, cursor);
        return at >= 0 && at < min ? at : min;
      }, text.length);
      parts.push({ text: text.slice(cursor, next) });
      cursor = next;
      continue;
    }
    parts.push({ text: found.token, book: found.book, number: found.number });
    cursor += found.token.length;
  }
  return parts;
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
        <p class="rulebook-kicker">RULE BOOK / {{ flatRules.length.toLocaleString() }} ENTRIES</p>
        <h1>{{ bookName }}</h1>
      </div>
      <div class="language-switch" aria-label="语言模式">
        <button v-for="option in [{ id: 'zh', label: '中文' }, { id: 'en', label: 'English' }, { id: 'both', label: '中英对照' }]" :key="option.id" :class="{ active: language === option.id }" @click="language = option.id as LanguageMode">{{ option.label }}</button>
      </div>
    </header>

    <div v-if="loading" class="state-card">正在加载规则书…</div>
    <div v-else-if="error" class="state-card error">{{ error }}</div>
    <template v-else>
      <section class="reader-tools">
        <label class="search-box"><span aria-hidden="true">⌕</span><input v-model="query" type="search" placeholder="检索规则编号或正文内容" /><button v-if="query" @click="query = ''">清除</button></label>
        <span class="match-count">{{ query.trim() ? `匹配 ${hits.length} 条` : `${flatRules.length} 条规则` }}</span>
        <button class="tool-action" :disabled="!selected.size" @click="copySelected">复制成段落 <b v-if="selected.size">{{ selected.size }}</b></button>
        <button class="tool-action" :disabled="!selected.size" @click="exportSelectedImage">导出为图</button>
      </section>
      <p v-if="notice" class="notice" role="status">{{ notice }}</p>
      <div class="reader-layout">
        <aside class="reader-sidebar">
          <div class="sidebar-heading"><span>本规则书</span><button @click="toggleAll">{{ selected.size === flatRules.length ? "取消全选" : "全选" }}</button></div>
          <p class="reader-hint">勾选条目后可复制或导出；点击检索结果定位到正文。</p>
          <div v-if="query.trim()" class="hit-list">
            <button v-for="hit in hits" :key="hit.id" class="hit-row" @click="scrollToRule(hit.rule_number)">
              <span class="hit-number">{{ hit.rule_number }}</span><span>{{ hit.text_zh || hit.text_en || "暂无正文" }}</span>
            </button>
            <p v-if="!hits.length" class="no-hits">没有匹配条目</p>
          </div>
          <div v-else class="outline-list">
            <button v-for="{ item } in flatRules" :key="item.id" class="outline-row" @click="scrollToRule(item.rule_number)">{{ item.rule_number }} <span>{{ item.text_zh || item.text_en || "" }}</span></button>
          </div>
        </aside>

        <main class="rule-content">
          <article v-for="{ item, depth } in flatRules" :id="ruleId(item.rule_number)" :key="item.id" class="rule-entry" :class="{ selected: selected.has(item.rule_number) }" :style="{ '--depth': depth }">
            <label class="select-entry" :aria-label="`选择规则 ${item.rule_number}`"><input type="checkbox" :checked="selected.has(item.rule_number)" @change="toggleSelected(item.rule_number)" /></label>
            <div class="entry-copy">
              <h2 :class="{ heading: item.is_heading }"><span class="entry-number">{{ item.rule_number }}</span></h2>
              <p v-for="(line, lineIndex) in displayLines(item)" :key="lineIndex" class="entry-text">
                <template v-for="(part, partIndex) in textParts(line)" :key="partIndex"><button v-if="part.book" class="rule-reference" @click="openReference(part)">{{ part.text }}</button><span v-else>{{ part.text }}</span></template>
              </p>
            </div>
          </article>
        </main>
      </div>
    </template>
  </div>
</template>

<style scoped>
.rulebook-page { width: min(100%, 1440px); margin: 0 auto; padding-bottom: 60px; color: var(--color-text-primary); }
.rulebook-head { display: flex; justify-content: space-between; align-items: end; gap: 24px; padding: 26px 0 24px; border-bottom: 1px solid var(--color-panel-border); }
.back-link { color: var(--color-text-muted); font-size: 12px; }
.back-link:hover { color: var(--color-brand); }
.rulebook-kicker { margin-top: 25px; color: var(--color-text-subtle); font: 10px ui-monospace, monospace; letter-spacing: .17em; }
h1 { margin-top: 7px; font: 800 clamp(27px, 4vw, 42px)/1.2 Georgia, "Noto Serif SC", serif; }
.language-switch { display: flex; gap: 3px; padding: 4px; border: 1px solid var(--color-card-border); border-radius: 8px; background: var(--color-card-bg); }
.language-switch button { padding: 8px 12px; border-radius: 5px; color: var(--color-text-muted); font-size: 12px; white-space: nowrap; }
.language-switch button.active { color: var(--color-brand-ink); background: var(--color-brand); }
.state-card { margin-top: 24px; padding: 32px; border: 1px solid var(--color-card-border); border-radius: 10px; background: var(--color-card-bg); color: var(--color-text-muted); }
.state-card.error { color: #9e493b; }
.reader-tools { display: flex; align-items: center; gap: 10px; padding: 18px 0; border-bottom: 1px solid var(--color-panel-border); }
.search-box { display: flex; align-items: center; gap: 9px; flex: 1; min-width: 200px; height: 42px; padding: 0 12px; border: 1px solid var(--color-card-border); border-radius: 7px; background: var(--color-card-bg); color: var(--color-brand); }
.search-box input { flex: 1; min-width: 0; outline: none; background: transparent; color: var(--color-text-primary); font-size: 13px; }
.search-box button, .match-count { color: var(--color-text-subtle); font-size: 11px; white-space: nowrap; }
.tool-action { padding: 10px 12px; border: 1px solid var(--color-card-border); border-radius: 6px; color: var(--color-text-muted); font-size: 12px; white-space: nowrap; }
.tool-action:not(:disabled):hover { border-color: var(--color-brand-faint); color: var(--color-brand); }
.tool-action:disabled { opacity: .45; cursor: not-allowed; }
.tool-action b { margin-left: 5px; color: var(--color-brand); }
.notice { position: fixed; z-index: 80; right: 24px; bottom: 24px; padding: 12px 16px; border-radius: 8px; color: white; background: #343b34; box-shadow: 0 8px 30px #0002; font-size: 13px; }
.reader-layout { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 34px; align-items: start; padding-top: 22px; }
.reader-sidebar { position: sticky; top: 126px; max-height: calc(100vh - 150px); overflow: auto; padding-right: 10px; }
.sidebar-heading { display: flex; justify-content: space-between; align-items: center; padding-bottom: 10px; border-bottom: 1px solid var(--color-panel-border); font-size: 13px; font-weight: 700; }
.sidebar-heading button { color: var(--color-brand); font-size: 11px; }
.reader-hint { padding: 10px 0; color: var(--color-text-subtle); font-size: 11px; line-height: 1.6; }
.outline-list, .hit-list { display: grid; }
.outline-row, .hit-row { display: flex; gap: 8px; width: 100%; padding: 8px 4px; border-bottom: 1px solid var(--color-split-line); text-align: left; color: var(--color-text-muted); font-size: 11px; line-height: 1.5; }
.outline-row:hover, .hit-row:hover { color: var(--color-brand); background: var(--color-brand-soft); }
.outline-row { color: var(--color-brand); font-family: ui-monospace, monospace; }
.outline-row span, .hit-row span:last-child { display: -webkit-box; flex: 1; overflow: hidden; -webkit-line-clamp: 2; -webkit-box-orient: vertical; color: var(--color-text-subtle); font-family: inherit; }
.hit-number { flex: 0 0 auto; color: var(--color-brand); font-family: ui-monospace, monospace; }
.no-hits { padding: 18px 4px; color: var(--color-text-subtle); font-size: 12px; }
.rule-content { min-width: 0; }
.rule-entry { display: grid; grid-template-columns: 24px minmax(0, 1fr); gap: 12px; padding: 18px 18px 18px calc(18px + min(var(--depth), 5) * 18px); border-bottom: 1px solid var(--color-split-line); scroll-margin-top: 150px; }
.rule-entry.selected { background: var(--color-brand-soft); }
.select-entry { padding-top: 3px; }
.select-entry input { accent-color: var(--color-brand); width: 15px; height: 15px; cursor: pointer; }
.entry-copy h2 { display: flex; align-items: baseline; gap: 10px; font-size: 14px; font-weight: 700; line-height: 1.55; }
.entry-copy h2.heading { font-size: 18px; }
.entry-number { color: var(--color-brand); font: 700 12px ui-monospace, monospace; white-space: nowrap; }
.entry-text { margin-top: 5px; color: var(--color-text-muted); font-size: 13px; line-height: 1.9; white-space: pre-wrap; overflow-wrap: anywhere; }
.rule-reference { color: var(--color-brand); text-decoration: underline; text-decoration-style: dotted; text-underline-offset: 3px; }
.rule-reference:hover { text-decoration-style: solid; }
@media (max-width: 900px) { .reader-layout { grid-template-columns: 1fr; gap: 12px; } .reader-sidebar { position: static; max-height: 260px; border-bottom: 1px solid var(--color-panel-border); } }
@media (max-width: 650px) { .rulebook-head { align-items: flex-start; flex-direction: column; } .language-switch { align-self: stretch; } .language-switch button { flex: 1; } .reader-tools { flex-wrap: wrap; } .search-box { flex-basis: 100%; } .match-count { flex: 1; } .rule-entry { padding-left: 12px; padding-right: 8px; } }
</style>
