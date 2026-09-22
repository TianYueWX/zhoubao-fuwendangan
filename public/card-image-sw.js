const CACHE_NAME = "carddex-images-v1";
const PROXY_MARK = "__card_image__";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (!requestUrl.pathname.endsWith(PROXY_MARK)) return;
  const remote = requestUrl.searchParams.get("url");
  if (!remote || !/^https?:\/\//i.test(remote)) {
    event.respondWith(new Response("Invalid image URL", { status: 400 }));
    return;
  }
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const key = new Request(remote, { mode: "no-cors", credentials: "omit" });
      const hit = await cache.match(key);
      if (hit) return hit;
      try {
        const response = await fetch(key);
        if (response.ok || response.type === "opaque")
          await cache.put(key, response.clone());
        return response;
      } catch {
        return new Response("", { status: 504 });
      }
    })(),
  );
});
