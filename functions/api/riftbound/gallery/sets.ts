/**
 * Cloudflare Pages Function: GET /api/riftbound/gallery/sets
 * 同源转发官网卡表系列列表（riftbound_gallery_sets）。
 */
import { handleGalleryList } from './_upstream';

interface FunctionContext {
  request: Request;
}

export function onRequestGet(context: FunctionContext): Promise<Response> {
  return handleGalleryList('sets', context.request);
}
