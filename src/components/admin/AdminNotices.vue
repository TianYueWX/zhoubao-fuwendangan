<script setup lang="ts">
/**
 * AdminNotices.vue · 编辑部就地提示
 *
 * 替代 Element Plus 的 ElMessage。规范 §7 要求「就地报错、不整页失败」,
 * 因此这里不是漂浮 toast,而是内容区顶部的一组细线提示:左侧 2px 竖线定调
 * (成功=黛绿 / 留意=藤黄 / 未成=朱砂),可堆叠、可手动收起、自动消退。
 */
import { dismissNotice, notices, type NoticeTone } from '@/tools/admin/notice';

const TONE: Record<NoticeTone, { rule: string; text: string; label: string }> = {
  ok: { rule: 'bg-delta-up', text: 'text-ink-muted', label: '已记' },
  warn: { rule: 'bg-accent', text: 'text-ink-muted', label: '留意' },
  error: { rule: 'bg-brand', text: 'text-delta-down', label: '未成' }
};
</script>

<template>
  <div v-if="notices.length" class="mb-7 space-y-2.5" role="status" aria-live="polite">
    <div
      v-for="n in notices"
      :key="n.id"
      class="flex items-start gap-3 pl-3 border-l-2"
      :class="TONE[n.tone].rule"
    >
      <div class="flex-1 min-w-0">
        <p class="text-[13px] leading-relaxed" :class="TONE[n.tone].text">
          <span class="text-[10px] tracking-[0.16em] mr-2 opacity-60">{{
            TONE[n.tone].label
          }}</span>
          {{ n.text }}
        </p>
        <p v-if="n.hint" class="text-[11px] text-ink-faint mt-1 leading-relaxed">{{ n.hint }}</p>
      </div>
      <button
        class="text-ink-faint hover:text-brand text-xs shrink-0 transition-colors"
        title="收起"
        @click="dismissNotice(n.id)"
      >
        ✕
      </button>
    </div>
  </div>
</template>
