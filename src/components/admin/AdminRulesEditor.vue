<script setup lang="ts">
/**
 * AdminRulesEditor.vue · 规则校勘(P3)
 *
 * 对应后台「方案 C · 规则书树形文档编辑器」。界面按宣纸档案风重写。
 *
 * 三处与后台原实现的差异,都有实测依据:
 *   ① 检索改为**本地子串匹配**。库里的 search_vector 用 `simple` 配置生成,
 *      而 simple 不切分中文 —— 实测「法术」FTS 召回 11 条、子串 288 条,
 *      「伤害」2 条 vs 148 条。FTS 对中文基本不可用。
 *      2381 条量级下本地扫描是瞬时的,还省掉每次按键一次网络请求。
 *   ② 树**扁平化渲染**再按 depth 缩进,而不是递归组件 ——
 *      2381 个节点递归出 DOM 太重。
 *   ③ 改父规则时**阻止成环**:不能把自己或自己的后代设为父。
 *      后台没做这个校验,一旦成环树就渲染不出来了。
 */
import { computed, onMounted, ref, watch } from 'vue';
import EditorialShell from './EditorialShell.vue';
import SectionHeading from '../SectionHeading.vue';
import AdminConfirmButton from './AdminConfirmButton.vue';
import { navigate } from '@/router/hash';
import { errorText, notifyError, notifyOk, notifyWarn } from '@/tools/admin/notice';
import { truncate } from '@/tools/admin/text';
import { insertRule, listAllRules, publishRules, updateRule, deleteRule } from '@/tools/admin/rules';
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
  editing.value = null;
  isNew.value = false;
  expanded.value = new Set(defaultExpanded(scopedRules.value, 1));
}

/* ──────────────────────── 树(扁平化) ──────────────────────── */

interface FlatNode {
  rule: Rule;
  depth: number;
  hasChildren: boolean;
  open: boolean;
}

const expanded = ref<Set<string>>(new Set());

const tree = computed<RuleNode[]>(() => buildRuleTree(scopedRules.value));

/** 搜索中时全部展开,否则按 expanded 集合 */
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
  expanded.value = new Set(allRules.value.filter((r) => hasChildren(allRules.value, r.rule_number)).map((r) => r.rule_number));
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

/* ──────────────────────── 编辑器 ──────────────────────── */

const editing = ref<Rule | null>(null);
const isNew = ref(false);
const saving = ref(false);
const busy = ref(false);

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

function selectRule(rule: Rule): void {
  editing.value = JSON.parse(JSON.stringify(rule)) as Rule;
  isNew.value = false;
}

/** 选中并把它所在的路径逐级展开 */
function locateRule(rule: Rule): void {
  clearSearch();
  selectedBook.value = rule.rules_book ?? '';
  selectRule(rule);
  const path = ancestorPath(allRules.value, rule.rule_number);
  const next = new Set(expanded.value);
  for (const p of path) next.add(p);
  expanded.value = next;
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

function addChild(): void {
  const parent = editing.value;
  if (!parent) {
    notifyWarn('请先选择一个父规则');
    return;
  }
  editing.value = blankRule({
    parent_number: parent.rule_number,
    level: (parent.level ?? 0) + 1,
    sort_order: nextSortOrder(scopedRules.value, parent.rule_number),
    rules_book: parent.rules_book
  });
  isNew.value = true;
}

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
  const patch = {
    rule_number: number,
    parent_number: cur.parent_number || null,
    level: cur.level,
    is_heading: cur.is_heading,
    text_zh: cur.text_zh,
    text_en: cur.text_en,
    sort_order: cur.sort_order,
    rules_book: cur.rules_book || null
  };
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
      selectRule(saved);
      const path = ancestorPath(allRules.value, number);
      const next = new Set(expanded.value);
      for (const p of path) next.add(p);
      expanded.value = next;
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
    editing.value = null;
    await loadRules();
  } catch (e) {
    notifyError(`删除失败:${errorText(e)}`);
  } finally {
    busy.value = false;
  }
}

onMounted(loadRules);
</script>

<template>
  <EditorialShell code="editorial-rules">
    <div class="max-w-[1720px] mx-auto">
      <!-- ══════════ 刊头 ══════════ -->
      <header class="mb-7">
        <div class="flex items-center justify-between gap-4 flex-wrap text-[11px] text-ink-faint">
          <button class="hover:text-brand transition-colors" @click="navigate({ view: 'editorial' })">
            ← 返回编辑部
          </button>
          <span class="font-latin tracking-[0.22em] uppercase">Editorial Desk</span>
        </div>
        <p class="eyebrow mt-7">编辑部 · 校勘</p>
        <h1 class="font-display font-black text-ink leading-tight mt-3 text-[28px] lg:text-[38px]">
          规则校勘
        </h1>
        <p class="standfirst mt-4 text-[15px]">
          规则书以 <code class="font-mono text-[13px]">parent_number</code> 自关联成树。
          保存并发布会触碰 <code class="font-mono text-[13px]">version.rules</code>,通知客户端刷新规则书缓存。
        </p>
        <div class="hairline mt-7"></div>
      </header>

      <p v-if="loading && !allRules.length" class="py-16 text-center text-sm text-ink-faint">
        正在载入规则树…
      </p>

      <!-- ══════════ 步骤一:选择规则书 ══════════ -->
      <section v-else-if="selectedBook === null">
        <SectionHeading
          eyebrow="其一 · 选书"
          title="选择规则书"
          :note="`共 ${allRules.length} 条规则,分属 ${books.length} 本`"
        />
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
            <span class="inline-block mt-3 text-[12px] text-brand">进入 →</span>
          </button>
          <button class="card card-hover text-left p-5 border-dashed" @click="openBook('')">
            <span class="font-latin text-[11px] tracking-[0.22em] text-ink-faint tabular-nums">
              {{ String(allRules.length).padStart(4, '0') }} 条
            </span>
            <h2 class="font-display font-bold text-ink text-[16px] mt-2.5">全部规则书</h2>
            <span class="inline-block mt-3 text-[12px] text-brand">进入 →</span>
          </button>
        </div>
      </section>

      <!-- ══════════ 步骤二:树 + 编辑器 ══════════ -->
      <div
        v-else
        class="grid grid-cols-1 xl:grid-cols-[minmax(0,4fr)_minmax(0,6fr)] xl:divide-x xl:divide-panel-border"
      >
        <!-- ───── 左:树 / 检索 ───── -->
        <aside class="xl:pr-8">
          <SectionHeading
            small
            :title="selectedBook === '' ? '全部规则书' : selectedBook"
            :note="`${scopedRules.length} 条`"
          >
            <template #actions>
              <button class="btn-ghost px-2.5 py-1 text-[11px]" @click="expandAll">展开全部</button>
              <button class="btn-ghost px-2.5 py-1 text-[11px]" @click="collapseAll">收起全部</button>
              <button class="btn-ghost px-2.5 py-1 text-[11px]" @click="selectedBook = null">
                切换规则书
              </button>
            </template>
          </SectionHeading>

          <input
            v-model="searchQuery"
            placeholder="检索:编号 / 中文 / 英文(子串匹配)"
            class="filter-select w-full mb-3"
          />

          <!-- 检索结果 -->
          <div v-if="searching" class="border border-card-border rounded-xl max-h-[560px] overflow-y-auto">
            <button
              v-for="r in searchResults.slice(0, 200)"
              :key="r.id"
              class="w-full text-left px-3 py-2 border-b border-panel-border/40 last:border-0 table-row transition-colors"
              @click="locateRule(r)"
            >
              <div class="flex items-baseline gap-2 min-w-0">
                <span class="font-mono text-[11px] text-brand shrink-0">{{ r.rule_number }}</span>
                <span class="text-[13px] text-ink truncate">
                  {{ truncate(r.text_zh || r.text_en, 34) || '（无文本）' }}
                </span>
              </div>
              <div v-if="r.rules_book" class="text-[10px] text-ink-faint mt-0.5">{{ r.rules_book }}</div>
            </button>
            <p v-if="!searchResults.length" class="px-3 py-8 text-center text-xs text-ink-faint">
              没有匹配的规则
            </p>
            <p
              v-else-if="searchResults.length > 200"
              class="px-3 py-2 text-[11px] text-ink-faint border-t border-panel-border/40"
            >
              共 {{ searchResults.length }} 条,仅显示前 200 条
            </p>
          </div>

          <!-- 树(扁平化渲染 + 缩进导线) -->
          <div v-else class="border border-card-border rounded-xl max-h-[560px] overflow-y-auto py-1">
            <button
              v-for="n in flatNodes"
              :key="n.rule.rule_number"
              class="w-full text-left py-1.5 pr-2 transition-colors flex items-center gap-0"
              :class="
                editing && !isNew && editing.rule_number === n.rule.rule_number
                  ? 'bg-brand-soft'
                  : 'table-row'
              "
              @click="selectRule(n.rule)"
            >
              <!-- 缩进导线:每层一条 1px 竖线,符合「层级靠细线承载」 -->
              <span
                v-for="d in n.depth"
                :key="d"
                class="shrink-0 self-stretch border-l border-panel-border/50"
                style="width: 14px"
              ></span>
              <span class="w-[14px] shrink-0 text-center text-[9px] text-ink-faint">
                <template v-if="n.hasChildren">
                  <span
                    class="hover:text-brand"
                    :title="n.open ? '收起' : '展开'"
                    @click.stop="toggleNode(n.rule.rule_number)"
                  >
                    {{ n.open ? '▾' : '▸' }}
                  </span>
                </template>
              </span>
              <span class="font-mono text-[11px] text-ink-faint shrink-0 w-[64px]">
                {{ n.rule.rule_number }}
              </span>
              <span
                class="text-[13px] truncate min-w-0"
                :class="n.rule.is_heading ? 'font-display font-bold text-ink' : 'text-ink-muted'"
              >
                {{ truncate(n.rule.text_zh || n.rule.text_en, 30) || '（无文本）' }}
              </span>
            </button>
            <p v-if="!flatNodes.length" class="px-3 py-8 text-center text-xs text-ink-faint">
              该规则书暂无条目
            </p>
          </div>
        </aside>

        <!-- ───── 右:编辑器 ───── -->
        <section class="xl:pl-8 pt-8 xl:pt-0 min-w-0">
          <template v-if="editing">
            <div class="flex items-start justify-between gap-4 flex-wrap mb-6">
              <div class="min-w-0">
                <h2 class="font-display font-bold text-ink text-xl truncate">
                  {{ isNew ? '新增规则' : editing.rule_number }}
                  <span
                    v-if="isNew"
                    class="text-[10px] text-accent border border-accent/40 rounded px-1.5 py-0.5 ml-2 align-middle"
                  >
                    未保存
                  </span>
                </h2>
                <p class="text-[11px] text-ink-faint mt-1">
                  <template v-if="!isNew">
                    {{ isExistingLeaf ? '叶子节点,可删除' : '含子节点,不可删除' }}
                  </template>
                  <template v-else>新增条目,填写编号后保存</template>
                </p>
              </div>
              <div class="flex items-center gap-3 shrink-0">
                <AdminConfirmButton
                  label="删除节点"
                  confirm-label="确认删除该规则"
                  :disabled="isNew || !isExistingLeaf || busy"
                  @confirm="remove"
                />
                <button class="btn-ghost px-3 py-1.5 text-xs" @click="addChild">新增子规则</button>
                <button class="btn-ghost px-3 py-1.5 text-xs" :disabled="saving" @click="save(false)">
                  {{ saving ? '保存中…' : '保存修改' }}
                </button>
                <button class="btn-brand px-3 py-1.5 text-xs" :disabled="saving" @click="save(true)">
                  保存并发布
                </button>
              </div>
            </div>

            <SectionHeading small eyebrow="条目字段" title="规则条目" />

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
              <label class="block">
                <span class="text-[11px] tracking-[0.14em] text-ink-faint">规则编号</span>
                <input v-model="editing.rule_number" class="filter-select w-full mt-1.5 font-mono" placeholder="如 053.1" />
              </label>
              <label class="block">
                <span class="text-[11px] tracking-[0.14em] text-ink-faint">规则书版本</span>
                <input
                  v-model="editing.rules_book"
                  list="rules-book-options"
                  class="filter-select w-full mt-1.5"
                  placeholder="选择或输入"
                />
                <datalist id="rules-book-options">
                  <option v-for="b in books" :key="b.name" :value="b.name" />
                </datalist>
              </label>
              <label class="block sm:col-span-2">
                <span class="text-[11px] tracking-[0.14em] text-ink-faint">父规则</span>
                <select v-model="editing.parent_number" class="filter-select w-full mt-1.5">
                  <option :value="null">无(根节点)</option>
                  <option v-for="p in parentOptions" :key="p.key" :value="p.key">{{ p.label }}</option>
                </select>
                <span v-if="cycleWarning" class="block text-[11px] text-delta-down mt-1.5">
                  {{ cycleWarning }}
                </span>
                <span v-else class="block text-[11px] text-ink-faint mt-1.5">
                  候选已排除自身及其全部后代,防止成环
                </span>
              </label>
              <label class="block">
                <span class="text-[11px] tracking-[0.14em] text-ink-faint">层级</span>
                <input v-model.number="editing.level" type="number" min="0" class="filter-select w-full mt-1.5 tabular-nums" />
              </label>
              <label class="block">
                <span class="text-[11px] tracking-[0.14em] text-ink-faint">排序号</span>
                <input v-model.number="editing.sort_order" type="number" min="0" class="filter-select w-full mt-1.5 tabular-nums" />
              </label>
              <div class="sm:col-span-2 flex items-center gap-2.5">
                <span class="text-[11px] tracking-[0.14em] text-ink-faint">条目类型</span>
                <div class="flex rounded-lg overflow-hidden border border-card-border">
                  <button
                    class="px-3 py-1.5 text-xs transition-colors border-l border-card-border first:border-l-0"
                    :class="!editing.is_heading ? 'tab-active' : 'text-ink-muted hover:text-brand'"
                    @click="editing.is_heading = false"
                  >
                    正文
                  </button>
                  <button
                    class="px-3 py-1.5 text-xs transition-colors border-l border-card-border"
                    :class="editing.is_heading ? 'tab-active' : 'text-ink-muted hover:text-brand'"
                    @click="editing.is_heading = true"
                  >
                    标题(树中加粗)
                  </button>
                </div>
              </div>
            </div>

            <div class="hairline my-6"></div>

            <SectionHeading small eyebrow="条文" title="中英文本" />
            <label class="block">
              <span class="text-[11px] tracking-[0.14em] text-ink-faint">中文文本</span>
              <textarea
                v-model="editing.text_zh"
                rows="5"
                class="filter-select w-full mt-1.5 leading-relaxed"
                placeholder="中文规则条文"
              ></textarea>
            </label>
            <label class="block mt-4">
              <span class="text-[11px] tracking-[0.14em] text-ink-faint">英文文本</span>
              <textarea
                v-model="editing.text_en"
                rows="5"
                class="filter-select w-full mt-1.5 leading-relaxed"
                placeholder="英文规则条文"
              ></textarea>
            </label>
          </template>

          <div v-else class="py-20 text-center">
            <p class="text-sm text-ink-faint">在左侧选择一个规则节点开始校勘</p>
            <p class="text-[11px] text-ink-faint mt-2">
              检索命中后点结果可直接定位;先选中一个条目再点「新增子规则」
            </p>
          </div>
        </section>
      </div>
    </div>
  </EditorialShell>
</template>
