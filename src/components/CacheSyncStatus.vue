<script setup lang="ts">
import { RefreshCw } from '@lucide/vue';
defineProps<{
  checking: boolean;
  stale: boolean;
  savedAt: string;
  error: string;
  disabled?: boolean;
}>();
defineEmits<{ refresh: [] }>();
</script>

<template>
  <div class="cache-sync-status" role="status">
    <span v-if="checking">正在检查资料版本…</span>
    <span v-else-if="stale">网络不可用，正在使用本地资料</span>
    <span v-else-if="savedAt">资料已同步</span>
    <span v-else-if="error">资料暂不可用</span>
    <button type="button" :disabled="disabled || checking" title="重新检查并更新资料" aria-label="重新检查并更新资料" @click="$emit('refresh')"><RefreshCw :size="15" aria-hidden="true" /></button>
  </div>
</template>

<style scoped>
.cache-sync-status { display: flex; align-items: center; gap: 7px; color: #89857b; font: 11px/1.4 system-ui, sans-serif; }
.cache-sync-status button { display: grid; flex: 0 0 25px; place-items: center; width: 25px; height: 25px; padding: 0; border-radius: 50%; color: #655f53; line-height: 1; }
.cache-sync-status button:hover { background: #0000000b; }
.cache-sync-status button:disabled { opacity: .45; cursor: default; }
</style>
