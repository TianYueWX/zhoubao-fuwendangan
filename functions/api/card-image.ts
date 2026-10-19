/**
 * Cloudflare Pages Function: GET /api/card-image?url=…
 * 同源转发白名单内的卡图，供 Canvas 生成分享图片时读取像素。
 */
import { handleCardImage } from './_card-image';

interface FunctionContext {
  request: Request;
}

export function onRequestGet(context: FunctionContext): Promise<Response> {
  return handleCardImage(context.request);
}
