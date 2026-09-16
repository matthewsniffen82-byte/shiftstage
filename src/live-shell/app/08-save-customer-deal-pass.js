

    async function saveCustomerDealPass(pass) {
      if (!pass?.id) return false;
      syncDeviceSavedDealPasses();
      const storageKey = savedDealsStorageKey();
      const existingSavedPass = savedDealPasses.find((item) => item.id === pass.id);
      const wasAlreadySaved = Boolean(existingSavedPass);
      const savedToAccount = await persistCustomerDealSave(pass, true);
      if (storageKey !== savedDealsStorageKey()) {
        syncDeviceSavedDealPasses();
        renderCustomerQuickActions();
        return false;
      }
      const previousPasses = savedDealPasses;
      const savedPass = {
        ...existingSavedPass,
        ...pass,
        savedAt: existingSavedPass?.savedAt || new Date().toISOString(),
        serverSaved: savedToAccount || existingSavedPass?.serverSaved === true
      };
      savedDealPasses = [savedPass, ...savedDealPasses.filter((item) => item.id !== pass.id)].slice(0, 20);
      const persisted = saveSavedDealPasses();
      if (!persisted && !savedToAccount) savedDealPasses = previousPasses;
      if ((persisted || savedToAccount) && !wasAlreadySaved) recordRevenueDealLifecycle(pass, "saved");
      if (customerDashboard.classList.contains("show")) renderDashboard();
      renderCustomerQuickActions();
      showToast(savedToAccount
        ? "Saved privately to your account. Find it in Saved Club Deals beside the bell on Home."
        : persisted
          ? wasAlreadySaved
            ? "Deal is already saved on this device."
            : isCustomerSession()
              ? "Saved on this device. Find it in Saved Club Deals beside the bell on Home."
              : "Saved in this browser. Sign in before saving deals to your account."
          : "Browser storage blocked saving this deal. Allow site storage and try again.");
      return persisted || savedToAccount;
    }

    function recordRevenueDealLifecycle(pass, eventType) {
      if (!pass?.serverGenerated || !pass?.redemptionToken) return;
      postOptionalAuthJson(
        `/api/deals/redemptions/${encodeURIComponent(pass.redemptionToken)}/events`,
        {
          eventType,
          sessionId: liveDealSessionId()
        }
      ).catch(() => null);
    }

    async function saveDealPassForLater(pass) {
      return saveCustomerDealPass(pass);
    }

    async function removeSavedDealPass(pass) {
      if (!pass?.id) return false;
      syncDeviceSavedDealPasses();
      const storageKey = savedDealsStorageKey();
      const removedFromAccount = await persistCustomerDealSave(pass, false);
      if (storageKey !== savedDealsStorageKey()) {
        syncDeviceSavedDealPasses();
        renderCustomerQuickActions();
        return false;
      }
      const previousPasses = savedDealPasses;
      savedDealPasses = savedDealPasses.filter((item) => item.id !== pass.id);
      const persisted = saveSavedDealPasses();
      if (!persisted && !removedFromAccount) savedDealPasses = previousPasses;
      if (customerDashboard.classList.contains("show")) renderDashboard();
      renderCustomerQuickActions();
      showToast(removedFromAccount
        ? "Removed from your private saved deals."
        : persisted
        ? "Removed from saved deals."
        : "Browser storage blocked removing this deal. Allow site storage and try again.");
      return persisted || removedFromAccount;
    }

    const pendingNfcDealIntentTtlMs = 12 * 60 * 60 * 1000;

    function pendingNfcDealIntentForPass(pass) {
      try {
        const intent = JSON.parse(localStorage.getItem("mydancrPendingNfcDealV2") || "null");
        if (intent?.admissionPassVersion !== 1 || !/^\/deals\/pass\/[A-Za-z0-9_-]{43}$/.test(intent.passUrl || "")) return null;
        if (!intent || intent.venueId !== pass?.venueId || intent.dealId !== pass?.dealId) return null;
        if (!["self_drive", "club_shuttle", "autonomous_cab", "waymo", "zoox", "cybercab"].includes(intent.transportation)) return null;
        const passSource = pass?.sourceType || "club_page";
        if ((intent.sourceType || "club_page") !== passSource) return null;
        if (passSource === "dancer_profile" && String(intent.dancerId || "") !== String(pass?.dancerId || "")) return null;
        const selectedAt = Number(intent.savedAt || 0);
        const expiresAt = Number(intent.expiresAt || selectedAt + pendingNfcDealIntentTtlMs);
        return { ...intent, selectedAt, expiresAt, expired: !selectedAt || expiresAt <= Date.now() };
      } catch {
        return null;
      }
    }

    function selectDealPassForNfc(pass) {
      const ready = pendingNfcDealIntentForPass(pass);
      if (ready && !ready.expired) { window.location.assign(ready.passUrl); return { ok: true, intent: ready }; }
      const query = new URLSearchParams({
        sourceType: pass.sourceType || "club_page",
        dancerId: pass.sourceType === "dancer_profile" ? pass.dancerId || "" : "",
        attributionToken: pass.sourceType === "dancer_profile" ? pass.attributionToken || "" : ""
      });
      window.location.assign(`/deals/transportation/${encodeURIComponent(pass.dealId)}?${query}`);
      return { ok: true, intent: null };
    }

    async function shareDealPass(pass) {
      if (!pass?.url) return;
      const shareData = {
        title: `${pass.venueName} Club Deal`,
        text: `${pass.title} from ${pass.venueName}. Choose your arrival method and get a pass to show door staff.`,
        url: pass.url
      };
      try {
        if (navigator.share) {
          await navigator.share(shareData);
          recordRevenueDealLifecycle(pass, "shared");
          showToast("Deal shared");
        } else {
          await copyText(pass.url, "Deal link copied");
          recordRevenueDealLifecycle(pass, "shared");
        }
      } catch (error) {
        if (error?.name === "AbortError") {
          showToast("Share cancelled");
          return;
        }
        const copied = await copyText(pass.url, "Sharing was unavailable, so the deal link was copied");
        if (copied) recordRevenueDealLifecycle(pass, "shared");
      }
    }

    function captureClubDealOverlayReturnContext(triggerButton = null) {
      clubDealOverlayReturnContext = {
        windowScrollY: window.scrollY || 0,
        resultsScrollTop: results?.scrollTop || 0,
        focusTarget: triggerButton instanceof HTMLElement
          ? triggerButton
          : document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null
      };
    }

    function restoreClubDealOverlayReturnContext() {
      const returnContext = clubDealOverlayReturnContext;
      clubDealOverlayReturnContext = null;
      if (!returnContext) return;
      const restorePosition = () => {
        if (results) results.scrollTop = returnContext.resultsScrollTop || 0;
        window.scrollTo({ top: returnContext.windowScrollY || 0, left: 0, behavior: "auto" });
      };
      requestAnimationFrame(() => {
        restorePosition();
        requestAnimationFrame(() => {
          restorePosition();
          if (returnContext.focusTarget?.isConnected) {
            returnContext.focusTarget.focus({ preventScroll: true });
          }
        });
      });
    }

    function dealPassOverlay() {
      let overlay = document.getElementById("dealPassOverlay");
      if (overlay) return overlay;
      document.body.insertAdjacentHTML("beforeend", `
        <div class="deal-pass-overlay" id="dealPassOverlay" aria-hidden="true" hidden>
          <div class="deal-pass-sheet" role="dialog" aria-modal="true" aria-labelledby="dealPassTitle" data-deal-state="preview">
            <button class="deal-pass-close" type="button" data-close-deal-pass aria-label="Close Club Deal">${actionIconMarkup("close")}</button>
            <h3 class="deal-pass-title" id="dealPassTitle" tabindex="-1">Club Deal</h3>
            <p class="deal-pass-copy" id="dealPassCopy">Club offer</p>
            <div class="deal-pass-available-content" data-deal-pass-available>
              <p class="deal-pass-meta" id="dealPassExpiry" hidden></p>
              <div class="deal-pass-preview-panel">
                <div class="deal-pass-nfc-symbol" aria-hidden="true">${clubDealQrSymbolMarkup("deal-pass-preview-nfc-icon")}</div>
                <p class="deal-pass-preview-instruction" id="dealPassPreviewInstruction"></p>
                <p class="deal-pass-how" id="dealPassHow" role="status" aria-live="polite" hidden></p>
                <div class="deal-pass-offer" id="dealPassOffer">
                  <button class="deal-pass-terms-toggle" type="button" data-toggle-deal-pass-terms aria-expanded="false" aria-controls="dealPassTerms" hidden>Terms</button>
                  <div class="deal-pass-terms" id="dealPassTerms" hidden>
                    <p class="deal-pass-description" id="dealPassDescription"></p>
                    <p id="dealPassTermsCopy"></p>
                    <p id="dealPassAttribution" hidden></p>
                  </div>
                </div>
              </div>
            </div>
            <div class="deal-pass-ready-content" data-deal-pass-ready role="status" hidden>
              <div class="deal-pass-ready-instructions">
                <div class="deal-pass-nfc-symbol" aria-hidden="true">${clubDealQrSymbolMarkup("deal-pass-ready-nfc-icon")}</div>
                <p>Show your admission pass to door staff for scanning.</p>
              </div>
              <div class="deal-pass-ready-footer">
                <p class="deal-pass-ready-close-note">You can close MyDancr now.</p>
                <p class="deal-pass-ready-until" id="dealPassReadyUntil"></p>
              </div>
            </div>
            <div class="deal-pass-primary-dock">
              <div class="deal-pass-actions">
                <button class="deal-pass-action" type="button" data-save-deal-pass aria-pressed="false">Save</button>
                <button class="deal-pass-action" type="button" data-share-deal-pass>Share</button>
              </div>
              <button class="deal-pass-action primary" type="button" data-select-deal-pass aria-pressed="false">Use this deal</button>
            </div>
          </div>
        </div>
      `);
      overlay = document.getElementById("dealPassOverlay");
      const closeButton = overlay.querySelector("[data-close-deal-pass]");
      const selectButton = overlay.querySelector("[data-select-deal-pass]");
      const saveButton = overlay.querySelector("[data-save-deal-pass]");
      saveButton.setAttribute("aria-live", "polite");
      const shareButton = overlay.querySelector("[data-share-deal-pass]");
      const termsButton = overlay.querySelector("[data-toggle-deal-pass-terms]");
      const closeFromButton = (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeDealPassOverlay();
      };
      closeButton?.addEventListener("pointerdown", closeFromButton, { passive: false });
      closeButton?.addEventListener("click", closeFromButton);
      closeButton?.addEventListener("pointerup", closeFromButton);
      closeButton?.addEventListener("touchend", closeFromButton, { passive: false });
      const bindDealPassAction = (button, action) => {
        if (!button) return;
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          action(button);
        });
      };
      const currentPass = () => decodeDealPass(overlay.dataset.dealPass || "");
      bindDealPassAction(termsButton, (button) => {
        const terms = document.getElementById("dealPassTerms");
        const expanded = button.getAttribute("aria-expanded") === "true";
        button.setAttribute("aria-expanded", String(!expanded));
        button.textContent = expanded ? "Terms" : "Hide terms";
        terms.hidden = expanded;
      });
      bindDealPassAction(selectButton, (button) => {
        const pass = currentPass();
        if (!pass) {
          showToast("Club Deal unavailable");
          return;
        }
        button.disabled = true;
        button.textContent = "Preparing…";
        const result = selectDealPassForNfc(pass);
        if (result.ok) {
          syncDealPassOverlayState(overlay, pass);
          document.getElementById("dealPassTitle").focus({ preventScroll: true });
        } else {
          syncDealPassOverlayState(overlay, pass, {
            state: "error",
            message: "Couldn’t prepare this deal. Allow site storage, then try again."
          });
        }
      });
      bindDealPassAction(saveButton, async (button) => {
        const pass = currentPass();
        if (!pass) {
          showToast("Club Deal unavailable");
          return;
        }
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
        const feedback = document.getElementById("dealPassHow");
        feedback.hidden = true;
        try {
          const isSaved = savedDealPasses.some((item) => item.id === pass.id);
          if (isSaved) {
            button.textContent = "Removing…";
            const removed = await removeSavedDealPass(pass);
            if (currentPass()?.id !== pass.id) return;
            button.textContent = removed ? "Save" : "Try removing again";
            button.setAttribute("aria-pressed", removed ? "false" : "true");
            button.classList.toggle("is-saved", !removed);
            button.title = removed ? "Save this deal" : "Remove saved deal";
            return;
          }
          button.textContent = "Saving…";
          const persisted = await saveDealPassForLater(pass);
          if (currentPass()?.id !== pass.id) return;
          button.textContent = persisted ? "Saved ✓" : "Try saving again";
          button.setAttribute("aria-pressed", persisted ? "true" : "false");
          button.classList.toggle("is-saved", persisted);
          button.title = persisted ? "Remove saved deal" : "Save this deal";
          feedback.textContent = persisted
            ? savedDealPasses.some((item) => item.id === pass.id && item.serverSaved)
              ? "Saved to your account. Find it in Saved Club Deals beside the bell on Home."
              : isCustomerSession()
                ? "Saved on this device. Find it in Saved Club Deals beside the bell on Home."
                : "Saved on this device. Sign in as a customer to open Saved Club Deals on Home."
            : "Couldn’t save this deal. Please try again.";
          feedback.hidden = false;
        } catch (error) {
          if (currentPass()?.id !== pass.id) return;
          button.textContent = "Try saving again";
          showToast(error?.message || "Could not update this saved deal.");
        } finally {
          if (currentPass()?.id === pass.id) {
            button.disabled = false;
            button.setAttribute("aria-busy", "false");
          }
        }
      });
      bindDealPassAction(shareButton, () => {
        const pass = currentPass();
        if (pass) shareDealPass(pass);
      });
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay || event.target.closest("[data-close-deal-pass]")) {
          closeDealPassOverlay();
        }
      });
      return overlay;
    }

    function dealPassPresentation(pass) {
      const venueName = String(pass?.venueName || "Club").trim() || "Club";
      const dancerName = String(pass?.dancerName || "").trim();
      const dancerAttributed = pass?.sourceType === "dancer_profile" && dancerName;
      return {
        copy: `Valid at ${venueName}`,
        attribution: dancerAttributed ? `Credited to ${dancerName}` : ""
      };
    }

    function phoneTapCopy(value) {
      return value.replace(/https?:\/\/\S+|(^|[^\w/:?&=%@])NFC(?:\s+(links?|tags?|stickers?|taps?))?(?![\w/:])/gi, (match, prefix, noun, offset) => {
        if (prefix === undefined) return match;
        const plural = noun?.toLowerCase().endsWith("s");
        let replacement = /^links?$/i.test(noun || "")
          ? plural ? "links that appear" : "link that appears"
          : /^(tags?|stickers?)$/i.test(noun || "")
            ? plural ? "tap stickers" : "tap sticker"
            : plural ? "phone taps" : "phone tap";
        if (!value.slice(0, offset).trim() || /[.!?]\s*$/.test(value.slice(0, offset) + prefix)) {
          replacement = replacement[0].toUpperCase() + replacement.slice(1);
        }
        return prefix + replacement;
      });
    }

    function customerFacingDealTerms(value) {
      return phoneTapCopy(String(value || "")
        .replaceAll("Free admission requires arrival in your own car or other private car that is not an Uber or taxi, or use of the club's free shuttle service.", "Free admission when you arrive in a private car, club-provided transport, Waymo, Zoox, or Cybercab. Uber, Lyft, and other rideshares or taxis do not qualify. Waymo, Zoox, and Cybercab ride fares are not included.")
        .replaceAll("Free admission when you arrive in a private car or club-provided transport. Arrivals by Uber, Lyft, other rideshares, or taxi do not qualify.", "Free admission when you arrive in a private car, club-provided transport, Waymo, Zoox, or Cybercab. Uber, Lyft, and other rideshares or taxis do not qualify. Waymo, Zoox, and Cybercab ride fares are not included.")
        .replace(/(?:^|\s+)Cashier NFC confirmation is required\.(?=\s+|$)/gi, " ")
        .replace(/[ \t]{2,}/g, " ")
        .trim());
    }

    function customerFacingDealDescription(value) {
      const description = String(value || "").trim();
      return /^Open a tracked MyDancr QR to review the complete Club Deal experience\.$/i.test(description)
        ? ""
        : phoneTapCopy(description);
    }

    function formatDealPassClockTime(value) {
      const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
      if (!match) return "";
      const hours = Number(match[1]);
      const minutes = Number(match[2]);
      if (!Number.isFinite(hours) || hours < 0 || hours > 23 || !Number.isFinite(minutes) || minutes < 0 || minutes > 59) return "";
      return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" })
        .format(new Date(2000, 0, 1, hours, minutes));
    }

    function dealPassAvailabilityLabel(pass) {
      const days = Array.isArray(pass?.validDays)
        ? pass.validDays.map((day) => String(day || "").trim()).filter(Boolean)
        : [];
      const start = formatDealPassClockTime(pass?.validStartTime);
      const end = formatDealPassClockTime(pass?.validEndTime);
      const dayLabel = days
        .map((day) => day.slice(0, 3).replace(/^./, (letter) => letter.toUpperCase()))
        .join(", ");
      if (dayLabel && start && end) return `${dayLabel} · ${start}–${end}`;
      if (dayLabel && start) return `${dayLabel} · From ${start}`;
      if (dayLabel && end) return `${dayLabel} · Until ${end}`;
      if (dayLabel) return dayLabel;
      if (start && end) return `${start}–${end}`;
      if (start) return `From ${start}`;
      if (end) return `Until ${end}`;
      return "";
    }

    function formatNfcIntentExpiry(value) {
      const date = new Date(Number(value || 0));
      if (!Number.isFinite(date.getTime())) return "";
      return new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit"
      }).format(date);
    }

    function syncDealPassOverlayState(overlay, pass, override = null) {
      const sheet = overlay.querySelector(".deal-pass-sheet");
      const selectButton = overlay.querySelector("[data-select-deal-pass]");
      const saveButton = overlay.querySelector("[data-save-deal-pass]");
      const status = document.getElementById("dealPassHow");
      const expiry = document.getElementById("dealPassExpiry");
      const availableContent = overlay.querySelector("[data-deal-pass-available]");
      const readyContent = overlay.querySelector("[data-deal-pass-ready]");
      const readyUntilElement = document.getElementById("dealPassReadyUntil");
      const primaryDock = overlay.querySelector(".deal-pass-primary-dock");
      const titleElement = document.getElementById("dealPassTitle");
      const intent = pendingNfcDealIntentForPass(pass);
      const state = override?.state || (intent?.expired ? "expired" : intent ? "ready" : "preview");
      sheet.dataset.dealState = state;
      availableContent.hidden = state === "ready";
      readyContent.hidden = state !== "ready";
      primaryDock.hidden = false;
      titleElement.textContent = state === "ready" ? "Your admission pass is ready" : pass.title;
      document.getElementById("dealPassCopy").textContent = state === "ready"
        ? `${pass.title} · ${pass.venueName || "Club"}`
        : dealPassPresentation(pass).copy;
      status.hidden = state === "preview";
      status.classList.toggle("is-ready", state === "ready");
      status.classList.toggle("is-error", state === "error");
      status.classList.toggle("is-expired", state === "expired");
      if (state === "ready") {
        const readyUntil = formatNfcIntentExpiry(intent.expiresAt);
        status.textContent = "";
        status.hidden = true;
        selectButton.textContent = "Show admission pass";
        selectButton.disabled = false;
        selectButton.setAttribute("aria-pressed", "true");
        selectButton.classList.add("is-ready");
        readyUntilElement.textContent = readyUntil ? `Ready until ${readyUntil}` : "";
        readyUntilElement.hidden = !readyUntil;
      } else {
        status.textContent = state === "preview" ? "" : override?.message || (state === "expired"
          ? "Your pass expired. Choose this deal again to get a new pass."
          : "Unable to prepare this deal. Try again.");
        selectButton.textContent = state === "error" ? "Try again"
          : String(pass.title).toLowerCase() === "free admission" ? "Use free admission" : "Use this deal";
        document.getElementById("dealPassPreviewInstruction").textContent = `Tap “${selectButton.textContent}”, then choose your transportation.`;
        selectButton.disabled = false;
        selectButton.setAttribute("aria-pressed", "false");
        selectButton.classList.remove("is-ready");
        expiry.textContent = dealPassAvailabilityLabel(pass);
      }
      const isSaved = savedDealPasses.some((savedPass) => savedPass.id === pass.id);
      saveButton.textContent = isSaved ? "Saved ✓" : "Save";
      saveButton.title = isSaved ? "Remove saved deal" : "Save this deal";
      saveButton.setAttribute("aria-busy", "false");
      saveButton.setAttribute("aria-pressed", isSaved ? "true" : "false");
      saveButton.classList.toggle("is-saved", isSaved);
      saveButton.disabled = false;
    }

    function openDealPassOverlay(pass, triggerButton = null) {
      if (triggerButton || !clubDealOverlayReturnContext) {
        captureClubDealOverlayReturnContext(triggerButton);
      }
      const overlay = dealPassOverlay();
      const presentation = dealPassPresentation(pass);
      overlay.hidden = false;
      overlay.dataset.dealPass = encodeDealPass(pass);
      document.getElementById("dealPassTitle").textContent = pass.title;
      document.getElementById("dealPassCopy").textContent = presentation.copy;
      const description = customerFacingDealDescription(pass.description);
      const descriptionElement = document.getElementById("dealPassDescription");
      descriptionElement.hidden = !description;
      descriptionElement.textContent = description;
      const terms = customerFacingDealTerms(pass.terms);
      const termsElement = document.getElementById("dealPassTermsCopy");
      const termsButton = overlay.querySelector("[data-toggle-deal-pass-terms]");
      termsButton.hidden = !description && !terms && !presentation.attribution;
      termsButton.textContent = "Terms";
      termsButton.setAttribute("aria-expanded", "false");
      document.getElementById("dealPassTerms").hidden = true;
      termsElement.hidden = !terms;
      const attributionElement = document.getElementById("dealPassAttribution");
      attributionElement.textContent = presentation.attribution;
      attributionElement.hidden = !presentation.attribution;
      termsElement.textContent = terms;
      const validity = dealPassAvailabilityLabel(pass);
      const expiryElement = document.getElementById("dealPassExpiry");
      expiryElement.hidden = !validity;
      expiryElement.textContent = validity;
      const offerElement = document.getElementById("dealPassOffer");
      offerElement.hidden = termsButton.hidden;
      syncDealPassOverlayState(overlay, pass);
      overlay.classList.add("show");
      overlay.setAttribute("aria-hidden", "false");
      syncOverlayScrollLock();
      overlay.querySelector("[data-close-deal-pass]")?.focus({ preventScroll: true });
    }

    function closeDealPassOverlay(restorePosition = true) {
      const overlay = document.getElementById("dealPassOverlay");
      if (!overlay?.classList.contains("show")) return;
      if (overlay.contains(document.activeElement)) {
        document.activeElement.blur();
      }
      overlay.classList.remove("show");
      overlay.setAttribute("aria-hidden", "true");
      overlay.hidden = true;
      delete overlay.dataset.dealPass;
      syncOverlayScrollLock();
      if (restorePosition) restoreClubDealOverlayReturnContext();
    }

    function clubDealOffers(config) {
      if (Array.isArray(config?.deals) && config.deals.length) return config.deals;
      return config?.deal?.id ? [config.deal] : [];
    }

    function clubDealOfferTypeLabel(type) {
      if (type === "other") return "Club offer";
      return "Admission offer";
    }

    function clubDealSelectionConfig(config, deal) {
      return {
        ...config,
        deal,
        deals: undefined,
        attributionToken: config?.sourceType === "dancer_profile"
          ? config?.dealAttributionTokens?.[deal.id] || config?.attributionToken || ""
          : ""
      };
    }

    function closeClubDealHub(restorePosition = true) {
      const overlay = document.getElementById("clubDealHubOverlay");
      if (!overlay?.classList.contains("show")) return;
      overlay.classList.remove("show");
      overlay.setAttribute("aria-hidden", "true");
      overlay.hidden = true;
      syncOverlayScrollLock();
      if (restorePosition) restoreClubDealOverlayReturnContext();
    }

    function clubDealHubOverlay() {
      let overlay = document.getElementById("clubDealHubOverlay");
      if (overlay) return overlay;
      document.body.insertAdjacentHTML("beforeend", `
        <div class="deal-pass-overlay club-deal-hub-overlay" id="clubDealHubOverlay" aria-hidden="true" hidden>
          <section class="deal-pass-sheet club-deal-hub-sheet" role="dialog" aria-modal="true" aria-labelledby="clubDealHubTitle" aria-describedby="clubDealHubCopy" tabindex="-1">
            <button class="deal-pass-close" type="button" data-close-club-deal-hub aria-label="Close Club Deals">${actionIconMarkup("close")}</button>
            <p class="deal-pass-kicker">Live club offers</p>
            <h3 class="deal-pass-title" id="clubDealHubTitle">Club Deals</h3>
            <p class="deal-pass-copy" id="clubDealHubCopy">Choose your admission offer.</p>
            <p class="club-deal-hub-status" id="clubDealHubStatus" role="status" aria-live="polite" hidden></p>
            <div class="club-deal-hub-list" id="clubDealHubList"></div>
          </section>
        </div>
      `);
      overlay = document.getElementById("clubDealHubOverlay");
      overlay.addEventListener("click", async (event) => {
        if (event.target === overlay || event.target.closest("[data-close-club-deal-hub]")) {
          closeClubDealHub();
          return;
        }

        const offerButton = event.target.closest("[data-club-deal-offer]");
        if (!offerButton) return;
        const selection = decodeDealPass(offerButton.dataset.clubDealOffer || "");
        if (!selection) return;
        const offerButtons = [...overlay.querySelectorAll("[data-club-deal-offer]")];
        const status = document.getElementById("clubDealHubStatus");
        offerButtons.forEach((button) => {
          button.disabled = true;
          button.classList.toggle("is-selected", button === offerButton);
          button.setAttribute("aria-pressed", String(button === offerButton));
        });
        offerButton.classList.add("is-loading");
        offerButton.setAttribute("aria-busy", "true");
        overlay.setAttribute("aria-busy", "true");
        status.textContent = "Preparing your admission offer…";
        status.hidden = false;
        try {
          const pass = await createRevenueDealPass(selection);
          closeClubDealHub(false);
          openDealPassOverlay(pass);
        } catch (error) {
          status.textContent = error.message || "Unable to prepare this Club Deal. Please try again.";
          status.hidden = false;
          showToast(error.message || "Unable to prepare this Club Deal");
        } finally {
          overlay.removeAttribute("aria-busy");
          offerButtons.forEach((button) => {
            button.disabled = false;
            button.classList.remove("is-selected", "is-loading");
            button.setAttribute("aria-pressed", "false");
            button.removeAttribute("aria-busy");
          });
        }
      });
      return overlay;
    }

    function openClubDealHub(config, triggerButton = null) {
      const offers = clubDealOffers(config);
      if (!offers.length) {
        showToast("Club Deals unavailable");
        return;
      }
      captureClubDealOverlayReturnContext(triggerButton);
      const overlay = clubDealHubOverlay();
      const venueName = String(config?.venueName || "this club").trim() || "this club";
      const status = document.getElementById("clubDealHubStatus");
      document.getElementById("clubDealHubTitle").textContent = `Club Deals at ${venueName}`;
      document.getElementById("clubDealHubCopy").textContent = `${offers.length} live ${offers.length === 1 ? "offer" : "offers"}. Choose one to preview. Choose your arrival method to get an admission pass. Staff scans it at the door.`;
      status.textContent = "";
      status.hidden = true;
      overlay.removeAttribute("aria-busy");
      document.getElementById("clubDealHubList").innerHTML = offers.map((deal) => {
        const selection = clubDealSelectionConfig(config, deal);
        return `<button class="club-deal-hub-offer" type="button" data-club-deal-offer="${encodeDealPass(selection)}" aria-pressed="false"><span>${clubDealOfferTypeLabel(deal.offerType)}</span><strong>${escapeHtml(deal.dealTitle || "Club Deal")}</strong><small>${escapeHtml(customerFacingDealDescription(deal.dealDescription) || "Club offer")}</small><em>Show your pass to door staff</em></button>`;
      }).join("");
      overlay.hidden = false;
      overlay.classList.add("show");
      overlay.setAttribute("aria-hidden", "false");
      syncOverlayScrollLock();
      overlay.querySelector(".club-deal-hub-sheet")?.focus({ preventScroll: true });
    }

    async function handleDealPassClick(event) {
      const revenueTrigger = event.target.closest("[data-club-deal-cta]");
      if (revenueTrigger) {
        event.preventDefault();
        event.stopPropagation();
        const config = decodeDealPass(revenueTrigger.dataset.clubDealCta || "");
        if (!config) {
          showToast("Club Deal unavailable");
          return true;
        }
        const offers = clubDealOffers(config);
        if (offers.length > 1) {
          openClubDealHub(config, revenueTrigger);
          return true;
        }
        if (offers.length === 1) config.deal = offers[0];
        revenueTrigger.disabled = true;
        revenueTrigger.classList.add("is-loading");
        try {
          const pass = await createRevenueDealPass(config);
          openDealPassOverlay(pass, revenueTrigger);
          if (
            revenueTrigger.hasAttribute("data-feed-live-qr") ||
            revenueTrigger.hasAttribute("data-feed-venue-qr")
          ) {
            recordVenuePageEvent({
              venueId: pass.venueId,
              dancerId: pass.dancerId,
              eventType: "qr_impression",
              source: revenueTrigger.hasAttribute("data-feed-venue-qr") ? "venue_page" : "dancer_profile"
            });
          }
        } catch (error) {
          showCardQrNotice(
            revenueTrigger,
            "Club Deals",
            error.message || "Unable to prepare this Club Deal"
          );
        } finally {
          revenueTrigger.disabled = false;
          revenueTrigger.classList.remove("is-loading");
        }
        return true;
      }
      const trigger = event.target.closest("[data-deal-pass]");
      if (!trigger) return false;
      event.preventDefault();
      event.stopPropagation();
      const pass = decodeDealPass(trigger.dataset.dealPass || "");
      if (!pass) {
        showToast("Club Deal unavailable");
        return true;
      }
      openDealPassOverlay(pass, trigger);
      if (
        trigger.hasAttribute("data-feed-live-qr") ||
        trigger.hasAttribute("data-feed-venue-qr")
      ) {
        recordVenuePageEvent({
          venueId: pass.venueId,
          dancerId: pass.dancerId,
          eventType: "qr_impression",
          source: trigger.hasAttribute("data-feed-venue-qr") ? "venue_page" : "dancer_profile"
        });
      }
      return true;
    }

    function venueOfferMarkup(venue) {
      if (venue?.activeDeal && venue?.id) {
        const config = {
          deal: venue.activeDeal,
          deals: venue.activeDeals,
          venueId: venue.id,
          venueSlug: venue.slug,
          venueName: venue.name,
          sourceType: "club_page"
        };
        return `
          <article class="venue-offer-card revenue-offer-card venue-deal-preview is-active-club-deal" id="club-deal">
            <div class="venue-offer-grid">
              <div class="venue-deal-preview-copy">
                <div class="venue-detail-club-deal-heading">
                  <span class="venue-detail-club-deal-status">Active tonight</span>
                </div>
              </div>
              <div class="venue-detail-club-deal-actions">
                <button class="venue-detail-club-deal-cta" type="button" data-club-deal-state="available" data-club-deal-cta="${encodeDealPass(config)}" aria-label="View free entry at ${escapeHtml(venue.name || "this club")}">
                  <strong>Free Entry</strong>
                  <span aria-hidden="true">›</span>
                </button>
                ${uberRideLinkMarkup({ venue, source: "venue_page", className: "venue-detail-entry-ride", dealConfig: config })}
              </div>
            </div>
          </article>
        `;
      }
      return "";
    }

    function dancerProfileClubDealConfig(profile) {
      if (
        !profile ||
        !isWorkingTonight(profile) ||
        !profile.venue ||
        !profile.venueId ||
        !profile.activeDeal?.id
      ) return null;

      const dancerAttributed = Boolean(profile.dealAttributionToken);
      return {
        deal: profile.activeDeal,
        deals: profile.activeDeals,
        venueId: profile.venueId,
        venueSlug: profile.venueSlug,
        venueName: profile.venue,
        sourceType: dancerAttributed ? "dancer_profile" : "club_page",
        dancerId: dancerAttributed ? profile.id : "",
        dancerName: dancerAttributed ? profile.name : "",
        attributionToken: dancerAttributed ? profile.dealAttributionToken : "",
        dealAttributionTokens: dancerAttributed ? profile.dealAttributionTokens : {}
      };
    }

    function dancerClubDealState(profile) {
      const workingNow = Boolean(profile && isWorkingTonight(profile));
      const available = Boolean(dancerProfileClubDealConfig(profile));
      if (available) {
        return {
          key: "available",
          label: "Club Deal",
          detail: profile?.dealAttributionToken
            ? "A tracked Club Deal is available during this verified check-in."
            : "This club has an active Club Deal available now."
        };
      }
      if (workingNow) {
        return {
          key: "no-active-offer",
          label: "No active deal",
          detail: `${profile?.venue || "This club"} has no live offer right now.`
        };
      }
      if (profile?.scheduled) {
        return {
          key: "available-when-working",
          label: "Going tonight? View free entry",
          detail: `Open ${profile?.venue || "the venue"}'s page to view its Club Deals.`
        };
      }
      return {
        key: "not-available-now",
        label: "No active club deal",
        detail: "Deals activate after a verified club check-in."
      };
    }

    function profileDealTileMarkup(profile) {
      const state = dancerClubDealState(profile);
      if (state.key === "available") {
        const config = dancerProfileClubDealConfig(profile);
        const offerCount = Math.max(1, config?.deals?.length || 1);
        const dealTitle = String(config?.deal?.dealTitle || "Club Deal").trim() || "Club Deal";
        return `
          <div class="info-tile profile-qr-tile profile-club-deal-tile is-active" data-club-deal-state="active" data-profile-club-deal-config="${encodeDealPass(config)}" aria-label="Active Club Deal">
            <div class="profile-club-deal-copy">
              <b class="profile-club-deal-title">${escapeHtml(dealTitle)}</b>
              <strong class="profile-club-deal-label">Active Club Deal</strong>
            </div>
            <button class="profile-club-deal-qr-button" type="button" aria-label="Loading active Club Deal" disabled>
              <span class="profile-club-deal-loading" aria-hidden="true"></span>
              <span class="profile-club-deal-offer-count" hidden>${offerCount}</span>
            </button>
          </div>
        `;
      }
      const inactiveActionLabel = state.key === "available-when-working" ? "At check-in" : "Inactive";
      return `
        <div class="info-tile profile-qr-tile profile-club-deal-tile is-inactive" data-club-deal-state="${escapeHtml(state.key)}" aria-label="Inactive Club Deal">
          <div class="profile-club-deal-copy">
            <strong class="profile-club-deal-label">Club Deal</strong>
            <b class="profile-club-deal-title">${escapeHtml(state.label)}</b>
            <small>${escapeHtml(state.detail)}</small>
          </div>
          <button class="profile-club-deal-qr-button" type="button" aria-label="Club Deal ${escapeHtml(inactiveActionLabel.toLowerCase())}" disabled>
            <span class="profile-club-deal-action-copy"><strong>${escapeHtml(inactiveActionLabel)}</strong></span>
          </button>
        </div>
      `;
    }

    function profileShareText(profileName, city = selectedCity()) {
      return `See ${profileName}'s verified Dancr schedule in ${city}.`;
    }

    function venueShareUrl(venue, city = selectedCity()) {
      return new URL(venueExperienceHref(venue, city), window.location.origin).toString();
    }

    function setVenueShareButtonState(button, state) {
      if (!button?.classList.contains("venue-detail-share")) return;
      const isSharing = state === "sharing";
      const isConfirmed = state === "confirmed";
      button.disabled = isSharing;
      button.classList.toggle("is-confirmed", isConfirmed);
      button.setAttribute("aria-live", "polite");
      button.innerHTML = actionButtonLabel(
        isConfirmed ? "check" : "share",
        isSharing ? "Sharing..." : isConfirmed ? "Shared" : "Share"
      );
      const resetTimer = Number(button.dataset.shareResetTimer || 0);
      if (resetTimer) window.clearTimeout(resetTimer);
      delete button.dataset.shareResetTimer;
      if (!isConfirmed) return;
      button.dataset.shareResetTimer = String(window.setTimeout(() => {
        if (!button.isConnected) return;
        setVenueShareButtonState(button, "idle");
      }, 1800));
    }

    async function runVenueShareAction(venueName, city = selectedCity(), trigger = null) {
      const venue = resolveVenueByName(venueName, city);
      if (!venue) {
        showToast("Club profile unavailable");
        return;
      }
      const analyticsContext = venueInteractionContext(trigger);
      setVenueShareButtonState(trigger, "sharing");
      const url = venueShareUrl(venue, city);
      const shareData = {
        title: `${venue.name} on MyDancr`,
        text: `See ${venue.name} on MyDancr.`,
        url
      };
      if (navigator.share) {
        try {
          await navigator.share(shareData);
          setVenueShareButtonState(trigger, "confirmed");
          recordVenueInteraction({ ...analyticsContext, venueId: venue.id, eventType: "share_completed" });
          showToast("Club profile shared");
          return;
        } catch (error) {
          setVenueShareButtonState(trigger, "idle");
          if (error?.name !== "AbortError") showToast("Sharing unavailable");
          return;
        }
      }
      const copied = await copyText(url, "Club link copied");
      if (copied) recordVenueInteraction({ ...analyticsContext, venueId: venue.id, eventType: "share_completed" });
      setVenueShareButtonState(trigger, copied ? "confirmed" : "idle");
    }

    function socialShareUrl(platformKey, profileName, city = selectedCity()) {
      const url = profileShareUrl(profileName, city);
      const text = profileShareText(profileName, city);
      const encodedUrl = encodeURIComponent(url);
      const encodedText = encodeURIComponent(text);
      if (platformKey === "x") return `https://x.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`;
      if (platformKey === "instagram") return "https://www.instagram.com/";
      if (platformKey === "tiktok") return "https://www.tiktok.com/upload";
      if (platformKey === "snapchat") return `https://www.snapchat.com/scan?attachmentUrl=${encodedUrl}`;
      return url;
    }

    async function copyText(value, successMessage = "Link copied") {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(value);
        } else {
          const textarea = document.createElement("textarea");
          textarea.value = value;
          textarea.setAttribute("readonly", "");
          textarea.style.position = "fixed";
          textarea.style.opacity = "0";
          document.body.appendChild(textarea);
          textarea.select();
          const copied = document.execCommand("copy");
          textarea.remove();
          if (!copied) throw new Error("Copy command was rejected");
        }
        showToast(successMessage);
        return true;
      } catch {
        showToast("Copy link unavailable");
        return false;
      }
    }

    function shareButtonsMarkup(profileName, city = selectedCity(), mode = "customer") {
      const copyLabel = mode === "dancer" ? "Copy profile link" : "Copy link";
      const nativeLabel = mode === "dancer" ? "Share profile" : "Share";
      return `
        <div class="share-panel">
          <div class="share-link-row">
            <div class="share-url">${escapeHtml(profileShareUrl(profileName, city))}</div>
            <button class="share-copy" type="button" data-copy-share="${escapeHtml(profileName)}" data-share-city="${escapeHtml(city)}">${copyLabel}</button>
          </div>
          <div class="share-buttons">
            <button class="share-open" type="button" data-native-share="${escapeHtml(profileName)}" data-share-city="${escapeHtml(city)}">${actionButtonLabel("share", nativeLabel)}</button>
            ${sharePlatforms.map((platform) => `
              <a class="social-link social-${platform.key}" href="${escapeHtml(socialShareUrl(platform.key, profileName, city))}" target="_blank" rel="noreferrer" data-social-share="${platform.key}" data-share-city="${escapeHtml(city)}" data-profile="${escapeHtml(profileName)}" aria-label="Share to ${platform.label}">
                ${socialIconMarkup(platform.key)}<span>${platform.label}</span>
              </a>
            `).join("")}
          </div>
          <div class="share-note">${mode === "dancer" ? "Promote your verified schedule on connected social channels." : "Share this verified schedule. Guest profiles stay private."}</div>
        </div>
      `;
    }

    function hasBlockedSocialLink(values) {
      const blocked = ["escort", "booking", "cashapp", "venmo"];
      return values.some((value) => blocked.some((term) => String(value).toLowerCase().includes(term)));
    }

    function socialLinksMarkup(profile, options = {}) {
      const includeUnapproved = Boolean(options.preview || options.includeUnapproved);
      const submittedByPlatform = new Map(normalizeSubmittedSocials(profile).map((social) => [social.platform, social]));
      const links = socialPlatforms
        .map((platform) => {
          const submitted = submittedByPlatform.get(platform.key);
          const status = normalizedReviewStatus(submitted?.reviewStatus || (submitted ? "pending" : "approved"));
          const liveUrl = profile.socials?.[platform.key] || "";
          const submittedUrl = submitted?.url || "";
          const url = includeUnapproved
            ? submittedUrl || liveUrl
            : status === "approved"
              ? submittedUrl || liveUrl
              : liveUrl && liveUrl !== submittedUrl
                ? liveUrl
                : "";
          return {
            ...platform,
            url: safeExternalHref(url),
            status
          };
        })
        .filter((platform) => platform.url);
      if (!links.length) {
        return "";
      }
      return `
        <div class="info-tile social-tile" aria-label="External profiles">
          <div class="social-links" role="list">
            ${links.map((platform) => `<a class="social-link social-${platform.key}" href="${escapeHtml(platform.url)}" target="_blank" rel="noopener noreferrer" aria-label="${platform.label}" title="${platform.label}" data-profile="${escapeHtml(profile.name)}" data-social="${platform.key}">${socialIconMarkup(platform.key)}</a>`).join("")}
          </div>
        </div>
      `;
    }

    function approvedDancerShiftVenues() {
      const affiliations = Array.isArray(liveDancerVenueVerification?.affiliations)
        ? liveDancerVenueVerification.affiliations
        : [];
      const uniqueVenues = new Map();
      affiliations.forEach((affiliation) => {
        const venue = affiliation?.venue;
        if (affiliation?.status !== "active" || affiliation?.revokedAt || !venue?.id || !venue?.name) return;
        uniqueVenues.set(venue.id, venue);
      });
      return [...uniqueVenues.values()];
    }
