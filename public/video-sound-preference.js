(() => {
  "use strict";

  const STORAGE_KEY = "mydancr.video-sound-muted.v1";
  const PREFERENCE_EVENT = "mydancr:video-sound-preference";
  const SOUND_CONTROL_SELECTOR = [
    "[data-home-tv-sound]",
    "#modalVideoSound",
    "[data-toggle-profile-tv-sound]",
  ].join(",");
  const MANAGED_VIDEO_SELECTOR = [
    ".home-tv-feed-video",
    ".modal-media-video-preview > video",
    "#profileTvViewerVideo",
  ].join(",");

  let preferredMuted = true;
  let hasStoredPreference = false;
  let soundTogglePending = false;
  let mutationFrame = 0;

  function readPreference() {
    try {
      const stored = window.sessionStorage.getItem(STORAGE_KEY);
      hasStoredPreference = stored === "muted" || stored === "sound-on";
      preferredMuted = stored !== "sound-on";
    } catch {
      hasStoredPreference = false;
      preferredMuted = true;
    }
  }

  function writePreference(muted) {
    preferredMuted = Boolean(muted);
    hasStoredPreference = true;
    try {
      window.sessionStorage.setItem(
        STORAGE_KEY,
        preferredMuted ? "muted" : "sound-on",
      );
    } catch {
      // The page-scoped preference still works when storage is unavailable.
    }
    window.dispatchEvent(
      new CustomEvent(PREFERENCE_EVENT, { detail: { muted: preferredMuted } }),
    );
  }

  function syncModalAccessibility(video) {
    if (!video.matches(".modal-media-video-preview > video")) return;
    const container = video.closest("#modalImage");
    if (!container) return;
    const label = container.getAttribute("aria-label") || "";
    if (!label) return;
    container.setAttribute(
      "aria-label",
      label
        .replace("autoplaying muted", "autoplaying with sound")
        .replace(
          "autoplaying with sound",
          preferredMuted ? "autoplaying muted" : "autoplaying with sound",
        ),
    );
  }

  function applyPreferenceToVideo(video) {
    if (!(video instanceof HTMLVideoElement) || !hasStoredPreference) return;
    video.muted = preferredMuted;
    video.defaultMuted = preferredMuted;
    if (preferredMuted) video.setAttribute("muted", "");
    else video.removeAttribute("muted");
    syncModalAccessibility(video);
  }

  function applyPreferenceToManagedVideos(root = document) {
    if (!hasStoredPreference) return;
    if (root instanceof HTMLVideoElement && root.matches(MANAGED_VIDEO_SELECTOR)) {
      applyPreferenceToVideo(root);
    }
    root.querySelectorAll?.(MANAGED_VIDEO_SELECTOR).forEach(applyPreferenceToVideo);
  }

  function syncHomeFeedState() {
    if (!hasStoredPreference) return;
    const button = document.querySelector("[data-home-tv-sound]");
    if (!button) return;
    const feedMuted = button.getAttribute("aria-pressed") !== "true";
    if (feedMuted === preferredMuted) return;
    button.click();
  }

  function selectedVideoForControl(control) {
    if (control.matches("[data-home-tv-sound]")) {
      return control.closest(".home-tv-feed-slide")?.querySelector(".home-tv-feed-video") ||
        document.querySelector('.home-tv-feed-slide[aria-current="true"] .home-tv-feed-video');
    }
    if (control.matches("#modalVideoSound")) {
      return document.querySelector(".modal-media-video-preview > video");
    }
    if (control.matches("[data-toggle-profile-tv-sound]")) {
      return document.getElementById("profileTvViewerVideo");
    }
    return null;
  }

  function settleSoundControl(control) {
    const video = selectedVideoForControl(control);
    if (video instanceof HTMLVideoElement) {
      writePreference(video.muted);
      applyPreferenceToManagedVideos();
    }
    soundTogglePending = false;
  }

  document.addEventListener("click", (event) => {
    const control = event.target instanceof Element
      ? event.target.closest(SOUND_CONTROL_SELECTOR)
      : null;
    if (!control) return;
    soundTogglePending = true;
    window.setTimeout(() => settleSoundControl(control), 0);
  }, true);

  document.addEventListener("play", (event) => {
    const video = event.target;
    if (!(video instanceof HTMLVideoElement) || !video.matches(MANAGED_VIDEO_SELECTOR)) return;
    applyPreferenceToVideo(video);
  }, true);

  document.addEventListener("volumechange", (event) => {
    const video = event.target;
    if (
      soundTogglePending ||
      !(video instanceof HTMLVideoElement) ||
      !video.matches(MANAGED_VIDEO_SELECTOR) ||
      !hasStoredPreference ||
      video.muted === preferredMuted
    ) {
      return;
    }
    applyPreferenceToVideo(video);
  }, true);

  window.addEventListener(PREFERENCE_EVENT, (event) => {
    if (typeof event.detail?.muted !== "boolean") return;
    preferredMuted = event.detail.muted;
    hasStoredPreference = true;
    applyPreferenceToManagedVideos();
    syncHomeFeedState();
  });

  const observer = new MutationObserver((records) => {
    if (mutationFrame) window.cancelAnimationFrame(mutationFrame);
    mutationFrame = window.requestAnimationFrame(() => {
      mutationFrame = 0;
      records.forEach((record) => {
        record.addedNodes.forEach((node) => {
          if (node instanceof Element) applyPreferenceToManagedVideos(node);
        });
      });
      syncHomeFeedState();
    });
  });

  readPreference();
  observer.observe(document.documentElement, { childList: true, subtree: true });
  applyPreferenceToManagedVideos();
  syncHomeFeedState();
})();
