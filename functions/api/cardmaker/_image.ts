/** Read-only image relay: only the three public card-image origins used by this catalog. */
const HOSTS = new Set([
  'cdn.playloltcg.com',
  'cmsassets.rgpub.io',
  'steamusercontent-a.akamaihd.net',
]);
const MAX_BYTES = 20 * 1024 * 1024;
export function cardImageUrl(value: string | null): URL | null {
  try {
    if (!value || value.length > 2000) return null;
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !HOSTS.has(url.hostname) ||
      url.hash
    )
      return null;
    return url;
  } catch {
    return null;
  }
}
function error(message: string, status: number): Response {
  return Response.json(
    { error: message },
    { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } },
  );
}
export async function handleCardImage(
  request: Request,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const initial = cardImageUrl(new URL(request.url).searchParams.get('url'));
  if (!initial) return error('只支持卡库的公开卡图地址。', 400);
  let url: URL = initial;
  try {
    const signal = AbortSignal.timeout(15000);
    let response: Response | undefined;
    for (let i = 0; i < 3; i++) {
      response = await fetcher(url.toString(), {
        redirect: 'manual',
        signal,
        headers: { Accept: 'image/png,image/jpeg,image/webp,image/gif' },
      });
      if (response.status < 300 || response.status >= 400) break;
      const location: string | null = response.headers.get('location');
      const next: URL | null = location ? cardImageUrl(new URL(location, url).toString()) : null;
      await response.body?.cancel();
      if (!next) return error('卡图重定向地址不受支持。', 502);
      url = next;
    }
    if (!response?.ok || !response.body) return error('卡图暂时不可用。', 502);
    const type =
      (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    if (!/^image\/(?:png|jpeg|webp|gif)$/.test(type)) {
      await response.body.cancel();
      return error('上游未返回卡牌图片。', 502);
    }
    if (Number(response.headers.get('content-length') ?? 0) > MAX_BYTES) {
      await response.body.cancel();
      return error('图片超过 20 MB。', 413);
    }
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        return error('图片超过 20 MB。', 413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return new Response(bytes, {
      headers: {
        'Content-Type': type,
        'Cache-Control': 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
        'Content-Length': String(size),
      },
    });
  } catch {
    return error('读取卡图超时，请稍后重试或上传配图。', 504);
  }
}
