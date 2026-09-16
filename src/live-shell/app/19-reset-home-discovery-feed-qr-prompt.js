

    function resetHomeDiscoveryFeedQrPrompt() {
      if (homeDiscoveryFeedQrPromptTimer) {
        window.clearTimeout(homeDiscoveryFeedQrPromptTimer);
        homeDiscoveryFeedQrPromptTimer = 0;
      }
      homeDiscoveryFeedQrPromptKey = "";
      results.querySelectorAll(".home-discovery-feed-slide.is-qr-prompt-ready").forEach((slide) => {
        slide.classList.remove("is-qr-prompt-ready");
      });
      results.querySelectorAll("[data-feed-qr-prompt]").forEach((prompt) => {
        prompt.setAttribute("aria-hidden", "true");
      });
    }

    function scheduleHomeDiscoveryFeedQrPrompt(slide) {
      const prompt = slide?.querySelector("[data-feed-qr-prompt]");
      const promptKey = prompt
        ? `${homeDiscoveryFeedPositionKey()}::${homeDiscoveryFeedSlideKey(slide)}`
        : "";
      if (
        promptKey &&
        promptKey === homeDiscoveryFeedQrPromptKey &&
        (homeDiscoveryFeedQrPromptTimer || slide.classList.contains("is-qr-prompt-ready"))
      ) {
        return;
      }
      resetHomeDiscoveryFeedQrPrompt();
      if (
        !prompt ||
        !promptKey ||
        !homeDiscoveryFeedOpen ||
        document.visibilityState !== "visible" ||
        homeDiscoveryFeedQrPromptsShown.has(promptKey)
      ) {
        return;
      }
      homeDiscoveryFeedQrPromptKey = promptKey;
      homeDiscoveryFeedQrPromptTimer = window.setTimeout(() => {
        homeDiscoveryFeedQrPromptTimer = 0;
        if (
          !homeDiscoveryFeedOpen ||
          !slide.isConnected ||
          slide.getAttribute("aria-current") !== "true" ||
          document.visibilityState !== "visible"
        ) {
          homeDiscoveryFeedQrPromptKey = "";
          return;
        }
        homeDiscoveryFeedQrPromptsShown.add(promptKey);
        slide.classList.add("is-qr-prompt-ready");
        prompt.setAttribute("aria-hidden", "false");
      }, HOME_DISCOVERY_QR_PROMPT_DELAY_MS);
    }

    function rememberHomeDiscoveryFeedPosition() {
      if (!results.classList.contains("home-discovery-feed")) return;
      const current = results.querySelector('.home-discovery-feed-slide[aria-current="true"]');
      const first = results.querySelector(".home-discovery-feed-slide");
      const itemKey = homeDiscoveryFeedSlideKey(current || first);
      if (!itemKey) return;
      homeDiscoveryFeedPositions.set(homeDiscoveryFeedPositionKey(), itemKey);
    }

    function activateHomeDiscoveryFeedItem(itemKey) {
      if (!homeDiscoveryFeedOpen || !itemKey) return;
      homeDiscoveryFeedPositions.set(homeDiscoveryFeedPositionKey(), itemKey);
      let activeSlide = null;
      results.querySelectorAll(".home-discovery-feed-slide").forEach((slide) => {
        const isActive = homeDiscoveryFeedSlideKey(slide) === itemKey;
        slide.classList.toggle("is-active", isActive);
        if (isActive) {
          activeSlide = slide;
          slide.setAttribute("aria-current", "true");
        }
        else slide.removeAttribute("aria-current");
      });
      scheduleHomeDiscoveryFeedQrPrompt(activeSlide);
      prefetchProfileNavigationFromElement(activeSlide);
    }

    function setupHomeDiscoveryFeedObserver() {
      homeDiscoveryFeedObserver?.disconnect();
      homeDiscoveryFeedObserver = null;
      const slides = [...results.querySelectorAll(".home-discovery-feed-slide")];
      if (!slides.length) return;
      if (!("IntersectionObserver" in window)) {
        activateHomeDiscoveryFeedItem(homeDiscoveryFeedSlideKey(slides[0]));
        return;
      }
      homeDiscoveryFeedObserver = new IntersectionObserver((entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting && entry.intersectionRatio >= .55)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
        if (!visible) return;
        activateHomeDiscoveryFeedItem(homeDiscoveryFeedSlideKey(visible.target));
      }, {
        root: null,
        rootMargin: "-72px 0px -88px",
        threshold: [.35, .55, .75]
      });
      slides.forEach((slide) => homeDiscoveryFeedObserver.observe(slide));
    }

    function deactivateHomeDiscoveryFeed() {
      rememberHomeDiscoveryFeedPosition();
      resetHomeDiscoveryFeedQrPrompt();
      homeDiscoveryFeedObserver?.disconnect();
      homeDiscoveryFeedObserver = null;
      homeDiscoveryFeedRenderKey = "";
      results.classList.remove("home-discovery-feed", "home-venue-discovery-feed", "home-dancer-grid");
      results.removeAttribute("aria-label");
    }

    document.addEventListener("visibilitychange", () => {
      if (!homeDiscoveryFeedOpen) return;
      if (document.visibilityState !== "visible") {
        resetHomeDiscoveryFeedQrPrompt();
        return;
      }
      scheduleHomeDiscoveryFeedQrPrompt(
        results.querySelector('.home-discovery-feed-slide[aria-current="true"]')
      );
    });

    function homeDiscoveryFeedStatus(profile) {
      if (isWorkingTonight(profile)) {
        return {
          className: "is-now",
          label: "Working now"
        };
      }
      if (profile.scheduled) {
        return {
          className: "is-upcoming",
          label: displayPublicShiftTime(profile.time, profile)
        };
      }
      return {
        className: "is-no-shift",
        label: "No upcoming shift posted"
      };
    }

    function homeDancerGridScheduleLabel(profile, city = selectedCity()) {
      city = profileDiscoveryCity(profile, city);
      if (isWorkingTonight(profile, city)) return "Working now";
      if (!profile?.scheduled) return "No upcoming shift posted";

      if (profile.shiftStartsAt) {
        const start = new Date(profile.shiftStartsAt);
        if (!Number.isNaN(start.getTime())) {
          const dateLabel = new Intl.DateTimeFormat("en-US", {
            month: "short",
            day: "numeric",
            timeZone: cityTimeZone(city)
          }).format(start);
          return `Upcoming · ${dateLabel}`;
        }
      }

      const compactDate = compactUpcomingDateLabel(profile, city);
      const match = compactDate.match(/^(\d{1,2})\/(\d{1,2})$/);
      if (match) {
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const monthName = monthNames[Number(match[1]) - 1];
        if (monthName) return `Upcoming · ${monthName} ${Number(match[2])}`;
      }
      return "Upcoming";
    }

    function homeDiscoveryFeedLiveQrData(profile) {
      if (!isWorkingTonight(profile) || !profile.venueId) return null;
      const config = dancerProfileClubDealConfig(profile);
      if (config) {
        return {
          triggerAttribute: `data-club-deal-cta="${encodeDealPass(config)}"`,
          venueName: profile.venue,
          offerCount: profile.activeDeals?.length || 1
        };
      }
      return null;
    }

    function homeDiscoveryFeedLiveQrMarkup(profile, presentation = "action") {
      const state = dancerClubDealState(profile);
      const qr = homeDiscoveryFeedLiveQrData(profile);
      if (!qr) {
        if (presentation === "prompt") return "";
        return `<button class="feed-card-action home-discovery-feed-live-qr is-unavailable" type="button" data-club-deal-state="${state.key}" disabled aria-disabled="true" aria-label="${escapeHtml(state.label)}">${actionButtonLabel("qr", "Free Entry")}</button>`;
      }
      if (presentation === "prompt") {
        const safeVenueName = escapeHtml(qr.venueName || "this club");
        return `
          <button class="home-discovery-feed-qr-prompt" type="button" ${qr.triggerAttribute} data-feed-live-qr data-feed-qr-prompt aria-hidden="true" aria-label="View free entry for ${safeVenueName}">
            ${actionIconMarkup("qr")}
            <span class="home-discovery-feed-qr-prompt-copy">
              <small>Free entry available</small>
              <strong>${safeVenueName}</strong>
            </span>
            <span class="home-discovery-feed-qr-prompt-action">Free Entry</span>
          </button>
        `;
      }
      return `<button class="feed-card-action home-discovery-feed-live-qr" type="button" ${qr.triggerAttribute} data-feed-live-qr aria-label="View free entry">${actionButtonLabel("qr", "Free Entry")}</button>`;
    }

    function homeDancerGridQrMarkup(profile) {
      const state = dancerClubDealState(profile);
      const qr = homeDiscoveryFeedLiveQrData(profile);
      if (!qr || state.key !== "available") {
        const cardLabel = state.key === "available-when-working" ? "Unlocks when working" : state.label;
        return `<button class="feed-card-action home-card-qr-rail-action is-unavailable is-${state.key}" type="button" data-card-action-slot="qr" data-club-deal-state="${state.key}" data-card-qr-label="${escapeOptionValue(cardLabel)}" data-card-qr-message="${escapeOptionValue(state.detail)}" aria-disabled="true" aria-expanded="false" aria-label="Free Entry: ${escapeHtml(cardLabel)}. Tap for details.">${actionButtonLabel("qr", "Free Entry")}</button>`;
      }
      const venueName = escapeHtml(qr.venueName || "this club");
      return `<button class="feed-card-action home-card-qr-rail-action is-available" type="button" ${qr.triggerAttribute} data-card-action-slot="qr" data-club-deal-state="available" data-feed-live-qr aria-label="View free entry for ${venueName}">${actionButtonLabel("qr", "Free Entry")}</button>`;
    }

    function homeVenueDiscoveryQrMarkup(venue) {
      const venueName = escapeHtml(venue?.name || "this club");
      if (venue?.id && venue.activeDeal?.id) {
        const config = {
          deal: venue.activeDeal,
          deals: venue.activeDeals,
          venueId: venue.id,
          venueSlug: venue.slug,
          venueName: venue.name,
          sourceType: "club_page"
        };
        const offerCount = venue.activeDeals?.length || 1;
        return `<button class="feed-card-action home-card-qr-rail-action home-venue-discovery-rail-qr is-available venue-card-primary-action venue-card-deals-action" type="button" data-card-action-slot="qr" data-club-deal-state="available" data-club-deal-cta="${encodeDealPass(config)}" data-feed-venue-qr aria-label="View free entry at ${venueName}">${actionButtonLabel("qr", "Free Entry")}</button>`;
      }
      return `<button class="feed-card-action home-card-qr-rail-action home-venue-discovery-rail-qr is-unavailable venue-card-primary-action venue-card-deals-action" type="button" data-card-action-slot="qr" data-club-deal-state="unavailable" data-card-qr-label="Free entry unavailable" data-card-qr-message="Free entry is currently unavailable at this club. Check back later." aria-expanded="false" aria-label="Check free entry availability at ${venueName}">${actionButtonLabel("qr", "Free Entry")}</button>`;
    }

    function homeVenueDiscoveryFeedSlide(venue, index, total, city) {
      city = venue.city || city;
      const details = venueDetails(venue, city);
      const operatingStatus = venueOperatingStatus(details.hours, city);
      const safeName = escapeHtml(venue.name);
      const venueValue = escapeOptionValue(venue.id || venue.name);
      const initials = venueInitials(venue.name);
      const logoMarkup = venueLogoMarkup(venue, "home-venue-discovery-logo");
      const localProfiles = venueDancers(city, venue.name);
      const workingNow = localProfiles
        .filter((profile) => isWorkingTonight(profile, city))
        .sort((left, right) => shiftStartMinutes(left.time) - shiftStartMinutes(right.time));
      const followsVenue = isFollowingVenue(city, venue.name);
      const locationLabel = `${details.city}${details.state ? `, ${details.state}` : ""}`;
      const hoursMarkup = operatingStatus.hoursLabel
        ? `<span class="home-venue-discovery-hours">${clockIconMarkup()}<span>Hours · ${escapeHtml(operatingStatus.hoursLabel)}</span></span>`
        : "";
      const operatingStatusMarkup = `<span class="home-venue-discovery-operating-status is-${operatingStatus.state}">${escapeHtml(operatingStatus.label)}</span>`;
      const railQrMarkup = homeVenueDiscoveryQrMarkup(venue);
      const lineupMarkup = venueLineupMarkup(venue, city, { mobile: true, profiles: workingNow, eager: index < 2 });
      const directionsMarkup = venueDirectionsMarkup({
        venue,
        className: "home-discovery-feed-directions venue-directions-btn venue-card-secondary-action venue-card-directions-action",
        city
      });
      const rideMarkup = uberRideLinkMarkup({
        venue,
        source: "tonight_feed",
        className: "feed-card-action feed-uber-ride home-venue-discovery-uber venue-card-primary-action venue-card-ride-action"
      });
      const workingLabel = `${workingNow.length} working now`;
      const accessibilityLabel = workingNow.length ? `${safeName}, ${escapeHtml(workingLabel)}` : safeName;
      const visualLabel = logoMarkup
        ? `${safeName} logo`
        : `${safeName} monogram`;
      return `
        <article data-analytics-venue-id="${escapeOptionValue(venue.isDashboardPreview ? "" : venue.id || "")}" data-analytics-source="venue_scroll_card" class="venue home-discovery-feed-slide home-venue-discovery-slide${workingNow.length ? " has-live-lineup" : ""}" data-discovery-key="${venueValue}" aria-label="${accessibilityLabel}">
          <div class="home-venue-discovery-art is-venue-logo-artwork${logoMarkup ? " has-venue-logo" : ""}" role="img" aria-label="${visualLabel}">
            ${logoMarkup || `<span class="home-venue-discovery-monogram">${escapeHtml(initials)}</span>`}
          </div>
          <div class="home-discovery-feed-shade" aria-hidden="true"></div>
          <div class="home-discovery-feed-copy">
            <span class="home-venue-discovery-location">${venueIconMarkup()}<span>${escapeHtml(locationLabel)} · ${escapeHtml(details.distanceLabel)}</span></span>
            <span class="home-venue-discovery-meta">${operatingStatusMarkup}${hoursMarkup}</span>
            <div class="home-venue-discovery-lineup-slot">${lineupMarkup}</div>
          </div>
          <div class="home-venue-discovery-context-actions venue-card-primary-actions${rideMarkup ? " with-uber-ride" : ""}" aria-label="${safeName} primary actions">
            ${railQrMarkup}
            ${rideMarkup}
          </div>
          <div class="home-dancer-grid-action-rail home-venue-discovery-action-rail venue-card-secondary-actions" aria-label="${safeName} secondary actions">
            <button class="feed-card-action home-venue-discovery-profile-action venue-card-secondary-action venue-card-page-action" type="button" data-open-venue-profile="${venueValue}" aria-label="Open ${safeName}'s full club profile" title="View club">${actionButtonLabel("clubProfile", "Club Page")}</button>
            ${directionsMarkup}
            <button class="feed-card-action home-dancer-grid-share venue-card-secondary-action venue-card-share-action" type="button" data-share-venue="${venueValue}" data-share-city="${escapeOptionValue(city)}" aria-label="Share ${safeName}'s club profile" title="Share">${actionButtonLabel("share", "Share")}</button>
            <button class="feed-card-action venue-card-secondary-action venue-card-favorite-action ${followsVenue ? "is-active" : ""}" type="button" data-venue-follow="${venueValue}" data-account-action="venue-follow" aria-label="${followsVenue ? `Unfollow ${safeName}` : `Follow ${safeName}`}" title="${followsVenue ? "Saved" : "Favorite"}" aria-pressed="${followsVenue}">${actionButtonLabel("heart", followsVenue ? "Saved" : "Favorite")}</button>
          </div>
        </article>
      `;
    }

    function homeDancerGridActionsMarkup(profile, city) {
      const safeName = escapeHtml(profile.name);
      const profileValue = escapeOptionValue(profile.name);
      const profileReference = escapeOptionValue(profileReferenceValue(profile));
      const cityValue = escapeOptionValue(city);
      const isFollowed = isFollowingProfile(city, profile.name);
      const isNotified = isNotificationOn(city, profile.name);
      const isGoing = !!goingTonightSavedByProfile[profile.name];
      const isLive = isWorkingTonight(profile, city);
      const canMarkGoing = Boolean(isLive && profile.shiftId);
      const venueName = String(profile.venue || "").trim();
      const venueValue = escapeOptionValue(profile.venueId || venueName);
      const venue = resolveVenueByName(venueName, city);
      const profileActionVisual = actionIconMarkup("profile");
      const venueActionMarkup = venue
        ? `<button class="feed-card-action home-dancer-grid-venue-action" type="button" data-card-venue="${venueValue}" aria-label="Open ${escapeHtml(venueName)} club profile">${actionButtonLabel("venue", "Club")}</button>`
        : "";
      const directionsMarkup = venue
        ? venueDirectionsMarkup({
            venue,
            className: "feed-card-action home-dancer-grid-directions venue-directions-btn",
            city
          })
        : "";
      const rideMarkup = isLive && venue
        ? uberRideLinkMarkup({
            venue,
            source: "tonight_feed",
            className: "feed-card-action feed-uber-ride home-dancer-grid-uber",
            dealConfig: dancerProfileClubDealConfig(profile),
            dancerId: profile.id || "",
            city
          })
        : "";
      const goingMarkup = canMarkGoing
        ? `<button class="feed-card-action ${isGoing ? "is-active" : ""}" type="button" data-feed-action="going" data-profile="${profileValue}" data-shift-state="tonight" aria-pressed="${isGoing}">${homeFeedGoingActionMarkup(profile, isGoing)}</button>`
        : "";
      const contextActions = `${venueActionMarkup}${directionsMarkup}${goingMarkup}${rideMarkup}`;
      return `
        <div class="home-dancer-grid-actions" aria-label="${safeName} actions">
          <div class="home-dancer-grid-action-rail">
            <button class="home-dancer-grid-profile-button" type="button" data-grid-profile-action="${profileReference}" aria-label="Open ${safeName}'s full profile">${profileActionVisual}<span>Profile</span></button>
            ${homeDancerGridQrMarkup(profile)}
            <button class="feed-card-action home-dancer-grid-share" type="button" data-native-share="${profileValue}" data-share-city="${cityValue}" aria-label="Share ${safeName}'s profile">${actionButtonLabel("share", "Share")}</button>
            <button class="feed-card-action ${isFollowed ? "is-active" : ""}" type="button" data-feed-action="follow" data-profile="${profileValue}" aria-pressed="${isFollowed}">${actionButtonLabel(isFollowed ? "check" : "personPlus", isFollowed ? "Following" : "Follow")}</button>
            <button class="feed-card-action ${isNotified ? "is-active" : ""}" type="button" data-feed-action="notify" data-profile="${profileValue}" aria-pressed="${isNotified}">${actionButtonLabel(isNotified ? "check" : "bell", isNotified ? "On" : "Notify")}</button>
          </div>
          ${contextActions ? `<div class="home-dancer-grid-context-actions${rideMarkup ? " with-uber-ride" : ""}">${contextActions}</div>` : ""}
        </div>
      `;
    }

    function homeDancerGridCard(profile, city, compactDirectory = false, imageIndex = 0) {
      const cityMarkup = city === ALL_CITIES && profile.city
        ? `<span class="home-dancer-grid-city">${escapeHtml(profile.city)}</span>`
        : "";
      city = profileDiscoveryCity(profile, city);
      const safeName = escapeHtml(profile.name);
      const profileValue = escapeOptionValue(profile.name);
      const profileReference = escapeOptionValue(profileReferenceValue(profile));
      const profileHref = profile.slug ? `/dancers/${encodeURIComponent(profile.slug)}` : `#profile-${slugify(profile.name)}`;
      const photoUrl = publicProfilePhotoUrl(profile);
      const photoSrcSet = publicProfilePhotoSrcSet(profile);
      const photoAttrs = customPhotoAttrs(photoUrl, photoSrcSet);
      const nativePhotoAttrs = nativeResponsivePhotoAttrs(photoUrl, photoSrcSet);
      // Start every photo in the rendered directory together. Rows below the
      // first six cards must not wait for scrolling or run at low priority.
      const imageLoading = "eager";
      const imageFetchPriority = imageIndex < 3 ? "high" : "auto";
      const photoMarkup = photoUrl
        ? compactDirectory && nativePhotoAttrs
          ? `<img class="home-dancer-grid-photo has-custom-photo" ${nativePhotoAttrs} sizes="(max-width: 720px) calc((100vw - 20px) / 3), (max-width: 1280px) calc((100vw - 64px) / 3), 390px" width="360" height="640" loading="${imageLoading}" fetchpriority="${imageFetchPriority}" decoding="async" draggable="false" alt="" aria-hidden="true" data-image-state="loading">`
          : `<div class="home-dancer-grid-photo${photoAttrs.className}"${photoAttrs.style}></div>`
        : `<div class="home-dancer-grid-photo" aria-hidden="true">${escapeHtml(String(profile.name).trim().charAt(0))}</div>`;
      const venueName = String(profile.venue || "").trim();
      const hasPublishedVenue = Boolean(
        profile.scheduled &&
        venueName &&
        venueName.toLowerCase() !== "venue pending"
      );
      const distanceLabel = profileCardDistanceLabel(profile);
      const status = homeDiscoveryFeedStatus(profile);
      const scheduleLabel = homeDancerGridScheduleLabel(profile, city);
      const venueMarkup = hasPublishedVenue
        ? `<span class="home-dancer-grid-venue">${venueIconMarkup()}<span>${escapeHtml(venueName)}${distanceLabel ? ` &middot; ${escapeHtml(distanceLabel)}` : ""}</span></span>`
        : "";
      const groupClass = status.className === "is-now"
        ? "is-now"
        : status.className === "is-upcoming"
          ? "is-upcoming"
          : "is-open";
      return `
        <article class="dancer-card home-dancer-grid-card ${groupClass}${compactDirectory ? " is-compact-directory" : ""}" data-profile="${profileValue}" data-profile-reference="${profileReference}" data-grid-group="${groupClass}" aria-label="${safeName}, ${escapeHtml(scheduleLabel)}">
          <a class="home-dancer-grid-link" href="${profileHref}" aria-label="Open ${safeName}'s full profile">
            ${photoMarkup}
            <span class="home-dancer-grid-copy">
              <h3 class="home-dancer-grid-name">${safeName}</h3>
              ${cityMarkup}
              ${venueMarkup}
              <span class="home-dancer-grid-status ${status.className}">${escapeHtml(scheduleLabel)}</span>
            </span>
          </a>
          ${compactDirectory ? "" : homeDancerGridActionsMarkup(profile, city)}
        </article>
      `;
    }

    function homeDancerGridSectionMarkup(label, className, profiles, city, compactDirectory = false, startIndex = 0, showEmpty = false) {
      if (!profiles.length && !showEmpty) return "";
      return `
        <div class="home-dancer-grid-heading ${className}" role="heading" aria-level="3">
          <strong>${label}</strong>
          <span>${profiles.length}</span>
        </div>
        ${profiles.map((profile, index) => homeDancerGridCard(profile, city, compactDirectory, startIndex + index)).join("")}
      `;
    }

    function dancerDirectoryFilterMarkup(profiles, city) {
      const counts = {
        all: profiles.length,
        now: profiles.filter((profile) => isWorkingTonight(profile, city)).length,
        upcoming: profiles.filter((profile) => profile.scheduled && !isWorkingTonight(profile, city)).length
      };
      const filters = [
        { id: "all", label: "All" },
        { id: "now", label: "Now" },
        { id: "upcoming", label: "Upcoming" }
      ];
      return `
        <div class="dancer-directory-filters" role="tablist" aria-label="Filter dancers">
          ${filters.map((filter) => {
            const active = dancerDirectoryFilter === filter.id;
            const empty = counts[filter.id] === 0;
            const statusDot = filter.id === "now" || filter.id === "upcoming"
              ? '<span class="dancer-directory-filter-status" aria-hidden="true"></span>'
              : "";
            return `<button class="dancer-directory-filter ${active ? "is-active" : ""}${empty ? " is-empty" : ""}" type="button" role="tab" data-dancer-directory-filter="${filter.id}" aria-controls="results" aria-selected="${active}" aria-pressed="${active}">${statusDot}<span class="dancer-directory-filter-label">${filter.label}</span><span class="dancer-directory-filter-count">${counts[filter.id]}</span></button>`;
          }).join("")}
        </div>
      `;
    }

    function dancerDirectorySections(profiles, city) {
      const groups = dancerDirectoryGroups(profiles, city);
      if (dancerDirectoryFilter === "now") {
        return [{ label: "Working Now", className: "is-now", profiles: groups.workingNow }];
      }
      if (dancerDirectoryFilter === "upcoming") {
        return [{
          label: "Upcoming",
          className: "is-upcoming",
          profiles: profiles
            .filter((profile) => profile.scheduled && !isWorkingTonight(profile, city))
            .sort((a, b) => (
              upcomingSortValue(a, city) - upcomingSortValue(b, city) ||
              dailyRotationScore(a, city) - dailyRotationScore(b, city)
            ))
        }];
      }
      return [
        { label: "Working Now", className: "is-now", profiles: groups.workingNow },
        { label: "Upcoming", className: "is-upcoming", profiles: groups.upcoming },
        { label: "No Schedule", className: "is-open", profiles: groups.noSchedule }
      ];
    }

    function homeDancerGridContentKey(city, markup) {
      return JSON.stringify({
        city,
        filter: dancerDirectoryFilter,
        venueFilter: selectedVenueFilter(),
        markup
      });
    }

    function revealDancerGridRows(grid) {
      const rows = [];
      let row = null;
      // This directory has three columns at every width. Section headings start
      // a fresh row, including when the preceding section has only one or two cards.
      for (const card of grid.children) {
        if (!card.matches(".home-dancer-grid-card")) {
          row = null;
          continue;
        }
        if (!row || row.cards.length === 3) {
          row = { cards: [], photos: [], decoding: false, ready: false };
          rows.push(row);
        }
        row.cards.push(card);
        row.photos.push(...card.querySelectorAll(".home-dancer-grid-photo[data-image-state]"));
        card.setAttribute("data-row-loading", "true");
        card.setAttribute("aria-busy", "true");
      }
      if (!rows.length) return;
      const firstCard = rows[0].cards[0];
      const observer = new MutationObserver(check);

      function check() {
        // Old image completions must never reveal a newer filter's cards.
        if (firstCard.parentNode !== grid) {
          observer.disconnect();
          return;
        }
        for (const row of rows) {
          if (row.ready || row.decoding || row.photos.some((photo) => !["ready", "error"].includes(photo.dataset.imageState))) continue;
          row.decoding = true;
          Promise.allSettled(row.photos.filter((photo) => photo.dataset.imageState === "ready").map((photo) => photo.decode()))
            .then(() => {
              if (firstCard.parentNode !== grid) return;
              // Reveal this row in one paint without waiting on other rows.
              row.cards.forEach((card) => {
                card.removeAttribute("data-row-loading");
                card.removeAttribute("aria-busy");
              });
              row.ready = true;
              homeTvLandingPreload.schedule();
              if (rows.every((item) => item.ready)) observer.disconnect();
            });
        }
      }

      observer.observe(grid, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-image-state"] });
      settleCompletedStableImages(grid);
      check();
    }

    function renderHomeDancerGrid(city, profiles) {
      const sections = dancerDirectorySections(profiles, city);
      const visibleCount = sections.reduce((total, section) => total + section.profiles.length, 0);
      const locationPhrase = discoveryLocationPhrase(city);
      let imageOffset = 0;
      const sectionMarkup = sections.map((section) => {
        const markup = homeDancerGridSectionMarkup(
          section.label,
          section.className,
          section.profiles,
          city,
          true,
          imageOffset,
          dancerDirectoryFilter !== "all"
        );
        imageOffset += section.profiles.length;
        return markup;
      }).join("");
      const emptyLabels = {
        now: `No dancers are working now ${locationPhrase}.`,
        upcoming: `No dancers have an upcoming shift ${locationPhrase}.`
      };
      results.classList.add("card-grid", "home-dancer-grid");
      results.classList.add("home-dancer-three-column");
      results.classList.toggle("home-dancer-filtered-view", dancerDirectoryFilter !== "all");
      results.setAttribute("aria-label", `Approved dancers ${locationPhrase}, grouped by live status and schedule`);
      const gridMarkup = `
        ${dancerDirectoryFilterMarkup(profiles, city)}
        ${sectionMarkup}
        ${visibleCount ? "" : `<div class="dancer-directory-filter-empty">${escapeHtml(emptyLabels[dancerDirectoryFilter] || `No approved dancer profiles are available ${locationPhrase} yet.`)}</div>`}
      `;
      const nextRenderKey = homeDancerGridContentKey(city, gridMarkup);
      if (
        homeDancerGridRenderKey === nextRenderKey &&
        results.querySelector(":scope > .dancer-directory-filters")
      ) {
        return;
      }
      homeDancerGridRenderKey = nextRenderKey;
      results.innerHTML = gridMarkup;
      revealDancerGridRows(results);
      window.requestAnimationFrame(() => {
        prefetchProfileNavigationFromElement(results.querySelector(".home-dancer-grid-card"));
      });
    }

    function homeDiscoveryFeedSlide(profile, index, total, tab) {
      const city = citySelect.value;
      const safeName = escapeHtml(profile.name);
      const profileValue = escapeOptionValue(profile.name);
      const profileReference = escapeOptionValue(profileReferenceValue(profile));
      const venueName = String(profile.venue || "").trim();
      const safeVenueName = escapeHtml(venueName);
      const venueValue = escapeOptionValue(profile.venueId || venueName);
      const profileHref = profile.slug ? `/dancers/${encodeURIComponent(profile.slug)}` : `#profile-${slugify(profile.name)}`;
      const profilePhotoUrl = publicProfilePhotoUrl(profile);
      const portraitPhotoAttrs = customPhotoAttrs(
        profilePhotoUrl,
        publicProfilePhotoSrcSet(profile)
      );
      const portraitMarkup = profilePhotoUrl
        ? `<div class="portrait home-discovery-feed-photo ${portraitClass(index)}${portraitPhotoAttrs.className}"${portraitPhotoAttrs.style}></div>`
        : `<div class="home-discovery-feed-photo is-photo-unavailable" aria-hidden="true">${escapeHtml(String(profile.name).trim().charAt(0))}</div>`;
      const status = homeDiscoveryFeedStatus(profile);
      const locationBadge = profileLocationStatusBadge(profile);
      const distanceLabel = profileCardDistanceLabel(profile);
      const isLive = isWorkingTonight(profile);
      const isFollowed = isFollowingProfile(city, profile.name);
      const isNotified = isNotificationOn(city, profile.name);
      const isGoing = !!goingTonightSavedByProfile[profile.name];
      const canMarkGoing = Boolean(isLive && profile.shiftId);
      const venue = resolveVenueByName(venueName, city);
      const directionsMarkup = tab === "tonight" && venue
        ? venueDirectionsMarkup({
            venue,
            className: "home-discovery-feed-directions venue-directions-btn",
            city
          })
        : "";
      const goingMarkup = canMarkGoing
        ? `<button class="feed-card-action ${isGoing ? "is-active" : ""}" type="button" data-feed-action="going" data-profile="${profileValue}" data-shift-state="tonight" aria-pressed="${isGoing}">${actionButtonLabel(isGoing ? "check" : "clock", isGoing ? "Going" : "I'm Going")}</button>`
        : "";
      const liveQrMarkup = homeDiscoveryFeedLiveQrMarkup(profile);
      const liveQrPromptMarkup = homeDiscoveryFeedLiveQrMarkup(profile, "prompt");
      const venueMarkup = venueName
        ? `<button class="home-discovery-feed-venue" type="button" data-card-venue="${venueValue}" aria-label="Open ${safeVenueName} club page">${venueIconMarkup()}<span class="home-discovery-feed-venue-label">${safeVenueName}${distanceLabel ? ` · ${escapeHtml(distanceLabel)}` : ""}</span></button>`
        : "";
      const goingCountMarkup = isLive
        ? `<span class="home-discovery-feed-going-count">${tonightInterestCount(profile).toLocaleString()} going</span>`
        : "";
      return `
        <article class="dancer-card home-discovery-feed-slide" data-discovery-key="${profileReference}" data-profile="${profileValue}" data-profile-reference="${profileReference}" aria-label="${safeName}, ${escapeHtml(status.label)}">
          ${portraitMarkup}
          <div class="home-discovery-feed-shade" aria-hidden="true"></div>
          <a class="home-discovery-feed-open-profile" href="${profileHref}" aria-label="Open ${safeName}'s full profile"></a>
          <span class="home-discovery-feed-position">${index + 1} / ${total}</span>
          <div class="home-discovery-feed-copy">
            <h3 class="home-discovery-feed-name">${safeName}</h3>
            ${locationBadge}
            ${venueMarkup}
            <span class="home-discovery-feed-status ${status.className}">${escapeHtml(status.label)}</span>
            ${goingCountMarkup}
            ${liveQrPromptMarkup}
          </div>
          <div class="home-discovery-feed-actions" aria-label="${safeName} actions">
            ${liveQrMarkup}
            <button class="home-discovery-feed-profile-button" type="button" data-profile="${profileValue}" aria-label="Open ${safeName}'s full profile">${actionButtonLabel("star", "Profile")}</button>
            <button class="feed-card-action ${isFollowed ? "is-active" : ""}" type="button" data-feed-action="follow" data-profile="${profileValue}" aria-pressed="${isFollowed}">${actionButtonLabel(isFollowed ? "check" : "personPlus", isFollowed ? "Following" : "Follow")}</button>
            <button class="feed-card-action ${isNotified ? "is-active" : ""}" type="button" data-feed-action="notify" data-profile="${profileValue}" aria-pressed="${isNotified}">${actionButtonLabel(isNotified ? "check" : "bell", isNotified ? "On" : "Notify")}</button>
            ${goingMarkup}
            ${directionsMarkup}
          </div>
        </article>
      `;
    }

    function renderHomeDiscoveryFeedMessage(message) {
      homeDiscoveryFeedRenderKey = "";
      results.innerHTML = `
        <div class="locked">${escapeHtml(message)}</div>
      `;
    }

    function homeDiscoveryLoadingStateMarkup(city, tabName = activeTab) {
      const safeCity = escapeHtml(city);
      const loadingLabel = tabName === "venues"
        ? `Loading clubs in ${safeCity}`
        : tabName === "tonight"
          ? `Loading who is working in ${safeCity}`
          : `Loading dancers in ${safeCity}`;
      const presentation = tabName === "venues" ? "is-venues" : "is-dancers";
      const cardCount = tabName === "venues" ? 1 : 3;
      const cards = Array.from({ length: cardCount }, () => `
        <span class="home-discovery-loading-card" aria-hidden="true">
          <span class="home-discovery-loading-copy"><span></span><span></span><span></span></span>
        </span>
      `).join("");
      return `
        <section class="home-discovery-loading ${presentation}" role="status" aria-label="${loadingLabel}" aria-live="polite" aria-busy="true">
          ${cards}
        </section>
      `;
    }

    function nextHomeDiscoveryRadiusOption() {
      if (!distanceSelect) return null;
      const currentRadius = selectedRadiusMiles();
      return [...distanceSelect.options]
        .map((option) => ({ option, miles: Number.parseFloat(option.value) }))
        .filter(({ miles }) => Number.isFinite(miles) && miles > currentRadius)
        .sort((left, right) => left.miles - right.miles)[0]?.option || null;
    }

    function homeClubEmptyStateMarkup(city) {
      if (userLocationOutsideMarkets) {
        return `
          <section class="home-discovery-empty is-club-empty" aria-labelledby="homeClubsEmptyTitle">
            <span class="home-discovery-empty-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M5 20V7l7-3 7 3v13"></path><path d="M3 20h18"></path><path d="M9 10h6M9 14h6"></path></svg>
            </span>
            <div class="home-discovery-empty-copy">
              <strong id="homeClubsEmptyTitle">No MyDancr clubs near you</strong>
              <p>MyDancr is not in your area yet. Choose a city to browse its dancers and clubs.</p>
            </div>
            <div class="home-discovery-empty-actions"><button class="home-discovery-empty-action is-secondary" type="button" data-home-empty-action="choose-city">Choose another city</button></div>
          </section>
        `;
      }
      const safeCity = escapeHtml(city);
      const publicClubs = (discoveryMarket(city)?.venues || []).filter((venue) => !venue?.hidden);
      const hasPublicClubs = publicClubs.length > 0;
      const selectedClub = selectedVenueFilter();
      const nextRadius = nextHomeDiscoveryRadiusOption();
      const hasExplicitFilters = selectedClub !== "all" || selectedRadiusMiles() !== 25;
      const title = hasPublicClubs ? "No clubs match these filters" : `No clubs in ${safeCity} yet`;
      const description = hasPublicClubs
        ? `Expand your search radius or clear the current filters to see more club profiles near ${safeCity}.`
        : `MyDancr is adding club profiles in ${safeCity}. Choose another city or check back soon.`;
      const actions = hasPublicClubs
        ? [
            nextRadius
              ? `<button class="home-discovery-empty-action" type="button" data-home-empty-action="expand-radius" data-radius-value="${escapeOptionValue(nextRadius.value)}">Expand radius</button>`
              : "",
            hasExplicitFilters
              ? '<button class="home-discovery-empty-action is-secondary" type="button" data-home-empty-action="clear-filters">Clear filters</button>'
              : "",
            '<button class="home-discovery-empty-action is-secondary" type="button" data-home-empty-action="choose-city">Choose another city</button>'
          ]
        : [
            '<button class="home-discovery-empty-action is-secondary" type="button" data-home-empty-action="choose-city">Choose another city</button>'
          ];

      return `
        <section class="home-discovery-empty is-club-empty" aria-labelledby="homeClubsEmptyTitle">
          <span class="home-discovery-empty-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M5 20V7l7-3 7 3v13"></path><path d="M3 20h18"></path><path d="M9 10h6M9 14h6"></path></svg>
          </span>
          <div class="home-discovery-empty-copy">
            <strong id="homeClubsEmptyTitle">${title}</strong>
            <p>${description}</p>
          </div>
          <div class="home-discovery-empty-actions">${actions.filter(Boolean).join("")}</div>
        </section>
      `;
    }

    function homeDiscoveryFeedContentKey(city, items) {
      return JSON.stringify({
        city,
        tab: activeTab,
        venueFilter: selectedVenueFilter(),
        items,
        venueDancers: activeTab === "venues" ? discoveryMarket(city)?.dancers || [] : [],
        followedProfiles: followedByCity[city] || [],
        followedVenues: followedVenuesByCity[city] || [],
        notifications: notifiedByCity[city] || [],
        going: goingTonightSavedByProfile
      });
    }

    function renderHomeDiscoveryFeed(city, items, options = {}) {
      rememberHomeDiscoveryFeedPosition();
      results.classList.remove("card-grid", "home-dancer-grid", "venue-card-grid");
      results.classList.add("home-discovery-feed");
      const isVenueFeed = activeTab === "venues";
      results.classList.toggle("home-venue-discovery-feed", isVenueFeed);
      const discoveryLabel = activeTab === "tonight"
        ? "dancers working now"
        : isVenueFeed
          ? "club profiles"
          : "dancer profiles";
      const locationPhrase = discoveryLocationPhrase(city);
      results.setAttribute("aria-label", `Scroll through ${discoveryLabel} ${locationPhrase}`);
      viewAllBtn.hidden = true;

      if (options.loading && !items.length) {
        homeDiscoveryFeedRenderKey = "";
        results.innerHTML = homeDiscoveryLoadingStateMarkup(city, activeTab);
        return;
      }
      if (!items.length) {
        if (activeTab === "venues") {
          homeDiscoveryFeedRenderKey = "";
          results.innerHTML = homeClubEmptyStateMarkup(city);
          return;
        }
        renderHomeDiscoveryFeedMessage(
          activeTab === "tonight"
            ? `No dancers are working now ${locationPhrase}.`
            : `No approved dancer profiles are available ${locationPhrase} yet.`
        );
        return;
      }

      const positionKey = homeDiscoveryFeedPositionKey(city, activeTab);
      const storedItem = homeDiscoveryFeedPositions.get(positionKey) || "";
      const restoreIndex = Math.max(0, items.findIndex((item) => item.name === storedItem));
      const nextRenderKey = homeDiscoveryFeedContentKey(city, items);
      if (
        homeDiscoveryFeedRenderKey === nextRenderKey &&
        results.querySelector(".home-discovery-feed-slide")
      ) {
        return;
      }
      homeDiscoveryFeedRenderKey = nextRenderKey;
      results.innerHTML = `
        ${items.map((item, index) => (
          activeTab === "venues"
            ? homeVenueDiscoveryFeedSlide(item, index, items.length, city)
            : homeDiscoveryFeedSlide(item, index, items.length, activeTab)
        )).join("")}
      `;
      window.requestAnimationFrame(() => {
        const restoredItem = items[restoreIndex]?.name || items[0].name;
        activateHomeDiscoveryFeedItem(restoredItem);
        setupHomeDiscoveryFeedObserver();
      });
    }

    let homeResultsFocusFrame = 0;
    let homeResultsFocusTimer = 0;
    let homeResultsFocusRun = 0;
    let homeResultsSmoothLandingPending = false;
    let homeDestinationTransitionTimer = 0;

    function homeResultsDocumentTop(element) {
      let top = 0;
      let node = element;
      while (node) {
        top += Number(node.offsetTop) || 0;
        node = node.offsetParent;
      }
      return top;
    }

    function alignHomeResultsTitle(behavior = "auto") {
      const destinationStart = tabTitle?.closest(".content-head") || tabTitle || results;
      if (!destinationStart.isConnected) return;
      const stickyTop = Number.parseFloat(window.getComputedStyle(destinationStart).top);
      const landingTop = Number.isFinite(stickyTop) ? stickyTop : 0;
      const targetTop = Math.max(0, homeResultsDocumentTop(destinationStart) - landingTop);
      window.scrollTo({ top: targetTop, left: 0, behavior });
    }

    function clearHomeDestinationTransition() {
      if (homeDestinationTransitionTimer) {
        window.clearTimeout(homeDestinationTransitionTimer);
        homeDestinationTransitionTimer = 0;
      }
      document.body.classList.remove("home-destination-transitioning");
      document.body.style.removeProperty("--home-destination-enter-offset");
    }

    function startHomeDestinationTransition(direction) {
      clearHomeDestinationTransition();
      if (
        window.innerWidth > 720 ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) return;
      const offset = direction === 0 ? 0 : direction > 0 ? 12 : -12;
      document.body.style.setProperty("--home-destination-enter-offset", `${offset}px`);
      void results.offsetWidth;
      document.body.classList.add("home-destination-transitioning");
      homeDestinationTransitionTimer = window.setTimeout(clearHomeDestinationTransition, 240);
    }

    function cancelHomeResultsFocus({ releaseTvLanding = false } = {}) {
      if (homeResultsFocusFrame) {
        window.cancelAnimationFrame(homeResultsFocusFrame);
        homeResultsFocusFrame = 0;
      }
      if (homeResultsFocusTimer) {
        window.clearTimeout(homeResultsFocusTimer);
        homeResultsFocusTimer = 0;
      }
      homeResultsFocusRun += 1;
      if (releaseTvLanding) homeTvFeedLandingPending = false;
    }

    function focusHomeResults() {
      cancelHomeResultsFocus();
      const focusRun = homeResultsFocusRun;
      const smoothLanding =
        homeResultsSmoothLandingPending &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      homeResultsSmoothLandingPending = false;
      if (smoothLanding) {
        alignHomeResultsTitle("smooth");
        homeResultsFocusTimer = window.setTimeout(() => {
          if (focusRun !== homeResultsFocusRun) return;
          homeResultsFocusTimer = 0;
          alignHomeResultsTitle("auto");
          homeResultsFocusFrame = window.requestAnimationFrame(() => {
            if (focusRun !== homeResultsFocusRun) return;
            homeResultsFocusFrame = 0;
            alignHomeResultsTitle("auto");
          });
        }, 240);
        return;
      }
      const settle = (remainingFrames) => {
        if (focusRun !== homeResultsFocusRun) return;
        alignHomeResultsTitle();
        if (remainingFrames > 0) {
          homeResultsFocusFrame = window.requestAnimationFrame(() => settle(remainingFrames - 1));
          return;
        }
        homeResultsFocusFrame = 0;
        homeResultsFocusTimer = window.setTimeout(() => {
          if (focusRun !== homeResultsFocusRun) return;
          homeResultsFocusTimer = 0;
          alignHomeResultsTitle();
        }, 160);
      };
      settle(2);
    }

    function settleHomeTvFeedLanding({ complete = false } = {}) {
      if (!homeTvFeedLandingPending) return;
      focusHomeResults();
      if (complete) homeTvFeedLandingPending = false;
    }

    const homeResultsScrollIntentKeys = new Set([
      "ArrowUp",
      "ArrowDown",
      "PageUp",
      "PageDown",
      "Home",
      "End",
      " ",
      "Spacebar"
    ]);

    function releaseHomeResultsLandingForUser(event) {
      if (event.type === "keydown" && !homeResultsScrollIntentKeys.has(event.key)) return;
      cancelHomeResultsFocus({ releaseTvLanding: true });
    }

    function handleHomeDiscoveryFeedViewportChange() {
      const shouldUseInlineLayout =
        activeTab === "venues" &&
        homeDiscoveryFeedUsesInlineLayout();
      if (homeDiscoveryFeedOpen === shouldUseInlineLayout) return;
      homeDiscoveryFeedOpen = shouldUseInlineLayout;
      deactivateHomeDiscoveryFeed();
      render();
      if (shouldUseInlineLayout) focusHomeResults();
    }