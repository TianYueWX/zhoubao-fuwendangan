/**
 * Cloudflare Pages Function: 同源转发官方 QA 分页接口。
 *
 * 路由和上游都是固定的，且请求体经白名单重建，避免成为开放代理。
 */

const UPSTREAM = 'https://lol-api.playloltcg.com/xcx/cardCommonQa/getCardCommonQaList';

interface FunctionContext {
  request: Request;
}

interface QaPageRequest {
  pageNum: number;
  pageSize: number;
  searchContent: string;
}

function jsonError(message: string, status: number): Response {
  return Response.json(
    { code: status, type: 'error', message, result: [] },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      }
    }
  );
}

function parseBody(value: unknown): QaPageRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const pageNum = Number(body.pageNum);
  const pageSize = Number(body.pageSize);
  const searchContent = body.searchContent ?? '';
  if (!Number.isInteger(pageNum) || pageNum < 1 || pageNum > 200) return null;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 30) return null;
  if (typeof searchContent !== 'string' || searchContent.length > 200) return null;
  return { pageNum, pageSize, searchContent };
}

export async function onRequestPost(context: FunctionContext): Promise<Response> {
  const contentLength = Number(context.request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > 8_192) {
    return jsonError('请求体过大', 413);
  }

  let raw: unknown;
  try {
    raw = await context.request.json();
  } catch {
    return jsonError('请求体必须是 JSON', 400);
  }
  const body = parseBody(raw);
  if (!body) return jsonError('分页参数无效', 400);

  try {
    const upstream = await fetch(UPSTREAM, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    const headers = new Headers({
      'Cache-Control': 'no-store',
      'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff'
    });
    const retryAfter = upstream.headers.get('retry-after');
    if (retryAfter) headers.set('Retry-After', retryAfter);
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch {
    return jsonError('官方 QA 接口暂时不可用', 502);
  }
}
