

    function deactivateHomeTvFeed(cancelPendingRequest = true) {
      homeTvFeedPageAbort?.abort();
      homeTvFeedPageAbort = null;
      if (cancelPendingRequest && homeTvFeedAbort) {
        homeTvFeedRequest += 1;
        homeTvFeedAbort.abort();
        homeTvFeedAbort = null;
        homeTvFeedCity = "";
        homeTvFeedStatus = "idle";
      }
      const fullscreenElement = homeTvFeedFullscreenElement();
      if (fullscreenElement === results) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (typeof exit === "function") {
          const exitResult = exit.call(document);
          if (exitResult?.catch) void exitResult.catch(() => {});
        }
      }
      setHomeTvFeedFallbackFullscreen(false);
      homeTvFeedWasFullscreen = false;
      homeTvFeedObserver?.disconnect();
      homeTvFeedObserver = null;
      homeTvFeedActiveVideoId = "";
      homeTvFeedEngagedTimers.forEach((timer) => window.clearTimeout(timer));
      homeTvFeedEngagedTimers.clear();
      results.querySelectorAll(".home-tv-feed-video").forEach(releaseDeferredVideoSource);
      results.classList.remove("home-tv-feed");
      document.documentElement.classList.remove("home-tv-page-snap");
      homeTvFeedLandingPending = false;
      delete results.dataset.homeTvFeedKey;
      const bottomTv = document.getElementById("homeBottomTv");
      bottomTv?.classList.remove("active");
      bottomTv?.setAttribute("aria-current", "false");
    }

    function returnToHomeDiscoveryMain() {
      if (profileBackdrop.classList.contains("show")) return false;
      activateHomeDestination("dancers", { dancerFilter: "all", scroll: false });
      window.requestAnimationFrame(() => {
        window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
      });
      return true;
    }

    function homeTvFeedSchedule(item) {
      if (item.shift?.isActive) return { label: "Working Now", className: "is-now" };
      if (item.shift) {
        const dateLabel = formatProfileTvShift(item.shift.startsAt, item.shift.timezone);
        return {
          label: dateLabel ? `Upcoming · ${dateLabel}` : "Upcoming",
          className: "is-upcoming"
        };
      }
      return null;
    }

    function createHomeTvFeedMediaFallback() {
      const fallback = document.createElement("div");
      fallback.className = "home-tv-feed-media-fallback";
      fallback.setAttribute("aria-hidden", "true");
      const status = document.createElement("span");
      status.className = "home-tv-feed-media-status";
      status.hidden = true;
      fallback.appendChild(status);
      return fallback;
    }

    function syncHomeTvFeedProgress(video, slide) {
      const progress = slide.querySelector(".home-tv-feed-progress");
      const scrubber = slide.querySelector(".home-tv-feed-scrubber");
      if (!(progress instanceof HTMLCanvasElement) || !scrubber) return;
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      const currentTime = duration ? Math.min(duration, Math.max(0, video.currentTime || 0)) : 0;
      const ratio = duration ? Math.min(1, Math.max(0, currentTime / duration)) : 0;
      const bounds = progress.getBoundingClientRect();
      const scale = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
      const pixelWidth = Math.max(1, Math.round(bounds.width * scale));
      const pixelHeight = Math.max(1, Math.round(bounds.height * scale));
      if (progress.width !== pixelWidth || progress.height !== pixelHeight) {
        progress.width = pixelWidth;
        progress.height = pixelHeight;
      }
      const context = progress.getContext("2d");
      if (context) {
        context.clearRect(0, 0, pixelWidth, pixelHeight);
        context.fillStyle = "rgba(255, 255, 255, 0.18)";
        context.fillRect(0, 0, pixelWidth, pixelHeight);
        const playedWidth = ratio > 0
          ? Math.min(pixelWidth, Math.max(scale, Math.round(pixelWidth * ratio)))
          : 0;
        if (playedWidth > 0) {
          context.fillStyle = "#f8f8fa";
          context.fillRect(0, 0, playedWidth, pixelHeight);
        }
      }
      scrubber.setAttribute("aria-valuemax", String(duration || 1));
      scrubber.setAttribute("aria-valuenow", String(currentTime));
      scrubber.setAttribute("aria-disabled", String(!duration));
      scrubber.setAttribute(
        "aria-valuetext",
        duration
          ? `${formatProfileTvDuration(currentTime)} of ${formatProfileTvDuration(duration)}`
          : "Video loading"
      );
    }

    function createHomeTvFeedProgress(slide, video) {
      const fragment = document.createDocumentFragment();
      const progress = document.createElement("canvas");
      progress.className = "home-tv-feed-progress";
      progress.setAttribute("aria-hidden", "true");
      const scrubber = document.createElement("div");
      scrubber.className = "home-tv-feed-scrubber";
      scrubber.setAttribute("role", "slider");
      scrubber.tabIndex = 0;
      scrubber.setAttribute("aria-orientation", "horizontal");
      scrubber.setAttribute("aria-valuemin", "0");
      scrubber.setAttribute("aria-valuemax", "1");
      scrubber.setAttribute("aria-valuenow", "0");
      scrubber.setAttribute("aria-label", "Video playback position");
      scrubber.setAttribute("aria-valuetext", "Video loading");
      scrubber.setAttribute("aria-disabled", "true");

      const seekToClientX = (clientX) => {
        const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
        if (!duration) return;
        const bounds = scrubber.getBoundingClientRect();
        const ratio = bounds.width > 0
          ? Math.min(1, Math.max(0, (clientX - bounds.left) / bounds.width))
          : 0;
        video.currentTime = duration * ratio;
        syncHomeTvFeedProgress(video, slide);
      };

      let seekingPointerId = null;
      scrubber.addEventListener("pointerdown", (event) => {
        if (scrubber.getAttribute("aria-disabled") === "true") return;
        event.preventDefault();
        seekingPointerId = event.pointerId;
        try { scrubber.setPointerCapture(event.pointerId); } catch {}
        seekToClientX(event.clientX);
      });
      scrubber.addEventListener("pointermove", (event) => {
        if (seekingPointerId !== event.pointerId) return;
        event.preventDefault();
        seekToClientX(event.clientX);
      });
      const finishSeek = (event) => {
        if (seekingPointerId !== event.pointerId) return;
        seekToClientX(event.clientX);
        seekingPointerId = null;
        try { scrubber.releasePointerCapture(event.pointerId); } catch {}
      };
      scrubber.addEventListener("pointerup", finishSeek);
      scrubber.addEventListener("pointercancel", (event) => {
        if (seekingPointerId === event.pointerId) seekingPointerId = null;
      });
      scrubber.addEventListener("keydown", (event) => {
        const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
        if (!duration) return;
        const smallStep = Math.max(1, duration * 0.05);
        const largeStep = Math.max(2, duration * 0.1);
        let nextTime = video.currentTime || 0;
        if (event.key === "ArrowLeft" || event.key === "ArrowDown") nextTime -= smallStep;
        else if (event.key === "ArrowRight" || event.key === "ArrowUp") nextTime += smallStep;
        else if (event.key === "PageDown") nextTime -= largeStep;
        else if (event.key === "PageUp") nextTime += largeStep;
        else if (event.key === "Home") nextTime = 0;
        else if (event.key === "End") nextTime = duration;
        else return;
        event.preventDefault();
        video.currentTime = Math.min(duration, Math.max(0, nextTime));
        syncHomeTvFeedProgress(video, slide);
      });
      fragment.append(progress, scrubber);
      window.requestAnimationFrame(() => syncHomeTvFeedProgress(video, slide));
      return fragment;
    }

    function showRelativeHomeTvFeedSlide(slide, direction) {
      const slides = [...results.querySelectorAll(".home-tv-feed-slide")];
      const currentIndex = slides.indexOf(slide);
      const nextIndex = currentIndex + direction;
      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= slides.length) {
        showHomeTvFeedFeedback(slide, direction > 0 && homeTvFeedNextCursor
          ? "Scroll down to load more videos" : direction > 0 ? "Last video" : "First video");
        return;
      }
      const nextSlide = slides[nextIndex];
      nextSlide.scrollIntoView({ block: "start", behavior: "smooth" });
      activateHomeTvFeedVideo(String(nextSlide.dataset.playbackId || nextSlide.dataset.videoId || ""));
      nextSlide.querySelector("video")?.focus({ preventScroll: true });
    }

    function homeTvPlaybackVideoUrl(item) {
      const original = String(item?.videoUrl || "").trim();
      if (item?.mobilePlaybackAvailable !== true || !/Android|iPhone/i.test(navigator.userAgent || "") || !window.matchMedia("(max-width: 760px)").matches) return original;
      try {
        const url = new URL(original, window.location.href);
        if (url.origin !== window.location.origin || url.pathname !== "/api/media/dancer-video" || !url.searchParams.get("id")) return original;
        url.searchParams.set("playback", "mobile");
        return url.href;
      } catch { return original; }
    }

    function fallbackHomeTvFeedVideo(video, slide, videoId) {
      const fullVideoUrl = video.dataset.fullVideoUrl;
      if (!fullVideoUrl || video.dataset.videoUrl === fullVideoUrl || !video.hasAttribute("src")) return false;
      const position = video.currentTime;
      video.dataset.videoUrl = fullVideoUrl;
      if (Number.isFinite(position) && position > 0) {
        video.addEventListener("loadedmetadata", () => {
          if (video.dataset.videoUrl === fullVideoUrl && Number.isFinite(video.duration)) {
            video.currentTime = Math.min(position, Math.max(0, video.duration - .1));
          }
        }, { once: true });
      }
      video.src = fullVideoUrl;
      if (slide.getAttribute("aria-current") === "true") activateHomeTvFeedVideo(videoId);
      return true;
    }

    function createHomeTvFeedVideo(item, index, slide, totalVideos) {
      const dancerName = String(item?.dancer?.stageName || "MyDancr TV").trim() || "MyDancr TV";
      const videoId = String(slide.dataset.playbackId || item.id);
      const video = homeTvLandingPreload.takeVideo(item) || document.createElement("video");
      video.className = "home-tv-feed-video";
      video.dataset.videoUrl = homeTvPlaybackVideoUrl(item);
      video.dataset.fullVideoUrl = String(item.videoUrl || "").trim();
      video.loop = true;
      video.autoplay = index === 0 && !homeTvFeedCoveredByProfile();
      video.muted = homeTvFeedMuted;
      video.defaultMuted = homeTvFeedMuted;
      video.playsInline = true;
      video.setAttribute("playsinline", "");
      video.setAttribute("webkit-playsinline", "");
      if (homeTvFeedMuted) video.setAttribute("muted", "");
      if (video.autoplay) video.setAttribute("autoplay", "");
      const posterUrl = String(item?.posterUrl || item?.poster_url || "").trim();
      video.dataset.posterUrl = posterUrl;
      if (posterUrl && index <= 2) video.poster = posterUrl;
      watchVideoPosterPresentation(video);
      video.preload = index === 0 ? "auto" : "none";
      video.controlsList = "nodownload noremoteplayback nofullscreen";
      video.disablePictureInPicture = true;
      video.tabIndex = 0;
      video.setAttribute("role", "button");
      video.setAttribute(
        "aria-label",
        `${dancerName} MyDancr TV video. Tap to play or pause, double tap to applaud${
          totalVideos > 1 ? ", or scroll up or down for another video" : ""
        }.`
      );
      let lastTapAt = 0;
      let singleTapTimer = 0;
      video.addEventListener("click", () => {
        const tapAt = Date.now();
        if (tapAt - lastTapAt <= 320) {
          window.clearTimeout(singleTapTimer);
          lastTapAt = 0;
          applaudHomeTvFeedVideo(item, slide);
          return;
        }
        lastTapAt = tapAt;
        singleTapTimer = window.setTimeout(() => {
          if (lastTapAt !== tapAt) return;
          lastTapAt = 0;
          toggleHomeTvFeedPlayback(video);
        }, 260);
      });
      video.addEventListener("dblclick", (event) => event.preventDefault());
      video.addEventListener("contextmenu", (event) => event.preventDefault());
      video.addEventListener("keydown", (event) => {
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          showRelativeHomeTvFeedSlide(slide, event.key === "ArrowDown" ? 1 : -1);
          return;
        }
        if (event.key === "a" || event.key === "A") {
          event.preventDefault();
          applaudHomeTvFeedVideo(item, slide);
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggleHomeTvFeedPlayback(video);
        }
      });
      video.addEventListener("loadstart", () => {
        slide.classList.add("is-media-loading");
        slide.classList.remove("is-media-unavailable");
        slide.setAttribute("aria-busy", "true");
        const mediaStatus = slide.querySelector(".home-tv-feed-media-status");
        if (mediaStatus) {
          mediaStatus.hidden = true;
          mediaStatus.textContent = "";
        }
      });
      video.addEventListener("loadeddata", () => {
        slide.classList.remove("is-media-loading", "is-media-unavailable");
        slide.removeAttribute("aria-busy");
        if (slide.classList.contains("is-active")) primeHomeTvFeedNeighbors(videoId);
        syncHomeTvFeedProgress(video, slide);
      });
      video.addEventListener("durationchange", () => syncHomeTvFeedProgress(video, slide));
      video.addEventListener("error", () => {
        if (fallbackHomeTvFeedVideo(video, slide, videoId)) return;
        slide.classList.remove("is-media-loading");
        slide.classList.add("is-media-unavailable");
        slide.removeAttribute("aria-busy");
        const mediaStatus = slide.querySelector(".home-tv-feed-media-status");
        if (mediaStatus) {
          mediaStatus.hidden = false;
          mediaStatus.textContent = "Video unavailable";
        }
        showHomeTvFeedFeedback(slide, "Video unavailable");
      });
      video.addEventListener("play", () => {
        slide.classList.remove("is-paused", "is-autoplay-blocked");
        syncHomeTvFeedProgress(video, slide);
        scheduleHomeTvFeedEngagedView(videoId, video);
      });
      video.addEventListener("pause", () => {
        slide.classList.add("is-paused");
        syncHomeTvFeedProgress(video, slide);
        clearHomeTvFeedEngagedTimer(videoId);
      });
      video.addEventListener("timeupdate", () => {
        syncHomeTvFeedProgress(video, slide);
        if (
          video.duration > 0 &&
          video.currentTime / video.duration >= .95 &&
          !homeTvFeedCompletedViews.has(String(item.id))
        ) {
          homeTvFeedCompletedViews.add(String(item.id));
          trackHomeTvFeedEvent(videoId, "completed");
        }
      });
      if (index === 0) attachDeferredVideoSource(video, "auto");
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        slide.classList.remove("is-media-loading", "is-media-unavailable");
        slide.removeAttribute("aria-busy");
      }
      return video;
    }

    function createHomeTvFeedCopy(item, scheduleContext) {
      const videoId = String(item.id);
      const dancerName = String(item?.dancer?.stageName || "MyDancr TV").trim() || "MyDancr TV";
      const dancerSlug = String(item?.dancer?.slug || "").trim();
      const dancerCity = String(item?.dancer?.city || citySelect.value).trim() || "Las Vegas";
      const dancerPhotoUrl = String(item?.dancer?.avatarPhotoUrl || item?.dancer?.primaryPhotoUrl || "").trim();
      const dancerPhotoPosition = avatarPhotoPosition(
        item?.dancer?.avatarPhotoFocalX ?? item?.dancer?.primaryPhotoFocalX,
        item?.dancer?.avatarPhotoFocalY ?? item?.dancer?.primaryPhotoFocalY
      );
      const venueName = String(item?.venue?.name || "").trim();
      const venueSlug = String(item?.venue?.slug || "").trim();
      const profileHref = dancerSlug
        ? `/?city=${encodeURIComponent(dancerCity)}&profile=${encodeURIComponent(dancerSlug)}`
        : "#";
      const copy = document.createElement("div");
      copy.className = "home-tv-feed-copy";

      const openDancerProfile = (event) => {
        trackHomeTvFeedEvent(videoId, "profile_click");
        if (!dancerSlug) {
          event.preventDefault();
          return;
        }
        const profile = discoveryMarket(selectedCity())?.dancers.find((profileItem) => (
          profileItem.slug === dancerSlug && isApprovedPublicProfile(profileItem)
        ));
        if (!profile) return;
        event.preventDefault();
        openProfileModal(profileReferenceValue(profile));
      };

      const dancer = document.createElement("a");
      dancer.className = "home-tv-feed-dancer";
      dancer.href = profileHref;
      dancer.dataset.profileReference = dancerSlug;
      dancer.dataset.profileCity = dancerCity;
      dancer.setAttribute("aria-label", `Open ${dancerName}'s live profile`);
      dancer.addEventListener("click", openDancerProfile);
      const dancerPhoto = document.createElement("span");
      dancerPhoto.className = "home-tv-feed-dancer-photo";
      dancerPhoto.setAttribute("data-dancer-avatar", "");
      dancerPhoto.setAttribute("aria-hidden", "true");
      const dancerIsWorkingNow = Boolean(item?.shift?.isActive);
      if (dancerIsWorkingNow) dancerPhoto.setAttribute("data-working-now", "true");
      if (item?.shift && !dancerIsWorkingNow) dancerPhoto.setAttribute("data-upcoming", "true");
      const dancerPhotoBorder = document.createElement("span");
      dancerPhotoBorder.setAttribute("data-dancer-avatar-border", "");
      dancerPhotoBorder.textContent = dancerName.charAt(0).toLocaleUpperCase();
      if (dancerPhotoUrl) {
        const dancerPhotoImage = document.createElement("img");
        dancerPhotoImage.sizes = "48px";
        dancerPhotoImage.srcset = String(item?.dancer?.avatarPhotoSrcSet || "");
        dancerPhotoImage.width = 48;
        dancerPhotoImage.height = 48;
        dancerPhotoImage.src = dancerPhotoUrl;
        dancerPhotoImage.alt = "";
        dancerPhotoImage.loading = "lazy";
        dancerPhotoImage.decoding = "async";
        dancerPhotoImage.referrerPolicy = "no-referrer";
        dancerPhotoImage.style.objectPosition = dancerPhotoPosition;
        dancerPhotoImage.addEventListener("error", () => dancerPhotoImage.remove());
        dancerPhotoBorder.appendChild(dancerPhotoImage);
      }
      dancerPhoto.appendChild(dancerPhotoBorder);
      const nameRow = document.createElement("span");
      nameRow.className = "home-tv-feed-dancer-name-row";
      const dancerLabel = document.createElement("span");
      dancerLabel.className = "home-tv-feed-dancer-name";
      dancerLabel.textContent = dancerName;
      const dancerCopy = document.createElement("span");
      dancerCopy.className = "home-tv-feed-dancer-copy";
      const meta = document.createElement("span");
      meta.className = "home-tv-feed-meta";
      meta.textContent = dancerCity;
      nameRow.append(dancerLabel);
      dancerCopy.append(nameRow, meta);
      dancer.append(dancerPhoto, dancerCopy);
      copy.appendChild(dancer);

      if (scheduleContext || venueName) {
        const context = document.createElement("div");
        context.className = "home-tv-feed-context";
        if (scheduleContext) {
          const schedule = document.createElement("span");
          schedule.className = `home-tv-feed-schedule ${scheduleContext.className}`;
          schedule.textContent = scheduleContext.label;
          context.appendChild(schedule);
        }
        if (venueName) {
          const venue = document.createElement(venueSlug ? "a" : "span");
          venue.className = "home-tv-feed-venue";
          if (venueSlug) {
            venue.href = venueExperienceHref(
              { slug: venueSlug, name: venueName },
              item?.dancer?.city || citySelect.value
            );
            venue.setAttribute("aria-label", `Open ${venueName} club profile`);
            venue.addEventListener("click", () => trackHomeTvFeedEvent(videoId, "venue_click"));
          }
          venue.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"></path><circle cx="12" cy="10" r="2.5"></circle></svg>';
          const venueLabel = document.createElement("span");
          venueLabel.textContent = venueName;
          venue.appendChild(venueLabel);
          context.appendChild(venue);
        }
        copy.appendChild(context);
      }
      return copy;
    }

    function createHomeTvFeedActionButton(className, label, iconMarkup) {
      const button = document.createElement("button");
      button.className = `home-tv-feed-action ${className}`;
      button.type = "button";
      button.setAttribute("aria-label", label);
      button.title = label;
      button.innerHTML = iconMarkup;
      return button;
    }

    function homeTvFeedDealState(item) {
      const workingNow = item?.shift?.isActive === true;
      const available = Boolean(
        workingNow &&
        item?.venue?.id &&
        item?.deal?.id &&
        item?.dealAttributionToken
      );
      if (available) {
        return {
          key: "available",
          label: "Club Deal",
          detail: "A tracked Club Deal is available during this verified check-in."
        };
      }
      if (workingNow) {
        return {
          key: "no-active-offer",
          label: "No Club Deal available",
          detail: "This club does not have an active tracked offer right now."
        };
      }
      if (item?.shift) {
        return {
          key: "available-when-working",
          label: "Unlocks when working",
          detail: "A tracked Club Deal can unlock after a verified check-in when the club has an active offer."
        };
      }
      return {
        key: "not-available-now",
        label: "Not available now",
        detail: "A verified current check-in is required before dancer attribution can be carried to a cashier-tap redemption."
      };
    }

    function closeHomeTvFeedReportMenus() {
      if (activeContentReport?.button?.dataset?.homeTvReport === "true") {
        closeContentReportDialog({ restoreFocus: false });
      }
    }

    function createHomeTvFeedActions(item, slide, video) {
      const videoId = String(item.id);
      const dancerName = String(item?.dancer?.stageName || "MyDancr TV").trim() || "MyDancr TV";
      const dancerCity = String(item?.dancer?.city || citySelect.value).trim() || "Las Vegas";
      const actions = document.createElement("div");
      actions.className = "home-tv-feed-actions";
      actions.setAttribute("aria-label", "Video actions");

      const sound = createHomeTvFeedSoundButton(slide);

      const profile = createHomeTvFeedActionButton(
        "home-tv-feed-profile-action",
        `Open ${dancerName}'s full profile`,
        actionIconMarkup("profile")
      );
      profile.dataset.homeTvProfile = "true";
      profile.title = "Profile";
      profile.addEventListener("click", () => {
        closeHomeTvFeedReportMenus();
        slide.querySelector(".home-tv-feed-dancer")?.click();
      });

      const like = createHomeTvFeedActionButton(
        "home-tv-feed-like-action",
        "Like",
        `${actionIconMarkup("heart")}<span data-media-like-count>${compactPublicMediaLikeCount(item.likeCount)}</span>`
      );
      preparePublicMediaLikeButton(like, "video", videoId, item.likeCount);
      like.addEventListener("click", async () => {
        closeHomeTvFeedReportMenus();
        await togglePublicMediaLike("video", videoId);
      });

      const share = createHomeTvFeedActionButton(
        "home-tv-feed-share-action",
        "Share",
        actionIconMarkup("share")
      );
      share.addEventListener("click", () => {
        closeHomeTvFeedReportMenus();
        void shareHomeTvFeedVideo(item, slide, share);
      });

      const isFollowed = isFollowingProfile(dancerCity, dancerName);
      const follow = document.createElement("button");
      const followLabel = isFollowed ? `Following ${dancerName}` : `Follow ${dancerName}`;
      follow.className = `home-tv-feed-action home-tv-feed-follow-action feed-card-action ${isFollowed ? "is-active" : ""}`;
      follow.type = "button";
      follow.dataset.feedAction = "follow";
      follow.dataset.profile = String(item?.dancer?.id || dancerName);
      follow.dataset.homeTvVideoId = videoId;
      follow.dataset.iconOnlyAction = "true";
      follow.setAttribute("aria-label", followLabel);
      follow.title = followLabel;
      follow.setAttribute("aria-pressed", String(isFollowed));
      follow.innerHTML = actionIconMarkup(isFollowed ? "check" : "personPlus");
      follow.addEventListener("click", () => closeHomeTvFeedReportMenus());

      const dealState = homeTvFeedDealState(item);
      let deal = null;
      if (dealState.key === "available") {
        deal = createHomeTvFeedActionButton(
          "home-tv-feed-deal-action home-card-qr-rail-action is-available",
          dealState.label,
          actionIconMarkup("qr")
        );
        deal.dataset.cardActionSlot = "qr";
        deal.dataset.clubDealState = dealState.key;
        const dealTitle = String(item.deal.dealTitle || "Club Deal").trim() || "Club Deal";
        const venueName = String(item.venue.name || "this club").trim() || "this club";
        const offerCount = Array.isArray(item.deals) && item.deals.length ? item.deals.length : 1;
        deal.setAttribute("aria-label", `View free entry for ${venueName}`);
        deal.title = offerCount > 1 ? `${offerCount} Club Deals` : dealTitle;
        deal.insertAdjacentHTML("beforeend", `<span class="home-tv-feed-deal-count">Free Entry</span>`);
        deal.dataset.clubDealCta = encodeDealPass({
          deal: item.deal,
          deals: item.deals,
          venueId: item.venue.id,
          venueSlug: item.venue.slug,
          venueName,
          sourceType: "dancer_profile",
          dancerId: item.dancer.id,
          dancerName: item.dancer.stageName,
          attributionToken: item.dealAttributionToken,
          dealAttributionTokens: item.dealAttributionTokens
        });
        deal.dataset.feedLiveQr = "true";
        deal.addEventListener("click", () => closeHomeTvFeedReportMenus());
      }

      const overflow = createHomeTvFeedActionButton(
        "home-tv-feed-overflow-action",
        "Report video",
        actionIconMarkup("report")
      );
      overflow.dataset.homeTvReport = "true";
      overflow.dataset.reportDefaultLabel = "Report video";
      prepareContentReportButton(
        overflow,
        "tv_video",
        videoId,
        "Report video"
      );

      overflow.addEventListener("click", () => {
        if (overflow.disabled) return;
        openContentReportDialog({
          button: overflow,
          targetType: "tv_video",
          targetId: videoId,
          targetLabel: `${dancerName} MyDancr TV video`,
          title: "Report video",
          quickReasons: true
        });
      });
      const fullscreen = createHomeTvFeedFullscreenButton(slide, video);
      actions.append(sound, profile, follow, like);
      if (deal) actions.appendChild(deal);
      actions.append(share, fullscreen);
      actions.appendChild(overflow);
      return actions;
    }

    function createHomeTvFeedSoundButton(slide) {
      const sound = document.createElement("button");
      sound.className = "home-tv-feed-action home-tv-feed-sound";
      sound.type = "button";
      sound.dataset.homeTvSound = "true";
      sound.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 7 9H3v6h4l4 4V5Z"></path><path class="home-tv-feed-sound-waves" d="M15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12"></path><path class="home-tv-feed-sound-muted" d="m16 9 5 5m0-5-5 5"></path></svg>';
      sound.addEventListener("click", () => {
        homeTvFeedMuted = !homeTvFeedMuted;
        results.querySelectorAll(".home-tv-feed-video").forEach((feedVideo) => {
          feedVideo.muted = homeTvFeedMuted;
          feedVideo.defaultMuted = homeTvFeedMuted;
          if (homeTvFeedMuted) feedVideo.setAttribute("muted", "");
          else feedVideo.removeAttribute("muted");
        });
        syncHomeTvFeedSoundButtons();
      });
      return sound;
    }

    function createHomeTvFeedFullscreenButton(slide, video) {
      const button = document.createElement("button");
      button.className = "home-tv-feed-action home-tv-feed-fullscreen";
      button.type = "button";
      button.dataset.homeTvFullscreen = "true";
      button.innerHTML = [
        '<svg class="home-tv-feed-video-expand-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5"></path></svg>',
        '<svg class="home-tv-feed-video-collapse-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8H3V3M16 8h5V3M21 21v-5h-5M3 21v-5h5"></path></svg>'
      ].join("");
      button.addEventListener("click", () => {
        closeHomeTvFeedReportMenus();
        void toggleHomeTvFeedFullscreen(slide, video);
      });
      return button;
    }

    function createHomeTvFeedFullViewCloseButton(slide, video) {
      const button = createHomeTvFeedActionButton(
        "home-tv-feed-full-view-close",
        "Exit full-screen videos",
        actionIconMarkup("close")
      );
      button.dataset.homeTvFullViewClose = "true";
      button.hidden = !homeTvFeedIsImmersive();
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        closeHomeTvFeedReportMenus();
        if (!homeTvFeedIsImmersive()) return;
        void toggleHomeTvFeedFullscreen(slide, video);
      });
      return button;
    }

    function renderHomeTvFeedSlide(slide, item, videoIndex, totalVideos) {
      const dancerName = String(item?.dancer?.stageName || "MyDancr TV").trim() || "MyDancr TV";
      const scheduleContext = homeTvFeedSchedule(item);
      const previousVideoId = String(slide.dataset.playbackId || slide.dataset.videoId || "");
      if (previousVideoId) clearHomeTvFeedEngagedTimer(previousVideoId);
      slide.dataset.videoId = String(item.id);
      slide.classList.toggle("has-media-poster", Boolean(item?.posterUrl || item?.poster_url));
      delete slide.dataset.userPaused;
      slide.classList.remove("is-media-unavailable", "is-applauding", "is-autoplay-blocked");
      slide.classList.add("is-media-loading", "is-paused");
      slide.setAttribute(
        "aria-label",
        `${dancerName} MyDancr TV video ${videoIndex + 1} of ${totalVideos}, ${
          scheduleContext?.label || "no shift currently posted"
        }`
      );
      const fallback = createHomeTvFeedMediaFallback();
      const video = createHomeTvFeedVideo(item, videoIndex, slide, totalVideos);
      const poster = document.createElement("img");
      poster.className = "home-tv-feed-poster";
      poster.alt = "";
      poster.setAttribute("aria-hidden", "true");
      poster.loading = "eager";
      poster.decoding = "async";
      if (video.poster) poster.src = video.poster;
      poster.addEventListener("error", () => { poster.hidden = true; });
      poster.addEventListener("load", () => { poster.hidden = false; });
      const playback = document.createElement("span");
      playback.className = "home-tv-feed-playback";
      playback.innerHTML = modalVideoPlaybackIcon(true);
      playback.setAttribute("aria-hidden", "true");
      const applause = document.createElement("span");
      applause.className = "home-tv-feed-applause";
      applause.textContent = "★";
      applause.setAttribute("aria-hidden", "true");
      const feedback = document.createElement("span");
      feedback.className = "home-tv-feed-feedback";
      feedback.setAttribute("role", "status");
      feedback.setAttribute("aria-live", "polite");
      const children = [
        fallback,
        video,
        poster,
        playback,
        createHomeTvFeedFullViewCloseButton(slide, video),
        createHomeTvFeedActions(item, slide, video),
        createHomeTvFeedCopy(item, scheduleContext),
        createHomeTvFeedProgress(slide, video),
        applause,
        feedback
      ];
      slide.replaceChildren(...children);
      syncHomeTvFeedSoundButtons();
      syncHomeTvFeedFullscreenButtons();
    }

    function createHomeTvFeedSlide(item, index, total) {
      const slide = document.createElement("article");
      slide.className = "home-tv-feed-slide is-paused is-media-loading";
      renderHomeTvFeedSlide(slide, item, index, total);
      return slide;
    }

    ["fullscreenchange", "webkitfullscreenchange"].forEach((eventName) => {
      document.addEventListener(eventName, syncHomeTvFeedFullscreenState);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !results.classList.contains("is-fullscreen-feed")) return;
      setHomeTvFeedFallbackFullscreen(false);
      syncHomeTvFeedFullscreenState();
    });
    const refreshHomeTvFeedViewportMode = () => {
      if (activeTab !== "tv" || !results.classList.contains("home-tv-feed")) return;
      syncHomeTvPageSnapState();
      window.requestAnimationFrame(setupHomeTvFeedObserver);
    };
    if (typeof homeTvFeedSnapMedia.addEventListener === "function") {
      homeTvFeedSnapMedia.addEventListener("change", refreshHomeTvFeedViewportMode);
    } else {
      homeTvFeedSnapMedia.addListener(refreshHomeTvFeedViewportMode);
    }
    window.addEventListener("scroll", markHomeTvPageScrollIndicatorActive, { passive: true });
    window.addEventListener("resize", queueHomeTvPageScrollIndicatorSync, { passive: true });
    window.addEventListener("orientationchange", queueHomeTvPageScrollIndicatorSync, { passive: true });
    window.visualViewport?.addEventListener("resize", queueHomeTvPageScrollIndicatorSync, { passive: true });

    function setHomeTvFeedCount(text, venueFilter = null) {
      const isVenueFiltered = Boolean(venueFilter?.id);
      tabCount.textContent = isVenueFiltered ? `${text} · Clear` : text;
      tabCount.classList.toggle("is-tv-venue-filter", isVenueFiltered);
      if (isVenueFiltered) {
        tabCount.setAttribute("role", "button");
        tabCount.setAttribute("tabindex", "0");
        tabCount.setAttribute("aria-label", `Clear ${venueFilter.name} club filter`);
        tabCount.setAttribute("title", `Show all ${selectedCity()} MyDancr TV videos`);
        return;
      }
      tabCount.removeAttribute("role");
      tabCount.removeAttribute("tabindex");
      tabCount.removeAttribute("aria-label");
      tabCount.removeAttribute("title");
    }

    function renderHomeTvFeedMessage(message, retryCity = "", requiresVerification = false) {
      const state = document.createElement("div");
      state.className = "locked";
      state.textContent = message;
      results.replaceChildren(state);
      delete results.dataset.homeTvFeedKey;
      if (!retryCity) return;
      const retry = document.createElement("button");
      retry.className = "view-all";
      retry.type = "button";
      retry.textContent = requiresVerification ? "Reload MyDancr TV" : "Retry MyDancr TV";
      retry.addEventListener("click", () => {
        if (requiresVerification) {
          // A challenge returned to fetch cannot run its browser check. Let a
          // user-requested document navigation complete it, retaining TV scope.
          const destination = new URL(window.location.href);
          destination.searchParams.set("view", "tv");
          destination.searchParams.set("city", retryCity);
          for (const [key, value] of [["tv_venue", homeTvFeedVenueId], ["tv_video", homeTvFeedSelectedVideoId]]) {
            if (value) destination.searchParams.set(key, value);
            else destination.searchParams.delete(key);
          }
          destination.searchParams.set("tv_refresh", String(Date.now()));
          window.location.replace(destination.href);
          return;
        }
        homeTvFeedStatus = "loading";
        renderHomeTvFeed(retryCity);
        return loadHomeTvFeed(retryCity, homeTvFeedVenueId, homeTvFeedSelectedVideoId, { refresh: true });
      });
      results.appendChild(retry);
    }

    function renderHomeTvFeedLoading() {
      const loading = document.createElement("div");
      loading.className = "home-tv-feed-loading";
      loading.setAttribute("role", "status");
      loading.setAttribute("aria-label", "Loading MyDancr TV");
      loading.innerHTML = '<span class="home-tv-feed-loading-copy" aria-hidden="true"><span></span><span></span><span></span></span>';
      results.replaceChildren(loading);
      delete results.dataset.homeTvFeedKey;
    }

    function hydrateHomeTvFeedSlide(slide) {
      if (slide.dataset.pendingVideoIndex === undefined) return;
      const index = Number(slide.dataset.pendingVideoIndex);
      const item = homeTvFeedVideos[index];
      if (!item || String(item.id) !== slide.dataset.videoId || !results.contains(slide)) return;
      delete slide.dataset.pendingVideoIndex;
      const userPaused = slide.dataset.userPaused;
      // Only initial construction may autoplay before viewport ownership is set.
      renderHomeTvFeedSlide(slide, item, Math.max(1, index), homeTvFeedVideos.length);
      if (userPaused) slide.dataset.userPaused = userPaused;
    }

    function finishHomeTvFeedCards(feedKey) {
      const next = () => {
        if (activeTab !== "tv" || results.dataset.homeTvFeedKey !== feedKey || document.visibilityState === "hidden") return;
        const slides = [...results.querySelectorAll(".home-tv-feed-slide")];
        const activeIndex = Math.max(0, slides.indexOf(homeTvFeedActiveSlide()));
        const slide = slides.slice(Math.max(0, activeIndex - 4), activeIndex + 5)
          .find((slide) => slide.dataset.pendingVideoIndex !== undefined);
        if (!slide) return;
        hydrateHomeTvFeedSlide(slide);
        // Yield between cards so playback, paint and swipe input can proceed.
        window.requestAnimationFrame(() => window.setTimeout(next, 0));
      };
      window.requestAnimationFrame(() => window.setTimeout(next, 0));
    }

    function createHomeTvFeedPlaceholder(index, copy = 0) {
      const item = homeTvFeedVideos[index];
      const slide = document.createElement("article");
      slide.className = "home-tv-feed-slide is-paused is-media-loading";
      slide.dataset.videoId = String(item.id);
      slide.dataset.playbackId = copy ? `${item.id}~${copy}` : String(item.id);
      slide.dataset.feedVideoIndex = String(index);
      slide.dataset.pendingVideoIndex = String(index);
      slide.setAttribute("aria-label", `${item.dancer.stageName} MyDancr TV video`);
      return slide;
    }

    function maintainHomeTvFeedWindow() {
      if (activeTab !== "tv" || homeTvFeedStatus !== "ready" || document.visibilityState === "hidden" || homeTvFeedCoveredByProfile()) return;
      const activeSlide = homeTvFeedActiveSlide();
      let slides = [...results.querySelectorAll(".home-tv-feed-slide")];
      if (!activeSlide || !slides.length) return;
      let index = slides.indexOf(activeSlide);
      if (homeTvFeedNextCursor && index >= slides.length - 7) void loadNextHomeTvFeedPage();

      if (!homeTvFeedNextCursor && homeTvFeedVideos.length > 1) {
        // Short libraries need distinct playback instances on either side of a
        // repeat boundary. Media IDs remain unchanged for likes/profile actions.
        if (slides.length < 8) {
          const count = homeTvFeedVideos.length;
          const target = Math.ceil(8 / count) * count;
          for (let position = slides.length; position < target; position++) {
            const slide = createHomeTvFeedPlaceholder(position % count, Math.floor(position / count));
            results.appendChild(slide);
            homeTvFeedObserver?.observe(slide);
          }
          slides = [...results.querySelectorAll(".home-tv-feed-slide")];
        }
        // Move only distant cards; the active player and both buffered neighbors
        // in each direction keep their elements and loaded media.
        const before = activeSlide.getBoundingClientRect().top;
        if (index >= slides.length - 3) {
          homeTvFeedLoopStarted = true;
          const moveCount = index - (slides.length - 4);
          slides.slice(0, moveCount).forEach((slide) => results.appendChild(slide));
        } else if (homeTvFeedLoopStarted && index < 3) {
          slides.slice(-(3 - index)).reverse().forEach((slide) => results.prepend(slide));
        }
        const delta = activeSlide.getBoundingClientRect().top - before;
        if (Math.abs(delta) > .5) {
          const scroller = homeTvFeedIsImmersive() ? results : window;
          scroller.scrollBy({ top: delta, left: 0, behavior: "instant" });
        }
      }

      slides = [...results.querySelectorAll(".home-tv-feed-slide")];
      index = slides.indexOf(activeSlide);
      slides.forEach((slide, position) => {
        if (Math.abs(position - index) <= 2) hydrateHomeTvFeedSlide(slide);
        else if (Math.abs(position - index) > 4 && slide.dataset.pendingVideoIndex === undefined) {
          const video = slide.querySelector("video");
          if (video) releaseDeferredVideoSource(video);
          clearHomeTvFeedEngagedTimer(String(slide.dataset.playbackId || slide.dataset.videoId));
          slide.replaceChildren();
          slide.dataset.pendingVideoIndex = slide.dataset.feedVideoIndex;
        }
      });
      primeHomeTvFeedNeighbors(homeTvFeedActiveVideoId);
      finishHomeTvFeedCards(results.dataset.homeTvFeedKey);
    }

    async function loadNextHomeTvFeedPage(retry = false) {
      if (!homeTvFeedNextCursor || homeTvFeedPageAbort || (homeTvFeedPageError && !retry) || activeTab !== "tv") return;
      const controller = new AbortController();
      homeTvFeedPageAbort = controller;
      homeTvFeedPageError = false;
      const requestId = homeTvFeedRequest;
      const city = homeTvFeedCity;
      const venueId = homeTvFeedVenueId;
      results.querySelector("[data-tv-page-retry]")?.remove();
      try {
        let added = [];
        // A page can be empty after current visibility/shift checks. Continue
        // the cursor instead of incorrectly treating that as the end of TV.
        do {
          const cursor = homeTvFeedNextCursor;
          const params = new URLSearchParams({ city, limit: "24", paging: "1", cursor });
          if (venueId) params.set("venue", venueId);
          const payload = await fetchJson(`/api/public/tv?${params}`, {
            retries: PUBLIC_DISCOVERY_REQUEST_RETRIES, signal: controller.signal
          });
          if (controller.signal.aborted || requestId !== homeTvFeedRequest || activeTab !== "tv") return;
          if (!payload.ok) throw new Error("Unable to load more videos.");
          if (payload.nextCursor === cursor) throw new Error("TV page did not advance.");
          const known = new Set(homeTvFeedVideos.map((item) => item.id));
          added = (Array.isArray(payload.videos) ? payload.videos : []).filter((item) => {
            if (!item?.id || !item.videoUrl || !item.dancer?.stageName || known.has(item.id) ||
                (venueId && item.venue?.id !== venueId)) return false;
            known.add(item.id);
            return true;
          });
          homeTvFeedNextCursor = payload.nextCursor || null;
        } while (!added.length && homeTvFeedNextCursor);
        const start = homeTvFeedVideos.length;
        homeTvFeedVideos.push(...added);
        added.forEach((item, offset) => {
          const slide = createHomeTvFeedPlaceholder(start + offset);
          results.appendChild(slide);
          homeTvFeedObserver?.observe(slide);
        });
        results.dataset.homeTvFeedKey = `${city}:${venueId}:${homeTvFeedVideos.map((item) => item.id).join(",")}`;
        void loadPublicMediaLikes(added.map((item) => ({ mediaType: "video", mediaId: item.id, likeCount: item.likeCount })));
        renderHomeTvFeed(city);
        maintainHomeTvFeedWindow();
      } catch (error) {
        if (controller.signal.aborted || requestId !== homeTvFeedRequest) return;
        homeTvFeedPageError = true;
        const retryButton = document.createElement("button");
        retryButton.type = "button";
        retryButton.className = "view-all";
        retryButton.dataset.tvPageRetry = "true";
        retryButton.textContent = "Unable to load more videos. Tap to retry";
        retryButton.addEventListener("click", () => void loadNextHomeTvFeedPage(true));
        results.appendChild(retryButton);
      } finally {
        if (homeTvFeedPageAbort === controller) homeTvFeedPageAbort = null;
      }
    }

    function renderHomeTvFeed(city) {
      const bottomTv = document.getElementById("homeBottomTv");
      bottomTv?.classList.add("active");
      bottomTv?.setAttribute("aria-current", "page");
      tabTitle.classList.remove("dancers-city-title");
      tabTitle.closest(".content-head")?.classList.add("discovery-section-head", "tv-section-head");
      viewAllBtn.hidden = true;
      results.classList.remove("card-grid", "home-dancer-grid", "home-discovery-feed", "home-venue-discovery-feed", "venue-card-grid");
      results.classList.add("home-tv-feed");
      syncHomeTvPageSnapState();

      const venueFilter = selectedHomeTvVenueFilter(city);
      const venueId = venueFilter?.id || "";
      const selectedVideoId = selectedHomeTvVideoId();
      tabTitle.textContent = venueFilter ? `MyDancr TV at ${venueFilter.name}` : `MyDancr TV ${discoveryLocationPhrase(city)}`;
      if (
        homeTvFeedCity !== city ||
        homeTvFeedVenueId !== venueId ||
        homeTvFeedSelectedVideoId !== selectedVideoId
      ) {
        homeTvFeedCity = city;
        homeTvFeedVenueId = venueId;
        homeTvFeedSelectedVideoId = selectedVideoId;
        homeTvFeedStatus = "loading";
        homeTvFeedVideos = [];
        void loadHomeTvFeed(city, venueId, selectedVideoId);
      }
      if (homeTvFeedStatus === "loading") {
        setHomeTvFeedCount("Videos", venueFilter);
        results.removeAttribute("aria-label");
        results.setAttribute("aria-busy", "true");
        renderHomeTvFeedLoading();
        settleHomeTvFeedLanding();
        return;
      }
      results.removeAttribute("aria-busy");
      if (homeTvFeedStatus === "verification-required") {
        setHomeTvFeedCount("Reload needed", venueFilter);
        renderHomeTvFeedMessage("Complete a quick browser check to continue watching.", city, true);
        settleHomeTvFeedLanding({ complete: true });
        return;
      }
      if (homeTvFeedStatus === "shell-reload-required") {
        setHomeTvFeedCount("Reload needed", venueFilter);
        renderHomeTvFeedMessage("Reload the page to finish loading MyDancr TV.", city, true);
        settleHomeTvFeedLanding({ complete: true });
        return;
      }
      if (homeTvFeedStatus === "error") {
        setHomeTvFeedCount("Unavailable", venueFilter);
        renderHomeTvFeedMessage("MyDancr TV videos are temporarily unavailable.", city);
        settleHomeTvFeedLanding({ complete: true });
        return;
      }
      if (!homeTvFeedVideos.length) {
        homeTvLandingPreload.clear();
        setHomeTvFeedCount("0 videos", venueFilter);
        renderHomeTvFeedMessage(venueFilter
          ? `No approved MyDancr TV videos are available from dancers affiliated with, working now at, or scheduled at ${venueFilter.name}.`
          : `No approved MyDancr TV videos are available ${discoveryLocationPhrase(city)} yet.`);
        settleHomeTvFeedLanding({ complete: true });
        return;
      }

      const feedScope = venueFilter ? `at ${venueFilter.name}` : discoveryLocationPhrase(city);
      setHomeTvFeedCount(
        venueFilter || city === ALL_CITIES ? `${homeTvFeedVideos.length} videos` : `${homeTvFeedVideos.length} citywide`,
        venueFilter,
      );
      results.setAttribute(
        "aria-label",
        `Swipe through ${homeTvFeedVideos.length} MyDancr TV video${homeTvFeedVideos.length === 1 ? "" : "s"} ${feedScope}`
      );
      const feedKey = `${city}:${venueId}:${homeTvFeedVideos.map((item) => item.id).join(",")}`;
      if (results.dataset.homeTvFeedKey === feedKey) {
        settleHomeTvFeedLanding({ complete: true });
        return;
      }
      homeTvFeedObserver?.disconnect();
      homeTvFeedLoopStarted = false;
      results.replaceChildren(
        ...homeTvFeedVideos.map((item, index) => {
          if (index < 3) {
            const slide = createHomeTvFeedSlide(item, index, homeTvFeedVideos.length);
            slide.dataset.feedVideoIndex = String(index);
            return slide;
          }
          // Retain every card's scroll/snap slot, but build only the first player
          // and its two upcoming neighbors before starting native playback.
          return createHomeTvFeedPlaceholder(index);
        })
      );
      homeTvLandingPreload.clear();
      results.dataset.homeTvFeedKey = feedKey;
      syncHomeTvFeedSoundButtons();
      void loadPublicMediaLikes(homeTvFeedVideos.map((item) => ({
        mediaType: "video",
        mediaId: String(item.id || ""),
        likeCount: item.likeCount
      })));
      setupHomeTvFeedObserver();
      finishHomeTvFeedCards(feedKey);
      settleHomeTvFeedLanding({ complete: true });
    }