    // An Internal roster hosts this same discovery viewer in an isolated frame.
    // Scoped profile data stays in memory and is never added to public discovery.
    const internalProfileFrameId = window.parent !== window
      ? new URLSearchParams(window.location.search).get("internal_profile") || "" : "";
    let internalRosterProfile = null;
    let internalProfileRevision = "";
    let internalProfileLoadSequence = 0;
    let internalTableRequest = null;
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
        const request = fetch(path, { headers, cache: "no-store", signal: AbortSignal.timeout(15000) })
          .then(response => { if (!response.ok) throw new Error("Media unavailable."); return response.blob(); })
          .then(blob => authSession?.accessToken === session.accessToken ? URL.createObjectURL(blob) : "")
          .catch(() => { internalProfileMedia.delete(key); return ""; });
        internalProfileMedia.set(key, request);
      }
      return internalProfileMedia.get(key);
    }

    async function openInternalProfileMessage(event) {
      if (!internalProfileFrameId || event.origin !== window.location.origin || event.source !== window.parent
        || event.data?.type !== "mydancr:internal-profile-open" || event.data?.profile?.id !== internalProfileFrameId) return;
      const source = event.data.profile;
      if (!Array.isArray(source.photos) || !Array.isArray(source.videos) || !Array.isArray(source.socialLinks)) return;
      const token = typeof event.data.token === "string" ? event.data.token : "";
      internalTableRequest = token && event.data.request ? {
        tableLabel: String(event.data.request.tableLabel || "our table").slice(0, 60),
        busy: event.data.request.busy === true, message: String(event.data.request.message || ""),
        status: source.requestStatus, requestId: source.requestId, confirmed: event.data.request.confirmed === true,
      } : null;
      const { requestsTonight, requestStatus, requestId, ...profileContent } = source;
      internalProfileActivity = { requestsTonight, requestStatus, requestId };
      const revision = JSON.stringify([profileContent, token]);
      if (internalRosterProfile) {
        internalRosterProfile.requestsTonight = requestsTonight;
        internalRosterProfile.requestStatus = requestStatus;
        internalRosterProfile.requestId = requestId;
        syncInternalProfileRequestUi();
      }
      if (revision === internalProfileRevision) return;
      internalProfileRevision = revision;
      const sequence = ++internalProfileLoadSequence;
      const city = discoveryMarket(source.city) ? source.city : selectedCity();
      const external = discoveryMarket(city)?.dancers?.find(item => item.id === source.id && isApprovedPublicProfile(item));
      const [avatarPhotoUrl, photos, videos] = await Promise.all([
        internalProfileMediaUrl("avatar", source.id, token, source.avatarRevision, 320),
        Promise.all(source.photos.map(async photo => ({
          id: photo.id, imageUrl: await internalProfileMediaUrl("photo", photo.id, token),
          reviewStatus: "approved", isPrimary: photo.is_primary === true,
          isPinned: photo.is_pinned === true, sortOrder: photo.sort_order || 0, likeCount: photo.like_count || 0,
        }))),
        Promise.all(source.videos.map(async video => ({
          id: video.id, videoUrl: await internalProfileMediaUrl("video", video.id, token),
          posterUrl: video.has_poster ? await internalProfileMediaUrl("video-poster", video.id, token) : "",
          caption: video.caption, durationSeconds: video.duration_seconds || 0, likeCount: video.like_count || 0,
          isPinned: video.is_pinned === true, publishedAt: video.published_at,
        }))),
      ]);
      if (sequence !== internalProfileLoadSequence) return;
      const working = Date.parse(source.workingUntil || "") > Date.now();
      internalRosterProfile = {
        ...external, id: source.id, slug: source.slug || external?.slug || "", name: source.stage_name, city,
        internalRoster: true, status: "Verified", photoStatus: "Approved",
        ...internalProfileActivity,
        // These flags remain private even though this authorized viewer can display the profile.
        hidden: true, isPublic: false, is_public: false,
        metricsUnavailable: external ? external.metricsUnavailable : true,
        avatarPhotoUrl, avatarPhotoSrcSet: "", mainPhotoUrl: (photos.find(photo => photo.isPrimary) || photos[0])?.imageUrl || "", mainPhotoSrcSet: "",
        galleryPhotoUrls: photos.map(photo => photo.imageUrl), galleryPhotoSrcSets: [],
        galleryPhotoIds: photos.map(photo => photo.id), galleryPhotoLikeCounts: photos.map(photo => photo.likeCount),
        galleryPhotoPins: photos.map(photo => photo.isPinned), submittedPhotos: photos,
        internalVideos: videos.sort((a, b) => Number(b.isPinned) - Number(a.isPinned)),
        socials: Object.fromEntries(source.socialLinks.map(link => [link.platform, link.url])),
        submittedSocials: [], socialLinks: source.socialLinks,
        venue: source.venueName, scheduled: working, tonight: working, liveTonight: working,
        time: working ? "Working now" : "Not working now", locationStatus: working ? "club_confirmed" : "self_reported",
        checkedInAt: working ? external?.checkedInAt || new Date(Date.now() - 1000).toISOString() : "",
        checkedOutAt: "", endedAt: "", workingStatus: working ? "club_confirmed" : "self_reported",
        locationVerificationExpiresAt: source.workingUntil || "",
        activeDeal: null, activeDeals: [], dealAttributionToken: "", dealAttributionTokens: {},
      };
      citySelect.value = city;
      openProfileModal(source.id);
      syncInternalProfilePublicMetrics();
      document.documentElement.classList.add("internal-profile-ready");
      window.parent.postMessage({ type: "mydancr:internal-profile-shown" }, window.location.origin);
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
      internalProfileLoadSequence += 1;
      internalRosterProfile = null;
      internalTableRequest = null;
      window.parent.postMessage({ type: "mydancr:internal-profile-close" }, window.location.origin);
    }

    function startInternalProfileAuth(mode) {
      if (!internalProfileFrameId || !internalRosterProfile) return false;
      window.parent.postMessage({ type: "mydancr:internal-profile-auth", profileId: internalRosterProfile.id, mode }, window.location.origin);
      return true;
    }

    function initializeInternalProfileFrame() {
      if (!internalProfileFrameId) return;
      document.addEventListener("click", event => {
        if (event.target instanceof Element && event.target.closest("[data-internal-table-request]")) sendInternalTableRequest();
      });
      window.addEventListener("message", event => {
        if (event.origin === window.location.origin && event.source === window.parent && event.data?.type === "mydancr:internal-profile-auth-error") {
          showToast(event.data.message);
          return;
        }
        void openInternalProfileMessage(event).catch(() => {
          internalProfileRevision = "";
          window.parent.postMessage({ type: "mydancr:internal-profile-error" }, window.location.origin);
        });
      });
      window.addEventListener("pagehide", () => {
        internalProfileLoadSequence += 1;
        internalProfileMedia.forEach(promise => { void promise.then(url => { if (url) URL.revokeObjectURL(url); }); });
        internalProfileMedia.clear();
      }, { once: true });
      window.parent.postMessage({ type: "mydancr:internal-profile-ready" }, window.location.origin);
    }
