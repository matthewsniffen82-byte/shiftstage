
    (() => {
      // The Home Screen launch can paint with system fonts while the optional
      // remote stylesheet loads. Attach the handler here to retain strict CSP.
      const webFonts = document.getElementById("homeWebFonts");
      if (webFonts) {
        const applyWebFonts = () => { webFonts.media = "all"; };
        webFonts.addEventListener("load", applyWebFonts, { once: true });
        if (webFonts.sheet) applyWebFonts();
      }
      const ua = navigator.userAgent || "";
      const platform = (navigator.userAgentData && navigator.userAgentData.platform) || "";
      const isAndroid = /Android/i.test(ua) || /Linux.*Mobile/i.test(ua) || /Android/i.test(platform);
      const isSamsung = /SamsungBrowser/i.test(ua);
      const root = document.documentElement;

      try {
        const initialParams = new URLSearchParams(window.location.search);
        if (initialParams.get("venue_preview") === "1" && initialParams.get("venue")) {
          root.classList.add("venue-preview-bootstrap");
        } else if (initialParams.get("venue")) {
          root.classList.add("venue-profile-bootstrap");
        }
      } catch {
        // The normal application shell remains available when URL parsing is unavailable.
      }

      if (isAndroid) root.classList.add("is-android", "android-rendering");
      if (isSamsung) root.classList.add("is-samsung-browser", "samsung-rendering");

      window.__dancrApplyDeviceClasses = () => {
        const body = document.body;
        if (!body) return;
        if (isAndroid) body.classList.add("is-android", "android-rendering");
        if (isSamsung) body.classList.add("is-samsung-browser", "samsung-rendering");
      };

      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", window.__dancrApplyDeviceClasses, { once: true });
      } else {
        window.__dancrApplyDeviceClasses();
      }

      let dancrViewportTop = null;
      let dancrViewportFrame = 0;
      window.__dancrSyncViewportSafeTop = () => {
        const editorOpen = document.getElementById("approvedEditProfileDropdown")?.classList.contains("show");
        const viewportTop = editorOpen
          ? Math.max(0, Math.round(window.visualViewport?.offsetTop || 0))
          : 0;
        if (viewportTop === dancrViewportTop) return;
        dancrViewportTop = viewportTop;
        document.documentElement.style.setProperty("--dancr-viewport-top", `${viewportTop}px`);
      };
      window.__dancrQueueViewportSafeTop = () => {
        if (!document.getElementById("approvedEditProfileDropdown")?.classList.contains("show") || dancrViewportFrame) return;
        dancrViewportFrame = window.requestAnimationFrame(() => {
          dancrViewportFrame = 0;
          window.__dancrSyncViewportSafeTop();
        });
      };
      window.__dancrSyncViewportSafeTop();
      window.visualViewport?.addEventListener("resize", window.__dancrSyncViewportSafeTop, { passive: true });
      window.visualViewport?.addEventListener("scroll", window.__dancrQueueViewportSafeTop, { passive: true });
      window.addEventListener("orientationchange", window.__dancrSyncViewportSafeTop, { passive: true });
    })();
