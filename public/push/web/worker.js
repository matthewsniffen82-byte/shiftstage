/* MyDancr direct Web Push. This worker does not cache pages or API responses. */
"use strict";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

function storage(operation, key, value) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("mydancr-web-push", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("state");
    open.onerror = () => reject(new Error("Push storage unavailable"));
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("state", operation === "get" ? "readonly" : "readwrite");
      const store = tx.objectStore("state");
      const request = operation === "get" ? store.get(key) : store.put(value, key);
      if (operation === "put") {
        const cursor = store.openCursor();
        cursor.onsuccess = () => {
          const entry = cursor.result;
          if (!entry) return;
          if (String(entry.key).startsWith("seen:") && entry.value < Date.now()) entry.delete();
          entry.continue();
        };
      }
      tx.oncomplete = () => { db.close(); resolve(request.result); };
      tx.onerror = tx.onabort = () => { db.close(); reject(new Error("Push storage unavailable")); };
    };
  });
}

let work = Promise.resolve();
self.addEventListener("message", event => {
  if (event.data?.type !== "MYDANCR_PUSH_ACCOUNT") return;
  const account = typeof event.data.accountId === "string" ? event.data.accountId : null;
  // Serialize account changes with notifications, including clearing on logout.
  work = work.catch(() => {}).then(async () => {
    const previous = await storage("get", "account");
    await storage("put", "account", account);
    if (previous !== account || !account) for (const notification of await self.registration.getNotifications()) notification.close();
  });
  event.waitUntil(work.then(() => event.ports[0]?.postMessage({ ok: true }), () => event.ports[0]?.postMessage({ ok: false })));
});

self.addEventListener("push", event => {
  work = work.catch(() => {}).then(async () => {
    let message;
    try { message = event.data?.json(); } catch { return; }
    if (!message || typeof message.id !== "string" || message.id.length > 80 || typeof message.accountId !== "string"
      || !Number.isFinite(message.expiresAt) || message.expiresAt <= Date.now()) return;
    if (await storage("get", "account") !== message.accountId) return;
    if (await storage("get", "seen:" + message.id)) return;
    await self.registration.showNotification(String(message.title || "MyDancr").slice(0, 120), {
      body: String(message.body || "You have a new update.").slice(0, 600),
      icon: "/mydancr-icon-192.png", badge: "/mydancr-icon-192.png", tag: message.id,
      data: { url: safeUrl(message.url), accountId: message.accountId },
      renotify: false,
    });
    await storage("put", "seen:" + message.id, Date.now() + 7 * 86400000);
  });
  event.waitUntil(work);
});

function safeUrl(value) {
  try {
    const url = new URL(typeof value === "string" ? value : "/", self.location.origin);
    if (url.origin === self.location.origin && !url.username && !url.password) return url.href;
  } catch { /* Use the app for malformed or external links. */ }
  return self.location.origin + "/";
}

self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    if (await storage("get", "account") !== event.notification.data?.accountId) return;
    const url = safeUrl(event.notification.data?.url);
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = clients.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) { const navigated = await existing.navigate(url); if (navigated) return navigated.focus(); }
    return self.clients.openWindow(url);
  })());
});
