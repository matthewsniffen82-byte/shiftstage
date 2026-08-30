/* dancr-sw-release: safe-public-cache-v1 */
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
    await self.clients.claim();

    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    await Promise.all(clients.map((client) => (
      typeof client.navigate === "function"
        ? client.navigate(client.url).catch(() => undefined)
        : Promise.resolve()
    )));
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  const isPublicNavigation = event.request.mode === "navigate" &&
    requestUrl.origin === self.location.origin &&
    (
      requestUrl.pathname === "/" ||
      requestUrl.pathname === "/dancers" ||
      requestUrl.pathname.startsWith("/dancers/") ||
      requestUrl.pathname === "/venues" ||
      requestUrl.pathname.startsWith("/venues/") ||
      requestUrl.pathname === "/tv" ||
      requestUrl.pathname.startsWith("/tv/")
    );
  event.respondWith(fetch(event.request, {
    cache: event.request.mode === "navigate" && !isPublicNavigation ? "no-store" : "default",
  }));
});
