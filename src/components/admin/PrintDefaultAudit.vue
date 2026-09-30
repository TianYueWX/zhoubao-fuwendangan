<script setup lang="ts">
/**
 * PrintDefaultAudit.vue · 「重设默认印刷」的计划清单抽屉
 *
 * 规则:每张基础卡的印刷版本里,取 language='SC' 且 extend_rarity_name='平卡'
 * 的那一行,置 is_default=true。判定逻辑全在 src/tools/admin/printDefaults.ts
 * (纯函数、有单测),这里只负责取数、展示、写回。
 *
 * 两条约定:
 *   · **先出清单再写** —— 一次可能写几百行,写之前必须让人看清会动哪些卡、
 *     每张卡选中的是哪一个卡号;
 *   · **只补缺失** —— 已经有默认的卡一律不动(卡牌详情页有手动勾选入口,
 *     强制对齐会把人工选择静默改回去)。已有默认但不是 SC 平卡的,只列进
 *     「跳过」并说明原因。
 */
import { computed, ref, watch } from 'vue';
import Drawer from '../Drawer.vue';
import {
  planPrintDefaults,
  type DefaultPlan,
  type DefaultPlanItem,
  DEFAULT_PRINT_LANGUAGE,
  DEFAULT_PRINT_RARITY
} from '@/tools/admin/printDefaults';
import {
  publishPrints,
  selectAllPrintsForDefault,
  selectCardsForDefaultAudit,
  setDefaultPrints,
  type CardFilter,
  type DefaultAuditCardRow,
  type PrintDefaultRow
} from '@/tools/admin/cards';
import { errorText, notifyError, notifyOk, notifyWarn } from '@/tools/admin/notice';

const props = defineProps<{
  open: boolean;
  /** 只处理这批卡(与列表页同一套筛选语义);不传 = 全表 */
  filter?: CardFilter;
}>();
const emit = defineEmits<{
  (e: 'update:open', v: boolean): void;
  /** 写入成功:让上层刷新(当前无候选值依赖,保留以便扩展) */
  (e: 'applied'): void;
}>();

/* ──────────────────────── 扫描 ──────────────────────── */

const cards = ref<DefaultAuditCardRow[]>([]);
const loading = ref(false);
const error = ref('');

/** 规划结果 */
const plan = ref<DefaultPlan<PrintDefaultRow> | null>(null);

/** 勾选的卡 id(默认全选) */
const chosen = ref<Set<string>>(new Set());

/** 列表很长(不筛选时 800+ 行)时只渲染前若干条,避免抽屉卡顿 */
const RENDER_CAP = 300;
const showAll = ref(false);

const scopeLabel = computed(() => {
  const f = props.filter ?? {};
  const parts: string[] = [];
  if (f.series) parts.push(`系列 ${f.series}`);
  if (f.rarity) parts.push(`稀有度 ${f.rarity}`);
  if (f.search) parts.push(`搜索「${f.search}」`);
  return parts.length ? parts.join(' · ') : '全表(未筛选)';
});

const toWrite = computed(() => plan.value?.toWrite ?? []);
const skipped = computed(() => plan.value?.skipped ?? []);
const alreadyCount = computed(() => plan.value?.already.length ?? 0);

const visibleToWrite = computed(() =>
  showAll.value ? toWrite.value : toWrite.value.slice(0, RENDER_CAP)
);

const chosenCount = computed(() => toWrite.value.filter((i) => chosen.value.has(i.cardId)).length);

async function scan(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const [scopedCards, prints] = await Promise.all([
      selectCardsForDefaultAudit(props.filter ?? {}),
      selectAllPrintsForDefault()
    ]);
    cards.value = scopedCards;
    const next = planPrintDefaults(scopedCards, prints);
    plan.value = next;
    chosen.value = new Set(next.toWrite.map((i) => i.cardId));
    showAll.value = false;
  } catch (e) {
    error.value = errorText(e);
    cards.value = [];
    plan.value = null;
  } finally {
    loading.value = false;
  }
}

/** 打开时扫一次;筛选变了也重扫 —— 与关键词体检同款 */
watch(
  () => [props.open, props.filter?.series, props.filter?.rarity, props.filter?.search] as const,
  ([open]) => {
    if (open) void scan();
  },
  { immediate: true }
);

/* ──────────────────────── 选择 ──────────────────────── */

function toggleCard(cardId: string): void {
  const next = new Set(chosen.value);
  if (next.has(cardId)) next.delete(cardId);
  else next.add(cardId);
  chosen.value = next;
}

function selectAll(v: boolean): void {
  chosen.value = v ? new Set(toWrite.value.map((i) => i.cardId)) : new Set();
}

/* ──────────────────────── 写入 ──────────────────────── */

const writing = ref(false);
const progress = ref('');
const publishTogether = ref(true);

async function commit(): Promise<void> {
  const targets = toWrite.value.filter((i) => chosen.value.has(i.cardId) && i.target);
  if (!targets.length) {
    notifyWarn('没有勾选任何卡');
    return;
  }
  writing.value = true;
  progress.value = `0/${targets.length}`;
  try {
    const res = await setDefaultPrints(
      targets.map((i) => i.target!.id),
      (done, total) => {
        progress.value = `${done}/${total}`;
      }
    );

    if (res.failedIds.length) {
      const failed = new Set(res.failedIds);
      const names = targets
        .filter((i) => failed.has(i.target!.id))
        .slice(0, 3)
        .map((i) => i.cardNo)
        .join('、');
      notifyError(
        `默认印刷写入 ${res.updated} 行成功、${res.failedIds.length} 行失败`,
        `例如 ${names}`
      );
    } else {
      notifyOk(`已置默认 ${res.updated} 行`);
    }

    if (publishTogether.value && !res.failedIds.length) {
      await publishPrints();
      notifyOk('已发布', "version.name='prints' 已触碰");
    }
    await scan();
    emit('applied');
  } catch (e) {
    notifyError(`写入异常:${errorText(e)}`);
  } finally {
    writing.value = false;
    progress.value = '';
  }
}

/** 目标印刷版本的一行摘要 */
function targetText(item: DefaultPlanItem<PrintDefaultRow>): string {
  const t = item.target;
  if (!t) return '—';
  return `${t.card_no_extend ?? '?'}${t.rarity_name ? ` · ${t.rarity_name}` : ''}`;
}
</script>

<template>
  <Drawer :open="open" wide title="重设默认印刷" @update:open="emit('update:open', $event)">
    <div class="text-[13px] text-ink-muted leading-relaxed">
      <p>
        每张基础卡取
        <b class="font-semibold text-ink">{{ DEFAULT_PRINT_LANGUAGE }} + {{ DEFAULT_PRINT_RARITY }}</b>
        的那一行印刷版本置为默认。
        <b class="font-semibold text-ink">只补缺失</b> —— 已经有默认的卡一律不动。
      </p>
      <p class="text-[12px] mt-1.5">
        处理范围:<b class="text-ink">{{ scopeLabel }}</b>
        <span v-if="scopeLabel !== '全表(未筛选)'" class="text-ink-faint">（改列表的筛选条件会重新扫描）</span>
      </p>

      <!-- 扫描中 / 出错 -->
      <div v-if="loading" class="panel px-4 py-3 mt-4 text-[12px] text-ink-faint">
        正在拉取范围内卡牌与全部印刷版本…
      </div>
      <div v-else-if="error" class="panel px-4 py-3 mt-4">
        <p class="text-[12px]" style="color: var(--color-delta-down)">扫描失败:{{ error }}</p>
        <button class="btn-ghost px-3 py-1.5 text-xs mt-2" @click="scan()">重试</button>
      </div>

      <template v-else-if="plan">
        <!-- ══════════ 汇总 ══════════ -->
        <div class="flex items-center gap-5 flex-wrap mt-4 text-[12px]">
          <span>范围内 <b class="text-ink tabular-nums">{{ cards.length }}</b> 张</span>
          <span>待补 <b class="text-ink tabular-nums">{{ toWrite.length }}</b> 张</span>
          <span>已正确 <b class="text-ink tabular-nums">{{ alreadyCount }}</b> 张</span>
          <span :class="skipped.length ? 'text-accent-ink' : ''">
            跳过 <b class="tabular-nums">{{ skipped.length }}</b> 张
          </span>
        </div>

        <!-- ══════════ 待补清单 ══════════ -->
        <div class="flex items-center gap-3 flex-wrap mt-6">
          <h3 class="font-display font-bold text-ink text-[15px]">① 待补</h3>
          <span class="text-[11px] text-ink-faint tabular-nums">
            已选 {{ chosenCount }} / {{ toWrite.length }} 张
          </span>
          <span class="flex-1"></span>
          <button class="text-[11px] text-ink-faint hover:text-brand transition-colors" @click="selectAll(true)">
            全选
          </button>
          <button class="text-[11px] text-ink-faint hover:text-brand transition-colors" @click="selectAll(false)">
            全不选
          </button>
        </div>

        <p v-if="!toWrite.length" class="text-[12px] text-ink-faint mt-3">
          这个范围内的卡都已经有正确的默认印刷版本,没有需要补的。
        </p>

        <ul v-else class="mt-3 space-y-1">
          <li
            v-for="item in visibleToWrite"
            :key="item.cardId"
            class="panel px-3.5 py-2 flex items-baseline gap-2.5 flex-wrap"
          >
            <label class="flex items-baseline gap-2.5 cursor-pointer min-w-0 w-full">
              <input
                type="checkbox"
                class="shrink-0 accent-[var(--color-brand)] translate-y-[2px]"
                :checked="chosen.has(item.cardId)"
                @change="toggleCard(item.cardId)"
              />
              <span class="font-mono text-[11px] text-ink-faint shrink-0">{{ item.cardNo }}</span>
              <span class="text-[13px] text-ink truncate">{{ item.note }}</span>
              <span v-if="item.pickedFromMany" class="text-[10px] text-accent-ink shrink-0">
                多候选
              </span>
              <span class="flex-1"></span>
              <span class="text-[11px] text-ink-faint tabular-nums shrink-0">
                {{ targetText(item) }}
              </span>
            </label>
          </li>
        </ul>

        <div v-if="!showAll && toWrite.length > RENDER_CAP" class="mt-2 text-center">
          <button class="btn-ghost px-3 py-1.5 text-xs" @click="showAll = true">
            还有 {{ toWrite.length - RENDER_CAP }} 张未显示(仍会一起写入) — 展开全部
          </button>
        </div>

        <!-- ══════════ 写入 ══════════ -->
        <div v-if="toWrite.length" class="panel px-4 py-3.5 mt-4 sticky bottom-0">
          <div class="flex items-center justify-between gap-4 flex-wrap">
            <label class="flex items-center gap-2 text-[12px] text-ink-muted">
              <input v-model="publishTogether" type="checkbox" class="accent-[var(--color-brand)]" />
              同时发布(触碰 version.prints)
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

        <!-- ══════════ 跳过清单 ══════════ -->
        <h3 class="font-display font-bold text-ink text-[15px] mt-8">② 跳过</h3>
        <p class="text-[11px] text-ink-faint mt-1 leading-relaxed">
          没有 SC 平卡、或已有默认但不是 SC 平卡的卡。此处只列不改 ——
          需要人工决定的可以到卡片详情页的印刷版本子表里手动勾选。
        </p>
        <p v-if="!skipped.length" class="text-[12px] text-ink-faint mt-3">没有跳过的卡。</p>
        <ul v-else class="mt-3 space-y-1">
          <li
            v-for="item in skipped"
            :key="item.cardId"
            class="panel px-3.5 py-2 flex items-baseline gap-2.5 flex-wrap"
          >
            <span class="font-mono text-[11px] text-ink-faint">{{ item.cardNo }}</span>
            <span class="text-[12px] text-ink-muted">{{ item.note }}</span>
          </li>
        </ul>
      </template>
    </div>
  </Drawer>
</template>
