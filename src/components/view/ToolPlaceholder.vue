<script setup lang="ts">
/**
 * ToolPlaceholder.vue · 未接入内容的工具占位视图
 *
 * 用于**架构已登记、内容未实现**的工具(云端报道 / QA / 规则 / 卡牌查询)。
 * 它证明扩展链路是通的:注册表登记 → 首页出现工具卡 → 路由可直达 → 视图给状态说明。
 * 接入真实内容时,把 ViewComponents 里的映射指向新组件即可,其余零改动。
 */
import { computed } from 'vue';
import { findTool, groupOf } from '@/tools/catalog';
import { getToolState, statusVisual } from '@/tools/state';
import { navigate } from '@/router/hash';

const props = defineProps<{ code: string }>();

const tool = computed(() => findTool(props.code));
const group = computed(() => groupOf(tool.value?.group ?? 'journal'));
const state = computed(() => getToolState(props.code));
const visual = computed(() => statusVisual(state.value.status));

const SOURCE_LABEL: Record<string, string> = {
  local: '本机浏览器内存',
  supabase: 'Supabase 云端(PostgREST)',
  static: '随站点发布的静态资源'
};
const sourceLabel = computed(() => SOURCE_LABEL[tool.value?.source ?? 'journal'] ?? '—');
</script>

<template>
  <div class="fade-in max-w-[820px] mx-auto">
    <header>
      <div class="flex items-center justify-between gap-4 flex-wrap text-[11px] text-ink-faint">
        <button class="hover:text-brand transition-colors" @click="navigate({ view: 'journal' })">
          ← 返回首页
        </button>
        <span class="font-latin tracking-[0.22em] uppercase">{{ group.latin }}</span>
      </div>
      <p class="eyebrow mt-7">{{ group.label }} · {{ tool?.badge ?? '工具' }}</p>
      <h1 class="font-display font-black text-ink leading-tight mt-3 text-[28px] lg:text-[38px]">
        {{ tool?.label ?? code }}
      </h1>
      <p class="standfirst mt-4 text-[15px]">{{ tool?.desc }}</p>
      <div class="hairline mt-7"></div>
    </header>

    <section class="mt-8 card p-6">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-[11px] px-1.5 py-0.5 rounded border border-card-border text-ink-faint">
          架构位
        </span>
        <span class="text-[11px]" :class="visual.tone">{{ visual.label }}</span>
      </div>

      <dl class="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
        <div>
          <dt class="text-[11px] tracking-[0.14em] text-ink-faint">工具 code</dt>
          <dd class="text-ink-muted tabular-nums mt-0.5">{{ code }}</dd>
        </div>
        <div>
          <dt class="text-[11px] tracking-[0.14em] text-ink-faint">数据源</dt>
          <dd class="text-ink-muted mt-0.5">{{ sourceLabel }}</dd>
        </div>
        <div>
          <dt class="text-[11px] tracking-[0.14em] text-ink-faint">分组</dt>
          <dd class="text-ink-muted mt-0.5">{{ group.label }}</dd>
        </div>
        <div>
          <dt class="text-[11px] tracking-[0.14em] text-ink-faint">状态</dt>
          <dd class="mt-0.5" :class="visual.tone">
            {{ visual.label }}<span v-if="state.message"> · {{ state.message }}</span>
          </dd>
        </div>
      </dl>

      <p v-if="tool?.unavailableHint" class="mt-5 text-xs text-ink-faint leading-relaxed">
        {{ tool.unavailableHint }}
      </p>
      <p class="mt-5 text-xs text-ink-faint leading-relaxed">
        该工具已登记在工具注册表(<code class="font-mono">src/tools/catalog.ts</code>),路由与首页入口均已生效;
        内容接入后替换视图组件即可,导航、路由、状态徽章无需改动。
      </p>
    </section>
  </div>
</template>
