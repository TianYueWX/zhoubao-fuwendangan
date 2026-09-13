<script setup lang="ts">
/**
 * ArchiveView.vue · 往期归档
 *
 * 全部期号(含本期)按期号从新到旧列出,按「赛季」分组;
 * 每张卡片与首页往期卡同构:期号 / 刊名 / 发布日期 / 日期区间 / 样本 / 3 条要点。
 */
import { computed } from 'vue';
import { store } from '@/store/analysis';
import { navigate } from '@/router/hash';
import type { IssueBrief } from '@/core/issue';

interface Group {
  season: string;
  issues: IssueBrief[];
}

const groups = computed<Group[]>(() => {
  const list = store.issueBriefs.slice().reverse(); // 新 → 旧
  const map = new Map<string, IssueBrief[]>();
  for (const b of list) {
    const season = store.packages.find((p) => p.id === b.id)?.season || '未标注赛季';
    const arr = map.get(season);
    if (arr) arr.push(b);
    else map.set(season, [b]);
  }
  return [...map.entries()].map(([season, issues]) => ({ season, issues }));
});

const total = computed(() => store.issueBriefs.length);

function openIssue(id: string): void {
  navigate({ view: 'issue', issueId: id });
}
</script>

<template>
  <div class="fade-in">
    <header class="max-w-[980px] mx-auto">
      <div class="flex items-center justify-between gap-4 flex-wrap text-[11px] text-ink-faint">
        <button class="hover:text-brand transition-colors" @click="navigate({ view: 'journal' })">
          ← 返回期刊
        </button>
        <span v-if="total" class="tabular-nums">共 {{ total }} 期</span>
      </div>
      <p class="eyebrow mt-7">Archive · 往期</p>
      <h1 class="font-display font-black text-ink leading-tight mt-3 text-[28px] lg:text-[38px]">
        往期期刊
      </h1>
      <p class="standfirst mt-4 text-[15px]">
        每一期对应一个已载入的数据包,按期号从新到旧排列。点击卡片进入该期周报正文。
      </p>
      <div class="hairline mt-7"></div>
    </header>

    <!-- 空态 -->
    <div v-if="total === 0" class="max-w-[620px] mx-auto text-center py-16">
      <p class="text-sm text-ink-muted leading-relaxed">
        还没有任何期刊。上传第一份赛事数据包后,这里会按期归档。
      </p>
      <button class="btn-brand mt-5 px-5 py-2 text-sm" @click="navigate({ view: 'import' })">
        去数据管理载入数据包
        <span aria-hidden="true">→</span>
      </button>
    </div>

    <!-- 分期列表 -->
    <div v-else class="mt-10 space-y-12">
      <section v-for="g in groups" :key="g.season">
        <div class="flex items-baseline gap-4 mb-5">
          <h2 class="font-display font-bold text-ink text-lg">{{ g.season }}</h2>
          <span class="text-[11px] text-ink-faint tabular-nums">{{ g.issues.length }} 期</span>
          <span class="flex-1 hairline"></span>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <article
            v-for="b in g.issues"
            :key="b.id"
            class="card card-hover p-5 flex flex-col cursor-pointer"
            @click="openIssue(b.id)"
          >
            <div class="flex items-baseline justify-between gap-3">
              <span class="eyebrow">{{ b.issueNo }}</span>
              <span class="text-[10px] text-ink-faint font-latin tracking-[0.18em] uppercase">
                {{ b.roman }}
              </span>
            </div>
            <h3 class="font-display font-bold text-ink text-[17px] leading-snug mt-2.5">
              {{ b.headline }}
            </h3>
            <p class="text-[11px] text-ink-faint tabular-nums mt-1.5">
              {{ b.dateRangeText }} · 样本 {{ b.sample }} · 赛事 {{ b.eventCount }}
            </p>
            <ul class="mt-3.5 space-y-1.5 flex-1">
              <li
                v-for="(bl, i) in b.bullets"
                :key="i"
                class="flex items-baseline gap-2 text-[12px] text-ink-muted leading-relaxed border-b border-[rgba(59,74,90,0.08)] pb-1.5 last:border-0"
              >
                <span
                  class="shrink-0 w-3 text-center tabular-nums"
                  :class="
                    bl.delta == null
                      ? 'text-ink-faint'
                      : bl.delta > 0
                        ? 'text-delta-up'
                        : 'text-delta-down'
                  "
                  >{{ bl.mark }}</span
                >
                <span class="min-w-0">{{ bl.text }}</span>
              </li>
            </ul>
            <span class="text-[11px] text-brand font-medium mt-3">阅读本期 →</span>
          </article>
        </div>
      </section>
    </div>
  </div>
</template>
