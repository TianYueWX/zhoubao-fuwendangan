/* ================================================================
 * src/tools/admin/notice.ts
 *
 * 编辑部就地提示(替代 Element Plus 的 ElMessage 弹窗)。
 *
 * 站点规范 §7 要求「Error 就地红字 + 可重试,不整页失败」,
 * 所以不用漂浮 toast,而是编辑部内容区顶部的一条细线提示,可堆叠、自动消退。
 * 由 EditorialShell 统一挂载,各工具只管调用 notify()。
 * ============================================================== */

import { ref } from 'vue';

export type NoticeTone = 'ok' | 'warn' | 'error';

export interface Notice {
  id: number;
  tone: NoticeTone;
  text: string;
  /** 可选的补充说明(如「可重试」) */
  hint?: string;
}

export const notices = ref<Notice[]>([]);

let seq = 0;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

export function dismissNotice(id: number): void {
  notices.value = notices.value.filter((n) => n.id !== id);
  const t = timers.get(id);
  if (t) {
    clearTimeout(t);
    timers.delete(id);
  }
}

/**
 * 推一条提示。
 * @param ttl 毫秒;0 = 不自动消退(错误类建议 0,让编务看清)
 */
export function notify(tone: NoticeTone, text: string, ttl = 4000, hint?: string): number {
  const id = ++seq;
  notices.value = [...notices.value.slice(-4), { id, tone, text, hint }];
  if (ttl > 0) {
    timers.set(
      id,
      setTimeout(() => dismissNotice(id), ttl)
    );
  }
  return id;
}

export const notifyOk = (text: string, hint?: string): number => notify('ok', text, 3200, hint);
export const notifyWarn = (text: string, hint?: string): number => notify('warn', text, 5000, hint);
export const notifyError = (text: string, hint?: string): number => notify('error', text, 0, hint);

export function clearNotices(): void {
  for (const id of timers.keys()) clearTimeout(timers.get(id));
  timers.clear();
  notices.value = [];
}

/** 从异常里取一句人话 */
export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
