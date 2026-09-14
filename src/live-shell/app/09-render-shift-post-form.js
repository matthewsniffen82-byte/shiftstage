

    function renderShiftPostForm() {
      const clubSelect = document.getElementById("shiftClub");
      const dateInput = document.getElementById("shiftDate");
      if (!clubSelect || !dateInput) return;
      const city = activeDancerCity();
      const approvedVenues = approvedDancerShiftVenues();
      const previousVenueId = clubSelect.value;
      const affiliationStateLoaded = Boolean(liveDancerVenueVerification);
      clubSelect.innerHTML = approvedVenues.length
        ? approvedVenues.map((venue) => `<option value="${escapeHtml(venue.id)}">${escapeHtml(venue.name)}</option>`).join("")
        : `<option value="">${affiliationStateLoaded ? "No approved venue affiliations" : "Loading approved clubs…"}</option>`;
      clubSelect.disabled = !approvedVenues.length;
      clubSelect.value = approvedVenues.some((venue) => venue.id === previousVenueId)
        ? previousVenueId
        : approvedVenues[0]?.id || "";
      const submitButton = document.querySelector("#shiftPostForm .post-shift-submit");
      if (submitButton) submitButton.disabled = !approvedVenues.length;
      if (!dateInput.value) dateInput.value = todayValue(city);
      const result = document.getElementById("shiftPostResult");
      if (result && lastPostedShift) {
        result.hidden = false;
        result.textContent = lastPostedShift.noticeText || "Schedule sent to followers and notify-only guests.";
      } else if (result && affiliationStateLoaded && !approvedVenues.length) {
        result.hidden = false;
        result.textContent = "A venue manager must approve your affiliation before you can post a shift there.";
      }
      renderShiftDisplayPreview();
    }

    function renderShiftDisplayPreview() {
      const preview = document.getElementById("shiftDisplayPreview");
      if (!preview) return;
      const city = activeDancerCity();
      const dateValue = document.getElementById("shiftDate")?.value || todayValue(city);
      const profile = {
        scheduled: true,
        shiftDate: dateValue
      };
      const upcomingText = displayPublicShiftTime(profile.time, profile);
      preview.innerHTML = `Profile card display: <strong>${displayText(upcomingText)}</strong> at the selected venue. A future date never makes you live; only an eligible dressing-room tap changes the card to <strong>Working Now</strong>.`;
    }

    function setFieldValueIfIdle(id, value = "") {
      const field = document.getElementById(id);
      if (!field || document.activeElement === field) return;
      field.value = value || "";
    }

    function shiftWindowForProfile(profile, city = activeDancerCity()) {
      if (!profile) return null;
      if (profile.shiftStartsAt && profile.shiftEndsAt) {
        const start = new Date(profile.shiftStartsAt);
        const end = new Date(profile.shiftEndsAt);
        if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) return { start, end };
      }
      const dateValue = profile.shiftDate || todayValue(city);
      return shiftWindowForDate(profile, dateValue);
    }

    function isCheckedInShift(profile) {
      const expiresAt = Date.parse(profile?.locationVerificationExpiresAt || "");
      return Boolean(profile?.checkedInAt && !profile?.checkedOutAt && !profile?.endedAt && profile?.locationStatus === "club_confirmed" && Number.isFinite(expiresAt) && expiresAt > Date.now());
    }

    function isShiftLocationVerificationCurrent(profile) {
      if (!isCheckedInShift(profile)) return false;
      if (profile.locationStatus !== "club_confirmed") return false;
      const expiresAt = Date.parse(profile.locationVerificationExpiresAt || "");
      return Number.isFinite(expiresAt) && expiresAt > Date.now();
    }

    function shiftLocationVerificationRefreshDue(profile) {
      if (!isCheckedInShift(profile) || profile.locationStatus === "club_confirmed") return false;
      const expiresAt = Date.parse(profile.locationVerificationExpiresAt || "");
      return !Number.isFinite(expiresAt) || expiresAt <= Date.now() + SHIFT_LOCATION_REFRESH_INTERVAL_MS;
    }

    function checkInWindowOpen(profile, city = activeDancerCity()) {
      const window = shiftWindowForProfile(profile, city);
      if (!window) return false;
      const now = new Date();
      return now >= window.start && now <= window.end;
    }

    function isShiftCurrentlyActive(profile, city = activeDancerCity()) {
      const window = shiftWindowForProfile(profile, city);
      if (!window) return false;
      const now = new Date();
      return now >= window.start && now <= window.end;
    }

    function shiftAutoEnded(profile, city = activeDancerCity()) {
      if (!isCheckedInShift(profile) || profile.endedAt) return false;
      const expiresAt = Date.parse(profile.locationVerificationExpiresAt || "");
      return Number.isFinite(expiresAt) && expiresAt <= Date.now();
    }

    function shiftSummaryForProfile(profile, reason = "completed", city = activeDancerCity()) {
      const window = shiftWindowForProfile(profile, city);
      const start = profile.checkedInAt ? new Date(profile.checkedInAt) : window?.start || new Date();
      const end = profile.checkedOutAt || profile.endedAt ? new Date(profile.checkedOutAt || profile.endedAt) : new Date();
      const hours = Math.max(0, (end.getTime() - start.getTime()) / 3600000);
      return {
        reason,
        hoursWorked: `${hours.toFixed(hours >= 10 ? 0 : 1)}h`,
        profileViews: firstRealMetric(profile, ["shiftProfileViews"]),
        qrCodeScans: firstRealMetric(profile, ["shiftQrCodeScans"]),
        estimatedCommissions: moneyFromCents(firstRealMetric(profile, ["shiftCommissionCents"])),
        newFollowers: firstRealMetric(profile, ["shiftNewFollowers"])
      };
    }

    function applyShiftState(profile, patch = {}) {
      if (!profile) return;
      const nextState = {
        locationStatus: patch.location_status ?? patch.locationStatus ?? profile.locationStatus,
        checkedInAt: patch.checked_in_at ?? patch.checkedInAt ?? profile.checkedInAt,
        checkedOutAt: patch.checked_out_at ?? patch.checkedOutAt ?? profile.checkedOutAt,
        checkinDistanceFeet: patch.checkin_distance_feet ?? patch.checkinDistanceFeet ?? profile.checkinDistanceFeet,
        locationVerificationExpiresAt: patch.location_verification_expires_at ?? patch.locationVerificationExpiresAt ?? profile.locationVerificationExpiresAt,
        workingStatus: patch.working_status ?? patch.workingStatus ?? profile.workingStatus,
        commissionTrackingStartedAt: patch.commission_tracking_started_at ?? patch.commissionTrackingStartedAt ?? profile.commissionTrackingStartedAt,
        commissionTrackingStoppedAt: patch.commission_tracking_stopped_at ?? patch.commissionTrackingStoppedAt ?? profile.commissionTrackingStoppedAt,
        endedAt: patch.ended_at ?? patch.endedAt ?? profile.endedAt,
        endedReason: patch.ended_reason ?? patch.endedReason ?? profile.endedReason,
        shiftSummary: patch.shift_summary ?? patch.shiftSummary ?? profile.shiftSummary
      };
      Object.assign(profile, nextState);
      const shiftId = patch.id || patch.shiftId || profile.shiftId;
      const matchingShift = profilePostedShifts(profile).find((shift) => String(shift.shiftId) === String(shiftId));
      if (matchingShift) Object.assign(matchingShift, nextState);
      profile.tonight = isWorkingTonight(profile, activeDancerCity());
    }

    function renderShiftVerificationPanel() {
      const panel = document.getElementById("shiftVerificationPanel");
      if (!panel) return;
      const profile = activeDancerProfile();
      if (!profile) {
        stopShiftLocationRefresh();
        panel.hidden = true;
        panel.innerHTML = "";
        return;
      }
      const checkedIn = isCheckedInShift(profile);
      const ended = profile.workingStatus === "ended" || profile.endedAt;
      const statusLabel = ended
        ? "Working Now ended"
        : checkedIn
          ? "Working Now"
          : "Not working now";
      const summary = profile.shiftSummary || (ended ? shiftSummaryForProfile(profile, profile.endedReason || "completed") : null);
      const statusCopy = ended
        ? "This Working Now session has ended."
        : checkedIn
          ? `Dressing-room tap verified at ${profile.venue || "the venue"}. Active until ${new Date(profile.locationVerificationExpiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. Retaps cannot extend this session; a six-hour cooldown follows.`
          : "Log in to your MyDancr dancer account first. No particular page needs to be open. Unlock your phone and tap the club's dressing-room sticker. Open the link if prompted, and log in there if asked. Working Now lasts 6 hours, followed by a 6-hour cooldown at all clubs.";

      panel.hidden = false;
      panel.innerHTML = `
        <div class="shift-verification-head">
          <span class="shift-status-pill">${displayText(statusLabel)}</span>
          <span class="shift-verification-copy">${checkedIn ? "6-hour club session" : "Tap required"}</span>
        </div>
        <div class="shift-verification-copy">${displayText(statusCopy)}</div>
        <div class="shift-action-grid">
          ${!checkedIn ? '<button class="mini-action primary" type="button" data-shift-verify-action="nfc-ready" aria-describedby="shiftCheckInStatus">Tap at dressing room to go Working Now</button>' : ""}
          ${checkedIn && !ended ? '<button class="mini-action checked-in-confirmation" type="button" disabled aria-label="Working Now confirmed" aria-live="polite">✓ Working Now</button>' : ""}
          ${checkedIn && !ended ? '<button class="mini-action danger" type="button" data-shift-verify-action="end">End Working Now</button>' : ""}
        </div>
        <div class="shift-verification-copy shift-checkin-feedback${shiftCheckInTone ? ` is-${shiftCheckInTone}` : ""}" id="shiftCheckInStatus" role="${shiftCheckInTone === "error" ? "alert" : "status"}" aria-live="${shiftCheckInTone === "error" ? "assertive" : "polite"}">${displayText(shiftCheckInMessage)}</div>
        ${summary ? `
          <div class="shift-bottom-sheet">
            <strong>✓ Shift Completed</strong>
            <div class="shift-summary-grid">
              <span><small>Hours Worked</small>${displayText(summary.hoursWorked)}</span>
              <span><small>Profile Views</small>${Number(summary.profileViews || 0).toLocaleString()}</span>
              <span><small>Cashier Redemptions</small>${Number(summary.qrCodeScans || 0).toLocaleString()}</span>
              <span><small>Estimated Commissions</small>${displayText(summary.estimatedCommissions || "$0")}</span>
              <span><small>New Followers</small>${Number(summary.newFollowers || 0).toLocaleString()}</span>
            </div>
          </div>
        ` : ""}
      `;
      stopShiftLocationRefresh();
    }

    function stopShiftLocationRefresh() {
      if (shiftLocationRefreshTimer) window.clearInterval(shiftLocationRefreshTimer);
      shiftLocationRefreshTimer = 0;
      shiftLocationRefreshShiftId = "";
    }

    function ensureShiftLocationRefresh(profile) {
      if (!isDancerSession() || !profile?.shiftId || !isCheckedInShift(profile) || profile.locationStatus === "club_confirmed") {
        stopShiftLocationRefresh();
        return;
      }
      if (shiftLocationRefreshTimer && shiftLocationRefreshShiftId === String(profile.shiftId)) return;
      stopShiftLocationRefresh();
      shiftLocationRefreshShiftId = String(profile.shiftId);
      const refresh = () => {
        const current = activeDancerProfile();
        if (
          document.visibilityState === "visible" &&
          current &&
          String(current.shiftId) === shiftLocationRefreshShiftId &&
          isCheckedInShift(current)
        ) {
          handleShiftVerificationAction("refresh", null, { silent: true });
        }
      };
      shiftLocationRefreshTimer = window.setInterval(refresh, SHIFT_LOCATION_REFRESH_INTERVAL_MS);
      if (shiftLocationVerificationRefreshDue(profile)) window.setTimeout(refresh, 0);
    }

    async function handleShiftVerificationAction(action, trigger = null, options = {}) {
      const profile = activeDancerProfile();
      if (!profile) return;
      const status = document.getElementById("shiftCheckInStatus");
      const setCheckInStatus = (message = "", tone = "", code = "") => {
        shiftCheckInMessage = message;
        shiftCheckInTone = tone;
        shiftCheckInCode = code;
        if (status) {
          status.textContent = message;
          status.className = `shift-verification-copy shift-checkin-feedback${tone ? ` is-${tone}` : ""}`;
          status.setAttribute("role", tone === "error" ? "alert" : "status");
          status.setAttribute("aria-live", tone === "error" ? "assertive" : "polite");
        }
      };
      let actionSucceeded = false;
      const triggerLabel = trigger?.querySelector("span") || trigger;
      if (trigger) {
        trigger.disabled = true;
        trigger.setAttribute("aria-busy", "true");
        if (triggerLabel) triggerLabel.textContent = action === "end" ? "Ending shift..." : "Ready to tap...";
      }
      try {
        if (!isDancerSession()) {
          throw new Error("Sign in to your dancer account before using Working Now.");
        }
        if (action === "nfc-ready") {
          setCheckInStatus("Log in to your MyDancr dancer account first. No particular page needs to be open. Unlock your phone and tap the club's dressing-room sticker. Open the link if prompted, and log in there if asked. Working Now lasts 6 hours, followed by a 6-hour cooldown at all clubs.", "success");
          if (!options.silent) showToast("Ready for dressing-room tap");
          return;
        }
        if (action === "end") {
          if (!profile.shiftId) throw new Error("No active Working Now session was found.");
          setCheckInStatus("Ending shift...", "loading");
          const data = await patchAuthenticatedJson("/api/dancer/shifts/check-in", { shiftId: profile.shiftId, action: "end" });
          if (data?.shift) applyShiftState(profile, data.shift);
          stopShiftLocationRefresh();
          setCheckInStatus("Shift ended. Club Deal commission tracking is stopped.", "success");
          actionSucceeded = true;
          if (!options.silent) showToast("Shift ended");
        } else {
          throw new Error("Use the venue's physical dressing-room sticker to start Working Now.");
        }
      } catch (error) {
        const message = error.message || "Could not update shift";
        setCheckInStatus(message, "error", typeof error?.code === "string" ? error.code : "request_failed");
        if (!options.silent) showToast(message);
      } finally {
        if (trigger) {
          trigger.disabled = false;
          trigger.setAttribute("aria-busy", "false");
        }
      }
      if (actionSucceeded) {
        render();
        renderDancerManagement();
        if (customerDashboard.classList.contains("show")) renderDashboard();
      } else {
        renderShiftVerificationPanel();
        if (!options.silent && shiftCheckInTone === "error") {
          window.requestAnimationFrame(() => {
            document.getElementById("shiftCheckInStatus")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
          });
        }
      }
    }

    function renderDancerManagement() {
      renderDancerShiftManager();
      renderShiftVerificationPanel();
      renderApprovedDancerProfileEditor();
    }

    function renderDancerShiftManager() {
      const list = document.getElementById("dancerShiftManager");
      if (!list) return;
      const profile = activeDancerProfile();
      const shifts = (profile ? profilePostedShifts(profile) : locallyStoredPostedShifts())
        .sort((left, right) => new Date(left.shiftStartsAt || 0).getTime() - new Date(right.shiftStartsAt || 0).getTime());
      if (!shifts.length) {
        list.innerHTML = `
          <div class="shift-manager-row">
            <strong>No posted shifts</strong>
            <div class="shift-manager-meta">Post one or more shifts above. This list is where you edit or delete them.</div>
          </div>
        `;
        return;
      }
      list.innerHTML = shifts.map((shift) => {
        const label = postedShiftDateTimeLabel(shift);
        return `
        <div class="shift-manager-row">
          <strong>${displayText(shift.venue || "Posted shift")}</strong>
          <div class="shift-manager-meta">${displayText(label)}${shift.repeat && shift.repeat !== "No repeat" ? ` · ${displayText(shift.repeat)}` : ""}</div>
          ${shift.notes ? `<div class="shift-manager-meta">${displayText(shift.notes)}</div>` : ""}
          <div class="shift-manager-actions">
            <button class="mini-action" type="button" data-shift-action="edit" data-shift-id="${displayText(shift.shiftId)}">Edit date</button>
            <button class="mini-action danger" type="button" data-shift-action="remove" data-shift-id="${displayText(shift.shiftId)}">Delete date</button>
          </div>
        </div>
      `;
      }).join("");
    }

    function approvedDancerPhotoReviewMarkup(profile) {
      const submitted = (profile?.submittedPhotos || []).map((photo, index) => ({
        id: photo.id || `${profile?.id || profile?.name || "profile"}-photo-${index}`,
        imageUrl: photo.imageUrl || photo.image_url || photo.url || "",
        label: photoDisplayLabel(index),
        status: normalizedReviewStatus(latestContentReview(`photo:${photo.id || `${profile?.id || profile?.name || "profile"}-photo-${index}`}`)?.status || photo.reviewStatus || photo.review_status || "pending"),
        notes: latestContentReview(`photo:${photo.id || `${profile?.id || profile?.name || "profile"}-photo-${index}`}`)?.notes || photo.reviewNotes || photo.review_notes || "",
        target: `submitted:${index}`
      }));
      const existing = [
        ...(profile?.mainPhotoUrl ? [{ imageUrl: profile.mainPhotoUrl, label: "Main Photo", status: "approved", notes: "", target: "main" }] : []),
        ...(profile?.galleryPhotoUrls || []).map((imageUrl, index) => ({ imageUrl, label: "Photo", status: "approved", notes: "", target: `gallery:${index}` }))
      ];
      const photos = relabelVisualPhotoItems([...submitted, ...existing]);
      if (!photos.length) {
        return '<div class="rule-note">No profile photos uploaded yet. Use the replace buttons above to submit photos for approval.</div>';
      }
      return `
        <div class="dancer-photo-review-grid">
          ${photos.map((photo) => {
            const rejected = photo.status === "rejected";
            const statusText = rejected ? "Not approved" : photo.status === "approved" ? "Approved" : "Pending approval";
            return `
              <div class="dancer-photo-review-card ${rejected ? "is-rejected" : ""}" ${rejected ? `data-fix-anchor="${displayText(photo.id ? `dancer-photo-${photo.id}` : "dancer-photo-review-card")}"` : ""}>
                ${photo.imageUrl ? `<img src="${displayText(photo.imageUrl)}" alt="${displayText(photo.label)}">` : ""}
                <strong>${displayText(photo.label)}</strong>
                <span>${displayText(statusText)}</span>
                ${rejected && photo.notes ? `<span>Reason: ${displayText(photo.notes)}</span>` : ""}
                ${rejected ? "<span>Use Replace main photo or Replace gallery photo, then resubmit changes.</span>" : ""}
                <button class="mini-action" type="button" data-dancer-control-action="replace-photo" data-photo-target="${displayText(photo.target)}">Replace this picture</button>
              </div>
            `;
          }).join("")}
        </div>
      `;
    }

    function canonicalDancerPhotoRows(profile) {
      const rows = Array.isArray(profile?.dancer_photos) ? profile.dancer_photos : [];
      const orderedNewestFirst = rows
        .map((photo, sourceIndex) => ({ photo, sourceIndex }))
        .filter(({ photo }) => {
          const status = normalizedReviewStatus(photo?.review_status || photo?.reviewStatus || "pending");
          const storagePath = photo?.storage_path || photo?.storagePath || "";
          return Boolean(photo?.id && storagePath && ["approved", "pending"].includes(status));
        })
        .sort((left, right) => {
          const createdOrder = String(right.photo.created_at || right.photo.createdAt || "")
            .localeCompare(String(left.photo.created_at || left.photo.createdAt || ""));
          return createdOrder || right.sourceIndex - left.sourceIndex;
        });
      const bySlot = new Map();
      orderedNewestFirst.forEach(({ photo }) => {
        const slotKey = photo.is_primary || photo.isPrimary
          ? "main"
          : `gallery:${Number(photo.sort_order ?? photo.sortOrder ?? 0)}`;
        if (!bySlot.has(slotKey)) bySlot.set(slotKey, photo);
      });
      return Array.from(bySlot.values()).sort((left, right) => {
        const leftPrimary = Boolean(left.is_primary || left.isPrimary);
        const rightPrimary = Boolean(right.is_primary || right.isPrimary);
        if (leftPrimary !== rightPrimary) return leftPrimary ? -1 : 1;
        return Number(left.sort_order ?? left.sortOrder ?? 0) - Number(right.sort_order ?? right.sortOrder ?? 0);
      });
    }

    function activeDancerPhotoRows(profile) {
      const canonicalRows = canonicalDancerPhotoRows(profile);
      return canonicalRows.filter((photo) => !photoMatchesDeletedDancerPhoto(profile, photo));
    }

    function dancerPhotoSlotKey(photo = {}) {
      if (photo.is_primary || photo.isPrimary) return "main";
      const sortOrder = Number(photo.sort_order ?? photo.sortOrder);
      return Number.isInteger(sortOrder) && sortOrder > 0
        ? `gallery:${sortOrder}`
        : `photo:${photo.id || photo.storage_path || photo.storagePath || "unassigned"}`;
    }

    function editableDancerPhotoRows(profile) {
      const byId = new Map();
      activeDancerPhotoRows(profile).forEach((photo) => byId.set(String(photo.id), photo));
      (profile?.submittedPhotos || [])
        .filter((photo) => normalizedReviewStatus(photo.review_status || photo.reviewStatus || "pending") === "pending")
        .filter((photo) => !photoMatchesDeletedDancerPhoto(profile, photo))
        .forEach((photo) => {
          const id = String(photo.id || "");
          if (id && !byId.has(id)) byId.set(id, photo);
        });
      return Array.from(byId.values())
        .sort((left, right) => {
          const leftPrimary = Boolean(left.is_primary || left.isPrimary);
          const rightPrimary = Boolean(right.is_primary || right.isPrimary);
          if (leftPrimary !== rightPrimary) return leftPrimary ? -1 : 1;
          return Number(left.sort_order ?? left.sortOrder ?? 0) - Number(right.sort_order ?? right.sortOrder ?? 0);
        });
    }

    function dancerPhotoDebugShape(photo = {}) {
      return {
        id: photo.id || "",
        storagePath: photo.storage_path || photo.storagePath || "",
        deletedAt: photo.deleted_at || photo.deletedAt || null,
        isActive: photo.is_active !== false && photo.isActive !== false,
        moderationStatus: photo.review_status || photo.reviewStatus || "pending"
      };
    }

    function logPhotoReplacementDebug(profile, deletedPhotoIds = []) {
      console.log("PHOTO_REPLACEMENT_DEBUG", {
        deletedPhotoIds,
        currentVisiblePhotos: activeDancerPhotoRows(profile).map(dancerPhotoDebugShape),
        fetchedPhotoRows: (Array.isArray(profile?.dancer_photos) ? profile.dancer_photos : []).map(dancerPhotoDebugShape)
      });
    }

    function runPhotoSourceOfTruthSelfTest() {
      const profile = {
        dancer_photos: [
          { id: "A", storage_path: "test/A.jpg", is_primary: true, sort_order: 0, review_status: "approved", created_at: "2026-01-01T00:00:00.000Z" },
          { id: "B", storage_path: "test/B.jpg", is_primary: false, sort_order: 1, review_status: "approved", created_at: "2026-01-02T00:00:00.000Z" },
          { id: "C", storage_path: "test/C.jpg", is_primary: false, sort_order: 2, review_status: "approved", created_at: "2026-01-03T00:00:00.000Z" },
          { id: "X", storage_path: "test/X-old.jpg", is_primary: false, sort_order: 3, review_status: "approved", created_at: "2026-01-04T00:00:00.000Z" },
          { id: "D", storage_path: "test/D.jpg", is_primary: false, sort_order: 3, review_status: "approved", created_at: "2026-01-05T00:00:00.000Z" }
        ],
        deletedPhotoIds: ["D"]
      };
      const visiblePhotoIds = activeDancerPhotoRows(profile).map((photo) => photo.id);
      return {
        passed: visiblePhotoIds.join(",") === "A,B,C",
        visiblePhotoIds,
        deletedPhotoExcluded: !visiblePhotoIds.includes("D"),
        previousUploadExcluded: !visiblePhotoIds.includes("X"),
        emptySlotPreserved: visiblePhotoIds.length === 3
      };
    }

    function approvedVisualPhotoItems(profile, options = {}) {
      const includeUnapproved = options.includeUnapproved !== false;
      return relabelVisualPhotoItems(editableDancerPhotoRows(profile)
        .filter((photo) => includeUnapproved || normalizedReviewStatus(photo.review_status || photo.reviewStatus || "pending") === "approved")
        .map((photo) => {
          const isPrimary = Boolean(photo.is_primary || photo.isPrimary);
          const sortOrder = Number(photo.sort_order ?? photo.sortOrder ?? 1);
          const target = normalizedReviewStatus(photo.review_status || photo.reviewStatus || "pending") === "pending"
            ? `pending:${photo.id}`
            : isPrimary ? "main" : `gallery:${Math.max(0, sortOrder - 1)}`;
          const imageUrl = photo.imageUrl || photo.image_url || photo.url || photo.storage_path || "";
          const review = latestContentReview(`photo:${photo.id}`);
          return {
            ...photo,
            id: String(photo.id),
            imageUrl,
            label: "Photo",
            status: normalizedReviewStatus(review?.status || photo.review_status || photo.reviewStatus || "pending"),
            notes: review?.notes || photo.review_notes || photo.reviewNotes || "",
            target,
            storagePath: photo.storage_path || photo.storagePath || "",
            sortOrder,
            sort_order: sortOrder,
            isPrimary,
            is_primary: isPrimary
          };
        }));
    }

    function photoDisplayLabel(index) {
      return index === 0 ? "Main Photo" : `Photo ${index + 1}`;
    }

    function relabelVisualPhotoItems(photos) {
      const primary = photos.find((photo) => photo.target === "main" || photo.isPrimary || photo.is_primary);
      const ordered = primary ? [primary, ...photos.filter((photo) => photo !== primary)] : photos;
      return ordered.map((photo, index) => ({
        ...photo,
        label: photoDisplayLabel(index)
      }));
    }

    function dancerProfilePhotoSlots(profile) {
      return editableDancerPhotoRows(profile).slice(0, MAX_DANCER_PROFILE_PHOTOS).map((photo) => ({
        key: normalizeDancerPhotoKey(photo.id || photo.storage_path || photo.storagePath),
        imageUrl: photo.imageUrl || photo.image_url || photo.url || photo.storage_path || "",
        photo
      }));
    }

    function dancerProfilePhotoCount(profile) {
      return dancerProfilePhotoSlots(profile).length;
    }

    function isReplacingApprovedPhotoTarget(profile, target) {
      const text = String(target || "");
      if (text === "gallery" || text === "gallery-add" || text.startsWith("gallery-add:")) return false;
      if (text.startsWith("pending:")) return true;
      if (text.startsWith("submitted:")) {
        const submittedIndex = Number(text.split(":")[1]);
        return Number.isInteger(submittedIndex) && submittedIndex >= 0 && Boolean(profile?.submittedPhotos?.[submittedIndex]);
      }
      if (text.startsWith("gallery:")) {
        return approvedVisualPhotoItems(profile).some((photo) => photo.target === text);
      }
      if (text !== "main") return false;
      return Boolean(
        profile?.mainPhotoUrl ||
        (profile?.submittedPhotos || []).some((photo) => photo?.isPrimary || photo?.is_primary)
      );
    }

    function selectedPhotoReplacement(profile, target) {
      const text = String(target || "");
      const selected = text.startsWith("submitted:")
        ? profile?.submittedPhotos?.[Number(text.split(":")[1])]
        : approvedVisualPhotoItems(profile).find((photo) => photo.target === text);
      const stored = (profile?.dancer_photos || []).find((photo) => String(photo.id) === String(selected?.id || ""));
      if (!stored) {
        throw new Error("Refresh your profile and select the photo again. Remove a pending upload before replacing it.");
      }
      return {
        id: String(stored.id),
        isPrimary: Boolean(stored.is_primary || stored.isPrimary),
        sortOrder: Number(stored.sort_order ?? stored.sortOrder ?? 0)
      };
    }

    function availableApprovedGallerySortOrders(profile) {
      const used = new Set(
        editableDancerPhotoRows(profile)
          .filter((photo) => !(photo.is_primary || photo.isPrimary))
          .map((photo) => Number(photo.sort_order ?? photo.sortOrder))
          .filter((sortOrder) => Number.isInteger(sortOrder) && sortOrder > 0)
      );
      const highestUsed = Math.max(0, ...used);
      const available = Array.from({ length: MAX_DANCER_PROFILE_PHOTOS }, (_, index) => index + 1)
        .filter((sortOrder) => !used.has(sortOrder));
      return [
        ...available.filter((sortOrder) => sortOrder > highestUsed),
        ...available.filter((sortOrder) => sortOrder <= highestUsed)
      ];
    }

    function nextAvailableApprovedGallerySortOrder(profile) {
      return availableApprovedGallerySortOrders(profile)[0] || MAX_DANCER_PROFILE_PHOTOS;
    }

    function assertDancerProfilePhotoLimit(profile, { adding = 1, replacing = false } = {}) {
      if (replacing) return;
      const currentCount = dancerProfilePhotoCount(profile);
      const remaining = MAX_DANCER_PROFILE_PHOTOS - currentCount;
      if (remaining < adding) {
        throw new Error(`You can upload up to ${MAX_DANCER_PROFILE_PHOTOS} profile pictures. Delete or replace one before adding more.`);
      }
    }

    async function persistQueuedApprovedPhotoDeletionsBeforeUpload(profile) {
      const deletedPayload = photoDeletedPayloadFromProfile(profile);
      const requestedPhotoIds = deletedPayload.deletedPhotoIds;
      if (!requestedPhotoIds.length && !deletedPayload.deletedPhotoStoragePaths.length) return profile;

      setApprovedPhotoUploadStatus("Saving deleted photo slots before upload...", "moderating");
      const data = await patchAuthenticatedJson("/api/dancer/profile", deletedPayload);
      if (!data?.profile) {
        throw new Error("Unable to save deleted photos before upload.");
      }

      const remainingDeletedPhotos = deletedPhotosStillInServerProfile(data.profile, deletedPayload);
      if (remainingDeletedPhotos.length) {
        throw new Error("The deleted photo slots could not be released. Please try again.");
      }

      const confirmedPhotoIds = new Set(
        (Array.isArray(data.deletedPhotoIds) ? data.deletedPhotoIds : [])
          .map(normalizeDancerPhotoKey)
          .filter(Boolean)
      );
      const unconfirmedPhotoIds = requestedPhotoIds.filter((photoId) => !confirmedPhotoIds.has(photoId));
      if (unconfirmedPhotoIds.length) {
        throw new Error("The deleted photo slots could not be confirmed. Please try again.");
      }

      clearDeletedDancerPhotos(profile);
      applyDancerApprovalProfile(data.profile);
      const refreshedProfile = activeDancerProfile(data.profile.city || data.profile.cityName || activeDancerCity()) || profile;
      clearDeletedDancerPhotos(refreshedProfile);
      return refreshedProfile;
    }

    function normalizeLocalDancerPhotos(profile) {
      if (!profile) return;
      const activeRows = activeDancerPhotoRows(profile);
      const editableRows = editableDancerPhotoRows(profile);
      const approvedRows = activeRows.filter((photo) => normalizedReviewStatus(photo.review_status || photo.reviewStatus || "pending") === "approved");
      const primary = approvedRows.find((photo) => photo.is_primary || photo.isPrimary) || approvedRows[0] || null;
      const approvedGallery = approvedRows.filter((photo) => photo !== primary);
      const photoUrl = (photo) => photo?.imageUrl || photo?.image_url || photo?.url || photo?.storage_path || "";
      profile.mainPhotoUrl = photoUrl(primary);
      profile.mainPhotoFocalX = primary?.focalX ?? primary?.imageFocalX ?? 50;
      profile.mainPhotoFocalY = primary?.focalY ?? primary?.imageFocalY ?? 50;
      profile.galleryPhotoUrls = approvedGallery.map(photoUrl).filter(Boolean);
      profile.submittedPhotos = editableRows
        .filter((photo) => normalizedReviewStatus(photo.review_status || photo.reviewStatus || "pending") === "pending")
        .map((photo) => ({ ...photo, imageUrl: photoUrl(photo), storagePath: photo.storage_path || photo.storagePath || "" }));
    }

    function normalizeDancerPhotoKey(value = "") {
      const text = String(value || "").trim();
      if (!text) return "";
      try {
        const parsed = new URL(text, window.location.origin);
        if (parsed.pathname === "/api/media/dancer-photo") return parsed.searchParams.get("path") || "";
        const marker = "/storage/v1/object/public/dancer-photos/";
        const markerIndex = parsed.pathname.indexOf(marker);
        return markerIndex >= 0
          ? decodeURIComponent(parsed.pathname.slice(markerIndex + marker.length)).replace(/^\/+/, "")
          : text;
      } catch (error) {
        return text.replace(/^\/+/, "");
      }
    }

    const queuedDancerPhotoDeletions = new Map();

    function dancerPhotoDeletionQueueKey(profile) {
      const stableId = profile?.id || profile?.dancerId || profile?.user_id || profile?.userId;
      if (stableId) return `dancer:${String(stableId)}`;
      const city = profile?.city || activeDancerCity() || "";
      const name = profile?.name || profile?.stage_name || profile?.stageName || activeDancerName() || "";
      return `profile:${String(city).trim().toLowerCase()}:${String(name).trim().toLowerCase()}`;
    }

    function dancerPhotoDeletionQueue(profile, create = false) {
      const key = dancerPhotoDeletionQueueKey(profile);
      if (!queuedDancerPhotoDeletions.has(key) && create) {
        queuedDancerPhotoDeletions.set(key, {
          ids: new Set(),
          storagePaths: new Set(),
          urls: new Set()
        });
      }
      return queuedDancerPhotoDeletions.get(key) || null;
    }

    function deletedDancerPhotoKeySet(profile) {
      const queued = dancerPhotoDeletionQueue(profile);
      return new Set([
        ...(profile?.deletedPhotoIds || []),
        ...(queued?.ids || [])
      ].map(normalizeDancerPhotoKey).filter(Boolean));
    }

    function photoDeletedPayloadFromProfile(profile) {
      const queued = dancerPhotoDeletionQueue(profile);
      return {
        deletedPhotoIds: [...new Set([
          ...(profile?.deletedPhotoIds || []),
          ...(queued?.ids || [])
        ].map(normalizeDancerPhotoKey).filter(Boolean))],
        deletedPhotoStoragePaths: []
      };
    }

    function deletedPhotosStillInServerProfile(serverProfile, deletedPayload) {
      const deletedKeys = new Set([
        ...(deletedPayload?.deletedPhotoIds || [])
      ].map(normalizeDancerPhotoKey).filter(Boolean));
      if (!deletedKeys.size) return [];
      return (serverProfile?.dancer_photos || []).filter((photo) => [
        photo?.id
      ].map(normalizeDancerPhotoKey).filter(Boolean).some((key) => deletedKeys.has(key)));
    }

    function rememberDeletedDancerPhoto(profile, { photoId = "" } = {}) {
      if (!profile) return;
      const id = normalizeDancerPhotoKey(photoId);
      const queued = dancerPhotoDeletionQueue(profile, true);
      if (id) queued.ids.add(id);
      profile.deletedPhotoIds = [...new Set([...(profile.deletedPhotoIds || []), id].filter(Boolean))];
      profile.deletedPhotoUrls = [];
      profile.deletedPhotoStoragePaths = [];
    }

    function clearDeletedDancerPhotos(profile) {
      if (!profile) return;
      profile.deletedPhotoIds = [];
      profile.deletedPhotoUrls = [];
      profile.deletedPhotoStoragePaths = [];
      queuedDancerPhotoDeletions.delete(dancerPhotoDeletionQueueKey(profile));
    }

    function photoMatchesDeletedDancerPhoto(profile, photo = {}) {
      const deleted = deletedDancerPhotoKeySet(profile);
      return [
        photo.id,
        photo.imageUrl,
        photo.image_url,
        photo.url,
        photo.storagePath,
        photo.storage_path
      ].map(normalizeDancerPhotoKey).filter(Boolean).some((key) => deleted.has(key));
    }

    if (new URLSearchParams(window.location.search).get("photo-source-test") === "1") {
      window.__dancrPhotoSourceTestResult = runPhotoSourceOfTruthSelfTest();
      document.documentElement.setAttribute("data-photo-source-test", JSON.stringify(window.__dancrPhotoSourceTestResult));
      console.log(`PHOTO_SOURCE_OF_TRUTH_SELF_TEST ${JSON.stringify(window.__dancrPhotoSourceTestResult)}`);
    }

    function photoUrlFromTarget(profile, target, submittedIndex, galleryIndex) {
      if (Number.isInteger(submittedIndex) && submittedIndex >= 0) {
        const photo = profile?.submittedPhotos?.[submittedIndex];
        return photo?.imageUrl || photo?.image_url || photo?.url || "";
      }
      if (target === "main") return profile?.mainPhotoUrl || "";
      if (Number.isInteger(galleryIndex) && galleryIndex >= 0) return profile?.galleryPhotoUrls?.[galleryIndex] || "";
      return "";
    }

    function removeLocalDancerPhoto(profile, { target = "", photoId = "", photoUrl = "", storagePath = "" } = {}) {
      if (!profile) return false;
      rememberDeletedDancerPhoto(profile, { photoId, photoUrl, storagePath });
      const submittedBefore = profile.submittedPhotos?.length || 0;
      const galleryBefore = profile.galleryPhotoUrls?.length || 0;
      const mainBefore = profile.mainPhotoUrl || "";
      profile.submittedPhotos = (profile.submittedPhotos || []).filter((photo, index) => {
        const id = String(photo?.id || "");
        const url = photo?.imageUrl || photo?.image_url || photo?.url || "";
        return !(photoId ? id === photoId : photoUrl ? url === photoUrl : target === `submitted:${index}`);
      });
      if (photoUrl && profile.mainPhotoUrl === photoUrl) profile.mainPhotoUrl = "";
      profile.galleryPhotoUrls = (profile.galleryPhotoUrls || []).filter((url) => !photoUrl || url !== photoUrl);
      normalizeLocalDancerPhotos(profile);
      return submittedBefore !== (profile.submittedPhotos?.length || 0) ||
        galleryBefore !== (profile.galleryPhotoUrls?.length || 0) ||
        mainBefore !== (profile.mainPhotoUrl || "");
    }

    function approvedVisualProfileFixCount(profile = activeDancerProfile()) {
      const photos = approvedVisualPhotoItems(profile);
      const submittedSocials = normalizeSubmittedSocials(profile);
      const socialFixes = submittedSocials.filter((social) => normalizedReviewStatus(social.reviewStatus) === "rejected").length;
      return photos.filter((photo) => photo.status === "rejected").length + socialFixes;
    }

    function approvedProfileVideoStatusLabel(status = "") {
      return ({
        uploading: "Upload incomplete",
        moderating: "Safety check",
        submitted: "Under review",
        approved: "Moderation passed",
        rejected: "Not approved"
      })[status] || status || "Saved";
    }

    function clearPendingApprovedProfileVideoSelection() {
      if (pendingApprovedProfileVideoPreviewUrl) {
        URL.revokeObjectURL(pendingApprovedProfileVideoPreviewUrl);
      }
      pendingApprovedProfileVideoFile = null;
      pendingApprovedProfileVideoPreviewUrl = "";
      pendingApprovedProfileVideoConsent = false;
      pendingApprovedProfileVideoRights = false;
    }

    function rememberPendingApprovedProfileVideo(file) {
      if (pendingApprovedProfileVideoPreviewUrl) {
        URL.revokeObjectURL(pendingApprovedProfileVideoPreviewUrl);
      }
      pendingApprovedProfileVideoFile = file || null;
      pendingApprovedProfileVideoPreviewUrl = file ? URL.createObjectURL(file) : "";
      return pendingApprovedProfileVideoPreviewUrl;
    }

    function approvedProfileVideoManagerMarkup() {
      const workspace = approvedProfileVideoWorkspace;
      const videos = Array.isArray(workspace?.videos)
        ? workspace.videos.slice(0, MAX_DANCER_PROFILE_VIDEOS)
        : [];
      const atLimit = videos.length >= MAX_DANCER_PROFILE_VIDEOS;
      const emptySlots = Math.min(6, Math.max(0, MAX_DANCER_PROFILE_VIDEOS - videos.length));
      const message = approvedProfileVideoStatus || (approvedProfileVideoLoading
        ? "Loading your profile videos..."
        : workspace?.profileEligible === false
          ? "Videos that pass safety moderation stay private until your dancer profile is approved."
          : "Approved videos automatically appear with the pictures on your public profile and in MyDancr TV.");
      const selectedVideoUrl = pendingApprovedProfileVideoPreviewUrl;
      return `
        <section class="approved-profile-video-manager" id="approvedProfileVideoManager" aria-labelledby="approvedProfileVideoTitle">
          <div class="approved-profile-video-head">
            <div>
              <strong id="approvedProfileVideoTitle">Profile videos</strong>
              <p>Upload up to ${MAX_DANCER_PROFILE_VIDEOS} vertical videos here. Every video is checked before it can go live.</p>
            </div>
            <span class="approved-profile-video-count">${videos.length}/${MAX_DANCER_PROFILE_VIDEOS}</span>
          </div>
          <div class="approved-profile-video-slots" aria-label="Profile video slots">
            ${videos.map((video, index) => `
              <article class="approved-profile-video-slot">
                ${video.videoUrl
                  ? `<video src="${displayText(video.videoUrl)}" controls playsinline preload="none" aria-label="Profile video ${index + 1}"></video>`
                  : '<div class="approved-profile-video-empty"><small>Video preview unavailable</small></div>'}
                <div class="approved-profile-video-slot-copy">
                  <span class="approved-profile-video-status">${displayText(approvedProfileVideoStatusLabel(video.status))}</span>
                </div>
                <button class="approved-profile-video-remove" type="button" data-approved-profile-video-remove="${displayText(video.id)}" ${approvedProfileVideoRemovingId === video.id ? "disabled" : ""}>
                  ${approvedProfileVideoRemovingId === video.id ? "Removing..." : "Remove"}
                </button>
              </article>
            `).join("")}
            ${Array.from({ length: emptySlots }, (_, index) => `
              <button class="approved-profile-video-slot approved-profile-video-empty" type="button" data-approved-profile-video-add ${approvedProfileVideoLoading ? "disabled" : ""} aria-label="Upload profile video ${videos.length + index + 1}">
                <span aria-hidden="true">+</span>
                <small>Video ${videos.length + index + 1}</small>
              </button>
            `).join("")}
          </div>
          ${workspace && workspace.profileEligible === false
            ? '<p class="approved-profile-video-limit">Private during setup · every upload receives automated safety moderation.</p>'
            : ""}
          ${!workspace ? (approvedProfileVideoLoading
              ? ""
              : '<button class="action-btn secondary" type="button" data-approved-profile-video-retry>Retry loading videos</button>') : atLimit
              ? `<p class="approved-profile-video-limit">All ${MAX_DANCER_PROFILE_VIDEOS} video slots are filled. Remove a video above before uploading another.</p>`
              : `
                <form class="approved-profile-video-form" id="approvedProfileVideoUploadForm">
                  <label>
                    Video file
                    <input id="approvedProfileVideoInput" type="file" accept="video/mp4,video/webm" ${pendingApprovedProfileVideoFile ? "" : "required"}>
              <small>Vertical or square MP4/WebM · 1–30 seconds · 75 MB maximum</small>
                  </label>
                  <video class="approved-profile-video-preview" id="approvedProfileVideoPreview" controls playsinline ${selectedVideoUrl ? `src="${escapeHtml(selectedVideoUrl)}"` : "hidden"}></video>
                  <div class="approved-profile-video-schedule-note">
                    <strong>Venue context is automatic</strong>
                    <small>MyDancr TV uses your verified Working Now shift first, then your next posted shift. If neither exists, the video shows no venue.</small>
                  </div>
                  <label class="approved-profile-video-check">
                    <input id="approvedProfileVideoConsent" type="checkbox" required ${pendingApprovedProfileVideoConsent ? "checked" : ""}>
                    <span>I have permission from every identifiable person shown.</span>
                  </label>
                  <label class="approved-profile-video-check">
                    <input id="approvedProfileVideoRights" type="checkbox" required ${pendingApprovedProfileVideoRights ? "checked" : ""}>
                    <span>I own this video or have permission to publish every visual, recording, song, beat, and other audio it contains.</span>
                  </label>
                  <button type="submit" ${approvedProfileVideoSubmitting ? "disabled" : ""}>
                    ${approvedProfileVideoSubmitting ? "Uploading and checking..." : "Upload profile video"}
                  </button>
                </form>
              `}
          <div class="approved-profile-video-message ${approvedProfileVideoStatusTone ? `is-${approvedProfileVideoStatusTone}` : ""}" id="approvedProfileVideoStatus" role="status" aria-live="polite">${displayText(message)}</div>
        </section>
      `;
    }

    function renderApprovedProfileVideoManager() {
      const current = document.getElementById("approvedProfileVideoManager");
      if (!current) return;
      const holder = document.createElement("div");
      holder.innerHTML = approvedProfileVideoManagerMarkup();
      current.replaceWith(holder.firstElementChild);
    }

    async function loadApprovedProfileVideos({ force = false } = {}) {
      if (!isDancerSession() || approvedProfileVideoLoading) return approvedProfileVideoWorkspace;
      if (approvedProfileVideoWorkspace && !force) return approvedProfileVideoWorkspace;
      const headers = authenticatedRequestHeaders();
      if (!headers) return null;
      approvedProfileVideoLoading = true;
      approvedProfileVideoStatus = "Loading your profile videos...";
      approvedProfileVideoStatusTone = "";
      renderApprovedProfileVideoManager();
      try {
        const response = await fetch("/api/dancer/tv/videos", { headers, cache: "no-store" });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.ok === false) {
          throw new Error(normalizeRequestError(data.error || data.message, "Unable to load profile videos."));
        }
        applyResponseSession(data, headers);
        approvedProfileVideoWorkspace = data;
        approvedProfileVideoStatus = "";
        approvedProfileVideoStatusTone = "";
        return data;
      } catch (error) {
        approvedProfileVideoStatus = error?.message || "Unable to load profile videos.";
        approvedProfileVideoStatusTone = "error";
        return null;
      } finally {
        approvedProfileVideoLoading = false;
        renderApprovedProfileVideoManager();
        if (document.getElementById("setupChecklist")) renderDancerSetupWhenEditorIdle();
      }
    }

    async function readApprovedProfileVideoMetadata(file) {
      if (!["video/mp4", "video/webm"].includes(file?.type)) {
        throw new Error("Upload an MP4 or WebM video.");
      }
      if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > 75 * 1024 * 1024) {
        throw new Error("Video files must be 75 MB or smaller.");
      }
      const video = document.createElement("video");
      const previewUrl = URL.createObjectURL(file);
      let metadataTimer = 0;
      try {
        const metadata = await new Promise((resolve, reject) => {
          video.preload = "metadata";
          video.onloadedmetadata = () => resolve({
            duration: video.duration,
            width: video.videoWidth,
            height: video.videoHeight
          });
          video.onerror = () => reject(new Error("This video could not be read. Try a different MP4 or WebM file."));
          metadataTimer = window.setTimeout(() => reject(new Error("This video took too long to read. Try again or choose a different file.")), 20_000);
          video.src = previewUrl;
        });
      if (!Number.isFinite(metadata.duration) || metadata.duration < 1 || metadata.duration > 30) {
        throw new Error("Videos must be between 1 and 30 seconds.");
        }
        if (!Number.isSafeInteger(metadata.width) || metadata.width < 240 || metadata.height < metadata.width) {
          throw new Error("Use a vertical or square video at least 240 pixels wide.");
        }
        return metadata;
      } finally {
        window.clearTimeout(metadataTimer);
        video.onloadedmetadata = null;
        video.onerror = null;
        video.pause();
        video.removeAttribute("src");
        video.load();
        URL.revokeObjectURL(previewUrl);
      }
    }