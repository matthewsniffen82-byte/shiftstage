

    function realDancerDashboardMetrics(profile, city = selectedCity()) {
      const venue = profile?.venue || discoveryMarket(city)?.venues?.[0]?.name || "Local venues";
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
        clubPickupEnabled: item.clubPickupEnabled === true,
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

    function venueLogoFitTarget(image) {
      if (image.classList.contains("home-venue-discovery-logo")) {
        return { width: .82, height: .56, maxScale: 2.35 };
      }
      if (image.classList.contains("venue-detail-logo")) {
        return { width: .84, height: .62, maxScale: 2.8 };
      }
      return { width: .78, height: .58, maxScale: 2.5 };
    }

    function applyVenueLogoFit(image, scale, centerX = .5, centerY = .5) {
      const safeScale = Math.max(1, Number(scale) || 1);
      const shiftX = (.5 - centerX) * safeScale * 100;
      const shiftY = (.5 - centerY) * safeScale * 100;
      image.style.setProperty("--venue-logo-scale", safeScale.toFixed(3));
      image.style.setProperty("--venue-logo-shift-x", `${shiftX.toFixed(2)}%`);
      image.style.setProperty("--venue-logo-shift-y", `${shiftY.toFixed(2)}%`);
      image.classList.add("is-logo-auto-fitted");
    }

    function fitVenueLogoImage(image) {
      if (!(image instanceof HTMLImageElement)) return;
      const width = Number(image.naturalWidth || 0);
      const height = Number(image.naturalHeight || 0);
      if (!width || !height) return;
      const ratio = width / height;
      const target = venueLogoFitTarget(image);
      const fallbackScale = ratio >= .78 && ratio <= 1.28 ? Math.min(1.75, target.maxScale) : 1;

      try {
        const sampleScale = Math.min(1, 240 / Math.max(width, height));
        const sampleWidth = Math.max(1, Math.round(width * sampleScale));
        const sampleHeight = Math.max(1, Math.round(height * sampleScale));
        const canvas = document.createElement("canvas");
        canvas.width = sampleWidth;
        canvas.height = sampleHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) {
          applyVenueLogoFit(image, fallbackScale);
          return;
        }
        context.drawImage(image, 0, 0, sampleWidth, sampleHeight);
        const pixels = context.getImageData(0, 0, sampleWidth, sampleHeight).data;
        const cornerOffsets = [
          0,
          (sampleWidth - 1) * 4,
          (sampleHeight - 1) * sampleWidth * 4,
          ((sampleHeight * sampleWidth) - 1) * 4
        ];
        const background = cornerOffsets.reduce((sum, offset) => ({
          r: sum.r + pixels[offset],
          g: sum.g + pixels[offset + 1],
          b: sum.b + pixels[offset + 2],
          a: sum.a + pixels[offset + 3]
        }), { r: 0, g: 0, b: 0, a: 0 });
        Object.keys(background).forEach((key) => { background[key] /= cornerOffsets.length; });

        let minX = sampleWidth;
        let minY = sampleHeight;
        let maxX = -1;
        let maxY = -1;
        let contentPixels = 0;
        for (let y = 0; y < sampleHeight; y += 1) {
          for (let x = 0; x < sampleWidth; x += 1) {
            const offset = ((y * sampleWidth) + x) * 4;
            const alpha = pixels[offset + 3];
            if (alpha <= 18) continue;
            const redDelta = pixels[offset] - background.r;
            const greenDelta = pixels[offset + 1] - background.g;
            const blueDelta = pixels[offset + 2] - background.b;
            const colorDelta = Math.sqrt((redDelta ** 2) + (greenDelta ** 2) + (blueDelta ** 2));
            const alphaDelta = Math.abs(alpha - background.a);
            const isContent = background.a < 28 ? alpha >= 44 : colorDelta >= 52 || alphaDelta >= 52;
            if (!isContent) continue;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
            contentPixels += 1;
          }
        }

        if (contentPixels < sampleWidth * sampleHeight * .001 || maxX < minX || maxY < minY) {
          applyVenueLogoFit(image, fallbackScale);
          return;
        }
        const contentWidth = (maxX - minX + 1) / sampleWidth;
        const contentHeight = (maxY - minY + 1) / sampleHeight;
        const contentCenterX = ((minX + maxX + 1) / 2) / sampleWidth;
        const contentCenterY = ((minY + maxY + 1) / 2) / sampleHeight;
        const fittedScale = Math.min(
          target.maxScale,
          Math.max(1, Math.min(target.width / contentWidth, target.height / contentHeight))
        );
        applyVenueLogoFit(image, fittedScale, contentCenterX, contentCenterY);
      } catch {
        applyVenueLogoFit(image, fallbackScale);
      }
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
        if (!venueId) throw new Error("Choose a venue from Admin before opening its preview.");
        data = await getAuthenticatedJson(`/api/admin/venues/preview?venueId=${encodeURIComponent(venueId)}`);
      } else {
        throw new Error("Sign in as the venue manager or a MyDancr administrator to open this preview.");
      }
      const profile = data?.profile;
      if (!profile?.slug || !profile?.name) throw new Error("Venue preview is unavailable.");

      if (isAdminSession() && profile.id !== venueId) {
        throw new Error("This Admin preview does not match the selected venue.");
      }

      const normalizedReference = slugify(String(reference || ""));
      if (normalizedReference && ![slugify(profile.slug), slugify(profile.name)].includes(normalizedReference)) {
        throw new Error("This preview does not belong to the signed-in venue.");
      }

      const previewCity = String(profile.city || city || "").trim();
      if (!previewCity) throw new Error("Add the venue city before opening its preview.");
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
      if (city === ALL_CITIES) {
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
              headers: { Accept: "application/json" },
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
          : "Choose from active MyDancr venue markets.";
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
      const force = Boolean(options.force);
      const cacheBust = force && options.cacheBust !== false;
      const background = Boolean(options.background && liveMarketState[city] === "ready");
      if (!discoveryMarket(city)) return;
      if (liveMarketState[city] === "loading" || liveMarketRefreshes.has(city)) {
        // Publication or browser Back must not lose a fresh read behind an older request.
        if (cacheBust) liveMarketPendingRefreshes.add(city);
        return;
      }
      if (!force && liveMarketState[city] === "ready") return;
      if (background) liveMarketRefreshes.add(city);
      else liveMarketState[city] = "loading";
      const params = new URLSearchParams({ city });
      if (cacheBust) params.set("refresh", String(Date.now()));
      const query = params.toString();
      try {
        const discovery = await fetchJson(`/api/public/discovery?${query}`, {
          timeoutMs: LIVE_JSON_REQUEST_TIMEOUT_MS,
          retries: PUBLIC_DISCOVERY_REQUEST_RETRIES
        });
        applyLiveMarket(
          city,
          discovery.dancers || [],
          discovery.tonightDancers || [],
          discovery.venues || []
        );
        liveMarketState[city] = "ready";
        if (citySelect.value === city) {
          render();
          if (customerDashboard.classList.contains("show")) renderDashboard();
          if (adminDashboard.classList.contains("show")) renderAdminDashboard();
        }
        // Public results must not wait for a private account request. Background
        // refreshes also must not refetch saved state and render every card twice.
        if (isCustomerSession() && !background) void loadLiveCustomerSaved();
      } catch (error) {
        if (background) {
          liveMarketState[city] = "ready";
          console.warn("Live discovery refresh failed; keeping the current public results", error);
          return;
        }
        const hasCurrentResults = Boolean(discoveryMarket(city)?.dancers?.length || discoveryMarket(city)?.venues?.length);
        liveMarketState[city] = hasCurrentResults ? "ready" : "error";
        console.warn(
          hasCurrentResults
            ? "Live discovery unavailable; keeping the current public results"
            : "Live discovery unavailable; public dancer profiles hidden",
          error
        );
        if (citySelect.value === city) {
          render();
          if (customerDashboard.classList.contains("show")) renderDashboard();
          if (adminDashboard.classList.contains("show")) renderAdminDashboard();
        }
      } finally {
        liveMarketRefreshes.delete(city);
        if (liveMarketPendingRefreshes.delete(city)) {
          void loadLiveDiscovery(city, { force: true, cacheBust: true, background: true });
        }
      }
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

    function readJoinedName(value, fallback = "Dancr venue") {
      const row = Array.isArray(value) ? value[0] : value;
      return row?.name || row?.deal_title || fallback;
    }

    function dancerCommissionActivityMarkup(item) {
      const deal = escapeHtml(readJoinedName(item?.club_deals, "Profile QR deal"));
      const venue = escapeHtml(readJoinedName(item?.venues, "Venue"));
      const amount = moneyFromCents(item?.amount_cents);
      const status = escapeHtml(String(item?.status || "pending").replace(/_/g, " "));
      return `<article class="rank-event stable"><span class="rank-event-icon">$</span><span><strong>${amount} ${status}</strong><p>${deal} at ${venue}</p></span></article>`;
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
