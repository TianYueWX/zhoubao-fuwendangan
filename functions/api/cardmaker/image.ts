import { handleCardImage } from './_image';
export function onRequestGet(context: { request: Request }): Promise<Response> {
  return handleCardImage(context.request);
}
