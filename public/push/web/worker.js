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
    if (!url.username && !url.password) {
      if (url.origin === self.location.origin) return url.href;
      // Older installs may use the bare domain. Keep their signed-in origin
      // while preserving the destination sent by the canonical www site.
      const appOrigins = ["https://mydancr.com", "https://www.mydancr.com"];
      if (appOrigins.includes(url.origin) && appOrigins.includes(self.location.origin)) {
        return self.location.origin + url.pathname + url.search + url.hash;
      }
    }
  } catch { /* Use the app for malformed or external links. */ }
  return self.location.origin + "/";
}

self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    if (await storage("get", "account") !== event.notification.data?.accountId) return;
    const destination = new URL(safeUrl(event.notification.data?.url));
    if (destination.pathname === "/dashboard/venue" && ["#table-requests", "#venue-pickups"].includes(destination.hash)) {
      // A new notification must load fresh requests even when an existing
      // dashboard differs only by its hash or is already at this inbox.
      destination.searchParams.set("notification", event.notification.tag || String(Date.now()));
    }
    const url = destination.href;
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const appClients = clients.filter(client => new URL(client.url).origin === self.location.origin);
    const existing = appClients.find(client => new URL(client.url).pathname === destination.pathname) || appClients[0];
    if (existing) {
      try {
        const navigated = await existing.navigate(url);
        if (navigated) return await navigated.focus();
      } catch { /* A tab may close while the notification is being opened. */ }
    }
    return self.clients.openWindow(url);
  })());
});
