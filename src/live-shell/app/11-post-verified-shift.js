

    function postVerifiedShift() {
      openUnifiedDashboard("dancer", "dancer-schedule");
    }

    function venueDetails(venue, city) {
      const venueCity = venue.city || city;
      const state = venue.state || stateByCity[venueCity] || "";
      return {
        ...venue,
        city: venueCity,
        state,
        distanceLabel: venueDistanceLabel(venue, city),
        address: venue.address || "",
        hours: venue.hours || ""
      };
    }

    function venueOperatingStatus(hours, city = selectedCity(), now = new Date()) {
      const hoursLabel = displayShiftTime(hours);
      const parts = String(hours || "").split(/\s*(?:-|–|—|\bto\b)\s*/i);
      if (!hoursLabel || parts.length !== 2) {
        return {
          state: "unknown",
          label: "Hours unavailable",
          hoursLabel: ""
        };
      }
      const start = parseClockMinutes(parts[0]);
      let end = parseClockMinutes(parts[1]);
      if (start === null || end === null) {
        return {
          state: "unknown",
          label: "Hours unavailable",
          hoursLabel: ""
        };
      }
      const cityNow = cityWallClock(now, city);
      let currentMinutes = (cityNow.getUTCHours() * 60) + cityNow.getUTCMinutes();
      if (end <= start) {
        end += 1440;
        if (currentMinutes <= end - 1440) currentMinutes += 1440;
      }
      const isOpen = currentMinutes >= start && currentMinutes < end;
      return {
        state: isOpen ? "open" : "closed",
        label: isOpen ? "Open now" : "Closed",
        hoursLabel
      };
    }

    function profileCard(profile, index, options = {}) {
      const isPending = profile.status === "Pending";
      const isTrending = !isPending && profile.trendRank;
      const statusBadge = isPending ? '<span class="badge pending">Pending</span>' : "";
      const trendBadge = "";
      const trendMarker = isTrending
        ? `<span class="card-trend-marker" aria-label="Trending rank ${escapeHtml(profile.trendRank)}"><span class="card-trend-symbol" aria-hidden="true">↗</span><span>#${escapeHtml(profile.trendRank)}</span></span>`
        : "";
      const upcomingLabel = upcomingCardLabel(profile);
      const workingTonight = isWorkingTonight(profile);
      const locationBadge = !isPending ? profileLocationStatusBadge(profile) : "";
      const distanceLabel = profileCardDistanceLabel(profile);
      const scheduleMarkup = isPending
        ? '<div class="pill-row"><span class="pill muted">Schedule locked</span></div>'
        : workingTonight
          ? `<div class="schedule-row is-tonight">${clockIconMarkup()}<span class="card-schedule-text tonight"><span class="schedule-time">${escapeHtml(displayPublicShiftTime(profile.time, profile))}</span></span></div>`
          : profile.scheduled
            ? `<div class="schedule-row is-upcoming">${clockIconMarkup()}<span class="card-schedule-text upcoming"><span class="schedule-time">${escapeHtml(displayPublicShiftTime(profile.time, profile))}</span></span></div>`
            : '<div class="meta no-shifts no-shifts-state"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4M16 2v4M3.5 9h17M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"/></svg><span>No schedule posted</span></div>';
      const clubMarkup = !isPending && profile.scheduled
        ? `<div class="meta card-venue-line ${workingTonight ? "is-tonight" : "is-upcoming"}">${venueIconMarkup()}<span class="card-venue-name card-venue-link" role="link" tabindex="0" data-card-venue="${escapeHtml(profile.venue)}" aria-label="Open ${escapeHtml(profile.venue)} club page">${escapeHtml(profile.venue)}</span>${distanceLabel ? `<span class="card-distance">• ${escapeHtml(distanceLabel)}</span>` : ""}</div>`
        : "";
      const portraitPhotoUrl = isPending ? customPhotoUrl(profile, 0) : publicProfilePhotoUrl(profile);
      const portraitPhotoAttrs = customPhotoAttrs(
        portraitPhotoUrl,
        isPending ? "" : profilePhotoSrcSet(profile, portraitPhotoUrl)
      );
      const profileHref = profile.slug ? `/dancers/${encodeURIComponent(profile.slug)}` : `#profile-${slugify(profile.name)}`;
      const profileCardBody = `
        <div class="portrait ${portraitClass(index)}${portraitPhotoAttrs.className}"${portraitPhotoAttrs.style}>
          <div class="card-badges">
            ${statusBadge}
            ${trendBadge}
            ${trendMarker}
          </div>
          ${options.feedActions && !isPending ? `<span class="card-profile-destination" aria-hidden="true"><svg class="card-profile-symbol" viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="15" height="15" rx="3"></rect><circle cx="11" cy="9.5" r="2.25"></circle><path d="M7.25 16c.35-2.15 1.65-3.35 3.75-3.35s3.4 1.2 3.75 3.35"></path></svg><svg class="card-profile-chevron" viewBox="0 0 12 20"><path d="m3 3 6 7-6 7"></path></svg></span>` : ""}
        </div>
        <div class="profile-body">
          <div class="card-info-stack">
            <h3><span class="card-stage-name">${escapeHtml(profile.name)}</span></h3>
            ${locationBadge}
            ${clubMarkup}
          </div>
          ${scheduleMarkup}
        </div>
      `;
      if (options.feedActions && !isPending) {
        const isFollowed = isFollowingProfile(citySelect.value, profile.name);
        const isNotified = isNotificationOn(citySelect.value, profile.name);
        const isGoing = !!goingTonightSavedByProfile[profile.name];
        const canMarkGoing = Boolean(workingTonight && profile.shiftId);
        const goingActionMarkup = canMarkGoing
          ? `<button class="feed-card-action ${isGoing ? "is-active" : ""}" type="button" data-feed-action="going" data-profile="${escapeHtml(profile.name)}" data-shift-state="tonight" aria-pressed="${isGoing}">${homeFeedGoingActionMarkup(profile, isGoing)}</button>`
          : "";
        return `
          <article data-public-dancer-id="${escapeOptionValue(profile.id || "")}" class="card dancer-card home-feed-card ${isTrending ? "trending-card" : ""} ${profile.trendRank === 1 ? "rank-one-card" : ""}" data-profile="${escapeHtml(profile.name)}">
            <a class="dancer-card-link" href="${escapeHtml(profileHref)}" aria-label="Open ${escapeHtml(profile.name)} profile">
              ${profileCardBody}
            </a>
            <div class="feed-card-actions${canMarkGoing ? "" : " without-going"}" aria-label="${escapeHtml(profile.name)} actions">
              <button class="feed-card-action ${isFollowed ? "is-active" : ""}" type="button" data-feed-action="follow" data-profile="${escapeHtml(profile.name)}" aria-pressed="${isFollowed}">${actionButtonLabel(isFollowed ? "check" : "personPlus", isFollowed ? "Following" : "Follow")}</button>
              <button class="feed-card-action ${isNotified ? "is-active" : ""}" type="button" data-feed-action="notify" data-profile="${escapeHtml(profile.name)}" aria-pressed="${isNotified}">${actionButtonLabel(isNotified ? "check" : "bell", isNotified ? "Notifications On" : "Notify")}</button>
              ${goingActionMarkup}
            </div>
          </article>
        `;
      }
      return `
        <a data-public-dancer-id="${escapeOptionValue(isPending ? "" : profile.id || "")}" class="card dancer-card ${isPending ? "pending" : ""} ${isTrending ? "trending-card" : ""} ${profile.trendRank === 1 ? "rank-one-card" : ""}" href="${escapeHtml(profileHref)}" data-profile="${escapeHtml(profile.name)}" aria-label="${escapeHtml(profile.name)} profile">
          ${profileCardBody}
        </a>
      `;
    }

    function venueInitials(name) {
      return String(name || "")
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part.charAt(0))
        .join("")
        .toUpperCase();
    }

    function venueAccent(name) {
      const palette = ["#7eeaff", "#c4b5fd", "#f0abfc", "#86efac", "#fda4af"];
      const index = [...String(name || "")]
        .reduce((totalValue, character) => totalValue + character.charCodeAt(0), 0);
      return palette[index % palette.length];
    }

    function venueVisualAttrs(venue) {
      const venueCoverUrl = String(venue.coverImageUrl || "").trim();
      const attrs = customPhotoAttrs(venueCoverUrl, venue.coverImageSrcSet);
      const hasVenueCover = Boolean(attrs.style);
      const sourceClass = hasVenueCover ? " has-venue-cover" : " is-venue-artwork";
      return {
        attrs: {
          ...attrs,
          className: `${attrs.className}${sourceClass}`
        },
        visualUrl: hasVenueCover ? venueCoverUrl : "",
        source: hasVenueCover ? "venue_cover" : "artwork"
      };
    }

    function venueLogoMarkup(venue, className) {
      const logoImageUrl = String(venue?.logoImageUrl || "").trim();
      if (!logoImageUrl) return "";
      const nativeLogoAttrs = nativeResponsivePhotoAttrs(logoImageUrl, venue?.logoImageSrcSet);
      const sourceAttrs = nativeLogoAttrs || `src="${escapeOptionValue(logoImageUrl)}"`;
      const imageWidth = Math.max(0, Number(venue?.logoImageWidth) || 0);
      const imageHeight = Math.max(0, Number(venue?.logoImageHeight) || 0);
      const dimensions = imageWidth && imageHeight
        ? ` width="${imageWidth}" height="${imageHeight}"`
        : "";
      return `<span class="${className}-shell" aria-hidden="true"><img class="${className}" crossorigin="anonymous" ${sourceAttrs} sizes="(max-width: 720px) 82vw, 620px"${dimensions} alt="" loading="lazy" decoding="async" data-image-state="loading"></span>`;
    }

    function venueLineupMarkup(venue, city, options = {}) {
      const liveProfiles = (Array.isArray(options.profiles)
        ? options.profiles
        : venueDancers(city, venue.name))
        .filter((profile) => isWorkingTonight(profile, city))
        .sort((left, right) => shiftStartMinutes(left.time) - shiftStartMinutes(right.time));
      if (!liveProfiles.length) return "";
      const visibleLimit = options.mobile ? 3 : 4;
      const profiles = liveProfiles.slice(0, visibleLimit);
      const remaining = liveProfiles.length - profiles.length;
      const classPrefix = options.mobile ? "home-venue-discovery" : "venue-card";
      const avatars = profiles.map((profile) => {
        const avatarUrl = publicAvatarPhotoUrl(profile);
        const nativePhotoAttrs = nativeResponsivePhotoAttrs(
          avatarUrl,
          publicAvatarPhotoSrcSet(profile)
        );
        const avatarPhoto = avatarUrl && nativePhotoAttrs
          ? `<img class="venue-lineup-avatar-photo" ${nativePhotoAttrs} sizes="32px" width="64" height="64" style="object-position: ${avatarPhotoPosition(
              profile.avatarPhotoFocalX ?? profile.mainPhotoFocalX,
              profile.avatarPhotoFocalY ?? profile.mainPhotoFocalY
            )}" alt="" aria-hidden="true" loading="${options.eager ? "eager" : "lazy"}" decoding="async" draggable="false" data-image-state="loading">`
          : escapeHtml(String(profile.name || "").trim().charAt(0).toUpperCase());
        return `<button type="button" class="${classPrefix}-lineup-avatar venue-lineup-profile" data-public-dancer-id="${escapeOptionValue(profile.id || "")}" data-venue-dancer-profile data-grid-profile-action="${escapeOptionValue(profileReferenceValue(profile))}" data-dancer-id="${escapeOptionValue(profile.id || "")}" data-dancer-avatar data-working-now="true" aria-label="Open ${escapeHtml(profile.name)}, working now"><span data-dancer-avatar-border aria-hidden="true">${avatarPhoto}</span><span data-working-now-indicator aria-hidden="true">NOW</span></button>`;
      }).join("");
      const remainingMarkup = !options.mobile && remaining > 0
        ? `<span class="${classPrefix}-lineup-count" aria-label="${remaining} more dancers working now">+${remaining}</span>`
        : "";
      const liveLabel = `${liveProfiles.length} ${liveProfiles.length === 1 ? "dancer" : "dancers"} working now`;
      const mobileCountLabel = String(liveProfiles.length);
      const mobileLiveCount = options.mobile
        ? `<span class="${classPrefix}-lineup-label" aria-hidden="true"><strong>${mobileCountLabel}</strong><span>NOW</span></span>`
        : "";
      return `<span class="${classPrefix}-lineup" role="group" aria-label="${liveLabel}">${avatars}${remainingMarkup}${mobileLiveCount}</span>`;
    }

    function venueCardQrMarkup(venue) {
      if (!venue?.id) return "";
      if (venue.activeDeal?.id) {
        const config = {
          deal: venue.activeDeal,
          deals: venue.activeDeals,
          venueId: venue.id,
          venueSlug: venue.slug,
          venueName: venue.name,
          sourceType: "club_page"
        };
        const offerCount = venue.activeDeals?.length || 1;
        return `<button class="venue-card-deal-action free-entry-cta" type="button" data-club-deal-cta="${encodeDealPass(config)}" aria-label="View free entry">${freeEntryButtonLabel()}</button>`;
      }
      return "";
    }

    function venueCard(venue) {
      const city = venue.city || citySelect.value;
      const details = venueDetails(venue, city);
      const initials = venueInitials(venue.name);
      const safeName = escapeHtml(venue.name);
      const venueValue = escapeOptionValue(venue.id || venue.name);
      const venueHref = venueExperienceHref(venue, city);
      const logoMarkup = venueLogoMarkup(venue, "venue-card-logo");
      const workingNow = venueDancers(city, venue.name)
        .filter((profile) => isWorkingTonight(profile, city))
        .sort((left, right) => shiftStartMinutes(left.time) - shiftStartMinutes(right.time));
      const followsVenue = isFollowingVenue(city, venue.name);
      const dealMarkup = venue.activeDeal?.dealTitle
        ? `<span class="venue-card-offer"><small>Tonight's offer</small><strong>${escapeHtml(venue.activeDeal.dealTitle)}</strong></span>`
        : "";
      const directionsMarkup = venueDirectionsMarkup({
        venue,
        className: "venue-card-directions venue-directions-btn",
        city
      });
      return `
        <article class="card venue venue-card" data-analytics-venue-id="${escapeOptionValue(venue.isDashboardPreview ? "" : venue.id || "")}" data-analytics-source="venue_scroll_card" aria-label="${safeName} club details" style="--venue-accent:${venueAccent(venue.name)}">
          <a class="venue-card-link" href="${venueHref}" data-open-venue-profile="${venueValue}" aria-label="Open ${safeName}'s full club profile">
            <div class="venue-art is-venue-logo-artwork${logoMarkup ? " has-venue-logo" : ""}">
              <span class="venue-card-kicker">MyDancr club</span>
              ${logoMarkup || `<span class="venue-card-mark">${escapeHtml(initials)}</span>`}
            </div>
            <div class="profile-body">
              <h3>${safeName}</h3>
              <div class="meta">${escapeHtml(details.city)}${details.state ? `, ${escapeHtml(details.state)}` : ""} · ${escapeHtml(details.distanceLabel)}</div>
              <div class="pill-row">
                ${details.hours ? `<span class="pill">${escapeHtml(displayShiftTime(details.hours))}</span>` : ""}
                ${dealMarkup}
              </div>
            </div>
          </a>
          ${venueLineupMarkup(venue, city, { profiles: workingNow })}
          <button class="venue-card-follow ${followsVenue ? "is-active" : ""}" type="button" data-venue-follow="${venueValue}" data-account-action="venue-follow" aria-label="${followsVenue ? `Unfollow ${safeName}` : `Follow ${safeName}`}" title="${followsVenue ? "Following" : "Follow"}" aria-pressed="${followsVenue}">${actionIconMarkup(followsVenue ? "check" : "personPlus")}</button>
          <div class="venue-card-actions" aria-label="${safeName} quick actions">
            ${venueCardQrMarkup(venue)}
            ${directionsMarkup}
          </div>
        </article>
      `;
    }

    function venueDancers(city, venueName) {
      return discoveryMarket(city).dancers
        .filter((profile) => isApprovedPublicProfile(profile) && profile.venue === venueName)
        .map((profile) => withTrendingRank(profile, city));
    }

    function venueDancerGridMarkup(profiles, city, label) {
      return `
        <div class="venue-dancer-grid home-dancer-grid home-dancer-three-column" aria-label="${escapeHtml(label)}">
          ${profiles.map((profile) => homeDancerGridCard(profile, city, true)).join("")}
        </div>
      `;
    }

    function venueDetailPage(venue) {
      const city = venue.city || citySelect.value;
      const details = venueDetails(venue, city);
      const operatingStatus = venueOperatingStatus(details.hours, city);
      const visual = venueVisualAttrs(venue);
      const logoMarkup = venueLogoMarkup(venue, "venue-detail-logo");
      const localProfiles = venueDancers(city, venue.name);
      const tonight = localProfiles
        .filter((profile) => isWorkingTonight(profile))
        .sort((a, b) => shiftStartMinutes(a.time) - shiftStartMinutes(b.time));
      const followsVenue = isFollowingVenue(city, venue.name);
      const venueValue = escapeOptionValue(venue.id || venue.name);
      const activitySections = [
        `
          <section class="venue-activity-section is-working" aria-labelledby="venue-working-now">
            <h3 class="section-title" id="venue-working-now" aria-label="${tonight.length} ${tonight.length === 1 ? "dancer" : "dancers"} working now at ${escapeHtml(details.name)}"><span>Working now · ${tonight.length}</span></h3>
            ${tonight.length
              ? venueDancerGridMarkup(tonight, city, `Working now at ${details.name}`)
              : `<div class="venue-activity-empty is-compact"><span class="venue-activity-empty-icon">${actionIconMarkup("clock")}</span><span><strong>No dancers working now</strong><small>Follow this club for updates.</small></span></div>`}
          </section>
        `
      ].filter(Boolean).join("");
      if (venue.id && !venue.isDashboardPreview) recordVenuePageEvent({ venueId: venue.id, eventType: "page_view", source: "venue_page" });

      return `
        <div data-analytics-venue-id="${escapeOptionValue(venue.isDashboardPreview ? "" : venue.id || "")}" data-analytics-source="venue_detail" class="venue-detail" role="dialog" aria-modal="true" aria-labelledby="venueDetailName">
          <article class="venue-hero">
            <div class="venue-hero-brand-row">
              <div class="venue-main-photo${visual.attrs.className}"${visual.attrs.style} data-venue-visual-source="${visual.source}">
                <div class="venue-art">
                  ${logoMarkup || `
                    <div class="venue-sign">
                      <div class="venue-sign-name">${escapeHtml(details.name)}</div>
                      <div class="venue-sign-meta">${escapeHtml(details.city)} nightlife</div>
                    </div>
                  `}
                </div>
              </div>
              <button class="close-btn venue-detail-close" type="button" data-close-venue-profile aria-label="Close ${escapeHtml(details.name)} club profile">
                <svg class="icon" viewBox="0 0 24 24"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>
              </button>
            </div>
            <div class="venue-hero-body">
              <div class="venue-identity-block">
                <div class="venue-identity-copy">
                  <h2 id="venueDetailName" class="venue-detail-accessible-name">${escapeHtml(details.name)}</h2>
                  <div class="venue-identity-meta">
                    <span class="venue-identity-location"><span class="meta">${escapeHtml(details.city)}${details.state ? `, ${escapeHtml(details.state)}` : ""}</span></span>
                    <span class="venue-identity-distance">${escapeHtml(details.distanceLabel)}</span>
                  </div>
                </div>
              </div>
              ${operatingStatus.state !== "unknown" ? `
                <div class="venue-profile-hours" aria-label="Opening hours">
                  <strong>${escapeHtml(operatingStatus.label)}</strong>
                  <span>Hours · ${escapeHtml(operatingStatus.hoursLabel)}</span>
                </div>
              ` : ""}
              ${venueOfferMarkup(venue)}
              <section class="venue-info venue-location-section" aria-label="Club location">
                ${details.address ? `<div class="venue-address-line"><span>${escapeHtml(details.address)}</span></div>` : ""}
                <div class="venue-action-stack" aria-label="Venue actions">
                  <div class="venue-location-actions venue-primary-actions" aria-label="Venue travel actions">
                    ${venueDirectionsMarkup({ venue, className: "venue-address-directions", city })}
                  </div>
                  <div class="venue-secondary-actions profile-actions-compact" aria-label="Venue profile actions">
                    <button class="action-btn secondary follow-venue-btn profile-action-icon-control ${followsVenue ? "is-following" : ""}" type="button" data-venue-follow="${venueValue}" data-account-action="venue-follow" aria-pressed="${followsVenue}">
                      <span class="profile-action-main">${actionButtonLabel(followsVenue ? "check" : "personPlus", followsVenue ? "Following" : "Follow")}</span>
                    </button>
                    <button class="action-btn secondary venue-detail-share profile-action-icon-control profile-share-action" type="button" data-share-venue="${venueValue}" data-share-city="${escapeOptionValue(city)}" aria-label="Share ${escapeHtml(details.name)} club profile">
                      <span class="profile-action-main">${actionButtonLabel("share", "Share")}</span>
                    </button>
                  </div>
                </div>
              </section>
            </div>
          </article>

          <div class="venue-detail-exploration">
            ${activitySections}
          </div>
        </div>
      `;
    }

    function profileReferenceValue(profile) {
      return String(profile?.slug || profile?.id || profile?.name || "").trim();
    }

    function findProfile(reference, options = {}) {
      const includePending = Boolean(options.includePending);
      const normalizedReference = String(reference || "").trim();
      if (!normalizedReference) return null;
      const availableProfiles = discoveryMarket(citySelect.value).dancers.filter((item) => (
        includePending || isApprovedPublicProfile(item)
      ));
      const profile = availableProfiles.find((item) => (
        String(item.id || "") === normalizedReference ||
        String(item.slug || "") === normalizedReference
      )) || availableProfiles.find((item) => item.name === normalizedReference);
      return profile ? (profile.status === "Pending" ? profile : withTrendingRank(profile, citySelect.value)) : null;
    }

    function modalVideoPlaybackIcon(paused) {
      return paused
        ? '<svg class="profile-modal-media-control-icon" viewBox="0 0 24 24" aria-hidden="true"><path class="is-fill" d="m9 7 8 5-8 5Z"></path></svg>'
        : '<svg class="profile-modal-media-control-icon" viewBox="0 0 24 24" aria-hidden="true"><path class="is-fill" d="M7 6h3v12H7zM14 6h3v12h-3z"></path></svg>';
    }

    function clearModalVideoPlaybackFeedback() {
      if (modalVideoPlaybackFeedbackTimer) window.clearTimeout(modalVideoPlaybackFeedbackTimer);
      modalVideoPlaybackFeedbackTimer = 0;
      modalVideoPlaybackFeedback.classList.remove("show");
    }

    function showModalVideoPlaybackFeedback(paused) {
      clearModalVideoPlaybackFeedback();
      modalVideoPlaybackFeedback.innerHTML = modalVideoPlaybackIcon(paused);
      modalVideoPlaybackFeedback.classList.add("show");
      modalVideoPlaybackFeedbackTimer = window.setTimeout(() => {
        modalVideoPlaybackFeedback.classList.remove("show");
        modalVideoPlaybackFeedbackTimer = 0;
      }, 850);
    }

    function modalVideoSoundIcon(muted) {
      const soundWaves = muted
        ? '<path d="m17 9 4 6"></path><path d="m21 9-4 6"></path>'
        : '<path d="M16 9.5a4 4 0 0 1 0 5"></path><path d="M18.5 7a7.5 7.5 0 0 1 0 10"></path>';
      return `<svg class="profile-modal-media-control-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10v4h4l5 4V6L8 10H4Z"></path>${soundWaves}</svg>`;
    }

    function clearModalVideoControlsHideTimer() {
      if (!modalVideoControlsHideTimer) return;
      window.clearTimeout(modalVideoControlsHideTimer);
      modalVideoControlsHideTimer = 0;
    }

    function setModalVideoControlsVisible(visible, options = {}) {
      clearModalVideoControlsHideTimer();
      modalVideoControls.classList.toggle("is-visible", visible);
      modalImage.classList.toggle("is-video-controls-visible", visible);
      const video = activeModalVideo();
      if (!visible || !options.autoHide || !video || video.paused) return;
      modalVideoControlsHideTimer = window.setTimeout(() => {
        modalVideoControls.classList.remove("is-visible");
        modalImage.classList.remove("is-video-controls-visible");
        modalVideoControlsHideTimer = 0;
      }, 1800);
    }

    function clearModalVideoPreview() {
      clearModalVideoControlsHideTimer();
      clearModalVideoPlaybackFeedback();
      modalImage.querySelector(".modal-media-video-preview")?.remove();
      modalImage.classList.remove("is-video-media", "is-video-controls-visible");
      delete modalImage.dataset.activeVideoIndex;
      modalVideoControls.hidden = true;
      modalVideoControls.classList.remove("is-visible");
      modalVideoPlayback.innerHTML = modalVideoPlaybackIcon(true);
      modalVideoPlayback.setAttribute("aria-label", "Play TV video");
      modalVideoSound.innerHTML = modalVideoSoundIcon(modalProfileVideoMuted);
      modalVideoSound.setAttribute("aria-label", modalProfileVideoMuted ? "Turn TV video sound on" : "Turn TV video sound off");
      modalVideoProgress.value = "0";
      modalVideoProgress.max = "0.1";
      modalVideoProgress.style.setProperty("--profile-video-progress", "0%");
      modalVideoProgress.setAttribute("aria-valuetext", "0:00 of 0:00");
      modalVideoTime.textContent = "0:00 / 0:00";
    }

    function activeModalVideo() {
      return modalImage.querySelector(".modal-media-video-preview > video");
    }

    function toggleModalVideoPlayback() {
      const video = activeModalVideo();
      if (!video) return;
      if (video.paused) {
        showModalVideoPlaybackFeedback(false);
        setModalVideoControlsVisible(true, { autoHide: true });
        void video.play().catch(() => {
          showModalVideoPlaybackFeedback(true);
          syncModalVideoControls();
          setModalVideoControlsVisible(true);
        });
        return;
      }
      video.pause();
      showModalVideoPlaybackFeedback(true);
      setModalVideoControlsVisible(true);
    }

    function syncModalVideoControls() {
      const video = activeModalVideo();
      if (!video || modalImage.dataset.activeMediaType !== "video") {
        modalVideoControls.hidden = true;
        setModalVideoControlsVisible(false);
        return;
      }
      const videos = Array.isArray(modalGallery.profileTvVideos) ? modalGallery.profileTvVideos : [];
      const item = videos[Number(modalImage.dataset.activeVideoIndex)] || {};
      const duration = Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : Math.max(0, Number(item.durationSeconds) || 0);
      const currentTime = Math.min(Math.max(0, video.currentTime || 0), Math.max(0, duration));
      modalProfileVideoMuted = video.muted;
      modalVideoControls.hidden = false;
      modalVideoPlayback.innerHTML = modalVideoPlaybackIcon(video.paused);
      modalVideoPlayback.setAttribute("aria-label", video.paused ? "Play TV video" : "Pause TV video");
      modalVideoSound.innerHTML = modalVideoSoundIcon(video.muted);
      modalVideoSound.setAttribute("aria-label", video.muted ? "Turn TV video sound on" : "Turn TV video sound off");
      modalVideoProgress.max = String(Math.max(0.1, duration));
      modalVideoProgress.value = String(currentTime);
      const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;
      modalVideoProgress.style.setProperty("--profile-video-progress", `${progressPercent}%`);
      const timeLabel = `${formatProfileTvDuration(currentTime)} of ${formatProfileTvDuration(duration)}`;
      modalVideoProgress.setAttribute("aria-valuetext", timeLabel);
      modalVideoTime.textContent = `${formatProfileTvDuration(currentTime)} / ${formatProfileTvDuration(duration)}`;
      if (video.paused) setModalVideoControlsVisible(true);
    }

    function syncProfileMediaTabCounts(photoCount = 0, videoCount = 0) {
      const mediaCounts = [
        { button: modalMediaPhotoTab, badge: modalMediaPhotoCount, count: Math.max(0, Number(photoCount) || 0), label: "Photos" },
        { button: modalMediaTvTab, badge: modalMediaTvCount, count: Math.max(0, Number(videoCount) || 0), label: "Videos" }
      ];
      mediaCounts.forEach(({ button, badge, count, label }) => {
        button.disabled = count === 0;
        button.setAttribute("aria-label", count ? `${label}, ${count} available` : `${label} unavailable`);
        button.title = count ? `${label} (${count})` : `${label} unavailable`;
        badge.textContent = String(count);
        badge.hidden = false;
      });
    }

    function setProfileMediaTab(requestedTab) {
      const tab = requestedTab === "video" && !modalMediaTvTab.disabled
        ? "video"
        : !modalMediaPhotoTab.disabled
          ? "photo"
          : !modalMediaTvTab.disabled
            ? "video"
            : "photo";
      modalGallery.dataset.mediaTab = tab;
      modalGallery.setAttribute("aria-labelledby", tab === "video" ? modalMediaTvTab.id : modalMediaPhotoTab.id);
      [modalMediaPhotoTab, modalMediaTvTab].forEach((button) => {
        const active = button.dataset.profileMediaTab === tab;
        button.classList.toggle("active", active);
        button.setAttribute("aria-selected", String(active));
      });
      const selector = tab === "video"
        ? ".thumb[data-profile-tv-index]"
        : ".thumb:not([data-profile-tv-index])";
      const visibleThumbs = [...modalGallery.querySelectorAll(selector)];
      modalMediaEmpty.hidden = visibleThumbs.length > 0;
      modalImage.hidden = true;
      modalMediaEmpty.textContent = tab === "video"
        ? "No approved MyDancr TV videos yet."
        : "No approved profile photos yet.";
      const selected = visibleThumbs.find((thumb) => thumb.classList.contains("active")) || visibleThumbs[0];
      if (selected && tab === "photo") selectModalMediaThumb(selected);
      if (tab === "video") clearModalVideoPreview();
      window.requestAnimationFrame(observeProfileMediaSentinel);
    }

    function syncModalMediaNavigation(kind, index, total) {
      if (modalMediaPosition) {
        modalMediaPosition.textContent = `${kind === "video" ? "TV" : "Photo"} ${Math.max(0, index) + 1} of ${Math.max(1, total)}`;
      }
      if (modalMediaPrevious) modalMediaPrevious.disabled = index <= 0;
      if (modalMediaNext) modalMediaNext.disabled = index >= total - 1;
    }

    function setModalPhoto(photoClass, photoUrl = "", requestedIndex = null) {
      clearModalVideoPreview();
      const safeUrl = safeCssUrl(photoUrl);
      const parsedRequestedIndex = Number(requestedIndex);
      const hasRequestedIndex = requestedIndex !== null && requestedIndex !== "" && Number.isInteger(parsedRequestedIndex);
      modalImage.className = `modal-image ${photoClass}${safeUrl ? " has-custom-photo" : ""}`;
      if (safeUrl) {
        modalImage.style.setProperty("--custom-photo", `url('${safeUrl}')`);
      } else {
        modalImage.style.removeProperty("--custom-photo");
      }
      const thumbs = [...modalGallery.querySelectorAll(".thumb")];
      thumbs.forEach((thumb) => {
        const isPhotoThumb = !thumb.hasAttribute("data-profile-tv-index");
        const isActive = isPhotoThumb && (hasRequestedIndex
          ? Number(thumb.dataset.profilePhotoIndex) === parsedRequestedIndex
          : thumb.dataset.photo === photoClass && (thumb.dataset.photoUrl || "") === (photoUrl || ""));
        thumb.classList.toggle("active", isActive);
        thumb.setAttribute("aria-pressed", String(isActive));
        if (isActive) {
          thumb.setAttribute("aria-current", "true");
        } else {
          thumb.removeAttribute("aria-current");
        }
      });
      const photoThumbs = thumbs.filter((thumb) => !thumb.hasAttribute("data-profile-tv-index"));
      const activePhotoThumb = photoThumbs.find((thumb) => thumb.classList.contains("active"));
      const activePhotoIndex = Math.max(0, hasRequestedIndex
        ? parsedRequestedIndex
        : Number(activePhotoThumb?.dataset.profilePhotoIndex || 0));
      const totalPhotos = Math.max(1, modalGallery.profilePhotoItems?.length || photoThumbs.length);
      modalImage.dataset.activePhotoIndex = String(activePhotoIndex);
      modalImage.dataset.activeMediaType = "photo";
      modalMediaExpand.hidden = true;
      modalImage.setAttribute(
        "aria-label",
        `${modalName.textContent.trim() || "Dancer"} profile photo ${activePhotoIndex + 1} of ${totalPhotos}. Swipe left or right to change photos.`
      );
      profilePhotoViewerImage?.setAttribute(
        "aria-label",
        `Dancer photos. Photo ${activePhotoIndex + 1} of ${totalPhotos}. Scroll up or down to change photos.`
      );
      syncModalMediaNavigation("photo", activePhotoIndex, totalPhotos);
    }

    function setModalVideo(item, profileName, videos, index) {
      if (!item?.videoUrl) return false;
      clearModalVideoPreview();
      modalImage.className = "modal-image is-video-media";
      modalImage.dataset.activeMediaType = "video";
      modalImage.dataset.activeVideoIndex = String(index);
      modalMediaExpand.hidden = false;
      modalImage.style.removeProperty("--custom-photo");

      const preview = document.createElement("div");
      preview.className = "modal-media-video-preview";
      const video = document.createElement("video");
      video.src = item.videoUrl;
      video.autoplay = true;
      video.loop = true;
      video.muted = modalProfileVideoMuted;
      video.defaultMuted = modalProfileVideoMuted;
      video.playsInline = true;
      video.preload = "metadata";
      const posterUrl = profileVideoPosterUrl(item);
      if (posterUrl) video.poster = posterUrl;
      video.setAttribute("autoplay", "");
      video.setAttribute("aria-hidden", "true");
      ["loadedmetadata", "durationchange", "timeupdate", "volumechange"].forEach((eventName) => {
        video.addEventListener(eventName, syncModalVideoControls);
      });
      video.addEventListener("play", () => {
        syncModalVideoControls();
        setModalVideoControlsVisible(true, { autoHide: true });
      });
      video.addEventListener("pause", () => {
        syncModalVideoControls();
        setModalVideoControlsVisible(true);
      });
      preview.appendChild(video);
      modalImage.appendChild(preview);
      modalVideoControls.hidden = false;
      setModalVideoControlsVisible(true);
      syncModalVideoControls();
      void video.play().catch(() => undefined);

      const thumbs = [...modalGallery.querySelectorAll(".thumb")];
      thumbs.forEach((thumb) => {
        const isActive = Number(thumb.dataset.profileTvIndex) === index;
        thumb.classList.toggle("active", isActive);
        thumb.setAttribute("aria-pressed", String(isActive));
        if (isActive) {
          thumb.setAttribute("aria-current", "true");
          modalGallery.scrollTo({
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
            left: thumb.offsetLeft - (modalGallery.clientWidth - thumb.offsetWidth) / 2
          });
        } else {
          thumb.removeAttribute("aria-current");
        }
      });
      const activeIndex = Math.max(0, thumbs.findIndex((thumb) => thumb.classList.contains("active")));
      modalImage.dataset.activeMediaType = "video";
      modalImage.dataset.activeVideoIndex = String(index);
      modalImage.dataset.activePhotoIndex = String(activeIndex);
      modalImage.setAttribute(
        "aria-label",
        `${profileName} profile video autoplaying muted, media ${activeIndex + 1} of ${Math.max(1, thumbs.length)}. Tap the video to play or pause. Use the full-screen button for immersive playback or swipe left or right to change media.`
      );
      syncModalMediaNavigation("video", index, videos.length);
      return true;
    }

    function selectModalMediaThumb(thumb, options = {}) {
      if (!thumb) return false;
      if (thumb.hasAttribute("data-profile-tv-index")) {
        const videos = Array.isArray(modalGallery.profileTvVideos) ? modalGallery.profileTvVideos : [];
        const videoIndex = Number(thumb.dataset.profileTvIndex);
        const item = videos[videoIndex];
        if (!item) return false;
        return setModalVideo(item, modalGallery.profileTvProfileName || "Dancer", videos, videoIndex);
      }
      const photoIndex = Number(thumb.dataset.profilePhotoIndex);
      setModalPhoto(
        thumb.dataset.photo,
        thumb.dataset.photoUrl || "",
        Number.isInteger(photoIndex) ? photoIndex : null
      );
      if (options.syncViewer) syncProfilePhotoViewerImage();
      return true;
    }

    function profileMediaCardScrollInset(scroller) {
      return parseFloat(getComputedStyle(scroller).scrollPaddingTop) || 0;
    }

    function profileMediaCardScrollIndex(scrollTop, offsets, inset = 0) {
      if (!offsets.length) return 0;
      const target = Number(scrollTop || 0) + Number(inset || 0);
      return offsets.reduce((closest, offset, index) =>
        Math.abs(offset - target) < Math.abs(offsets[closest] - target) ? index : closest, 0);
    }

    function profilePhotoCardScrollIndex(scrollTop, offsets, viewportHeight, scrollHeight) {
      if (!offsets.length) return 0;
      if (scrollTop > 0 && scrollTop + viewportHeight >= scrollHeight - 1) return offsets.length - 1;
      return offsets.reduce((active, offset, index) => offset <= scrollTop + 1 ? index : active, 0);
    }

    function sizeProfilePhotoCard(slide, width, height) {
      if (!slide || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
      const ratio = `${width} / ${height}`;
      if (slide.style.getPropertyValue("--profile-photo-card-ratio") === ratio) return;
      const feed = profilePhotoViewerImage;
      const anchor = [...feed.querySelectorAll("[data-profile-photo-card]")].reverse()
        .find((card) => card.offsetTop <= feed.scrollTop + 1);
      const before = anchor?.offsetTop || 0;
      slide.style.setProperty("--profile-photo-card-ratio", ratio);
      slide.dataset.photoShape = width > height * 3 ? "panorama" : width > height ? "landscape" : "portrait";
      if (anchor && anchor.offsetTop !== before) feed.scrollTo({ top: feed.scrollTop + anchor.offsetTop - before, behavior: "instant" });
    }

    function profileMediaCardControls(overlay) {
      if (!overlay.profileMediaCardControls) {
        overlay.profileMediaCardControls = [...overlay.querySelectorAll(
          ".profile-photo-viewer-footer, .profile-photo-viewer-previous, .profile-photo-viewer-next, .profile-tv-viewer-footer, .profile-tv-viewer-previous, .profile-tv-viewer-next, .profile-tv-playback-feedback"
        )];
      }
      return overlay.profileMediaCardControls;
    }

    function mountProfileMediaCardControls(overlay, slide = null) {
      const host = slide || overlay.querySelector(".profile-photo-viewer-shell, .profile-tv-viewer-shell");
      if (!host) return;
      profileMediaCardControls(overlay).forEach((control) => {
        if (control.parentElement !== host) host.appendChild(control);
      });
    }

    function mountProfileMediaCardHeader(overlay, scroller = null) {
      const host = scroller || overlay.querySelector(".profile-photo-viewer-shell, .profile-tv-viewer-shell");
      if (!host) return;
      let header = overlay.querySelector(".profile-media-card-header");
      if (!header) {
        header = document.createElement("div");
        header.className = "profile-media-card-header";
        const heading = document.createElement("div");
        heading.className = "profile-media-card-heading";
        header.appendChild(heading);
      }
      header.querySelector(".profile-media-card-heading").textContent = overlay.dataset.profileMediaHeading || "Profile media";
      host.prepend(header);
    }

    function appendProfileMediaBackButton(slide, onBack) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "profile-media-card-back";
      button.setAttribute("aria-label", "Back to dancer profile");
      button.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M19 12H5m7-7-7 7 7 7"></path></svg>';
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onBack();
      });
      slide.appendChild(button);
    }

    function syncProfilePhotoViewerImage() {
      if (!profilePhotoViewerImage || profilePhotoViewer?.hidden) return;
      const activePhotoIndex = Math.max(0, Number(modalImage?.dataset.activePhotoIndex || 0));
      scrollProfilePhotoViewerTo(activePhotoIndex);
      if (profilePhotoViewerStatus) profilePhotoViewerStatus.textContent = "";
    }

    function renderProfilePhotoViewerSlides() {
      if (!profilePhotoViewerImage) return 0;
      const items = Array.isArray(modalGallery.profilePhotoItems) ? modalGallery.profilePhotoItems : [];
      const profileName = modalName.textContent.trim() || "Dancer";
      mountProfileMediaCardControls(profilePhotoViewer);
      mountProfileMediaCardHeader(profilePhotoViewer);
      profilePhotoViewerImage.innerHTML = "";
      items.forEach((item, index) => {
        const slide = document.createElement("section");
        slide.className = "profile-photo-viewer-slide";
        slide.dataset.profilePhotoCard = "true";
        slide.dataset.profilePhotoViewerIndex = String(index);
        slide.setAttribute("aria-label", `${profileName} photo ${index + 1} of ${items.length}`);
        const image = document.createElement("div");
        image.className = `profile-photo-viewer-slide-image ${item.photoClass || ""}${item.photoUrl ? " has-custom-photo" : ""}`;
        image.dataset.profilePhotoUrl = String(item.photoUrl || "").trim();
        image.setAttribute("role", "img");
        image.setAttribute("aria-label", `${profileName} photo ${index + 1} of ${items.length}`);
        slide.appendChild(image);
        appendProfileMediaBackButton(slide, closeProfilePhotoViewer);
        profilePhotoViewerImage.appendChild(slide);
        mountProfilePhotoCardControls(slide, item, index, items.length, profileName);
        const thumb = modalGallery.querySelector(`[data-profile-photo-index="${index}"] img`);
        if (thumb?.naturalWidth && thumb?.naturalHeight) sizeProfilePhotoCard(slide, thumb.naturalWidth, thumb.naturalHeight);
      });
      mountProfileMediaCardHeader(profilePhotoViewer, profilePhotoViewerImage);
      return items.length;
    }

    function mountProfilePhotoCardControls(slide, item, index, total, profileName) {
      // Each photo owns stable controls. Moving one glass layer between cards
      // leaves the incoming photo bare during Safari's momentum scrolling.
      profileMediaCardControls(profilePhotoViewer).forEach((template) => {
        const control = template.cloneNode(true);
        [control, ...control.querySelectorAll("[id]")].forEach((node) => node.removeAttribute("id"));
        control.removeAttribute("data-profile-photo-control-template");
        control.hidden = false;
        slide.appendChild(control);
        template.dataset.profilePhotoControlTemplate = "true";
      });
      const status = slide.querySelector(".profile-photo-viewer-status");
      if (status) status.textContent = "";
      slide.querySelector(".profile-photo-viewer-copy strong").textContent = profileName;
      slide.querySelector(".profile-media-position").textContent = `${index + 1}/${total}`;
      const bind = (selector, handler) => {
        const button = slide.querySelector(selector);
        button?.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          handler(button);
        });
        return button;
      };
      const previous = bind(".profile-photo-viewer-previous", () => scrollProfilePhotoViewerTo(index - 1));
      const next = bind(".profile-photo-viewer-next", () => scrollProfilePhotoViewerTo(index + 1));
      if (previous) previous.disabled = index <= 0;
      if (next) next.disabled = index >= total - 1;
      const like = bind(".profile-photo-viewer-like", () => void togglePublicMediaLike("photo", String(item.id || ""), status));
      preparePublicMediaLikeButton(like, "photo", String(item.id || ""), item.likeCount);
      bind(".profile-photo-viewer-share", () => void shareProfilePhoto(index, status));
      const photoId = String(item.id || "");
      const targetType = isReportableContentId(photoId) ? "profile_photo" : "dancer_profile";
      const targetId = targetType === "profile_photo" ? photoId : String(modalGallery.dataset.profileMediaProfile || "");
      const report = bind(".profile-photo-viewer-report", (button) => openContentReportDialog({
        button, status, targetType, targetId,
        targetLabel: targetType === "profile_photo" ? `${profileName} profile photo ${index + 1}` : profileName,
        title: "Report photo", quickReasons: true
      }));
      if (report) report.dataset.reportDefaultLabel = "Report this profile photo";
      prepareContentReportButton(report, targetType, targetId, "Report this profile photo");
    }
