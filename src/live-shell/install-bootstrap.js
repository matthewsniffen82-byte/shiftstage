    (() => {
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
        // Keep automatic install prompts suppressed; installation remains
        // available through the browser's own menu.
        event.preventDefault();
      });
    })();
