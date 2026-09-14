

    async function submitApprovedProfileVideo(form) {
      const headers = authenticatedRequestHeaders("application/json");
      if (!headers) throw new Error("Sign in as a dancer to upload profile videos.");
      const fileInput = form.querySelector("#approvedProfileVideoInput");
      const file = fileInput?.files?.[0] || pendingApprovedProfileVideoFile;
      if (!file) throw new Error("Choose an MP4 or WebM video first.");
      if ((approvedProfileVideoWorkspace?.videos?.length || 0) >= MAX_DANCER_PROFILE_VIDEOS) {
        throw new Error(`You can upload up to ${MAX_DANCER_PROFILE_VIDEOS} profile videos. Remove one before adding another.`);
      }
      const consentConfirmed = form.querySelector("#approvedProfileVideoConsent")?.checked === true || pendingApprovedProfileVideoConsent;
      const rightsConfirmed = form.querySelector("#approvedProfileVideoRights")?.checked === true || pendingApprovedProfileVideoRights;
      if (!consentConfirmed || !rightsConfirmed) {
        throw new Error("Confirm consent and content rights before uploading.");
      }
      const metadata = await readApprovedProfileVideoMetadata(file);
      let preparedVideoId = "";
      let submissionStarted = false;
      try {
        const prepareResponse = await fetch("/api/dancer/tv/videos", {
          method: "POST",
          headers,
          body: JSON.stringify({
            mimeType: file.type,
            fileSize: file.size,
            durationSeconds: metadata.duration,
            width: metadata.width,
            height: metadata.height,
            consentConfirmed,
            rightsConfirmed
          })
        });
        const prepared = await prepareResponse.json().catch(() => ({}));
        if (!prepareResponse.ok || prepared.ok === false || !prepared.upload?.uploadUrl) {
          throw new Error(normalizeRequestError(prepared.error || prepared.message, "Unable to prepare the secure video upload."));
        }
        applyResponseSession(prepared, headers);
        preparedVideoId = prepared.upload.videoId;
        approvedProfileVideoStatus = "Uploading securely...";
        renderApprovedProfileVideoManager();

        const storageBody = new FormData();
        storageBody.append("cacheControl", "3600");
        storageBody.append("", file);
        const uploadResponse = await fetch(prepared.upload.uploadUrl, {
          method: "PUT",
          headers: { "x-upsert": "false" },
          body: storageBody
        });
        if (!uploadResponse.ok) {
          const uploadError = await uploadResponse.json().catch(() => ({}));
          throw new Error(uploadError.message || uploadError.error || "Secure video upload failed.");
        }

        approvedProfileVideoStatus = "Running the complete-video safety check...";
        renderApprovedProfileVideoManager();
        submissionStarted = true;
        const submitResponse = await fetch(`/api/dancer/tv/videos/${encodeURIComponent(preparedVideoId)}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ action: "submit" })
        });
        const submitted = await submitResponse.json().catch(() => ({}));
        if (!submitResponse.ok || submitted.ok === false) {
          throw new Error(normalizeRequestError(submitted.error || submitted.message, "Unable to submit the video for review."));
        }
        applyResponseSession(submitted, headers);
        const completionMessage = submitted.message || "Your video completed automated safety review.";
        const completionTone = submitted.video?.status === "rejected" ? "error" : "success";
        if (fileInput) fileInput.value = "";
        form.reset();
        clearPendingApprovedProfileVideoSelection();
        await loadApprovedProfileVideos({ force: true });
        approvedProfileVideoStatus = completionMessage;
        approvedProfileVideoStatusTone = completionTone;
        renderApprovedProfileVideoManager();
        showToast("Profile video saved");
      } catch (error) {
        if (preparedVideoId && !submissionStarted) {
          fetch(`/api/dancer/tv/videos/${encodeURIComponent(preparedVideoId)}`, {
            method: "DELETE",
            headers: authenticatedRequestHeaders()
          }).catch(() => {});
        }
        throw error;
      }
    }

    async function removeApprovedProfileVideo(videoId) {
      const headers = authenticatedRequestHeaders();
      if (!headers) throw new Error("Sign in as a dancer to remove profile videos.");
      const response = await fetch(`/api/dancer/tv/videos/${encodeURIComponent(videoId)}`, {
        method: "DELETE",
        headers
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) {
        throw new Error(normalizeRequestError(data.error || data.message, "Unable to remove the video."));
      }
      applyResponseSession(data, headers);
      await loadApprovedProfileVideos({ force: true });
      approvedProfileVideoStatus = data.message || "Video removed.";
      approvedProfileVideoStatusTone = "success";
      renderApprovedProfileVideoManager();
    }

    function approvedVisualProfileEditorMarkup(profile) {
      const photos = approvedVisualPhotoItems(profile);
      const selectedPhoto = photos.find((photo) => photo.target === activeApprovedVisualPhotoTarget || photo.id === activeApprovedVisualPhotoTarget) || photos[0];
      const mainPhoto = selectedPhoto || { imageUrl: "", label: "Main Photo", status: "", notes: "", target: "main" };
      const selectedPhotoIndex = Math.max(0, photos.indexOf(mainPhoto));
      const primaryPhoto = photos.find((photo) => photo.target === "main" || photo.isPrimary || photo.is_primary) || photos[0] || null;
      const availableGallerySortOrders = availableApprovedGallerySortOrders(profile);
      const emptyPhotoSlots = Array.from({ length: Math.min(6, Math.max(0, MAX_DANCER_PROFILE_PHOTOS - photos.length)) }, (_, index) => {
        const slotNumber = photos.length + index + 1;
        const target = slotNumber === 1
          ? "main"
          : `gallery-add:${availableGallerySortOrders[index] || nextAvailableApprovedGallerySortOrder(profile)}`;
        return `<button class="thumb approved-photo-empty-slot" type="button" data-approved-visual-photo-add="${target}" aria-label="Upload Photo ${slotNumber}" title="Upload Photo ${slotNumber}"><span aria-hidden="true">+</span><small>Photo ${slotNumber}</small></button>`;
      }).join("");
      console.log("PHOTO_NUMBERING_DEBUG", {
        photos: photos.map((photo, index) => ({
          index,
          id: photo.id,
          isPrimary: Boolean(photo.isPrimary || photo.is_primary || photo.target === "main"),
          sortOrder: photo.sortOrder ?? photo.sort_order ?? null,
          label: photo.label
        })),
        primaryPhotoId: primaryPhoto?.id,
        orderedPhotoIds: photos.map((photo) => photo.id),
        renderedLabels: photos.map((photo) => photo.label)
      });
      const mainPhotoClass = mainPhoto.imageUrl ? portraitClass(selectedPhotoIndex) : "approved-photo-empty-preview";
      const mainPhotoAttrs = customPhotoAttrs(mainPhoto.imageUrl);
      const photoStatusClass = [
        mainPhoto.status === "rejected" ? "is-rejected" : "",
        mainPhoto.status === "pending" ? "is-pending" : "",
        mainPhoto.status === "approved" ? "is-live" : "",
        mainPhoto.status === "approved" && mainPhoto.target === "main" ? "is-main" : ""
      ].filter(Boolean).join(" ");
      const submittedSocials = normalizeSubmittedSocials(profile);
      const socials = socialPlatforms.map((platform) => {
        const submitted = submittedSocials.find((item) => item.platform === platform.key);
        const currentValue = approvedProfileFieldValue(`profile${platform.key.charAt(0).toUpperCase()}${platform.key.slice(1)}`, `approvedControl${platform.key.charAt(0).toUpperCase()}${platform.key.slice(1)}`);
        const status = normalizedReviewStatus(submitted?.reviewStatus || (submitted ? "pending" : ""));
        const deleted = (profile?.deletedSocialPlatforms || []).includes(platform.key);
        const previewValue = normalizeSocialInput(platform.key, currentValue) || currentValue;
        return {
          ...platform,
          value: deleted ? "" : previewValue,
          status,
          notes: submitted?.reviewNotes || "",
          deleted
        };
      });
      const shareName = displayText(profile?.name || activeDancerName());
      const shareCity = displayText(activeDancerCity());
      const socialUtilityButtons = `
        <div class="profile-utility-actions approved-social-tools" aria-label="Profile social tools">
          <button class="profile-share-trigger" type="button" data-readonly-profile-tool="share" data-profile-share-menu="${shareName}" data-share-city="${shareCity}" aria-haspopup="dialog" aria-label="Share profile" title="Share profile - not editable">
            ${actionIconMarkup("share")}
          </button>
        </div>
      `;
      const socialEditButton = `
        <button class="approved-social-edit-btn ${approvedSocialEditMode ? "is-active" : ""}" type="button" data-approved-social-edit-toggle aria-label="${approvedSocialEditMode ? "Done editing social links" : "Edit social links"}" aria-pressed="${approvedSocialEditMode ? "true" : "false"}">
          <svg class="icon" viewBox="0 0 24 24"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"></path></svg>
        </button>
      `;
      const photoEditButton = `
        <button class="approved-photo-edit-badge ${approvedPhotoEditMode ? "is-active" : ""}" type="button" data-approved-photo-edit-toggle aria-label="${approvedPhotoEditMode ? "Done editing photos" : "Edit photos"}" aria-pressed="${approvedPhotoEditMode ? "true" : "false"}">
          <svg class="icon" viewBox="0 0 24 24"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"></path></svg>
        </button>
      `;
      const changeState = approvedProfileChangeState(profile);
      const editableStageName = approvedProfileFieldValue("profileStageName", "approvedControlStageName") || profile?.name || activeDancerName();
      const pendingAvatarReview = profile?.pendingAvatarReview || profile?.pending_avatar_review || null;
      const dedicatedAvatarPath = String(profile?.avatarStoragePath || profile?.avatar_storage_path || "").trim();
      const liveAvatarUrl = String(profile?.avatarPhotoUrl || profile?.avatar_photo_url || "").trim();
      const pendingAvatarUrl = String(pendingAvatarReview?.previewUrl || pendingAvatarReview?.preview_url || "").trim();
      const avatarPreviewUrl = pendingAvatarUrl || liveAvatarUrl || mainPhoto.imageUrl || "";
      const avatarPreviewAttrs = customAvatarPhotoAttrs(
        avatarPreviewUrl,
        profile?.avatarPhotoSrcSet || profile?.avatar_photo_src_set || "",
        profile?.avatarPhotoFocalX ?? profile?.avatar_photo_focal_x ?? profile?.mainPhotoFocalX ?? 50,
        profile?.avatarPhotoFocalY ?? profile?.avatar_photo_focal_y ?? profile?.mainPhotoFocalY ?? 50
      );
      const avatarIsWorkingNow = isWorkingTonight(profile, activeDancerCity());
      const avatarIsUpcoming = Boolean(profile?.scheduled) && !avatarIsWorkingNow;
      const avatarInitials = String(editableStageName || "D")
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
          : "Your main photo is used until you upload a dedicated avatar.";
      const visibleSocials = socials.filter((social) => !social.deleted && social.value);
      const approvedEditableSocialMarkup = `
        <div class="info-tile social-tile ${approvedSocialEditMode ? "is-social-editing" : ""}">
          <div class="social-tile-head">
            <strong>Social links</strong>
            ${socialUtilityButtons}
          </div>
          ${visibleSocials.length ? `
          <div class="social-links">
            ${visibleSocials.map((social) => `
              <span class="social-edit-item" data-fix-anchor="${displayText(`profile-${social.key}`)}">
                  <a class="social-link social-${displayText(social.key)} ${social.status === "rejected" ? "is-rejected" : social.status === "pending" ? "is-pending" : ""}" href="${displayText(safeExternalHref(social.value) || "#")}" target="_blank" rel="noreferrer" aria-label="${displayText(social.label)}" data-social-url="${displayText(social.value)}" title="${displayText(social.status === "rejected" ? `Not approved: ${social.notes || "No reason added."}` : social.status === "pending" ? "Pending admin approval" : social.label)}">
                  ${socialIconMarkup(social.key)}
                </a>
              </span>
            `).join("")}
          </div>
          ` : '<div class="meta">No social links posted</div>'}
          ${socialEditButton}
        </div>
      `;
      return `
        <div class="approved-visual-profile">
          <div class="approved-edit-help">
            <strong>Edit your public profile</strong>
            <span>Update your stage name and face avatar first. For gallery pictures, tap the pencil and then tap a picture to replace or delete it. Blank social links stay hidden from preview and live profile.</span>
          </div>
          <section class="profile-modal">
            <section class="approved-profile-identity-editor" aria-labelledby="approvedIdentityEditorTitle">
              <div class="approved-profile-identity-heading">
                <strong id="approvedIdentityEditorTitle">Profile identity</strong>
                <small>Public name + circular avatar</small>
              </div>
              <div class="approved-profile-identity-row">
                <div class="approved-avatar-preview${avatarPreviewAttrs.className}"${avatarPreviewAttrs.style} data-dancer-avatar${avatarIsWorkingNow ? ' data-working-now="true"' : avatarIsUpcoming ? ' data-upcoming="true"' : ""} role="img" aria-label="Avatar preview${avatarIsWorkingNow ? ", working now" : avatarIsUpcoming ? ", upcoming shift posted" : ""}">
                  <span data-dancer-avatar-border aria-hidden="true">${avatarPreviewUrl ? "" : displayText(avatarInitials)}</span>
                  ${avatarIsWorkingNow ? '<span data-working-now-indicator aria-hidden="true">NOW</span>' : ""}
                </div>
                <div class="approved-profile-identity-fields">
                  <div class="approved-stage-name-editor">
                    <label for="approvedVisualStageName">
                      Stage name
                      <input id="approvedVisualStageName" data-approved-stage-name-input type="text" value="${escapeHtml(editableStageName)}" minlength="2" maxlength="40" autocomplete="nickname" spellcheck="false" aria-describedby="approvedVisualStageNameHelp">
                    </label>
                    <small id="approvedVisualStageNameHelp">This is the public name guests see on dancer cards, MyDancr TV, schedules, and your full profile.</small>
                  </div>
                  <div class="approved-avatar-copy">
                    <strong id="approvedAvatarEditorTitle">Face avatar</strong>
                    <p>Use a clear face photo. MyDancr centers it in live avatar circles.</p>
                    <span class="approved-avatar-status ${pendingAvatarReview ? "is-pending" : dedicatedAvatarPath ? "is-live" : ""}" id="approvedAvatarUploadStatus" aria-live="polite">${displayText(avatarStatus)}</span>
                  </div>
                </div>
              </div>
              <div class="approved-avatar-actions">
                <button type="button" data-approved-avatar-upload>${dedicatedAvatarPath || pendingAvatarReview ? "Replace avatar" : "Upload avatar"}</button>
                ${dedicatedAvatarPath || pendingAvatarReview ? '<button class="approved-avatar-remove" type="button" data-approved-avatar-remove>Remove avatar</button>' : ""}
              </div>
            </section>
            <div class="approved-photo-edit-frame">
              <button class="modal-image ${mainPhotoClass}${mainPhotoAttrs.className} ${photoStatusClass} ${approvedPhotoEditMode ? "is-photo-editing" : ""}"${mainPhotoAttrs.style} type="button" data-fix-anchor="${displayText(`dancer-photo-${mainPhoto.id}`)}" data-profile-visual-edit="photo" data-photo-id="${displayText(mainPhoto.id || "")}" data-photo-target="${displayText(mainPhoto.target)}" data-photo-url="${displayText(mainPhoto.imageUrl || "")}" data-photo-storage-path="${displayText(mainPhoto.storagePath || mainPhoto.storage_path || "")}" data-photo-label="${displayText(mainPhoto.label || "Main Photo")}" data-review-status="${displayText(mainPhoto.status || "")}" data-review-notes="${displayText(mainPhoto.notes || "")}">
                <div class="modal-identity-stack">
                  <div class="modal-identity">
                    <h2><span data-approved-stage-name-preview>${displayText(editableStageName)}</span></h2>
                    <div class="pill-row">
                      <span class="pill" id="modalCity">${displayText(activeDancerCity())}</span>
                    </div>
                  </div>
                </div>
                <span class="approved-photo-edit-instruction">${approvedPhotoEditMode ? "Photo edit is on. Tap any photo to replace or delete it." : "Tap the pencil, then tap a photo to replace or delete it."}</span>
                ${mainPhoto.status === "pending" ? '<span class="approved-photo-review-badge">Pending review</span>' : ""}
              </button>
              ${photoEditButton}
            </div>
            <div class="gallery" aria-label="Profile pictures">
                ${photos.map((photo) => `
                  <button class="thumb ${photo === mainPhoto ? "active" : ""} ${photo.status === "rejected" ? "is-rejected" : photo.status === "pending" ? "is-pending" : photo.status === "approved" ? "is-live" : ""} ${photo.status === "approved" && photo.target === "main" ? "is-main" : ""}" type="button" data-fix-anchor="${displayText(`dancer-photo-${photo.id}`)}" data-approved-visual-photo-select="${displayText(photo.id || photo.target)}" data-photo-id="${displayText(photo.id || "")}" data-photo-target="${displayText(photo.target)}" data-photo-url="${displayText(photo.imageUrl || "")}" data-photo-storage-path="${displayText(photo.storagePath || photo.storage_path || "")}" data-photo-label="${displayText(photo.label)}" data-review-status="${displayText(photo.status || "")}" data-review-notes="${displayText(photo.notes || "")}" title="${displayText(approvedPhotoEditMode ? `Edit ${photo.label}` : photo.status === "rejected" ? `Not approved: ${photo.notes || "No reason added."}` : photo.status === "pending" ? "Pending admin approval" : photo.label)}">
                    <span class="portrait ${portraitClass(photos.indexOf(photo))}${customPhotoAttrs(photo.imageUrl).className}"${customPhotoAttrs(photo.imageUrl).style}></span>
                  </button>
                `).join("")}
                ${emptyPhotoSlots}
            </div>
            <div class="modal-body">
              <div class="approved-visual-photo-actions">
                <button type="button" data-approved-visual-photo-add="main">Add main photo</button>
                <button type="button" data-approved-visual-photo-add="gallery-add">Add gallery photo</button>
              </div>
              <div class="meta" id="approvedPhotoUploadStatus" aria-live="polite">Choose a photo button to upload a new picture.</div>
              ${approvedProfileVideoManagerMarkup()}
              ${profileModalGridMarkup(profile, { preview: true, city: activeDancerCity(), socialMarkup: approvedEditableSocialMarkup })}
              <div class="modal-actions">
                <button class="approved-visual-save action-btn secondary ${approvedProfileSaveConfirmed ? "is-saved" : ""}" type="button" data-dancer-control-action="save-profile">
                  ${approvedProfileSaveConfirmed ? actionButtonLabel("check", "Saved Profile") : actionButtonLabel("save", "Save Profile")}
                </button>
              </div>
            </div>
          </section>
          <div class="approved-edit-popover" id="approvedEditItemPopover" hidden>
            <div class="approved-edit-card" id="approvedEditItemCard"></div>
          </div>
        </div>
      `;
    }

    function renderApprovedVisualProfileEditor() {
      const mount = document.getElementById("approvedVisualProfileEditor");
      if (!mount) return;
      const profile = activeDancerProfile() || ensureActiveDancerProfile("Verified");
      mount.innerHTML = approvedVisualProfileEditorMarkup(profile);
      if (activeApprovedToolDropdown === "edit" && !approvedProfileVideoWorkspace && !approvedProfileVideoLoading) {
        void loadApprovedProfileVideos();
      }
    }

    function releaseEditProfileMobileFocus(trigger = null) {
      const active = document.activeElement;
      if (active && typeof active.blur === "function" && active !== document.body) active.blur();
      if (trigger && typeof trigger.blur === "function") trigger.blur();
      window.__dancrSyncViewportSafeTop?.();
    }

    function setApprovedProfileSaveFeedback(message, options = {}) {
      const profileResult = document.getElementById("profileEditResult");
      const visualStatus = document.getElementById("approvedPhotoUploadStatus");
      const controlResult = document.getElementById("dancerControlResult");
      const saveButtons = document.querySelectorAll('[data-dancer-control-action="save-profile"]');
      if (options.saving === true) approvedProfileSaveConfirmed = false;
      if (options.saved === true) approvedProfileSaveConfirmed = true;
      if (profileResult) {
        profileResult.hidden = false;
        profileResult.textContent = message;
      }
      if (visualStatus) visualStatus.textContent = message;
      if (controlResult) controlResult.textContent = message;
      saveButtons.forEach((button) => {
        const wasConfirmed = button.classList.contains("is-saved");
        if (!button.dataset.saveProfileIdleText) button.dataset.saveProfileIdleText = "Save Profile";
        if (!button.dataset.saveProfileIdleHtml) {
          button.dataset.saveProfileIdleHtml = wasConfirmed
            ? actionButtonLabel("save", "Save Profile")
            : button.innerHTML || button.textContent || "Save Profile";
        }
        button.classList.toggle("is-saved", approvedProfileSaveConfirmed && options.saving !== true);
        button.classList.toggle("is-saving", options.saving === true);
        button.setAttribute("aria-busy", options.saving ? "true" : "false");
        if (options.saving) button.innerHTML = actionButtonLabel("save", "Saving...");
        else if (approvedProfileSaveConfirmed) button.innerHTML = actionButtonLabel("check", "Saved Profile");
        else button.innerHTML = button.dataset.saveProfileIdleHtml || button.dataset.saveProfileIdleText || "Save Profile";
      });
      if (options.toast !== false) showToast(message);
    }

    function clearApprovedProfileSaveConfirmation() {
      if (!approvedProfileSaveConfirmed) return;
      approvedProfileSaveConfirmed = false;
      document.querySelectorAll('[data-dancer-control-action="save-profile"]').forEach((button) => {
        button.classList.remove("is-saved");
        button.innerHTML = button.dataset.saveProfileIdleHtml || button.dataset.saveProfileIdleText || "Save Profile";
      });
    }

    function closeApprovedVisualEditPopover() {
      const popover = document.getElementById("approvedEditItemPopover");
      if (popover) {
        if (popover.contains(document.activeElement)) document.activeElement.blur?.();
        popover.hidden = true;
        popover.classList.remove("is-social");
        popover.style.removeProperty("--approved-social-popover-top");
      }
      document.body.classList.remove("social-edit-popover-open");
    }

    function closeApprovedProfileEditor() {
      closeApprovedVisualEditPopover();
      activeApprovedToolDropdown = "";
      renderApprovedToolDropdowns();
      showToast("Edit profile closed");
    }

    function openApprovedVisualEditPopover(kind, data = {}) {
      const popover = document.getElementById("approvedEditItemPopover");
      const card = document.getElementById("approvedEditItemCard");
      if (!popover || !card) return;
      popover.classList.toggle("is-social", kind !== "photo");
      document.body.classList.toggle("social-edit-popover-open", kind !== "photo");
      popover.style.removeProperty("--approved-social-popover-top");
      if (kind === "photo") {
        document.querySelector(".approved-visual-profile")?.appendChild(popover);
        const pending = normalizedReviewStatus(data.status) === "pending";
        const rejectionReason = normalizedReviewStatus(data.status) === "rejected"
          ? `<div class="approved-visual-reason">${displayText(data.label || "Photo")} not approved: ${displayText(data.notes || "No reason added.")}</div>`
          : "";
        card.innerHTML = `
          <div class="row"><div><strong>${displayText(data.label || "Profile photo")}</strong><div class="meta">${pending ? "This upload is awaiting review. You can remove it below. Your approved photos stay live." : "Replace or delete this picture. Approved photos go live automatically. Save Profile keeps your live profile in sync."}</div></div><button class="close-btn" type="button" data-approved-edit-close aria-label="Close"><svg class="icon" viewBox="0 0 24 24"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg></button></div>
          ${rejectionReason}
          <div class="approved-visual-photo-actions">
            ${pending ? "" : `<button type="button" data-approved-visual-photo-replace data-photo-id="${displayText(data.photoId || "")}" data-photo-target="${displayText(data.target || "gallery")}">Replace picture</button>`}
            <button class="approved-visual-delete" type="button" data-approved-visual-photo-delete data-photo-id="${displayText(data.photoId || "")}" data-photo-target="${displayText(data.target || "gallery")}" data-photo-label="${displayText(data.label || "Profile photo")}" data-photo-url="${displayText(data.photoUrl || "")}" data-photo-storage-path="${displayText(data.storagePath || "")}">${pending ? "Remove upload" : "Delete picture"}</button>
          </div>
        `;
      } else {
        const submittedSocials = normalizeSubmittedSocials(activeDancerProfile());
        card.innerHTML = `
          <div class="row"><div><strong>Social links</strong><div class="meta">Add accepted social profile links below. Leave a box blank to hide that social icon from edit preview and the live profile.</div></div><button class="close-btn" type="button" data-approved-edit-close aria-label="Close"><svg class="icon" viewBox="0 0 24 24"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg></button></div>
          <div class="approved-social-form-grid">
            ${socialPlatforms.map((platform) => {
              const inputId = `profile${platform.key.charAt(0).toUpperCase()}${platform.key.slice(1)}`;
              const value = approvedProfileFieldValue(inputId, `approvedControl${platform.key.charAt(0).toUpperCase()}${platform.key.slice(1)}`);
              const submitted = submittedSocials.find((item) => item.platform === platform.key);
              const rejected = normalizedReviewStatus(submitted?.reviewStatus) === "rejected";
              return `
                <div class="field">
                  <label for="approvedSocialInput-${displayText(platform.key)}">${displayText(platform.label)}</label>
                  <input id="approvedSocialInput-${displayText(platform.key)}" data-approved-social-bulk-input data-social-platform="${displayText(platform.key)}" type="text" value="${escapeHtml(value)}" placeholder="Username or profile URL">
                  ${rejected ? `<small>Not approved: ${displayText(submitted?.reviewNotes || "No reason added.")}</small>` : `<small>${displayText(platform.label)} is optional. Blank means hidden.</small>`}
                </div>
              `;
            }).join("")}
          </div>
          <div class="approved-visual-social-actions">
            <button class="action-btn" type="button" data-approved-visual-social-save-all>Apply links</button>
            <button class="approved-visual-delete" type="button" data-approved-edit-close>Cancel</button>
          </div>
        `;
        document.querySelector(".approved-visual-profile")?.appendChild(popover);
      }
      popover.hidden = false;
    }

    async function handleApprovedEditPopoverClick(event) {
      const popover = event.target.closest("#approvedEditItemPopover");
      if (!popover) return false;
      const replaceButton = event.target.closest("[data-approved-visual-photo-replace]");
      const deleteButton = event.target.closest("[data-approved-visual-photo-delete]");
      const socialSaveAllButton = event.target.closest("[data-approved-visual-social-save-all]");
      const socialSaveButton = event.target.closest("[data-approved-visual-social-save]");
      const socialDeleteButton = event.target.closest("[data-approved-visual-social-delete]");
      const closeButton = event.target.closest("[data-approved-edit-close]");
      if (!replaceButton && !deleteButton && !socialSaveAllButton && !socialSaveButton && !socialDeleteButton && !closeButton) return false;
      event.preventDefault();
      event.stopPropagation();

      if (replaceButton) {
        pendingApprovedPhotoTarget = replaceButton.dataset.photoTarget || "gallery";
        pendingApprovedPhotoAutoSubmit = false;
        closeApprovedVisualEditPopover();
        openApprovedPhotoUploadPicker("Choose a replacement picture. Approved photos go live automatically.");
        return true;
      }

      if (deleteButton) {
        const payload = {
          photoId: deleteButton.dataset.photoId || "",
          target: deleteButton.dataset.photoTarget || "",
          label: deleteButton.dataset.photoLabel || "Profile photo",
          photoUrl: deleteButton.dataset.photoUrl || "",
          storagePath: deleteButton.dataset.photoStoragePath || ""
        };
        console.log("DELETE_CONFIRM", {
          photoId: payload.photoId,
          label: payload.label
        });
        deleteButton.disabled = true;
        try {
          const deleted = await deleteApprovedDancerPhoto(payload);
          closeApprovedVisualEditPopover();
          showToast(deleted ? "Photo deleted. Press Save profile when ready." : "Photo could not be deleted.");
        } catch (error) {
          showToast(error.message || "Could not delete photo");
        } finally {
          deleteButton.disabled = false;
        }
        return true;
      }

      if (socialSaveAllButton) {
        document.querySelectorAll("[data-approved-social-bulk-input]").forEach((input) => {
          const platform = input.dataset.socialPlatform || "";
          const fieldId = `profile${platform.charAt(0).toUpperCase()}${platform.slice(1)}`;
          const field = document.getElementById(fieldId);
          if (!field) return;
          field.value = input.value.trim();
          if (field.value) clearApprovedSocialDeleted(platform);
          else markApprovedSocialDeleted(platform);
          mirrorApprovedProfileEditField(field);
        });
        closeApprovedVisualEditPopover();
        showToast("Social links updated. Press Save profile to keep them.");
        return true;
      }

      if (socialSaveButton) {
        const platform = socialSaveButton.dataset.socialPlatform || "";
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
        return true;
      }

      if (socialDeleteButton) {
        const platform = socialDeleteButton.dataset.socialPlatform || "";
        const fieldId = `profile${platform.charAt(0).toUpperCase()}${platform.slice(1)}`;
        const field = document.getElementById(fieldId);
        if (field) {
          field.value = "";
          markApprovedSocialDeleted(platform);
          mirrorApprovedProfileEditField(field);
          closeApprovedVisualEditPopover();
          showToast("Social link deleted. Press Save profile to send the change to admin.");
        }
        return true;
      }

      closeApprovedVisualEditPopover();
      return true;
    }

    function renderApprovedDancerProfileEditor(preserveCitySelection = false) {
      const stageField = document.getElementById("profileStageName");
      const cityField = document.getElementById("profileCity");
      const venueField = document.getElementById("profileVenue");
      if (!stageField || !cityField || !venueField) return;
      const currentCity = activeDancerCity();
      const selectedCity = preserveCitySelection ? cityField.value : currentCity;
      const city = markets[selectedCity] ? selectedCity : currentCity;
      const profile = activeDancerProfile(currentCity) || ensureActiveDancerProfile("Verified");
      cityField.innerHTML = Object.keys(markets).map((name) => `<option${name === city ? " selected" : ""}>${escapeHtml(name)}</option>`).join("");
      const controlCityField = document.getElementById("approvedControlCity");
      if (controlCityField) controlCityField.innerHTML = cityField.innerHTML;
      const venues = discoveryMarket(city)?.venues || [];
      const venueName = profile?.venue || venues[0]?.name || "";
      venueField.innerHTML = venues.map((venue) => `<option${venue.name === venueName ? " selected" : ""}>${escapeHtml(venue.name)}</option>`).join("");
      const controlVenueField = document.getElementById("approvedControlVenue");
      if (controlVenueField) controlVenueField.innerHTML = venueField.innerHTML;
      cityField.onchange = () => renderApprovedDancerProfileEditor(true);
      if (controlCityField) controlCityField.onchange = () => {
        if (cityField) cityField.value = controlCityField.value;
        renderApprovedDancerProfileEditor(true);
      };

      const socials = { ...dancerSignupSocials, ...(profile?.socials || {}) };
      setFieldValueIfIdle("profileStageName", profile?.name || activeDancerName());
      setFieldValueIfIdle("approvedControlStageName", profile?.name || activeDancerName());
      setFieldValueIfIdle("approvedControlRealName", document.getElementById("dancerLegalName")?.value || profile?.legalName || "");
      if (controlCityField) controlCityField.value = city;
      if (controlVenueField) controlVenueField.value = venueName;
      const photoReview = document.getElementById("approvedProfilePhotoReview");
      if (photoReview) photoReview.innerHTML = approvedDancerPhotoReviewMarkup(profile);
      setFieldValueIfIdle("profileInstagram", socials.instagram || "");
      setFieldValueIfIdle("profileTiktok", socials.tiktok || "");
      setFieldValueIfIdle("profileSnapchat", socials.snapchat || "");
      setFieldValueIfIdle("profileOnlyfans", socials.onlyfans || "");
      setFieldValueIfIdle("profileX", socials.x || "");
      setFieldValueIfIdle("approvedControlInstagram", socials.instagram || "");
      setFieldValueIfIdle("approvedControlTiktok", socials.tiktok || "");
      setFieldValueIfIdle("approvedControlSnapchat", socials.snapchat || "");
      setFieldValueIfIdle("approvedControlOnlyfans", socials.onlyfans || "");
      setFieldValueIfIdle("approvedControlX", socials.x || "");
      normalizeSubmittedSocials(profile).forEach((social) => {
        const input = document.getElementById(`profile${social.platform.charAt(0).toUpperCase()}${social.platform.slice(1)}`);
        if (!input) return;
        const rejected = normalizedReviewStatus(social.reviewStatus) === "rejected";
        const socialRow = input.closest(".social-edit-field, .field");
        input.dataset.fixAnchor = `profile-${social.platform}`;
        if (socialRow) {
          socialRow.dataset.fixAnchor = `profile-${social.platform}`;
          socialRow.classList.toggle("is-rejected", rejected);
        }
        input.classList.toggle("dancer-fix-highlight", false);
        let note = input.parentElement?.querySelector(".social-review-reason");
        if (!note && rejected) {
          note = document.createElement("div");
          note.className = "field-note social-review-reason";
          input.insertAdjacentElement("afterend", note);
        }
        if (note) {
          note.hidden = !rejected;
          note.textContent = rejected ? `Not approved: ${social.reviewNotes || "No reason added."}` : "";
        }
      });
      renderApprovedVisualProfileEditor();
      syncApprovedProfileSubmitState();
    }

    function approvedProfileFieldValue(primaryId, fallbackId = "") {
      const primary = document.getElementById(primaryId);
      const fallback = fallbackId ? document.getElementById(fallbackId) : null;
      return (primary?.value ?? fallback?.value ?? "").trim();
    }

    function readApprovedProfileEditValues() {
      const rawSocials = {
        instagram: approvedProfileFieldValue("profileInstagram", "approvedControlInstagram"),
        tiktok: approvedProfileFieldValue("profileTiktok", "approvedControlTiktok"),
        snapchat: approvedProfileFieldValue("profileSnapchat", "approvedControlSnapchat"),
        onlyfans: approvedProfileFieldValue("profileOnlyfans", "approvedControlOnlyfans"),
        x: approvedProfileFieldValue("profileX", "approvedControlX")
      };
      return {
        stageName: cleanDisplayValue(approvedProfileFieldValue("profileStageName", "approvedControlStageName")) || activeDancerName(),
        city: approvedProfileFieldValue("profileCity", "approvedControlCity") || activeDancerCity(),
        venue: approvedProfileFieldValue("profileVenue", "approvedControlVenue"),
        rawSocials,
        normalizedSocials: Object.fromEntries(
          Object.entries(rawSocials).map(([key, value]) => [key, normalizeSocialInput(key, value)])
        )
      };
    }

    function validateDancerStageName(value) {
      const stageName = String(value || "").trim().replace(/\s+/gu, " ");
      const characterCount = [...stageName].length;
      if (!stageName) return { valid: false, value: "", error: "Stage name is required." };
      if (characterCount < 2) return { valid: false, value: stageName, error: "Stage name must be at least 2 characters." };
      if (characterCount > 40) return { valid: false, value: stageName, error: "Stage name must be 40 characters or fewer." };
      if (/[\u0000-\u001f\u007f<>]/u.test(stageName)) return { valid: false, value: stageName, error: "Stage name contains unsupported characters." };
      if (!/[\p{L}\p{N}]/u.test(stageName)) return { valid: false, value: stageName, error: "Stage name must include a letter or number." };
      return { valid: true, value: stageName, error: "" };
    }

    function approvedProfileChangeState(profile = activeDancerProfile()) {
      if (!profile) return { hasAnyChange: false, needsApproval: false, hasDeletesOnly: false };
      const values = readApprovedProfileEditValues();
      const existingSocials = normalizeSubmittedSocials(profile);
      const detailsChanged = values.stageName !== (profile.name || activeDancerName()) ||
        values.city !== (profile.city || activeDancerCity()) ||
        Boolean(values.venue && values.venue !== (profile.venue || ""));
      const socialStates = socialPlatforms.map(({ key }) => {
        const existing = existingSocials.find((social) => social.platform === key);
        const current = values.normalizedSocials[key] || "";
        const previous = existing?.url || "";
        return {
          key,
          addedOrChanged: Boolean(current && current !== previous),
          deleted: Boolean(previous && !current)
        };
      });
      const pendingPhoto = (profile.submittedPhotos || []).some((photo) =>
        normalizedReviewStatus(photo.reviewStatus || photo.review_status || "pending") === "pending"
      );
      const waitingOnAdmin = Boolean(profile.approvalChangesPending && profile.approvalChangesSubmitted);
      const needsApproval = detailsChanged || (!waitingOnAdmin && pendingPhoto) || socialStates.some((item) => item.addedOrChanged || item.deleted) || Boolean(profile.approvalChangesPending && !profile.approvalChangesSubmitted);
      const hasDeletes = socialStates.some((item) => item.deleted) || deletedDancerPhotoKeySet(profile).size > 0;
      const hasAnyChange = needsApproval || hasDeletes;
      return { hasAnyChange, needsApproval, hasDeletesOnly: hasDeletes && !needsApproval, submitted: waitingOnAdmin && !needsApproval };
    }

    function syncApprovedProfileSubmitState() {
      const state = approvedProfileChangeState();
      if (state.hasAnyChange) clearApprovedProfileSaveConfirmation();
      const submitButtons = [];
      submitButtons.forEach((button) => {
        button.disabled = !state.needsApproval;
        button.classList.toggle("is-ready", state.needsApproval);
        button.classList.toggle("is-submitted", state.submitted);
        if (button.classList.contains("approved-visual-submit")) {
          button.innerHTML = state.submitted
            ? actionButtonLabel("check", "Submitted for review")
            : actionButtonLabel("save", "Save profile");
        } else {
          button.textContent = state.submitted ? "Sent to admin" : "Save profile";
        }
        button.title = state.needsApproval
          ? "Save, then send changed or uploaded items to admin."
          : state.submitted
            ? "Your latest photo or social changes were submitted for admin review."
          : state.hasDeletesOnly
            ? "Deleted items can be saved without admin approval."
            : "Change or upload something to submit for approval.";
      });
      const result = document.getElementById("dancerControlResult");
      if (result && state.hasDeletesOnly) {
        result.textContent = "Only deleted items changed. Press Save profile to keep those changes.";
      }
    }

    function mirrorApprovedProfileEditField(field) {
      const pairs = [
        ["profileStageName", "approvedControlStageName"],
        ["profileCity", "approvedControlCity"],
        ["profileVenue", "approvedControlVenue"],
        ["profileInstagram", "approvedControlInstagram"],
        ["profileTiktok", "approvedControlTiktok"],
        ["profileSnapchat", "approvedControlSnapchat"],
        ["profileOnlyfans", "approvedControlOnlyfans"],
        ["profileX", "approvedControlX"]
      ];
      const pair = pairs.find(([left, right]) => field?.id === left || field?.id === right);
      if (!pair) return;
      const [leftId, rightId] = pair;
      const other = document.getElementById(field.id === leftId ? rightId : leftId);
      if (other && other.value !== field.value) other.value = field.value;
      syncApprovedProfileSubmitState();
      renderApprovedVisualProfileEditor();
    }

    function markApprovedSocialDeleted(platform = "") {
      const key = String(platform || "").toLowerCase();
      if (!key) return;
      const profile = activeDancerProfile() || ensureActiveDancerProfile("Verified");
      if (!profile) return;
      profile.deletedSocialPlatforms = [...new Set([...(profile.deletedSocialPlatforms || []), key])];
      profile.approvalChangesPending = true;
      profile.approvalChangesSubmitted = false;
    }

    function clearApprovedSocialDeleted(platform = "") {
      const key = String(platform || "").toLowerCase();
      const profile = activeDancerProfile();
      if (!profile || !key) return;
      profile.deletedSocialPlatforms = (profile.deletedSocialPlatforms || []).filter((item) => item !== key);
    }

    function socialPlatformFromApprovedFieldId(fieldId = "") {
      const match = String(fieldId || "").match(/^(?:profile|approvedControl)(Instagram|Tiktok|Snapchat|Onlyfans|X)$/);
      return match ? match[1].toLowerCase() : "";
    }

    function focusApprovedSocialField(fieldId = "") {
      const field = document.getElementById(fieldId);
      if (!field) return;
      openAncestorDetails(field);
      field.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      field.focus({ preventScroll: true });
      field.select?.();
    }

    function clearApprovedSocialField(fieldId = "") {
      const field = document.getElementById(fieldId);
      if (!field) return;
      field.value = "";
      markApprovedSocialDeleted(socialPlatformFromApprovedFieldId(fieldId));
      mirrorApprovedProfileEditField(field);
      focusApprovedSocialField(fieldId);
      showToast("Social link cleared. Press Save profile to keep it blank.");
    }

    async function saveApprovedDancerProfile(options = {}) {
      const trigger = options.trigger || null;
      releaseEditProfileMobileFocus(trigger);
      const editWasOpen = activeApprovedToolDropdown === "edit";
      const editorScrollTop = document.getElementById("approvedVisualProfileEditor")?.scrollTop || 0;
      const oldCity = activeDancerCity();
      const oldName = activeDancerName();
      const oldMarket = markets[oldCity];
      const oldProfile = activeDancerProfile(oldCity) || ensureActiveDancerProfile("Verified");
      if (!oldProfile || !oldMarket) return false;
      const changeStateBeforeSave = approvedProfileChangeState(oldProfile);
      const existingSocialsBeforeSave = normalizeSubmittedSocials(oldProfile).map((social) => ({ ...social }));
      const editValues = readApprovedProfileEditValues();
      const stageNameValidation = validateDancerStageName(approvedProfileFieldValue("profileStageName", "approvedControlStageName"));
      if (!stageNameValidation.valid) {
        showToast(stageNameValidation.error);
        const stageNameInput = document.getElementById("approvedVisualStageName");
        stageNameInput?.focus();
        return false;
      }
      const stageName = stageNameValidation.value;
      const newCity = editValues.city || oldCity;
      const targetMarket = markets[newCity] || oldMarket;
      const venueName = editValues.venue || oldProfile.venue;
      const venue = targetMarket.venues.find((item) => item.name === venueName);
      const rawSocials = editValues.rawSocials;
      if (hasBlockedSocialLink(Object.values(rawSocials))) {
        showToast("Escorting, payment, or solicitation links are not allowed");
        return false;
      }
      const normalizedSocials = editValues.normalizedSocials;
      const invalidSocial = Object.entries(rawSocials).some(([key, value]) => value && !normalizedSocials[key]);
      if (invalidSocial) {
        showToast("Use Instagram, TikTok, Snapchat, OnlyFans, or X links only");
        return false;
      }
      const nextSocialLinks = Object.entries(normalizedSocials)
        .filter(([, url]) => Boolean(url))
        .map(([platform, url], index) => {
          const existingSocial = existingSocialsBeforeSave.find((social) => social.platform === platform);
          const unchangedApproved = existingSocial?.url === url && normalizedReviewStatus(existingSocial.reviewStatus) === "approved";
          return {
            id: existingSocial?.id || `${oldProfile.id || oldProfile.name}-social-${platform}-${index}`,
            platform,
            url,
            handle: socialHandleFromUrl(url),
            isActive: true,
            reviewStatus: unchangedApproved ? "approved" : "pending",
            reviewNotes: unchangedApproved ? existingSocial.reviewNotes || "" : ""
          };
        });
      const submittedSocialPlatforms = nextSocialLinks
        .filter((social) => normalizedReviewStatus(social.reviewStatus) === "pending")
        .map((social) => social.platform);
      const result = document.getElementById("profileEditResult");
      if (result) {
        result.hidden = false;
        result.textContent = options.submitForReview
          ? "Saving profile before admin review..."
          : "Saving profile changes...";
      }
      setApprovedProfileSaveFeedback(options.submitForReview ? "Saving profile before admin review..." : "Saving profile changes...", { saving: true, toast: false });
      if (trigger) trigger.disabled = true;
      try {
        let savedServerProfile = null;
        if (isDancerSession()) {
          const deletedPhotoPayload = photoDeletedPayloadFromProfile(oldProfile);
          console.log("EDIT_PROFILE_SAVE_PAYLOAD", {
            deletedPhotoIds: deletedPhotoPayload.deletedPhotoIds,
            deletedPhotoStoragePathCount: deletedPhotoPayload.deletedPhotoStoragePaths.length
          });
          const data = await patchAuthenticatedJson("/api/dancer/profile", {
            stageName,
            city: newCity,
            socials: socialPayloadFromMap(normalizedSocials),
            submitForReview: options.submitForReview === true,
            submittedSocialPlatforms,
            ...deletedPhotoPayload
          });
          if (!data) throw new Error("Sign in required");
          savedServerProfile = data.profile || null;
          const undeletedServerPhotos = deletedPhotosStillInServerProfile(savedServerProfile, deletedPhotoPayload);
          if (undeletedServerPhotos.length) {
            console.error("PROFILE_DELETE_PERSISTENCE_FAILED", {
              requestedPhotoIds: deletedPhotoPayload.deletedPhotoIds,
              remainingPhotoIds: undeletedServerPhotos.map((photo) => photo.id)
            });
            throw new Error("The photo was not removed from your live profile. Please try deleting it again.");
          }
        }
        let profile = oldProfile;
        if (targetMarket !== oldMarket) {
          oldMarket.dancers = oldMarket.dancers.filter((item) => item !== oldProfile);
          profile = { ...oldProfile };
          targetMarket.dancers.push(profile);
          document.getElementById("dancerCity").value = newCity;
          citySelect.value = newCity;
        }
        Object.assign(profile, {
          name: stageName,
          city: newCity,
          venue: venueName,
          distance: venue?.distance || profile.distance,
          socials: normalizedSocials,
          status: dancerCoreApprovalUnlocked(profile) ? "Verified" : profile.status,
          reviewSubmitted: dancerCoreApprovalUnlocked(profile) ? false : profile.reviewSubmitted,
          approvalChangesPending: submittedSocialPlatforms.length > 0,
          approvalChangesSubmitted: submittedSocialPlatforms.length > 0
        });
        profile.socialLinks = nextSocialLinks;
        profile.deletedSocialPlatforms = [];
        assignSocialMap(dancerSignupSocials, normalizedSocials);
        document.getElementById("dancerStageName").value = stageName;
        updateDancerDashboardName(stageName);
        if (savedServerProfile) {
          applyDancerApprovalProfile(savedServerProfile);
        }
        if (isDancerSession()) {
          liveMarketState[newCity] = null;
          await loadLiveDiscovery(newCity, { force: true });
          if (savedServerProfile) {
            applyDancerApprovalProfile(savedServerProfile);
            profile = activeDancerProfile(newCity) || profile;
            console.log("EDIT_PROFILE_PHOTOS_RESTORED_AFTER_DISCOVERY", {
              profileId: savedServerProfile.id || profile.id || null,
              savedPhotoIds: (savedServerProfile.dancer_photos || []).map((photo) => photo.id).filter(Boolean),
              visiblePhotoIds: activeDancerPhotoRows(profile).map((photo) => photo.id).filter(Boolean)
            });
          }
        }
        clearDeletedDancerPhotos(profile);
        if (lastPostedShift?.name === oldName) {
          lastPostedShift.name = stageName;
          lastPostedShift.city = newCity;
          lastPostedShift.venue = venueName;
        }
        render();
        if (editWasOpen) {
          activeApprovedToolDropdown = "edit";
          renderApprovedToolDropdowns();
          const editor = document.getElementById("approvedVisualProfileEditor");
          if (editor) editor.scrollTop = editorScrollTop;
        } else {
          renderDancerSetup();
        }
        if (customerDashboard.classList.contains("show")) renderDashboard();
        syncApprovedProfileSubmitState();
        const successMessage = options.submitForReview
          ? "Profile saved. Changed social links were sent to admin."
          : (submittedSocialPlatforms.length ? "Profile saved. Changed social links were sent to admin for approval." : "Profile saved.");
        if (result) result.textContent = successMessage;
        setApprovedProfileSaveFeedback(successMessage, { saved: true, toast: false });
        releaseEditProfileMobileFocus(trigger);
        return { saved: true, needsApproval: submittedSocialPlatforms.length > 0 };
      } catch (error) {
        const errorMessage = error.message || "Could not save live profile";
        if (result) result.textContent = errorMessage;
        setApprovedProfileSaveFeedback(errorMessage, { toast: true });
        return false;
      } finally {
        if (trigger) {
          trigger.disabled = false;
          trigger.removeAttribute("aria-busy");
        }
        document.querySelectorAll('[data-dancer-control-action="save-profile"].is-saving').forEach((button) => {
          button.classList.remove("is-saving");
          button.removeAttribute("aria-busy");
        });
      }
    }

    function handleShiftManagerAction(action, trigger = null) {
      const profile = activeDancerProfile();
      const shiftId = trigger?.dataset.shiftId || profile?.shiftId || "";
      const shifts = profile ? profilePostedShifts(profile) : locallyStoredPostedShifts();
      const selectedShift = shifts.find((shift) => String(shift.shiftId) === String(shiftId)) || shifts[0] || null;
      if (action === "edit") {
        if (!selectedShift) return;
        editingShiftId = selectedShift.shiftId || null;
        const clubField = document.getElementById("shiftClub");
        const approvedVenue = approvedDancerShiftVenues().find((venue) => venue.name === selectedShift.venue);
        if (clubField) clubField.value = approvedVenue?.id || "";
        setFieldValueIfIdle("shiftDate", selectedShift.shiftDate || todayValue(activeDancerCity()));
        const repeatField = document.getElementById("shiftRepeat");
        if (repeatField) repeatField.value = selectedShift.repeat || "No repeat";
        setFieldValueIfIdle("shiftNotes", selectedShift.notes || "");
        document.getElementById("shiftPostForm")?.scrollIntoView({ behavior: "smooth", block: "center" });
        showToast("Upcoming date loaded for editing");
        return;
      }
      if (action === "remove") {
        if (!selectedShift || trigger?.getAttribute("aria-busy") === "true") return;
        const row = trigger?.closest(".shift-manager-row");
        const originalLabel = trigger?.textContent || "Delete shift";
        if (row) row.classList.add("is-deleting");
        if (trigger) {
          trigger.disabled = true;
          trigger.setAttribute("aria-busy", "true");
          trigger.textContent = "Deleting...";
        }
        void (async () => {
          try {
            if (shiftId && isDancerSession()) {
              await patchAuthenticatedJson("/api/dancer/shifts", {
                shiftId,
                status: "cancelled"
              });
            }
            shiftCheckInMessage = "";
            shiftCheckInTone = "";
            shiftCheckInCode = "";
            removeLocalPostedShift(activeDancerCity(), profile?.name || activeDancerName(), shiftId);
            if (profile) {
              profile.postedShifts = shifts.filter((shift) => String(shift.shiftId) !== String(shiftId));
              applyDisplayShift(profile);
              lastPostedShift = profile.postedShifts.length ? lastPostedShift : null;
            } else {
              lastPostedShift = locallyStoredPostedShifts().length ? lastPostedShift : null;
            }
            render();
            const shiftList = document.getElementById("dancerShiftManager");
            if (row?.isConnected && shiftList) {
              row.remove();
              if (!shiftList.querySelector(".shift-manager-row")) renderDancerShiftManager();
            } else {
              renderDancerShiftManager();
            }
            renderShiftVerificationPanel();
            if (customerDashboard.classList.contains("show")) renderDashboard();
            showToast("Shift removed from your public profile and venue page");
            editingShiftId = null;
          } catch (error) {
            if (row) row.classList.remove("is-deleting");
            if (trigger) {
              trigger.disabled = false;
              trigger.setAttribute("aria-busy", "false");
              trigger.textContent = originalLabel;
            }
            showToast(error.message || "Could not cancel live shift");
          }
        })();
      }
    }