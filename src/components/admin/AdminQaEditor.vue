<script setup lang="ts">
/**
 * AdminQaEditor.vue · QA 问答校勘
 *
 * 直接编辑 qa_entries（含手动录入 source=manual）与 qa_entry_cards 关联。
 * 写入复用 admin/qa.ts 的 applyQaPlan（0 行/关联不完整即报错），发布触碰 version.qa。
 */
import { computed, onMounted, ref } from 'vue';
import EditorialShell from './EditorialShell.vue';
import SectionHeading from '../SectionHeading.vue';
import QaRichText from './QaRichText.vue';
import AdminTagInput from './AdminTagInput.vue';
import AdminPager from './AdminPager.vue';
import AdminConfirmButton from './AdminConfirmButton.vue';
import { errorText, notifyError, notifyOk } from '@/tools/admin/notice';
import {
  createQaEntry,
  deleteQaEntry,
  loadQaExisting,
  publishQa,
  saveQaEntry,
  type QaEntryPatch,
  type QaExisting
} from '@/tools/admin/qa';
import type { QaDbEntry } from '@/tools/sync/qa';

const loading = ref(false);
const existing = ref<QaExisting | null>(null);
const search = ref('');
const page = ref(1);
const pageSize = 30;
const saving = ref(false);
const busy = ref(false);
const inputError = ref('');

/** null = 未选中；'' = 新增手录 */
const selectedId = ref<string | null>(null);

interface Draft {
  question: string;
  answer: string;
  question_en: string;
  answer_en: string;
  links: string[];
}
const draft = ref<Draft | null>(null);

const entries = computed(() => existing.value?.entries ?? []);
const cardNos = computed(() => existing.value?.cardNos ?? new Set<string>());
const nameByNo = computed(() => existing.value?.nameByNo ?? new Map<string, string>());
const cardNoOptions = computed(() => [...cardNos.value].sort());

const linksByQa = computed(() => {
  const map = new Map<string, string[]>();
  for (const l of existing.value?.links ?? []) {
    const arr = map.get(l.qa_id) ?? [];
    arr.push(l.card_no);
    map.set(l.qa_id, arr);
  }
  return map;
});

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return entries.value;
  return entries.value.filter((e) => {
    const hay = `${e.source_id ?? ''} ${e.question} ${e.answer} ${e.question_en ?? ''} ${e.answer_en ?? ''} ${(linksByQa.value.get(e.id) ?? []).join(' ')}`.toLowerCase();
    return hay.includes(q);
  });
});
const visible = computed(() => filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize));

const isNew = computed(() => selectedId.value === '');
const currentEntry = computed(() => (selectedId.value ? entries.value.find((e) => e.id === selectedId.value) ?? null : null));
const currentLinks = computed(() => (selectedId.value ? linksByQa.value.get(selectedId.value) ?? [] : []));
const linkNames = computed(() => (draft.value?.links ?? []).map((n) => (nameByNo.value.has(n) ? `${n} ${nameByNo.value.get(n)}` : n)));

function sourceLabel(e?: QaDbEntry | null): string {
  if (!e) return '—';
  if (e.source === 'manual') return '手录';
  if (e.source === 'xcx') return '小程序';
  return e.source || '—';
}

function preview(text: string, n: number): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    existing.value = await loadQaExisting();
    page.value = Math.min(page.value, Math.max(1, Math.ceil(filtered.value.length / pageSize)));
  } catch (e) {
    notifyError(`加载问答失败:${errorText(e)}`);
    existing.value = null;
  } finally {
    loading.value = false;
  }
}

function select(e: QaDbEntry): void {
  selectedId.value = e.id;
  draft.value = {
    question: e.question,
    answer: e.answer,
    question_en: e.question_en ?? '',
    answer_en: e.answer_en ?? '',
    links: [...(linksByQa.value.get(e.id) ?? [])]
  };
  inputError.value = '';
}

function newEntry(): void {
  selectedId.value = '';
  draft.value = { question: 'Q：', answer: 'A：', question_en: '', answer_en: '', links: [] };
  inputError.value = '';
}

async function save(publish: boolean): Promise<void> {
  const d = draft.value;
  if (!d) return;
  inputError.value = '';
  if (!d.question.trim()) {
    inputError.value = '问题不能为空';
    return;
  }
  if (!d.answer.trim()) {
    inputError.value = '答案不能为空';
    return;
  }
  const links = [...new Set(d.links.map((n) => n.trim()).filter(Boolean))];
  const bad = links.filter((n) => !cardNos.value.has(n));
  if (bad.length) {
    inputError.value = `编号不在 cards_base，无法关联：${bad.join('、')}`;
    return;
  }
  const patch: QaEntryPatch = {
    question: d.question,
    answer: d.answer,
    question_en: d.question_en.trim() ? d.question_en : null,
    answer_en: d.answer_en.trim() ? d.answer_en : null
  };
  saving.value = true;
  try {
    let saved: QaDbEntry;
    if (isNew.value) {
      saved = await createQaEntry(patch, links);
      notifyOk('已新增问答');
    } else {
      saved = await saveQaEntry(selectedId.value!, patch, links, currentLinks.value);
      notifyOk('问答已保存');
    }
    if (publish) {
      await publishQa();
      notifyOk('已发布', 'version.qa 时间戳已更新');
    }
    await load();
    const found = existing.value?.entries.find((e) => e.id === saved.id);
    if (found) select(found);
  } catch (e) {
    notifyError(`保存失败:${errorText(e)}`);
  } finally {
    saving.value = false;
  }
}

async function remove(): Promise<void> {
  const id = selectedId.value;
  if (!id) return;
  busy.value = true;
  try {
    await deleteQaEntry(id);
    notifyOk('问答已删除');
    selectedId.value = null;
    draft.value = null;
    await load();
  } catch (e) {
    notifyError(`删除失败:${errorText(e)}`);
  } finally {
    busy.value = false;
  }
}

async function publish(): Promise<void> {
  busy.value = true;
  try {
    await publishQa();
    notifyOk('已发布', 'version.qa 时间戳已更新');
  } catch (e) {
    notifyError(`发布失败:${errorText(e)}`);
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <EditorialShell code="editorial-qa">
    <div class="max-w-[1720px] mx-auto">
      <header class="mb-7">
        <h1 class="font-display font-black text-ink leading-tight text-[28px] lg:text-[38px]">
          QA 问答
        </h1>
        <div class="hairline mt-7"></div>
      </header>

      <p v-if="!existing" class="py-16 text-center text-sm text-ink-faint">
        {{ loading ? '正在载入问答…' : '暂无数据（请确认已登录且已配置 Supabase）' }}
      </p>

      <div
        v-else
        class="grid grid-cols-1 xl:grid-cols-[minmax(0,4fr)_minmax(0,6fr)] xl:divide-x xl:divide-panel-border"
      >
        <!-- ───── 左：列表 ───── -->
        <aside class="xl:pr-8">
          <SectionHeading plain small title="问答条目" :note="`共 ${entries.length} 条`">
            <template #actions>
              <button class="btn-ghost px-2.5 py-1 text-[11px]" :disabled="busy" @click="publish">发布</button>
              <button class="btn-brand px-2.5 py-1 text-[11px]" @click="newEntry">新建手录</button>
            </template>
          </SectionHeading>

          <input
            v-model="search"
            placeholder="检索：问题 / 答案 / 卡号"
            class="filter-select w-full mb-3"
            @input="page = 1"
          />

          <div class="border border-card-border rounded-xl overflow-hidden">
            <button
              v-for="e in visible"
              :key="e.id"
              class="w-full text-left px-3 py-2.5 border-b border-panel-border/40 last:border-0 transition-colors"
              :class="selectedId === e.id ? 'bg-brand-soft' : 'table-row'"
              @click="select(e)"
            >
              <div class="flex items-center gap-2">
                <span class="text-[10px] px-1.5 py-0.5 rounded border border-card-border text-ink-faint">
                  {{ sourceLabel(e) }}
                </span>
                <span class="text-[11px] text-ink-faint font-mono">#{{ e.source_id ?? '—' }}</span>
                <span v-if="(linksByQa.get(e.id) ?? []).length" class="text-[11px] text-ink-faint">
                  · {{ (linksByQa.get(e.id) ?? []).length }} 张卡
                </span>
              </div>
              <p class="text-[13px] text-ink mt-1.5">{{ preview(e.question, 60) }}</p>
              <p class="text-[11px] text-ink-faint mt-1">{{ preview(e.answer, 60) }}</p>
            </button>
            <p v-if="!visible.length" class="px-3 py-8 text-center text-xs text-ink-faint">
              没有符合条件的问答
            </p>
          </div>

          <div class="mt-3">
            <AdminPager v-model:page="page" :page-size="pageSize" :total="filtered.length" :disabled="saving" />
          </div>
        </aside>

        <!-- ───── 右：编辑器 ───── -->
        <section class="xl:pl-8 pt-8 xl:pt-0 min-w-0">
          <template v-if="draft">
            <div class="flex items-start justify-between gap-4 flex-wrap mb-6">
              <div class="min-w-0">
                <h2 class="font-display font-bold text-ink text-xl truncate">
                  {{ isNew ? '新增问答' : `#${currentEntry?.source_id ?? '手录'}` }}
                  <span
                    v-if="isNew"
                    class="text-[10px] text-accent border border-accent/40 rounded px-1.5 py-0.5 ml-2 align-middle"
                  >
                    未保存
                  </span>
                </h2>
                <p class="text-[11px] text-ink-faint mt-1">
                  <template v-if="isNew">手动录入，来源标记为 manual</template>
                  <template v-else>
                    {{ sourceLabel(currentEntry) }} · 关联 {{ currentLinks.length }} 张卡
                  </template>
                </p>
              </div>
              <div class="flex items-center gap-3 shrink-0">
                <AdminConfirmButton
                  v-if="!isNew"
                  label="删除条目"
                  confirm-label="确认删除该问答"
                  :disabled="busy || saving"
                  @confirm="remove"
                />
                <button class="btn-ghost px-3 py-1.5 text-xs" :disabled="saving" @click="save(false)">
                  {{ saving ? '保存中…' : '保存修改' }}
                </button>
                <button class="btn-brand px-3 py-1.5 text-xs" :disabled="saving" @click="save(true)">
                  保存并发布
                </button>
              </div>
            </div>

            <p v-if="inputError" class="text-[12px] text-delta-down mb-4">{{ inputError }}</p>

            <SectionHeading plain small title="正文" />
            <label class="block">
              <span class="text-[11px] tracking-[0.14em] text-ink-faint">问题（含 Q：前缀）</span>
              <textarea v-model="draft.question" rows="3" class="filter-select w-full mt-1.5 leading-relaxed"></textarea>
            </label>
            <label class="block mt-4">
              <span class="text-[11px] tracking-[0.14em] text-ink-faint">答案（含 A：前缀，可换行）</span>
              <textarea v-model="draft.answer" rows="5" class="filter-select w-full mt-1.5 leading-relaxed"></textarea>
            </label>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 mt-4">
              <label class="block">
                <span class="text-[11px] tracking-[0.14em] text-ink-faint">英文问题</span>
                <textarea v-model="draft.question_en" rows="3" class="filter-select w-full mt-1.5 leading-relaxed"></textarea>
              </label>
              <label class="block">
                <span class="text-[11px] tracking-[0.14em] text-ink-faint">英文答案</span>
                <textarea v-model="draft.answer_en" rows="3" class="filter-select w-full mt-1.5 leading-relaxed"></textarea>
              </label>
            </div>

            <div class="hairline my-6"></div>

            <SectionHeading plain small title="关联卡牌" :note="`${draft.links.length} 张`" />
            <AdminTagInput
              v-model="draft.links"
              :options="cardNoOptions"
              placeholder="输入卡号（如 OGN-055）后回车"
              :disabled="saving"
            />
            <p v-if="linkNames.length" class="text-[11px] text-ink-faint mt-2 leading-relaxed">
              {{ linkNames.join('、') }}
            </p>
            <p class="text-[11px] text-ink-faint mt-1">仅可关联 cards_base 中已存在的编号；保存时会再次校验。</p>

            <div class="hairline my-6"></div>
            <SectionHeading plain small title="预览" />
            <div class="border border-card-border rounded-xl p-4">
              <p class="text-[13px]"><QaRichText :text="draft.question" /></p>
              <p class="text-[13px] text-ink-muted mt-2"><QaRichText :text="draft.answer" /></p>
            </div>
          </template>

          <div v-else class="py-20 text-center">
            <p class="text-sm text-ink-faint">在左侧选择一条问答开始编辑</p>
            <p class="text-[11px] text-ink-faint mt-2">或点「新建手录」录入一条新的问答</p>
          </div>
        </section>
      </div>
    </div>
  </EditorialShell>
</template>
