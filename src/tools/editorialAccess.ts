/** 编辑部隐藏入口:依次点击「符 → 文 → 档 → 案」。
 * 这里只控制入口状态;管理员登录与服务端权限校验保持独立。
 */
import { ref } from 'vue';

/** 需要连点几次 */
export const KNOCK_TARGET = 4;
/** 相邻两次点击的最大间隔(毫秒),超时则计数归零 */
export const KNOCK_WINDOW_MS = 3000;

const UNLOCK_KEY = 'riftbound-editorial-unlocked';

/** 当前标签页会话是否已解锁入口;刷新可恢复,不长期保存。 */
export const editorialUnlocked = ref(false);

/** 当前敲击进度(0–KNOCK_TARGET),用于验证四字顺序 */
export const knockProgress = ref(0);

export function loadEditorialUnlock(): boolean {
  try {
    const on = sessionStorage.getItem(UNLOCK_KEY) === '1';
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
    sessionStorage.setItem(UNLOCK_KEY, '1');
  } catch {
    /* 存储不可用时仅保留内存状态,刷新后需重新解锁。 */
  }
}

/** 撤回入口(调试/演示用;不影响已登录会话) */
export function lockEditorial(): void {
  editorialUnlocked.value = false;
  knockProgress.value = 0;
  try {
    sessionStorage.removeItem(UNLOCK_KEY);
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

/** 离开首页或点击顺序错误时清理进度。 */
export function resetKnock(): void {
  knockProgress.value = 0;
  lastKnockAt = 0;
  if (decayTimer) clearTimeout(decayTimer);
  decayTimer = null;
}

/** 每次都验证完整顺序,解锁后显示入口,不自动跳转。 */
export function knock(characterIndex: number): 'unlocked' | 'progress' {
  const now = Date.now();
  if (now - lastKnockAt > KNOCK_WINDOW_MS) resetKnock();
  lastKnockAt = now;

  if (characterIndex !== knockProgress.value) {
    resetKnock();
    if (characterIndex !== 0) return 'progress';
    lastKnockAt = now;
  }
  knockProgress.value += 1;
  if (knockProgress.value === KNOCK_TARGET) {
    resetKnock();
    unlockEditorial();
    return 'unlocked';
  }
  scheduleDecay();
  return 'progress';
}
