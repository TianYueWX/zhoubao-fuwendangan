/* ================================================================
 * src/utils/debounce.ts
 * 通用节流 / 防抖工具(Vue 3 响应式系统可以直接用 ref / watch 包装,
 * 本工具保留以兼容"非 watch"路径,如第三方 onMounted 内部回调)
 * ============================================================== */

export type DebouncedFn<TArgs extends readonly unknown[]> = ((
  ...args: TArgs
) => void) & {
  cancel: () => void;
  flush: () => void;
};

/**
 * 防抖:在停止触发 wait 毫秒后才真正调用。
 * - leading=false / trailing=true(默认)与 lodash 行为一致
 */
export function debounce<TArgs extends readonly unknown[]>(
  fn: (...args: TArgs) => void,
  wait: number
): DebouncedFn<TArgs> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: TArgs | null = null;

  const wrapped = ((...args: TArgs) => {
    lastArgs = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (lastArgs) fn(...lastArgs);
    }, wait);
  }) as DebouncedFn<TArgs>;

  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  wrapped.flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (lastArgs) fn(...lastArgs);
  };

  return wrapped;
}

/**
 * 节流:保证 interval 毫秒内最多调用一次。
 */
export function throttle<TArgs extends readonly unknown[]>(
  fn: (...args: TArgs) => void,
  interval: number
): (...args: TArgs) => void {
  let lastCall = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: TArgs | null = null;

  return (...args: TArgs) => {
    const now = Date.now();
    const elapsed = now - lastCall;
    lastArgs = args;
    if (elapsed >= interval) {
      lastCall = now;
      fn(...args);
      lastArgs = null;
    } else if (!timer) {
      timer = setTimeout(() => {
        lastCall = Date.now();
        timer = null;
        if (lastArgs) {
          fn(...lastArgs);
          lastArgs = null;
        }
      }, interval - elapsed);
    }
  };
}
