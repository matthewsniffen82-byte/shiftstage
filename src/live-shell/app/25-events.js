

    dancerDashboard.addEventListener("click", async (event) => {
      const avatarUpload = event.target.closest("[data-approved-avatar-upload]");
      if (avatarUpload) {
        event.preventDefault();
        openApprovedAvatarUploadPicker({
          preserveSetupStep: Boolean(avatarUpload.closest('#setupChecklist [data-step="profile"]'))
        });
        return;
      }
      const avatarRemove = event.target.closest("[data-approved-avatar-remove]");
      if (avatarRemove) {
        event.preventDefault();
        avatarRemove.disabled = true;
        avatarRemove.setAttribute("aria-busy", "true");
        setApprovedAvatarUploadStatus("Removing avatar...", "moderating");
        try {
          await removeApprovedDancerAvatar();
          if (pendingAvatarObjectUrl) URL.revokeObjectURL(pendingAvatarObjectUrl);
          pendingAvatarObjectUrl = "";
          renderDancerSetup();
          renderApprovedVisualProfileEditor();
          renderDancerManagement();
          setApprovedAvatarUploadStatus("Avatar removed. Your main photo is now used in avatar circles.");
          showToast("Avatar removed");
        } catch (error) {
          const message = normalizeRequestError(error, "Could not remove avatar");
          setApprovedAvatarUploadStatus(message, "error");
          showToast(message);
        } finally {
          if (avatarRemove.isConnected) {
            avatarRemove.disabled = false;
            avatarRemove.removeAttribute("aria-busy");
          }
        }
        return;
      }
      const retryProfileVideos = event.target.closest("[data-approved-profile-video-retry]");
      if (retryProfileVideos) {
        event.preventDefault();
        approvedProfileVideoStatusTone = "";
        void loadApprovedProfileVideos({ force: true });
        return;
      }
      const addProfileVideo = event.target.closest("[data-approved-profile-video-add]");
      if (addProfileVideo) {
        event.preventDefault();
        document.getElementById("approvedProfileVideoInput")?.click();
        return;
      }
      const removeProfileVideo = event.target.closest("[data-approved-profile-video-remove]");
      if (removeProfileVideo) {
        event.preventDefault();
        const videoId = removeProfileVideo.dataset.approvedProfileVideoRemove || "";
        if (!videoId || !window.confirm("Remove this video from your profile and MyDancr TV?")) return;
        approvedProfileVideoRemovingId = videoId;
        approvedProfileVideoStatus = "Removing video...";
        approvedProfileVideoStatusTone = "";
        renderApprovedProfileVideoManager();
        try {
          await removeApprovedProfileVideo(videoId);
          showToast("Profile video removed");
        } catch (error) {
          approvedProfileVideoStatus = error?.message || "Unable to remove the video.";
          approvedProfileVideoStatusTone = "error";
          showToast(approvedProfileVideoStatus);
        } finally {
          approvedProfileVideoRemovingId = "";
          renderApprovedProfileVideoManager();
        }
        return;
      }
      const profileEditorClose = event.target.closest("[data-approved-profile-editor-close]");
      if (profileEditorClose) {
        event.preventDefault();
        event.stopPropagation();
        closeApprovedProfileEditor();
        return;
      }
      if (await handleApprovedEditPopoverClick(event)) return;
      if (handleNotificationCenterClick(event)) return;
      if (handleSupportActionClick(event)) return;
      if (handleAccountControlClick(event)) return;
      if (handleShareClick(event)) return;
      if (event.target.closest("[data-readonly-profile-tool]")) return;
      const socialEditToggle = event.target.closest("[data-approved-social-edit-toggle]");
      if (socialEditToggle) {
        event.preventDefault();
        approvedSocialEditMode = false;
        openApprovedVisualEditPopover("socials", { anchor: socialEditToggle });
        showToast("Edit social links.");
        return;
      }
      const photoEditToggle = event.target.closest("[data-approved-photo-edit-toggle]");
      if (photoEditToggle) {
        event.preventDefault();
        approvedPhotoEditMode = !approvedPhotoEditMode;
        closeApprovedVisualEditPopover();
        renderApprovedVisualProfileEditor();
        showToast(approvedPhotoEditMode ? "Tap a profile picture to edit it." : "Photo edit mode closed.");
        return;
      }
      const visualPhotoSelect = event.target.closest("[data-approved-visual-photo-select]");
      if (visualPhotoSelect) {
        event.preventDefault();
        if (approvedPhotoEditMode) {
          console.log("DELETE_CLICK", {
            photoId: visualPhotoSelect.dataset.photoId || "",
            label: visualPhotoSelect.dataset.photoLabel || "",
            storagePath: visualPhotoSelect.dataset.photoStoragePath || ""
          });
          openApprovedVisualEditPopover("photo", {
            photoId: visualPhotoSelect.dataset.photoId,
            target: visualPhotoSelect.dataset.photoTarget,
            photoUrl: visualPhotoSelect.dataset.photoUrl,
            storagePath: visualPhotoSelect.dataset.photoStoragePath,
            label: visualPhotoSelect.dataset.photoLabel,
            status: visualPhotoSelect.dataset.reviewStatus,
            notes: visualPhotoSelect.dataset.reviewNotes,
            anchor: visualPhotoSelect
          });
          return;
        }
        activeApprovedVisualPhotoTarget = visualPhotoSelect.dataset.approvedVisualPhotoSelect || visualPhotoSelect.dataset.photoTarget || "";
        renderApprovedVisualProfileEditor();
        return;
      }
      const approvedSocialLink = event.target.closest(".approved-visual-profile .social-edit-item .social-link[data-social-url]");
      if (approvedSocialLink && !approvedSocialEditMode) {
        event.preventDefault();
        const url = approvedSocialLink.dataset.socialUrl || "";
        if (url) {
          window.open(url, "_blank", "noopener,noreferrer");
          showToast("Social link opened");
        } else {
          showToast("No social link added yet");
        }
        return;
      }
      const visualEdit = event.target.closest("[data-profile-visual-edit]");
      if (visualEdit) {
        event.preventDefault();
        if (visualEdit.dataset.profileVisualEdit === "photo" && !approvedPhotoEditMode) {
          openPhotoViewerFromElement(visualEdit);
          return;
        }
        openApprovedVisualEditPopover(visualEdit.dataset.profileVisualEdit, {
          photoId: visualEdit.dataset.photoId,
          target: visualEdit.dataset.photoTarget,
          photoUrl: visualEdit.dataset.photoUrl,
          storagePath: visualEdit.dataset.photoStoragePath,
          label: visualEdit.dataset.photoLabel,
          platform: visualEdit.dataset.socialPlatform,
          status: visualEdit.dataset.reviewStatus,
          notes: visualEdit.dataset.reviewNotes,
          anchor: visualEdit
        });
        return;
      }
      const visualPhotoReplace = event.target.closest("[data-approved-visual-photo-replace]");
      if (visualPhotoReplace) {
        event.preventDefault();
        pendingApprovedPhotoTarget = visualPhotoReplace.dataset.photoTarget || "gallery";
        pendingApprovedPhotoAutoSubmit = false;
        closeApprovedVisualEditPopover();
        openApprovedPhotoUploadPicker("Choose a replacement picture. Approved photos go live automatically.");
        return;
      }
      const visualPhotoAdd = event.target.closest("[data-approved-visual-photo-add]");
      if (visualPhotoAdd) {
        event.preventDefault();
        pendingApprovedPhotoTarget = visualPhotoAdd.dataset.approvedVisualPhotoAdd || "gallery";
        pendingApprovedPhotoAutoSubmit = false;
        openApprovedPhotoUploadPicker("Choose a picture. Approved photos go live automatically.");
        return;
      }
      const visualPhotoDelete = event.target.closest("[data-approved-visual-photo-delete]");
      if (visualPhotoDelete) {
        event.preventDefault();
        const payload = {
          photoId: visualPhotoDelete.dataset.photoId || "",
          target: visualPhotoDelete.dataset.photoTarget || "",
          label: visualPhotoDelete.dataset.photoLabel || "Profile photo",
          photoUrl: visualPhotoDelete.dataset.photoUrl || "",
          storagePath: visualPhotoDelete.dataset.photoStoragePath || ""
        };
        visualPhotoDelete.disabled = true;
        try {
          const deleted = await deleteApprovedDancerPhoto(payload);
          closeApprovedVisualEditPopover();
          showToast(deleted ? "Photo deleted. Press Save profile when ready." : "Photo could not be deleted.");
        } catch (error) {
          showToast(error.message || "Could not delete photo");
        } finally {
          visualPhotoDelete.disabled = false;
        }
        return;
      }
      const visualSocialSave = event.target.closest("[data-approved-visual-social-save]");
      if (visualSocialSave) {
        event.preventDefault();
        const platform = visualSocialSave.dataset.socialPlatform || "";
        const input = document.getElementById("approvedVisualSocialInput");
        const fieldId = `profile${platform.charAt(0).toUpperCase()}${platform.slice(1)}`;
        const field = document.getElementById(fieldId);
        if (field && input) {
          field.value = input.value.trim();
          clearApprovedSocialDeleted(platform);
          mirrorApprovedProfileEditField(field);
          closeApprovedVisualEditPopover();
          showToast("Social link saved. Press Save profile to send it to admin.");
        }
        return;
      }
      const visualSocialDelete = event.target.closest("[data-approved-visual-social-delete]");
      if (visualSocialDelete) {
        event.preventDefault();
        const platform = visualSocialDelete.dataset.socialPlatform || "";
        const fieldId = `profile${platform.charAt(0).toUpperCase()}${platform.slice(1)}`;
        const field = document.getElementById(fieldId);
        if (field) {
          field.value = "";
          markApprovedSocialDeleted(platform);
          mirrorApprovedProfileEditField(field);
          closeApprovedVisualEditPopover();
          showToast("Social link deleted. Press Save profile to send the change to admin.");
        }
        return;
      }
      if (event.target.closest("[data-approved-edit-close]")) {
        event.preventDefault();
        closeApprovedVisualEditPopover();
        return;
      }
      const fixTargetButton = event.target.closest("[data-fix-target]");
      if (fixTargetButton) {
        event.preventDefault();
        jumpToDancerFixTarget(fixTargetButton.dataset.fixTarget);
        return;
      }
      const socialFocusButton = event.target.closest("[data-social-focus]");
      if (socialFocusButton) {
        event.preventDefault();
        focusApprovedSocialField(socialFocusButton.dataset.socialFocus);
        return;
      }
      const socialClearButton = event.target.closest("[data-social-clear]");
      if (socialClearButton) {
        event.preventDefault();
        clearApprovedSocialField(socialClearButton.dataset.socialClear);
        return;
      }
      const dancerControlAction = event.target.closest("[data-dancer-control-action]");
      if (dancerControlAction) {
        event.preventDefault();
        event.stopPropagation();
        handleDancerControlAction(dancerControlAction.dataset.dancerControlAction, dancerControlAction);
        return;
      }
      const shiftVerifyAction = event.target.closest("[data-shift-verify-action]");
      if (shiftVerifyAction) {
        handleShiftVerificationAction(shiftVerifyAction.dataset.shiftVerifyAction, shiftVerifyAction);
        return;
      }
      const shiftAction = event.target.closest("[data-shift-action]");
      if (shiftAction) {
        handleShiftManagerAction(shiftAction.dataset.shiftAction, shiftAction);
        return;
      }
      const approvalToggle = event.target.closest("[data-setup-checklist-toggle]");
      const approvalCommand = approvalToggle?.closest("#dancerApprovalCommand");
      if (approvalToggle && approvalCommand && !approvalCommand.classList.contains("approved")) {
        setupChecklistExpanded = !setupChecklistExpanded;
        if (setupChecklistExpanded && !activeSetupStep) {
          activeSetupStep = nextIncompleteStep() || "profile";
        }
        renderDancerSetup();
        return;
      }
      const setupToggleButton = event.target.closest("#setupChecklistToggle");
      if (setupToggleButton) {
        setupChecklistExpanded = !setupChecklistExpanded;
        if (setupChecklistExpanded && !activeSetupStep) {
          activeSetupStep = nextIncompleteStep() || "profile";
        }
        renderDancerSetup();
        return;
      }
      const submitReviewButton = event.target.closest("[data-submit-review]");
      if (submitReviewButton) {
        submitDancerProfileForReview(submitReviewButton);
        return;
      }
      const previewProfileButton = event.target.closest("[data-preview-profile]");
      if (previewProfileButton) {
        openDancerProfilePreview();
        return;
      }
      const toggle = event.target.closest("[data-step-toggle]");
      if (toggle) {
        const step = toggle.dataset.stepToggle;
        if (canOpenStep(step)) {
          setupChecklistExpanded = true;
          activeSetupStep = activeSetupStep === step ? "" : step;
          renderDancerSetup();
          scrollToSetupStep(step);
        } else {
          const missingStep = firstUnsavedSetupRequirement(step);
          if (missingStep) {
            setupChecklistExpanded = true;
            activeSetupStep = missingStep;
            renderDancerSetup();
            showToast(`Complete and save Step ${setupOrder().indexOf(missingStep) + 1} ${setupStepDisplayName(missingStep)} first.`);
            scrollToSetupStep(missingStep);
          }
        }
        return;
      }
      const completeButton = event.target.closest("[data-complete-step]");
      if (completeButton) {
        completeSetupStep(completeButton.dataset.completeStep);
      }
    });

    dancerDashboard.addEventListener("keydown", (event) => {
      if (handleNotificationCenterKeydown(event)) return;
      const approvalToggle = event.target.closest("[data-setup-checklist-toggle]");
      const approvalCommand = approvalToggle?.closest("#dancerApprovalCommand");
      if (!approvalToggle || !approvalCommand || approvalCommand.classList.contains("approved")) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      setupChecklistExpanded = !setupChecklistExpanded;
      if (setupChecklistExpanded && !activeSetupStep) {
        activeSetupStep = nextIncompleteStep() || "profile";
      }
      renderDancerSetup();
    });

    dancerDashboard.addEventListener("input", (event) => {
      if (event.target.closest("#shiftDate")) {
        renderShiftDisplayPreview();
        return;
      }

      const approvedStageNameInput = event.target.closest("[data-approved-stage-name-input]");
      if (approvedStageNameInput) {
        ["profileStageName", "approvedControlStageName"].forEach((fieldId) => {
          const field = document.getElementById(fieldId);
          if (field && field.value !== approvedStageNameInput.value) field.value = approvedStageNameInput.value;
        });
        document.querySelectorAll("[data-approved-stage-name-preview]").forEach((preview) => {
          preview.textContent = approvedStageNameInput.value.trim() || "Stage name";
        });
        syncApprovedProfileSubmitState();
        return;
      }

      if (event.target.closest("#publicProfileForm, #approvedProfileEditFields, .social-control-grid")) {
        mirrorApprovedProfileEditField(event.target);
        return;
      }

      const socialField = event.target.closest("[data-setup-social]");
      if (socialField) {
        dancerSignupSocials[socialField.dataset.setupSocial] = socialField.value;
        saveDancerProfileDraft({ socials: { [socialField.dataset.setupSocial]: socialField.value } });
        return;
      }

      const profileField = event.target.closest("[data-setup-profile-field]");
      if (!profileField) return;
      const value = profileField.value;
      if (profileField.dataset.setupProfileField === "stageName") {
        setDancerSetupField("dancerStageName", value);
        updateDancerDashboardName(value);
        saveDancerProfileDraft({ stageName: value });
      }
      if (profileField.dataset.setupProfileField === "city") {
        setDancerSetupField("dancerCity", value);
        saveDancerProfileDraft({ city: value });
      }
    });

    dancerDashboard.addEventListener("focusout", (event) => {
      if (!event.target.closest("#setupChecklist [data-setup-form], #setupChecklist [data-setup-profile-editor]")) return;
      window.setTimeout(() => {
        if (dancerSetupRefreshPending && !dancerSetupEditorHasFocus()) {
          renderDancerSetupWhenEditorIdle();
        }
      }, 0);
    });

    dancerDashboard.addEventListener("change", (event) => {
      if (event.target.closest("#shiftDate")) {
        renderShiftDisplayPreview();
        return;
      }
      if (event.target.closest("#publicProfileForm, #approvedProfileEditFields, .social-control-grid")) {
        mirrorApprovedProfileEditField(event.target);
      }
    });

    dancerDashboard.addEventListener("submit", async (event) => {
      const profileVideoForm = event.target.closest("#approvedProfileVideoUploadForm");
      if (profileVideoForm) {
        event.preventDefault();
        if (approvedProfileVideoSubmitting) return;
        if (document.querySelector("[data-setup-profile-editor]")) captureDancerSetupProfileDraft();
        approvedProfileVideoSubmitting = true;
        approvedProfileVideoStatus = "Checking your video...";
        approvedProfileVideoStatusTone = "";
        const submit = profileVideoForm.querySelector('button[type="submit"]');
        if (submit) {
          submit.disabled = true;
          submit.textContent = "Uploading and checking...";
        }
        try {
          await submitApprovedProfileVideo(profileVideoForm);
        } catch (error) {
          approvedProfileVideoStatus = error?.message || "Unable to upload the profile video.";
          approvedProfileVideoStatusTone = "error";
          showToast(approvedProfileVideoStatus);
        } finally {
          approvedProfileVideoSubmitting = false;
          renderApprovedProfileVideoManager();
        }
        return;
      }
      const shiftForm = event.target.closest("#shiftPostForm");
      if (shiftForm) {
        event.preventDefault();
        postVerifiedShift();
        return;
      }

      const profileEditForm = event.target.closest("#publicProfileForm");
      if (profileEditForm) {
        event.preventDefault();
        await saveApprovedDancerProfile({ trigger: profileEditForm.querySelector("[data-dancer-control-action='save-profile']") });
        return;
      }

      const photosForm = event.target.closest("[data-setup-form='photos']");
      if (photosForm) {
        event.preventDefault();
        captureDancerSetupProfileDraft();
        submitSetupPhotos(photosForm);
        return;
      }

      const form = event.target.closest("[data-setup-form='profile']");
      if (!form) return;
      event.preventDefault();
      const stageNameValidation = validateDancerStageName(document.getElementById("setupStageName").value);
      const stageName = stageNameValidation.value;
      const city = document.getElementById("setupCity").value.trim();
      const rawSocials = {
        instagram: document.getElementById("setupInstagram").value.trim(),
        tiktok: document.getElementById("setupTiktok").value.trim(),
        snapchat: document.getElementById("setupSnapchat").value.trim(),
        onlyfans: document.getElementById("setupOnlyfans").value.trim(),
        x: document.getElementById("setupX").value.trim()
      };
      if (!stageNameValidation.valid) {
        showToast(stageNameValidation.error);
        document.getElementById("setupStageName").focus();
        return;
      }
      if (!city) {
        showToast("City required");
        return;
      }
      if (hasBlockedSocialLink(Object.values(rawSocials))) {
        showToast("Escorting, payment, or solicitation links are not allowed");
        return;
      }
      const normalizedSocials = Object.fromEntries(
        Object.entries(rawSocials).map(([key, value]) => [key, normalizeSocialInput(key, value)])
      );
      const invalidSocial = Object.entries(rawSocials).some(([key, value]) => value && !normalizedSocials[key]);
      if (invalidSocial) {
        showToast("Use Instagram, TikTok, Snapchat, OnlyFans, or X links only");
        return;
      }
      document.getElementById("dancerStageName").value = stageName;
      document.getElementById("dancerCity").value = city;
      pendingDancerSignupCity = city;
      updateDancerDashboardName(stageName);
      assignSocialMap(dancerSignupSocials, normalizedSocials);
      saveDancerProfileDraft({ stageName, city, socials: normalizedSocials });
      const submit = document.querySelector("[data-setup-profile-save]");
      const status = document.getElementById("setupProfileSaveStatus");
      if (submit) {
        submit.disabled = true;
        submit.setAttribute("aria-busy", "true");
        submit.textContent = "Saving profile...";
      }
      if (status) {
        status.hidden = false;
        status.classList.remove("is-success", "is-error");
        status.textContent = "Saving your avatar, stage name, city, and social links...";
      }
      try {
        if (isDancerSession()) {
          const data = await patchAuthenticatedJson("/api/dancer/profile", {
            stageName,
            city,
            socials: socialPayloadFromMap(normalizedSocials)
          });
          if (!data) throw new Error("Sign in required");
          if (data.profile) applyDancerApprovalProfile(data.profile);
          markDancerProfileSetupSaved(true);
        } else {
          markDancerProfileSetupSaved(true);
        }
        completeSetupStep("profile", { keepOpen: true });
        clearStoredDancerProfileDraft();
        const refreshedSubmit = document.querySelector("[data-setup-profile-save]");
        const refreshedStatus = document.getElementById("setupProfileSaveStatus");
        if (refreshedSubmit) {
          refreshedSubmit.disabled = false;
          refreshedSubmit.removeAttribute("aria-busy");
          refreshedSubmit.classList.add("is-saved");
          refreshedSubmit.textContent = "Saved ✓";
        }
        if (refreshedStatus) {
          refreshedStatus.hidden = false;
          refreshedStatus.classList.add("is-success");
          refreshedStatus.textContent = "Profile saved. Your avatar, stage name, city, and social links are preserved.";
        }
        showToast("Profile saved");
        window.setTimeout(() => {
          const currentSubmit = document.querySelector("[data-setup-profile-save]");
          if (currentSubmit && currentSubmit.textContent.includes("Saved")) {
            currentSubmit.classList.remove("is-saved");
            currentSubmit.textContent = "Save profile";
          }
        }, 3200);
      } catch (error) {
        const message = error.message || "Could not save live profile";
        const currentStatus = document.getElementById("setupProfileSaveStatus");
        if (currentStatus) {
          currentStatus.hidden = false;
          currentStatus.classList.remove("is-success");
          currentStatus.classList.add("is-error");
          currentStatus.textContent = `Profile was not saved. ${message}`;
        }
        showToast(message);
      } finally {
        if (submit?.isConnected) {
          submit.disabled = false;
          submit.removeAttribute("aria-busy");
          submit.textContent = "Save profile";
        }
      }
    });

    document.addEventListener("click", (event) => {
      handleDealPassClick(event);
    });

    document.addEventListener("keydown", (event) => {
      const openTvViewer = document.getElementById("profileTvViewer");
      if (event.key === "Escape" && contentReportPopover && !contentReportPopover.hidden) {
        event.preventDefault();
        closeContentReportDialog();
        return;
      }
      if (openTvViewer && !openTvViewer.hidden && event.key === "ArrowUp") {
        event.preventDefault();
        showRelativeProfileTvVideo(-1);
        return;
      }
      if (openTvViewer && !openTvViewer.hidden && event.key === "ArrowDown") {
        event.preventDefault();
        showRelativeProfileTvVideo(1);
        return;
      }
      if (event.key === "Escape") {
        if (openTvViewer && !openTvViewer.hidden) {
          closeProfileTvViewer();
          return;
        }
      }
      if (event.key === "Escape") closeDealPassOverlay();
      const cardVenueLink = event.target.closest?.("[data-card-venue]");
      if (cardVenueLink && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        event.stopPropagation();
        openVenueFromName(cardVenueLink.dataset.cardVenue, {
          returnTo: customerDashboard.classList.contains("show") ? "customer-dashboard" : "",
          showFocusRing: true
        });
        return;
      }
      if (event.key === "Escape") {
        if (accountRequiredPopover && !accountRequiredPopover.hidden) {
          closeAccountRequiredPrompt();
          return;
        }
        if (adminPreviewPopover && !adminPreviewPopover.hidden) {
          closeAdminPreview();
          return;
        }
        if (publicContactPopover && !publicContactPopover.hidden) {
          closePublicContactForm();
          return;
        }
      }
      if (event.key === "Escape") {
        const dealOverlay = document.getElementById("dealPassOverlay");
        if (dealOverlay?.classList.contains("show")) {
          closeDealPassOverlay();
          return;
        }
      }
      if (event.key === "Escape") {
        const profileShareOverlay = document.getElementById("profileShareChoiceOverlay");
        if (profileShareOverlay?.classList.contains("show")) {
          closeProfileShareChoice();
          return;
        }
      }
      if (event.key === "Escape") {
        const qrOverlay = document.getElementById("profileQrOverlay");
        if (qrOverlay?.classList.contains("show")) {
          closeQrPopovers();
          return;
        }
      }
      if (event.key === "Escape" && profileBackdrop.classList.contains("show")) {
        if (profilePhotoViewer && !profilePhotoViewer.hidden) {
          closeProfilePhotoViewer();
          return;
        }
        event.preventDefault();
        return;
      }
      if (event.key === "Escape") closeUtilityMenu();
    });

    const homeBottomTv = document.getElementById("homeBottomTv");
    const homeDestinationOrder = ["dancers", "tv", "venues"];
    const dancerDirectoryFilters = ["all", "now", "upcoming"];

    function dancerDirectoryFilterFromLocation() {
      const params = new URLSearchParams(window.location.search);
      const requestedFilter = params.get("dancer_filter");
      if (dancerDirectoryFilters.includes(requestedFilter)) return requestedFilter;
      const requestedView = params.get("view");
      if (requestedView === "tonight") return "now";
      return "all";
    }

    function homeDestinationFromLocation() {
      const requestedView = new URLSearchParams(window.location.search).get("view");
      if (requestedView === "tonight" || requestedView === "trending") return "dancers";
      return homeDestinationOrder.includes(requestedView) ? requestedView : "dancers";
    }

    function homeDestinationWasRequested() {
      const requestedView = new URLSearchParams(window.location.search).get("view");
      return homeDestinationOrder.includes(requestedView) || requestedView === "tonight" || requestedView === "trending";
    }

    function syncHomeDestinationLocation(nextTab) {
      if (!homeDestinationOrder.includes(nextTab)) return;
      const url = new URL(window.location.href);
      url.searchParams.set("city", citySelect.value);
      url.searchParams.set("view", nextTab);
      if (nextTab === "dancers" && dancerDirectoryFilter !== "all") {
        url.searchParams.set("dancer_filter", dancerDirectoryFilter);
      } else {
        url.searchParams.delete("dancer_filter");
      }
      url.searchParams.delete("profile");
      url.searchParams.delete("venue");
      if (nextTab !== "tv") {
        url.searchParams.delete("tv_video");
        url.searchParams.delete("tv_venue");
      }
      const search = url.searchParams.toString();
      window.history.replaceState(
        {},
        document.title,
        `${url.pathname}${search ? `?${search}` : ""}${url.hash}`
      );
    }

    function clearHomeDestinationLocation() {
      const url = new URL(window.location.href);
      url.searchParams.delete("view");
      url.searchParams.delete("dancer_filter");
      url.searchParams.delete("profile");
      url.searchParams.delete("venue");
      url.searchParams.delete("tv_video");
      url.searchParams.delete("tv_venue");
      const search = url.searchParams.toString();
      window.history.replaceState(
        {},
        document.title,
        `${url.pathname}${search ? `?${search}` : ""}${url.hash}`
      );
    }

    function activateHomeDestination(nextTab, options = {}) {
      if (!homeDestinationOrder.includes(nextTab)) return false;
      const previousDestinationIndex = homeDestinationOrder.indexOf(activeTab);
      const nextDestinationIndex = homeDestinationOrder.indexOf(nextTab);
      const transitionDirection = Math.sign(nextDestinationIndex - previousDestinationIndex);
      const leavingAnotherDestination = activeTab !== "dancers";
      if (nextTab === "dancers") {
        dancerDirectoryFilter = dancerDirectoryFilters.includes(options.dancerFilter)
          ? options.dancerFilter
          : leavingAnotherDestination
            ? "all"
            : dancerDirectoryFilter;
      }
      if (profileBackdrop.classList.contains("show")) closeProfileModal();
      deactivateHomeTvFeed(nextTab !== "tv");
      deactivateHomeDiscoveryFeed();
      if (nextTab === "venues" && activeTab === "venues" && selectedVenueName) {
        selectedVenueName = null;
      }
      activeTab = nextTab;
      homeTvFeedLandingPending = nextTab === "tv" && options.scroll !== false;
      homeDiscoveryFeedOpen =
        nextTab === "venues" &&
        homeDiscoveryFeedUsesInlineLayout();
      tonightExpanded = false;
      dancersExpanded = false;
      if (activeTab !== "venues") selectedVenueName = null;
      document.querySelectorAll(".tab").forEach((item) => {
        const isActive = item.dataset.tab === nextTab;
        item.classList.toggle("active", isActive);
        item.setAttribute("aria-current", isActive ? "page" : "false");
      });
      const isTv = nextTab === "tv";
      homeBottomTv?.classList.toggle("active", isTv);
      homeBottomTv?.setAttribute("aria-current", isTv ? "page" : "false");
      syncHomeDestinationLocation(nextTab);
      render();
      if (nextTab === "venues") void refreshVisibleHomeDiscovery({ bypassCache: true });
      if (options.scroll !== false) {
        homeResultsSmoothLandingPending = true;
        startHomeDestinationTransition(transitionDirection);
        focusHomeResults();
      }
      return true;
    }

    homeBottomTv?.addEventListener("click", (event) => {
      event.preventDefault();
      activateHomeDestination("tv");
    });
    window.addEventListener("touchstart", releaseHomeResultsLandingForUser, { passive: true, capture: true });
    window.addEventListener("wheel", releaseHomeResultsLandingForUser, { passive: true, capture: true });
    window.addEventListener("keydown", releaseHomeResultsLandingForUser, { capture: true });
    window.addEventListener("resize", handleHomeDiscoveryFeedViewportChange, { passive: true });
    window.addEventListener("orientationchange", handleHomeDiscoveryFeedViewportChange, { passive: true });
    window.visualViewport?.addEventListener("resize", handleHomeDiscoveryFeedViewportChange, { passive: true });

    document.querySelectorAll(".tab").forEach((tab) => {
      tab.addEventListener("click", () => activateHomeDestination(tab.dataset.tab || ""));
    });

    function installIphoneBottomNavigationTouch() {
      const isIphoneWebKit =
        /iP(?:hone|ad|od)/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      if (!discoveryTabs || !isIphoneWebKit) return;

      const MAX_MOVEMENT_PX = 10;
      const MAX_DURATION_MS = 900;
      let target = null;
      let startX = 0;
      let startY = 0;
      let startedAt = 0;

      function resetTap() {
        target = null;
        startX = 0;
        startY = 0;
        startedAt = 0;
      }

      function destinationFor(element) {
        if (!(element instanceof Element)) return "";
        const button = element.closest(".tab, #homeBottomTv");
        if (!button || !discoveryTabs.contains(button)) return "";
        return button.id === "homeBottomTv" ? "tv" : button.dataset.tab || "";
      }

      discoveryTabs.addEventListener("touchstart", (event) => {
        resetTap();
        if (event.touches.length !== 1) return;
        const destination = destinationFor(event.target);
        if (!homeDestinationOrder.includes(destination)) return;
        const touch = event.touches[0];
        target = destination;
        startX = touch.clientX;
        startY = touch.clientY;
        startedAt = Date.now();
      }, { passive: true });

      discoveryTabs.addEventListener("touchend", (event) => {
        if (!target || event.changedTouches.length !== 1) {
          resetTap();
          return;
        }
        const destination = target;
        const touch = event.changedTouches[0];
        const moved = Math.hypot(touch.clientX - startX, touch.clientY - startY);
        const elapsed = Date.now() - startedAt;
        resetTap();
        if (moved > MAX_MOVEMENT_PX || elapsed > MAX_DURATION_MS) return;
        if (event.cancelable) event.preventDefault();
        activateHomeDestination(destination);
      }, { passive: false });

      discoveryTabs.addEventListener("touchcancel", resetTap, { passive: true });
    }

    installIphoneBottomNavigationTouch();

    const homeDestinationSwipe = {
      startX: 0,
      startY: 0,
      startedAt: 0,
      tracking: false,
      axis: "pending"
    };
    const HOME_DESTINATION_SWIPE_MIN_PX = 34;
    const HOME_DESTINATION_SWIPE_FLICK_MIN_PX = 22;
    const HOME_DESTINATION_SWIPE_FLICK_VELOCITY = .32;
    const HOME_DESTINATION_SWIPE_DIRECTION_LOCK_PX = 10;
    const HOME_DESTINATION_SWIPE_HORIZONTAL_RATIO = 1.08;
    const HOME_DESTINATION_SWIPE_MAX_MS = 1400;
    const HOME_DESTINATION_SWIPE_EDGE_GUARD_PX = 20;

    function homeDestinationIsSelected() {
      return Boolean(discoveryTabs?.querySelector(".tab.active, .home-bottom-tv.active"));
    }

    function homeDestinationSwipeBlocked(target) {
      if (!(target instanceof Element)) return true;
      return Boolean(target.closest(
        "input, select, textarea, [contenteditable], [role='slider'], " +
        "iframe, #discoveryTabs, .global-mobile-bottom-nav, [data-global-navigation-swipe='ignore'], " +
        "#modalImage, #modalGallery, .profile-photo-viewer, " +
        ".profile-tv-strip-list, .profile-tv-viewer"
      ));
    }

    function setHomeDestinationSwipeOffset(deltaX) {
      const currentIndex = homeDestinationOrder.indexOf(activeTab);
      const direction = deltaX < 0 ? 1 : -1;
      const canMove =
        currentIndex >= 0 &&
        currentIndex + direction >= 0 &&
        currentIndex + direction < homeDestinationOrder.length;
      const resistance = canMove ? .16 : .05;
      const maxOffset = canMove ? 30 : 10;
      const offset = Math.max(-maxOffset, Math.min(maxOffset, deltaX * resistance));
      document.body.style.setProperty("--home-destination-swipe-offset", `${offset}px`);
      document.body.classList.add("home-destination-swipe-active");
    }

    function resetHomeDestinationSwipe() {
      homeDestinationSwipe.tracking = false;
      homeDestinationSwipe.startX = 0;
      homeDestinationSwipe.startY = 0;
      homeDestinationSwipe.startedAt = 0;
      homeDestinationSwipe.axis = "pending";
      document.body.classList.remove("home-destination-swipe-active");
      document.body.style.removeProperty("--home-destination-swipe-offset");
    }

    function moveToAdjacentHomeDestination(direction) {
      const currentIndex = homeDestinationOrder.indexOf(activeTab);
      const nextIndex = currentIndex + direction;
      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= homeDestinationOrder.length) return false;
      return activateHomeDestination(homeDestinationOrder[nextIndex]);
    }

    document.addEventListener("touchstart", (event) => {
      resetHomeDestinationSwipe();
      if (
        window.innerWidth > 720 ||
        event.touches.length !== 1 ||
        !homeDestinationIsSelected() ||
        homeDestinationSwipeBlocked(event.target)
      ) return;
      const touch = event.touches[0];
      if (
        touch.clientX <= HOME_DESTINATION_SWIPE_EDGE_GUARD_PX ||
        touch.clientX >= window.innerWidth - HOME_DESTINATION_SWIPE_EDGE_GUARD_PX
      ) return;
      homeDestinationSwipe.startX = touch.clientX;
      homeDestinationSwipe.startY = touch.clientY;
      homeDestinationSwipe.startedAt = Date.now();
      homeDestinationSwipe.tracking = true;
    }, { passive: true, capture: true });

    document.addEventListener("touchmove", (event) => {
      if (!homeDestinationSwipe.tracking || event.touches.length !== 1) {
        resetHomeDestinationSwipe();
        return;
      }
      const touch = event.touches[0];
      const deltaX = touch.clientX - homeDestinationSwipe.startX;
      const deltaY = touch.clientY - homeDestinationSwipe.startY;
      const distanceX = Math.abs(deltaX);
      const distanceY = Math.abs(deltaY);

      if (homeDestinationSwipe.axis === "pending") {
        if (
          distanceX < HOME_DESTINATION_SWIPE_DIRECTION_LOCK_PX &&
          distanceY < HOME_DESTINATION_SWIPE_DIRECTION_LOCK_PX
        ) return;
        if (distanceY > distanceX * HOME_DESTINATION_SWIPE_HORIZONTAL_RATIO) {
          resetHomeDestinationSwipe();
          return;
        }
        if (distanceX <= distanceY * HOME_DESTINATION_SWIPE_HORIZONTAL_RATIO) return;
        homeDestinationSwipe.axis = "horizontal";
      }

      setHomeDestinationSwipeOffset(deltaX);
      if (event.cancelable) event.preventDefault();
    }, { passive: false, capture: true });

    document.addEventListener("touchend", (event) => {
      if (!homeDestinationSwipe.tracking || event.changedTouches.length !== 1) {
        resetHomeDestinationSwipe();
        return;
      }
      const touch = event.changedTouches[0];
      const deltaX = touch.clientX - homeDestinationSwipe.startX;
      const deltaY = touch.clientY - homeDestinationSwipe.startY;
      const elapsed = Math.max(1, Date.now() - homeDestinationSwipe.startedAt);
      const distanceX = Math.abs(deltaX);
      const velocity = distanceX / elapsed;
      const isDeliberate =
        distanceX >= HOME_DESTINATION_SWIPE_MIN_PX ||
        (
          distanceX >= HOME_DESTINATION_SWIPE_FLICK_MIN_PX &&
          velocity >= HOME_DESTINATION_SWIPE_FLICK_VELOCITY
        );
      const isHorizontal =
        distanceX > Math.abs(deltaY) * HOME_DESTINATION_SWIPE_HORIZONTAL_RATIO;
      resetHomeDestinationSwipe();
      if (
        elapsed > HOME_DESTINATION_SWIPE_MAX_MS ||
        !isDeliberate ||
        !isHorizontal
      ) return;
      const moved = moveToAdjacentHomeDestination(deltaX < 0 ? 1 : -1);
      if (moved) event.preventDefault();
    }, { passive: false, capture: true });

    document.addEventListener("touchcancel", resetHomeDestinationSwipe, { passive: true, capture: true });

    homeFeedReturnHomeBtn?.addEventListener("click", returnToHomeDiscoveryMain);
    brandHome.addEventListener("click", returnToHomeDiscoveryMain);

    function cityPickerOptionMarkup(city) {
      const safeCity = escapeHtml(city);
      const selected = !userLocationOutsideMarkets && city === citySelect?.value;
      const stats = city === ALL_CITIES && cityDiscoveryStatsByName.size
        ? [...cityDiscoveryStatsByName.values()].reduce((total, item) => ({ dancers: total.dancers + item.dancers, venues: total.venues + item.venues }), { dancers: 0, venues: 0 })
        : cityDiscoveryStatsByName.get(city);
      const statsLabel = stats
        ? `${stats.dancers.toLocaleString()} ${stats.dancers === 1 ? "dancer" : "dancers"} · ${stats.venues.toLocaleString()} ${stats.venues === 1 ? "club" : "clubs"}`
        : "";
      return `<button class="venue-picker-option city-picker-option" type="button" role="option" data-city-picker-value="${safeCity}" aria-selected="${selected}"><span class="venue-picker-radio" aria-hidden="true"></span><span class="venue-picker-option-name">${safeCity}</span>${statsLabel ? `<span class="city-picker-stats">${escapeHtml(statsLabel)}</span>` : ""}</button>`;
    }