/* ================================================================
 * src/tools/chain/useChainDnd.ts
 *
 * 结算链推演的拖拽层 —— 纯 Pointer Events 手势实现。
 *
 * 演进过程(两次踩坑,都记在这里以免重蹈):
 *
 *   1) 最初用 SortableJS。挂在**区域容器**上的实例收不到 pointerdown:
 *      容器上有监听器但处理器从不执行,同页面同配置挂在卡池上却正常,
 *      换容器、重建实例均无效。行为无法解释,弃用。
 *
 *   2) 改为 HTML5 原生拖拽(draggable=true + dragstart/dragover/drop)。
 *      用 CDP 的 Input.setInterceptDrags + dispatchDragEvent 验收"全过"——
 *      但那是**绕过浏览器原生拖拽机制的合成链路**,只证明了 drop 处理逻辑
 *      正确,**从未证明真实鼠标手势能触发 dragstart**。实际使用中完全拖不动。
 *      教训:验收方式必须覆盖被测机制的入口,否则等于没测。
 *
 *   3) 现在:Pointer Events 手势。不依赖任何浏览器拖拽机制,
 *      鼠标与触屏走**同一条**代码路径,拖影、落点高亮、插入位置全部自己算。
 *      完全可控、可预测,而且能在无头环境里用真实 pointer 事件端到端验证。
 *
 * 实现要点:
 *   - 事件委托:只在 document 上挂一组监听器,900+ 张卡也没有额外开销。
 *   - 拖动阈值 6px:低于阈值视为点击(卡片要能单击看大图),
 *     因此点击与拖拽互不干扰。
 *   - setPointerCapture:指针移出卡片甚至移出窗口也不丢事件。
 *   - 拖影是 fixed 且高 z-index,会挡住命中判定,取落点前先临时隐藏它。
 * ============================================================== */

import { onUnmounted, ref, type Ref } from 'vue';
import type { ChainAreaKey } from './types';

export interface ChainDndHandlers {
  /** 区域内重排:传入拖拽结束后的 uid 顺序 */
  reorder: (area: ChainAreaKey, order: string[]) => void;
  /** 盘内已有卡跨区移动 */
  move: (uid: string, toArea: ChainAreaKey, toIndex: number) => void;
  /** 从卡池/自定义池克隆一张新卡进区域 */
  clone: (sourceUid: string, toArea: ChainAreaKey, toIndex: number) => void;
  /** 把盘内的卡拖回卡池 = 移出棋盘 */
  remove: (uid: string) => void;
  /**
   * 该区域是否还能再放一张。
   * 容量检查必须在这里做:它依赖当前条数,通用拖拽库都表达不了
   * 「结算中限 1 张」这种规则。
   */
  canAccept: (area: ChainAreaKey) => boolean;
  /** 超容量被退回时的提示 */
  onRejected: (area: ChainAreaKey) => void;
}

export interface ChainDndOptions {
  /** 六个区域的容器 ref(按区名索引) */
  zoneRefs: Record<ChainAreaKey, Ref<HTMLElement | null>>;
  /** 卡池容器的 ref(拖回此处 = 移出棋盘) */
  customPoolRef: Ref<HTMLElement | null>;
  handlers: ChainDndHandlers;
  /** 挂载失败时的回调(宿主用 toast 告知用户,而不是静默失效) */
  onError?: (message: string) => void;
}

export interface ChainDndController {
  mount: () => Promise<void>;
  destroy: () => void;
  isMounted: () => boolean;
  lastMountError: () => string;
  /** 当前是否正在拖拽(供宿主显示提示与关闭预览浮层) */
  isDragging: Ref<boolean>;
}

/** 卡片节点统一属性名(盘内卡与卡池模板都用它) */
const UID_ATTR = 'data-uid';

/** 拖拽期间挂在 <html> 上的类,用于统一改光标 */
const DRAGGING_CLASS = 'chain-dragging-active';

/** 判定为「拖拽」而非「点击」的位移阈值(px) */
const DRAG_THRESHOLD = 6;

/** 拖影宽度(px) */
const GHOST_WIDTH = 200;

interface DragPayload {
  /** 卡片 uid:盘内卡为 'c-N',卡池为 'pool:编号',自定义为 'custom:ID' / 'effect:ID' */
  uid: string;
  /** 来源区域;null = 来自卡池(应克隆而非移动) */
  fromArea: ChainAreaKey | null;
}

/** 从事件目标回溯到卡片元素 */
function cardFromTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>(`[${UID_ATTR}]`);
}

/** 从事件目标回溯到区域 key;落在卡池等非区域落点上时返回 null */
function areaFromTarget(target: EventTarget | null): ChainAreaKey | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest<HTMLElement>('[data-drop-area]');
  const key = el?.dataset.dropArea;
  if (!key) return null;
  return key === 'pool' || key === 'custom-pool' ? null : (key as ChainAreaKey);
}

/** 落点是否是卡池(拖回卡池 = 移出棋盘) */
function onPoolTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !!target.closest('[data-drop-area="pool"], [data-drop-area="custom-pool"]');
}

/** 卡池模板的 uid 都有前缀,盘内实例一律是 'c-N' */
function isTemplate(uid: string): boolean {
  return !uid.startsWith('c-');
}

export function useChainDnd(options: ChainDndOptions): ChainDndController {
  const { zoneRefs, handlers } = options;

  const isDragging = ref(false);
  let mounted = false;
  let lastError = '';

  let payload: DragPayload | null = null;
  /** 是否已越过阈值、进入真正的拖拽态 */
  let active = false;
  /** 按下时的坐标与来源节点,用于阈值判定与拖影定位 */
  let start = { x: 0, y: 0 };
  let sourceEl: HTMLElement | null = null;
  let ghost: HTMLElement | null = null;
  let highlighted: HTMLElement | null = null;
  let poolHighlighted: HTMLElement | null = null;

  /* ──────────────── 视觉反馈 ──────────────── */

  function clearZoneHighlight(): void {
    if (highlighted) {
      highlighted.classList.remove('chain-drop-active');
      highlighted = null;
    }
  }

  function setZoneHighlight(area: ChainAreaKey | null): void {
    const el = area ? (zoneRefs[area]?.value ?? null) : null;
    if (el === highlighted) return;
    clearZoneHighlight();
    if (el) {
      el.classList.add('chain-drop-active');
      highlighted = el;
    }
  }

  function setPoolHighlight(on: boolean): void {
    const el = options.customPoolRef.value?.closest<HTMLElement>('.chain-pool') ?? null;
    if (on) {
      if (el && el !== poolHighlighted) {
        poolHighlighted?.classList.remove('chain-pool-drop-active');
        el.classList.add('chain-pool-drop-active');
        poolHighlighted = el;
      }
      return;
    }
    if (poolHighlighted) {
      poolHighlighted.classList.remove('chain-pool-drop-active');
      poolHighlighted = null;
    }
  }

  /* ──────────────── 拖影 ──────────────── */

  function makeGhost(from: HTMLElement): HTMLElement {
    const node = from.cloneNode(true) as HTMLElement;
    node.classList.add('chain-touch-ghost');
    node.style.position = 'fixed';
    node.style.pointerEvents = 'none';
    node.style.zIndex = '9999';
    node.style.opacity = '0.9';
    node.style.width = `${GHOST_WIDTH}px`;
    node.style.margin = '0';
    node.style.left = '-9999px';
    node.style.top = '-9999px';
    document.body.appendChild(node);
    return node;
  }

  function moveGhost(x: number, y: number): void {
    if (!ghost) return;
    // 拖影跟随指针并夹在视口内,贴边时也不会看不见
    const w = ghost.offsetWidth || GHOST_WIDTH;
    const h = ghost.offsetHeight || 60;
    const left = Math.min(Math.max(8, x - w / 2), Math.max(8, window.innerWidth - w - 8));
    const top = Math.min(Math.max(8, y - h / 2), Math.max(8, window.innerHeight - h - 8));
    ghost.style.left = `${left}px`;
    ghost.style.top = `${top}px`;
  }

  /**
   * 取指针位置下的落点。
   * 拖影是 fixed + 高 z-index,肯定会挡住命中测试,所以先临时藏起来。
   */
  function dropTargetAt(x: number, y: number): { area: ChainAreaKey | null; pool: boolean } {
    if (ghost) ghost.style.display = 'none';
    const under = document.elementFromPoint(x, y);
    if (ghost) ghost.style.display = '';
    return { area: areaFromTarget(under), pool: onPoolTarget(under) };
  }

  /**
   * 依据指针坐标算出应插入的下标。
   *
   * 取目标区内每张卡的主轴中点,指针落在哪张之前就插到它的位置,都不满足
   * 则追加到末尾。比按位移估算直观,也没有「往后拖差一位」的经典偏移。
   */
  function dropIndexAt(area: ChainAreaKey, x: number, y: number): number {
    const zoneEl = zoneRefs[area]?.value;
    if (!zoneEl) return 0;
    const horizontal = zoneEl.classList.contains('zone-chain');
    const cards = Array.from(zoneEl.querySelectorAll<HTMLElement>(`[${UID_ATTR}]`));
    let index = 0;
    for (const card of cards) {
      if (card === sourceEl) continue; // 拖自己不算落点
      const r = card.getBoundingClientRect();
      const mid = horizontal ? r.left + r.width / 2 : r.top + r.height / 2;
      const pos = horizontal ? x : y;
      if (pos < mid) return index;
      index += 1;
    }
    return index;
  }

  /* ──────────────── 手势 ──────────────── */

  function onDragSuppressClick(e: MouseEvent): void {
    // 拖拽结束时浏览器会在落点上补发一次 click。若不吞掉,它会命中卡片的
    // 单击处理(弹出并"钉住"大图浮层),浮层随即盖住卡片,下一次就拖不动了。
    e.stopPropagation();
    e.preventDefault();
  }

  function beginDrag(x: number, y: number): void {
    active = true;
    isDragging.value = true;
    // 拖拽期间任何预览浮层都必须让位,否则它会挡住指针命中判定
    document.addEventListener('click', onDragSuppressClick, true);
    document.documentElement.classList.add(DRAGGING_CLASS);
    if (sourceEl) {
      sourceEl.classList.add('chain-dragging');
      ghost = makeGhost(sourceEl);
      moveGhost(x, y);
    }
  }

  function endDrag(): void {
    active = false;
    isDragging.value = false;
    document.documentElement.classList.remove(DRAGGING_CLASS);
    // 延后一拍再解除 click 拦截,确保尾随 click 已被吞掉
    setTimeout(() => document.removeEventListener('click', onDragSuppressClick, true), 0);
    if (sourceEl) {
      sourceEl.classList.remove('chain-dragging');
      sourceEl = null;
    }
    ghost?.remove();
    ghost = null;
    clearZoneHighlight();
    setPoolHighlight(false);
    payload = null;
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return; // 只处理主键
    if (e.target instanceof Element && e.target.closest('button, input, textarea, select, a, [contenteditable="true"]')) return;
    const card = cardFromTarget(e.target);
    if (!card) return;
    // Only editable board/pool nodes belong to this controller (not presentation copies).
    if (!Object.values(zoneRefs).some((zone) => zone.value?.contains(card)) &&
        !card.closest('.chain-pool')) return;
    const uid = card.getAttribute(UID_ATTR) ?? '';
    if (!uid) return;

    payload = { uid, fromArea: areaFromTarget(e.target) };
    sourceEl = card;
    start = { x: e.clientX, y: e.clientY };
    active = false;

    // 指针捕获:移出卡片甚至移出窗口也不丢事件
    try {
      card.setPointerCapture(e.pointerId);
    } catch {
      /* 个别环境不支持捕获,不致命 */
    }
  }

  function onPointerMove(e: PointerEvent): void {
    if (!payload || !sourceEl) return;

    if (!active) {
      // 未越过阈值 → 可能只是一次点击(单击要弹卡牌大图),不启动拖拽
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_THRESHOLD) return;
      beginDrag(e.clientX, e.clientY);
    }

    e.preventDefault();
    moveGhost(e.clientX, e.clientY);

    const { area, pool } = dropTargetAt(e.clientX, e.clientY);
    setPoolHighlight(pool);
    setZoneHighlight(area);
  }

  function onPointerUp(e: PointerEvent): void {
    const current = payload;
    // 没越过阈值 → 是一次点击,交给卡片的 click 处理(看大图)
    if (!current || !active) {
      payload = null;
      sourceEl = null;
      return;
    }

    const { area, pool } = dropTargetAt(e.clientX, e.clientY);
    const index = area ? dropIndexAt(area, e.clientX, e.clientY) : 0;
    endDrag();

    // 拖回卡池:盘内的卡移出棋盘;卡池模板拖回原处则什么都不做
    if (pool) {
      if (current.fromArea !== null) handlers.remove(current.uid);
      return;
    }
    if (!area) return; // 落在空白处 → 取消,不改状态

    if (current.fromArea === area) {
      const order = Array.from(zoneRefs[area].value?.querySelectorAll<HTMLElement>(`[${UID_ATTR}]`) ?? [])
        .map((card) => card.getAttribute(UID_ATTR)!)
        .filter((uid) => uid !== current.uid);
      order.splice(index, 0, current.uid);
      handlers.reorder(area, order);
      return;
    }
    if (!handlers.canAccept(area)) {
      handlers.onRejected(area);
      return;
    }
    if (current.fromArea === null) handlers.clone(current.uid, area, index);
    else handlers.move(current.uid, area, index);
  }

  function onPointerCancel(): void {
    if (active) {
      endDrag();
      return;
    }
    payload = null;
    sourceEl = null;
  }

  /* ──────────────── 生命周期 ──────────────── */

  function anyContainerReady(): boolean {
    for (const key of Object.keys(zoneRefs) as ChainAreaKey[]) {
      if (zoneRefs[key]?.value) return true;
    }
    return false;
  }

  async function mount(): Promise<void> {
    if (mounted) return;
    if (!anyContainerReady()) {
      // 容器还没渲染。这里不报错(宿主会在 DOM 就绪后再试),
      // 但必须留下可读的原因 —— 静默失效比报错难查得多。
      lastError = '拖拽容器尚未就绪';
      return;
    }
    mounted = true;
    lastError = '';

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('pointermove', onPointerMove, { passive: false });
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerCancel);
  }

  function destroy(): void {
    document.removeEventListener('pointerdown', onPointerDown);
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    document.removeEventListener('pointercancel', onPointerCancel);
    if (active || payload) endDrag();
    mounted = false;
    lastError = '';
  }

  onUnmounted(destroy);

  return {
    mount,
    destroy,
    isMounted: () => mounted,
    lastMountError: () => lastError,
    isDragging
  };
}
