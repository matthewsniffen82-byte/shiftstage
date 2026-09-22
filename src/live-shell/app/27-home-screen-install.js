    (() => {
      const state = window.__dancrHomeScreenInstall;
      const button = document.getElementById("homeScreenInstallBtn");
      const dialog = document.getElementById("homeScreenInstallDialog");
      const steps = document.getElementById("homeScreenInstallSteps");
      const help = document.getElementById("homeScreenInstallHelp");
      const intro = document.getElementById("homeScreenInstallIntro");
      const ua = navigator.userAgent || "";
      const samsungBrowser = /SamsungBrowser/i.test(ua);
      const appleMobile = /iPhone|iPad|iPod/i.test(ua)
        || /Mac/i.test(navigator.platform || "") && navigator.maxTouchPoints > 1;
      const android = /Android/i.test(ua) || /Android/i.test(navigator.userAgentData?.platform || "");
      const standalone = window.matchMedia("(display-mode: standalone)");
      const installedDisplay = () => standalone.matches || navigator.standalone === true;

      function syncInstallAction() {
        button.hidden = state.installed || state.accepted || installedDisplay()
          || !(appleMobile || android || samsungBrowser || state.promptEvent);
        if ((state.installed || installedDisplay()) && dialog.open) dialog.close();
      }

      function showInstallInstructions() {
        let instructions;
        intro.textContent = "Open MyDancr with one tap.";
        if (appleMobile) {
          instructions = [
            "In Safari, tap Share (the square with an upward arrow). It may be inside the ••• menu.",
            "Choose Add to Home Screen.",
            "Leave Open as Web App on if shown, then tap Add."
          ];
          help.textContent = "If you’re using another browser or an in-app link, open mydancr.com in Safari first. If Add to Home Screen is missing, find it under Edit Actions in the Share menu.";
        } else if (samsungBrowser) {
          intro.textContent = "Add a shortcut that opens MyDancr in Samsung Internet.";
          instructions = [
            "Tap the Samsung Internet menu (☰).",
            "Choose Add page to, then Home screen. You may see Add to Home screen instead.",
            "Keep the name mydancr and tap Add."
          ];
          help.textContent = "The icon opens MyDancr in your browser. If you still see Install or a Play Protect warning, cancel and refresh this page before trying again. Keep Play Protect enabled.";
        } else if (android) {
          instructions = [
            "Open your browser menu (⋮).",
            "Choose Add to Home screen or Install app.",
            "Tap Add or Install to confirm."
          ];
          help.textContent = "If that option is missing, open mydancr.com in an up-to-date Chrome browser and try again.";
        } else {
          instructions = ["Open your browser menu.", "Choose Install MyDancr or Install app, then confirm."];
          help.textContent = "If the install option is unavailable, you can keep using MyDancr in this browser.";
        }
        steps.replaceChildren(...instructions.map((text) => {
          const item = document.createElement("li");
          item.textContent = text;
          return item;
        }));
        if (!dialog.open) dialog.showModal();
      }

      button.addEventListener("click", async () => {
        closeUtilityMenu();
        if (state.installed || installedDisplay()) return;
        if (samsungBrowser) {
          state.promptEvent = null;
          showInstallInstructions();
          return;
        }
        const pending = state.promptEvent;
        if (!pending) {
          showInstallInstructions();
          return;
        }
        // Each native prompt can only be used once, including after dismissal.
        state.promptEvent = null;
        button.disabled = true;
        try {
          const result = await pending.prompt();
          const choice = await (pending.userChoice || result);
          state.accepted = choice?.outcome === "accepted";
        } catch {
          showInstallInstructions();
        } finally {
          button.disabled = false;
          syncInstallAction();
        }
      });
      document.getElementById("homeScreenInstallClose").addEventListener("click", () => dialog.close());
      document.getElementById("homeScreenInstallDone").addEventListener("click", () => dialog.close());
      dialog.addEventListener("click", (event) => {
        if (event.target !== dialog) return;
        const bounds = dialog.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right
          || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
      });
      dialog.addEventListener("keydown", (event) => {
        // Keep Escape from also dismissing underlying application surfaces.
        if (event.key === "Escape") event.stopPropagation();
      });
      dialog.addEventListener("close", () => {
        (guestMenuBtn.hidden ? accountBtn : guestMenuBtn).focus({ preventScroll: true });
      });
      window.addEventListener("dancr-install-state-change", syncInstallAction);
      window.addEventListener("pageshow", syncInstallAction);
      standalone.addEventListener("change", syncInstallAction);
      syncInstallAction();
    })();
