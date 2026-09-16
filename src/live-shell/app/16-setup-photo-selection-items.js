

    function setupPhotoSelectionItems() {
      return pendingSetupPhotoFiles.map((file, index) => ({
        id: `selected-${index}-${file.name || "photo"}`,
        imageUrl: pendingSetupPhotoPreviewUrls[index] || "",
        category: "selected"
      }));
    }

    function dancerSetupPhotoPreviewMarkup() {
      const profile = activeDancerProfile() || null;
      const galleryUrls = Array.isArray(profile?.galleryPhotoUrls) ? profile.galleryPhotoUrls.filter(Boolean) : [];
      const mainUrl = profile?.mainPhotoUrl ? [profile.mainPhotoUrl] : [];
      const approvedItems = [...mainUrl, ...galleryUrls].map((imageUrl, index) => ({
        id: `approved-${index}`,
        imageUrl,
        category: "approved"
      }));
      const pendingItems = (profile?.submittedPhotos || [])
        .filter((photo) => dancerSetupPhotoModerationCategory(photo) === "review")
        .map((photo, index) => ({
          id: photo.id || `pending-${index}`,
          imageUrl: photo.imageUrl || photo.image_url || photo.url || "",
          category: "review"
        }));
      const seen = new Set();
      const items = [...approvedItems, ...pendingItems, ...setupPhotoSelectionItems()]
        .filter((photo) => {
          const key = photo.category === "review" ? `review:${photo.id}` : photo.imageUrl || photo.id;
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        });

      if (!items.length) {
        return '<div class="locked">No uploaded photos yet.</div>';
      }

      return `
        <div class="photo-upload-grid" aria-label="Uploaded profile photos">
          ${items.map((photo, index) => `
            <div class="upload-slot submitted-photo-slot ${photo.category === "review" ? "is-pending" : photo.category === "selected" ? "is-selected" : "is-approved"}">
              ${photo.imageUrl
                ? `<img src="${escapeHtml(photo.imageUrl)}" alt="Uploaded profile photo ${index + 1}" loading="lazy" decoding="async">`
                : '<div class="submitted-photo-placeholder" aria-label="Private pending photo preview">Pending review</div>'}
              <span>${photoDisplayLabel(index)}<small>${photo.category === "review" ? "Pending human review" : photo.category === "selected" ? "Ready to upload" : "Approved automatically"}</small></span>
            </div>
          `).join("")}
        </div>
      `;
    }

    function setupPhotoModerationResultMessage({ approvedCount, reviewCount, rejectedCount, failedCount, canContinue }) {
      const acceptedCount = approvedCount + reviewCount;
      if (!acceptedCount) {
        if (rejectedCount) {
          return canContinue
            ? `${rejectedCount} new photo${rejectedCount === 1 ? " was" : "s were"} fully rejected and did not occupy a slot. Your existing approved media still lets you continue to Step 2.`
            : `${rejectedCount} photo${rejectedCount === 1 ? " was" : "s were"} fully rejected. Step 2 stays locked. Upload a different photo that meets Dancr's photo guidelines.`;
        }
        return canContinue
          ? "The new upload could not be processed. Your existing approved media still lets you continue to Step 2."
          : "No photos were accepted. Step 2 stays locked. Please try the upload again.";
      }
      const outcomes = [];
      if (approvedCount) outcomes.push(`${approvedCount} approved automatically`);
      if (reviewCount) outcomes.push(`${reviewCount} pending human review`);
      if (rejectedCount) outcomes.push(`${rejectedCount} fully rejected`);
      if (failedCount) outcomes.push(`${failedCount} could not be processed`);
      if (!canContinue) {
        return `${outcomes.join(" · ")}. Step 2 stays locked until at least one profile photo is approved.`;
      }
      return reviewCount
        ? `${outcomes.join(" · ")}. Your required profile photo is approved, so you can continue to Step 2 while the additional review finishes.`
        : `${outcomes.join(" · ")}. The required profile-photo check passed. You can continue to Step 2.`;
    }

    async function submitSetupPhotos(form) {
      if (!canOpenStep("profile")) return;
      if (!isDancerSession()) {
        dancerSetup.photos = true;
        renderDancerSetup();
        showToast("Demo photos submitted");
        return;
      }
      const submit = form.querySelector('button[type="submit"]');
      const result = document.getElementById("photoUploadResult");
      const inputFiles = pendingSetupPhotoFiles.length
        ? [...pendingSetupPhotoFiles]
        : Array.from(document.getElementById("setupProfilePhotos")?.files || []);
      const photoFiles = [...inputFiles];
      if (!photoFiles.length) {
        showToast("Choose at least one photo");
        return;
      }
      if (inputFiles.length > MAX_DANCER_PROFILE_PHOTOS) {
        const message = `Choose up to ${MAX_DANCER_PROFILE_PHOTOS} photos for review.`;
        showToast(message);
        if (result) result.textContent = message;
        return;
      }
      try {
        assertDancerProfilePhotoLimit(activeDancerProfile(), { adding: inputFiles.length });
      } catch (error) {
        const message = error.message || `Choose up to ${MAX_DANCER_PROFILE_PHOTOS} photos`;
        showToast(message);
        if (result) result.textContent = message;
        return;
      }
      submit.disabled = true;
      let setupProgressIndex = 0;
      const setupProgressSteps = [
        `Uploading ${photoFiles.length} photo${photoFiles.length === 1 ? "" : "s"} securely...`,
        "Server is validating the real image file data...",
        "Auto moderator is checking the photo content...",
        "Saving approved photos or review records...",
        "Almost done. Finalizing photo status..."
      ];
      const setSetupPhotoStatus = (message, state = "") => {
        if (!result) return;
        result.textContent = message;
        result.classList.toggle("is-moderating", state === "moderating");
        result.classList.toggle("is-success", state === "success");
        result.classList.toggle("is-review", state === "review");
        result.classList.toggle("is-error", state === "error");
        result.setAttribute("aria-busy", state === "moderating" ? "true" : "false");
      };
      let setupProgressTimer = 0;
      try {
        const uploadAttempts = [];
        for (const file of photoFiles) {
          try {
            window.clearInterval(setupProgressTimer);
            setSetupPhotoStatus("Frame your photo, then choose Use photo to upload.");
            const cropped = await cropApprovedProfilePhoto(file);
            setupProgressIndex = 0;
            setSetupPhotoStatus(setupProgressSteps[setupProgressIndex], "moderating");
            setupProgressTimer = window.setInterval(() => {
              setupProgressIndex = Math.min(setupProgressIndex + 1, setupProgressSteps.length - 1);
              setSetupPhotoStatus(setupProgressSteps[setupProgressIndex], "moderating");
            }, 1400);
            const profile = activeDancerProfile() || ensureActiveDancerProfile("Pending");
            const upload = await uploadApprovedDancerPhoto(cropped, nextSetupPhotoUploadTarget(profile));
            uploadAttempts.push({ status: "fulfilled", value: upload });
          } catch (reason) {
            uploadAttempts.push({ status: "rejected", reason });
            if (reason?.name === "AbortError") {
              while (uploadAttempts.length < photoFiles.length) uploadAttempts.push({ status: "rejected", reason });
              break;
            }
          }
        }
        const uploaded = uploadAttempts
          .filter((attempt) => attempt.status === "fulfilled")
          .map((attempt) => attempt.value);
        const failedAttempts = uploadAttempts.filter((attempt) => attempt.status === "rejected");
        const profile = ensureActiveDancerProfile("Pending");
        const approvedUploads = uploaded.filter((item) => dancerSetupPhotoModerationCategory(item) === "approved");
        const reviewUploads = uploaded.filter((item) => dancerSetupPhotoModerationCategory(item) === "review");
        const rejectedUploads = uploaded.filter((item) => dancerSetupPhotoModerationCategory(item) === "rejected");
        const unresolvedUploads = uploaded.filter((item) => !dancerSetupPhotoModerationCategory(item));
        if (profile) {
          normalizeLocalDancerPhotos(profile);
          profile.photoStatus = reviewUploads.length ? "Pending" : approvedUploads.length ? "Approved" : profile.photoStatus;
        }
        const failedFiles = [];
        const failedPreviewUrls = [];
        uploadAttempts.forEach((attempt, index) => {
          const previewUrl = pendingSetupPhotoPreviewUrls[index] || "";
          if (attempt.status === "rejected") {
            failedFiles.push(photoFiles[index]);
            failedPreviewUrls.push(previewUrl);
          } else if (previewUrl) {
            URL.revokeObjectURL(previewUrl);
          }
        });
        pendingSetupPhotoFiles = failedFiles;
        pendingSetupPhotoPreviewUrls = failedPreviewUrls;
        dancerSetup.photos = dancerProfileMediaModerationComplete(profile)
          || approvedUploads.length > 0;
        activeSetupStep = "profile";
        setupChecklistExpanded = true;
        const message = setupPhotoModerationResultMessage({
          approvedCount: approvedUploads.length,
          reviewCount: reviewUploads.length,
          rejectedCount: rejectedUploads.length,
          failedCount: failedAttempts.length + unresolvedUploads.length,
          canContinue: dancerSetup.photos
        });
        const messageState = dancerSetup.photos
          ? (reviewUploads.length || rejectedUploads.length || failedAttempts.length || unresolvedUploads.length ? "review" : "success")
          : "error";
        setSetupPhotoStatus(message, messageState);
        showToast(message);
        renderDancerSetup();
        const refreshedResult = document.getElementById("photoUploadResult");
        if (refreshedResult) {
          refreshedResult.textContent = message;
          refreshedResult.classList.add(`is-${messageState}`);
          refreshedResult.setAttribute("aria-busy", "false");
        }
      } catch (error) {
        const message = normalizeRequestError(error, "Could not upload photos");
        setSetupPhotoStatus(message, "error");
        showToast(message);
      } finally {
        window.clearInterval(setupProgressTimer);
        submit.disabled = false;
      }
    }

    async function submitDancerProfileForReview(button) {
      const setupProfile = activeDancerProfile();
      const avatarSaved = Boolean(setupProfile?.avatarStoragePath || setupProfile?.avatar_storage_path);
      if (!dancerSetup.profile || !dancerSetup.photos || !avatarSaved) {
        activeSetupStep = "profile";
        profileSubmitNotice = "Complete your identity, approved avatar, and at least one approved profile picture before submitting. Other media can finish review separately.";
        profileSubmitNoticeTone = "error";
        renderDancerSetup();
        showToast("Complete the required profile items first");
        return;
      }
      const profile = ensureActiveDancerProfile("Pending");
      if (button) {
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
        button.textContent = "Submitting...";
      }
      try {
        if (isDancerSession()) {
          const data = await patchAuthenticatedJson("/api/dancer/profile", { submitForReview: true });
          if (!data) throw new Error("Sign in required");
          if (data.profile && normalizedReviewStatus(data.profile.status) !== "pending_review" && !dancerCoreApprovalUnlocked(data.profile)) {
            throw new Error("Dancr could not confirm the review submission. Please try again.");
          }
        }
        const wasApproved = dancerCoreApprovalUnlocked(profile) || dancerSetup.approval;
        if (profile) {
          profile.reviewSubmitted = true;
          profile.status = wasApproved ? "Verified" : "Pending";
          profile.approvalChangesPending = false;
          (profile.submittedPhotos || []).forEach((photo) => {
            if ((photo.reviewStatus || photo.review_status) === "rejected") {
              photo.reviewStatus = "pending";
              photo.review_status = "pending";
            }
          });
        }
        dancerSetup.review = true;
        liveDancerReviews = liveDancerReviews.map((review) => (
          review.status === "rejected"
            ? { ...review, status: "pending", notes: "Resubmitted by dancer.", reviewedAt: null }
            : review
        ));
        activeSetupStep = "approval";
        profileSubmitNotice = "Profile submitted. Tap the club's official dressing-room sticker to activate your profile.";
        profileSubmitNoticeTone = "success";
        renderDancerSetup();
        showToast("Profile saved. Continue with the official club tap.");
        if (isDancerSession()) window.dispatchEvent(new CustomEvent("mydancr:push-invitation", { detail: { moment: "dancer-review" } }));
        void loadDancerVenueVerification();
      } catch (error) {
        const message = error.message || "Could not submit for review";
        activeSetupStep = "profile";
        profileSubmitNotice = message;
        profileSubmitNoticeTone = "error";
        renderDancerSetup();
        showToast(message);
      } finally {
        if (button?.isConnected) {
          button.disabled = false;
          button.removeAttribute("aria-busy");
          button.textContent = "Submit profile";
        }
      }
    }

    async function submitApprovedProfileChangesForReview(button) {
      const changeState = approvedProfileChangeState();
      if (!changeState.needsApproval) {
        showToast(changeState.hasDeletesOnly ? "Deleted items only need Save profile" : "Change or upload something before submitting");
        syncApprovedProfileSubmitState();
        return;
      }
      if (button) button.disabled = true;
      const result = document.getElementById("profileEditResult");
      if (result) {
        result.hidden = false;
        result.textContent = "Saving changes before admin review...";
      }
      try {
        const wasCoreApproved = dancerCoreApprovalUnlocked(activeDancerProfile()) || dancerSetup.approval;
        const saved = await saveApprovedDancerProfile({ submitForReview: true });
        if (!saved?.saved || !saved.needsApproval) return;
        const profile = activeDancerProfile();
        const stillCoreApproved = wasCoreApproved || dancerCoreApprovalUnlocked(profile);
        if (stillCoreApproved && profile) {
          Object.assign(profile, {
            status: "Verified",
            reviewSubmitted: false,
            approvalChangesPending: true,
            approvalChangesSubmitted: true
          });
          dancerSetup.approval = true;
          markDancerProfileSetupSaved(true);
          renderAdminDashboard();
          renderDancerSetup();
          render();
          if (customerDashboard.classList.contains("show")) renderDashboard();
          syncApprovedProfileSubmitState();
          if (result) result.textContent = "Submitted to admin. Your profile stays approved and live while only changed photos/social links are reviewed.";
          showToast("Changes submitted. Your profile stays live.");
          return;
        }
        await submitDancerProfileForReview(null);
        if (profile) {
          profile.approvalChangesPending = false;
          profile.approvalChangesSubmitted = false;
        }
        syncApprovedProfileSubmitState();
        if (result) result.textContent = "Submitted to admin. Only changed or replaced photos/social links will appear for review.";
      } finally {
        if (button) button.disabled = false;
      }
    }

    function openApprovedPhotoUploadPicker(message) {
      const input = document.getElementById("approvedPhotoUploadInput");
      const result = document.getElementById("dancerControlResult");
      const visualStatus = document.getElementById("approvedPhotoUploadStatus");
      if (result) result.textContent = message;
      if (visualStatus) {
        visualStatus.textContent = message;
        visualStatus.classList.remove("is-moderating", "is-success", "is-review", "is-error");
        visualStatus.setAttribute("aria-busy", "false");
      }
      showToast(message);
      if (!input) {
        const missingMessage = "Photo uploader is still loading. Close Edit Profile, open it again, and try once more.";
        if (result) result.textContent = missingMessage;
        if (visualStatus) {
          visualStatus.textContent = missingMessage;
          visualStatus.classList.add("is-error");
        }
        showToast(missingMessage);
        return;
      }
      input.value = "";
      input.click();
    }

    function keepAvatarOriginSetupStepOpen() {
      if (pendingAvatarSetupStep !== "profile") return;
      setupChecklistExpanded = true;
      activeSetupStep = "profile";
    }

    function openApprovedAvatarUploadPicker(options = {}) {
      const input = document.getElementById("approvedAvatarUploadInput");
      const message = "Choose a clear face photo for your avatar.";
      pendingAvatarSetupStep = options.preserveSetupStep === true ? "profile" : "";
      if (pendingAvatarSetupStep === "profile") captureDancerSetupProfileDraft();
      keepAvatarOriginSetupStepOpen();
      setApprovedAvatarUploadStatus(message);
      showToast(message);
      if (!input) {
        setApprovedAvatarUploadStatus("Avatar uploader is still loading. Close Edit Profile, open it again, and try once more.", "error");
        return;
      }
      input.value = "";
      window.addEventListener("focus", () => {
        window.setTimeout(() => {
          if (!input.files?.length) pendingAvatarSetupStep = "";
        }, 0);
      }, { once: true });
      input.click();
    }

    function setApprovedAvatarUploadStatus(message, state = "") {
      ["approvedAvatarUploadStatus", "setupAvatarUploadStatus", "dancerDashboardAvatarStatus"].forEach((statusId) => {
        const status = document.getElementById(statusId);
        if (!status) return;
        status.textContent = message;
        status.classList.toggle("is-live", state === "success");
        status.classList.toggle("is-pending", state === "pending" || state === "moderating");
        status.classList.toggle("is-error", state === "error");
        status.setAttribute("aria-busy", state === "moderating" ? "true" : "false");
      });
      document.querySelectorAll("[data-approved-avatar-upload]").forEach((button) => {
        button.disabled = state === "moderating";
        button.setAttribute("aria-busy", state === "moderating" ? "true" : "false");
      });
      const result = document.getElementById("dancerControlResult");
      if (result) result.textContent = message;
    }

    function startApprovedAvatarModerationProgress(fileName) {
      const steps = [
        `Uploading ${fileName} securely...`,
        "Checking the avatar image...",
        "Finding the best face-aware crop...",
        "Saving the avatar status..."
      ];
      let index = 0;
      setApprovedAvatarUploadStatus(steps[index], "moderating");
      return window.setInterval(() => {
        index = Math.min(index + 1, steps.length - 1);
        setApprovedAvatarUploadStatus(steps[index], "moderating");
      }, 1400);
    }

    async function uploadApprovedDancerAvatar(file) {
      if (!isDancerSession()) throw new Error("Sign in as a dancer to upload an avatar.");
      const formData = new FormData();
      formData.append("file", file);
      formData.append("idempotencyKey", `${file.name}:${file.size}:${file.lastModified}:avatar:${Date.now()}:${Math.random().toString(36).slice(2)}`);
      const headers = authenticatedRequestHeaders();
      if (!headers) throw new Error("Sign in required");
      const response = await fetch("/api/dancer/avatar", {
        method: "POST",
        headers,
        body: formData
      });
      const data = await response.json().catch(() => ({}));
      const decision = normalizedReviewStatus(data?.decision);
      if (decision === "rejected") return data;
      if (!response.ok || data.ok === false) {
        throw new Error(normalizeRequestError(data.message || data.error, "Avatar upload failed"));
      }
      applyResponseSession(data, headers);
      return data;
    }

    async function hydrateApprovedDancerAvatar(uploadResult) {
      const data = await getAuthenticatedJson("/api/dancer/profile");
      if (!data?.profile) throw new Error("The avatar was saved but could not be reloaded. Please refresh and try again.");
      const uploadedPath = String(uploadResult?.photo?.storage_path || uploadResult?.photo?.storagePath || "").trim();
      const confirmedPath = String(data.profile.avatar_storage_path || data.profile.avatarStoragePath || "").trim();
      if (!uploadedPath || confirmedPath !== uploadedPath || !data.profile.avatarPhotoUrl) {
        throw new Error("The avatar was saved but could not be verified on your live profile. Please try again.");
      }
      applyDancerApprovalProfile(data.profile);
      await loadLiveDiscovery(data.profile.city || activeDancerCity(), { force: true });
      return data.profile;
    }

    async function removeApprovedDancerAvatar() {
      const data = await deleteAuthenticatedJson("/api/dancer/avatar");
      if (!data?.ok) throw new Error(data?.error || "Avatar could not be removed.");
      const refreshed = await getAuthenticatedJson("/api/dancer/profile");
      if (!refreshed?.profile) throw new Error("Avatar was removed but the profile could not be refreshed.");
      applyDancerApprovalProfile(refreshed.profile);
      await loadLiveDiscovery(refreshed.profile.city || activeDancerCity(), { force: true });
      return refreshed.profile;
    }

    function setApprovedPhotoUploadStatus(message, state = "") {
      const result = document.getElementById("dancerControlResult");
      const visualStatus = document.getElementById("approvedPhotoUploadStatus");
      if (result) result.textContent = message;
      if (!visualStatus) return;
      visualStatus.textContent = message;
      visualStatus.classList.toggle("is-moderating", state === "moderating");
      visualStatus.classList.toggle("is-success", state === "success");
      visualStatus.classList.toggle("is-review", state === "review");
      visualStatus.classList.toggle("is-error", state === "error");
      visualStatus.setAttribute("aria-busy", state === "moderating" ? "true" : "false");
    }

    function startApprovedPhotoModerationProgress(fileName) {
      const steps = [
        `Uploading ${fileName} securely...`,
        "Server is validating the real image file...",
        "Auto moderator is checking the photo...",
        "Saving the moderation result...",
        "Almost done. Finalizing photo status..."
      ];
      let index = 0;
      setApprovedPhotoUploadStatus(steps[index], "moderating");
      return window.setInterval(() => {
        index = Math.min(index + 1, steps.length - 1);
        setApprovedPhotoUploadStatus(steps[index], "moderating");
      }, 1400);
    }

    function isVerificationAdminApproved() {
      return true;
    }

    function setupStepMarkup(step, title, body) {
      const saved = isSavedSetupStepComplete(step);
      const verificationApproved = step === "verification" && isVerificationAdminApproved();
      const markerComplete = step === "verification" ? verificationApproved : saved;
      const submittedForReview = step === "verification" && saved && !verificationApproved;
      const locked = !canOpenStep(step);
      const open = activeSetupStep === step && !locked;
      const stepNumber = setupOrder().indexOf(step) + 1;
      const missingStep = firstUnsavedSetupRequirement(step);
      const lockedMessage = missingStep
        ? `Complete and save Step ${setupOrder().indexOf(missingStep) + 1} ${setupStepDisplayName(missingStep)} first.`
        : "";
      const bodyId = `setup-step-${step}-body`;
      const statusText = markerComplete
        ? (step === "approval" ? "Approved" : "Saved")
        : (submittedForReview ? "Files saved" : "");
      const statusLabel = markerComplete
        ? statusText
        : (submittedForReview ? "Files saved and pending admin approval" : "Not saved");
      return `
        <article class="setup-step ${markerComplete ? "complete" : ""} ${submittedForReview ? "submitted" : ""} ${open ? "open" : ""} ${locked ? "locked" : ""}" data-step="${step}">
          <button class="step-head" data-step-toggle="${step}" type="button"
            aria-expanded="${open ? "true" : "false"}"
            aria-controls="${bodyId}"
            aria-disabled="${locked ? "true" : "false"}"
            ${lockedMessage ? `title="${escapeHtml(lockedMessage)}"` : ""}>
            <span><span class="step-number">Step ${stepNumber}${statusText ? ` · ${statusText}` : ""}</span>${title}</span>
            <span class="step-check" aria-label="${statusLabel}">${markerComplete ? "✓" : '<span class="step-status-dot" aria-hidden="true"></span>'}</span>
            <span class="step-expand" aria-hidden="true">${open ? "−" : "+"}</span>
          </button>
          <div class="step-body" id="${bodyId}" aria-hidden="${open ? "false" : "true"}">${body}</div>
        </article>
      `;
    }

    function scrollToSetupStep(step) {
      window.requestAnimationFrame(() => {
        const target = document.querySelector(`#setupChecklist [data-step="${step}"]`);
        if (!target) return;
        target.scrollIntoView({ behavior: "smooth", block: "start", inline: "nearest" });
      });
    }

    function syncDancerIncognitoToggle(profile = activeDancerProfile(), approved = false) {
      const button = document.getElementById("dancerIncognitoToggle");
      const status = document.getElementById("dancerIncognitoStatus");
      const title = document.getElementById("dancerVisibilityTitle");
      const summary = document.getElementById("dancerVisibilitySummary");
      if (!button) return;
      const isHidden = dancerProfileIsHidden(profile);
      button.hidden = !approved;
      button.classList.toggle("is-incognito", isHidden);
      button.setAttribute("aria-pressed", isHidden ? "true" : "false");
      button.setAttribute("aria-label", isHidden ? "Reactivate public profile" : "Go incognito and hide public profile");
      const label = button.querySelector("strong");
      const helper = button.querySelector("span");
      if (label) label.textContent = isHidden ? "Turn profile back on" : "Go incognito";
      if (helper) helper.textContent = isHidden ? "Incognito on · Profile hidden" : "Hide profile from guests";
      if (title) title.textContent = isHidden ? "Your profile is hidden" : "Your profile is live";
      if (summary) summary.textContent = isHidden ? "Incognito · Hidden from guests" : "Visible to guests";
      if (status) {
        status.classList.toggle("show", approved);
        status.classList.toggle("is-incognito", isHidden);
        status.textContent = isHidden
          ? "Guests cannot discover your profile, schedule, or venue details. Turn it back on whenever you are ready."
          : "Guests can discover your profile, schedules, and venue directions.";
      }
    }

    function dancerDashboardPostedShifts(profile, city = activeDancerCity()) {
      if (!profile) return [];
      const today = todayValue(city);
      const shifts = profilePostedShifts(profile).filter((shift) => {
        if (!shift || shift.status === "cancelled" || shift.workingStatus === "ended" || shift.endedAt) return false;
        if (shift.shiftEndsAt) {
          const endTime = Date.parse(shift.shiftEndsAt);
          if (Number.isFinite(endTime)) return endTime >= Date.now();
        }
        return !shift.shiftDate || shift.shiftDate >= today;
      });
      return shifts.sort((left, right) => {
        const leftTime = Date.parse(left.shiftStartsAt || `${left.shiftDate || today}T${left.shiftStart || "23:59"}:00`);
        const rightTime = Date.parse(right.shiftStartsAt || `${right.shiftDate || today}T${right.shiftStart || "23:59"}:00`);
        return (Number.isFinite(leftTime) ? leftTime : Number.MAX_SAFE_INTEGER) - (Number.isFinite(rightTime) ? rightTime : Number.MAX_SAFE_INTEGER);
      });
    }

    function dancerDashboardAvatarEditorMarkup(profile) {
      const pendingAvatarReview = profile?.pendingAvatarReview || profile?.pending_avatar_review || null;
      const dedicatedAvatarPath = String(profile?.avatarStoragePath || profile?.avatar_storage_path || "").trim();
      const pendingAvatarUrl = String(pendingAvatarReview?.previewUrl || pendingAvatarReview?.preview_url || "").trim();
      const avatarPreviewUrl = pendingAvatarUrl || publicAvatarPhotoUrl(profile);
      const avatarPreviewAttrs = customAvatarPhotoAttrs(
        avatarPreviewUrl,
        pendingAvatarUrl ? "" : publicAvatarPhotoSrcSet(profile),
        profile?.avatarPhotoFocalX ?? profile?.avatar_photo_focal_x ?? profile?.mainPhotoFocalX ?? 50,
        profile?.avatarPhotoFocalY ?? profile?.avatar_photo_focal_y ?? profile?.mainPhotoFocalY ?? 50
      );
      const avatarInitials = String(profile?.name || activeDancerName() || "D")
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part.charAt(0))
        .join("")
        .toUpperCase();
      const avatarStatus = pendingAvatarReview
        ? "Replacement awaiting review. Your current live avatar stays visible until approval."
        : dedicatedAvatarPath
          ? "Live in dancer avatar circles across MyDancr."
          : "Your main photo is currently used in avatar circles.";
      const avatarStatusClass = pendingAvatarReview ? "is-pending" : dedicatedAvatarPath ? "is-live" : "";
      const avatarIsWorkingNow = isWorkingTonight(profile, activeDancerCity());
      const avatarIsUpcoming = dancerDashboardPostedShifts(profile).length > 0 && !avatarIsWorkingNow;
      return `
        <div class="dancer-dashboard-avatar-main">
          <div class="dancer-dashboard-avatar-preview${avatarPreviewAttrs.className}"${avatarPreviewAttrs.style} data-dancer-avatar${avatarIsWorkingNow ? ' data-working-now="true"' : avatarIsUpcoming ? ' data-upcoming="true"' : ""} role="img" aria-label="Profile avatar preview${avatarIsWorkingNow ? ", working now" : avatarIsUpcoming ? ", upcoming shift posted" : ""}">
            <span data-dancer-avatar-border aria-hidden="true">${avatarPreviewUrl ? "" : displayText(avatarInitials)}</span>
            ${avatarIsWorkingNow ? '<span data-working-now-indicator aria-hidden="true">NOW</span>' : ""}
          </div>
          <div class="dancer-dashboard-avatar-copy">
            <span class="eyebrow">Profile avatar</span>
            <strong>Your circular profile photo</strong>
            <p>Upload a clear face photo. MyDancr automatically centers it for avatar circles across the site.</p>
            <span class="dancer-dashboard-avatar-status ${avatarStatusClass}" id="dancerDashboardAvatarStatus" aria-live="polite">${displayText(avatarStatus)}</span>
          </div>
        </div>
        <div class="dancer-dashboard-avatar-actions">
          <button type="button" data-approved-avatar-upload>${dedicatedAvatarPath || pendingAvatarReview ? "Replace avatar" : "Upload avatar"}</button>
          ${dedicatedAvatarPath || pendingAvatarReview ? '<button class="approved-avatar-remove" type="button" data-approved-avatar-remove>Remove avatar</button>' : ""}
        </div>
      `;
    }

    function renderDancerDashboardAvatarEditor(profile, approved) {
      const mount = document.getElementById("dancerDashboardAvatarEditor");
      if (!mount) return;
      mount.hidden = !approved;
      mount.innerHTML = approved ? dancerDashboardAvatarEditorMarkup(profile) : "";
    }

    function renderDancerDailyOverview(profile, approved, dashboardMetrics, optionalProfileFixes = false) {
      const overview = document.getElementById("dancerApprovedTopTools");
      if (!overview) return;
      overview.hidden = !approved;
      overview.classList.toggle("show", approved);
      renderDancerDashboardAvatarEditor(profile, approved);
      if (!approved) return;

      const city = activeDancerCity();
      const isHidden = dancerProfileIsHidden(profile);
      const visibilityPill = document.getElementById("dancerDashboardVisibilityPill");
      const overviewTitle = document.getElementById("dancerDashboardOverviewTitle");
      const overviewCopy = document.getElementById("dancerDashboardOverviewCopy");
      if (visibilityPill) {
        visibilityPill.textContent = optionalProfileFixes ? "Action needed" : isHidden ? "Incognito" : "Public";
        visibilityPill.classList.toggle("is-incognito", isHidden || optionalProfileFixes);
      }
      if (overviewTitle) overviewTitle.textContent = optionalProfileFixes
        ? "Your profile is live, with an item to fix"
        : isHidden
          ? "Your profile is hidden"
          : `You're live in ${city}`;
      if (overviewCopy) overviewCopy.textContent = optionalProfileFixes
        ? "Open Edit profile to replace or remove the item flagged for changes."
        : isHidden
          ? "Your tools remain available while guests cannot see your profile."
          : "Keep your next shift current so guests know where to find you.";

      const views = liveMetricNumber(dashboardMetrics?.profileViews30, 0);
      const followers = liveMetricNumber(dashboardMetrics?.followers, 0);
      const directions = liveMetricNumber(dashboardMetrics?.directionRequests30, 0);
      const metricValues = {
        dancerDashboardProfileViews: views,
        dancerDashboardFollowers: followers,
        dancerDashboardDirections: directions
      };
      Object.entries(metricValues).forEach(([id, value]) => {
        const target = document.getElementById(id);
        if (target) target.textContent = value.toLocaleString();
      });
      const analyticsSummary = document.getElementById("dancerAnalyticsSummary");
      if (analyticsSummary) analyticsSummary.textContent = `${views.toLocaleString()} profile views · ${followers.toLocaleString()} followers · ${directions.toLocaleString()} directions in the last 30 days.`;
      const qrSummaryCount = document.getElementById("dancerQrSummaryCount");
      if (qrSummaryCount) qrSummaryCount.textContent = String(liveMetricNumber(liveDancerDeals?.redeemed, 0));

      const kicker = document.getElementById("dancerDashboardShiftKicker");
      const title = document.getElementById("dancerDashboardShiftTitle");
      const detail = document.getElementById("dancerDashboardShiftDetail");
      const action = document.getElementById("dancerDashboardShiftAction");
      const actionLabel = action?.querySelector("span");
      const checkedIn = Boolean(profile && isCheckedInShift(profile) && profile.workingStatus !== "ended" && !profile.endedAt);
      const nextShift = dancerDashboardPostedShifts(profile, city)[0] || null;
      if (action) action.classList.remove("is-retry");

      if (checkedIn) {
        if (action) action.disabled = false;
        if (kicker) kicker.textContent = "Working now";
        if (title) title.textContent = profile.venue || "Current shift";
        if (detail) detail.textContent = `Dressing-room tap verified until ${new Date(profile.locationVerificationExpiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. Retaps cannot extend it.`;
        if (action) action.dataset.dashboardShiftAction = "post-schedule";
        if (actionLabel) actionLabel.textContent = "Manage shift";
      } else if (nextShift) {
        if (action) action.disabled = false;
        if (kicker) kicker.textContent = "Next shift";
        if (title) title.textContent = nextShift.venue || "Posted shift";
        if (detail) detail.textContent = `${postedShiftDateTimeLabel(nextShift, city)} · Tap the dressing-room sticker when you arrive.`;
        if (action) action.dataset.dashboardShiftAction = "nfc-ready";
        if (actionLabel) actionLabel.textContent = "Tap when you arrive";
      } else {
        if (action) action.disabled = false;
        if (kicker) kicker.textContent = "Working Now";
        if (title) title.textContent = "Not working now";
        if (detail) detail.textContent = "Tap the official dressing-room sticker at your venue to start one six-hour session.";
        if (action) action.dataset.dashboardShiftAction = "nfc-ready";
        if (actionLabel) actionLabel.textContent = "Tap at dressing room";
      }
    }

    function dancerSetupAvatarEditorMarkup(profile) {
      const pendingAvatarReview = profile?.pendingAvatarReview || profile?.pending_avatar_review || null;
      const dedicatedAvatarPath = String(profile?.avatarStoragePath || profile?.avatar_storage_path || "").trim();
      const pendingAvatarUrl = String(pendingAvatarReview?.previewUrl || pendingAvatarReview?.preview_url || "").trim();
      const avatarPreviewUrl = pendingAvatarUrl || publicAvatarPhotoUrl(profile);
      const avatarPreviewAttrs = customAvatarPhotoAttrs(
        avatarPreviewUrl,
        pendingAvatarUrl ? "" : publicAvatarPhotoSrcSet(profile),
        profile?.avatarPhotoFocalX ?? profile?.avatar_photo_focal_x ?? profile?.mainPhotoFocalX ?? 50,
        profile?.avatarPhotoFocalY ?? profile?.avatar_photo_focal_y ?? profile?.mainPhotoFocalY ?? 50
      );
      const avatarInitials = String(profile?.name || activeDancerName() || "D")
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part.charAt(0))
        .join("")
        .toUpperCase();
      const avatarStatus = pendingAvatarReview
        ? "Replacement awaiting review. Your current live avatar stays visible until approval."
        : dedicatedAvatarPath
          ? "Live in dancer avatar circles across MyDancr."
          : "Upload a clear face photo to create your centered avatar.";
      const avatarStatusClass = pendingAvatarReview ? "is-pending" : dedicatedAvatarPath ? "is-live" : "";
      return `
        <div class="setup-avatar-editor" data-dashboard-avatar-editor>
          <span class="setup-avatar-preview${avatarPreviewAttrs.className}"${avatarPreviewAttrs.style} role="img" aria-label="Avatar preview">${avatarPreviewUrl ? "" : displayText(avatarInitials)}</span>
          <div class="setup-avatar-copy">
            <strong>Face avatar</strong>
            <p>Choose a clear face photo. MyDancr checks it and automatically centers the best square crop for every avatar circle.</p>
            <span class="setup-avatar-status ${avatarStatusClass}" id="setupAvatarUploadStatus" aria-live="polite">${displayText(avatarStatus)}</span>
          </div>
          <div class="setup-avatar-actions">
            <button class="action-btn secondary" type="button" data-approved-avatar-upload>${dedicatedAvatarPath || pendingAvatarReview ? "Replace avatar" : "Upload clear face photo"}</button>
            ${dedicatedAvatarPath || pendingAvatarReview ? '<button class="action-btn secondary" type="button" data-approved-avatar-remove>Remove avatar</button>' : ""}
          </div>
        </div>
      `;
    }
