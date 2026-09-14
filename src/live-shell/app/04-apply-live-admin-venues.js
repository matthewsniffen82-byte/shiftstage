

    function applyLiveAdminVenues(venues) {
      (venues || []).forEach((item) => {
        const city = item.city || citySelect.value;
        const market = discoveryMarket(city);
        if (!market) return;
        const existing = market.venues.find((venue) => venue.id === item.id || venue.slug === item.slug || venue.name === item.name);
        const venueData = mapLiveAdminVenue(item, city, existing);
        if (existing) Object.assign(existing, venueData);
        else market.venues.push(venueData);
        market.stats.venues = market.venues.filter((venue) => !venue.hidden).length;
      });
    }

    function isAdminSession() {
      return Boolean(authSession?.accessToken && authSession?.account?.role === "admin");
    }

    function isDancerSession() {
      return Boolean(authSession?.accessToken && authSession?.account?.role === "dancer");
    }

    function isCustomerSession() {
      return Boolean(authSession?.accessToken && authSession?.account?.role === "customer");
    }

    function isVenueSession() {
      return Boolean(authSession?.accessToken && authSession?.account?.role === "venue");
    }

    function findProfileBySavedDancer(savedDancer) {
      const dancer = savedDancer?.dancer || savedDancer;
      const dancerId = savedDancer?.dancerId || dancer?.id;
      if (dancerId) {
        for (const [city, market] of Object.entries(markets)) {
          const profile = market.dancers.find((item) => item.id === dancerId);
          if (profile) return { city, profile };
        }
        return null;
      }
      const city = dancer?.city;
      const market = city ? discoveryMarket(city) : null;
      if (!market) return null;
      const profile = market.dancers.find((item) => (
        item.id === dancer.id ||
        item.slug === dancer.slug ||
        item.name === dancer.stageName
      ));
      return profile ? { city, profile } : null;
    }

    function findProfileBySavedShift(savedGoing) {
      const shift = savedGoing?.shift;
      const city = shift?.dancer?.city || shift?.venue?.city;
      const market = city ? discoveryMarket(city) : null;
      if (!market) return null;
      const profile = market.dancers.find((item) => (
        item.shiftId === savedGoing.shiftId ||
        item.id === shift?.dancer?.id ||
        item.slug === shift?.dancer?.slug ||
        item.name === shift?.dancer?.stageName
      ));
      return profile ? { city, profile } : null;
    }

    function findVenueBySavedVenue(savedVenue) {
      const venue = savedVenue?.venue || savedVenue;
      const city = venue?.city;
      const market = city ? discoveryMarket(city) : null;
      if (!market) return null;
      const match = market.venues.find((item) => (
        item.id === venue.id ||
        item.slug === venue.slug ||
        item.name === venue.name
      ));
      return match ? { city, venue: match } : null;
    }

    function applyLiveProfileActions(saved) {
      clearLiveProfileActionCollections();
      (saved?.follows || []).forEach((item) => {
        const dancerId = item.dancerId || item.dancer?.id;
        if (dancerId) followedDancerIds.add(dancerId);
        const match = findProfileBySavedDancer(item);
        if (!match) return;
        setProfileFollowed(match.city, match.profile.name, true);
        if (item.notificationsEnabled) enableProfileNotifications(match.city, match.profile.name);
        else disableProfileNotifications(match.city, match.profile.name);
      });
      (saved?.goingSignals || []).forEach((item) => {
        const match = findProfileBySavedShift(item);
        if (!match) return;
        goingTonightSavedByProfile[match.profile.name] = true;
        goingTonightByProfile[match.profile.name] = tonightInterestCount(match.profile);
      });
      syncOpenProfileFollowButton();
    }

    function applyLiveCustomerSaved(saved) {
      if (authSession?.accessToken) clearCustomerSavedCollections();
      applyLiveProfileActions(saved);
      mergeLiveCustomerSavedDeals(saved?.dealSaves);
      mergeLiveCustomerDealPasses(saved?.dealRedemptions);
      (saved?.favorites || []).forEach((item) => {
        const match = findProfileBySavedDancer(item);
        if (!match) return;
        const favorites = favoritedByCity[match.city] || (favoritedByCity[match.city] = []);
        if (!favorites.includes(match.profile.name)) favorites.push(match.profile.name);
      });
      (saved?.venueFollows || []).forEach((item) => {
        const match = findVenueBySavedVenue(item);
        if (!match) return;
        const followedVenues = followedVenuesByCity[match.city] || (followedVenuesByCity[match.city] = []);
        if (!followedVenues.includes(match.venue.name)) followedVenues.push(match.venue.name);
      });
    }

    async function loadLiveProfileActionState() {
      if (!isCustomerSession()) return;
      const savedStateVersion = customerSavedStateVersion;
      try {
        const data = await getAuthenticatedJson("/api/customer/saved");
        if (!isCustomerSession() || savedStateVersion !== customerSavedStateVersion) return;
        applyLiveProfileActions(data.saved || {});
        render();
      } catch (error) {
        showToast(error.message || "Could not load profile actions");
      }
    }

    async function loadLiveCustomerProfile() {
      if (!isCustomerSession()) return null;
      const data = await getAuthenticatedJson("/api/customer/profile");
      liveCustomerProfile = data.profile || null;
      const city = liveCustomerProfile?.city;
      if (city && discoveryMarket(city) && citySelect.value !== city && citySelect.value !== ALL_CITIES) {
        citySelect.value = city;
        await loadLiveDiscovery(city);
      }
      render();
      if (customerDashboard.classList.contains("show")) renderDashboard();
      return liveCustomerProfile;
    }

    async function loadLiveCustomerSaved() {
      if (!isCustomerSession()) return false;
      const savedStateVersion = customerSavedStateVersion;
      const storageKey = savedDealsStorageKey();
      try {
        const data = await getAuthenticatedJson("/api/customer/saved");
        // An older read must not replace a follow or favorite saved while it was in flight.
        if (!isCustomerSession() || savedStateVersion !== customerSavedStateVersion || storageKey !== savedDealsStorageKey()) return false;
        applyLiveCustomerSaved(data.saved || {});
        render();
        if (customerDashboard.classList.contains("show")) renderDashboard();
        return true;
      } catch (error) {
        console.warn("Customer saved state unavailable; keeping the current page state", error);
        return false;
      }
    }

    async function loadLiveCustomerDashboardData() {
      if (!isCustomerSession()) return;
      liveCustomerDashboardState = "loading";
      if (customerDashboard.classList.contains("show")) renderDashboard();
      let loaded = true;
      try {
        await loadLiveCustomerProfile();
      } catch (error) {
        loaded = false;
        showToast(error.message || "Could not load guest profile");
      }
      if (!(await loadLiveCustomerSaved())) loaded = false;
      liveCustomerDashboardState = loaded ? "ready" : "error";
      if (customerDashboard.classList.contains("show")) renderDashboard();
    }

    function saveLiveCustomerProfile(update) {
      if (!isCustomerSession()) return;
      patchAuthenticatedJson("/api/customer/profile", update).then((data) => {
        if (data?.profile) liveCustomerProfile = data.profile;
      }).catch((error) => showToast(error.message || "Could not save guest profile"));
    }

    function notificationClearStorageKey() {
      const account = authSession?.account || {};
      const identity = account.id || account.email || authSession?.user?.id || authSession?.email || "anonymous";
      const role = account.role || authSession?.role || "user";
      return `mydancr:notifications-cleared-at:${role}:${identity}`;
    }

    function notificationClearedAtMs() {
      try {
        const value = Number(localStorage.getItem(notificationClearStorageKey()) || 0);
        return Number.isFinite(value) ? value : 0;
      } catch {
        return 0;
      }
    }

    function markNotificationsClearedNow(clearedAt = Date.now(), storageKey = notificationClearStorageKey()) {
      try {
        const previous = Number(localStorage.getItem(storageKey)) || 0;
        localStorage.setItem(storageKey, String(Math.max(previous, clearedAt)));
      } catch {
        // Local persistence is only used to suppress regenerated browser-only notices.
      }
    }

    function notificationTimestampMs(notification) {
      const value = notification?.sentAt || notification?.createdAt || notification?.created_at || "";
      const timestamp = value ? new Date(value).getTime() : 0;
      return Number.isFinite(timestamp) ? timestamp : 0;
    }

    function isVisibleAfterNotificationClear(notification) {
      const clearedAt = notificationClearedAtMs();
      if (!clearedAt) return true;
      if (notification?.localOnly && notification.type === "approval_status" && notification.payload?.status === "approved") return false;
      const timestamp = notificationTimestampMs(notification);
      return timestamp > clearedAt;
    }

    function visibleLiveNotifications() {
      return liveNotifications.filter(isVisibleAfterNotificationClear);
    }

    function notificationCenterMarkup() {
      if (liveNotificationsState === "loading") {
        return '<div class="locked" role="status">Loading notifications…</div>';
      }
      if (liveNotificationsState === "error") {
        return '<div class="locked" role="status">Notifications could not be loaded. Reopen notifications to try again.</div>';
      }
      const notifications = visibleLiveNotifications();
      if (!notifications.length) {
        return '<div class="locked">No notifications yet.</div>';
      }
      return notifications.slice(0, 8).map((notification) => {
        const unread = !notification.readAt;
        const date = formatBillingDate(notification.sentAt || notification.createdAt);
        const notificationId = notification.id || "";
        const canMarkRead = unread && notificationId && !notification.localOnly;
        const actionable = isActionableDancerReviewNotification(notification);
        const notificationIndex = notifications.indexOf(notification);
        return `
          <article class="rank-event ${unread ? "top-ten" : "stable"}" ${notificationId ? `data-notification-id="${notificationId}"` : ""} data-notification-index="${notificationIndex}" ${actionable ? 'role="button" tabindex="0" title="Open the issue to fix"' : ""}>
            <span class="rank-event-icon">${unread ? "!" : "OK"}</span>
            <span>
              <strong>${displayText(notification.title || "Dancr notification")}</strong>
              <p>${displayText(notification.body || "You have a new update.")}${date ? ` · ${date}` : ""}</p>
              ${canMarkRead ? '<button class="ghost" type="button" data-notification-action="mark-read">Mark read</button>' : ""}
            </span>
          </article>
        `;
      }).join("");
    }

    function ensureLocalDancerApprovalNotification(profile) {
      if (!isDancerSession() || profile?.status !== "approved") return;
      const alreadyShown = liveNotifications.some((notification) => (
        notification.type === "approval_status" &&
        (notification.payload?.status === "approved" || notification.title === "Your Dancr profile is live")
      ));
      if (alreadyShown) return;

      const stageName = profile.stage_name || profile.stageName || document.getElementById("dancerStageName")?.value || "Your Dancr profile";
      const createdAt = new Date().toISOString();
      const notification = {
        id: "",
        localOnly: true,
        type: "approval_status",
        title: "Your Dancr profile is live",
        body: `${stageName} is live after verified venue affiliation.`,
        payload: { status: "approved" },
        readAt: null,
        sentAt: createdAt,
        createdAt
      };
      if (!isVisibleAfterNotificationClear(notification)) return;
      liveNotifications = [notification, ...liveNotifications];
      renderNotificationCenters();
    }

    function renderNotificationCenters() {
      liveNotifications = visibleLiveNotifications();
      const clearing = liveNotificationClearPending?.accountKey === notificationClearStorageKey();
      document.querySelectorAll('[data-notification-action="clear-all"]').forEach((button) => {
        button.disabled = clearing || !liveNotifications.length;
        button.setAttribute("aria-busy", String(clearing));
      });
      const markup = notificationCenterMarkup();
      if (customerNotificationList) customerNotificationList.innerHTML = markup;
      if (dancerNotificationList) dancerNotificationList.innerHTML = markup;
      const dancerNotificationSummaryCount = document.getElementById("dancerNotificationSummaryCount");
      if (dancerNotificationSummaryCount) {
        dancerNotificationSummaryCount.textContent = String(liveNotifications.filter((notification) => !notification.readAt).length);
      }
      renderCustomerQuickActions();
    }

    function isActionableDancerReviewNotification(notification) {
      return isDancerSession() && notification?.payload?.status === "rejected" && Boolean(notification.payload.setupStep || notification.payload.targetType);
    }

    function setupStepForNotificationPayload(payload = {}) {
      if (payload.setupStep) return payload.setupStep;
      if (payload.targetType === "photo") return "photos";
      return "profile";
    }

    function inputSelectorForReviewPayload(payload = {}) {
      const label = String(payload.label || "").toLowerCase();
      if (payload.targetType === "photo") return "#setupProfilePhotos";
      if (payload.targetType === "social_link") {
        if (label.includes("instagram")) return "#setupInstagram";
        if (label.includes("tiktok")) return "#setupTiktok";
        if (label.includes("snap")) return "#setupSnapchat";
        if (label.includes("onlyfans")) return "#setupOnlyfans";
        if (label === "x" || label.includes("twitter")) return "#setupX";
      }
      if (payload.setupStep === "approval") return "";
      return "#setupStageName";
    }

    function setupStepForRejectedTarget(targetType) {
      if (targetType === "photo") return "photos";
      return "profile";
    }

    function rejectedTargetTitle(targetType, label) {
      if (label) return `${label} needs changes`;
      if (targetType === "photo") return "Profile photo needs changes";
      return "Social link needs changes";
    }

    function addLocalDancerReviewNotification(profile, targetType, targetId, label, notes) {
      if (!isDancerSession()) return;
      const activeProfile = activeDancerProfile();
      const sameProfile = activeProfile && profile && (
        activeProfile.id === profile.id ||
        activeProfile.name === profile.name ||
        activeProfile.slug === profile.slug
      );
      if (!sameProfile) return;
      liveNotifications = [{
        id: "",
        localOnly: true,
        type: "approval_status",
        title: rejectedTargetTitle(targetType, label),
        body: `Dancr reviewed this item and needs you to fix or resend it. Reason: ${notes}`,
        payload: {
          status: "rejected",
          targetType,
          targetId,
          label,
          notes,
          setupStep: setupStepForRejectedTarget(targetType)
        },
        readAt: null,
        sentAt: new Date().toISOString(),
        createdAt: new Date().toISOString()
      }, ...liveNotifications];
      renderNotificationCenters();
    }

    function openDancerReviewIssue(notification) {
      if (!isActionableDancerReviewNotification(notification)) return false;
      const payload = notification.payload || {};
      closeCustomerQuickPanels();
      if (!dancerDashboard.classList.contains("show")) {
        closeDashboard();
        closeVenueDashboard();
        openDancerDashboard();
      }
      setupChecklistExpanded = true;
      activeSetupStep = setupStepForNotificationPayload(payload);
      renderDancerSetup();
      showToast(payload.notes ? `Fix requested: ${payload.notes}` : "Open the highlighted item and resubmit it.");
      window.requestAnimationFrame(() => {
        const selector = inputSelectorForReviewPayload(payload);
        const input = selector ? document.querySelector(selector) : null;
        const reviewNote = document.querySelector(".review-feedback-item.is-rejected");
        const stepCard = document.querySelector(`#setupChecklist [data-step="${activeSetupStep}"]`);
        const target = input || reviewNote || stepCard || document.getElementById("setupChecklistWrap");
        target?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
        if (input) {
          input.focus({ preventScroll: true });
          input.classList.add("field-needs-review");
          window.setTimeout(() => input.classList.remove("field-needs-review"), 2400);
        } else if (target) {
          target.classList.add("field-needs-review");
          window.setTimeout(() => target.classList.remove("field-needs-review"), 2400);
        }
      });
      if (notification.id && !notification.readAt) markLiveNotificationRead(notification.id);
      return true;
    }

    function notificationFromNode(node) {
      const id = node?.dataset.notificationId || node?.dataset.quickNotificationId || "";
      if (id) return liveNotifications.find((notification) => notification.id === id);
      const index = Number(node?.dataset.notificationIndex);
      return Number.isFinite(index) ? visibleLiveNotifications()[index] : null;
    }

    function closeCustomerQuickPanels() {
      customerNotificationsQuickPanel.hidden = true;
      customerDealsQuickPanel.hidden = true;
      customerNotificationQuickBtn.classList.remove("active");
      customerDealQuickBtn.classList.remove("active");
      customerNotificationQuickBtn.setAttribute("aria-expanded", "false");
      customerDealQuickBtn.setAttribute("aria-expanded", "false");
    }

    function customerQuickNotificationItems() {
      const notifications = visibleLiveNotifications();
      return notifications.slice(0, 5).map((notification, index) => ({
        id: notification.id,
        index,
        unread: !notification.readAt,
        title: notification.title || "Dancr notification",
        detail: `${notification.body || "You have a new update."}${formatBillingDate(notification.sentAt || notification.createdAt) ? ` · ${formatBillingDate(notification.sentAt || notification.createdAt)}` : ""}`
      }));
    }

    function renderCustomerQuickNotifications() {
      if (!customerNotificationsQuickList) return;
      customerNotificationQuickBtn?.setAttribute("aria-label", "Open notifications");
      if (liveNotificationsState === "loading") {
        customerNotificationQuickCount.hidden = true;
        customerNotificationsQuickList.innerHTML = '<div class="customer-quick-empty" role="status">Loading notifications…</div>';
        return;
      }
      if (liveNotificationsState === "error") {
        customerNotificationQuickCount.hidden = true;
        customerNotificationsQuickList.innerHTML = '<div class="customer-quick-empty" role="status">Notifications could not be loaded. Reopen notifications to try again.</div>';
        return;
      }
      const items = customerQuickNotificationItems();
      const unreadCount = visibleLiveNotifications().filter((notification) => !notification.readAt).length;
      const count = unreadCount;
      customerNotificationQuickCount.hidden = count <= 0;
      customerNotificationQuickCount.textContent = String(Math.min(count, 9));
      customerNotificationQuickBtn?.setAttribute(
        "aria-label",
        count > 0 ? `Open notifications, ${count} unread` : "Open notifications"
      );
      customerNotificationsQuickList.innerHTML = items.length
        ? items.map((item) => `
            <button class="customer-quick-item" type="button" ${item.id ? `data-quick-notification-id="${item.id}"` : ""} ${Number.isFinite(item.index) ? `data-notification-index="${item.index}"` : ""}>
              <strong>${displayText(item.title)}</strong>
              <span>${displayText(item.detail)}</span>
            </button>
          `).join("")
        : `<div class="customer-quick-empty" role="status">${isDancerSession()
          ? "No new alerts yet. Dancer account updates will appear here."
          : isVenueSession()
            ? "No new alerts yet. Venue account and dancer affiliation updates will appear here."
            : "No new alerts yet. Recent dancer, venue, and deal notifications will appear here."}</div>`;
    }

    function renderCustomerQuickDeals() {
      if (!customerDealsQuickList) return;
      customerDealsQuickList.innerHTML = savedDealPasses.length
        ? savedDealPasses.slice(0, 5).map((pass) => `
            <button class="customer-quick-item has-qr" type="button" data-deal-pass="${encodeDealPass(pass)}">
              <span class="customer-quick-deal-copy">
                <strong>${displayText(pass.title)}</strong>
                <span>${displayText(pass.venueName)} · cashier tap</span>
              </span>
              ${clubDealQrSymbolMarkup("saved-deal-nfc-symbol")}
            </button>
          `).join("")
        : `<div class="customer-quick-empty">No saved Club Deals yet. Save a Club Deal to find it here later.</div>`;
      syncCustomerDealQuickCta();
    }

    function renderCustomerQuickActions() {
      syncDeviceSavedDealPasses();
      if (!customerQuickActions) return;
      const showNotifications = isCustomerSession() || isDancerSession() || isVenueSession();
      const showProfileShare = isDancerSession();
      const showDeals = isCustomerSession();
      const show = showNotifications || showProfileShare || showDeals;
      customerQuickActions.hidden = !show;
      customerNotificationQuickBtn.hidden = !showNotifications;
      dancerProfileShareQuickBtn.hidden = !showProfileShare;
      customerDealQuickBtn.hidden = !showDeals;
      if (!showNotifications) {
        customerNotificationsQuickPanel.hidden = true;
        customerNotificationQuickBtn.classList.remove("active");
        customerNotificationQuickBtn.setAttribute("aria-expanded", "false");
      }
      if (!showDeals) {
        customerDealsQuickPanel.hidden = true;
        customerDealQuickBtn.classList.remove("active");
        customerDealQuickBtn.setAttribute("aria-expanded", "false");
      }
      if (!showProfileShare) {
        dancerProfileShareQuickBtn.classList.remove("is-open");
        dancerProfileShareQuickBtn.setAttribute("aria-expanded", "false");
        dancerProfileShareQuickBtn.removeAttribute("data-share-city");
      }
      if (!show) {
        closeCustomerQuickPanels();
        return;
      }
      if (showNotifications) renderCustomerQuickNotifications();
      if (showDeals) renderCustomerQuickDeals();
      else syncCustomerDealQuickCta();
    }

    function toggleCustomerQuickPanel(panelName) {
      if (panelName === "notifications" && !(isCustomerSession() || isDancerSession() || isVenueSession())) return;
      if (panelName === "deals" && !isCustomerSession()) return;
      const openNotifications = panelName === "notifications" && customerNotificationsQuickPanel.hidden;
      const openDeals = panelName === "deals" && customerDealsQuickPanel.hidden;
      closeCustomerQuickPanels();
      if (openNotifications) {
        if (liveNotificationsState === "error") void loadLiveNotifications();
        renderCustomerQuickNotifications();
        customerNotificationsQuickPanel.hidden = false;
        customerNotificationQuickBtn.classList.add("active");
        customerNotificationQuickBtn.setAttribute("aria-expanded", "true");
      }
      if (openDeals) {
        renderCustomerQuickDeals();
        customerDealsQuickPanel.hidden = false;
        customerDealQuickBtn.classList.add("active");
        customerDealQuickBtn.setAttribute("aria-expanded", "true");
        markSavedDealsSeen();
      }
    }

    async function loadLiveNotifications() {
      if (!authSession?.accessToken) return;
      const accountKey = notificationClearStorageKey();
      if (liveNotificationClearPending?.accountKey === accountKey) return;
      const requestVersion = ++liveNotificationsRequestVersion;
      liveNotificationsState = "loading";
      renderNotificationCenters();
      try {
        const data = await getAuthenticatedJson("/api/notifications");
        if (requestVersion !== liveNotificationsRequestVersion || accountKey !== notificationClearStorageKey()) return;
        liveNotifications = (data.notifications || []).filter(isVisibleAfterNotificationClear);
        liveNotificationsState = "ready";
      } catch {
        if (requestVersion !== liveNotificationsRequestVersion || accountKey !== notificationClearStorageKey()) return;
        liveNotificationsState = "error";
        // Background notification failures belong in the inbox, not over public discovery.
      }
      renderNotificationCenters();
    }

    async function markLiveNotificationRead(notificationId) {
      if (!notificationId) return;
      try {
        const data = await patchAuthenticatedJson("/api/notifications", { notificationId });
        const match = liveNotifications.find((item) => item.id === notificationId);
        if (match) match.readAt = data.notification?.readAt || new Date().toISOString();
        renderNotificationCenters();
      } catch (error) {
        showToast(error.message || "Could not update notification");
      }
    }

    async function markAllLiveNotificationsRead() {
      try {
        const data = await patchAuthenticatedJson("/api/notifications", { all: true });
        const readAt = data?.readAt || new Date().toISOString();
        liveNotifications = liveNotifications.map((notification) => ({ ...notification, readAt: notification.readAt || readAt }));
        renderNotificationCenters();
        showToast("Notifications marked read");
      } catch (error) {
        showToast(error.message || "Could not update notifications");
      }
    }

    async function clearAllLiveNotifications() {
      if (!authSession?.accessToken) return;
      const accountKey = notificationClearStorageKey();
      if (liveNotificationClearPending?.accountKey === accountKey) return;
      const requestVersion = ++liveNotificationsRequestVersion;
      const clearedAt = Date.now();
      const previousNotifications = liveNotifications.slice();
      liveNotificationClearPending = { accountKey, requestVersion };
      liveNotifications = [];
      liveNotificationsState = "ready";
      renderNotificationCenters();
      try {
        await fetchWithTimeout("/api/notifications", {
          method: "DELETE",
          headers: authenticatedRequestHeaders("application/json") || {}
        }, 15000, "Could not clear notifications. Check your connection and try again.").then(async (response) => {
          const data = await response.json().catch(() => ({}));
          if (!response.ok || data.ok === false) throw new Error(data.error || "Could not clear notifications");
          return data;
        });
        if (requestVersion !== liveNotificationsRequestVersion || accountKey !== notificationClearStorageKey()) return;
        markNotificationsClearedNow(clearedAt, accountKey);
        showToast("Notifications cleared");
      } catch (error) {
        if (requestVersion !== liveNotificationsRequestVersion || accountKey !== notificationClearStorageKey()) return;
        liveNotifications = previousNotifications;
        showToast(error.message || "Could not clear notifications");
      } finally {
        if (liveNotificationClearPending?.requestVersion === requestVersion) liveNotificationClearPending = null;
        if (requestVersion === liveNotificationsRequestVersion && accountKey === notificationClearStorageKey()) renderNotificationCenters();
      }
    }

    function handleNotificationCenterClick(event) {
      const button = event.target.closest("[data-notification-action]");
      if (button) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        const action = button.dataset.notificationAction;
        if (action === "mark-all") {
          markAllLiveNotificationsRead();
          return true;
        }
        if (action === "clear-all") {
          clearAllLiveNotifications();
          return true;
        }
        if (action === "mark-read") {
          const item = button.closest("[data-notification-id]");
          markLiveNotificationRead(item?.dataset.notificationId);
          return true;
        }
      }
      const item = event.target.closest("[data-notification-id], [data-notification-index]");
      const notification = notificationFromNode(item);
      if (openDancerReviewIssue(notification)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return true;
      }
      return false;
    }

    function handleNotificationCenterKeydown(event) {
      if (event.key !== "Enter" && event.key !== " ") return false;
      const item = event.target.closest("[data-notification-id], [data-notification-index]");
      const notification = notificationFromNode(item);
      if (!isActionableDancerReviewNotification(notification)) return false;
      event.preventDefault();
      openDancerReviewIssue(notification);
      return true;
    }

    function handleSupportActionClick(event) {
      const button = event.target.closest("[data-support-action]");
      if (!button) return false;
      const threadId = button.dataset.supportThread || "";
      const textarea = document.querySelector(`[data-support-reply="${CSS.escape(threadId)}"]`);
      const body = textarea?.value.trim() || "";
      if (button.dataset.supportAction === "admin-reply") {
        sendAdminSupportReply(threadId, body).then(() => {
          if (textarea) textarea.value = "";
        });
        return true;
      }
      const role = isDancerSession() || dancerDashboard.classList.contains("show") ? "dancer" : "customer";
      sendSupportMessage(role, "", body, threadId).then((sent) => {
        if (sent && textarea) textarea.value = "";
      });
      return true;
    }

    function ownSupportThreads(role) {
      return liveSupportThreads
        .filter((thread) => thread.userRole === role)
        .slice()
        .sort((a, b) => Date.parse(b.lastMessageAt || b.createdAt || "") - Date.parse(a.lastMessageAt || a.createdAt || ""));
    }

    function supportThreadMarkup(thread, isAdmin = false) {
      const messages = Array.isArray(thread.messages) ? thread.messages : [];
      const userLabel = thread.userName || thread.userEmail || thread.userRole || "User";
      const roleLabel = thread.userRole ? `${thread.userRole === "customer" ? "guest" : thread.userRole} account` : "account";
      const statusLabel = thread.status === "answered" ? "Admin replied" : "Awaiting admin reply";
      return `
        <details class="support-thread" data-support-thread="${displayText(thread.id)}" ${!isAdmin && messages.length <= 2 ? "open" : ""}>
          <summary>
            <strong>${displayText(thread.subject || "Support conversation")}</strong>
            <small>${isAdmin ? `${displayText(userLabel)} · ${displayText(roleLabel)} · ` : ""}${statusLabel} · ${displayText(formatBillingDate(thread.lastMessageAt || thread.createdAt))}</small>
          </summary>
          <div class="support-message-list">
            ${messages.map((message) => `
              <div class="support-message ${message.senderRole === "admin" ? "from-admin" : ""}">
                <strong>${message.senderRole === "admin" ? "Admin Support" : isAdmin ? displayText(userLabel) : "You"}</strong>
                <p>${displayText(message.body || "")}</p>
                <small>${displayText(formatBillingDate(message.createdAt))}</small>
              </div>
            `).join("")}
          </div>
          <textarea data-support-reply="${displayText(thread.id)}" placeholder="${isAdmin ? "Reply to this account" : "Reply to admin"}"></textarea>
          <button class="action-btn secondary" type="button" data-support-action="${isAdmin ? "admin-reply" : "user-reply"}" data-support-thread="${displayText(thread.id)}">Send reply</button>
        </details>
      `;
    }

    function renderSupportInbox(role) {
      const container = document.getElementById(`${role}SupportThreads`);
      if (!container) return;
      const summaryCount = document.getElementById(`${role}SupportSummaryCount`);
      if (liveSupportThreadsState === "loading") {
        if (summaryCount) summaryCount.textContent = "…";
        container.innerHTML = '<div class="locked" role="status">Loading support conversations…</div>';
        return;
      }
      if (liveSupportThreadsState === "error") {
        if (summaryCount) summaryCount.textContent = "—";
        container.innerHTML = '<div class="locked" role="status">Support conversations are temporarily unavailable.</div>';
        return;
      }
      const threads = ownSupportThreads(role);
      container.innerHTML = threads.length ? threads.map((thread) => supportThreadMarkup(thread)).join("") : "No support conversations yet.";
      if (summaryCount) summaryCount.textContent = String(threads.length);
    }

    function renderAdminSupportInbox() {
      const container = document.getElementById("adminSupportInbox");
      if (!container) return;
      if (liveAdminSupportThreadsState === "loading") {
        container.innerHTML = '<div class="locked" role="status">Loading support messages…</div>';
        return;
      }
      if (liveAdminSupportThreadsState === "error") {
        container.innerHTML = '<div class="locked" role="status">Support messages are temporarily unavailable.</div>';
        return;
      }
      const threads = liveAdminSupportThreads;
      container.innerHTML = threads.length ? threads.map((thread) => supportThreadMarkup(thread, true)).join("") : '<div class="locked">No support messages yet.</div>';
    }

    async function loadLiveSupportThreads() {
      if (!authSession?.accessToken || (!isCustomerSession() && !isDancerSession())) return;
      liveSupportThreadsState = "loading";
      renderSupportInbox(isDancerSession() ? "dancer" : "customer");
      try {
        const data = await getAuthenticatedJson("/api/support");
        liveSupportThreads = data.threads || [];
        liveSupportThreadsState = "ready";
      } catch {
        liveSupportThreads = [];
        liveSupportThreadsState = "error";
      }
      renderSupportInbox(isDancerSession() ? "dancer" : "customer");
    }

    async function loadLiveAdminSupportThreads() {
      if (!isAdminSession()) return;
      liveAdminSupportThreadsState = "loading";
      renderAdminSupportInbox();
      try {
        const data = await getAuthenticatedJson("/api/admin/support");
        liveAdminSupportThreads = data.threads || [];
        liveAdminSupportThreadsState = "ready";
      } catch {
        liveAdminSupportThreads = [];
        liveAdminSupportThreadsState = "error";
      }
      renderAdminSupportInbox();
    }

    let pendingSupportAttempt = null;
    async function sendSupportMessage(role, subject, body, threadId = "") {
      const status = document.getElementById(`${role}SupportStatus`);
      if (!body.trim()) {
        if (status) status.textContent = "Enter a message before sending.";
        return false;
      }
      if (!authSession?.accessToken) {
        if (status) status.textContent = "Sign in to message the admin team.";
        return false;
      }
      try {
        if (status) status.textContent = "Sending your message to the admin team...";
        const key = JSON.stringify([authSession?.account?.id || authSession?.accessToken, subject, body, threadId]);
        if (pendingSupportAttempt?.key !== key) {
          pendingSupportAttempt = { key, id: globalThis.crypto?.randomUUID?.() };
        }
        const data = await postAuthenticatedJson("/api/support", { subject, message: body, threadId, requestId: pendingSupportAttempt.id });
        pendingSupportAttempt = null;
        if (data?.thread) {
          liveSupportThreads = [data.thread, ...liveSupportThreads.filter((thread) => thread.id !== data.thread.id)];
        }
        if (status) status.textContent = "Message sent to admin.";
        renderSupportInbox(role);
        return true;
      } catch (error) {
        if (status) status.textContent = error.message || "Could not send message.";
        return false;
      }
    }

    let pendingAdminSupportAttempt = null;
    async function sendAdminSupportReply(threadId, body) {
      if (!body.trim()) {
        showToast("Enter a reply first");
        return;
      }
      if (!isAdminSession()) {
        showToast("Admin sign in required");
        return;
      }
      try {
        const key = JSON.stringify([authSession?.account?.id || authSession?.accessToken, threadId, body]);
        if (pendingAdminSupportAttempt?.key !== key) pendingAdminSupportAttempt = { key, id: globalThis.crypto?.randomUUID?.() };
        const data = await postAuthenticatedJson("/api/admin/support", { threadId, message: body, requestId: pendingAdminSupportAttempt.id });
        pendingAdminSupportAttempt = null;
        if (data?.thread) liveAdminSupportThreads = [data.thread, ...liveAdminSupportThreads.filter((thread) => thread.id !== data.thread.id)];
        renderAdminSupportInbox();
        showToast("Reply sent");
      } catch (error) {
        showToast(error.message || "Could not send reply");
      }
    }

    async function loadLiveAdminApprovals() {
      const status = document.getElementById("adminLiveStatus");
      if (!isAdminSession()) {
        if (status) status.textContent = "Use an existing Supabase admin account.";
        return;
      }
      if (status) status.textContent = "Loading live admin data...";
      try {
        const [approvalData, venueData, subscriptionData, monitoringData, imageModerationData, operationsData] = await Promise.all([
          getAuthenticatedJson("/api/admin/approvals"),
          getAuthenticatedJson("/api/admin/venues"),
          getAuthenticatedJson("/api/admin/subscriptions"),
          getAuthenticatedJson("/api/admin/monitoring"),
          getAuthenticatedJson("/api/admin/image-moderation?decision=review&pageSize=50"),
          getAuthenticatedJson("/api/admin/operations")
        ]);
        liveAdminMonitoring = monitoringData.monitoring || null;
        liveAdminOperations = operationsData.operations || null;
        liveAdminImageModeration = imageModerationData.records || [];
        try {
          const reportData = await getAuthenticatedJson("/api/admin/reports");
          liveAdminReports = reportData.reports || [];
        } catch {
          liveAdminReports = [];
        }
        await loadLiveAdminSupportThreads();
        const queue = approvalData.queue || [];
        const adminDancers = approvalData.dancers || [];
        const venues = venueData.venues || [];
        liveAdminSubscriptions = subscriptionData.subscriptions || [];
        applyLiveApprovalQueue(adminDancers);
        applyLiveApprovalQueue(queue);
        applyLiveAdminVenues(venues);
        renderAdminDashboard();
        if (status) status.textContent = `Loaded ${adminDancers.length} real dancer${adminDancers.length === 1 ? "" : "s"}, ${liveAdminOperations?.attention?.total || queue.length} item${(liveAdminOperations?.attention?.total || queue.length) === 1 ? "" : "s"} needing attention, ${venues.length} venue${venues.length === 1 ? "" : "s"}, ${liveAdminSubscriptions.length} subscription${liveAdminSubscriptions.length === 1 ? "" : "s"}, and ${liveAdminReports.length} report${liveAdminReports.length === 1 ? "" : "s"}.`;
      } catch (error) {
        if (status) status.textContent = error.message || "Could not load live admin data";
        showToast(error.message || "Could not load live admin data");
      }
    }

    function reportOptionalDancerLoadError(error, fallbackMessage, options = {}) {
      if (options.notify === true) showToast(error.message || fallbackMessage);
      else console.warn(fallbackMessage, error);
    }

    async function loadLiveDancerAnalytics(options = {}) {
      if (!isDancerSession()) return;
      try {
        const data = await getAuthenticatedJson("/api/dancer/analytics");
        liveDancerAnalytics = data.analytics || null;
        renderDancerSetupWhenEditorIdle();
      } catch (error) {
        liveDancerAnalytics = null;
        reportOptionalDancerLoadError(error, "Could not load live analytics", options);
      }
    }

    async function loadLiveDancerDeals(options = {}) {
      if (!isDancerSession()) return;
      try {
        const data = await getAuthenticatedJson("/api/dancer/dashboard");
        liveDancerDeals = data.deals || null;
        if (data.analytics) liveDancerAnalytics = data.analytics;
        renderDancerSetupWhenEditorIdle();
      } catch (error) {
        liveDancerDeals = null;
        reportOptionalDancerLoadError(error, "Could not load Club Deal commissions", options);
      }
    }

    async function loadLiveDancerWeeklyReport(options = {}) {
      if (!isDancerSession()) return;
      try {
        const data = await getAuthenticatedJson("/api/dancer/weekly-report");
        liveDancerWeeklyReport = data.report || null;
        renderDancerSetupWhenEditorIdle();
      } catch (error) {
        liveDancerWeeklyReport = null;
        reportOptionalDancerLoadError(error, "Could not load weekly report", options);
      }
    }

    async function loadLiveDancerBilling(options = {}) {
      if (!isDancerSession()) return;
      try {
        const data = await getAuthenticatedJson("/api/dancer/billing");
        liveDancerBilling = data.billing || null;
        renderDancerSetupWhenEditorIdle();
      } catch (error) {
        liveDancerBilling = null;
        reportOptionalDancerLoadError(error, "Could not load billing status", options);
      }
    }

    async function loadLiveDancerFinance(options = {}) {
      if (!isDancerSession()) return;
      try {
        const data = await getAuthenticatedJson("/api/dancer/finance");
        liveDancerFinance = data.finance || null;
        renderDancerSetupWhenEditorIdle();
      } catch (error) {
        liveDancerFinance = null;
        reportOptionalDancerLoadError(error, "Could not load payout setup", options);
      }
    }

    async function loadLiveDancerRankingEvents(options = {}) {
      if (!isDancerSession()) return;
      try {
        const data = await getAuthenticatedJson("/api/dancer/ranking-events");
        liveDancerRankingEvents = data.events || [];
        renderDancerSetupWhenEditorIdle();
      } catch (error) {
        liveDancerRankingEvents = [];
        reportOptionalDancerLoadError(error, "Could not load ranking alerts", options);
      }
    }

    async function loadLiveDancerReviews(options = {}) {
      if (!isDancerSession()) return;
      try {
        const data = await getAuthenticatedJson("/api/dancer/reviews");
        liveDancerReviews = data.reviews || [];
        renderDancerSetupWhenEditorIdle();
      } catch (error) {
        liveDancerReviews = [];
        reportOptionalDancerLoadError(error, "Could not load review notes", options);
      }
    }

    function isLiveSubscriptionActive(subscription) {
      return subscription?.status === "active" || subscription?.status === "trialing";
    }

    function formatBillingDate(value) {
      if (!value) return "";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "";
      return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    }

    function dancerBillingSummary() {
      return {
        label: "FREE",
        detail: "Dancer profiles are free right now. No monthly subscription is due.",
        action: "Free plan"
      };
    }

    function liveMetricNumber(value, fallback = 0) {
      const number = Number(value);
      return Number.isFinite(number) ? number : fallback;
    }