<script setup lang="ts">
import { ArrowRight, ChevronDown, ChevronRight, GripVertical, Plus, Search, X } from '@lucide/vue';
/**
 * AdminRulesEditor.vue · 规则校勘(P3)
 *
 * 形态:像**一本打开的规则书**那样浏览,双击任意段落 → 右侧滑出编辑抽屉
 * (与公开阅读页的「卡牌查询」同一套抽屉范式),在抽屉里改这一条。
 *
 * 与旧版「左树 + 右表单」卡库范式相比,三处保留的实测依据:
 *   ① 检索仍为**本地子串匹配**。库里的 search_vector 用 `simple` 配置生成,
 *      而 simple 不切分中文 —— 实测「法术」FTS 召回 11 条、子串 288 条,
 *      「伤害」2 条 vs 148 条。FTS 对中文基本不可用。
 *   ② 书页把树**扁平化渲染**再按 depth 缩进,而不是递归组件 ——
 *      2381 个节点递归出 DOM 太重。
 *   ③ 改父规则时**阻止成环**:自己与自己的后代都不能当父。
 *      后台没做这个校验,一旦成环树就渲染不出来了。
 *   ④ 段落行尾的拖动手柄走 HTML5 原生拖拽:拖到某条**之上**=成为其子条目,
 *      拖到上下缘=插入其前/后(同一父级内重排)。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import EditorialShell from './EditorialShell.vue';
import SectionHeading from '../SectionHeading.vue';
import AdminConfirmButton from './AdminConfirmButton.vue';
import { errorText, notifyError, notifyOk, notifyWarn } from '@/tools/admin/notice';
import { truncate } from '@/tools/admin/text';
import { insertRule, listAllRules, publishRules, updateRule, deleteRule, type RulePatch } from '@/tools/admin/rules';
import {
  ancestorPath,
  bookCounts,
  buildRuleTree,
  defaultExpanded,
  filterByBook,
  hasChildren,
  matchRules,
  nextSortOrder,
  wouldCreateCycle,
  type RuleNode
} from '@/tools/admin/rulesTree';
import type { Rule } from '@/tools/admin/types';
import { isUsableRuleNumber } from '@/tools/admin/validate';

type LanguageMode = 'zh' | 'en' | 'both';
type DropMode = 'before' | 'child' | 'after';

/* ──────────────────────── 载入 ──────────────────────── */

const allRules = ref<Rule[]>([]);
const loading = ref(false);

async function loadRules(): Promise<void> {
  loading.value = true;
  try {
    allRules.value = await listAllRules();
  } catch (e) {
    notifyError(`加载规则失败:${errorText(e)}`);
    allRules.value = [];
  } finally {
    loading.value = false;
  }
}

/* ──────────────────────── 选书 ──────────────────────── */

/** null = 尚未选书(选择页);'' = 全部;其它 = 具体某一本 */
const selectedBook = ref<string | null>(null);

const books = computed(() => bookCounts(allRules.value));
const scopedRules = computed(() =>
  selectedBook.value === null ? [] : filterByBook(allRules.value, selectedBook.value)
);

function openBook(name: string): void {
  selectedBook.value = name;
  closeDrawer();
  selected.value = new Set();
  located.value = '';
  expanded.value = new Set(defaultExpanded(scopedRules.value, 1));
}

/* ──────────────────────── 书页(扁平化树) ──────────────────────── */

interface FlatNode {
  rule: Rule;
  depth: number;
  hasChildren: boolean;
  open: boolean;
}

const expanded = ref<Set<string>>(new Set());
const language = ref<LanguageMode>('zh');
const located = ref('');
const selected = ref<Set<string>>(new Set());

const tree = computed<RuleNode[]>(() => buildRuleTree(scopedRules.value));
const searching = computed(() => searchQuery.value.trim().length > 0);

const flatNodes = computed<FlatNode[]>(() => {
  const out: FlatNode[] = [];
  const walk = (nodes: RuleNode[], depth: number): void => {
    for (const n of nodes) {
      const kids = n.children.length > 0;
      const open = searching.value || expanded.value.has(n.rule.rule_number);
      out.push({ rule: n.rule, depth, hasChildren: kids, open });
      if (kids && open) walk(n.children, depth + 1);
    }
  };
  walk(tree.value, 0);
  return out;
});

function toggleNode(number: string): void {
  const next = new Set(expanded.value);
  if (next.has(number)) next.delete(number);
  else next.add(number);
  expanded.value = next;
}

function expandAll(): void {
  expanded.value = new Set(
    scopedRules.value.filter((r) => hasChildren(scopedRules.value, r.rule_number)).map((r) => r.rule_number)
  );
}
function collapseAll(): void {
  expanded.value = new Set();
}

/* ──────────────────────── 检索(本地子串) ──────────────────────── */

const searchQuery = ref('');
const searchResults = computed(() => matchRules(scopedRules.value, searchQuery.value));

function clearSearch(): void {
  searchQuery.value = '';
}

function textLines(rule: Rule): string[] {
  if (language.value === 'en') return [rule.text_en || rule.text_zh || 'No text available'];
  if (language.value === 'both') return [rule.text_zh || '暂无中文正文', rule.text_en || 'No English text'];
  return [rule.text_zh || rule.text_en || '暂无正文'];
}

function ruleRowId(number: string): string {
  return `arow-${encodeURIComponent(number)}`;
}

async function scrollToRule(number: string): Promise<void> {
  await nextTick();
  document.getElementById(ruleRowId(number))?.scrollIntoView({
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    block: 'center'
  });
}

/** 检索命中后定位并高亮该书页段落,但**不**打开抽屉(编辑靠双击) */
function locateRule(rule: Rule): void {
  clearSearch();
  if (selectedBook.value !== null && selectedBook.value !== '' && (rule.rules_book ?? '') !== selectedBook.value) {
    selectedBook.value = rule.rules_book ?? '';
  }
  const path = ancestorPath(allRules.value, rule.rule_number);
  const next = new Set(expanded.value);
  for (const p of path) next.add(p);
  expanded.value = next;
  located.value = rule.rule_number;
  void scrollToRule(rule.rule_number);
}

function toggleSelected(number: string): void {
  const next = new Set(selected.value);
  if (next.has(number)) next.delete(number);
  else next.add(number);
  selected.value = next;
}

function clearSelection(): void {
  selected.value = new Set();
}

async function copySelected(): Promise<void> {
  const rules = flatNodes.value
    .map((n) => n.rule)
    .filter((r) => selected.value.has(r.rule_number));
  if (!rules.length) return;
  const text = rules.map((r) => `${r.rule_number}  ${textLines(r).join('\n')}`).join('\n\n');
  try {
    await navigator.clipboard.writeText(text);
    notifyOk(`已复制 ${rules.length} 条规则`);
  } catch {
    notifyWarn('复制失败,请检查浏览器剪贴板权限');
  }
}

/* ──────────────────────── 编辑器(抽屉) ──────────────────────── */

const editing = ref<Rule | null>(null);
const original = ref<Rule | null>(null);
const isNew = ref(false);
const saving = ref(false);
const busy = ref(false);
const advancedOpen = ref(false);
const confirmDiscard = ref(false);

const drawerOpen = computed(() => editing.value !== null);

const isDirty = computed(() => {
  const cur = editing.value;
  if (!cur) return false;
  if (isNew.value) return true;
  return JSON.stringify(cur) !== JSON.stringify(original.value);
});

const activeNumber = computed(() => (isNew.value ? '' : editing.value?.rule_number ?? ''));

function blankRule(prefill: Partial<Rule>): Rule {
  return {
    id: '',
    rule_number: '',
    parent_number: null,
    level: null,
    is_heading: false,
    text_zh: null,
    text_en: null,
    sort_order: null,
    rules_book: null,
    ...prefill
  };
}

function openEditor(rule: Rule): void {
  if (interactionLocked.value) return;
  // 双击也可能顺带选中了一段文字,这里清掉,避免显得像复制态
  window.getSelection()?.removeAllRanges();
  located.value = '';
  confirmDiscard.value = false;
  advancedOpen.value = false;
  original.value = JSON.parse(JSON.stringify(rule)) as Rule;
  editing.value = JSON.parse(JSON.stringify(rule)) as Rule;
  isNew.value = false;
}

/** 行尾「＋」:在该条下新增子规则 */
function startAddChild(parent: Rule): void {
  if (interactionLocked.value) return;
  confirmDiscard.value = false;
  advancedOpen.value = false;
  original.value = null;
  editing.value = blankRule({
    parent_number: parent.rule_number,
    level: (parent.level ?? 0) + 1,
    sort_order: nextSortOrder(scopedRules.value, parent.rule_number),
    rules_book: parent.rules_book
  });
  isNew.value = true;
}

/** 抽屉内「新增子规则」:以当前条目为父 */
function addChild(): void {
  const parent = editing.value;
  if (!parent) {
    notifyWarn('请先选择一个父规则');
    return;
  }
  confirmDiscard.value = false;
  original.value = parent;
  editing.value = blankRule({
    parent_number: parent.rule_number,
    level: (parent.level ?? 0) + 1,
    sort_order: nextSortOrder(scopedRules.value, parent.rule_number),
    rules_book: parent.rules_book
  });
  isNew.value = true;
}

function requestClose(): void {
  if (isDirty.value) {
    confirmDiscard.value = true;
    return;
  }
  closeDrawer();
}

function closeDrawer(): void {
  editing.value = null;
  original.value = null;
  isNew.value = false;
  advancedOpen.value = false;
  confirmDiscard.value = false;
}

/** 父规则候选:排除自己与自己的后代(防环) */
const parentOptions = computed(() => {
  const cur = editing.value;
  if (!cur) return [];
  return scopedRules.value
    .filter((r) => r.rule_number !== cur.rule_number)
    .filter((r) => !wouldCreateCycle(allRules.value, cur.rule_number, r.rule_number))
    .map((r) => ({ key: r.rule_number, label: `${r.rule_number} ${truncate(r.text_zh ?? r.text_en, 20)}`.trim() }));
});

/** 当前编辑项若是库里已有的编号,则可判断是否为叶子 */
const isExistingLeaf = computed(() => {
  const cur = editing.value;
  if (!cur || isNew.value) return false;
  return !hasChildren(allRules.value, cur.rule_number);
});

/** 改父规则时给出即时警告,而不是等到保存才失败 */
const cycleWarning = computed(() => {
  const cur = editing.value;
  if (!cur || isNew.value) return '';
  if (!wouldCreateCycle(allRules.value, cur.rule_number, cur.parent_number)) return '';
  return '该父规则位于自己的子树内,保存后会形成环,已阻止。';
});

watch(
  () => editing.value?.parent_number,
  (next) => {
    const cur = editing.value;
    if (!cur || isNew.value || !next) return;
    if (wouldCreateCycle(allRules.value, cur.rule_number, next)) {
      notifyWarn('不能把父规则设为自己的后代(会形成环)');
    }
  }
);

function rulePatch(rule: Rule, over: Partial<RulePatch> = {}): RulePatch {
  return {
    rule_number: rule.rule_number,
    parent_number: rule.parent_number ?? null,
    level: rule.level,
    is_heading: rule.is_heading,
    text_zh: rule.text_zh,
    text_en: rule.text_en,
    sort_order: rule.sort_order,
    rules_book: rule.rules_book || null,
    ...over
  };
}

async function save(publish: boolean): Promise<void> {
  const cur = editing.value;
  if (!cur) return;
  const number = cur.rule_number.trim();
  if (!isUsableRuleNumber(number)) {
    notifyWarn('规则编号需以数字开头,可含点与字母(如 053.1 / 133.4.b),长度不超过 24');
    return;
  }
  if (cycleWarning.value) {
    notifyError(cycleWarning.value);
    return;
  }
  saving.value = true;
  const patch = rulePatch(cur, { rule_number: number, parent_number: cur.parent_number || null });
  try {
    if (isNew.value) {
      const created = await insertRule(patch);
      notifyOk(`规则 ${created.rule_number} 已新增`);
    } else {
      const rows = await updateRule(cur.id, patch);
      if (!rows.length) throw new Error('未被写入(0 行受影响):账号可能不是管理员,或该行已被删除');
      notifyOk(`规则 ${number} 已保存`);
    }
    if (publish) {
      await publishRules();
      notifyOk('已发布', 'version.rules 时间戳已更新');
    }
    isNew.value = false;
    await loadRules();
    const saved = allRules.value.find((r) => r.rule_number === number);
    if (saved) {
      original.value = JSON.parse(JSON.stringify(saved)) as Rule;
      editing.value = JSON.parse(JSON.stringify(saved)) as Rule;
      const path = ancestorPath(allRules.value, number);
      const next = new Set(expanded.value);
      for (const p of path) next.add(p);
      expanded.value = next;
    } else {
      closeDrawer();
    }
  } catch (e) {
    notifyError(`保存失败:${errorText(e)}`);
  } finally {
    saving.value = false;
  }
}

async function remove(): Promise<void> {
  const cur = editing.value;
  if (!cur || isNew.value) return;
  if (hasChildren(allRules.value, cur.rule_number)) {
    notifyWarn('该节点含子节点,只允许删除没有子节点的叶子');
    return;
  }
  busy.value = true;
  try {
    const rows = await deleteRule(cur.id);
    if (!rows.length) throw new Error('未被删除(0 行受影响)');
    notifyOk(`规则 ${cur.rule_number} 已删除`);
    closeDrawer();
    await loadRules();
  } catch (e) {
    notifyError(`删除失败:${errorText(e)}`);
  } finally {
    busy.value = false;
  }
}

/* ──────────────────────── 拖拽:改父级 / 同一父级内重排 ──────────────────────── */

const dragging = ref('');
const dropTarget = ref<{ number: string; mode: DropMode } | null>(null);

function compareRules(a: Rule, b: Rule): number {
  return (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.rule_number.localeCompare(b.rule_number, 'zh');
}

function onDragStart(event: DragEvent, rule: Rule): void {
  dragging.value = rule.rule_number;
  dropTarget.value = null;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', rule.rule_number);
  }
}

function onDragOver(event: DragEvent, rule: Rule): void {
  if (!dragging.value || dragging.value === rule.rule_number) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const offset = event.clientY - rect.top;
  const mode: DropMode = offset < rect.height * 0.28 ? 'before' : offset > rect.height * 0.72 ? 'after' : 'child';
  dropTarget.value = { number: rule.rule_number, mode };
}

function onDragEnd(): void {
  dragging.value = '';
  dropTarget.value = null;
}

async function onDrop(event: DragEvent, target: Rule): Promise<void> {
  event.preventDefault();
  const source = dragging.value;
  const mode = dropTarget.value?.number === target.rule_number ? dropTarget.value.mode : 'child';
  onDragEnd();
  if (!source || source === target.rule_number) return;
  await moveRule(source, target, mode);
}

async function moveRule(sourceNumber: string, target: Rule, mode: DropMode): Promise<void> {
  const drag = scopedRules.value.find((r) => r.rule_number === sourceNumber);
  if (!drag) return;
  const newParent = mode === 'child' ? target.rule_number : target.parent_number ?? null;
  if (newParent === drag.rule_number || wouldCreateCycle(allRules.value, drag.rule_number, newParent)) {
    notifyWarn('不能移动到自己的子树内');
    return;
  }
  busy.value = true;
  try {
    const siblings = scopedRules.value
      .filter((r) => r.rule_number !== drag.rule_number && (r.parent_number ?? null) === newParent)
      .sort(compareRules);
    let index = siblings.length;
    if (mode !== 'child') {
      const at = siblings.findIndex((r) => r.rule_number === target.rule_number);
      if (at >= 0) index = mode === 'before' ? at : at + 1;
    }
    const sequence = [...siblings.slice(0, index), drag, ...siblings.slice(index)];
    const jobs: Array<Promise<unknown>> = [];
    sequence.forEach((rule, i) => {
      const want = i + 1;
      if (rule.rule_number === drag.rule_number) {
        jobs.push(updateRule(drag.id, rulePatch(drag, { parent_number: newParent, sort_order: want })));
      } else if ((rule.sort_order ?? 0) !== want) {
        jobs.push(updateRule(rule.id, rulePatch(rule, { sort_order: want })));
      }
    });
    await Promise.all(jobs);
    notifyOk(`已将 ${sourceNumber} 移动到 ${target.rule_number} ${mode === 'child' ? '之下' : mode === 'before' ? '之前' : '之后'}`);
    const path = ancestorPath(allRules.value, sourceNumber);
    const next = new Set(expanded.value);
    for (const p of path) next.add(p);
    if (mode === 'child') next.add(target.rule_number);
    expanded.value = next;
    await loadRules();
  } catch (e) {
    notifyError(`移动失败:${errorText(e)}`);
  } finally {
    busy.value = false;
  }
}

/* ──────────────────────── 发布 ──────────────────────── */

async function publish(): Promise<void> {
  busy.value = true;
  try {
    await publishRules();
    notifyOk('已发布', 'version.rules 时间戳已更新');
  } catch (e) {
    notifyError(`发布失败:${errorText(e)}`);
  } finally {
    busy.value = false;
  }
}

/* 拖拽进行中禁用双击/新增,避免状态互相打架 */
const interactionLocked = computed(() => busy.value || Boolean(dragging.value));

onMounted(loadRules);
</script>

<template>
  <EditorialShell code="editorial-rules">
    <div class="rules-reader" :class="{ 'drawer-open': drawerOpen }">
      <!-- ══════════ 刊头 ══════════ -->
      <header class="mb-6">
        <h1 class="font-display font-black text-ink leading-tight text-[28px] lg:text-[38px]">规则校勘</h1>
        <div class="hairline mt-6"></div>
      </header>

      <p v-if="loading && !allRules.length" class="py-16 text-center text-sm text-ink-faint">
        正在载入规则树…
      </p>

      <!-- ══════════ 步骤一:选择规则书 ══════════ -->
      <section v-else-if="selectedBook === null">
        <SectionHeading plain title="选择规则书" :note="`共 ${allRules.length} 条规则,分属 ${books.length} 本`" />
        <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          <button
            v-for="b in books"
            :key="b.name"
            class="card card-hover text-left p-5"
            @click="openBook(b.name)"
          >
            <span class="font-latin text-[11px] tracking-[0.22em] text-ink-faint tabular-nums">
              {{ String(b.count).padStart(4, '0') }} 条
            </span>
            <h2 class="font-display font-bold text-ink text-[16px] mt-2.5">{{ b.name }}</h2>
            <span class="inline-block mt-3 text-[12px] text-brand">进入 <ArrowRight :size="13" aria-hidden="true" /></span>
          </button>
          <button class="card card-hover text-left p-5 border-dashed" @click="openBook('')">
            <span class="font-latin text-[11px] tracking-[0.22em] text-ink-faint tabular-nums">
              {{ String(allRules.length).padStart(4, '0') }} 条
            </span>
            <h2 class="font-display font-bold text-ink text-[16px] mt-2.5">全部规则书</h2>
            <span class="inline-block mt-3 text-[12px] text-brand">进入 <ArrowRight :size="13" aria-hidden="true" /></span>
          </button>
        </div>
      </section>

      <!-- ══════════ 步骤二:书页 + 抽屉 ══════════ -->
      <template v-else>
        <!-- 工具条 -->
        <div class="rules-toolbar">
          <button class="btn-ghost px-2.5 py-1 text-[11px]" @click="selectedBook = null">‹ 切换规则书</button>
          <span class="rules-title">{{ selectedBook === '' ? '全部规则书' : selectedBook }}</span>
          <label class="rules-search-wrap">
            <Search :size="15" aria-hidden="true" />
            <input
              v-model="searchQuery"
              class="filter-select rules-search"
              placeholder="检索:编号 / 中文 / 英文(子串匹配)"
            />
          </label>
          <div class="rules-toolbar-actions">
            <button class="btn-ghost px-2.5 py-1 text-[11px]" @click="expandAll">展开全部</button>
            <button class="btn-ghost px-2.5 py-1 text-[11px]" @click="collapseAll">收起全部</button>
            <div class="rules-lang" role="group" aria-label="语言模式">
              <button
                v-for="option in [{ id: 'zh', label: '中' }, { id: 'en', label: '英' }, { id: 'both', label: '中英' }]"
                :key="option.id"
                :class="{ active: language === option.id }"
                @click="language = option.id as LanguageMode"
              >
                {{ option.label }}
              </button>
            </div>
            <button class="btn-ghost px-2.5 py-1 text-[11px]" :disabled="busy" @click="publish">发布</button>
          </div>
        </div>
        <p class="rules-toolbar-note">
          双击任意段落即可在右侧编辑;行尾 <Plus :size="11" aria-hidden="true" /> 新增子规则,拖动手柄可改父级或在同级重排。
        </p>

        <!-- 检索结果 -->
        <div v-if="searching" class="rules-page rules-search-page">
          <button
            v-for="r in searchResults.slice(0, 200)"
            :key="r.id"
            class="rules-search-hit table-row"
            @click="locateRule(r)"
          >
            <span class="font-mono text-[11px] text-brand shrink-0">{{ r.rule_number }}</span>
            <span class="text-[13px] text-ink truncate">{{ truncate(r.text_zh || r.text_en, 40) || '（无文本）' }}</span>
            <span v-if="r.rules_book" class="text-[10px] text-ink-faint shrink-0">{{ r.rules_book }}</span>
          </button>
          <p v-if="!searchResults.length" class="py-10 text-center text-xs text-ink-faint">没有匹配的规则</p>
          <p
            v-else-if="searchResults.length > 200"
            class="pt-3 text-center text-[11px] text-ink-faint"
          >
            共 {{ searchResults.length }} 条,仅显示前 200 条
          </p>
        </div>

        <!-- 书页 -->
        <main v-else class="rules-page">
          <article
            v-for="n in flatNodes"
            :id="ruleRowId(n.rule.rule_number)"
            :key="n.rule.rule_number"
            class="rule-row"
            :class="{
              chapter: n.rule.is_heading,
              selected: selected.has(n.rule.rule_number),
              editing: activeNumber === n.rule.rule_number,
              located: located === n.rule.rule_number,
              dragging: dragging === n.rule.rule_number,
              'drop-child': dropTarget?.number === n.rule.rule_number && dropTarget?.mode === 'child',
              'drop-before': dropTarget?.number === n.rule.rule_number && dropTarget?.mode === 'before',
              'drop-after': dropTarget?.number === n.rule.rule_number && dropTarget?.mode === 'after'
            }"
            :data-rule-number="n.rule.rule_number"
            :data-depth="n.depth"
            :style="{ '--depth': n.depth }"
            @dblclick="openEditor(n.rule)"
            @dragover="onDragOver($event, n.rule)"
            @drop="onDrop($event, n.rule)"
          >
            <span class="rule-gutter">
              <button
                v-if="n.hasChildren"
                class="rule-toggle"
                :title="n.open ? '收起' : '展开'"
                :aria-label="n.open ? '收起' : '展开'"
                @click.stop="toggleNode(n.rule.rule_number)"
              >
                <ChevronDown v-if="n.open" :size="14" /><ChevronRight v-else :size="14" />
              </button>
            </span>

            <div class="rule-body">
              <p
                v-for="(line, lineIndex) in textLines(n.rule)"
                :key="lineIndex"
                class="rule-line"
                :class="{ 'english-line': language === 'both' && lineIndex > 0 }"
              >
                <button
                  v-if="lineIndex === 0"
                  class="rule-number"
                  :title="selected.has(n.rule.rule_number) ? '取消选择' : '点击编号选择整条规则'"
                  :aria-pressed="selected.has(n.rule.rule_number)"
                  @click.stop="toggleSelected(n.rule.rule_number)"
                >
                  {{ n.rule.rule_number }}
                </button>
                <span class="rule-text">{{ line }}</span>
              </p>
            </div>

            <span class="rule-actions">
              <button class="rule-action" title="新增子规则" @click.stop="startAddChild(n.rule)">
                <Plus :size="14" aria-hidden="true" />
              </button>
              <span
                class="rule-drag"
                role="button"
                tabindex="0"
                draggable="true"
                title="拖动到目标条目之上成为其子条目,拖到上下缘则插入其前/后"
                aria-label="拖动排序"
                @dragstart="onDragStart($event, n.rule)"
                @dragend="onDragEnd"
              >
                <GripVertical :size="14" aria-hidden="true" />
              </span>
            </span>
          </article>

          <p v-if="!flatNodes.length" class="py-16 text-center text-xs text-ink-faint">该规则书暂无条目</p>
        </main>

        <!-- 选择条 -->
        <div v-if="selected.size" class="rules-selection-bar" role="toolbar" aria-label="已选规则操作">
          <span class="tabular-nums">已选 {{ selected.size }} 条</span>
          <button class="btn-ghost px-2.5 py-1 text-[11px]" @click="copySelected">复制条文</button>
          <button class="btn-ghost px-2.5 py-1 text-[11px]" @click="clearSelection">清除</button>
        </div>

        <!-- 编辑抽屉 -->
        <aside
          class="rules-drawer"
          :class="{ open: drawerOpen }"
          :aria-hidden="!drawerOpen"
          aria-label="规则编辑"
        >
          <template v-if="editing">
            <header class="drawer-head">
              <div class="min-w-0">
                <h2 class="drawer-title">
                  {{ isNew ? '新增规则' : `编辑 · ${editing.rule_number}` }}
                  <span v-if="isNew" class="drawer-badge">未保存</span>
                </h2>
                <p class="drawer-sub">
                  <template v-if="!isNew">
                    {{ isExistingLeaf ? '叶子节点,可删除' : '含子节点,不可删除' }}
                  </template>
                  <template v-else>填写编号与正文后保存</template>
                </p>
              </div>
              <button class="drawer-x" aria-label="关闭编辑" @click="requestClose"><X :size="18" /></button>
            </header>

            <div class="drawer-scroll">
              <div class="drawer-field">
                <span class="drawer-label">条目类型</span>
                <div class="drawer-seg">
                  <button :class="{ active: !editing.is_heading }" @click="editing.is_heading = false">正文</button>
                  <button :class="{ active: editing.is_heading }" @click="editing.is_heading = true">标题</button>
                </div>
              </div>

              <label class="drawer-field">
                <span class="drawer-label">中文文本</span>
                <textarea v-model="editing.text_zh" rows="5" class="filter-select w-full leading-relaxed" placeholder="中文规则条文"></textarea>
              </label>
              <label class="drawer-field">
                <span class="drawer-label">英文文本</span>
                <textarea v-model="editing.text_en" rows="5" class="filter-select w-full leading-relaxed" placeholder="英文规则条文"></textarea>
              </label>

              <button class="drawer-advanced-toggle" :aria-expanded="advancedOpen" @click="advancedOpen = !advancedOpen">
                <ChevronDown v-if="advancedOpen" :size="15" /><ChevronRight v-else :size="15" />
                高级（结构字段）
              </button>

              <div v-show="advancedOpen" class="drawer-advanced">
                <label class="drawer-field">
                  <span class="drawer-label">规则编号</span>
                  <input v-model="editing.rule_number" class="filter-select w-full font-mono" placeholder="如 053.1" />
                </label>
                <label class="drawer-field">
                  <span class="drawer-label">父规则</span>
                  <select v-model="editing.parent_number" class="filter-select w-full">
                    <option :value="null">无(根节点)</option>
                    <option v-for="p in parentOptions" :key="p.key" :value="p.key">{{ p.label }}</option>
                  </select>
                  <span v-if="cycleWarning" class="drawer-hint warn">{{ cycleWarning }}</span>
                  <span v-else class="drawer-hint">候选已排除自身及其全部后代,防止成环</span>
                </label>
                <div class="drawer-grid2">
                  <label class="drawer-field">
                    <span class="drawer-label">层级</span>
                    <input v-model.number="editing.level" type="number" min="0" class="filter-select w-full tabular-nums" />
                  </label>
                  <label class="drawer-field">
                    <span class="drawer-label">排序号</span>
                    <input v-model.number="editing.sort_order" type="number" min="0" class="filter-select w-full tabular-nums" />
                  </label>
                </div>
                <label class="drawer-field">
                  <span class="drawer-label">规则书版本</span>
                  <input v-model="editing.rules_book" list="rules-book-options" class="filter-select w-full" placeholder="选择或输入" />
                  <datalist id="rules-book-options">
                    <option v-for="b in books" :key="b.name" :value="b.name" />
                  </datalist>
                </label>
              </div>
            </div>

            <footer class="drawer-foot">
              <p v-if="confirmDiscard" class="drawer-confirm">
                有未保存改动,确认放弃?
                <button class="text-brand font-semibold" @click="closeDrawer">放弃</button>
                <button class="text-ink-faint" @click="confirmDiscard = false">继续编辑</button>
              </p>
              <div class="drawer-actions">
                <AdminConfirmButton
                  label="删除节点"
                  confirm-label="确认删除该规则"
                  :disabled="isNew || !isExistingLeaf || busy"
                  @confirm="remove"
                />
                <span class="drawer-actions-spacer"></span>
                <button class="btn-ghost px-3 py-1.5 text-xs" :disabled="busy" @click="addChild">新增子规则</button>
                <button class="btn-ghost px-3 py-1.5 text-xs" :disabled="saving" @click="save(false)">
                  {{ saving ? '保存中…' : '保存修改' }}
                </button>
                <button class="btn-brand px-3 py-1.5 text-xs" :disabled="saving" @click="save(true)">保存并发布</button>
              </div>
            </footer>
          </template>
        </aside>
      </template>
    </div>
  </EditorialShell>
</template>

<style scoped>
.rules-reader {
  --rules-drawer-w: clamp(340px, 30vw, 460px);
  transition: padding-right 0.2s ease;
}
.rules-reader.drawer-open {
  padding-right: calc(var(--rules-drawer-w) + 24px);
}

/* ── 工具条 ── */
.rules-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--color-panel-border);
}
.rules-title {
  font-family: "Noto Serif SC", "Songti SC", Georgia, serif;
  font-weight: 700;
  color: var(--color-text-primary);
  font-size: 15px;
  min-width: 0;
}
.rules-search-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1 1 260px;
  max-width: 460px;
  color: var(--color-text-subtle);
}
.rules-search {
  flex: 1;
  min-width: 0;
}
.rules-toolbar-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-left: auto;
}
.rules-lang {
  display: flex;
  gap: 1px;
  padding: 2px;
  border: 1px solid var(--color-card-border);
  border-radius: 999px;
}
.rules-lang button {
  min-width: 30px;
  padding: 4px 7px;
  border-radius: 999px;
  color: var(--color-text-subtle);
  font-size: 11px;
}
.rules-lang button.active {
  color: var(--color-brand-ink);
  background: var(--color-brand);
}
.rules-toolbar-note {
  margin: 10px 0 0;
  color: var(--color-text-subtle);
  font-size: 11px;
  line-height: 1.7;
}
.rules-toolbar-note :deep(svg) {
  vertical-align: -1px;
  color: var(--color-brand);
}

/* ── 书页 ── */
.rules-page {
  max-width: 940px;
  margin: 16px auto 120px;
  padding: 40px clamp(20px, 3vw, 48px) 80px;
  background: var(--color-card-bg);
  border: 1px solid var(--color-card-border);
  border-radius: 12px;
}
.rules-page.rules-search-page {
  padding: 8px 12px 16px;
}
.rules-search-hit {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: baseline;
  gap: 10px;
  width: 100%;
  text-align: left;
  padding: 9px 10px;
  border-bottom: 1px solid var(--color-split-line);
  transition: background-color 0.15s;
}
.rules-search-hit:last-of-type {
  border-bottom: 0;
}

.rule-row {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  margin-top: 1.15em;
  margin-left: calc(min(var(--depth), 6) * 1.3em);
  padding: 2px 4px;
  border-radius: 3px;
  scroll-margin-top: 90px;
  transition: background-color 0.15s, box-shadow 0.15s;
}
.rule-row.chapter {
  margin-top: 2.2em;
}
.rule-row.selected {
  background: var(--color-brand-soft);
}
.rule-row.located {
  box-shadow: inset 0 0 0 1px var(--color-brand-faint);
}
.rule-row.editing {
  background: var(--color-brand-soft);
  box-shadow: inset 3px 0 0 var(--color-brand);
}
.rule-row.dragging {
  opacity: 0.45;
}
.rule-row.drop-child {
  box-shadow: inset 0 0 0 2px var(--color-brand);
}
.rule-row.drop-before {
  box-shadow: inset 0 2px 0 0 var(--color-brand);
}
.rule-row.drop-after {
  box-shadow: inset 0 -2px 0 0 var(--color-brand);
}
.rule-row:hover .rule-actions {
  opacity: 1;
}

.rule-gutter {
  flex: 0 0 16px;
  display: flex;
  justify-content: center;
  padding-top: 0.35em;
}
.rule-toggle {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  color: var(--color-text-subtle);
}
.rule-toggle:hover {
  color: var(--color-brand);
}

.rule-body {
  flex: 1;
  min-width: 0;
  font-family: "Noto Serif SC", "Songti SC", "Noto Serif", Georgia, serif;
}
.rule-line {
  display: grid;
  grid-template-columns: 4.6em minmax(0, 1fr);
  align-items: baseline;
  margin: 0;
  font: 400 1em/1.95 "Noto Serif SC", "Songti SC", "Noto Serif", Georgia, serif;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.rule-row.chapter .rule-line {
  font-weight: 700;
}
.rule-row.chapter .rule-line:first-child {
  font-size: 1.12em;
}
.rule-number {
  justify-self: start;
  padding: 3px 4px;
  margin-left: -4px;
  text-align: left;
  color: #8a7652;
  font: 600 0.8em/1.6 ui-monospace, monospace;
  white-space: nowrap;
}
.rule-number:hover {
  color: var(--color-brand);
  background: var(--color-brand-soft);
}
.rule-text {
  min-width: 0;
  font-family: inherit;
  user-select: text;
}
.english-line .rule-text {
  grid-column: 2;
  color: var(--color-text-subtle);
  font-size: 0.92em;
}

.rule-actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 2px;
  padding-top: 0.25em;
  opacity: 0;
  transition: opacity 0.15s;
}
.rule-action,
.rule-drag {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  color: var(--color-text-subtle);
  cursor: pointer;
}
.rule-action:hover,
.rule-drag:hover {
  color: var(--color-brand);
  background: var(--color-brand-soft);
}
.rule-drag {
  cursor: grab;
}
.rule-drag:active {
  cursor: grabbing;
}

/* ── 选择条 ── */
.rules-selection-bar {
  position: fixed;
  left: 50%;
  bottom: max(18px, env(safe-area-inset-bottom));
  z-index: 40;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: var(--color-card-bg);
  border: 1px solid var(--color-card-border);
  border-radius: 12px;
  box-shadow: 0 8px 28px rgba(60, 50, 30, 0.16);
  font-size: 12px;
  color: var(--color-text-muted);
  white-space: nowrap;
}
.rules-reader.drawer-open .rules-selection-bar {
  left: calc((100vw - var(--rules-drawer-w)) / 2);
}

/* ── 抽屉 ── */
.rules-drawer {
  position: fixed;
  inset: 0 0 0 auto;
  z-index: 50;
  width: var(--rules-drawer-w);
  display: flex;
  flex-direction: column;
  background: var(--color-card-bg);
  border-left: 1px solid var(--color-panel-border);
  box-shadow: -8px 0 30px rgba(60, 50, 30, 0.1);
  transform: translateX(102%);
  transition: transform 0.22s ease;
}
.rules-drawer.open {
  transform: translateX(0);
}
.drawer-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 20px 12px;
  border-bottom: 1px solid var(--color-split-line);
}
.drawer-title {
  font-family: "Noto Serif SC", "Songti SC", Georgia, serif;
  font-weight: 700;
  font-size: 18px;
  color: var(--color-text-primary);
}
.drawer-badge {
  margin-left: 8px;
  padding: 1px 6px;
  font-size: 10px;
  color: var(--color-brand);
  border: 1px solid var(--color-brand-faint);
  border-radius: 4px;
  vertical-align: middle;
}
.drawer-sub {
  margin-top: 4px;
  font-size: 11px;
  color: var(--color-text-subtle);
}
.drawer-x {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 5px;
  color: var(--color-text-subtle);
}
.drawer-x:hover {
  color: var(--color-brand);
  background: var(--color-brand-soft);
}
.drawer-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 20px 18px;
}
.drawer-field {
  display: block;
  margin-bottom: 14px;
}
.drawer-label {
  display: block;
  margin-bottom: 6px;
  font-size: 11px;
  letter-spacing: 0.1em;
  color: var(--color-text-subtle);
}
.drawer-hint {
  display: block;
  margin-top: 6px;
  font-size: 11px;
  color: var(--color-text-subtle);
}
.drawer-hint.warn {
  color: var(--color-brand);
}
.drawer-seg {
  display: flex;
  border: 1px solid var(--color-card-border);
  border-radius: 8px;
  overflow: hidden;
}
.drawer-seg button {
  padding: 6px 14px;
  font-size: 12px;
  color: var(--color-text-subtle);
  border-left: 1px solid var(--color-card-border);
}
.drawer-seg button:first-child {
  border-left: 0;
}
.drawer-seg button.active {
  color: var(--color-brand-ink);
  background: var(--color-brand);
}
.drawer-advanced-toggle {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  padding: 9px 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-muted);
  border-top: 1px solid var(--color-split-line);
}
.drawer-advanced-toggle:hover {
  color: var(--color-brand);
}
.drawer-advanced {
  padding-top: 8px;
}
.drawer-grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.drawer-foot {
  padding: 12px 20px max(14px, env(safe-area-inset-bottom));
  border-top: 1px solid var(--color-split-line);
  background: var(--color-card-bg);
}
.drawer-confirm {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 10px;
  padding: 8px 10px;
  font-size: 12px;
  color: var(--color-text-muted);
  background: var(--color-brand-soft);
  border-radius: 8px;
}
.drawer-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.drawer-actions-spacer {
  flex: 1;
}

@media (max-width: 900px) {
  .rules-reader.drawer-open {
    padding-right: 0;
  }
  .rules-page {
    max-width: 100%;
    padding: 24px 16px 64px;
  }
  .rules-reader.drawer-open .rules-selection-bar {
    left: 50%;
  }
  .rules-drawer {
    inset: auto 0 0;
    width: 100%;
    height: 72dvh;
    border-left: 0;
    border-top: 1px solid var(--color-panel-border);
    border-radius: 16px 16px 0 0;
    transform: translateY(102%);
    box-shadow: 0 -8px 32px rgba(60, 50, 30, 0.16);
  }
  .rules-drawer.open {
    transform: translateY(0);
  }
}
</style>
