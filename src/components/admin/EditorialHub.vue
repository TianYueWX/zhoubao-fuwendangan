<script setup lang="ts">
/**
 * EditorialHub.vue · 编辑部首页(后台总管)
 *
 * 报头刊名连点解锁后的落地页:列出编辑部下属的 5 个工具,选一个进入。
 * 版式与工具台(HomeView)同源 —— 同样的卡片栅格、编号、状态徽章,
 * 只是范围收窄到 editorial 分组,并把「未登录」翻译成门禁语。
 */
import { computed } from 'vue';
import { toolsOf } from '@/tools/catalog';
import type { ToolDef } from '@/tools/catalog';
import { navigate } from '@/router/hash';
import EditorialShell from './EditorialShell.vue';

/** 编辑部下属工具(hub 自身不计入) */
const entries = computed<ToolDef[]>(() => toolsOf('editorial').filter((t) => t.code !== 'editorial'));

/** 全局编号 01–NN,与工具台一致的报刊序号 */
const indexMap = computed(() => {
  const map = new Map<string, string>();
  entries.value.forEach((t, i) => map.set(t.code, String(i + 1).padStart(2, '0')));
  return map;
});

/** 每张卡的落款:说明该工具作用于哪些表,便于编务一眼定位 */
const TARGETS: Record<string, string> = {
  'editorial-cards': 'cards_base · card_prints',
  'editorial-batch': 'cards_base',
  'editorial-rules': 'rules',
  'editorial-resources': 'series · card_icons · version',
  'editorial-sync': '全表 · 官方接口 → Supabase'
};

function open(code: string): void {
  navigate({ view: code });
}
</script>

<template>
  <!-- hub 也必须过门禁:深链 #/editorial 的访客不能直接看到工具清单 -->
  <EditorialShell code="editorial">
    <div class="fade-in max-w-[980px] mx-auto">
      <section class="text-center pt-2 pb-9">
        <h1 class="font-display font-black text-ink leading-tight text-[30px] lg:text-[40px]">
          编辑部
        </h1>
        <div class="hairline mt-8"></div>
      </section>

      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        <button
          v-for="t in entries"
          :key="t.code"
          class="card card-hover text-left p-5 group/tool"
          :data-tool="t.code"
          @click="open(t.code)"
        >
          <div class="flex items-baseline justify-between gap-3">
            <span class="font-latin text-[11px] tracking-[0.22em] text-ink-faint tabular-nums">
              {{ indexMap.get(t.code) }}
            </span>
            <span
              v-if="t.badge"
              class="text-[10px] px-1.5 py-0.5 rounded border border-card-border text-ink-faint"
              >{{ t.badge }}</span
            >
          </div>
          <h2
            class="font-display font-bold text-ink text-[17px] mt-3 group-hover/tool:text-brand transition-colors"
          >
            {{ t.label }}
          </h2>
          <p class="text-xs text-ink-faint mt-1.5 leading-relaxed">{{ t.desc }}</p>
          <p class="text-[10px] font-mono text-ink-faint/80 mt-3">{{ TARGETS[t.code] ?? '' }}</p>
        </button>
      </div>

      <div class="hairline mt-10"></div>
      <p class="mt-5 text-[11px] text-ink-faint leading-relaxed max-w-[720px]">
        口径:所有写入经服务端行级安全策略(is_card_admin)校验,前端不做权限判断的最终依据。
        人工维护列(keyword / advanced_tag / deck_limit / *_en / tts_cdn 等)不会被数据同步覆盖。
      </p>
    </div>
  </EditorialShell>
</template>
