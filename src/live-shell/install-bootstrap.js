    (() => {
      // Capture the browser event before the deferred application has loaded.
      const state = window.__dancrHomeScreenInstall = { promptEvent: null, installed: false, accepted: false };
      const samsungBrowser = /SamsungBrowser/i.test(navigator.userAgent || "");
      // Select before fetching a manifest, so Samsung never starts with the
      // standalone app metadata. Its browser shortcut does not need a WebAPK.
      const manifest = document.getElementById("homeScreenManifest");
      if (manifest) manifest.href = samsungBrowser ? "/manifest-shortcut.webmanifest" : "/manifest.webmanifest";
      if (samsungBrowser) {
        document.querySelectorAll('meta[name="mobile-web-app-capable"], meta[name="apple-mobile-web-app-capable"]')
          .forEach((meta) => { meta.content = "no"; });
      }
      window.addEventListener("beforeinstallprompt", (event) => {
        if (typeof event.prompt !== "function") return;
        event.preventDefault();
        // Samsung's generated Android package can be blocked as outdated.
        // Keep its prompt suppressed and offer browser shortcut instructions.
        state.promptEvent = samsungBrowser ? null : event;
        state.accepted = false;
        window.dispatchEvent(new Event("dancr-install-state-change"));
      });
      window.addEventListener("appinstalled", () => {
        state.promptEvent = null;
        state.installed = true;
        window.dispatchEvent(new Event("dancr-install-state-change"));
      });
    })();
