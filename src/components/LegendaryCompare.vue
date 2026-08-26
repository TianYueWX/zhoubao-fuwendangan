<script setup lang="ts">
/**
 * LegendaryCompare.vue · 最佳传奇排行横向对比(v3 新增)
 *  - 按指标(真实胜率/出场率/Top8 率)排序,取前 N 名(N 可调,默认前 2)并排对比
 *  - 每张卡:名次徽章 + 卡图(离线降级色块)+ 双色域 + 常用英雄 + 相对条形对比
 *  - 纯展示组件:数据由父级用 legendaryRows() 计算后注入
 */
import { computed, ref } from 'vue';
import type { LegendaryMetric, LegendaryRow } from '@/core/legendaryStats';
import { metricValue, sortLegendaryRows } from '@/core/legendaryStats';
import { CARD_COLOR_HEX } from '@/utils/palette';
import { CARD_COLOR_LABELS } from '@/types';

const props = withDefaults(
  defineProps<{
    rows: LegendaryRow[];
    /** 是否已有真实胜场数据(决定默认指标与提示文案) */
    hasWinData?: boolean;
  }>(),
  { hasWinData: false }
);

/** 实际生效指标:无胜场数据时强制退回出场率 */
const metric = ref<LegendaryMetric>(props.hasWinData ? 'winRate' : 'popularity');
const effectiveMetric = computed<LegendaryMetric>(() =>
  metric.value === 'winRate' && !props.hasWinData ? 'popularity' : metric.value
);

const topN = ref(2);
const TOP_N_OPTIONS = [2, 3, 5, 10] as const;

const metricOptions: ReadonlyArray<{ id: LegendaryMetric; label: string; disabled: boolean }> = [
  { id: 'winRate', label: '胜率·修正', disabled: false },
  { id: 'popularity', label: '出场率', disabled: false },
  { id: 'top8Rate', label: 'Top8 率', disabled: false }
];

const ranked = computed(() =>
  sortLegendaryRows(props.rows, effectiveMetric.value).slice(0, topN.value)
);

const maxValue = computed(() =>
  Math.max(1, ...ranked.value.map((r) => metricValue(r, effectiveMetric.value)))
);

function barWidth(r: LegendaryRow): string {
  const v = metricValue(r, effectiveMetric.value);
  return `${Math.max(4, (v / maxValue.value) * 100).toFixed(1)}%`;
}

/** 三指标条形固定色,保证跨卡可比 */
const BAR_COLORS: Readonly<Record<LegendaryMetric, string>> = {
  winRate: '#4cc38a',
  popularity: '#5b8def',
  top8Rate: '#e8b54a'
};

function fmt(v: number, digits = 1): string {
  return `${v.toFixed(digits)}%`;
}

const RANK_BADGES: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

const gridClass = computed(() => {
  const n = topN.value;
  if (n === 2) return 'grid-cols-1 md:grid-cols-2';
  if (n === 3) return 'grid-cols-1 md:grid-cols-3';
  return 'grid-cols-2 md:grid-cols-3 lg:grid-cols-5';
});

const imgFailed = ref<Set<string>>(new Set());
function onImgErr(cardNo: string): void {
  imgFailed.value = new Set(imgFailed.value).add(cardNo);
}
</script>

<template>
  <div class="panel rounded-2xl p-5">
    <!-- 头部:标题 + 指标/数量控制 -->
    <div class="flex items-start justify-between gap-3 flex-wrap mb-1">
      <div>
        <h3 class="text-lg font-bold text-slate-800 dark:text-white">⚔️ 最佳传奇 · 横向对比</h3>
        <p class="text-xs text-slate-400 mt-1">
          每套卡组由 1 张传奇定义双色域;对比 {{ topN }} 名最佳传奇的强度与热度
          <span v-if="!hasWinData" class="text-amber-500 dark:text-amber-400"
            >(未导入胜场,按出场率/Top8 率排序)</span
          ><span v-else class="text-slate-400">;胜率为贝叶斯收缩修正值(小样本向环境均值收缩)</span>
        </p>
      </div>
      <div class="flex items-center gap-2 flex-wrap shrink-0">
        <!-- 指标切换 -->
        <div class="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden text-xs">
          <button
            v-for="m in metricOptions"
            :key="m.id"
            class="px-3 py-1.5 font-medium transition-colors"
            :class="
              effectiveMetric === m.id
                ? 'bg-indigo-500 text-white'
                : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            "
            :disabled="m.id === 'winRate' && !hasWinData"
            :title="m.id === 'winRate' && !hasWinData ? '导入名次胜场(rank_data)后可用' : m.label"
            @click="metric = m.id"
          >
            {{ m.label }}
          </button>
        </div>
        <!-- TopN 选取 -->
        <div class="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden text-xs">
          <button
            v-for="n in TOP_N_OPTIONS"
            :key="n"
            class="px-2.5 py-1.5 font-medium transition-colors tabular-nums"
            :class="
              topN === n
                ? 'bg-indigo-500 text-white'
                : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            "
            @click="topN = n"
          >
            Top {{ n }}
          </button>
        </div>
      </div>
    </div>

    <!-- 对比卡片 -->
    <div v-if="ranked.length" :class="['grid gap-4 mt-4', gridClass]">
      <article
        v-for="(r, i) in ranked"
        :key="r.cardNo"
        class="card p-4 flex flex-col gap-3 relative"
      >
        <!-- 名次 -->
        <div class="flex items-center justify-between">
          <span
            class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-bold"
          >
            <span>{{ RANK_BADGES[i + 1] ?? `#${i + 1}` }}</span>
            <span class="tabular-nums">第 {{ i + 1 }} 名</span>
          </span>
          <span class="flex items-center gap-1">
            <span
              v-if="effectiveMetric === 'winRate' && r.total < 15"
              class="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400 text-[10px] font-medium"
              title="样本不足 15,胜率波动大,仅供参考"
              >样本少</span
            >
            <span
              v-if="r.isBanned"
              class="px-1.5 py-0.5 rounded bg-red-500 text-white text-[10px] font-bold"
              >禁</span
            >
          </span>
        </div>

        <!-- 卡图 + 身份 -->
        <div class="flex items-center gap-3">
          <div class="relative shrink-0">
            <div
              class="w-14 h-[78px] rounded-md overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
            >
              <div
                v-if="!r.imgUrl || imgFailed.has(r.cardNo)"
                class="w-full h-full flex items-center justify-center p-1 text-center"
                :style="{
                  background: `linear-gradient(135deg, ${
                    r.colors.length
                      ? r.colors.map((c) => CARD_COLOR_HEX[c]).join(', ')
                      : '#94a3b8, #64748b'
                  })`
                }"
              >
                <span class="text-white text-[9px] font-medium leading-tight line-clamp-3 drop-shadow">{{
                  r.name
                }}</span>
              </div>
              <img
                v-else
                :src="r.imgUrl"
                :alt="r.name"
                loading="lazy"
                class="w-full h-full object-cover"
                @error="onImgErr(r.cardNo)"
              />
            </div>
          </div>
          <div class="min-w-0 flex flex-col gap-1.5">
            <h4 class="font-bold text-sm text-slate-800 dark:text-white leading-tight line-clamp-2">
              {{ r.name }}
            </h4>
            <span class="text-[10px] text-slate-400 tabular-nums">
              {{ r.cardNo
              }}<template v-if="r.variants > 1"
                > · ×{{ r.variants }} 版本</template
              >
            </span>
            <!-- 双色域 -->
            <div class="flex items-center gap-1 flex-wrap">
              <span
                v-for="c in r.colors"
                :key="c"
                class="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700"
              >
                <i class="w-2 h-2 rounded-full" :style="{ background: CARD_COLOR_HEX[c] }"></i>
                {{ CARD_COLOR_LABELS[c] }}
              </span>
            </div>
          </div>
        </div>

        <!-- 常用英雄 -->
        <div class="flex items-center justify-between text-[11px]">
          <span class="text-slate-400">常用英雄</span>
          <span class="font-medium text-slate-600 dark:text-slate-300">
            {{ r.topHero }}
            <span class="text-slate-400 tabular-nums">· {{ r.topHeroRate.toFixed(0) }}%</span>
          </span>
        </div>

        <!-- 相对条形对比 -->
        <div class="flex flex-col gap-1.5 mt-auto">
          <div
            v-for="m in (['winRate', 'popularity', 'top8Rate'] as LegendaryMetric[])"
            :key="m"
            class="flex items-center gap-2"
            :title="`${r.name} · ${
              m === 'winRate'
                ? `胜率:修正 ${fmt(metricValue(r, m))} / 原始 ${
                    r.winRate != null ? fmt(r.winRate) : '—'
                  } (样本 ${r.total} 套,${r.rounds ?? 0} 轮)`
                : m === 'popularity'
                  ? `出场率: ${fmt(metricValue(r, m))}`
                  : `Top8 率: ${fmt(metricValue(r, m))}`
            }`"
          >
            <span class="w-12 shrink-0 text-[10px] text-slate-400 text-right tabular-nums">{{
              m === 'winRate' ? '胜率*' : m === 'popularity' ? '出场' : 'Top8'
            }}</span>
            <div class="flex-1 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div
                class="h-full rounded-full transition-all duration-500"
                :style="{ width: barWidth(r), background: BAR_COLORS[m] }"
              ></div>
            </div>
            <span class="w-11 shrink-0 text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">{{
              fmt(metricValue(r, m))
            }}</span>
          </div>
          <div class="text-[10px] text-slate-400 tabular-nums mt-0.5">
            样本 {{ r.total }} 套
            <span v-if="r.winRate != null && r.winRateAdj != null"
              >· 修正 {{ fmt(r.winRateAdj) }} / 原始 {{ fmt(r.winRate) }}</span
            >
          </div>
        </div>
      </article>
    </div>

    <!-- 空态 -->
    <div v-else class="h-32 flex items-center justify-center text-sm text-slate-400">
      暂无传奇数据(需导入赛事卡组与卡牌基础)
    </div>
  </div>
</template>
