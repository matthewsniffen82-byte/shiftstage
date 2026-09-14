

    function keepAdminApprovalCardOpen(card) {
      if (!card) return;
      const key = card.dataset.adminApprovalKey;
      if (!key) return;
      adminClosedDancerApprovalCards.delete(key);
      card.open = true;
      persistClosedAdminApprovalCards();
    }

    function rememberOpenAdminApprovalCards() {
      document.querySelectorAll("#adminDancers details[data-admin-approval-key]").forEach((card) => {
        const key = card.dataset.adminApprovalKey;
        if (!key) return;
        if (card.open) adminClosedDancerApprovalCards.delete(key);
        else adminClosedDancerApprovalCards.add(key);
      });
      persistClosedAdminApprovalCards();
    }

    function adminDancerApprovalCard(city, profile, index) {
      const approvalKey = adminApprovalCardKey(city, profile);
      const visibleStatus = profile.hidden ? "Hidden" : profile.status;
      const socialCount = normalizeSubmittedSocials(profile).length;
      const photoCount = profile.submittedPhotos?.length || profile.galleryPhotoUrls?.length || (profile.mainPhotoUrl ? 1 : 0);
      const pendingItems = pendingAdminSubmissionItems(profile);
      const approveDisabled = pendingItems.length ? "disabled" : "";
      const submittedChanges = Boolean(profile.reviewSubmitted || profile.approvalChangesSubmitted);
      const submittedLabel = profile.approvalChangesSubmitted ? "Profile changes submitted" : "Submitted for review";
      const pendingLabel = profile.approvalChangesPending ? "Profile changes pending submission" : "Pending submission";
      return `
        <details class="admin-item" data-admin-city="${escapeHtml(city)}" data-admin-profile="${escapeHtml(profile.name)}" data-admin-approval-key="${displayText(approvalKey)}" ${adminClosedDancerApprovalCards.has(approvalKey) ? "" : "open"}>
          <summary class="row">
            <div>
              <h3>${displayText(profile.name || "Stage name missing")}</h3>
              <div class="meta">${displayText(city)} · ${displayText(visibleStatus)} · ${submittedChanges ? submittedLabel : pendingLabel}</div>
            </div>
            <span class="${submittedChanges ? "badge pending" : "pill"}">${submittedChanges ? "Submitted" : "Pending"}</span>
          </summary>
          <div class="meta">Stage: ${displayText(profile.name || "Not submitted")} · City: ${displayText(city || "Not submitted")}</div>
          <div class="meta">Venue affiliation: ${profile.venueApprovedAt ? "Confirmed" : "Required"} · Photos: ${displayText(profile.photoStatus)}</div>
          <div class="meta">Socials: ${socialCount} · Photos: ${photoCount}</div>
          <button class="admin-profile-open-link" type="button" data-admin-action="view-dancer-profile">Open ${displayText(profile.name || "dancer")}'s full profile</button>
          <div class="info-tile">
            <strong>Submitted socials</strong>
            ${adminSubmittedSocialsMarkup(profile)}
          </div>
          <div class="info-tile">
            <strong>Submitted photos</strong>
            <div class="photo-upload-grid">${adminSubmittedPhotosMarkup(profile)}</div>
          </div>
          <div class="info-tile">
            <strong>Review history</strong>
            ${adminReviewHistoryMarkup(profile)}
          </div>
          ${pendingItems.length ? `<div class="locked">Review pending items first: ${displayText(pendingItems.join(", "))}.</div>` : ""}
          <div class="admin-actions">
            <button class="action-btn secondary" data-admin-action="view-dancer-profile">View full profile</button>
            <button class="action-btn danger" data-admin-action="delete-dancer-profile">Delete profile</button>
            <button class="action-btn" data-admin-action="approve-dancer" ${approveDisabled}>Approve profile content</button>
            <button class="action-btn danger" data-admin-action="reject-dancer">Reject dancer</button>
            <button class="action-btn secondary" data-admin-action="remove-content">Remove inappropriate content</button>
          </div>
        </details>
      `;
    }

    function adminImageModerationCard(record, index) {
      const recordId = record.id || "";
      const thumbnail = record.thumbnailUrl || record.thumbnail_url || "";
      const context = String(record.upload_context || "profile photo").replaceAll("_", " ");
      const reasons = Array.isArray(record.reasonCodes) ? record.reasonCodes : Array.isArray(record.reason_codes) ? record.reason_codes : [];
      const createdAt = record.created_at ? formatBillingDate(record.created_at) : "Just submitted";
      const scores = record.categoryScores || record.category_scores || {};
      const flags = record.categoryFlags || record.category_flags || {};
      return `
        <details class="admin-item" data-admin-image-moderation="${displayText(recordId)}" ${index === 0 ? "open" : ""}>
          <summary class="row">
            <div>
              <h3>Pending photo moderation</h3>
              <div class="meta">${displayText(context)} · ${displayText(createdAt)} · ${displayText(record.status || "pending")}</div>
            </div>
            <span class="badge pending">Photo review</span>
          </summary>
          <div class="info-tile">
            <strong>Submitted photo</strong>
            <div class="photo-upload-grid">
              <a class="upload-slot submitted-photo-slot" href="${displayText(thumbnail || "#")}" data-admin-preview-kind="image" data-admin-preview-title="Pending moderated photo" data-admin-preview-url="${displayText(thumbnail)}">
                ${thumbnail ? `<img src="${displayText(thumbnail)}" alt="Pending moderated photo">` : "Private photo"}
                <span>${displayText(record.decision || "review")}</span>
                <span>Uploader: ${displayText(record.user_id || "unknown")}</span>
              </a>
            </div>
          </div>
          <div class="meta">Model: ${displayText(record.provider_model || "openai")} · Reasons: ${displayText(reasons.length ? reasons.join(", ") : "None")}</div>
          <details class="submission-json">
            <summary>Category flags and scores</summary>
            <pre>${displayText(JSON.stringify({ flags, scores }, null, 2))}</pre>
          </details>
          <textarea data-image-moderation-notes="${displayText(recordId)}" placeholder="Reviewer notes"></textarea>
          <div class="admin-actions">
            <button class="action-btn" data-admin-image-moderation-action="approved" data-record-id="${displayText(recordId)}">Approve picture</button>
            <button class="action-btn secondary" data-admin-image-moderation-action="rejected" data-record-id="${displayText(recordId)}">Reject picture</button>
          </div>
        </details>
      `;
    }

    function subscriptionStatusLabel(status) {
      return String(status || "unknown").replaceAll("_", " ");
    }

    function adminSubscriptionRow(subscription) {
      const dancer = subscription.dancer || {};
      const stageName = dancer.stageName || "Unassigned dancer";
      const city = dancer.city || "No city";
      const status = subscriptionStatusLabel(subscription.status);
      const periodEnd = formatBillingDate(subscription.currentPeriodEnd);
      const detail = periodEnd ? `Renews or ends ${periodEnd}` : "No current period date";
      const badgeClass = isLiveSubscriptionActive(subscription) ? "badge" : "badge pending";
      return `
        <article class="admin-item">
          <div class="row">
            <div>
              <h3>${escapeHtml(stageName)}</h3>
              <div class="meta">${escapeHtml(city)} · ${escapeHtml(detail)}</div>
            </div>
            <span class="${badgeClass}">${escapeHtml(status)}</span>
          </div>
          <div class="meta">Stripe subscription: ${escapeHtml(subscription.stripeSubscriptionId || "not created")}</div>
        </article>
      `;
    }

    function monitoringItemMarkup(item, label = item.name) {
      const ready = item.ok;
      const detail = item.count !== undefined && item.count !== null
        ? `${item.count.toLocaleString()} records`
        : ready
          ? "Configured"
          : "Missing required config";
      return `
        <article class="admin-item">
          <div class="row"><div><h3>${displayText(label)}</h3><div class="meta">${displayText(detail)}</div></div><span class="${ready ? "pill" : "badge pending"}">${ready ? "Ready" : "Needs config"}</span></div>
        </article>
      `;
    }

    function adminMonitoringMarkup() {
      if (!liveAdminMonitoring) return '<div class="locked">Live platform checks load after admin login.</div>';
      const databaseItems = (liveAdminMonitoring.database || []).map((item) => monitoringItemMarkup(item));
      const integrationItems = (liveAdminMonitoring.integrations || []).map((item) => monitoringItemMarkup(item));
      return [...databaseItems, ...integrationItems].join("") || '<div class="locked">No monitoring checks returned.</div>';
    }

    function adminReportRow(report) {
      const reason = report.reason || "Content report";
      const target = report.targetLabel || "Reported target";
      const details = report.details ? `<div class="meta"><strong>Reporter details</strong><br>${displayText(report.details).replace(/\n/g, "<br>")}</div>` : "";
      const canRemoveTarget = report.targetType !== "contact_message";
      const profileTarget = report.profileTarget || {};
      const canViewDancerProfile = profileTarget.kind === "dancer" && profileTarget.id;
      return `
        <article class="admin-item" data-report="${displayText(report.id)}" data-live-report="true" data-report-target="${displayText(target)}">
          <div class="row"><div><h3>${displayText(target)}</h3><div class="meta"><strong>Why it was reported</strong><br>${displayText(reason)}</div>${details}</div><span class="badge pending">Open</span></div>
          <div class="admin-actions">
            ${canViewDancerProfile ? '<button class="action-btn secondary" data-admin-action="view-reported-profile">View reported profile</button>' : ""}
            <button class="action-btn secondary" data-admin-action="resolve-report">Resolve report</button>
            ${canRemoveTarget ? '<button class="action-btn danger" data-admin-action="remove-reported">Remove target</button>' : ""}
          </div>
        </article>
      `;
    }

    function renderAdminOperationsSummary() {
      const host = document.getElementById("adminOperationsSummary");
      if (!host) return;
      const operations = liveAdminOperations;
      if (!operations) {
        host.innerHTML = '<div class="locked">Live operations data is unavailable. Open the operations center for system details.</div>';
        return;
      }
      const attention = operations.attention || {};
      const live = operations.live || {};
      const revenue = operations.revenue || {};
      const items = [
        ["Needs attention", attention.total || 0],
        ["Overdue", attention.overdue || 0],
        ["Checked in now", (live.checkedInDancers || []).length],
        ["Active venues", live.activeVenueCount || 0],
        ["QR today", live.qrGeneratedToday || 0],
        ["QR redeemed", live.qrRedeemedToday || 0],
        ["Suspicious QR", live.suspiciousQrToday || 0],
        ["Deal conversion", `${Number(revenue.conversionRate || 0).toFixed(1)}%`]
      ];
      host.innerHTML = items.map(([label, value]) => `
        <div class="stat"><strong>${displayText(value)}</strong><span>${displayText(label)}</span></div>
      `).join("");
    }

    function renderAdminDashboard() {
      if (!isAdminSession()) {
        showAdminAuthPage("Admin username and password required.");
        return;
      }

      rememberOpenAdminApprovalCards();
      showAdminDashboardPage();
      savedAdminContentReviews = loadSavedAdminContentReviews();
      applySavedAdminContentReviews();
      const profiles = adminProfiles();
      const visibleProfiles = profiles.filter(({ profile }) => !profile.hidden);
      const pendingProfiles = visibleProfiles.filter(({ profile }) =>
        profile.status === "Pending" || profile.approvalChangesSubmitted || hasPendingAdminSubmittedContent(profile)
      );
      const pendingImageReviews = liveAdminImageModeration.filter((record) => normalizedReviewStatus(record.decision) === "review");
      const shiftProfiles = visibleProfiles.filter(({ profile }) => profile.scheduled);
      const activeSubscriptions = liveAdminSubscriptions.filter(isLiveSubscriptionActive);
      document.getElementById("adminUserCount").textContent = adminUsers.length + visibleProfiles.length;
      document.getElementById("adminPendingCount").textContent = pendingProfiles.length + pendingImageReviews.length;
      document.getElementById("adminSubscriptionCount").textContent = liveAdminSubscriptions.length;
      document.getElementById("adminActiveSubscriptionCount").textContent = activeSubscriptions.length;
      renderAdminOperationsSummary();
      document.getElementById("adminMonitoring").innerHTML = adminMonitoringMarkup();

      const adminUserRows = [
        ...adminUsers.map((user) => `
          <article class="admin-item">
            <div class="row"><div><h3>${escapeHtml(user.name)}</h3><div class="meta">${escapeHtml(user.role)}</div></div><span class="pill">${escapeHtml(user.status)}</span></div>
          </article>
        `),
        ...visibleProfiles.map(({ city, profile }) => adminProfileRow(city, profile))
      ];
      document.getElementById("adminUsers").innerHTML = adminUserRows.length
        ? adminUserRows.join("")
        : '<div class="locked">No real users found yet.</div>';

      const imageModerationCards = pendingImageReviews.map(adminImageModerationCard);
      const dancerApprovalCards = pendingProfiles.map(({ city, profile }, index) => adminDancerApprovalCard(city, profile, index));
      document.getElementById("adminDancers").innerHTML = imageModerationCards.length || dancerApprovalCards.length
        ? [...imageModerationCards, ...dancerApprovalCards].join("")
        : '<div class="locked">No pending dancers.</div>';
      const approvedSearch = document.getElementById("adminApprovedDancerSearch");
      const disapprovedSearch = document.getElementById("adminDisapprovedDancerSearch");
      if (approvedSearch && approvedSearch.value !== adminApprovedDancerSearch) approvedSearch.value = adminApprovedDancerSearch;
      if (disapprovedSearch && disapprovedSearch.value !== adminDisapprovedDancerSearch) disapprovedSearch.value = adminDisapprovedDancerSearch;
      renderAdminDancerDirectories();

      const visibleReports = liveAdminReports.filter((report) => report.status === "open");
      document.getElementById("adminReports").innerHTML = visibleReports.map(adminReportRow).join("") || '<div class="locked">No reported users or content.</div>';
      renderAdminSupportInbox();

      document.getElementById("adminSubscriptions").innerHTML = liveAdminSubscriptions.length
        ? liveAdminSubscriptions.slice(0, 12).map(adminSubscriptionRow).join("")
        : '<div class="locked">No live subscriptions found.</div>';

      document.getElementById("adminShifts").innerHTML = shiftProfiles.map(({ city, profile }) => `
        <article class="admin-item" data-admin-city="${escapeHtml(city)}" data-admin-profile="${escapeHtml(profile.name)}">
          <div class="row"><div><h3>${escapeHtml(profile.name)}</h3><div class="meta">${escapeHtml(profile.venue)} · ${escapeHtml(displayShiftTime(profile.time))}</div></div><span class="pill">${profile.tonight ? "Now" : "Upcoming"}</span></div>
          <div class="admin-actions">
            <button class="action-btn secondary" data-admin-action="feature-dancer">Feature dancer</button>
            <button class="action-btn danger" data-admin-action="remove-shift">Remove shift</button>
          </div>
        </article>
      `).join("") || '<div class="locked">No shifts to manage.</div>';

      document.getElementById("adminFeatured").innerHTML = `
        ${visibleProfiles.filter(({ profile }) => profile.status === "Verified").slice(0, 6).map(({ city, profile }) => `
          <article class="admin-item" data-admin-city="${escapeHtml(city)}" data-admin-profile="${escapeHtml(profile.name)}">
            <div class="row"><div><h3>${escapeHtml(profile.name)}</h3><div class="meta">${escapeHtml(city)}</div></div><span class="${profile.featured ? "pill featured" : "pill"}">${profile.featured ? `${badgeIconMarkup("featured")}Featured` : "Standard"}</span></div>
            <button class="action-btn secondary" data-admin-action="feature-dancer">${profile.featured ? "Unfeature dancer" : "Feature dancer"}</button>
          </article>
        `).join("")}
        ${Object.entries(markets).flatMap(([city, market]) => market.venues.filter((venue) => !venue.hidden).slice(0, 2).map((venue) => `
          <article class="admin-item" data-admin-city="${escapeHtml(city)}" data-admin-venue="${escapeHtml(venue.name)}">
            <div class="row"><div><h3>${escapeHtml(venue.name)}</h3><div class="meta">${escapeHtml(city)}</div></div><span class="${venue.featured ? "pill featured" : "pill"}">${venue.featured ? `${badgeIconMarkup("featured")}Featured` : "Standard"}</span></div>
            <button class="action-btn secondary" data-admin-action="feature-venue">${venue.featured ? "Unfeature venue" : "Feature venue"}</button>
          </article>
        `)).join("")}
      `;

      const managedVenueMarkup = Object.entries(markets).flatMap(([city, market]) => (
        market.venues.filter((venue) => !venue.hidden).map((venue, index) => {
          return `
            <details class="admin-item" data-admin-city="${escapeHtml(city)}" data-admin-venue="${escapeHtml(venue.name)}" ${index === 0 ? "open" : ""}>
              <summary class="row"><div><h3>${escapeHtml(venue.name)}</h3><div class="meta">${escapeHtml(city)} · ${escapeHtml(venue.shifts)} posted shifts</div></div><span class="badge">Active</span></summary>
              <div class="meta">Directory status: Active · Featured: ${venue.featured ? "Yes" : "No"}</div>
              <div class="admin-actions">
                <button class="action-btn secondary" data-admin-action="feature-venue">${venue.featured ? "Unfeature venue" : "Feature venue"}</button>
                <button class="action-btn danger" data-admin-action="remove-venue">Remove venue</button>
              </div>
            </details>
          `;
        })
      )).join("");
      document.getElementById("adminVenues").innerHTML = managedVenueMarkup || '<div class="locked">No live venues found.</div>';
    }

    function setAdminAuthMode(mode) {
      adminAuthMode = mode === "signup" ? "signup" : "login";
      document.querySelectorAll("[data-admin-auth-mode]").forEach((button) => {
        button.classList.toggle("active", button.dataset.adminAuthMode === adminAuthMode);
      });
      const codeField = document.getElementById("adminCodeField");
      const codeInput = document.getElementById("adminCode");
      const forgotButton = document.getElementById("adminForgotPasswordBtn");
      const loginButton = document.getElementById("adminLoginBtn");
      const createButton = document.getElementById("adminCreateBtn");
      if (codeField) codeField.hidden = adminAuthMode !== "signup";
      if (codeInput) codeInput.required = adminAuthMode === "signup";
      if (forgotButton) forgotButton.hidden = adminAuthMode !== "login";
      if (loginButton) loginButton.hidden = adminAuthMode !== "login";
      if (createButton) createButton.hidden = adminAuthMode !== "signup";
      const passwordInput = document.getElementById("adminPassword");
      if (passwordInput) passwordInput.autocomplete = adminAuthMode === "signup" ? "new-password" : "current-password";
      const status = document.getElementById("adminLiveStatus");
      if (status) {
        status.textContent = adminAuthMode === "signup"
          ? "Enter a username, password, and admin code, then create the admin account."
          : "Sign in with an existing admin account.";
      }
    }

    function showAdminAuthPage(message = "Sign in or create an admin account to continue.") {
      document.getElementById("adminLoginForm").hidden = false;
      document.getElementById("adminLogoutBtn").hidden = true;
      const content = document.getElementById("adminDashboardContent");
      if (content) content.hidden = true;
      const status = document.getElementById("adminLiveStatus");
      if (status) status.textContent = message;
      setAdminAuthMode(adminAuthMode);
    }

    function showAdminDashboardPage() {
      document.getElementById("adminLoginForm").hidden = true;
      document.getElementById("adminLogoutBtn").hidden = false;
      const content = document.getElementById("adminDashboardContent");
      if (content) content.hidden = false;
      document.querySelectorAll("#adminDashboard .admin-dashboard-collapse, #adminDashboard #adminDancers details.admin-item").forEach((section) => {
        section.open = false;
      });
    }

    function logoutAdminAccount() {
      liveAdminMonitoring = null;
      liveAdminOperations = null;
      liveAdminImageModeration = [];
      liveAdminReports = [];
      liveAdminSupportThreads = [];
      liveAdminSubscriptions = [];
      void endAuthSession();
      document.getElementById("adminEmail").value = "";
      document.getElementById("adminPassword").value = "";
      document.getElementById("adminCode").value = "";
      lockAdminDashboard();
      updateAccountHeader();
      showToast("Admin logged out");
    }

    function lockAdminDashboard() {
      showAdminAuthPage("Admin username and password required.");
      const status = document.getElementById("adminLiveStatus");
      if (status) status.textContent = "Admin username and password required.";
      ["adminUserCount", "adminPendingCount", "adminSubscriptionCount", "adminActiveSubscriptionCount", "adminApprovedDancerCount", "adminDisapprovedDancerCount"].forEach((id) => {
        const node = document.getElementById(id);
        if (node) node.textContent = "0";
      });
      [
        "adminMonitoring",
        "adminOperationsSummary",
        "adminUsers",
        "adminDancers",
        "adminApprovedDancers",
        "adminDisapprovedDancers",
        "adminReports",
        "adminSupportInbox",
        "adminSubscriptions",
        "adminShifts",
        "adminFeatured",
        "adminVenues"
      ].forEach((id) => {
        const node = document.getElementById(id);
        if (node) node.innerHTML = '<div class="locked">Admin login required.</div>';
      });
      const rankingStatus = document.getElementById("adminRankingStatus");
      if (rankingStatus) rankingStatus.textContent = "Admin login required.";
    }

    function renderDashboard() {
      const city = citySelect.value;
      const dashboardLoading = liveCustomerDashboardState === "loading";
      const dashboardError = liveCustomerDashboardState === "error";
      const dashboardListMessage = (loadingMessage, emptyMessage) => dashboardLoading
        ? `<div class="locked" role="status">${escapeHtml(loadingMessage)}</div>`
        : dashboardError
          ? '<div class="locked" role="status">Saved dashboard data is temporarily unavailable.</div>'
          : `<div class="locked">${escapeHtml(emptyMessage)}</div>`;
      const followed = followedProfiles(city);
      const venues = followedVenues(city);
      const workingTonight = followed
        .filter((profile) => isWorkingTonight(profile, city))
        .sort((a, b) => shiftStartMinutes(a.time) - shiftStartMinutes(b.time));
      const notificationsOn = followed.filter((profile) => isNotificationOn(city, profile.name)).length;
      document.getElementById("dashboardCity").textContent = city;
      document.getElementById("customerSummaryTitle").textContent = `Your private ${city} dashboard`;
      document.getElementById("customerSummaryCopy").textContent = dashboardLoading
        ? "Loading your saved dancers, clubs, and private alerts…"
        : dashboardError
          ? "Your saved dashboard data is temporarily unavailable. Try opening the dashboard again."
          : workingTonight.length
            ? `${workingTonight.length} followed ${workingTonight.length === 1 ? "dancer is" : "dancers are"} working now. Your follows, alerts, and directions stay private.`
            : followed.length || venues.length
              ? `No followed dancers are working now. Your saved dancers and clubs are ready for the next schedule update.`
              : `Follow dancers and clubs in ${city} to build your private dashboard, schedule alerts, and directions list.`;
      document.getElementById("dashTonightCount").textContent = dashboardLoading ? "…" : dashboardError ? "—" : String(workingTonight.length);
      document.getElementById("dashFollowedCount").textContent = dashboardLoading ? "…" : dashboardError ? "—" : String(followed.length);
      document.getElementById("dashVenueCount").textContent = dashboardLoading ? "…" : dashboardError ? "—" : String(venues.length);
      document.getElementById("dashNotificationsCount").textContent = dashboardLoading ? "…" : dashboardError ? "—" : String(notificationsOn + venues.length);
      document.getElementById("dashTonightTitle").textContent = `Followed dancers working now`;
      document.getElementById("dashFollowedTitle").textContent = `All followed dancers in ${city}`;
      document.getElementById("dashVenuesTitle").textContent = `Favorite clubs in ${city}`;
      document.getElementById("dashTonightContext").textContent = dashboardLoading ? "Loading…" : dashboardError ? "Unavailable" : `${city} · ${workingTonight.length} ${workingTonight.length === 1 ? "profile" : "profiles"}`;
      document.getElementById("dashFollowedContext").textContent = dashboardLoading ? "Loading…" : dashboardError ? "Unavailable" : `${city} · ${followed.length} saved`;
      document.getElementById("dashVenuesContext").textContent = dashboardLoading ? "Loading…" : dashboardError ? "Unavailable" : `${venues.length} saved`;
      document.getElementById("dashSavedDealsContext").textContent = `${savedDealPasses.length} saved`;

      const visibleTonight = limitedList(workingTonight, dashboardTonightExpanded);
      const visibleFollowed = limitedList(followed, dashboardFollowedExpanded);
      const visibleVenues = limitedList(venues, dashboardVenuesExpanded);
      dashTonightList.innerHTML = dashboardLoading || dashboardError
        ? dashboardListMessage("Loading followed dancers working now…", `No followed dancers working now in ${city}.`)
        : visibleTonight.length
        ? visibleTonight.map((profile, index) => profileCard(profile, index, { tonight: true })).join("")
        : `<div class="locked">No followed dancers working now in ${escapeHtml(city)}.</div>`;
      dashFollowedList.innerHTML = dashboardLoading || dashboardError
        ? dashboardListMessage("Loading followed dancers…", `No followed dancers in ${city} yet.`)
        : visibleFollowed.length
        ? visibleFollowed.map((profile, index) => profileCard(profile, index + 2)).join("")
        : `<div class="locked">No followed dancers in ${escapeHtml(city)} yet.</div>`;
      dashVenueList.innerHTML = dashboardLoading || dashboardError
        ? dashboardListMessage("Loading favorite clubs…", `No favorite clubs in ${city} yet.`)
        : visibleVenues.length
        ? visibleVenues.map((venue) => venueCard(venue)).join("")
        : `<div class="locked">No favorite clubs in ${escapeHtml(city)} yet.</div>`;
      dashSavedDealsList.innerHTML = savedDealPasses.length
        ? savedDealPasses.map((pass) => savedDealPassMarkup(pass)).join("")
        : `<div class="locked">No saved Club Deals yet. Save a Club Deal to find it here later.</div>`;
      dashTonightViewAll.hidden = dashboardLoading || dashboardError || workingTonight.length <= 5 || dashboardTonightExpanded;
      dashFollowedViewAll.hidden = dashboardLoading || dashboardError || followed.length <= 5 || dashboardFollowedExpanded;
      dashVenueViewAll.hidden = dashboardLoading || dashboardError || venues.length <= 5 || dashboardVenuesExpanded;
      renderSupportInbox("customer");
      renderNotificationSettings();
      renderNotificationCenters();
    }

    function adminProfileFromNode(node) {
      const city = node?.dataset.adminCity;
      const name = node?.dataset.adminProfile;
      if (!city || !name) return null;
      const profile = discoveryMarket(city).dancers.find((item) => item.name === name);
      return profile ? { city, profile } : null;
    }

    function adminVenueFromNode(node) {
      const city = node?.dataset.adminCity;
      const name = node?.dataset.adminVenue;
      if (!city || !name) return null;
      const venue = discoveryMarket(city).venues.find((item) => item.name === name);
      return venue ? { city, venue } : null;
    }

    function clearRetiredAccountCaches() {
      try {
        for (let index = localStorage.length - 1; index >= 0; index -= 1) {
          const key = localStorage.key(index) || "";
          if (key.startsWith("dancrAccountEmail:") || key.startsWith("mydancr:admin-content-reviews:")) {
            localStorage.removeItem(key);
          }
        }
      } catch {}
    }

    function loadSavedAdminContentReviews() {
      clearRetiredAccountCaches();
      const accountId = authSession?.account?.role === "admin" && authSession?.accessToken
        ? String(authSession.account.id || "") : "";
      if (!accountId || accountId !== savedAdminContentReviewAccount) savedAdminContentReviews = [];
      savedAdminContentReviewAccount = accountId;
      return savedAdminContentReviews;
    }

    function writeSavedAdminContentReviews() {
      clearRetiredAccountCaches();
      // Server review records are authoritative; optimistic notes stay in this page.
      savedAdminContentReviews = savedAdminContentReviews.slice(-500);
    }

    function adminContentReviewProfileKey(profile) {
      return String(profile?.id || profile?.slug || profile?.name || "profile");
    }

    function saveAdminContentReview(profile, targetType, targetId, status, notes) {
      loadSavedAdminContentReviews();
      if (!savedAdminContentReviewAccount) return;
      const row = {
        profileKey: adminContentReviewProfileKey(profile),
        targetType,
        targetId,
        status,
        notes,
        reviewedAt: new Date().toISOString()
      };
      savedAdminContentReviews = [
        ...savedAdminContentReviews.filter((item) => !(item.profileKey === row.profileKey && item.targetType === targetType && item.targetId === targetId)),
        row
      ];
      writeSavedAdminContentReviews();
    }

    function findReviewPhoto(profile, targetId) {
      return (profile.submittedPhotos || []).find((item, index) => (
        String(item.id || `${profile.id || profile.name}-photo-${index}`) === targetId
      ));
    }

    function findReviewSocial(profile, targetId) {
      const rows = profile.socialLinks || profile.social_links || [];
      return rows.find((item, index) => String(item.id || `${profile.id || profile.name}-social-${index}`) === targetId);
    }

    function applySavedAdminContentReviewsToProfile(profile) {
      const profileKey = adminContentReviewProfileKey(profile);
      savedAdminContentReviews
        .filter((item) => item.profileKey === profileKey)
        .forEach((item) => applyLocalAdminContentReview(profile, item.targetType, item.targetId, item.status, item.notes || "", false));
    }

    function applySavedAdminContentReviews() {
      allProfiles().forEach(({ profile }) => applySavedAdminContentReviewsToProfile(profile));
    }

    function refreshAfterAdminAction(message) {
      renderAdminDashboard();
      render();
      if (customerDashboard.classList.contains("show")) renderDashboard();
      showToast(message);
    }

    function markDancerProfileContentApproved(profile) {
      if (!profile) return;
      Object.assign(profile, {
        photoStatus: "Approved",
        reviewSubmitted: false,
        contentFlagged: false
      });
      if (!profile.venueApprovedAt) setDancerProfilePublic(profile, false);
    }

    function saveLiveAdminReview(profile, status) {
      if (!profile?.id || !isAdminSession()) return;
      postAuthenticatedJson("/api/admin/approvals", {
        dancerId: profile.id,
        status,
        notes: status === "approved" ? "Profile content approved in admin dashboard; venue affiliation remains required." : "Rejected in admin dashboard."
      }).then(() => {
        showToast(status === "approved" ? "Profile content review saved" : "Live rejection saved");
        loadLiveAdminApprovals();
        refreshPublicDiscoveryAfterAdminReview(profile, status);
      }).catch((error) => showToast(error.message || "Could not save live review"));
    }

    function findAdminReviewReason(host, key) {
      return Array.from(host?.querySelectorAll("[data-review-reason]") || [])
        .find((input) => input.dataset.reviewReason === key);
    }

    function markAdminReviewButton(button, status) {
      if (!button) return;
      button.textContent = status === "approved" ? "Approved" : "Disapproved";
      button.disabled = true;
      const actions = button.closest(".admin-review-actions, .admin-actions");
      actions?.querySelectorAll("button").forEach((item) => {
        if (item !== button) item.disabled = true;
      });
    }

    function applyLocalAdminContentReview(profile, targetType, targetId, status, notes, persist = true) {
      const reviewedAt = new Date().toISOString();
      if (targetType === "photo") {
        const photo = findReviewPhoto(profile, targetId);
        if (photo) {
          photo.reviewStatus = status;
          photo.reviewNotes = notes;
          photo.reviewedAt = reviewedAt;
        }
      }
      if (targetType === "social_link") {
        const social = findReviewSocial(profile, targetId);
        if (social) {
          social.reviewStatus = status;
          social.reviewNotes = notes;
          social.reviewedAt = reviewedAt;
        }
        profile.socialReviewStatuses = profile.socialReviewStatuses || {};
        profile.socialReviewStatuses[targetId] = { status, notes, reviewedAt };
      }
      if (persist) saveAdminContentReview(profile, targetType, targetId, status, notes);
    }

    async function reviewAdminSubmittedContent(button) {
      const host = button.closest("[data-admin-profile]");
      const profileMatch = adminProfileFromNode(host);
      if (!profileMatch) return;
      const approvalCard = host.closest("details[data-admin-approval-key]");
      keepAdminApprovalCardOpen(approvalCard);

      const status = button.dataset.adminContentReview;
      const targetType = button.dataset.reviewType;
      const targetId = button.dataset.reviewTarget || "";
      const label = button.dataset.reviewLabel || "Submitted item";
      const hasLiveTarget = button.dataset.reviewLiveTarget !== "false";
      const reasonInput = findAdminReviewReason(host, button.dataset.reviewKey || `${targetType}:${targetId}`);
      const notes = reasonInput?.value.trim() || "";

      if (status === "rejected" && !notes) {
        showToast("Add a reason before disapproving this item");
        if (reasonInput) reasonInput.focus();
        return;
      }

      const originalText = button.textContent;
      button.disabled = true;
      button.textContent = "Saving...";

      try {
        let savedStatus = status;
        if (isAdminSession() && profileMatch.profile.id && hasLiveTarget) {
          const data = await postAuthenticatedJson("/api/admin/approvals", {
            action: "review_content",
            dancerId: profileMatch.profile.id,
            targetType,
            targetId,
            status,
            notes,
            label
          });
          savedStatus = normalizedReviewStatus(data?.review?.status) || status;
        }
        applyLocalAdminContentReview(profileMatch.profile, targetType, targetId, savedStatus, notes);
        markAdminReviewButton(button, savedStatus);
        if (savedStatus === "rejected") {
          addLocalDancerReviewNotification(profileMatch.profile, targetType, targetId, label, notes);
        }
        showToast(savedStatus === "approved" ? `${label} approved` : `${label} disapproved`);
        keepAdminApprovalCardOpen(approvalCard);
        renderAdminDashboard();
      } catch (error) {
        button.textContent = originalText;
        button.disabled = false;
        button.closest(".admin-review-actions")?.querySelectorAll("button").forEach((item) => {
          item.disabled = false;
        });
        showToast(error.message || "Could not save content review");
      } finally {
        if (button.textContent === "Saving...") button.disabled = false;
      }
    }

    async function reviewAdminImageModeration(button) {
      const recordId = button.dataset.recordId || "";
      const decision = button.dataset.adminImageModerationAction || "";
      if (!recordId || !decision) return;
      const host = button.closest("[data-admin-image-moderation]");
      const notes = host?.querySelector(`[data-image-moderation-notes="${CSS.escape(recordId)}"]`)?.value.trim() || "";
      const confirmed = decision === "approved"
        ? confirm("Approve this photo and publish it?")
        : confirm("Reject this photo and keep it private?");
      if (!confirmed) return;
      button.disabled = true;
      button.textContent = decision === "approved" ? "Approving..." : "Rejecting...";
      try {
        const data = await postAuthenticatedJson("/api/admin/image-moderation", {
          recordId,
          decision,
          notes
        });
        liveAdminImageModeration = liveAdminImageModeration.filter((record) => record.id !== recordId);
        renderAdminDashboard();
        if (decision === "approved") {
          liveMarketState[selectedCity()] = null;
          await loadLiveDiscovery(selectedCity(), { force: true });
        }
        showToast(decision === "approved" ? "Photo approved and published" : "Photo rejected and removed");
      } catch (error) {
        button.disabled = false;
        button.textContent = decision === "approved" ? "Approve picture" : "Reject picture";
        showToast(error.message || "Could not update photo review");
      }
    }

    function saveLiveAdminVenueRemoval(venue) {
      if (!venue?.id || !isAdminSession()) return;
      patchAuthenticatedJson("/api/admin/venues", {
        venueId: venue.id,
        isActive: false
      }).then(() => {
        showToast("Live venue removed");
        loadLiveAdminApprovals();
      }).catch((error) => showToast(error.message || "Could not remove live venue"));
    }

    function saveLiveAdminReportAction(reportId, action) {
      if (!reportId || !isAdminSession()) return;
      patchAuthenticatedJson("/api/admin/reports", {
        reportId,
        action
      }).then(() => {
        liveAdminReports = liveAdminReports.filter((report) => report.id !== reportId);
        renderAdminDashboard();
        showToast(action === "removed" ? "Reported target removed" : "Report resolved");
      }).catch((error) => showToast(error.message || "Could not update report"));
    }

    async function recalculateLiveRankings(button) {
      const status = document.getElementById("adminRankingStatus");
      const city = citySelect.value;
      if (!isAdminSession()) {
        showToast("Admin login required");
        return;
      }
      if (button) button.disabled = true;
      if (status) status.textContent = `Recalculating ${city} rankings...`;
      try {
        const data = await postAuthenticatedJson("/api/admin/rankings/recalculate", { city });
        liveMarketState[city] = null;
        let refreshWarning = "";
        try { await loadLiveDiscovery(city); } catch { refreshWarning = " Refresh the page to see the saved rankings."; }
        const count = data.rankings?.length || 0;
        if (status) status.textContent = `Updated ${count} ${city} ranking${count === 1 ? "" : "s"}. ${Array.isArray(data.warnings) ? data.warnings.join(" ") : ""}${refreshWarning}`.trim();
        showToast("Rankings recalculated");
      } catch (error) {
        if (status) status.textContent = error.message || "Could not recalculate rankings";
        showToast(error.message || "Could not recalculate rankings");
      } finally {
        if (button) button.disabled = false;
      }
    }

    function runAdminAction(action, host, button) {
      const profileMatch = adminProfileFromNode(host);
      const venueMatch = adminVenueFromNode(host);
      const reportId = host?.dataset.report;
      const report = liveAdminReports.find((item) => item.id === reportId);
      if (action === "recalculate-rankings") {
        recalculateLiveRankings(button);
        return;
      }
      if (action === "view-dancer-profile" && profileMatch) {
        openAdminFullProfile(profileMatch.profile, button);
        return;
      }
      if (action === "view-reported-profile" && report?.profileTarget?.kind === "dancer" && report.profileTarget.id) {
        openAdminFullProfile({ id: report.profileTarget.id, name: report.profileTarget.label }, button, report);
        return;
      }
      if (action === "delete-dancer-profile" && profileMatch) {
        deleteLiveAdminDancerProfile(profileMatch.profile, button);
        return;
      }
      if (action === "approve-dancer" && profileMatch) {
        const pendingItems = pendingAdminSubmissionItems(profileMatch.profile);
        if (pendingItems.length) {
          showToast(`Review pending items first: ${pendingItems.join(", ")}`);
          return;
        }
        markAdminReviewButton(button, "approved");
        markDancerProfileContentApproved(profileMatch.profile);
        if (activeDancerProfile(profileMatch.city)?.id === profileMatch.profile.id || activeDancerProfile(profileMatch.city)?.name === profileMatch.profile.name) {
          Object.assign(dancerSetup, { profile: true, photos: true, review: true, approval: false });
          setupChecklistExpanded = true;
          activeSetupStep = "approval";
        }
        window.setTimeout(() => refreshAfterAdminAction(`${profileMatch.profile.name}'s profile content was approved; venue affiliation is still required`), 700);
        saveLiveAdminReview(profileMatch.profile, "approved");
        return;
      }
      if (action === "reject-dancer" && profileMatch) {
        markAdminReviewButton(button, "rejected");
        profileMatch.profile.status = "Rejected";
        profileMatch.profile.hidden = true;
        window.setTimeout(() => refreshAfterAdminAction(`${profileMatch.profile.name} disapproved and hidden`), 700);
        saveLiveAdminReview(profileMatch.profile, "rejected");
        return;
      }
      if ((action === "remove-profile" || action === "remove-content") && profileMatch) {
        profileMatch.profile.hidden = true;
        profileMatch.profile.contentFlagged = false;
        refreshAfterAdminAction(action === "remove-profile" ? "Fake profile removed" : "Inappropriate content removed");
        return;
      }
      if (action === "approve-photos" && profileMatch) {
        profileMatch.profile.photoStatus = "Approved";
        refreshAfterAdminAction("Photos approved");
        return;
      }
      if (action === "reject-photos" && profileMatch) {
        profileMatch.profile.photoStatus = "Rejected";
        refreshAfterAdminAction("Photos rejected and hidden");
        return;
      }
      if (action === "remove-shift" && profileMatch) {
        const market = markets[profileMatch.city];
        const venue = market.venues.find((item) => item.name === profileMatch.profile.venue);
        if (venue && venue.shifts > 0) venue.shifts -= 1;
        if (market.stats.shifts > 0) market.stats.shifts -= 1;
        Object.assign(profileMatch.profile, { scheduled: false, tonight: false, time: "No upcoming shifts" });
        refreshAfterAdminAction("Shift removed");
        return;
      }
      if (action === "feature-dancer" && profileMatch) {
        profileMatch.profile.featured = !profileMatch.profile.featured;
        refreshAfterAdminAction(profileMatch.profile.featured ? "Dancer featured" : "Dancer unfeatured");
        return;
      }
      if (action === "feature-venue" && venueMatch) {
        venueMatch.venue.featured = !venueMatch.venue.featured;
        refreshAfterAdminAction(venueMatch.venue.featured ? "Venue featured" : "Venue unfeatured");
        return;
      }
      if (action === "remove-venue" && venueMatch) {
        venueMatch.venue.hidden = true;
        venueMatch.venue.isActive = false;
        if (selectedVenueName === venueMatch.venue.name) selectedVenueName = null;
        refreshAfterAdminAction("Venue removed");
        saveLiveAdminVenueRemoval(venueMatch.venue);
        return;
      }
      if (action === "resolve-report" && report) {
        saveLiveAdminReportAction(reportId, "resolved");
        return;
      }
      if (action === "remove-reported" && report) {
        const targetName = report.targetLabel || report.target || host?.dataset.reportTarget;
        const target = allProfiles().find(({ profile }) => profile.name === targetName);
        if (target) target.profile.hidden = true;
        saveLiveAdminReportAction(reportId, "removed");
      }
    }

    function workingNowItems(city) {
      const market = discoveryMarket(city);
      return market.dancers
        .filter((profile) => isApprovedPublicProfile(profile) && isWorkingTonight(profile, city) && profileMatchesVenueFilter(profile))
        .sort((a, b) => shiftStartMinutes(a.time) - shiftStartMinutes(b.time))
        .map((profile) => withTrendingRank(profile, city));
    }

    function venueSchedulePriority(venue, city) {
      city = venue?.city || city;
      const profiles = venueDancers(city, venue.name);
      if (profiles.some((profile) => isWorkingTonight(profile, city))) return 0;
      if (profiles.some((profile) => profile.scheduled)) return 1;
      return 2;
    }

    function venueDiscoveryIsActiveNow(venue, city) {
      city = venue?.city || city;
      const hasWorkingDancer = venueDancers(city, venue.name)
        .some((profile) => isWorkingTonight(profile, city));
      if (hasWorkingDancer) return true;
      return venueOperatingStatus(venue?.hours || "", city).state === "open";
    }

    function compareVenuePopularity(left, right) {
      const leftPopularity = left?.popularity || {};
      const rightPopularity = right?.popularity || {};
      return (
        (Number(rightPopularity.followerCount) || 0) - (Number(leftPopularity.followerCount) || 0) ||
        (Number(rightPopularity.directionRequests30d) || 0) - (Number(leftPopularity.directionRequests30d) || 0) ||
        (Number(rightPopularity.profileViews30d) || 0) - (Number(leftPopularity.profileViews30d) || 0)
      );
    }

    function compareVenueDiscoveryPriority(left, right, city) {
      const dealDifference = Number(Boolean(right?.activeDeal?.id)) - Number(Boolean(left?.activeDeal?.id));
      const activeDifference = Number(venueDiscoveryIsActiveNow(right, city)) - Number(venueDiscoveryIsActiveNow(left, city));
      const scheduleDifference = venueSchedulePriority(left, city) - venueSchedulePriority(right, city);
      return dealDifference || activeDifference || scheduleDifference || compareVenuePopularity(left, right) || compareVenueDistance(left, right, city);
    }

    function getItems(city, tab) {
      const market = discoveryMarket(city);
      if (["tonight", "dancers", "venues"].includes(tab) && liveMarketState[city] !== "ready") {
        return [];
      }
      if (userLocationOutsideMarkets && ["tonight", "dancers", "venues"].includes(tab)) return [];
      if (tab === "tonight") return workingNowItems(city);
      if (tab === "dancers") {
        const profiles = market.dancers
          .filter((profile) => isApprovedPublicProfile(profile) && profileMatchesVenueFilter(profile))
          .map((profile) => withTrendingRank(profile, city));
        return dancerDirectoryProfiles(profiles, city);
      }
      if (tab === "venues") {
        return market.venues
          .filter(venueMatchesCurrentFilter)
          .sort((a, b) => compareVenueDiscoveryPriority(a, b, city));
      }
      return [];
    }

    function homeNavigationIconMarkup(tabName) {
      const icons = {
        tonight: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5.5" width="17" height="15" rx="2"></rect><path d="M8 3.5v4M16 3.5v4M3.5 10h17"></path><circle cx="15.5" cy="15.5" r="3"></circle><path d="M15.5 14v1.7l1.2.8"></path></svg>',
        dancers: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.2"></circle><path d="M5.5 20c.6-4.1 2.8-6.2 6.5-6.2s5.9 2.1 6.5 6.2"></path></svg>',
        venues: '<svg viewBox="0 0 24 24"><path d="M5 20V7l7-3 7 3v13"></path><path d="M3 20h18"></path><path d="M9 10h6M9 14h6"></path></svg>'
      };
      return `<span class="home-nav-icon" aria-hidden="true"><span class="mobile-nav-selection-halo"></span>${icons[tabName] || icons.tonight}</span>`;
    }

    function updateTabCounts(city) {
      const loading = liveDiscoveryIsLoading(city);
      const unavailable = liveMarketState[city] === "error";
      const counts = {
        tonight: getItems(city, "tonight").length,
        dancers: getItems(city, "dancers").length,
        venues: getItems(city, "venues").length
      };
      document.querySelectorAll(".tab[data-tab]").forEach((tab) => {
        const tabName = tab.dataset.tab;
        const label = tab.dataset.tabLabel || tab.textContent.trim();
        const liveTab = ["tonight", "dancers", "venues"].includes(tabName);
        const count = liveTab && (loading || unavailable) ? "..." : (counts[tabName] ?? 0);
        tab.innerHTML = `${homeNavigationIconMarkup(tabName)}<span class="home-nav-label">${label}</span><span class="tab-count">${count}</span>`;
      });
    }

    function updateHomeLiveSummary(city) {
      const summary = document.getElementById("homeLiveSummary");
      if (!summary || !discoveryMarket(city)) return;

      const venueName = selectedVenueFilter();
      const workingNowCount = getItems(city, "tonight").length;
      const radiusLabel = distanceSelect?.value || "25 mi";
      const venueLabel = venueName === "all" ? "All clubs" : resolveVenueByName(venueName, city)?.name || venueName;
      const loading = liveDiscoveryIsLoading(city);
      const unavailable = liveMarketState[city] === "error";
      const workingSummary = document.getElementById("homeLiveWorking");
      document.getElementById("homeLiveRadius").textContent = city === ALL_CITIES ? `All cities · ${venueLabel}` : `${radiusLabel} radius · ${venueLabel}`;
      workingSummary.textContent = unavailable
        ? "Live results unavailable"
        : loading
        ? "Live schedule"
        : `${workingNowCount} working now`;
      summary.toggleAttribute("aria-busy", loading);
      workingSummary.classList.toggle("is-empty", !loading && !unavailable && workingNowCount === 0);
      workingSummary.classList.toggle("is-active", !loading && !unavailable && workingNowCount > 0);
      syncHomeFilterToggleState();
    }

    function syncHomeFilterToggleState() {
      syncDistancePickerDisplay();
      if (!homeFilterToggle) return;
      const activeFilterCount = Number(distanceSelect?.value !== "25 mi") + Number(selectedVenueFilter() !== "all");
      const count = document.getElementById("homeFilterCount");
      if (count) {
        count.textContent = String(activeFilterCount);
        count.hidden = activeFilterCount === 0;
      }
      if (homeFilterReset) homeFilterReset.hidden = activeFilterCount === 0;
      homeFilterToggle.classList.toggle("has-active-filters", activeFilterCount > 0);
      homeFilterToggle.setAttribute(
        "aria-label",
        activeFilterCount > 0
          ? `Filters, ${activeFilterCount} active`
          : "Filters"
      );
    }

    function homeDiscoveryFeedUsesInlineLayout() {
      return window.matchMedia("(max-width: 720px)").matches;
    }

    function homeDiscoveryFeedPositionKey(city = citySelect.value, tab = activeTab) {
      return [
        city,
        tab,
        distanceSelect?.value || "25 mi",
        selectedVenueFilter()
      ].join("::");
    }

    function homeDiscoveryFeedSlideKey(slide) {
      return String(slide?.dataset?.discoveryKey || slide?.dataset?.profile || "");
    }