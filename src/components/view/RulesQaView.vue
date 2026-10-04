<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { navigate } from "@/router/hash";
import { listAllRules } from "@/tools/admin/rules";
import { bookCounts, matchRules } from "@/tools/admin/rulesTree";
import type { Rule } from "@/tools/admin/types";
import { restSelectAll } from "@/tools/sources/rest";
import { readSupabaseConfig } from "@/tools/sources/config";
import { useVersionedResource } from "@/tools/sources/versionedCache";
import QaRichText from "@/components/admin/QaRichText.vue";
import CacheSyncStatus from "@/components/CacheSyncStatus.vue";

type Scope = "all" | "rules" | "qa";

interface QaEntry {
  id: string;
  source: string | null;
  source_id: string | null;
  question: string;
  answer: string;
  question_en: string | null;
  answer_en: string | null;
  updated_at: string | null;
}

interface QaLink {
  qa_id: string;
  card_no: string;
  position: number;
}

interface CardLabel {
  card_no: string;
  card_name_cn: string | null;
}

interface QaBundle {
  entries: QaEntry[];
  links: QaLink[];
}

interface QaDisplay extends QaEntry {
  cards: string[];
}

const rules = ref<Rule[]>([]);
const qa = ref<QaDisplay[]>([]);
const loading = ref(true);
const error = ref("");
const query = ref("");
const scope = ref<Scope>("all");
const selectedBook = ref("");
const browseMode = ref(false);
const expandedQa = ref<Set<string>>(new Set());
const rulesResource = useVersionedResource("rules", listAllRules);
const qaResource = useVersionedResource<QaBundle>("qa", async () => {
  const [entries, links] = await Promise.all([
    restSelectAll<QaEntry>("qa_entries", {
      columns: "id,source,source_id,question,answer,question_en,answer_en,updated_at",
      order: "updated_at.desc,id.asc",
    }),
    restSelectAll<QaLink>("qa_entry_cards", {
      columns: "qa_id,card_no,position",
      order: "qa_id.asc,position.asc",
    }),
  ]);
  return { entries, links };
});
const cardNamesResource = useVersionedResource("cards", () =>
  restSelectAll<CardLabel>("cards_base", { order: "card_no.asc,id.asc" }),
);

const scopeOptions: Array<{ value: Scope; label: string }> = [
  { value: "all", label: "全部" },
  { value: "rules", label: "规则" },
  { value: "qa", label: "QA" },
];

const books = computed(() => bookCounts(rules.value));
const bookName = computed(() => selectedBook.value || "全部规则书");

const scopedRules = computed(() =>
  selectedBook.value
    ? rules.value.filter((rule) => (rule.rules_book ?? "") === selectedBook.value)
    : rules.value,
);

const qaHits = computed(() => {
  const q = query.value.trim().toLocaleLowerCase();
  if (!q) return browseMode.value && showQa.value ? qa.value : [];
  return qa.value.filter((item) => {
    const haystack = [
      item.question,
      item.answer,
      item.question_en,
      item.answer_en,
      ...item.cards,
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase();
    return haystack.includes(q);
  });
});

const ruleHits = computed(() =>
  query.value.trim() || browseMode.value
    ? query.value.trim()
      ? matchRules(scopedRules.value, query.value)
      : scopedRules.value
    : [],
);
const hasQuery = computed(() => query.value.trim().length > 0 || browseMode.value);
const showRules = computed(() => scope.value === "all" || scope.value === "rules");
const showQa = computed(() => scope.value === "all" || scope.value === "qa");

const searchResults = computed(() => {
  const results: Array<
    | { kind: "rule"; item: Rule }
    | { kind: "qa"; item: QaDisplay }
  > = [];
  if (showRules.value) {
    for (const item of ruleHits.value.slice(0, 30)) results.push({ kind: "rule", item });
  }
  if (showQa.value) {
    for (const item of qaHits.value.slice(0, 30)) results.push({ kind: "qa", item });
  }
  return results;
});

const featuredQa = computed(() => qa.value.slice(0, 8));
const isConfigured = computed(() => Boolean(readSupabaseConfig()));
const resources = [rulesResource, qaResource, cardNamesResource];
const cacheChecking = computed(() => resources.some((resource) => resource.checking.value));
const cacheStale = computed(() => resources.some((resource) => resource.stale.value));
const cacheSavedAt = computed(() => {
  const values = resources.map((resource) => resource.savedAt.value).filter(Boolean).sort();
  return values[values.length - 1] ?? "";
});
const cacheError = computed(() => resources.find((resource) => resource.error.value)?.error.value ?? "");

async function refreshReferenceData(): Promise<void> {
  await Promise.allSettled(resources.map((resource) => resource.load(true)));
}

function cardLabel(cardNo: string): string {
  return cardNo;
}

function toggleQa(id: string): void {
  const next = new Set(expandedQa.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expandedQa.value = next;
}

function chooseBook(book: string): void {
  selectedBook.value = selectedBook.value === book ? "" : book;
  if (selectedBook.value) scope.value = "rules";
  browseMode.value = true;
}

function clearSearch(): void {
  query.value = "";
  scope.value = "all";
  selectedBook.value = "";
  browseMode.value = false;
}

function browseQa(): void {
  scope.value = "qa";
  query.value = "";
  browseMode.value = true;
}

function setScope(next: Scope): void {
  scope.value = next;
  if (next !== "all") browseMode.value = true;
}

watch(query, (value) => {
  if (value.trim()) browseMode.value = false;
});

async function loadReferenceData(): Promise<void> {
  loading.value = true;
  error.value = "";
  if (!isConfigured.value) {
    error.value = "未配置 Supabase 连接。规则与 QA 资料来自当前项目的公开资料库。";
    loading.value = false;
    return;
  }

  try {
    const [ruleRows, qaBundle, cardRows] = await Promise.all([
      rulesResource.load(), qaResource.load(), cardNamesResource.load(),
    ]);
    if (!ruleRows || !qaBundle || !cardRows) throw new Error("资料加载失败");
    const cardNameByNo = new Map(
      cardRows.map((card) => [card.card_no, card.card_name_cn || card.card_no]),
    );
    const cardsByQa = new Map<string, string[]>();
    for (const link of qaBundle.links) {
      const cards = cardsByQa.get(link.qa_id) ?? [];
      const label = cardNameByNo.get(link.card_no);
      cards.push(label ? `${link.card_no} · ${label}` : link.card_no);
      cardsByQa.set(link.qa_id, cards);
    }

    rules.value = ruleRows;
    qa.value = qaBundle.entries.map((item) => ({
      ...item,
      cards: cardsByQa.get(item.id) ?? [],
    }));
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "资料加载失败，请稍后重试。";
  } finally {
    loading.value = false;
  }
}

// 订阅本地缓存：版本检查尚未完成时也能先渲染已有资料。
watch(rulesResource.data, (rows) => { if (rows) rules.value = rows; }, { immediate: true });
watch([qaResource.data, cardNamesResource.data], ([bundle, cards]) => {
  if (!bundle || !cards) return;
  const labels = new Map(cards.map((card) => [card.card_no, card.card_name_cn || card.card_no]));
  const linksByQa = new Map<string, string[]>();
  for (const link of bundle.links) {
    const list = linksByQa.get(link.qa_id) ?? [];
    const label = labels.get(link.card_no);
    list.push(label ? `${link.card_no} · ${label}` : link.card_no);
    linksByQa.set(link.qa_id, list);
  }
  qa.value = bundle.entries.map((entry) => ({ ...entry, cards: linksByQa.get(entry.id) ?? [] }));
  loading.value = false;
}, { immediate: true });

onMounted(() => void loadReferenceData());
</script>

<template>
  <div class="reference-page fade-in">
    <header class="reference-hero">
      <div class="reference-hero-copy">
        <div class="flex items-center gap-3 text-[11px] text-ink-faint">
          <button class="hover:text-brand transition-colors" @click="navigate({ view: 'home' })">
            ← 返回首页
          </button>
          <span aria-hidden="true">/</span>
          <span class="font-latin tracking-[0.22em] uppercase">REFERENCE DESK</span>
        </div>
        <p class="eyebrow mt-8">规则书 · 赛事判例 · 卡牌 QA</p>
        <h1 class="headline-xl reference-title">规则与 QA 查询</h1>
        <p class="standfirst reference-lede">
          把规则编号、正文、卡牌问答和关联卡牌放进同一张检索桌。输入一个词，直接找到可执行的裁定依据。
        </p>
      </div>

      <div class="reference-seal" aria-hidden="true">
        <span class="reference-seal-ring"></span>
        <span class="reference-seal-mark">问</span>
        <span class="reference-seal-caption">RULES / QA</span>
      </div>
    </header>

    <div class="flex justify-end mt-3">
      <CacheSyncStatus :checking="cacheChecking" :stale="cacheStale" :saved-at="cacheSavedAt" :error="cacheError" :disabled="loading" @refresh="refreshReferenceData" />
    </div>

    <section class="reference-search card" aria-label="检索规则与 QA">
      <div class="reference-search-label">
        <span class="sec-kicker"></span>
        <span>输入关键词检索</span>
      </div>
      <div class="reference-search-row">
        <label class="reference-search-box">
          <span class="sr-only">搜索规则编号、文本或 QA</span>
          <span class="reference-search-icon" aria-hidden="true">⌕</span>
          <input
            v-model="query"
            type="search"
            autocomplete="off"
            placeholder="例如：伤害、法术、OGN-021、133.4…"
          />
          <button v-if="query" type="button" class="reference-clear" @click="query = ''">清除</button>
        </label>
        <div class="reference-scope" role="tablist" aria-label="检索范围">
          <button
            v-for="item in scopeOptions"
            :key="item.value"
            type="button"
            role="tab"
            :aria-selected="scope === item.value"
            :class="{ active: scope === item.value }"
            @click="setScope(item.value)"
          >
            {{ item.label }}
          </button>
        </div>
      </div>
      <div class="reference-search-foot">
        <span>支持中文子串、规则编号、英文术语与卡号</span>
        <span class="tabular-nums">{{ rules.length.toLocaleString() }} 条规则 · {{ qa.length.toLocaleString() }} 条 QA</span>
      </div>
    </section>

    <div v-if="loading" class="reference-loading card" role="status">
      <span class="reference-spinner" aria-hidden="true"></span>
      <div>
        <p class="font-semibold">正在读取规则与 QA 资料…</p>
        <p class="text-xs text-ink-faint mt-1">首次打开会建立本机检索索引。</p>
      </div>
    </div>

    <div v-else-if="error" class="reference-error card">
      <div class="reference-error-symbol" aria-hidden="true">!</div>
      <div>
        <p class="font-semibold">资料暂时不可用</p>
        <p class="text-sm text-ink-muted mt-1">{{ error }}</p>
        <button class="btn-ghost px-3 py-1.5 text-xs mt-4" @click="loadReferenceData">重新加载</button>
      </div>
    </div>

    <template v-else>
      <div class="reference-stats" aria-label="资料统计">
        <div class="reference-stat">
          <span class="reference-stat-number">{{ rules.length.toLocaleString() }}</span>
          <span class="reference-stat-label">规则条目</span>
        </div>
        <div class="reference-stat">
          <span class="reference-stat-number">{{ books.length }}</span>
          <span class="reference-stat-label">规则书</span>
        </div>
        <div class="reference-stat">
          <span class="reference-stat-number">{{ qa.length.toLocaleString() }}</span>
          <span class="reference-stat-label">QA 条目</span>
        </div>
        <div class="reference-stat reference-stat-note">
          <span class="reference-stat-dot"></span>
          <span>公开资料库已接通</span>
        </div>
      </div>

      <div v-if="hasQuery" class="reference-results-head">
        <div>
          <p class="eyebrow">SEARCH RESULTS</p>
          <h2 class="font-display text-2xl font-black mt-1">
            找到 {{ (showRules ? ruleHits.length : 0) + (showQa ? qaHits.length : 0) }} 条相关内容
          </h2>
        </div>
        <button class="btn-ghost px-3 py-1.5 text-xs" @click="clearSearch">清空检索</button>
      </div>

      <div v-if="hasQuery" class="reference-result-layout">
        <aside class="reference-sidebar">
          <div class="reference-sidebar-heading">
            <span class="eyebrow">RULE BOOKS</span>
            <span class="text-xs text-ink-faint">{{ bookName }}</span>
          </div>
          <button
            type="button"
            class="reference-book-row"
            :class="{ active: !selectedBook }"
            @click="selectedBook = ''"
          >
            <span>全部规则书</span><span>{{ rules.length }}</span>
          </button>
          <button
            v-for="book in books"
            :key="book.name"
            type="button"
            class="reference-book-row"
            :class="{ active: selectedBook === book.name }"
            @click="chooseBook(book.name)"
          >
            <span>{{ book.name }}</span><span>{{ book.count }}</span>
          </button>
        </aside>

        <section class="reference-results" aria-live="polite">
          <p v-if="!searchResults.length" class="reference-empty card">
            没有匹配内容。试试更短的关键词，或切换检索范围。
          </p>
          <article
            v-for="result in searchResults"
            :key="`${result.kind}-${result.item.id}`"
            class="reference-result card"
          >
            <template v-if="result.kind === 'rule'">
              <div class="reference-result-meta">
                <span class="result-type result-type-rule">规则</span>
                <span class="font-mono text-xs text-ink-muted">{{ result.item.rule_number }}</span>
                <span class="text-xs text-ink-faint">{{ result.item.rules_book || '未分类' }}</span>
              </div>
              <p class="reference-rule-text">{{ result.item.text_zh || result.item.text_en || '暂无正文' }}</p>
              <p v-if="result.item.text_zh && result.item.text_en" class="reference-rule-en">
                {{ result.item.text_en }}
              </p>
            </template>
            <template v-else>
              <button type="button" class="reference-qa-trigger" @click="toggleQa(result.item.id)">
                <span class="result-type result-type-qa">QA</span>
                <span class="reference-qa-question">{{ result.item.question }}</span>
                <span class="reference-qa-chevron" :class="{ open: expandedQa.has(result.item.id) }">⌄</span>
              </button>
              <div v-if="expandedQa.has(result.item.id)" class="reference-qa-answer">
                <div class="reference-answer-label">ANSWER</div>
                <QaRichText :text="result.item.answer" />
              </div>
              <div v-else class="reference-qa-preview"><QaRichText :text="result.item.answer" /></div>
              <div v-if="result.item.cards.length" class="reference-card-links">
                <span class="text-[11px] text-ink-faint">关联卡牌</span>
                <span v-for="card in result.item.cards" :key="card" class="reference-card-chip">{{ cardLabel(card) }}</span>
              </div>
            </template>
          </article>
          <p v-if="searchResults.length >= 60" class="text-center text-xs text-ink-faint py-4">仅展示前 60 条，请缩小关键词范围。</p>
        </section>
      </div>

      <div v-else class="reference-discovery">
        <section class="reference-books-panel">
          <div class="reference-section-heading">
            <div>
              <p class="eyebrow">RULE BOOKS</p>
              <h2 class="font-display text-2xl font-black mt-1">按规则书浏览</h2>
            </div>
            <span class="text-xs text-ink-faint">选择后自动切换到规则检索</span>
          </div>
          <div class="reference-book-grid">
            <button
              v-for="book in books"
              :key="book.name"
              type="button"
              class="reference-book-card"
              @click="navigate({ view: 'rulebook', ruleBook: book.name })">
              <span class="reference-book-index">{{ String(books.indexOf(book) + 1).padStart(2, '0') }}</span>
              <span class="reference-book-name">{{ book.name }}</span>
              <span class="reference-book-count">{{ book.count }} 条</span>
              <span class="reference-book-arrow" aria-hidden="true">↗</span>
            </button>
          </div>
        </section>

        <section class="reference-qa-panel">
          <div class="reference-section-heading">
            <div>
              <p class="eyebrow">RECENT QA</p>
              <h2 class="font-display text-2xl font-black mt-1">常见问答</h2>
            </div>
            <button class="text-xs text-brand hover:underline" @click="browseQa">查看全部 QA →</button>
          </div>
          <div class="reference-qa-list">
            <article v-for="item in featuredQa" :key="item.id" class="reference-qa-row">
              <div class="reference-qa-row-mark">Q</div>
              <button type="button" class="reference-qa-row-copy" @click="toggleQa(item.id)">
                <span>{{ item.question }}</span>
                <span v-if="expandedQa.has(item.id)" class="reference-qa-row-answer"><QaRichText :text="item.answer" /></span>
              </button>
              <span class="reference-qa-row-arrow" aria-hidden="true">{{ expandedQa.has(item.id) ? '−' : '+' }}</span>
            </article>
            <p v-if="!featuredQa.length" class="text-sm text-ink-faint py-4">当前还没有已发布的 QA 条目。</p>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.reference-page {
  width: min(100%, 1240px);
  margin: 0 auto;
}

.reference-hero {
  display: flex;
  justify-content: space-between;
  gap: 48px;
  align-items: flex-end;
  padding: 26px 0 34px;
  border-bottom: 1px solid var(--color-panel-border);
}

.reference-hero-copy { max-width: 760px; }
.reference-title { font-size: clamp(36px, 5vw, 62px); margin-top: 14px; }
.reference-lede { max-width: 650px; margin-top: 17px; font-size: 15px; }

.reference-seal {
  width: 142px;
  height: 142px;
  flex: 0 0 auto;
  border: 1px solid var(--color-brand-faint);
  position: relative;
  display: grid;
  place-items: center;
  color: var(--color-brand);
  transform: rotate(7deg);
}
.reference-seal-ring { position: absolute; inset: 13px; border: 1px solid var(--color-brand-faint); border-radius: 50%; }
.reference-seal-mark { font-family: "Noto Serif SC", serif; font-weight: 900; font-size: 54px; line-height: 1; }
.reference-seal-caption { position: absolute; bottom: 20px; font: 9px/1 ui-monospace, monospace; letter-spacing: .12em; }

.reference-search { margin-top: 28px; padding: 20px 22px 16px; border-radius: 12px; }
.reference-search-label { display: flex; align-items: center; gap: 9px; font-size: 12px; color: var(--color-text-muted); }
.reference-search-label .sec-kicker { width: 20px; height: 2px; }
.reference-search-row { display: flex; gap: 14px; align-items: center; margin-top: 13px; }
.reference-search-box { display: flex; align-items: center; flex: 1; min-width: 0; height: 50px; padding: 0 14px; border: 1px solid var(--color-card-border); background: var(--color-page-bg); border-radius: 8px; }
.reference-search-box:focus-within { border-color: var(--color-brand); box-shadow: 0 0 0 3px var(--color-brand-soft); }
.reference-search-icon { font-size: 28px; line-height: 1; color: var(--color-brand); transform: rotate(-18deg); margin-right: 9px; }
.reference-search-box input { flex: 1; min-width: 0; background: transparent; outline: none; font-size: 14px; color: var(--color-text-primary); }
.reference-search-box input::placeholder { color: var(--color-text-subtle); }
.reference-clear { font-size: 12px; color: var(--color-text-subtle); }
.reference-clear:hover { color: var(--color-brand); }
.reference-scope { display: flex; gap: 3px; padding: 3px; background: var(--color-page-bg); border: 1px solid var(--color-card-border); border-radius: 8px; }
.reference-scope button { min-width: 52px; height: 40px; padding: 0 11px; color: var(--color-text-subtle); font-size: 12px; border-radius: 5px; }
.reference-scope button:hover { color: var(--color-brand); }
.reference-scope button.active { color: var(--color-brand-ink); background: var(--color-brand); }
.reference-search-foot { display: flex; justify-content: space-between; gap: 12px; margin-top: 10px; font-size: 11px; color: var(--color-text-subtle); }

.reference-loading, .reference-error { display: flex; align-items: center; gap: 14px; margin-top: 26px; padding: 24px; border-radius: 12px; }
.reference-spinner { width: 20px; height: 20px; border: 2px solid var(--color-brand-faint); border-top-color: var(--color-brand); border-radius: 50%; animation: reference-spin .8s linear infinite; }
@keyframes reference-spin { to { transform: rotate(360deg); } }
.reference-error-symbol { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: var(--color-brand-soft); color: var(--color-brand); font-weight: 800; }

.reference-stats { display: flex; align-items: stretch; margin-top: 26px; border-block: 1px solid var(--color-panel-border); }
.reference-stat { min-width: 150px; padding: 15px 22px; border-right: 1px solid var(--color-panel-border); display: flex; flex-direction: column; gap: 1px; }
.reference-stat-number { font: 800 24px/1.2 ui-monospace, monospace; color: var(--color-text-primary); }
.reference-stat-label { font-size: 11px; color: var(--color-text-subtle); }
.reference-stat-note { flex: 1; flex-direction: row; align-items: center; gap: 8px; border-right: 0; color: var(--color-text-subtle); font-size: 11px; }
.reference-stat-dot { width: 7px; height: 7px; border-radius: 50%; background: #3d8f66; box-shadow: 0 0 0 4px rgba(61,143,102,.12); }

.reference-results-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; margin-top: 36px; }
.reference-result-layout { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 28px; margin-top: 22px; }
.reference-sidebar { align-self: start; position: sticky; top: 134px; }
.reference-sidebar-heading { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; padding-bottom: 10px; border-bottom: 1px solid var(--color-panel-border); }
.reference-book-row { width: 100%; display: flex; justify-content: space-between; gap: 10px; text-align: left; padding: 9px 8px; border-bottom: 1px solid var(--color-split-line); font-size: 12px; color: var(--color-text-muted); }
.reference-book-row:hover, .reference-book-row.active { color: var(--color-brand); background: var(--color-brand-soft); }
.reference-book-row span:last-child { font: 11px ui-monospace, monospace; color: var(--color-text-subtle); }
.reference-results { min-width: 0; display: grid; gap: 12px; }
.reference-result { padding: 17px 19px; border-radius: 10px; }
.reference-result-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 9px; }
.result-type { display: inline-flex; align-items: center; height: 21px; padding: 0 7px; font: 700 10px/1 ui-monospace, monospace; letter-spacing: .08em; }
.result-type-rule { color: var(--color-brand); border: 1px solid var(--color-brand-faint); background: var(--color-brand-soft); }
.result-type-qa { color: var(--color-accent-ink); border: 1px solid rgba(197,155,70,.45); background: rgba(197,155,70,.15); }
.reference-rule-text { margin-top: 12px; font-size: 14px; line-height: 1.85; }
.reference-rule-en { margin-top: 8px; font-size: 12px; line-height: 1.7; color: var(--color-text-subtle); }
.reference-qa-trigger { display: flex; align-items: flex-start; gap: 10px; width: 100%; text-align: left; }
.reference-qa-question { flex: 1; font-size: 14px; line-height: 1.65; font-weight: 650; }
.reference-qa-chevron { color: var(--color-brand); font-size: 18px; line-height: 1; transition: transform .2s; }
.reference-qa-chevron.open { transform: rotate(180deg); }
.reference-qa-answer { margin: 15px 0 0 30px; padding: 13px 15px; border-left: 2px solid var(--color-accent); background: rgba(197,155,70,.08); font-size: 13px; line-height: 1.8; }
.reference-answer-label { margin-bottom: 6px; font: 10px ui-monospace, monospace; color: var(--color-accent); letter-spacing: .15em; }
.reference-qa-preview { margin: 10px 0 0 30px; color: var(--color-text-muted); font-size: 12px; line-height: 1.7; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.reference-card-links { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 13px 0 0 30px; }
.reference-card-chip { padding: 3px 7px; border: 1px solid var(--color-card-border); border-radius: 4px; color: var(--color-text-muted); font-size: 10px; background: var(--color-page-bg); }
.reference-empty { padding: 30px 20px; text-align: center; color: var(--color-text-subtle); font-size: 13px; }

.reference-discovery { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 36px; margin-top: 38px; }
.reference-section-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; padding-bottom: 14px; border-bottom: 1px solid var(--color-panel-border); }
.reference-book-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 16px; }
.reference-book-card { position: relative; min-height: 112px; padding: 15px; display: flex; flex-direction: column; align-items: flex-start; text-align: left; border: 1px solid var(--color-card-border); border-radius: 9px; background: var(--color-card-bg); transition: border-color .2s, transform .2s, background-color .2s; }
.reference-book-card:hover { border-color: var(--color-brand-faint); background: var(--color-brand-soft); transform: translateY(-2px); }
.reference-book-index { font: 10px ui-monospace, monospace; color: var(--color-brand); }
.reference-book-name { margin-top: 16px; font-size: 13px; font-weight: 650; line-height: 1.4; }
.reference-book-count { margin-top: 6px; color: var(--color-text-subtle); font-size: 11px; }
.reference-book-arrow { position: absolute; top: 14px; right: 14px; color: var(--color-text-subtle); }
.reference-qa-list { margin-top: 2px; }
.reference-qa-row { display: flex; gap: 12px; align-items: flex-start; padding: 15px 0; border-bottom: 1px solid var(--color-split-line); }
.reference-qa-row-mark { flex: 0 0 auto; width: 23px; height: 23px; display: grid; place-items: center; border: 1px solid var(--color-accent); color: var(--color-accent); font: 11px ui-monospace, monospace; }
.reference-qa-row-copy { flex: 1; min-width: 0; text-align: left; font-size: 13px; line-height: 1.6; }
.reference-qa-row-copy:hover { color: var(--color-brand); }
.reference-qa-row-answer { display: block; margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--color-card-border); color: var(--color-text-muted); font-size: 12px; }
.reference-qa-row-arrow { flex: 0 0 auto; color: var(--color-brand); font-size: 18px; line-height: 1.2; }

@media (max-width: 800px) {
  .reference-hero { align-items: flex-start; padding-top: 8px; }
  .reference-seal { width: 92px; height: 92px; }
  .reference-seal-ring { inset: 8px; }
  .reference-seal-mark { font-size: 36px; }
  .reference-seal-caption { bottom: 12px; font-size: 7px; }
  .reference-search-row, .reference-stats { align-items: stretch; flex-direction: column; }
  .reference-scope { align-self: flex-start; }
  .reference-stat { min-width: 0; border-right: 0; border-bottom: 1px solid var(--color-panel-border); flex-direction: row; align-items: baseline; gap: 10px; }
  .reference-stat-note { border-bottom: 0; }
  .reference-result-layout, .reference-discovery { grid-template-columns: 1fr; gap: 28px; }
  .reference-sidebar { position: static; }
  .reference-sidebar-heading { display: none; }
  .reference-book-row { display: inline-flex; width: auto; margin: 0 4px 5px 0; padding: 7px 9px; border: 1px solid var(--color-card-border); border-radius: 5px; }
  .reference-book-row span:last-child { margin-left: 8px; }
}

@media (max-width: 540px) {
  .reference-hero { gap: 14px; }
  .reference-seal { display: none; }
  .reference-title { font-size: 36px; }
  .reference-search { padding-inline: 15px; }
  .reference-search-foot { flex-direction: column; gap: 3px; }
  .reference-book-grid { grid-template-columns: 1fr; }
  .reference-qa-answer, .reference-qa-preview, .reference-card-links { margin-left: 0; }
}
</style>
