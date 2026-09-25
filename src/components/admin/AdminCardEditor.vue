<script setup lang="ts">
/**
 * AdminCardEditor.vue · 卡牌校勘(P1)
 *
 * 对应后台「方案 A · 卡牌编辑台」,界面按宣纸档案风重写:
 *   上   检索条(卡号/中英名 · 系列 · 稀有度 · 新建)
 *   左   卡牌列表(服务端分页)
 *   右   详情表单 + 印刷版本子表
 *
 * 沿用后台确立的库约定:
 *   - 所有写操作显式带 updated_at(库中无触发器)
 *   - 保存只提交变更字段,不整行覆盖
 *   - 「保存并发布」= 保存 + 触碰 version.name='cards'
 *   - 删除卡牌先删其印刷版本(外键约束)
 *   - deck_limit 三态:null=默认3张 / 0=不限 / N=限N张
 *   - 效果文本 {{标记}} 实时预览(经白名单过滤,不裸 v-html)
 */
import { computed, onMounted, reactive, ref, watch } from 'vue';
import EditorialShell from './EditorialShell.vue';
import AdminPager from './AdminPager.vue';
import AdminTagInput from './AdminTagInput.vue';
import AdminConfirmButton from './AdminConfirmButton.vue';
import SectionHeading from '../SectionHeading.vue';
import { debounce } from '@/utils/debounce';
import { errorText, notifyError, notifyOk, notifyWarn } from '@/tools/admin/notice';
import { renderEffectPreview, formatTime } from '@/tools/admin/text';
import {
  changedCardFields,
  createCard,
  deleteCard,
  deletePrint,
  getCard,
  insertPrint,
  listCards,
  listPrints,
  loadArrayFieldOptions,
  loadLuaExportRows,
  loadRarityOptions,
  loadSeriesOptions,
  publishCards,
  transferPrint,
  updateCard,
  updatePrint,
  type PrintPayload,
  type SeriesOption
} from '@/tools/admin/cards';
import { buildAllCardsLua } from '@/tools/admin/luaExport';
import { downloadText } from '@/tools/sync/exporters';
import {
  deckLimitLabel,
  deckLimitToMode,
  modeToDeckLimit,
  type CardBase,
  type DeckMode
} from '@/tools/admin/types';

/* ──────────────────────── 列表 ──────────────────────── */

const PAGE_SIZE = 15;

const search = ref('');
const filterSeries = ref('');
const filterRarity = ref('');
const page = ref(1);
const listOpen = ref(true);

const rows = ref<CardBase[]>([]);
const total = ref<number | null>(null);
const listLoading = ref(false);

const seriesOptions = ref<SeriesOption[]>([]);
const rarityOptions = ref<string[]>([]);

/** 数组字段候选值(全表去重),供标签输入器下拉 */
const arrayOptions = reactive<Record<string, string[]>>({
  card_color_list: [],
  region: [],
  tag: [],
  keyword: [],
  advanced_tag: []
});

async function loadList(): Promise<void> {
  listLoading.value = true;
  try {
    const res = await listCards({
      search: search.value,
      series: filterSeries.value,
      rarity: filterRarity.value,
      page: page.value,
      pageSize: PAGE_SIZE
    });
    rows.value = res.rows;
    total.value = res.total;
  } catch (e) {
    notifyError(`加载卡牌列表失败:${errorText(e)}`);
    rows.value = [];
    total.value = null;
  } finally {
    listLoading.value = false;
  }
}

const debouncedSearch = debounce(() => {
  page.value = 1;
  void loadList();
}, 320);

function onFilterChange(): void {
  page.value = 1;
  void loadList();
}

watch(page, () => void loadList());

/* ──────────────────────── 详情表单 ──────────────────────── */

/** 当前选中的卡牌 id */
const selectedId = ref<string | null>(null);

/** 当前选中卡牌的完整行,与载入时的快照 —— 两者相比得出变更字段 */
const original = ref<CardBase | null>(null);
const form = ref<CardBase | null>(null);
const detailLoading = ref(false);
const saving = ref(false);

const effectTab = ref<'cn' | 'en'>('cn');
const flavorOpen = ref(false);

const deckMode = ref<DeckMode>('default');
const deckN = ref(1);

const dirtyFields = computed<Record<string, unknown>>(() => {
  if (!original.value || !form.value) return {};
  return changedCardFields(original.value, form.value);
});
const isDirty = computed(() => Object.keys(dirtyFields.value).length > 0);
const dirtyKeys = computed(() => Object.keys(dirtyFields.value));

async function selectCard(id: string): Promise<void> {
  if (isDirty.value) {
    notifyWarn('当前卡牌有未保存的修改,已切换;如需保留请先保存。');
  }
  selectedId.value = id;
  detailLoading.value = true;
  try {
    const card = await getCard(id);
    if (!card) {
      notifyError('该卡牌已不存在,可能已被删除');
      await loadList();
      return;
    }
    original.value = JSON.parse(JSON.stringify(card)) as CardBase;
    form.value = JSON.parse(JSON.stringify(card)) as CardBase;
    deckMode.value = deckLimitToMode(card.deck_limit);
    deckN.value = card.deck_limit && card.deck_limit > 0 ? card.deck_limit : 1;
    effectTab.value = 'cn';
    await loadPrintRows(id);
  } catch (e) {
    notifyError(`加载卡牌详情失败:${errorText(e)}`);
  } finally {
    detailLoading.value = false;
  }
}

/** deck_limit 由三态控件推导,写回 form(这样变更检测能看见它) */
watch([deckMode, deckN], () => {
  if (form.value) form.value.deck_limit = modeToDeckLimit(deckMode.value, deckN.value);
});

const effectPreview = computed(() => {
  if (!form.value) return '';
  const text = effectTab.value === 'cn' ? form.value.effect_cn : form.value.effect_en;
  return renderEffectPreview(text);
});

async function save(publish: boolean): Promise<void> {
  if (!form.value || !selectedId.value) return;
  const patch = dirtyFields.value;
  if (!Object.keys(patch).length && !publish) {
    notifyOk('没有需要保存的改动');
    return;
  }
  saving.value = true;
  try {
    if (Object.keys(patch).length) {
      const updated = await updateCard(selectedId.value, patch);
      if (!updated.length) {
        // PostgREST 在 RLS 拒绝时不报错、只返回 0 行 —— 必须显式识别
        throw new Error('未被写入(0 行受影响):账号可能不是管理员,或该行已被删除');
      }
      original.value = JSON.parse(JSON.stringify(form.value)) as CardBase;
    }
    if (publish) {
      await publishCards();
      notifyOk('已保存并发布', 'version.cards 时间戳已更新,站内客户端将重新拉取卡表');
    } else {
      notifyOk(`已保存${Object.keys(patch).length ? `(${dirtyKeys.value.length} 个字段)` : ''}`);
    }
    await loadList();
  } catch (e) {
    const msg = errorText(e);
    notifyError(
      `保存失败:${msg}`,
      /权限|0 行/.test(msg) ? '请确认账号 app_metadata.role = admin,且已执行 supabase/admin-setup.sql' : undefined
    );
  } finally {
    saving.value = false;
  }
}

const deleting = ref(false);

async function removeCard(): Promise<void> {
  if (!selectedId.value) return;
  deleting.value = true;
  try {
    await deleteCard(selectedId.value);
    notifyOk('卡牌及其全部印刷版本已删除');
    original.value = null;
    form.value = null;
    selectedId.value = null;
    prints.value = [];
    await loadList();
  } catch (e) {
    notifyError(`删除失败:${errorText(e)}`);
  } finally {
    deleting.value = false;
  }
}

const creating = ref(false);

async function addCard(): Promise<void> {
  creating.value = true;
  try {
    const created = await createCard();
    notifyOk('已新建空白卡牌,请完善卡号与名称', `占位卡号 ${created.card_no}`);
    page.value = 1;
    await loadList();
    await selectCard(created.id);
  } catch (e) {
    notifyError(`新建失败:${errorText(e)}`);
  } finally {
    creating.value = false;
  }
}

/* ──────────────────────── 印刷版本子表 ──────────────────────── */

type PrintRow = PrintPayload;

const prints = ref<PrintRow[]>([]);
const printsLoading = ref(false);
const printBusy = ref<string | null>(null);

async function loadPrintRows(cardId: string): Promise<void> {
  printsLoading.value = true;
  try {
    prints.value = await listPrints(cardId);
  } catch (e) {
    notifyError(`加载印刷版本失败:${errorText(e)}`);
    prints.value = [];
  } finally {
    printsLoading.value = false;
  }
}

function addPrintRow(): void {
  if (!selectedId.value) return;
  prints.value = [
    ...prints.value,
    {
      id: null,
      card_id: selectedId.value,
      card_no_extend: '',
      rarity_name: null,
      extend_rarity_name: null,
      language: 'SC',
      artist: null,
      img_cdn: null,
      tts_cdn: null,
      back_image: null,
      print_order: prints.value.length + 1,
      is_default: false,
      is_promo: false,
      series: null,
      flavor_text_cn: null,
      flavor_text_en: null
    }
  ];
}

/** 系列代码 → 中文名(用于「继承」选项的展示) */
function seriesLabel(code: string | null | undefined): string {
  if (!code) return '';
  return seriesOptions.value.find((s) => s.code === code)?.name_cn || code;
}

function dropDraftRow(row: PrintRow): void {
  prints.value = prints.value.filter((p) => p !== row);
}

async function savePrintRow(row: PrintRow): Promise<void> {
  if (!selectedId.value) return;
  printBusy.value = row.id ?? 'new';
  try {
    if (row.id) {
      const out = await updatePrint(row.id, row);
      if (!out.length) throw new Error('未被写入(0 行受影响)');
      notifyOk(`印刷版本 ${row.card_no_extend || ''} 已更新`);
    } else {
      await insertPrint(selectedId.value, row);
      notifyOk('印刷版本已新增');
      await loadPrintRows(selectedId.value);
    }
  } catch (e) {
    notifyError(`保存印刷版本失败:${errorText(e)}`);
  } finally {
    printBusy.value = null;
  }
}

async function removePrintRow(row: PrintRow): Promise<void> {
  if (!row.id) {
    dropDraftRow(row);
    return;
  }
  printBusy.value = row.id;
  try {
    const out = await deletePrint(row.id);
    if (!out.length) throw new Error('未被删除(0 行受影响)');
    notifyOk('印刷版本已删除');
    if (selectedId.value) await loadPrintRows(selectedId.value);
  } catch (e) {
    notifyError(`删除失败:${errorText(e)}`);
  } finally {
    printBusy.value = null;
  }
}

/* ──────────────────────── 转移绑定 ──────────────────────── */

const transferOpen = ref(false);
const transferTarget = ref<PrintRow | null>(null);
const transferQuery = ref('');
const transferCandidates = ref<CardBase[]>([]);
const transferTargetId = ref('');
const transferLoading = ref(false);

const searchTransferCandidates = debounce(async () => {
  transferLoading.value = true;
  try {
    const res = await listCards({ search: transferQuery.value, page: 1, pageSize: 20 });
    // 排除当前卡牌自身
    transferCandidates.value = res.rows.filter((c) => c.id !== selectedId.value);
  } catch (e) {
    notifyError(`搜索目标卡牌失败:${errorText(e)}`);
  } finally {
    transferLoading.value = false;
  }
}, 320);

async function openTransfer(row: PrintRow): Promise<void> {
  if (!row.id) {
    notifyWarn('请先保存该印刷版本,再执行转移');
    return;
  }
  transferTarget.value = row;
  transferQuery.value = '';
  transferTargetId.value = '';
  transferOpen.value = true;
  await searchTransferCandidates();
}

async function confirmTransfer(): Promise<void> {
  const row = transferTarget.value;
  if (!row?.id || !transferTargetId.value) return;
  transferLoading.value = true;
  try {
    const out = await transferPrint(row.id, transferTargetId.value);
    if (!out.length) throw new Error('未被写入(0 行受影响)');
    notifyOk('印刷版本已转移到目标卡牌');
    transferOpen.value = false;
    if (selectedId.value) await loadPrintRows(selectedId.value);
  } catch (e) {
    notifyError(`转移失败:${errorText(e)}`);
  } finally {
    transferLoading.value = false;
  }
}

/* ──────────────────────── 导出 TTS Lua ──────────────────────── */

/** 导出的 Lua 文本块与面板开关 */
const luaOpen = ref(false);
const luaLoading = ref(false);
const luaText = ref('');
const luaMeta = ref<{ total: number; skippedNoBase: number; skippedNoCardNo: number } | null>(null);
const luaCopied = ref(false);
const luaBox = ref<HTMLTextAreaElement | null>(null);
let luaCopiedTimer: number | undefined;

const luaNote = computed(() => {
  if (!luaMeta.value) return '';
  const parts = [`共 ${luaMeta.value.total} 条`];
  if (luaMeta.value.skippedNoBase) parts.push(`跳过无基础卡 ${luaMeta.value.skippedNoBase} 条`);
  if (luaMeta.value.skippedNoCardNo) parts.push(`跳过缺卡号 ${luaMeta.value.skippedNoCardNo} 条`);
  return parts.join(' · ');
});

/** 拉全量卡表(SC 印刷版)→ 生成 all_cards Lua 文本 */
async function generateLua(): Promise<void> {
  luaLoading.value = true;
  try {
    const { cards, prints } = await loadLuaExportRows();
    const result = buildAllCardsLua(cards, prints);
    luaText.value = result.text;
    luaMeta.value = {
      total: result.total,
      skippedNoBase: result.skippedNoBase,
      skippedNoCardNo: result.skippedNoCardNo
    };
    luaOpen.value = true;
    notifyOk(`已生成 ${result.total} 条 TTS 卡牌数据`);
  } catch (e) {
    notifyError(`导出 TTS Lua 失败:${errorText(e)}`);
  } finally {
    luaLoading.value = false;
  }
}

async function copyLua(): Promise<void> {
  if (!luaText.value) return;
  try {
    await navigator.clipboard.writeText(luaText.value);
    luaCopied.value = true;
    if (luaCopiedTimer) window.clearTimeout(luaCopiedTimer);
    luaCopiedTimer = window.setTimeout(() => (luaCopied.value = false), 1500);
  } catch {
    // 剪贴板 API 需要安全上下文,失败时全选让用户手动复制
    luaBox.value?.focus();
    luaBox.value?.select();
    notifyWarn('复制失败:已全选,请按 Ctrl/Cmd+C');
  }
}

function downloadLua(): void {
  if (!luaText.value) return;
  downloadText('all_cards.lua', luaText.value, 'text/x-lua');
}

/* ──────────────────────── 启动 ──────────────────────── */

onMounted(async () => {
  await loadList();
  try {
    const [series, rarities] = await Promise.all([loadSeriesOptions(), loadRarityOptions()]);
    seriesOptions.value = series;
    rarityOptions.value = rarities;
  } catch (e) {
    notifyWarn(`筛选项加载失败:${errorText(e)}`);
  }
  // 数组字段候选值:逐列去重(5 次轻量请求)
  const fields = ['card_color_list', 'region', 'tag', 'keyword', 'advanced_tag'] as const;
  for (const f of fields) {
    try {
      arrayOptions[f] = await loadArrayFieldOptions(f);
    } catch {
      /* 候选值拿不到不影响手输,静默 */
    }
  }
});
</script>

<template>
  <EditorialShell code="editorial-cards">
    <div class="max-w-[1720px] mx-auto">
      <!-- ══════════ 刊头 ══════════ -->
      <header class="mb-7">
        <h1 class="font-display font-black text-ink leading-tight text-[28px] lg:text-[38px]">
          卡牌校勘
        </h1>
        <div class="hairline mt-7"></div>
      </header>

      <!-- ══════════ 检索条 ══════════ -->
      <div class="flex items-center gap-2.5 flex-wrap mb-6">
        <input
          v-model="search"
          placeholder="卡号 / 中文名 / 英文名"
          class="filter-select w-[240px]"
          @input="debouncedSearch"
        />
        <select v-model="filterSeries" class="filter-select w-[150px]" @change="onFilterChange">
          <option value="">全部系列</option>
          <option v-for="s in seriesOptions" :key="s.code" :value="s.code">
            {{ s.name_cn || s.code }}
          </option>
        </select>
        <select v-model="filterRarity" class="filter-select w-[140px]" @change="onFilterChange">
          <option value="">全部稀有度</option>
          <option v-for="r in rarityOptions" :key="r" :value="r">{{ r }}</option>
        </select>

        <span class="flex-1"></span>

        <span class="text-[11px] text-ink-faint tabular-nums">
          {{ total === null ? '' : `${total} 张` }}
        </span>
        <button
          type="button"
          class="btn-ghost px-3 py-1.5 text-xs"
          :aria-expanded="listOpen"
          aria-controls="card-list-panel"
          :title="listOpen ? '收起卡牌列表，腾出更多校勘空间' : '展开卡牌列表'"
          @click="listOpen = !listOpen"
        >
          {{ listOpen ? '收起列表' : '展开列表' }}
        </button>
        <button class="btn-ghost px-3 py-1.5 text-xs" :disabled="listLoading" @click="loadList">
          刷新
        </button>
        <button
          type="button"
          class="btn-ghost px-3 py-1.5 text-xs"
          :disabled="luaLoading"
          :aria-expanded="luaOpen"
          aria-controls="lua-export-panel"
          title="把库中 SC 印刷版卡表生成为 TTS mod 的 all_cards Lua 数据块"
          @click="generateLua"
        >
          {{ luaLoading ? '生成中…' : '导出 TTS Lua' }}
        </button>
        <button class="btn-brand px-3 py-1.5 text-xs" :disabled="creating" @click="addCard">
          {{ creating ? '新建中…' : '新增卡牌' }}
        </button>
      </div>

      <!-- ══════════ 导出 TTS Lua ══════════ -->
      <section v-show="luaOpen" id="lua-export-panel" class="card p-4 mb-6">
        <SectionHeading plain small title="导出 TTS Lua" :note="luaNote" />
        <div class="flex items-center gap-2 flex-wrap mb-3">
          <button class="btn-brand px-3 py-1.5 text-xs" @click="copyLua">
            {{ luaCopied ? '已复制' : '复制全文' }}
          </button>
          <button class="btn-ghost px-3 py-1.5 text-xs" @click="downloadLua">
            下载 all_cards.lua
          </button>
          <button
            class="btn-ghost px-3 py-1.5 text-xs"
            :disabled="luaLoading"
            @click="generateLua"
          >
            {{ luaLoading ? '生成中…' : '重新生成' }}
          </button>
          <span class="flex-1"></span>
          <span v-if="luaText" class="text-[11px] text-ink-faint tabular-nums">
            {{ luaText.length.toLocaleString() }} 字符
          </span>
          <button class="btn-ghost px-3 py-1.5 text-xs" @click="luaOpen = false">关闭</button>
        </div>
        <textarea
          ref="luaBox"
          :value="luaText"
          readonly
          spellcheck="false"
          aria-label="TTS Lua 数据"
          class="w-full h-[420px] font-mono text-[11px] leading-relaxed bg-transparent border border-card-border rounded-lg p-3 text-ink resize-y"
        ></textarea>
      </section>

      <!-- ══════════ 主从布局 ══════════ -->
      <div
        class="grid grid-cols-1"
        :class="listOpen ? 'xl:grid-cols-[minmax(0,3fr)_minmax(0,7fr)] xl:divide-x xl:divide-panel-border' : ''"
      >
        <!-- ───── 左:卡牌列表 ───── -->
        <aside v-show="listOpen" id="card-list-panel" class="xl:pr-8">
          <SectionHeading plain small title="卡牌列表" :note="`每页 ${PAGE_SIZE} 张 · 服务端分页`" />

          <div class="border border-card-border rounded-xl overflow-hidden">
            <div class="max-h-[540px] overflow-y-auto" :class="{ 'opacity-50': listLoading }">
              <button
                v-for="c in rows"
                :key="c.id"
                class="w-full text-left px-3 py-2.5 border-b border-panel-border/40 last:border-0 transition-colors"
                :class="c.id === selectedId ? 'bg-brand-soft' : 'table-row'"
                @click="selectCard(c.id)"
              >
                <div class="flex items-baseline gap-2 min-w-0">
                  <span class="font-mono text-[11px] text-ink-faint shrink-0">{{ c.card_no }}</span>
                  <span
                    class="text-[13px] truncate"
                    :class="c.id === selectedId ? 'text-brand font-semibold' : 'text-ink'"
                  >
                    {{ c.card_name_cn || c.card_name_en || '（未命名）' }}
                  </span>
                </div>
                <div class="flex items-center gap-2.5 mt-1">
                  <span v-if="c.is_banned" class="text-[10px] text-brand border border-brand-faint rounded px-1">
                    禁用
                  </span>
                  <span
                    v-else-if="c.deck_limit !== null"
                    class="text-[10px] text-accent"
                  >
                    {{ deckLimitLabel(c.deck_limit) }}
                  </span>
                  <span v-if="c.energy !== null" class="text-[10px] text-ink-faint tabular-nums">
                    能量 {{ c.energy }}
                  </span>
                </div>
              </button>

              <p v-if="!listLoading && !rows.length" class="px-3 py-8 text-center text-xs text-ink-faint">
                没有匹配的卡牌
              </p>
            </div>
          </div>

          <div class="mt-3">
            <AdminPager
              v-model:page="page"
              :page-size="PAGE_SIZE"
              :total="total"
              :disabled="listLoading"
            />
          </div>
        </aside>

        <!-- ───── 右:详情 + 印刷版本 ───── -->
        <section class="min-w-0" :class="listOpen ? 'pt-8 xl:pt-0 xl:pl-8' : ''">
          <p v-if="detailLoading" class="text-sm text-ink-faint py-16 text-center">载入中…</p>

          <template v-else-if="form">
            <!-- 详情头 -->
            <div class="flex items-start justify-between gap-4 flex-wrap mb-6">
              <div class="min-w-0">
                <h2 class="font-display font-bold text-ink text-xl truncate">
                  {{ form.card_name_cn || form.card_name_en || '（未命名）' }}
                  <span class="font-mono text-[12px] text-ink-faint font-normal ml-2">
                    {{ form.card_no }}
                  </span>
                </h2>
                <p class="text-[11px] text-ink-faint mt-1 tabular-nums">
                  最后更新 {{ formatTime(form.updated_at) }}
                  <span v-if="isDirty" class="text-accent ml-2">
                    · {{ dirtyKeys.length }} 个字段待保存
                  </span>
                </p>
              </div>
              <div class="flex items-center gap-3 shrink-0">
                <AdminConfirmButton
                  label="删除卡牌"
                  confirm-label="确认删除卡牌及其印刷版本"
                  :disabled="deleting"
                  @confirm="removeCard"
                />
                <button
                  class="btn-ghost px-3 py-1.5 text-xs"
                  :disabled="saving || !isDirty"
                  @click="save(false)"
                >
                  {{ saving ? '保存中…' : '保存修改' }}
                </button>
                <button
                  class="btn-brand px-3 py-1.5 text-xs"
                  :disabled="saving"
                  @click="save(true)"
                >
                  保存并发布
                </button>
              </div>
            </div>

            <!-- 基础字段 -->
            <SectionHeading plain small title="名称与编号" />
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 mb-2">
              <label class="block">
                <span class="text-[11px] tracking-[0.14em] text-ink-faint">卡号</span>
                <input v-model="form.card_no" class="filter-select w-full mt-1.5 font-mono" />
              </label>
              <label class="block">
                <span class="text-[11px] tracking-[0.14em] text-ink-faint">冠军标</span>
                <input v-model="form.champion_tag" class="filter-select w-full mt-1.5" />
              </label>
              <label class="block">
                <span class="text-[11px] tracking-[0.14em] text-ink-faint">中文名</span>
                <input v-model="form.card_name_cn" class="filter-select w-full mt-1.5" />
              </label>
              <label class="block">
                <span class="text-[11px] tracking-[0.14em] text-ink-faint">英文名</span>
                <input v-model="form.card_name_en" class="filter-select w-full mt-1.5" />
              </label>
              <label class="block">
                <span class="text-[11px] tracking-[0.14em] text-ink-faint">中文副题</span>
                <input v-model="form.sub_title_cn" class="filter-select w-full mt-1.5" />
              </label>
              <label class="block">
                <span class="text-[11px] tracking-[0.14em] text-ink-faint">英文副题</span>
                <input v-model="form.sub_title_en" class="filter-select w-full mt-1.5" />
              </label>
            </div>

            <div class="hairline my-6"></div>

            <!-- 数值与分类 -->
            <SectionHeading plain small title="数值与分类" />
            <div class="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-x-5 gap-y-4 mb-2">
              <label class="block">
                <span class="text-[11px] tracking-[0.14em] text-ink-faint">能量</span>
                <input v-model.number="form.energy" type="number" min="0" class="filter-select w-full mt-1.5 tabular-nums" />
              </label>
              <label class="block">
                <span class="text-[11px] tracking-[0.14em] text-ink-faint">返还能量</span>
                <input v-model.number="form.return_energy" type="number" min="0" class="filter-select w-full mt-1.5 tabular-nums" />
              </label>
              <label class="block">
                <span class="text-[11px] tracking-[0.14em] text-ink-faint">战力</span>
                <input v-model.number="form.power" type="number" min="0" class="filter-select w-full mt-1.5 tabular-nums" />
              </label>
              <label class="block">
                <span class="text-[11px] tracking-[0.14em] text-ink-faint">稀有度</span>
                <select v-model="form.rarity_name" class="filter-select w-full mt-1.5">
                  <option :value="null">—</option>
                  <option v-for="r in rarityOptions" :key="r" :value="r">{{ r }}</option>
                </select>
              </label>
              <label class="block">
                <span class="text-[11px] tracking-[0.14em] text-ink-faint">所属系列</span>
                <select v-model="form.series_name" class="filter-select w-full mt-1.5">
                  <option :value="null">—</option>
                  <option v-for="s in seriesOptions" :key="s.code" :value="s.code">
                    {{ s.name_cn || s.code }}
                  </option>
                </select>
              </label>
            </div>

            <div class="hairline my-6"></div>

            <!-- 数组字段 -->
            <SectionHeading
              plain
              small
              title="分类标记"
              note="下拉可选全表已出现过的值,也可直接输入回车新建"
            />
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 mb-2">
              <div>
                <span class="text-[11px] tracking-[0.14em] text-ink-faint">颜色</span>
                <div class="mt-1.5">
                  <AdminTagInput v-model="form.card_color_list" :options="arrayOptions.card_color_list" placeholder="如 紫、蓝" />
                </div>
              </div>
              <div>
                <span class="text-[11px] tracking-[0.14em] text-ink-faint">地区</span>
                <div class="mt-1.5">
                  <AdminTagInput v-model="form.region" :options="arrayOptions.region" placeholder="如 巨神峰" />
                </div>
              </div>
              <div>
                <span class="text-[11px] tracking-[0.14em] text-ink-faint">标签</span>
                <div class="mt-1.5">
                  <AdminTagInput v-model="form.tag" :options="arrayOptions.tag" />
                </div>
              </div>
              <div>
                <span class="text-[11px] tracking-[0.14em] text-ink-faint">关键词</span>
                <div class="mt-1.5">
                  <AdminTagInput v-model="form.keyword" :options="arrayOptions.keyword" />
                </div>
              </div>
              <div class="sm:col-span-2">
                <span class="text-[11px] tracking-[0.14em] text-ink-faint">高级标签</span>
                <div class="mt-1.5">
                  <AdminTagInput v-model="form.advanced_tag" :options="arrayOptions.advanced_tag" />
                </div>
              </div>
            </div>

            <div class="hairline my-6"></div>

            <!-- 禁限控制 -->
            <SectionHeading plain small title="禁限与构筑上限" />
            <div class="flex items-center gap-6 flex-wrap mb-2">
              <div class="flex items-center gap-2.5">
                <span class="text-[11px] tracking-[0.14em] text-ink-faint">禁用</span>
                <div class="flex rounded-lg overflow-hidden border border-card-border">
                  <button
                    class="px-3 py-1.5 text-xs transition-colors"
                    :class="!form.is_banned ? 'tab-active' : 'text-ink-muted hover:text-brand'"
                    @click="form.is_banned = false"
                  >
                    启用
                  </button>
                  <button
                    class="px-3 py-1.5 text-xs transition-colors border-l border-card-border"
                    :class="form.is_banned ? 'tab-active' : 'text-ink-muted hover:text-brand'"
                    @click="form.is_banned = true"
                  >
                    禁用
                  </button>
                </div>
              </div>

              <div class="flex items-center gap-2.5">
                <span class="text-[11px] tracking-[0.14em] text-ink-faint">构筑上限</span>
                <div class="flex rounded-lg overflow-hidden border border-card-border">
                  <button
                    v-for="opt in ([
                      { id: 'default', label: '默认 3 张' },
                      { id: 'unlimited', label: '不限' },
                      { id: 'limited', label: '限 N 张' }
                    ] as const)"
                    :key="opt.id"
                    class="px-3 py-1.5 text-xs transition-colors border-l border-card-border first:border-l-0"
                    :class="deckMode === opt.id ? 'tab-active' : 'text-ink-muted hover:text-brand'"
                    @click="deckMode = opt.id"
                  >
                    {{ opt.label }}
                  </button>
                </div>
                <input
                  v-if="deckMode === 'limited'"
                  v-model.number="deckN"
                  type="number"
                  min="1"
                  class="filter-select w-[70px] tabular-nums"
                />
                <span class="text-[11px] text-ink-faint">当前:{{ deckLimitLabel(form.deck_limit) }}</span>
              </div>
            </div>

            <div class="hairline my-6"></div>

            <!-- 效果文本 -->
            <SectionHeading
              plain
              small
              title="效果文本"
              note="支持 {{标记}} 内联标签;预览经标签白名单过滤,不会执行库中的脚本"
            />
            <div class="flex rounded-lg overflow-hidden border border-card-border w-fit mb-3">
              <button
                v-for="t in ([
                  { id: 'cn', label: '中文效果' },
                  { id: 'en', label: '英文效果' }
                ] as const)"
                :key="t.id"
                class="px-3.5 py-1.5 text-xs transition-colors border-l border-card-border first:border-l-0"
                :class="effectTab === t.id ? 'tab-active' : 'text-ink-muted hover:text-brand'"
                @click="effectTab = t.id"
              >
                {{ t.label }}
              </button>
            </div>
            <textarea
              v-if="effectTab === 'cn'"
              v-model="form.effect_cn"
              rows="4"
              class="filter-select w-full font-mono text-[12.5px] leading-relaxed"
              placeholder="支持 {{标记}} 内联效果标签"
            ></textarea>
            <textarea
              v-else
              v-model="form.effect_en"
              rows="4"
              class="filter-select w-full font-mono text-[12.5px] leading-relaxed"
              placeholder="可含 <p> 等段落标签"
            ></textarea>

            <div v-if="effectPreview" class="mt-3 border border-dashed border-card-border rounded-lg p-3 bg-panel-bg">
              <p class="text-[10px] tracking-[0.16em] text-ink-faint mb-2">渲染预览</p>
              <div class="effect-preview text-[13px] leading-relaxed text-ink" v-html="effectPreview"></div>
            </div>

            <!-- 风味文本 -->
            <div class="mt-6">
              <button
                class="text-[12px] text-ink-faint hover:text-brand transition-colors"
                @click="flavorOpen = !flavorOpen"
              >
                {{ flavorOpen ? '▾' : '▸' }} 风味文本
              </button>
              <div v-if="flavorOpen" class="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
                <textarea v-model="form.flavor_text_cn" rows="3" class="filter-select w-full" placeholder="中文风味文本"></textarea>
                <textarea v-model="form.flavor_text_en" rows="3" class="filter-select w-full" placeholder="英文风味文本"></textarea>
              </div>
            </div>

            <!-- ══════════ 印刷版本子表 ══════════ -->
            <div class="mt-10">
              <SectionHeading
                plain
                small
                :title="`印刷版本（${prints.length}）`"
                note="每行独立保存;新增行需先保存才能转移绑定"
              >
                <template #actions>
                  <button class="btn-ghost px-3 py-1.5 text-xs" @click="addPrintRow">新增印刷版本</button>
                </template>
              </SectionHeading>

              <div class="border border-card-border rounded-xl overflow-x-auto">
                <table class="w-full text-sm min-w-[1440px]">
                  <thead class="sticky-thead text-[11px] text-ink-faint">
                    <tr class="border-b border-card-border">
                      <th class="text-left font-normal px-2.5 py-2 w-[130px]">扩展编号</th>
                      <th class="text-left font-normal px-2.5 py-2 w-[100px]">稀有度</th>
                      <th class="text-left font-normal px-2.5 py-2 w-[110px]">扩展稀有度</th>
                      <th class="text-left font-normal px-2.5 py-2 w-[130px]">系列</th>
                      <th class="text-left font-normal px-2.5 py-2 w-[80px]">语言</th>
                      <th class="text-left font-normal px-2.5 py-2 w-[110px]">画师</th>
                      <th class="text-left font-normal px-2.5 py-2 min-w-[160px]">图片 CDN</th>
                      <th class="text-left font-normal px-2.5 py-2 min-w-[180px]">中文风味</th>
                      <th class="text-left font-normal px-2.5 py-2 min-w-[180px]">英文风味</th>
                      <th class="text-right font-normal px-2.5 py-2 w-[70px]">排序</th>
                      <th class="text-center font-normal px-2.5 py-2 w-[60px]">默认</th>
                      <th class="text-center font-normal px-2.5 py-2 w-[60px]">Promo</th>
                      <th class="text-right font-normal px-2.5 py-2 w-[150px]">操作</th>
                    </tr>
                  </thead>
                  <tbody :class="{ 'opacity-50': printsLoading }">
                    <tr
                      v-for="row in prints"
                      :key="row.id ?? 'draft'"
                      class="table-row border-b border-panel-border/30 last:border-0"
                    >
                      <td class="px-2.5 py-1.5">
                        <input v-model="row.card_no_extend" class="filter-select w-full font-mono" placeholder="OGN-300*" />
                      </td>
                      <td class="px-2.5 py-1.5">
                        <input v-model="row.rarity_name" class="filter-select w-full" />
                      </td>
                      <td class="px-2.5 py-1.5">
                        <input v-model="row.extend_rarity_name" class="filter-select w-full" placeholder="异画/超编" />
                      </td>
                      <td class="px-2.5 py-1.5">
                        <select
                          v-model="row.series"
                          class="filter-select w-full"
                          :title="row.series ? `覆盖：${seriesLabel(row.series)}` : '继承基础卡系列'"
                        >
                          <option :value="null">
                            继承 · {{ seriesLabel(form?.series_name) || '—' }}
                          </option>
                          <option v-for="s in seriesOptions" :key="s.code" :value="s.code">
                            {{ s.name_cn || s.code }}
                          </option>
                        </select>
                      </td>
                      <td class="px-2.5 py-1.5">
                        <select v-model="row.language" class="filter-select w-full">
                          <option value="SC">SC</option>
                          <option value="EN">EN</option>
                        </select>
                      </td>
                      <td class="px-2.5 py-1.5">
                        <input v-model="row.artist" class="filter-select w-full" />
                      </td>
                      <td class="px-2.5 py-1.5">
                        <input v-model="row.img_cdn" class="filter-select w-full" :title="row.img_cdn ?? ''" />
                      </td>
                      <td class="px-2.5 py-1.5">
                        <input
                          v-model="row.flavor_text_cn"
                          class="filter-select w-full"
                          :placeholder="`继承：${form?.flavor_text_cn || '—'}`"
                          :title="row.flavor_text_cn || `继承基础卡：${form?.flavor_text_cn || '—'}`"
                        />
                      </td>
                      <td class="px-2.5 py-1.5">
                        <input
                          v-model="row.flavor_text_en"
                          class="filter-select w-full"
                          :placeholder="`继承：${form?.flavor_text_en || '—'}`"
                          :title="row.flavor_text_en || `继承基础卡：${form?.flavor_text_en || '—'}`"
                        />
                      </td>
                      <td class="px-2.5 py-1.5">
                        <input v-model.number="row.print_order" type="number" class="filter-select w-full text-right tabular-nums" />
                      </td>
                      <td class="px-2.5 py-1.5 text-center">
                        <input v-model="row.is_default" type="checkbox" class="accent-[var(--color-brand)]" />
                      </td>
                      <td class="px-2.5 py-1.5 text-center">
                        <input v-model="row.is_promo" type="checkbox" class="accent-[var(--color-brand)]" />
                      </td>
                      <td class="px-2.5 py-1.5">
                        <div class="flex items-center justify-end gap-3">
                          <button
                            class="text-[12px] text-brand hover:underline disabled:opacity-40"
                            :disabled="printBusy === (row.id ?? 'new')"
                            @click="savePrintRow(row)"
                          >
                            {{ row.id ? '保存' : '新增' }}
                          </button>
                          <button
                            class="text-[12px] text-ink-faint hover:text-brand transition-colors disabled:opacity-40"
                            :disabled="!row.id"
                            :title="row.id ? '转移到另一张卡牌' : '请先保存'"
                            @click="openTransfer(row)"
                          >
                            转移
                          </button>
                          <AdminConfirmButton
                            label="删除"
                            confirm-label="确认删除"
                            :disabled="printBusy === (row.id ?? 'new')"
                            @confirm="removePrintRow(row)"
                          />
                        </div>
                      </td>
                    </tr>
                    <tr v-if="!prints.length && !printsLoading">
                      <td colspan="13" class="px-3 py-6 text-center text-xs text-ink-faint">
                        该卡牌暂无印刷版本
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </template>

          <!-- 未选卡牌 -->
          <div v-else class="py-20 text-center">
            <p class="text-sm text-ink-faint">在左侧选择一张卡牌开始校勘</p>
            <p class="text-[11px] text-ink-faint mt-2">或点击上方「新增卡牌」创建空白条目</p>
          </div>
        </section>
      </div>
    </div>

    <!-- ══════════ 转移绑定抽屉 ══════════ -->
    <Teleport to="body">
      <div v-if="transferOpen" class="fixed inset-0 z-[90] flex justify-end">
        <div class="absolute inset-0 bg-ink/35 backdrop-blur-sm" @click="transferOpen = false"></div>
        <div
          class="relative h-full w-full max-w-lg overflow-y-auto"
          :style="{ background: 'var(--color-drawer-bg)' }"
        >
          <div
            class="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b border-panel-border"
            :style="{ background: 'var(--color-drawer-bg)' }"
          >
            <h3 class="font-display font-bold text-ink">转移绑定卡牌</h3>
            <button
              class="w-8 h-8 rounded-lg hover:bg-ink/5 text-ink-faint hover:text-brand transition-colors"
              @click="transferOpen = false"
            >
              ✕
            </button>
          </div>

          <div class="p-5">
            <p class="text-[13px] text-ink-muted leading-relaxed">
              把印刷版本
              <b class="font-mono text-ink">{{ transferTarget?.card_no_extend || '（未命名）' }}</b>
              改绑到另一张卡牌。原卡牌将不再包含该印刷版本。
            </p>

            <input
              v-model="transferQuery"
              placeholder="搜索目标卡号 / 中英文名"
              class="filter-select w-full mt-5"
              @input="searchTransferCandidates"
            />

            <div class="mt-4 border border-card-border rounded-xl overflow-hidden max-h-[420px] overflow-y-auto">
              <button
                v-for="c in transferCandidates"
                :key="c.id"
                class="w-full text-left px-3 py-2.5 border-b border-panel-border/40 last:border-0 transition-colors"
                :class="c.id === transferTargetId ? 'bg-brand-soft' : 'table-row'"
                @click="transferTargetId = c.id"
              >
                <div class="flex items-baseline gap-2">
                  <span class="font-mono text-[11px] text-ink-faint">{{ c.card_no }}</span>
                  <span class="text-[13px]" :class="c.id === transferTargetId ? 'text-brand font-semibold' : 'text-ink'">
                    {{ c.card_name_cn || c.card_name_en || '（未命名）' }}
                  </span>
                </div>
              </button>
              <p v-if="!transferCandidates.length" class="px-3 py-6 text-center text-xs text-ink-faint">
                {{ transferLoading ? '搜索中…' : '没有匹配的卡牌' }}
              </p>
            </div>

            <div class="flex items-center justify-end gap-3 mt-6">
              <button class="btn-ghost px-3 py-1.5 text-xs" @click="transferOpen = false">取消</button>
              <button
                class="btn-brand px-3 py-1.5 text-xs"
                :disabled="!transferTargetId || transferLoading"
                @click="confirmTransfer"
              >
                确认转移
              </button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </EditorialShell>
</template>

<style scoped>
/* {{标记}} 渲染成朱砂小标,与卡片效果文本的消费端保持一致 */
.effect-preview :deep(.effect-mark) {
  display: inline-block;
  padding: 0 5px;
  margin: 0 2px;
  border-radius: 4px;
  font-size: 12px;
  line-height: 1.6;
  background: var(--color-brand-soft);
  color: var(--color-brand);
  border: 1px solid var(--color-brand-faint);
}
.effect-preview :deep(p) {
  margin: 0 0 0.5em;
}
.effect-preview :deep(p:last-child) {
  margin-bottom: 0;
}
</style>
