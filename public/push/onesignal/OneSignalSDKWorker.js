// Retire the former provider registration when an older install checks for updates.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil((async () => {
  await (await self.registration.pushManager.getSubscription())?.unsubscribe();
  await self.registration.unregister();
})()));
