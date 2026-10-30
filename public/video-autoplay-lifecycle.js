/* Retry the selected inline player when Safari can actually start it. */
(() => {
  "use strict";

  function mount(video, { isActive, play }) {
    const doc = video.ownerDocument;
    const view = doc.defaultView;
    let disposed = false;
    let pending = false;
    const resume = (event) => {
      if (disposed || pending || video.isConnected === false || doc.visibilityState === "hidden" || !isActive()) return;
      if (event?.type === "click" || event?.type === "touchend" || event?.type === "keydown") {
        if (!event.isTrusted) return;
        // Let a video's own tap handler decide whether to pause or resume.
        // touchend precedes click, so resuming here could invert that decision.
        if (event.type === "touchend" && event.target?.closest?.("video, button, a, input, [role='button']")) return;
      }
      video.autoplay = true;
      video.setAttribute("autoplay", "");
      video.playsInline = true;
      video.setAttribute("playsinline", "");
      video.setAttribute("webkit-playsinline", "");
      if (!video.paused) return;
      pending = true;
      // Call synchronously: deferring past the gesture loses Safari permission.
      try { Promise.resolve(play()).catch(() => {}).finally(() => { pending = false; }); }
      catch { pending = false; }
    };
    const readyEvents = ["loadedmetadata", "loadeddata", "canplay"];
    const interactionEvents = ["click", "touchend", "keydown"];
    readyEvents.forEach(name => video.addEventListener(name, resume));
    interactionEvents.forEach(name => doc.addEventListener(name, resume));
    doc.addEventListener("visibilitychange", resume);
    view.addEventListener("pageshow", resume);
    resume();
    return () => {
      disposed = true;
      readyEvents.forEach(name => video.removeEventListener(name, resume));
      interactionEvents.forEach(name => doc.removeEventListener(name, resume));
      doc.removeEventListener("visibilitychange", resume);
      view.removeEventListener("pageshow", resume);
    };
  }

  const api = { mount };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.MyDancrVideoAutoplay = api;
})();
