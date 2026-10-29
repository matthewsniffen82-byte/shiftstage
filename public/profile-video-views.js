(() => {
  "use strict";

  // Match the React TV viewer's session. The live shell supplies its existing
  // session getter so profile and TV playback share the server's daily dedup.
  const SESSION_KEY = "mydancrTvViewerSessionV1";
  const recorded = new Set();
  const pending = new Set();
  let fallbackSessionId = "";

  function readSessionId() {
    try {
      const saved = window.localStorage.getItem(SESSION_KEY);
      if (saved) return saved;
    } catch { /* Storage can be unavailable in private browsers. */ }
    if (!fallbackSessionId) {
      fallbackSessionId = window.crypto?.randomUUID?.() || `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    try { window.localStorage.setItem(SESSION_KEY, fallbackSessionId); }
    catch { /* Keep one stable session in memory when storage is blocked. */ }
    return fallbackSessionId;
  }

  function mount(video, options) {
    const videoId = String(options?.videoId || "").split("~")[0];
    if (!video || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(videoId)) return () => {};
    const doc = video.ownerDocument;
    const win = doc.defaultView;
    let timer = null;
    let disposed = false;

    function eligible() {
      return !disposed && video.isConnected && !video.paused && !video.ended
        && !video.seeking && video.readyState >= 3 && doc.visibilityState !== "hidden"
        && (!options.isActive || options.isActive());
    }

    function stop() {
      if (timer !== null) win.clearTimeout(timer);
      timer = null;
    }

    async function record() {
      timer = null;
      if (!eligible()) return;
      let pendingKey;
      try {
        const sessionId = options.getSessionId ? options.getSessionId() : readSessionId();
        const key = `${new Date().toISOString().slice(0, 10)}:${sessionId}:${videoId}`;
        if (recorded.has(key) || pending.has(key)) return;
        const accessToken = options.getAccessToken?.();
        pending.add(key);
        pendingKey = key;
        const response = await win.fetch(`/api/public/tv/${encodeURIComponent(videoId)}/events`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
          body: JSON.stringify({ eventType: "engaged_view", source: "dancer_profile", sessionId }),
        });
        if (response.ok) recorded.add(key);
      } catch { /* Analytics must never interrupt playback; a later play can retry. */ }
      finally { if (pendingKey) pending.delete(pendingKey); }
    }

    function start() {
      if (timer === null && eligible()) timer = win.setTimeout(record, 3000);
    }

    function visibilityChanged() {
      stop();
      start();
    }

    const stopEvents = ["pause", "waiting", "seeking", "ended", "emptied", "error"];
    video.addEventListener("playing", start);
    stopEvents.forEach((event) => video.addEventListener(event, stop));
    doc.addEventListener("visibilitychange", visibilityChanged);
    win.addEventListener("pagehide", stop);
    win.addEventListener("pageshow", start);
    start();
    return () => {
      disposed = true;
      stop();
      video.removeEventListener("playing", start);
      stopEvents.forEach((event) => video.removeEventListener(event, stop));
      doc.removeEventListener("visibilitychange", visibilityChanged);
      win.removeEventListener("pagehide", stop);
      win.removeEventListener("pageshow", start);
    };
  }

  const api = { mount };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.MyDancrProfileVideoViews = api;
})();
