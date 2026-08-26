/* ================================================================
 * src/composables/useTheme.ts
 *
 * 三态主题 hook:Light / Dark / System
 *   - preference: 用户的选择(写 localStorage)
 *   - effective : 实际生效的暗 / 明
 *   - version   : 主题每次"生效变化"都自增,供 ECharts 实例订阅
 *   - 系统偏好变化时,若 preference === 'system' 自动跟随
 * ============================================================== */

import { ref, computed, watch, type ComputedRef } from 'vue';
import type { Theme, EffectiveTheme } from '@/types';

const STORAGE_KEY = 'riftbound-theme';

/* ---------- 模块级单例(整个应用共享同一份主题状态) ---------- */

function loadInitialPref(): Theme {
  if (typeof window === 'undefined') return 'system';
  try {
    const t = localStorage.getItem(STORAGE_KEY);
    if (t === 'light' || t === 'dark' || t === 'system') return t;
  } catch {
    /* localStorage 不可用,降级 system */
  }
  return 'system';
}

const preference = ref<Theme>(loadInitialPref());
const systemDark = ref<boolean>(false);
const version = ref(0);

let mediaQuery: MediaQueryList | null = null;

function effectiveNow(): EffectiveTheme {
  if (preference.value === 'dark') return 'dark';
  if (preference.value === 'light') return 'light';
  return systemDark.value ? 'dark' : 'light';
}

function syncHtmlClass(): void {
  if (typeof document === 'undefined') return;
  const eff = effectiveNow();
  document.documentElement.classList.toggle('dark', eff === 'dark');
  document.documentElement.classList.toggle('light', eff === 'light');
}

if (typeof window !== 'undefined') {
  mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  systemDark.value = mediaQuery.matches;
  mediaQuery.addEventListener('change', () => {
    systemDark.value = mediaQuery!.matches;
    if (preference.value === 'system') {
      syncHtmlClass();
      version.value += 1;
    }
  });
}

watch(preference, (val) => {
  try {
    localStorage.setItem(STORAGE_KEY, val);
  } catch {
    /* 隐私模式下 localStorage 写失败,忽略 */
  }
  syncHtmlClass();
  version.value += 1;
});

// 初始同步(以防 index.html 预加载脚本与本地状态不一致)
syncHtmlClass();

/* ---------- 对外 hook ---------- */

export function useTheme() {
  return {
    preference,
    effective: computed(effectiveNow) as ComputedRef<EffectiveTheme>,
    version,
    setPreference(t: Theme): void {
      preference.value = t;
    }
  };
}
