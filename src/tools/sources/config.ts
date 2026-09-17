/* ================================================================
 * src/tools/sources/config.ts
 *
 * Supabase 连接配置 —— 全站唯一来源(Vite 环境变量)。
 *
 * 单独成文件的原因:auth.ts 需要读配置,rest.ts 需要读配置 + 会话,
 * 若都写在 supabase.ts 里会形成 config ⇄ auth 的循环 import。
 * 分层:config(环境) → auth(会话) → rest(读写) → supabase(公开只读)
 *
 * 环境变量(项目根目录 .env.local,已被 .gitignore 忽略):
 *   VITE_SUPABASE_URL=https://xxxx.supabase.co
 *   VITE_SUPABASE_ANON_KEY=eyJhbGci...
 *
 * 前端只用 anon / publishable key;service_role 绝不出现在浏览器。
 * ============================================================== */

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

/** 从 Vite 环境变量读取配置;缺失返回 null(「未配置」不是错误) */
export function readSupabaseConfig(): SupabaseConfig | null {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
  const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();
  if (!url || !anonKey) return null;
  return { url: url.replace(/\/+$/, ''), anonKey };
}

export function isSupabaseConfigured(): boolean {
  return readSupabaseConfig() !== null;
}
