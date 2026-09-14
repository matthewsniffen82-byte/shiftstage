(function () {
  "use strict";
  // One percent of document visits. No cookies, storage, identity, URLs or
  // content are collected. Observers use browser buffers for earlier paints.
  if (navigator.webdriver || navigator.globalPrivacyControl || navigator.doNotTrack === "1" || Math.random() >= 0.01) return;
  const release = document.currentScript?.dataset.release || "";
  if (!/^[a-f0-9]{40}$/.test(release)) return;
  const url = new URL(location.href);
  const route = url.pathname.startsWith("/dancers/") ? "profile"
    : url.pathname.startsWith("/venues/") ? "venue"
    : url.pathname.startsWith("/dashboard/") ? "dashboard"
    : url.pathname === "/tv" || (url.searchParams.get("tab") === "tv" || url.searchParams.get("view") === "tv") ? "tv"
    : url.searchParams.has("auth") ? "auth"
    : url.pathname === "/" ? "home" : "other";
  const metrics = {};
  const observers = [];
  const observe = (type, receive, extra = {}) => {
    try {
      if (PerformanceObserver.supportedEntryTypes && !PerformanceObserver.supportedEntryTypes.includes(type)) return;
      const observer = new PerformanceObserver(list => list.getEntries().forEach(receive));
      observer.observe({ type, buffered: true, ...extra });
      if (type === "layout-shift") metrics.cls = 0;
      observers.push({ observer, receive });
    } catch { /* Older browsers omit unavailable measurements. */ }
  };
  observe("largest-contentful-paint", entry => { metrics.lcpMs = Math.round(entry.startTime); });
  let clsStart = 0, clsLast = 0, clsWindow = 0;
  observe("layout-shift", entry => {
    if (entry.hadRecentInput) return;
    if (entry.startTime - clsLast > 1000 || entry.startTime - clsStart > 5000) {
      clsWindow = 0; clsStart = entry.startTime;
    }
    clsLast = entry.startTime; clsWindow += entry.value;
    metrics.cls = Math.round(Math.max(metrics.cls || 0, clsWindow) * 10000) / 10000;
  });
  // Explicitly an interaction maximum, not the web-vitals INP algorithm.
  observe("event", entry => {
    if (entry.interactionId) metrics.interactionMaxMs = Math.max(metrics.interactionMaxMs || 0, entry.duration);
  }, { durationThreshold: 16 });
  const played = new WeakSet();
  const playing = event => {
    if (!event.target.matches?.("video.home-tv-feed-video")) return;
    played.add(event.target);
    if (metrics.tvFirstPlayMs === undefined) {
      metrics.tvFirstPlayMs = Math.round(performance.now());
      metrics.tvRebuffers = 0;
    }
  };
  const waiting = event => {
    if (!played.has(event.target) || event.target.paused || !event.target.closest(".home-tv-feed-slide.is-active")) return;
    metrics.tvRebuffers = (metrics.tvRebuffers || 0) + 1;
  };
  document.addEventListener("playing", playing, true);
  document.addEventListener("waiting", waiting, true);
  let sent = false;
  function flush() {
    if (sent) return;
    sent = true;
    for (const { observer, receive } of observers) {
      observer.takeRecords().forEach(receive);
      observer.disconnect();
    }
    document.removeEventListener("playing", playing, true);
    document.removeEventListener("waiting", waiting, true);
    document.removeEventListener("visibilitychange", hidden);
    window.removeEventListener("pagehide", flush);
    if (!Object.keys(metrics).length) return;
    void fetch("/api/public/performance", {
      method: "POST", credentials: "omit", keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: 1, release, route, device: innerWidth <= 760 ? "mobile" : "desktop", metrics }),
    }).catch(() => {});
  }
  function hidden() { if (document.visibilityState === "hidden") flush(); }
  document.addEventListener("visibilitychange", hidden);
  window.addEventListener("pagehide", flush);
}());
