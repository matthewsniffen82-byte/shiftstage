/* One seekable playback bar for the discovery and React dancer galleries. */
(() => {
  "use strict";

  function mount(video, host) {
    const track = host.ownerDocument.createElement("span");
    track.className = "profile-media-video-track";
    track.setAttribute("aria-hidden", "true");
    const slider = host.ownerDocument.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.step = "0.1";
    slider.setAttribute("aria-label", "Video playback position");
    host.replaceChildren(track, slider);

    const duration = () => Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const timeLabel = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
    const sync = () => {
      const total = duration();
      const current = total ? Math.min(total, Math.max(0, Number(video.currentTime) || 0)) : 0;
      slider.max = String(total || 1);
      slider.value = String(current);
      slider.disabled = !total;
      slider.setAttribute("aria-valuetext", total ? `${timeLabel(current)} of ${timeLabel(total)}` : "Video loading");
      host.style.setProperty("--profile-video-played", `${total ? current / total * 100 : 0}%`);
    };
    const seek = () => {
      const total = duration();
      const requested = Number(slider.value);
      if (!total || !Number.isFinite(requested)) return;
      video.currentTime = Math.min(total, Math.max(0, requested));
      sync();
    };
    // Seeking must not trigger the card's tap-to-pause or scrolling handlers.
    const stop = (event) => event.stopPropagation();
    const videoEvents = ["loadedmetadata", "durationchange", "timeupdate", "seeking", "seeked", "ended", "emptied"];
    const isolatedEvents = ["click", "pointerdown", "pointerup", "keydown"];
    videoEvents.forEach((name) => video.addEventListener(name, sync));
    isolatedEvents.forEach((name) => slider.addEventListener(name, stop));
    slider.addEventListener("input", seek);
    sync();

    return () => {
      videoEvents.forEach((name) => video.removeEventListener(name, sync));
      isolatedEvents.forEach((name) => slider.removeEventListener(name, stop));
      slider.removeEventListener("input", seek);
      host.replaceChildren();
    };
  }

  const api = { mount };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.MyDancrMediaProgress = api;
})();
