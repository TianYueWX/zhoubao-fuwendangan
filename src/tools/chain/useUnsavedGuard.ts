/* ================================================================
 * src/tools/chain/useUnsavedGuard.ts
 *
 * 未保存拦截的统一出入口。
 *
 * 为什么单独抽一层:
 *   「切换盘位 / 新建 / 删除 / 离开工具页」四个入口都要面对同一个问题 ——
 *   有未保存改动时先问用户。如果每个入口各写一遍,迟早会漏掉一个,
 *   而漏掉的代价是用户丢数据。
 *
 * 用法:
 *   const guard = useUnsavedGuard();
 *   guard.guard('切换到「第二局」', () => switchPlay(id));   // 需要拦截的动作
 *   guard.guard(null, () => undo());                         // 不需要拦截
 *
 * 关键实现细节:动作被推迟到对话框里执行,因此 store 的当前盘位
 * 在用户点按钮之前不会变 —— 保存/放弃作用的都是同一个盘。
 * ============================================================== */

import { ref, type Ref } from 'vue';
import { dirty, discardChanges, savePlay } from './store';

export interface UnsavedGuard {
  /** 对话框是否打开 */
  open: Ref<boolean>;
  /** 即将发生的动作描述,用于对话框文案 */
  action: Ref<string>;
  /**
   * 执行一个可能被拦截的动作。
   * @param why    需要拦截时的动作描述;传 null 表示该动作无需保护
   * @param run    真正要执行的动作
   * @returns      是否立刻执行了(未拦截)
   */
  guard: (why: string | null, run: () => void) => boolean;
  /** 对话框三出口 */
  onSaveAndContinue: () => void;
  onDiscardAndContinue: () => void;
  onCancel: () => void;
}

export function useUnsavedGuard(): UnsavedGuard {
  const open = ref(false);
  const action = ref('');
  let pending: (() => void) | null = null;

  function guard(why: string | null, run: () => void): boolean {
    // 无未保存改动,或该动作声明不需要保护 → 直接执行
    if (!why || !dirty.value) {
      run();
      return true;
    }
    // 已经在问一个动作时不再叠加,后来的请求直接放行(避免对话框套娃)
    if (open.value) {
      run();
      return true;
    }
    action.value = why;
    pending = run;
    open.value = true;
    return false;
  }

  function finish(): void {
    const run = pending;
    pending = null;
    open.value = false;
    action.value = '';
    run?.();
  }

  function onSaveAndContinue(): void {
    savePlay();
    finish();
  }

  function onDiscardAndContinue(): void {
    discardChanges();
    finish();
  }

  function onCancel(): void {
    pending = null;
    open.value = false;
    action.value = '';
  }

  return { open, action, guard, onSaveAndContinue, onDiscardAndContinue, onCancel };
}
