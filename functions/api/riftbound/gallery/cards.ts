/**
 * Cloudflare Pages Function: GET /api/riftbound/gallery/cards
 * 同源转发官网卡表卡片列表（riftbound_gallery_cards）。
 */
import { handleGalleryList } from './_upstream';

interface FunctionContext {
  request: Request;
}

export function onRequestGet(context: FunctionContext): Promise<Response> {
  return handleGalleryList('cards', context.request);
}
