    // An Internal roster hosts this same discovery viewer in an isolated frame.
    // Scoped profile data stays in memory and is never added to public discovery.
    const internalProfileFrameId = window.parent !== window
      ? new URLSearchParams(window.location.search).get("internal_profile") || "" : "";
    let internalRosterProfile = null;
    let internalProfileRevision = "";
    let internalProfileMediaIncomplete = false;
    let internalProfileLoadSequence = 0;
    let internalProfileTargetId = "";
    let internalProfileToken = "";
    let internalProfileMediaController = new AbortController();
    let internalTableRequest = null;
    let internalVipRequest = null;
    let internalProfileActivity = {};
    const internalProfileMedia = new Map();

    function internalProfileMatches(reference) {
      return internalRosterProfile && [internalRosterProfile.id, internalRosterProfile.slug, internalRosterProfile.name]
        .includes(String(reference || "").trim()) ? internalRosterProfile : null;
    }

    async function internalProfileMediaUrl(kind, id, token, revision = "", width = 0) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return "";
      const path = `/api/internal/${kind}/${id}${width ? `?width=${width}` : ""}`;
      if (token) return new URL(`${path}${width ? "&" : "?"}token=${encodeURIComponent(token)}&revision=${encodeURIComponent(revision)}`, window.location.origin).toString();
      // Staff media uses their existing venue session, never a public storage URL.
      const key = `${path}:${revision}`;
      if (!internalProfileMedia.has(key)) {
        const session = authSession;
        if (!session?.accessToken) return "";
        const headers = { authorization: `Bearer ${session.accessToken}` };
        if (session.refreshToken) headers["x-dancr-refresh-token"] = session.refreshToken;
        const scope = internalProfileMediaController;
        const controller = new AbortController();
        const cancel = () => controller.abort();
        scope.signal.addEventListener("abort", cancel, { once: true });
        const timeout = window.setTimeout(cancel, 15000);
        const request = fetch(path, { headers, cache: "no-store", signal: controller.signal })
          .then(response => { if (!response.ok) throw new Error("Media unavailable."); return response.blob(); })
          .then(blob => !controller.signal.aborted && authSession?.accessToken === session.accessToken ? URL.createObjectURL(blob) : "")
          .catch(() => { if (internalProfileMedia.get(key) === request) internalProfileMedia.delete(key); return ""; })
          .finally(() => { window.clearTimeout(timeout); scope.signal.removeEventListener("abort", cancel); });
        internalProfileMedia.set(key, request);
      }
      return internalProfileMedia.get(key);
    }

    // Customer cards use the same warm viewer, but only the public profile API
    // can supply their content. They never enter the staff media path.
    async function openPublicProfileMessage(event) {
      if (internalProfileFrameId !== "viewer" || event.origin !== window.location.origin || event.source !== window.parent
        || event.data?.type !== "mydancr:public-profile-open"
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(event.data.profileId || "")
        || typeof event.data.slug !== "string" || !event.data.slug || event.data.slug.length > 200) return;
      const { profileId, slug } = event.data;
      const revision = `public:${profileId}:${slug}`;
      const vipRequest = event.data.vipRequest;
      const nextVipRequest = vipRequest && typeof vipRequest.added === "boolean" && typeof vipRequest.disabled === "boolean"
        ? { added: vipRequest.added, disabled: vipRequest.disabled, message: String(vipRequest.message || "").slice(0, 500) } : null;
      if (internalProfileRevision === revision) {
        internalVipRequest = nextVipRequest;
        syncVipProfileRequestUi();
        return;
      }
      if (internalProfileTargetId) closeProfileModal();
      internalProfileTargetId = profileId;
      internalProfileRevision = revision;
      internalVipRequest = nextVipRequest;
      const sequence = ++internalProfileLoadSequence;
      const controller = internalProfileMediaController;
      const timeout = window.setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(`/api/public/dancers/${encodeURIComponent(slug)}`, {
          cache: "no-store", credentials: "same-origin", signal: controller.signal,
        });
        const payload = response.ok ? await response.json() : null;
        if (sequence !== internalProfileLoadSequence) return;
        const source = payload?.profile;
        if (controller.signal.aborted || !payload?.ok || source?.id !== profileId || source.verified !== true) throw new Error("Profile unavailable.");
        const city = String(source.city || selectedCity()).trim();
        if (!discoveryMarket(city)) markets[city] = { stats: { dancers: 0, shifts: 0, venues: 0 }, dancers: [], venues: [] };
        if (![...citySelect.options].some(option => option.value === city)) {
          const option = document.createElement("option");
          option.value = city; option.textContent = city; citySelect.append(option);
        }
        internalRosterProfile = {
          ...mapLiveDancer(source, isWorkingTonight(source, city), 0, {}),
          dashboardProfile: true,
          vipProfile: Boolean(internalVipRequest),
        };
        citySelect.value = city;
        // Start with the confirmed saved state already loaded by the dashboard.
        // These flags only paint controls; every action still uses its normal API.
        const actions = event.data.actions || {};
        setProfileFollowed(city, internalRosterProfile.name, actions.following === true);
        if (actions.following === true && actions.notificationsEnabled === true) enableProfileNotifications(city, internalRosterProfile.name);
        else disableProfileNotifications(city, internalRosterProfile.name);
        goingTonightSavedByProfile[internalRosterProfile.name] = actions.going === true;
        document.body.dataset.internalProfileAudience = "public";
        delete document.body.dataset.venueGuestColor;
        document.body.style.removeProperty("--venue-guest-accent");
        document.body.style.removeProperty("--venue-guest-on-accent");
        openProfileModal(profileId);
        document.documentElement.classList.add("internal-profile-ready");
        window.parent.postMessage({ type: "mydancr:internal-profile-shown", profileId }, window.location.origin);
      } catch (error) {
        if (sequence === internalProfileLoadSequence) throw error;
      } finally {
        window.clearTimeout(timeout);
      }
    }

    async function openInternalProfileMessage(event) {
      if (!internalProfileFrameId || event.origin !== window.location.origin || event.source !== window.parent
        || event.data?.type !== "mydancr:internal-profile-open"
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(event.data?.profile?.id || "")
        || (internalProfileFrameId !== "viewer" && event.data.profile.id !== internalProfileFrameId)) return;
      const source = event.data.profile;
      if (!Array.isArray(source.photos) || !Array.isArray(source.videos) || !Array.isArray(source.socialLinks)) return;
      const token = typeof event.data.token === "string" ? event.data.token : "";
      if (internalProfileTargetId && (internalProfileTargetId !== source.id || internalProfileToken !== token)) closeProfileModal();
      internalProfileTargetId = source.id;
      internalProfileToken = token;
      document.body.dataset.internalProfileAudience = token ? "guest" : "staff";
      // Only a table-token profile may carry a club theme. This document is
      // isolated from the public app and the staff profile preview.
      const guestAccent = token && /^#[0-9a-f]{6}$/i.test(source.internalAccent || "") ? source.internalAccent : "";
      if (guestAccent) {
        const channels = guestAccent.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
          .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
        const light = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722 > .179;
        document.body.dataset.venueGuestColor = "custom";
        document.body.style.setProperty("--venue-guest-accent", guestAccent);
        document.body.style.setProperty("--venue-guest-on-accent", light ? "#050507" : "#ffffff");
      } else {
        delete document.body.dataset.venueGuestColor;
        document.body.style.removeProperty("--venue-guest-accent");
        document.body.style.removeProperty("--venue-guest-on-accent");
      }
      internalTableRequest = token && event.data.request ? {
        tableLabel: String(event.data.request.tableLabel || "our table").slice(0, 60),
        busy: event.data.request.busy === true, message: String(event.data.request.message || ""),
        status: source.requestStatus, requestId: source.requestId, confirmed: event.data.request.confirmed === true,
      } : null;
      const { requestsTonight, requestStatus, requestId, ...profileContent } = source;
      internalProfileActivity = { requestsTonight, requestStatus, requestId };
      const revision = JSON.stringify([profileContent, token, Date.parse(source.workingUntil || "") > Date.now()]);
      if (internalRosterProfile) {
        internalRosterProfile.requestsTonight = requestsTonight;
        internalRosterProfile.requestStatus = requestStatus;
        internalRosterProfile.requestId = requestId;
        syncInternalProfileRequestUi();
      }
      if (revision === internalProfileRevision && !internalProfileMediaIncomplete) return;
      internalProfileRevision = revision;
      const sequence = ++internalProfileLoadSequence;
      const city = String(source.city || selectedCity()).trim();
      // A private profile only needs its own city context, not a directory fetch.
      if (!discoveryMarket(city)) markets[city] = { stats: { dancers: 0, shifts: 0, venues: 0 }, dancers: [], venues: [] };
      if (![...citySelect.options].some(option => option.value === city)) {
        const option = document.createElement("option");
        option.value = city; option.textContent = city; citySelect.append(option);
      }
      const external = discoveryMarket(city)?.dancers?.find(item => item.id === source.id && isApprovedPublicProfile(item));
      const photoDetails = (photo, imageUrl) => ({
        id: photo.id, imageUrl,
        reviewStatus: "approved", isPrimary: photo.is_primary === true,
        isPinned: photo.is_pinned === true, sortOrder: photo.sort_order || 0, likeCount: photo.like_count || 0,
      });
      const photoMedia = async photo => photoDetails(photo, await internalProfileMediaUrl("photo", photo.id, token));
      const mainPhoto = source.photos.find(photo => photo.is_primary) || source.photos[0];
      // The parent has already authorized this exact profile. Show its identity
      // immediately; even the main photo must not hold the viewer closed.
      const visibleMedia = Promise.all([
        internalProfileMediaUrl("avatar", source.id, token, source.avatarRevision, 320),
        mainPhoto ? photoMedia(mainPhoto) : null,
      ]);
      const previous = internalRosterProfile;
      const initialPhotoUrl = typeof source.initialPhotoUrl === "string"
        && /^(?:https?:\/\/|blob:https?:\/\/)/.test(source.initialPhotoUrl) ? source.initialPhotoUrl : "";
      const photos = previous?.submittedPhotos || (mainPhoto && initialPhotoUrl ? [photoDetails(mainPhoto, initialPhotoUrl)] : []);
      internalProfileMediaIncomplete = false;
      const working = Date.parse(source.workingUntil || "") > Date.now();
      internalRosterProfile = {
        ...external, ...previous, id: source.id, slug: source.slug || external?.slug || "", name: source.stage_name, city,
        internalRoster: true, internalGuestProfile: Boolean(token), status: "Verified", photoStatus: "Approved",
        ...internalProfileActivity,
        // These flags remain private even though this authorized viewer can display the profile.
        hidden: true, isPublic: false, is_public: false,
        metricsUnavailable: previous ? previous.metricsUnavailable : external ? external.metricsUnavailable : true,
        avatarPhotoUrl: previous?.avatarPhotoUrl || initialPhotoUrl, avatarPhotoSrcSet: "", mainPhotoUrl: (photos.find(photo => photo.isPrimary) || photos[0])?.imageUrl || "", mainPhotoSrcSet: "",
        galleryPhotoUrls: photos.map(photo => photo.imageUrl), galleryPhotoSrcSets: [],
        galleryPhotoIds: photos.map(photo => photo.id), galleryPhotoLikeCounts: photos.map(photo => photo.likeCount),
        galleryPhotoPins: photos.map(photo => photo.isPinned), submittedPhotos: photos,
        internalVideos: previous?.internalVideos || [],
        socials: Object.fromEntries(source.socialLinks.map(link => [link.platform, link.url])),
        submittedSocials: [], socialLinks: source.socialLinks,
        venue: source.venueName, venueSlug: source.venueSlug || "", scheduled: working, tonight: working, liveTonight: working,
        time: working ? "Working now" : "Not working now", locationStatus: working ? "club_confirmed" : "self_reported",
        checkedInAt: working ? external?.checkedInAt || new Date(Date.now() - 1000).toISOString() : "",
        checkedOutAt: "", endedAt: "", workingStatus: working ? "club_confirmed" : "self_reported",
        locationVerificationExpiresAt: source.workingUntil || "",
        activeDeal: null, activeDeals: [], dealAttributionToken: "", dealAttributionTokens: {},
      };
      const viewed = internalRosterProfile;
      // Give the visible images priority over full video downloads.
      viewed.internalVideosRequest = visibleMedia.then(() => sequence !== internalProfileLoadSequence ? [] : Promise.all(source.videos.map(async video => ({
        id: video.id, videoUrl: await internalProfileMediaUrl("video", video.id, token),
        posterUrl: video.has_poster ? await internalProfileMediaUrl("video-poster", video.id, token) : "",
        caption: video.caption, durationSeconds: video.duration_seconds || 0, likeCount: video.like_count || 0,
        isPinned: video.is_pinned === true, publishedAt: video.published_at,
      })))).then(videos => {
        if (sequence !== internalProfileLoadSequence) return { ok: false, videos: [] };
        internalProfileMediaIncomplete ||= videos.some((video, index) => !video.videoUrl || (source.videos[index].has_poster && !video.posterUrl));
        viewed.internalVideos = videos.filter(video => video.videoUrl).sort((a, b) => Number(b.isPinned) - Number(a.isPinned));
        return { ok: true, videos: viewed.internalVideos };
      });
      citySelect.value = city;
      if (!previous) openProfileModal(source.id);
      else {
        // A roster poll can change likes, request counts or availability. Keep
        // the selected tab, playing video and scroll position intact.
        syncInternalProfileDetails(previous, viewed);
        void loadProfileMyDancrTv(viewed);
      }
      syncInternalProfilePublicMetrics();
      if (!external) void loadInternalProfilePublicMetrics(viewed, sequence);
      document.documentElement.classList.add("internal-profile-ready");
      window.parent.postMessage({ type: "mydancr:internal-profile-shown", profileId: source.id }, window.location.origin);
      const [avatarPhotoUrl, primaryPhoto] = await visibleMedia;
      if (sequence !== internalProfileLoadSequence) return;
      viewed.avatarPhotoUrl = avatarPhotoUrl || initialPhotoUrl;
      if (primaryPhoto?.imageUrl) {
        viewed.mainPhotoUrl = primaryPhoto.imageUrl;
        viewed.submittedPhotos = [primaryPhoto];
        setModalPhoto(portraitClass(-1), viewed.mainPhotoUrl);
        setProfileMainPhoto(viewed.mainPhotoUrl, "");
      }
      const gallery = await Promise.all(source.photos.map(photo => photo.id === mainPhoto?.id ? primaryPhoto : photoMedia(photo)));
      if (sequence !== internalProfileLoadSequence) return;
      internalProfileMediaIncomplete ||= !avatarPhotoUrl || gallery.some(photo => !photo.imageUrl);
      viewed.submittedPhotos = gallery;
      viewed.mainPhotoUrl = (gallery.find(photo => photo.isPrimary) || gallery[0])?.imageUrl || "";
      if (previous && !previous.mainPhotoUrl && viewed.mainPhotoUrl) {
        setModalPhoto(portraitClass(-1), viewed.mainPhotoUrl);
        setProfileMainPhoto(viewed.mainPhotoUrl, "");
      }
      viewed.galleryPhotoUrls = gallery.map(photo => photo.imageUrl);
      viewed.galleryPhotoIds = gallery.map(photo => photo.id);
      viewed.galleryPhotoLikeCounts = gallery.map(photo => photo.likeCount);
      viewed.galleryPhotoPins = gallery.map(photo => photo.isPinned);
      modalGallery.profilePhotoItems = profilePhotoGalleryItems(viewed, -1);
      modalGallery.profileVisiblePhotoCount = Math.min(modalGallery.profilePhotoItems.length, Math.max(PROFILE_MEDIA_PAGE_SIZE, modalGallery.profileVisiblePhotoCount || 0));
      renderProfileMediaLibrary();
      syncProfileMediaTabCounts(modalGallery.profilePhotoItems.length, modalGallery.profileTvVideos?.length || 0);
      window.requestAnimationFrame(observeProfileMediaSentinel);
      await viewed.internalVideosRequest;
    }

    function syncInternalProfileDetails(previous, profile) {
      const name = document.getElementById("modalName");
      if (name) name.textContent = profile.name;
      const city = document.getElementById("modalCity");
      if (city) city.textContent = profile.city;
      if (previous.scheduled !== profile.scheduled || previous.venue !== profile.venue || previous.locationVerificationExpiresAt !== profile.locationVerificationExpiresAt) {
        const body = document.getElementById("modalBody");
        if (body) body.innerHTML = profileModalGridMarkup(profile, { city: profile.city });
        document.querySelectorAll(".profile-modal-avatar, .profile-featured-column").forEach(node => { node.dataset.workingNow = String(profile.scheduled); });
      }
      syncInternalProfileRequestUi();
    }

    async function loadInternalProfilePublicMetrics(profile, sequence) {
      if (!profile.slug) return;
      try {
        const response = await fetch(`/api/public/dancers/${encodeURIComponent(profile.slug)}`, { signal: internalProfileMediaController.signal });
        const payload = response.ok ? await response.json() : null;
        if (sequence !== internalProfileLoadSequence || payload?.profile?.id !== profile.id) return;
        Object.assign(internalRosterProfile, {
          followerCount: payload.profile.followerCount, profileViewsToday: payload.profile.profileViewsToday,
          metricsUnavailable: payload.profile.metricsUnavailable,
        });
        const metrics = document.getElementById("modalProfileMetrics");
        if (metrics) metrics.innerHTML = profileActivityMetricsMarkup(internalRosterProfile, profile.city);
      } catch { /* Internal-only profiles can remain unavailable to public metrics. */ }
    }

    function syncInternalProfilePublicMetrics() {
      if (!internalRosterProfile) return;
      const external = discoveryMarket(internalRosterProfile.city)?.dancers?.find(item => item.id === internalRosterProfile.id && isApprovedPublicProfile(item));
      if (!external) return;
      internalRosterProfile.followerCount = external.followerCount;
      internalRosterProfile.profileViewsToday = external.profileViewsToday;
      internalRosterProfile.metricsUnavailable = external.metricsUnavailable;
      const metrics = document.getElementById("modalProfileMetrics");
      if (metrics) metrics.innerHTML = profileActivityMetricsMarkup(internalRosterProfile, internalRosterProfile.city);
    }

    function internalProfileRequestActionsMarkup(profile) {
      if (!internalTableRequest) return "";
      const sent = ["pending", "acknowledged"].includes(internalTableRequest.status);
      const confirmed = sent && internalTableRequest.confirmed;
      const label = internalTableRequest.busy ? sent ? "Cancelling…" : "Sending…" : confirmed ? "Request sent" : sent ? "Cancel request" : `Request at ${internalTableRequest.tableLabel}`;
      return `<div class="internal-profile-request">
        <div class="modal-actions profile-actions-compact profile-venue-actions"><button type="button" class="action-btn profile-action-icon-control" data-internal-table-request ${sent ? "data-request-sent" : ""} ${confirmed || internalTableRequest.busy || (sent ? !internalTableRequest.requestId : !profile.scheduled) ? "disabled" : ""} aria-busy="${internalTableRequest.busy}">${confirmed ? `<span class="internal-request-sent-label">${escapeHtml(label)}</span>` : escapeHtml(label)}</button></div>
        <p role="status" class="internal-profile-request-status">${escapeHtml(internalTableRequest.message || (internalTableRequest.status === "acknowledged" ? "Seen by club staff." : sent ? "Sent to club staff. Availability is confirmed by staff." : ""))}</p>
      </div>`;
    }

    function vipProfileRequestActionsMarkup(profile) {
      if (!profile?.vipProfile || !internalVipRequest) return "";
      const label = internalVipRequest.added ? "Added to request queue" : "Request";
      return `<div class="vip-profile-queue">
        <button type="button" class="action-btn vip-profile-queue-action" data-vip-profile-request
          ${internalVipRequest.added || internalVipRequest.disabled ? "disabled" : ""} aria-live="polite">${escapeHtml(label)}</button>
        <p role="status" class="internal-profile-request-status">${escapeHtml(internalVipRequest.message)}</p>
      </div>`;
    }

    function syncVipProfileRequestUi() {
      const actions = document.querySelector(".vip-profile-queue");
      if (actions && internalRosterProfile?.vipProfile) actions.outerHTML = vipProfileRequestActionsMarkup(internalRosterProfile);
    }

    function sendVipProfileRequest() {
      if (!internalRosterProfile?.vipProfile || !internalVipRequest || internalVipRequest.added || internalVipRequest.disabled) return;
      window.parent.postMessage({ type: "mydancr:vip-profile-request", profileId: internalRosterProfile.id }, window.location.origin);
    }

    function syncInternalProfileRequestUi() {
      const count = document.getElementById("internalRequestsTonight");
      if (count) count.textContent = Number.isSafeInteger(internalRosterProfile.requestsTonight) && internalRosterProfile.requestsTonight >= 0 ? internalRosterProfile.requestsTonight.toLocaleString() : "—";
      const actions = document.querySelector(".internal-profile-request");
      if (actions) actions.outerHTML = internalProfileRequestActionsMarkup(internalRosterProfile);
    }

    function sendInternalTableRequest() {
      if (!internalRosterProfile || !internalTableRequest || internalTableRequest.busy || internalTableRequest.confirmed) return;
      const cancel = ["pending", "acknowledged"].includes(internalTableRequest.status);
      if (cancel ? !internalTableRequest.requestId : !internalRosterProfile.scheduled) return;
      internalTableRequest.busy = true;
      internalTableRequest.message = "";
      syncInternalProfileRequestUi();
      window.parent.postMessage({ type: cancel ? "mydancr:internal-table-cancel" : "mydancr:internal-table-request", profileId: internalRosterProfile.id, ...(cancel ? { requestId: internalTableRequest.requestId } : {}) }, window.location.origin);
    }

    function closeInternalProfileFrame() {
      if (!internalProfileFrameId) return;
      const profileId = internalProfileTargetId;
      internalProfileLoadSequence += 1;
      internalRosterProfile = null;
      internalTableRequest = null;
      internalVipRequest = null;
      internalProfileTargetId = "";
      internalProfileToken = "";
      internalProfileRevision = "";
      internalProfileMediaIncomplete = false;
      internalProfileMediaController.abort();
      internalProfileMediaController = new AbortController();
      internalProfileMedia.forEach(promise => { void promise.then(url => { if (url) URL.revokeObjectURL(url); }); });
      internalProfileMedia.clear();
      modalGallery.profileTvLoadRequest = null;
      modalGallery.dataset.profileMediaProfile = "";
      modalGallery.profileMediaScope = "";
      modalGallery.profilePhotoItems = [];
      modalGallery.profileTvVideos = [];
      if (profileId) window.parent.postMessage({ type: "mydancr:internal-profile-close", profileId }, window.location.origin);
    }

    function startInternalProfileAuth(mode) {
      if (!internalProfileFrameId || !internalRosterProfile) return false;
      window.parent.postMessage({ type: "mydancr:internal-profile-auth", profileId: internalRosterProfile.id, mode }, window.location.origin);
      return true;
    }

    function initializeInternalProfileFrame() {
      if (!internalProfileFrameId) return;
      const profileModal = document.getElementById("profileModal");
      if (profileModal && !profileModal.querySelector(".internal-profile-powered-by")) {
        const credit = document.createElement("footer");
        credit.className = "internal-profile-powered-by";
        credit.innerHTML = '<a href="https://www.mydancr.com" target="_blank" rel="noopener noreferrer"><span>Powered by MyDancr</span><span>www.mydancr.com</span></a>';
        profileModal.append(credit);
      }
      document.addEventListener("click", event => {
        if (event.target instanceof Element && event.target.closest("[data-internal-table-request]")) sendInternalTableRequest();
        if (event.target instanceof Element && event.target.closest("[data-vip-profile-request]")) sendVipProfileRequest();
      });
      window.addEventListener("message", event => {
        if (event.origin !== window.location.origin || event.source !== window.parent) return;
        if (event.data?.type === "mydancr:internal-profile-clear") {
          closeProfileModal();
          return;
        }
        if (event.origin === window.location.origin && event.source === window.parent && event.data?.type === "mydancr:internal-profile-auth-error") {
          showToast(event.data.message);
          return;
        }
        const opening = event.data?.type === "mydancr:public-profile-open" ? openPublicProfileMessage(event) : openInternalProfileMessage(event);
        void opening.catch(() => {
          const profileId = event.data?.profileId || event.data?.profile?.id;
          if (profileId !== internalProfileTargetId) return;
          internalProfileRevision = "";
          window.parent.postMessage({ type: "mydancr:internal-profile-error", profileId }, window.location.origin);
        });
      });
      window.addEventListener("pagehide", () => {
        closeInternalProfileFrame();
      }, { once: true });
      window.parent.postMessage({ type: "mydancr:internal-profile-ready" }, window.location.origin);
    }
