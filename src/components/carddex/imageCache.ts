const CACHE_NAME = "carddex-images-v1";
let registration: Promise<boolean> | null = null;
const pending = new Map<string, Promise<boolean>>();

export function imageProxyUrl(remote: string): string {
  if (!remote || typeof window === "undefined") return remote;
  const base = new URL(import.meta.env.BASE_URL, window.location.href);
  const proxy = new URL("__card_image__", base);
  proxy.searchParams.set("url", remote);
  return proxy.toString();
}

export async function enableCardImageCache(): Promise<boolean> {
  if (registration) return registration;
  registration = (async () => {
    if (!("serviceWorker" in navigator) || !window.isSecureContext)
      return false;
    try {
      const base = new URL(import.meta.env.BASE_URL, window.location.href);
      const swUrl = new URL("card-image-sw.js", base);
      await navigator.serviceWorker.register(swUrl.toString(), {
        scope: base.pathname,
      });
      await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>((resolve) =>
          window.setTimeout(() => resolve(null), 1800),
        ),
      ]);
      if (navigator.serviceWorker.controller) return true;
      return await new Promise<boolean>((resolve) => {
        const timer = window.setTimeout(() => resolve(false), 1800);
        navigator.serviceWorker.addEventListener(
          "controllerchange",
          () => {
            window.clearTimeout(timer);
            resolve(true);
          },
          { once: true },
        );
      });
    } catch {
      return false;
    }
  })();
  return registration;
}

export async function clearCardImageCache(): Promise<boolean> {
  if (!("caches" in window)) return false;
  return caches.delete(CACHE_NAME);
}

/**
 * Cache only images whose tiles/details have actually entered the viewport.
 * This also covers the first visit, before the newly installed service worker
 * controls the page. The worker will reuse the same URL key on later visits.
 */
export function cacheViewedCardImage(remote: string): Promise<boolean> {
  if (!remote || typeof window === "undefined" || !("caches" in window))
    return Promise.resolve(false);
  const existing = pending.get(remote);
  if (existing) return existing;

  const task = (async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      const request = new Request(remote, {
        mode: "no-cors",
        credentials: "omit",
      });
      if (await cache.match(request)) return true;
      const response = await fetch(request);
      if (!response.ok && response.type !== "opaque") return false;
      await cache.put(request, response.clone());
      return true;
    } catch {
      return false;
    } finally {
      pending.delete(remote);
    }
  })();
  pending.set(remote, task);
  return task;
}
