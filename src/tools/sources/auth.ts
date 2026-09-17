/* ================================================================
 * src/tools/sources/auth.ts
 *
 * 编辑部认证层 —— GoTrue REST,纯 fetch,不引入 @supabase/supabase-js。
 *
 * 端点(一律带 apikey: <anon> 头):
 *   登录     POST {url}/auth/v1/token?grant_type=password      { email, password }
 *   刷新     POST {url}/auth/v1/token?grant_type=refresh_token { refresh_token }
 *   当前用户 GET  {url}/auth/v1/user          Authorization: Bearer <access_token>
 *   登出     POST {url}/auth/v1/logout        Authorization: Bearer <access_token>
 *
 * ⚠ 两条来自 Supabase 文档《User sessions》的硬约束:
 *   1. access_token 是短命 JWT(默认 1 小时);refresh_token 只能用一次,
 *      每次交换得到**新的一对**令牌。
 *   2. 服务端启用「刷新令牌重用检测」:同一个 refresh_token 被并发使用,
 *      会导致**整个会话连同全部刷新令牌被吊销**(仅有 10 秒宽容窗口)。
 *      ⇒ 刷新必须单飞:所有调用共享同一个 in-flight Promise,
 *        且必须原子地落盘最新令牌对。
 *
 * 权限判定读 app_metadata.role(服务端可写、用户不可改);
 * 绝不读 user_metadata —— 那是用户可自行篡改的字段。
 *
 * 这是全站唯一的持久化(state 约定见 docs/style-spec.md「与文档的差异」):
 * 会话必须跨刷新存活,否则每次 F5 都要重登。
 * ============================================================== */

import { computed, reactive } from 'vue';
import { readSupabaseConfig } from './config';

/** 持久化 key —— 全站唯一 */
const SESSION_KEY = 'riftbound-editorial-session';

/** 提前多久刷新(毫秒);JWT 默认寿命 1 小时 */
const REFRESH_LEEWAY_MS = 60_000;

export interface AdminSession {
  accessToken: string;
  refreshToken: string;
  /** access_token 过期时刻(epoch ms) */
  expiresAt: number;
  email: string;
  /** app_metadata.role,管理员为 'admin' */
  role: string | null;
}

export type AuthStatus = 'anonymous' | 'restoring' | 'authenticated';

interface AuthState {
  status: AuthStatus;
  session: AdminSession | null;
  /** 最近一次失败原因,供门禁页显示 */
  error: string;
}

export const authState = reactive<AuthState>({
  status: 'anonymous',
  session: null,
  error: ''
});

/** 已登录且是管理员 */
export const isEditorialAdmin = computed(
  () => authState.status === 'authenticated' && authState.session?.role === 'admin'
);

/* ──────────────────────────── 持久化 ──────────────────────────── */

function isSession(v: unknown): v is AdminSession {
  if (!v || typeof v !== 'object') return false;
  const s = v as Partial<AdminSession>;
  return typeof s.accessToken === 'string' && typeof s.refreshToken === 'string';
}

export function loadStoredSession(): AdminSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function persist(session: AdminSession | null): void {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* 隐私模式/配额满:降级为「刷新即掉登录」,不影响功能 */
  }
}

function adopt(session: AdminSession): AdminSession {
  // 单点写入:内存态 + 持久化必须同时更新,否则会留下会被重用的旧 refresh_token
  authState.session = session;
  authState.status = 'authenticated';
  authState.error = '';
  persist(session);
  return session;
}

export function clearSession(): void {
  authState.session = null;
  authState.status = 'anonymous';
  persist(null);
}

/* ──────────────────────────── HTTP ──────────────────────────── */

class AuthError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

/** 把 GoTrue 的各种错误体形状归一成一句人话 */
async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === 'object') {
      const b = body as Record<string, unknown>;
      const candidate = b.error_description ?? b.msg ?? b.message ?? b.error;
      if (typeof candidate === 'string' && candidate) {
        if (/invalid login credentials/i.test(candidate)) return '邮箱或密码不正确';
        if (/email not confirmed/i.test(candidate)) return '邮箱尚未确认';
        return candidate;
      }
    }
  } catch {
    /* 非 JSON 响应,落到 fallback */
  }
  return fallback;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: { email?: string; app_metadata?: Record<string, unknown> };
}

/** 把 token 端点响应转成会话对象;字段缺失则抛错 */
function toSession(body: TokenResponse, fallbackRefresh = ''): AdminSession {
  const accessToken = body.access_token;
  const refreshToken = body.refresh_token || fallbackRefresh;
  if (!accessToken || !refreshToken) {
    throw new AuthError('认证服务返回的令牌不完整', 500);
  }
  const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : 3600;
  const meta = body.user?.app_metadata;
  const role = typeof meta?.role === 'string' ? meta.role : null;
  return {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
    email: body.user?.email ?? '',
    role
  };
}

/* ──────────────────────────── 登录 / 登出 ──────────────────────────── */

/**
 * 邮箱密码登录。
 * 登录成功但 app_metadata.role !== 'admin' 时**立即登出并抛错** ——
 * 编辑部是门禁区域,不留半开的会话。
 */
export async function signIn(email: string, password: string): Promise<AdminSession> {
  const cfg = readSupabaseConfig();
  if (!cfg) throw new AuthError('未配置 Supabase 连接(VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)', 0);

  authState.error = '';
  let res: Response;
  try {
    res = await fetch(`${cfg.url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: cfg.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
  } catch (e) {
    throw new AuthError(e instanceof Error ? e.message : '网络不可达', 0);
  }

  if (!res.ok) {
    throw new AuthError(await readError(res, `登录失败(HTTP ${res.status})`), res.status);
  }

  const session = toSession((await res.json()) as TokenResponse);
  if (session.role !== 'admin') {
    await revoke(session.accessToken).catch(() => undefined);
    throw new AuthError('该账号不是管理员(app_metadata.role ≠ admin)', 403);
  }
  return adopt(session);
}

/** 尽力吊销服务端会话;失败也不阻断本地登出 */
async function revoke(accessToken: string): Promise<void> {
  const cfg = readSupabaseConfig();
  if (!cfg) return;
  await fetch(`${cfg.url}/auth/v1/logout`, {
    method: 'POST',
    headers: { apikey: cfg.anonKey, Authorization: `Bearer ${accessToken}` }
  });
}

export async function signOut(): Promise<void> {
  const current = authState.session;
  clearSession();
  if (current) await revoke(current.accessToken).catch(() => undefined);
}

/* ──────────────────────────── 刷新(单飞) ──────────────────────────── */

let refreshInFlight: Promise<AdminSession | null> | null = null;

/**
 * 刷新会话。**并发调用共享同一个请求** —— 这是硬约束,不是优化:
 * 同一个 refresh_token 被并发使用会吊销整个会话。
 */
export function refreshSession(): Promise<AdminSession | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = doRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function doRefresh(): Promise<AdminSession | null> {
  const current = authState.session;
  const cfg = readSupabaseConfig();
  if (!current || !cfg) return null;

  let res: Response;
  try {
    res = await fetch(`${cfg.url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: cfg.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: current.refreshToken })
    });
  } catch {
    // 网络问题:保留会话,下次再试(不因离线把人踢出去)
    return null;
  }

  if (!res.ok) {
    // invalid_grant / 重用检测命中 → 会话已死,必须重新登录
    clearSession();
    authState.error = '登录已过期,请重新登录';
    return null;
  }

  const next = toSession((await res.json()) as TokenResponse, current.refreshToken);
  if (next.role !== 'admin') {
    clearSession();
    authState.error = '账号已失去管理员权限';
    return null;
  }
  return adopt(next);
}

/**
 * 取一个可用的 access_token;距过期不足 REFRESH_LEEWAY_MS 时先刷新。
 * 返回 null = 未登录或会话已失效,调用方应引导重新登录。
 */
export async function getAccessToken(): Promise<string | null> {
  const s = authState.session;
  if (!s) return null;
  if (Date.now() < s.expiresAt - REFRESH_LEEWAY_MS) return s.accessToken;
  const refreshed = await refreshSession();
  return refreshed?.accessToken ?? null;
}

/** 强制取一个 token(读公开数据时用 anon,写时必须有用户令牌) */
export async function requireAccessToken(): Promise<string> {
  const token = await getAccessToken();
  if (!token) throw new AuthError('未登录或登录已过期,请重新登录', 401);
  return token;
}

/* ──────────────────────────── 启动恢复 ──────────────────────────── */

let bootstrapped = false;

/**
 * 应用启动时恢复会话:读持久化 → 校验角色 → 必要时刷新。
 * 幂等,可重复调用。
 */
export async function bootstrapAuth(): Promise<void> {
  if (bootstrapped) return;
  bootstrapped = true;

  if (!readSupabaseConfig()) {
    authState.status = 'anonymous';
    return;
  }

  const stored = loadStoredSession();
  if (!stored) {
    authState.status = 'anonymous';
    return;
  }

  authState.status = 'restoring';
  authState.session = stored;
  if (stored.role !== 'admin') {
    clearSession();
    return;
  }

  // 过期(或即将过期)则立刻刷新;未过期也验证一次服务端状态
  if (Date.now() >= stored.expiresAt - REFRESH_LEEWAY_MS) {
    await refreshSession();
  }
  if (authState.session) authState.status = 'authenticated';
}

/** 仅供测试/调试:重置启动标记与内存态 */
export function __resetAuthForTest(): void {
  bootstrapped = false;
  clearSession();
}
