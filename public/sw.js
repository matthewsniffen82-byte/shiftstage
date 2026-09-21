/* dancr-sw-release: nonblocking-launch-v3 */
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Retire old offline copies without interrupting a page that is loading.
    // Unavailable storage must not prevent the replacement worker taking over.
    try {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
    } catch { /* The browser may disable Cache Storage. */ }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  // Let the browser load public pages, assets and APIs directly. Forwarding
  // every resource through fetch adds work and applies the worker's connect-src
  // policy to fonts/images that are allowed by the document's own policy.
  if (event.request.method !== "GET" || event.request.mode !== "navigate") return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;
  const isPublicNavigation = (
    requestUrl.pathname === "/" ||
    requestUrl.pathname === "/dancers" ||
    requestUrl.pathname.startsWith("/dancers/") ||
    requestUrl.pathname === "/venues" ||
    requestUrl.pathname.startsWith("/venues/") ||
    requestUrl.pathname === "/tv" ||
    requestUrl.pathname.startsWith("/tv/")
  );
  if (isPublicNavigation) return;
  event.respondWith(fetch(event.request, { cache: "no-store" }));
});
