/**
 * 同源卡图转发：GET /api/card-image?url=<编码后的卡图地址>
 *
 * 卡图 CDN（cdn.playloltcg.com / cmsassets.rgpub.io / steamusercontent）不返回
 * `Access-Control-Allow-Origin`。页面里用 <img> 可以直接显示，但 Canvas 通过
 * fetch + createImageBitmap 取图时会因 CORS 失败，导致分享的卡组图片只剩卡名。
 *
 * 该函数只允许转发白名单内的 https 图片地址，并校验返回的 MIME 与体积，
 * 避免成为开放代理。Cloudflare Pages 会把 `functions/api/card-image.ts`
 * 注册为 /api/card-image；文件名以下划线开头的本文件不会被注册成路由。
 */

/** 允许转发的卡图 CDN（精确匹配 hostname）。 */
export const CARD_IMAGE_HOSTS = [
  'cdn.playloltcg.com',
  'cmsassets.rgpub.io',
  'steamusercontent-a.akamaihd.net'
] as const;

export const CARD_IMAGE_PATH = '/api/card-image';

/** 只接受浏览器可直接解码的光栅图，拒绝 SVG（避免同源脚本执行面）。 */
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/gif']);

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 12_000;

function errorResponse(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

/** 解析并校验待转发地址；任何不在白名单内的 URL 都返回 null。 */
export function parseCardImageTarget(raw: string | null): URL | null {
  if (!raw) return null;
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return null;
  }
  if (target.protocol !== 'https:') return null;
  if (target.username || target.password) return null;
  if (target.port && target.port !== '443') return null;
  if (!(CARD_IMAGE_HOSTS as readonly string[]).includes(target.hostname.toLowerCase())) return null;
  return target;
}

function finalHostAllowed(rawUrl: string): boolean {
  if (!rawUrl) return false;
  try {
    const url = new URL(rawUrl);
    return (
      url.protocol === 'https:' &&
      (!url.port || url.port === '443') &&
      (CARD_IMAGE_HOSTS as readonly string[]).includes(url.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

export async function handleCardImage(request: Request): Promise<Response> {
  if (request.method !== 'GET') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { Allow: 'GET', 'Cache-Control': 'no-store' }
    });
  }

  const target = parseCardImageTarget(new URL(request.url).searchParams.get('url'));
  if (!target) return errorResponse('卡图地址无效', 400);

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: 'GET',
      redirect: 'follow',
      headers: { Accept: 'image/png,image/jpeg,image/webp,image/avif,image/gif' },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
    });
  } catch {
    return errorResponse('卡图源站暂时不可用', 504);
  }

  if (!upstream.ok) {
    await upstream.body?.cancel();
    return errorResponse('卡图源站暂时不可用', 502);
  }
  // 跟随重定向后再核验一次，避免白名单主机把请求跳到任意地址。
  if (!finalHostAllowed(upstream.url)) {
    await upstream.body?.cancel();
    return errorResponse('卡图源站不可信', 502);
  }

  const type = (upstream.headers.get('content-type') || '').split(';')[0]?.trim().toLowerCase() || '';
  if (!ALLOWED_TYPES.has(type)) {
    await upstream.body?.cancel();
    return errorResponse('卡图格式不受支持', 502);
  }

  const declaredLength = Number(upstream.headers.get('content-length') || '');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
    await upstream.body?.cancel();
    return errorResponse('卡图文件过大', 502);
  }

  let bytes: ArrayBuffer;
  try {
    bytes = await upstream.arrayBuffer();
  } catch {
    return errorResponse('卡图读取失败', 504);
  }
  if (bytes.byteLength > MAX_IMAGE_BYTES) return errorResponse('卡图文件过大', 502);

  return new Response(bytes, {
    status: 200,
    headers: {
      'Cache-Control': 'public, max-age=604800, stale-while-revalidate=86400',
      'Content-Length': String(bytes.byteLength),
      'Content-Type': type,
      'Cross-Origin-Resource-Policy': 'same-origin',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}
