

    document.getElementById("authForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const submit = document.getElementById("authSubmit");
      const previousText = submit.textContent;
      let confirmationSent = false;
      submit.disabled = true;
      submit.setAttribute("aria-busy", "true");
      submit.textContent = authMode === "signup" ? "Creating account…" : "Signing in…";
      setCustomerAuthStatus(authMode === "signup" ? "Creating your private guest account…" : "Signing in securely…");
      try {
        if (authMode === "signup") {
          const password = document.getElementById("customerPassword").value;
          const confirmPassword = document.getElementById("customerConfirmPassword").value;
          if (password !== confirmPassword) {
            throw new Error("Passwords do not match.");
          }
        }
        const payload = {
          mode: authMode,
          role: "customer",
          email: document.getElementById("customerEmail").value,
          password: document.getElementById("customerPassword").value,
          city: citySelect.value
        };
        if (authMode === "signup") payload.emailRedirectTo = saveAuthResume("customer", "/dashboard/customer?confirmed=1");
        const result = await requestAuth(payload);
        if (authMode === "signup") {
          isCustomerLoggedIn = false;
          updateAccountHeader();
          confirmationSent = true;
          const confirmationMessage = "Confirmation email sent. Open the newest MyDancr email and tap the confirmation link. You’ll return signed in.";
          setCustomerAuthStatus(confirmationMessage);
          showToast(confirmationMessage);
          return;
        }
        if (!result.session?.accessToken) throw new Error("Sign in did not start a session. Confirm your email, then try again.");
        const signedInRole = result.account?.role;
        restoreLoggedInSessionState();
        if (["customer", "dancer", "venue"].includes(signedInRole) && pendingAccountAuthReturnTo) {
          const destination = accountLoginDestination(signedInRole, pendingAccountAuthReturnTo);
          pendingAccountAuthReturnTo = "";
          window.location.assign(destination);
          return;
        }
        if (signedInRole === "dancer") {
          setCustomerAuthStatus("Signed in. Opening your dancer dashboard…");
          await startRealDancerSession("Dancer dashboard opened", payload.email);
          return;
        }
        if (signedInRole === "venue") {
          setCustomerAuthStatus("Signed in. Opening your venue dashboard…");
          await startVenueDashboardSession("Venue dashboard opened");
          return;
        }
        if (signedInRole !== "customer") {
          throw new Error("This account cannot use the public sign-in. Contact support for help.");
        }
        resetAccountControl("customer");
        prepareRealCustomerDashboardState();
        isCustomerLoggedIn = true;
        isDancerLoggedIn = false;
        isVenueLoggedIn = false;
        activeDashboardType = "customer";
        updateAccountHeader();
        maybeShowAccountTooltip("customer");
        closeAuthPage();
        showToast(authMode === "signup" ? "Guest account created" : "Logged in");
        openUnifiedDashboard("customer");
      } catch (error) {
        const message = friendlyAuthErrorMessage(error.message, authMode === "signup" ? "Guest signup failed" : "Sign in failed");
        setCustomerAuthStatus(message);
        showToast(message);
      } finally {
        submit.removeAttribute("aria-busy");
        if (confirmationSent) {
          startConfirmationResendCooldown(submit);
        } else {
          submit.disabled = false;
          submit.textContent = previousText;
        }
      }
    });

    async function startRealDancerSession(message = "Dancer dashboard opened. Start with profile setup.", signedInEmail = "") {
      resetAccountControl("dancer");
      freshDancerVerificationLockedToProfile = false;
      dancerSignupStarted = true;
      stripeConfirmed = true;
      const loginEmail = String(signedInEmail || authSession?.email || "").trim();
      if (loginEmail) document.getElementById("dancerEmail").value = loginEmail;
      setupChecklistExpanded = true;
      activeSetupStep = "profile";
      isCustomerLoggedIn = false;
      isDancerLoggedIn = true;
      isVenueLoggedIn = false;
      activeDashboardType = "dancer";
      closeAuthPage();
      updateAccountHeader();
      showToast(message);
      await hydrateDancerApprovalProgress();
      openUnifiedDashboard("dancer");
    }

    async function startVenueDashboardSession(message = "Venue dashboard opened") {
      if (!isVenueSession()) {
        throw new Error("A verified venue session is required. Sign in and try again.");
      }
      restoreLoggedInSessionState();
      const destination = accountLoginDestination("venue", pendingVenueAuthReturnTo);
      pendingVenueAuthReturnTo = "";
      closeAuthPage();
      updateAccountHeader();
      if (destination !== "/dashboard/venue") {
        window.location.href = destination;
        return true;
      }
      const opened = openUnifiedDashboard("venue");
      if (opened) showToast(message);
      return opened;
    }

    document.getElementById("dancerVenueVerificationCreate").addEventListener("click", () => createDancerVenueVerification());
    document.getElementById("dancerVenueVerificationShare").addEventListener("click", shareDancerVenueVerification);
    document.getElementById("dancerVenueVerificationVenue").addEventListener("change", () => {
      stopDancerVenueVerificationLifecycle();
      activeDancerVenueVerification = null;
      document.getElementById("dancerVenueVerificationQr").hidden = true;
      updateDancerVenueVerificationSelectionStatus();
    });
    document.getElementById("venueDancerVerificationApprove").addEventListener("click", approveVenueDancerVerification);

    async function submitVenueSignup(button = document.getElementById("venueJoinNowBtn")) {
      const venueCodeInput = document.getElementById("venueSignupCode");
      const emailInput = document.getElementById("venueLoginEmail");
      const passwordInput = document.getElementById("venueLoginPassword");
      const submittedCode = formatVenueAccessCode(venueCodeInput.value);
      if (!verifiedVenueSignupCode || submittedCode !== verifiedVenueSignupCode || !verifiedVenueSignupPreview) {
        const verified = await verifyVenueAccessCode();
        if (!verified) venueCodeInput.focus();
        return false;
      }
      if (!emailInput.reportValidity() || !passwordInput.reportValidity()) return false;
      button.disabled = true;
      setVenueAuthStatus(`Creating the manager account for ${verifiedVenueSignupPreview.name}…`);
      try {
        const result = await requestAuth({
          mode: "signup",
          role: "venue",
          venueCode: verifiedVenueSignupCode,
          email: document.getElementById("venueLoginEmail").value,
          password: document.getElementById("venueLoginPassword").value
        });
        if (result.requiresEmailConfirmation) {
          setVenueAuthStatus("Venue account created. Check your email and tap the confirmation link, then sign in here.");
          showToast("Confirmation email sent. Open it on this device to return here.");
          return true;
        }
        if (!result.session?.accessToken || result.account?.role !== "venue" || !result.venue?.id) {
          throw new Error("Venue account authorization could not be verified. Sign in and try again.");
        }
        setVenueAuthStatus("Venue account verified. Opening your live dashboard…");
        await startVenueDashboardSession("Venue account created");
        return true;
      } catch (error) {
        setVenueAuthStatus(error.message || "Venue signup failed");
        showToast(error.message || "Venue signup failed");
        return false;
      } finally {
        button.disabled = false;
      }
    }

    document.getElementById("venueCodeVerifyBtn").addEventListener("click", () => {
      void verifyVenueAccessCode();
    });

    document.getElementById("venueSignupCode").addEventListener("input", (event) => {
      const input = event.currentTarget;
      const previousCode = input.value;
      const formattedCode = formatVenueAccessCode(previousCode);
      if (formattedCode !== previousCode) input.value = formattedCode;
      if (verifiedVenueSignupCode && formattedCode !== verifiedVenueSignupCode) {
        invalidateVenueAccessPreview();
      }
    });

    document.getElementById("venueLoginForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      await submitVenueSignup(document.getElementById("venueJoinNowBtn"));
    });

    function formatBusinessPhoneNumber(value) {
      // Keep international numbers and extensions intact.
      if (/[^\d\s()+.-]/.test(value) || (value.trim().startsWith("+") && !value.trim().startsWith("+1"))) return value;
      const digits = value.replace(/\D/g, "");
      const hasCountryCode = value.trim().startsWith("+1") || (digits.length === 11 && digits.startsWith("1"));
      const national = hasCountryCode ? digits.slice(1) : digits;
      if (national.length > 10) return value;
      const groups = [national.slice(0, 3), national.slice(3, 6), national.slice(6)].filter(Boolean);
      const prefix = hasCountryCode ? (value.trim().startsWith("+") ? "+1" : "1") : "";
      return [prefix, ...groups].filter(Boolean).join("-");
    }

    function formatBusinessPhoneInput(event) {
      if (event.isComposing) return;
      const input = event.currentTarget;
      const previous = input.value;
      const formatted = formatBusinessPhoneNumber(previous);
      if (formatted === previous) return;
      const start = input.selectionStart;
      const end = input.selectionEnd;
      const direction = input.selectionDirection || "none";
      function positionAfterDigits(position) {
        const count = previous.slice(0, position).replace(/\D/g, "").length;
        if (!count) return Math.min(position, formatted.startsWith("+") ? 1 : 0);
        let seen = 0;
        for (let index = 0; index < formatted.length; index += 1) {
          if (/\d/.test(formatted[index]) && ++seen === count) return index + 1;
        }
        return formatted.length;
      }
      input.value = formatted;
      if (start !== null && end !== null) input.setSelectionRange(positionAfterDigits(start), positionAfterDigits(end), direction);
    }

    document.getElementById("venueRequestContactPhone").addEventListener("input", formatBusinessPhoneInput);
    document.getElementById("venueRequestContactPhone").addEventListener("change", formatBusinessPhoneInput);

    ["venueRequestPassword", "venueRequestConfirmPassword"].forEach((id) => {
      document.getElementById(id).addEventListener("input", () => {
        document.getElementById("venueRequestPassword").setCustomValidity("");
        document.getElementById("venueRequestConfirmPassword").setCustomValidity("");
      });
    });

    document.getElementById("venueRequestForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const password = document.getElementById("venueRequestPassword");
      const confirmation = document.getElementById("venueRequestConfirmPassword");
      password.setCustomValidity(passwordValidationMessage(password.value));
      confirmation.setCustomValidity(password.value === confirmation.value ? "" : "The passwords do not match.");
      if (!form.reportValidity()) return;

      const submit = document.getElementById("venueRequestSubmit");
      const defaultLabel = "Send club request";
      submit.disabled = true;
      submit.classList.remove("is-submitted");
      submit.setAttribute("aria-busy", "true");
      submit.textContent = "Sending request…";
      setVenueRequestStatus("");

      try {
        const response = await fetch("/api/venue/signup-requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            loginEmail: document.getElementById("venueRequestLoginEmail").value.trim(),
            password: password.value,
            confirmPassword: confirmation.value,
            venueName: document.getElementById("venueRequestName").value.trim(),
            streetAddress: document.getElementById("venueRequestAddress").value.trim(),
            city: document.getElementById("venueRequestCity").value.trim(),
            state: document.getElementById("venueRequestState").value.trim(),
            postalCode: document.getElementById("venueRequestPostalCode").value.trim(),
            website: document.getElementById("venueRequestWebsite").value.trim(),
            contactName: document.getElementById("venueRequestContactName").value.trim(),
            contactTitle: document.getElementById("venueRequestContactTitle").value.trim(),
            contactPhone: document.getElementById("venueRequestContactPhone").value.trim(),
            message: document.getElementById("venueRequestMessage").value.trim(),
            companyFax: document.getElementById("venueRequestCompanyFax").value,
            authorizedToRepresentVenue: document.getElementById("venueRequestAuthorization").checked,
            agentReferralCode: pendingVenueAgentReferralCode || null
          })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || payload?.message || "Unable to submit the club request.");
        }

        try {
          sessionStorage.setItem("dancrVenueConfirmationEmail", document.getElementById("venueRequestLoginEmail").value.trim());
        } catch {}
        form.reset();
        pendingVenueAgentReferralCode = "";
        authPage.classList.add("venue-request-succeeded");
        submit.classList.add("is-submitted");
        submit.textContent = "✓ Request received";
        setVenueRequestStatus(
          "Your details are saved. Confirm your email to send your club request for approval."
        );
        showToast("Club request received");
        window.location.assign(payload.emailDelivered === false ? "/venue/confirm-email?delivery=failed" : "/venue/confirm-email");
      } catch (error) {
        submit.disabled = false;
        submit.textContent = defaultLabel;
        const message = error?.message || "Unable to submit the club request.";
        setVenueRequestStatus(message);
        showToast(message);
      } finally {
        submit.removeAttribute("aria-busy");
      }
    });

    document.getElementById("openDancerSignup").addEventListener("click", () => {
      closeAuthPage();
      openDancerSignupPage();
    });

    document.getElementById("dancerSignupForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const agreement = document.getElementById("dancerAgreementAccepted");
      if (!agreement?.checked) {
        setDancerSignupStatus("Read and accept the Dancer Agreement before creating your account.");
        agreement?.focus();
        return;
      }
      const submit = event.submitter || event.currentTarget.querySelector('button[type="submit"]');
      const originalText = submit.textContent;
      let confirmationSent = false;
      submit.disabled = true;
      submit.setAttribute("aria-busy", "true");
      submit.textContent = "Creating account…";
      setDancerSignupStatus("");
      try {
        const email = document.getElementById("dancerEmail").value.trim();
        const result = await requestAuth({
          mode: "signup",
          role: "dancer",
          email,
          agreementAccepted: agreement.checked === true,
          agreementVersion: agreement.dataset.agreementVersion,
          password: document.getElementById("dancerPassword").value,
          emailRedirectTo: saveAuthResume("dancer")
        });
        if (result.requiresEmailConfirmation) {
          confirmationSent = true;
          setDancerSignupStatus(`Confirmation email sent${email ? ` to ${email}` : ""}. Open the newest MyDancr email and tap Confirm email. Then finish your profile and dressing-room tap step.`);
          showToast("Confirmation email sent. Open the newest email to continue.");
          return;
        }
        dancerSignupStarted = true;
        stripeConfirmed = true;
        Object.assign(dancerSetup, {
          profile: false,
          photos: false,
          review: false,
          approval: false,
          shift: false
        });
        setupChecklistExpanded = true;
        activeSetupStep = "profile";
        activeDashboardType = "dancer";
        showToast("Dancer account created");
        if (result.session) {
          isCustomerLoggedIn = false;
          isDancerLoggedIn = true;
          isVenueLoggedIn = false;
          updateAccountHeader();
          maybeShowAccountTooltip("dancer");
          closeDancerSignupPage();
          openUnifiedDashboard("dancer", "dancer-profile-media");
        }
      } catch (error) {
        const message = error.message || "Dancer signup failed";
        setDancerSignupStatus(message);
        showToast(message);
      } finally {
        submit.removeAttribute("aria-busy");
        if (confirmationSent) {
          startConfirmationResendCooldown(submit);
        } else {
          submit.disabled = false;
          submit.textContent = originalText;
        }
      }
    });

    async function startLiveStripeCheckout(button) {
      stripeConfirmed = true;
      isCustomerLoggedIn = false;
      isDancerLoggedIn = true;
      isVenueLoggedIn = false;
      activeDashboardType = "dancer";
      updateAccountHeader();
      closeStripeCheckoutPage();
      showToast("Free dancer access enabled");
      openDancerDashboard();
    }

    document.getElementById("stripeConfirmBtn").addEventListener("click", (event) => {
      startLiveStripeCheckout(event.currentTarget);
    });

    document.getElementById("billingPortalBtn").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      if (!isDancerSession()) {
        showToast("Opening Stripe billing portal");
        window.open("https://billing.stripe.com/", "_blank", "noreferrer");
        return;
      }
      const subscription = liveDancerBilling?.subscription;
      const endpoint = subscription?.hasStripeSubscription ? "/api/dancer/billing/portal" : "/api/dancer/billing/checkout";
      button.disabled = true;
      try {
        const data = await postAuthenticatedJson(endpoint, {});
        const url = data?.portalUrl || data?.checkoutUrl;
        if (!url) throw new Error("Stripe URL missing.");
        window.location.href = url;
      } catch (error) {
        showToast(error.message || "Could not open Stripe billing");
      } finally {
        button.disabled = false;
      }
    });

    dashTonightViewAll.addEventListener("click", () => {
      dashboardTonightExpanded = true;
      renderDashboard();
    });

    dashFollowedViewAll.addEventListener("click", () => {
      dashboardFollowedExpanded = true;
      renderDashboard();
    });

    dashVenueViewAll.addEventListener("click", () => {
      dashboardVenuesExpanded = true;
      renderDashboard();
    });

    customerDashboard.addEventListener("click", (event) => {
      if (handleNotificationCenterClick(event)) return;
      if (handleSupportActionClick(event)) return;
      if (handleAccountControlClick(event)) return;
      const statButton = event.target.closest("[data-dashboard-jump]");
      if (!statButton) return;
      const section = customerDashboard.querySelector(`[data-dashboard-section="${statButton.dataset.dashboardJump}"]`);
      if (!section) return;
      section.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    customerBrowseTonight.addEventListener("click", () => {
      closeDashboard();
      activeTab = "tonight";
      tonightExpanded = false;
      selectedVenueName = null;
      document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item.dataset.tab === "tonight"));
      render();
      tabTitle?.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    customerBrowseDancers.addEventListener("click", () => {
      closeDashboard();
      activeTab = "dancers";
      dancersExpanded = false;
      selectedVenueName = null;
      document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item.dataset.tab === "dancers"));
      render();
      tabTitle?.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    customerDashboard.addEventListener("click", (event) => {
      if (handleNotificationCenterClick(event)) return;
      if (handleSupportActionClick(event)) return;
      const cardVenueLink = event.target.closest("[data-card-venue]");
      if (cardVenueLink) {
        event.preventDefault();
        event.stopPropagation();
        openVenueFromName(cardVenueLink.dataset.cardVenue, {
          returnTo: "customer-dashboard",
          showFocusRing: event.detail === 0
        });
        return;
      }
      const card = event.target.closest(".dancer-card");
      if (!card) return;
      event.preventDefault();
      openProfileModal(card.dataset.profileReference || card.dataset.profile);
    });

    async function handleDancerControlAction(action, trigger = null) {
      const city = activeDancerCity();
      const profileName = activeDancerName();
      const result = document.getElementById("dancerControlResult");
      const setResult = (message) => {
        if (result) result.textContent = message;
        showToast(message);
      };

      if (action === "collapse-approved-tool") {
        activeApprovedToolDropdown = "";
        renderApprovedToolDropdowns();
        setResult("Approved dancer tools collapsed.");
        return;
      }

      if (action === "edit-profile") {
        const panel = document.getElementById("approvedDancerPanel");
        panel?.removeAttribute("hidden");
        if (panel) panel.open = true;
        const willOpen = activeApprovedToolDropdown !== "edit";
        setApprovedToolDropdown("edit");
        if (willOpen) void loadApprovedProfileVideos({ force: true });
        setResult(willOpen ? "Edit profile tools opened." : "Edit profile tools collapsed.");
        return;
      }

      if (action === "post-schedule") {
        openApprovedScheduleEditor();
        setResult("Schedule posting form opened.");
        return;
      }

      if (action === "dashboard-primary") {
        if (trigger?.dataset.dashboardShiftAction === "nfc-ready") {
          openApprovedScheduleEditor();
          await handleShiftVerificationAction("nfc-ready", trigger);
          renderDancerSetup();
          return;
        }
        openApprovedScheduleEditor();
        setResult("Schedule posting form opened.");
        return;
      }

      if (action === "toggle-incognito") {
        const profile = activeDancerProfile(city);
        if (!profile) {
          setResult("Profile not found.");
          return;
        }
        if (!isDancerSession() || !authSession?.accessToken) {
          setResult("Sign in to your dancer account to change profile visibility.");
          openAuthRole("dancer");
          return;
        }
        const nextPublic = dancerProfileIsHidden(profile);
        if (!nextPublic && !window.confirm("Go incognito? Your profile and schedule will disappear as pages refresh. Previously loaded content and shared media may remain visible.")) {
          return;
        }
        if (trigger) {
          trigger.disabled = true;
          trigger.setAttribute("aria-busy", "true");
        }
        setResult(nextPublic ? "Reactivating your public profile..." : "Hiding your profile from public pages...");
        try {
          const data = await patchAuthenticatedJson("/api/dancer/profile/visibility", { isPublic: nextPublic });
          if (!data) throw new Error("Sign in required");
          const savedProfile = data.profile || null;
          const savedPublic = savedProfile?.is_public === true || savedProfile?.isPublic === true;
          if (savedPublic !== nextPublic) {
            throw new Error("Profile visibility did not save. Try again.");
          }
          if (data.visibility?.verified !== true || data.visibility?.publicProfileVisible !== nextPublic) {
            throw new Error("Public profile visibility could not be verified. Try again.");
          }
          const updatedProfile = activeDancerProfile(city) || profile;
          setDancerProfilePublic(updatedProfile, savedPublic);
          liveMarketState[city] = null;
          syncDancerIncognitoToggle(updatedProfile, true);
          renderDancerSetup();
          render();
          if (customerDashboard.classList.contains("show")) renderDashboard();
          setResult(savedPublic
            ? "Your profile is back on and visible to guests."
            : "Incognito is on. Your profile and schedule will disappear as pages refresh. Previously loaded content and shared media may remain visible.");
          showToast(savedPublic ? "Profile is back on" : "Profile hidden · Incognito on");
        } catch (error) {
          setResult(error.message || "Could not update profile visibility.");
          showToast(error.message || "Could not update profile visibility.");
        } finally {
          if (trigger) {
            trigger.disabled = false;
            trigger.removeAttribute("aria-busy");
          }
        }
        return;
      }

      if (action === "preview-profile") {
        openDancerProfilePreview();
        setResult("Profile preview opened.");
        return;
      }

      if (action === "share-profile") {
        runShareAction(profileName, city);
        setResult("Share options opened for your public profile.");
        return;
      }

      if (action === "show-qr") {
        openQrOverlay(profileName, city, null);
        setResult("QR code opened. Guests can scan it without an account.");
        return;
      }

      if (action === "save-profile") {
        releaseEditProfileMobileFocus(trigger);
        const saved = await saveApprovedDancerProfile({ trigger });
        if (!saved?.saved) return;
        setResult(saved.needsApproval
          ? "Profile saved. Changed social links were sent to admin for approval."
          : "Profile saved.");
        updateAccountHeader();
        return;
      }

      if (action === "main-photo") {
        pendingApprovedPhotoTarget = "main";
        openApprovedPhotoUploadPicker("Choose a main photo. Approved photos go live automatically.");
        return;
      }

      if (action === "gallery-photo") {
        pendingApprovedPhotoTarget = "gallery-add";
        openApprovedPhotoUploadPicker("Choose a gallery photo. Approved photos go live automatically.");
        return;
      }

      if (action === "replace-photo") {
        pendingApprovedPhotoTarget = trigger?.dataset.photoTarget || "gallery";
        openApprovedPhotoUploadPicker("Choose a replacement picture. Approved photos go live automatically.");
        return;
      }
    }

    dancerDashboard.addEventListener("change", async (event) => {
      if (event.target?.id === "setupProfilePhotos") {
        const input = event.target;
        const files = Array.from(input.files || []);
        if (!files.length) return;
        try {
          if (files.length > MAX_DANCER_PROFILE_PHOTOS) {
            throw new Error(`Choose up to ${MAX_DANCER_PROFILE_PHOTOS} photos for review.`);
          }
          assertDancerProfilePhotoLimit(activeDancerProfile(), { adding: files.length });
        } catch (error) {
          const message = error?.message || "Those photos could not be selected.";
          input.value = "";
          const result = document.getElementById("photoUploadResult");
          if (result) result.textContent = message;
          showToast(message);
          return;
        }
        rememberSetupPhotoFiles(files);
        activeSetupStep = "profile";
        setupChecklistExpanded = true;
        renderDancerSetup();
        const message = `${files.length} picture${files.length === 1 ? "" : "s"} selected. Tap Upload pictures to run the same safety check used in Edit Profile.`;
        const result = document.getElementById("photoUploadResult");
        if (result) {
          result.textContent = message;
          result.classList.add("is-review");
        }
        showToast(`${files.length} picture${files.length === 1 ? "" : "s"} ready to upload`);
        return;
      }
      if (event.target?.id === "approvedProfileVideoInput") {
        const input = event.target;
        const preview = document.getElementById("approvedProfileVideoPreview");
        const file = input.files?.[0];
        if (preview && file) {
          const objectUrl = rememberPendingApprovedProfileVideo(file);
          preview.src = objectUrl;
          preview.hidden = false;
        } else if (preview) {
          clearPendingApprovedProfileVideoSelection();
          preview.removeAttribute("src");
          preview.hidden = true;
        }
        const status = document.getElementById("approvedProfileVideoStatus");
        if (status) status.textContent = file ? "Confirm both permissions, then upload." : "Choose a video file.";
        return;
      }
      if (event.target?.id === "approvedProfileVideoConsent") {
        pendingApprovedProfileVideoConsent = event.target.checked === true;
        return;
      }
      if (event.target?.id === "approvedProfileVideoRights") {
        pendingApprovedProfileVideoRights = event.target.checked === true;
        return;
      }
      if (event.target?.id === "approvedAvatarUploadInput") {
        const input = event.target;
        const file = input.files?.[0];
        if (!file) return;
        keepAvatarOriginSetupStepOpen();
        const progressTimer = startApprovedAvatarModerationProgress(file.name || "avatar");
        showToast("Checking your avatar...");
        input.disabled = true;
        try {
          const uploadResult = await uploadApprovedDancerAvatar(file);
          const decision = normalizedReviewStatus(uploadResult?.decision);
          if (decision === "approved") {
            await hydrateApprovedDancerAvatar(uploadResult);
            if (pendingAvatarObjectUrl) URL.revokeObjectURL(pendingAvatarObjectUrl);
            pendingAvatarObjectUrl = "";
          } else if (["review", "moderation_retry", "moderation_error"].includes(decision)) {
            if (pendingAvatarObjectUrl) URL.revokeObjectURL(pendingAvatarObjectUrl);
            pendingAvatarObjectUrl = URL.createObjectURL(file);
            const profile = activeDancerProfile() || ensureActiveDancerProfile("Verified");
            if (profile) {
              profile.pendingAvatarReview = {
                id: uploadResult?.moderationRecordId || uploadResult?.photo?.id || "",
                previewUrl: pendingAvatarObjectUrl,
                status: "pending"
              };
            }
          }
          keepAvatarOriginSetupStepOpen();
          renderDancerSetup();
          renderApprovedVisualProfileEditor();
          renderDancerManagement();
          if (decision === "approved") {
            setApprovedAvatarUploadStatus(uploadResult?.message || "Avatar is live across MyDancr.", "success");
            showToast("Avatar is live");
          } else if (["review", "moderation_retry", "moderation_error"].includes(decision)) {
            setApprovedAvatarUploadStatus(uploadResult?.message || "Avatar awaiting review. Your current live avatar stays visible.", "pending");
            showToast("Avatar awaiting review");
          } else if (decision === "rejected") {
            setApprovedAvatarUploadStatus(uploadResult?.message || "This avatar was not approved. Choose a different image.", "error");
            showToast(uploadResult?.message || "Avatar not approved");
          } else {
            throw new Error("Dancr could not confirm the avatar upload status. Please try again.");
          }
        } catch (error) {
          keepAvatarOriginSetupStepOpen();
          renderDancerSetup();
          const message = normalizeRequestError(error, "Could not upload avatar");
          setApprovedAvatarUploadStatus(message, "error");
          showToast(message);
        } finally {
          window.clearInterval(progressTimer);
          input.value = "";
          input.disabled = false;
          pendingAvatarSetupStep = "";
        }
        return;
      }
      if (event.target?.id !== "approvedPhotoUploadInput") return;
      const input = event.target;
      const file = input.files?.[0];
      if (!file) return;
      let progressTimer = 0;
      setApprovedPhotoUploadStatus("Frame your photo, then choose Use photo to upload.");
      input.disabled = true;
      try {
        const cropped = await cropApprovedProfilePhoto(file);
        progressTimer = startApprovedPhotoModerationProgress(cropped.name || "photo");
        let uploadResult = await uploadApprovedDancerPhoto(cropped, pendingApprovedPhotoTarget);
        const decision = normalizedReviewStatus(uploadResult?.decision);
        if (decision === "approved") {
          uploadResult = await hydrateConfirmedApprovedDancerPhoto(uploadResult);
        }
        activeApprovedVisualPhotoTarget = uploadResult?.photoTarget || pendingApprovedPhotoTarget;
        renderDancerManagement();
        renderApprovedVisualProfileEditor();
        syncApprovedProfileSubmitState();
        if (["review", "moderation_retry", "moderation_error"].includes(decision)) {
          const message = uploadResult.message || "Your photo was uploaded and is awaiting a quick review. It will not appear publicly until approved.";
          setApprovedPhotoUploadStatus(message, "review");
          showToast("Photo awaiting review");
        } else if (decision === "approved") {
          const message = uploadResult?.message || "Photo uploaded successfully.";
          setApprovedPhotoUploadStatus(message, "success");
          showToast("Photo uploaded successfully");
        } else if (decision === "rejected") {
          const message = uploadResult?.message || "This photo was not approved. Please choose a different photo.";
          setApprovedPhotoUploadStatus(message, "error");
          showToast(message);
        } else {
          throw new Error("Dancr could not confirm the photo upload status. Please try again.");
        }
      } catch (error) {
        const message = normalizeRequestError(error, "Could not upload photo");
        setApprovedPhotoUploadStatus(message, "error");
        showToast(message);
      } finally {
        window.clearInterval(progressTimer);
        pendingApprovedPhotoAutoSubmit = false;
        input.value = "";
        input.disabled = false;
      }
    });
