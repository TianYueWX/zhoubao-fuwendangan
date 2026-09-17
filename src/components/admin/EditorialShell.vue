<script setup lang="ts">
/**
 * EditorialShell.vue · 编辑部通用外壳
 *
 * 三层判定,由外到内:
 *   ① 未配置 Supabase → 说明卡(未配置不是错误)
 *   ② 恢复会话中     → 一行文案进度(不用旋转器)
 *   ③ 未登录/非管理员 → EditorialGate 门禁页
 *   ④ 已通过          → 署名条 + 插槽内容
 *
 * 5 个编辑部工具全部套这层,权限逻辑只写一遍。
 */
import { computed } from 'vue';
import { authState, isEditorialAdmin, signOut } from '@/tools/sources/auth';
import { isSupabaseConfigured } from '@/tools/sources/config';
import EditorialGate from './EditorialGate.vue';
import AdminNotices from './AdminNotices.vue';

defineProps<{ code?: string }>();

const configured = computed(() => isSupabaseConfigured());
const restoring = computed(() => authState.status === 'restoring');
const email = computed(() => authState.session?.email ?? '');

async function logout(): Promise<void> {
  await signOut();
}
</script>

<template>
  <!-- ① 未配置 -->
  <EditorialGate v-if="!configured" />

  <!-- ② 恢复会话中 -->
  <div v-else-if="restoring" class="fade-in max-w-[820px] mx-auto py-16 text-center">
    <p class="text-sm text-ink-faint">正在核对编务凭据…</p>
  </div>

  <!-- ③ 门禁 -->
  <EditorialGate v-else-if="!isEditorialAdmin" />

  <!-- ④ 已登入 -->
  <div v-else class="fade-in">
    <div class="flex items-center justify-between gap-4 flex-wrap mb-6 text-[11px]">
      <span class="text-ink-faint">
        编务凭据有效 · <b class="text-ink-muted font-normal">{{ email }}</b>
      </span>
      <button class="text-ink-faint hover:text-brand transition-colors" @click="logout">
        退出编务
      </button>
    </div>
    <!-- 全编辑部共用的就地提示区(见 tools/admin/notice.ts) -->
    <AdminNotices />
    <slot />
  </div>
</template>
