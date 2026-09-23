/**
 * Cloudflare Pages Function: 同源转发官方 QA 分页接口。
 *
 * 路由和上游都是固定的，且请求体经白名单重建，避免成为开放代理。
 *
 * 上游在腾讯云，本站经 Cloudflare 转发，跨境链路偶发静默丢包（连接既不返回
 * 也不 reset）。若不设超时，函数会一直挂到 Cloudflare 的 ~100s 源站上限并回
 * 524。这里给每次上游请求加超时并做一次重试，及时回可重试的 504。
 */

const UPSTREAM = 'https://lol-api.playloltcg.com/xcx/cardCommonQa/getCardCommonQaList';

/** 单次上游请求超时；须远小于 Cloudflare 的 ~100s 源站超时，才能回可控错误而非 524。 */
export const UPSTREAM_TIMEOUT_MS = 12_000;
/** 上游偶发挂死时的函数内重试次数（含首次）。 */
export const UPSTREAM_ATTEMPTS = 2;

interface FunctionContext {
  request: Request;
}

interface QaPageRequest {
  pageNum: number;
  pageSize: number;
  searchContent: string;
}

interface UpstreamResult {
  status: number;
  contentType: string;
  retryAfter: string | null;
  bytes: ArrayBuffer;
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

/**
 * 转发到固定上游。每次请求带超时，失败则重试；响应体在超时窗口内读完，
 * 避免“响应头已到、body 中途挂死”绕过超时。全部失败时抛出最后一个错误。
 */
export async function fetchUpstream(
  body: QaPageRequest,
  timeoutMs = UPSTREAM_TIMEOUT_MS,
  attempts = UPSTREAM_ATTEMPTS
): Promise<UpstreamResult> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const upstream = await fetch(UPSTREAM, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
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
  throw lastError instanceof Error ? lastError : new Error('官方 QA 接口暂时不可用');
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

  let upstream: UpstreamResult;
  try {
    upstream = await fetchUpstream(body);
  } catch {
    return jsonError('官方 QA 接口暂时不可用', 504);
  }

  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': upstream.contentType,
    'X-Content-Type-Options': 'nosniff'
  });
  if (upstream.retryAfter) headers.set('Retry-After', upstream.retryAfter);
  return new Response(upstream.bytes, { status: upstream.status, headers });
}
