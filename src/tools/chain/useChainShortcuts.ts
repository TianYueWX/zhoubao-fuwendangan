/* ================================================================
 * src/tools/chain/useChainShortcuts.ts
 *
 * 结算链推演 —— 全局快捷键。
 *
 * 两条纪律:
 *   1. **输入框聚焦时一律让行**。盘位改名、搜索卡池、添加自定义卡都在
 *      输入框里发生,此时 Ctrl+S / Ctrl+Z 应该归浏览器或输入框自己,
 *      抢过来会让用户没法正常编辑。
 *   2. 只拦截真正处理掉的按键(调用 preventDefault),没处理的保持原样,
 *      避免破坏浏览器既有行为(如 Ctrl+P 打印)。
 *
 * 键位(与上游一致):
 *   Ctrl/Cmd + S  存快照(上游「保存快照 ctrl+s」)
 *   Ctrl/Cmd + Z  撤销
 *   Ctrl/Cmd + Y / Shift+Z  重做
 *   Ctrl/Cmd + P  切换演示模式
 *   Ctrl/Cmd + E  导出 JSON
 *   Ctrl/Cmd + F  全屏
 *   Esc           退出全屏 / 关闭浮层 / 退出演示(各组件自行处理)
 *   悬停 / 单击 / Ctrl  查看卡牌大图(在卡片组件里实现)
 * ============================================================== */

import { onUnmounted } from 'vue';

export interface ChainShortcutHandlers {
  /** Ctrl+S:存快照 */
  onSnapshot: () => void;
  /** Ctrl+Z:撤销 */
  onUndo: () => void;
  /** Ctrl+Y / Ctrl+Shift+Z:重做 */
  onRedo: () => void;
  /** Ctrl+P:切换演示模式 */
  onTogglePresentation: () => void;
  /** Ctrl+E:导出 JSON */
  onExport: () => void;
  /** Ctrl+F:全屏开关 */
  onToggleFullscreen: () => void;
}

/** 焦点是否落在可输入元素上 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable;
}

/**
 * 绑定快捷键。返回解绑函数(组件卸载时自动解绑)。
 */
export function useChainShortcuts(handlers: ChainShortcutHandlers): () => void {
  function onKeydown(e: KeyboardEvent): void {
    // 输入中不抢键
    if (isTypingTarget(e.target)) return;

    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;

    switch (e.key.toLowerCase()) {
      case 's':
        e.preventDefault();
        handlers.onSnapshot();
        return;
      case 'z':
        e.preventDefault();
        if (e.shiftKey) handlers.onRedo();
        else handlers.onUndo();
        return;
      case 'y':
        e.preventDefault();
        handlers.onRedo();
        return;
      case 'p':
        e.preventDefault();
        handlers.onTogglePresentation();
        return;
      case 'e':
        e.preventDefault();
        handlers.onExport();
        return;
      case 'f':
        e.preventDefault();
        handlers.onToggleFullscreen();
        return;
      default:
        return;
    }
  }

  window.addEventListener('keydown', onKeydown);
  const unbind = (): void => window.removeEventListener('keydown', onKeydown);
  onUnmounted(unbind);
  return unbind;
}
