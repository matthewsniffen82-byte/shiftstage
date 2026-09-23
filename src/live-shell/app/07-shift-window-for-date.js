

    function shiftWindowForDate(profile, dateValue) {
      const range = parseShiftRange(profile);
      if (!range || !dateValue) return null;
      const startDate = dateValueToWallDate(dateValue);
      const start = new Date(startDate.getTime() + (range.start * 60000));
      const end = new Date(startDate.getTime() + (range.end * 60000));
      return { start, end };
    }

    function activeShiftWindow(profile, now = new Date(), city = selectedCity()) {
      city = profileDiscoveryCity(profile, city);
      if (!profile.scheduled || !profile.time) return null;
      const cityNow = cityWallClock(now, city);
      const yesterday = new Date(cityNow);
      yesterday.setUTCDate(cityNow.getUTCDate() - 1);
      const dates = profile.shiftDate
        ? [profile.shiftDate]
        : profile.tonight
          ? [
              wallDateValue(cityNow),
              wallDateValue(yesterday)
            ]
          : [];
      for (const dateValue of dates) {
        const window = shiftWindowForDate(profile, dateValue);
        if (window && cityNow >= window.start && cityNow <= window.end) return window;
      }
      return null;
    }

    function upcomingShiftWindow(profile, now = new Date(), city = selectedCity()) {
      city = profileDiscoveryCity(profile, city);
      if (!profile.scheduled || !profile.time) return null;
      const today = localDateValue(now, city);
      return shiftWindowForDate(profile, profile.shiftDate || (profile.tonight ? today : ""));
    }

    function goingTonightIsOpen(profile, now = new Date(), city = selectedCity()) {
      if (!profile.scheduled || !profile.time) return false;
      if (activeShiftWindow(profile, now, city)) return true;
      const today = localDateValue(now, city);
      if (profile.shiftDate) return profile.shiftDate === today;
      return Boolean(profile.tonight);
    }

    function shiftStatus(profile, city = selectedCity()) {
      city = profileDiscoveryCity(profile, city);
      const now = new Date();
      const activeWindow = activeShiftWindow(profile, now, city);
      if (activeWindow) return { state: "active", label: `${tonightInterestCount(profile).toLocaleString()} going` };
      if (goingTonightIsOpen(profile, now, city)) return { state: "active", label: `${tonightInterestCount(profile).toLocaleString()} going` };
      if (profile.tonight && profile.scheduled) {
        const window = upcomingShiftWindow(profile, now, city);
        if (window && cityWallClock(now, city) < window.start) {
          return { state: "active", label: `${tonightInterestCount(profile).toLocaleString()} going` };
        }
        return { state: "ended", label: "Shift ended" };
      }
      return { state: "inactive", label: "Not working now" };
    }

    function profileLocationStatusLabel(profile) {
      if (profile?.locationStatus === "club_confirmed") return "Club Confirmed";
      if (profile?.locationStatus === "location_confirmed") return "Checked In";
      if (profile?.checkedInAt && !profile?.checkedOutAt) return "Checked In";
      return "";
    }

    function profileLocationStatusBadge(profile) {
      const label = profileLocationStatusLabel(profile);
      if (!label) return "";
      const distance = Number(profile.checkinDistanceFeet);
      const title = Number.isFinite(distance)
        ? `${label} within ${Math.round(distance)} ft of ${profile.venue || "the venue"}`
        : `${label} near ${profile.venue || "the venue"}`;
      return `<span class="location-confirmed-badge" title="${escapeHtml(title)}">${escapeHtml(label)}</span>`;
    }

    function profileLocationStatusTile(profile, city = selectedCity()) {
      if (isWorkingTonight(profile, city)) return "";
      const label = profileLocationStatusLabel(profile);
      if (!label) return "";
      const distance = Number(profile.checkinDistanceFeet);
      const detail = Number.isFinite(distance)
        ? `Checked in within ${Math.round(distance)} ft of ${profile.venue || "the venue"}.`
        : `Checked in near ${profile.venue || "the venue"}.`;
      return `
        <div class="info-tile location-status-tile">
          <strong>${escapeHtml(label)}</strong>
          <div class="meta">${escapeHtml(detail)}</div>
        </div>
      `;
    }

    function tonightShiftWindow(profile, now = new Date(), city = selectedCity()) {
      city = profileDiscoveryCity(profile, city);
      if (!profile.scheduled || !profile.time) return null;
      const activeWindow = activeShiftWindow(profile, now, city);
      if (activeWindow) return activeWindow;
      const cityNow = cityWallClock(now, city);
      const today = wallDateValue(cityNow);
      const dateValue = profile.shiftDate || (profile.tonight ? today : "");
      const window = shiftWindowForDate(profile, dateValue);
      if (!window) return null;
      const shiftDayStart = dateValueToWallDate(dateValue);
      return cityNow >= shiftDayStart && cityNow <= window.end ? window : null;
    }

    function isWorkingTonight(profile, city = selectedCity()) {
      if (profile?.workingStatus === "ended" || profile?.endedAt || profile?.checkedOutAt) return false;
      return isShiftLocationVerificationCurrent(profile);
    }

    function todayValue(city = selectedCity()) {
      return localDateValue(new Date(), city);
    }

    function localDateValue(date = new Date(), city = selectedCity()) {
      return wallDateValue(cityWallClock(date, city));
    }

    function formatDateLabel(dateValue, city = selectedCity()) {
      if (!dateValue) return "Upcoming";
      const date = new Date(`${dateValue}T12:00:00Z`);
      const today = cityWallClock(new Date(), city);
      const todayDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
      const shiftDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
      const diffDays = Math.round((shiftDate - todayDate) / 86400000);
      if (diffDays === 0) return "Now";
      if (diffDays === 1) return "Tomorrow";
      return date.toLocaleDateString([], { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
    }

    function formatClock(timeValue) {
      if (!timeValue) return "";
      const [rawHours, minutes] = timeValue.split(":").map(Number);
      const period = rawHours >= 12 ? "p" : "a";
      const hours = rawHours % 12 || 12;
      return `${hours}:${String(minutes).padStart(2, "0")}${period}`;
    }

    function formatShiftTime(startValue, endValue) {
      return `${formatClock(startValue)} - ${formatClock(endValue)}`;
    }

    function postedShiftDateTimeLabel(shift, city = activeDancerCity()) {
      const dateLabel = shift.shiftDate
        ? new Date(`${shift.shiftDate}T12:00:00Z`).toLocaleDateString([], {
            timeZone: "UTC",
            weekday: "short",
            month: "short",
            day: "numeric"
          })
        : (shift.shiftLabel || "Date pending");
      return dateLabel;
    }

    function shortMeridiemTime(timeValue, omitZeroMinutes = false) {
      return String(timeValue || "").replace(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\b/gi, (_, hours, minutes = "", period) => {
        const minuteText = minutes && !(omitZeroMinutes && minutes === "00") ? `:${minutes}` : "";
        return `${hours}${minuteText}${period.toUpperCase() === "PM" ? "p" : "a"}`;
      });
    }

    function displayShiftTime(timeValue) {
      return shortMeridiemTime(timeValue).replace(/\s*-\s*/g, " - ").trim();
    }

    function displayPublicShiftTime(timeValue, profile = null) {
      if (profile && isWorkingTonight(profile) && profile.scheduled) {
        return "Working Now";
      }
      const dateLabel = compactUpcomingDateLabel(profile);
      if (dateLabel) return `Scheduled ${dateLabel}`;
      return profile?.scheduled ? "Schedule posted" : "";
    }

    function publicShiftStartTime(timeValue) {
      const raw = shortMeridiemTime(timeValue, true).trim();
      if (!raw) return "";
      const explicitStart = raw.match(/(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:a|p|am|pm)\b)/i)?.[1] || "";
      const compactStart = (explicitStart || raw
        .replace(/^Now\s*[·•]\s*/i, "")
        .replace(/^Tonight\s*[·•]\s*/i, "")
        .split(/\s*(?:-|–|—|\bto\b|\buntil\b)\s*/i)[0]
        .trim()).replace(/\s+/g, "");
      return compactStart.replace(/^(\d{1,2})(?::(\d{2}))?([ap])$/i, (_, hour, minute = "00", period) => `${Number(hour)}:${minute} ${period.toLowerCase() === "p" ? "PM" : "AM"}`);
    }

    function compactCardShiftTime(timeValue) {
      return shortMeridiemTime(timeValue, true)
        .replace(/\s*-\s*/g, "-")
        .replace(/\s+/g, " ")
        .trim();
    }

    function dateFromUpcomingLabel(label, city = selectedCity()) {
      if (!label) return null;
      const clean = String(label).trim().toLowerCase();
      const today = cityWallClock(new Date(), city);
      const date = new Date(today);
      if (clean === "tomorrow") {
        date.setUTCDate(today.getUTCDate() + 1);
        return date;
      }
      const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
      const target = weekdays.indexOf(clean);
      if (target === -1) return null;
      let diff = (target - today.getUTCDay() + 7) % 7;
      if (diff === 0) diff = 7;
      date.setUTCDate(today.getUTCDate() + diff);
      return date;
    }

    function upcomingDateForProfile(profile, city = selectedCity()) {
      city = profileDiscoveryCity(profile, city);
      if (profile.shiftDate) return dateValueToWallDate(profile.shiftDate);
      return dateFromUpcomingLabel(profile.shiftLabel, city);
    }

    function compactUpcomingDateLabel(profile, city = selectedCity()) {
      city = profileDiscoveryCity(profile, city);
      if (profile?.shiftStartsAt) {
        const start = new Date(profile.shiftStartsAt);
        if (!Number.isNaN(start.getTime())) {
          return `${start.getMonth() + 1}/${start.getDate()}`;
        }
      }
      const date = upcomingDateForProfile(profile || {}, city);
      if (date) return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
      const numeric = String(profile?.shiftLabel || "").match(/\b\d{1,2}\/\d{1,2}\b/);
      return numeric ? numeric[0] : "";
    }

    function upcomingSortValue(profile, city = selectedCity()) {
      city = profileDiscoveryCity(profile, city);
      if (!profile.scheduled) return Number.MAX_SAFE_INTEGER;
      if (isWorkingTonight(profile, city)) return shiftStartMinutes(profile.time);
      const date = upcomingDateForProfile(profile, city);
      if (!date) return Number.MAX_SAFE_INTEGER - 1;
      const range = parseShiftRange(profile);
      const startMinutes = range?.start ?? shiftStartMinutes(profile.time);
      return date.getTime() + (startMinutes * 60000);
    }

    function dailyRotationScore(profile, city = selectedCity()) {
      city = profileDiscoveryCity(profile, city);
      const seed = `${city}|${localDateValue(new Date(), city)}|${profile.name}`;
      let hash = 0;
      for (let index = 0; index < seed.length; index += 1) {
        hash = ((hash << 5) - hash + seed.charCodeAt(index)) | 0;
      }
      return Math.abs(hash);
    }

    function interleaveDancerCities(profiles) {
      const groups = new Map();
      profiles.forEach((profile) => {
        const city = profile.city || "";
        if (!groups.has(city)) groups.set(city, []);
        groups.get(city).push(profile);
      });
      const mixed = [];
      for (let index = 0; mixed.length < profiles.length; index += 1) {
        groups.forEach((group) => { if (group[index]) mixed.push(group[index]); });
      }
      return mixed;
    }

    function dancerDirectoryGroups(profiles, city = selectedCity()) {
      const workingNow = profiles
        .filter((profile) => isWorkingTonight(profile, city))
        .sort((a, b) => (
          shiftStartMinutes(a.time) - shiftStartMinutes(b.time) ||
          dailyRotationScore(a, city) - dailyRotationScore(b, city)
        ));
      const notWorkingNow = profiles
        .filter((profile) => !isWorkingTonight(profile, city))
        .sort((a, b) => dailyRotationScore(a, city) - dailyRotationScore(b, city));
      if (city === ALL_CITIES) return { workingNow: interleaveDancerCities(workingNow), notWorkingNow: interleaveDancerCities(notWorkingNow) };
      return { workingNow, notWorkingNow };
    }

    function dancerDirectoryProfiles(profiles, city = selectedCity()) {
      const groups = dancerDirectoryGroups(profiles, city);
      return [...groups.workingNow, ...groups.notWorkingNow];
    }

    function daysFromToday(date, city = selectedCity()) {
      const today = cityWallClock(new Date(), city);
      const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
      const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
      return Math.round((target - start) / 86400000);
    }

    function upcomingCardLabel(profile, city = selectedCity()) {
      city = profileDiscoveryCity(profile, city);
      const label = profile.shiftLabel || "Upcoming";
      const date = dateFromUpcomingLabel(label, city);
      if (!date) return "Date pending";
      return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
    }

    function upcomingFullLabel(profile, city = selectedCity()) {
      city = profileDiscoveryCity(profile, city);
      const label = profile.shiftLabel || "Upcoming";
      const date = dateFromUpcomingLabel(label, city);
      if (!date) return "Date pending";
      return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
    }

    function isTonightDate(dateValue, city = selectedCity()) {
      return dateValue === todayValue(city);
    }

    function privateTrendingSignals(profile, city = selectedCity()) {
      return {
        uniqueProfileViews: firstRealMetric(profile, ["profileViewsToday", "profile_views_today"]),
        followers: firstRealMetric(profile, ["followerCount", "follower_count", "followers", "totalFollowers"]),
        favorites: firstRealMetric(profile, ["favoritesAdded", "favoritesAdded30Days", "favoriteCount"]),
        goingTonight: tonightInterestCount(profile),
        interested: firstRealMetric(profile, ["interestedClicks", "notificationCount", "notification_count"]),
        scheduleViews: firstRealMetric(profile, ["scheduleViews30", "scheduleViews30Days"]),
        notificationOpens: firstRealMetric(profile, ["notificationOpens", "notificationsOpened30Days"]),
        clubPageClicks: firstRealMetric(profile, ["clubPageClicks", "clubPageClicks30Days"]),
        socialClicks: firstRealMetric(profile, ["socialClicks", "socialClicks30Days"]),
        directionRequests: firstRealMetric(profile, ["directionRequests30", "directionRequests30Days"]),
        recentActivity: firstRealMetric(profile, ["recentActivity"]),
        shiftBoost: 0,
        lowIntentRefreshes: firstRealMetric(profile, ["lowIntentRefreshes"]),
        repeatedClickRate: firstRealMetric(profile, ["repeatedClickRate"])
      };
    }

    function privateTrendingScore(profile, city = selectedCity()) {
      const signal = privateTrendingSignals(profile, city);
      const antiSpamPenalty = Math.min(180, signal.repeatedClickRate * 9 + signal.lowIntentRefreshes * 0.35);
      return Math.round(
        Math.log1p(signal.uniqueProfileViews) * 130 +
        Math.log1p(signal.followers) * 82 +
        Math.sqrt(signal.favorites) * 32 +
        signal.goingTonight * 7.6 +
        signal.interested * 4.2 +
        signal.scheduleViews * 1.25 +
        signal.notificationOpens * 1.55 +
        signal.clubPageClicks * 2.05 +
        signal.socialClicks * 1.85 +
        signal.directionRequests * 2.75 +
        signal.recentActivity * 5.4 +
        signal.shiftBoost -
        antiSpamPenalty
      );
    }

    function rankedTrendingProfiles(city) {
      return [];
    }

    function withTrendingRank(profile, city) {
      const ranked = rankedTrendingProfiles(city).find((item) => item.name === profile.name);
      if (!ranked || ranked.trendRank > 10) return { ...profile, trendRank: null, trendScore: 0, trendSignals: privateTrendingSignals(profile, city) };
      return { ...profile, trendRank: ranked.trendRank, trendScore: ranked.trendScore, trendSignals: ranked.trendSignals };
    }

    function followedProfiles(city) {
      const names = followedByCity[city] || [];
      return discoveryMarket(city).dancers
        .filter((profile) => names.includes(profile.name) && isApprovedPublicProfile(profile))
        .map((profile) => withTrendingRank(profile, city));
    }

    function followedVenues(city) {
      if (!isCustomerSession()) return [];
      return discoveryMarket(city).venues.filter((venue) =>
        (followedVenuesByCity[venue.city || city] || []).includes(venue.name) && !venue.hidden
      );
    }

    function isFollowingVenue(city, venueName) {
      return Boolean(
        isCustomerSession() &&
        (followedVenuesByCity[city] || []).includes(venueName)
      );
    }

    function activeDancerCity() {
      const city = document.getElementById("dancerCity").value.trim();
      return discoveryMarket(city) ? city : citySelect.value;
    }

    function activeDancerName() {
      return document.getElementById("dancerStageName").value.trim();
    }

    function displayText(value) {
      return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
    }

    function cleanDisplayValue(value) {
      return String(value).replace(/[<>"&]/g, "").trim();
    }

    function venueIconMarkup() {
      return '<span class="venue-dot" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 21s6-5.3 6-11a6 6 0 0 0-12 0c0 5.7 6 11 6 11Z"></path><circle cx="12" cy="10" r="2.2"></circle></svg></span>';
    }

    function clockIconMarkup() {
      return '<span class="venue-dot" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"></circle><path d="M12 7.5v5l3.2 2"></path></svg></span>';
    }

    function badgeIconMarkup(type) {
      if (type === "featured") {
        return '<span class="badge-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3l2.4 5.2 5.6.7-4.1 3.8 1.1 5.5-5-2.8-5 2.8 1.1-5.5L4 8.9l5.6-.7L12 3Z"></path></svg></span>';
      }
      return '<span class="badge-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.1.55-2 1.92-2 3.5 0 .83.34 1.5.5 2Z"></path><path d="M12 2c0 3-2 4-4 6s-3 4-3 6a7 7 0 0 0 14 0c0-2-1-4-3-6s-4-3-4-6Z"></path></svg></span>';
    }

    function actionIconMarkup(type) {
      const icons = {
        heart: '<svg viewBox="0 0 24 24"><path d="M20.8 8.6c0 5.3-8.8 10.4-8.8 10.4S3.2 13.9 3.2 8.6A4.6 4.6 0 0 1 12 6.7a4.6 4.6 0 0 1 8.8 1.9Z"></path></svg>',
        personPlus: '<svg viewBox="0 0 24 24"><circle cx="8.5" cy="7.5" r="3.5"></circle><path d="M3 20a5.5 5.5 0 0 1 11 0M18 8.5v6M15 11.5h6"></path></svg>',
        star: '<svg viewBox="0 0 24 24"><path d="M12 3l2.7 5.6 6.1.8-4.4 4.2 1.1 6-5.5-3-5.5 3 1.1-6-4.4-4.2 6.1-.8L12 3Z"></path></svg>',
        profile: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5"></circle><path d="M5.5 20a6.5 6.5 0 0 1 13 0"></path></svg>',
        venue: '<svg viewBox="0 0 24 24"><path d="M4 20V8.5L12 4l8 4.5V20"></path><path d="M8 20v-5h8v5"></path><path d="M8 10h.01M12 10h.01M16 10h.01"></path></svg>',
        clubProfile: '<svg viewBox="0 0 24 24"><path d="M5 20V9l7-4 7 4v11"></path><path d="M9 20v-6h6v6"></path></svg>',
        bell: '<svg viewBox="0 0 24 24"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7Z"></path><path d="M10 20a2 2 0 0 0 4 0"></path></svg>',
        clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"></circle><path d="M12 7.5v5l3.2 2"></path></svg>',
        calendar: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5.5" width="17" height="15" rx="2"></rect><path d="M7.5 3v5M16.5 3v5M3.5 10h17"></path></svg>',
        pin: '<svg viewBox="0 0 24 24"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"></path><circle cx="12" cy="10" r="2.5"></circle></svg>',
        car: '<svg viewBox="0 0 24 24"><path d="m5 11 1.7-4.3A2.7 2.7 0 0 1 9.2 5h5.6a2.7 2.7 0 0 1 2.5 1.7L19 11"></path><path d="M4 11h16a1 1 0 0 1 1 1v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5a1 1 0 0 1 1-1Z"></path><path d="M6.5 15h.01M17.5 15h.01M6 19v2M18 19v2"></path></svg>',
        check: '<svg viewBox="0 0 24 24"><path d="m5 12 4.2 4.2L19 6.5"></path></svg>',
        close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12"></path><path d="M18 6 6 18"></path></svg>',
        share: '<svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><path d="m8.6 10.7 6.8-4.4"></path><path d="m8.6 13.3 6.8 4.4"></path></svg>',
        report: '<svg viewBox="0 0 24 24"><path d="M5 21V4"></path><path d="M5 5h11l-1.8 3L16 11H5"></path></svg>',
        more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"></circle><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"></circle><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"></circle></svg>',
        profileQr: '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="7" height="7" rx=".8"></rect><rect x="13.5" y="3.5" width="7" height="7" rx=".8"></rect><rect x="3.5" y="13.5" width="7" height="7" rx=".8"></rect><path d="M14 14h2.5v2.5H14zM18.5 13.5h2v2M18 18h2.5v2.5H18M13.5 18.5H16V21"></path></svg>',
        qr: '<svg viewBox="0 0 24 24"><rect x="3.5" y="2.5" width="10" height="19" rx="2"></rect><path d="M7.4 18.5h2.2"></path><path d="M15.5 8.2a4.4 4.4 0 0 1 0 7.6"></path><path d="M18 5.5a7.5 7.5 0 0 1 0 13"></path></svg>',
        lock: '<svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3"></path></svg>'
      };
      const resolvedType = icons[type] ? type : "check";
      return `<span class="action-icon action-icon-${resolvedType}" data-action-icon="${resolvedType}" aria-hidden="true">${icons[resolvedType]}</span>`;
    }

    function clubDealQrSymbolMarkup(className = "") {
      const classes = ["club-deal-qr-symbol", className].filter(Boolean).join(" ");
      return `<span class="${classes}" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3.5" y="2.5" width="10" height="19" rx="2"></rect><path d="M7.4 18.5h2.2"></path><path d="M15.5 8.2a4.4 4.4 0 0 1 0 7.6"></path><path d="M18 5.5a7.5 7.5 0 0 1 0 13"></path></svg></span>`;
    }

    document.querySelectorAll("[data-quick-icon]").forEach((target) => {
      target.innerHTML = actionIconMarkup(target.dataset.quickIcon);
    });

    function actionButtonLabel(icon, label) {
      return `${actionIconMarkup(icon)}<span>${label}</span>`;
    }

    function homeFeedGoingActionMarkup(profile, active) {
      const count = Math.max(0, Number(tonightInterestCount(profile)) || 0);
      const countMarkup = count > 0
        ? `<span class="feed-card-action-count" title="${count.toLocaleString()} going">${compactNumber(count)}</span>`
        : "";
      return `${actionButtonLabel(active ? "check" : "clock", active ? "Going" : "I'm Going")}${countMarkup}`;
    }

    function socialIconMarkup(type) {
      const icons = {
        instagram: '<span class="social-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="5"></rect><circle cx="12" cy="12" r="3.4"></circle><path d="M17.2 6.8h.01"></path></svg></span>',
        tiktok: '<span class="social-icon fill" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M15.8 3c.3 2.5 1.8 4.1 4.2 4.4v3.2c-1.6 0-3-.5-4.2-1.4v6.1c0 3.3-2.3 5.7-5.5 5.7A5.2 5.2 0 0 1 5 15.8c0-3.1 2.4-5.4 5.5-5.4.4 0 .8 0 1.1.1v3.4a2.6 2.6 0 0 0-1.2-.3 2.1 2.1 0 0 0-2.1 2.2c0 1.3.9 2.2 2.1 2.2s2.1-.9 2.1-2.4V3h3.3Z"></path></svg></span>',
        snapchat: '<span class="social-icon fill" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3.2c2.7 0 4.6 2 4.6 4.8v2.5c0 .6.5.9 1.1 1.1.6.2 1.2.4 1.2.9 0 .6-.7.9-1.5 1.1-.4.1-.5.4-.3.8.6 1.1 1.5 1.8 2.7 2.1.3.1.4.5.2.8-.8.7-1.8.8-2.5.8-.5 0-.8.2-1.1.6-.6.7-1.3 1.1-2.2 1.1-.7 0-1.2-.2-1.7-.5a1.1 1.1 0 0 0-1.1 0c-.5.3-1 .5-1.7.5-.9 0-1.6-.4-2.2-1.1-.3-.4-.6-.6-1.1-.6-.7 0-1.7-.1-2.5-.8-.2-.3-.1-.7.2-.8 1.2-.3 2.1-1 2.7-2.1.2-.4.1-.7-.3-.8-.8-.2-1.5-.5-1.5-1.1 0-.5.6-.7 1.2-.9.6-.2 1.1-.5 1.1-1.1V8c0-2.8 1.9-4.8 4.6-4.8Z"></path></svg></span>',
        onlyfans: '<span class="social-icon fill" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="9.2" cy="12" r="5.4"></circle><circle cx="9.2" cy="12" r="2.15" fill="#050507"></circle><path d="M13.9 8.2h6.2c.5 0 .8.5.6 1l-1 2.2c-.1.3-.4.5-.7.5h-3.2l-1.1 3.9c-.1.4-.5.7-.9.7h-3.1l2.3-7.5c.1-.5.5-.8.9-.8Z"></path></svg></span>',
        x: '<span class="social-icon fill" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.451-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z"></path></svg></span>'
      };
      return icons[type] || "";
    }

    const socialPlatforms = [
      { key: "instagram", label: "Instagram", base: "https://instagram.com/", hosts: ["instagram.com", "www.instagram.com"] },
      { key: "tiktok", label: "TikTok", base: "https://tiktok.com/@", hosts: ["tiktok.com", "www.tiktok.com"] },
      { key: "snapchat", label: "Snapchat", base: "https://snapchat.com/add/", hosts: ["snapchat.com", "www.snapchat.com"] },
      { key: "onlyfans", label: "OnlyFans", base: "https://onlyfans.com/", hosts: ["onlyfans.com", "www.onlyfans.com"] },
      { key: "x", label: "X", base: "https://x.com/", hosts: ["x.com", "www.x.com", "twitter.com", "www.twitter.com"] }
    ];

    const sharePlatforms = socialPlatforms.filter((platform) => platform.key !== "onlyfans");

    function cleanSocialHandle(value) {
      return cleanDisplayValue(value)
        .replace(/^@+/, "")
        .replace(/[^a-zA-Z0-9._-]/g, "")
        .slice(0, 32);
    }

    function normalizeSocialInput(platformKey, value) {
      const raw = String(value || "").trim();
      if (!raw) return "";
      const platform = socialPlatforms.find((item) => item.key === platformKey);
      if (!platform) return "";
      if (/^https?:\/\//i.test(raw)) {
        try {
          const url = new URL(raw);
          if (!platform.hosts.includes(url.hostname.toLowerCase())) return "";
          return url.href;
        } catch {
          return "";
        }
      }
      const handle = cleanSocialHandle(raw);
      return handle ? `${platform.base}${handle}` : "";
    }

    function publicProfileBaseUrl() {
      if (window.location.protocol === "file:") {
        return "https://shiftstage.vercel.app/outputs/index.html";
      }
      return `${window.location.origin}${window.location.pathname}`;
    }

    function profileShareUrl(profileName, city = selectedCity(), assignedSlug = "") {
      const profile = discoveryMarket(city)?.dancers?.find((item) => item.name === profileName && isApprovedPublicProfile(item));
      const slug = assignedSlug || profile?.slug;
      if (slug && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return new URL(`/dancers/${slug}`, window.location.origin).toString();
      const url = new URL(publicProfileBaseUrl());
      url.searchParams.set("city", city);
      url.searchParams.set("profile", slugify(profileName));
      url.hash = "";
      return url.toString();
    }

    function profilePhotoShareUrl(profileName, city = selectedCity(), photoIndex = 0) {
      const url = new URL(profileShareUrl(profileName, city));
      url.searchParams.set("media", "photo");
      url.searchParams.set("mediaIndex", String(Math.max(0, Number(photoIndex) || 0)));
      return url.toString();
    }

    function qrCodeUrl(value) {
      return `/api/public/share-qr?url=${encodeURIComponent(value)}`;
    }

    function savedDealsStorageKey() {
      try {
        const session = JSON.parse(localStorage.getItem("dancrAuthSessionV1") || "null");
        const id = typeof session?.account?.id === "string" ? session.account.id.trim() : "";
        const userId = typeof session?.user?.id === "string" ? session.user.id.trim() : "";
        const accountId = id || userId;
        if (accountId) return `dancrSavedDealPassesV3:account:${encodeURIComponent(accountId)}`;
        if (session?.accessToken) return null;
        return "dancrSavedDealPassesV3:anonymous";
      } catch {
        return null;
      }
    }

    function loadSavedDealPasses() {
      try {
        const key = savedDealsStorageKey();
        if (!key) return [];
        // The legacy V2 list has no owner, so it must not enter any account.
        const saved = JSON.parse(localStorage.getItem(key) || "[]");
        return Array.isArray(saved) ? saved : [];
      } catch {
        return [];
      }
    }

    function saveSavedDealPasses() {
      try {
        const key = savedDealsStorageKey();
        if (!key || key !== savedDealPassesStorageKey) return false;
        const deviceOnlyPasses = savedDealPasses.filter((pass) => !pass.serverSaved);
        localStorage.setItem(key, JSON.stringify(deviceOnlyPasses));
        return true;
      } catch {
        return false;
      }
    }

    function savedDealsSeenStorageKey() {
      const account = authSession?.account || {};
      const identity = account.id || account.email || authSession?.user?.id || authSession?.email || "anonymous";
      return `mydancr:saved-deals-seen-at:${identity}`;
    }

    function savedDealsSeenAt() {
      try {
        const value = Number(localStorage.getItem(savedDealsSeenStorageKey()) || 0);
        return Number.isFinite(value) ? value : 0;
      } catch {
        return 0;
      }
    }

    function savedDealTimestamp(pass) {
      const rawValue = pass?.savedAt || pass?.generatedAt || pass?.preparedAt || 0;
      const value = typeof rawValue === "number" ? rawValue : Date.parse(rawValue);
      return Number.isFinite(value) ? value : 0;
    }

    function savedDealIsReady(pass) {
      const status = String(pass?.status || "generated").toLowerCase();
      if (["redeemed", "expired", "voided", "reversed"].includes(status)) return false;
      const expiresAt = typeof pass?.expiresAt === "number" ? pass.expiresAt : Date.parse(pass?.expiresAt || "");
      return !Number.isFinite(expiresAt) || expiresAt > Date.now();
    }

    function unseenSavedDealCount() {
      const seenAt = savedDealsSeenAt();
      return savedDealPasses.filter((pass) => savedDealIsReady(pass) && savedDealTimestamp(pass) > seenAt).length;
    }

    function syncCustomerDealQuickCta() {
      if (!customerDealQuickBtn || !customerDealQuickCount || !customerDealQuickCta) return;
      const count = isCustomerSession() ? unseenSavedDealCount() : 0;
      const hasNewDeal = count > 0;
      customerDealQuickCount.textContent = count > 99 ? "99+" : String(count);
      customerDealQuickCount.hidden = !hasNewDeal;
      customerDealQuickCta.textContent = count === 1 ? "New deal saved · Open" : `${count} new deals · Open`;
      customerDealQuickCta.hidden = !hasNewDeal;
      customerDealQuickBtn.classList.toggle("has-new-deal", hasNewDeal);
      customerDealQuickBtn.setAttribute("aria-label", hasNewDeal
        ? `${count} new saved ${count === 1 ? "Club Deal" : "Club Deals"}. Open saved Club Deals.`
        : "Open saved Club Deals");
    }

    function markSavedDealsSeen() {
      try {
        localStorage.setItem(savedDealsSeenStorageKey(), String(Date.now()));
      } catch {
        // The panel still opens if browser storage is unavailable.
      }
      syncCustomerDealQuickCta();
    }

    function mergeLiveCustomerSavedDeals(dealSaves) {
      if (!Array.isArray(dealSaves)) return;
      syncDeviceSavedDealPasses();
      const accountDeals = dealSaves
        .filter((item) => item?.deal?.id && item?.venue?.id)
        .map((item) => ({
          id: `nfc:${item.venue.id}:${item.deal.id}`,
          venueId: String(item.venue.id),
          venueSlug: String(item.venue.slug || ""),
          venueName: String(item.venue.name || "Venue"),
          dealId: String(item.deal.id),
          title: String(item.deal.title || "Club Deal"),
          description: String(item.deal.description || ""),
          terms: String(item.deal.terms || ""),
          offerType: String(item.deal.offerType || "admission"),
          sourceType: String(item.sourceType || "club_page"),
          dancerId: item.dancerId ? String(item.dancerId) : "",
          savedAt: item.savedAt || new Date().toISOString(),
          url: venueExperienceHref(item.venue),
          nfcIntent: true,
          serverSaved: true
        }));
      const accountIds = new Set(accountDeals.map((pass) => pass.id));
      const deviceOnlyDeals = savedDealPasses.filter((pass) => !pass.serverSaved && !accountIds.has(String(pass.id)));
      savedDealPasses = [...accountDeals, ...deviceOnlyDeals]
        .sort((left, right) => savedDealTimestamp(right) - savedDealTimestamp(left))
        .slice(0, 20);
      saveSavedDealPasses();
    }

    function mergeLiveCustomerDealPasses(redemptions) {
      if (!Array.isArray(redemptions) || !redemptions.length) return;
      const livePasses = redemptions
        .filter((item) => item?.id && item?.venue && item?.deal)
        .map((item) => ({
          id: String(item.id),
          venueId: String(item.venue?.id || ""),
          venueSlug: String(item.venue?.slug || ""),
          venueName: String(item.venue?.name || "Venue"),
          title: String(item.deal?.title || "Club Deal"),
          terms: item.deal?.terms ? String(item.deal.terms) : "",
          sourceType: String(item.sourceType || "club_page"),
          redemptionToken: String(item.redemptionToken || ""),
          status: String(item.status || "generated"),
          generatedAt: item.generatedAt || null,
          savedAt: item.generatedAt || new Date().toISOString(),
          expiresAt: item.expiresAt || null,
          redeemedAt: item.redeemedAt || null,
          serverGenerated: true
        }));
      if (!livePasses.length) return;
      const liveIds = new Set(livePasses.map((pass) => pass.id));
      savedDealPasses = [...livePasses, ...savedDealPasses.filter((pass) => !liveIds.has(String(pass.id)))]
        .sort((left, right) => savedDealTimestamp(right) - savedDealTimestamp(left))
        .slice(0, 20);
      saveSavedDealPasses();
    }

    function dealPassFileName(pass, extension = "png") {
      const venue = slugify(pass?.venueName || "club-deal") || "club-deal";
      const source = pass?.sourceType === "dancer_profile" && pass?.dancerName
        ? `-${slugify(pass.dancerName)}`
        : "";
      return `mydancr-${venue}${source}-qr.${extension}`;
    }

    function syncDeviceSavedDealPasses() {
      try {
        const key = savedDealsStorageKey();
        if (key !== savedDealPassesStorageKey) {
          savedDealPasses = [];
          savedDealPassesStorageKey = key;
        }
        const deviceDeals = key ? JSON.parse(localStorage.getItem(key) || "[]") : [];
        if (!Array.isArray(deviceDeals)) return;
        const accountDeals = savedDealPasses.filter((pass) => pass.serverSaved);
        const accountIds = new Set(accountDeals.map((pass) => pass.id));
        const localDeals = deviceDeals.filter((pass) => pass && typeof pass.id === "string" && !pass.serverSaved && !accountIds.has(pass.id));
        // Read without writing: another dashboard tab may just have removed a
        // device save. Do not restore it from this page's older in-memory list.
        savedDealPasses = [...accountDeals, ...localDeals]
          .sort((left, right) => savedDealTimestamp(right) - savedDealTimestamp(left));
      } catch {
        // Keep the current list when browser storage is temporarily unavailable.
      }
    }

    function venueExperienceHref(venue, city = selectedCity()) {
      const venueSlug = String(venue?.slug || slugify(venue?.name || "")).trim();
      const venueCity = String(venue?.city || city || selectedCity()).trim() || "Las Vegas";
      if (!venueSlug) return `/?city=${encodeURIComponent(venueCity)}`;
      const query = new URLSearchParams({
        city: venueCity,
        venue: venueSlug
      });
      return `/?${query.toString()}`;
    }

    function liveDealSessionId() {
      const key = "mydancrDealSessionV1";
      try {
        const existing = localStorage.getItem(key) || "";
        if (/^[0-9a-f-]{36}$/i.test(existing)) return existing;
        const next = crypto.randomUUID();
        localStorage.setItem(key, next);
        return next;
      } catch {
        return crypto.randomUUID();
      }
    }

    async function createRevenueDealPass({
      deal,
      venueId,
      venueSlug,
      venueName,
      sourceType = "club_page",
      dancerId = "",
      dancerName = "",
      attributionToken = ""
    }) {
      if (!deal?.id || !venueId) throw new Error("This Club Deal is unavailable.");
      const intent = {
        id: `nfc:${venueId}:${deal.id}`,
        venueId,
        venueSlug,
        venueName,
        dancerId,
        dancerName,
        sourceType,
        title: deal.dealTitle || "Club Deal",
        description: customerFacingDealDescription(deal.dealDescription),
        terms: deal.dealTerms || "",
        offerType: deal.offerType || "admission",
        bookingUrl: deal.bookingUrl || "",
        validDays: Array.isArray(deal.validDays) ? deal.validDays : [],
        validStartTime: deal.validStartTime || "",
        validEndTime: deal.validEndTime || "",
        dealId: deal.id,
        attributionToken: sourceType === "dancer_profile" ? attributionToken : "",
        details: sourceType === "dancer_profile"
          ? `Get an admission pass for ${venueName}; the dancer profile source is recorded securely.`
          : `Show your admission pass to staff at ${venueName}.`,
        url: venueExperienceHref({ slug: venueSlug, name: venueName }),
        nfcIntent: true,
        preparedAt: Date.now()
      };
      return intent;
    }

    function profileClubDealPassKey(config) {
      return [
        config?.deal?.id || "",
        config?.venueId || "",
        config?.dancerId || "",
        config?.attributionToken || ""
      ].join(":");
    }

    function isReusableProfileClubDealPass(entry, key) {
      if (!entry || entry.key !== key || !entry.pass) return false;
      const pass = entry.pass;
      return pass.nfcIntent === true && Date.now() - Number(pass.preparedAt || pass.savedAt || 0) < 12 * 60 * 60 * 1000;
    }

    function readReusableProfileClubDealPass(key) {
      if (isReusableProfileClubDealPass(activeProfileClubDealPassCache, key)) {
        return activeProfileClubDealPassCache.pass;
      }
      try {
        const stored = JSON.parse(sessionStorage.getItem("dancrActiveProfileClubDealNfcV1") || "null");
        if (isReusableProfileClubDealPass(stored, key)) {
          activeProfileClubDealPassCache = stored;
          return stored.pass;
        }
      } catch {
        // The intent is recreated when session storage is unavailable.
      }
      return null;
    }

    function cacheProfileClubDealPass(key, pass) {
      activeProfileClubDealPassCache = { key, pass };
      try {
        sessionStorage.setItem("dancrActiveProfileClubDealNfcV1", JSON.stringify(activeProfileClubDealPassCache));
      } catch {
        // The in-memory cache still prevents duplicate issuance during this page visit.
      }
    }

    async function hydrateProfileClubDealQr(root) {
      const tile = root?.querySelector?.("[data-profile-club-deal-config]");
      const qrButton = tile?.querySelector?.(".profile-club-deal-qr-button");
      if (!tile || !qrButton) return;
      const encodedConfig = tile.dataset.profileClubDealConfig || "";
      const config = decodeDealPass(encodedConfig);
      if (!config) return;
      const offers = clubDealOffers(config);
      if (offers.length > 1) {
        qrButton.dataset.clubDealCta = encodedConfig;
        qrButton.setAttribute("aria-label", `View free entry at ${config.venueName || "this club"}`);
        qrButton.innerHTML = `${clubDealQrSymbolMarkup("profile-club-deal-hub-symbol")}<span class="profile-club-deal-action-copy"><strong>Free Entry</strong></span>`;
        qrButton.disabled = false;
        tile.classList.add("is-ready", "has-multiple-offers");
        return;
      }
      const key = profileClubDealPassKey(config);
      tile.setAttribute("aria-busy", "true");
      try {
        const pass = readReusableProfileClubDealPass(key) || await createRevenueDealPass(config);
        cacheProfileClubDealPass(key, pass);
        if (!tile.isConnected || tile.dataset.profileClubDealConfig !== encodedConfig) return;
        qrButton.dataset.dealPass = encodeDealPass(pass);
        qrButton.removeAttribute("data-save-deal-pass-on-open");
        qrButton.setAttribute("aria-label", `View free entry at ${config.venueName || "this club"}`);
        qrButton.innerHTML = `${clubDealQrSymbolMarkup("profile-club-deal-nfc-symbol")}<span class="profile-club-deal-action-copy"><strong>Free Entry</strong></span>`;
        qrButton.disabled = false;
        tile.classList.add("is-ready");
        recordVenuePageEvent({
          venueId: pass.venueId,
          dancerId: pass.dancerId,
          eventType: "deal_view",
          source: "dancer_profile"
        });
      } catch (error) {
        if (!tile.isConnected || tile.dataset.profileClubDealConfig !== encodedConfig) return;
        tile.classList.add("is-error");
        qrButton.hidden = true;
        const label = tile.querySelector(".profile-club-deal-label");
        if (label) label.textContent = "Club Deal unavailable";
        tile.setAttribute("aria-label", error?.message || "Club Deal unavailable");
      } finally {
        if (tile.isConnected && tile.dataset.profileClubDealConfig === encodedConfig) {
          tile.removeAttribute("aria-busy");
        }
      }
    }

    function recordVenuePageEvent({ venueId, dancerId = null, eventType, source }) {
      if (!venueId) return;
      fetch("/api/public/venue-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          venueId,
          dancerId: dancerId || null,
          eventType,
          source,
          sessionId: trendEventStore.viewerId
        }),
        keepalive: true
      }).catch(() => null);
    }

    function encodeDealPass(pass) {
      return encodeURIComponent(JSON.stringify(pass));
    }

    function decodeDealPass(value) {
      try {
        return JSON.parse(decodeURIComponent(value));
      } catch {
        return null;
      }
    }

    function dealPassButtonMarkup(pass, className) {
      const sourceLabel = pass.sourceType === "dancer_profile" && pass.dancerName
        ? `Published while ${pass.dancerName} is working now`
        : `Published by ${pass.venueName}`;
      return `
        <button class="${className} deal-qr-trigger" type="button" data-deal-pass="${encodeDealPass(pass)}" aria-label="Prepare ${escapeHtml(pass.venueName)} admission pass">
          ${clubDealQrSymbolMarkup("saved-deal-nfc-symbol")}
          <span class="meta">${escapeHtml(sourceLabel)}</span>
        </button>
      `;
    }

    function savedDealPassMarkup(pass) {
      const sourceLabel = pass.sourceType === "dancer_profile" && pass.dancerName
        ? `From ${pass.dancerName}'s working-now profile`
        : "Club page";
      return `
        <button class="saved-deal-pass" type="button" data-deal-pass="${encodeDealPass(pass)}">
          <span>
            <strong>${escapeHtml(pass.title)}</strong>
            <span>${escapeHtml(pass.venueName)} · ${escapeHtml(sourceLabel)}</span>
          </span>
          ${clubDealQrSymbolMarkup("saved-deal-nfc-symbol")}
        </button>
      `;
    }

    async function persistCustomerDealSave(pass, saved) {
      if (!isCustomerSession() || !pass?.dealId) return false;
      const headers = authenticatedRequestHeaders("application/json");
      if (!headers) return false;
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 8_000);
      try {
        const response = await fetch("/api/customer/deal-saves", {
          method: "POST",
          headers,
          credentials: "same-origin",
          signal: controller.signal,
          body: JSON.stringify({
            dealId: pass.dealId,
            saved,
            sourceType: pass.sourceType === "dancer_profile" ? "dancer_profile" : "club_page",
            dancerId: pass.sourceType === "dancer_profile" ? pass.dancerId || null : null
          })
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || data?.ok !== true) throw apiRequestError(data, "Unable to save this deal.");
        applyResponseSession(data, headers);
        return data.persisted === true && data.saved === saved;
      } catch (error) {
        console.warn("Private Club Deal save unavailable; using device storage", error);
        return false;
      } finally {
        window.clearTimeout(timeoutId);
      }
    }
