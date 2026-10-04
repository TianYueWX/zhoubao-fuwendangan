<script setup lang="ts">
/**
 * KeywordAudit.vue · 「关键词体检」抽屉
 *
 * 拿规则引擎(src/tools/admin/keywords.ts)扫全表,输出四张清单:
 *   ① 可补    —— 文本能提取出关键词、而库里还没记的卡,勾选后批量写入
 *   ② 异常    —— 库里有、文本却推不出来的词(如人工看提示语填的 后排),只读
 *   ③ 新词    —— 提取出的、全表从未出现过的词。这是硬编码规则唯一的自检机制:
 *                新系列常带出新标记(RAD 这轮带出了「亮出」),它们可能只是
 *                噪音,也可能该进黑名单,由人拍板
 *   ④ 规则    —— 当前生效的黑名单与映射(与引擎同源,不是手抄的文档)
 *
 * 写入是**逐行只提交 keyword 一个字段**,不整行覆盖;并且只加不删。
 */
import { computed, ref, watch } from 'vue';
import { TriangleAlert } from '@lucide/vue';
import Drawer from '../Drawer.vue';
import {
  diffKeywords,
  suggestKeywords,
  RULE_SUMMARY,
  type KeywordHit
} from '@/tools/admin/keywords';
import {
  publishCards,
  selectCardsForKeywordAudit,
  writeKeywords,
  type CardFilter,
  type KeywordAuditRow
} from '@/tools/admin/cards';
import { errorText, notifyError, notifyOk, notifyWarn } from '@/tools/admin/notice';

const props = defineProps<{
  open: boolean;
  /** 只扫这批卡(与列表页同一套筛选语义);不传 = 全表 */
  filter?: CardFilter;
  /**
   * 全表关键词词表(用于判断「这个词全表从没出现过」)。
   * 必须由外部给**全表**的,不能用本次扫描结果自己推 —— 只筛一个系列时,
   * 别的系列已有的词会被误报成新词。
   */
  vocabulary?: string[];
}>();
const emit = defineEmits<{
  (e: 'update:open', v: boolean): void;
  /** 写入成功:让上层刷新关键词候选值 */
  (e: 'applied'): void;
}>();

/* ──────────────────────── 扫描 ──────────────────────── */

interface AuditItem {
  row: KeywordAuditRow;
  /** 当前库里的词 */
  current: string[];
  /** 全部建议(按卡面出现顺序) */
  hits: KeywordHit[];
  /** 需要新增的 */
  add: KeywordHit[];
  /** 库里有、文本推不出来的 */
  orphan: string[];
}

const rows = ref<KeywordAuditRow[]>([]);
const loading = ref(false);
const error = ref('');
const showRules = ref(false);

/** 可补 / 异常 两张清单 */
const items = computed<AuditItem[]>(() =>
  rows.value.map((row) => {
    const hits = suggestKeywords(row);
    const current = row.keyword ?? [];
    const diff = diffKeywords(current, hits);
    return { row, current, hits, add: diff.add, orphan: diff.orphan };
  })
);

const fillable = computed(() => items.value.filter((it) => it.add.length > 0));
const anomalies = computed(() => items.value.filter((it) => it.orphan.length > 0));

/** 全表已有词表(提取出的词不在这里面 = 从没见过的新词) */
const vocabulary = computed(() => {
  if (props.vocabulary?.length) return new Set(props.vocabulary);
  // 退路:没给全表词表时只能用本次扫描结果,此时「新词」仅供参考
  const set = new Set<string>();
  for (const r of rows.value) for (const k of r.keyword ?? []) set.add(k);
  return set;
});

/** 扫描范围说明 —— 编务必须一眼看出自己在改哪一批卡 */
const scopeLabel = computed(() => {
  const f = props.filter ?? {};
  const parts: string[] = [];
  if (f.series) parts.push(`系列 ${f.series}`);
  if (f.rarity) parts.push(`稀有度 ${f.rarity}`);
  if (f.search) parts.push(`搜索「${f.search}」`);
  return parts.length ? parts.join(' · ') : '全表(未筛选)';
});

const newWords = computed(() => {
  const set = new Set<string>();
  for (const it of fillable.value) for (const h of it.add) if (!vocabulary.value.has(h.keyword)) set.add(h.keyword);
  return [...set];
});

async function scan(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    rows.value = await selectCardsForKeywordAudit(props.filter ?? {});
    chosen.value = new Set(fillable.value.map((it) => it.row.id));
    dropped.value = new Map();
  } catch (e) {
    error.value = errorText(e);
    rows.value = [];
  } finally {
    loading.value = false;
  }
}

/**
 * 打开时扫一次;**筛选变了也重扫** —— 否则抽屉里显示的会是上一批卡的结论。
 * 逐个取筛选字段而不是整个 filter 对象:父组件每次渲染都会传新对象字面量,
 * 依赖对象本身会无限重扫。
 */
watch(
  () => [props.open, props.filter?.series, props.filter?.rarity, props.filter?.search] as const,
  ([open]) => {
    if (open) void scan();
  },
  { immediate: true }
);

/* ──────────────────────── 选择 ──────────────────────── */

/** 勾选的卡 id */
const chosen = ref<Set<string>>(new Set());
/** 卡 id → 被手动剔掉的词(默认全选,只记例外) */
const dropped = ref<Map<string, Set<string>>>(new Map());

const chosenCount = computed(() => fillable.value.filter((it) => chosen.value.has(it.row.id)).length);

function toggleCard(id: string): void {
  const next = new Set(chosen.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  chosen.value = next;
}

function isDropped(id: string, kw: string): boolean {
  return dropped.value.get(id)?.has(kw) ?? false;
}

function toggleWord(id: string, kw: string): void {
  const next = new Map(dropped.value);
  const set = new Set(next.get(id) ?? []);
  if (set.has(kw)) set.delete(kw);
  else set.add(kw);
  if (set.size) next.set(id, set);
  else next.delete(id);
  dropped.value = next;
}

function selectAll(v: boolean): void {
  chosen.value = v ? new Set(fillable.value.map((it) => it.row.id)) : new Set();
}

/** 这张卡最终要写入的数组:建议顺序在前(贴合卡面词序),人工填的孤儿词追加在后 */
function mergedFor(it: AuditItem): string[] {
  const keptExisting = new Set(it.current);
  const keptNew = it.add.filter((h) => !isDropped(it.row.id, h.keyword)).map((h) => h.keyword);
  const finalSet = new Set([...keptExisting, ...keptNew]);
  const out: string[] = [];
  for (const h of it.hits) if (finalSet.has(h.keyword) && !out.includes(h.keyword)) out.push(h.keyword);
  for (const k of it.current) if (!out.includes(k)) out.push(k);
  return out;
}

const pending = computed(() => fillable.value.filter((it) => chosen.value.has(it.row.id)));

/* ──────────────────────── 写入 ──────────────────────── */

const writing = ref(false);
const progress = ref('');
const publishTogether = ref(false);

async function commit(): Promise<void> {
  const targets = pending.value;
  if (!targets.length) {
    notifyWarn('没有勾选任何卡');
    return;
  }
  writing.value = true;
  progress.value = `0/${targets.length}`;
  try {
    const patches = targets.map((it) => ({
      id: it.row.id,
      card_no: it.row.card_no ?? '',
      keyword: mergedFor(it)
    }));
    const res = await writeKeywords(patches, (done, total) => {
      progress.value = `${done}/${total}`;
    });

    if (res.failed.length) {
      notifyError(
        `关键词写入 ${res.ok} 行成功、${res.failed.length} 行失败`,
        res.failed
          .slice(0, 3)
          .map((f) => `${f.card_no}:${f.error}`)
          .join(';')
      );
    } else {
      notifyOk(`关键词已写入 ${res.ok} 行`);
    }

    if (publishTogether.value && !res.failed.length) {
      await publishCards();
      notifyOk('已发布', "version.name='cards' 已触碰");
    }
    await scan();
    emit('applied');
  } catch (e) {
    notifyError(`关键词写入异常:${errorText(e)}`);
  } finally {
    writing.value = false;
    progress.value = '';
  }
}
</script>

<template>
  <Drawer
    :open="open"
    wide
    title="关键词体检"
    @update:open="emit('update:open', $event)"
  >
    <div class="text-[13px] text-ink-muted leading-relaxed">
      <p>
        拿「从效果文本提取关键词」的规则扫<b class="font-semibold text-ink">当前筛选出来的卡</b>,列出还缺关键词的。
        <b class="font-semibold text-ink">只加不删</b> —— 库里有、文本推不出来的词不会被改动。
      </p>
      <p class="text-[12px] mt-1.5">
        扫描范围:<b class="text-ink">{{ scopeLabel }}</b>
        <span v-if="scopeLabel !== '全表(未筛选)'" class="text-ink-faint">（改列表的筛选条件会重新扫描）</span>
      </p>

      <!-- 扫描中 / 出错 -->
      <div v-if="loading" class="panel px-4 py-3 mt-4 text-[12px] text-ink-faint">
        正在拉取全表并逐张比对…
      </div>
      <div v-else-if="error" class="panel px-4 py-3 mt-4">
        <p class="text-[12px]" style="color: var(--color-delta-down)">扫描失败:{{ error }}</p>
        <button class="btn-ghost px-3 py-1.5 text-xs mt-2" @click="scan()">重试</button>
      </div>

      <template v-else>
        <!-- ══════════ 汇总 ══════════ -->
        <div class="flex items-center gap-5 flex-wrap mt-4 text-[12px]">
          <span>范围内 <b class="text-ink tabular-nums">{{ rows.length }}</b> 张</span>
          <span>可补 <b class="text-ink tabular-nums">{{ fillable.length }}</b> 张</span>
          <span>异常 <b class="text-ink tabular-nums">{{ anomalies.length }}</b> 张</span>
          <span v-if="newWords.length">
            新词 <b class="text-accent-ink tabular-nums">{{ newWords.length }}</b> 个
          </span>
          <span class="flex-1"></span>
          <button class="text-[11px] text-ink-faint hover:text-brand transition-colors" @click="showRules = !showRules">
            {{ showRules ? '收起规则' : '查看规则' }}
          </button>
        </div>

        <!-- ══════════ 规则说明(与引擎同源) ══════════ -->
        <div v-if="showRules" class="panel px-4 py-3 mt-3 space-y-2">
          <div v-for="r in RULE_SUMMARY" :key="r.label">
            <p class="text-[11px] tracking-[0.14em] text-ink">{{ r.label }}</p>
            <p class="text-[11px] text-ink-faint mt-0.5">{{ r.note }}</p>
            <p class="text-[11px] font-mono text-ink-faint/80 mt-0.5 break-words">
              {{ r.words.join(' · ') }}
            </p>
          </div>
        </div>

        <!-- ══════════ ③ 新词提醒 ══════════ -->
        <div v-if="newWords.length" class="panel px-4 py-3 mt-4 border-l-2 border-accent">
          <p class="text-[12px] text-ink">
            发现 <b class="tabular-nums">{{ newWords.length }}</b> 个全表从未出现过的词
          </p>
          <p class="text-[11px] text-ink-faint mt-1 leading-relaxed">
            它们可能只是新系列带来的噪音,也可能该进黑名单 ——
            规则写在 <code class="font-mono">src/tools/admin/keywords.ts</code>,确认后告诉我改。
          </p>
          <div class="flex flex-wrap gap-1.5 mt-2">
            <span
              v-for="w in newWords"
              :key="w"
              class="text-[11px] px-1.5 py-1 rounded bg-brand-soft text-brand border border-brand-faint"
              >{{ w }}</span
            >
          </div>
        </div>

        <!-- ══════════ ① 可补清单 ══════════ -->
        <div class="flex items-center gap-3 flex-wrap mt-6">
          <h3 class="font-display font-bold text-ink text-[15px]">① 可补</h3>
          <span class="text-[11px] text-ink-faint tabular-nums">
            已选 {{ chosenCount }} / {{ fillable.length }} 张
          </span>
          <span class="flex-1"></span>
          <button class="text-[11px] text-ink-faint hover:text-brand transition-colors" @click="selectAll(true)">
            全选
          </button>
          <button class="text-[11px] text-ink-faint hover:text-brand transition-colors" @click="selectAll(false)">
            全不选
          </button>
        </div>

        <p v-if="!fillable.length" class="text-[12px] text-ink-faint mt-3">
          这个范围内的 {{ rows.length }} 张卡,关键词与正文标记一致,没有需要补的。
        </p>

        <ul v-else class="mt-3 space-y-1.5">
          <li v-for="it in fillable" :key="it.row.id" class="panel px-3.5 py-3">
            <label class="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                class="mt-[3px] shrink-0 accent-[var(--color-brand)]"
                :checked="chosen.has(it.row.id)"
                @change="toggleCard(it.row.id)"
              />
              <div class="min-w-0 flex-1">
                <div class="flex items-baseline gap-2.5 flex-wrap">
                  <span class="font-mono text-[11px] text-ink-faint">{{ it.row.card_no }}</span>
                  <span class="text-[13px] text-ink">{{ it.row.card_name_cn }}</span>
                  <span class="text-[10px] text-ink-faint">{{ it.row.series_name }}</span>
                </div>

                <!-- 将新增的词:点一下即剔除该词 -->
                <div class="flex flex-wrap gap-1.5 mt-2">
                  <button
                    v-for="h in it.add"
                    :key="h.keyword"
                    type="button"
                    class="text-[11px] px-1.5 py-1 rounded border transition-colors"
                    :class="isDropped(it.row.id, h.keyword)
                      ? 'border-card-border text-ink-faint line-through'
                      : h.suspect
                        ? 'border-accent/50 text-accent-ink bg-accent/10'
                        : 'border-brand-faint text-brand bg-brand-soft'"
                    :title="`${h.before}${h.hit}${h.after}`"
                    @click.prevent="toggleWord(it.row.id, h.keyword)"
                  >
                    {{ h.keyword }}
                    <TriangleAlert v-if="h.suspect" class="ml-1" :size="13" aria-hidden="true" />
                  </button>
                </div>

                <!-- 可疑项的上下文摊开显示,不用悬停也能看见 -->
                <div
                  v-for="h in it.add.filter((x) => x.suspect && !isDropped(it.row.id, x.keyword))"
                  :key="`ctx-${h.keyword}`"
                  class="text-[11px] text-ink-faint leading-relaxed mt-1.5 break-words"
                >
                  <TriangleAlert :size="13" aria-hidden="true" /> <b class="font-normal text-ink-muted">{{ h.keyword }}</b>
                  疑似描述他人:{{ h.before }}<b class="font-normal text-ink-muted">{{ h.hit }}</b>{{ h.after }}
                </div>

                <p v-if="it.orphan.length" class="text-[11px] text-ink-faint mt-1.5">
                  文本推不出、不会动:{{ it.orphan.join('、') }}
                </p>
                <p v-if="it.current.length && !it.orphan.length" class="text-[11px] text-ink-faint mt-1.5">
                  已有:{{ it.current.join('、') }}
                </p>
              </div>
            </label>
          </li>
        </ul>

        <!-- ══════════ 写入 ══════════ -->
        <div v-if="fillable.length" class="panel px-4 py-3.5 mt-4 sticky bottom-0">
          <div class="flex items-center justify-between gap-4 flex-wrap">
            <label class="flex items-center gap-2 text-[12px] text-ink-muted">
              <input v-model="publishTogether" type="checkbox" class="accent-[var(--color-brand)]" />
              同时发布(触碰 version.cards)
            </label>
            <div class="flex items-center gap-3">
              <span v-if="progress" class="text-[11px] text-ink-faint tabular-nums">{{ progress }}</span>
              <button
                class="btn-brand px-3.5 py-1.5 text-xs"
                :disabled="writing || !chosenCount"
                @click="commit()"
              >
                {{ writing ? '写入中…' : `写入所选 ${chosenCount} 张` }}
              </button>
            </div>
          </div>
        </div>

        <!-- ══════════ ② 异常清单 ══════════ -->
        <h3 class="font-display font-bold text-ink text-[15px] mt-8">② 异常</h3>
        <p class="text-[11px] text-ink-faint mt-1 leading-relaxed">
          库里有、正文却推不出来的词。多半是人工看提示语或卡图填的(如 ARC-002 凯特琳的「后排」),
          此处只列不改。
        </p>
        <p v-if="!anomalies.length" class="text-[12px] text-ink-faint mt-3">没有异常。</p>
        <ul v-else class="mt-3 space-y-1.5">
          <li
            v-for="it in anomalies"
            :key="it.row.id"
            class="panel px-3.5 py-2.5 flex items-baseline gap-2.5 flex-wrap"
          >
            <span class="font-mono text-[11px] text-ink-faint">{{ it.row.card_no }}</span>
            <span class="text-[13px] text-ink">{{ it.row.card_name_cn }}</span>
            <span class="text-[11px] text-ink-faint">
              库里:{{ it.current.join('、') }}<template v-if="it.hits.length">
                · 文本另有:{{ it.hits.map((h) => h.keyword).join('、') }}</template
              >
            </span>
          </li>
        </ul>
      </template>
    </div>
  </Drawer>
</template>
