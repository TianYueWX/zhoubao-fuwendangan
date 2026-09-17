/* ================================================================
 * src/tools/editorialAccess.ts
 *
 * 编辑部的「暗门」状态。
 *
 * 编辑部是内容后台,不该出现在公开资料站的导航里。它靠一个彩蛋解锁:
 * **连点报头刊名 KNOCK_TARGET 次(每次间隔不超过 KNOCK_WINDOW_MS)**
 * 即可让「编辑部」出现在栏目导航中。
 *
 * 设计约束:
 *   - 解锁是**持久**的(localStorage):否则每次刷新都要重新敲一遍暗门。
 *   - 解锁只是「看见入口」,**不等于有权限** —— 真正的门禁是登录 +
 *     服务端 RLS 策略,这里只负责藏。
 *   - 敲击进度只在第 2 下之后才显示(报头刊名下方长出一条朱砂细线),
 *     偶发的一次误点看不出任何异常。
 * ============================================================== */

import { ref } from 'vue';

/** 需要连点几次 */
export const KNOCK_TARGET = 5;
/** 相邻两次点击的最大间隔(毫秒),超时则计数归零 */
export const KNOCK_WINDOW_MS = 3000;

const UNLOCK_KEY = 'riftbound-editorial-unlocked';

/** 是否已解锁编辑部入口 */
export const editorialUnlocked = ref(false);

/** 当前敲击进度(0–KNOCK_TARGET),仅供报头细线使用 */
export const knockProgress = ref(0);

export function loadEditorialUnlock(): boolean {
  try {
    const on = localStorage.getItem(UNLOCK_KEY) === '1';
    editorialUnlocked.value = on;
    return on;
  } catch {
    editorialUnlocked.value = false;
    return false;
  }
}

export function unlockEditorial(): void {
  editorialUnlocked.value = true;
  knockProgress.value = 0;
  try {
    localStorage.setItem(UNLOCK_KEY, '1');
  } catch {
    /* 隐私模式:本次会话内有效,刷新后需重新敲 */
  }
}

/** 撤回入口(调试/演示用;不影响已登录会话) */
export function lockEditorial(): void {
  editorialUnlocked.value = false;
  knockProgress.value = 0;
  try {
    localStorage.removeItem(UNLOCK_KEY);
  } catch {
    /* ignore */
  }
}

/* ──────────────────────────── 敲击计数 ──────────────────────────── */

let lastKnockAt = 0;
let decayTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleDecay(): void {
  if (decayTimer) clearTimeout(decayTimer);
  decayTimer = setTimeout(() => {
    knockProgress.value = 0;
    decayTimer = null;
  }, KNOCK_WINDOW_MS);
}

/**
 * 记一次敲击。
 * @returns 'already' 此前已解锁(调用方应走正常行为,不要误判为刚解锁)
 *          'unlocked' 本次刚好解锁
 *          'progress' 仅累计进度
 */
export function knock(): 'already' | 'unlocked' | 'progress' {
  if (editorialUnlocked.value) return 'already';

  const now = Date.now();
  // 间隔超时 → 重新计数(所以慢悠悠点 5 下不算)
  if (now - lastKnockAt > KNOCK_WINDOW_MS) knockProgress.value = 0;
  lastKnockAt = now;
  knockProgress.value += 1;

  if (knockProgress.value >= KNOCK_TARGET) {
    unlockEditorial();
    if (decayTimer) {
      clearTimeout(decayTimer);
      decayTimer = null;
    }
    return 'unlocked';
  }
  scheduleDecay();
  return 'progress';
}

/** 进度百分比(0–100),报头细线宽度用 */
export function knockPercent(): number {
  return Math.min(100, Math.round((knockProgress.value / KNOCK_TARGET) * 100));
}
