/* Shared by the discovery shell and the React profile viewer. */
(() => {
  "use strict";

  function createController(surface, { onChange, onLayout }) {
    const doc = surface.ownerDocument;
    let active = false;
    let nativeSeen = false;
    let disposed = false;
    let revision = 0;
    const fullscreenElement = () => doc.fullscreenElement || doc.webkitFullscreenElement;
    const exitOwned = () => {
      if (fullscreenElement() !== surface) return Promise.resolve();
      const exit = doc.exitFullscreen || doc.webkitExitFullscreen;
      try { return Promise.resolve(exit?.call(doc)).catch(() => undefined); }
      catch { return Promise.resolve(); }
    };
    const layout = (attempt) => {
      if (!disposed && surface.isConnected && revision === attempt) onLayout();
    };
    const fullscreenChanged = () => {
      if (fullscreenElement() === surface) {
        nativeSeen = true;
        if (disposed || !active || !surface.isConnected) void exitOwned();
        else layout(revision);
      } else if (nativeSeen) {
        nativeSeen = false;
        if (!disposed && active) {
          active = false;
          revision += 1;
          onChange(false);
          layout(revision);
        }
      }
    };

    function set(next) {
      if (disposed || !surface.isConnected || active === next) return Promise.resolve();
      active = next;
      const attempt = ++revision;
      // Apply the in-page fallback immediately. The native request must stay
      // inside the tap's user activation, before any asynchronous work.
      onChange(active);
      if (!active) return exitOwned().then(() => layout(attempt));
      let request;
      try {
        if (typeof surface.requestFullscreen === "function") {
          request = surface.requestFullscreen({ navigationUI: "hide" });
        } else if (typeof surface.webkitRequestFullscreen === "function") {
          request = surface.webkitRequestFullscreen();
        }
      } catch {
        layout(attempt);
        return Promise.resolve();
      }
      return Promise.resolve(request).then(() => {
        // A slow permission response must not reopen a closed viewer or exit
        // a newer fullscreen session belonging to another component.
        if (disposed || !active || !surface.isConnected) return exitOwned();
        layout(attempt);
      }, () => layout(attempt));
    }

    const releaseForDialog = (event) => {
      // Account, offer and report dialogs live outside the native fullscreen
      // surface. Leave fullscreen before their existing handlers open them.
      if (active && event.target?.closest?.(
        ".profile-media-entry, .profile-media-control-follow, [data-profile-photo-follow], [data-profile-tv-follow], .profile-photo-viewer-report, .profile-tv-viewer-report, .profile-media-viewer-report"
      )) void set(false);
    };
    doc.addEventListener("fullscreenchange", fullscreenChanged);
    doc.addEventListener("webkitfullscreenchange", fullscreenChanged);
    surface.addEventListener("click", releaseForDialog, true);

    return {
      set,
      dispose() {
        disposed = true;
        active = false;
        revision += 1;
        doc.removeEventListener("fullscreenchange", fullscreenChanged);
        doc.removeEventListener("webkitfullscreenchange", fullscreenChanged);
        surface.removeEventListener("click", releaseForDialog, true);
        void exitOwned();
      },
    };
  }

  const api = { createController };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.MyDancrMediaFullscreen = api;
})();
