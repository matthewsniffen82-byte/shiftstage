    (() => {
      // Capture the browser event before the deferred application has loaded.
      const state = window.__dancrHomeScreenInstall = { promptEvent: null, installed: false, accepted: false };
      window.addEventListener("beforeinstallprompt", (event) => {
        if (typeof event.prompt !== "function") return;
        event.preventDefault();
        state.promptEvent = event;
        state.accepted = false;
        window.dispatchEvent(new Event("dancr-install-state-change"));
      });
      window.addEventListener("appinstalled", () => {
        state.promptEvent = null;
        state.installed = true;
        window.dispatchEvent(new Event("dancr-install-state-change"));
      });
    })();
