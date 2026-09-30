<script setup lang="ts">
/**
 * KeywordSuggest.vue · 单卡「从文本提取」的内联预览条
 *
 * 为什么不是点一下就写入:纯文本提取会误伤。线上真实例子 —— RAD-001
 * 业余爆破狂的正文是「打出炸弹指示物。(其具有{{部署}})」,`部署` 属于那个
 * 指示物,这张牌自己不是部署牌。这属于语义判断,算法拍不了板(编务确实会
 * 记录本牌「赋予他人」的关键词,如 SFD-197 的「你的黄沙士兵获得{{百炼}}」),
 * 所以一律先出清单、带命中上下文、勾选后并入。
 *
 * 两条约定:
 *   · **不弹模态框**,用内联批注条 —— 与 AdminBatchOps 的批量操作条同款;
 *   · **只加不删** —— kept 原样保留,orphan 只提示文本推不出,永不自动清掉。
 */
import { computed, ref, watch } from 'vue';
import type { KeywordHit } from '@/tools/admin/keywords';

const props = defineProps<{
  hits: KeywordHit[];
  /** 当前已有、建议里也有的词(保持不变) */
  kept: string[];
  /** 当前已有、但文本推不出来的词(只提示,不删) */
  orphan: string[];
}>();

const emit = defineEmits<{
  (e: 'apply', keywords: string[]): void;
  (e: 'cancel'): void;
}>();

const selected = ref<Set<string>>(new Set());

// 每次拿到新建议都重置为全选:默认相信提取结果,可疑项靠 suspect 徽章引导视线,
// 而不是替编务做决定。
watch(
  () => props.hits,
  (hits) => {
    selected.value = new Set(hits.map((h) => h.keyword));
  },
  { immediate: true }
);

const selectedCount = computed(
  () => props.hits.filter((h) => selected.value.has(h.keyword)).length
);

function toggle(kw: string): void {
  const next = new Set(selected.value);
  if (next.has(kw)) next.delete(kw);
  else next.add(kw);
  selected.value = next;
}

function apply(): void {
  // 按提取顺序交出去,保持与卡面文本一致的词序
  emit(
    'apply',
    props.hits.filter((h) => selected.value.has(h.keyword)).map((h) => h.keyword)
  );
}

/** 原文里的写法,供编务核对是哪一处标记 */
function markOf(h: KeywordHit): string {
  return h.from === 'cn' ? `{{${h.mark}}}` : `[${h.mark}]`;
}
</script>

<template>
  <div class="panel px-3.5 py-3 mt-2 fade-in" data-testid="keyword-suggest">
    <div class="flex items-baseline justify-between gap-3 mb-2">
      <span class="text-[11px] tracking-[0.14em] text-ink-faint">
        从文本提取到 {{ hits.length }} 个词<template v-if="selectedCount !== hits.length">
          ,已选 {{ selectedCount }}</template
        >
      </span>
      <button
        type="button"
        class="text-[11px] text-ink-faint hover:text-brand transition-colors shrink-0"
        @click="emit('cancel')"
      >
        取消
      </button>
    </div>

    <p v-if="!hits.length" class="text-[12px] text-ink-muted leading-relaxed">
      这张卡的正文里没有可提取的关键词<template v-if="orphan.length"
        >(现有的 {{ orphan.join('、') }} 是人工填的,不会被改动)</template
      >。
    </p>

    <ul v-else class="space-y-2">
      <li v-for="h in hits" :key="h.keyword" class="flex items-start gap-2.5">
        <input
          type="checkbox"
          class="mt-[3px] shrink-0 accent-brand"
          :checked="selected.has(h.keyword)"
          :aria-label="`并入 ${h.keyword}`"
          @change="toggle(h.keyword)"
        />
        <div class="min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-[13px] text-ink">{{ h.keyword }}</span>
            <span
              v-if="h.suspect"
              class="text-[10px] leading-none px-1.5 py-0.5 rounded border border-accent/40 text-accent-ink bg-accent/10"
              title="命中处的前文是「其具有 / 拥有…」这类转述句式,这个词可能属于别的牌或指示物"
            >
              疑似描述他人
            </span>
            <span class="text-[10px] font-mono text-ink-faint">{{ markOf(h) }}</span>
          </div>
          <p class="text-[11px] text-ink-faint leading-relaxed mt-0.5 break-words">
            {{ h.before }}<b class="text-ink-muted font-normal">{{ h.hit }}</b>{{ h.after }}
          </p>
        </div>
      </li>
    </ul>

    <p v-if="kept.length" class="text-[11px] text-ink-faint mt-2.5">
      已有、保持不变:{{ kept.join('、') }}
    </p>
    <p v-if="hits.length && orphan.length" class="text-[11px] text-ink-faint mt-1">
      文本推不出、不会动:{{ orphan.join('、') }}
    </p>

    <div class="flex items-center gap-2 mt-3">
      <button
        type="button"
        class="btn-brand px-3 py-1.5 text-xs"
        :disabled="!selectedCount"
        @click="apply"
      >
        并入{{ selectedCount ? ` ${selectedCount} 个` : '' }}
      </button>
      <button type="button" class="btn-ghost px-3 py-1.5 text-xs" @click="emit('cancel')">
        取消
      </button>
    </div>
  </div>
</template>
