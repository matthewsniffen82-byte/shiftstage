/* dancr-sw-release: android-avatar-foreground-ring-v3 */
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
  event.respondWith(fetch(event.request, {
    cache: event.request.mode === "navigate" ? "no-store" : "default",
  }));
});
