/* ================================================================
 * src/tools/state.ts
 *
 * 工具加载状态机(数据源无关)。
 *
 * 目的:让首页工具卡与导航能在**不加载任何真实数据**的前提下正确表达
 * 「未配置 / 加载中 / 就绪 / 空 / 失败」,从而让云端工具(Supabase)
 * 可以先把架构接好、内容后补。
 *
 * 两层状态:
 *   - sourceState:数据源级健康(如 supabase 是否已配置且可达),广播给该源全部工具
 *   - toolState  :单个工具的加载状态(可取默认值 = 其数据源的健康状态)
 * ============================================================== */

import { computed, reactive } from 'vue';
import { TOOLS, findTool, type ToolSource, type ToolStatus } from './catalog';

export interface ToolState {
  status: ToolStatus;
  message: string;
  /** 结果条数/卡组数等,可空 */
  count: number | null;
  updatedAt: number | null;
}

interface SourceState {
  status: ToolStatus;
  message: string;
  checkedAt: number | null;
}

function emptyState(): ToolState {
  return { status: 'idle', message: '', count: null, updatedAt: null };
}

/** 数据源健康状态:由 App 启动时探测回写 */
export const sourceState = reactive<Record<ToolSource, SourceState>>({
  local: { status: 'idle', message: '', checkedAt: null },
  supabase: { status: 'unconfigured', message: '未配置云端连接', checkedAt: null },
  static: { status: 'idle', message: '', checkedAt: null }
});

/** 单工具状态:仅登记被显式设置过的工具 */
export const toolState = reactive<Record<string, ToolState>>({});

export function getToolState(code: string): ToolState {
  const own = toolState[code];
  if (own) return own;
  const tool = findTool(code);
  const src = tool ? sourceState[tool.source] : null;
  return {
    status: src?.status ?? 'idle',
    message: src?.message ?? '',
    count: null,
    updatedAt: src?.checkedAt ?? null
  };
}

export function setToolState(code: string, patch: Partial<ToolState>): void {
  const cur = toolState[code] ?? emptyState();
  toolState[code] = { ...cur, ...patch, updatedAt: Date.now() };
}

export function setSourceState(
  source: ToolSource,
  patch: Partial<SourceState>
): void {
  const cur = sourceState[source];
  sourceState[source] = { ...cur, ...patch, checkedAt: Date.now() };
}

/** 批量重置(如切换数据包后刷新本地工具状态) */
export function resetLocalToolStates(): void {
  for (const t of TOOLS) {
    if (t.source === 'local') delete toolState[t.code];
  }
}

/* ──────────────────────── 展示层辅助 ──────────────────────── */

export interface StatusVisual {
  label: string;
  /** Tailwind 颜色类(文字) */
  tone: string;
  /** 是否可点(不可用时仍可进,但页面内给引导) */
  active: boolean;
}

export function statusVisual(status: ToolStatus): StatusVisual {
  switch (status) {
    case 'ready':
      return { label: '就绪', tone: 'text-delta-up', active: true };
    case 'loading':
      return { label: '加载中', tone: 'text-accent', active: true };
    case 'empty':
      return { label: '暂无内容', tone: 'text-ink-faint', active: true };
    case 'error':
      return { label: '加载失败', tone: 'text-delta-down', active: true };
    case 'unconfigured':
      return { label: '未配置', tone: 'text-ink-faint', active: true };
    default:
      return { label: '待载入', tone: 'text-ink-faint', active: true };
  }
}

/** 便捷读取(响应式):某工具当前状态 */
export function useToolStatus(code: string) {
  return computed(() => getToolState(code).status);
}
