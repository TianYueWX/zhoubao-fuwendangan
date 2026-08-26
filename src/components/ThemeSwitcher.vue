<script setup lang="ts">
import { useTheme } from '@/composables/useTheme';
import type { Theme } from '@/types';

const { preference, setPreference } = useTheme();

const options: ReadonlyArray<{ key: Theme; title: string; svg: string }> = [
  {
    key: 'light',
    title: '浅色模式',
    svg: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"></path>'
  },
  {
    key: 'system',
    title: '跟随系统',
    svg: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path>'
  },
  {
    key: 'dark',
    title: '深色模式',
    svg: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"></path>'
  }
];
</script>

<template>
  <div class="flex items-center bg-slate-100 dark:bg-slate-800 rounded-lg p-1 gap-1">
    <button
      v-for="opt in options"
      :key="opt.key"
      @click="setPreference(opt.key)"
      :title="opt.title"
      :class="[
        'theme-btn p-1.5 rounded-md hover:text-neutral-900 dark:hover:text-neutral-100',
        preference === opt.key
          ? 'active'
          : 'text-slate-500 dark:text-slate-400'
      ]"
    >
      <svg
        class="w-4 h-4"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        v-html="opt.svg"
      />
    </button>
  </div>
</template>
