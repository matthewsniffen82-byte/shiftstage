

    function activeSupportRole() {
      if (isVenueSession()) return "venue";
      if (isDancerSession()) return "dancer";
      if (isCustomerSession()) return "customer";
      if (isVenueLoggedIn) return "venue";
      if (isDancerLoggedIn) return "dancer";
      if (isCustomerLoggedIn) return "customer";
      return "";
    }

    function openContactAdmin() {
      const role = activeSupportRole();
      if (!role) {
        openPublicContactForm();
        return;
      }
      if (role === "venue") return openUnifiedDashboard("venue", "venue-support");
      if (role === "customer") return openUnifiedDashboard("customer", "customer-support");
      return openUnifiedDashboard("dancer", "dancer-support");
    }

    async function submitPublicContactForm(event) {
      event.preventDefault();
      if (!publicContactForm || !publicContactStatus) return;
      const submitButton = publicContactForm.querySelector('button[type="submit"]');
      if (submitButton?.disabled) return;
      const formData = new FormData(publicContactForm);
      const name = String(formData.get("name") || "").trim();
      const email = String(formData.get("email") || "").trim();
      const subject = String(formData.get("subject") || "").trim();
      const message = String(formData.get("message") || "").trim();
      if (!subject || !message) {
        publicContactStatus.dataset.state = "error";
        publicContactStatus.textContent = "Add a subject and message before sending.";
        return;
      }
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = "Sending…";
      }
      delete publicContactStatus.dataset.state;
      publicContactStatus.textContent = "Sending your message…";
      try {
        const details = [
          "Footer contact message",
          `Name: ${name || "Not provided"}`,
          `Email: ${email || "Not provided"}`,
          `Page: ${window.location.href}`,
          "",
          "Message:",
          message
        ].join("\n");
        const data = await postOptionalAuthJson("/api/reports", {
          targetType: "contact_message",
          targetId: null,
          targetLabel: email || name || "Unsigned visitor",
          reason: subject,
          details
        });
        if (data?.report) {
          liveAdminReports = [data.report, ...liveAdminReports.filter((item) => item.id !== data.report.id)];
        }
        publicContactStatus.dataset.state = "success";
        publicContactStatus.textContent = "Message sent. Thanks for getting in touch.";
        publicContactForm.reset();
      } catch (error) {
        publicContactStatus.dataset.state = "error";
        publicContactStatus.textContent = error?.message || "Unable to send message right now.";
      } finally {
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = "Send message";
        }
      }
    }

    function closeDemoSurfaces() {
      closeAuthPage();
      closeDancerSignupPage();
      closeStripeCheckoutPage();
      closeDashboard();
      closeDancerDashboard();
      closeVenueDashboard();
      closeAdminDashboard();
      closeProfileModal();
      closeUtilityMenu();
    }

    function openApprovedDancerDemo() {
      closeDemoSurfaces();
      resetAccountControl("dancer");
      citySelect.value = "Las Vegas";
      document.getElementById("dancerLegalName").value = "";
      document.getElementById("dancerStageName").value = "";
      document.getElementById("dancerEmail").value = "";
      document.getElementById("dancerCity").value = "Las Vegas";
      Object.assign(dancerSetup, {
        profile: true,
        photos: true,
        review: true,
        approval: true,
        shift: true
      });
      dancerSignupStarted = true;
      stripeConfirmed = true;
      setupChecklistExpanded = false;
      activeSetupStep = "";
      isCustomerLoggedIn = false;
      isDancerLoggedIn = true;
      isVenueLoggedIn = false;
      activeDashboardType = "dancer";
      updateAccountHeader();
      ensureActiveDancerProfile("Verified");
      showToast("Dancer setup opened");
      openDancerDashboard();
    }

    function openPendingDancerDemo() {
      closeDemoSurfaces();
      resetAccountControl("dancer");
      citySelect.value = "Las Vegas";
      document.getElementById("dancerLegalName").value = "";
      document.getElementById("dancerStageName").value = "";
      document.getElementById("dancerEmail").value = "";
      document.getElementById("dancerCity").value = "Las Vegas";
      Object.assign(dancerSetup, {
        profile: true,
        photos: true,
        review: true,
        approval: false,
        shift: false
      });
      dancerSignupStarted = true;
      stripeConfirmed = true;
      setupChecklistExpanded = true;
      activeSetupStep = "approval";
      isCustomerLoggedIn = false;
      isDancerLoggedIn = true;
      isVenueLoggedIn = false;
      activeDashboardType = "dancer";
      updateAccountHeader();
      ensureActiveDancerProfile("Pending");
      showToast("Dancer review opened");
      openDancerDashboard();
    }

    function openApprovedCustomerDemo() {
      closeDemoSurfaces();
      resetAccountControl("customer");
      citySelect.value = "Las Vegas";
      isCustomerLoggedIn = true;
      isDancerLoggedIn = false;
      isVenueLoggedIn = false;
      activeDashboardType = "customer";
      dashboardTonightExpanded = false;
      dashboardFollowedExpanded = false;
      dashboardVenuesExpanded = false;
      updateAccountHeader();
      showToast("Guest dashboard");
      openDashboard();
    }

    function openBrowsingCustomerDemo() {
      closeDemoSurfaces();
      citySelect.value = "Las Vegas";
      isCustomerLoggedIn = false;
      isDancerLoggedIn = false;
      isVenueLoggedIn = false;
      activeDashboardType = "customer";
      activeTab = "tonight";
      selectedVenueName = null;
      tonightExpanded = false;
      dancersExpanded = false;
      dashboardTonightExpanded = false;
      dashboardFollowedExpanded = false;
      dashboardVenuesExpanded = false;
      updateAccountHeader();
      document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item.dataset.tab === "tonight"));
      render();
      showToast("Browsing as a guest");
    }

    function openCustomerSignupDemo() {
      closeDemoSurfaces();
      isCustomerLoggedIn = false;
      isDancerLoggedIn = false;
      isVenueLoggedIn = false;
      activeDashboardType = "customer";
      document.getElementById("customerEmail").value = "";
      updateAccountHeader();
      openAuthPage();
      openCustomerSignup();
      showToast("Guest sign up");
    }

    function startCustomerDashboardSession(message = "Guest dashboard") {
      resetAccountControl("customer");
      isCustomerLoggedIn = true;
      isDancerLoggedIn = false;
      isVenueLoggedIn = false;
      activeDashboardType = "customer";
      dashboardTonightExpanded = false;
      dashboardFollowedExpanded = false;
      dashboardVenuesExpanded = false;
      updateAccountHeader();
      closeAuthPage();
      showToast(message);
      openUnifiedDashboard("customer");
    }

    function dancerProfileMediaReady() {
      const profile = activeDancerProfile();
      const avatarSaved = Boolean(profile?.avatarStoragePath || profile?.avatar_storage_path);
      return Boolean(dancerSetup.profile && dancerSetup.photos && avatarSaved);
    }

    function setupOrder() {
      return ["profile", "approval"];
    }

    function isSavedSetupStepComplete(step) {
      if (step === "profile") return dancerProfileMediaReady() && Boolean(dancerSetup.review);
      return Boolean(dancerSetup[step]);
    }

    function firstUnsavedSetupRequirement(step) {
      const index = setupOrder().indexOf(step);
      if (index < 0) return null;
      return setupOrder().slice(0, index).find((requiredStep) => !isSavedSetupStepComplete(requiredStep)) || null;
    }

    function setupStepDisplayName(step) {
      const labels = {
        profile: "profile, media, and submission",
        approval: "venue affiliation"
      };
      return labels[step] || "previous step";
    }

    function canOpenStep(step) {
      const index = setupOrder().indexOf(step);
      if (index < 0) return false;
      return firstUnsavedSetupRequirement(step) === null;
    }

    function nextIncompleteStep() {
      return setupOrder().find((step) => !isSavedSetupStepComplete(step)) || null;
    }

    function completeSetupStep(step, options = {}) {
      if (!canOpenStep(step)) return;
      if (step === "approval" && isDancerSession()) {
        showToast("Complete this step by tapping the club's official dressing-room sticker.");
        return;
      }
      setupChecklistExpanded = true;
      dancerSetup[step] = true;
      if (step === "profile") freshDancerVerificationLockedToProfile = false;
      if (step === "profile") ensureActiveDancerProfile("Pending");
      if (step === "approval") ensureActiveDancerProfile("Verified");
      activeSetupStep = options.keepOpen ? step : (nextIncompleteStep() || step);
      renderDancerSetup();
    }

    function dancerProfileSetupStorageKey() {
      const userKey =
        authSession?.user?.id ||
        normalizeAccountEmail(authSession?.account?.email) ||
        normalizeAccountEmail(authSession?.email) ||
        normalizeAccountEmail(authSession?.user?.email) ||
        normalizeAccountEmail(document.getElementById("dancerEmail")?.value) ||
        "dancer";
      return `mydancr:dancer-profile-setup-saved:${userKey}`;
    }

    function markDancerProfileSetupSaved(saved = true) {
      try {
        if (saved) localStorage.setItem(dancerProfileSetupStorageKey(), "true");
        else localStorage.removeItem(dancerProfileSetupStorageKey());
      } catch (error) {}
    }

    function dancerProfileDraftStorageKey() {
      return `${dancerProfileSetupStorageKey()}:draft`;
    }

    function currentDancerProfileDraft() {
      return {
        stageName: document.getElementById("dancerStageName")?.value || "",
        city: document.getElementById("dancerCity")?.value || "",
        socials: { ...dancerSignupSocials },
        updatedAt: Date.now()
      };
    }

    function readStoredDancerProfileDraft() {
      try {
        const draft = JSON.parse(localStorage.getItem(dancerProfileDraftStorageKey()) || "null");
        return draft && typeof draft === "object" ? draft : null;
      } catch (error) {
        return null;
      }
    }

    function clearStoredDancerProfileDraft() {
      try {
        localStorage.removeItem(dancerProfileDraftStorageKey());
      } catch (error) {}
    }

    function hasCompletedDancerProfileSetup(profile = {}) {
      const identitySavedAt = String(profile.identity_saved_at || profile.identitySavedAt || "").trim();
      const stageName = String(profile.stage_name || profile.stageName || "").trim();
      const city = String(profile.city || profile.cityName || "").trim();
      return Boolean(identitySavedAt && stageName && city);
    }

    function saveDancerProfileDraft(update = {}) {
      const draft = {
        ...currentDancerProfileDraft(),
        ...update,
        socials: {
          ...dancerSignupSocials,
          ...(update.socials || {})
        },
        dirty: true,
        updatedAt: Date.now()
      };
      try {
        localStorage.setItem(dancerProfileDraftStorageKey(), JSON.stringify(draft));
      } catch (error) {}
    }

    function captureDancerSetupProfileDraft() {
      const editor = document.querySelector("[data-setup-profile-editor]");
      const form = editor?.querySelector('[data-setup-form="profile"]') || document.querySelector('[data-setup-form="profile"]');
      if (!form) return readStoredDancerProfileDraft();
      const stageName = form.querySelector("#setupStageName")?.value ?? document.getElementById("dancerStageName")?.value ?? "";
      const city = form.querySelector("#setupCity")?.value ?? document.getElementById("dancerCity")?.value ?? "";
      const socials = { ...dancerSignupSocials };
      (editor || form).querySelectorAll("[data-setup-social]").forEach((field) => {
        socials[field.dataset.setupSocial] = field.value;
      });
      setDancerSetupField("dancerStageName", stageName);
      setDancerSetupField("dancerCity", city);
      assignSocialMap(dancerSignupSocials, socials);
      saveDancerProfileDraft({ stageName, city, socials });
      return readStoredDancerProfileDraft();
    }

    function applyStoredDancerProfileDraft() {
      const draft = readStoredDancerProfileDraft();
      if (!draft) return false;
      const socials = draft.socials && typeof draft.socials === "object" ? draft.socials : {};
      setDancerSetupField("dancerStageName", draft.stageName || "");
      setDancerSetupField("dancerCity", draft.city || "");
      Object.assign(dancerSignupSocials, {
        instagram: socials.instagram || "",
        tiktok: socials.tiktok || "",
        snapchat: socials.snapchat || "",
        onlyfans: socials.onlyfans || "",
        x: socials.x || ""
      });
      updateDancerDashboardName(draft.stageName || "");
      return true;
    }

    function escapeHtml(value) {
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function profileReviewNoticeMarkup(reviewSubmitted = false) {
      const message = profileSubmitNotice || (reviewSubmitted
        ? "Your profile and media were submitted successfully. MyDancr will notify you by email and in your site notifications when the review is complete."
        : "");
      if (!message) return "";
      const tone = profileSubmitNotice ? (profileSubmitNoticeTone || "success") : "success";
      const heading = tone === "error" ? "Submission not completed" : "Submitted for review";
      return `
        <div class="rule-note verification-review-notice is-${tone}" role="${tone === "error" ? "alert" : "status"}" aria-live="polite">
          <strong>${heading}</strong>
          <span>${escapeHtml(message)}</span>
        </div>
      `;
    }

    const approvedProfilePhotoAccountIds = new WeakMap();

    async function uploadSetupPhotoFile(file, isPrimary, sortOrder, options = {}) {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("isPrimary", isPrimary ? "true" : "false");
      formData.append("sortOrder", String(sortOrder));
      formData.append("idempotencyKey", `${file.name}:${file.size}:${file.lastModified}:${isPrimary}:${sortOrder}:${Date.now()}:${Math.random().toString(36).slice(2)}`);
      if (options.replaceExisting) formData.append("replaceExisting", "true");
      if (options.replacementPhotoId) formData.append("replacementPhotoId", options.replacementPhotoId);
      const session = synchronizeAuthSession();
      const photoAccountId = approvedProfilePhotoAccountIds.get(file);
      if (photoAccountId && session?.account?.id !== photoAccountId) {
        throw new DOMException("Your account changed. Select the photo again.", "AbortError");
      }
      const headers = authenticatedRequestHeaders(undefined, session);
      if (!headers) throw new Error("Sign in required");
      const response = await fetch("/api/dancer/photos", {
        method: "POST",
        headers,
        body: formData
      });
      const data = await response.json().catch(() => ({}));
      if (normalizedReviewStatus(data?.decision) === "rejected") return data;
      if (!response.ok || data.ok === false) {
        throw new Error(normalizeRequestError(data.message || data.error, "Photo upload failed"));
      }
      applyResponseSession(data, headers);
      return data;
    }

    async function cropApprovedProfilePhoto(file) {
      if (!window.DancrPhotoCrop) throw new Error("The photo editor is still loading. Please try again.");
      const accountId = synchronizeAuthSession()?.account?.id;
      if (!accountId || !isDancerSession()) throw new Error("Sign in as a dancer to upload photos.");
      const photoAccountId = approvedProfilePhotoAccountIds.get(file);
      if (photoAccountId && photoAccountId !== accountId) {
        throw new DOMException("Your account changed. Select the photo again.", "AbortError");
      }
      approvedProfilePhotoAccountIds.set(file, accountId);
      const controller = new AbortController();
      const requireCropSession = () => {
        const session = synchronizeAuthSession();
        if (!isDancerSession() || session?.account?.id !== accountId || controller.signal.aborted) {
          throw new DOMException("Your account changed. Select the photo again.", "AbortError");
        }
        return session;
      };
      const cancelChangedAccountCrop = (event) => {
        if (event.key !== "dancrAuthSessionV1" && event.key !== null) return;
        try { requireCropSession(); } catch { controller.abort(); }
      };
      window.addEventListener("storage", cancelChangedAccountCrop);
      try {
        const cropped = await window.DancrPhotoCrop.crop(file, {
          signal: controller.signal,
          prepare: async (original, signal) => {
            const headers = authenticatedRequestHeaders(undefined, requireCropSession());
            const body = new FormData();
            body.set("file", original);
            const response = await fetch("/api/dancer/photos/preview", { method: "POST", headers, body, signal });
            const data = await response.json().catch(() => ({}));
            requireCropSession();
            if (!response.ok || data.ok === false) throw new Error(normalizeRequestError(data.error, "Unable to prepare this photo for cropping."));
            applyResponseSession(data, headers);
            return data.imageDataUrl;
          }
        });
        requireCropSession();
        if (!cropped) throw new DOMException("Photo crop canceled. No photo was added to your profile.", "AbortError");
        approvedProfilePhotoAccountIds.set(cropped, accountId);
        return cropped;
      } finally {
        window.removeEventListener("storage", cancelChangedAccountCrop);
        controller.abort();
      }
    }

    async function uploadApprovedDancerPhoto(file, target) {
      if (!isDancerSession()) throw new Error("Sign in as a dancer to upload live photos.");
      const selectionProfile = activeDancerProfile();
      const replacement = isReplacingApprovedPhotoTarget(selectionProfile, target)
        ? selectedPhotoReplacement(selectionProfile, target)
        : null;
      file = await cropApprovedProfilePhoto(file);
      let profile = activeDancerProfile() || ensureActiveDancerProfile("Verified");
      profile = await persistQueuedApprovedPhotoDeletionsBeforeUpload(profile);
      const submittedIndex = String(target || "").startsWith("submitted:") ? Number(String(target).split(":")[1]) : -1;
      const galleryIndex = String(target || "").startsWith("gallery:") ? Number(String(target).split(":")[1]) : -1;
      const requestedAddSortOrder = String(target || "").startsWith("gallery-add:")
        ? Number(String(target).split(":")[1])
        : -1;
      const replacingSubmitted = Number.isInteger(submittedIndex) && submittedIndex >= 0;
      const existingSubmitted = replacingSubmitted ? profile?.submittedPhotos?.[submittedIndex] : null;
      const isPrimary = replacement ? replacement.isPrimary : target === "main" || Boolean(existingSubmitted?.isPrimary || existingSubmitted?.is_primary);
      const replacingExistingPhoto = Boolean(replacement);
      assertDancerProfilePhotoLimit(profile, { replacing: replacingExistingPhoto });
      const sortOrder = replacement ? replacement.sortOrder : replacingSubmitted
        ? Number(existingSubmitted?.sortOrder ?? existingSubmitted?.sort_order ?? (isPrimary ? 0 : submittedIndex + 1))
        : target === "main"
          ? 0
          : galleryIndex >= 0
            ? galleryIndex + 1
            : Number.isInteger(requestedAddSortOrder) && requestedAddSortOrder > 0
              ? requestedAddSortOrder
              : nextAvailableApprovedGallerySortOrder(profile);
      const data = await uploadSetupPhotoFile(file, isPrimary, sortOrder, { replaceExisting: replacingExistingPhoto, replacementPhotoId: replacement?.id });
      const uploadDecision = normalizedReviewStatus(data?.decision);
      if (!["approved", "review", "moderation_retry", "moderation_error", "rejected"].includes(uploadDecision)) {
        throw new Error("Dancr could not confirm the photo upload status. Please try again.");
      }
      let uploadedPhotoTarget = target;
      if (profile) {
        const uploaded = data?.photo || data || {};
        const serverSortOrder = Number(uploaded.sortOrder ?? uploaded.sort_order);
        const resolvedSortOrder = Number.isInteger(serverSortOrder) && serverSortOrder >= 0 ? serverSortOrder : sortOrder;
        const persistedImageUrl = uploaded.imageUrl || uploaded.image_url || uploaded.url || "";
        const imageUrl = persistedImageUrl || (uploadDecision !== "rejected" ? URL.createObjectURL(file) : "");
        const uploadReviewStatus = uploadDecision;
        const approvedUpload = uploadReviewStatus === "approved";
        const rejectedUpload = uploadReviewStatus === "rejected";
        const pendingUpload = !approvedUpload && !rejectedUpload;
        if (approvedUpload && (!uploaded.id || !(uploaded.storage_path || uploaded.storagePath) || !persistedImageUrl)) {
          throw new Error("Dancr saved the upload but could not verify its photo record. Please try again.");
        }
        const photo = {
          id: uploaded.id || data?.moderationRecordId || `${profile.id || profile.name}-resubmitted-photo-${Date.now()}`,
          imageUrl,
          image_url: imageUrl,
          isPrimary,
          is_primary: isPrimary,
          reviewStatus: approvedUpload ? "approved" : rejectedUpload ? "rejected" : "pending",
          review_status: approvedUpload ? "approved" : rejectedUpload ? "rejected" : "pending",
          reviewNotes: approvedUpload ? "" : rejectedUpload ? (data?.message || "Rejected by automatic moderation.") : "Pending review. This slot stays occupied until approval or rejection.",
          review_notes: approvedUpload ? "" : rejectedUpload ? (data?.message || "Rejected by automatic moderation.") : "Pending review. This slot stays occupied until approval or rejection.",
          sortOrder: resolvedSortOrder,
          sort_order: resolvedSortOrder
        };
        const submittedPhotos = [...(profile.submittedPhotos || [])];
        if (approvedUpload && imageUrl) {
          const completedIds = new Set([data?.moderationRecordId, uploaded.id, replacement?.id].filter(Boolean).map(String));
          profile.submittedPhotos = submittedPhotos.filter((item) => !completedIds.has(String(item.id)));
          const existingRows = Array.isArray(profile.dancer_photos) ? profile.dancer_photos : [];
          profile.dancer_photos = [
            ...existingRows.filter((item) => {
              const sameMain = isPrimary && Boolean(item.is_primary || item.isPrimary);
              const sameGallery = !isPrimary && !(item.is_primary || item.isPrimary) && Number(item.sort_order ?? item.sortOrder ?? 0) === resolvedSortOrder;
              return !sameMain && !sameGallery;
            }),
            {
              ...uploaded,
              id: photo.id,
              storage_path: uploaded.storage_path || uploaded.storagePath || "",
              imageUrl,
              is_primary: isPrimary,
              isPrimary,
              sort_order: resolvedSortOrder,
              sortOrder: resolvedSortOrder,
              review_status: "approved",
              reviewStatus: "approved",
              created_at: new Date().toISOString()
            }
          ];
          const galleryUrls = Array.isArray(profile.galleryPhotoUrls) ? profile.galleryPhotoUrls.filter(Boolean) : [];
          if (isPrimary) {
            profile.mainPhotoUrl = imageUrl;
            profile.mainPhotoFocalX = uploaded.focalX ?? uploaded.imageFocalX ?? 50;
            profile.mainPhotoFocalY = uploaded.focalY ?? uploaded.imageFocalY ?? 50;
            profile.galleryPhotoUrls = [...new Set(galleryUrls.filter((url) => url !== imageUrl))].slice(0, MAX_DANCER_PROFILE_PHOTOS - 1);
            uploadedPhotoTarget = "main";
          } else {
            const nextGallery = galleryUrls.filter((url) => url !== imageUrl);
            if (galleryIndex >= 0) nextGallery[galleryIndex] = imageUrl;
            else nextGallery.push(imageUrl);
            profile.galleryPhotoUrls = [...new Set(nextGallery.filter(Boolean))].slice(0, MAX_DANCER_PROFILE_PHOTOS - 1);
            uploadedPhotoTarget = `gallery:${Math.max(0, resolvedSortOrder - 1)}`;
          }
          normalizeLocalDancerPhotos(profile);
          profile.photoStatus = "Approved";
          profile.approvalChangesPending = false;
          profile.approvalChangesSubmitted = false;
        } else if (pendingUpload) {
          profile.submittedPhotos = [...submittedPhotos.filter((item) => String(item.id) !== String(photo.id)), photo]
            .sort((left, right) => Number(left.sortOrder ?? left.sort_order ?? 0) - Number(right.sortOrder ?? right.sort_order ?? 0));
          normalizeLocalDancerPhotos(profile);
          uploadedPhotoTarget = `pending:${photo.id}`;
          profile.photoStatus = "Pending";
          profile.approvalChangesPending = true;
          profile.approvalChangesSubmitted = false;
        } else {
          profile.photoStatus = "Rejected";
        }
        if (dancerCoreApprovalUnlocked(profile)) {
          profile.status = "Verified";
          profile.reviewSubmitted = false;
        }
      }
      return { ...data, photoTarget: uploadedPhotoTarget };
    }

    function dancerPhotoIdentityKeys(photo = {}) {
      return [...new Set([
        photo.id,
        photo.storage_path,
        photo.storagePath,
        photo.imageUrl,
        photo.image_url,
        photo.url
      ].map(normalizeDancerPhotoKey).filter(Boolean))];
    }

    function dancerPhotoDisplayUrl(photo = {}) {
      return String(
        photo.imageUrl ||
        photo.image_url ||
        photo.url ||
        photo.storage_path ||
        photo.storagePath ||
        ""
      ).trim();
    }

    function confirmedApprovedDancerPhoto(profile, uploadResult) {
      if (normalizedReviewStatus(uploadResult?.decision) !== "approved") return null;
      const uploaded = uploadResult?.photo || {};
      const uploadedId = String(uploaded.id || "").trim();
      const uploadedStoragePath = String(uploaded.storage_path || uploaded.storagePath || "").trim();
      const uploadedImageUrl = dancerPhotoDisplayUrl(uploaded);
      if (!uploadedId || !uploadedStoragePath || !uploadedImageUrl) return null;
      const uploadedKeys = new Set(dancerPhotoIdentityKeys(uploaded));
      return (Array.isArray(profile?.dancer_photos) ? profile.dancer_photos : []).find((photo) => {
        const status = normalizedReviewStatus(photo.review_status || photo.reviewStatus);
        const matchesUpload = dancerPhotoIdentityKeys(photo).some((key) => uploadedKeys.has(key));
        return status === "approved" && matchesUpload && Boolean(dancerPhotoDisplayUrl(photo));
      }) || null;
    }

    async function hydrateConfirmedApprovedDancerPhoto(uploadResult) {
      if (!confirmedApprovedDancerPhoto({ dancer_photos: [uploadResult?.photo] }, uploadResult)) {
        throw new Error("Dancr saved the upload but could not verify its photo record. Please try again.");
      }
      const data = await getAuthenticatedJson("/api/dancer/profile");
      const confirmedPhoto = confirmedApprovedDancerPhoto(data?.profile, uploadResult);
      if (!data?.profile || !confirmedPhoto) {
        throw new Error("The photo was saved but could not be loaded into your profile. Please refresh and try again.");
      }
      applyDancerApprovalProfile(data.profile);
      const localProfile = activeDancerProfile(data.profile.city || data.profile.cityName || activeDancerCity());
      const visiblePhoto = confirmedApprovedDancerPhoto(localProfile, uploadResult);
      if (!localProfile || !visiblePhoto) {
        throw new Error("The photo was saved but could not be displayed in your profile. Please refresh and try again.");
      }
      const isPrimary = Boolean(confirmedPhoto.is_primary || confirmedPhoto.isPrimary);
      const sortOrder = Number(confirmedPhoto.sort_order ?? confirmedPhoto.sortOrder ?? 0);
      return {
        ...uploadResult,
        photo: {
          ...confirmedPhoto,
          imageUrl: dancerPhotoDisplayUrl(confirmedPhoto)
        },
        photoTarget: isPrimary ? "main" : `gallery:${Math.max(0, sortOrder - 1)}`
      };
    }

    async function deleteApprovedDancerPhoto(deleteRequest) {
      const profile = activeDancerProfile() || ensureActiveDancerProfile("Verified");
      if (!profile) return false;
      const request = typeof deleteRequest === "string" ? { target: deleteRequest } : (deleteRequest || {});
      const requestedPhotoId = String(request.photoId || "");
      const target = String(request.target || "");
      const photos = approvedVisualPhotoItems(profile);
      console.log("DELETE_HANDLER_RECEIVED", {
        photoId: requestedPhotoId,
        label: request.label || "",
        target,
        currentPhotos: photos.map((photo) => ({
          id: photo.id,
          target: photo.target,
          sortOrder: photo.sort_order ?? photo.sortOrder ?? null,
          isPrimary: Boolean(photo.is_primary || photo.isPrimary || photo.target === "main")
        }))
      });
      const targetPhoto = requestedPhotoId
        ? photos.find((photo) => String(photo.id || "") === requestedPhotoId)
        : photos.find((photo) => String(photo.target || "") === target);
      const submittedIndex = String(target || "").startsWith("submitted:") ? Number(String(target).split(":")[1]) : -1;
      const galleryIndex = String(target || "").startsWith("gallery:") ? Number(String(target).split(":")[1]) : -1;
      let removed = false;
      let deletedLivePhotoId = targetPhoto?.id && !["main"].includes(String(targetPhoto.id)) && !String(targetPhoto.id).startsWith("gallery-")
        ? String(targetPhoto.id)
        : "";
      let deletedPhotoUrl = request.photoUrl || targetPhoto?.imageUrl || photoUrlFromTarget(profile, target, submittedIndex, galleryIndex);
      console.log("DELETE_TARGET_RESOLVED", {
        requestedPhotoId,
        resolvedPhotoId: targetPhoto?.id || deletedLivePhotoId || "",
        target,
        storagePath: request.storagePath || targetPhoto?.storagePath || targetPhoto?.storage_path || ""
      });
      if (targetPhoto?.id) {
        removed = true;
      } else if (Number.isInteger(submittedIndex) && submittedIndex >= 0 && profile.submittedPhotos?.[submittedIndex]) {
        deletedLivePhotoId = profile.submittedPhotos[submittedIndex]?.id || "";
        removed = true;
      } else if (target === "main" && profile.mainPhotoUrl) {
        removed = true;
      } else if (Number.isInteger(galleryIndex) && galleryIndex >= 0 && Array.isArray(profile.galleryPhotoUrls)) {
        removed = true;
      }
      if (!removed) return false;
      const locallyRemoved = removeLocalDancerPhoto(profile, {
        target,
        photoId: deletedLivePhotoId || requestedPhotoId,
        photoUrl: deletedPhotoUrl,
        storagePath: request.storagePath || targetPhoto?.storagePath || targetPhoto?.storage_path || ""
      });
      if (activeApprovedVisualPhotoTarget === target || activeApprovedVisualPhotoTarget === deletedLivePhotoId) activeApprovedVisualPhotoTarget = "";
      profile.approvalChangesPending = true;
      profile.approvalChangesSubmitted = false;
      if (dancerCoreApprovalUnlocked(profile)) {
        profile.status = "Verified";
        profile.reviewSubmitted = false;
      }
      profile.photoStatus = approvedVisualPhotoItems(profile).some((photo) => photo.status === "pending") ? "Pending" : "Approved";
      logPhotoReplacementDebug(profile, [deletedLivePhotoId || requestedPhotoId].filter(Boolean));
      render();
      renderDancerManagement();
      renderApprovedVisualProfileEditor();
      syncApprovedProfileSubmitState();
      render();
      renderDancerManagement();
      renderApprovedVisualProfileEditor();
      return locallyRemoved || removed;
    }

    async function hydrateDancerApprovalProgress() {
      if (!isDancerSession()) return null;
      if (freshDancerVerificationLockedToProfile) {
        Object.assign(dancerSetup, {
          profile: false,
          photos: false,
          review: false,
          approval: false,
          shift: dancerSetup.shift
        });
        activeSetupStep = "profile";
        renderDancerSetupWhenEditorIdle();
        return null;
      }
      try {
        const data = await getAuthenticatedJson("/api/dancer/profile");
        if (!data?.profile) return null;
        applyDancerApprovalProfile(data.profile);
        renderDancerSetupWhenEditorIdle();
        return data.profile;
      } catch (error) {
        return null;
      }
    }

    function applyDancerApprovalProfile(profile) {
      const expandedStepBeforeApply = setupChecklistExpanded && setupOrder().includes(activeSetupStep)
        ? activeSetupStep
        : "";
      const approved = dancerCoreApprovalUnlocked(profile);
      const rejected = isRejectedDancerStatus(profile.status);
      const submittedForReview = normalizedReviewStatus(profile.status) === "pending_review";
      const savedProfileSetup = approved || rejected || hasCompletedDancerProfileSetup(profile);
      const savedStageName = String(profile.identity_saved_at || profile.identitySavedAt || "").trim()
        ? (profile.stage_name || profile.stageName || "")
        : "";
      const draft = readStoredDancerProfileDraft();
      const useDraftFields = Boolean(draft && (draft.dirty === true || !savedProfileSetup));
      const liveSocials = dancerSocialMapFromProfile(profile);
      const draftSocials = draft?.socials && typeof draft.socials === "object" ? draft.socials : {};
      const legalName = useDraftFields ? (draft.legalName || profile.real_name || profile.realName || "") : (profile.real_name || profile.realName || draft?.legalName || "");
      const stageName = useDraftFields ? (draft.stageName || savedStageName) : (savedStageName || draft?.stageName || "");
      const city = useDraftFields ? (draft.city || profile.city || profile.cityName || "") : (profile.city || profile.cityName || draft?.city || "");
      const photos = dancerProfilePhotoUrls(profile);
      const submittedPhotos = dancerSubmittedPhotosFromProfile(profile);
      const dancerPhotos = Array.isArray(profile?.dancer_photos)
        ? profile.dancer_photos.map((photo) => ({
          ...photo,
          imageUrl: photo.imageUrl || photo.image_url || photo.url || photo.storage_path || "",
          storagePath: photo.storagePath || photo.storage_path || ""
        }))
        : [];
      const socialLinks = Array.isArray(profile.social_links)
        ? profile.social_links.map((social) => ({
          id: social.id,
          platform: social.platform,
          handle: social.handle,
          url: social.url,
          isActive: social.is_active !== false,
          is_active: social.is_active !== false
        }))
        : [];

      setDancerSetupField("dancerLegalName", legalName);
      setDancerSetupField("dancerStageName", stageName);
      setDancerSetupField("dancerCity", city);
      updateDancerDashboardName(stageName);

      assignSocialMap(dancerSignupSocials, useDraftFields ? { ...liveSocials, ...draftSocials } : liveSocials);
      Object.assign(dancerSetup, {
        profile: savedProfileSetup,
        photos: dancerProfileMediaModerationComplete(profile),
        review: approved || Boolean(profile.reviewSubmitted || normalizedReviewStatus(profile.status) === "pending_review"),
        approval: approved,
        shift: dancerSetup.shift
      });

      if (approved) markDancerProfileSetupSaved(true);
      setupChecklistExpanded = Boolean(expandedStepBeforeApply) || rejected || !approved;
      activeSetupStep = expandedStepBeforeApply || (rejected ? "approval" : (nextIncompleteStep() || (approved ? "approval" : "profile")));
      ensureLocalDancerApprovalNotification(profile);

      const localProfile = ensureActiveDancerProfile(approved ? "Verified" : rejected ? "Rejected" : "Pending");
      if (localProfile) {
        Object.assign(localProfile, {
          id: profile.id || localProfile.id,
          name: stageName || localProfile.name,
          city: city || localProfile.city || citySelect.value || "Las Vegas",
          mainPhotoUrl: photos[0] || "",
          mainPhotoFocalX: dancerPhotos[0]?.focalX ?? dancerPhotos[0]?.imageFocalX ?? 50,
          mainPhotoFocalY: dancerPhotos[0]?.focalY ?? dancerPhotos[0]?.imageFocalY ?? 50,
          avatarPhotoUrl: profile.avatarPhotoUrl || profile.avatar_photo_url || photos[0] || "",
          avatarPhotoFocalX: profile.avatarPhotoFocalX ?? profile.avatar_photo_focal_x ?? dancerPhotos[0]?.focalX ?? 50,
          avatarPhotoFocalY: profile.avatarPhotoFocalY ?? profile.avatar_photo_focal_y ?? dancerPhotos[0]?.focalY ?? 50,
          avatarPhotoSrcSet: profile.avatarPhotoSrcSet || profile.avatar_photo_src_set || "",
          avatarStoragePath: profile.avatar_storage_path || profile.avatarStoragePath || "",
          venueApprovedAt: profile.venue_approved_at || profile.venueApprovedAt || "",
          pendingAvatarReview: profile.pending_avatar_review || profile.pendingAvatarReview || null,
          galleryPhotoUrls: photos.slice(1),
          status: approved ? "Verified" : rejected ? "Rejected" : "Pending",
          photoStatus: reviewStatusLabel(profile.photo_review_status || profile.photoReviewStatus, "Approved", dancerSetup.photos ? "Pending" : localProfile.photoStatus),
          reviewSubmitted: approved || rejected ? false : (submittedForReview || localProfile.reviewSubmitted),
          hidden: approved ? (profile.is_public === false || profile.isPublic === false) : localProfile.hidden,
          isPublic: profile.is_public !== false && profile.isPublic !== false,
          socials: { ...emptySocialMap(), ...dancerSignupSocials },
          submittedPhotos,
          dancer_photos: dancerPhotos,
          socialLinks: Array.isArray(profile.social_links) ? socialLinks : (localProfile.socialLinks || [])
        });
        normalizeLocalDancerPhotos(localProfile);
      }
    }

    function setDancerSetupField(id, value, property = "value") {
      const element = document.getElementById(id);
      if (!element || value === undefined || value === null) return;
      element[property] = value;
    }

    function getDancerDashboardStageName(stageName = "") {
      return cleanDisplayValue(stageName || document.getElementById("dancerStageName")?.value || "");
    }

    function updateDancerDashboardName(stageName = "") {
      const dashName = document.getElementById("dancerDashName");
      if (!dashName) return;
      dashName.textContent = getDancerDashboardStageName(stageName) || "Dancer dashboard";
    }

    function dancerSetupEditorHasFocus() {
      const activeElement = document.activeElement;
      return Boolean(
        activeElement &&
        activeElement !== document.body &&
        activeElement.closest?.("#setupChecklist [data-setup-form], #setupChecklist [data-setup-profile-editor]")
      );
    }

    function renderDancerSetupWhenEditorIdle() {
      if (dancerSetupEditorHasFocus()) {
        dancerSetupRefreshPending = true;
        return false;
      }
      dancerSetupRefreshPending = false;
      renderDancerSetup();
      return true;
    }

    function dancerSocialMapFromProfile(profile) {
      const socials = emptySocialMap();
      const rows = Array.isArray(profile?.social_links) ? profile.social_links : [];
      rows.forEach((row) => {
        if (!row?.platform || row.is_active === false) return;
        socials[row.platform] = row.url || row.handle || "";
      });
      return socials;
    }

    function emptySocialMap() {
      return Object.fromEntries(socialPlatforms.map(({ key }) => [key, ""]));
    }

    function assignSocialMap(target, source = {}) {
      socialPlatforms.forEach(({ key }) => {
        target[key] = String(source?.[key] || "");
      });
      return target;
    }

    function dancerProfilePhotoUrls(profile) {
      const rows = Array.isArray(profile?.dancer_photos) ? profile.dancer_photos : [];
      return rows
        .slice()
        .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
        .filter((photo) => normalizedReviewStatus(photo.review_status || photo.reviewStatus || "pending") === "approved")
        .map((photo) => photo.imageUrl || photo.image_url || photo.url || photo.storage_path || "")
        .filter(Boolean);
    }

    function dancerSetupPhotoModerationCategory(photo = {}) {
      const decision = normalizedReviewStatus(photo.decision || photo.moderationDecision || photo.moderation_decision);
      const status = normalizedReviewStatus(photo.review_status || photo.reviewStatus || photo.status);
      if (decision === "rejected" || status === "rejected") return "rejected";
      if (decision === "approved" || status === "approved") return "approved";
      if (
        decision === "review" ||
        decision === "moderation_retry" ||
        decision === "moderation_error" ||
        ["pending", "pending_review", "moderating", "moderation_retry", "moderation_error"].includes(status)
      ) {
        return "review";
      }
      return "";
    }

    function dancerProfileMediaModerationComplete(profile) {
      const rows = Array.isArray(profile?.dancer_photos) ? profile.dancer_photos : [];
      const pendingReviews = Array.isArray(profile?.pending_photo_reviews) ? profile.pending_photo_reviews : [];
      const submittedPhotos = Array.isArray(profile?.submittedPhotos) ? profile.submittedPhotos : [];
      const categories = [...rows, ...pendingReviews, ...submittedPhotos]
        .map((photo) => dancerSetupPhotoModerationCategory(photo))
        .filter(Boolean);
      return categories.includes("approved");
    }

    function dancerSubmittedPhotosFromProfile(profile) {
      const rows = Array.isArray(profile?.dancer_photos) ? profile.dancer_photos : [];
      const pendingReviews = Array.isArray(profile?.pending_photo_reviews) ? profile.pending_photo_reviews : [];
      const pendingRows = [
        ...rows.filter((photo) => dancerSetupPhotoModerationCategory(photo) === "review"),
        ...pendingReviews.filter((review) => dancerSetupPhotoModerationCategory(review) === "review").map((review) => ({
          ...review,
          imageUrl: review.previewUrl || review.preview_url || "",
          image_url: review.previewUrl || review.preview_url || "",
          isPrimary: Boolean(review.isPrimary || review.is_primary || String(review.upload_context || "").includes("main")),
          is_primary: Boolean(review.isPrimary || review.is_primary || String(review.upload_context || "").includes("main")),
          sortOrder: Number(review.sortOrder ?? review.sort_order ?? 0),
          sort_order: Number(review.sortOrder ?? review.sort_order ?? 0),
          reviewStatus: "pending",
          review_status: "pending"
        }))
      ];
      const byId = new Map();
      pendingRows
        .slice()
        .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")))
        .forEach((photo) => byId.set(String(photo.id), photo));
      return Array.from(byId.values())
        .sort((a, b) => Number(a.sort_order ?? a.sortOrder ?? 0) - Number(b.sort_order ?? b.sortOrder ?? 0))
        .map((photo, index) => {
          const imageUrl = photo.imageUrl || photo.image_url || photo.url || photo.storage_path || "";
          const review = latestContentReview(`photo:${photo.id || `${profile?.id || profile?.stage_name || profile?.stageName || "profile"}-photo-${index}`}`);
          return {
            id: photo.id || `${profile?.id || profile?.stage_name || profile?.stageName || "profile"}-photo-${index}`,
            imageUrl,
            image_url: imageUrl,
            isPrimary: Boolean(photo.is_primary || photo.isPrimary),
            is_primary: Boolean(photo.is_primary || photo.isPrimary),
            sortOrder: Number(photo.sort_order ?? photo.sortOrder ?? index),
            sort_order: Number(photo.sort_order ?? photo.sortOrder ?? index),
            reviewStatus: review?.status || photo.review_status || photo.reviewStatus || "pending",
            review_status: review?.status || photo.review_status || photo.reviewStatus || "pending",
            reviewNotes: review?.notes || photo.review_notes || photo.reviewNotes || "Pending review. This slot stays occupied until approval or rejection.",
            review_notes: review?.notes || photo.review_notes || photo.reviewNotes || "Pending review. This slot stays occupied until approval or rejection."
          };
        });
    }

    function releaseSetupPhotoPreviews(urls = pendingSetupPhotoPreviewUrls) {
      urls.filter(Boolean).forEach((url) => URL.revokeObjectURL(url));
    }

    function rememberSetupPhotoFiles(files = []) {
      releaseSetupPhotoPreviews();
      pendingSetupPhotoFiles = Array.from(files);
      pendingSetupPhotoPreviewUrls = pendingSetupPhotoFiles.map((file) => URL.createObjectURL(file));
    }

    function nextSetupPhotoUploadTarget(profile) {
      const hasPrimary = editableDancerPhotoRows(profile)
        .some((photo) => Boolean(photo.is_primary || photo.isPrimary));
      if (!hasPrimary) return "main";
      return `gallery-add:${nextAvailableApprovedGallerySortOrder(profile)}`;
    }
