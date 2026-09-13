<script setup lang="ts">
/**
 * PackagePanel.vue · 数据包库(多包管理)
 *
 * 列出全部已入档的数据包(= 期刊的期号):激活 / 改刊名 / 移出 / 载回暂存区重算。
 * 工具层的 5 个分析工具始终作用于「活动包」,这里决定谁是活动包。
 */
import { computed, ref } from 'vue';
import {
  store,
  selectPackage,
  removePackage,
  renamePackage,
  loadPackageToDraft,
  type PackageRecord
} from '@/store/analysis';
import SectionHeading from '@/components/SectionHeading.vue';

const editing = ref('');
const draftName = ref('');

const packages = computed(() => store.packages.slice().reverse()); // 新 → 旧

/** 期号:包在升序列表中的序号(与首页/往期一致) */
function issueNoOf(p: PackageRecord): number {
  return store.packages.findIndex((x) => x.id === p.id) + 1;
}

function startRename(p: PackageRecord): void {
  editing.value = p.id;
  draftName.value = p.label;
}
function commitRename(): void {
  if (editing.value) renamePackage(editing.value, draftName.value);
  editing.value = '';
}
function onDraftKey(e: KeyboardEvent): void {
  if (e.key === 'Enter') commitRename();
  if (e.key === 'Escape') editing.value = '';
}

function reload(p: PackageRecord): void {
  if (loadPackageToDraft(p.id)) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}
</script>

<template>
  <section v-if="store.hasPackages">
    <SectionHeading
      eyebrow="档案架 · Library"
      title="已载入的数据包"
      :note="`共 ${store.packages.length} 期 · 5 个分析工具作用于「活动包」,点击卡片切换`"
    />

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <article
        v-for="p in packages"
        :key="p.id"
        class="card p-4 transition-colors cursor-pointer"
        :class="p.id === store.activePackageId ? 'border-brand-faint bg-brand-soft/40' : 'card-hover'"
        @click="selectPackage(p.id)"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="eyebrow">第 {{ issueNoOf(p) }} 期</span>
              <span
                v-if="p.id === store.activePackageId"
                class="text-[10px] px-1.5 py-0.5 rounded border border-brand-faint text-brand"
                >活动中</span
              >
              <span v-if="p.season" class="text-[10px] text-ink-faint">{{ p.season }}</span>
            </div>

            <!-- 刊名(双击或点「改名」进入编辑) -->
            <input
              v-if="editing === p.id"
              v-model="draftName"
              class="mt-1.5 w-full bg-card-bg border border-card-border rounded-md px-2 py-1 text-sm text-ink"
              @click.stop
              @keydown="onDraftKey"
              @blur="commitRename"
            />
            <h4 v-else class="font-display font-bold text-ink text-[15px] mt-1.5 truncate">
              {{ p.label }}
            </h4>

            <p class="text-[11px] text-ink-faint tabular-nums mt-1">
              {{ p.meta.dateRange ? p.meta.dateRange.join(' — ') : '日期未知' }}
              · 样本 {{ p.meta.sampleCount }} · 赛事 {{ p.meta.eventCount }}
              · 城市 {{ p.meta.cityCount }} · {{ p.meta.weekCount }} 周
            </p>
            <p class="text-[11px] mt-1" :class="p.meta.hasWinData ? 'text-delta-up' : 'text-ink-faint'">
              {{ p.meta.hasWinData ? '含真实胜场数据' : '无胜场数据(仅出场率/Top 率)' }}
            </p>
          </div>
        </div>

        <div class="flex items-center gap-2 mt-3 flex-wrap" @click.stop>
          <button
            v-if="p.id !== store.activePackageId"
            class="btn-ghost px-2.5 py-1 text-xs"
            @click="selectPackage(p.id)"
          >
            设为活动包
          </button>
          <button class="btn-ghost px-2.5 py-1 text-xs" @click="startRename(p)">改刊名</button>
          <button class="btn-ghost px-2.5 py-1 text-xs" @click="reload(p)">载回暂存区</button>
          <button
            class="btn-ghost px-2.5 py-1 text-xs text-delta-down hover:border-delta-down"
            @click="removePackage(p.id)"
          >
            移出
          </button>
        </div>
      </article>
    </div>
  </section>
</template>
