

    function render() {
      syncDiscoveryCityScope();
      const city = citySelect.value;
      homeTvLandingPreload.sync(city);
      document.body.classList.toggle("dancer-directory-active", activeTab === "dancers");
      syncCityPickerSelection(city);
      populateVenueSelect(city);
      const tvVenueFilter = selectedHomeTvVenueFilter(city);
      const tvLaunchScope = `${city}:${tvVenueFilter?.id || ""}`;
      if (homeTvLaunchScope !== tvLaunchScope) {
        homeTvLaunchScope = tvLaunchScope;
        void renderHomeTvLaunch(city, tvVenueFilter);
      }
      document.querySelectorAll("[data-city-label]").forEach((node) => { node.textContent = userLocationOutsideMarkets ? "Near me" : city; });
      updateTabCounts(city);
      updateHomeLiveSummary(city);
      const expectsVenueProfile = activeTab === "venues" && Boolean(selectedVenueName);
      document.body.classList.toggle("venue-full-view-open", expectsVenueProfile);
      results.classList.toggle("venue-profile-overlay", expectsVenueProfile);
      if (activeTab === "tv") {
        homeDiscoveryFeedOpen = false;
        deactivateHomeDiscoveryFeed();
        renderHomeTvFeed(city);
        return;
      }
      deactivateHomeTvFeed();

      const loadingDiscovery = liveDiscoveryIsLoading(city);
      const unavailableDiscovery = liveMarketState[city] === "error";
      const allItems = getItems(city, activeTab);
      const items = allItems;
      const venueFilter = selectedVenueFilter();
      const locationPhrase = discoveryLocationPhrase(city);
      const venueFilterLabel = resolveVenueByName(venueFilter, city)?.name || venueFilter;
      const titles = {
        dancers: venueFilter === "all" ? `Dancers ${locationPhrase}` : `Dancers at ${venueFilterLabel}`,
        venues: `Clubs ${locationPhrase}`
      };
      const selectedVenue = activeTab === "venues" && selectedVenueName
        ? resolveVenueByName(selectedVenueName, city)
        : null;
      if (selectedVenue?.hidden) {
        selectedVenueName = null;
        render();
        return;
      }
      const venueProfileOpen = Boolean(selectedVenue);
      document.body.classList.toggle("venue-full-view-open", venueProfileOpen);
      results.classList.toggle("venue-profile-overlay", venueProfileOpen);
      const keepDancerCityOnOneLine =
        !userLocationOutsideMarkets && !selectedVenue && activeTab === "dancers" && venueFilter === "all";
      const usesDiscoverySectionHeader =
        !selectedVenue && (activeTab === "dancers" || activeTab === "venues");
      tabTitle.classList.toggle("dancers-city-title", keepDancerCityOnOneLine);
      const contentHead = tabTitle.closest(".content-head");
      contentHead?.classList.remove("tv-section-head");
      contentHead?.classList.toggle("discovery-section-head", usesDiscoverySectionHeader);
      if (keepDancerCityOnOneLine) {
        const cityTitle = document.createElement("span");
        cityTitle.className = "tab-title-city";
        cityTitle.textContent = city;
        tabTitle.replaceChildren(document.createTextNode(city === ALL_CITIES ? "Dancers across " : "Dancers in "), cityTitle);
      } else {
        tabTitle.textContent = selectedVenue ? `${selectedVenue.name}` : titles[activeTab];
      }
      const resultCount = activeTab === "dancers"
        ? dancerDirectorySections(allItems, city).reduce((total, section) => total + section.profiles.length, 0)
        : allItems.length;
      const resultCountLabel = activeTab === "venues"
        ? `${resultCount} club${resultCount === 1 ? "" : "s"}`
        : `${resultCount} dancer${resultCount === 1 ? "" : "s"}`;
      setHomeTvFeedCount(unavailableDiscovery
        ? "Unavailable"
        : loadingDiscovery
        ? activeTab === "venues" ? "Clubs" : "Dancers"
        : selectedVenue
        ? city
        : resultCountLabel);
      const usesDiscoveryFeed =
        activeTab === "venues" &&
        !selectedVenue &&
        homeDiscoveryFeedUsesInlineLayout();
      // Derive the mobile venue renderer during every render. Filter and data
      // refresh handlers may clear transient feed state, but they must never
      // expose the retired venue grid for a frame before viewport events settle.
      homeDiscoveryFeedOpen = usesDiscoveryFeed;
      if (usesDiscoveryFeed) {
        renderHomeDiscoveryFeed(city, allItems, { loading: loadingDiscovery });
        return;
      }
      if (homeDiscoveryFeedOpen) homeDiscoveryFeedOpen = false;
      deactivateHomeDiscoveryFeed();
      const showsVenueDirectoryLink = activeTab === "venues" && !selectedVenue;
      viewAllBtn.hidden = !showsVenueDirectoryLink || !allItems.length;
      viewAllBtn.textContent = showsVenueDirectoryLink
        ? "View All Clubs"
        : activeTab === "dancers"
          ? "View All Dancers"
          : "View All";
      results.classList.remove("home-dancer-grid");
      results.classList.toggle("card-grid", activeTab !== "venues");
      results.classList.toggle("venue-card-grid", activeTab === "venues" && !selectedVenue);
      if (selectedVenue) {
        viewAllBtn.hidden = true;
        results.classList.remove("card-grid", "venue-card-grid");
        results.innerHTML = venueDetailPage(selectedVenue);
        return;
      }
      if (loadingDiscovery && !items.length) {
        results.innerHTML = homeDiscoveryLoadingStateMarkup(city, activeTab);
        return;
      }
      if (liveMarketState[city] === "error" && !items.length) {
        const contentLabel = activeTab === "venues" ? "clubs" : "dancer profiles";
        results.innerHTML = `
          <section class="home-discovery-empty" aria-labelledby="homeDiscoveryErrorTitle" role="alert">
            <strong id="homeDiscoveryErrorTitle">Live ${contentLabel} could not load.</strong>
            <p>Check your connection and try again. MyDancr will request the latest live results.</p>
            <button class="home-discovery-empty-action" type="button" data-retry-live-discovery="${escapeHtml(city)}">Try again</button>
          </section>
        `;
        return;
      }
      if (activeTab === "dancers" && !items.length) {
        const scope = venueFilter === "all" ? `in ${city}` : `at ${venueFilterLabel}`;
        results.innerHTML = `
          <section class="home-discovery-empty" aria-labelledby="homeDancersEmptyTitle">
            <strong id="homeDancersEmptyTitle">No approved dancer profiles ${scope}.</strong>
            <p>Profiles appear here as soon as they are approved for public discovery.</p>
          </section>
        `;
        return;
      }
      if (activeTab === "venues" && !items.length) {
        results.innerHTML = homeClubEmptyStateMarkup(city);
        return;
      }
      if (activeTab === "dancers") {
        renderHomeDancerGrid(city, items);
        return;
      }
      results.innerHTML = items.map((item) => venueCard(item)).join("");
    }

    async function renderHomeTvLaunch(city, venueFilter = null) {
      const launch = document.getElementById("homeTvLaunch");
      const title = document.getElementById("homeTvLaunchTitle");
      const count = document.getElementById("homeTvLaunchCount");
      const desktopCount = document.getElementById("homeTvDesktopCount");
      const bottomTv = document.getElementById("homeBottomTv");
      if (!launch || !title || !count) return;

      const requestId = ++homeTvLaunchRequest;
      const tvCityLabel = String(city).trim() || "Las Vegas";
      const venueId = String(venueFilter?.id || "");
      const venueName = String(venueFilter?.name || "");
      const scopeLabel = venueName ? `at ${venueName}` : tvCityLabel;
      const launchParams = new URLSearchParams({ city: tvCityLabel, view: "tv" });
      if (venueId) {
        launchParams.set("tv_venue", venueId);
      }
      launch.href = `/?${launchParams.toString()}`;
      launch.setAttribute("aria-label", `Open MyDancr TV ${scopeLabel} vertical video feed`);
      if (bottomTv) {
        bottomTv.setAttribute("aria-label", `Show MyDancr TV ${scopeLabel} videos in the Home feed`);
      }
      launch.setAttribute("aria-busy", "true");
      title.textContent = venueName ? `MyDancr TV at ${venueName}` : `MyDancr TV ${tvCityLabel}`;
      count.textContent = "Videos";
      count.removeAttribute("title");
      if (desktopCount) { desktopCount.textContent = "..."; desktopCount.removeAttribute("title"); }

      try {
        const countParams = new URLSearchParams({ city: tvCityLabel });
        if (venueId) countParams.set("venue", venueId);
        const response = await fetch(`/api/public/tv/count?${countParams.toString()}`, { cache: "default" });
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error(payload.error || "Unable to load the MyDancr TV video count.");
        if (requestId !== homeTvLaunchRequest || homeTvLaunchScope !== `${city}:${venueId}`) return;
        const approvedVideoCount = Number(payload.approvedVideoCount);
        if (!Number.isSafeInteger(approvedVideoCount) || approvedVideoCount < 0) {
          throw new Error("MyDancr TV returned an invalid video count.");
        }
        count.textContent = `${approvedVideoCount} video${approvedVideoCount === 1 ? "" : "s"}`;
        count.title = `${approvedVideoCount} approved MyDancr TV video${approvedVideoCount === 1 ? "" : "s"} ${scopeLabel}`;
        if (desktopCount) { desktopCount.textContent = String(approvedVideoCount); desktopCount.title = count.title; }
      } catch {
        if (requestId !== homeTvLaunchRequest || homeTvLaunchScope !== `${city}:${venueId}`) return;
        count.textContent = "Count unavailable";
        count.title = "The vertical video feed is still available.";
        if (desktopCount) { desktopCount.textContent = "—"; desktopCount.title = count.title; }
        homeTvLaunchScope = "";
      } finally {
        if (requestId === homeTvLaunchRequest && homeTvLaunchScope === `${city}:${venueId}`) {
          launch.setAttribute("aria-busy", "false");
        }
      }
    }

    function trackHomeTvFeedEvent(videoId, eventType) {
      if (!videoId || window.location.protocol === "file:") return Promise.resolve(false);
      const headers = { "Content-Type": "application/json", Accept: "application/json" };
      if (authSession?.accessToken) headers.Authorization = `Bearer ${authSession.accessToken}`;
      return fetch(`/api/public/tv/${encodeURIComponent(videoId)}/events`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          eventType,
          sessionId: dancrLiveSessionId(),
          source: "home"
        }),
        keepalive: true
      }).then((response) => response.ok).catch(() => false);
    }

    function publicMediaLikeKey(mediaType, mediaId) {
      return `${mediaType}:${mediaId}`;
    }

    function safePublicMediaLikeCount(value) {
      const count = Number(value);
      return Number.isSafeInteger(count) && count >= 0 ? count : 0;
    }

    function compactPublicMediaLikeCount(value) {
      return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 })
        .format(safePublicMediaLikeCount(value));
    }

    function publicMediaLikeState(mediaType, mediaId, initialCount = 0) {
      const key = publicMediaLikeKey(mediaType, mediaId);
      if (!publicMediaLikeStates.has(key)) {
        publicMediaLikeStates.set(key, {
          liked: false,
          likeCount: safePublicMediaLikeCount(initialCount),
          pending: false,
          loaded: false
        });
      }
      return publicMediaLikeStates.get(key);
    }

    function recordPublicEngagementShare(targetType, targetId) {
      if (!targetId || !["profile", "photo", "video"].includes(targetType)) return Promise.resolve(false);
      return fetch("/api/public/engagement-shares", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetType, targetId }),
        credentials: "same-origin",
        keepalive: true
      }).then((response) => response.ok).catch(() => false);
    }

    function recordProfileEngagementShare(profileName, city) {
      const profile = publicProfileForNavigation(profileName, city);
      return profile?.id
        ? recordPublicEngagementShare("profile", String(profile.id))
        : Promise.resolve(false);
    }

    function syncPublicMediaLikeButtons(mediaType, mediaId) {
      const state = publicMediaLikeState(mediaType, mediaId);
      document.querySelectorAll("[data-media-like-type][data-media-like-id]").forEach((button) => {
        if (button.dataset.mediaLikeType !== mediaType || button.dataset.mediaLikeId !== mediaId) return;
        const mediaLabel = mediaType === "photo" ? "photo" : "video";
        button.classList.toggle("is-liked", state.liked);
        button.setAttribute("aria-pressed", String(state.liked));
        button.setAttribute("aria-label", `${state.liked ? "Unlike" : "Like"} this ${mediaLabel}. ${state.likeCount} ${state.likeCount === 1 ? "like" : "likes"}.`);
        button.disabled = state.pending;
        const count = button.querySelector("[data-media-like-count]");
        if (count) count.textContent = compactPublicMediaLikeCount(state.likeCount);
      });
    }

    function preparePublicMediaLikeButton(button, mediaType, mediaId, initialCount = 0) {
      if (!button) return false;
      if (!mediaId) {
        button.hidden = true;
        return false;
      }
      button.hidden = false;
      button.dataset.mediaLikeType = mediaType;
      button.dataset.mediaLikeId = mediaId;
      publicMediaLikeState(mediaType, mediaId, initialCount);
      syncPublicMediaLikeButtons(mediaType, mediaId);
      return true;
    }

    async function loadPublicMediaLikes(items) {
      if (window.location.protocol === "file:") return;
      const pendingItems = [...new Map((items || [])
        .filter((item) => item?.mediaId && (item.mediaType === "photo" || item.mediaType === "video"))
        .map((item) => {
          const key = publicMediaLikeKey(item.mediaType, item.mediaId);
          const state = publicMediaLikeState(item.mediaType, item.mediaId, item.likeCount);
          return [key, { ...item, key, state }];
        })).values()]
        .filter((item) => !item.state.loaded && !publicMediaLikeLoads.has(item.key));
      for (let index = 0; index < pendingItems.length; index += 50) {
        const group = pendingItems.slice(index, index + 50);
        const params = new URLSearchParams();
        group.forEach((item) => params.append(item.mediaType, item.mediaId));
        const request = fetch(`/api/public/media-likes?${params.toString()}`, {
          cache: "no-store",
          credentials: "same-origin"
        }).then(async (response) => {
          const payload = await response.json();
          if (!response.ok || !payload.ok || !Array.isArray(payload.likes)) {
            throw new Error(payload.error || "Unable to load likes.");
          }
          payload.likes.forEach((item) => {
            const key = publicMediaLikeKey(item.mediaType, item.mediaId);
            publicMediaLikeStates.set(key, {
              liked: item.liked === true,
              likeCount: safePublicMediaLikeCount(item.likeCount),
              pending: false,
              loaded: true
            });
            syncPublicMediaLikeButtons(item.mediaType, item.mediaId);
          });
        }).catch(() => false).finally(() => {
          group.forEach((item) => publicMediaLikeLoads.delete(item.key));
        });
        group.forEach((item) => publicMediaLikeLoads.set(item.key, request));
        await request;
      }
    }

    async function togglePublicMediaLike(mediaType, mediaId, statusTarget = null) {
      const state = publicMediaLikeState(mediaType, mediaId);
      if (!mediaId || state.pending) return state;
      const previous = { ...state };
      state.liked = !state.liked;
      state.likeCount = Math.max(0, state.likeCount + (state.liked ? 1 : -1));
      state.pending = true;
      syncPublicMediaLikeButtons(mediaType, mediaId);
      if (statusTarget) statusTarget.textContent = "";
      try {
        const response = await fetch("/api/public/media-likes", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ mediaType, mediaId, liked: state.liked })
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error(payload.error || "Unable to update like.");
        state.liked = payload.liked === true;
        state.likeCount = safePublicMediaLikeCount(payload.likeCount);
        state.loaded = true;
        if (statusTarget) statusTarget.textContent = "";
      } catch {
        Object.assign(state, previous);
        if (statusTarget) statusTarget.textContent = "Unable to update this like.";
      } finally {
        state.pending = false;
        syncPublicMediaLikeButtons(mediaType, mediaId);
      }
      return state;
    }

    function clearHomeTvFeedEngagedTimer(videoId) {
      const timer = homeTvFeedEngagedTimers.get(videoId);
      if (timer) window.clearTimeout(timer);
      homeTvFeedEngagedTimers.delete(videoId);
    }

    function scheduleHomeTvFeedEngagedView(videoId, video) {
      clearHomeTvFeedEngagedTimer(videoId);
      if (homeTvFeedEngagedViews.has(videoId)) return;
      const timer = window.setTimeout(() => {
        homeTvFeedEngagedTimers.delete(videoId);
        if (homeTvFeedActiveVideoId !== videoId || video.paused) return;
        homeTvFeedEngagedViews.add(videoId);
        trackHomeTvFeedEvent(videoId, "engaged_view");
      }, 3000);
      homeTvFeedEngagedTimers.set(videoId, timer);
    }

    function syncHomeTvFeedSoundButtons() {
      document.querySelectorAll("[data-home-tv-sound]").forEach((button) => {
        const label = homeTvFeedMuted ? "Turn MyDancr TV sound on" : "Mute MyDancr TV";
        button.classList.toggle("is-muted", homeTvFeedMuted);
        button.setAttribute("aria-label", label);
        button.setAttribute("title", label);
        button.setAttribute("aria-pressed", String(!homeTvFeedMuted));
      });
    }

    function homeTvFeedFullscreenElement() {
      return document.fullscreenElement || document.webkitFullscreenElement || null;
    }

    function homeTvFeedFullscreenSurface() {
      return results.classList.contains("home-tv-feed") ? results : null;
    }

    function homeTvFeedIsImmersive() {
      const feed = homeTvFeedFullscreenSurface();
      return Boolean(
        feed &&
        (homeTvFeedFullscreenElement() === feed || feed.classList.contains("is-fullscreen-feed"))
      );
    }

    function setHomeTvFeedFallbackFullscreen(active) {
      const feed = homeTvFeedFullscreenSurface();
      feed?.classList.toggle("is-fullscreen-feed", active);
      document.documentElement.classList.toggle("home-tv-feed-immersive-open", active);
      document.body.classList.toggle("home-tv-feed-immersive-open", active);
    }

    function homeTvFeedActiveSlide() {
      return results.querySelector(
        `.home-tv-feed-slide[data-video-id="${CSS.escape(homeTvFeedActiveVideoId)}"]`
      ) || results.querySelector(".home-tv-feed-slide");
    }

    function alignHomeTvFeedFullscreenSlide(slide) {
      if (!slide || !homeTvFeedIsImmersive()) return;
      window.requestAnimationFrame(() => {
        if (!homeTvFeedIsImmersive()) return;
        results.scrollTo({ top: slide.offsetTop, left: 0, behavior: "auto" });
        window.requestAnimationFrame(setupHomeTvFeedObserver);
      });
    }

    function syncHomeTvFeedFullscreenButtons() {
      const feedIsFullscreen = homeTvFeedIsImmersive();
      document.querySelectorAll("[data-home-tv-fullscreen]").forEach((button) => {
        const label = feedIsFullscreen ? "Exit full-screen videos" : "View videos full screen";
        button.setAttribute("aria-label", label);
        button.setAttribute("title", label);
        button.setAttribute("aria-pressed", String(feedIsFullscreen));
      });
      document.querySelectorAll("[data-home-tv-full-view-close]").forEach((button) => {
        button.hidden = !feedIsFullscreen;
      });
    }

    function syncHomeTvFeedFullscreenState() {
      const feedIsFullscreen = homeTvFeedIsImmersive();
      if (feedIsFullscreen) {
        const activeSlide = homeTvFeedActiveSlide();
        alignHomeTvFeedFullscreenSlide(activeSlide);
      } else if (homeTvFeedWasFullscreen) {
        document.documentElement.classList.remove("home-tv-feed-immersive-open");
        document.body.classList.remove("home-tv-feed-immersive-open");
        const activeSlide = homeTvFeedActiveSlide();
        window.requestAnimationFrame(() => {
          if (activeSlide?.isConnected) {
            window.scrollTo({ top: homeTvFeedFullscreenReturnScrollY, left: 0, behavior: "auto" });
            activeSlide.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
          }
          setupHomeTvFeedObserver();
        });
      }
      homeTvFeedWasFullscreen = feedIsFullscreen;
      syncHomeTvFeedFullscreenButtons();
    }

    async function toggleHomeTvFeedFullscreen(slide, video) {
      if (!slide || !video) return;
      const feed = homeTvFeedFullscreenSurface();
      if (!feed) return;
      const isFullscreen = homeTvFeedIsImmersive();
      try {
        if (isFullscreen) {
          if (homeTvFeedFullscreenElement() === feed) {
            const exit = document.exitFullscreen || document.webkitExitFullscreen;
            if (typeof exit === "function") await exit.call(document);
          } else {
            setHomeTvFeedFallbackFullscreen(false);
            syncHomeTvFeedFullscreenState();
          }
          return;
        }
        const videoId = String(slide.dataset.videoId || "");
        delete slide.dataset.userPaused;
        if (videoId) activateHomeTvFeedVideo(videoId);
        homeTvFeedFullscreenReturnScrollY = window.scrollY || 0;
        let enteredNativeFullscreen = false;
        try {
          if (typeof feed.requestFullscreen === "function") {
            await feed.requestFullscreen({ navigationUI: "hide" });
            enteredNativeFullscreen = true;
          } else if (typeof feed.webkitRequestFullscreen === "function") {
            await feed.webkitRequestFullscreen();
            enteredNativeFullscreen = true;
          }
        } catch {
          enteredNativeFullscreen = false;
        }
        if (!enteredNativeFullscreen) setHomeTvFeedFallbackFullscreen(true);
        homeTvFeedWasFullscreen = true;
        alignHomeTvFeedFullscreenSlide(slide);
        showHomeTvFeedFeedback(slide, "Full screen", "neutral");
      } catch {
        showHomeTvFeedFeedback(slide, "Full screen unavailable", "neutral");
      } finally {
        syncHomeTvFeedFullscreenState();
      }
    }

    function showHomeTvFeedFeedback(slide, message, tone = "default") {
      const feedback = slide?.querySelector(".home-tv-feed-feedback");
      if (!feedback) return;
      window.clearTimeout(slide.homeTvFeedbackTimer);
      feedback.textContent = message;
      feedback.classList.toggle("is-neutral", tone === "neutral");
      feedback.classList.add("show");
      slide.homeTvFeedbackTimer = window.setTimeout(() => {
        feedback.classList.remove("show", "is-neutral");
      }, 1100);
    }

    async function applaudHomeTvFeedVideo(item, slide) {
      const videoId = String(item?.id || "");
      if (!videoId || !slide) return;
      const state = publicMediaLikeState("video", videoId, item.likeCount);
      const alreadyLiked = state.liked;
      slide.classList.remove("is-applauding");
      void slide.offsetWidth;
      slide.classList.add("is-applauding");
      window.setTimeout(() => slide.classList.remove("is-applauding"), 720);
      if (alreadyLiked) {
        return;
      }
      const result = await togglePublicMediaLike("video", videoId);
      if (!result.liked) showHomeTvFeedFeedback(slide, "Unable to like");
      if (result.liked) void trackHomeTvFeedEvent(videoId, "applause");
    }

    async function shareHomeTvFeedVideo(item, slide, button) {
      const videoId = String(item?.id || "");
      const dancerName = String(item?.dancer?.stageName || "MyDancr TV").trim() || "MyDancr TV";
      if (!videoId) return;
      const url = new URL(`/tv/${encodeURIComponent(videoId)}`, window.location.origin).toString();
      button.disabled = true;
      try {
        if (navigator.share) {
          await navigator.share({
            title: `${dancerName} on MyDancr TV`,
            text: `Watch ${dancerName} on MyDancr TV.`,
            url
          });
          showHomeTvFeedFeedback(slide, "Shared");
        } else {
          const copied = await copyText(url, "Video link copied");
          if (!copied) return;
          showHomeTvFeedFeedback(slide, "Link copied");
        }
        void recordPublicEngagementShare("video", videoId);
        void trackHomeTvFeedEvent(videoId, "share");
      } catch (error) {
        if (error?.name !== "AbortError") showHomeTvFeedFeedback(slide, "Sharing unavailable");
      } finally {
        button.disabled = false;
      }
    }

    function watchVideoPosterPresentation(video) {
        let frame = null;
        let paint = null;
        let generation = 0;
        const cancel = () => {
            generation++;
            if (frame !== null)
                video.cancelVideoFrameCallback(frame);
            if (paint !== null)
                window.cancelAnimationFrame(paint);
            frame = null;
            paint = null;
        };
        const reset = () => {
            cancel();
            delete video.dataset.frameReady;
        };
        const reveal = () => {
            if (video.dataset.frameReady === "true" || frame !== null || paint !== null)
                return;
            const source = video.getAttribute("src");
            if (!source)
                return;
            const version = generation;
            const ready = () => video.isConnected && generation === version &&
                video.getAttribute("src") === source && video.readyState >= 2;
            if (typeof video.requestVideoFrameCallback === "function") {
                frame = video.requestVideoFrameCallback(() => {
                    if (generation !== version)
                        return;
                    frame = null;
                    if (ready())
                        video.dataset.frameReady = "true";
                });
            }
            else {
                // Older browsers: allow a paint after the native playing event, never
                // reveal a merely preloaded or autoplay-blocked player.
                paint = window.requestAnimationFrame(() => {
                    if (generation !== version)
                        return;
                    paint = window.requestAnimationFrame(() => {
                        if (generation !== version)
                            return;
                        paint = null;
                        if (ready() && !video.paused)
                            video.dataset.frameReady = "true";
                    });
                });
            }
        };
        video.addEventListener("playing", reveal);
        video.addEventListener("emptied", reset);
        video.addEventListener("error", reset);
        return () => {
            reset();
            video.removeEventListener("playing", reveal);
            video.removeEventListener("emptied", reset);
            video.removeEventListener("error", reset);
        };
    }

    function canWarmAdjacentVideo() {
      const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (!connection) return true;
      if (connection.saveData) return false;
      return !["slow-2g", "2g"].includes(String(connection.effectiveType || "").toLowerCase());
    }

    function videoBufferMode(index, activeIndex, allowWarmup, activeReady, hasSource) {
      if (index === activeIndex) return "auto";
      if (!allowWarmup) return "release";
      const distance = Math.abs(index - activeIndex);
      if (distance === 1) return activeReady ? "auto" : hasSource ? "retain" : "release";
      if (distance === 2) return activeReady ? "metadata" : hasSource ? "retain" : "release";
      return "release";
    }

    function applyVideoBufferMode(video, mode) {
      if (mode === "release") {
        delete video.dataset.frameReady;
        releaseDeferredVideoSource(video);
      } else if (mode === "retain") {
        if (!video.paused) video.pause();
        if (video.preload !== "none") video.preload = "none";
      } else {
        attachDeferredVideoSource(video, mode);
      }
    }

    const pageSuspendedVideos = new Set();

    function suspendPageVideoPlayback() {
      homeTvLandingPreload.clear();
      const profileVideo = activeProfileTvViewerVideo();
      document.querySelectorAll(".home-tv-feed-video, .profile-tv-viewer-video").forEach((video) => {
        if (!video.paused) pageSuspendedVideos.add(video);
        video.autoplay = false;
        video.removeAttribute("autoplay");
        video.pause();
        video.preload = "none";
        const homeActive = video.closest(".home-tv-feed-slide")?.getAttribute("aria-current") === "true";
        if (!homeActive && video !== profileVideo) releaseDeferredVideoSource(video);
      });
    }

    function resumePageVideoPlayback() {
      if (document.visibilityState === "hidden") return;
      const videos = [...pageSuspendedVideos];
      pageSuspendedVideos.clear();
      videos.forEach((video) => {
        if (!video.isConnected || !video.hasAttribute("src")) return;
        if (video === activeProfileTvViewerVideo()) {
          video.preload = "auto";
          void playProfileTvViewerVideo(video);
          return;
        }
        const slide = video.closest(".home-tv-feed-slide");
        if (slide && homeTvFeedCoveredByProfile()) {
          pageSuspendedVideos.add(video);
          return;
        }
        if (slide?.getAttribute("aria-current") === "true" && slide.dataset.userPaused !== "true" &&
            slide.dataset.viewportInactive !== "true" &&
            !homeTvFeedCoveredByProfile()) {
          activateHomeTvFeedVideo(String(slide.dataset.videoId || ""));
        }
      });
    }

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") suspendPageVideoPlayback();
      else resumePageVideoPlayback();
    });
    window.addEventListener("pagehide", suspendPageVideoPlayback);
    window.addEventListener("pageshow", resumePageVideoPlayback);

    function attachDeferredVideoSource(video, preload = "metadata") {
      if (!(video instanceof HTMLVideoElement)) return false;
      const videoUrl = String(video.dataset.videoUrl || "").trim();
      if (!videoUrl) return false;
      if (video.preload !== preload) video.preload = preload;
      if (!video.hasAttribute("src")) video.src = videoUrl;
      if (
        video.readyState === HTMLMediaElement.HAVE_NOTHING &&
        video.networkState === HTMLMediaElement.NETWORK_EMPTY
      ) {
        video.load();
      }
      return true;
    }

    function releaseDeferredVideoSource(video) {
      if (!(video instanceof HTMLVideoElement)) return;
      pageSuspendedVideos.delete(video);
      if (video.autoplay) video.autoplay = false;
      if (video.hasAttribute("autoplay")) video.removeAttribute("autoplay");
      if (!video.paused) video.pause();
      if (video.preload !== "none") video.preload = "none";
      if (!video.hasAttribute("src")) return;
      video.removeAttribute("src");
      video.load();
    }

    function homeTvFeedCoveredByProfile() {
      return document.body.classList.contains("profile-full-view-open") ||
        document.body.classList.contains("profile-tv-viewer-open");
    }

    function activateHomeTvFeedVideo(videoId) {
      if (activeTab !== "tv" || !videoId || document.visibilityState === "hidden" || homeTvFeedCoveredByProfile()) return;
      closeHomeTvFeedReportMenus();
      homeTvFeedActiveVideoId = videoId;
      const slides = results.querySelectorAll(".home-tv-feed-slide");
      const incomingIndex = [...slides].findIndex((slide) => String(slide.dataset.videoId || "") === videoId);
      if (incomingIndex < 0) return;
      [...slides].slice(Math.max(0, incomingIndex - 2), incomingIndex + 3).forEach(hydrateHomeTvFeedSlide);
      // A backward swipe visits the incoming card first in DOM order. Stop the
      // outgoing player before any new play request can compete for decoding.
      slides.forEach((slide) => {
        if (String(slide.dataset.videoId || "") === videoId) return;
        const video = slide.querySelector("video");
        if (video && (!video.paused || video.autoplay || video.hasAttribute("autoplay"))) {
          video.autoplay = false;
          video.removeAttribute("autoplay");
          video.pause();
        }
      });
      slides.forEach((slide) => {
        const slideVideoId = String(slide.dataset.videoId || "");
        const video = slide.querySelector("video");
        const isActive = slideVideoId === videoId;
        if (!video) return;
        // Only the incoming and outgoing cards change state during a swipe.
        if (!isActive && slide.getAttribute("aria-current") !== "true") return;
        slide.classList.toggle("is-active", isActive);
        if (isActive) {
          delete slide.dataset.viewportPaused;
          slide.setAttribute("aria-current", "true");
          video.autoplay = true;
          video.setAttribute("autoplay", "");
          video.playsInline = true;
          video.setAttribute("playsinline", "");
          video.setAttribute("webkit-playsinline", "");
          video.muted = homeTvFeedMuted;
          video.defaultMuted = homeTvFeedMuted;
          if (homeTvFeedMuted) video.setAttribute("muted", "");
          attachDeferredVideoSource(video, "auto");
          if (!homeTvFeedImpressions.has(videoId)) {
            homeTvFeedImpressions.add(videoId);
            trackHomeTvFeedEvent(videoId, "impression");
          }
          if (slide.dataset.userPaused === "true") {
            slide.classList.remove("is-autoplay-blocked");
            video.pause();
            slide.classList.add("is-paused");
            return;
          }
          slide.classList.remove("is-autoplay-blocked");
          void video.play().then(() => {
            if (video.paused || slide.dataset.userPaused === "true") return;
            slide.classList.remove("is-paused", "is-autoplay-blocked");
            primeHomeTvFeedNeighbors(videoId);
            scheduleHomeTvFeedEngagedView(videoId, video);
          }).catch((error) => {
            if (
              error?.name === "AbortError" ||
              !slide.classList.contains("is-active") ||
              slide.dataset.userPaused === "true"
            ) return;
            slide.classList.add("is-paused", "is-autoplay-blocked");
          });
        } else {
          slide.removeAttribute("aria-current");
          slide.classList.remove("is-autoplay-blocked");
          clearHomeTvFeedEngagedTimer(slideVideoId);
          slide.classList.add("is-paused");
        }
      });
      primeHomeTvFeedNeighbors(videoId);
      syncHomeTvFeedSoundButtons();
    }

    function primeHomeTvFeedNeighbors(videoId) {
      const slides = [...results.querySelectorAll(".home-tv-feed-slide")];
      const activeIndex = slides.findIndex((slide) => String(slide.dataset.videoId || "") === videoId);
      if (activeIndex < 0) return;
      const activeVideo = slides[activeIndex].querySelector("video.home-tv-feed-video");
      const allowNextWarmup = document.visibilityState !== "hidden" && !homeTvFeedCoveredByProfile() &&
        slides[activeIndex].dataset.viewportInactive !== "true" && canWarmAdjacentVideo();
      const activeReady = activeVideo?.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
      slides.forEach((slide, index) => {
        const video = slide.querySelector("video.home-tv-feed-video");
        if (!video) return;
        const posterUrl = String(video.dataset.posterUrl || "");
        const poster = video.nextElementSibling;
        if (posterUrl && Math.abs(index - activeIndex) <= 2) {
          if (video.getAttribute("poster") !== posterUrl) video.poster = posterUrl;
          if (poster?.getAttribute("src") !== posterUrl) poster?.setAttribute("src", posterUrl);
        } else {
          if (video.hasAttribute("poster")) video.removeAttribute("poster");
          if (poster?.hasAttribute("src")) poster.removeAttribute("src");
        }
        if (index === activeIndex) return;
        const mode = videoBufferMode(index, activeIndex, allowNextWarmup, activeReady, video.hasAttribute("src"));
        applyVideoBufferMode(video, mode);
      });
    }

    function toggleHomeTvFeedPlayback(video) {
      const slide = video.closest(".home-tv-feed-slide");
      const videoId = String(slide?.dataset.videoId || "");
      if (!videoId) return;
      if (video.paused) {
        delete slide.dataset.userPaused;
        showHomeTvFeedPlaybackFeedback(slide, false);
        activateHomeTvFeedVideo(videoId);
        return;
      }
      clearHomeTvFeedEngagedTimer(videoId);
      slide.dataset.userPaused = "true";
      slide.classList.remove("is-autoplay-blocked");
      video.autoplay = false;
      video.removeAttribute("autoplay");
      video.pause();
      slide.classList.add("is-paused");
      showHomeTvFeedPlaybackFeedback(slide, true);
    }

    function showHomeTvFeedPlaybackFeedback(slide, paused) {
      const playback = slide?.querySelector(".home-tv-feed-playback");
      if (!playback) return;
      if (playback.feedbackTimer) window.clearTimeout(playback.feedbackTimer);
      playback.innerHTML = modalVideoPlaybackIcon(paused);
      playback.classList.add("show");
      playback.feedbackTimer = window.setTimeout(() => {
        playback.classList.remove("show");
        playback.feedbackTimer = 0;
      }, 850);
    }

    function homeTvFeedUsesSnapViewport() {
      return homeTvFeedSnapMedia.matches;
    }

    function ensureHomeTvPageScrollIndicator() {
      if (homeTvPageScrollRail?.isConnected && homeTvPageScrollThumb?.isConnected) return;
      homeTvPageScrollRail = document.createElement("div");
      homeTvPageScrollRail.className = "home-tv-page-scroll-rail";
      homeTvPageScrollRail.hidden = true;
      homeTvPageScrollRail.setAttribute("aria-hidden", "true");
      homeTvPageScrollThumb = document.createElement("span");
      homeTvPageScrollThumb.className = "home-tv-page-scroll-thumb";
      homeTvPageScrollRail.appendChild(homeTvPageScrollThumb);
      document.body.appendChild(homeTvPageScrollRail);
      if ("ResizeObserver" in window) {
        homeTvPageScrollResizeObserver = new ResizeObserver(queueHomeTvPageScrollIndicatorSync);
        homeTvPageScrollResizeObserver.observe(document.body);
      }
    }

    function syncHomeTvPageScrollIndicator() {
      if (!document.documentElement.classList.contains("home-tv-page-snap")) {
        if (homeTvPageScrollRail) {
          homeTvPageScrollRail.hidden = true;
          homeTvPageScrollRail.classList.remove("is-scrolling");
        }
        if (homeTvPageScrollIdleTimer) {
          window.clearTimeout(homeTvPageScrollIdleTimer);
          homeTvPageScrollIdleTimer = 0;
        }
        return;
      }
      ensureHomeTvPageScrollIndicator();
      const scroller = document.scrollingElement || document.documentElement;
      const trackHeight = homeTvPageScrollRail.clientHeight;
      const viewportHeight = Math.max(1, document.documentElement.clientHeight || window.innerHeight);
      const scrollHeight = Math.max(viewportHeight, scroller.scrollHeight);
      const maxScroll = Math.max(0, scrollHeight - viewportHeight);
      if (!trackHeight || maxScroll <= 1) {
        homeTvPageScrollRail.hidden = true;
        return;
      }
      const thumbHeight = Math.min(
        trackHeight,
        Math.max(48, Math.round(trackHeight * (viewportHeight / scrollHeight))),
      );
      const progress = Math.min(1, Math.max(0, scroller.scrollTop / maxScroll));
      const thumbOffset = Math.round((trackHeight - thumbHeight) * progress);
      homeTvPageScrollThumb.style.height = `${thumbHeight}px`;
      homeTvPageScrollThumb.style.transform = `translate3d(0, ${thumbOffset}px, 0)`;
      homeTvPageScrollRail.hidden = false;
    }

    function queueHomeTvPageScrollIndicatorSync() {
      if (homeTvPageScrollFrame) return;
      homeTvPageScrollFrame = window.requestAnimationFrame(() => {
        homeTvPageScrollFrame = 0;
        syncHomeTvPageScrollIndicator();
      });
    }

    function markHomeTvPageScrollIndicatorActive() {
      if (!document.documentElement.classList.contains("home-tv-page-snap")) return;
      ensureHomeTvPageScrollIndicator();
      homeTvPageScrollRail.classList.add("is-scrolling");
      if (homeTvPageScrollIdleTimer) window.clearTimeout(homeTvPageScrollIdleTimer);
      homeTvPageScrollIdleTimer = window.setTimeout(() => {
        homeTvPageScrollIdleTimer = 0;
        homeTvPageScrollRail?.classList.remove("is-scrolling");
      }, 700);
      queueHomeTvPageScrollIndicatorSync();
    }

    function syncHomeTvPageSnapState() {
      const shouldSnap = activeTab === "tv" && homeTvFeedUsesSnapViewport();
      document.documentElement.classList.toggle("home-tv-page-snap", shouldSnap);
      if (shouldSnap) ensureHomeTvPageScrollIndicator();
      queueHomeTvPageScrollIndicatorSync();
    }

    function setupHomeTvFeedObserver() {
      homeTvFeedObserver?.disconnect();
      homeTvFeedObserver = null;
      const slides = [...results.querySelectorAll(".home-tv-feed-slide")];
      if (!slides.length) return;
      const initialSlide = homeTvFeedIsImmersive() ? homeTvFeedActiveSlide() : slides[0];
      if (!("IntersectionObserver" in window)) {
        activateHomeTvFeedVideo(String(initialSlide?.dataset.videoId || ""));
        return;
      }
      const fullscreenRoot = homeTvFeedIsImmersive() ? results : null;
      const visibleRatios = new Map();
      homeTvFeedObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          visibleRatios.set(entry.target, entry.isIntersecting ? entry.intersectionRatio : 0);
          entry.target.dataset.viewportInactive = entry.isIntersecting ? "false" : "true";
        });
        const activeSlide = slides.find((slide) => String(slide.dataset.videoId || "") === homeTvFeedActiveVideoId);
        const activeRatio = visibleRatios.get(activeSlide) || 0;
        const visible = [...visibleRatios.entries()].filter(([, ratio]) => ratio > .25)
          .sort((left, right) => right[1] - left[1])[0];
        const visibleVideoId = String(visible?.[0].dataset.videoId || "");
        // Start the incoming card while the swipe is still moving so its native
        // continuation request does not wait until the card is almost settled.
        if (visibleVideoId && (visible[1] >= .5 || activeRatio <= .25)) {
          if (visibleVideoId !== homeTvFeedActiveVideoId || visible[0].dataset.viewportPaused === "true") {
            activateHomeTvFeedVideo(visibleVideoId);
          }
        } else if (activeSlide && activeRatio > .25 &&
            activeSlide.dataset.viewportPaused === "true" && activeSlide.dataset.userPaused !== "true") {
          // The current card may return below the handoff threshold after the
          // initial layout or a scroll toward the header. Resume that same player.
          activateHomeTvFeedVideo(String(activeSlide.dataset.videoId || ""));
        } else if (activeSlide && activeRatio === 0) {
          const video = activeSlide.querySelector("video");
          if (video && activeSlide.dataset.userPaused !== "true") activeSlide.dataset.viewportPaused = "true";
          if (video) {
            video.autoplay = false;
            video.removeAttribute("autoplay");
            video.pause();
            video.preload = "none";
          }
          clearHomeTvFeedEngagedTimer(homeTvFeedActiveVideoId);
          primeHomeTvFeedNeighbors(homeTvFeedActiveVideoId);
        }
      }, {
        root: fullscreenRoot,
        rootMargin: fullscreenRoot ? "0px" : "-72px 0px -88px",
        threshold: [0, .25, .5, .6, .72]
      });
      slides.forEach((slide) => homeTvFeedObserver.observe(slide));
      activateHomeTvFeedVideo(String(initialSlide?.dataset.videoId || ""));
    }