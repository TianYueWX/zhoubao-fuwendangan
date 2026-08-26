<script setup lang="ts">
/**
 * Drawer.vue · 右侧滑出抽屉
 */
import { watch } from 'vue';

const props = defineProps<{ open: boolean; title?: string; wide?: boolean }>();
const emit = defineEmits<{
  (e: 'update:open', v: boolean): void;
  (e: 'close'): void;
}>();

function close(): void {
  emit('update:open', false);
  emit('close');
}

watch(
  () => props.open,
  (v) => {
    if (typeof document !== 'undefined') {
      document.body.style.overflow = v ? 'hidden' : '';
    }
  }
);

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') close();
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-[90] flex justify-end"
      @keydown.esc="onKeydown"
    >
      <!-- 遮罩 -->
      <div
        class="absolute inset-0 bg-ink/35 backdrop-blur-sm"
        @click="close()"
      ></div>

      <!-- 面板 -->
      <div
        :class="[
          'relative h-full w-full shadow-2xl overflow-y-auto drawer-in',
          wide ? 'max-w-3xl' : 'max-w-lg'
        ]"
        :style="{ background: 'var(--color-drawer-bg)' }"
      >
        <div
          class="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b border-panel-border"
          :style="{ background: 'var(--color-drawer-bg)' }"
        >
          <h3 class="font-display font-bold text-ink truncate">
            {{ title }}
          </h3>
          <button
            @click="close()"
            class="w-8 h-8 rounded-lg hover:bg-ink/5 text-ink-faint hover:text-brand transition-colors shrink-0"
          >
            ✕
          </button>
        </div>
        <div class="p-5">
          <slot />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.drawer-in {
  animation: drawerIn 0.25s ease-out;
}
@keyframes drawerIn {
  from {
    transform: translateX(40px);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}
</style>
