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
    : /^\/dashboard\/customer(?:\/|$)/.test(url.pathname) ? "customer"
    : /^\/dashboard\/dancer(?:\/|$)/.test(url.pathname) ? "dancer"
    : /^\/dashboard\/venue(?:\/|$)/.test(url.pathname) ? "club"
    : /^\/(?:dashboard\/)?vip(?:\/|$)/.test(url.pathname) ? "vip"
    : /^\/admin(?:\/|$)/.test(url.pathname) ? "admin"
    : /^\/internal(?:\/|$)/.test(url.pathname) ? "internal"
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
  // Measure panel appearance only when a user explicitly selects a known workspace tab.
  const panelKeys = {
    "customer-view-night": "nightPanelMs", "customer-view-saved": "savedPanelMs",
    "customer-view-alerts": "alertsPanelMs", "customer-view-account": "accountPanelMs",
    "dancer-destination-overview": "overviewPanelMs", "dancer-destination-profile": "profilePanelMs",
    "dancer-destination-results": "resultsPanelMs", "dancer-destination-account": "accountPanelMs",
    "venue-workspace-tonight": "tonightPanelMs", "venue-workspace-roster": "rosterPanelMs",
    "venue-workspace-business": "resultsPanelMs", "venue-workspace-venue": "clubPanelMs",
  };
  let pendingPanel = null;
  const panelObserver = typeof MutationObserver === "function" && ["customer", "dancer", "club"].includes(route)
    ? new MutationObserver(() => {
      if (!pendingPanel) return;
      const { id, start } = pendingPanel;
      const element = document.getElementById(id);
      if (!element || !element.getClientRects().length) return;
      metrics[panelKeys[id]] = Math.round(performance.now() - start);
      pendingPanel = null;
      panelObserver.disconnect();
    }) : null;
  const onTabClick = event => {
    if (!panelObserver) return;
    panelObserver.disconnect();
    pendingPanel = null;
    const button = event.target.closest?.("button[aria-controls]");
    const id = button?.getAttribute("aria-controls");
    if (!Object.hasOwn(panelKeys, id) || button.disabled || button.getAttribute("aria-current") === "page" || button.getAttribute("aria-selected") === "true") return;
    pendingPanel = { id, start: performance.now() };
    panelObserver.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden", "aria-selected", "aria-current"] });
  };
  if (panelObserver) document.addEventListener("click", onTabClick, true);
  const played = new WeakSet();
  const playStarts = new WeakMap();
  const onPlay = event => {
    const video = event.target;
    if (metrics.videoFirstFrameMs !== undefined || !video.matches?.("video") || !video.requestVideoFrameCallback) return;
    const start = performance.now();
    playStarts.set(video, start);
    video.requestVideoFrameCallback(() => {
      if (!sent && !video.paused && playStarts.get(video) === start && metrics.videoFirstFrameMs === undefined)
        metrics.videoFirstFrameMs = Math.round(performance.now() - start);
    });
  };
  document.addEventListener("play", onPlay, true);
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
    panelObserver?.disconnect();
    document.removeEventListener("click", onTabClick, true);
    document.removeEventListener("play", onPlay, true);
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
