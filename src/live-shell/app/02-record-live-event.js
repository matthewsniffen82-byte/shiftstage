

    function recordLiveEvent(type, details = {}) {
      if (window.location.protocol === "file:") return;
      try {
        const payload = JSON.stringify({
          type,
          city: selectedCity(),
          sessionId: dancrLiveSessionId(),
          ...details,
        });
        if (navigator.sendBeacon) {
          navigator.sendBeacon("/api/events", new Blob([payload], { type: "application/json" }));
          return;
        }
        fetch("/api/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true,
        }).catch(() => {});
      } catch (error) {}
    }

    function buildUberRideUrl(destination) {
      const fallback = "https://m.uber.com/looking";
      try {
        const name = String(destination?.name || "").trim();
        const formattedAddress = String(destination?.formattedAddress || "").trim();
        if (!name || !formattedAddress) return fallback;

        const url = new URL(fallback);
        url.searchParams.set("action", "setPickup");
        url.searchParams.set("pickup", "my_location");
        url.searchParams.set("dropoff[nickname]", name);
        url.searchParams.set("dropoff[formatted_address]", formattedAddress);
        const dropoff = {
          addressLine1: name,
          addressLine2: formattedAddress
        };
        const latitude = Number(destination.latitude);
        const longitude = Number(destination.longitude);
        const validLatitude = destination.latitude !== null && destination.latitude !== "" && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90;
        const validLongitude = destination.longitude !== null && destination.longitude !== "" && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
        if (validLatitude && validLongitude) {
          dropoff.latitude = latitude;
          dropoff.longitude = longitude;
          url.searchParams.set("dropoff[latitude]", String(latitude));
          url.searchParams.set("dropoff[longitude]", String(longitude));
        }
        url.searchParams.set("drop[0]", JSON.stringify(dropoff));
        return url.toString();
      } catch (error) {
        return fallback;
      }
    }

    function publicVenueUberDestination(venue, city = selectedCity()) {
      if (!venue) return null;
      const details = venueDetails(venue, city);
      const name = String(venue.name || details.name || "").trim();
      const fictionalAddress = fictionalDemoVenueTravelAddress(venue);
      const formattedAddress = fictionalAddress || String(venue.address || details.address || "").trim();
      if (!name || !formattedAddress) return null;
      return {
        name,
        formattedAddress,
        latitude: fictionalAddress ? null : venue.latitude,
        longitude: fictionalAddress ? null : venue.longitude
      };
    }

    const FICTIONAL_DEMO_VENUE_TRAVEL_ADDRESS = "0000 MyDancr Ave, Las Vegas, NV 55555";

    function isFictionalDemoVenue(venue) {
      return String(venue?.logoImageUrl || "").trim().startsWith("/venue-logos/fictional/");
    }

    function fictionalDemoVenueTravelAddress(venue) {
      return isFictionalDemoVenue(venue) ? FICTIONAL_DEMO_VENUE_TRAVEL_ADDRESS : "";
    }

    function venueDirectionsMarkup({ venue, className, label = "Directions", city = selectedCity(), dancerId = "" }) {
      const details = venueDetails(venue, city);
      const safeName = escapeHtml(venue?.name || details.name || "this club");
      const venueValue = escapeOptionValue(venue?.name || details.name || "");
      const dancerValue = escapeOptionValue(dancerId);
      const destinationAddress = fictionalDemoVenueTravelAddress(venue) || String(details.address || "").trim();
      if (!destinationAddress) {
        return `<button class="${className} is-travel-unavailable" type="button" data-travel-unavailable="directions" disabled aria-disabled="true" aria-label="Directions unavailable for ${safeName}">${actionButtonLabel("pin", escapeHtml(label))}</button>`;
      }
      return `<a class="${className}" href="https://maps.google.com/?q=${encodeURIComponent(destinationAddress)}" target="_blank" rel="noreferrer" data-venue="${venueValue}" data-venue-id="${escapeOptionValue(venue?.id || "")}"${dancerValue ? ` data-dancer-id="${dancerValue}"` : ""} aria-label="Get directions to ${safeName}">${actionButtonLabel("pin", escapeHtml(label))}</a>`;
    }

    function rideActionLabel(source, venueName) {
      const safeVenueName = String(venueName || "this club").trim() || "this club";
      return source === "dancer_profile" ? `Free Entry + Pickup at ${safeVenueName}` : "Free Ride + Entry";
    }

    function uberRideLinkMarkup({ venue, source, className = "", displayLabel = "", dealConfig = null }) {
      const label = rideActionLabel(source, venue?.name);
      const visibleLabel = String(displayLabel || label).trim() || label;
      const classes = ["uber-ride-link", className].filter(Boolean).join(" ");
      if (!venue?.id || venue.isActive === false || venue.isPublic === false) {
        const safeName = escapeHtml(venue?.name || "this club");
        return `<button class="${classes} is-travel-unavailable" type="button" data-travel-unavailable="shuttle" disabled aria-disabled="true" aria-label="Free ride unavailable for ${safeName}">${actionButtonLabel("car", escapeHtml(label))}</button>`;
      }
      const query = new URLSearchParams();
      if (dealConfig?.deal?.id) {
        query.set("dealId", dealConfig.deal.id);
        if (dealConfig.sourceType === "dancer_profile" && dealConfig.dancerId && dealConfig.attributionToken) {
          query.set("sourceType", "dancer_profile");
          query.set("dancerId", dealConfig.dancerId);
          query.set("attributionToken", dealConfig.attributionToken);
        }
      }
      const href = `/rides/${encodeURIComponent(venue.id)}${query.size ? `?${query}` : ""}`;
      return `<a class="${classes}" href="${escapeHtml(href)}" data-free-ride-link data-venue-id="${escapeOptionValue(venue.id)}"${dealConfig?.dancerId ? ` data-dancer-id="${escapeOptionValue(dealConfig.dancerId)}"` : ""} aria-label="${escapeHtml(label)}. Free admission with club-provided transport. Request pickup; the club will contact you to confirm.">${actionButtonLabel("car", escapeHtml(visibleLabel))}</a>`;
    }

    document.addEventListener("click", (event) => {
      const link = event.target.closest?.("[data-free-ride-link]");
      if (!link) return;
      event.stopPropagation();
    }, true);

    document.addEventListener("click", (event) => {
      const unavailableTravelButton = event.target.closest?.("[data-travel-unavailable]");
      if (!unavailableTravelButton) return;
      event.preventDefault();
      event.stopPropagation();
      showToast(unavailableTravelButton.dataset.travelUnavailable === "shuttle"
        ? "Free ride requests are unavailable for this club."
        : "Directions are unavailable because this club has not published a usable address.");
    });

    function loadAuthSession() {
      clearRetiredAccountCaches();
      try {
        const raw = localStorage.getItem("dancrAuthSessionV1");
        return raw ? JSON.parse(raw) : null;
      } catch (error) {
        return null;
      }
    }

    function normalizeAccountEmail(value) {
      return typeof value === "string" ? value.trim().toLowerCase() : "";
    }

    function accountEmailStorageKey(role) {
      return `dancrAccountEmail:${role}`;
    }

    function persistAccountEmail(role, _email) {
      // Retire the duplicate email copy; the current authenticated session owns it.
      try { localStorage.removeItem(accountEmailStorageKey(role)); } catch {}
    }

    function sessionEmailForRole(role) {
      const sessionRole = authSession?.account?.role || authSession?.role;
      if (!authSession?.accessToken || (role && sessionRole !== role)) return "";
      return normalizeAccountEmail(authSession?.account?.email) ||
        normalizeAccountEmail(authSession?.email) ||
        normalizeAccountEmail(authSession?.user?.email);
    }

    function updateCurrentEmailDisplays() {
      ["customer", "dancer"].forEach((role) => {
        const node = document.getElementById(`${role}CurrentEmail`);
        if (node) node.textContent = sessionEmailForRole(role) || "Not signed in";
      });
    }

    function saveAuthSession(session) {
      try {
        const pushAccount = localStorage.getItem("mydancr:push-account");
        if (pushAccount && pushAccount !== session?.account?.id) void clearCustomerPushDevice();
      } catch (error) {}
      if (browserAccountIdentity(authSession) !== browserAccountIdentity(session)) {
        savedAdminContentReviews = [];
        savedAdminContentReviewAccount = "";
      }
      authSession = session;
      visibleAuthAccountIdentity = browserAccountIdentity(session);
      const role = session?.account?.role || session?.role;
      const email =
        normalizeAccountEmail(session?.account?.email) ||
        normalizeAccountEmail(session?.email) ||
        normalizeAccountEmail(session?.user?.email);
      if (role && email) persistAccountEmail(role, email);
      try {
        if (session) localStorage.setItem("dancrAuthSessionV1", JSON.stringify(session));
        else localStorage.removeItem("dancrAuthSessionV1");
      } catch (error) {}
      updateCurrentEmailDisplays();
    }

    async function endAuthSession() {
      const session = synchronizeAuthSession();
      saveAuthSession(null);
      if (!session?.accessToken) return true;

      const headers = { Authorization: `Bearer ${session.accessToken}` };
      if (session.refreshToken) headers["X-Dancr-Refresh-Token"] = session.refreshToken;
      try {
        const response = await fetch("/api/auth", {
          method: "DELETE",
          headers,
          cache: "no-store",
          credentials: "same-origin",
          keepalive: true
        });
        return response.ok;
      } catch (error) {
        return false;
      }
    }

    async function clearCustomerPushDevice() {
      try {
        localStorage.removeItem("mydancr:push-account");
        if (!("serviceWorker" in navigator)) return;
        const registration = await navigator.serviceWorker.getRegistration("/push/onesignal/");
        if (!registration?.scope.endsWith("/push/onesignal/")) return;
        const subscription = await registration?.pushManager.getSubscription();
        if (!localStorage.getItem("mydancr:push-account")) await subscription?.unsubscribe();
      } catch (error) {}
    }

    function savePendingAuthConfirmation(state) {
      try {
        localStorage.setItem("dancrPendingAuthConfirmationV1", JSON.stringify({
          ...state,
          createdAt: Date.now()
        }));
      } catch (error) {}
    }

    function readPendingAuthConfirmation() {
      try {
        const raw = localStorage.getItem("dancrPendingAuthConfirmationV1");
        if (!raw) return null;
        const state = JSON.parse(raw);
        if (!state?.role || Date.now() - Number(state.createdAt || 0) > 1000 * 60 * 60 * 24) {
          localStorage.removeItem("dancrPendingAuthConfirmationV1");
          return null;
        }
        return state;
      } catch (error) {
        return null;
      }
    }

    function clearPendingAuthConfirmation() {
      try {
        localStorage.removeItem("dancrPendingAuthConfirmationV1");
      } catch (error) {}
    }

    function readConfirmationSessionFromUrl() {
      if (window.__DANCR_CONFIRMED_SESSION__?.accessToken) {
        return window.__DANCR_CONFIRMED_SESSION__;
      }
      const hash = window.location.hash ? window.location.hash.slice(1) : "";
      const query = window.location.search ? window.location.search.slice(1) : "";
      const hashParams = new URLSearchParams(hash);
      const queryParams = new URLSearchParams(query);
      const accessToken = hashParams.get("access_token") || queryParams.get("access_token");
      if (!accessToken) return null;

      const sensitiveKeys = ["access_token", "refresh_token", "expires_at", "expires_in", "token_type"];
      sensitiveKeys.forEach((key) => queryParams.delete(key));
      if (!hashParams.get("access_token")) {
        hashParams.set("access_token", accessToken);
        for (const key of ["refresh_token", "expires_at", "expires_in", "token_type", "type"]) {
          const value = new URLSearchParams(query).get(key);
          if (value) hashParams.set(key, value);
        }
      }
      const callbackUrl = new URL("/auth/callback", window.location.origin);
      callbackUrl.search = queryParams.toString();
      callbackUrl.hash = hashParams.toString();
      window.location.replace(callbackUrl.pathname + callbackUrl.search + callbackUrl.hash);
      return null;
    }

    async function hydrateConfirmedSessionAccount(role, state) {
      const initiatingSession = synchronizeAuthSession();
      if (!initiatingSession?.accessToken) return;
      try {
        const data = await getAuthenticatedJson("/api/account");
        const current = synchronizeAuthSession();
        const sameAccount = initiatingSession.account?.id
          ? current?.account?.id === initiatingSession.account.id
          : current?.accessToken === initiatingSession.accessToken;
        if (!current?.accessToken || !sameAccount || !data?.account) return;
        // Account roles come from the verified server response, never URL hints.
        saveAuthSession({ ...current, account: data.account });
      } catch (error) {
        // Preserve the existing session during a temporary account lookup failure.
      }
    }
    const authResumeStorageKey = "dancrAuthResumeV1";
    readAuthResumeStore();
    const accountTooltipStorageKey = "dancrAccountTooltipDismissedV1";
    let accountTooltipTimer = 0;

    function authResumeToken() {
      if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
      return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    function readAuthResumeStore() {
      try {
        const raw = localStorage.getItem(authResumeStorageKey) || "{}";
        const store = pruneAuthResumeStore(raw.length <= 262144 ? JSON.parse(raw) : {});
        writeAuthResumeStore(store);
        return store;
      } catch {
        try { localStorage.removeItem(authResumeStorageKey); } catch {}
        return {};
      }
    }

    function pruneAuthResumeStore(value) {
      if (!value || typeof value !== "object" || Array.isArray(value)) return {};
      const now = Date.now();
      const allowed = ["role", "email", "city", "activeTab", "selectedVenueName", "scrollY", "createdAt", "mode",
        "dancerCity", "resumeTarget", "setupStep", "authIntent", "freshDancerVerification", "destination"];
      return Object.fromEntries(Object.entries(value).filter(([token, state]) => {
        return /^[a-zA-Z0-9-]{1,128}$/.test(token) && state && typeof state === "object" && !Array.isArray(state)
          && ["customer", "dancer", "venue"].includes(state.role) && Number.isFinite(state.createdAt)
          && state.createdAt <= now && now - state.createdAt < 86400000;
      }).sort((left, right) => right[1].createdAt - left[1].createdAt).slice(0, 20).map(([token, state]) => {
        const fields = Object.fromEntries(allowed.filter(key => {
          const item = state[key];
          return (typeof item === "string" && item.length <= (key === "destination" ? 2048 : 254)) || typeof item === "boolean"
            || (typeof item === "number" && Number.isFinite(item));
        }).map(key => [key, state[key]]));
        return [token, fields];
      }));
    }

    function writeAuthResumeStore(store) {
      try {
        const retained = pruneAuthResumeStore(store);
        if (Object.keys(retained).length) localStorage.setItem(authResumeStorageKey, JSON.stringify(retained));
        else localStorage.removeItem(authResumeStorageKey);
      } catch {}
    }

    function accountIconMarkup() {
      return `<svg class="account-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/></svg>`;
    }

    function dismissAccountTooltip() {
      if (!accountTooltip) return;
      accountTooltip.classList.remove("show");
      accountTooltip.hidden = true;
      if (accountTooltipTimer) window.clearTimeout(accountTooltipTimer);
      accountTooltipTimer = 0;
      try {
        localStorage.setItem(accountTooltipStorageKey, "1");
      } catch (error) {}
    }

    function hideAccountTooltip() {
      if (!accountTooltip) return;
      accountTooltip.classList.remove("show");
      accountTooltip.hidden = true;
      if (accountTooltipTimer) window.clearTimeout(accountTooltipTimer);
      accountTooltipTimer = 0;
    }

    function maybeShowAccountTooltip(role) {
      if (!accountTooltip || (role !== "customer" && role !== "dancer")) return;
      try {
        if (localStorage.getItem(accountTooltipStorageKey) === "1") return;
      } catch (error) {}
      accountTooltip.hidden = false;
      window.requestAnimationFrame(() => accountTooltip.classList.add("show"));
      if (accountTooltipTimer) window.clearTimeout(accountTooltipTimer);
      accountTooltipTimer = window.setTimeout(dismissAccountTooltip, 5000);
    }

    function saveAuthResume(role, returnTo = "") {
      const token = authResumeToken();
      const store = readAuthResumeStore();
      const state = {
        role,
        city: citySelect.value,
        activeTab,
        selectedVenueName,
        scrollY: window.scrollY || 0,
        createdAt: Date.now()
      };

      if (role === "customer") {
        state.mode = authMode;
        state.email = document.getElementById("customerEmail")?.value || "";
      }

      if (role === "dancer") {
        state.email = document.getElementById("dancerEmail")?.value || "";
        state.dancerCity = "";
        state.resumeTarget = "dancer_verification";
        state.setupStep = "profile";
        state.authIntent = "signup";
        state.freshDancerVerification = true;
      }

      if (role === "venue") {
        state.email = document.getElementById("venueLoginEmail")?.value || "";
      }

      store[token] = state;
      writeAuthResumeStore(store);
      const destination = returnTo || (role === "dancer" ? "/dashboard/dancer" : role === "venue" ? "/dashboard/venue" : "/dashboard/customer");
      state.destination = destination;
      savePendingAuthConfirmation({ ...state, resumeToken: token });
      return `${window.location.origin}/auth/callback?dancr_confirm=1&resume=${encodeURIComponent(token)}&role=${encodeURIComponent(role)}&dancr_role=${encodeURIComponent(role)}&return_to=${encodeURIComponent(destination)}`;
    }

    function savePasswordResetResume(role, email, returnTo = "") {
      const dashboardRole = role === "dancer" || role === "venue" ? role : "customer";
      const token = authResumeToken();
      const store = readAuthResumeStore();
      const destination = returnTo || (dashboardRole === "dancer" ? "/dashboard/dancer" : dashboardRole === "venue" ? "/dashboard/venue" : "/dashboard/customer");
      const state = {
        role: dashboardRole,
        email: normalizeAccountEmail(email),
        city: citySelect.value,
        activeTab,
        selectedVenueName,
        scrollY: window.scrollY || 0,
        destination,
        resumeTarget: "account_password",
        authIntent: "password_reset",
        createdAt: Date.now()
      };
      store[token] = state;
      writeAuthResumeStore(store);
      savePendingAuthConfirmation({ ...state, resumeToken: token });
      return `${window.location.origin}/auth/callback?dancr_reset=1&resume=${encodeURIComponent(token)}&role=${encodeURIComponent(dashboardRole)}&dancr_role=${encodeURIComponent(dashboardRole)}&reset_target=account_password&return_to=${encodeURIComponent(destination)}`;
    }

    function takeAuthResume(token) {
      const store = readAuthResumeStore();
      const state = store[token];
      if (state) {
        delete store[token];
        writeAuthResumeStore(store);
      }
      return state || null;
    }

    function isFreshDancerVerificationState(state = {}) {
      return state.role === "dancer"
        && state.resumeTarget === "dancer_verification"
        && (state.authIntent === "signup" || state.freshDancerVerification);
    }

    function resetFreshDancerVerificationDraft() {
      freshDancerVerificationLockedToProfile = true;
      markDancerProfileSetupSaved(false);
      try {
        localStorage.removeItem(dancerProfileDraftStorageKey());
      } catch (error) {}
      Object.assign(dancerSetup, {
        profile: false,
        photos: false,
        review: false,
        approval: false,
        shift: false
      });
      ["dancerLegalName", "dancerStageName", "dancerCity", "setupStageName", "setupCity"].forEach((id) => {
        const field = document.getElementById(id);
        if (field) field.value = "";
      });
      if (typeof dancerSignupSocials === "object" && dancerSignupSocials) {
        Object.keys(dancerSignupSocials).forEach((key) => {
          dancerSignupSocials[key] = "";
        });
      }
    }

    function prepareConfirmedDancerVerification(state = {}) {
      const freshVerification = isFreshDancerVerificationState(state);
      if (freshVerification) {
        resetFreshDancerVerificationDraft();
      }
      dancerSignupStarted = true;
      stripeConfirmed = true;
      setupChecklistExpanded = true;
      const requestedStep = state.resumeTarget === "dancer_verification" ? "profile" : state.setupStep;
      activeSetupStep = requestedStep || nextIncompleteStep() || "profile";
      const dancerEmail = document.getElementById("dancerEmail");
      const dancerCity = document.getElementById("dancerCity");
      if (dancerEmail && state.email) dancerEmail.value = state.email;
      const confirmedCity = state.dancerCity || "";
      if (confirmedCity) pendingDancerSignupCity = confirmedCity;
      if (dancerCity && !dancerCity.value.trim()) dancerCity.value = confirmedCity;
      if (freshVerification) {
        activeSetupStep = "profile";
      }
    }

    function scrollDancerVerificationIntoView() {
      const profileForm = document.querySelector('[data-setup-form="profile"]');
      const profileStep = document.querySelector('#setupChecklist [data-step="profile"]');
      const target = profileForm || profileStep || document.getElementById("setupChecklistWrap") || document.getElementById("dancerApprovalCommand");
      target?.scrollIntoView({ block: "start", behavior: "smooth" });
      setTimeout(() => {
        document.querySelector('[data-setup-profile-editor] [data-approved-avatar-upload]')?.focus({ preventScroll: true });
      }, 260);
    }

    function scrollDancerDashboardToTop(behavior = "auto") {
      window.requestAnimationFrame(() => {
        dancerDashboard?.scrollTo?.({ top: 0, behavior });
        dancerDashboard?.querySelector?.(".page-panel-inner")?.scrollTo?.({ top: 0, behavior });
        window.scrollTo({ top: 0, behavior });
      });
    }

    const dancerDashboardLinkStorageKey = "dancrPendingDancerDashboardLinkV1";

    function storePendingDancerDashboardLink(linkState) {
      try {
        localStorage.setItem(dancerDashboardLinkStorageKey, JSON.stringify({ ...linkState, createdAt: Date.now() }));
      } catch (error) {}
    }

    function takePendingDancerDashboardLink() {
      try {
        const raw = localStorage.getItem(dancerDashboardLinkStorageKey);
        if (!raw) return null;
        localStorage.removeItem(dancerDashboardLinkStorageKey);
        const state = JSON.parse(raw);
        if (Date.now() - Number(state.createdAt || 0) > 1000 * 60 * 60 * 24 * 7) return null;
        return state;
      } catch (error) {
        return null;
      }
    }

    function dancerDashboardLinkFromParams(params) {
      if (params.get("dancr_dashboard") !== "dancer") return null;
      return {
        status: params.get("dancr_status") || "",
        setupStep: params.get("dancr_step") || "",
        targetType: params.get("dancr_target_type") || "",
        targetId: params.get("dancr_target_id") || "",
        label: params.get("dancr_label") || ""
      };
    }

    function stepForDancerDashboardLink(linkState = {}) {
      if (linkState.setupStep && linkState.setupStep !== "approved") return linkState.setupStep;
      if (linkState.targetType === "photo") return "photos";
      if (linkState.targetType === "social_link") return "profile";
      return linkState.status === "approved" ? "approved" : "approval";
    }

    function scrollDancerDashboardLinkTarget(linkState = {}) {
      const step = stepForDancerDashboardLink(linkState);
      if (step === "approved") {
        const target = document.getElementById("approvedDancerPanel") || document.getElementById("dancerDashboard");
        target?.scrollIntoView({ behavior: "smooth", block: "start" });
        target?.classList.add("field-needs-review");
        window.setTimeout(() => target?.classList.remove("field-needs-review"), 2400);
        return;
      }
      setupChecklistExpanded = true;
      activeSetupStep = step;
      renderDancerSetup();
      window.requestAnimationFrame(() => {
        const label = String(linkState.label || "").toLowerCase();
        const input =
          linkState.targetType === "photo" ? document.getElementById("setupProfilePhotos") :
          null;
        const reviewNote = document.querySelector(".review-feedback-item.is-rejected");
        const stepCard = document.querySelector(`#setupChecklist [data-step="${step}"]`);
        const target = input || reviewNote || stepCard || document.getElementById("setupChecklistWrap");
        target?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
        target?.classList.add("field-needs-review");
        if (input) input.focus({ preventScroll: true });
        window.setTimeout(() => target?.classList.remove("field-needs-review"), 2400);
      });
    }

    function openDancerDashboardFromLink(linkState = {}) {
      dancerSignupStarted = true;
      stripeConfirmed = true;
      activeDashboardType = "dancer";
      isCustomerLoggedIn = false;
      isDancerLoggedIn = true;
      isVenueLoggedIn = false;
      const step = stepForDancerDashboardLink(linkState);
      setupChecklistExpanded = step !== "approved";
      activeSetupStep = step === "approved" ? "" : step;
      updateAccountHeader();
      closeAuthPage();
      closeDashboard();
      closeVenueDashboard();
      openDancerDashboard();
      showToast(linkState.status === "approved" ? "Dancer dashboard opened." : "Open the highlighted section, fix the issue, then resubmit.");
      window.setTimeout(() => scrollDancerDashboardLinkTarget(linkState), 260);
    }

    function consumePendingDancerDashboardLink() {
      const pending = takePendingDancerDashboardLink();
      if (!pending || !isDancerSession()) return false;
      openDancerDashboardFromLink(pending);
      return true;
    }

    function scrollAccountPasswordIntoView(role) {
      const accountRole = role === "dancer" ? "dancer" : "customer";
      const passwordInput = document.getElementById(`${accountRole}AccountPassword`);
      const confirmInput = document.getElementById(`${accountRole}AccountPasswordConfirm`);
      const status = document.getElementById(`${accountRole}AccountCenterStatus`);
      const target =
        passwordInput?.closest(".account-center-panel") ||
        passwordInput?.closest(".panel-card") ||
        passwordInput?.closest("label") ||
        passwordInput ||
        confirmInput;
      if (status) {
        status.hidden = false;
        status.textContent = "Enter a new password, confirm it, then tap Update password.";
      }
      target?.scrollIntoView({ block: "center", behavior: "smooth" });
      setTimeout(() => passwordInput?.focus({ preventScroll: true }), 260);
    }

    function openConfirmedSessionDashboard(role, state = {}) {
      const dashboardRole = role === "dancer" || role === "venue" ? role : "customer";
      const isPasswordReset = state.resumeTarget === "account_password" || state.authIntent === "password_reset";
      saveAuthSession({
        ...authSession,
        account: {
          ...(authSession?.account || {}),
          role: dashboardRole,
          displayName: state.name || state.stageName || state.email || authSession?.account?.displayName || null,
          accountState: "active",
          email: normalizeAccountEmail(state.email) || sessionEmailForRole(dashboardRole) || authSession?.account?.email || null
        }
      });
      return hydrateConfirmedSessionAccount(dashboardRole, state).finally(async () => {
        resetAccountControl(dashboardRole);
        isCustomerLoggedIn = dashboardRole === "customer";
        isDancerLoggedIn = dashboardRole === "dancer";
        isVenueLoggedIn = dashboardRole === "venue";
        activeDashboardType = dashboardRole;
        if (dashboardRole === "customer") {
          prepareRealCustomerDashboardState();
          loadLiveCustomerDashboardData();
        }
        if (dashboardRole === "dancer") {
          prepareConfirmedDancerVerification(state);
        }
        updateAccountHeader();
        maybeShowAccountTooltip(dashboardRole);
        if (dashboardRole === "customer") {
          if (isPasswordReset) {
            closeAuthPage();
            openUnifiedDashboard("customer", "customer-settings");
            showToast("Enter a new password to finish reset.");
            return;
          }
          closeDashboard();
          closeAuthPage();
          showToast("Email confirmed. Your private guest dashboard is ready.");
          window.location.assign("/dashboard/customer?confirmed=1");
          return;
        }
        if (dashboardRole === "dancer") {
          if (isPasswordReset) {
            closeAuthPage();
            closeDashboard();
            closeVenueDashboard();
            openUnifiedDashboard("dancer", "dancer-account");
            showToast("Enter a new password to finish reset.");
            return;
          }
          closeAuthPage();
          closeDashboard();
          closeVenueDashboard();
          showToast("Email confirmed. Complete your 3-step dancer profile setup.");
          openUnifiedDashboard("dancer", "dancer-profile-media");
          return;
        }
        if (dashboardRole === "venue") {
          closeAuthPage();
          closeDashboard();
          const opened = openUnifiedDashboard("venue", isPasswordReset ? "venue-account" : "");
          if (opened) {
            showToast(isPasswordReset ? "You're signed in. Venue account settings are ready." : "Email confirmed. Venue dashboard opened.");
          }
          return;
        }
        showToast(dashboardRole === "dancer" ? "Email confirmed. Complete your 3-step dancer profile setup." : "Email confirmed. Welcome back to Mydancr.");
        openUnifiedDashboard("customer");
      });
    }

    function restoreAuthConfirmationResume() {
      const params = new URLSearchParams(window.location.search);
      const hashParams = new URLSearchParams(window.location.hash ? window.location.hash.slice(1) : "");
      const token = params.get("resume");
      const callbackSession = readConfirmationSessionFromUrl();
      const isAuthCallback =
        params.get("dancr_confirm") === "1" ||
        params.get("dancr_reset") === "1" ||
        hashParams.get("type") === "recovery";
      const confirmedSession =
        callbackSession ||
        (isAuthCallback && authSession?.accessToken ? authSession : null);
      const pendingConfirmation = readPendingAuthConfirmation();
      const roleParam = params.get("role") || params.get("dancr_role") || "";
      const roleHint = roleParam || pendingConfirmation?.role || "";
      const isPasswordReset = params.get("dancr_reset") === "1" || params.get("reset_target") === "account_password" || hashParams.get("type") === "recovery";
      if (!token && !confirmedSession?.accessToken) {
        if (isPasswordReset) {
          saveAuthSession(null);
          window.history.replaceState({}, document.title, "/");
          openAuthRole(roleHint === "dancer" || roleHint === "venue" ? roleHint : "customer");
          showToast("Password reset link opened. Sign in, then update your password in Account Center.");
          return true;
        }
        if (params.get("dancr_confirm") === "1" && roleHint === "dancer") {
          saveAuthSession(null);
          window.history.replaceState({}, document.title, "/");
          openAuthRole("dancer");
          document.getElementById("customerEmail").value = pendingConfirmation?.email || "";
          showToast("Email confirmed. Sign in to open your dancer verification setup.");
          setTimeout(() => document.getElementById(pendingConfirmation?.email ? "customerPassword" : "customerEmail")?.focus(), 80);
          return true;
        }
        return false;
      }

      const state = {
        ...((token ? takeAuthResume(token) : null) || pendingConfirmation || {}),
        ...(isPasswordReset
          ? {
              role: roleHint === "dancer" || roleHint === "venue" || roleHint === "customer" ? roleHint : ((token ? null : pendingConfirmation)?.role || "customer"),
              resumeTarget: "account_password",
              authIntent: "password_reset"
            }
          : {})
      };
      window.history.replaceState({}, document.title, "/");
      if (!state.role && !state.resumeTarget) {
        if (confirmedSession?.accessToken) {
          const hintedRole = roleHint === "dancer" || roleHint === "venue" || roleHint === "customer" ? roleHint : "";
          const sessionRole =
            confirmedSession.account?.role === "dancer" || confirmedSession.account?.role === "venue" || confirmedSession.account?.role === "customer"
              ? confirmedSession.account.role
              : "";
          const confirmedRole = hintedRole || sessionRole || "customer";
          const fallbackState =
            isPasswordReset
              ? {
                  role: confirmedRole,
                  email: confirmedSession.account?.email || "",
                  resumeTarget: "account_password",
                  authIntent: "password_reset"
                }
              : confirmedRole === "dancer"
              ? {
                  role: "dancer",
                  email: confirmedSession.account?.email || "",
                  dancerCity: "",
                  resumeTarget: "dancer_verification",
                  setupStep: "profile",
                  authIntent: "signup",
                  freshDancerVerification: true
                }
              : {};
          saveAuthSession(confirmedSession);
          clearPendingAuthConfirmation();
          openConfirmedSessionDashboard(confirmedRole, fallbackState);
          return true;
        }
        showToast("Email confirmed. Please sign in to continue.");
        openAuthRole("customer");
        return true;
      }

      if (state.city && markets[state.city]) citySelect.value = state.city;
      activeTab = state.activeTab || activeTab;
      selectedVenueName = state.selectedVenueName || null;
      document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item.dataset.tab === activeTab));
      render();

      if (state.role === "dancer") {
        const freshVerification = isFreshDancerVerificationState(state);
        const dancerEmailField = document.getElementById("dancerEmail");
        const dancerCityField = document.getElementById("dancerCity");
        if (dancerEmailField) dancerEmailField.value = state.email || "";
        if (dancerCityField) dancerCityField.value = freshVerification ? "" : (state.dancerCity || state.city || "Las Vegas");
        if (confirmedSession?.accessToken) {
          saveAuthSession(confirmedSession);
          clearPendingAuthConfirmation();
          openConfirmedSessionDashboard("dancer", state);
          return true;
        }
        openAuthRole("dancer");
        document.getElementById("customerEmail").value = state.email || "";
        showToast("Email confirmed. Sign in to open your dancer verification setup.");
        setTimeout(() => document.getElementById("customerPassword")?.focus(), 80);
      } else if (state.role === "venue") {
        openAuthRole("venue");
        document.getElementById("customerEmail").value = state.email || "";
        showToast("Email confirmed. Sign in to open your venue dashboard.");
        setTimeout(() => document.getElementById("customerPassword")?.focus(), 80);
      } else {
        if (confirmedSession?.accessToken) {
          saveAuthSession(confirmedSession);
          clearPendingAuthConfirmation();
          openConfirmedSessionDashboard("customer", state);
          return true;
        }
        openAuthRole("customer");
        setCustomerAuthMode("login");
        document.getElementById("customerEmail").value = state.email || "";
        showToast("Email confirmed. Sign in to continue where you left off.");
        setTimeout(() => document.getElementById("customerPassword")?.focus(), 80);
      }

      setTimeout(() => window.scrollTo({ top: state.scrollY || 0, behavior: "auto" }), 120);
      return true;
    }

    function browserAccountIdentity(session) {
      if (!session?.accessToken) return "";
      const accountId = typeof session.account?.id === "string" ? session.account.id : session.accessToken;
      return JSON.stringify([session.account?.role || "", accountId]);
    }

    function refreshBrowserAccountView() {
      const session = loadAuthSession();
      const identity = browserAccountIdentity(session);
      if (identity === visibleAuthAccountIdentity) return false;
      visibleAuthAccountIdentity = identity;
      authSession = session;
      // Retire all cached private panels immediately while the new page loads.
      document.body.inert = true;
      document.body.style.visibility = "hidden";
      window.location.reload();
      return true;
    }

    function captureAuthSessionGuard() {
      try {
        const expected = localStorage.getItem("dancrAuthSessionV1");
        return () => {
          try { return localStorage.getItem("dancrAuthSessionV1") === expected; }
          catch { return false; }
        };
      } catch {
        return () => false;
      }
    }

    async function requestAuth(payload) {
      const isSessionUnchanged = captureAuthSessionGuard();
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) {
        throw new Error(friendlyAuthErrorMessage(data.error || (response.status === 429 ? "Email rate limit exceeded" : ""), "Authentication failed"));
      }
      if (["login", "signup"].includes(payload.mode) && !isSessionUnchanged()) {
        throw new Error("Your sign-in changed in another window. Please try again if you still want to switch accounts.");
      }
      const email = normalizeAccountEmail(payload.email);
      const resolvedRole = data.account?.role || payload.role || null;
      if (resolvedRole && email) persistAccountEmail(resolvedRole, email);
      const shouldSaveSession = data.session && (payload.mode !== "signup" || payload.role === "admin" || payload.role === "venue");
      const confirmationOnlySignup = payload.mode === "signup" && (payload.role === "customer" || (payload.role === "dancer" && data.requiresEmailConfirmation));
      if (shouldSaveSession || confirmationOnlySignup) {
        const revocation = endAuthSession();
        const isSignedOutSessionUnchanged = captureAuthSessionGuard();
        await revocation;
        if (!isSignedOutSessionUnchanged()) throw new Error("Your sign-in changed in another window. Please try again if you still want to switch accounts.");
      }
      if (shouldSaveSession) {
        const account = data.account
          ? { ...data.account, email: normalizeAccountEmail(data.account.email) || email || null }
          : { role: resolvedRole, email: email || null, accountState: "active" };
        saveAuthSession({ ...data.session, email: email || data.session.email || null, account });
      }
      return data;
    }

    let passwordRecoveryRequestVersion = 0;

    function setPasswordRecoveryState(state = "idle", message = "") {
      const button = document.getElementById("passwordRecoverySubmit");
      const label = document.getElementById("passwordRecoverySubmitLabel");
      const emailInput = document.getElementById("passwordRecoveryEmail");
      const title = document.getElementById("passwordRecoveryStatusTitle");
      const detail = document.getElementById("passwordRecoveryStatusMessage");
      if (passwordRecoveryCard) passwordRecoveryCard.dataset.state = state;
      if (button) {
        button.disabled = state === "sending" || state === "success";
        button.setAttribute("aria-busy", String(state === "sending"));
      }
      if (label) label.textContent = state === "sending" ? "Sending reset link…" : state === "success" ? "Reset link requested" : "Send reset link";
      if (emailInput) emailInput.readOnly = state === "sending";
      if (title) title.hidden = state !== "success";
      if (detail) detail.textContent = message;
      if (passwordRecoveryStatus) passwordRecoveryStatus.hidden = !message;
    }

    function resetPasswordRecoveryFeedback() {
      passwordRecoveryRequestVersion += 1;
      setPasswordRecoveryState();
    }

    async function sendPasswordReset({ role, emailInputId, buttonId, statusId = "" }) {
      const email = document.getElementById(emailInputId)?.value?.trim() || "";
      const button = document.getElementById(buttonId);
      const status = statusId ? document.getElementById(statusId) : null;
      const previousText = button?.textContent || "Forgot password?";
      const isRecoveryDialog = buttonId === "passwordRecoverySubmit";
      const requestVersion = passwordRecoveryRequestVersion;
      if (button?.disabled) return;

      if (!email) {
        const message = "Enter the email used for your account.";
        if (isRecoveryDialog) setPasswordRecoveryState("error", message);
        else if (status) {
          status.textContent = message;
          status.hidden = false;
        }
        showToast(message);
        return;
      }

      if (isRecoveryDialog) setPasswordRecoveryState("sending");
      else if (button) {
        button.disabled = true;
        button.textContent = "Sending reset email...";
      }

      try {
        const returnTo =
          role === "admin" ? "/admin" :
          role === "dancer" ? "/dashboard/dancer" :
          role === "venue" ? "/dashboard/venue" :
          "/dashboard/customer";
        await requestAuth({
          mode: "reset_password",
          role,
          email,
          emailRedirectTo: savePasswordResetResume(role, email, returnTo)
        });
        if (isRecoveryDialog && requestVersion !== passwordRecoveryRequestVersion) return;
        const message = "If an account matches this email, a reset link is on its way. Check your spam folder too.";
        if (isRecoveryDialog) setPasswordRecoveryState("success", message);
        else if (status) {
          status.textContent = message;
          status.hidden = false;
        }
        if (!isRecoveryDialog) showToast(message);
      } catch (error) {
        if (isRecoveryDialog && requestVersion !== passwordRecoveryRequestVersion) return;
        const message = friendlyAuthErrorMessage(error.message, "Unable to send reset email.");
        if (isRecoveryDialog) setPasswordRecoveryState("error", message);
        else if (status) {
          status.textContent = message;
          status.hidden = false;
        }
        if (!isRecoveryDialog) showToast(message);
      } finally {
        if (button && !isRecoveryDialog) {
          button.disabled = false;
          button.textContent = previousText;
        }
      }
    }

    function setRecoveryPopoverOrigin(popover, sourceButton) {
      const surface = popover?.querySelector(".recovery-popover-surface");
      if (!surface || !sourceButton) return;
      const rect = sourceButton.getBoundingClientRect();
      surface.style.setProperty("--recovery-shift-x", `${rect.left + rect.width / 2 - window.innerWidth / 2}px`);
      surface.style.setProperty("--recovery-shift-y", `${rect.top + rect.height / 2 - window.innerHeight / 2}px`);
    }

    function closeRecoveryPopover(popover, restoreFocus = true) {
      if (!popover || popover.hidden) return;
      const trigger = document.getElementById(popover.dataset.triggerId || "");
      popover.hidden = true;
      if (popover === passwordRecoveryCard) resetPasswordRecoveryFeedback();
      if (popover === loginRecoveryCard) resetLoginRecoveryFeedback();
      popover.dataset.triggerId = "";
      if (trigger) trigger.setAttribute("aria-expanded", "false");
      if (restoreFocus) trigger?.focus({ preventScroll: true });
    }

    function openRecoveryPopover(popover, sourceButton, focusTargetId) {
      if (!popover || !sourceButton) return;
      [passwordRecoveryCard, loginRecoveryCard].forEach((item) => {
        if (item && item !== popover) closeRecoveryPopover(item, false);
      });
      setRecoveryPopoverOrigin(popover, sourceButton);
      popover.dataset.triggerId = sourceButton.id;
      sourceButton.setAttribute("aria-expanded", "true");
      popover.hidden = false;
      window.setTimeout(() => document.getElementById(focusTargetId)?.focus({ preventScroll: true }), 220);
    }

    function openPasswordRecovery({ role, emailInputId, buttonId }) {
      const sourceButton = document.getElementById(buttonId);
      const accountEmail = document.getElementById(emailInputId)?.value?.trim() || "";
      const emailInput = document.getElementById("passwordRecoveryEmail");
      const roleInput = document.getElementById("passwordRecoveryRole");
      if (roleInput) roleInput.value = role;
      if (emailInput) emailInput.value = accountEmail;
      resetPasswordRecoveryFeedback();
      openRecoveryPopover(passwordRecoveryCard, sourceButton, "passwordRecoveryEmail");
    }
