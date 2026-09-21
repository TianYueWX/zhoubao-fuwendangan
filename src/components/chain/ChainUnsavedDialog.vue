<script setup lang="ts">
/**
 * ChainUnsavedDialog.vue · 未保存拦截对话框
 *
 * 出现的时机(宿主决定):
 *   - 切换盘位 / 新建盘位 / 删除当前盘位 / 离开结算链推演页
 *   - 浏览器关页与刷新由 store 的 beforeunload 处理(原生提示无法自定义)
 *
 * 三个出口的含义必须说清楚,否则用户会乱点:
 *   保存并继续 → 先落盘再执行原动作
 *   放弃改动   → 回滚到上次保存状态再执行原动作
 *   取消       → 什么都不做,留在原地
 */
defineProps<{
  open: boolean;
  /** 即将发生的动作描述,如「切换到『第二局』」 */
  action: string;
  /** 当前盘位名 */
  playName: string;
}>();

const emit = defineEmits<{
  (e: 'save'): void;
  (e: 'discard'): void;
  (e: 'cancel'): void;
}>();
</script>

<template>
  <div v-if="open" class="unsaved-mask" role="alertdialog" aria-modal="true" aria-labelledby="unsaved-title">
    <div class="unsaved-panel">
      <h3 id="unsaved-title">有未保存的改动</h3>
      <p class="unsaved-body">
        盘位「<b>{{ playName }}</b>」有尚未保存的改动。你要{{ action }}。
      </p>
      <p class="unsaved-tip">
        推演盘位存在本机浏览器,不落盘就关页会丢失。想留个副本可先点「保存并继续」。
      </p>
      <div class="unsaved-actions">
        <button type="button" class="btn-brand" @click="emit('save')">保存并继续</button>
        <button type="button" class="btn-ghost" @click="emit('discard')">放弃改动</button>
        <button type="button" class="btn-ghost" @click="emit('cancel')">取消</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.unsaved-mask {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: grid;
  place-items: center;
  padding: 24px;
  background: color-mix(in srgb, var(--color-text-primary) 40%, transparent);
}
.unsaved-panel {
  width: min(420px, 100%);
  padding: 20px;
  border: 1px solid var(--color-card-border);
  border-radius: 12px;
  background: var(--color-card-bg);
  box-shadow: 0 24px 50px -26px rgba(0, 0, 0, 0.45);
}
.unsaved-panel h3 {
  font-size: 16px;
  font-weight: 700;
  color: var(--color-text-primary);
  padding-bottom: 8px;
  margin-bottom: 10px;
  border-bottom: 1px solid var(--color-panel-border);
}
.unsaved-body {
  font-size: 13px;
  line-height: 1.7;
  color: var(--color-text-muted);
}
.unsaved-body b { color: var(--color-brand); }
.unsaved-tip {
  margin-top: 8px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--color-text-subtle);
}
.unsaved-actions {
  margin-top: 16px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.btn-ghost {
  font-size: 12px;
  padding: 6px 14px;
  border: 1px solid var(--color-panel-border);
  border-radius: 8px;
  color: var(--color-text-muted);
  background: var(--color-card-bg);
}
.btn-ghost:hover { border-color: var(--color-brand); color: var(--color-brand); }
</style>
