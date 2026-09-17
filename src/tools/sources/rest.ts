/* ================================================================
 * src/tools/sources/rest.ts
 *
 * PostgREST 读写层 —— 编辑部的数据出入口。纯 fetch,不引入 supabase-js。
 *
 * 与 supabase.ts 的分工:
 *   supabase.ts  公开只读(anon key),给访客看的资讯类内容
 *   rest.ts      编辑部读写,写操作强制携带**用户 JWT**,命中 RLS 的
 *                is_card_admin() 策略
 *
 * ⚠ 两个必须处理的 PostgREST 陷阱:
 *   1. **写操作默认静默无效果**:RLS 拒绝时 PostgREST 返回 204 且无错误,
 *      前端表现为「提示保存成功但数据没变」。因此所有写操作一律带
 *      Prefer: return=representation,并按**返回行数**判定是否真的写入。
 *   2. **UPDATE/DELETE 无 where 条件会命中全表**。故 filter 为必填参数,
 *      空过滤器直接抛错,不给你手滑的机会。
 * ============================================================== */

import { readSupabaseConfig } from './config';
import { getAccessToken } from './auth';

export type FilterOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'ilike' | 'is' | 'in';

export interface RestFilter {
  column: string;
  op: FilterOp;
  value: string | number | boolean | null | ReadonlyArray<string | number>;
}

export interface RestQuery {
  /** select 列表,默认 '*' */
  columns?: string;
  /** AND 连接的过滤条件 */
  filters?: RestFilter[];
  /** PostgREST or=(...) 原始表达式,如 'card_no.ilike.*x*,card_name_cn.ilike.*x*' */
  or?: string;
  /** 排序,如 'card_no.asc' */
  order?: string;
  limit?: number;
  offset?: number;
  /** 是否请求总行数(Prefer: count=exact) */
  count?: boolean;
}

export class RestError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'RestError';
    this.status = status;
  }
}

/* ──────────────────────────── 查询串 ──────────────────────────── */

function encodeValue(v: RestFilter['value']): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return `(${v.map((x) => String(x)).join(',')})`;
  if (typeof v === 'boolean') return String(v);
  return String(v);
}

function buildSearch(query: RestQuery): string {
  const params = new URLSearchParams();
  params.set('select', query.columns ?? '*');
  for (const f of query.filters ?? []) {
    params.append(f.column, `${f.op}.${encodeValue(f.value)}`);
  }
  if (query.or) params.set('or', `(${query.or})`);
  if (query.order) params.set('order', query.order);
  if (typeof query.limit === 'number') params.set('limit', String(query.limit));
  if (typeof query.offset === 'number') {
    params.set('offset', String(query.offset));
  }
  return params.toString();
}

/* ──────────────────────────── 请求 ──────────────────────────── */

type TokenMode = 'anon' | 'user';

interface CallOptions {
  /** 'anon' 用公开 key;'user' 必须有用户 JWT(写操作默认) */
  token?: TokenMode;
  prefer?: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  search?: string;
  body?: unknown;
}

async function resolveAuthHeader(mode: TokenMode, anonKey: string): Promise<string> {
  if (mode === 'anon') return `Bearer ${anonKey}`;
  const token = await getAccessToken();
  if (!token) throw new RestError('未登录或登录已过期,请重新登录', 401);
  return `Bearer ${token}`;
}

async function restError(res: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === 'object') {
      const b = body as Record<string, unknown>;
      const msg = b.message ?? b.hint ?? b.details ?? b.error;
      if (typeof msg === 'string' && msg) {
        if (/permission denied|row-level security/i.test(msg)) {
          return '权限不足:该操作被行级安全策略拒绝(账号可能不是管理员)';
        }
        if (/no unique|on conflict|there is no unique/i.test(msg)) {
          return '缺少唯一约束,无法 upsert(请先执行 supabase/sync-constraints.sql)';
        }
        return msg;
      }
    }
  } catch {
    /* 非 JSON,落到 fallback */
  }
  return fallback;
}

async function call<T>(table: string, opts: CallOptions): Promise<{ rows: T[]; total: number | null }> {
  const cfg = readSupabaseConfig();
  if (!cfg) throw new RestError('未配置 Supabase 连接(VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)', 0);

  const auth = await resolveAuthHeader(opts.token ?? 'anon', cfg.anonKey);
  const headers: Record<string, string> = {
    apikey: cfg.anonKey,
    Authorization: auth,
    'Content-Type': 'application/json'
  };
  if (opts.prefer) headers.Prefer = opts.prefer;

  const url = `${cfg.url}/rest/v1/${table}${opts.search ? `?${opts.search}` : ''}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
    });
  } catch (e) {
    throw new RestError(e instanceof Error ? e.message : '网络不可达', 0);
  }

  if (!res.ok) {
    throw new RestError(await restError(res, `请求失败(HTTP ${res.status})`), res.status);
  }

  const range = res.headers.get('content-range');
  const parsedTotal = range ? Number(range.split('/')[1]) : NaN;
  const total = Number.isFinite(parsedTotal) ? parsedTotal : null;

  // 204 / 空体:合法(如 DELETE 无 Prefer 时)
  if (res.status === 204) return { rows: [], total };
  const text = await res.text();
  if (!text) return { rows: [], total };
  try {
    const parsed: unknown = JSON.parse(text);
    return { rows: (Array.isArray(parsed) ? parsed : [parsed]) as T[], total };
  } catch {
    return { rows: [], total };
  }
}

/* ──────────────────────────── 读 ──────────────────────────── */

/** 读一页(可选带总数)。未登录时走 anon key —— 公开表照常可读。 */
export async function restSelect<T = Record<string, unknown>>(
  table: string,
  query: RestQuery = {}
): Promise<{ rows: T[]; total: number | null }> {
  return call<T>(table, {
    method: 'GET',
    token: 'anon',
    search: buildSearch(query),
    prefer: query.count ? 'count=exact' : undefined
  });
}

/**
 * 分页读全表(PostgREST 单次上限默认 1000 行)。
 * 用于同步差异比对这类需要全量快照的场景。
 */
export async function restSelectAll<T = Record<string, unknown>>(
  table: string,
  query: RestQuery = {},
  pageSize = 1000
): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { rows } = await restSelect<T>(table, {
      ...query,
      limit: pageSize,
      offset
    });
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

/* ──────────────────────────── 写 ──────────────────────────── */

/**
 * 插入。返回真正落库的行(空数组 = 被 RLS 拒绝,调用方必须判空)。
 */
export async function restInsert<T = Record<string, unknown>>(
  table: string,
  rows: Record<string, unknown> | Record<string, unknown>[]
): Promise<T[]> {
  const { rows: out } = await call<T>(table, {
    method: 'POST',
    token: 'user',
    prefer: 'return=representation',
    body: rows
  });
  return out;
}

/**
 * 更新。**filters 必填** —— 空过滤器会命中全表,这里直接拒绝。
 * 返回真正被更新的行;空数组 = 无匹配行或被 RLS 拒绝(不是错误,但多半是权限问题)。
 */
export async function restUpdate<T = Record<string, unknown>>(
  table: string,
  patch: Record<string, unknown>,
  filters: RestFilter[]
): Promise<T[]> {
  if (!filters.length) {
    throw new RestError('拒绝执行:更新操作必须带 where 条件(空过滤器会命中全表)', 400);
  }
  const { rows } = await call<T>(table, {
    method: 'PATCH',
    token: 'user',
    prefer: 'return=representation',
    search: buildSearch({ filters }),
    body: patch
  });
  return rows;
}

/**
 * Upsert(POST + on_conflict)。依赖目标表存在唯一约束。
 */
export async function restUpsert<T = Record<string, unknown>>(
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string
): Promise<T[]> {
  if (!rows.length) return [];
  const { rows: out } = await call<T>(table, {
    method: 'POST',
    token: 'user',
    prefer: `resolution=merge-duplicates,return=representation`,
    search: `on_conflict=${encodeURIComponent(onConflict)}`,
    body: rows
  });
  return out;
}

/**
 * 删除。**filters 必填**,理由同 restUpdate。
 */
export async function restDelete<T = Record<string, unknown>>(
  table: string,
  filters: RestFilter[]
): Promise<T[]> {
  if (!filters.length) {
    throw new RestError('拒绝执行:删除操作必须带 where 条件(空过滤器会清空全表)', 400);
  }
  const { rows } = await call<T>(table, {
    method: 'DELETE',
    token: 'user',
    prefer: 'return=representation',
    search: buildSearch({ filters })
  });
  return rows;
}

/* ──────────────────────────── 发布 ──────────────────────────── */

/** 分类名与 version.name 一一对应 */
export type VersionCategory = 'cards' | 'prints' | 'icons' | 'rules' | 'series';

export const VERSION_CATEGORIES: readonly VersionCategory[] = [
  'cards',
  'prints',
  'icons',
  'rules',
  'series'
];

export const VERSION_LABEL: Record<VersionCategory, string> = {
  cards: '卡牌',
  prints: '印刷版本',
  icons: '图标',
  rules: '规则书',
  series: '系列'
};

/**
 * 触碰发布标记 —— 库中没有触发器,updated_at 必须显式写。
 * 客户端靠 version.updated_at 判断缓存是否失效,这就是「发布」的全部含义。
 */
export async function touchVersion(
  name: VersionCategory,
  now: string = new Date().toISOString()
): Promise<void> {
  const rows = await restUpdate('version', { updated_at: now }, [
    { column: 'name', op: 'eq', value: name }
  ]);
  if (!rows.length) {
    throw new RestError(`发布失败:version 表没有 name='${name}' 的行,或权限不足`, 403);
  }
}

/** 一次触碰多个分类(失败不回滚,逐个上报) */
export async function touchVersions(
  names: readonly VersionCategory[]
): Promise<{ name: VersionCategory; ok: boolean; error?: string }[]> {
  const now = new Date().toISOString();
  const out: { name: VersionCategory; ok: boolean; error?: string }[] = [];
  for (const name of names) {
    try {
      await touchVersion(name, now);
      out.push({ name, ok: true });
    } catch (e) {
      out.push({ name, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

/** 读发布标记(供资源页展示各分类最后发布时间) */
export async function fetchVersions(): Promise<
  Array<{ id: number; name: string; updated_at: string | null }>
> {
  const { rows } = await restSelect<{ id: number; name: string; updated_at: string | null }>(
    'version',
    { order: 'name.asc' }
  );
  return rows;
}
