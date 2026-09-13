/* ================================================================
 * src/tools/sources/supabase.ts
 *
 * Supabase 数据源适配层(架构位,当前为「未配置即静默降级」的桩实现)。
 *
 * 设计要点:
 *   - 不引入 @supabase/supabase-js 依赖:走 PostgREST HTTP 接口,
 *     用 fetch + anon key 即可读公开内容(报道 blog / QA / 规则)。
 *   - **配置缺失不是错误**:未配置时返回 { configured: false },
 *     由状态机表达为 unconfigured,首页显示「未配置」而非报错。
 *   - 表结构由调用方声明(见 CloudResource),后续建表后无需改本文件。
 *
 * 环境变量(在项目根目录 .env.local,已被 .gitignore 忽略):
 *   VITE_SUPABASE_URL=https://xxxx.supabase.co
 *   VITE_SUPABASE_ANON_KEY=eyJhbGci...
 *
 * 建表后把 TOOL_RESOURCES 里对应的表名填上即可,视图层无需改动。
 * ============================================================== */

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

/** 从 Vite 环境变量读取配置;缺失返回 null */
export function readSupabaseConfig(): SupabaseConfig | null {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
  const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();
  if (!url || !anonKey) return null;
  return { url: url.replace(/\/+$/, ''), anonKey };
}

export function isSupabaseConfigured(): boolean {
  return readSupabaseConfig() !== null;
}

/** 云端资源声明:一个工具对应一张表(或一个 view) */
export interface CloudResource {
  /** 工具 code,与 src/tools/catalog.ts 对应 */
  tool: string;
  /** 表名或视图名 */
  table: string;
  /** 列表页排序字段 */
  orderBy?: string;
  /** 单页条数 */
  limit?: number;
  /** 列表需要返回的字段;空 = 全部 */
  select?: string[];
}

/**
 * 工具 → 云端资源映射。
 * 建表后填写即可启用;留空则工具以「未配置」状态出现。
 */
export const TOOL_RESOURCES: readonly CloudResource[] = Object.freeze([
  // { tool: 'blog',  table: 'reports',  orderBy: 'published_at', limit: 20,
  //   select: ['id', 'title', 'summary', 'published_at', 'tags'] },
  // { tool: 'qa',    table: 'qa_entries', orderBy: 'updated_at', limit: 50,
  //   select: ['id', 'question', 'answer', 'tags'] }
]);

export function resourceOf(tool: string): CloudResource | null {
  return TOOL_RESOURCES.find((r) => r.tool === tool) ?? null;
}

export type ProbeResult =
  | { configured: false }
  | { configured: true; ok: true; latencyMs: number }
  | { configured: true; ok: false; error: string };

/**
 * 轻量连通性探测:取 1 行验证 key 与网络是否可用。
 * 用于启动时把 supabase 数据源状态写进状态机(不阻塞首屏)。
 */
export async function probeSupabase(
  resource: CloudResource | null = TOOL_RESOURCES[0] ?? null
): Promise<ProbeResult> {
  const cfg = readSupabaseConfig();
  if (!cfg) return { configured: false };
  const table = resource?.table ?? 'reports';
  const started = Date.now();
  try {
    const res = await fetch(`${cfg.url}/rest/v1/${table}?select=*&limit=1`, {
      headers: {
        apikey: cfg.anonKey,
        Authorization: `Bearer ${cfg.anonKey}`
      }
    });
    if (!res.ok) {
      return { configured: true, ok: false, error: `HTTP ${res.status}` };
    }
    return { configured: true, ok: true, latencyMs: Date.now() - started };
  } catch (e) {
    return {
      configured: true,
      ok: false,
      error: e instanceof Error ? e.message : String(e)
    };
  }
}

/**
 * 通用列表查询(架构位):按资源声明读取一页数据。
 * 视图层只需 resourceOf(tool) + fetchList(resource),不接触 HTTP 细节。
 */
export async function fetchList<T = Record<string, unknown>>(
  resource: CloudResource
): Promise<{ rows: T[]; total: number | null }> {
  const cfg = readSupabaseConfig();
  if (!cfg) throw new Error('Supabase 未配置');

  const params = new URLSearchParams();
  params.set('select', resource.select?.join(',') ?? '*');
  if (resource.orderBy) params.set('order', `${resource.orderBy}.desc`);
  params.set('limit', String(resource.limit ?? 20));

  const res = await fetch(`${cfg.url}/rest/v1/${resource.table}?${params}`, {
    headers: {
      apikey: cfg.anonKey,
      Authorization: `Bearer ${cfg.anonKey}`,
      // 让响应带上总行数,便于分页显示
      Prefer: 'count=exact'
    }
  });
  if (!res.ok) throw new Error(`Supabase 查询失败:HTTP ${res.status}`);
  const rows = (await res.json()) as T[];
  const range = res.headers.get('content-range');
  const total = range ? Number(range.split('/')[1]) : null;
  return { rows, total: Number.isFinite(total) ? total : null };
}
