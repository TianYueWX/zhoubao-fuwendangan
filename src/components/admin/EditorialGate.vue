<script setup lang="ts">
/**
 * EditorialGate.vue · 编辑部门禁
 *
 * 未登录时取代全部编辑部内容。视觉沿用报刊版式:
 * 眉题 + 衬线标题 + 导语 + 发丝线,表单只用语义色,不引入图标与投影。
 *
 * 权限判定在服务端:登录后校验 app_metadata.role === 'admin',
 * 且所有写操作还要再过一遍 RLS 的 is_card_admin() 策略。
 * 这里只是一道门,不是锁。
 */
import { computed, onMounted, ref } from 'vue';
import { signIn, authState } from '@/tools/sources/auth';
import { isSupabaseConfigured } from '@/tools/sources/config';

const email = ref('');
const password = ref('');
const busy = ref(false);
const localError = ref('');
const emailInput = ref<HTMLInputElement | null>(null);

const configured = computed(() => isSupabaseConfigured());
const errorText = computed(() => localError.value || authState.error);

onMounted(() => {
  if (configured.value) emailInput.value?.focus();
});

async function submit(): Promise<void> {
  if (busy.value) return;
  localError.value = '';
  if (!email.value.trim() || !password.value) {
    localError.value = '请填写邮箱与密码';
    return;
  }
  busy.value = true;
  try {
    await signIn(email.value.trim(), password.value);
    password.value = '';
  } catch (e) {
    localError.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="fade-in max-w-[820px] mx-auto">
    <header>
      <h1 class="font-display font-black text-ink leading-tight text-[28px] lg:text-[38px]">
        编务门禁
      </h1>
      <div class="hairline mt-7"></div>
    </header>

    <!-- 未配置连接:按站点约定,「未配置」不是错误 -->
    <section v-if="!configured" class="mt-8 card p-6">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-[11px] px-1.5 py-0.5 rounded border border-card-border text-ink-faint">
          未配置
        </span>
        <span class="text-[11px] text-ink-faint">云端连接缺失</span>
      </div>
      <p class="mt-4 text-sm text-ink-muted leading-relaxed">
        编辑部需要 Supabase 连接。请在项目根目录创建
        <code class="font-mono text-[12px] px-1 py-0.5 rounded bg-brand-soft text-brand">.env.local</code>
        并填入下列两项,然后重启开发服务器:
      </p>
      <pre class="mt-3 text-[12px] leading-relaxed font-mono text-ink-muted bg-card-bg border border-card-border rounded-lg p-3 overflow-x-auto">VITE_SUPABASE_URL=https://&lt;project-ref&gt;.supabase.co
VITE_SUPABASE_ANON_KEY=&lt;anon / publishable key&gt;</pre>
      <p class="mt-3 text-[11px] text-ink-faint leading-relaxed">
        只用 anon / publishable key。service_role 绝不出现在浏览器端。
      </p>
    </section>

    <!-- 登录表单 -->
    <section v-else class="mt-8 card p-6 lg:p-7">
      <form class="max-w-[380px]" @submit.prevent="submit">
        <label class="block">
          <span class="text-[11px] tracking-[0.14em] text-ink-faint">邮箱</span>
          <input
            ref="emailInput"
            v-model="email"
            type="email"
            autocomplete="username"
            :disabled="busy"
            class="mt-1.5 w-full bg-card-bg border border-card-border rounded-lg px-3 py-2 text-sm text-ink transition-colors focus:border-brand focus:outline-none disabled:opacity-40"
            placeholder="you@example.com"
          />
        </label>

        <label class="block mt-4">
          <span class="text-[11px] tracking-[0.14em] text-ink-faint">密码</span>
          <input
            v-model="password"
            type="password"
            autocomplete="current-password"
            :disabled="busy"
            class="mt-1.5 w-full bg-card-bg border border-card-border rounded-lg px-3 py-2 text-sm text-ink transition-colors focus:border-brand focus:outline-none disabled:opacity-40"
            placeholder="••••••••"
          />
        </label>

        <!-- 就地报错,不整页失败(样式规范 §7) -->
        <p v-if="errorText" class="mt-4 text-[13px] text-delta-down leading-relaxed">
          {{ errorText }}
        </p>

        <button
          type="submit"
          class="btn-brand mt-6 w-full px-4 py-2 text-sm"
          :disabled="busy"
        >
          {{ busy ? '核对中…' : '登入编务' }}
        </button>
      </form>

      <div class="hairline mt-7"></div>
      <p class="mt-5 text-[11px] text-ink-faint leading-relaxed">
        管理员角色存放于
        <code class="font-mono">app_metadata.role</code>(服务端可写、用户不可篡改),
        而非 <code class="font-mono">user_metadata</code>。
        登入状态保存在本机浏览器,是全站唯一的本地持久化。
      </p>
    </section>
  </div>
</template>
