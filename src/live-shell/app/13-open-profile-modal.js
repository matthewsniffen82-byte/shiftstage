

    function openProfileModal(profileReference, options = {}) {
      let city = citySelect.value;
      const isPrivatePreview = Boolean(options.preview);
      const profile = findProfile(profileReference, { includePending: isPrivatePreview });
      if (!profile) return;
      profileModal.dataset.analyticsDancerId = isPrivatePreview ? "" : String(profile.id || "");
      profileModal.dataset.publicDancerId = isPrivatePreview ? "" : String(profile.id || "");
      profileModal.removeAttribute("data-public-visibility-hidden");
      city = profileDiscoveryCity(profile, city);
      profileModalReturnContext = captureProfileReturnContext(options.returnTo || "");
      profileModalReturnTarget = profileModalReturnContext?.surface || "";
      const profileName = profile.name;
      const baseProfile = discoveryMarket(city).dancers.find((item) => (
        !item.hidden && (
          (profile.id && item.id === profile.id) ||
          (profile.slug && item.slug === profile.slug)
        )
      )) || profile;
      if (baseProfile?.status === "Verified") {
        recordUniqueTrendEvent("profileViews", city, profileName);
        if (baseProfile.scheduled) recordUniqueTrendEvent("scheduleViews", city, profileName);
      }
      if (!isPrivatePreview) {
        recordLiveEvent("profile_view", { dancerName: profileName, city, source: "profile_modal" });
        if (baseProfile?.scheduled) {
          recordLiveEvent("schedule_view", { dancerName: profileName, city, source: "profile_modal" });
        }
      }
      const exactProfileIndex = discoveryMarket(city).dancers.findIndex((item) => (
        (profile.id && item.id === profile.id) ||
        (profile.slug && item.slug === profile.slug)
      ));
      const profileIndex = exactProfileIndex >= 0
        ? exactProfileIndex
        : discoveryMarket(city).dancers.findIndex((item) => item.name === profile.name);
      const isPending = profile.status === "Pending";
      const profileWithTrend = !isPending ? withTrendingRank(profile, city) : profile;
      const modalTrendRank = profileWithTrend.trendRank;
      const status = shiftStatus(profile);
      const modalIsWorkingNow = isWorkingTonight(profile, city);
      const modalHasUpcomingShift = false;
      const basePhoto = portraitClass(profileIndex);
      const visiblePhotoUrls = uploadedProfilePhotoUrls(profile, isPrivatePreview);
      const basePhotoUrl = visiblePhotoUrls[0] || (isPrivatePreview ? customPhotoUrl(profile, 0) : "");
      const avatarPhotoUrl = publicAvatarPhotoUrl(profile) || basePhotoUrl;
      savedScrollY = window.scrollY;

      modalName.textContent = profile.name;
      modalGallery.dataset.profileMediaProfile = String(profile.id || "");
      const profileReportButton = document.getElementById("reportBtn");
      if (profileReportButton) {
        profileReportButton.dataset.profile = profile.name;
        profileReportButton.dataset.reportTargetLabel = profile.name;
        profileReportButton.dataset.reportDefaultLabel = "Report profile";
        prepareContentReportButton(
          profileReportButton,
          "dancer_profile",
          String(profile.id || ""),
          `Report ${profile.name} profile`
        );
      }
      modalStatus.textContent = isPending ? "Pending" : "";
      modalStatus.className = isPending ? "badge pending" : "badge modal-status-hidden";
      modalCity.textContent = city;
      modalCity.hidden = false;
      modalProfileMetrics.innerHTML = profileActivityMetricsMarkup(profile, city);
      modalName.closest(".profile-modal-name-row")?.setAttribute(
        "data-follower-label",
        modalProfileMetrics.querySelector("#modalFollowerLabel")?.textContent?.trim() || "Followers"
      );
      modalRank.className = "badge trend modal-rank";
      modalRank.innerHTML = "";
      modalRank.hidden = true;
      modalRank.setAttribute("aria-hidden", "true");
      modalRank.removeAttribute("aria-label");
      if (modalTrendRank) {
        modalRank.className = "modal-rank card-trend-marker modal-card-trend";
        modalRank.innerHTML = `<span class="card-trend-symbol" aria-hidden="true">↗</span><span>#${modalTrendRank}</span>`;
        modalRank.hidden = false;
        modalRank.removeAttribute("aria-hidden");
        modalRank.setAttribute("aria-label", `Trending rank ${modalTrendRank}`);
      }
      initializeProfileMediaLibrary(profile, profileIndex, { preview: isPrivatePreview });
      const photoCount = modalGallery.profilePhotoItems?.length || 0;
      syncProfileMediaTabCounts(photoCount, 0);
      modalProfileAvatar.className = `profile-modal-avatar ${basePhoto}${avatarPhotoUrl ? " has-photo" : ""}`;
      modalProfileAvatar.dataset.workingNow = String(modalIsWorkingNow);
      modalProfileAvatar.dataset.upcoming = String(modalHasUpcomingShift);
      modalProfileAvatarBorder.textContent = avatarPhotoUrl ? "" : profile.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
      if (avatarPhotoUrl) {
        modalProfileAvatar.style.backgroundImage = `url('${safeCssUrl(avatarPhotoUrl)}'), radial-gradient(circle at 68% 20%, rgba(126,234,255,.16), transparent 34%), linear-gradient(145deg, rgba(109,40,217,.38), #08080d)`;
        modalProfileAvatar.style.setProperty(
          "--custom-photo-position",
          avatarPhotoPosition(
            profile.avatarPhotoFocalX ?? profile.mainPhotoFocalX,
            profile.avatarPhotoFocalY ?? profile.mainPhotoFocalY
          )
        );
      } else {
        modalProfileAvatar.style.removeProperty("background-image");
        modalProfileAvatar.style.removeProperty("--custom-photo-position");
      }
      modalProfileAvatar.setAttribute("aria-label", `${profile.name} profile photo${modalIsWorkingNow ? ", working now" : modalHasUpcomingShift ? ", upcoming shift posted" : ""}`);
      setProfileMediaTab("photo");
      setModalPhoto(basePhoto, basePhotoUrl);
      const liveSocialMarkup = isPending && !isPrivatePreview
        ? ""
        : socialLinksMarkup(profile, { preview: isPrivatePreview });
      modalMediaSocials.innerHTML = liveSocialMarkup;
      modalMediaSocials.hidden = !liveSocialMarkup;

      if (isPending && !isPrivatePreview) {
        modalBody.innerHTML = `
          <div class="lock-list">
            <div class="lock-row"><strong>Pending.</strong> Profile under review.</div>
            <div class="lock-row">Schedule locked.</div>
            <div class="lock-row">Social links locked.</div>
            <div class="lock-row">Gallery locked.</div>
          </div>
        `;
      } else {
        modalBody.innerHTML = profileModalGridMarkup(profile, { preview: isPrivatePreview, status, city });
        if (!isPrivatePreview) void hydrateProfileClubDealQr(modalBody);
        void loadProfileMyDancrTv(profile);
      }

      resetProfileModalScroll();
      profileBackdrop.classList.add("show");
      void refreshOpenProfileWorkingAlert();
      profileBackdrop.setAttribute("aria-hidden", "false");
      focusProfileModalStart();
      syncOverlayScrollLock();
      if (!isPending && !isPrivatePreview && profile.shiftId) {
        void refreshProfileGoingState(profile);
      }
    }

    let profileTvViewerMuted = false;
    let profileTvPlaybackFeedbackTimer = 0;

    function profileTvViewerScrollTarget(openingIndexValue, scrollTop, clientHeight, offsets = [], inset = 0) {
      const openingIndex = Number(openingIndexValue);
      if (openingIndexValue !== undefined && Number.isInteger(openingIndex)) {
        return { index: Math.max(0, openingIndex), locked: true };
      }
      return {
        index: offsets.length ? profileMediaCardScrollIndex(scrollTop, offsets, inset)
          : Math.max(0, Math.round(Number(scrollTop || 0) / Math.max(1, Number(clientHeight || 0)))),
        locked: false
      };
    }

    function profileTvViewer() {
      let overlay = document.getElementById("profileTvViewer");
      if (overlay) return overlay;
      document.body.insertAdjacentHTML("beforeend", `
        <div class="profile-tv-viewer profile-media-card-feed" id="profileTvViewer" role="dialog" aria-modal="true" aria-label="MyDancr TV video" aria-hidden="true" hidden>
          <div class="profile-tv-viewer-shell">
            <div class="profile-tv-viewer-stage" id="profileTvViewerStage" aria-label="Dancer videos. Scroll up or down to change videos."></div>
            <span class="profile-tv-playback-feedback" id="profileTvPlaybackFeedback" aria-hidden="true"></span>
            <button class="profile-tv-viewer-previous" type="button" data-previous-profile-tv aria-label="Previous dancer video">↑</button>
            <button class="profile-tv-viewer-next" type="button" data-next-profile-tv aria-label="Next dancer video">↓</button>
            <div class="profile-tv-viewer-footer">
              <div class="profile-tv-viewer-copy">
                <strong id="profileTvViewerName"></strong>
                <span id="profileTvViewerSchedule"></span>
              </div>
              <div class="profile-tv-viewer-actions">
                <button class="profile-tv-viewer-like" type="button" data-like-profile-tv aria-label="Like this profile video" aria-pressed="false">${actionIconMarkup("heart")}<span data-media-like-count>0</span></button>
                <button class="profile-tv-viewer-state-control" type="button" data-toggle-profile-tv-sound aria-label="Turn TV video sound off">${modalVideoSoundIcon(false)}</button>
                <button class="profile-tv-viewer-share" type="button" data-share-profile-tv aria-label="Share this profile video">${actionIconMarkup("share")}</button>
                <button class="profile-tv-viewer-report" type="button" data-report-profile-tv aria-label="Report this profile video">${actionIconMarkup("report")}</button>
              </div>
              <p class="profile-tv-viewer-status" id="profileTvViewerStatus" aria-live="polite"></p>
            </div>
          </div>
        </div>
      `);
      overlay = document.getElementById("profileTvViewer");
      const stage = document.getElementById("profileTvViewerStage");
      let scrollFrame = 0;

      overlay.addEventListener("click", (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;
        if (target === overlay) {
          closeProfileTvViewer();
          return;
        }
        if (target.closest("[data-toggle-profile-tv-sound]")) {
          toggleProfileTvSound();
          return;
        }
        if (target.closest("[data-like-profile-tv]")) {
          const videoId = overlay.dataset.videoId || "";
          if (videoId) void togglePublicMediaLike("video", videoId, document.getElementById("profileTvViewerStatus"));
          return;
        }
        if (target.closest("[data-report-profile-tv]")) {
          const reportButton = target.closest("[data-report-profile-tv]");
          openContentReportDialog({
            button: reportButton,
            status: document.getElementById("profileTvViewerStatus"),
            targetType: reportButton.dataset.reportTargetType,
            targetId: reportButton.dataset.reportTargetId,
            targetLabel: reportButton.dataset.reportTargetLabel,
            title: "Report video",
            quickReasons: true
          });
          return;
        }
        if (target.closest("[data-previous-profile-tv]")) {
          showRelativeProfileTvVideo(-1);
          return;
        }
        if (target.closest("[data-next-profile-tv]")) {
          showRelativeProfileTvVideo(1);
          return;
        }
        if (target.closest("[data-share-profile-tv]")) {
          void shareProfileTvVideo();
        }
      });

      stage.addEventListener("scroll", () => {
        window.cancelAnimationFrame(scrollFrame);
        scrollFrame = window.requestAnimationFrame(() => {
          scrollFrame = 0;
          if (overlay.hidden || stage.clientHeight <= 0) return;
          const target = profileTvViewerScrollTarget(
            overlay.dataset.openingVideoIndex,
            stage.scrollTop,
            stage.clientHeight,
            [...stage.querySelectorAll("[data-profile-tv-viewer-index]")].map((slide) => slide.offsetTop),
            profileMediaCardScrollInset(stage)
          );
          if (target.locked) {
            scrollProfileTvViewerTo(target.index, { instant: true });
            return;
          }
          renderProfileTvViewerItem(target.index, { scroll: false });
        });
      }, { passive: true });
      stage.addEventListener("click", (event) => {
        if (event.target instanceof HTMLVideoElement) toggleProfileTvPlayback();
      });
      stage.addEventListener("dblclick", (event) => event.preventDefault());
      stage.addEventListener("volumechange", syncProfileTvSoundControl, true);
      return overlay;
    }

    function profileTvScheduleLabel(item) {
      if (item.shift?.isActive) return "Working Now";
      if (!item.shift) return "No shift posted";
      const dateLabel = formatProfileTvShift(item.shift.startsAt, item.shift.timezone);
      return dateLabel ? `Upcoming · ${dateLabel}` : "Upcoming";
    }

    function formatProfileTvDuration(durationSeconds) {
      const totalSeconds = Math.max(0, Math.round(Number(durationSeconds) || 0));
      const minutes = Math.floor(totalSeconds / 60);
      return `${minutes}:${String(totalSeconds % 60).padStart(2, "0")}`;
    }

    function renderProfileTvViewerSlides(overlay, videos, profileName) {
      const stage = document.getElementById("profileTvViewerStage");
      if (!stage) return;
      mountProfileMediaCardControls(overlay);
      mountProfileMediaCardHeader(overlay);
      stage.innerHTML = "";
      videos.forEach((item, index) => {
        const slide = document.createElement("section");
        slide.className = "profile-tv-viewer-slide";
        slide.dataset.profileTvViewerIndex = String(index);
        slide.setAttribute("aria-label", `${profileName} video ${index + 1} of ${videos.length}`);
        const video = document.createElement("video");
        video.className = "profile-tv-viewer-video";
        video.dataset.videoUrl = String(item.videoUrl || "").trim();
        video.loop = true;
        video.muted = profileTvViewerMuted;
        video.defaultMuted = profileTvViewerMuted;
        video.playsInline = true;
        video.preload = "none";
        video.setAttribute("controlslist", "nofullscreen noremoteplayback nodownload");
        video.setAttribute("disablepictureinpicture", "");
        const posterUrl = profileVideoPosterUrl(item);
        if (posterUrl && Math.abs(index - Number(overlay.dataset.videoIndex || 0)) <= 2) {
          video.poster = posterUrl;
        }
        video.addEventListener("loadeddata", () => {
          if (Number(overlay.dataset.videoIndex || 0) !== index) return;
          overlay.dataset.loadedVideoIndex = String(index);
          syncProfileTvVideoLoading(overlay, index);
        });
        video.addEventListener("emptied", () => { delete video.dataset.frameReady; });
        watchVideoPosterPresentation(video);
        slide.appendChild(video);
        const poster = document.createElement("img");
        poster.className = "profile-media-video-poster";
        poster.alt = "";
        poster.setAttribute("aria-hidden", "true");
        poster.loading = "eager";
        poster.decoding = "async";
        if (video.poster) poster.src = video.poster;
        slide.appendChild(poster);
        appendProfileMediaBackButton(slide, closeProfileTvViewer);
        stage.appendChild(slide);
      });
      mountProfileMediaCardHeader(overlay, stage);
    }

    function syncProfileTvVideoLoading(overlay, activeIndex) {
      const videos = Array.isArray(overlay?.profileTvVideos) ? overlay.profileTvVideos : [];
      const activeReady = overlay?.dataset.loadedVideoIndex === String(activeIndex);
      const allowNextWarmup = canWarmAdjacentVideo();
      overlay?.querySelectorAll(".profile-tv-viewer-video").forEach((video, index) => {
        const item = videos[index];
        const posterUrl = profileVideoPosterUrl(item);
        const poster = video.nextElementSibling;
        if (posterUrl && Math.abs(index - activeIndex) <= 2) {
          video.poster = posterUrl;
          if (poster?.getAttribute("src") !== posterUrl) poster?.setAttribute("src", posterUrl);
        } else {
          video.removeAttribute("poster");
          poster?.removeAttribute("src");
        }
        const mode = document.visibilityState === "hidden"
          ? index === activeIndex ? "retain" : "release"
          : videoBufferMode(index, activeIndex, allowNextWarmup, activeReady, video.hasAttribute("src"));
        applyVideoBufferMode(video, mode);
      });
    }

    function activeProfileTvViewerVideo() {
      const overlay = document.getElementById("profileTvViewer");
      const index = Math.max(0, Number(overlay?.dataset.videoIndex || 0));
      return overlay?.querySelector(`[data-profile-tv-viewer-index="${index}"] .profile-tv-viewer-video`) || null;
    }

    function scrollProfileTvViewerTo(index, options = {}) {
      const stage = document.getElementById("profileTvViewerStage");
      if (!stage) return false;
      const activeSlide = stage.querySelector(`[data-profile-tv-viewer-index="${index}"]`);
      stage.scrollTo({
        behavior: options.instant || window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
        top: index === 0 ? 0 : Math.max(0, activeSlide?.offsetTop ?? 0)
      });
      return true;
    }

    function settleProfileTvViewerOpening(overlay, index) {
      if (!overlay || overlay.hidden || overlay.dataset.openingVideoIndex !== String(index)) return;
      window.cancelAnimationFrame(Number(overlay.profileTvOpeningFrame || 0));
      let remainingFrames = 3;
      const settle = () => {
        if (overlay.hidden || overlay.dataset.openingVideoIndex !== String(index)) return;
        renderProfileTvViewerItem(index, { instant: true });
        scrollProfileTvViewerTo(index, { instant: true });
        if (remainingFrames > 0) {
          remainingFrames -= 1;
          overlay.profileTvOpeningFrame = window.requestAnimationFrame(settle);
          return;
        }
        overlay.profileTvOpeningFrame = 0;
        delete overlay.dataset.openingVideoIndex;
      };
      overlay.profileTvOpeningFrame = window.requestAnimationFrame(settle);
    }

    function renderProfileTvViewerItem(index, options = {}) {
      const overlay = document.getElementById("profileTvViewer");
      const videos = overlay?.profileTvVideos || [];
      const nextIndex = Math.min(Math.max(Number(index) || 0, 0), Math.max(0, videos.length - 1));
      const item = videos[nextIndex];
      if (!overlay || !item) return;
      const stage = document.getElementById("profileTvViewerStage");
      const currentIndex = Number(overlay.dataset.videoIndex || 0);
      if (currentIndex === nextIndex && options.scroll === false) return;
      if (currentIndex !== nextIndex) clearProfileTvPlaybackFeedback();
      const scheduleLabel = profileTvScheduleLabel(item);
      overlay.dataset.videoId = String(item.id || "");
      overlay.dataset.videoIndex = String(nextIndex);
      mountProfileMediaCardControls(overlay, stage?.querySelector(`[data-profile-tv-viewer-index="${nextIndex}"]`));
      if (currentIndex !== nextIndex) delete overlay.dataset.loadedVideoIndex;
      document.getElementById("profileTvViewerSchedule").textContent = `${scheduleLabel} · Scroll up or down · Video ${nextIndex + 1} of ${videos.length}`;
      document.getElementById("profileTvViewerStatus").textContent = "";
      preparePublicMediaLikeButton(
        overlay.querySelector("[data-like-profile-tv]"),
        "video",
        String(item.id || ""),
        item.likeCount
      );
      const reportButton = overlay.querySelector("[data-report-profile-tv]");
      if (reportButton) {
        reportButton.dataset.reportTargetLabel = `${overlay.dataset.profileName || "Dancer"} profile video ${nextIndex + 1}`;
        reportButton.dataset.reportDefaultLabel = "Report this profile video";
      }
      prepareContentReportButton(
        reportButton,
        "tv_video",
        String(item.id || ""),
        "Report this profile video"
      );
      const viewerVideos = [...overlay.querySelectorAll(".profile-tv-viewer-video")];
      syncProfileTvVideoLoading(overlay, nextIndex);
      viewerVideos.forEach((video, videoIndex) => {
        if (videoIndex === nextIndex) {
          video.id = "profileTvViewerVideo";
        } else {
          video.removeAttribute("id");
        }
        video.muted = profileTvViewerMuted;
        if (videoIndex !== nextIndex) video.pause();
      });
      if (options.scroll !== false && stage) {
        scrollProfileTvViewerTo(nextIndex, options);
      }
      const video = activeProfileTvViewerVideo();
      if (video?.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        overlay.dataset.loadedVideoIndex = String(nextIndex);
        syncProfileTvVideoLoading(overlay, nextIndex);
      }
      document.querySelector("[data-previous-profile-tv]").disabled = nextIndex <= 0;
      document.querySelector("[data-next-profile-tv]").disabled = nextIndex >= videos.length - 1;
      document.body.classList.add("profile-tv-viewer-open");
      syncProfileTvSoundControl();
      if (video) void playProfileTvViewerVideo(video);
    }

    async function playProfileTvViewerVideo(video) {
      if (document.visibilityState === "hidden") return;
      try {
        await video.play();
        return;
      } catch (error) {
        if (error?.name === "AbortError" || video !== activeProfileTvViewerVideo()) return;
      }
      // iOS may deny sound-on autoplay for the newly scrolled-to element.
      if (!video.muted) {
        video.muted = true;
        profileTvViewerMuted = true;
        syncProfileTvSoundControl();
        try { await video.play(); return; }
        catch (error) {
          if (error?.name === "AbortError" || video !== activeProfileTvViewerVideo()) return;
        }
      }
      if (video === activeProfileTvViewerVideo()) {
        document.getElementById("profileTvViewerStatus").textContent = "Tap the video to start it.";
      }
    }

    function showRelativeProfileTvVideo(direction) {
      const overlay = document.getElementById("profileTvViewer");
      const currentIndex = Number(overlay?.dataset.videoIndex || 0);
      renderProfileTvViewerItem(currentIndex + direction);
    }

    function openProfileTvViewer(item, profileName, videos, requestedIndex = null) {
      const overlay = profileTvViewer();
      overlay.dataset.publicDancerId = profileModal.dataset.publicDancerId || "";
      overlay.removeAttribute("data-public-visibility-hidden");
      overlay.profileTvVideos = Array.isArray(videos) ? videos : [item];
      const parsedRequestedIndex = Number(requestedIndex);
      const matchingItemIndex = overlay.profileTvVideos.indexOf(item);
      const matchingIdIndex = overlay.profileTvVideos.findIndex((videoItem) => videoItem.id === item.id);
      const fallbackIndex = matchingItemIndex >= 0 ? matchingItemIndex : Math.max(0, matchingIdIndex);
      const initialIndex = requestedIndex !== null && Number.isInteger(parsedRequestedIndex)
        ? Math.min(Math.max(parsedRequestedIndex, 0), Math.max(0, overlay.profileTvVideos.length - 1))
        : fallbackIndex;
      overlay.profileTvReturnTarget = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      overlay.dataset.videoIndex = String(initialIndex);
      delete overlay.dataset.loadedVideoIndex;
      overlay.dataset.openingVideoIndex = String(initialIndex);
      overlay.dataset.profileName = String(profileName || "Dancer");
      overlay.dataset.profileMediaHeading = `${profileName || "Dancer"} · Videos`;
      overlay.setAttribute("aria-label", `${profileName || "Dancer"} MyDancr TV video`);
      document.getElementById("profileTvViewerName").textContent = profileName || "MyDancr TV";
      renderProfileTvViewerSlides(overlay, overlay.profileTvVideos, profileName || "Dancer");
      void loadPublicMediaLikes(overlay.profileTvVideos.map((videoItem) => ({
        mediaType: "video",
        mediaId: String(videoItem.id || ""),
        likeCount: videoItem.likeCount
      })));
      overlay.hidden = false;
      overlay.classList.add("show");
      overlay.setAttribute("aria-hidden", "false");
      document.body.classList.add("profile-tv-viewer-open");
      settleProfileTvViewerOpening(overlay, initialIndex);
      window.requestAnimationFrame(() => renderProfileTvViewerItem(initialIndex, { instant: true }));
      overlay.querySelector(`[data-profile-tv-viewer-index="${initialIndex}"] .profile-media-card-back`)?.focus({ preventScroll: true });
      syncOverlayScrollLock();
    }

    function closeProfileTvViewer() {
      const overlay = document.getElementById("profileTvViewer");
      if (!overlay || overlay.hidden) return;
      const returnTarget = overlay.profileTvReturnTarget;
      const stage = document.getElementById("profileTvViewerStage");
      stage?.querySelectorAll("video").forEach(releaseDeferredVideoSource);
      clearProfileTvPlaybackFeedback();
      overlay.classList.remove("show");
      overlay.hidden = true;
      overlay.setAttribute("aria-hidden", "true");
      overlay.profileTvVideos = [];
      overlay.profileTvReturnTarget = null;
      window.cancelAnimationFrame(Number(overlay.profileTvOpeningFrame || 0));
      overlay.profileTvOpeningFrame = 0;
      delete overlay.dataset.openingVideoIndex;
      delete overlay.dataset.loadedVideoIndex;
      mountProfileMediaCardControls(overlay);
      mountProfileMediaCardHeader(overlay);
      if (stage) stage.innerHTML = "";
      document.body.classList.remove("profile-tv-viewer-open");
      syncOverlayScrollLock();
      if (returnTarget?.isConnected) returnTarget.focus({ preventScroll: true });
    }

    function syncProfileTvSoundControl() {
      const video = activeProfileTvViewerVideo();
      const button = document.querySelector("[data-toggle-profile-tv-sound]");
      if (!button) return;
      const muted = Boolean(video?.muted);
      if (video) profileTvViewerMuted = muted;
      button.innerHTML = modalVideoSoundIcon(muted);
      button.setAttribute("aria-label", muted ? "Turn TV video sound on" : "Turn TV video sound off");
    }

    function toggleProfileTvSound() {
      const video = activeProfileTvViewerVideo();
      if (!video) return;
      profileTvViewerMuted = !video.muted;
      document.querySelectorAll(".profile-tv-viewer-video").forEach((viewerVideo) => {
        viewerVideo.muted = profileTvViewerMuted;
      });
      syncProfileTvSoundControl();
    }

    function clearProfileTvPlaybackFeedback() {
      if (profileTvPlaybackFeedbackTimer) window.clearTimeout(profileTvPlaybackFeedbackTimer);
      profileTvPlaybackFeedbackTimer = 0;
      document.getElementById("profileTvPlaybackFeedback")?.classList.remove("show");
    }

    function showProfileTvPlaybackFeedback(paused) {
      const feedback = document.getElementById("profileTvPlaybackFeedback");
      if (!feedback) return;
      clearProfileTvPlaybackFeedback();
      feedback.innerHTML = modalVideoPlaybackIcon(paused);
      feedback.classList.add("show");
      profileTvPlaybackFeedbackTimer = window.setTimeout(() => {
        feedback.classList.remove("show");
        profileTvPlaybackFeedbackTimer = 0;
      }, 850);
    }

    function toggleProfileTvPlayback() {
      const video = activeProfileTvViewerVideo();
      if (!video) return;
      if (video.paused) {
        showProfileTvPlaybackFeedback(false);
        void video.play().catch(() => {
          showProfileTvPlaybackFeedback(true);
          document.getElementById("profileTvViewerStatus").textContent = "Tap the video again to start it.";
        });
      } else {
        video.pause();
        showProfileTvPlaybackFeedback(true);
      }
    }

    async function shareProfileTvVideo() {
      const overlay = document.getElementById("profileTvViewer");
      const videoId = overlay?.dataset.videoId || "";
      const profileName = overlay?.dataset.profileName || "Dancer";
      const status = document.getElementById("profileTvViewerStatus");
      if (!videoId) return;
      const url = new URL(`/tv/${encodeURIComponent(videoId)}`, window.location.origin).toString();
      try {
        if (navigator.share) {
          await navigator.share({
            title: `${profileName} on MyDancr TV`,
            text: `Watch ${profileName} on MyDancr TV.`,
            url
          });
          void recordPublicEngagementShare("video", videoId);
          if (status) status.textContent = "Video shared.";
        } else {
          const copied = await copyText(url, "Video link copied");
          if (!copied) return;
          void recordPublicEngagementShare("video", videoId);
          if (status) status.textContent = "Video link copied.";
        }
      } catch (error) {
        if (error?.name === "AbortError") return;
        if (status) status.textContent = "Unable to share this video.";
      }
    }

    function publicProfileForNavigation(reference, city = citySelect.value) {
      const normalizedReference = String(reference || "").trim();
      if (!normalizedReference) return null;
      const profiles = discoveryMarket(city)?.dancers?.filter(isApprovedPublicProfile) || [];
      return profiles.find((item) => (
        String(item.id || "") === normalizedReference ||
        String(item.slug || "") === normalizedReference
      )) || profiles.find((item) => item.name === normalizedReference) || null;
    }

    function pruneProfileNavigationPrefetchCache(now = Date.now()) {
      profileNavigationPrefetchCache.forEach((entry, key) => {
        if (!entry || entry.expiresAt <= now) profileNavigationPrefetchCache.delete(key);
      });
      while (profileNavigationPrefetchCache.size >= PROFILE_NAVIGATION_PREFETCH_LIMIT) {
        const oldestKey = profileNavigationPrefetchCache.keys().next().value;
        if (!oldestKey) break;
        profileNavigationPrefetchCache.delete(oldestKey);
      }
    }

    function requestProfileTvPayload(profile, city = citySelect.value) {
      if (!profile?.id || !/^[0-9a-f-]{36}$/i.test(profile.id)) return Promise.resolve(null);
      const now = Date.now();
      const key = `${city}:${profile.id}`;
      const cached = profileNavigationPrefetchCache.get(key);
      if (cached?.expiresAt > now) return cached.promise;
      pruneProfileNavigationPrefetchCache(now);
      const params = new URLSearchParams({
        city,
        dancer: profile.id,
        limit: String(MAX_DANCER_PROFILE_VIDEOS)
      });
      const promise = fetchJson(`/api/public/tv?${params.toString()}`, {
        retries: PUBLIC_DISCOVERY_REQUEST_RETRIES
      })
        .then((payload) => payload?.ok ? payload : null)
        .catch(() => null);
      profileNavigationPrefetchCache.set(key, {
        expiresAt: now + PROFILE_NAVIGATION_PREFETCH_TTL_MS,
        promise
      });
      void promise.then((payload) => {
        if (payload || profileNavigationPrefetchCache.get(key)?.promise !== promise) return;
        profileNavigationPrefetchCache.delete(key);
      });
      return promise;
    }

    function prefetchProfileNavigation(reference, city = citySelect.value) {
      if (!canWarmAdjacentVideo()) return;
      const profile = publicProfileForNavigation(reference, city);
      if (profile) void requestProfileTvPayload(profile, city);
    }

    function prefetchProfileNavigationFromElement(element) {
      if (!(element instanceof Element)) return;
      const target = element.closest(
        "[data-profile-reference], [data-grid-profile-action], .venue-shift-row, .home-tv-feed-dancer"
      );
      if (!target) return;
      const reference = target.dataset.profileReference ||
        target.dataset.gridProfileAction ||
        target.dataset.profile ||
        "";
      const city = target.dataset.profileCity || citySelect.value;
      prefetchProfileNavigation(reference, city);
    }

    async function loadProfileMyDancrTv(profile) {
      if (!profile?.id || !/^[0-9a-f-]{36}$/i.test(profile.id)) return;
      const requestProfileId = profile.id;
      const requestCity = citySelect.value;
      const requestToken = {};
      modalGallery.profileTvLoadRequest = requestToken;
      modalGallery.dataset.profileMediaProfile = requestProfileId;
      modalGallery.parentElement.querySelector("[data-profile-tv-retry]")?.remove();
      modalMediaTvTab.setAttribute("aria-busy", "true");
      modalMediaTvTab.setAttribute("aria-label", "Loading profile videos");
      modalMediaTvCount.textContent = "…";
      modalGallery.querySelectorAll("[data-profile-tv-index]").forEach((thumb) => (thumb.closest(".profile-media-grid-cell") || thumb).remove());
      modalGallery.profileTvVideos = [];
      modalGallery.profileVisibleVideoCount = 0;
      modalGallery.profileTvProfileName = profile.name || "Dancer";
      try {
        const payload = await requestProfileTvPayload(profile, requestCity);
        if (
          modalGallery.dataset.profileMediaProfile !== requestProfileId ||
          modalGallery.profileTvLoadRequest !== requestToken
        ) return;
        if (!payload?.ok || !Array.isArray(payload.videos)) throw new Error("Unable to load profile videos.");
        const videos = payload.videos.slice(0, MAX_DANCER_PROFILE_VIDEOS);
        modalGallery.profileTvVideos = videos;
        modalGallery.profileVisibleVideoCount = 0;
        appendNextProfileMediaBatch("video", { skipObserve: true });
        const photoCount = modalGallery.profilePhotoItems?.length || 0;
        syncProfileMediaTabCounts(photoCount, videos.length);
        window.requestAnimationFrame(observeProfileMediaSentinel);
      } catch {
        if (modalGallery.dataset.profileMediaProfile !== requestProfileId || modalGallery.profileTvLoadRequest !== requestToken) return;
        syncProfileMediaTabCounts(modalGallery.profilePhotoItems?.length || 0, 0);
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "action-btn secondary";
        retry.dataset.profileTvRetry = "";
        retry.textContent = "Videos couldn't load. Retry";
        retry.addEventListener("click", () => { void loadProfileMyDancrTv(profile); }, { once: true });
        modalGallery.before(retry);
      } finally {
        if (modalGallery.dataset.profileMediaProfile === requestProfileId && modalGallery.profileTvLoadRequest === requestToken) {
          modalMediaTvTab.removeAttribute("aria-busy");
        }
      }
    }

    function formatProfileTvShift(startsAt, timeZone) {
      const date = new Date(startsAt);
      if (!Number.isFinite(date.getTime())) return "";
      const options = {
        weekday: "short",
        month: "short",
        day: "numeric",
        ...(timeZone ? { timeZone } : {})
      };
      try {
        return new Intl.DateTimeFormat(undefined, options).format(date);
      } catch {
        delete options.timeZone;
        return new Intl.DateTimeFormat(undefined, options).format(date);
      }
    }

    function clearProfileDeepLink() {
      const url = new URL(window.location.href);
      if (!url.searchParams.has("profile")) return;
      url.searchParams.delete("profile");
      url.searchParams.delete("media");
      url.searchParams.delete("mediaIndex");
      const search = url.searchParams.toString();
      window.history.replaceState(
        {},
        document.title,
        `${url.pathname}${search ? `?${search}` : ""}${url.hash}`
      );
    }

    function closeProfileModal() {
      profileMediaObserver?.disconnect();
      profileMediaObserver = null;
      window.cancelAnimationFrame(profileMediaObserverScrollFrame);
      profileMediaObserverScrollFrame = 0;
      modalImage?.querySelector("video")?.pause();
      clearModalVideoPreview();
      [
        closeProfileTvViewer,
        closeProfilePhotoViewer,
        () => closeDealPassOverlay(false),
        closeProfileShareChoice,
        closeQrPopovers
      ].forEach((closeOverlay) => {
        try {
          closeOverlay();
        } catch (error) {
          console.warn("Profile overlay cleanup failed", error);
        }
      });
      const returnContext = profileModalReturnContext || captureProfileReturnContext(profileModalReturnTarget);
      profileModalReturnTarget = "";
      profileModalReturnContext = null;
      profileBackdrop.classList.remove("show");
      profileBackdrop.setAttribute("aria-hidden", "true");
      clearProfileDeepLink();
      const restoredReturnContext = restoreProfileReturnContext(returnContext);
      if (!restoredReturnContext) {
        syncOverlayScrollLock();
        window.scrollTo(0, savedScrollY);
      }
    }

    function syncOverlayScrollLock() {
      const profileFullViewOpen = profileBackdrop.classList.contains("show");
      const profileFullViewWasOpen = document.body.classList.contains("profile-full-view-open");
      const overlayOpen = !!document.querySelector(".page-panel.show, .modal-backdrop.show, .profile-tv-viewer.show, .profile-photo-viewer:not([hidden]), .deal-pass-overlay.show, .profile-qr-overlay.show, .account-required-popover:not([hidden])");
      const dealPassOverlayOpen = !!document.querySelector(".deal-pass-overlay.show");
      const dashboardOverlayOpen = !!document.querySelector(
        "#customerDashboard.show, #dancerDashboard.show, #venueDashboard.show, #adminDashboard.show"
      );
      const accountCreationOverlayOpen =
        dancerSignupPage.classList.contains("show") ||
        stripeCheckoutPage.classList.contains("show");
      const customerAuthOverlayOpen =
        authPage.classList.contains("show") &&
        !document.getElementById("authForm").hidden;
      const venueAuthOverlayOpen =
        authPage.classList.contains("show") &&
        !document.getElementById("venueLoginForm").hidden;
      const venueRequestOverlayOpen =
        authPage.classList.contains("show") &&
        !document.getElementById("venueRequestForm").hidden;
      const accountSurfaceOpen =
        dashboardOverlayOpen ||
        accountCreationOverlayOpen ||
        authPage.classList.contains("show");
      if (dealPassOverlayOpen) document.body.classList.add("deal-pass-overlay-open");
      document.body.classList.toggle("overlay-open", overlayOpen);
      if (!dealPassOverlayOpen) document.body.classList.remove("deal-pass-overlay-open");
      document.documentElement.classList.toggle("deal-pass-overlay-open", dealPassOverlayOpen);
      document.body.classList.toggle("dashboard-overlay-open", dashboardOverlayOpen);
      document.body.classList.toggle("account-creation-overlay-open", accountCreationOverlayOpen);
      document.body.classList.toggle("customer-auth-overlay-open", customerAuthOverlayOpen);
      document.body.classList.toggle("dancer-auth-overlay-open", false);
      document.body.classList.toggle("venue-auth-overlay-open", venueAuthOverlayOpen);
      if (venueRequestOverlayOpen) document.body.classList.add("venue-auth-overlay-open");
      document.body.classList.toggle("account-surface-open", accountSurfaceOpen);
      document.body.classList.toggle("profile-full-view-open", profileFullViewOpen);
      if (profileFullViewOpen && !profileFullViewWasOpen) suspendPageVideoPlayback();
      else if (!profileFullViewOpen && profileFullViewWasOpen) resumePageVideoPlayback();
      syncProfileDestinationNavigation();
    }

    function syncProfileDestinationNavigation() {
      if (!discoveryTabs || !discoveryTabsHomeParent) return;
      const shouldClearProfileStack =
        profileBackdrop.classList.contains("show") &&
        window.matchMedia("(max-width: 720px)").matches;
      if (shouldClearProfileStack) {
        if (discoveryTabs.parentNode !== profileBackdrop.parentNode) {
          profileBackdrop.parentNode?.insertBefore(discoveryTabs, profileBackdrop);
        }
        return;
      }
      if (discoveryTabs.parentNode !== discoveryTabsHomeParent) {
        discoveryTabsHomeParent.insertBefore(discoveryTabs, discoveryTabsHomeNextSibling);
      }
    }

    window.addEventListener("resize", syncProfileDestinationNavigation, { passive: true });

    let authViewportFrame = 0;

    function usesSoftKeyboardAuthLayout() {
      return window.matchMedia("(max-width: 720px), (hover: none) and (pointer: coarse)").matches;
    }

    function blurFocusedAuthField() {
      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLElement &&
        authPage.contains(activeElement) &&
        activeElement.matches("input, textarea, select")
      ) {
        activeElement.blur();
      }
    }

    function syncAuthVisualViewport() {
      if (!authPage.classList.contains("show")) return;
      const viewport = window.visualViewport;
      const viewportHeight = Math.max(1, Math.round(viewport?.height || window.innerHeight));
      const viewportTop = Math.max(0, Math.round(viewport?.offsetTop || 0));
      authPage.style.setProperty("--dancr-auth-viewport-height", `${viewportHeight}px`);
      authPage.style.setProperty("--dancr-auth-viewport-top", `${viewportTop}px`);

      const activeElement = document.activeElement;
      if (
        usesSoftKeyboardAuthLayout() &&
        activeElement instanceof HTMLElement &&
        authPage.contains(activeElement) &&
        activeElement.matches("input, textarea, select")
      ) {
        activeElement.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    }

    function queueAuthVisualViewportSync() {
      if (authViewportFrame) return;
      authViewportFrame = window.requestAnimationFrame(() => {
        authViewportFrame = 0;
        syncAuthVisualViewport();
      });
    }

    function resetAuthViewport() {
      blurFocusedAuthField();
      authPage.scrollTo({ top: 0, behavior: "auto" });
      queueAuthVisualViewportSync();
    }

    function focusAuthFieldWhenKeyboardSafe(fieldId, delay = 60) {
      window.setTimeout(() => {
        if (!authPage.classList.contains("show")) return;
        if (usesSoftKeyboardAuthLayout()) {
          resetAuthViewport();
          const activeTabId = authEntryMode === "create" ? "authCreateTab" : "authSignInTab";
          document.getElementById(activeTabId)?.focus({ preventScroll: true });
          return;
        }
        document.getElementById(fieldId)?.focus({ preventScroll: true });
      }, delay);
    }

    window.visualViewport?.addEventListener("resize", queueAuthVisualViewportSync, { passive: true });
    window.visualViewport?.addEventListener("scroll", queueAuthVisualViewportSync, { passive: true });
    window.addEventListener("orientationchange", queueAuthVisualViewportSync, { passive: true });
    authPage.addEventListener("focusin", (event) => {
      if (!event.target.matches?.("input, textarea, select")) return;
      window.setTimeout(queueAuthVisualViewportSync, 80);
    });

    function openAuthPage() {
      authPage.classList.add("show");
      authPage.setAttribute("aria-hidden", "false");
      authPage.scrollTo({ top: 0, behavior: "auto" });
      queueAuthVisualViewportSync();
      syncOverlayScrollLock();
    }

    function clearAuthFields(scope = "all") {
      const clearValue = (id, value = "") => {
        const input = document.getElementById(id);
        if (input) input.value = value;
      };

      if (scope === "all" || scope === "customer") {
        clearValue("customerEmail");
        clearValue("customerPassword");
        clearValue("customerConfirmPassword");
        stopConfirmationResendCooldown(document.getElementById("authSubmit"), authMode === "signup" ? "Create guest account" : "Sign in");
        setCustomerAuthStatus("");
      }

      if (scope === "all" || scope === "venue") {
        clearValue("venueSignupCode");
        clearValue("venueLoginEmail");
        clearValue("venueLoginPassword");
        verifiedVenueSignupCode = "";
        verifiedVenueSignupPreview = null;
        const preview = document.getElementById("venueAccessPreview");
        const codeStatus = document.getElementById("venueCodeStatus");
        if (preview) preview.hidden = true;
        if (codeStatus) {
          codeStatus.hidden = true;
          codeStatus.textContent = "";
        }
        const signupSubmit = document.getElementById("venueJoinNowBtn");
        if (signupSubmit) signupSubmit.textContent = "Create venue account";
        setVenueAuthStatus("");
        const requestForm = document.getElementById("venueRequestForm");
        if (requestForm) requestForm.reset();
        const requestSubmit = document.getElementById("venueRequestSubmit");
        if (requestSubmit) {
          requestSubmit.disabled = false;
          requestSubmit.classList.remove("is-submitted");
          requestSubmit.textContent = "Send club request";
        }
        authPage.classList.remove("venue-request-succeeded");
        setVenueRequestStatus("");
      }

      document.querySelectorAll("[data-password-toggle]").forEach((button) => {
        const input = document.getElementById(button.dataset.passwordToggle);
        if (input) input.type = "password";
        button.classList.remove("is-visible");
        button.setAttribute("aria-pressed", "false");
        button.setAttribute("aria-label", "Show password");
      });
    }

    function setVenueAuthStatus(message = "") {
      const status = document.getElementById("venueAuthStatus");
      if (!status) return;
      status.textContent = message;
      status.hidden = !message;
    }

    function setVenueCodeStatus(message = "") {
      const status = document.getElementById("venueCodeStatus");
      if (!status) return;
      status.textContent = message;
      status.hidden = !message;
    }

    function setVenueRequestStatus(message = "") {
      const status = document.getElementById("venueRequestStatus");
      if (!status) return;
      status.textContent = message;
      status.hidden = !message;
    }
