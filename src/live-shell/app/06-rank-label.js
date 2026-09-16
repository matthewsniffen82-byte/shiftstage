

    function rankLabel(rank) {
      return rank ? `#${rank}` : "Outside Top 10";
    }

    function rankMovementText(change) {
      if (change > 0) return `Up ${change}`;
      if (change < 0) return `Down ${Math.abs(change)}`;
      return "No change";
    }

    function rankTrendFromChange(change) {
      if (change >= 3) return "Rising";
      if (change <= -2) return "Falling";
      return "Stable";
    }

    function rankingSignalLabel(metrics) {
      const signals = [
        [metrics.profileViews30, "Profile views"],
        [metrics.scheduleViews30, "Schedule views"],
        [metrics.newFollowers, "Followers gained"],
        [metrics.notificationOpens, "Notification engagement"],
        [metrics.favoritesAdded, "Favorites"],
        [metrics.goingTonightClicks, "Going Now signals"]
      ];
      signals.sort((a, b) => b[0] - a[0]);
      return signals[0]?.[1] || "Profile activity";
    }

    function rankingNotificationMarkup(event) {
      return `
        <article class="rank-event ${escapeHtml(event.type)}">
          <span class="rank-event-icon">${escapeHtml(event.icon)}</span>
          <span><strong>${escapeHtml(event.title)}</strong><p>${escapeHtml(event.message)}</p></span>
        </article>
      `;
    }

    function liveRankingEventMarkupData(event) {
      const map = {
        number_one: { type: "rank-one", icon: "👑", title: "Reached #1 Trending" },
        entered_top_10: { type: "top-ten", icon: "🔥", title: "Entered Top 10" },
        moved_up_3_plus: { type: "up", icon: "📈", title: "Significant rank increase" },
        biggest_mover: { type: "up", icon: "↗", title: "Biggest mover" },
        first_time_trending: { type: "first", icon: "⭐", title: "First time trending" }
      };
      const fallback = { type: "stable", icon: "⚡", title: "Ranking update" };
      const mapped = map[event.eventType] || fallback;
      return {
        ...mapped,
        message: event.message || `Your ${event.city || "city"} ranking changed.`
      };
    }

    function latestDancerReviews() {
      const latest = new Map();
      liveDancerReviews.forEach((review) => {
        const type = review.reviewType || review.review_type || "review";
        if (type === "identity" || type.startsWith("verification_document:")) return;
        const previous = latest.get(type);
        const currentTime = Date.parse(review.reviewedAt || review.reviewed_at || review.createdAt || review.created_at || "") || 0;
        const previousTime = previous ? Date.parse(previous.reviewedAt || previous.reviewed_at || previous.createdAt || previous.created_at || "") || 0 : -1;
        if (!previous || currentTime >= previousTime) latest.set(type, review);
      });
      return Array.from(latest.values());
    }

    function latestContentReview(reviewType = "") {
      if (!reviewType) return null;
      return latestDancerReviews().find((review) =>
        String(review.reviewType || review.review_type || "") === reviewType
      ) || null;
    }

    function reviewSetupStep(reviewType = "") {
      if (reviewType.startsWith("photo:") || reviewType === "photos") return "photos";
      if (reviewType.startsWith("social_link:") || reviewType === "profile") return "profile";
      return "approval";
    }

    function reviewDisplayLabel(reviewType = "") {
      if (reviewType === "photos") return "Photo set";
      if (reviewType === "profile") return "Profile details";
      if (reviewType.startsWith("photo:")) {
        const targetId = reviewType.split(":").slice(1).join(":");
        const profile = activeDancerProfile() || null;
        const photoIndex = (profile?.submittedPhotos || []).findIndex((photo, index) =>
          String(photo.id || `${profile?.id || profile?.name || "profile"}-photo-${index}`) === targetId ||
          String(photo.id || "").toLowerCase().includes(targetId.toLowerCase()) ||
          targetId.toLowerCase().includes(`photo-${index}`)
        );
        return photoIndex >= 0 ? `Photo ${photoIndex + 1}` : "Submitted photo";
      }
      if (reviewType.startsWith("social_link:")) {
        const targetId = reviewType.split(":").slice(1).join(":");
        const profile = activeDancerProfile() || null;
        const normalizedTarget = targetId.toLowerCase();
        const platformTarget = socialPlatforms.find((item) =>
          item.key === normalizedTarget ||
          normalizedTarget.includes(item.key) ||
          normalizedTarget.includes(`social-${item.key}`)
        );
        if (platformTarget) return platformTarget.label;
        const social = normalizeSubmittedSocials(profile).find((item) =>
          item.id === targetId ||
          item.platform === normalizedTarget ||
          String(item.id || "").toLowerCase().includes(normalizedTarget) ||
          normalizedTarget.includes(item.platform)
        );
        return social?.label || "Social link";
      }
      return String(reviewType || "Review").replaceAll("_", " ");
    }

    function reviewStepLabel(step) {
      if (step === "profile") return "Step 1 profile";
      if (step === "photos") return "Step 1 photos";
      return "Step 2 venue tap";
    }

    function hasRejectedDancerReviews() {
      return latestDancerReviews().some((review) => review.status === "rejected");
    }

    function isOptionalProfileFixReviewType(type = "") {
      return type === "photos" || type.startsWith("photo:") || type.startsWith("social_link:");
    }

    function hasOptionalProfileFixReviews() {
      return latestDancerReviews().some((review) =>
        review.status === "rejected" && isOptionalProfileFixReviewType(String(review.reviewType || review.review_type || ""))
      );
    }

    function reviewFixTarget(type = "") {
      if (type.startsWith("photo:")) {
        const targetId = type.split(":").slice(1).join(":");
        return targetId ? `dancer-photo-${targetId}` : "dancer-photo-review-card";
      }
      if (type === "photos") return "dancer-photo-review-card";
      if (type.startsWith("social_link:")) {
        const targetId = type.split(":").slice(1).join(":");
        const platformTarget = socialPlatforms.find((platform) => platform.key === targetId);
        if (platformTarget) return `profile-${platformTarget.key}`;
        const profile = activeDancerProfile() || null;
        const social = normalizeSubmittedSocials(profile).find((item) =>
          item.id === targetId ||
          item.platform === targetId ||
          String(item.id || "").toLowerCase().includes(`social-${targetId}`)
        );
        return social ? `profile-${social.platform}` : "profile-socials";
      }
      if (type === "profile") return "profile-socials";
      return "";
    }

    function dancerReviewFeedbackMarkup() {
      if (!liveDancerReviews.length) {
        return '<div class="rule-note">No platform review notes yet. Photo and social-link moderation updates appear here.</div>';
      }
      return `<div class="review-feedback-list">${latestDancerReviews().map((review) => {
        const rawStatus = String(review.status || "pending");
        const status = rawStatus.replaceAll("_", " ");
        const type = String(review.reviewType || review.review_type || "review");
        const date = formatBillingDate(review.reviewedAt || review.createdAt);
        const step = reviewSetupStep(type);
        const stateClass = rawStatus === "rejected" ? "is-rejected" : rawStatus === "approved" ? "is-approved" : "is-pending";
        const reason = review.notes || (rawStatus === "approved" ? "Approved. No changes needed." : "No reason added.");
        return `
          <div class="info-tile review-feedback-item ${stateClass}">
            <span class="review-status">${status}</span>
            <strong>${displayText(reviewDisplayLabel(type))}</strong>
            <div class="meta">${displayText(reason)}${date ? ` · ${date}` : ""}</div>
            ${rawStatus === "rejected" ? `<div class="meta">Fix or resend in ${displayText(reviewStepLabel(step))}.</div>` : ""}
          </div>
        `;
      }).join("")}</div>`;
    }

    function editableDancerFixFeedbackMarkup() {
      const rejected = latestDancerReviews().filter((review) => {
        const type = String(review.reviewType || review.review_type || "");
        return review.status === "rejected" && (
          type.startsWith("photo:") ||
          type.startsWith("social_link:") ||
          type === "photos" ||
          type === "profile"
        );
      });
      if (!rejected.length) {
        return "";
      }
      const links = rejected.map((review) => {
        const type = String(review.reviewType || review.review_type || "review");
        const date = formatBillingDate(review.reviewedAt || review.createdAt);
        const reason = review.notes || "No reason added.";
        const fixTarget = reviewFixTarget(type);
        const label = reviewDisplayLabel(type);
        return `
          <button type="button" ${fixTarget ? `data-fix-target="${displayText(fixTarget)}"` : ""} title="${displayText(reason)}${date ? ` · ${date}` : ""}">
            ${displayText(label)}
          </button>
        `;
      }).join("");
      return `
        <div class="fix-link-summary">
          <strong>${rejected.length} item${rejected.length === 1 ? "" : "s"} need${rejected.length === 1 ? "s" : ""} to be fixed</strong>
          <div class="fix-link-row">${links}</div>
        </div>
      `;
    }

    function setApprovedToolDropdown(panel = "", options = {}) {
      activeApprovedToolDropdown = options.force ? panel : activeApprovedToolDropdown === panel ? "" : panel;
      renderApprovedToolDropdowns();
    }

    function openApprovedScheduleEditor() {
      const panel = document.getElementById("approvedDancerPanel");
      panel?.removeAttribute("hidden");
      if (panel) panel.open = true;
      setApprovedToolDropdown("schedule", { force: true });
      window.requestAnimationFrame(() => {
        document.getElementById("approvedScheduleDropdown")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    }

    function renderApprovedToolDropdowns() {
      const editPanel = document.getElementById("approvedEditProfileDropdown");
      const schedulePanel = document.getElementById("approvedScheduleDropdown");
      const fixList = document.getElementById("approvedProfileFixList");
      const profileMount = document.getElementById("approvedProfileFormMount");
      const scheduleMount = document.getElementById("approvedScheduleFormMount");
      if (fixList) fixList.innerHTML = editableDancerFixFeedbackMarkup();
      editPanel?.classList.toggle("show", activeApprovedToolDropdown === "edit");
      schedulePanel?.classList.toggle("show", activeApprovedToolDropdown === "schedule");
      const scheduleExpanded = activeApprovedToolDropdown === "schedule";
      const scheduleCard = schedulePanel?.closest(".dancer-next-shift");
      const schedulePrimary = document.getElementById("dancerDashboardShiftAction");
      scheduleCard?.classList.toggle("is-schedule-editor-open", scheduleExpanded);
      schedulePrimary?.setAttribute("aria-expanded", scheduleExpanded ? "true" : "false");
      schedulePrimary?.setAttribute("aria-controls", "approvedScheduleDropdown");
      dancerDashboard?.classList.toggle("is-edit-profile-fullscreen", activeApprovedToolDropdown === "edit");
      document.body.classList.toggle("edit-profile-open", activeApprovedToolDropdown === "edit");
      if (editPanel) editPanel.hidden = activeApprovedToolDropdown !== "edit";
      if (schedulePanel) schedulePanel.hidden = activeApprovedToolDropdown !== "schedule";
      document.querySelectorAll('[data-dancer-control-action="edit-profile"]').forEach((button) => {
        const expanded = activeApprovedToolDropdown === "edit";
        const fixCount = approvedVisualProfileFixCount();
        button.classList.toggle("is-expanded", expanded);
        button.setAttribute("aria-expanded", expanded ? "true" : "false");
        button.setAttribute("aria-controls", "approvedEditProfileDropdown");
        const strong = button.querySelector("strong");
        if (strong) {
          strong.innerHTML = `Edit profile${fixCount ? `<span class="fix-count-inline">${fixCount}</span>` : ""}`;
        }
      });
      document.querySelectorAll('[data-dancer-control-action="post-schedule"]').forEach((button) => {
        const expanded = activeApprovedToolDropdown === "schedule";
        button.classList.toggle("is-expanded", expanded);
        button.setAttribute("aria-expanded", expanded ? "true" : "false");
        button.setAttribute("aria-controls", "approvedScheduleDropdown");
      });
      const profileForm = document.getElementById("publicProfileForm");
      const profileResult = document.getElementById("profileEditResult");
      if (profileMount && profileForm && profileForm.parentElement !== profileMount) {
        profileMount.appendChild(profileForm);
        if (profileResult) profileMount.appendChild(profileResult);
      }
      const shiftForm = document.getElementById("shiftPostForm");
      const shiftResult = document.getElementById("shiftPostResult");
      const shiftVerifyPanel = document.getElementById("shiftVerificationPanel");
      const shiftManagerCard = document.getElementById("dancerShiftManager")?.closest(".dancer-manager-card");
      if (scheduleMount && shiftVerifyPanel && shiftVerifyPanel.parentElement !== scheduleMount) {
        scheduleMount.appendChild(shiftVerifyPanel);
      }
      if (scheduleMount && shiftForm && shiftForm.parentElement !== scheduleMount) {
        scheduleMount.appendChild(shiftForm);
        if (shiftResult) scheduleMount.appendChild(shiftResult);
      }
      if (scheduleMount && shiftManagerCard && shiftManagerCard.parentElement !== scheduleMount) {
        scheduleMount.appendChild(shiftManagerCard);
      }
      renderShiftVerificationPanel();
      renderDancerShiftManager();
      renderApprovedVisualProfileEditor();
    }

    function openAncestorDetails(target) {
      let node = target?.parentElement || null;
      while (node) {
        if (node.tagName === "DETAILS") node.open = true;
        node = node.parentElement;
      }
    }

    function findDancerFixTarget(targetKey = "") {
      if (!targetKey) return;
      const exact = document.querySelector(`[data-fix-anchor="${CSS.escape(targetKey)}"]`);
      if (exact) return exact;
      if (targetKey.startsWith("dancer-photo-")) {
        const targetId = targetKey.replace("dancer-photo-", "");
        const matchingPhoto = Array.from(document.querySelectorAll(".dancer-photo-review-card.is-rejected[data-fix-anchor]"))
          .find((card) => String(card.dataset.fixAnchor || "").includes(targetId));
        return matchingPhoto || document.querySelector(".dancer-photo-review-card.is-rejected") || document.querySelector('[data-fix-anchor="dancer-photo-review-card"]');
      }
      if (targetKey.startsWith("profile-")) {
        const platform = targetKey.replace("profile-", "");
        const input = document.getElementById(`profile${platform.charAt(0).toUpperCase()}${platform.slice(1)}`);
        return input?.closest(".social-edit-field, .field") || input || document.querySelector('[data-fix-anchor="profile-socials"]');
      }
      return null;
    }

    function jumpToDancerFixTarget(targetKey = "") {
      if (!targetKey) return;
      const panel = document.getElementById("approvedDancerPanel");
      panel?.removeAttribute("hidden");
      if (panel) panel.open = true;
      if (activeApprovedToolDropdown !== "edit") {
        activeApprovedToolDropdown = "edit";
        renderApprovedToolDropdowns();
      }
      const target = findDancerFixTarget(targetKey);
      if (!target) return;
      openAncestorDetails(target);
      target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      const highlightTarget = target.closest(".social-edit-field, .dancer-photo-review-card, .field") || target;
      highlightTarget.classList.add("dancer-fix-highlight");
      target.classList.add("dancer-fix-highlight");
      const focusTarget = target.matches?.("input, textarea, select, button") ? target : target.querySelector?.("input, textarea, select, button");
      if (typeof focusTarget?.focus === "function") focusTarget.focus({ preventScroll: true });
      window.setTimeout(() => {
        highlightTarget.classList.remove("dancer-fix-highlight");
        target.classList.remove("dancer-fix-highlight");
      }, 4200);
    }

    function buildRankingNotifications(profile, city, metrics) {
      const events = [];
      const rank = metrics.currentRank;
      if (rank === 1) {
        events.push({
          type: "rank-one",
          icon: "👑",
          title: "Reached #1 Trending",
          message: `You are now the #1 Trending dancer in ${city}.`
        });
      }
      if (rank && metrics.previousRank > 10 && rank <= 10) {
        events.push({
          type: "top-ten",
          icon: "🔥",
          title: "Entered Top 10",
          message: `You entered the Top 10 Trending dancers in ${city}.`
        });
      }
      if (rank && metrics.rankChangeYesterday >= 3) {
        events.push({
          type: "up",
          icon: "📈",
          title: "Significant rank increase",
          message: `You moved up ${metrics.rankChangeYesterday} positions and are now #${rank} Trending.`
        });
      }
      if (rank && metrics.firstTimeTrending) {
        events.push({
          type: "first",
          icon: "⭐",
          title: "First time trending",
          message: "You are now trending in your city."
        });
      }
      if (rank && metrics.biggestMover) {
        events.push({
          type: "mover",
          icon: "🚀",
          title: "Biggest mover",
          message: "You were one of today's fastest-rising dancers."
        });
      }
      if (!events.length) {
        events.push({
          type: "stable",
          icon: "⚡",
          title: "Rank watch active",
          message: `Keep posting shifts and sharing your profile to climb in ${city}.`
        });
      }
      return events.slice(0, 4);
    }

    function activeDancerProfile(city = activeDancerCity()) {
      const dancerName = activeDancerName();
      return discoveryMarket(city)?.dancers.find((profile) => profile.name === dancerName) || null;
    }

    function postedShiftStoreKey(city = activeDancerCity(), name = activeDancerName()) {
      return `${city}::${cleanDisplayValue(name)}`;
    }

    function locallyStoredPostedShifts(profile = null, city = activeDancerCity()) {
      const name = profile?.name || activeDancerName();
      const keyed = localPostedShiftStore.get(postedShiftStoreKey(city, name)) || [];
      return profile ? keyed : mergePostedShiftLists(keyed, localPostedShiftList);
    }

    function mergePostedShiftLists(primary = [], fallback = []) {
      const byId = new Map();
      [...primary, ...fallback].forEach((shift) => {
        if (!shift || shift.status === "cancelled") return;
        byId.set(String(shift.shiftId || byId.size), shift);
      });
      return [...byId.values()];
    }

    function saveLocalPostedShift(city, name, shift) {
      const key = postedShiftStoreKey(city, name);
      const existing = localPostedShiftStore.get(key) || [];
      localPostedShiftStore.set(key, mergePostedShiftLists(
        existing.filter((item) => String(item.shiftId) !== String(shift.shiftId)),
        [shift]
      ));
      localPostedShiftList = mergePostedShiftLists(
        localPostedShiftList.filter((item) => String(item.shiftId) !== String(shift.shiftId)),
        [shift]
      );
    }

    function removeLocalPostedShift(city, name, shiftId) {
      const key = postedShiftStoreKey(city, name);
      const existing = localPostedShiftStore.get(key) || [];
      localPostedShiftStore.set(key, existing.filter((shift) => String(shift.shiftId) !== String(shiftId)));
      localPostedShiftList = localPostedShiftList.filter((shift) => String(shift.shiftId) !== String(shiftId));
    }

    function profilePostedShifts(profile) {
      if (!profile) return [];
      if (!Array.isArray(profile.postedShifts)) {
        profile.postedShifts = profile.scheduled ? [{
          shiftId: profile.shiftId || `shift-${Date.now()}`,
          venue: profile.venue || "",
          time: profile.time || "",
          shiftDate: profile.shiftDate || "",
          shiftStart: profile.shiftStart || "",
          shiftEnd: profile.shiftEnd || "",
          shiftLabel: profile.shiftLabel || "",
          shiftStartsAt: profile.shiftStartsAt || "",
          shiftEndsAt: profile.shiftEndsAt || "",
          repeat: profile.repeat || "No repeat",
          notes: profile.notes || "",
          locationStatus: profile.locationStatus || "self_reported",
          checkedInAt: profile.checkedInAt || "",
          checkedOutAt: profile.checkedOutAt || "",
          locationVerificationExpiresAt: profile.locationVerificationExpiresAt || "",
          workingStatus: profile.workingStatus || "self_reported"
        }] : [];
      }
      profile.postedShifts = mergePostedShiftLists(profile.postedShifts, locallyStoredPostedShifts(profile, profile.city || activeDancerCity()));
      return profile.postedShifts.filter((shift) => shift && shift.status !== "cancelled");
    }

    function displayShiftForProfile(profile, city = activeDancerCity()) {
      const now = Date.now();
      const shifts = profilePostedShifts(profile)
        .filter((shift) => !shift.checkedOutAt && (!shift.shiftEndsAt || new Date(shift.shiftEndsAt).getTime() >= now))
        .sort((left, right) => new Date(left.shiftStartsAt || 0).getTime() - new Date(right.shiftStartsAt || 0).getTime());
      const live = shifts.find((shift) => {
        const startsAt = new Date(shift.shiftStartsAt || 0).getTime();
        const endsAt = new Date(shift.shiftEndsAt || 0).getTime();
        const expiresAt = Date.parse(shift.locationVerificationExpiresAt || "");
        const checkedIn = shift.locationStatus === "club_confirmed" || (
          shift.locationStatus === "location_confirmed" &&
          Number.isFinite(expiresAt) &&
          expiresAt > now
        );
        return checkedIn && startsAt <= now && endsAt >= now;
      });
      return live || shifts.find((shift) => new Date(shift.shiftEndsAt || 0).getTime() >= now) || null;
    }

    function applyDisplayShift(profile, city = activeDancerCity()) {
      const shift = displayShiftForProfile(profile, city);
      if (!shift) {
        Object.assign(profile, {
          scheduled: false,
          tonight: false,
          venue: "",
          time: "No upcoming shifts",
          shiftDate: "",
          shiftStart: "",
          shiftEnd: "",
          shiftLabel: "",
          shiftStartsAt: "",
          shiftEndsAt: "",
          shiftId: "",
          locationStatus: "self_reported",
          checkedInAt: "",
          checkedOutAt: "",
          locationVerificationExpiresAt: "",
          workingStatus: "self_reported"
        });
        return null;
      }
      Object.assign(profile, {
        scheduled: true,
        venue: shift.venue || "",
        time: shift.time || "",
        shiftDate: shift.shiftDate || "",
        shiftStart: shift.shiftStart || "",
        shiftEnd: shift.shiftEnd || "",
        shiftLabel: shift.shiftLabel || "",
        shiftStartsAt: shift.shiftStartsAt || "",
        shiftEndsAt: shift.shiftEndsAt || "",
        shiftId: shift.shiftId || "",
        repeat: shift.repeat || "No repeat",
        notes: shift.notes || "",
        locationStatus: shift.locationStatus || "self_reported",
        checkedInAt: shift.checkedInAt || "",
        checkedOutAt: shift.checkedOutAt || "",
        locationVerificationExpiresAt: shift.locationVerificationExpiresAt || "",
        workingStatus: shift.workingStatus || "self_reported"
      });
      profile.tonight = isWorkingTonight(profile, city);
      return shift;
    }

    function savedDancerSocials() {
      return Object.fromEntries(
        Object.entries(dancerSignupSocials).filter(([, url]) => Boolean(url))
      );
    }

    function ensureActiveDancerProfile(status = dancerSetup.approval ? "Verified" : "Pending") {
      const city = activeDancerCity();
      const market = discoveryMarket(city);
      if (!market) return null;
      const name = cleanDisplayValue(activeDancerName());
      const socials = savedDancerSocials();
      let profile = market.dancers.find((item) => item.name === name);
      const wasVerified = profile?.status === "Verified";
      const profileData = {
        name,
        isRealDancerAccount: true,
        status,
        isPublic: !dancerProfileIsHidden(profile),
        is_public: !dancerProfileIsHidden(profile),
        hidden: dancerProfileIsHidden(profile),
        city,
        venue: profile?.venue || "",
        time: profile?.time || "No upcoming shifts",
        tonight: profile?.tonight || false,
        scheduled: profile?.scheduled || false,
        postedShifts: profilePostedShifts(profile),
        trend: profile?.trend || 10,
        distance: profile?.distance || "0.0 mi",
        photoStatus: status === "Verified" ? "Approved" : "Pending",
        socials: { ...(profile?.socials || {}), ...socials }
      };
      if (profile) {
        Object.assign(profile, profileData);
      } else {
        profile = profileData;
        market.dancers.push(profile);
      }
      if (status === "Verified" && !wasVerified) {
        market.stats.dancers += 1;
      }
      return profile;
    }

    function dancerDashboardMetrics(profile, city = selectedCity()) {
      if (!profile) return null;
      const ranked = withTrendingRank(profile, city);
      const followers = followerNumber(profile, city);
      const newFollowers = firstRealMetric(profile, ["followersGained30Days", "newFollowers30", "newFollowers"]);
      const profileViews30 = firstRealMetric(profile, ["profileViews30Days", "profileViews30", "profileViews"]);
      const scheduleViews30 = firstRealMetric(profile, ["scheduleViews30Days", "scheduleViews30", "scheduleViews"]);
      const directionRequests30 = firstRealMetric(profile, ["directionRequests30Days", "directionRequests30", "directionRequests"]);
      const social = profile.socialClicks30Days || profile.socialClicks || {};
      const instagramClicks = firstRealMetric(social, ["instagram"]);
      const snapchatClicks = firstRealMetric(social, ["snapchat"]);
      const tiktokClicks = firstRealMetric(social, ["tiktok"]);
      const onlyfansClicks = firstRealMetric(social, ["onlyfans"]);
      const xClicks = firstRealMetric(social, ["x"]);
      const weeklyViews = Math.round(profileViews30 * 0.28);
      const weeklyFollowers = Math.round(newFollowers * 0.28);
      const weeklyInstagram = Math.round(instagramClicks * 0.3);
      const goingTonightClicks = firstRealMetric(profile, ["goingSignals30Days", "goingTonightClicks", "goingCount"]);
      const weeklyGoing = Math.round(goingTonightClicks * 0.28);
      const venue = profile.venue || discoveryMarket(city)?.venues[0]?.name || "Local venues";
      const venueRank = 0;
      const notificationOpens = firstRealMetric(profile, ["notificationsOpened30Days", "notificationOpens"]);
      const favoritesAdded = firstRealMetric(profile, ["favoritesAdded30Days", "favoritesAdded"]);
      const mediaLikes = firstRealMetric(profile, ["mediaLikes"]);
      const interestedClicks = firstRealMetric(profile, ["interestedClicks"]);
      const clubPageClicks = firstRealMetric(profile, ["clubPageClicks"]);
      const profileShares = firstRealMetric(profile, ["profileShares"]);
      const searchAppearances = firstRealMetric(profile, ["searchAppearances"]);
      const profileToFollowRate = Math.max(0, Math.round((newFollowers / Math.max(1, profileViews30)) * 1000) / 10);
      const scheduleToGoingRate = Math.max(0, Math.round((goingTonightClicks / Math.max(1, scheduleViews30)) * 1000) / 10);
      const directionRate = Math.max(0, Math.round((directionRequests30 / Math.max(1, scheduleViews30)) * 1000) / 10);
      const returningViewers = firstRealMetric(profile, ["returningViewers"]);
      const nearbyViews = firstRealMetric(profile, ["nearbyViews"]);
      const peakHourViews = firstRealMetric(profile, ["peakHourViews"]);
      const shiftReminderSaves = firstRealMetric(profile, ["shiftReminderSaves"]);
      const venueClicksFromProfile = firstRealMetric(profile, ["venueClicksFromProfile"]);
      const directionsAfterProfile = firstRealMetric(profile, ["directionsAfterProfile"]);
      const socialClickRate = Math.max(0, Math.round(((instagramClicks + snapchatClicks + tiktokClicks + onlyfansClicks + xClicks) / Math.max(1, profileViews30)) * 1000) / 10);
      const rankGain = 0;
      const currentRank = firstRealMetric(profile, ["currentRank", "trendRank"], ranked.trendRank || 0) || null;
      const previousRank = firstRealMetric(profile, ["previousRank"]);
      const rankChangeYesterday = firstRealMetric(profile, ["rankChangeSinceYesterday", "rankChangeYesterday"], previousRank && currentRank ? previousRank - currentRank : 0);
      const bestRankThisWeek = firstRealMetric(profile, ["bestRankThisWeek"]) || null;
      const highestRankAchieved = firstRealMetric(profile, ["highestRank", "highestRankAchieved"]) || null;
      const firstTimeTrending = Boolean(currentRank && firstRealMetric(profile, ["firstTimeTrending"]));
      const biggestMover = Boolean(currentRank && rankChangeYesterday >= 5);
      const rankTrend = rankTrendFromChange(rankChangeYesterday);
      const rankingSignal = rankingSignalLabel({
        profileViews30,
        scheduleViews30,
        newFollowers,
        notificationOpens,
        favoritesAdded,
        mediaLikes,
        goingTonightClicks
      });
      const rankingNotifications = buildRankingNotifications(profile, city, {
        currentRank,
        previousRank,
        rankChangeYesterday,
        firstTimeTrending,
        biggestMover
      });
      const dancrScore = Math.min(99, Math.max(0, Math.round(
        48 +
        Math.min(18, followers / 520) +
        Math.min(14, profileViews30 / 520) +
        Math.min(11, scheduleViews30 / 390) +
        Math.min(8, goingTonightClicks / 30)
      )));
      const weeklyStartRank = previousRank || currentRank || 0;
      const weeklyEndRank = currentRank || 0;
      const clubPerformance = [
        { name: venue, avgViews: firstRealMetric(profile, ["venueAverageViews"], 0) }
      ].filter((club, index, list) => list.findIndex((item) => item.name === club.name) === index);
      const profileCompleteness = profile.scheduled ? 96 : 84;
      return {
        ranked,
        signals: {},
        followers,
        notifications: notificationNumber(profile, city),
        notificationOpens,
        newFollowers,
        profileViews30,
        scheduleViews30,
        directionRequests30,
        favoritesAdded,
        interestedClicks,
        goingTonightClicks,
        clubPageClicks,
        profileShares,
        searchAppearances,
        profileToFollowRate,
        scheduleToGoingRate,
        directionRate,
        returningViewers,
        nearbyViews,
        peakHourViews,
        shiftReminderSaves,
        venueClicksFromProfile,
        directionsAfterProfile,
        socialClickRate,
        rankGain,
        currentRank,
        previousRank,
        rankChangeYesterday,
        bestRankThisWeek,
        highestRankAchieved,
        firstTimeTrending,
        biggestMover,
        rankTrend,
        rankingSignal,
        rankingNotifications,
        dancrScore,
        weeklyStartRank,
        weeklyEndRank,
        clubPerformance,
        profileCompleteness,
        instagramClicks,
        snapchatClicks,
        tiktokClicks,
        onlyfansClicks,
        xClicks,
        weeklyViews,
        weeklyFollowers,
        weeklyInstagram,
        weeklyGoing,
        venue,
        venueRank,
        streak: Math.max(2, 9 - Number(profile.trend || 6))
      };
    }

    function tonightInterestCount(profile) {
      if (goingTonightByProfile[profile.name] !== undefined) return goingTonightByProfile[profile.name];
      return firstRealMetric(profile, ["goingCount", "going_count"]);
    }

    function shiftStartMinutes(time) {
      const match = time.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
      if (!match) return Number.MAX_SAFE_INTEGER;
      let hours = Number(match[1]);
      const minutes = Number(match[2] || 0);
      const period = match[3].toUpperCase();
      if (period === "AM" && hours === 12) hours = 0;
      if (period === "PM" && hours !== 12) hours += 12;
      const total = (hours * 60) + minutes;
      return total < 360 ? total + 1440 : total;
    }

    function parseClockMinutes(value) {
      const match = String(value || "").match(/(\d{1,2})(?::(\d{2}))?\s*(A(?:M)?|P(?:M)?)/i);
      if (!match) return null;
      let hours = Number(match[1]);
      const minutes = Number(match[2] || 0);
      const period = match[3].toUpperCase();
      if (period.startsWith("A") && hours === 12) hours = 0;
      if (period.startsWith("P") && hours !== 12) hours += 12;
      return (hours * 60) + minutes;
    }

    function parseShiftRange(profile) {
      const parts = String(profile.time || "").split(/\s+-\s+/);
      if (parts.length !== 2) return null;
      const start = parseClockMinutes(parts[0]);
      let end = parseClockMinutes(parts[1]);
      if (start === null || end === null) return null;
      if (end <= start) end += 1440;
      return { start, end };
    }

    function selectedCity() {
      return citySelect?.value && discoveryMarket(citySelect.value) ? citySelect.value : "Las Vegas";
    }

    function discoveryLocationPhrase(city = selectedCity()) {
      if (city === ALL_CITIES) return "across all cities";
      return userLocationOutsideMarkets ? "near you" : `in ${city}`;
    }

    function escapeOptionValue(value) {
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }

    function selectedRadiusMiles() {
      const miles = Number.parseFloat(String(distanceSelect?.value || "25 mi"));
      return Number.isFinite(miles) ? miles : 25;
    }

    function parseMiles(value) {
      const miles = Number.parseFloat(String(value || "").replace(/[^\d.]/g, ""));
      return Number.isFinite(miles) ? miles : null;
    }

    function hasCoordinates(value) {
      const latitude = liveVenueCoordinate(value?.latitude, -90, 90);
      const longitude = liveVenueCoordinate(value?.longitude, -180, 180);
      return latitude !== null && longitude !== null;
    }

    function distanceMilesBetween(left, right) {
      if (!hasCoordinates(left) || !hasCoordinates(right)) return null;
      const toRadians = (degrees) => degrees * Math.PI / 180;
      const earthRadiusMiles = 3958.7613;
      const lat1 = toRadians(Number(left.latitude));
      const lat2 = toRadians(Number(right.latitude));
      const deltaLat = toRadians(Number(right.latitude) - Number(left.latitude));
      const deltaLng = toRadians(Number(right.longitude) - Number(left.longitude));
      const a =
        Math.sin(deltaLat / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
      return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function activeDistanceOrigin(city = selectedCity()) {
      return userLocation || cityCoordinates[city] || null;
    }

    function venueDistanceMiles(venue, city = selectedCity()) {
      const coordinateDistance = distanceMilesBetween(activeDistanceOrigin(city), venue);
      if (coordinateDistance !== null) return coordinateDistance;
      const numericDistance = venue?.distanceMiles == null || String(venue.distanceMiles).trim() === ""
        ? NaN : Number(venue.distanceMiles);
      if (Number.isFinite(numericDistance)) return numericDistance;
      return parseMiles(venue?.distance);
    }

    function formatDistanceMiles(miles) {
      if (!Number.isFinite(miles)) return "";
      if (miles < 0.1) return "less than 0.1 mi";
      if (miles < 10) return `${miles.toFixed(1)} mi`;
      return `${Math.round(miles)} mi`;
    }

    function venueDistanceLabel(venue, city = selectedCity()) {
      return formatDistanceMiles(venueDistanceMiles(venue, city)) || String(venue?.distance || "").trim() || "Distance unavailable";
    }

    function compareVenueDistance(left, right, city = selectedCity()) {
      const leftDistance = venueDistanceMiles(left, city);
      const rightDistance = venueDistanceMiles(right, city);
      if (Number.isFinite(leftDistance) && Number.isFinite(rightDistance) && leftDistance !== rightDistance) {
        return leftDistance - rightDistance;
      }
      if (Number.isFinite(leftDistance)) return -1;
      if (Number.isFinite(rightDistance)) return 1;
      return left.name.localeCompare(right.name);
    }

    function nearestCityForCoordinates(coords) {
      return Object.entries(cityCoordinates)
        .map(([city, coordinates]) => ({ city, miles: distanceMilesBetween(coords, coordinates) }))
        .filter((item) => Number.isFinite(item.miles))
        .sort((a, b) => a.miles - b.miles)[0] || null;
    }

    function requestVenuePosition() {
      return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error("Location permission is required for accurate venue distances."));
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (position) => resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy
          }),
          () => reject(new Error("Location permission is required for accurate venue distances.")),
          { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
        );
      });
    }

    function venueWithinSelectedRadius(venue) {
      if (selectedCity() === ALL_CITIES) return true;
      const miles = venueDistanceMiles(venue);
      return miles === null || miles <= selectedRadiusMiles();
    }

    function selectedVenueFilter() {
      return venueSelect?.value || "all";
    }

    function selectedHomeTvVenueFilter(city = selectedCity()) {
      const requestedVenueId = new URLSearchParams(window.location.search).get("tv_venue")?.trim() || "";
      if (requestedVenueId) {
        const requestedVenue = discoveryMarket(city)?.venues?.find((venue) => String(venue.id || "") === requestedVenueId);
        if (requestedVenue?.id) {
          return { id: String(requestedVenue.id), name: String(requestedVenue.name || "Venue") };
        }
      }
      const venueName = selectedVenueFilter();
      if (venueName === "all") return null;
      const venue = resolveVenueByName(venueName, city);
      return venue?.id ? { id: String(venue.id), name: String(venue.name || venueName) } : null;
    }

    function selectedHomeTvVideoId() {
      const videoId = new URLSearchParams(window.location.search).get("tv_video")?.trim() || "";
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(videoId)
        ? videoId
        : "";
    }

    function profileMatchesVenueFilter(profile) {
      const venueName = selectedVenueFilter();
      if (venueName === "all") return true;
      const venue = resolveVenueByName(venueName);
      return venue?.id && profile?.venueId
        ? profile.venueId === venue.id
        : profile?.venue === (venue?.name || venueName) && (!venue?.city || !profile?.city || venue.city === profile.city);
    }

    function venueMatchesCurrentFilter(venue) {
      const venueName = selectedVenueFilter();
      return !venue?.hidden && venueWithinSelectedRadius(venue) && (venueName === "all" || venue.id === venueName || venue.name === venueName);
    }

    function venueWorkingNowCount(venue, city = selectedCity()) {
      city = venue?.city || city;
      if (!venue?.name || !discoveryMarket(city)) return 0;
      return venueDancers(city, venue.name).filter((profile) => isWorkingTonight(profile, city)).length;
    }

    function venuePickerOptionMarkup(value, label, workingNowCount, selected) {
      const safeValue = escapeOptionValue(value);
      const safeLabel = escapeOptionValue(label);
      const liveLabel = workingNowCount ? `${workingNowCount} ${workingNowCount === 1 ? "dancer" : "dancers"} working now` : "";
      return `<button class="venue-picker-option" type="button" role="option" data-venue-picker-value="${safeValue}" aria-selected="${selected}" aria-label="${safeLabel}${liveLabel ? `, ${liveLabel}` : ""}"><span class="venue-picker-radio" aria-hidden="true"></span><span class="venue-picker-option-name">${safeLabel}</span>${workingNowCount ? `<span class="venue-picker-now" aria-hidden="true">${workingNowCount} NOW</span>` : ""}</button>`;
    }

    function syncVenuePickerSelection(value = venueSelect?.value || "all") {
      pendingVenueSelection = value;
      venueSelectOptions?.querySelectorAll("[data-venue-picker-value]").forEach((option) => {
        option.setAttribute("aria-selected", String(option.dataset.venuePickerValue === value));
      });
      const city = selectedCity();
      const venue = value === "all" ? null : resolveVenueByName(value, city);
      const workingNowCount = venueWorkingNowCount(venue, city);
      if (venueSelectButtonText) venueSelectButtonText.textContent = venue?.name || "All clubs";
      if (venueSelectButtonLive) {
        venueSelectButtonLive.textContent = `${workingNowCount} NOW`;
        venueSelectButtonLive.hidden = !workingNowCount;
      }
      if (venueSelectButton) venueSelectButton.setAttribute("aria-label", venue ? `${venue.name}${workingNowCount ? `, ${workingNowCount} ${workingNowCount === 1 ? "dancer" : "dancers"} working now` : ""}` : "All clubs");
    }

    function populateVenueSelect(city = selectedCity()) {
      if (!venueSelect || !discoveryMarket(city)) return;
      const previous = venueSelect.value || "all";
      const venues = discoveryMarket(city).venues
        .filter((venue) => !venue.hidden && venueWithinSelectedRadius(venue))
        .sort((a, b) => compareVenueDistance(a, b, city));
      const venueOptions = venues.map((venue) => ({
        venue,
        value: city === ALL_CITIES ? venue.id || venue.name : venue.name,
        label: city === ALL_CITIES && venue.city ? `${venue.name} · ${venue.city}` : venue.name,
        workingNowCount: venueWorkingNowCount(venue, city)
      }));
      venueSelect.innerHTML = [
        `<option value="all">All clubs</option>`,
        ...venueOptions.map(({ value, label, workingNowCount }) => `<option value="${escapeOptionValue(value)}" data-working-now="${Boolean(workingNowCount)}">${escapeOptionValue(label)}${workingNowCount ? ` · ${workingNowCount} NOW` : ""}</option>`)
      ].join("");
      venueSelect.value = venueOptions.some((option) => option.value === previous) ? previous : "all";
      if (venueSelectOptions) {
        venueSelectOptions.innerHTML = [
          venuePickerOptionMarkup("all", "All clubs", 0, venueSelect.value === "all"),
          ...venueOptions.map(({ value, label, workingNowCount }) => venuePickerOptionMarkup(value, label, workingNowCount, venueSelect.value === value))
        ].join("");
      }
      syncVenuePickerSelection(venueSelect.value);
    }

    function cityTimeZone(city = selectedCity()) {
      return timeZoneByCity[city] || Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Los_Angeles";
    }

    const cityWallClockFormatters = new Map();

    function cityWallClockFormatter(timeZone) {
      const cached = cityWallClockFormatters.get(timeZone);
      if (cached) return cached;
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
      });
      // Cache formatter configuration, never the current date or schedule result.
      if (cityWallClockFormatters.size >= 16) cityWallClockFormatters.delete(cityWallClockFormatters.keys().next().value);
      cityWallClockFormatters.set(timeZone, formatter);
      return formatter;
    }

    function cityWallClock(date = new Date(), city = selectedCity()) {
      const parts = cityWallClockFormatter(cityTimeZone(city)).formatToParts(date).reduce((acc, part) => {
        if (part.type !== "literal") acc[part.type] = part.value;
        return acc;
      }, {});
      const hour = Number(parts.hour) === 24 ? 0 : Number(parts.hour);
      return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), hour, Number(parts.minute), Number(parts.second)));
    }

    function wallDateValue(date) {
      return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
    }

    function dateValueToWallDate(dateValue) {
      return new Date(`${dateValue}T00:00:00Z`);
    }
