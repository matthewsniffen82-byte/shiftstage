

    function setVenueAuthMode(mode, options = {}) {
      venueAuthMode = "signup";
      const signupStep = document.getElementById("venueSignupCodeStep");
      const accountFields = document.getElementById("venueAccountFields");
      const accountStepHeading = document.getElementById("venueAccountStepHeading");
      const signupSubmit = document.getElementById("venueJoinNowBtn");
      const passwordInput = document.getElementById("venueLoginPassword");
      const signupReady = Boolean(verifiedVenueSignupCode && verifiedVenueSignupPreview);

      if (signupStep) signupStep.hidden = false;
      if (accountFields) accountFields.hidden = !signupReady;
      if (accountStepHeading) accountStepHeading.hidden = !signupReady;
      if (signupSubmit) signupSubmit.hidden = !signupReady;
      if (passwordInput) {
        passwordInput.autocomplete = "new-password";
        passwordInput.setAttribute("minlength", "6");
      }
      const passwordRequirements = document.getElementById("venuePasswordRequirements");
      if (passwordRequirements) passwordRequirements.hidden = !signupReady;
      setVenueAuthStatus("");

      if (options.focus !== false) {
        setTimeout(() => {
          const target = document.getElementById(signupReady ? "venueLoginEmail" : "venueSignupCode");
          target?.focus({ preventScroll: true });
        }, 60);
      }
    }

    function formatVenueAccessCode(value) {
      const normalized = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (!normalized) return "";
      if (normalized.length < 5 && "DANCR".startsWith(normalized)) return normalized;
      const entropy = (normalized.startsWith("DANCR") ? normalized.slice(5) : normalized).slice(0, 20);
      const groups = entropy.match(/.{1,4}/g) || [];
      return ["DANCR", ...groups].join("-");
    }

    function invalidateVenueAccessPreview() {
      verifiedVenueSignupCode = "";
      verifiedVenueSignupPreview = null;
      const preview = document.getElementById("venueAccessPreview");
      if (preview) preview.hidden = true;
      setVenueCodeStatus("");
      if (venueAuthMode === "signup") setVenueAuthMode("signup", { focus: false });
    }

    async function verifyVenueAccessCode() {
      const input = document.getElementById("venueSignupCode");
      const button = document.getElementById("venueCodeVerifyBtn");
      const code = formatVenueAccessCode(input?.value || "");
      if (input) input.value = code;
      if (!input?.reportValidity()) {
        setVenueCodeStatus("Enter the complete private access code from MyDancr.");
        return false;
      }

      button.disabled = true;
      button.textContent = "Verifying securely…";
      setVenueCodeStatus("Checking the venue assigned to this code…");
      try {
        const response = await fetch("/api/venue/access-code/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ code })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok || !data.venue?.id) {
          throw new Error(data.error || "This venue access code could not be verified.");
        }

        verifiedVenueSignupCode = code;
        verifiedVenueSignupPreview = data.venue;
        document.getElementById("venueAccessPreviewName").textContent = data.venue.name;
        document.getElementById("venueAccessPreviewLocation").textContent = [data.venue.city, data.venue.state].filter(Boolean).join(", ");
        document.getElementById("venueAccessPreview").hidden = false;
        document.getElementById("venueJoinNowBtn").textContent = `Create account for ${data.venue.name}`;
        setVenueCodeStatus("Access code verified. Create the manager login below.");
        setVenueAuthMode("signup", { focus: false });
        setTimeout(() => document.getElementById("venueLoginEmail")?.focus({ preventScroll: true }), 80);
        return true;
      } catch (error) {
        invalidateVenueAccessPreview();
        setVenueCodeStatus(error.message || "This venue access code could not be verified.");
        return false;
      } finally {
        button.disabled = false;
        button.textContent = "Verify access code";
      }
    }

    function clearDancerSignupFields() {
      ["dancerLegalName", "dancerStageName", "dancerEmail", "dancerPassword"].forEach((id) => {
        const input = document.getElementById(id);
        if (input) input.value = "";
      });
      const dancerCity = document.getElementById("dancerCity");
      if (dancerCity) dancerCity.value = "";
      pendingDancerSignupCity = "";
      setDancerSignupStatus("");
      const submit = document.querySelector('#dancerSignupForm button[type="submit"]');
      stopConfirmationResendCooldown(submit, "Create dancer account", false);
      if (submit) submit.disabled = false;
    }

    function setAuthEntryMode(mode) {
      blurFocusedAuthField();
      authEntryMode = mode === "create" ? "create" : "signin";
      const isCreate = authEntryMode === "create";
      const signInTab = document.getElementById("authSignInTab");
      const createTab = document.getElementById("authCreateTab");
      signInTab.classList.toggle("active", !isCreate);
      createTab.classList.toggle("active", isCreate);
      signInTab.setAttribute("aria-selected", String(!isCreate));
      createTab.setAttribute("aria-selected", String(isCreate));
      document.getElementById("authPageTitle").textContent = isCreate ? "Choose your account" : "Sign in to MyDancr";
      document.getElementById("authRoleTitle").textContent = isCreate ? "What are you joining as?" : "One sign-in for every account";
      document.getElementById("authRoleSubtitle").textContent = isCreate
        ? "Pick the account that matches how you use MyDancr."
        : "Use the email and password for your guest, dancer, or venue account.";
      document.querySelector(".auth-selected-role").hidden = isCreate;
      document.getElementById("authOverview").hidden = !isCreate;
      document.getElementById("authForm").hidden = isCreate;
      document.getElementById("venueLoginForm").hidden = true;
      document.getElementById("venueRequestForm").hidden = true;
      if (!isCreate) {
        setCustomerAuthMode("login");
        setCustomerAuthStatus("");
      }
      authPage.scrollTo({ top: 0, behavior: "auto" });
      queueAuthVisualViewportSync();
      syncOverlayScrollLock();
    }

    function openCustomerSignup() {
      blurFocusedAuthField();
      authEntryMode = "create";
      document.getElementById("authSignInTab").classList.remove("active");
      document.getElementById("authCreateTab").classList.add("active");
      document.getElementById("authSignInTab").setAttribute("aria-selected", "false");
      document.getElementById("authCreateTab").setAttribute("aria-selected", "true");
      document.getElementById("authPageTitle").textContent = "Create guest account";
      document.querySelector(".auth-selected-role").hidden = true;
      document.getElementById("authOverview").hidden = true;
      document.getElementById("authForm").hidden = false;
      document.getElementById("venueLoginForm").hidden = true;
      document.getElementById("venueRequestForm").hidden = true;
      setCustomerAuthMode("signup");
      setCustomerAuthStatus("");
      syncOverlayScrollLock();
      focusAuthFieldWhenKeyboardSafe("customerEmail");
    }

    function openVenueSignup() {
      blurFocusedAuthField();
      authEntryMode = "create";
      closeRecoveryPopover(passwordRecoveryCard, false);
      closeRecoveryPopover(loginRecoveryCard, false);
      clearAuthFields("venue");
      document.getElementById("authSignInTab").classList.remove("active");
      document.getElementById("authCreateTab").classList.add("active");
      document.getElementById("authSignInTab").setAttribute("aria-selected", "false");
      document.getElementById("authCreateTab").setAttribute("aria-selected", "true");
      document.getElementById("authPageTitle").textContent = "Create venue account";
      document.querySelector(".auth-selected-role").hidden = true;
      document.getElementById("authOverview").hidden = true;
      document.getElementById("authForm").hidden = true;
      document.getElementById("venueLoginForm").hidden = false;
      document.getElementById("venueRequestForm").hidden = true;
      setVenueAuthMode("signup");
      authPage.scrollTo({ top: 0, behavior: "auto" });
      queueAuthVisualViewportSync();
      syncOverlayScrollLock();
    }

    function openVenueRequest() {
      blurFocusedAuthField();
      authEntryMode = "create";
      closeRecoveryPopover(passwordRecoveryCard, false);
      closeRecoveryPopover(loginRecoveryCard, false);
      clearAuthFields("venue");
      document.getElementById("authSignInTab").classList.remove("active");
      document.getElementById("authCreateTab").classList.add("active");
      document.getElementById("authSignInTab").setAttribute("aria-selected", "false");
      document.getElementById("authCreateTab").setAttribute("aria-selected", "true");
      document.getElementById("authPageTitle").textContent = "List your club";
      document.querySelector(".auth-selected-role").hidden = true;
      document.getElementById("authOverview").hidden = true;
      document.getElementById("authForm").hidden = true;
      document.getElementById("venueLoginForm").hidden = true;
      document.getElementById("venueRequestForm").hidden = false;
      syncOverlayScrollLock();
      focusAuthFieldWhenKeyboardSafe("venueRequestName");
    }

    function openAuthRole(role = "customer") {
      authRoleHint = role === "dancer" || role === "venue" ? role : "customer";
      closeRecoveryPopover(passwordRecoveryCard, false);
      closeRecoveryPopover(loginRecoveryCard, false);
      clearAuthFields("customer");
      openAuthPage();
      setAuthEntryMode("signin");
      if (isAdminSession()) {
        setCustomerAuthStatus("An admin session is active. Signing in here will safely switch to your public account.");
      }
      focusAuthFieldWhenKeyboardSafe("customerEmail");
    }

    function closeAuthPage() {
      blurFocusedAuthField();
      pendingVenueAuthReturnTo = "";
      pendingAccountAuthReturnTo = "";
      pendingVenueAgentReferralCode = "";
      clearAuthFields("all");
      closeRecoveryPopover(passwordRecoveryCard, false);
      closeRecoveryPopover(loginRecoveryCard, false);
      authPage.classList.remove("show");
      authPage.setAttribute("aria-hidden", "true");
      authPage.style.removeProperty("--dancr-auth-viewport-height");
      authPage.style.removeProperty("--dancr-auth-viewport-top");
      syncOverlayScrollLock();
    }

    function openAdminDashboard() {
      window.location.assign("/admin");
    }

    function closeAdminDashboard() {
      adminDashboard.classList.remove("show");
      adminDashboard.setAttribute("aria-hidden", "true");
      syncOverlayScrollLock();
    }

    function openLegalPage(pageId) {
      const page = document.getElementById(pageId);
      if (!page) return;
      page.classList.add("show");
      page.setAttribute("aria-hidden", "false");
      syncOverlayScrollLock();
    }

    function closeLegalPage(button) {
      const page = button.closest(".legal-page");
      if (!page) return;
      page.classList.remove("show");
      page.setAttribute("aria-hidden", "true");
      syncOverlayScrollLock();
    }

    function openDancerSignupPage() {
      closeAuthPage();
      clearDancerSignupFields();
      dancerSignupPage.classList.add("show");
      dancerSignupPage.setAttribute("aria-hidden", "false");
      syncOverlayScrollLock();
    }

    function closeDancerSignupPage() {
      clearDancerSignupFields();
      dancerSignupPage.classList.remove("show");
      dancerSignupPage.setAttribute("aria-hidden", "true");
      syncOverlayScrollLock();
    }

    function openStripeCheckoutPage() {
      closeDancerSignupPage();
      stripeCheckoutPage.classList.add("show");
      stripeCheckoutPage.setAttribute("aria-hidden", "false");
      syncOverlayScrollLock();
    }

    function closeStripeCheckoutPage() {
      stripeCheckoutPage.classList.remove("show");
      stripeCheckoutPage.setAttribute("aria-hidden", "true");
      syncOverlayScrollLock();
    }

    function updateAccountHeader() {
      const loggedIn = isCustomerLoggedIn || isDancerLoggedIn || isVenueLoggedIn;
      const sessionRole = authSession?.account?.role;
      const role = activeDashboardType === "dancer" ? "Dancer" : activeDashboardType === "venue" ? "Venue" : "Guest";
      dashboardBtn.hidden = !loggedIn;
      dashboardBtn.textContent = loggedIn ? `${role} dashboard` : "Dashboard";
      dashboardBtn.setAttribute("aria-label", loggedIn ? `Open ${role.toLowerCase()} dashboard` : "Open dashboard");
      adminBtn.hidden = loggedIn && sessionRole !== "admin";
      sessionMenuEnd.hidden = !loggedIn;
      deleteAccountBtn.hidden = !loggedIn || !["customer", "dancer", "venue"].includes(sessionRole);
      deleteAccountBtn.dataset.accountRole = sessionRole || "";
      accountBtn.hidden = false;
      accountBtn.classList.toggle("account-icon-btn", loggedIn);
      accountBtn.innerHTML = loggedIn ? accountIconMarkup() : "Login / Join";
      accountBtn.setAttribute("aria-label", loggedIn ? "Account menu" : "Login or join");
      if (loggedIn) {
        accountBtn.title = `${role} account`;
      } else {
        accountBtn.removeAttribute("title");
        closeUtilityMenu();
        hideAccountTooltip();
      }
      renderCustomerQuickActions();
    }

    function restoreLoggedInSessionState() {
      const role = authSession?.account?.role;
      if (!authSession?.accessToken || !role) return;
      isCustomerLoggedIn = role === "customer";
      isDancerLoggedIn = role === "dancer";
      isVenueLoggedIn = role === "venue";
      activeDashboardType = role === "dancer" ? "dancer" : role === "venue" ? "venue" : "customer";
      syncSignedInAccountControl(role);
      if (role === "customer") prepareRealCustomerDashboardState();
    }

    function closeUtilityMenu() {
      moreMenuPanel.hidden = true;
      accountBtn.classList.remove("active");
      accountBtn.setAttribute("aria-expanded", "false");
    }

    function toggleUtilityMenu() {
      const willOpen = moreMenuPanel.hidden;
      moreMenuPanel.hidden = !willOpen;
      accountBtn.classList.toggle("active", willOpen);
      accountBtn.setAttribute("aria-expanded", String(willOpen));
    }

    function logoutAccount({ message = "Logged out" } = {}) {
      void endAuthSession();
      isCustomerLoggedIn = false;
      isDancerLoggedIn = false;
      isVenueLoggedIn = false;
      activeDashboardType = "customer";
      liveDancerAnalytics = null;
      liveDancerDeals = null;
      liveDancerWeeklyReport = null;
      liveDancerBilling = null;
      liveDancerFinance = null;
      liveDancerRankingEvents = [];
      liveDancerReviews = [];
      liveCustomerProfile = null;
      liveVenueDashboard = null;
      liveNotificationsRequestVersion += 1;
      liveNotificationClearPending = null;
      liveNotifications = [];
      releaseSetupPhotoPreviews();
      pendingSetupPhotoFiles = [];
      pendingSetupPhotoPreviewUrls = [];
      clearPendingApprovedProfileVideoSelection();
      clearCustomerSavedCollections();
      savedDealPasses = loadSavedDealPasses();
      renderCustomerQuickActions();
      closeDashboard();
      closeDancerDashboard();
      closeVenueDashboard();
      updateAccountHeader();
      showToast(message);
    }

    function setCustomerAuthMode(mode) {
      authMode = mode === "signup" ? "signup" : "login";
      const isSignup = mode === "signup";
      const selectedRoleHead = document.querySelector(".auth-selected-role");
      if (selectedRoleHead) selectedRoleHead.hidden = isSignup;
      const customerFormHead = document.querySelector(".customer-form-head");
      if (customerFormHead) customerFormHead.hidden = true;
      const label = document.getElementById("customerAuthModeLabel");
      if (label) label.textContent = isSignup ? "Create your private guest account" : "Sign in";
      const formHead = document.getElementById("customerAuthModeDescription");
      if (formHead) formHead.textContent = isSignup
        ? "Enter your email and a secure password. We’ll send one confirmation link."
        : "MyDancr opens the right dashboard automatically.";
      const passwordInput = document.getElementById("customerPassword");
      if (passwordInput) {
        passwordInput.autocomplete = isSignup ? "new-password" : "current-password";
        if (isSignup) passwordInput.setAttribute("minlength", "6");
        else passwordInput.removeAttribute("minlength");
      }
      const passwordRequirements = document.getElementById("customerPasswordRequirements");
      if (passwordRequirements) passwordRequirements.hidden = !isSignup;
      const confirmField = document.getElementById("customerConfirmPasswordField");
      const confirmInput = document.getElementById("customerConfirmPassword");
      if (confirmField) confirmField.hidden = !isSignup;
      if (confirmInput) confirmInput.required = isSignup;
      document.getElementById("customerSignupNote").hidden = !isSignup;
      document.getElementById("customerBackToTypes").hidden = !isSignup;
      const forgotButton = document.getElementById("customerForgotPasswordBtn");
      if (forgotButton) forgotButton.hidden = mode !== "login";
      const forgotLoginButton = document.getElementById("customerForgotLoginBtn");
      if (forgotLoginButton) forgotLoginButton.hidden = mode !== "login";
      const submit = document.getElementById("authSubmit");
      if (!confirmationResendTimers.has(submit)) {
        submit.textContent = isSignup ? "Create guest account" : "Sign in";
        submit.disabled = false;
      }
      if (!isSignup) stopConfirmationResendCooldown(submit, "Sign in");
    }

    function setCustomerAuthStatus(message) {
      const status = document.getElementById("customerAuthStatus");
      if (!status) return;
      status.textContent = message || "";
      status.hidden = !message;
    }

    function setDancerSignupStatus(message) {
      const status = document.getElementById("dancerSignupStatus");
      if (!status) return;
      status.textContent = message || "";
      status.hidden = !message;
    }

    function stopConfirmationResendCooldown(button, defaultText = "", enable = true) {
      const timer = confirmationResendTimers.get(button);
      if (timer) window.clearInterval(timer);
      confirmationResendTimers.delete(button);
      if (!button) return;
      if (defaultText) button.textContent = defaultText;
      if (enable) button.disabled = false;
    }

    function startConfirmationResendCooldown(button, readyText = "Resend confirmation email", seconds = 60) {
      stopConfirmationResendCooldown(button, "", false);
      let remaining = seconds;
      const render = () => {
        button.disabled = true;
        button.textContent = `Resend confirmation in ${remaining}s`;
      };
      render();
      const timer = window.setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          stopConfirmationResendCooldown(button, readyText);
          return;
        }
        render();
      }, 1000);
      confirmationResendTimers.set(button, timer);
    }

    function openFreshCustomerSignup() {
      saveAuthSession(null);
      isCustomerLoggedIn = false;
      isDancerLoggedIn = false;
      isVenueLoggedIn = false;
      activeDashboardType = "customer";
      closeDashboard();
      closeDancerDashboard();
      closeVenueDashboard();
      updateAccountHeader();
      openAuthRole("customer");
      openCustomerSignup();
      document.getElementById("customerPassword").value = "";
      document.getElementById("customerConfirmPassword").value = "";
    }

    function openUnifiedDashboard(role = activeDashboardType, section = "") {
      const dashboardRole = ["customer", "dancer", "venue"].includes(authSession?.account?.role)
        ? authSession.account.role
        : role === "dancer" || role === "venue" ? role : "customer";
      if (!authSession?.accessToken) {
        openAuthRole(dashboardRole);
        return false;
      }
      const sectionHash = section && role === dashboardRole ? `#${encodeURIComponent(section)}` : "";
      window.location.assign(`/dashboard/${dashboardRole}${sectionHash}`);
      return true;
    }

    function openDashboard() {
      if (activeDashboardType === "dancer") {
        openDancerDashboard();
        return;
      }
      if (activeDashboardType === "venue") {
        openVenueDashboard();
        return;
      }
      return openUnifiedDashboard("customer");
    }

    function closeDashboard() {
      customerDashboard.classList.remove("show");
      customerDashboard.setAttribute("aria-hidden", "true");
      syncOverlayScrollLock();
    }

    function openDancerDashboard() {
      if (!dancerSignupStarted && !isDancerSession()) {
        openDancerSignupPage();
        return;
      }
      syncSignedInAccountControl("dancer");
      applyStoredDancerProfileDraft();
      updateDancerDashboardName();
      setupChecklistExpanded = false;
      activeSetupStep = "";
      renderDancerSetup();
      renderAccountControls();
      dancerDashboard.classList.add("show");
      dancerDashboard.setAttribute("aria-hidden", "false");
      syncOverlayScrollLock();
      const dancerApprovalProgressRequest = hydrateDancerApprovalProgress();
      loadLiveAccountState();
      loadLiveDancerAnalytics();
      loadLiveDancerDeals();
      loadLiveDancerWeeklyReport();
      loadLiveDancerBilling();
      loadLiveDancerFinance();
      loadLiveDancerRankingEvents();
      loadLiveDancerReviews();
      loadLiveNotifications();
      loadLiveSupportThreads();
      if (dancerSetup.review || dancerSetup.approval) loadDancerVenueVerification();
      void dancerApprovalProgressRequest.then(() => {
        const venueVerificationSection = document.getElementById("dancerVenueVerificationSection");
        if (venueVerificationSection && !venueVerificationSection.hidden) {
          return loadDancerVenueVerification();
        }
        return null;
      });
      startDancerVenueApprovalPolling();
      renderSupportInbox("dancer");
    }

    function closeDancerDashboard() {
      stopDancerVenueVerificationLifecycle();
      activeDancerVenueVerification = null;
      const verificationQr = document.getElementById("dancerVenueVerificationQr");
      if (verificationQr) verificationQr.hidden = true;
      dancerDashboard.classList.remove("show");
      dancerDashboard.setAttribute("aria-hidden", "true");
      stopDancerVenueApprovalPolling();
      syncOverlayScrollLock();
    }

    function stopDancerVenueApprovalPolling() {
      if (dancerVenueApprovalPollTimer) window.clearInterval(dancerVenueApprovalPollTimer);
      dancerVenueApprovalPollTimer = 0;
    }

    function startDancerVenueApprovalPolling() {
      stopDancerVenueApprovalPolling();
      if (!isDancerSession() || dancerSetup.approval) return;
      dancerVenueApprovalPollTimer = window.setInterval(async () => {
        if (!dancerDashboard.classList.contains("show") || dancerSetup.approval) {
          stopDancerVenueApprovalPolling();
          return;
        }
        const wasApproved = dancerSetup.approval;
        await hydrateDancerApprovalProgress();
        if (!wasApproved && dancerSetup.approval) {
          stopDancerVenueApprovalPolling();
          showToast("Venue affiliation confirmed. Your profile is live.");
        }
      }, 8000);
    }

    function formatVenueAffiliationTime(value, includeYear = false) {
      const date = new Date(value || "");
      if (Number.isNaN(date.getTime())) return includeYear ? "recently" : "soon";
      return includeYear
        ? date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
        : date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    }

    function renderDancerVenueVerification() {
      const section = document.getElementById("dancerVenueVerificationSection");
      if (!section) return;
      const state = liveDancerVenueVerification || {};
      const onboardingRequired = state.dancer?.onboardingRequired === true;
      const venues = Array.isArray(state.venues) ? state.venues : [];
      const dancerCity = String(state.dancer?.city || "your city");
      const affiliations = (Array.isArray(state.affiliations) ? state.affiliations : []).filter((item) => item.status === "active");
      document.getElementById("dancerVenueVerificationEyebrow").textContent = onboardingRequired ? "Step 3 · Dressing-room tap" : "Venue access";
      document.getElementById("dancerVenueVerificationTitle").textContent = onboardingRequired ? "Verify your first venue" : "Manage where you work";
      document.getElementById("dancerVenueVerificationDescription").textContent = onboardingRequired
        ? "At the club, tap its official MyDancr dressing-room sticker. The tap approves venue access; MyDancr reviews profile content separately."
        : "Use a new personal QR whenever you add or switch clubs. Your approved profile stays live while affiliations change.";
      const select = document.getElementById("dancerVenueVerificationVenue");
      const previousVenueId = select.value;
      select.innerHTML = venues.length
        ? venues.map((venue) => `<option value="${escapeHtml(venue.id)}">${escapeHtml(venue.name)} · ${venue.managerReady === true ? "Manager ready" : "Manager setup needed"}</option>`).join("")
        : `<option value="">No active venues available in ${escapeHtml(dancerCity)}</option>`;
      select.disabled = !venues.length;
      const preferredVenue = venues.find((venue) => venue.id === previousVenueId) || venues[0] || null;
      select.value = preferredVenue?.id || "";
      document.getElementById("dancerVenueVerificationCreate").disabled = preferredVenue?.managerReady !== true;
      const list = document.getElementById("dancerVenueAffiliationList");
      list.innerHTML = `<strong>Verified venues</strong>${affiliations.length
        ? affiliations.map((item) => `
            <div>
              <span><b>✓ ${escapeHtml(item.venue?.name || "Venue")}</b><small>Approved ${escapeHtml(formatVenueAffiliationTime(item.approvedAt, true))}</small></span>
              <button type="button" data-dancer-affiliation-remove="${escapeHtml(item.id)}">Remove</button>
            </div>
          `).join("")
        : "<small>No venue has verified your affiliation yet.</small>"}`;
      list.querySelectorAll("[data-dancer-affiliation-remove]").forEach((button) => {
        button.onclick = () => removeDancerVenueAffiliation(button.dataset.dancerAffiliationRemove);
      });
      renderShiftPostForm();
      document.getElementById("dancerVenueVerificationStatus").textContent =
        preferredVenue?.managerReady === true
          ? `Tap ${preferredVenue.name}'s official dressing-room sticker at the club.`
          : preferredVenue
            ? `${preferredVenue.name} is not ready for dressing-room taps yet.`
            : `Choose an active ${dancerCity} venue.`;
    }

    function selectedDancerVenueVerificationVenue() {
      const venueId = document.getElementById("dancerVenueVerificationVenue")?.value || "";
      const venues = Array.isArray(liveDancerVenueVerification?.venues) ? liveDancerVenueVerification.venues : [];
      return venues.find((venue) => venue.id === venueId) || null;
    }

    function updateDancerVenueVerificationSelectionStatus() {
      const venue = selectedDancerVenueVerificationVenue();
      const dancerCity = String(liveDancerVenueVerification?.dancer?.city || "your city");
      const button = document.getElementById("dancerVenueVerificationCreate");
      const status = document.getElementById("dancerVenueVerificationStatus");
      button.disabled = venue?.managerReady !== true;
      status.textContent = !venue
        ? `Choose an active ${dancerCity} venue.`
        : venue.managerReady === true
          ? `Tap ${venue.name}'s official dressing-room sticker at the club.`
          : `${venue.name} is not ready for dressing-room taps yet.`;
    }

    function loadDancerVenueVerification({ quiet = false } = {}) {
      const status = document.getElementById("dancerVenueVerificationStatus");
      if (!isDancerSession()) {
        if (!quiet) {
          const select = document.getElementById("dancerVenueVerificationVenue");
          if (select) {
            select.innerHTML = '<option value="">Sign in to load venues</option>';
            select.disabled = true;
          }
          document.getElementById("dancerVenueVerificationCreate").disabled = true;
          if (status) status.textContent = "Sign in to your dancer account to load venue affiliations.";
        }
        return Promise.resolve(null);
      }
      if (dancerVenueVerificationRequest) return dancerVenueVerificationRequest;
      if (status && !quiet) status.textContent = "Loading venue verification…";
      dancerVenueVerificationRequest = (async () => {
        try {
          liveDancerVenueVerification = await requestVenueAffiliationJson("/api/dancer/venue-verification");
          renderDancerVenueVerification();
          return liveDancerVenueVerification;
        } catch (error) {
          if (!quiet) {
            const select = document.getElementById("dancerVenueVerificationVenue");
            if (select) {
              select.innerHTML = '<option value="">Unable to load venues</option>';
              select.disabled = true;
            }
            document.getElementById("dancerVenueVerificationCreate").disabled = true;
            if (status) status.textContent = error.message || "Unable to load venue verification.";
          }
          return null;
        } finally {
          dancerVenueVerificationRequest = null;
        }
      })();
      return dancerVenueVerificationRequest;
    }

    function stopDancerVenueVerificationLifecycle() {
      window.clearTimeout(dancerVenueVerificationRenewTimer);
      window.clearInterval(dancerVenueVerificationApprovalPoll);
      dancerVenueVerificationRenewTimer = 0;
      dancerVenueVerificationApprovalPoll = 0;
    }

    function dancerVenueAffiliationIsApproved(state, venueId) {
      return (Array.isArray(state?.affiliations) ? state.affiliations : []).some(
        (item) => item.status === "active" && item.venueId === venueId
      );
    }

    function completeDancerVenueVerification(venueName) {
      stopDancerVenueVerificationLifecycle();
      activeDancerVenueVerification = null;
      document.getElementById("dancerVenueVerificationQr").hidden = true;
      document.getElementById("dancerVenueVerificationStatus").textContent = `${venueName || "Venue"} approved your profile.`;
    }

    function startDancerVenueVerificationLifecycle(verification) {
      stopDancerVenueVerificationLifecycle();
      if (!verification?.venue?.id) return;
      const venueId = verification.venue.id;
      dancerVenueVerificationApprovalPoll = window.setInterval(async () => {
        const latest = await loadDancerVenueVerification({ quiet: true });
        if (dancerVenueAffiliationIsApproved(latest, venueId)) {
          completeDancerVenueVerification(verification.venue?.name);
        }
      }, 5000);
      const expiresAt = new Date(verification.expiresAt || "").getTime();
      const renewalDelay = Number.isFinite(expiresAt)
        ? Math.max(1000, expiresAt - Date.now() + 250)
        : 10 * 60 * 1000;
      dancerVenueVerificationRenewTimer = window.setTimeout(() => {
        if (activeDancerVenueVerification === verification) {
          void createDancerVenueVerification({ rotate: true });
        }
      }, renewalDelay);
    }

    async function createDancerVenueVerification({ rotate = false } = {}) {
      const button = document.getElementById("dancerVenueVerificationCreate");
      const status = document.getElementById("dancerVenueVerificationStatus");
      const currentVerification = rotate ? activeDancerVenueVerification : null;
      const venueId = currentVerification?.venue?.id || document.getElementById("dancerVenueVerificationVenue").value;
      if (!venueId) {
        status.textContent = "Choose a club first.";
        return;
      }
      const selectedVenue = selectedDancerVenueVerificationVenue();
      if (selectedVenue?.managerReady !== true) {
        updateDancerVenueVerificationSelectionStatus();
        return;
      }
      button.disabled = true;
      status.textContent = rotate
        ? "Refreshing your private verification QR…"
        : "Creating your private 10-minute QR…";
      try {
        const data = await requestVenueAffiliationJson("/api/dancer/venue-verification", {
          method: "POST",
          body: currentVerification
            ? {
                venueId,
                tokenId: currentVerification.tokenId,
                rotationToken: currentVerification.rotationToken
              }
            : { venueId }
        });
        activeDancerVenueVerification = data.verification;
        document.getElementById("dancerVenueVerificationQrImage").src = data.verification.qrDataUrl;
        document.getElementById("dancerVenueVerificationQrVenue").textContent = data.verification.venue?.name || "Venue";
        document.getElementById("dancerVenueVerificationQrExpiry").textContent = `Expires ${formatVenueAffiliationTime(data.verification.expiresAt)}`;
        document.getElementById("dancerVenueVerificationQr").hidden = false;
        status.textContent = data.message || "Tap the official dressing-room sticker at the club.";
        startDancerVenueVerificationLifecycle(data.verification);
      } catch (error) {
        const latest = rotate ? await loadDancerVenueVerification({ quiet: true }) : null;
        if (rotate && dancerVenueAffiliationIsApproved(latest, venueId)) {
          completeDancerVenueVerification(currentVerification?.venue?.name);
          return;
        }
        stopDancerVenueVerificationLifecycle();
        activeDancerVenueVerification = null;
        document.getElementById("dancerVenueVerificationQr").hidden = true;
        status.textContent = error.message || "Unable to create verification QR.";
      } finally {
        button.disabled = selectedDancerVenueVerificationVenue()?.managerReady !== true;
      }
    }

    async function shareDancerVenueVerification() {
      const status = document.getElementById("dancerVenueVerificationStatus");
      const verification = activeDancerVenueVerification;
      if (!verification?.verificationUrl) return;
      try {
        if (navigator.share) {
          await navigator.share({
            title: `Verify me at ${verification.venue?.name || "this venue"}`,
            text: "Open this private MyDancr link to approve my venue affiliation.",
            url: verification.verificationUrl
          });
          status.textContent = "Verification link shared.";
          return;
        }
        await navigator.clipboard.writeText(verification.verificationUrl);
        status.textContent = "Private verification link copied.";
      } catch (error) {
        if (error?.name !== "AbortError") status.textContent = "Unable to share the verification link.";
      }
    }

    async function removeDancerVenueAffiliation(affiliationId) {
      if (!affiliationId) return;
      const status = document.getElementById("dancerVenueVerificationStatus");
      status.textContent = "Removing venue verification…";
      try {
        const data = await requestVenueAffiliationJson("/api/dancer/venue-verification", { method: "DELETE", body: { affiliationId } });
        stopDancerVenueVerificationLifecycle();
        activeDancerVenueVerification = null;
        document.getElementById("dancerVenueVerificationQr").hidden = true;
        await loadDancerVenueVerification();
        status.textContent = data.message || "Venue verification removed.";
      } catch (error) {
        status.textContent = error.message || "Unable to remove venue verification.";
      }
    }

    function renderVenueDancerAffiliations(state = liveVenueDashboard || {}) {
      const affiliations = (Array.isArray(state.affiliations) ? state.affiliations : []).filter((item) => item.status === "active");
      const list = document.getElementById("venueDancerAffiliationList");
      if (!list) return;
      list.innerHTML = `<strong>Approved roster</strong>${affiliations.length
        ? affiliations.map((item) => `
            <div>
              <span><b>✓ ${escapeHtml(item.dancer?.stageName || "Dancer")}</b><small>Approved ${escapeHtml(formatVenueAffiliationTime(item.approvedAt, true))}</small></span>
              <button type="button" data-venue-affiliation-remove="${escapeHtml(item.id)}">Remove</button>
            </div>
          `).join("")
        : "<small>No dancers have been approved yet.</small>"}`;
      list.querySelectorAll("[data-venue-affiliation-remove]").forEach((button) => {
        button.onclick = () => removeVenueDancerAffiliation(button.dataset.venueAffiliationRemove);
      });
    }

    function renderVenueDancerVerificationPreview(verification) {
      const preview = document.getElementById("venueDancerVerificationPreview");
      const status = document.getElementById("venueDancerVerificationStatus");
      activeVenueDancerVerification = verification || null;
      preview.hidden = !verification;
      if (!verification) return;
      const dancer = verification.dancer || {};
      const avatar = document.getElementById("venueDancerVerificationAvatar");
      avatar.innerHTML = dancer.avatarUrl
        ? `<img src="${escapeHtml(dancer.avatarUrl)}" alt="">`
        : escapeHtml(String(dancer.stageName || "D").slice(0, 1));
      document.getElementById("venueDancerVerificationName").textContent = dancer.stageName || "Dancer";
      document.getElementById("venueDancerVerificationCity").textContent = dancer.city || "City unavailable";
      document.getElementById("venueDancerVerificationExpiry").textContent = verification.alreadyVerified
        ? "Already verified here"
        : `Link expires ${formatVenueAffiliationTime(verification.tokenExpiresAt)}`;
      document.getElementById("venueDancerVerificationApprove").textContent = verification.alreadyVerified
        ? "Confirm again"
        : "Confirm she works here";
      status.textContent = `Confirm that ${dancer.stageName || "this dancer"} works at ${verification.venue?.name || "your venue"}.`;
      preview.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    async function loadVenueDancerVerification(token = "") {
      const query = token ? `?token=${encodeURIComponent(token)}` : "";
      const data = await requestVenueAffiliationJson(`/api/venue/dancer-verifications${query}`);
      if (liveVenueDashboard) liveVenueDashboard.affiliations = data.affiliations || [];
      renderVenueDancerAffiliations(data);
      renderVenueDancerVerificationPreview(data.verification || null);
      return data;
    }

    async function processPendingVenueDancerVerification() {
      const token = pendingVenueDancerVerificationToken();
      if (!token || !isVenueSession()) return false;
      const status = document.getElementById("venueDancerVerificationStatus");
      status.textContent = "Loading dancer verification…";
      try {
        await loadVenueDancerVerification(token);
        return true;
      } catch (error) {
        savePendingVenueDancerVerificationToken("");
        renderVenueDancerVerificationPreview(null);
        status.textContent = error.message || "This dancer verification link is invalid or expired.";
        showToast(status.textContent);
        return false;
      }
    }

    async function approveVenueDancerVerification() {
      const token = pendingVenueDancerVerificationToken();
      const button = document.getElementById("venueDancerVerificationApprove");
      const status = document.getElementById("venueDancerVerificationStatus");
      if (!token || !activeVenueDancerVerification) {
        status.textContent = "Scan a current dancer verification QR first.";
        return;
      }
      button.disabled = true;
      status.textContent = "Approving dancer affiliation…";
      try {
        const data = await requestVenueAffiliationJson("/api/venue/dancer-verifications", { method: "POST", body: { token } });
        savePendingVenueDancerVerificationToken("");
        renderVenueDancerVerificationPreview(null);
        await loadVenueDancerVerification();
        status.textContent = data.message || "Dancer affiliation approved.";
        showToast(status.textContent);
      } catch (error) {
        status.textContent = error.message || "Unable to approve dancer verification.";
      } finally {
        button.disabled = false;
      }
    }

    async function removeVenueDancerAffiliation(affiliationId) {
      if (!affiliationId) return;
      const status = document.getElementById("venueDancerVerificationStatus");
      status.textContent = "Removing dancer verification…";
      try {
        const data = await requestVenueAffiliationJson("/api/venue/dancer-verifications", {
          method: "DELETE",
          body: { affiliationId, reason: "Venue manager removed affiliation." }
        });
        await loadVenueDancerVerification();
        status.textContent = data.message || "Dancer verification removed.";
      } catch (error) {
        status.textContent = error.message || "Unable to remove dancer verification.";
      }
    }

    function renderVenueDashboard() {
      const profile = liveVenueDashboard?.profile;
      const analytics = liveVenueDashboard?.analytics || {};
      if (!profile) return;
      activeVenueName = profile.name;
      document.getElementById("venueDashName").textContent = profile.name;
      document.getElementById("venuePageViewCount").textContent = String(analytics.pageViews30Days || 0);
      document.getElementById("venueFollowerCount").textContent = String(analytics.totalFollowers || 0);
      document.getElementById("venueDirectionCount").textContent = String(analytics.directions30Days || 0);
      document.getElementById("venueShiftCount").textContent = String(analytics.activeDancersNow || 0);
      document.getElementById("venuePageViewsToday").textContent = String(analytics.pageViewsToday || 0);
      document.getElementById("venueDressingRoomNfcTaps").textContent = String(analytics.dressingRoomNfcTaps30Days || 0);
      document.getElementById("venueCashierNfcRedemptions").textContent = String(analytics.cashierNfcRedemptions30Days || 0);
      document.getElementById("venueGoingSignals").textContent = String(analytics.goingSignals30Days || 0);
      document.getElementById("venueProfileNameInput").value = profile.name || "";
      document.getElementById("venueProfileAddressInput").value = profile.address || "";
      document.getElementById("venueProfilePhoneInput").value = profile.phone || "";
      document.getElementById("venueProfileWebsiteInput").value = profile.website || "";
      document.getElementById("venueQrLabelInput").value = profile.qrCodeLabel || "";
      const qrPreview = document.getElementById("venueQrPreview");
      const qrImage = document.getElementById("venueQrImage");
      const qrPlaceholder = document.getElementById("venueQrPlaceholder");
      const removeButton = document.getElementById("venueQrRemoveBtn");
      qrPreview.hidden = false;
      qrImage.hidden = !profile.qrCodeUrl;
      qrPlaceholder.hidden = Boolean(profile.qrCodeUrl);
      removeButton.hidden = !profile.qrCodeUrl;
      if (profile.qrCodeUrl) qrImage.src = profile.qrCodeUrl;
      else qrImage.removeAttribute("src");
      const working = Array.isArray(liveVenueDashboard.workingNow) ? liveVenueDashboard.workingNow : [];
      document.getElementById("venueWorkingNowList").innerHTML = working.length
        ? working.map((dancer) => `
            <button class="lock-row venue-admin-tool" type="button" data-venue-dashboard-dancer-profile="${escapeOptionValue(dancer.dancerSlug || dancer.stageName || "")}" data-venue-dashboard-dancer-city="${escapeOptionValue(profile.city || citySelect.value)}">
              <strong>${escapeHtml(dancer.stageName || "Dancer")}</strong>
              <span>${escapeHtml(String(dancer.locationStatus || "").replaceAll("_", " "))}</span>
            </button>
          `).join("")
        : '<div class="rule-note">No verified dancer check-ins right now.</div>';
      renderVenueDancerAffiliations(liveVenueDashboard);
      document.getElementById("venueDashboardStatus").textContent = "Live venue data loaded.";
    }

    async function loadLiveVenueDashboard() {
      const status = document.getElementById("venueDashboardStatus");
      if (status) status.textContent = "Loading live venue data…";
      try {
        liveVenueDashboard = await getAuthenticatedJson("/api/venue/dashboard");
        renderVenueDashboard();
        return liveVenueDashboard;
      } catch (error) {
        if (status) status.textContent = error.message || "Unable to load venue dashboard.";
        throw error;
      }
    }

    async function loadAndRevealVenueDashboard() {
      if (!isVenueSession()) {
        throw new Error("A verified venue session is required. Sign in and try again.");
      }
      const dashboard = await loadLiveVenueDashboard();
      if (!dashboard?.profile && !dashboard?.claim) {
        throw new Error("No venue is connected to this account.");
      }
      isCustomerLoggedIn = false;
      isDancerLoggedIn = false;
      isVenueLoggedIn = true;
      activeDashboardType = "venue";
      activeVenueName = dashboard?.profile?.name || authSession?.account?.displayName || activeVenueName;
      venueDashboard.classList.add("show");
      venueDashboard.setAttribute("aria-hidden", "false");
      syncOverlayScrollLock();
      loadLiveNotifications();
      await processPendingVenueDancerVerification();
      return dashboard;
    }

    async function openVenueDashboard() {
      if (!isVenueSession()) {
        isVenueLoggedIn = false;
        openAuthRole("venue");
        return false;
      }
      window.location.href = "/dashboard/venue";
      return true;
    }

    function closeVenueDashboard() {
      venueDashboard.classList.remove("show");
      venueDashboard.setAttribute("aria-hidden", "true");
      syncOverlayScrollLock();
    }