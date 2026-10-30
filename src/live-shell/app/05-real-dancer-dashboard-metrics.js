

    function realDancerDashboardMetrics(profile, city = selectedCity()) {
      const venue = profile?.venue || discoveryMarket(city)?.venues?.[0]?.name || "Local clubs";
      const metrics = {
        ranked: { ...(profile || {}), trendRank: null, trendScore: 0, trendSignals: {} },
        signals: {},
        followers: 0,
        notifications: 0,
        notificationsSent30Days: 0,
        notificationOpens: 0,
        newFollowers: 0,
        profileViewsToday: 0,
        profileViews30: 0,
        scheduleViews30: 0,
        directionRequests30: 0,
        favoritesAdded: 0,
        interestedClicks: 0,
        goingTonightClicks: 0,
        clubPageClicks: 0,
        profileShares: 0,
        searchAppearances: 0,
        profileToFollowRate: 0,
        scheduleToGoingRate: 0,
        directionRate: 0,
        returningViewers: 0,
        nearbyViews: 0,
        peakHourViews: 0,
        shiftReminderSaves: 0,
        venueClicksFromProfile: 0,
        directionsAfterProfile: 0,
        socialClickRate: 0,
        rankGain: 0,
        currentRank: null,
        previousRank: null,
        rankChangeYesterday: 0,
        bestRankThisWeek: null,
        highestRankAchieved: null,
        firstTimeTrending: false,
        biggestMover: false,
        rankTrend: "Stable",
        rankingSignal: "Profile activity",
        rankingNotifications: [],
        dancrScore: 0,
        weeklyStartRank: 0,
        weeklyEndRank: 0,
        clubPerformance: [],
        profileCompleteness: profile?.scheduled ? 96 : 84,
        instagramClicks: 0,
        snapchatClicks: 0,
        tiktokClicks: 0,
        onlyfansClicks: 0,
        xClicks: 0,
        weeklyViews: 0,
        weeklyFollowers: 0,
        weeklyInstagram: 0,
        weeklyGoing: 0,
        venue,
        venueRank: 0,
        streak: 0
      };
      return metrics;
    }

    function mergeLiveDancerDashboardMetrics(base, analytics, profile, city) {
      const realBase = realDancerDashboardMetrics(profile, city);
      if (!analytics) return realBase;
      const social = analytics.socialClicks30Days || {};
      const merged = {
        ...realBase,
        currentRank: liveMetricNumber(analytics.currentRank, 0) || null,
        highestRankAchieved: liveMetricNumber(analytics.highestRank, 0) || null,
        bestRankThisWeek: liveMetricNumber(analytics.bestRankThisWeek, 0) || null,
        rankChangeYesterday: liveMetricNumber(analytics.rankChangeSinceYesterday, 0),
        followers: liveMetricNumber(analytics.totalFollowers, 0),
        notifications: liveMetricNumber(analytics.notificationSubscribers, 0),
        notificationsSent30Days: liveMetricNumber(analytics.notificationsSent30Days, 0),
        profileViewsToday: liveMetricNumber(analytics.profileViewsToday, 0),
        profileViews30: liveMetricNumber(analytics.profileViews30Days, 0),
        newFollowers: liveMetricNumber(analytics.followersGained30Days, 0),
        scheduleViews30: liveMetricNumber(analytics.scheduleViews30Days, 0),
        directionRequests30: liveMetricNumber(analytics.directionRequests30Days, 0),
        goingTonightClicks: liveMetricNumber(analytics.goingSignals30Days, 0),
        favoritesAdded: liveMetricNumber(analytics.favoritesAdded30Days, 0),
        mediaLikes: liveMetricNumber(analytics.mediaLikes, 0),
        notificationOpens: liveMetricNumber(analytics.notificationsOpened30Days, 0),
        instagramClicks: liveMetricNumber(social.instagram, 0),
        snapchatClicks: liveMetricNumber(social.snapchat, 0),
        tiktokClicks: liveMetricNumber(social.tiktok, 0),
        onlyfansClicks: liveMetricNumber(social.onlyfans, 0),
        xClicks: liveMetricNumber(social.x, 0),
        clubPageClicks: 0,
        searchAppearances: 0,
        nearbyViews: 0,
        returningViewers: 0,
        peakHourViews: 0,
        clubPerformance: []
      };
      merged.previousRank = liveMetricNumber(analytics.previousRank, 0) || null;
      merged.weeklyStartRank = merged.previousRank || merged.currentRank || 0;
      merged.weeklyEndRank = merged.currentRank || 0;
      merged.rankTrend = rankTrendFromChange(merged.rankChangeYesterday);
      merged.weeklyViews = Math.round(merged.profileViews30 * 0.28);
      merged.weeklyFollowers = Math.round(merged.newFollowers * 0.28);
      merged.weeklyGoing = Math.round(merged.goingTonightClicks * 0.28);
      merged.weeklyInstagram = Math.round(merged.instagramClicks * 0.28);
      merged.profileToFollowRate = Math.max(0, Math.round((merged.newFollowers / Math.max(1, merged.profileViews30)) * 1000) / 10);
      merged.scheduleToGoingRate = Math.max(0, Math.round((merged.goingTonightClicks / Math.max(1, merged.scheduleViews30)) * 1000) / 10);
      merged.directionRate = Math.max(0, Math.round((merged.directionRequests30 / Math.max(1, merged.scheduleViews30)) * 1000) / 10);
      merged.socialClickRate = Math.max(0, Math.round(((merged.instagramClicks + merged.snapchatClicks + merged.tiktokClicks + merged.onlyfansClicks + merged.xClicks) / Math.max(1, merged.profileViews30)) * 1000) / 10);
      merged.rankingSignal = rankingSignalLabel({
        profileViews30: merged.profileViews30,
        scheduleViews30: merged.scheduleViews30,
        newFollowers: merged.newFollowers,
        notificationOpens: merged.notificationOpens,
        favoritesAdded: merged.favoritesAdded,
        goingTonightClicks: merged.goingTonightClicks
      });
      merged.rankingNotifications = [];
      merged.dancrScore = Math.min(99, Math.max(0, Math.round(
        48 +
        Math.min(18, merged.followers / 520) +
        Math.min(14, merged.profileViews30 / 520) +
        Math.min(11, merged.scheduleViews30 / 390) +
        Math.min(8, merged.goingTonightClicks / 30)
      )));
      return merged;
    }

    function liveVenueCoordinate(value, minimum, maximum) {
      if (value === null || value === undefined || String(value).trim() === "") return null;
      const coordinate = Number(value);
      return Number.isFinite(coordinate) && coordinate >= minimum && coordinate <= maximum
        ? coordinate
        : null;
    }

    function mapLiveVenue(item, city, venueShiftCounts) {
      city = String(item.city || city).trim();
      return {
        city,
        id: item.id,
        slug: item.slug,
        name: item.name,
        area: item.address || item.state || item.city || city,
        state: item.state || stateByCity[city] || "",
        address: item.address || "",
        phone: item.phone || "",
        website: item.website || "",
        hours: item.hoursLabel || "",
        openDays: item.openDays ?? item.open_days,
        weeklyHours: item.weeklyHours ?? item.weekly_hours,
        shifts: venueShiftCounts[item.name] || 0,
        distance: "",
        latitude: liveVenueCoordinate(item.latitude, -90, 90),
        longitude: liveVenueCoordinate(item.longitude, -180, 180),
        coverImageUrl: item.coverImageUrl || "",
        coverImageSrcSet: item.coverImageSrcSet || "",
        coverImageWidth: item.coverImageWidth || null,
        coverImageHeight: item.coverImageHeight || null,
        logoImageUrl: item.logoImageUrl || "",
        logoImageSrcSet: item.logoImageSrcSet || "",
        logoImageWidth: item.logoImageWidth || null,
        logoImageHeight: item.logoImageHeight || null,
        qrCodeUrl: item.qrCodeUrl || "",
        qrCodeLabel: item.qrCodeLabel || "",
        activeDeals: Array.isArray(item.activeDeals) ? item.activeDeals : item.activeDeal ? [item.activeDeal] : [],
        activeDeal: item.activeDeal || null,
        popularity: {
          followerCount: Math.max(0, Number(item.popularity?.followerCount) || 0),
          directionRequests30d: Math.max(0, Number(item.popularity?.directionRequests30d) || 0),
          profileViews30d: Math.max(0, Number(item.popularity?.profileViews30d) || 0)
        }
      };
    }

    function venuePreviewRequested() {
      const params = new URLSearchParams(window.location.search);
      return params.get("venue_preview") === "1" && Boolean(params.get("venue"));
    }

    function finishVenuePreviewBootstrap() {
      document.documentElement.classList.remove("venue-preview-bootstrap");
    }

    function fitVenueLogoImage(image) {
      // Shared fitting also handles cached images, resizing and dashboard logos.
      if (image instanceof HTMLImageElement) window.MydancrClubLogos?.fit(image);
    }

    function venueDashboardPreviewTime(value) {
      const raw = String(value || "").trim();
      if (!raw) return "";
      const time24 = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/);
      if (time24) {
        const hour24 = Number(time24[1]);
        if (!Number.isInteger(hour24) || hour24 < 0 || hour24 > 23) return "";
        const period = hour24 >= 12 ? "PM" : "AM";
        const hour12 = hour24 % 12 || 12;
        return `${hour12}:${time24[2]} ${period}`;
      }
      const time12 = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
      if (!time12) return "";
      const hour12 = Number(time12[1]);
      if (!Number.isInteger(hour12) || hour12 < 1 || hour12 > 12) return "";
      return `${hour12}:${time12[2] || "00"} ${time12[3].toUpperCase()}`;
    }

    function venueDashboardPreviewHours(profile) {
      const opensAt = venueDashboardPreviewTime(profile?.opensAt ?? profile?.opens_at);
      const closesAt = venueDashboardPreviewTime(profile?.closesAt ?? profile?.closes_at);
      return opensAt && closesAt ? `${opensAt} - ${closesAt}` : "";
    }

    async function applyVenueDashboardPreview(city, reference) {
      const params = new URLSearchParams(window.location.search);
      if (params.get("venue_preview") !== "1") return null;
      const venueId = String(params.get("venue_id") || "").trim();
      let data;
      if (isVenueSession()) {
        data = await getAuthenticatedJson("/api/venue/dashboard");
      } else if (isAdminSession()) {
        if (!venueId) throw new Error("Choose a club from Admin before opening its preview.");
        data = await getAuthenticatedJson(`/api/admin/venues/preview?venueId=${encodeURIComponent(venueId)}`);
      } else {
        throw new Error("Sign in as the club manager or a MyDancr administrator to open this preview.");
      }
      const profile = data?.profile;
      if (!profile?.slug || !profile?.name) throw new Error("Club preview is unavailable.");

      if (isAdminSession() && profile.id !== venueId) {
        throw new Error("This Admin preview does not match the selected club.");
      }

      const normalizedReference = slugify(String(reference || ""));
      if (normalizedReference && ![slugify(profile.slug), slugify(profile.name)].includes(normalizedReference)) {
        throw new Error("This preview does not belong to the signed-in club.");
      }

      const previewCity = String(profile.city || city || "").trim();
      if (!previewCity) throw new Error("Add the club city before opening its preview.");
      if (!markets[previewCity]) {
        markets[previewCity] = {
          stats: { dancers: 0, shifts: 0, venues: 0 },
          dancers: [],
          venues: []
        };
      }
      if (![...citySelect.options].some((option) => option.value === previewCity)) {
        const previewCityOption = document.createElement("option");
        previewCityOption.value = previewCity;
        previewCityOption.textContent = previewCity;
        citySelect.append(previewCityOption);
      }
      const market = markets[previewCity];

      const activeDeals = (Array.isArray(data.deals) ? data.deals : [])
        .filter((deal) => deal?.isActive === true);
      const previewRecord = mapLiveVenue({
        id: profile.id,
        slug: profile.slug,
        name: profile.name,
        city: previewCity,
        state: profile.state,
        address: profile.address,
        phone: profile.phone,
        website: profile.website,
        hoursLabel: venueDashboardPreviewHours(profile),
        openDays: profile.openDays ?? profile.open_days,
        weeklyHours: profile.weeklyHours ?? profile.weekly_hours,
        coverImageUrl: profile.coverImageUrl,
        coverImageSrcSet: profile.coverImageSrcSet,
        coverImageWidth: profile.coverImageWidth,
        coverImageHeight: profile.coverImageHeight,
        logoImageUrl: profile.logoImageUrl,
        logoImageSrcSet: profile.logoImageSrcSet,
        logoImageWidth: profile.logoImageWidth,
        logoImageHeight: profile.logoImageHeight,
        qrCodeUrl: profile.qrCodeUrl,
        qrCodeLabel: profile.qrCodeLabel,
        activeDeals,
        activeDeal: activeDeals[0] || (data.deal?.isActive === true ? data.deal : null),
        popularity: {
          followerCount: data.analytics?.totalFollowers,
          directionRequests30d: data.analytics?.directions30Days,
          profileViews30d: data.analytics?.pageViews30Days
        }
      }, previewCity, {});
      previewRecord.city = previewCity;
      const existing = market.venues.find((venue) => (
        venue.id === previewRecord.id || venue.slug === previewRecord.slug || venue.name === previewRecord.name
      ));
      const venue = existing ? mergePublicVenueRecords(previewRecord, existing) : previewRecord;
      venue.isDashboardPreview = true;
      venue.isPrivatePreview = profile.isActive !== true;
      if (existing) Object.assign(existing, venue);
      else market.venues.push(venue);
      market.stats.venues = market.venues.filter((item) => !item.hidden).length;
      citySelect.value = previewCity;
      return venue;
    }

    function publicVenueRecordScore(venue) {
      const canonicalSlug = slugify(venue?.name || "");
      return (
        (venue?.slug === canonicalSlug ? 32 : 0) +
        (venue?.id ? 16 : 0) +
        (venue?.coverImageUrl ? 12 : 0) +
        (venue?.activeDeal?.id ? 8 : 0) +
        (venue?.qrCodeUrl ? 4 : 0) +
        (venue?.address ? 2 : 0) +
        (venue?.hours ? 1 : 0)
      );
    }

    function mergePublicVenueRecords(preferred, alternate) {
      const preferredPopularity = preferred?.popularity || {};
      const alternatePopularity = alternate?.popularity || {};
      return {
        ...alternate,
        ...preferred,
        area: preferred?.area || alternate?.area || "",
        state: preferred?.state || alternate?.state || "",
        address: preferred?.address || alternate?.address || "",
        phone: preferred?.phone || alternate?.phone || "",
        website: preferred?.website || alternate?.website || "",
        hours: preferred?.hours || alternate?.hours || "",
        shifts: Math.max(Number(preferred?.shifts) || 0, Number(alternate?.shifts) || 0),
        distance: preferred?.distance || alternate?.distance || "",
        latitude: preferred?.latitude ?? alternate?.latitude ?? null,
        longitude: preferred?.longitude ?? alternate?.longitude ?? null,
        coverImageUrl: preferred?.coverImageUrl || alternate?.coverImageUrl || "",
        coverImageSrcSet: preferred?.coverImageSrcSet || alternate?.coverImageSrcSet || "",
        coverImageWidth: preferred?.coverImageWidth ?? alternate?.coverImageWidth ?? null,
        coverImageHeight: preferred?.coverImageHeight ?? alternate?.coverImageHeight ?? null,
        logoImageUrl: preferred?.logoImageUrl || alternate?.logoImageUrl || "",
        logoImageSrcSet: preferred?.logoImageSrcSet || alternate?.logoImageSrcSet || "",
        logoImageWidth: preferred?.logoImageWidth ?? alternate?.logoImageWidth ?? null,
        logoImageHeight: preferred?.logoImageHeight ?? alternate?.logoImageHeight ?? null,
        qrCodeUrl: preferred?.qrCodeUrl || alternate?.qrCodeUrl || "",
        qrCodeLabel: preferred?.qrCodeLabel || alternate?.qrCodeLabel || "",
        activeDeal: preferred?.activeDeal?.id ? preferred.activeDeal : alternate?.activeDeal || null,
        popularity: {
          followerCount: Math.max(Number(preferredPopularity.followerCount) || 0, Number(alternatePopularity.followerCount) || 0),
          directionRequests30d: Math.max(Number(preferredPopularity.directionRequests30d) || 0, Number(alternatePopularity.directionRequests30d) || 0),
          profileViews30d: Math.max(Number(preferredPopularity.profileViews30d) || 0, Number(alternatePopularity.profileViews30d) || 0)
        }
      };
    }

    function dedupePublicVenues(venues) {
      const uniqueVenues = new Map();
      venues.forEach((venue) => {
        const nameKey = String(venue?.name || "").trim().toLowerCase();
        const identity = nameKey || String(venue?.id || venue?.slug || "");
        const key = identity ? `${String(venue?.city || "").trim().toLowerCase()}:${identity}` : "";
        if (!key) return;
        const current = uniqueVenues.get(key);
        if (!current) {
          uniqueVenues.set(key, venue);
          return;
        }
        const preferred = publicVenueRecordScore(venue) > publicVenueRecordScore(current) ? venue : current;
        const alternate = preferred === venue ? current : venue;
        uniqueVenues.set(key, mergePublicVenueRecords(preferred, alternate));
      });
      return [...uniqueVenues.values()];
    }

    function mergeLiveVenues(existingVenues, liveVenues) {
      if (!liveVenues.length) return dedupePublicVenues(existingVenues);
      const merged = [...existingVenues];
      liveVenues.forEach((liveVenue) => {
        const matchIndex = merged.findIndex((venue) => (
          (liveVenue.id && venue.id === liveVenue.id) ||
          (liveVenue.slug && venue.slug === liveVenue.slug) ||
          venue.name === liveVenue.name
        ));
        if (matchIndex >= 0) {
          merged[matchIndex] = {
            ...merged[matchIndex],
            ...liveVenue,
            shifts: liveVenue.shifts || merged[matchIndex].shifts || 0,
            area: liveVenue.area || merged[matchIndex].area,
            address: liveVenue.address || merged[matchIndex].address || "",
            latitude: liveVenue.latitude ?? merged[matchIndex].latitude ?? null,
            longitude: liveVenue.longitude ?? merged[matchIndex].longitude ?? null
          };
        } else {
          merged.push(liveVenue);
        }
      });
      return dedupePublicVenues(merged);
    }

    function mergeAuthenticatedDancerIntoDiscovery(city, liveDancers) {
      if (!isDancerSession() || city !== activeDancerCity()) return liveDancers;
      const ownProfile = activeDancerProfile(city);
      if (!ownProfile) return liveDancers;
      const ownIndex = liveDancers.findIndex((profile) => (
        (ownProfile.id && profile.id === ownProfile.id) ||
        profile.name === ownProfile.name
      ));
      if (ownIndex < 0) return [...liveDancers, ownProfile];
      const privatePhotoState = {
        dancer_photos: Array.isArray(ownProfile.dancer_photos) ? ownProfile.dancer_photos : [],
        submittedPhotos: Array.isArray(ownProfile.submittedPhotos) ? ownProfile.submittedPhotos : [],
        deletedPhotoIds: Array.isArray(ownProfile.deletedPhotoIds) ? ownProfile.deletedPhotoIds : [],
        deletedPhotoStoragePaths: Array.isArray(ownProfile.deletedPhotoStoragePaths) ? ownProfile.deletedPhotoStoragePaths : [],
        deletedPhotoUrls: Array.isArray(ownProfile.deletedPhotoUrls) ? ownProfile.deletedPhotoUrls : [],
        mainPhotoUrl: ownProfile.mainPhotoUrl || liveDancers[ownIndex].mainPhotoUrl || "",
        mainPhotoFocalX: ownProfile.mainPhotoFocalX ?? liveDancers[ownIndex].mainPhotoFocalX ?? 50,
        mainPhotoFocalY: ownProfile.mainPhotoFocalY ?? liveDancers[ownIndex].mainPhotoFocalY ?? 50,
        avatarPhotoUrl: ownProfile.avatarPhotoUrl || liveDancers[ownIndex].avatarPhotoUrl || ownProfile.mainPhotoUrl || liveDancers[ownIndex].mainPhotoUrl || "",
        avatarPhotoFocalX: ownProfile.avatarPhotoFocalX ?? liveDancers[ownIndex].avatarPhotoFocalX ?? ownProfile.mainPhotoFocalX ?? 50,
        avatarPhotoFocalY: ownProfile.avatarPhotoFocalY ?? liveDancers[ownIndex].avatarPhotoFocalY ?? ownProfile.mainPhotoFocalY ?? 50,
        avatarPhotoSrcSet: ownProfile.avatarPhotoSrcSet || liveDancers[ownIndex].avatarPhotoSrcSet || ownProfile.mainPhotoSrcSet || "",
        galleryPhotoUrls: Array.isArray(ownProfile.galleryPhotoUrls) && ownProfile.galleryPhotoUrls.length
          ? ownProfile.galleryPhotoUrls
          : liveDancers[ownIndex].galleryPhotoUrls || []
      };
      Object.assign(ownProfile, liveDancers[ownIndex], privatePhotoState);
      liveDancers[ownIndex] = ownProfile;
      return liveDancers;
    }

    function applyLiveMarket(city, dancers, tonightDancers, venues) {
      const market = discoveryMarket(city);
      if (!market) return false;
      // Paged All cities results must not overwrite independently loaded city pages.
      if (city === ALL_CITIES && !market.pagination) {
        const cityNames = new Set([...Object.keys(markets), ...(dancers || []).map((item) => item.city), ...(venues || []).map((item) => item.city)]);
        cityNames.forEach((name) => {
          if (!name || name === ALL_CITIES) return;
          markets[name] ||= { stats: { dancers: 0, shifts: 0, venues: 0 }, dancers: [], venues: [] };
          applyLiveMarket(name, (dancers || []).filter((item) => item.city === name), (tonightDancers || []).filter((item) => item.city === name), (venues || []).filter((item) => item.city === name));
        });
      }
      const privatePreviewVenues = venuePreviewRequested()
        ? market.venues.filter((venue) => venue?.isDashboardPreview === true)
        : [];
      const tonightIds = new Set((tonightDancers || []).map((item) => item.id));
      const venueShiftCounts = {};
      const liveDancers = mergeAuthenticatedDancerIntoDiscovery(
        city,
        (dancers || []).map((item, index) => mapLiveDancer(item, tonightIds.has(item.id), index, venueShiftCounts))
      );
      const liveVenues = (venues || []).map((item) => mapLiveVenue(item, city, venueShiftCounts));

      market.dancers = liveDancers;
      market.venues = dedupePublicVenues([...liveVenues, ...privatePreviewVenues]);
      market.stats = {
        dancers: market.dancers.filter(isApprovedPublicProfile).length,
        shifts: market.dancers.filter((profile) => profile.scheduled).length,
        venues: market.venues.filter((venue) => !venue.hidden).length
      };
      followedByCity[city] = market.dancers.filter((profile) => followedDancerIds.has(profile.id)).map((profile) => profile.name);
      followedVenuesByCity[city] = followedVenuesByCity[city] || [];
      return liveDancers.length || liveVenues.length;
    }

    const LIVE_JSON_REQUEST_TIMEOUT_MS = 12000;
    const PUBLIC_DISCOVERY_REQUEST_RETRIES = 1;

    async function fetchJson(url, options = {}) {
      const timeoutMs = Number(options.timeoutMs) > 0
        ? Number(options.timeoutMs)
        : LIVE_JSON_REQUEST_TIMEOUT_MS;
      const retries = Math.max(0, Number(options.retries) || 0);
      const signal = options.signal;
      const abortError = new Error("The live request was canceled.");
      abortError.name = "AbortError";

      for (let attempt = 0; attempt <= retries; attempt += 1) {
        if (signal?.aborted) throw abortError;
        const controller = typeof AbortController === "function" ? new AbortController() : null;
        let timeoutId = null;
        let retryTimeoutId = null;
        let removeAbortListener = () => {};
        const abortRequest = new Promise((resolve, reject) => {
          if (!signal) return;
          const onAbort = () => {
            controller?.abort();
            reject(abortError);
          };
          signal.addEventListener("abort", onAbort, { once: true });
          removeAbortListener = () => signal.removeEventListener("abort", onAbort);
          if (signal.aborted) onAbort();
        });
        const timeoutError = new Error("The live request timed out.");
        timeoutError.name = "TimeoutError";
        const timeoutRequest = new Promise((resolve, reject) => {
          timeoutId = window.setTimeout(() => {
            if (controller) controller.abort();
            reject(timeoutError);
          }, timeoutMs);
        });

        try {
          const response = await Promise.race([
            fetch(url, {
              headers: { Accept: "application/json", ...options.headers },
              cache: options.cache === "no-store" || attempt > 0 ? "no-store" : "default",
              signal: controller ? controller.signal : undefined
            }),
            timeoutRequest,
            abortRequest
          ]);
          if (!response.ok) {
            const requestError = new Error(`Request failed: ${response.status}`);
            requestError.status = response.status;
            if (response.status === 403 && response.headers?.get("x-vercel-mitigated") === "challenge") {
              requestError.code = "BROWSER_VERIFICATION_REQUIRED";
            }
            throw requestError;
          }
          // The deadline includes the body: headers can arrive before a stalled download.
          return await Promise.race([response.json(), timeoutRequest, abortRequest]);
        } catch (error) {
          if (signal?.aborted) throw abortError;
          const status = Number(error?.status || 0);
          const retryable = !status || status === 429 || status >= 500;
          if (attempt >= retries || !retryable) throw error;
          await Promise.race([
            new Promise((resolve) => { retryTimeoutId = window.setTimeout(resolve, 250 * (attempt + 1)); }),
            abortRequest
          ]);
        } finally {
          if (timeoutId !== null) window.clearTimeout(timeoutId);
          if (retryTimeoutId !== null) window.clearTimeout(retryTimeoutId);
          removeAbortListener();
        }
      }

      throw new Error("The live request could not be completed.");
    }

    function dancerSignupCityOptionsMarkup(selectedCity = "") {
      const selectedKey = String(selectedCity || "").trim().toLocaleLowerCase("en-US");
      const placeholder = dancerSignupCitiesState === "error" ? "Cities temporarily unavailable" : "Select a city";
      return [
        `<option value="" disabled${selectedKey ? "" : " selected"}>${placeholder}</option>`,
        ...dancerSignupCities.map((city) => {
          const selected = city.value.toLocaleLowerCase("en-US") === selectedKey ? " selected" : "";
          return `<option value="${escapeHtml(city.value)}"${selected}>${escapeHtml(city.label)}</option>`;
        })
      ].join("");
    }

    function syncDancerSignupCitySelect(preferredCity = "") {
      const select = document.getElementById("setupCity");
      if (!select) return;
      const requestedCity = String(preferredCity || select.value || document.getElementById("dancerCity")?.value || pendingDancerSignupCity || "").trim();
      const matchingCity = dancerSignupCities.find((city) => city.value.toLocaleLowerCase("en-US") === requestedCity.toLocaleLowerCase("en-US"));
      select.innerHTML = dancerSignupCityOptionsMarkup(matchingCity?.value || "");
      select.disabled = dancerSignupCitiesState !== "ready";
      if (matchingCity) {
        select.value = matchingCity.value;
        pendingDancerSignupCity = matchingCity.value;
      }

      const note = document.getElementById("setupCityNote");
      if (note) {
        note.textContent = dancerSignupCitiesState === "error"
          ? "The live city list could not be loaded. Try again before saving your profile."
          : "Choose from active MyDancr club markets.";
      }
      const submit = document.querySelector("[data-setup-profile-save]");
      if (submit) submit.disabled = dancerSignupCitiesState !== "ready";
    }

    async function loadDancerSignupCities(options = {}) {
      if (dancerSignupCitiesState === "ready" && !options.force) {
        syncDancerSignupCitySelect();
        return dancerSignupCities;
      }
      if (dancerSignupCitiesRequest && !options.force) return dancerSignupCitiesRequest;

      dancerSignupCitiesState = "loading";
      syncDancerSignupCitySelect();
      dancerSignupCitiesRequest = fetchJson("/api/public/cities")
        .then((data) => {
          const cities = Array.isArray(data?.cities)
            ? data.cities.filter((city) => city && typeof city.value === "string" && typeof city.label === "string" && city.value.trim() && city.label.trim())
            : [];
          if (!cities.length) throw new Error("No dancer signup cities are available.");
          dancerSignupCities = cities;
          dancerSignupCities.forEach((city) => {
            const dancerCount = Number(city.dancerCount);
            const venueCount = Number(city.venueCount);
            if (Number.isInteger(dancerCount) && dancerCount >= 0 && Number.isInteger(venueCount) && venueCount >= 0) {
              cityDiscoveryStatsByName.set(city.value, { dancers: dancerCount, venues: venueCount });
            }
            if (!markets[city.value]) {
              markets[city.value] = {
                stats: { dancers: 0, shifts: 0, venues: 0 },
                dancers: [],
                venues: []
              };
            }
          });
          renderCityPickerOptions();
          dancerSignupCitiesState = "ready";
          syncDancerSignupCitySelect(pendingDancerSignupCity);
          if (dancerDashboard.classList.contains("show") && !dancerSetup.approval) renderDancerSetupWhenEditorIdle();
          return dancerSignupCities;
        })
        .catch((error) => {
          dancerSignupCities = [];
          dancerSignupCitiesState = "error";
          syncDancerSignupCitySelect();
          console.error("Unable to load dancer signup cities", error);
          return [];
        })
        .finally(() => {
          dancerSignupCitiesRequest = null;
        });
      return dancerSignupCitiesRequest;
    }

    function liveDiscoveryIsLoading(city = selectedCity()) {
      return liveMarketState[city] === "loading";
    }

    async function loadLiveDiscovery(city = selectedCity(), options = {}) {
      const market = discoveryMarket(city);
      if (!market) return;
      const requestedScope = discoveryRequestScope(city);
      const headers = discoveryRequestHeaders();
      const identity = JSON.stringify(headers);
      const cacheKey = JSON.stringify([city, requestedScope.key, identity]);
      if (options.force && options.cacheBust !== false) discoveryScopeCache.clear();
      const inFlight = market.discoveryRequest;
      if (inFlight && inFlight.cacheKey !== cacheKey) {
        // A new tab must not wait for the old tab's response or timeout.
        inFlight.canceled = true;
        inFlight.controller?.abort();
        liveMarketRefreshes.delete(city);
        liveMarketPendingRefreshes.delete(city);
        if (liveMarketState[city] === "loading") liveMarketState[city] = null;
        delete market.requestScopeKey;
        delete market.directoryFilterPending;
      }
      const cached = discoveryScopeCache.get(cacheKey);
      if (!options.force && !options.more && cached?.page && cached.expiresAt > Date.now()
        && market.pagination?.scopeKey !== requestedScope.key
        && liveMarketState[city] !== "loading" && !liveMarketRefreshes.has(city)) {
        market.pagination = { ...cached.page, loading: false, error: false };
        delete market.directoryFilterPending;
        applyLiveMarket(city, cached.page.dancers, cached.page.tonightDancers, cached.page.venues);
        liveMarketState[city] = "ready";
        if (citySelect.value === city) render();
        // Reuse only a recent matching scope, then recheck visibility and presence.
        return loadLiveDiscovery(city, { more: Boolean(cached.page.nextCursor), force: !cached.page.nextCursor, cacheBust: false, background: true });
      }
      const previous = market.pagination;
      const scopeChanged = Boolean(previous?.scopeKey && previous.scopeKey !== requestedScope.key);
      const more = Boolean(options.more && !scopeChanged);
      const force = Boolean(options.force || scopeChanged);
      const cacheBust = Boolean(options.force && options.cacheBust !== false);
      // A club can reuse its visible cards from the city directory while its
      // smaller, club-only roster is fetched. Never blank them on entry.
      const keepVenueResults = activeTab === "venues" && selectedVenueName && city === citySelect.value;
      const keepDirectoryResults = activeTab === "dancers" && city === citySelect.value
        && ["now", "not_now"].includes(previous?.filter)
        && previous.scopeKey === JSON.stringify([previous.filter, requestedScope.venue])
        && previous.identity === identity;
      const hasLoadedResults = liveMarketState[city] === "ready" || Boolean(previous?.pageCount)
        || Boolean(market.dancers?.length || market.venues?.length);
      const keepCurrentResults = hasLoadedResults && (!scopeChanged || keepVenueResults || keepDirectoryResults);
      const background = Boolean(options.background && keepCurrentResults);
      if (more && !previous?.nextCursor) return;
      if (liveMarketState[city] === "loading" || liveMarketRefreshes.has(city)) {
        if (options.force && options.cacheBust !== false || market.requestScopeKey !== requestedScope.key) liveMarketPendingRefreshes.add(city);
        return;
      }
      if (!more && !force && keepCurrentResults && liveMarketState[city] === "ready") return;
      const request = { cacheKey, controller: typeof AbortController === "function" ? new AbortController() : null, canceled: false };
      market.discoveryRequest = request;
      market.requestScopeKey = requestedScope.key;
      market.directoryFilterPending = Boolean(scopeChanged && keepDirectoryResults);
      if (keepCurrentResults) {
        liveMarketState[city] = "ready";
        liveMarketRefreshes.add(city);
      }
      else liveMarketState[city] = "loading";
      if (scopeChanged && !keepVenueResults && !keepDirectoryResults) market.dancers = [];
      if (previous) { previous.loading = more; previous.error = false; }
      if (scopeChanged && citySelect.value === city) render();
      if (more && citySelect.value === city) render();
      // Follow every continuation automatically, including on refresh. The API's
      // batch size must not become the directory's total or require a load-more click.
      let cursor = more ? previous.nextCursor : null;
      let pageCount = more ? previous.pageCount : 0;
      const startingPageCount = pageCount;
      let dancers = more ? [...previous.dancers] : [];
      let tonightDancers = more ? [...previous.tonightDancers] : [];
      let venues = more ? previous.venues : [];
      let statusCounts = more ? previous.statusCounts : null;
      const seenCursors = new Set();
      let savedRequested = false;
      const publishResults = (error = false) => {
        const loading = Boolean(cursor && !error);
        market.pagination = { scopeKey: requestedScope.key, filter: requestedScope.filter, identity, dancers, tonightDancers, venues, statusCounts, nextCursor: cursor, pageCount, loading, error };
        delete market.directoryFilterPending;
        if (loading) liveMarketRefreshes.add(city);
        applyLiveMarket(city, dancers, tonightDancers, venues);
        // Initial club links may resolve only once venue metadata arrives.
        if (citySelect.value === city && requestedScope.key !== discoveryRequestScope(city).key) liveMarketPendingRefreshes.add(city);
        liveMarketState[city] = "ready";
        if (citySelect.value === city) {
          render();
          if (customerDashboard.classList.contains("show")) renderDashboard();
          if (adminDashboard.classList.contains("show")) renderAdminDashboard();
        }
        if (isCustomerSession() && !background && !more && !savedRequested) {
          savedRequested = true;
          void loadLiveCustomerSaved();
        }
        if (!error) cacheDiscoveryScope(cacheKey, { page: market.pagination });
      };
      try {
        do {
          if (cursor && seenCursors.has(cursor)) throw new Error("Discovery pagination did not advance.");
          if (cursor) seenCursors.add(cursor);
          const params = new URLSearchParams({ city, filter: requestedScope.filter });
          if (requestedScope.venue) params.set("venue", requestedScope.venue);
          if (cursor) params.set("cursor", cursor);
          if (cacheBust) params.set("refresh", String(Date.now()));
          const query = params.toString();
          const prefetched = !cursor && !cacheBust && cached?.request && cached.expiresAt > Date.now() ? await cached.request : null;
          if (request.canceled) return;
          const discovery = prefetched || await fetchJson(`/api/public/discovery?${query}`, {
            headers, cache: "no-store",
            timeoutMs: LIVE_JSON_REQUEST_TIMEOUT_MS,
            retries: PUBLIC_DISCOVERY_REQUEST_RETRIES,
            signal: request.controller?.signal
          });
          if (request.canceled) return;
          if (discovery.ok === false || !Array.isArray(discovery.dancers)) throw new Error("Invalid discovery page.");
          if (discovery.nextCursor != null && (typeof discovery.nextCursor !== "string" || !discovery.nextCursor || discovery.nextCursor === cursor)) {
            throw new Error("Invalid discovery continuation.");
          }
          if (identity !== JSON.stringify(discoveryRequestHeaders())
            || citySelect.value === city && requestedScope.key !== discoveryRequestScope(city).key) {
            liveMarketPendingRefreshes.add(city);
            return;
          }
          dancers = mergeDiscoveryPageRows(dancers, discovery.dancers);
          tonightDancers = mergeDiscoveryPageRows(tonightDancers, discovery.tonightDancers || []);
          venues = discovery.venues || venues;
          if (["now", "not_now"].every(key => Number.isSafeInteger(discovery.statusCounts?.[key]) && discovery.statusCounts[key] >= 0)) {
            statusCounts = { now: discovery.statusCounts.now, not_now: discovery.statusCounts.not_now,
              ...(discovery.statusCounts.nowByVenue ? { nowByVenue: discovery.statusCounts.nowByVenue } : {}) };
          }
          cursor = discovery.nextCursor || null;
          pageCount += 1;
          // First visits can paint cards and begin image loading immediately.
          // Refreshes keep the complete existing list until its replacement is ready.
          if (cursor && (!keepCurrentResults || scopeChanged && keepDirectoryResults)) publishResults();
          // A shared club link becomes resolvable as soon as venue metadata
          // arrives. Switch to that roster instead of downloading the city.
          if (citySelect.value === city && requestedScope.key !== discoveryRequestScope(city).key) {
            liveMarketPendingRefreshes.add(city);
            return;
          }
        } while (cursor);
        publishResults();
        return true;
      } catch (error) {
        if (request.canceled) return;
        if (identity !== JSON.stringify(discoveryRequestHeaders())
          || citySelect.value === city && requestedScope.key !== discoveryRequestScope(city).key) {
          liveMarketPendingRefreshes.add(city);
          return;
        }
        if (cursor && Number(error?.status) === 409) liveMarketPendingRefreshes.add(city);
        if (previous) { previous.loading = false; previous.error = more; }
        // Keep successful batches and a retry cursor if a later request fails.
        // A background refresh still replaces the existing directory atomically.
        if (pageCount > startingPageCount && (!keepCurrentResults || more || scopeChanged && keepDirectoryResults)) {
          publishResults(true);
          console.warn("Some live discovery pages could not load", error);
          return;
        }
        if (keepCurrentResults) {
          liveMarketState[city] = "ready";
          console.warn("Live discovery refresh failed; keeping the current public results", error);
          if (market.directoryFilterPending) {
            delete market.directoryFilterPending;
            if (citySelect.value === city && activeTab === "dancers") {
              dancerDirectoryFilter = previous.filter;
              syncHomeDestinationLocation("dancers");
              showToast("Could not switch lists. Please try again.");
              render();
            }
          }
          if (more && citySelect.value === city) render();
          return;
        }
        const hasCurrentResults = Boolean(market.dancers?.length || market.venues?.length);
        liveMarketState[city] = hasCurrentResults ? "ready" : "error";
        console.warn("Live discovery unavailable", error);
        if (citySelect.value === city) render();
      } finally {
        if (market.discoveryRequest === request) {
          if (previous) previous.loading = false;
          liveMarketRefreshes.delete(city);
          delete market.requestScopeKey;
          delete market.discoveryRequest;
          if (liveMarketPendingRefreshes.delete(city)) {
            if (liveMarketState[city] === "loading") liveMarketState[city] = null;
            void loadLiveDiscovery(city, { force: true, cacheBust: true, background: true });
          } else if (citySelect.value === city && activeTab === "venues" && selectedVenueName) {
            // Settle a failed/partial roster after the in-flight flag is cleared.
            render();
          }
        }
      }
      return false;
    }

    function cacheDiscoveryScope(cacheKey, entry) {
      const now = Date.now();
      discoveryScopeCache.forEach((cached, key) => {
        if (cached.expiresAt <= now) discoveryScopeCache.delete(key);
      });
      discoveryScopeCache.delete(cacheKey);
      while (discoveryScopeCache.size >= DISCOVERY_SCOPE_CACHE_LIMIT) {
        discoveryScopeCache.delete(discoveryScopeCache.keys().next().value);
      }
      entry.expiresAt = now + DISCOVERY_SCOPE_CACHE_TTL_MS;
      discoveryScopeCache.set(cacheKey, entry);
    }

    function prefetchDancerDirectory(city) {
      const market = discoveryMarket(city);
      const scope = discoveryRequestScope(city);
      if (activeTab !== "dancers" || city !== citySelect.value || scope.venue
        || !["now", "not_now"].includes(scope.filter) || market?.pagination?.scopeKey !== scope.key) return;
      const filter = scope.filter === "now" ? "not_now" : "now";
      const scopeKey = JSON.stringify([filter, ""]);
      const headers = discoveryRequestHeaders();
      const identity = JSON.stringify(headers);
      const cacheKey = JSON.stringify([city, scopeKey, identity]);
      if (discoveryScopeCache.get(cacheKey)?.expiresAt > Date.now()) return;
      const entry = {};
      cacheDiscoveryScope(cacheKey, entry);
      // Warm only the opening batch. The selected tab owns all continuation work.
      entry.request = fetchJson(`/api/public/discovery?${new URLSearchParams({ city, filter })}`, {
        headers, cache: "no-store", timeoutMs: LIVE_JSON_REQUEST_TIMEOUT_MS
      }).then(discovery => {
        if (discoveryScopeCache.get(cacheKey) !== entry || identity !== JSON.stringify(discoveryRequestHeaders())) return null;
        if (discovery.ok === false || !Array.isArray(discovery.dancers)
          || discovery.nextCursor != null && (typeof discovery.nextCursor !== "string" || !discovery.nextCursor)) throw new Error("Invalid discovery page.");
        const statusCounts = ["now", "not_now"].every(key => Number.isSafeInteger(discovery.statusCounts?.[key]) && discovery.statusCounts[key] >= 0)
          ? { now: discovery.statusCounts.now, not_now: discovery.statusCounts.not_now,
            ...(discovery.statusCounts.nowByVenue ? { nowByVenue: discovery.statusCounts.nowByVenue } : {}) } : null;
        cacheDiscoveryScope(cacheKey, { page: {
          scopeKey, filter, identity, dancers: discovery.dancers, tonightDancers: discovery.tonightDancers || [],
          venues: discovery.venues || [], statusCounts, nextCursor: discovery.nextCursor || null, pageCount: 1, loading: false, error: false
        } });
        return discovery;
      }).catch(() => {
        if (discoveryScopeCache.get(cacheKey) === entry) discoveryScopeCache.delete(cacheKey);
        return null;
      });
    }

    function discoveryRequestScope(city) {
      const directory = activeTab === "dancers" && city === citySelect.value;
      const clubProfile = activeTab === "venues" && city === citySelect.value && selectedVenueName;
      const venueName = clubProfile || (directory ? selectedVenueFilter() : "all");
      const venue = venueName === "all" ? "" : resolveVenueByName(venueName, city)?.id || "";
      const filter = clubProfile ? "now" : directory ? (venue ? "now" : dancerDirectoryFilter) : "all";
      return { filter, venue, key: JSON.stringify([filter, venue]) };
    }

    function mergeDiscoveryPageRows(previous, incoming) {
      const rows = new Map(previous.map(row => [row.id, row]));
      incoming.forEach(row => rows.set(row.id, row));
      return [...rows.values()];
    }

    function hasMoreDiscovery(city = selectedCity()) {
      const page = discoveryMarket(city)?.pagination;
      return Boolean(page?.nextCursor && (!page.scopeKey || page.scopeKey === discoveryRequestScope(city).key));
    }

    function discoveryDancerCount(city, tab = "dancers") {
      if (userLocationOutsideMarkets) return null;
      const page = discoveryMarket(city)?.pagination;
      if (!page || page.scopeKey !== discoveryRequestScope(city).key || !hasMoreDiscovery(city)) return null;
      const totals = page.statusCounts;
      if (!Number.isSafeInteger(totals?.now) || !Number.isSafeInteger(totals?.not_now)) return null;
      return tab === "tonight" || page.filter === "now" ? totals.now
        : page.filter === "not_now" ? totals.not_now : totals.now + totals.not_now;
    }

    function discoveryPaginationMarkup(city) {
      const page = discoveryMarket(city)?.pagination;
      if (!hasMoreDiscovery(city)) return "";
      if (page.loading) return '<div class="dancer-directory-pagination" role="status">Loading remaining dancers…</div>';
      return `<div class="dancer-directory-pagination" aria-live="polite">
        <span>${page.error ? "More dancers could not load. Try again." : "More dancers are available."}</span>
        <button class="home-discovery-empty-action" type="button" data-more-live-discovery="${escapeHtml(city)}"${page.loading ? " disabled" : ""}>${page.loading ? "Loading dancers…" : page.error ? "Try again" : "Load more dancers"}</button>
      </div>`;
    }

    async function refreshPublicDiscoveryAfterAdminReview(profile, status) {
      if (status !== "approved") return;
      const city = profile?.city && markets[profile.city] ? profile.city : selectedCity();
      liveMarketState[city] = null;
      await loadLiveDiscovery(city, { force: true });
      if (citySelect.value === city) {
        render();
        if (customerDashboard.classList.contains("show")) renderDashboard();
      }
    }

    function slugify(value) {
      return value.toLowerCase().replaceAll(" ", "-").replace(/[^a-z0-9-]/g, "");
    }

    function loadTrendEventStore() {
      const fallback = {
        viewerId: `viewer-${Math.random().toString(36).slice(2)}`,
        profileViews: {},
        scheduleViews: {},
        favorites: {},
        interested: {},
        directionRequests: {},
        socialClicks: {}
      };
      try {
        const saved = JSON.parse(localStorage.getItem(trendEventStoreKey) || "null");
        return saved?.viewerId ? { ...fallback, ...saved } : fallback;
      } catch {
        return fallback;
      }
    }

    function saveTrendEventStore() {
      try {
        localStorage.setItem(trendEventStoreKey, JSON.stringify(trendEventStore));
      } catch {
        /* Local files may block storage in some browsers. */
      }
    }

    function trendKey(city, profileName) {
      return `${city}::${profileName}`;
    }

    function stableHash(value) {
      let hash = 2166136261;
      for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      return Math.abs(hash >>> 0);
    }

    function recordUniqueTrendEvent(type, city, profileName) {
      if (!trendEventStore[type]) trendEventStore[type] = {};
      const key = trendKey(city, profileName);
      if (!trendEventStore[type][key]) trendEventStore[type][key] = {};
      if (trendEventStore[type][key][trendEventStore.viewerId]) return;
      trendEventStore[type][key][trendEventStore.viewerId] = Date.now();
      saveTrendEventStore();
    }

    function uniqueTrendEventCount(type, city, profileName) {
      const events = trendEventStore[type]?.[trendKey(city, profileName)] || {};
      return Object.keys(events).length;
    }

    function cappedSignal(value, cap) {
      return Math.min(Math.max(0, value), cap);
    }

    function isFollowingProfile(city, profileName) {
      const profile = discoveryMarket(city)?.dancers.find((item) => item.name === profileName || item.id === profileName);
      return profile?.id ? followedDancerIds.has(profile.id) : (followedByCity[city] || []).includes(profileName);
    }

    function setProfileFollowed(city, profileName, following) {
      const profile = discoveryMarket(city)?.dancers.find((item) => item.name === profileName || item.id === profileName);
      if (profile?.id) {
        if (following) followedDancerIds.add(profile.id);
        else followedDancerIds.delete(profile.id);
      }
      const followed = followedByCity[city] || (followedByCity[city] = []);
      const index = followed.indexOf(profileName);
      if (following && index < 0) followed.push(profileName);
      if (!following && index >= 0) followed.splice(index, 1);
    }

    function isFavoritedProfile(city, profileName) {
      return (favoritedByCity[city] || []).includes(profileName);
    }

    function isNotificationOn(city, profileName) {
      return (notifiedByCity[city] || []).includes(profileName);
    }

    function enableProfileNotifications(city, profileName) {
      const notificationList = notifiedByCity[city] || (notifiedByCity[city] = []);
      if (!notificationList.includes(profileName)) notificationList.push(profileName);
      recordUniqueTrendEvent("interested", city, profileName);
    }

    function disableProfileNotifications(city, profileName) {
      const notificationList = notifiedByCity[city] || (notifiedByCity[city] = []);
      const index = notificationList.indexOf(profileName);
      if (index >= 0) notificationList.splice(index, 1);
    }

    function firstRealMetric(source, keys, fallback = 0) {
      for (const key of keys) {
        const value = source?.[key];
        if (value !== undefined && value !== null && value !== "") {
          const number = Number(value);
          return Number.isFinite(number) ? number : fallback;
        }
      }
      return fallback;
    }

    function followerNumber(profile) {
      return firstRealMetric(profile, ["followerCount", "followers", "totalFollowers"]);
    }

    function followerCount(profile, city = selectedCity()) {
      return `${followerNumber(profile, city).toLocaleString()} followers`;
    }

    function notificationNumber(profile, city = selectedCity()) {
      return firstRealMetric(profile, ["notificationCount", "notificationsEnabled", "notificationSubscribers"]);
    }

    function notificationCount(profile, city = selectedCity()) {
      return `${notificationNumber(profile, city).toLocaleString()} notifications enabled`;
    }

    function shiftRecipientCounts(profile, city = selectedCity()) {
      const followers = followerNumber(profile, city);
      const notifyOnly = Math.max(0, notificationNumber(profile, city) - followers);
      return {
        followers,
        notifyOnly,
        total: followers + notifyOnly
      };
    }

    function shiftNotificationMessage(profile, city = selectedCity(), dateValue = "") {
      const counts = shiftRecipientCounts(profile, city);
      const shiftType = isTonightDate(dateValue, city) ? "Now shift" : "Upcoming shift";
      return `${shiftType} sent to ${counts.total.toLocaleString()} guests: ${counts.followers.toLocaleString()} followers + ${counts.notifyOnly.toLocaleString()} notify-only guests.`;
    }

    function compactNumber(value) {
      return Number(value || 0).toLocaleString();
    }

    function moneyFromCents(value) {
      return `$${(Number(value || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    function readJoinedName(value, fallback = "Dancr club") {
      const row = Array.isArray(value) ? value[0] : value;
      return row?.name || row?.deal_title || fallback;
    }


    function metricPhraseMarkup(value) {
      const text = String(value || "");
      const match = text.match(/^([\d,.]+[KMB]?)\s+(.+)$/i);
      if (!match) return escapeHtml(text);
      return `<span class="metric-number">${escapeHtml(match[1])}</span><span class="metric-label">${escapeHtml(match[2])}</span>`;
    }

    function compactProfileMetric(value) {
      const number = Number(value || 0);
      if (number >= 1000000) return `${(number / 1000000).toFixed(number >= 10000000 ? 0 : 1).replace(/\.0$/, "")}M`;
      if (number >= 1000) return `${(number / 1000).toFixed(number >= 10000 ? 0 : 1).replace(/\.0$/, "")}K`;
      return number.toLocaleString();
    }

    function followerMetricMarkup(profile, city = selectedCity()) {
      if (profile.metricsUnavailable) return metricPhraseMarkup("— Followers");
      return metricPhraseMarkup(`${compactProfileMetric(followerNumber(profile, city))} Followers`);
    }

    function notificationMetricMarkup(profile, city = selectedCity()) {
      if (profile.metricsUnavailable) return metricPhraseMarkup("— Notifications");
      return metricPhraseMarkup(`${compactProfileMetric(notificationNumber(profile, city))} Notifications`);
    }

    function profileViewsToday(profile, city = selectedCity()) {
      return firstRealMetric(profile, ["profileViewsToday", "viewsToday", "todayProfileViews"]);
    }

    function profileViewsTodayMarkup(profile, city = selectedCity()) {
      if (profile.metricsUnavailable) return '<span class="profile-view-count">Activity counts temporarily unavailable</span>';
      return `
        <span class="profile-view-count">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"></path>
            <circle cx="12" cy="12" r="2.5"></circle>
          </svg>
          ${profileViewsToday(profile, city).toLocaleString()} profile views today
        </span>
      `;
    }

    function metricCardMarkup(value, label) {
      return `<div class="metric-card"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`;
    }

    function lockedMetricCards(labels) {
      return labels.map((label) => metricCardMarkup("Locked", label)).join("");
    }
