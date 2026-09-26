<script setup lang="ts">
/**
 * AdminConfirmButton.vue · 就地二次确认
 *
 * 替代 ElMessageBox。规范禁止用浮层打断,且「危险操作要点两下」本身就足够
 * 表达意图 —— 第一次点击把按钮变成「确认删除 / 取消」,4 秒内不确认自动复位。
 * 不用弹窗,也就没有焦点陷阱与遮罩层要维护。
 */
import { onBeforeUnmount, ref } from 'vue';

withDefaults(
  defineProps<{
    label?: string;
    confirmLabel?: string;
    disabled?: boolean;
    /** 供验收脚本定位；确认态按钮自动加 -confirm 后缀 */
    testid?: string;
  }>(),
  { label: '删除', confirmLabel: '确认删除' }
);

const emit = defineEmits<{ (e: 'confirm'): void }>();

const armed = ref(false);
let timer: ReturnType<typeof setTimeout> | null = null;

function clearTimer(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

function onClick(): void {
  if (!armed.value) {
    armed.value = true;
    clearTimer();
    timer = setTimeout(() => (armed.value = false), 4000);
    return;
  }
  clearTimer();
  armed.value = false;
  emit('confirm');
}

function cancel(): void {
  clearTimer();
  armed.value = false;
}

onBeforeUnmount(clearTimer);
</script>

<template>
  <template v-if="!armed">
    <button
      class="text-[12px] text-ink-faint hover:text-brand transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      :disabled="disabled"
      :data-testid="testid"
      @click="onClick"
    >
      {{ label }}
    </button>
  </template>
  <template v-else>
    <span class="inline-flex items-center gap-2.5">
      <button
        class="text-[12px] font-semibold text-brand hover:underline transition-colors"
        :data-testid="testid ? `${testid}-confirm` : undefined"
        @click="onClick"
      >
        {{ confirmLabel }}
      </button>
      <button class="text-[12px] text-ink-faint hover:text-ink-muted transition-colors" @click="cancel">
        取消
      </button>
    </span>
  </template>
</template>
