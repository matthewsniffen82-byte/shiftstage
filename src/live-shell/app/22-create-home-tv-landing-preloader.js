

    // Prepare only the first two paused players once the visible directory is
    // ready. A short-lived, page-local result keeps the server's shuffled order
    // intact; it is never persisted or used for a different city/TV scope.
    function createHomeTvLandingPreloader() {
      const ttl = 20 * 1000;
      let timer = 0;
      let idle = 0;
      let state = null;
      let attemptedCity = "";

      function eligible(city) {
        if (activeTab !== "dancers" || citySelect.value !== city ||
            document.readyState !== "complete" || document.visibilityState === "hidden" ||
            userLocationOutsideMarkets || document.body.classList.contains("overlay-open") ||
            !canWarmAdjacentVideo() || homeTvFeedStatus === "ready") return false;
        const cards = [...results.querySelectorAll(".home-dancer-grid-card")];
        return cards.length > 0 && cards.every((card) => {
          const rect = card.getBoundingClientRect();
          return rect.bottom <= 0 || rect.top >= window.innerHeight || !card.hasAttribute("data-row-loading");
        });
      }

      function clear() {
        window.clearTimeout(timer);
        timer = 0;
        if (idle) window.cancelIdleCallback?.(idle);
        idle = 0;
        const previous = state;
        state = null;
        if (!previous) return;
        window.clearTimeout(previous.expiryTimer);
        previous.controller.abort();
        previous.videos.forEach((video) => {
          releaseDeferredVideoSource(video);
          video.removeAttribute("poster");
        });
        previous.videos.clear();
      }

      function start(city) {
        idle = 0;
        if (state || attemptedCity === city || !eligible(city)) return;
        attemptedCity = city;
        const entry = { city, controller: new AbortController(), videos: new Map(),
          expiresAt: Date.now() + ttl, expiryTimer: 0, claimed: false, promise: null };
        state = entry;
        entry.expiryTimer = window.setTimeout(clear, ttl);
        const params = new URLSearchParams({ city, limit: "24" });
        params.set("paging", "1");
        entry.promise = fetchJson(`/api/public/tv?${params.toString()}`, {
          retries: 0, cache: "no-store", signal: entry.controller.signal
        }).then((payload) => {
          if (!payload.ok) throw new Error("TV preload unavailable");
          if (state !== entry) return null;
          if (!entry.claimed && eligible(city)) {
            const videos = Array.isArray(payload.videos) ? payload.videos.filter((item) =>
              item?.id && item?.videoUrl && item?.dancer?.stageName).slice(0, 2) : [];
            videos.forEach((item, index) => {
              const video = document.createElement("video");
              video.dataset.videoUrl = homeTvPlaybackVideoUrl(item);
              video.autoplay = false;
              video.muted = video.defaultMuted = true;
              video.playsInline = true;
              video.setAttribute("playsinline", "");
              video.setAttribute("muted", "");
              const poster = String(item.posterUrl || item.poster_url || "").trim();
              if (poster) video.poster = poster;
              entry.videos.set(String(item.id), video);
              attachDeferredVideoSource(video, index === 0 ? "auto" : "metadata");
            });
          }
          return payload;
        }).catch(() => {
          if (state === entry) clear();
          return null;
        });
        void loadLiveShellFeature("tv").catch(() => {});
      }

      function schedule() {
        const city = citySelect.value;
        if (timer || idle || state || attemptedCity === city || !eligible(city)) return;
        // Let the photo reveal paint before doing optional network/JS work.
        timer = window.setTimeout(() => {
          timer = 0;
          if (window.requestIdleCallback) idle = window.requestIdleCallback(() => start(city), { timeout: 1500 });
          else start(city);
        }, 750);
      }

      function sync(city) {
        if (activeTab !== "dancers") {
          window.clearTimeout(timer);
          timer = 0;
          if (idle) window.cancelIdleCallback?.(idle);
          idle = 0;
        }
        if (state && (state.city !== city || !canWarmAdjacentVideo() ||
            !["dancers", "tv"].includes(activeTab) || (state.claimed && activeTab !== "tv"))) clear();
      }

      function takePayload(city, venueId, videoId, options, signal) {
        const entry = state;
        if (!entry) return null;
        if (entry.claimed || entry.city !== city || venueId || videoId || options.refresh ||
            entry.expiresAt <= Date.now() || !canWarmAdjacentVideo() || signal?.aborted) {
          clear();
          return null;
        }
        entry.claimed = true;
        window.clearTimeout(entry.expiryTimer);
        const abort = () => { if (state === entry) clear(); };
        signal?.addEventListener("abort", abort, { once: true });
        return entry.promise.finally(() => signal?.removeEventListener("abort", abort));
      }

      function takeVideo(item) {
        const video = state?.videos.get(String(item.id));
        if (!video) return null;
        state.videos.delete(String(item.id));
        if (video.error || video.dataset.videoUrl !== homeTvPlaybackVideoUrl(item)) {
          releaseDeferredVideoSource(video);
          return null;
        }
        return video;
      }

      return { schedule, sync, clear, takePayload, takeVideo };
    }

    // Development keeps the readable shell together. The production generator
    // supplies content-versioned, on-demand classic scripts at this boundary.
    const LIVE_SHELL_FEATURE_URLS = Object.freeze({});
    const liveShellFeatureLoads = new Map();
    function loadLiveShellFeature(feature) {
      const source = LIVE_SHELL_FEATURE_URLS[feature];
      if (!source) return Promise.resolve();
      if (liveShellFeatureLoads.has(feature)) return liveShellFeatureLoads.get(feature);
      const pending = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = source;
        script.async = true;
        script.onload = () => { script.onload = script.onerror = null; resolve(); };
        script.onerror = () => {
          script.remove();
          liveShellFeatureLoads.delete(feature);
          reject(Object.assign(new Error("Unable to load MyDancr TV. Please reload the page."), { code: "SHELL_FEATURE_UNAVAILABLE" }));
        };
        document.head.appendChild(script);
      });
      liveShellFeatureLoads.set(feature, pending);
      return pending;
    }

    async function loadHomeTvFeed(city, venueId = "", selectedVideoId = selectedHomeTvVideoId(), options = {}) {
      homeTvFeedAbort?.abort();
      homeTvFeedPageAbort?.abort();
      homeTvFeedPageAbort = null;
      homeTvFeedNextCursor = null;
      homeTvFeedPageError = false;
      homeTvFeedLoopStarted = false;
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      homeTvFeedAbort = controller;
      const requestId = ++homeTvFeedRequest;
      try {
        const params = new URLSearchParams({ city, limit: "24" });
        params.set("paging", "1");
        if (venueId) params.set("venue", venueId);
        if (selectedVideoId) params.set("video", selectedVideoId);
        if (options.refresh) params.set("refresh", String(Date.now()));
        const prepared = homeTvLandingPreload.takePayload(city, venueId, selectedVideoId, options, controller?.signal);
        const requestPayload = () => fetchJson(`/api/public/tv?${params.toString()}`, {
          retries: PUBLIC_DISCOVERY_REQUEST_RETRIES,
          cache: options.refresh ? "no-store" : "default",
          signal: controller?.signal
        });
        let [payload] = await Promise.all([
          prepared ? prepared.then((payload) => payload || requestPayload()) : requestPayload(),
          loadLiveShellFeature("tv")
        ]);
        while (payload.ok && !payload.videos?.length && payload.nextCursor) {
          if (controller?.signal.aborted || requestId !== homeTvFeedRequest) return;
          if (params.get("cursor") === payload.nextCursor) throw new Error("TV page did not advance.");
          params.set("cursor", payload.nextCursor);
          params.delete("video");
          payload = await requestPayload();
        }
        if (!payload.ok) throw new Error(payload.error || "Unable to load MyDancr TV.");
        if (
          requestId !== homeTvFeedRequest ||
          homeTvFeedCity !== city ||
          homeTvFeedVenueId !== venueId ||
          homeTvFeedSelectedVideoId !== selectedVideoId
        ) return;
        homeTvFeedVideos = Array.isArray(payload.videos)
          ? payload.videos.filter((item) => (
              item?.id &&
              item?.videoUrl &&
              item?.dancer?.stageName &&
              (!venueId || item?.venue?.id === venueId)
            ))
          : [];
        homeTvFeedNextCursor = payload.nextCursor || null;
        homeTvFeedStatus = "ready";
      } catch (error) {
        if (
          requestId !== homeTvFeedRequest ||
          homeTvFeedCity !== city ||
          homeTvFeedVenueId !== venueId ||
          homeTvFeedSelectedVideoId !== selectedVideoId
        ) return;
        homeTvLandingPreload.clear();
        homeTvFeedVideos = [];
        homeTvFeedStatus = error?.code === "BROWSER_VERIFICATION_REQUIRED" ? "verification-required"
          : error?.code === "SHELL_FEATURE_UNAVAILABLE" ? "shell-reload-required" : "error";
      } finally {
        if (homeTvFeedAbort === controller) homeTvFeedAbort = null;
      }
      if (activeTab === "tv" && citySelect.value === city) renderHomeTvFeed(city);
    }

    function resolveVenueByName(venueName, city = citySelect.value) {
      if (!venueName || !discoveryMarket(city)) return null;
      const exactVenue = discoveryMarket(city).venues.find((venue) => venue.id === venueName || venue.slug === venueName);
      if (exactVenue) return exactVenue;
      const normalizedName = String(venueName).trim().toLowerCase();
      const normalizedSlug = slugify(venueName);
      return discoveryMarket(city).venues.find((venue) => (
        venue.name === venueName ||
        venue.name.toLowerCase() === normalizedName ||
        venue.slug === normalizedSlug ||
        slugify(venue.name) === normalizedSlug
      )) || null;
    }

    function openVenueFromName(venueName, options = {}) {
      if (!venueName) return;
      const venue = resolveVenueByName(venueName);
      if (!venue) {
        showToast("Club profile not found");
        return;
      }
      if (!selectedVenueName) {
        venueProfileSavedScrollY = window.scrollY || 0;
        venueProfileReturnContext = captureProfileReturnContext(options.returnTo || "");
      }
      if (venueProfileReturnContext) suspendProfileReturnSurface(venueProfileReturnContext);
      homeDiscoveryFeedOpen = false;
      deactivateHomeDiscoveryFeed();
      selectedVenueName = venue.id || venue.name;
      activeTab = "venues";
      document.querySelectorAll(".tab").forEach((item) => {
        const isActive = item.dataset.tab === "venues";
        item.classList.toggle("active", isActive);
        item.setAttribute("aria-current", isActive ? "page" : "false");
      });
      homeBottomTv?.classList.toggle("active", false);
      homeBottomTv?.setAttribute("aria-current", "false");
      const url = new URL(window.location.href);
      url.searchParams.set("city", citySelect.value);
      url.searchParams.set("venue", venue.slug || slugify(venue.name));
      url.searchParams.delete("profile");
      url.searchParams.delete("view");
      window.history.replaceState(
        {},
        document.title,
        `${url.pathname}?${url.searchParams.toString()}${url.hash}`
      );
      render();
      syncOverlayScrollLock();
      focusVenueProfileStart(options);
    }

    function focusVenueProfileStart({ showFocusRing = false } = {}) {
      const resetProfileScroll = () => {
        results.scrollTo({ top: 0, left: 0, behavior: "auto" });
      };
      resetProfileScroll();
      requestAnimationFrame(() => {
        resetProfileScroll();
        requestAnimationFrame(() => {
          resetProfileScroll();
          const closeButton = results.querySelector("[data-close-venue-profile]");
          if (!closeButton) return;
          closeButton.toggleAttribute("data-auto-focus", !showFocusRing);
          closeButton.focus({ preventScroll: true });
          closeButton.addEventListener("blur", () => closeButton.removeAttribute("data-auto-focus"), { once: true });
        });
      });
    }

    function closeVenueProfile() {
      if (!selectedVenueName) return false;
      const params = new URLSearchParams(window.location.search);
      if (params.get("venue_preview") === "1") {
        window.location.assign(params.get("preview_source") === "admin" ? "/admin" : "/dashboard/venue");
        return true;
      }
      const returnContext = venueProfileReturnContext;
      venueProfileReturnContext = null;
      selectedVenueName = null;
      activeTab = "venues";
      homeDiscoveryFeedOpen = homeDiscoveryFeedUsesInlineLayout();
      document.querySelectorAll(".tab").forEach((item) => {
        const isActive = item.dataset.tab === "venues";
        item.classList.toggle("active", isActive);
        item.setAttribute("aria-current", isActive ? "page" : "false");
      });
      homeBottomTv?.classList.toggle("active", false);
      homeBottomTv?.setAttribute("aria-current", "false");
      syncHomeDestinationLocation("venues");
      render();
      const restoredReturnContext = restoreProfileReturnContext(returnContext);
      if (!restoredReturnContext) {
        syncOverlayScrollLock();
        requestAnimationFrame(() => {
          window.scrollTo({ top: venueProfileSavedScrollY, left: 0, behavior: "auto" });
          document.querySelector('.tab[data-tab="venues"]')?.focus({ preventScroll: true });
        });
      }
      return true;
    }

    function scrollToVenueDetail() {
      requestAnimationFrame(() => {
        const target = results.querySelector(".venue-detail .venue-hero") || results.querySelector(".venue-detail") || tabTitle;
        if (!target) return;
        const top = target.getBoundingClientRect().top + window.scrollY - 12;
        window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
      });
    }

    const handleProfileNavigationIntent = (event) => {
      const target = event.target instanceof Element ? event.target : null;
      prefetchProfileNavigationFromElement(target);
    };
    results.addEventListener("pointerover", handleProfileNavigationIntent, { passive: true });
    results.addEventListener("focusin", handleProfileNavigationIntent);
    results.addEventListener("touchstart", handleProfileNavigationIntent, { passive: true });

    results.addEventListener("click", async (event) => {
      if (!event.target.closest(".home-tv-feed-actions")) closeHomeTvFeedReportMenus();
      const emptyStateAction = event.target.closest("[data-home-empty-action]");
      if (emptyStateAction) {
        event.preventDefault();
        const action = emptyStateAction.dataset.homeEmptyAction;
        if (action === "choose-city") {
          if (citySelectButton && citySelectPanel) {
            openCityPicker();
          } else if (typeof citySelect?.showPicker === "function") {
            citySelect.showPicker();
          } else {
            citySelect?.focus();
          }
          return;
        }
        if (action === "expand-radius") {
          const radiusValue = emptyStateAction.dataset.radiusValue;
          const optionExists = [...(distanceSelect?.options || [])].some((option) => option.value === radiusValue);
          if (!distanceSelect || !radiusValue || !optionExists) return;
          distanceSelect.value = radiusValue;
          distanceSelect.dispatchEvent(new Event("change", { bubbles: true }));
          return;
        }
        if (action === "clear-filters") {
          if (distanceSelect) distanceSelect.value = "25 mi";
          if (venueSelect) venueSelect.value = "all";
          homeDiscoveryFeedOpen = false;
          deactivateHomeDiscoveryFeed();
          selectedVenueName = null;
          populateVenueSelect();
          render();
          showToast("Club filters cleared");
          return;
        }
      }
      const liveDiscoveryRetry = event.target.closest("[data-retry-live-discovery]");
      if (liveDiscoveryRetry) {
        event.preventDefault();
        const retryCity = liveDiscoveryRetry.dataset.retryLiveDiscovery || selectedCity();
        liveMarketState[retryCity] = null;
        const retryRequest = loadLiveDiscovery(retryCity, { force: true });
        if (citySelect.value === retryCity) render();
        await retryRequest;
        return;
      }
      const dancerFilterButton = event.target.closest("[data-dancer-directory-filter]");
      if (dancerFilterButton) {
        event.preventDefault();
        const nextFilter = dancerFilterButton.dataset.dancerDirectoryFilter;
        if (!dancerDirectoryFilters.includes(nextFilter)) return;
        dancerDirectoryFilter = nextFilter;
        syncHomeDestinationLocation("dancers");
        render();
        results.querySelector(`[data-dancer-directory-filter="${nextFilter}"]`)?.focus({ preventScroll: true });
        return;
      }
      const venueProfileClose = event.target.closest("[data-close-venue-profile]");
      if (venueProfileClose) {
        event.preventDefault();
        event.stopPropagation();
        closeVenueProfile();
        return;
      }
      const venueProfileLink = event.target.closest("[data-open-venue-profile]");
      if (venueProfileLink) {
        event.preventDefault();
        event.stopPropagation();
        openVenueFromName(venueProfileLink.dataset.openVenueProfile, { showFocusRing: event.detail === 0 });
        return;
      }
      const unavailableCardQr = event.target.closest('[data-card-action-slot="qr"][data-card-qr-label]');
      if (unavailableCardQr) {
        event.preventDefault();
        event.stopPropagation();
        showCardQrNotice(
          unavailableCardQr,
          unavailableCardQr.dataset.cardQrLabel || "Club Deal tap",
          unavailableCardQr.dataset.cardQrMessage || "No Club Deal is available right now."
        );
        return;
      }
      const externalVenueQr = event.target.closest("[data-external-venue-qr]");
      if (externalVenueQr) {
        recordVenuePageEvent({
          venueId: externalVenueQr.dataset.venueId,
          eventType: "qr_impression",
          source: "venue_page"
        });
        return;
      }
      const dealPassTrigger = event.target.closest("[data-club-deal-cta], [data-deal-pass]");
      if (dealPassTrigger) {
        await handleDealPassClick(event);
        return;
      }
      if (handleQrClick(event)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (handleShareClick(event)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const gridProfileButton = event.target.closest("[data-grid-profile-action]");
      if (gridProfileButton) {
        event.preventDefault();
        event.stopPropagation();
        openProfileModal(gridProfileButton.dataset.gridProfileAction);
        return;
      }
      const showDancersButton = event.target.closest("[data-show-dancers]");
      if (showDancersButton) {
        activateHomeDestination("dancers", { dancerFilter: "now", scroll: false });
        document.querySelector('.tab[data-tab="dancers"]')?.focus({ preventScroll: true });
        return;
      }
      const feedActionButton = event.target.closest("[data-feed-action]");
      if (feedActionButton) {
        event.preventDefault();
        event.stopPropagation();
        const action = feedActionButton.dataset.feedAction;
        if (
          (action === "follow" || action === "notify") &&
          !requireCustomerAccountForProfileAction(feedActionButton)
        ) return;
        if (action === "follow") {
          await saveProfileFollow(feedActionButton);
          return;
        }
        if (action === "notify") {
          await saveProfileNotifications(feedActionButton);
          return;
        }
        if (action === "going") {
          await saveProfileGoing(feedActionButton);
          return;
        }
      }
      const cardVenueLink = event.target.closest("[data-card-venue]");
      if (cardVenueLink) {
        event.preventDefault();
        event.stopPropagation();
        openVenueFromName(cardVenueLink.dataset.cardVenue, { showFocusRing: event.detail === 0 });
        return;
      }
      const directionsLink = event.target.closest(".venue-directions-btn");
      if (directionsLink) {
        const venueRecord = resolveVenueByName(directionsLink.dataset.venueId || directionsLink.dataset.venue);
        const city = venueRecord?.city || citySelect.value;
        const venueName = venueRecord?.name || directionsLink.dataset.venue;
        const attributedDancerId = directionsLink.dataset.dancerId || "";
        const venueProfiles = discoveryMarket(city).dancers
          .filter((profile) => isApprovedPublicProfile(profile) && profile.venue === venueName);
        const attributedProfiles = attributedDancerId
          ? venueProfiles.filter((profile) => profile.id === attributedDancerId)
          : venueProfiles;
        const directionSource = attributedDancerId ? "dancer_profile" : "venue_detail";
        attributedProfiles.forEach((profile) => recordUniqueTrendEvent("directionRequests", city, profile.name));
        if (isCustomerSession() && venueRecord?.id) {
          postAuthenticatedJson("/api/customer/directions", {
            venueId: venueRecord.id,
            dancerIds: attributedProfiles.map((profile) => profile.id).filter(Boolean),
            sessionId: dancrLiveSessionId()
          }).catch(() => recordLiveEvent("direction_request", { venueName, dancerId: attributedDancerId || undefined, source: directionSource }));
        } else {
          recordLiveEvent("direction_request", { venueName, dancerId: attributedDancerId || undefined, source: directionSource });
        }
        return;
      }
      const followVenueButton = event.target.closest("[data-venue-follow]");
      if (followVenueButton) {
        event.preventDefault();
        event.stopPropagation();
        if (followVenueButton.disabled) return;
        if (!requireCustomerAccountForProfileAction(followVenueButton)) return;
        const venueReference = followVenueButton.dataset.venueFollow;
        const venueRecord = resolveVenueByName(venueReference);
        const city = venueRecord?.city || citySelect.value;
        const venueName = venueRecord?.name || venueReference;
        if (!venueRecord?.id) {
          showToast("This club follow is unavailable.");
          return;
        }
        const willFollow = !(followedVenuesByCity[city] || []).includes(venueName);
        const originalMarkup = followVenueButton.innerHTML;
        followVenueButton.disabled = true;
        followVenueButton.setAttribute("aria-busy", "true");
        customerSavedStateVersion += 1;
        try {
          // Refresh an expired access token before committing the follow.
          await getAuthenticatedJson("/api/account", {
            timeoutMs: 15000,
            timeoutMessage: "Your sign-in could not be checked. Please try saving this club again."
          });
          const result = await postAuthenticatedJson("/api/customer/venue-follows", {
            venueId: venueRecord.id,
            following: willFollow,
            notificationsEnabled: willFollow
          }, { timeoutMs: 15000, timeoutMessage: "Saving this club took too long. Please try again." });
          if (!result?.ok) throw new Error("Sign in required.");
          // A saved-items refresh may have replaced the array during the request.
          const savedVenues = followedVenuesByCity[city] || (followedVenuesByCity[city] = []);
          const following = result.following === true;
          followedVenuesByCity[city] = savedVenues.filter((name) => name !== venueName);
          if (following) followedVenuesByCity[city].push(venueName);
          if (following) window.dispatchEvent(new CustomEvent("mydancr:push-invitation", { detail: { moment: "customer-follow" } }));
          customerSavedStateVersion += 1;
          render();
          if (customerDashboard.classList.contains("show")) renderDashboard();
        } catch (error) {
          followVenueButton.disabled = false;
          if (/sign in required|sign-in expired/i.test(error.message || "")) {
            openAuthRole("customer");
            setCustomerAuthStatus("Your sign-in expired. Sign in again to save this club.");
            return;
          }
          showToast(error.message || "Could not save venue follow");
        } finally {
          customerSavedStateVersion += 1;
          followVenueButton.disabled = false;
          followVenueButton.removeAttribute("aria-busy");
          followVenueButton.innerHTML = originalMarkup;
        }
        return;
      }
      const venueJump = event.target.closest("[data-venue-jump]");
      if (venueJump) {
        event.preventDefault();
        const target = document.getElementById(venueJump.dataset.venueJump);
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        return;
      }
      const venueShift = event.target.closest(".venue-shift-row");
      if (venueShift) {
        event.preventDefault();
        openProfileModal(venueShift.dataset.profile);
        return;
      }
      const card = event.target.closest(".dancer-card");
      if (!card) return;
      event.preventDefault();
      openProfileModal(card.dataset.profileReference || card.dataset.profile);
    });

    async function runShareAction(profileName, city, assignedSlug = "") {
      const url = profileShareUrl(profileName, city, assignedSlug);
      const text = profileShareText(profileName, city);
      if (navigator.share) {
        try {
          await navigator.share({ title: "Dancr profile", text, url });
          recordUniqueTrendEvent("socialClicks", city, profileName);
          void recordProfileEngagementShare(profileName, city);
          return;
        } catch {
          return;
        }
      }
      const copied = await copyText(url, "Profile link copied");
      if (!copied) return;
      void recordProfileEngagementShare(profileName, city);
    }

    function closeSharePopovers(exceptPanel = null) {
      document.querySelectorAll("[data-share-popover]").forEach((panel) => {
        if (panel === exceptPanel) return;
        panel.hidden = true;
      });
      document.querySelectorAll("[data-toggle-share]").forEach((button) => {
        const panel = document.querySelector(`[data-share-popover="${CSS.escape(button.dataset.toggleShare)}"]`);
        const isOpen = panel && !panel.hidden;
        button.classList.toggle("is-open", isOpen);
        button.setAttribute("aria-expanded", String(Boolean(isOpen)));
      });
    }

    function profileQrOverlay() {
      let overlay = document.getElementById("profileQrOverlay");
      if (overlay) return overlay;
      document.body.insertAdjacentHTML("beforeend", `
        <div class="profile-qr-overlay" id="profileQrOverlay" aria-hidden="true" hidden>
          <div class="profile-qr-sheet" role="dialog" aria-modal="true" aria-labelledby="profileQrTitle">
            <button class="profile-qr-close" type="button" data-close-qr-overlay aria-label="Close QR code">${actionIconMarkup("close")}</button>
            <p class="profile-qr-kicker">Profile-sharing QR</p>
            <h3 class="profile-qr-title" id="profileQrTitle">Open dancer account profile</h3>
            <p class="profile-qr-subtitle" id="profileQrSubtitle">Scan to open this dancer profile. This is not a Club Deal.</p>
            <div class="profile-qr-frame">
              <img class="profile-qr-overlay-image" id="profileQrImage" alt="QR code for dancer profile" width="360" height="360" decoding="async">
            </div>
            <p class="profile-qr-load-status" id="profileQrLoadStatus" role="status" aria-live="polite" hidden></p>
            <button class="profile-qr-action" type="button" data-retry-profile-qr hidden>Retry QR code</button>
            <div class="profile-qr-actions">
              <button class="profile-qr-action" type="button" data-copy-qr-profile>Copy link</button>
              <a class="profile-qr-action primary" id="profileQrOpen" href="#" target="_blank" rel="noreferrer">Open profile</a>
            </div>
          </div>
        </div>
      `);
      overlay = document.getElementById("profileQrOverlay");
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay || event.target.closest("[data-close-qr-overlay]")) {
          closeQrPopovers();
          return;
        }
        if (event.target.closest("[data-retry-profile-qr]")) {
          loadProfileQrImage(overlay);
          return;
        }
        if (event.target.closest("[data-copy-qr-profile]")) {
          const url = overlay.dataset.qrUrl;
          if (url) copyText(url, overlay.dataset.qrKind === "venue" ? "Club link copied" : "Profile link copied");
        }
      });
      return overlay;
    }

    function profileShareChoiceOverlay() {
      let overlay = document.getElementById("profileShareChoiceOverlay");
      if (overlay) return overlay;
      document.body.insertAdjacentHTML("beforeend", `
        <div class="profile-qr-overlay profile-share-choice-overlay" id="profileShareChoiceOverlay" aria-hidden="true" hidden>
          <div class="profile-qr-sheet" role="dialog" aria-modal="true" aria-labelledby="profileShareChoiceTitle">
            <button class="profile-qr-close" type="button" data-close-profile-share-choice aria-label="Close profile sharing">${actionIconMarkup("close")}</button>
            <p class="profile-qr-kicker">Share profile</p>
            <h3 class="profile-qr-title" id="profileShareChoiceTitle">Share this dancer profile</h3>
            <p class="profile-qr-subtitle" id="profileShareChoiceSubtitle">Share this public profile, copy its link, or show a QR code. Show your Club Deal admission pass to venue staff for scanning.</p>
            <div class="profile-share-choice-actions">
              <button class="profile-qr-action primary" type="button" data-share-profile-choice>${actionButtonLabel("share", "Share profile")}</button>
              <button class="profile-qr-action" type="button" data-copy-profile-choice>Copy profile link</button>
              <button class="profile-qr-action" type="button" data-show-profile-qr-choice>Show QR code</button>
            </div>
          </div>
        </div>
      `);
      overlay = document.getElementById("profileShareChoiceOverlay");
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay || event.target.closest("[data-close-profile-share-choice]")) {
          closeProfileShareChoice();
          return;
        }
        const profileName = overlay.dataset.profileName || "";
        const city = overlay.dataset.shareCity || selectedCity();
        const assignedSlug = overlay.dataset.profileSlug || "";
        if (event.target.closest("[data-share-profile-choice]")) {
          closeProfileShareChoice({ restoreFocus: false });
          recordLiveEvent("profile_action", { dancerName: profileName, source: "share_opened" });
          runShareAction(profileName, city, assignedSlug);
          return;
        }
        if (event.target.closest("[data-copy-profile-choice]")) {
          void copyText(profileShareUrl(profileName, city, assignedSlug), "Profile link copied").then((copied) => {
            if (copied) void recordProfileEngagementShare(profileName, city);
          });
          return;
        }
        if (event.target.closest("[data-show-profile-qr-choice]")) {
          const shareTrigger = overlay.profileShareTrigger;
          closeProfileShareChoice({ restoreFocus: false });
          openQrOverlay(profileName, city, shareTrigger, assignedSlug);
          recordLiveEvent("profile_action", { dancerName: profileName, source: "profile_share_qr_opened" });
        }
      });
      return overlay;
    }

    function openProfileShareChoice(profileName, city, triggerButton, assignedSlug = "") {
      const overlay = profileShareChoiceOverlay();
      const safeProfileName = String(profileName || "Dancer").trim() || "Dancer";
      overlay.dataset.profileName = safeProfileName;
      overlay.dataset.profileSlug = assignedSlug;
      overlay.dataset.shareCity = city || selectedCity();
      overlay.profileShareTrigger = triggerButton || null;
      triggerButton?.setAttribute("aria-expanded", "true");
      document.getElementById("profileShareChoiceTitle").textContent = `${safeProfileName} on MyDancr`;
      document.getElementById("profileShareChoiceSubtitle").textContent =
        "Share this public profile, copy its link, or show a QR code. Show your Club Deal admission pass to venue staff for scanning.";
      overlay.hidden = false;
      overlay.classList.add("show");
      overlay.setAttribute("aria-hidden", "false");
      syncOverlayScrollLock();
      overlay.querySelector("[data-close-profile-share-choice]")?.focus({ preventScroll: true });
    }

    function closeProfileShareChoice({ restoreFocus = true } = {}) {
      const overlay = document.getElementById("profileShareChoiceOverlay");
      if (!overlay) return;
      const returnTarget = overlay.profileShareTrigger;
      if (overlay.contains(document.activeElement)) {
        document.activeElement.blur();
      }
      overlay.classList.remove("show");
      overlay.setAttribute("aria-hidden", "true");
      overlay.hidden = true;
      delete overlay.dataset.profileName;
      delete overlay.dataset.profileSlug;
      delete overlay.dataset.shareCity;
      returnTarget?.setAttribute("aria-expanded", "false");
      overlay.profileShareTrigger = null;
      syncOverlayScrollLock();
      if (restoreFocus && returnTarget?.isConnected) {
        returnTarget.focus({ preventScroll: true });
      }
    }

    function closeQrPopovers() {
      const overlay = document.getElementById("profileQrOverlay");
      const returnTarget = overlay?.profileQrTrigger;
      if (overlay) {
        if (overlay.contains(document.activeElement)) {
          document.activeElement.blur();
        }
        overlay.classList.remove("show");
        overlay.setAttribute("aria-hidden", "true");
        overlay.hidden = true;
        delete overlay.dataset.qrUrl;
        delete overlay.dataset.qrKind;
        overlay.profileQrTrigger = null;
      }
      document.querySelectorAll("[data-profile-qr], [data-toggle-qr], [data-venue-profile-qr]").forEach((button) => {
        button.classList.remove("is-open");
        button.setAttribute("aria-expanded", "false");
      });
      returnTarget?.classList.remove("is-open");
      returnTarget?.setAttribute("aria-expanded", "false");
      syncOverlayScrollLock();
      if (returnTarget?.isConnected) {
        returnTarget.focus({ preventScroll: true });
      }
    }

    function loadProfileQrImage(overlay) {
      const image = overlay.querySelector("#profileQrImage");
      const status = overlay.querySelector("#profileQrLoadStatus");
      const retry = overlay.querySelector("[data-retry-profile-qr]");
      image.style.visibility = "hidden";
      status.hidden = false;
      status.textContent = "Loading QR code…";
      retry.hidden = true;
      image.onload = () => { image.style.visibility = "visible"; status.hidden = true; };
      image.onerror = () => {
        image.style.visibility = "hidden";
        status.textContent = "QR code unavailable. Try again or copy your link.";
        retry.hidden = false;
      };
      // Reset a failed image so Safari retries the same QR URL.
      image.removeAttribute("src");
      image.src = qrCodeUrl(overlay.dataset.qrUrl);
    }

    function openShareQrOverlay({
      url,
      kicker,
      title,
      subtitle,
      imageAlt,
      openLabel,
      kind,
      triggerButton
    }) {
      const overlay = profileQrOverlay();
      overlay.hidden = false;
      const image = document.getElementById("profileQrImage");
      const kickerNode = overlay.querySelector(".profile-qr-kicker");
      const titleNode = document.getElementById("profileQrTitle");
      const subtitleNode = document.getElementById("profileQrSubtitle");
      const openLink = document.getElementById("profileQrOpen");
      overlay.dataset.qrUrl = url;
      overlay.dataset.qrKind = kind;
      overlay.profileQrTrigger = triggerButton || null;
      loadProfileQrImage(overlay);
      image.alt = imageAlt;
      kickerNode.textContent = kicker;
      titleNode.textContent = title;
      subtitleNode.textContent = subtitle;
      openLink.href = url;
      openLink.textContent = openLabel;
      document.querySelectorAll("[data-profile-qr], [data-toggle-qr], [data-venue-profile-qr]").forEach((button) => {
        const isActive = button === triggerButton;
        button.classList.toggle("is-open", isActive);
        button.setAttribute("aria-expanded", String(isActive));
      });
      triggerButton?.classList.add("is-open");
      triggerButton?.setAttribute("aria-expanded", "true");
      overlay.classList.add("show");
      overlay.setAttribute("aria-hidden", "false");
      overlay.querySelector("[data-close-qr-overlay]")?.focus({ preventScroll: true });
    }

    function openQrOverlay(profileName, city, triggerButton, assignedSlug = "") {
      openShareQrOverlay({
        url: profileShareUrl(profileName, city, assignedSlug),
        kicker: "Profile-sharing QR",
        title: `${profileName} profile QR`,
        subtitle: `Scan to open ${profileName}'s MyDancr profile and follow them. This is not a Club Deal and cannot be redeemed at a venue.`,
        imageAlt: `QR code for ${profileName} profile`,
        openLabel: "Open profile",
        kind: "profile",
        triggerButton
      });
    }

    function shareableDancerProfile(profile) {
      if (!isApprovedPublicProfile(profile) || profile?.disabled_at || profile?.disabledAt) return null;
      const profileName = cleanDisplayValue(profile?.stage_name || profile?.stageName || "");
      const city = cleanDisplayValue(profile?.city || profile?.cityName || "");
      return profileName && city ? { profileName, city, slug: String(profile.slug || "") } : null;
    }

    async function openOwnDancerProfileShare(triggerButton) {
      if (!isDancerSession() || !triggerButton) return;
      triggerButton.disabled = true;
      triggerButton.setAttribute("aria-busy", "true");
      try {
        const data = await getAuthenticatedJson("/api/dancer/profile");
        const target = shareableDancerProfile(data?.profile);
        if (!target) {
          showToast("Publish your dancer profile before sharing it");
          return;
        }
        triggerButton.dataset.shareCity = target.city;
        openProfileShareChoice(target.profileName, target.city, triggerButton, target.slug);
        recordLiveEvent("profile_action", {
          dancerName: target.profileName,
          source: "profile_share_nav_opened"
        });
      } catch (error) {
        showToast(error?.message || "Profile sharing unavailable");
      } finally {
        triggerButton.disabled = false;
        triggerButton.setAttribute("aria-busy", "false");
      }
    }

    function openVenueQrOverlay(venueName, city, triggerButton) {
      const venue = resolveVenueByName(venueName, city);
      if (!venue) {
        showToast("Club QR unavailable");
        return;
      }
      openShareQrOverlay({
        url: venueShareUrl(venue, city),
        kicker: "Club QR",
        title: venue.name,
        subtitle: `No account needed. Scan to open ${venue.name}'s verified MyDancr club page.`,
        imageAlt: `QR code for ${venue.name} club page`,
        openLabel: "Open club",
        kind: "venue",
        triggerButton
      });
      if (venue.id) {
        recordVenuePageEvent({
          venueId: venue.id,
          eventType: "qr_impression",
          source: "venue_page"
        });
      }
    }

    function handleQrClick(event) {
      const venueQrButton = event.target.closest("[data-venue-profile-qr]");
      if (venueQrButton) {
        const venueName = venueQrButton.dataset.venueProfileQr;
        if (!venueName) return true;
        openVenueQrOverlay(
          venueName,
          venueQrButton.dataset.shareCity || selectedCity(),
          venueQrButton
        );
        return true;
      }
      const qrButton = event.target.closest("[data-profile-qr], [data-toggle-qr]");
      if (!qrButton) return false;
      const profileName = qrButton.dataset.profileQr;
      if (!profileName) return true;
      openQrOverlay(profileName, qrButton.dataset.shareCity || selectedCity(), qrButton);
      recordLiveEvent("profile_action", { dancerName: profileName, source: "qr_opened" });
      return true;
    }

    function handleShareClick(event) {
      const venueButton = event.target.closest("[data-share-venue]");
      if (venueButton) {
        void runVenueShareAction(
          venueButton.dataset.shareVenue,
          venueButton.dataset.shareCity || selectedCity(),
          venueButton
        );
        return true;
      }
      const profileShareMenuButton = event.target.closest("[data-profile-share-menu]");
      if (profileShareMenuButton) {
        openProfileShareChoice(
          profileShareMenuButton.dataset.profileShareMenu,
          profileShareMenuButton.dataset.shareCity || selectedCity(),
          profileShareMenuButton
        );
        return true;
      }
      const toggleButton = event.target.closest("[data-toggle-share]");
      if (toggleButton) {
        runShareAction(toggleButton.dataset.toggleShare, selectedCity());
        return true;
      }
      const copyButton = event.target.closest("[data-copy-share]");
      if (copyButton) {
        const city = copyButton.dataset.shareCity || selectedCity();
        const profileName = copyButton.dataset.copyShare;
        void copyText(profileShareUrl(profileName, city), "Profile link copied").then((copied) => {
          if (copied) void recordProfileEngagementShare(profileName, city);
        });
        return true;
      }
      const nativeButton = event.target.closest("[data-native-share]");
      if (nativeButton) {
        recordLiveEvent("profile_action", { dancerName: nativeButton.dataset.nativeShare, source: "share_opened" });
        runShareAction(nativeButton.dataset.nativeShare, nativeButton.dataset.shareCity || selectedCity());
        return true;
      }
      const socialShare = event.target.closest("[data-social-share]");
      if (socialShare) {
        recordUniqueTrendEvent("socialClicks", socialShare.dataset.shareCity || selectedCity(), socialShare.dataset.profile);
        recordLiveEvent("profile_action", { dancerName: socialShare.dataset.profile, source: `share_${socialShare.dataset.socialShare}` });
        void recordProfileEngagementShare(
          socialShare.dataset.profile,
          socialShare.dataset.shareCity || selectedCity()
        );
        showToast(`${socialShare.dataset.socialShare} share opened`);
        return false;
      }
      return false;
    }

    document.addEventListener("pointerdown", event => {
      document.querySelectorAll("details.dancer-media-menu[open]").forEach(menu => { if (!menu.contains(event.target)) menu.open = false; });
    });
    modalGallery.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const thumb = event.target.closest(".thumb");
      if (!thumb) return;
      if (thumb.hasAttribute("data-profile-tv-index")) {
        const videos = Array.isArray(modalGallery.profileTvVideos) ? modalGallery.profileTvVideos : [];
        const videoIndex = Number(thumb.dataset.profileTvIndex);
        const item = videos[videoIndex];
        if (item) openProfileTvViewer(item, modalGallery.profileTvProfileName || "Dancer", videos, videoIndex);
        return;
      }
      const photoIndex = Number(thumb.dataset.profilePhotoIndex);
      selectModalMediaThumb(thumb, { syncViewer: true });
      openPhotoViewerFromElement(modalImage, Number.isInteger(photoIndex) ? photoIndex : null);
    });

    [modalMediaPhotoTab, modalMediaTvTab].forEach((button) => {
      button?.addEventListener("click", () => {
        if (button.disabled) return;
        setProfileMediaTab(button.dataset.profileMediaTab);
      });
    });

    modalVideoPlayback?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleModalVideoPlayback();
    });
