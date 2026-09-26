/**
 * Cloudflare Pages Function: 同源转发官网卡表接口（Riot Publishing Content Service）。
 *
 * 上游 https://content.publishing.riotgames.com 的 CORS 只放行 playriftbound.com，
 * 浏览器无法直连，因此由本站同源代理转发。
 *
 * 路由与上游路径固定，查询参数经白名单重建，避免成为开放代理。
 * 文件名以 `_` 开头，Cloudflare Pages 不会把它注册成路由。
 */

export const GALLERY_UPSTREAM_BASE =
  'https://content.publishing.riotgames.com/publishing-content/v2.0/public/channel/riftbound_website/list';

/** 官网支持的语区（与语言选择器一致）。 */
export const GALLERY_LOCALES = [
  'en_US',
  'zh_CN',
  'zh_TW',
  'ja_JP',
  'ko_KR',
  'de_DE',
  'fr_FR',
  'es_ES',
  'it_IT'
] as const;

export type GalleryLocale = (typeof GALLERY_LOCALES)[number];

export type GalleryListName = 'cards' | 'sets';

/** 单次上游请求超时；须远小于 Cloudflare 的 ~100s 源站超时，才能回可控错误而非 524。 */
export const UPSTREAM_TIMEOUT_MS = 12_000;
/** 上游偶发挂死时的函数内重试次数（含首次）。 */
export const UPSTREAM_ATTEMPTS = 2;

export interface GalleryQuery {
  locale: GalleryLocale;
  from: number;
  limit: number;
}

export interface UpstreamResult {
  status: number;
  contentType: string;
  retryAfter: string | null;
  bytes: ArrayBuffer;
}

function isGalleryLocale(value: string): value is GalleryLocale {
  return (GALLERY_LOCALES as readonly string[]).includes(value);
}

/**
 * 解析并校验查询参数。只接受白名单语区与受限的 from/limit，
 * 其余参数一律忽略（不透传上游 URL 的任意部分）。
 */
export function parseGalleryQuery(params: URLSearchParams): GalleryQuery | null {
  const locale = params.get('locale') ?? 'en_US';
  if (!isGalleryLocale(locale)) return null;
  const from = Number(params.get('from') ?? '0');
  const limit = Number(params.get('limit') ?? '200');
  if (!Number.isInteger(from) || from < 0 || from > 2000) return null;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) return null;
  return { locale, from, limit };
}

/** 由固定上游基址 + 列表名 + 已校验参数拼接（不接收调用方传入的 URL）。 */
export function galleryUpstreamUrl(list: GalleryListName, query: GalleryQuery): string {
  const url = new URL(`${GALLERY_UPSTREAM_BASE}/riftbound_gallery_${list}`);
  url.searchParams.set('locale', query.locale);
  url.searchParams.set('from', String(query.from));
  url.searchParams.set('limit', String(query.limit));
  return url.toString();
}

export function jsonError(message: string, status: number): Response {
  return Response.json(
    { error: { status, message } },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      }
    }
  );
}

/**
 * 转发到固定上游。每次请求带超时并读完整响应体（避免响应头已到、body 中途挂死），
 * 失败则重试；全部失败时抛出最后一个错误。
 */
export async function fetchUpstream(
  list: GalleryListName,
  query: GalleryQuery,
  timeoutMs = UPSTREAM_TIMEOUT_MS,
  attempts = UPSTREAM_ATTEMPTS
): Promise<UpstreamResult> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const upstream = await fetch(galleryUpstreamUrl(list, query), {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs)
      });
      return {
        status: upstream.status,
        contentType: upstream.headers.get('content-type') || 'application/json; charset=utf-8',
        retryAfter: upstream.headers.get('retry-after'),
        bytes: await upstream.arrayBuffer()
      };
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('官网卡表接口暂时不可用');
}

/** GET /api/riftbound/gallery/{cards,sets} —— 校验参数后转发上游 JSON。 */
export async function handleGalleryList(list: GalleryListName, request: Request): Promise<Response> {
  const query = parseGalleryQuery(new URL(request.url).searchParams);
  if (!query) return jsonError('查询参数无效', 400);

  let upstream: UpstreamResult;
  try {
    upstream = await fetchUpstream(list, query);
  } catch {
    return jsonError('官网卡表接口暂时不可用', 504);
  }

  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': upstream.contentType,
    'X-Content-Type-Options': 'nosniff'
  });
  if (upstream.retryAfter) headers.set('Retry-After', upstream.retryAfter);
  return new Response(upstream.bytes, { status: upstream.status, headers });
}
