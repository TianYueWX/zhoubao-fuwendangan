<script setup lang="ts">
/**
 * AdminResources.vue · 资源与发布(P4)
 *
 * 对应后台「方案 D · 辅助资源管理面板」,三页签:
 *   ① 系列管理   series   —— CRUD + 内联开关 + 封面预览 + 引用印刷数
 *   ② 图标库     card_icons —— 网格 + 内联编辑面板
 *   ③ 版本发布   version  —— 逐行触碰 / 一键发布全部
 *
 * 「发布」的全部含义就是触碰 version.updated_at —— 库中没有触发器,
 * 客户端靠这个时间戳判断缓存是否失效。所以这里没有复杂逻辑,
 * 重要的是让编务清楚「我刚刚让哪些客户端的缓存失效了」。
 *
 * 编辑表单用内联面板而非模态框(遵守站内「不用浮层打断」的约定)。
 */
import { computed, onMounted, reactive, ref } from 'vue';
import EditorialShell from './EditorialShell.vue';
import SectionHeading from '../SectionHeading.vue';
import AdminConfirmButton from './AdminConfirmButton.vue';
import { navigate } from '@/router/hash';
import { errorText, notifyError, notifyOk, notifyWarn } from '@/tools/admin/notice';
import { formatTime } from '@/tools/admin/text';
import {
  countPrintsInSeries,
  deleteIcon,
  deleteSeries,
  insertIcon,
  insertSeries,
  isUsableIconUrl,
  listIcons,
  listSeries,
  setSeriesFlag,
  updateIcon,
  updateSeries,
  type IconPatch,
  type SeriesPatch
} from '@/tools/admin/resources';
import {
  VERSION_CATEGORIES,
  VERSION_LABEL,
  fetchVersions,
  touchVersion,
  touchVersions,
  type VersionCategory
} from '@/tools/sources/rest';
import type { CardIcon, Series, VersionRow } from '@/tools/admin/types';
import { isUsableSeriesCode } from '@/tools/admin/validate';

type TabId = 'series' | 'icons' | 'version';
const TAB_LABEL: Record<TabId, string> = {
  series: '系列管理',
  icons: '图标库',
  version: '版本发布'
};

const tab = ref<TabId>('series');

/* ══════════════════════ 系列 ══════════════════════ */

const seriesList = ref<Series[]>([]);
const seriesLoading = ref(false);
/** 每个系列被多少印刷版本引用 —— 删除前必须让编务知道 */
const seriesUsage = reactive<Record<string, number>>({});

const seriesOpen = ref(false);
const seriesEditingCode = ref<string | null>(null);
const seriesBusy = ref(false);
const seriesForm = reactive({
  code: '',
  name_cn: '',
  name_en: '',
  release_order: 0,
  is_standard: false,
  is_active: false,
  cover_image: ''
});

async function loadSeries(): Promise<void> {
  seriesLoading.value = true;
  try {
    seriesList.value = await listSeries();
    // 引用计数:每个系列两次轻量 count 查询(显式 series + 继承基础卡系列)
    await Promise.all(
      seriesList.value.map(async (s) => {
        try {
          seriesUsage[s.code] = (await countPrintsInSeries(s.code)) ?? 0;
        } catch {
          seriesUsage[s.code] = -1; // -1 = 未取到,界面显示 —
        }
      })
    );
  } catch (e) {
    notifyError(`加载系列失败:${errorText(e)}`);
    seriesList.value = [];
  } finally {
    seriesLoading.value = false;
  }
}

function openSeriesAdd(): void {
  seriesEditingCode.value = null;
  Object.assign(seriesForm, {
    code: '',
    name_cn: '',
    name_en: '',
    release_order: (seriesList.value.at(-1)?.release_order ?? 0) + 10,
    is_standard: false,
    is_active: false,
    cover_image: ''
  });
  seriesOpen.value = true;
}

function openSeriesEdit(s: Series): void {
  seriesEditingCode.value = s.code;
  Object.assign(seriesForm, {
    code: s.code,
    name_cn: s.name_cn ?? '',
    name_en: s.name_en ?? '',
    release_order: s.release_order ?? 0,
    is_standard: s.is_standard,
    is_active: s.is_active,
    cover_image: s.cover_image ?? ''
  });
  seriesOpen.value = true;
}

async function saveSeries(): Promise<void> {
  const code = seriesForm.code.trim();
  if (!seriesEditingCode.value && !isUsableSeriesCode(code)) {
    notifyWarn('系列代码只允许字母数字与连字符,长度 1–16,且需以字母或数字开头');
    return;
  }
  const patch: SeriesPatch = {
    name_cn: seriesForm.name_cn || null,
    name_en: seriesForm.name_en || null,
    release_order: seriesForm.release_order,
    is_standard: seriesForm.is_standard,
    is_active: seriesForm.is_active,
    cover_image: seriesForm.cover_image || null
  };
  seriesBusy.value = true;
  try {
    if (seriesEditingCode.value) {
      const rows = await updateSeries(seriesEditingCode.value, patch);
      if (!rows.length) throw new Error('未被写入(0 行受影响)');
      notifyOk(`系列 ${seriesEditingCode.value} 已更新`);
    } else {
      await insertSeries(code, patch);
      notifyOk(`系列 ${code} 已新增`);
    }
    seriesOpen.value = false;
    await loadSeries();
  } catch (e) {
    notifyError(`保存失败:${errorText(e)}`);
  } finally {
    seriesBusy.value = false;
  }
}

/** 内联开关:先改本地(界面即时反馈),写失败再回滚 */
async function toggleFlag(s: Series, field: 'is_standard' | 'is_active'): Promise<void> {
  const next = s[field];
  try {
    const rows = await setSeriesFlag(s.code, field, next);
    if (!rows.length) throw new Error('未被写入(0 行受影响)');
  } catch (e) {
    s[field] = !next;
    notifyError(`更新失败:${errorText(e)}`);
  }
}

const seriesDeleting = ref<string | null>(null);

async function removeSeries(s: Series): Promise<void> {
  seriesDeleting.value = s.code;
  try {
    const rows = await deleteSeries(s.code);
    if (!rows.length) throw new Error('未被删除(0 行受影响)');
    notifyOk(`系列 ${s.code} 已删除`);
    await loadSeries();
  } catch (e) {
    notifyError(`删除失败:${errorText(e)}`);
  } finally {
    seriesDeleting.value = null;
  }
}

/* ══════════════════════ 图标库 ══════════════════════ */

const icons = ref<CardIcon[]>([]);
const iconsLoading = ref(false);
const iconOpen = ref(false);
const iconEditingId = ref<string | null>(null);
const iconBusy = ref(false);
const iconForm = reactive<IconPatch>({
  name_zh: '',
  name_en: '',
  url: '',
  url_en: '',
  storage_type: 'online',
  isWhite: false
});

const iconFilter = ref('');
const filteredIcons = computed(() => {
  const q = iconFilter.value.trim().toLowerCase();
  if (!q) return icons.value;
  return icons.value.filter((i) =>
    `${i.name_zh ?? ''} ${i.name_en ?? ''}`.toLowerCase().includes(q)
  );
});

async function loadIcons(): Promise<void> {
  iconsLoading.value = true;
  try {
    icons.value = await listIcons();
  } catch (e) {
    notifyError(`加载图标失败:${errorText(e)}`);
    icons.value = [];
  } finally {
    iconsLoading.value = false;
  }
}

function openIconAdd(): void {
  iconEditingId.value = null;
  Object.assign(iconForm, {
    name_zh: '',
    name_en: '',
    url: '',
    url_en: '',
    storage_type: 'online',
    isWhite: false
  });
  iconOpen.value = true;
}

function openIconEdit(i: CardIcon): void {
  iconEditingId.value = i.id;
  Object.assign(iconForm, {
    name_zh: i.name_zh ?? '',
    name_en: i.name_en ?? '',
    url: i.url ?? '',
    url_en: i.url_en ?? '',
    storage_type: i.storage_type ?? 'online',
    isWhite: i.isWhite
  });
  iconOpen.value = true;
}

async function saveIcon(): Promise<void> {
  if (!iconForm.name_zh.trim()) {
    notifyWarn('请填写中文名(关键词)');
    return;
  }
  if (!isUsableIconUrl(iconForm.url)) {
    notifyWarn('请填写图标 URL(http(s) / 站内路径 / data:image)');
    return;
  }
  const patch: IconPatch = {
    name_zh: iconForm.name_zh.trim(),
    name_en: iconForm.name_en || '',
    url: iconForm.url.trim(),
    url_en: iconForm.url_en || null,
    storage_type: iconForm.storage_type,
    isWhite: iconForm.isWhite
  };
  iconBusy.value = true;
  try {
    if (iconEditingId.value) {
      const rows = await updateIcon(iconEditingId.value, patch);
      if (!rows.length) throw new Error('未被写入(0 行受影响)');
      notifyOk(`图标「${patch.name_zh}」已更新`);
    } else {
      await insertIcon(patch);
      notifyOk(`图标「${patch.name_zh}」已新增`);
    }
    iconOpen.value = false;
    await loadIcons();
  } catch (e) {
    notifyError(`保存失败:${errorText(e)}`);
  } finally {
    iconBusy.value = false;
  }
}

const iconDeleting = ref<string | null>(null);

async function removeIcon(i: CardIcon): Promise<void> {
  iconDeleting.value = i.id;
  try {
    const rows = await deleteIcon(i.id);
    if (!rows.length) throw new Error('未被删除(0 行受影响)');
    notifyOk('图标已删除');
    await loadIcons();
  } catch (e) {
    notifyError(`删除失败:${errorText(e)}`);
  } finally {
    iconDeleting.value = null;
  }
}

/* ══════════════════════ 版本发布 ══════════════════════ */

const versions = ref<VersionRow[]>([]);
const versionLoading = ref(false);
const versionBusy = ref<string | null>(null);
const publishingAll = ref(false);

async function loadVersions(): Promise<void> {
  versionLoading.value = true;
  try {
    versions.value = await fetchVersions();
  } catch (e) {
    notifyError(`加载发布标记失败:${errorText(e)}`);
    versions.value = [];
  } finally {
    versionLoading.value = false;
  }
}

async function touch(name: string): Promise<void> {
  versionBusy.value = name;
  try {
    await touchVersion(name as VersionCategory);
    notifyOk(`已发布「${VERSION_LABEL[name as VersionCategory] ?? name}」`);
    await loadVersions();
  } catch (e) {
    notifyError(`发布失败:${errorText(e)}`);
  } finally {
    versionBusy.value = null;
  }
}

async function publishAll(): Promise<void> {
  publishingAll.value = true;
  try {
    const results = await touchVersions(VERSION_CATEGORIES);
    const failed = results.filter((r) => !r.ok);
    if (!failed.length) {
      notifyOk('已发布全部', '五个分类的时间戳均已更新,客户端将重新拉取');
    } else {
      notifyError(
        `${failed.length} 个分类发布失败:${failed.map((f) => VERSION_LABEL[f.name]).join('、')}`,
        failed[0]?.error
      );
    }
    await loadVersions();
  } finally {
    publishingAll.value = false;
  }
}

onMounted(async () => {
  await Promise.all([loadSeries(), loadIcons(), loadVersions()]);
});
</script>

<template>
  <EditorialShell code="editorial-resources">
    <div class="max-w-[1500px] mx-auto">
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
          资源与发布
        </h1>
        <p class="standfirst mt-4 text-[15px]">
          维护系列与关键词图标,并掌控发布的节奏。「发布」= 触碰该分类的
          <code class="font-mono text-[13px]">version.updated_at</code>;客户端据此判断缓存是否失效。
        </p>
        <div class="hairline mt-7"></div>
      </header>

      <!-- ══════════ 页签 ══════════ -->
      <div class="flex rounded-lg overflow-hidden border border-card-border w-fit mb-7">
        <button
          v-for="(label, id) in TAB_LABEL"
          :key="id"
          class="px-4 py-2 text-[12.5px] transition-colors border-l border-card-border first:border-l-0"
          :class="tab === id ? 'tab-active' : 'text-ink-muted hover:text-brand'"
          @click="tab = id as TabId"
        >
          {{ label }}
        </button>
      </div>

      <!-- ══════════════════ 页签一:系列管理 ══════════════════ -->
      <section v-if="tab === 'series'">
        <SectionHeading
          eyebrow="其一 · 系列"
          :title="`系列管理（${seriesList.length}）`"
          note="保存显式带 updated_at;「引用印刷」列为归属该代码的印刷版本数(含继承基础卡系列)—— 删除系列不会改动卡牌,只会让它们失去系列归属"
        >
          <template #actions>
            <button class="btn-ghost px-3 py-1.5 text-xs" :disabled="seriesLoading" @click="loadSeries">
              刷新
            </button>
            <button class="btn-brand px-3 py-1.5 text-xs" @click="openSeriesAdd">新增系列</button>
          </template>
        </SectionHeading>

        <!-- 内联编辑面板 -->
        <div v-if="seriesOpen" class="card p-5 mb-5">
          <div class="flex items-start justify-between gap-4 flex-wrap">
            <span class="eyebrow">{{ seriesEditingCode ? `编辑系列 ${seriesEditingCode}` : '新增系列' }}</span>
            <button class="text-[12px] text-ink-faint hover:text-brand" @click="seriesOpen = false">收起</button>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-x-5 gap-y-4 mt-4">
            <label class="block">
              <span class="text-[11px] tracking-[0.14em] text-ink-faint">系列代码</span>
              <input
                v-model="seriesForm.code"
                :disabled="!!seriesEditingCode"
                class="filter-select w-full mt-1.5 font-mono disabled:opacity-50"
                placeholder="如 FND"
              />
            </label>
            <label class="block">
              <span class="text-[11px] tracking-[0.14em] text-ink-faint">发布顺序</span>
              <input v-model.number="seriesForm.release_order" type="number" class="filter-select w-full mt-1.5 tabular-nums" />
            </label>
            <label class="block">
              <span class="text-[11px] tracking-[0.14em] text-ink-faint">中文名</span>
              <input v-model="seriesForm.name_cn" class="filter-select w-full mt-1.5" />
            </label>
            <label class="block">
              <span class="text-[11px] tracking-[0.14em] text-ink-faint">英文名</span>
              <input v-model="seriesForm.name_en" class="filter-select w-full mt-1.5" />
            </label>
            <label class="block xl:col-span-2">
              <span class="text-[11px] tracking-[0.14em] text-ink-faint">封面图 URL</span>
              <input v-model="seriesForm.cover_image" class="filter-select w-full mt-1.5" placeholder="https://…" />
            </label>
            <div class="flex items-end gap-6">
              <label class="flex items-center gap-2 text-[12px] text-ink-muted">
                <input v-model="seriesForm.is_standard" type="checkbox" class="accent-[var(--color-brand)]" />
                标准环境
              </label>
              <label class="flex items-center gap-2 text-[12px] text-ink-muted">
                <input v-model="seriesForm.is_active" type="checkbox" class="accent-[var(--color-brand)]" />
                活跃
              </label>
            </div>
          </div>
          <div class="flex items-center justify-end gap-3 mt-5">
            <button class="btn-ghost px-3 py-1.5 text-xs" @click="seriesOpen = false">取消</button>
            <button class="btn-brand px-4 py-1.5 text-xs" :disabled="seriesBusy" @click="saveSeries">
              {{ seriesBusy ? '保存中…' : '保存' }}
            </button>
          </div>
        </div>

        <div class="border border-card-border rounded-xl overflow-x-auto">
          <table class="w-full text-sm min-w-[1000px]">
            <thead class="sticky-thead text-[11px] text-ink-faint">
              <tr class="border-b border-card-border">
                <th class="text-left font-normal px-2.5 py-2 w-[80px]">代码</th>
                <th class="text-left font-normal px-2.5 py-2 min-w-[130px]">中文名</th>
                <th class="text-left font-normal px-2.5 py-2 min-w-[150px]">英文名</th>
                <th class="text-right font-normal px-2.5 py-2 w-[80px]">顺序</th>
                <th class="text-center font-normal px-2.5 py-2 w-[70px]">标准</th>
                <th class="text-center font-normal px-2.5 py-2 w-[70px]">活跃</th>
                <th class="text-right font-normal px-2.5 py-2 w-[90px]">引用印刷</th>
                <th class="text-left font-normal px-2.5 py-2 min-w-[180px]">各类计数</th>
                <th class="text-center font-normal px-2.5 py-2 w-[80px]">封面</th>
                <th class="text-right font-normal px-2.5 py-2 w-[140px]">操作</th>
              </tr>
            </thead>
            <tbody :class="{ 'opacity-50': seriesLoading }">
              <tr v-for="s in seriesList" :key="s.code" class="table-row border-b border-panel-border/30 last:border-0">
                <td class="px-2.5 py-1.5 font-mono text-[12px]">{{ s.code }}</td>
                <td class="px-2.5 py-1.5">{{ s.name_cn || '—' }}</td>
                <td class="px-2.5 py-1.5 text-ink-muted">{{ s.name_en || '—' }}</td>
                <td class="px-2.5 py-1.5 text-right tabular-nums">{{ s.release_order ?? '—' }}</td>
                <td class="px-2.5 py-1.5 text-center">
                  <input
                    v-model="s.is_standard"
                    type="checkbox"
                    class="accent-[var(--color-brand)]"
                    @change="toggleFlag(s, 'is_standard')"
                  />
                </td>
                <td class="px-2.5 py-1.5 text-center">
                  <input
                    v-model="s.is_active"
                    type="checkbox"
                    class="accent-[var(--color-brand)]"
                    @change="toggleFlag(s, 'is_active')"
                  />
                </td>
                <td class="px-2.5 py-1.5 text-right tabular-nums">
                  <span v-if="seriesUsage[s.code] === -1" class="text-ink-faint">—</span>
                  <span v-else :class="seriesUsage[s.code] ? 'text-ink-muted' : 'text-ink-faint'">
                    {{ seriesUsage[s.code] ?? 0 }}
                  </span>
                </td>
                <td class="px-2.5 py-1.5 text-[11px] text-ink-faint tabular-nums">
                  基础 {{ s.base_count ?? 0 }} · 异画 {{ s.alt_count ?? 0 }} · 超编 {{ s.overnum_count ?? 0 }} ·
                  符文 {{ s.rune_count ?? 0 }} · 衍生 {{ s.token_count ?? 0 }}
                </td>
                <td class="px-2.5 py-1.5 text-center">
                  <img
                    v-if="s.cover_image"
                    :src="s.cover_image"
                    :title="s.cover_image"
                    alt=""
                    loading="lazy"
                    decoding="async"
                    class="inline-block w-9 h-[50px] object-contain border border-card-border rounded"
                  />
                  <span v-else class="text-ink-faint">—</span>
                </td>
                <td class="px-2.5 py-1.5">
                  <div class="flex items-center justify-end gap-3">
                    <button class="text-[12px] text-brand hover:underline" @click="openSeriesEdit(s)">编辑</button>
                    <AdminConfirmButton
                      :label="`删除`"
                      :confirm-label="
                        seriesUsage[s.code]
                          ? `确认删除(${seriesUsage[s.code]} 个印刷版本将失去系列)`
                          : '确认删除'
                      "
                      :disabled="seriesDeleting === s.code"
                      @confirm="removeSeries(s)"
                    />
                  </div>
                </td>
              </tr>
              <tr v-if="!seriesList.length && !seriesLoading">
                <td colspan="10" class="px-3 py-8 text-center text-xs text-ink-faint">暂无系列</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- ══════════════════ 页签二:图标库 ══════════════════ -->
      <section v-else-if="tab === 'icons'">
        <SectionHeading
          eyebrow="其二 · 图标"
          :title="`图标库（${icons.length}）`"
          note="白描图标在深底上预览(isWhite);存储类型 online/local 决定客户端取图方式"
        >
          <template #actions>
            <input v-model="iconFilter" placeholder="按名称筛选" class="filter-select w-[160px]" />
            <button class="btn-ghost px-3 py-1.5 text-xs" :disabled="iconsLoading" @click="loadIcons">
              刷新
            </button>
            <button class="btn-brand px-3 py-1.5 text-xs" @click="openIconAdd">新增图标</button>
          </template>
        </SectionHeading>

        <!-- 内联编辑面板 -->
        <div v-if="iconOpen" class="card p-5 mb-5">
          <div class="flex items-start justify-between gap-4 flex-wrap">
            <span class="eyebrow">{{ iconEditingId ? '编辑图标' : '新增图标' }}</span>
            <div class="flex items-center gap-4">
              <div
                class="w-12 h-12 grid place-items-center rounded-lg border border-card-border overflow-hidden"
                :style="{ background: iconForm.isWhite ? 'var(--color-text-muted)' : 'var(--color-panel-bg)' }"
              >
                <img v-if="iconForm.url" :src="iconForm.url" alt="" class="max-w-[34px] max-h-[34px] object-contain" />
                <span v-else class="text-[10px] text-ink-faint">无图</span>
              </div>
              <button class="text-[12px] text-ink-faint hover:text-brand" @click="iconOpen = false">收起</button>
            </div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-x-5 gap-y-4 mt-4">
            <label class="block">
              <span class="text-[11px] tracking-[0.14em] text-ink-faint">中文名(关键词)</span>
              <input v-model="iconForm.name_zh" class="filter-select w-full mt-1.5" placeholder="如 待命" />
            </label>
            <label class="block">
              <span class="text-[11px] tracking-[0.14em] text-ink-faint">英文名</span>
              <input v-model="iconForm.name_en" class="filter-select w-full mt-1.5" />
            </label>
            <div class="flex items-end gap-5">
              <label class="flex items-center gap-2 text-[12px] text-ink-muted">
                <input v-model="iconForm.isWhite" type="checkbox" class="accent-[var(--color-brand)]" />
                白描(isWhite)
              </label>
            </div>
            <label class="block xl:col-span-2">
              <span class="text-[11px] tracking-[0.14em] text-ink-faint">图标 URL</span>
              <input v-model="iconForm.url" class="filter-select w-full mt-1.5" placeholder="https://… 或 /runes/xx.svg" />
            </label>
            <label class="block">
              <span class="text-[11px] tracking-[0.14em] text-ink-faint">英文 URL</span>
              <input v-model="iconForm.url_en" class="filter-select w-full mt-1.5" />
            </label>
            <div class="flex items-center gap-2.5">
              <span class="text-[11px] tracking-[0.14em] text-ink-faint">存储类型</span>
              <div class="flex rounded-lg overflow-hidden border border-card-border">
                <button
                  v-for="st in ['online', 'local'] as const"
                  :key="st"
                  class="px-3 py-1.5 text-xs transition-colors border-l border-card-border first:border-l-0"
                  :class="iconForm.storage_type === st ? 'tab-active' : 'text-ink-muted hover:text-brand'"
                  @click="iconForm.storage_type = st"
                >
                  {{ st }}
                </button>
              </div>
            </div>
          </div>
          <div class="flex items-center justify-end gap-3 mt-5">
            <button class="btn-ghost px-3 py-1.5 text-xs" @click="iconOpen = false">取消</button>
            <button class="btn-brand px-4 py-1.5 text-xs" :disabled="iconBusy" @click="saveIcon">
              {{ iconBusy ? '保存中…' : '保存' }}
            </button>
          </div>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7 gap-3" :class="{ 'opacity-50': iconsLoading }">
          <div v-for="i in filteredIcons" :key="i.id" class="card p-3 flex flex-col items-center gap-2 text-center">
            <div
              class="w-14 h-14 grid place-items-center rounded-lg border border-card-border overflow-hidden"
              :style="{ background: i.isWhite ? 'var(--color-text-muted)' : 'var(--color-panel-bg)' }"
            >
              <!-- lazy:图标有 100+ 张且都是外链,全部立即加载会拖慢首屏并挤占 CDN 并发 -->
              <img
                v-if="i.url"
                :src="i.url"
                :title="i.url"
                alt=""
                loading="lazy"
                decoding="async"
                class="max-w-[40px] max-h-[40px] object-contain"
              />
              <span v-else class="text-[10px] text-ink-faint">无图</span>
            </div>
            <div class="text-[13px] font-semibold text-ink leading-tight">{{ i.name_zh || '—' }}</div>
            <div class="text-[11px] text-ink-faint leading-tight">{{ i.name_en || '' }}</div>
            <div class="flex items-center gap-1.5 flex-wrap justify-center">
              <span class="text-[10px] px-1.5 py-0.5 rounded border border-card-border text-ink-faint">
                {{ i.storage_type || '—' }}
              </span>
              <span v-if="i.isWhite" class="text-[10px] px-1.5 py-0.5 rounded border border-accent/40 text-accent">
                白描
              </span>
            </div>
            <div class="flex items-center gap-3 mt-0.5">
              <button class="text-[12px] text-brand hover:underline" @click="openIconEdit(i)">编辑</button>
              <AdminConfirmButton
                label="删除"
                confirm-label="确认删除"
                :disabled="iconDeleting === i.id"
                @confirm="removeIcon(i)"
              />
            </div>
          </div>
          <p v-if="!filteredIcons.length && !iconsLoading" class="col-span-full py-10 text-center text-xs text-ink-faint">
            {{ iconFilter ? '没有匹配的图标' : '暂无图标' }}
          </p>
        </div>
      </section>

      <!-- ══════════════════ 页签三:版本发布 ══════════════════ -->
      <section v-else>
        <SectionHeading
          eyebrow="其三 · 发布"
          title="版本发布"
          note="触碰某个分类的时间戳,即通知所有客户端该分类的缓存已失效、需要重新拉取"
        >
          <template #actions>
            <button class="btn-ghost px-3 py-1.5 text-xs" :disabled="versionLoading" @click="loadVersions">
              刷新
            </button>
            <button class="btn-brand px-3 py-1.5 text-xs" :disabled="publishingAll" @click="publishAll">
              {{ publishingAll ? '发布中…' : '发布全部' }}
            </button>
          </template>
        </SectionHeading>

        <div class="border border-card-border rounded-xl overflow-hidden">
          <table class="w-full text-sm">
            <thead class="sticky-thead text-[11px] text-ink-faint">
              <tr class="border-b border-card-border">
                <th class="text-left font-normal px-3 py-2 w-[200px]">分类</th>
                <th class="text-left font-normal px-3 py-2">最后发布</th>
                <th class="text-right font-normal px-3 py-2 w-[160px]">操作</th>
              </tr>
            </thead>
            <tbody :class="{ 'opacity-50': versionLoading }">
              <tr v-for="v in versions" :key="v.id ?? v.name" class="table-row border-b border-panel-border/30 last:border-0">
                <td class="px-3 py-2.5">
                  <span class="text-ink">{{ VERSION_LABEL[v.name as VersionCategory] ?? v.name }}</span>
                  <span class="font-mono text-[11px] text-ink-faint ml-2">{{ v.name }}</span>
                </td>
                <td class="px-3 py-2.5 text-ink-muted tabular-nums">{{ formatTime(v.updated_at) }}</td>
                <td class="px-3 py-2.5 text-right">
                  <button
                    class="text-[12px] text-brand hover:underline disabled:opacity-40 disabled:no-underline"
                    :disabled="versionBusy === v.name"
                    @click="touch(v.name)"
                  >
                    {{ versionBusy === v.name ? '发布中…' : '触碰发布' }}
                  </button>
                </td>
              </tr>
              <tr v-if="!versions.length && !versionLoading">
                <td colspan="3" class="px-3 py-8 text-center text-xs text-ink-faint">
                  读不到 version 表 —— 请确认该表存在且启用了公开 SELECT 策略
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p class="mt-4 text-[11px] text-ink-faint leading-relaxed max-w-[760px]">
          口径:库中<b class="font-semibold text-ink-muted">没有触发器</b>,updated_at 不会自动刷新 ——
          任何数据改动后都必须显式触碰对应分类,否则客户端不会感知到更新。
          卡牌校勘 / 批量校勘 / 规则校勘的「保存并发布」按钮做的就是这件事。
        </p>
      </section>
    </div>
  </EditorialShell>
</template>
