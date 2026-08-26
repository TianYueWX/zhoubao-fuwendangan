/* ================================================================
 * src/composables/useDebouncedRef.ts
 * 防抖响应式 ref:写入立即生效,触发 trigger() 在 delay ms 内合并
 * 用于 DataTable 的搜索框等需要"输入稳定后才真正消费"的场景
 * ============================================================== */

import { customRef } from 'vue';

export function useDebouncedRef<T>(initial: T, delay = 200) {
  let value = initial;
  let timer: ReturnType<typeof setTimeout> | null = null;

  return customRef<T>((track, trigger) => ({
    get(): T {
      track();
      return value;
    },
    set(newValue: T): void {
      value = newValue;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        trigger();
      }, delay);
    }
  }));
}
