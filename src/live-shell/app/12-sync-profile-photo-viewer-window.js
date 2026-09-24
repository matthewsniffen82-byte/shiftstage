

    function syncProfilePhotoViewerWindow(activePhotoIndex) {
      if (!profilePhotoViewerImage) return;
      // Selection follows the top card, so two following cards can be visible.
      // Warm both neighbors before scrolling reveals them, without loading the whole gallery.
      profilePhotoViewerImage.querySelectorAll(".profile-photo-viewer-slide-image").forEach((image, index) => {
        if (Math.abs(index - activePhotoIndex) > 2) {
          image.style.removeProperty("background-image");
          return;
        }
        const safeUrl = safeCssUrl(image.dataset.profilePhotoUrl);
        if (safeUrl) {
          image.style.backgroundImage = `url('${safeUrl}')`;
          if (!image.profilePhotoSizeProbe && !image.dataset.profilePhotoSized) {
            const probe = new Image();
            image.profilePhotoSizeProbe = probe;
            probe.onload = () => {
              if (image.isConnected) {
                sizeProfilePhotoCard(image.parentElement, probe.naturalWidth, probe.naturalHeight);
                image.dataset.profilePhotoSized = "true";
              }
              image.profilePhotoSizeProbe = null;
              probe.onload = null;
            };
            probe.src = safeUrl;
          }
        }
      });
    }

    function syncProfilePhotoViewerPosition(requestedIndex) {
      const items = Array.isArray(modalGallery.profilePhotoItems) ? modalGallery.profilePhotoItems : [];
      const totalPhotos = items.length;
      if (!totalPhotos) return 0;
      const activePhotoIndex = Math.min(Math.max(Number(requestedIndex) || 0, 0), totalPhotos - 1);
      const profileName = modalName.textContent.trim() || "Dancer";
      const activeItem = items[activePhotoIndex];
      profilePhotoViewer.dataset.profilePhotoIndex = String(activePhotoIndex);
      profilePhotoViewerPrevious.disabled = activePhotoIndex <= 0;
      profilePhotoViewerNext.disabled = activePhotoIndex >= totalPhotos - 1;
      profilePhotoViewer.setAttribute("aria-label", `${profileName} profile photos, photo ${activePhotoIndex + 1} of ${totalPhotos}`);
      preparePublicMediaLikeButton(
        profilePhotoViewerLike,
        "photo",
        String(activeItem?.id || ""),
        activeItem?.likeCount
      );
      const profileId = String(modalGallery.dataset.profileMediaProfile || "");
      const photoId = String(activeItem?.id || "");
      const reportTargetType = isReportableContentId(photoId) ? "profile_photo" : "dancer_profile";
      const reportTargetId = reportTargetType === "profile_photo" ? photoId : profileId;
      if (profilePhotoViewerReport) {
        profilePhotoViewerReport.dataset.reportTargetLabel = reportTargetType === "profile_photo"
          ? `${profileName} profile photo ${activePhotoIndex + 1}`
          : profileName;
        profilePhotoViewerReport.dataset.reportDefaultLabel = "Report this profile photo";
      }
      prepareContentReportButton(
        profilePhotoViewerReport,
        reportTargetType,
        reportTargetId,
        "Report this profile photo"
      );
      syncProfilePhotoViewerWindow(activePhotoIndex);

      while (Number(modalGallery.profileVisiblePhotoCount || 0) <= activePhotoIndex && profileMediaHasMore("photo")) {
        appendNextProfileMediaBatch("photo", { skipObserve: true });
      }
      const photoThumb = [...modalGallery.querySelectorAll(".thumb:not([data-profile-tv-index])")]
        .find((thumb) => Number(thumb.dataset.profilePhotoIndex) === activePhotoIndex);
      if (photoThumb && !photoThumb.classList.contains("active")) selectModalMediaThumb(photoThumb);
      if (profilePhotoViewerStatus) profilePhotoViewerStatus.textContent = "";
      return activePhotoIndex;
    }

    function scrollProfilePhotoViewerTo(requestedIndex, options = {}) {
      if (!profilePhotoViewerImage) return false;
      const activePhotoIndex = syncProfilePhotoViewerPosition(requestedIndex);
      const activeSlide = profilePhotoViewerImage.querySelector(
        `[data-profile-photo-viewer-index="${activePhotoIndex}"]`
      );
      profilePhotoViewerImage.scrollTo({
        behavior: options.instant || window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
        top: activePhotoIndex === 0 ? 0 : Math.max(0, activeSlide?.offsetTop ?? 0)
      });
      return true;
    }

    function openPhotoViewerFromElement(element, requestedIndex = null) {
      if (!profilePhotoViewer || !profilePhotoViewerImage || !element) return;
      const items = Array.isArray(modalGallery.profilePhotoItems) ? modalGallery.profilePhotoItems : [];
      if (!items.length) return;
      profilePhotoViewerReturnTarget = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      const parsedRequestedIndex = Number(requestedIndex);
      const initialIndex = Math.max(0, requestedIndex !== null && Number.isInteger(parsedRequestedIndex)
        ? parsedRequestedIndex
        : Number(modalImage?.dataset.activePhotoIndex || 0));
      profilePhotoViewer.style.zIndex = "1600";
      profilePhotoViewer.hidden = false;
      profilePhotoViewer.dataset.publicDancerId = profileModal.dataset.publicDancerId || "";
      profilePhotoViewer.removeAttribute("data-public-visibility-hidden");
      profilePhotoViewer.dataset.profileMediaHeading = `${modalName.textContent.trim() || "Dancer"} · Photos`;
      renderProfilePhotoViewerSlides();
      void loadPublicMediaLikes(items.map((item) => ({
        mediaType: "photo",
        mediaId: String(item.id || ""),
        likeCount: item.likeCount
      })));
      document.body.classList.add("profile-photo-viewer-open");
      syncOverlayScrollLock();
      syncProfilePhotoViewerPosition(initialIndex);
      scrollProfilePhotoViewerTo(initialIndex, { instant: true });
      if (profilePhotoViewerStatus) profilePhotoViewerStatus.textContent = "";
      window.requestAnimationFrame(() => {
        scrollProfilePhotoViewerTo(initialIndex, { instant: true });
        profilePhotoViewerImage.querySelector(`[data-profile-photo-viewer-index="${initialIndex}"] .profile-media-card-back`)?.focus({ preventScroll: true });
      });
    }

    function closeProfilePhotoViewer() {
      if (!profilePhotoViewer) return;
      profilePhotoViewer.hidden = true;
      profilePhotoViewer.style.removeProperty("z-index");
      window.cancelAnimationFrame(profilePhotoViewerScrollFrame);
      profilePhotoViewerScrollFrame = 0;
      mountProfileMediaCardControls(profilePhotoViewer);
      mountProfileMediaCardHeader(profilePhotoViewer);
      profilePhotoViewerImage.innerHTML = "";
      document.body.classList.remove("profile-photo-viewer-open");
      syncOverlayScrollLock();
      if (profilePhotoViewerStatus) profilePhotoViewerStatus.textContent = "";
      const returnTarget = profilePhotoViewerReturnTarget;
      profilePhotoViewerReturnTarget = null;
      if (returnTarget?.isConnected) returnTarget.focus({ preventScroll: true });
    }

    async function shareProfilePhoto(requestedIndex = null, statusTarget = profilePhotoViewerStatus) {
      const photoThumbs = [...modalGallery.querySelectorAll(".thumb:not([data-profile-tv-index])")];
      const activePhoto = photoThumbs.find((thumb) => thumb.classList.contains("active"));
      const activePhotoIndex = Number.isInteger(requestedIndex) ? requestedIndex : profilePhotoViewer && !profilePhotoViewer.hidden
        ? Math.max(0, Number(profilePhotoViewer.dataset.profilePhotoIndex || 0))
        : Math.max(0, Number(activePhoto?.dataset.profilePhotoIndex || 0));
      const profileName = modalName.textContent.trim() || "Dancer";
      const activeItem = modalGallery.profilePhotoItems?.[activePhotoIndex];
      const url = profilePhotoShareUrl(profileName, citySelect.value || selectedCity(), activePhotoIndex);
      if (statusTarget) statusTarget.textContent = "";
      try {
        if (navigator.share) {
          await navigator.share({
            title: `${profileName} on MyDancr`,
            text: `View ${profileName}'s photo on MyDancr.`,
            url
          });
          void recordPublicEngagementShare("photo", String(activeItem?.id || ""));
          if (statusTarget) statusTarget.textContent = "Photo shared.";
          return;
        }
        const copied = await copyText(url, "Photo link copied");
        if (!copied) return;
        void recordPublicEngagementShare("photo", String(activeItem?.id || ""));
        if (statusTarget) statusTarget.textContent = "Photo link copied.";
      } catch (error) {
        if (error?.name === "AbortError") return;
        if (statusTarget) statusTarget.textContent = "Unable to share this photo.";
      }
    }

    function moveModalPhoto(direction, options = {}) {
      if (options.syncViewer && profilePhotoViewer && !profilePhotoViewer.hidden) {
        const currentIndex = Math.max(0, Number(profilePhotoViewer.dataset.profilePhotoIndex || 0));
        const totalPhotos = modalGallery.profilePhotoItems?.length || 0;
        const nextIndex = currentIndex + direction;
        if (nextIndex < 0 || nextIndex >= totalPhotos) return false;
        return scrollProfilePhotoViewerTo(nextIndex);
      }
      const selector = options.syncViewer || modalGallery.dataset.mediaTab !== "video"
        ? ".thumb:not([data-profile-tv-index])"
        : ".thumb[data-profile-tv-index]";
      let thumbs = [...modalGallery.querySelectorAll(selector)];
      if (thumbs.length < 2) return false;
      let currentIndex = Math.max(0, thumbs.findIndex((thumb) => thumb.classList.contains("active")));
      const tab = selector.includes("data-profile-tv-index") ? "video" : "photo";
      if (direction > 0 && currentIndex >= thumbs.length - 2 && profileMediaHasMore(tab)) {
        appendNextProfileMediaBatch(tab);
        thumbs = [...modalGallery.querySelectorAll(selector)];
        currentIndex = Math.max(0, thumbs.findIndex((thumb) => thumb.classList.contains("active")));
      }
      const requestedIndex = currentIndex + direction;
      if (options.syncViewer && (requestedIndex < 0 || requestedIndex >= thumbs.length)) return false;
      const nextIndex = (requestedIndex + thumbs.length) % thumbs.length;
      const nextThumb = thumbs[nextIndex];
      return selectModalMediaThumb(nextThumb, options);
    }

    function bindHorizontalProfilePhotoSwipe(element, options = {}) {
      if (!element) return;
      const vertical = options.vertical === true;
      let pointerId = null;
      let startX = 0;
      let startY = 0;
      let horizontal = false;
      let verticalGesture = false;
      let cancelled = false;
      let trackpadLockedUntil = 0;

      const resetGesture = () => {
        pointerId = null;
        horizontal = false;
        verticalGesture = false;
        cancelled = false;
        element.classList.remove("is-swiping");
      };

      element.addEventListener("pointerdown", (event) => {
        if (
          !event.isPrimary ||
          (event.pointerType === "mouse" && event.button !== 0) ||
          event.target.closest?.("button, a, input, select, textarea")
        ) {
          return;
        }
        pointerId = event.pointerId;
        startX = event.clientX;
        startY = event.clientY;
        horizontal = false;
        verticalGesture = false;
        cancelled = false;
        element.setPointerCapture?.(event.pointerId);
      });

      element.addEventListener("pointermove", (event) => {
        if (pointerId !== event.pointerId || cancelled) return;
        const distanceX = event.clientX - startX;
        const distanceY = event.clientY - startY;
        if (Math.abs(distanceX) < 10 && Math.abs(distanceY) < 10) return;
        if (vertical) {
          if (Math.abs(distanceX) >= Math.abs(distanceY)) {
            cancelled = true;
            return;
          }
          verticalGesture = true;
        } else {
          if (Math.abs(distanceY) >= Math.abs(distanceX)) {
            cancelled = true;
            return;
          }
          horizontal = true;
        }
        element.classList.add("is-swiping");
        event.preventDefault();
      }, { passive: false });

      element.addEventListener("pointerup", (event) => {
        if (pointerId !== event.pointerId) return;
        const distanceX = event.clientX - startX;
        const distanceY = event.clientY - startY;
        const verticalSwipe = vertical && verticalGesture && Math.abs(distanceY) >= 44 && Math.abs(distanceY) > Math.abs(distanceX) * 1.2;
        const horizontalSwipe = !vertical && horizontal && Math.abs(distanceX) >= 44 && Math.abs(distanceX) > Math.abs(distanceY) * 1.2;
        if (!cancelled && (verticalSwipe || horizontalSwipe)) {
          event.preventDefault();
          moveModalPhoto(vertical ? distanceY < 0 ? 1 : -1 : distanceX < 0 ? 1 : -1, options);
        }
        element.releasePointerCapture?.(event.pointerId);
        resetGesture();
      }, { passive: false });

      element.addEventListener("pointercancel", resetGesture);
      element.addEventListener("wheel", (event) => {
        const primaryDelta = vertical ? event.deltaY : event.deltaX;
        const crossDelta = vertical ? event.deltaX : event.deltaY;
        if (Math.abs(primaryDelta) < 18 || Math.abs(primaryDelta) <= Math.abs(crossDelta)) return;
        event.preventDefault();
        const now = Date.now();
        if (now < trackpadLockedUntil) return;
        trackpadLockedUntil = now + 320;
        moveModalPhoto(primaryDelta > 0 ? 1 : -1, options);
      }, { passive: false });
    }

    function uploadedProfilePhotoUrls(profile, includeUnapproved = false) {
      const submittedUrls = (profile?.submittedPhotos || [])
        .filter((photo) => includeUnapproved || normalizedReviewStatus(photo.reviewStatus || photo.review_status) === "approved")
        .map((photo) => photo.imageUrl || photo.image_url || photo.url || "")
        .filter(Boolean);
      const submittedStatusByUrl = new Map((profile?.submittedPhotos || [])
        .map((photo) => [
          photo.imageUrl || photo.image_url || photo.url || "",
          normalizedReviewStatus(photo.reviewStatus || photo.review_status || "pending")
        ])
        .filter(([url]) => Boolean(url)));
      const isVisibleApprovedUrl = (url) => includeUnapproved || !submittedStatusByUrl.has(url) || submittedStatusByUrl.get(url) === "approved";
      const galleryUrls = Array.isArray(profile?.galleryPhotoUrls)
        ? profile.galleryPhotoUrls.filter(Boolean).filter(isVisibleApprovedUrl)
        : [];
      const mainUrl = profile?.mainPhotoUrl && isVisibleApprovedUrl(profile.mainPhotoUrl) ? [profile.mainPhotoUrl] : [];
      return [...new Set([...mainUrl, ...galleryUrls, ...submittedUrls])].filter(Boolean);
    }

    function publicProfilePhotoUrl(profile) {
      return uploadedProfilePhotoUrls(profile, false)[0] || "";
    }

    function profilePhotoSrcSet(profile, photoUrl) {
      const normalizedUrl = String(photoUrl || "").trim();
      if (!normalizedUrl) return "";
      const submittedPhoto = (profile?.submittedPhotos || []).find((photo) =>
        [photo.imageUrl, photo.image_url, photo.url].some((url) => String(url || "").trim() === normalizedUrl)
      );
      if (submittedPhoto) return submittedPhoto.imageSrcSet || submittedPhoto.image_src_set || "";
      if (String(profile?.mainPhotoUrl || "").trim() === normalizedUrl) {
        return profile?.mainPhotoSrcSet || "";
      }
      const galleryIndex = (profile?.galleryPhotoUrls || []).findIndex(
        (url) => String(url || "").trim() === normalizedUrl
      );
      return galleryIndex >= 0 ? profile?.galleryPhotoSrcSets?.[galleryIndex] || "" : "";
    }

    function profilePhotoLikeMetadata(profile, photoUrl) {
      const normalizedUrl = String(photoUrl || "").trim();
      const submittedPhoto = (profile?.submittedPhotos || []).find((photo) =>
        [photo.imageUrl, photo.image_url, photo.url].some((url) => String(url || "").trim() === normalizedUrl)
      );
      if (submittedPhoto?.id) {
        return {
          mediaId: String(submittedPhoto.id),
          likeCount: safePublicMediaLikeCount(submittedPhoto.likeCount || submittedPhoto.like_count),
          isPinned: submittedPhoto.isPinned === true || submittedPhoto.is_pinned === true
        };
      }
      const galleryIndex = (profile?.galleryPhotoUrls || []).findIndex(
        (url) => String(url || "").trim() === normalizedUrl
      );
      return galleryIndex >= 0 ? {
        mediaId: String(profile?.galleryPhotoIds?.[galleryIndex] || ""),
        likeCount: safePublicMediaLikeCount(profile?.galleryPhotoLikeCounts?.[galleryIndex]),
        isPinned: profile?.galleryPhotoPins?.[galleryIndex] === true
      } : { mediaId: "", likeCount: 0 };
    }

    function publicProfilePhotoSrcSet(profile) {
      return profilePhotoSrcSet(profile, publicProfilePhotoUrl(profile));
    }

    function publicAvatarPhotoUrl(profile) {
      return String(profile?.avatarPhotoUrl || profile?.avatar_photo_url || publicProfilePhotoUrl(profile) || "").trim();
    }

    function publicAvatarPhotoSrcSet(profile) {
      return String(profile?.avatarPhotoSrcSet || profile?.avatar_photo_src_set || publicProfilePhotoSrcSet(profile) || "").trim();
    }

    function profilePhotoGalleryItems(profile, baseIndex, options = {}) {
      const isPrivatePreview = Boolean(options.preview);
      const uploadedUrls = uploadedProfilePhotoUrls(profile, isPrivatePreview);
      if (profile.status === "Pending" && !isPrivatePreview) return [];
      if (profile.photoStatus !== "Approved" && !isPrivatePreview && !uploadedUrls.length) return [];
      const galleryOffsets = uploadedUrls.length
        ? uploadedUrls.map((photoUrl, offset) => ({ offset, photoUrl }))
        : [0, 1, 2, 3].map((offset) => ({ offset, photoUrl: customPhotoUrl(profile, offset) }));
      return galleryOffsets.map(({ offset, photoUrl }) => {
        const like = profilePhotoLikeMetadata(profile, photoUrl);
        return {
          index: offset,
          id: like.mediaId,
          likeCount: like.likeCount,
          isPinned: like.isPinned === true,
          photoClass: portraitClass(baseIndex + offset),
          photoUrl,
          photoSrcSet: profilePhotoSrcSet(profile, photoUrl)
        };
      });
    }


    function profilePhotoThumbMarkup(item, total, galleryIndex = item.index) {
      const photoAttrs = nativeResponsivePhotoAttrs(item.photoUrl, item.photoSrcSet);
      const photoMarkup = photoAttrs
        ? `<img class="portrait ${escapeHtml(item.photoClass)} has-custom-photo" ${photoAttrs} sizes="(max-width: 720px) calc((100vw - 6px) / 3), 250px" width="360" height="504" alt="" aria-hidden="true" loading="${total <= PROFILE_MEDIA_PAGE_SIZE || galleryIndex < 6 ? "eager" : "lazy"}" fetchpriority="${galleryIndex < 3 ? "high" : "auto"}" decoding="async" draggable="false" data-image-state="loading">`
        : `<span class="portrait ${escapeHtml(item.photoClass)}"></span>`;
      return `
        <button class="thumb ${galleryIndex === 0 ? "active" : ""}" type="button" data-profile-photo-index="${galleryIndex}" data-photo="${escapeHtml(item.photoClass)}" data-photo-url="${displayText(item.photoUrl)}" aria-label="Open gallery photo ${galleryIndex + 1} of ${total} in scrolling cards${item.isPinned ? ", pinned" : ""}" aria-pressed="${galleryIndex === 0 ? "true" : "false"}">
          ${photoMarkup}
          ${item.isPinned ? '<svg class="dancer-photo-pin-indicator" aria-hidden="true" viewBox="0 0 24 24"><path d="m16 3 5 5-4 1-3 5-4-4 5-3 1-4Z" /><path d="m9 9 6 6M12 12l-7 7" /></svg>' : ""}
        </button>
      `;
    }

    function galleryMarkup(profile, baseIndex, options = {}) {
      const items = profilePhotoGalleryItems(profile, baseIndex, options);
      if (!items.length) {
        return profile.status === "Pending" && !options.preview
          ? '<div class="lock-row" style="grid-column:1/-1">Gallery locked.</div>'
          : '<div class="lock-row" style="grid-column:1/-1">Photos pending admin approval.</div>';
      }
      const limit = Math.max(1, Number(options.limit) || PROFILE_MEDIA_PAGE_SIZE);
      return items.slice(0, limit).map((item, index) => profilePhotoThumbMarkup(item, items.length, index)).join("");
    }

    function profileVideoPosterUrl(item) {
      return String(
        item?.posterUrl ||
        item?.poster_url ||
        ""
      ).trim();
    }

    function profileVideoThumbMarkup(item, index, total, profileName) {
      const scheduleLabel = profileTvScheduleLabel(item);
      const posterUrl = profileVideoPosterUrl(item);
      const previewMarkup = posterUrl
        ? `<img class="portrait profile-media-thumb-poster-image" src="${escapeHtml(posterUrl)}" alt="" aria-hidden="true" loading="${index < 6 ? "eager" : "lazy"}" fetchpriority="low" decoding="async" draggable="false" data-image-state="loading">`
        : '<span class="profile-media-thumb-poster" aria-hidden="true"></span>';
      return `
        <button class="thumb profile-media-thumb is-video" type="button" data-profile-tv-index="${index}" aria-pressed="false" aria-label="Open ${escapeHtml(profileName)} profile video ${index + 1} of ${total} in scrolling cards, ${escapeHtml(scheduleLabel)}">
          ${previewMarkup}
          <span class="profile-media-thumb-play" aria-hidden="true"></span>
        </button>
      `;
    }

    function profileMediaSentinel() {
      let sentinel = modalGallery.querySelector("[data-profile-media-lazy-sentinel]");
      if (sentinel) return sentinel;
      sentinel = document.createElement("div");
      sentinel.className = "profile-media-lazy-sentinel";
      sentinel.dataset.profileMediaLazySentinel = "";
      sentinel.setAttribute("aria-hidden", "true");
      modalGallery.appendChild(sentinel);
      return sentinel;
    }

    function profileMediaHasMore(tab = modalGallery.dataset.mediaTab) {
      if (tab === "video") {
        return Number(modalGallery.profileVisibleVideoCount || 0) < (modalGallery.profileTvVideos?.length || 0);
      }
      return Number(modalGallery.profileVisiblePhotoCount || 0) < (modalGallery.profilePhotoItems?.length || 0);
    }

    function appendNextProfileMediaBatch(tab = modalGallery.dataset.mediaTab, options = {}) {
      const sentinel = profileMediaSentinel();
      let appended = false;
      if (tab === "video") {
        const items = Array.isArray(modalGallery.profileTvVideos) ? modalGallery.profileTvVideos : [];
        const start = Number(modalGallery.profileVisibleVideoCount || 0);
        const end = Math.min(items.length, start + PROFILE_MEDIA_PAGE_SIZE);
        if (end > start) {
          sentinel.insertAdjacentHTML(
            "beforebegin",
            items.slice(start, end).map((item, offset) =>
              profileVideoThumbMarkup(item, start + offset, items.length, modalGallery.profileTvProfileName || "Dancer")
            ).join("")
          );
          modalGallery.profileVisibleVideoCount = end;
          appended = true;
        }
      } else {
        const items = Array.isArray(modalGallery.profilePhotoItems) ? modalGallery.profilePhotoItems : [];
        const start = Number(modalGallery.profileVisiblePhotoCount || 0);
        const end = Math.min(items.length, start + PROFILE_MEDIA_PAGE_SIZE);
        if (end > start) {
          sentinel.insertAdjacentHTML(
            "beforebegin",
            items.slice(start, end).map((item, offset) =>
              profilePhotoThumbMarkup(item, items.length, start + offset)
            ).join("")
          );
          modalGallery.profileVisiblePhotoCount = end;
          appended = true;
        }
      }
      if (appended) {
        profileMediaLastAppendScrollTop = Math.max(0, Number(profileModal?.scrollTop || 0));
      }
      sentinel.hidden = !profileMediaHasMore(tab);
      if (!options.skipObserve) window.requestAnimationFrame(observeProfileMediaSentinel);
    }

    function observeProfileMediaSentinel() {
      profileMediaObserver?.disconnect();
      profileMediaObserver = null;
      const tab = modalGallery.dataset.mediaTab || "photo";
      const sentinel = profileMediaSentinel();
      sentinel.hidden = !profileMediaHasMore(tab);
      if (sentinel.hidden || !("IntersectionObserver" in window)) return;
      profileMediaObserver = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        profileMediaObserver?.disconnect();
        profileMediaObserver = null;
        const scrollTop = Math.max(0, Number(profileModal?.scrollTop || 0));
        if (scrollTop < profileMediaLastAppendScrollTop + PROFILE_MEDIA_BATCH_SCROLL_STEP) return;
        appendNextProfileMediaBatch(tab);
      }, { root: profileModal, rootMargin: "480px 0px" });
      profileMediaObserver.observe(sentinel);
    }

    function queueProfileMediaObserverAfterScroll() {
      if (profileMediaObserverScrollFrame) return;
      profileMediaObserverScrollFrame = window.requestAnimationFrame(() => {
        profileMediaObserverScrollFrame = 0;
        if (!profileBackdrop.classList.contains("show") || !profileMediaHasMore()) return;
        observeProfileMediaSentinel();
      });
    }

    profileModal?.addEventListener("scroll", queueProfileMediaObserverAfterScroll, { passive: true });

    function initializeProfileMediaLibrary(profile, baseIndex, options = {}) {
      profileMediaObserver?.disconnect();
      profileMediaObserver = null;
      modalGallery.profilePhotoItems = profilePhotoGalleryItems(profile, baseIndex, options);
      modalGallery.profileVisiblePhotoCount = 0;
      modalGallery.profileTvVideos = [];
      modalGallery.profileVisibleVideoCount = 0;
      modalGallery.innerHTML = "";
      appendNextProfileMediaBatch("photo", { skipObserve: true });
      profileMediaLastAppendScrollTop = 0;
      profileMediaSentinel();
    }

    function shiftNotesMarkup(profile) {
      return profile.notes
        ? `<div class="info-tile"><strong>Notes</strong><div class="meta">${escapeHtml(profile.notes)}</div></div>`
        : "";
    }

    function shiftInterestTileMarkup(profile, status) {
      const hasUpcomingShift = profile.scheduled && status.state !== "active" && status.state !== "ended";
      const tileTitle = status.state === "active" ? "Who's going" : "Interest";
      const mutedClass = status.state === "active" || hasUpcomingShift ? "" : "muted muted-value";
      const statusText = status.state === "active" || hasUpcomingShift
        ? metricPhraseMarkup(`${tonightInterestCount(profile).toLocaleString()} people going`)
        : status.label;
      return `
        <div class="info-tile interest-tile" id="tonightInterestTile">
          <strong>${tileTitle}</strong>
          <div class="meta"><span class="interest-count ${mutedClass}" id="tonightInterestCount">${statusText}</span></div>
        </div>
      `;
    }

    function profileVenueDestinationMarkup(profile, options = {}) {
      const safeVenueName = displayText(profile.venue);
      const venueNameLength = Array.from(String(profile.venue || "").trim()).length;
      const venueNameSizeClass = venueNameLength <= 12
        ? " is-short-name"
        : venueNameLength <= 20
          ? " is-medium-name"
          : " is-long-name";
      const statusClass = options.live ? " is-live" : options.upcoming ? " is-upcoming" : "";
      return `
        <button class="profile-venue-destination${statusClass}${venueNameSizeClass}" type="button" data-open-venue="${safeVenueName}" aria-label="Open ${safeVenueName} club details">
          ${venueIconMarkup()}
          <span class="profile-venue-copy"><span class="profile-venue-name">${safeVenueName}</span></span>
          <span class="profile-venue-cue" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"></path></svg></span>
        </button>
      `;
    }

    function shiftsMarkup(profile, status = shiftStatus(profile), options = {}) {
      const isEditorPreview = Boolean(options.preview);
      const city = options.city || selectedCity();
      if (isWorkingTonight(profile) && profile.scheduled) {
        return `
          <div class="info-tile profile-schedule-card profile-shift-card working-now-tile schedule-live">
            <strong>Current shift</strong>
            <div class="profile-schedule-primary modal-schedule-text tonight">Working Now</div>
            <div class="schedule-stack">
              ${profileVenueDestinationMarkup(profile, { live: true })}
            </div>
            <p class="profile-schedule-explanation">This dancer is venue-confirmed as working here now.</p>
          </div>
        `;
      }
      const emptyScheduleCopy = isEditorPreview
        ? "<span>Tap a club’s dressing-room sticker to show guests where you are working now.</span>"
        : `${actionIconMarkup("bell")}<span data-profile-working-alert="${escapeOptionValue(profile.id || profile.name)}">Follow to get notified when ${escapeHtml(profile.name)} is working.</span>`;
      return `
        <div class="info-tile profile-schedule-card profile-shift-card schedule-empty${isEditorPreview ? "" : " has-working-alert"}" aria-label="Schedule status">
          <span class="profile-empty-state">Not working now</span>
          <span class="profile-empty-copy${isEditorPreview ? "" : " profile-working-alert"}" aria-live="polite">
            ${emptyScheduleCopy}
          </span>
        </div>
      `;
    }

    async function refreshOpenProfileWorkingAlert() {
      const hint = profileModal?.querySelector("[data-profile-working-alert]");
      if (!hint) return;
      const profile = findProfile(hint.dataset.profileWorkingAlert);
      if (!profile) return;
      const request = {};
      hint.workingAlertRequest = request;
      synchronizeAuthSession();
      const userId = isCustomerSession() ? authSession?.account?.id : "";
      const following = userId && isFollowingProfile(profile.city || selectedCity(), profile.name);
      if (!following) {
        hint.textContent = `Follow to get notified when ${profile.name} is working.`;
        return;
      }
      hint.innerHTML = '<a href="/dashboard/customer#customer-alerts">Enable notifications</a>';
      try {
        const moduleUrl = document.querySelector("script[data-device-module]")?.dataset.deviceModule;
        if (!moduleUrl) return;
        const [device, data] = await Promise.all([
          import(moduleUrl), getAuthenticatedJson("/api/customer/profile")
        ]);
        const enabled = await device.customerWorkingNowAlertsEnabled(data.profile, userId);
        if (!hint.isConnected || hint.workingAlertRequest !== request || synchronizeAuthSession()?.account?.id !== userId) return;
        if (enabled) hint.textContent = `You’ll be notified when ${profile.name} is working.`;
      } catch { /* Keep the settings link when delivery cannot be confirmed. */ }
    }

    window.addEventListener("mydancr:push-changed", () => { void refreshOpenProfileWorkingAlert(); });
    window.addEventListener("focus", () => { void refreshOpenProfileWorkingAlert(); });
    window.addEventListener("storage", () => { void refreshOpenProfileWorkingAlert(); });

    function profileActivityMetricsMarkup(profile, city = selectedCity()) {
      const followerCount = followerNumber(profile, city);
      return `
        <dl class="profile-activity-metrics" aria-label="Profile activity">
          <div>
            <dd id="modalFollowerCount" aria-live="polite">${profile.metricsUnavailable ? "—" : followerCount.toLocaleString()}</dd>
            <dt id="modalFollowerLabel">${followerCount === 1 ? "Follower" : "Followers"}</dt>
          </div>
          <div>
            <dd id="tonightInterestCount" aria-live="polite">${profile.metricsUnavailable ? "—" : tonightInterestCount(profile).toLocaleString()}</dd>
            <dt>Going</dt>
          </div>
          <div>
            <dd id="modalProfileViews" aria-live="polite">${profile.metricsUnavailable ? "—" : profileViewsToday(profile, city).toLocaleString()}</dd>
            <dt>Views today</dt>
          </div>
        </dl>
      `;
    }

    function dancerProfileDirectionsMarkup(profile, options = {}) {
      const city = options.city || selectedCity();
      if (options.preview || !profile?.scheduled) return "";
      const venue = resolveVenueByName(profile.venue, city);
      if (!venue) return "";
      return venueDirectionsMarkup({
        venue,
        className: "profile-primary-directions venue-directions-btn",
        label: "Directions",
        city,
        dancerId: profile.id || ""
      });
    }

    function dancerProfileUpcomingVenueDealMarkup(profile, options = {}) {
      const city = options.city || selectedCity();
      if (options.preview || !profile?.scheduled || isWorkingTonight(profile, city) || !profile?.venue) return "";
      const resolvedVenue = resolveVenueByName(profile.venue, city);
      const venue = resolvedVenue || {
        name: profile.venue,
        slug: profile.venueSlug || slugify(profile.venue)
      };
      const venueName = String(venue.name || profile.venue).trim();
      if (!venueName) return "";
      const openVenueAttribute = resolvedVenue
        ? ` data-open-venue-profile="${escapeOptionValue(venueName)}"`
        : "";
      return `<a class="profile-upcoming-venue-deal" href="${venueExperienceHref(venue, city)}"${openVenueAttribute} data-upcoming-venue-deal="venue-page" aria-label="View free entry on ${escapeHtml(venueName)}'s venue page"><span>Free Entry</span><span aria-hidden="true">›</span></a>`;
    }

    function dancerProfileTonightTravelActionsMarkup(profile, options = {}) {
      const city = options.city || selectedCity();
      if (options.preview) return "";
      if (!profile?.scheduled) return "";
      // Working Now links to the club page, where guests can get directions.
      if (isWorkingTonight(profile, city)) return "";
      const directionsMarkup = dancerProfileDirectionsMarkup(profile, { city });
      // Upcoming profiles may point customers to the venue, but they never
      // receive a deal trigger or dancer-attribution token.
      const venueDealMarkup = dancerProfileUpcomingVenueDealMarkup(profile, { city });
      const actions = [directionsMarkup, venueDealMarkup].filter(Boolean);
      if (!actions.length) return "";
      const statusClass = isWorkingTonight(profile, city) ? "is-working-now" : "is-upcoming";
      const dealLinkClass = venueDealMarkup ? " has-venue-deal-link" : "";
      const offerNote = venueDealMarkup ? `<p class="profile-upcoming-offer-note">Going tonight?</p>` : "";
      return `${offerNote}<div class="profile-tonight-travel-actions ${statusClass}${dealLinkClass}" aria-label="Venue travel actions">${actions.join("")}</div>`;
    }

    function profileModalGridMarkup(profile, options = {}) {
      const status = options.status || shiftStatus(profile);
      const city = options.city || selectedCity();
      const previewSocialMarkup = options.preview
        ? options.socialMarkup || socialLinksMarkup(profile, { preview: true })
        : "";
      const dealState = dancerClubDealState(profile);
      const dealMarkup = profile?.scheduled
        ? options.preview
          ? profileDealTileMarkup(profile, { preview: true })
          : profileDealTileMarkup(profile)
        : "";
      const travelActionsMarkup = dancerProfileTonightTravelActionsMarkup(profile, {
        city,
        preview: Boolean(options.preview)
      });
      const shiftState = isWorkingTonight(profile, city) && profile.scheduled
        ? "now"
        : profile.scheduled
          ? "upcoming"
          : "no-schedule";
      const tonightClasses = [
        "profile-tonight-card",
        isWorkingTonight(profile, city) && profile.scheduled ? "is-now" : "",
        profile.scheduled && !isWorkingTonight(profile, city) ? "is-upcoming" : "",
        !profile.scheduled ? "is-no-schedule" : "",
        dealState.key === "available" ? "has-club-deal" : "",
        profile.scheduled && !isWorkingTonight(profile, city) && profile.venue ? "has-venue-deal-link" : ""
      ].filter(Boolean).join(" ");
      return `
        <div class="modal-grid ${options.preview ? "is-editor-preview" : ""}">
          ${options.preview ? "" : liveProfileModalActionsMarkup(profile, status)}
          <section class="${tonightClasses}" data-profile-shift-state="${shiftState}" data-profile-deal-state="${escapeHtml(dealState.key)}" aria-label="Tonight">
            ${shiftsMarkup(profile, status, { preview: Boolean(options.preview), city })}
            ${dealMarkup ? `<div class="profile-tonight-deal">${dealMarkup}</div>` : ""}
            ${travelActionsMarkup}
          </section>
          ${profileLocationStatusTile(profile, city)}
          ${previewSocialMarkup}
        </div>
      `;
    }

    function profileActionButtonMarkup(icon, label) {
      return `<span class="profile-action-main">${actionButtonLabel(icon, label)}</span>`;
    }

    function liveProfileModalActionsMarkup(profile, status) {
      const city = selectedCity();
      const isFollowed = isFollowingProfile(city, profile.name);
      const isGoingTonight = !!goingTonightSavedByProfile[profile.name];
      const isWorkingNow = isWorkingTonight(profile, city);
      const canMarkGoing = Boolean(profile?.scheduled && profile.shiftId);
      const goingCopy = { idle: "I'm Going", active: "Going" };
      const goingButton = canMarkGoing
        ? `<button class="action-btn going-btn profile-action-icon-control is-available-action ${isGoingTonight ? "is-going" : ""}" id="goingBtn" type="button" data-profile="${escapeHtml(profile.name)}" data-shift-state="posted" aria-label="${isGoingTonight ? "Remove this shift from your plans" : "Add this shift to your plans"}" aria-pressed="${isGoingTonight}">${profileActionButtonMarkup(isGoingTonight ? "check" : "clock", isGoingTonight ? goingCopy.active : goingCopy.idle)}</button>`
        : `<button class="action-btn going-btn profile-action-icon-control secondary is-unavailable" id="goingBtn" type="button" data-profile="${escapeHtml(profile.name)}" data-shift-state="unavailable" aria-disabled="true" disabled>${profileActionButtonMarkup("clock", goingCopy.idle)}</button>`;
      return `
        <div class="modal-actions profile-actions-compact ${isWorkingNow ? "is-working-now" : profile?.scheduled ? "is-upcoming-shift" : "is-no-live-shift"}" aria-label="Guest actions">
          <button class="action-btn follow-primary profile-action-icon-control ${isFollowed ? "is-following" : ""}" id="followBtn" data-profile="${escapeOptionValue(profile.id || profile.name)}" aria-pressed="${isFollowed}">${profileActionButtonMarkup(isFollowed ? "check" : "personPlus", isFollowed ? "Following" : "Follow")}</button>
          ${goingButton}
          <button class="action-btn secondary profile-share-action profile-action-icon-control" type="button" data-profile-share-menu="${escapeHtml(profile.name)}" data-share-city="${escapeHtml(city)}" aria-haspopup="dialog" aria-label="Share ${escapeHtml(profile.name)} profile">${profileActionButtonMarkup("share", "Share")}</button>
        </div>
      `;
    }

    async function refreshProfileGoingState(profile) {
      if (!profile?.shiftId || window.location.protocol === "file:") return;
      try {
        const headers = { Accept: "application/json" };
        if (authSession?.accessToken) headers.Authorization = `Bearer ${authSession.accessToken}`;
        if (authSession?.refreshToken) headers["X-Dancr-Refresh-Token"] = authSession.refreshToken;
        const response = await fetch(`/api/customer/going?shiftId=${encodeURIComponent(profile.shiftId)}`, {
          method: "GET",
          headers,
          cache: "no-store"
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.ok === false) throw new Error(apiErrorMessage(data));
        const realCount = Number(data.goingCount);
        if (!Number.isSafeInteger(realCount) || realCount < 0) return;

        const savedGoing = data.going === true;
        goingTonightByProfile[profile.name] = realCount;
        goingTonightSavedByProfile[profile.name] = savedGoing;
        profile.goingCount = realCount;

        const actionButton = document.getElementById("goingBtn");
        if (!actionButton || actionButton.dataset.profile !== profile.name) return;
        const idleLabel = "I'm Going";
        const activeLabel = "Going";
        const countEl = document.getElementById("tonightInterestCount");
        if (countEl) {
          countEl.classList.remove("muted");
          countEl.textContent = realCount.toLocaleString();
        }
        actionButton.classList.toggle("is-going", savedGoing);
        actionButton.setAttribute("aria-label", savedGoing ? "Remove this shift from your plans" : "Add this shift to your plans");
        actionButton.setAttribute("aria-pressed", String(savedGoing));
        actionButton.innerHTML = profileActionButtonMarkup(savedGoing ? "check" : "clock", savedGoing ? activeLabel : idleLabel);
      } catch {
        // Keep the server-rendered count visible if the latest status cannot be loaded.
      }
    }

    function resetProfileModalScroll() {
      [profileBackdrop, profileModal].forEach((element) => {
        if (!element) return;
        element.scrollTop = 0;
        element.scrollLeft = 0;
        try {
          element.scrollTo({ top: 0, left: 0, behavior: "auto" });
        } catch {
          element.scrollTop = 0;
          element.scrollLeft = 0;
        }
      });
    }

    function focusProfileModalStart() {
      resetProfileModalScroll();
      requestAnimationFrame(() => {
        resetProfileModalScroll();
        requestAnimationFrame(resetProfileModalScroll);
      });
    }

    function profileReturnSurfaceElement(surface) {
      if (surface === "customer-dashboard") return customerDashboard;
      if (surface === "dancer-dashboard") return dancerDashboard;
      if (surface === "venue-dashboard") return venueDashboard;
      if (surface === "admin-dashboard") return adminDashboard;
      return null;
    }

    function activeProfileReturnSurface(explicitSurface = "") {
      if (profileReturnSurfaceElement(explicitSurface)) return explicitSurface;
      if (customerDashboard.classList.contains("show")) return "customer-dashboard";
      if (dancerDashboard.classList.contains("show")) return "dancer-dashboard";
      if (venueDashboard.classList.contains("show")) return "venue-dashboard";
      if (adminDashboard.classList.contains("show")) return "admin-dashboard";
      return "";
    }

    function captureProfileReturnContext(explicitSurface = "") {
      const surface = activeProfileReturnSurface(explicitSurface);
      const panel = profileReturnSurfaceElement(surface);
      if (!panel) return null;
      return {
        surface,
        panelScrollTop: panel.scrollTop || 0,
        windowScrollY: window.scrollY || 0,
        location: `${window.location.pathname}${window.location.search}${window.location.hash}`,
        focusTarget: document.activeElement instanceof HTMLElement ? document.activeElement : null
      };
    }

    function suspendProfileReturnSurface(context) {
      const panel = profileReturnSurfaceElement(context?.surface);
      if (!panel) return false;
      panel.classList.remove("show");
      panel.setAttribute("aria-hidden", "true");
      syncOverlayScrollLock();
      return true;
    }

    function restoreProfileReturnContext(context) {
      if (context?.surface === "customer-dashboard") return openUnifiedDashboard("customer");
      const panel = profileReturnSurfaceElement(context?.surface);
      if (!panel) return false;
      if (context.location) {
        window.history.replaceState({}, document.title, context.location);
      }
      if (context.surface === "dancer-dashboard") activeDashboardType = "dancer";
      if (context.surface === "venue-dashboard") activeDashboardType = "venue";
      panel.classList.add("show");
      panel.setAttribute("aria-hidden", "false");
      if (context.surface === "dancer-dashboard") startDancerVenueApprovalPolling();
      updateAccountHeader();
      syncOverlayScrollLock();
      requestAnimationFrame(() => {
        panel.scrollTop = context.panelScrollTop || 0;
        window.scrollTo({ top: context.windowScrollY || 0, left: 0, behavior: "auto" });
        if (context.focusTarget?.isConnected) {
          context.focusTarget.focus({ preventScroll: true });
        }
      });
      return true;
    }
