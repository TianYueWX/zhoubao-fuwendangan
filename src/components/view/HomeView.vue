<script setup lang="ts">
/**
 * HomeView.vue · 工具台(首页)
 *
 * 首页不再是期刊正文,而是**工具入口**:按分组陈列全部已登记工具,
 * 每个工具一张卡(编号 / 名称 / 说明 / 来源徽章 / 状态),点击进入其路由。
 *
 * 扩展方式:在 src/tools/catalog.ts 登记 + src/components/view/index.ts 映射组件,
 * 本页无需改动 —— 分组、徽章与状态全部由注册表与状态机驱动。
 * 期刊(周报)只是其中一个工具,不特殊对待。
 */
import { computed } from 'vue';
import { TOOL_GROUPS, toolsOf } from '@/tools/catalog';
import type { ToolDef, ToolStatus } from '@/tools/catalog';
import { getToolState, statusVisual } from '@/tools/state';
import { navigate } from '@/router/hash';
import { store } from '@/store/analysis';

/** 卡片编号:跨分组的全局序号,报刊式 01–NN */
const indexMap = computed(() => {
  const map = new Map<string, string>();
  let n = 0;
  for (const g of TOOL_GROUPS) {
    for (const t of toolsOf(g.id)) {
      n += 1;
      map.set(t.code, String(n).padStart(2, '0'));
    }
  }
  return map;
});

/** 分组是否存在可见工具 */
function groupTools(id: string): ToolDef[] {
  return toolsOf(id as never);
}

/**
 * 有效状态:把「状态机状态」与「本地数据是否已载入」合并成用户看得懂的一句话。
 *  - 需要数据的本地工具:未载入 → 需先载入;载入后 → 就绪
 *  - 云端工具:未配置 → 未配置(由数据源状态机给出)
 */
function effectiveStatus(t: ToolDef): { label: string; tone: string } {
  // 期刊本体:有数据包 = 有期刊可读;没有则「暂无期刊」
  if (t.code === 'journal') {
    return store.hasPackages
      ? { label: `已刊行 ${store.packages.length} 期`, tone: 'text-delta-up' }
      : { label: '暂无期刊', tone: 'text-ink-faint' };
  }
  // 数据管理:没有数据包时它才是"第一步"
  if (t.code === 'import') {
    return store.hasPackages
      ? { label: '可继续载入', tone: 'text-delta-up' }
      : { label: '第一步', tone: 'text-brand' };
  }
  // 需要数据包的本地分析工具
  if (t.needsData && t.source === 'local') {
    return store.hasPackages
      ? { label: '就绪', tone: 'text-delta-up' }
      : { label: '需先载入', tone: 'text-ink-faint' };
  }
  const v = statusVisual(getToolState(t.code).status);
  return { label: v.label, tone: v.tone };
}

function open(code: string): void {
  navigate({ view: code });
}
</script>

<template>
  <div class="fade-in">
    <!-- ══════════ 刊头 ══════════ -->
    <section class="max-w-[980px] mx-auto text-center pt-6 pb-10">
      <p class="eyebrow mb-3">Riftbound Meta Journal</p>
      <h1 class="font-display font-black text-ink leading-tight text-[34px] lg:text-[46px]">
        符文档案<span class="text-brand mx-1">·</span>周报
      </h1>
      <p class="standfirst mt-4 text-[15px] lg:text-base max-w-[620px] mx-auto">
        工具台:期刊归档与全部数据工具在此汇集 —— 载入赛事数据包即可生成当期周报,
        并对 meta 做逐层下钻。
      </p>
      <p v-if="store.hasPackages" class="mt-4 text-[11px] tracking-[0.18em] text-ink-faint">
        已载入 {{ store.packages.length }} 期 · 当前活动包「{{ store.sourceLabel }}」
      </p>
      <p v-else class="mt-4 text-[11px] tracking-[0.18em] text-ink-faint">
        尚未载入数据包 · 数据工具需先载入后可用
      </p>
      <div class="hairline mt-9"></div>
    </section>

    <!-- ══════════ 工具分区 ══════════ -->
    <div class="space-y-11">
      <section v-for="g in TOOL_GROUPS" :key="g.id">
        <template v-if="groupTools(g.id).length > 0">
          <div class="flex items-end justify-between gap-4 flex-wrap mb-5">
            <div>
              <span class="sec-kicker mb-2.5"></span>
              <h2 class="font-display font-bold text-xl text-ink">{{ g.label }}</h2>
              <p class="text-xs text-ink-faint mt-1.5">{{ g.desc }}</p>
            </div>
            <span class="font-latin text-[10px] tracking-[0.24em] text-ink-faint uppercase">
              {{ g.latin }}
            </span>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            <button
              v-for="t in groupTools(g.id)"
              :key="t.code"
              class="card card-hover text-left p-5 group/tool"
              :data-tool="t.code"
              :data-status="effectiveStatus(t).label"
              :data-group="t.group"
              @click="open(t.code)"
            >
              <div class="flex items-baseline justify-between gap-3">
                <span class="font-latin text-[11px] tracking-[0.22em] text-ink-faint tabular-nums">
                  {{ indexMap.get(t.code) }}
                </span>
                <span class="flex items-center gap-2">
                  <span
                    v-if="t.badge"
                    class="text-[10px] px-1.5 py-0.5 rounded border border-card-border text-ink-faint"
                    >{{ t.badge }}</span
                  >
                  <span class="text-[10px]" :class="effectiveStatus(t).tone">
                    {{ effectiveStatus(t).label }}
                  </span>
                </span>
              </div>
              <h3
                class="font-display font-bold text-ink text-[17px] mt-3 group-hover/tool:text-brand transition-colors"
              >
                {{ t.label }}
              </h3>
              <p class="text-xs text-ink-faint mt-1.5 leading-relaxed">{{ t.desc }}</p>
            </button>
          </div>
        </template>
      </section>
    </div>

    <div class="hairline mt-12"></div>
    <p class="mt-6 text-[11px] text-ink-faint leading-relaxed max-w-[820px]">
      栏目:期刊(本期与往期周报,及其全部数据工具)、云端内容(按需联网读取)、
      参考资料(随站点发布)。未接入内容的工具已登记在注册表中,状态如实标注。
    </p>
  </div>
</template>
