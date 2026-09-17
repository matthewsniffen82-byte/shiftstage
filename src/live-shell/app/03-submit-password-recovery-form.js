

    async function submitPasswordRecoveryForm(event) {
      event.preventDefault();
      await sendPasswordReset({
        role: document.getElementById("passwordRecoveryRole")?.value || "customer",
        emailInputId: "passwordRecoveryEmail",
        buttonId: "passwordRecoverySubmit",
        statusId: "passwordRecoveryStatus"
      });
    }

    function sendLoginRecoveryHelp({ role, emailInputId, buttonId }) {
      const accountEmail = document.getElementById(emailInputId)?.value?.trim() || "";
      const sourceButton = document.getElementById(buttonId);
      const contactInput = document.getElementById("loginRecoveryContactEmail");
      const roleInput = document.getElementById("loginRecoveryRole");
      const cityInput = document.getElementById("loginRecoveryCity");
      const nameLabel = document.getElementById("loginRecoveryAccountNameLabel");
      const title = document.getElementById("loginRecoveryTitle");
      if (loginRecoveryForm) loginRecoveryForm.reset();
      if (roleInput) roleInput.value = role;
      if (cityInput) cityInput.value = citySelect.value || "Las Vegas";
      if (contactInput && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountEmail)) contactInput.value = accountEmail;
      if (nameLabel) nameLabel.textContent = role === "dancer" ? "Stage name" : role === "venue" ? "Venue name" : "Name used on the account";
      if (title) title.textContent = role === "venue" ? "Find your venue sign-in email" : "Find your sign-in email";
      if (loginRecoveryStatus) {
        loginRecoveryStatus.textContent = "";
        loginRecoveryStatus.hidden = true;
      }
      openRecoveryPopover(loginRecoveryCard, sourceButton, "loginRecoveryAccountName");
    }

    function closeLoginRecovery() {
      closeRecoveryPopover(loginRecoveryCard);
    }

    async function submitLoginRecoveryForm(event) {
      event.preventDefault();
      const submit = document.getElementById("loginRecoverySubmit");
      submit.disabled = true;
      submit.textContent = "Sending securely...";
      loginRecoveryStatus.textContent = "Submitting your recovery request...";
      loginRecoveryStatus.hidden = false;
      try {
        const response = await fetch("/api/account-recovery", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            role: document.getElementById("loginRecoveryRole").value,
            accountName: document.getElementById("loginRecoveryAccountName").value,
            city: document.getElementById("loginRecoveryCity").value,
            contactEmail: document.getElementById("loginRecoveryContactEmail").value,
            details: document.getElementById("loginRecoveryDetails").value
          })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.ok === false) throw new Error(data.error || "Unable to submit account recovery request.");
        loginRecoveryStatus.textContent = `${data.message} Reference: ${data.reference}.`;
        document.getElementById("loginRecoveryDetails").value = "";
        showToast("Account recovery request sent");
      } catch (error) {
        loginRecoveryStatus.textContent = error?.message || "Unable to submit account recovery request.";
      } finally {
        submit.disabled = false;
        submit.textContent = "Send recovery request";
      }
    }

    function friendlyAuthErrorMessage(message, fallback = "Authentication failed") {
      const text = message || fallback;
      if (/rate limit/i.test(text)) {
        return "Too many confirmation emails were sent. Please wait a few minutes, then try again, or use the newest confirmation email already in your inbox.";
      }
      return text;
    }

    function synchronizeAuthSession() {
      try {
        const raw = localStorage.getItem("dancrAuthSessionV1");
        const stored = raw ? JSON.parse(raw) : null;
        authSession = stored?.accessToken ? stored : null;
      } catch (error) {
        // Keep the current session when browser storage is unavailable.
      }
      return authSession;
    }

    function authenticatedRequestHeaders(contentType, session = synchronizeAuthSession()) {
      const token = session?.accessToken;
      if (!token) return null;
      const headers = {
        Accept: "application/json",
        Authorization: `Bearer ${token}`
      };
      if (contentType) headers["Content-Type"] = contentType;
      if (session?.refreshToken) {
        headers["X-Dancr-Refresh-Token"] = session.refreshToken;
      }
      return headers;
    }

    function applyResponseSession(data, requestHeaders) {
      if (!data?.session?.accessToken) return;
      const current = synchronizeAuthSession();
      // An older request must not undo a refresh, a new login, or a logout.
      if (!current?.accessToken || !requestHeaders
        || requestHeaders.Authorization !== `Bearer ${current.accessToken}`
        || (requestHeaders["X-Dancr-Refresh-Token"] || "") !== (current.refreshToken || "")) return;
      saveAuthSession({
        ...current,
        ...data.session,
        account: data.account
          ? {
              ...data.account,
              email: normalizeAccountEmail(data.account.email) || sessionEmailForRole(data.account.role) || authSession?.account?.email || null
            }
          : current.account || null
      });
    }

    function apiErrorMessage(data, fallback = "Request failed") {
      const message = data?.error || fallback;
      if (data?.code === "outside_geofence") {
        const requiredRadiusFeet = Number.isFinite(Number(data?.requiredRadiusFeet))
          ? Math.round(Number(data.requiredRadiusFeet))
          : 300;
        return `You can't check in yet. You're outside the club's ${requiredRadiusFeet.toLocaleString()} ft check-in area. Move closer to the club and try again.`;
      }
      if (Number.isFinite(Number(data?.distanceFeet)) && Number.isFinite(Number(data?.requiredRadiusFeet))) {
        return `${message} Your location was about ${Math.round(Number(data.distanceFeet)).toLocaleString()} ft away; check-in requires ${Math.round(Number(data.requiredRadiusFeet)).toLocaleString()} ft or less.`;
      }
      return message;
    }

    function apiRequestError(data, fallback = "Request failed") {
      const error = new Error(apiErrorMessage(data, fallback));
      error.code = typeof data?.code === "string" ? data.code : "request_failed";
      if (Number.isFinite(Number(data?.distanceFeet))) error.distanceFeet = Number(data.distanceFeet);
      if (Number.isFinite(Number(data?.requiredRadiusFeet))) error.requiredRadiusFeet = Number(data.requiredRadiusFeet);
      return error;
    }

    async function fetchWithTimeout(url, options, timeoutMs = 0, timeoutMessage = "The check-in request timed out. Check your connection and try again.") {
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return fetch(url, options);
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await fetch(url, { ...options, signal: controller.signal });
      } catch (error) {
        if (error?.name === "AbortError") {
          const timeoutError = new Error(timeoutMessage);
          timeoutError.code = "request_timeout";
          throw timeoutError;
        }
        throw error;
      } finally {
        window.clearTimeout(timeoutId);
      }
    }

    async function postAuthenticatedJson(url, payload, options = {}) {
      const headers = authenticatedRequestHeaders("application/json");
      if (!headers) return null;
      const response = await fetchWithTimeout(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
      }, options.timeoutMs, options.timeoutMessage);
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw apiRequestError(data);
      applyResponseSession(data, headers);
      return data;
    }

    async function postOptionalAuthJson(url, payload) {
      const token = authSession?.accessToken;
      const headers = {
        "Content-Type": "application/json",
        Accept: "application/json"
      };
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.error || "Request failed");
      applyResponseSession(data, headers);
      return data;
    }

    async function patchAuthenticatedJson(url, payload, options = {}) {
      const headers = authenticatedRequestHeaders("application/json");
      if (!headers) return null;
      const response = await fetchWithTimeout(url, {
        method: "PATCH",
        headers,
        body: JSON.stringify(payload)
      }, options.timeoutMs);
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw apiRequestError(data);
      applyResponseSession(data, headers);
      return data;
    }

    async function deleteAuthenticatedJson(url, session = authSession) {
      const headers = authenticatedRequestHeaders(undefined, session);
      if (!headers) return null;
      const response = await fetch(url, {
        method: "DELETE",
        headers
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.error || "Request failed");
      return data;
    }

    async function postAuthenticatedFormData(url, formData) {
      const headers = authenticatedRequestHeaders();
      if (!headers) throw new Error("Sign in required");
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: formData
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(normalizeRequestError(data.message || data.error, "Request failed"));
      applyResponseSession(data, headers);
      return data;
    }

    function normalizeRequestError(error, fallback = "Request failed") {
      if (!error) return fallback;
      if (typeof error === "string") return error;
      if (error instanceof Error) return error.message || fallback;
      if (typeof error === "object") {
        return error.message || error.error || error.details || error.hint || fallback;
      }
      return String(error);
    }

    async function getAuthenticatedJson(url, options = {}) {
      const headers = authenticatedRequestHeaders();
      if (!headers) throw new Error("Sign in required");
      const response = await fetchWithTimeout(url, {
        headers,
        cache: "no-store"
      }, options.timeoutMs, options.timeoutMessage);
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.error || "Request failed");
      applyResponseSession(data, headers);
      return data;
    }

    async function requestVenueAffiliationJson(url, { method = "GET", body } = {}) {
      const headers = authenticatedRequestHeaders(body === undefined ? undefined : "application/json");
      if (!headers) throw new Error("Sign in required");
      const response = await fetchWithTimeout(url, {
        method,
        headers,
        cache: "no-store",
        body: body === undefined ? undefined : JSON.stringify(body)
      }, 15000, "Venue verification took too long to load. Check your connection and try again.");
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.error || "Request failed");
      applyResponseSession(data, headers);
      return data;
    }

    function pendingVenueDancerVerificationToken() {
      try {
        const token = sessionStorage.getItem(PENDING_VENUE_DANCER_VERIFICATION_KEY) || "";
        return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : "";
      } catch {
        return "";
      }
    }

    function savePendingVenueDancerVerificationToken(token) {
      const normalized = String(token || "").trim();
      try {
        if (/^[A-Za-z0-9_-]{43}$/.test(normalized)) {
          sessionStorage.setItem(PENDING_VENUE_DANCER_VERIFICATION_KEY, normalized);
        } else {
          sessionStorage.removeItem(PENDING_VENUE_DANCER_VERIFICATION_KEY);
        }
      } catch {}
    }

    function socialPayloadFromMap(socials) {
      return socialPlatforms.map(({ key: platform }) => {
        const url = String(socials?.[platform] || "").trim();
        return {
          platform,
          url,
          handle: socialHandleFromUrl(url),
          isActive: Boolean(url)
        };
      });
    }

    function socialHandleFromUrl(url) {
      try {
        const parsed = new URL(url);
        return parsed.pathname.split("/").filter(Boolean).pop()?.replace(/^@/, "") || parsed.hostname;
      } catch {
        return String(url || "").replace(/^@/, "");
      }
    }

    function socialPlatformLabel(platform) {
      return socialPlatforms.find((item) => item.key === platform)?.label || String(platform || "Social").replaceAll("_", " ");
    }

    function normalizeSubmittedSocials(profile) {
      const rawSocialLinks = Array.isArray(profile?.socialLinks)
        ? profile.socialLinks
        : Array.isArray(profile?.social_links)
          ? profile.social_links
          : [];
      const hasSubmittedSocialRows = rawSocialLinks.length > 0;
      const mappedSocials = rawSocialLinks.length
        ? rawSocialLinks
        : Object.entries(profile?.socials || {}).map(([platform, value]) => ({ platform, url: value, handle: value }));

      return mappedSocials
        .filter((social) => social && social.isActive !== false && social.is_active !== false)
        .map((social, index) => {
          const platform = String(social.platform || social.type || "").toLowerCase();
          const rawUrl = String(social.url || social.href || "").trim();
          const rawHandle = String(social.handle || social.username || social.value || "").trim();
          const normalizedUrl = rawUrl || normalizeSocialInput(platform, rawHandle);
          const handle = rawHandle || socialHandleFromUrl(normalizedUrl);
          const id = social.id || `${profile?.id || profile?.name || "profile"}-social-${index}`;
          const liveReview = latestContentReview(`social_link:${id}`);
          const localReview = profile?.socialReviewStatuses?.[id] || {};
          const explicitReviewStatus = liveReview?.status || localReview.status || social.reviewStatus || social.review_status;
          const defaultReviewStatus = hasSubmittedSocialRows && !isApprovedDancerStatus(profile?.status) ? "pending" : "approved";
          return {
            id,
            hasLiveId: Boolean(social.id),
            platform,
            label: socialPlatformLabel(platform),
            url: normalizedUrl,
            handle,
            reviewStatus: explicitReviewStatus || defaultReviewStatus,
            reviewNotes: liveReview?.notes || localReview.notes || social.reviewNotes || social.review_notes || ""
          };
        })
        .filter((social) => social.platform && (social.url || social.handle));
    }

    function shiftIsoRange(dateValue, startValue, endValue) {
      const start = new Date(`${dateValue}T${startValue || "00:00"}:00`);
      const end = new Date(`${dateValue}T${endValue || "00:00"}:00`);
      if (end <= start) end.setDate(end.getDate() + 1);
      return { startsAt: start.toISOString(), endsAt: end.toISOString() };
    }

    function resetAccountControl(role) {
      if (!accountControlState[role]) return;
      accountControlState[role].disabled = false;
      accountControlState[role].deleted = false;
    }

    function hasLiveEditableDancerAccount() {
      if (!isDancerSession()) return false;
      const profile = activeDancerProfile() || null;
      const profileStatus = normalizedReviewStatus(profile?.status);
      const hasEditableProfile = Boolean(
        profile &&
        profileStatus !== "deleted" &&
        profileStatus !== "disabled" &&
        (
          profile.name ||
          profile.stageName ||
          profile.mainPhotoUrl ||
          (profile.galleryPhotoUrls || []).length ||
          (profile.submittedPhotos || []).length ||
          profile.isPublic !== false
        )
      );
      return Boolean(
        hasEditableProfile ||
        dancerSetup.approval ||
        dancerCoreApprovalUnlocked(profile) ||
        normalizedReviewStatus(liveDancerBilling?.dancerStatus) === "approved"
      );
    }

    function resolvedAccountControlState(role, accountState) {
      const normalizedState = normalizedReviewStatus(accountState || "active");
      if (role === "dancer" && normalizedState === "deleted" && hasLiveEditableDancerAccount()) return "active";
      return normalizedState;
    }

    function syncSignedInAccountControl(role) {
      const state = accountControlState[role];
      if (!state || authSession?.account?.role !== role) return;
      const sessionState = resolvedAccountControlState(role, authSession.account.accountState);
      state.deleted = sessionState === "deleted";
      state.disabled = sessionState === "disabled";
    }

    function renderAccountControlPanel(role) {
      const panel = document.querySelector(`[data-account-panel="${role}"]`);
      const state = accountControlState[role];
      if (!panel || !state) return;
      const status = panel.querySelector("[data-account-status]");
      const note = panel.querySelector("[data-account-note]");
      const disableButton = panel.querySelector('[data-account-action="disable"]');
      const deleteButton = panel.querySelector('[data-account-action="delete"]');
      if (role === "dancer" && state.deleted && hasLiveEditableDancerAccount()) {
        state.deleted = false;
        state.disabled = false;
      }
      const dancerPending = role === "dancer" && !(dancerSetup.approval || activeDancerProfile()?.status === "Verified" || liveDancerBilling?.dancerStatus === "approved");
      const mode = state.deleted ? "deleted" : state.disabled ? "disabled" : dancerPending ? "pending" : "active";
      panel.classList.toggle("is-disabled", state.disabled && !state.deleted);
      panel.classList.toggle("is-deleted", state.deleted);
      panel.classList.toggle("is-pending", dancerPending && !state.disabled && !state.deleted);
      if (status) {
        status.textContent = mode === "deleted" ? "Deleted" : mode === "disabled" ? "Paused" : mode === "pending" ? "Pending" : "Active";
      }
      if (note) note.textContent = mode === "pending"
        ? "Your dancer account is pending review. Public profile tools activate after approval."
        : accountControlCopy[role][mode];
      if (disableButton) {
        disableButton.textContent = state.disabled ? "Reactivate account" : "Disable temporarily";
        disableButton.disabled = state.deleted;
      }
      if (deleteButton) deleteButton.disabled = state.deleted;
    }

    function renderAccountControls() {
      renderAccountControlPanel("customer");
      renderAccountControlPanel("dancer");
      updateCurrentEmailDisplays();
    }

    function applyLiveAccountState(account) {
      const role = account?.role;
      const state = accountControlState[role];
      if (!state) return;
      const email = normalizeAccountEmail(account.email) || sessionEmailForRole(role);
      const accountState = resolvedAccountControlState(role, account.accountState);
      if (email) persistAccountEmail(role, email);
      state.disabled = accountState === "disabled";
      state.deleted = accountState === "deleted";
      if (authSession?.account && authSession.account.role === role) {
        saveAuthSession({ ...authSession, account: { ...authSession.account, accountState, email: email || authSession.account.email || null } });
      }
      renderAccountControlPanel(role);
      updateCurrentEmailDisplays();
    }

    async function loadLiveAccountState() {
      if (!authSession?.accessToken) return;
      try {
        const data = await getAuthenticatedJson("/api/account");
        if (data?.account) applyLiveAccountState(data.account);
      } catch (error) {
        showToast(error.message || "Could not load account state");
      }
    }

    async function saveLiveAccountState(role, accountState, button, rollback) {
      if (!authSession?.accessToken) return;
      if (button) button.disabled = true;
      try {
        const data = await patchAuthenticatedJson("/api/account", { accountState });
        if (data?.account) applyLiveAccountState(data.account);
        showToast(accountState === "disabled" ? `${role === "dancer" ? "Dancer account" : "Guest account"} paused` : `${role === "dancer" ? "Dancer account" : "Guest account"} reactivated`);
      } catch (error) {
        rollback?.();
        showToast(error.message || "Could not update account");
      } finally {
        syncApprovedProfileSubmitState();
      }
    }

    async function deleteLiveAccount(role, button) {
      const deletionSession = authSession;
      if (!deletionSession?.accessToken) return false;
      const buttonLabel = button?.textContent || "Delete account";
      if (button) {
        button.disabled = true;
        button.textContent = "Deleting account...";
      }
      logoutAccount({ message: "Deleting account…" });
      try {
        await deleteAuthenticatedJson("/api/account", deletionSession);
        markPublicDiscoveryForRefresh();
        finalizeDeletedAccount(role);
        return true;
      } catch (error) {
        showToast(`${error.message || "Could not delete account"} You have been signed out; sign in again to retry.`);
        return false;
      }
    }

    function markPublicDiscoveryForRefresh() {
      try {
        window.sessionStorage.setItem(PUBLIC_DISCOVERY_REFRESH_KEY, String(Date.now()));
      } catch {
        // The next foreground refresh also bypasses stale public discovery data.
      }
    }

    function consumePublicDiscoveryRefreshRequest() {
      try {
        const requested = Boolean(window.sessionStorage.getItem(PUBLIC_DISCOVERY_REFRESH_KEY));
        if (requested) window.sessionStorage.removeItem(PUBLIC_DISCOVERY_REFRESH_KEY);
        return requested;
      } catch {
        return false;
      }
    }

    function accountRoleLabel(role) {
      if (role === "dancer") return "Dancer account";
      if (role === "venue") return "Venue account";
      return "Guest account";
    }

    function finalizeDeletedAccount(role) {
      saveAuthSession(null);
      try {
        logoutAccount({ message: `${accountRoleLabel(role)} deleted` });
      } finally {
        window.location.replace("/");
      }
    }

    function setAccountCenterStatus(role, message, isError = false) {
      const status = document.getElementById(`${role}AccountCenterStatus`);
      if (!status) return;
      status.textContent = message || "";
      status.classList.toggle("is-error", Boolean(isError));
    }

    function setCustomerAccountCenterStatus(message, isError = false) {
      setAccountCenterStatus("customer", message, isError);
    }

    function clearAccountCenterFields(role, type) {
      if (!type || type === "email") {
        const emailInput = document.getElementById(`${role}AccountEmail`);
        if (emailInput) emailInput.value = "";
      }
      if (!type || type === "password") {
        const passwordInput = document.getElementById(`${role}AccountPassword`);
        const confirmInput = document.getElementById(`${role}AccountPasswordConfirm`);
        if (passwordInput) passwordInput.value = "";
        if (confirmInput) confirmInput.value = "";
      }
    }

    function clearCustomerAccountCenterFields(type) {
      clearAccountCenterFields("customer", type);
    }

    async function updateAccountEmail(role, button) {
      const emailInput = document.getElementById(`${role}AccountEmail`);
      const email = emailInput?.value.trim().toLowerCase() || "";
      if (!authSession?.accessToken) {
        setAccountCenterStatus(role, "Sign in required.", true);
        return;
      }
      if (!email || !email.includes("@")) {
        setAccountCenterStatus(role, "Enter a valid email address.", true);
        emailInput?.focus();
        return;
      }
      if (button) button.disabled = true;
      setAccountCenterStatus(role, "Sending confirmation...");
      try {
        const data = await patchAuthenticatedJson("/api/account", { email });
        if (data?.account) applyLiveAccountState(data.account);
        clearAccountCenterFields(role, "email");
        setAccountCenterStatus(role, data?.message || "Check your new email address to confirm the change.");
        showToast("Check your new email to confirm the change");
      } catch (error) {
        setAccountCenterStatus(role, error.message || "Could not update email.", true);
      } finally {
        if (button) button.disabled = false;
      }
    }

    async function updateCustomerAccountEmail(button) {
      updateAccountEmail("customer", button);
    }

    function passwordValidationMessage(password) {
      if (password.length > 1024) return "Password is too long.";
      if (password.length < 6 || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[\p{P}\p{S}]/u.test(password)) {
        return "Use at least 6 characters, including 1 capital letter, 1 number, and 1 special character.";
      }
      return "";
    }

    async function updateAccountPassword(role, button) {
      const passwordInput = document.getElementById(`${role}AccountPassword`);
      const confirmInput = document.getElementById(`${role}AccountPasswordConfirm`);
      const password = passwordInput?.value || "";
      const confirmPassword = confirmInput?.value || "";
      if (!authSession?.accessToken) {
        setAccountCenterStatus(role, "Sign in required.", true);
        return;
      }
      const passwordError = passwordValidationMessage(password);
      if (passwordError) {
        setAccountCenterStatus(role, passwordError, true);
        passwordInput?.focus();
        return;
      }
      if (password !== confirmPassword) {
        setAccountCenterStatus(role, "Passwords do not match.", true);
        confirmInput?.focus();
        return;
      }
      if (button) button.disabled = true;
      setAccountCenterStatus(role, "Updating password...");
      try {
        const data = await patchAuthenticatedJson("/api/account", { password });
        if (data?.account) applyLiveAccountState(data.account);
        clearAccountCenterFields(role, "password");
        setAccountCenterStatus(role, data?.message || "Password updated.");
        showToast("Password updated");
      } catch (error) {
        setAccountCenterStatus(role, error.message || "Could not update password.", true);
      } finally {
        if (button) button.disabled = false;
      }
    }

    async function updateCustomerAccountPassword(button) {
      updateAccountPassword("customer", button);
    }

    function handleAccountControlClick(event) {
      const button = event.target.closest("[data-account-action]");
      if (!button) return false;
      const role = button.dataset.accountRole;
      const action = button.dataset.accountAction;
      const state = accountControlState[role];
      if (!state) return false;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const roleLabel = accountRoleLabel(role);

      if (action === "update-email") {
        updateAccountEmail(role, button);
        return true;
      }

      if (action === "update-password") {
        updateAccountPassword(role, button);
        return true;
      }

      if (action === "disable") {
        const previousDisabled = state.disabled;
        state.disabled = !state.disabled;
        state.deleted = false;
        renderAccountControlPanel(role);
        if (authSession?.accessToken) {
          saveLiveAccountState(role, state.disabled ? "disabled" : "active", button, () => {
            state.disabled = previousDisabled;
            renderAccountControlPanel(role);
          });
        } else {
          showToast(state.disabled ? `${roleLabel} paused` : `${roleLabel} reactivated`);
        }
        return true;
      }

      if (action === "delete") {
        const confirmed = window.confirm(`Permanently delete this ${roleLabel.toLowerCase()}? Your account and sign-in will be removed. This cannot be undone.`);
        if (!confirmed) return true;
        if (authSession?.accessToken) {
          deleteLiveAccount(role, button);
        } else {
          state.deleted = true;
          state.disabled = false;
          renderAccountControlPanel(role);
          finalizeDeletedAccount(role);
        }
        return true;
      }

      return false;
    }

    function portraitClass(index) {
      return ["", "two", "three"][index % 3];
    }

    function safeCssUrl(value) {
      const trimmed = String(value || "").trim();
      if (!trimmed || /[\u0000-\u001f\u007f]/.test(trimmed) || (!/^https?:\/\//i.test(trimmed) && !/^data:image\//i.test(trimmed) && !/^blob:/i.test(trimmed))) return "";
      return trimmed.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    }

    function safeExternalHref(value) {
      const trimmed = String(value || "").trim();
      if (!trimmed) return "";
      try {
        const parsed = new URL(trimmed);
        return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : "";
      } catch {
        return "";
      }
    }

    function customPhotoUrl(profile, offset = 0) {
      const gallery = Array.isArray(profile?.galleryPhotoUrls) ? profile.galleryPhotoUrls.filter(Boolean) : [];
      if (offset === 0) return profile?.mainPhotoUrl || gallery[0] || "";
      return gallery[offset - 1] || profile?.mainPhotoUrl || "";
    }

    function responsiveCssImageSet(srcSet) {
      const sources = String(srcSet || "")
        .split(",")
        .map((source) => source.trim().match(/^(\S+)\s+(\d+)w$/))
        .filter(Boolean)
        .map((match) => ({ url: safeCssUrl(match[1]), width: Number(match[2]) }))
        .filter((source) => source.url && Number.isFinite(source.width))
        .sort((left, right) => left.width - right.width);
      if (!sources.length) return "";
      // Preserve the established CSS portrait choices when smaller candidates
      // are added for native avatar srcsets. Array offsets are not densities.
      const displaySources = sources.filter((source) => source.width >= 320);
      return `image-set(${sources
        .map((source) => `url('${source.url}') ${source.width < 320 ? source.width / 320 : displaySources.indexOf(source) + 1}x`)
        .join(", ")})`;
    }

    function customPhotoAttrs(url, srcSet = "") {
      const safeUrl = safeCssUrl(url);
      const responsiveImageSet = responsiveCssImageSet(srcSet);
      return safeUrl ? {
        className: " has-custom-photo",
        style: ` style="--custom-photo: ${escapeHtml(responsiveImageSet || `url('${safeUrl}')`)}"`
      } : { className: "", style: "" };
    }

    function nativeResponsivePhotoAttrs(url, srcSet = "") {
      const sources = String(srcSet || "")
        .split(",")
        .map((entry) => entry.trim().match(/^(\S+)\s+(\d+)w$/))
        .filter(Boolean)
        .map((match) => ({ url: safeExternalHref(match[1]), width: Number(match[2]) }))
        .filter((source) => source.url && Number.isFinite(source.width))
        .sort((left, right) => left.width - right.width);
      const fallbackUrl = sources.find((source) => source.width >= 320)?.url || sources[sources.length - 1]?.url || safeExternalHref(url);
      if (!fallbackUrl) return "";
      const safeSrcSet = sources
        .map((source) => `${escapeOptionValue(source.url)} ${source.width}w`)
        .join(", ");
      return `src="${escapeOptionValue(fallbackUrl)}"${safeSrcSet ? ` srcset="${safeSrcSet}"` : ""}`;
    }

    function avatarPhotoPosition(focalX, focalY) {
      const normalize = (value) => {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return 50;
        return Math.min(100, Math.max(0, Math.round(parsed)));
      };
      return `${normalize(focalX)}% ${normalize(focalY)}%`;
    }

    function customAvatarPhotoAttrs(url, srcSet = "", focalX = 50, focalY = 50) {
      const attrs = customPhotoAttrs(url, srcSet);
      if (!attrs.style) return attrs;
      return {
        ...attrs,
        style: attrs.style.replace(/"$/, `; --custom-photo-position: ${avatarPhotoPosition(focalX, focalY)}"`)
      };
    }

    function formatLiveDistance(value) {
      const distance = Number(value);
      return Number.isFinite(distance) ? `${distance.toFixed(1)} mi` : "";
    }

    function profileCardDistanceLabel(profile) {
      const city = profile?.city || selectedCity();
      const profileVenue = profile?.venue ? discoveryMarket(city)?.venues.find((venue) => venue.name === profile.venue) : null;
      const venueMiles = profileVenue ? venueDistanceMiles(profileVenue, city) : null;
      if (Number.isFinite(venueMiles)) return formatDistanceMiles(venueMiles);
      const rawDistance = String(profile?.distance || "").trim();
      if (/^\d+(?:\.\d+)?\s*mi$/i.test(rawDistance)) {
        return rawDistance.replace(/\s*mi$/i, " mi");
      }
      const liveDistance = Number(profile?.distanceMiles);
      return Number.isFinite(liveDistance) ? `${liveDistance.toFixed(1)} mi` : "";
    }

    function mapLiveDancer(item, isTonight, index, venueShiftCounts) {
      if (item.venueName) venueShiftCounts[item.venueName] = (venueShiftCounts[item.venueName] || 0) + 1;
      const galleryPhotoUrls = Array.isArray(item.galleryPhotoUrls)
        ? item.galleryPhotoUrls.filter(Boolean)
        : item.primaryPhotoUrl
          ? [item.primaryPhotoUrl]
          : [];
      const socialLinks = Array.isArray(item.socialLinks) ? item.socialLinks : [];
      const socials = Object.fromEntries(
        socialLinks
          .filter((link) => link?.platform && link?.url)
          .map((link) => [String(link.platform).toLowerCase(), link.url])
      );
      return {
        id: item.id,
        slug: item.slug,
        name: item.stageName,
        city: String(item.city || "").trim(),
        venueSlug: item.venueSlug || "",
        venueId: item.venueId || "",
        venueQrCodeUrl: item.venueQrCodeUrl || "",
        venueQrCodeLabel: item.venueQrCodeLabel || "",
        activeDeals: Array.isArray(item.activeDeals) ? item.activeDeals : item.activeDeal ? [item.activeDeal] : [],
        activeDeal: item.activeDeal || null,
        dealAttributionTokens: item.dealAttributionTokens || {},
        dealAttributionToken: item.dealAttributionToken || "",
        shiftId: item.shiftId || "",
        status: item.verified ? "Verified" : "Pending",
        venue: item.venueName || "Venue pending",
        time: item.shiftLabel || "Schedule pending",
        tonight: isTonight,
        liveTonight: isTonight,
        scheduled: Boolean(item.shiftLabel || item.shiftStartsAt || item.venueName),
        trend: item.currentRank || null,
        trendRank: item.currentRank || null,
        distance: formatLiveDistance(item.distanceMiles),
        mainPhotoUrl: item.primaryPhotoUrl || galleryPhotoUrls[0] || "",
        mainPhotoFocalX: item.primaryPhotoFocalX ?? 50,
        mainPhotoFocalY: item.primaryPhotoFocalY ?? 50,
        mainPhotoSrcSet: item.primaryPhotoSrcSet || "",
        avatarPhotoUrl: item.avatarPhotoUrl || item.primaryPhotoUrl || galleryPhotoUrls[0] || "",
        avatarPhotoFocalX: item.avatarPhotoFocalX ?? item.primaryPhotoFocalX ?? 50,
        avatarPhotoFocalY: item.avatarPhotoFocalY ?? item.primaryPhotoFocalY ?? 50,
        avatarPhotoSrcSet: item.avatarPhotoSrcSet || item.primaryPhotoSrcSet || "",
        galleryPhotoUrls,
        galleryPhotoSrcSets: Array.isArray(item.galleryPhotoSrcSets) ? item.galleryPhotoSrcSets : [],
        galleryPhotoIds: Array.isArray(item.galleryPhotoIds) ? item.galleryPhotoIds : [],
        galleryPhotoLikeCounts: Array.isArray(item.galleryPhotoLikeCounts) ? item.galleryPhotoLikeCounts : [],
        galleryPhotoPins: Array.isArray(item.galleryPhotoPins) ? item.galleryPhotoPins : [],
        socialLinks,
        socials,
        shiftLabel: item.shiftLabel || "",
        shiftStartsAt: item.shiftStartsAt || "",
        shiftEndsAt: item.shiftEndsAt || "",
        shiftTimeZone: item.shiftTimeZone || "",
        locationStatus: item.locationStatus || item.location_status || "self_reported",
        checkedInAt: item.checkedInAt || item.checked_in_at || "",
        checkedOutAt: item.checkedOutAt || item.checked_out_at || "",
        checkinDistanceFeet: item.checkinDistanceFeet ?? item.checkin_distance_feet ?? null,
        locationVerificationExpiresAt: item.locationVerificationExpiresAt || item.location_verification_expires_at || "",
        followerCount: item.followerCount ?? item.follower_count ?? 0,
        notificationCount: item.notificationCount ?? item.notification_count ?? 0,
        profileViewsToday: item.profileViewsToday ?? item.profile_views_today ?? 0,
        metricsUnavailable: item.metricsUnavailable === true,
        goingCount: item.goingCount ?? item.going_count ?? 0,
        workingStatus: item.workingStatus || item.working_status || "self_reported",
        commissionTrackingStartedAt: item.commissionTrackingStartedAt || item.commission_tracking_started_at || "",
        commissionTrackingStoppedAt: item.commissionTrackingStoppedAt || item.commission_tracking_stopped_at || "",
        endedAt: item.endedAt || item.ended_at || "",
        endedReason: item.endedReason || item.ended_reason || "",
        shiftSummary: item.shiftSummary || item.shift_summary || null,
        postedShifts: item.shiftId || item.shiftStartsAt ? [{
          shiftId: item.shiftId || "",
          venue: item.venueName || "Venue pending",
          time: item.shiftLabel || "Schedule pending",
          shiftLabel: item.shiftLabel || "",
          shiftStartsAt: item.shiftStartsAt || "",
          shiftEndsAt: item.shiftEndsAt || "",
          shiftTimeZone: item.shiftTimeZone || "",
          locationStatus: item.locationStatus || item.location_status || "self_reported",
          checkedInAt: item.checkedInAt || item.checked_in_at || "",
          checkedOutAt: item.checkedOutAt || item.checked_out_at || "",
          locationVerificationExpiresAt: item.locationVerificationExpiresAt || item.location_verification_expires_at || "",
          workingStatus: item.workingStatus || item.working_status || "self_reported"
        }] : []
      };
    }

    function approvalStatusLabel(status) {
      if (status === "approved") return "Verified";
      if (status === "rejected") return "Rejected";
      return "Pending";
    }

    function reviewStatusLabel(status, approvedLabel, pendingLabel) {
      if (status === "approved") return approvedLabel;
      if (status === "rejected") return "Rejected";
      return pendingLabel;
    }

    function normalizedReviewStatus(status) {
      return String(status || "").trim().toLowerCase();
    }

    function isApprovedDancerStatus(status) {
      const normalized = normalizedReviewStatus(status);
      return normalized === "approved" || normalized === "verified";
    }

    function isRejectedDancerStatus(status) {
      const normalized = normalizedReviewStatus(status);
      return normalized === "rejected" || normalized === "disapproved";
    }

    function dancerCoreApprovalUnlocked(profile) {
      const verificationApproved = normalizedReviewStatus(profile?.verification_status || profile?.verificationStatus) === "approved";
      return Boolean(isApprovedDancerStatus(profile?.status) || verificationApproved);
    }

    function applyLiveApprovalQueue(queue) {
      (queue || []).forEach((item, index) => {
        const city = item.city || citySelect.value;
        const market = discoveryMarket(city);
        if (!market) return;
        const photos = Array.isArray(item.photos) ? item.photos : [];
        const socialLinks = normalizeSubmittedSocials(item);
        const reviews = Array.isArray(item.reviews) ? item.reviews : [];
        const hasPendingContent =
          photos.some((photo) => !isFinalAdminReviewStatus(normalizedReviewStatus(photo.reviewStatus || photo.review_status))) ||
          socialLinks.some((social) => !isFinalAdminReviewStatus(normalizedReviewStatus(social.reviewStatus)));
        const primaryPhoto = photos.find((photo) => photo.isPrimary)?.imageUrl || photos[0]?.imageUrl || "";
        const profileData = {
          id: item.id,
          userId: item.userId || item.user_id || "",
          isRealDancerAccount: true,
          slug: item.slug || slugify(item.stageName),
          name: item.stageName,
          legalName: item.realName || item.real_name || "",
          city,
          status: approvalStatusLabel(item.status),
          reviewSubmitted: item.status === "pending_review",
          approvalChangesPending: item.status === "approved" && hasPendingContent,
          approvalChangesSubmitted: item.status === "approved" && hasPendingContent,
          venue: "",
          time: "No upcoming shifts",
          tonight: false,
          scheduled: false,
          trend: 10 + index,
          distance: "Pending",
          hidden: item.isPublic === false || item.is_public === false,
          isPublic: item.isPublic !== false && item.is_public !== false,
          createdAt: item.createdAt || item.created_at || "",
          updatedAt: item.updatedAt || item.updated_at || "",
          approvedAt: item.approvedAt || item.approved_at || "",
          disabledAt: item.disabledAt || item.disabled_at || "",
          contentFlagged: false,
          photoStatus: reviewStatusLabel(item.photoReviewStatus, "Approved", "Pending"),
          socials: Object.fromEntries(socialLinks.map((social) => [social.platform, social.url || social.handle || ""]).filter(([, value]) => Boolean(value))),
          socialLinks,
          reviews,
          submittedPhotos: photos,
          mainPhotoUrl: primaryPhoto,
          galleryPhotoUrls: photos.map((photo) => photo.imageUrl).filter(Boolean),
          galleryPhotoIds: photos.filter((photo) => photo.imageUrl).map((photo) => photo.id || ""),
          galleryPhotoLikeCounts: photos.filter((photo) => photo.imageUrl).map((photo) => safePublicMediaLikeCount(photo.likeCount || photo.like_count))
        };
        const existing = market.dancers.find((profile) => profile.id === item.id || profile.slug === profileData.slug || profile.name === item.stageName);
        if (existing) Object.assign(existing, profileData);
        else market.dancers.push(profileData);
      });
    }

    function formatVenueHours(item) {
      if (item.hoursLabel) return item.hoursLabel;
      if (item.opens_at && item.closes_at) return `${item.opens_at} - ${item.closes_at}`;
      return "Hours pending";
    }

    function mapLiveAdminVenue(item, city, existing) {
      return {
        id: item.id,
        slug: item.slug,
        name: item.name,
        area: item.state || item.city || city,
        state: item.state || stateByCity[city] || "",
        address: item.address || "",
        phone: item.phone || "",
        website: item.website || "",
        hours: formatVenueHours(item),
        shifts: existing?.shifts || 0,
        distance: existing?.distance && existing.distance !== "Nearby" ? existing.distance : "",
        latitude: Number.isFinite(Number(item.latitude)) ? Number(item.latitude) : existing?.latitude,
        longitude: Number.isFinite(Number(item.longitude)) ? Number(item.longitude) : existing?.longitude,
        featured: Boolean(existing?.featured),
        hidden: item.is_active === false,
        isActive: item.is_active !== false,
        ownerUserId: item.owner_user_id || null
      };
    }