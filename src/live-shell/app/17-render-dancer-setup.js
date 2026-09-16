

    function renderDancerSetup() {
      keepAvatarOriginSetupStepOpen();
      dancerSetupRefreshPending = false;
      const steps = setupOrder();
      const completedSteps = steps.filter((step) => isSavedSetupStepComplete(step)).length;
      const nextStep = nextIncompleteStep();
      const nextLabels = {
        profile: "Create, review, and submit profile",
        approval: "Venue affiliation"
      };
      const dancerName = activeDancerName();
      const city = activeDancerCity();
      const activeProfile = activeDancerProfile(city);
      const approved = dancerSetup.approval || dancerCoreApprovalUnlocked(activeProfile) || normalizedReviewStatus(liveDancerBilling?.dancerStatus) === "approved";
      const optionalProfileFixes = approved && hasOptionalProfileFixReviews();
      const rejected = !approved && (isRejectedDancerStatus(activeProfile?.status) || hasRejectedDancerReviews());
      const readyForReview = dancerProfileMediaReady();
      const reviewSubmitted = Boolean(activeProfile?.reviewSubmitted);
      const approvalStateLabel = rejected ? "Rejected" : optionalProfileFixes ? "Approved with fixes needed" : approved ? "Approved" : reviewSubmitted ? "Submitted" : readyForReview ? "Ready" : "Pending";
      const billingSummary = dancerBillingSummary(approved);
      const dashboardMetrics = mergeLiveDancerDashboardMetrics(null, liveDancerAnalytics, activeProfile, city);
      renderNotificationCenters();
      renderSupportInbox("dancer");
      dancerDashboard.classList.toggle("is-approved", approved);
      dancerDashboard.classList.toggle("is-pending-approval", !approved);
      document.querySelectorAll("#dancerDashboard .approved-analytics").forEach((section) => {
        const isPreviewCard = section.id === "dancerAnalyticsPreviewCard";
        section.hidden = !approved && !isPreviewCard;
        section.classList.toggle("locked-analytics", !approved && isPreviewCard);
      });
      document.querySelectorAll("#dancerDashboard .approved-dancer-stat").forEach((stat) => {
        stat.hidden = !approved;
      });
      const approvalCommand = document.getElementById("dancerApprovalCommand");
      if (approvalCommand) {
        approvalCommand.classList.toggle("approved", approved && !rejected);
        approvalCommand.classList.toggle("has-actionable-review", approved && optionalProfileFixes);
      }
      const approvalCommandToggle = approvalCommand?.querySelector("[data-setup-checklist-toggle]");
      if (approvalCommandToggle) {
        approvalCommandToggle.setAttribute("aria-expanded", setupChecklistExpanded ? "true" : "false");
        approvalCommandToggle.hidden = approved && !optionalProfileFixes;
      }
      const dancerApprovalStatus = document.getElementById("dancerApprovalStatus");
      if (dancerApprovalStatus) dancerApprovalStatus.textContent = approvalStateLabel;
      document.getElementById("dancerApprovalEyebrow").textContent = approved ? "Profile live" : "Profile setup";
      document.getElementById("dancerApprovalTitle").textContent = rejected
          ? "Rejected"
        : optionalProfileFixes
          ? "Approved with fixes needed"
        : approved
          ? "Your profile is live"
        : reviewSubmitted
          ? "Ready for venue affiliation"
          : "Finish your profile to continue";
      document.getElementById("dancerApprovalCopy").textContent = rejected
          ? "Your profile was rejected, but anything already approved stays approved. Fix or resend the red items below, then resubmit for review."
        : optionalProfileFixes
          ? "Your required verification is approved. Only pictures and/or social links need fixes. You can replace them and submit again, or leave them blank."
        : approved
          ? "Your public profile is live. Keep your schedule current, share your profile, and track the guests Dancr sends you."
        : reviewSubmitted
          ? "Your profile is private and ready. Tap the club's official dressing-room sticker to activate it."
          : "Create your profile and upload media. Every picture and video is automatically safety-moderated before the venue affiliation step.";
      document.getElementById("dancerApprovalProgress").textContent = `${completedSteps}/${steps.length}`;
      document.getElementById("dancerApprovalNext").textContent = rejected
          ? "Fix red items"
        : optionalProfileFixes
          ? "Approved with fixes"
        : approved
          ? "Ready to post shifts"
        : reviewSubmitted
          ? "Waiting for dressing-room tap"
          : `Next: ${nextLabels[nextStep] || "Approval"}`;
      const approvalExpand = document.getElementById("dancerApprovalExpand");
      if (approvalExpand) {
        approvalExpand.textContent = rejected
          ? setupChecklistExpanded ? "Hide fixes" : "Show fixes"
          : approved ? "Approved" : setupChecklistExpanded ? "Hide steps" : "Show steps";
      }
      document.getElementById("dancerSubscriptionStatus").textContent = billingSummary.label;
      const profileIncognito = Boolean(approved && dancerProfileIsHidden(activeProfile));
      document.getElementById("dancerPublicStatus").textContent = approved
        ? (profileIncognito ? "Incognito" : "Visible to guests")
        : "Profile setup required";
      document.getElementById("dancerSubscriptionDetail").textContent = billingSummary.detail;
      const billingButton = document.getElementById("billingPortalBtn");
      if (billingButton) billingButton.textContent = billingSummary.action;
      const billingSection = document.getElementById("dancerBillingSection");
      if (billingSection) billingSection.hidden = !liveDancerBilling?.subscription?.hasStripeSubscription;
      const approvalStatusSection = document.getElementById("dancerApprovalStatusSection");
      if (approvalStatusSection) approvalStatusSection.hidden = approved && !optionalProfileFixes && !rejected;
      document.getElementById("dancerPublicDetail").textContent = approved
        ? (profileIncognito
          ? "Your approved tools stay available. Press Reactivate profile any time to show your profile on Dancr again."
          : "Guests can discover this profile, follow it, view schedules, and request venue directions.")
        : "Complete and save your stage name and city to finish your public profile setup.";
      syncDancerIncognitoToggle(activeProfile, approved);
      renderDancerDailyOverview(activeProfile, approved, dashboardMetrics, optionalProfileFixes);
      const approvalStatusPrimary = document.getElementById("dancerApprovalStatusPrimary");
      const approvalStatusSecondary = document.getElementById("dancerApprovalStatusSecondary");
      if (approvalStatusPrimary && approvalStatusSecondary) {
        if (rejected) {
          approvalStatusPrimary.textContent = "Rejected. Fix or resend the red items in the review notes below.";
          approvalStatusSecondary.textContent = "Approved items stay approved. After you fix the rejected items, press Resubmit for review.";
        } else if (optionalProfileFixes) {
          approvalStatusPrimary.textContent = "Approved with fixes needed. Social links and/or pictures need fixes only.";
          approvalStatusSecondary.textContent = "Replace the rejected item and submit again, or leave that social/photo blank.";
        } else if (approved) {
          approvalStatusPrimary.textContent = "Venue affiliation confirmed. Your public profile, gallery, and shift posting are unlocked.";
          approvalStatusSecondary.textContent = "Keep your schedule updated so guests can find you when you are working.";
        } else if (reviewSubmitted) {
          approvalStatusPrimary.textContent = "Profile submitted and private. Tap the official dressing-room sticker at the venue where you work.";
          approvalStatusSecondary.textContent = "The dressing-room tap authorizes only your venue access. MyDancr separately reviews profile photos, videos, and public information for safety.";
        } else if (readyForReview) {
          approvalStatusPrimary.textContent = "Ready to preview. Review and submit your profile, then complete the dressing-room tap.";
          approvalStatusSecondary.textContent = "Your profile remains private until the dressing-room tap and profile/media review are complete.";
        } else {
          approvalStatusPrimary.textContent = "Complete your profile, avatar, and moderated media in Step 1.";
          approvalStatusSecondary.textContent = "Public discovery and the full dashboard unlock after venue affiliation.";
        }
      }
      const dancerFollowerStat = document.getElementById("dancerFollowerStat");
      if (dancerFollowerStat) {
        dancerFollowerStat.textContent = dashboardMetrics
          ? dashboardMetrics.followers.toLocaleString()
          : "0";
      }
      const dancerNotificationStat = document.getElementById("dancerNotificationStat");
      if (dancerNotificationStat) {
        dancerNotificationStat.textContent = dashboardMetrics
          ? dashboardMetrics.notifications.toLocaleString()
          : "0";
      }
      if (dashboardMetrics && approved) {
        const totalSocialClicks = dashboardMetrics.instagramClicks + dashboardMetrics.snapchatClicks + dashboardMetrics.tiktokClicks + dashboardMetrics.onlyfansClicks + dashboardMetrics.xClicks;
        const socialPlatforms = [
          { name: "Instagram", clicks: dashboardMetrics.instagramClicks },
          { name: "Snapchat", clicks: dashboardMetrics.snapchatClicks },
          { name: "TikTok", clicks: dashboardMetrics.tiktokClicks },
          { name: "OnlyFans", clicks: dashboardMetrics.onlyfansClicks },
          { name: "X", clicks: dashboardMetrics.xClicks }
        ].sort((a, b) => b.clicks - a.clicks);
        const bestSocial = socialPlatforms[0] || { name: "Social links", clicks: 0 };
        const highIntentActions = dashboardMetrics.directionRequests30 + dashboardMetrics.goingTonightClicks;
        const notificationOpenRate = Math.round((dashboardMetrics.notificationOpens / Math.max(1, dashboardMetrics.notificationsSent30Days || dashboardMetrics.notifications)) * 100);
        const scheduleConversionRate = Math.round((dashboardMetrics.goingTonightClicks / Math.max(1, dashboardMetrics.scheduleViews30)) * 1000) / 10;
        const searchImpressions = dashboardMetrics.searchAppearances + dashboardMetrics.nearbyViews;
        const strongestClub = dashboardMetrics.clubPerformance.find((club) => club.name === dashboardMetrics.venue) || dashboardMetrics.clubPerformance[0] || { name: dashboardMetrics.venue, avgViews: 0 };
        const weeklyStartRank = liveMetricNumber(liveDancerWeeklyReport?.startRank, 0);
        const weeklyEndRank = liveMetricNumber(liveDancerWeeklyReport?.currentRank, 0);
        const weeklyFollowers = liveMetricNumber(liveDancerWeeklyReport?.followersGained, 0);
        const weeklyViews = liveMetricNumber(liveDancerWeeklyReport?.profileViews, 0);
        const weeklyGoing = liveMetricNumber(liveDancerWeeklyReport?.goingSignals, 0);
        const weeklySocialClicks = liveMetricNumber(liveDancerWeeklyReport?.socialClicks, 0);
        const weeklyNotificationOpens = liveMetricNumber(liveDancerWeeklyReport?.notificationOpens, 0);
        const weeklyRankText = weeklyStartRank || weeklyEndRank ? `${rankLabel(weeklyStartRank)} -> ${rankLabel(weeklyEndRank)}` : "No rank yet";
        const qrOpens = liveDancerDeals?.qrOpens || 0;
        const qrRedeemed = liveDancerDeals?.redeemed || 0;
        const hasTrafficData = dashboardMetrics.profileViews30 || dashboardMetrics.scheduleViews30 || dashboardMetrics.directionRequests30 || highIntentActions || totalSocialClicks;

        document.getElementById("dancerValueMessage").innerHTML = hasTrafficData
          ? `We sent <strong>${compactNumber(dashboardMetrics.profileViews30)}</strong> people to your profile, <strong>${compactNumber(dashboardMetrics.scheduleViews30)}</strong> viewed your schedule, and <strong>${compactNumber(dashboardMetrics.directionRequests30)}</strong> requested directions to <strong>${escapeHtml(dashboardMetrics.venue)}</strong> this month.`
          : "No live analytics yet. Real profile views, schedule views, followers, social clicks, notifications, direction requests, and Club Deal activity will appear here after guests interact with your profile.";
        document.getElementById("dancerRankMetrics").innerHTML = [
          metricCardMarkup(rankLabel(dashboardMetrics.currentRank), `${city} rank`),
          metricCardMarkup(rankMovementText(dashboardMetrics.rankChangeYesterday), "Rank change this week"),
          metricCardMarkup(rankLabel(dashboardMetrics.highestRankAchieved), "Highest rank achieved"),
          metricCardMarkup(rankLabel(dashboardMetrics.bestRankThisWeek), "Best rank this week")
        ].join("");
        document.getElementById("dancerValueMetrics").innerHTML = [
          metricCardMarkup(compactNumber(dashboardMetrics.profileViews30), "Profile views"),
          metricCardMarkup(compactNumber(dashboardMetrics.newFollowers), "Followers gained"),
          metricCardMarkup(compactNumber(dashboardMetrics.scheduleViews30), "Schedule views"),
          metricCardMarkup(compactNumber(dashboardMetrics.directionRequests30), "Direction requests · strongest value metric"),
          metricCardMarkup(compactNumber(dashboardMetrics.goingTonightClicks), "Going Now clicks"),
          metricCardMarkup(compactNumber(dashboardMetrics.favoritesAdded), "Favorites added"),
          metricCardMarkup(compactNumber(dashboardMetrics.mediaLikes), "Media likes")
        ].join("");
        document.getElementById("dancerCustomerImpact").innerHTML = `${compactNumber(highIntentActions)} <span>actions</span>`;
        document.getElementById("dancerCustomerImpactDetail").textContent = highIntentActions
          ? `Dancr generated ${compactNumber(highIntentActions)} high-intent guest actions for you this month.`
          : "No high-intent guest actions yet. Direction requests and Going Now clicks will appear here.";
        document.getElementById("dancerWeeklySummary").textContent = liveDancerWeeklyReport
          ? `Monday report: ${weeklyRankText}, ${compactNumber(weeklyFollowers)} new followers, ${compactNumber(weeklyViews)} profile views, and ${compactNumber(weeklyGoing)} Going Now signals.`
          : "No weekly report data yet. Once guest activity starts, this will show real weekly rank, follower, profile view, social click, and notification data.";
        document.getElementById("dancerWeeklyMetrics").innerHTML = [
          metricCardMarkup(weeklyRankText, "Previous rank -> current rank"),
          metricCardMarkup(compactNumber(weeklyFollowers), "New followers"),
          metricCardMarkup(compactNumber(weeklyViews), "Profile views"),
          metricCardMarkup(compactNumber(weeklyGoing), "Going Now signals"),
          metricCardMarkup(compactNumber(weeklySocialClicks), "Social clicks"),
          metricCardMarkup(compactNumber(weeklyNotificationOpens), "Notification opens")
        ].join("");
        document.getElementById("dancerClubSummary").textContent = dashboardMetrics.directionRequests30 || dashboardMetrics.clubPageClicks
          ? `${dashboardMetrics.venue} is your strongest venue with ${compactNumber(dashboardMetrics.directionRequests30)} direction requests.`
          : "No live club traffic yet. Club page clicks and direction requests will appear here.";
        document.getElementById("dancerClubMetrics").innerHTML = [
          metricCardMarkup(dashboardMetrics.venue, "Strongest venue"),
          metricCardMarkup(compactNumber(dashboardMetrics.clubPageClicks), "Club page clicks"),
          metricCardMarkup(compactNumber(dashboardMetrics.directionRequests30), "Direction requests"),
          metricCardMarkup(compactNumber(strongestClub.avgViews), `${strongestClub.name} avg views`),
          ...dashboardMetrics.clubPerformance
            .filter((club) => club.name !== strongestClub.name)
            .slice(0, 2)
            .map((club) => metricCardMarkup(compactNumber(club.avgViews), `${club.name} avg views`))
        ].join("");
        document.getElementById("dancerDealSummary").textContent =
          qrRedeemed ? "Cashier taps generated " + compactNumber(qrRedeemed) + " redeemed deals." : "Verified Club Deal activity appears here after guests interact with your profile.";
        document.getElementById("dancerDealMetrics").innerHTML = [
          metricCardMarkup(compactNumber(qrOpens), "Attributed deal opens"),
          metricCardMarkup(compactNumber(qrRedeemed), "Cashier-tap redemptions")
        ].join("");
        document.getElementById("dancerSocialSummary").textContent = totalSocialClicks
          ? `${bestSocial.name} is your top-performing link this month.`
          : "No social link clicks yet. Instagram, TikTok, Snapchat, OnlyFans, and X clicks will appear here.";
        document.getElementById("dancerSocialMetrics").innerHTML = [
          metricCardMarkup(compactNumber(totalSocialClicks), "Total social clicks"),
          metricCardMarkup(totalSocialClicks ? bestSocial.name : "None yet", "Best performing platform"),
          metricCardMarkup(compactNumber(dashboardMetrics.instagramClicks), "Instagram clicks"),
          metricCardMarkup(compactNumber(dashboardMetrics.snapchatClicks), "Snapchat clicks"),
          metricCardMarkup(compactNumber(dashboardMetrics.tiktokClicks), "TikTok clicks"),
          metricCardMarkup(compactNumber(dashboardMetrics.onlyfansClicks), "OnlyFans clicks"),
          metricCardMarkup(compactNumber(dashboardMetrics.xClicks), "X clicks")
        ].join("");
        document.getElementById("dancerNotificationMetrics").innerHTML = [
          metricCardMarkup(compactNumber(dashboardMetrics.notifications), "Notifications enabled"),
          metricCardMarkup(compactNumber(dashboardMetrics.notificationsSent30Days), "Notifications sent"),
          metricCardMarkup(compactNumber(dashboardMetrics.notificationOpens), "Notification opens"),
          metricCardMarkup(`${notificationOpenRate}%`, "Open rate")
        ].join("");
        document.getElementById("dancerAdvancedMetrics").innerHTML = [
          metricCardMarkup(compactNumber(dashboardMetrics.searchAppearances), "City search appearances"),
          metricCardMarkup(compactNumber(dashboardMetrics.returningViewers), "Returning viewers"),
          metricCardMarkup(compactNumber(dashboardMetrics.peakHourViews), "Peak-hour views"),
          metricCardMarkup(`${notificationOpenRate}%`, "Notification open rate"),
          metricCardMarkup(`${scheduleConversionRate}%`, "Schedule conversion rate"),
          metricCardMarkup(compactNumber(searchImpressions), "Search impressions")
        ].join("");
        const rankingNotifications = liveDancerRankingEvents.length
          ? liveDancerRankingEvents.slice(0, 4).map(liveRankingEventMarkupData)
          : dashboardMetrics.rankingNotifications;
        document.getElementById("dancerRankingNotifications").innerHTML = rankingNotifications.length
          ? rankingNotifications.map(rankingNotificationMarkup).join("")
          : `<article class="rank-event stable"><span class="rank-event-icon">!</span><span><strong>No ranking milestones yet</strong><p>Real ranking alerts will appear after your profile earns Top 10, moves up 3+ spots, or reaches #1.</p></span></article>`;
      } else if (approved) {
        document.getElementById("dancerValueMessage").textContent =
          "No live analytics yet. Real profile views, schedule views, followers, social clicks, notifications, direction requests, and Club Deal activity will appear here after guests interact with your profile.";
        document.getElementById("dancerRankMetrics").innerHTML = [
          metricCardMarkup("No rank yet", `${city} rank`),
          metricCardMarkup("No change", "Rank change this week"),
          metricCardMarkup("No rank yet", "Highest rank achieved"),
          metricCardMarkup("No rank yet", "Best rank this week")
        ].join("");
        document.getElementById("dancerValueMetrics").innerHTML = [
          metricCardMarkup("0", "Profile views"),
          metricCardMarkup("0", "Followers gained"),
          metricCardMarkup("0", "Schedule views"),
          metricCardMarkup("0", "Direction requests"),
          metricCardMarkup("0", "Going Now clicks"),
          metricCardMarkup("0", "Favorites added")
        ].join("");
        document.getElementById("dancerCustomerImpact").innerHTML = `0 <span>actions</span>`;
        document.getElementById("dancerCustomerImpactDetail").textContent = "No high-intent guest actions yet.";
        document.getElementById("dancerWeeklySummary").textContent = "No weekly report data yet. Once guest activity starts, this will show real weekly profile and ranking activity.";
        document.getElementById("dancerWeeklyMetrics").innerHTML = [
          metricCardMarkup("No rank yet", "Previous rank -> current rank"),
          metricCardMarkup("0", "New followers"),
          metricCardMarkup("0", "Profile views"),
          metricCardMarkup("0", "Going Now signals"),
          metricCardMarkup("0", "Social clicks"),
          metricCardMarkup("0", "Notification opens")
        ].join("");
        document.getElementById("dancerClubSummary").textContent = "No live club traffic yet. Club page clicks and direction requests will appear here.";
        document.getElementById("dancerClubMetrics").innerHTML = [
          metricCardMarkup(activeProfile?.venue || "No venue yet", "Strongest venue"),
          metricCardMarkup("0", "Club page clicks"),
          metricCardMarkup("0", "Direction requests"),
          metricCardMarkup("0", "Average views by club")
        ].join("");
        const qrOpens = liveDancerDeals?.qrOpens || 0;
        const qrRedeemed = liveDancerDeals?.redeemed || 0;
        document.getElementById("dancerDealSummary").textContent =
          qrRedeemed ? "Cashier taps generated " + compactNumber(qrRedeemed) + " redeemed deals." : "Verified Club Deal activity appears here after guests interact with your profile.";
        document.getElementById("dancerDealMetrics").innerHTML = [
          metricCardMarkup(compactNumber(qrOpens), "Attributed deal opens"),
          metricCardMarkup(compactNumber(qrRedeemed), "Cashier-tap redemptions")
        ].join("");
        document.getElementById("dancerSocialSummary").textContent = "No social link clicks yet. Instagram, TikTok, Snapchat, OnlyFans, and X clicks will appear here.";
        document.getElementById("dancerSocialMetrics").innerHTML = [
          metricCardMarkup("0", "Total social clicks"),
          metricCardMarkup("None yet", "Best performing platform"),
          metricCardMarkup("0", "Instagram clicks"),
          metricCardMarkup("0", "Snapchat clicks"),
          metricCardMarkup("0", "TikTok clicks"),
          metricCardMarkup("0", "OnlyFans clicks"),
          metricCardMarkup("0", "X clicks")
        ].join("");
        document.getElementById("dancerNotificationMetrics").innerHTML = [
          metricCardMarkup("0", "Notifications sent"),
          metricCardMarkup("0", "Notification opens"),
          metricCardMarkup("0%", "Open rate")
        ].join("");
        document.getElementById("dancerAdvancedMetrics").innerHTML = [
          metricCardMarkup("0", "City search appearances"),
          metricCardMarkup("0", "Returning viewers"),
          metricCardMarkup("0", "Peak-hour views"),
          metricCardMarkup("0%", "Notification open rate"),
          metricCardMarkup("0%", "Schedule conversion rate"),
          metricCardMarkup("0", "Search impressions")
        ].join("");
        document.getElementById("dancerRankingNotifications").innerHTML =
          `<article class="rank-event stable"><span class="rank-event-icon">!</span><span><strong>No ranking milestones yet</strong><p>Real ranking alerts will appear after your profile earns Top 10, moves up 3+ spots, or reaches #1.</p></span></article>`;
      } else {
        document.getElementById("dancerValueMessage").textContent =
          "Analytics unlock after approval. Dancr tracks profile views, schedule views, follower growth, social clicks, ranking movement, notifications, favorites, Going Now clicks, and club direction requests so you can see what brings guests to you.";
        document.getElementById("dancerRankMetrics").innerHTML = lockedMetricCards([
          "Current city rank",
          "Rank change this week",
          "Highest rank achieved",
          "Best rank this week"
        ]);
        document.getElementById("dancerValueMetrics").innerHTML = lockedMetricCards([
          "Profile views",
          "Followers gained",
          "Schedule views",
          "Direction requests",
          "Going Now clicks",
          "Favorites added"
        ]);
        document.getElementById("dancerCustomerImpact").textContent = "Locked";
        document.getElementById("dancerCustomerImpactDetail").textContent = "High-intent guest actions unlock after approval.";
        document.getElementById("dancerWeeklySummary").textContent =
          "Your weekly report unlocks after approval and tracks rank movement, followers, profile views, Going Now signals, social clicks, and notification opens.";
        document.getElementById("dancerWeeklyMetrics").innerHTML = lockedMetricCards([
          "Previous rank → current rank",
          "New followers",
          "Profile views",
          "Going Now signals",
          "Social clicks",
          "Notification opens"
        ]);
        document.getElementById("dancerClubSummary").textContent = "Club traffic unlocks after approval so you can see where Dancr sends guests.";
        document.getElementById("dancerClubMetrics").innerHTML = lockedMetricCards([
          "Strongest venue",
          "Club page clicks",
          "Direction requests",
          "Average views by club"
        ]);
        document.getElementById("dancerDealSummary").textContent = "Club Deal activity unlocks after profile approval.";
        document.getElementById("dancerDealMetrics").innerHTML = lockedMetricCards(["Attributed deal opens", "Cashier-tap redemptions"]);
        document.getElementById("dancerSocialSummary").textContent = "Social growth unlocks after approval across Instagram, Snapchat, TikTok, OnlyFans, and X.";
        document.getElementById("dancerSocialMetrics").innerHTML = lockedMetricCards([
          "Total social clicks",
          "Best performing platform",
          "Instagram clicks",
          "Snapchat clicks",
          "TikTok clicks",
          "OnlyFans clicks",
          "X clicks"
        ]);
        document.getElementById("dancerNotificationMetrics").innerHTML = lockedMetricCards([
          "Notifications sent",
          "Notification opens",
          "Open rate"
        ]);
        document.getElementById("dancerAdvancedMetrics").innerHTML = lockedMetricCards([
          "City search appearances",
          "Returning viewers",
          "Peak-hour views",
          "Notification open rate",
          "Schedule conversion rate",
          "Search impressions"
        ]);
        document.getElementById("dancerRankingNotifications").innerHTML =
          `<article class="rank-event stable"><span class="rank-event-icon">🔒</span><span><strong>Ranking alerts locked</strong><p>Milestone notifications unlock after approval.</p></span></article>`;
      }
      const setupWrap = document.getElementById("setupChecklistWrap");
      const setupToggle = document.getElementById("setupChecklistToggle");
      const setupList = document.getElementById("setupChecklist");
      const setupLock = document.getElementById("setupChecklistLock");
      const setupSummary = document.getElementById("setupChecklistSummary");
      setupWrap.hidden = (approved && !rejected) || !setupChecklistExpanded;
      setupWrap.classList.toggle("expanded", setupChecklistExpanded);
      if (setupToggle) {
        setupToggle.setAttribute("aria-expanded", setupChecklistExpanded ? "true" : "false");
        setupToggle.textContent = setupChecklistExpanded ? "Hide steps" : "Show steps";
      }
      setupList.hidden = !setupChecklistExpanded;
      if (setupLock) setupLock.hidden = true;
      if (setupSummary) {
        setupSummary.textContent = approved
          ? "Your profile is approved."
          : `${completedSteps}/${steps.length} complete${nextStep ? ` · Next: ${nextLabels[nextStep]}` : ""}`;
      }
      document.getElementById("approvedDancerPanel").hidden = !approved;
      document.getElementById("dancerVenueVerificationSection").hidden = !(reviewSubmitted || dancerSetup.review || approved);
      renderShiftPostForm();
      if (approved) {
        renderDancerManagement();
        renderApprovedToolDropdowns();
      }
      if (approved && !rejected) {
        if (setupList) setupList.innerHTML = "";
        const sharePanel = document.getElementById("dancerSharePanel");
        if (sharePanel) {
          sharePanel.innerHTML = `
            <strong>Share your profile</strong>
            ${shareButtonsMarkup(dancerName, city, "dancer")}
          `;
        }
        return;
      }

      const profileIdentityBody = `
        <section class="setup-profile-editor-section">
          <div class="setup-profile-editor-head">
            <strong>Profile identity</strong>
            <p>Start with your avatar, then add the public name and city guests will see.</p>
          </div>
          <form class="auth-form" id="setupProfileForm" data-setup-form="profile">
            <div class="field">
              <label>Profile avatar</label>
              ${dancerSetupAvatarEditorMarkup(activeProfile)}
              <div class="field-note">Required. Upload this first so your face-centered avatar is ready while you finish the rest of your profile. The same production moderation used in Edit Profile is applied here.</div>
            </div>
            <div class="field">
              <label for="setupStageName">Stage name</label>
              <input id="setupStageName" data-setup-profile-field="stageName" type="text" value="${escapeHtml(document.getElementById("dancerStageName").value || "")}" minlength="2" maxlength="40" autocomplete="nickname">
              <div class="stage-name-note"><strong>Displayed on profile cards:</strong> This is the name guests see on Dancr profiles, schedules, and search results.</div>
            </div>
            <div class="field">
              <label for="setupCity">City</label>
              <select id="setupCity" data-setup-profile-field="city" required ${dancerSignupCitiesState === "ready" ? "" : "disabled"}>
                ${dancerSignupCityOptionsMarkup(document.getElementById("dancerCity")?.value || pendingDancerSignupCity)}
              </select>
              <div class="field-note" id="setupCityNote">${dancerSignupCitiesState === "error" ? "The live city list could not be loaded. Try again before saving your profile." : "Choose from active MyDancr venue markets."}</div>
            </div>
          </form>
        </section>
      `;
      const photosBody = `
        <section class="setup-profile-editor-section">
          <div class="setup-profile-editor-head">
            <strong>Profile pictures</strong>
            <p>Add and review pictures with the same uploader used in Edit Profile.</p>
          </div>
          <form class="auth-form" data-setup-form="photos">
            ${dancerSetupPhotoPreviewMarkup()}
            <div class="field">
              <label for="setupProfilePhotos">Choose pictures</label>
              <input id="setupProfilePhotos" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" multiple>
              <div class="field-note"><strong>Upload up to ${MAX_DANCER_PROFILE_PHOTOS} photos.</strong> For the sharpest result, choose original camera images—not screenshots or social-media copies—with at least 2,000 pixels on the longest edge. MyDancr keeps the high-resolution master, serves responsive sizes, and never enlarges a small upload. The first photo becomes your main profile photo. Each photo uses the live Dancr auto-moderation rules: it is approved automatically, sent for human review, or fully rejected.</div>
            </div>
            <div class="rule-note" id="photoUploadResult">Every image is checked automatically. A pending or rejected image keeps profile submission locked until it passes or is removed.</div>
            <button class="action-btn" type="submit">Upload pictures</button>
          </form>
        </section>
        ${approvedProfileVideoManagerMarkup()}
      `;
      const profileSocialBody = `
        <section class="setup-profile-editor-section">
          <div class="setup-profile-editor-head">
            <strong>Social links</strong>
            <p>Add the same optional links that appear in Edit Profile. Uploading media will not clear these fields.</p>
          </div>
          <div class="auth-form">
            <div class="field"><label for="setupInstagram">Optional Instagram</label><input id="setupInstagram" form="setupProfileForm" data-setup-social="instagram" type="text" value="${escapeHtml(dancerSignupSocials.instagram)}" placeholder="Username or profile URL"></div>
            <div class="field"><label for="setupTiktok">Optional TikTok</label><input id="setupTiktok" form="setupProfileForm" data-setup-social="tiktok" type="text" value="${escapeHtml(dancerSignupSocials.tiktok)}" placeholder="Username or profile URL"></div>
            <div class="field"><label for="setupSnapchat">Optional Snapchat</label><input id="setupSnapchat" form="setupProfileForm" data-setup-social="snapchat" type="text" value="${escapeHtml(dancerSignupSocials.snapchat)}" placeholder="username or snapchat.com/add/username"></div>
            <div class="field"><label for="setupOnlyfans">Optional OnlyFans</label><input id="setupOnlyfans" form="setupProfileForm" data-setup-social="onlyfans" type="text" value="${escapeHtml(dancerSignupSocials.onlyfans)}" placeholder="Username or profile URL"></div>
            <div class="field"><label for="setupX">Optional X</label><input id="setupX" form="setupProfileForm" data-setup-social="x" type="text" value="${escapeHtml(dancerSignupSocials.x)}" placeholder="Username or profile URL"></div>
            <div class="rule-note">Enter a username or full profile URL. MyDancr turns it into a clickable account link after approval. Allowed: Instagram, TikTok, Snapchat, OnlyFans, and X. No escorting, illegal services, or direct solicitation links.</div>
          </div>
          <div class="setup-profile-editor-actions">
            <button class="action-btn" type="submit" form="setupProfileForm" data-setup-profile-save ${dancerSignupCitiesState === "ready" ? "" : "disabled"}>Save profile</button>
            <div class="rule-note" id="setupProfileSaveStatus" role="status" aria-live="polite" hidden></div>
          </div>
        </section>
      `;
      const profileBody = `<div class="setup-profile-editor" data-setup-profile-editor>${profileIdentityBody}${photosBody}${profileSocialBody}</div>`;
      const reviewBody = `
        <section class="setup-profile-editor-section setup-profile-review-section">
          <div class="setup-profile-editor-head">
            <strong>Review and submit</strong>
            <p>Preview the guest-facing profile, confirm it is accurate, then submit it.</p>
          </div>
          ${profileReviewNoticeMarkup(reviewSubmitted)}
          <button class="action-btn secondary" type="button" data-preview-profile>
            Preview public profile
          </button>
          <button class="action-btn" type="button" data-submit-review>Submit profile</button>
          <div class="rule-note">Only moderation-safe pictures and videos can proceed. Submission keeps the profile private while you complete venue affiliation.</div>
        </section>
      `;
      const approvalBody = `
        <div class="info-tile"><strong>Approve venue access</strong><div class="meta">Log in to your MyDancr dancer account first. No particular page needs to be open. Unlock your phone and tap the club's MyDancr dressing-room sticker. Open the link if prompted, and log in there if asked.</div></div>
        <div class="rule-note">This Step 2 tap approves the submitted profile and authorizes the venue for check-in and Working Now.</div>
      `;
      document.getElementById("setupChecklist").innerHTML = [
        setupStepMarkup("profile", "Create & review profile", `${profileBody}${reviewBody}`),
        setupStepMarkup("approval", "Confirm venue affiliation", approvalBody)
      ].join("");
      if (!approvedProfileVideoWorkspace && !approvedProfileVideoLoading && approvedProfileVideoStatusTone !== "error") void loadApprovedProfileVideos();
    }

    function limitedList(items, expanded) {
      return expanded ? items : items.slice(0, 5);
    }

    function renderNotificationSettings() {
      notificationSettings.innerHTML = '<a class="action-btn secondary" href="/dashboard/customer#customer-alerts">Manage notification preferences</a>';
    }

    function allProfiles() {
      return Object.entries(markets).flatMap(([city, market]) => (
        market.dancers.map((profile) => ({ city, profile }))
      ));
    }

    function hasRealSubmittedDancerData(profile) {
      return Boolean(
        profile?.id ||
        profile?.isRealDancerAccount ||
        profile?.reviewSubmitted ||
        profile?.approvalChangesPending ||
        (Array.isArray(profile?.submittedPhotos) && profile.submittedPhotos.length) ||
        (Array.isArray(profile?.reviews) && profile.reviews.length) ||
        (Array.isArray(profile?.socialLinks) && profile.socialLinks.length)
      );
    }

    function adminProfiles() {
      return allProfiles().filter(({ profile }) => hasRealSubmittedDancerData(profile));
    }

    function adminProfileRow(city, profile) {
      const visibleStatus = profile.hidden ? "Hidden" : profile.status;
      const shiftText = profile.scheduled ? `${profile.venue} · ${displayShiftTime(profile.time)}` : "No active shift";
      const socialCount = normalizeSubmittedSocials(profile).length;
      const photoCount = profile.submittedPhotos?.length || profile.galleryPhotoUrls?.length || (profile.mainPhotoUrl ? 1 : 0);
      return `
        <article class="admin-item" data-admin-profile="${escapeHtml(profile.name)}" data-admin-city="${escapeHtml(city)}">
          <div class="row">
            <div>
              <h3><button class="admin-profile-open-link" type="button" data-admin-action="view-dancer-profile">${displayText(profile.name)}</button></h3>
              <div class="meta">${escapeHtml(city)} · ${escapeHtml(visibleStatus)} · ${escapeHtml(shiftText)}</div>
            </div>
            <span class="${profile.status === "Pending" ? "badge pending" : "badge"}">${escapeHtml(visibleStatus)}</span>
          </div>
          <div class="meta">Venue affiliation: ${profile.venueApprovedAt ? "Confirmed" : "Required"} · Photos: ${displayText(profile.photoStatus)}</div>
          <div class="meta">Socials: ${socialCount} · Photos: ${photoCount}</div>
          <div class="admin-actions">
            <button class="action-btn secondary" data-admin-action="view-dancer-profile">View full profile</button>
          </div>
        </article>
      `;
    }

    function adminDirectoryDancerSearchText(city, profile) {
      return [
        profile.name,
        profile.stageName,
        profile.venue,
        city,
        profile.status,
        profile.photoStatus
      ].map((value) => String(value || "")).join(" ").toLowerCase();
    }

    function adminDirectoryDancerRow(city, profile, statusLabel) {
      const shiftText = profile.scheduled ? `${profile.venue} · ${displayShiftTime(profile.time)}` : profile.venue || "No active shift";
      const badgeClass = statusLabel === "Approved" ? "badge" : "badge pending";
      return `
        <article class="admin-item" data-admin-profile="${displayText(profile.name)}" data-admin-city="${displayText(city)}">
          <div class="row">
            <div>
              <h3><button class="admin-profile-open-link" type="button" data-admin-action="view-dancer-profile">${displayText(profile.name || "Stage name missing")}</button></h3>
              <div class="meta">${displayText(city)} · ${displayText(shiftText)}</div>
            </div>
            <span class="${badgeClass}">${displayText(statusLabel)}</span>
          </div>
          <div class="meta">Venue affiliation: ${profile.venueApprovedAt ? "Confirmed" : "Required"} · Photos: ${displayText(profile.photoStatus)}</div>
          <div class="admin-actions">
            <button class="action-btn secondary" data-admin-action="view-dancer-profile">View full profile</button>
            <button class="action-btn danger" data-admin-action="delete-dancer-profile">Delete profile</button>
            <button class="action-btn secondary" data-admin-action="feature-dancer">${profile.featured ? "Unfeature dancer" : "Feature dancer"}</button>
            ${statusLabel === "Disapproved" ? '<button class="action-btn" data-admin-action="approve-dancer">Approve profile content</button>' : ""}
          </div>
        </article>
      `;
    }

    function filterAdminDirectoryDancers(items, query) {
      const normalized = String(query || "").trim().toLowerCase();
      if (!normalized) return items;
      return items.filter(({ city, profile }) => adminDirectoryDancerSearchText(city, profile).includes(normalized));
    }

    function renderAdminDancerDirectories() {
      const profiles = adminProfiles();
      const approved = profiles.filter(({ profile }) => profile.status === "Verified");
      const disapproved = profiles.filter(({ profile }) => profile.status === "Rejected");
      const visibleApproved = filterAdminDirectoryDancers(approved, adminApprovedDancerSearch);
      const visibleDisapproved = filterAdminDirectoryDancers(disapproved, adminDisapprovedDancerSearch);
      const approvedCount = document.getElementById("adminApprovedDancerCount");
      const disapprovedCount = document.getElementById("adminDisapprovedDancerCount");
      const approvedList = document.getElementById("adminApprovedDancers");
      const disapprovedList = document.getElementById("adminDisapprovedDancers");
      if (approvedCount) approvedCount.textContent = String(approved.length);
      if (disapprovedCount) disapprovedCount.textContent = String(disapproved.length);
      if (approvedList) {
        approvedList.innerHTML = visibleApproved.length
          ? visibleApproved.map(({ city, profile }) => adminDirectoryDancerRow(city, profile, "Approved")).join("")
          : `<div class="locked">${adminApprovedDancerSearch ? "No approved dancers match that search." : "No approved dancers yet."}</div>`;
      }
      if (disapprovedList) {
        disapprovedList.innerHTML = visibleDisapproved.length
          ? visibleDisapproved.map(({ city, profile }) => adminDirectoryDancerRow(city, profile, "Disapproved")).join("")
          : `<div class="locked">${adminDisapprovedDancerSearch ? "No disapproved dancers match that search." : "No disapproved dancers yet."}</div>`;
      }
    }

    function adminSubmittedSocialsMarkup(profile) {
      const socials = normalizeSubmittedSocials(profile).filter((social) =>
        !isFinalAdminReviewStatus(normalizedReviewStatus(social.reviewStatus))
      );
      if (!socials.length) return '<div class="locked">No newly submitted social links waiting for review.</div>';
      return `<div class="admin-social-icons">${socials.map((social, index) => {
        const url = safeExternalHref(social.url);
        const handle = social.handle ? `@${social.handle.replace(/^@/, "")}` : social.url;
        const label = `${social.label}${handle ? ` ${handle}` : ""}`;
        const hrefAttr = url ? ` href="${displayText(url)}"` : "";
        const targetId = social.id || `${profile.id || profile.name}-social-${index}`;
        const key = `social_link:${targetId}`;
        return `
          <div class="admin-social-review">
            <a class="admin-social-icon social-${displayText(social.platform)}"${hrefAttr} data-admin-preview-kind="link" data-admin-preview-title="${displayText(label)}" data-admin-preview-url="${displayText(url)}" aria-label="${displayText(label)}" title="${displayText(label)}">${socialIconMarkup(social.platform)}<span>${displayText(social.label)}</span></a>
            <span class="admin-review-hint">${displayText(social.label)} · ${displayText(social.reviewStatus || "pending")}</span>
            ${social.reviewNotes ? `<span class="admin-review-hint">Reason: ${displayText(social.reviewNotes)}</span>` : ""}
            <textarea data-review-reason="${displayText(key)}" placeholder="Reason for disapproval"></textarea>
            <div class="admin-review-actions">
              <button class="action-btn" data-admin-content-review="approved" data-review-type="social_link" data-review-target="${displayText(targetId)}" data-review-label="${displayText(social.label)}" data-review-key="${displayText(key)}" data-review-live-target="${social.hasLiveId ? "true" : "false"}" ${social.hasLiveId ? "" : "disabled"}>Approve social</button>
              <button class="action-btn secondary" data-admin-content-review="rejected" data-review-type="social_link" data-review-target="${displayText(targetId)}" data-review-label="${displayText(social.label)}" data-review-key="${displayText(key)}" data-review-live-target="${social.hasLiveId ? "true" : "false"}">Save disapproval</button>
            </div>
          </div>
        `;
      }).join("")}</div>`;
    }

    function adminSubmittedPhotosMarkup(profile) {
      const photos = profile.submittedPhotos?.length
        ? profile.submittedPhotos
        : (profile.galleryPhotoUrls || []).map((imageUrl, index) => ({ imageUrl, sortOrder: index }));
      const reviewablePhotos = photos.filter((photo) =>
        !isFinalAdminReviewStatus(normalizedReviewStatus(photo.reviewStatus || photo.review_status))
      );
      if (!reviewablePhotos.length) return '<div class="locked">No newly submitted photos waiting for review.</div>';
      return relabelVisualPhotoItems(reviewablePhotos.slice(0, MAX_DANCER_PROFILE_PHOTOS)).map((photo, index) => {
        const imageUrl = photo.imageUrl || photo.image_url || "";
        const targetId = photo.id || `${profile.id || profile.name}-photo-${index}`;
        const key = `photo:${targetId}`;
        const label = photo.label || photoDisplayLabel(index);
        return `
          <div class="admin-submission-review">
            <a class="upload-slot submitted-photo-slot" href="${displayText(imageUrl || "#")}" data-admin-preview-kind="image" data-admin-preview-title="Submitted dancer ${displayText(label)}" data-admin-preview-url="${displayText(imageUrl)}">
              ${imageUrl ? `<img src="${displayText(imageUrl)}" alt="Submitted dancer ${displayText(label)}">` : displayText(label)}
              <span>${displayText(photo.reviewStatus || photo.review_status || "pending")}</span>
              <span>Submitted by ${displayText(profile.name || "dancer")}</span>
              ${photo.reviewNotes || photo.review_notes ? `<span>Reason: ${displayText(photo.reviewNotes || photo.review_notes)}</span>` : ""}
            </a>
            <textarea data-review-reason="${displayText(key)}" placeholder="Reason for disapproval"></textarea>
            <span class="admin-review-hint">Type the reason, then press Save disapproval.</span>
            <div class="admin-review-actions">
              <button class="action-btn" data-admin-content-review="approved" data-review-type="photo" data-review-target="${displayText(targetId)}" data-review-label="${displayText(label)}" data-review-key="${displayText(key)}" data-review-live-target="${photo.id ? "true" : "false"}" ${photo.id ? "" : "disabled"}>Approve picture</button>
              <button class="action-btn secondary" data-admin-content-review="rejected" data-review-type="photo" data-review-target="${displayText(targetId)}" data-review-label="${displayText(label)}" data-review-key="${displayText(key)}" data-review-live-target="${photo.id ? "true" : "false"}">Save disapproval</button>
            </div>
          </div>
        `;
      }).join("");
    }

    function adminReviewHistoryMarkup(profile) {
      const reviews = Array.isArray(profile.reviews) ? profile.reviews : [];
      if (!reviews.length) return '<div class="locked">No prior review history.</div>';
      return reviews.map((review) => `
        <div class="lock-row">
          <strong>${displayText(review.reviewType || review.review_type || "Review")}: ${displayText(review.status || "pending")}</strong>
          <span>${displayText(review.notes || "No notes")}${review.reviewedAt || review.reviewed_at ? ` · ${displayText(formatBillingDate(review.reviewedAt || review.reviewed_at))}` : ""}</span>
        </div>
      `).join("");
    }

    function adminFullProfileValue(label, value) {
      return `
        <div class="admin-full-value">
          <span>${displayText(label)}</span>
          <strong>${displayText(value || "Not submitted")}</strong>
        </div>
      `;
    }

    function adminFullProfileMarkup(profile) {
      const account = profile.account && typeof profile.account === "object" ? profile.account : {};
      const subscription = profile.subscription && typeof profile.subscription === "object" ? profile.subscription : {};
      const photos = Array.isArray(profile.photos) ? profile.photos : [];
      const socials = Array.isArray(profile.socialLinks) ? profile.socialLinks : [];
      const reviews = Array.isArray(profile.reviews) ? profile.reviews : [];
      const publicLabel = profile.isPublic === false || profile.is_public === false ? "Hidden" : "Visible";
      const photoMarkup = photos.length ? photos.map((photo, index) => {
        const imageUrl = photo.imageUrl || photo.image_url || "";
        const label = photo.isPrimary || photo.is_primary ? "Main Photo" : `Photo ${index + 1}`;
        const photoId = photo.id || "";
        return `
          <div class="admin-full-photo admin-full-managed">
            <a class="admin-full-photo-link" href="${displayText(imageUrl || "#")}" target="_blank" rel="noreferrer">
              ${imageUrl ? `<img src="${displayText(imageUrl)}" alt="${displayText(label)}">` : "<span>No image available</span>"}
              <strong>${displayText(label)}</strong>
              <span>${displayText(photo.reviewStatus || photo.review_status || "pending")}</span>
            </a>
            <button class="action-btn danger" type="button" data-admin-delete-photo="${displayText(photoId)}" data-admin-content-label="${displayText(label)}" ${photoId ? "" : "disabled"}>Delete picture</button>
          </div>
        `;
      }).join("") : '<div class="locked">No profile photos.</div>';
      const socialMarkup = socials.length ? socials.map((social) => `
        <div class="admin-full-row admin-full-managed">
          <a class="admin-full-row-link" href="${displayText(safeExternalHref(social.url) || "#")}" target="_blank" rel="noreferrer">
            <strong>${displayText(social.platform || "Social link")}</strong>
            <span>${displayText(social.handle || social.url || "No handle")}</span>
            <span>${displayText(social.reviewStatus || social.review_status || "pending")}</span>
          </a>
          <button class="action-btn danger" type="button" data-admin-delete-social="${displayText(social.id || "")}" data-admin-content-label="${displayText(social.platform || "Social link")} social link" ${social.id ? "" : "disabled"}>Delete social link</button>
        </div>
      `).join("") : '<div class="locked">No social links.</div>';
      const reviewMarkup = reviews.length ? reviews.map((review) => `
        <div class="admin-full-row">
          <strong>${displayText(review.reviewType || review.review_type || "Review")} · ${displayText(review.status || "pending")}</strong>
          <span>${displayText(review.notes || "No notes")}</span>
          <span>${displayText(formatBillingDate(review.reviewedAt || review.reviewed_at || review.createdAt || review.created_at) || "Not reviewed")}</span>
        </div>
      `).join("") : '<div class="locked">No review history.</div>';

      return `
        <div class="admin-full-profile" data-admin-full-profile="${displayText(profile.id || "")}" data-admin-full-profile-name="${displayText(profile.stageName || profile.stage_name || "Dancer")}">
          <section class="admin-full-section">
            <strong>Profile information</strong>
            <div class="admin-full-grid">
              ${adminFullProfileValue("Stage name", profile.stageName || profile.stage_name)}
              ${adminFullProfileValue("City", profile.city)}
              ${adminFullProfileValue("Slug", profile.slug)}
              ${adminFullProfileValue("Profile ID", profile.id)}
              ${adminFullProfileValue("User ID", profile.userId || profile.user_id)}
              ${adminFullProfileValue("Profile status", profile.status)}
              ${adminFullProfileValue("Public visibility", publicLabel)}
              ${adminFullProfileValue("Account approval", "Automatic")}
              ${adminFullProfileValue("Photo review", profile.photoReviewStatus || profile.photo_review_status)}
              ${adminFullProfileValue("Created", formatBillingDate(profile.createdAt || profile.created_at))}
              ${adminFullProfileValue("Updated", formatBillingDate(profile.updatedAt || profile.updated_at))}
              ${adminFullProfileValue("Approved", formatBillingDate(profile.approvedAt || profile.approved_at))}
              ${adminFullProfileValue("Disabled", formatBillingDate(profile.disabledAt || profile.disabled_at))}
            </div>
          </section>
          <section class="admin-full-section">
            <strong>Login account</strong>
            <div class="admin-full-grid">
              ${adminFullProfileValue("Email", account.email)}
              ${adminFullProfileValue("Display name", account.displayName || account.display_name)}
              ${adminFullProfileValue("Account state", account.accountState || account.account_state)}
              ${adminFullProfileValue("Account created", formatBillingDate(account.createdAt || account.created_at))}
            </div>
          </section>
          <section class="admin-full-section">
            <strong>Photos (${photos.length})</strong>
            <div class="admin-full-photos">${photoMarkup}</div>
          </section>
          <section class="admin-full-section">
            <strong>Social links (${socials.length})</strong>
            <div class="admin-full-list">${socialMarkup}</div>
          </section>
          <section class="admin-full-section">
            <strong>Subscription</strong>
            <div class="admin-full-grid">
              ${adminFullProfileValue("Status", subscription.status || "No subscription record")}
              ${adminFullProfileValue("Period end", formatBillingDate(subscription.currentPeriodEnd || subscription.current_period_end))}
              ${adminFullProfileValue("Stripe customer", subscription.stripeCustomerId || subscription.stripe_customer_id)}
              ${adminFullProfileValue("Stripe subscription", subscription.stripeSubscriptionId || subscription.stripe_subscription_id)}
            </div>
          </section>
          <section class="admin-full-section">
            <strong>Review history (${reviews.length})</strong>
            <div class="admin-full-list">${reviewMarkup}</div>
          </section>
          <section class="admin-full-section admin-full-delete">
            <strong>Delete dancer profile</strong>
            <span class="meta">This removes the profile and stored content. The dancer login account remains.</span>
            <button class="action-btn danger" type="button" data-admin-delete-profile="${displayText(profile.id || "")}" data-admin-delete-name="${displayText(profile.stageName || profile.stage_name || "Dancer")}">Delete profile</button>
          </section>
        </div>
      `;
    }

    function adminReportedProfileContextMarkup(report) {
      if (!report) return "";
      return `
        <section class="admin-report-context">
          <small>Reported target</small>
          <strong>${displayText(report.targetLabel || report.targetType || "Reported profile")}</strong>
          <dl>
            <div><dt>Why it was reported</dt><dd>${displayText(report.reason || "Reason pending")}</dd></div>
            <div><dt>Reporter details</dt><dd>${displayText(report.details || "No additional details were supplied.")}</dd></div>
            <div><dt>Reported</dt><dd>${displayText(formatBillingDate(report.createdAt))}</dd></div>
            <div><dt>Target record</dt><dd>${displayText(`${report.targetType || "profile"} · ${report.targetId || "No record ID"}`)}</dd></div>
          </dl>
        </section>
      `;
    }

    async function openAdminFullProfile(profile, button, reportContext = null) {
      if (!profile?.id || !isAdminSession()) {
        showToast("Admin login required");
        return;
      }
      const originalText = button?.textContent || "View full profile";
      if (button) {
        button.disabled = true;
        button.textContent = "Loading profile...";
      }
      adminPreviewTitle.textContent = "Loading full profile...";
      adminPreviewBody.innerHTML = '<div class="locked">Loading live dancer profile...</div>';
      adminPreviewPopover.hidden = false;
      try {
        const data = await getAuthenticatedJson(`/api/admin/dancers/${encodeURIComponent(profile.id)}`);
        const detail = data.profile;
        adminPreviewTitle.textContent = `${detail.stageName || profile.name || "Dancer"} · full profile`;
        adminPreviewBody.innerHTML = `${adminReportedProfileContextMarkup(reportContext)}${adminFullProfileMarkup(detail)}`;
      } catch (error) {
        closeAdminPreview();
        showToast(error.message || "Could not load dancer profile");
      } finally {
        if (button) {
          button.disabled = false;
          button.textContent = originalText;
        }
      }
    }

    async function deleteLiveAdminDancerProfile(profile, button) {
      if (!profile?.id || !isAdminSession()) {
        showToast("Admin login required");
        return;
      }
      const stageName = profile.stageName || profile.stage_name || profile.name || "this dancer";
      const confirmed = confirm(`Permanently delete ${stageName}'s dancer profile and all profile photos, schedules, and profile activity? Their login account will remain. This cannot be undone.`);
      if (!confirmed) return;

      const originalText = button?.textContent || "Delete profile";
      if (button) {
        button.disabled = true;
        button.textContent = "Deleting profile...";
      }
      try {
        const data = await deleteAuthenticatedJson(`/api/admin/dancers/${encodeURIComponent(profile.id)}`);
        Object.values(markets).forEach((market) => {
          market.dancers = market.dancers.filter((item) => item.id !== profile.id);
        });
        closeAdminPreview();
        render();
        renderAdminDashboard();
        liveMarketState[selectedCity()] = null;
        await loadLiveDiscovery(selectedCity(), { force: true });
        const warningCount = Array.isArray(data.deleted?.warnings) ? data.deleted.warnings.length : 0;
        showToast(warningCount
          ? `Profile deleted; ${warningCount} cleanup warning${warningCount === 1 ? "" : "s"} logged`
          : "Profile and stored content deleted");
      } catch (error) {
        showToast(error.message || "Could not delete dancer profile");
        if (button) {
          button.disabled = false;
          button.textContent = originalText;
        }
      }
    }

    async function deleteLiveAdminDancerContent(profile, contentType, targetId, label, button) {
      if (!profile?.id || !targetId || !isAdminSession()) {
        showToast("Admin login required");
        return;
      }
      const stageName = profile.stageName || profile.stage_name || profile.name || "this dancer";
      const confirmed = confirm(`Permanently delete ${label} from ${stageName}'s profile? This cannot be undone.`);
      if (!confirmed) return;

      const originalText = button?.textContent || "Delete";
      if (button) {
        button.disabled = true;
        button.textContent = contentType === "photo" ? "Deleting picture..." : "Deleting social...";
      }
      try {
        const resource = contentType === "photo" ? "photos" : "social-links";
        const data = await deleteAuthenticatedJson(
          `/api/admin/dancers/${encodeURIComponent(profile.id)}/${resource}/${encodeURIComponent(targetId)}`
        );
        if (!data?.profile) throw new Error("The content was deleted, but the profile could not be refreshed.");
        adminPreviewTitle.textContent = `${data.profile.stageName || stageName} · full profile`;
        adminPreviewBody.innerHTML = adminFullProfileMarkup(data.profile);
        await loadLiveAdminApprovals();
        const warningCount = Array.isArray(data.deleted?.warnings) ? data.deleted.warnings.length : 0;
        showToast(warningCount
          ? `${label} deleted with ${warningCount} cleanup warning${warningCount === 1 ? "" : "s"} logged`
          : `${label} deleted`);
      } catch (error) {
        showToast(error.message || `Could not delete ${label}`);
        if (button) {
          button.disabled = false;
          button.textContent = originalText;
        }
      }
    }

    function isFinalAdminReviewStatus(status) {
      return status === "approved" || status === "rejected";
    }

    function hasPendingAdminSubmittedContent(profile) {
      const hasPendingSocial = normalizeSubmittedSocials(profile).some((social) =>
        !isFinalAdminReviewStatus(normalizedReviewStatus(social.reviewStatus))
      );
      const hasPendingPhoto = (profile.submittedPhotos || []).some((photo) =>
        !isFinalAdminReviewStatus(normalizedReviewStatus(photo.reviewStatus || photo.review_status))
      );
      return hasPendingSocial || hasPendingPhoto;
    }

    function pendingAdminSubmissionItems(profile) {
      const pending = [];
      if ((profile.submittedPhotos || []).some((photo) => !isFinalAdminReviewStatus(normalizedReviewStatus(photo.reviewStatus || photo.review_status)))) {
        pending.push("photos");
      }
      if (normalizeSubmittedSocials(profile).some((social) => !isFinalAdminReviewStatus(normalizedReviewStatus(social.reviewStatus)))) {
        pending.push("social links");
      }
      return pending;
    }

    function adminApprovalCardKey(city, profile) {
      return `${city || ""}::${profile?.id || profile?.slug || profile?.name || ""}`;
    }

    function loadClosedAdminApprovalCards() {
      try {
        const storedKeys = JSON.parse(sessionStorage.getItem(ADMIN_CLOSED_DANCER_APPROVAL_CARDS_KEY) || "[]");
        return new Set(Array.isArray(storedKeys) ? storedKeys.filter((key) => typeof key === "string" && key) : []);
      } catch {
        return new Set();
      }
    }

    function persistClosedAdminApprovalCards() {
      try {
        sessionStorage.setItem(
          ADMIN_CLOSED_DANCER_APPROVAL_CARDS_KEY,
          JSON.stringify([...adminClosedDancerApprovalCards])
        );
      } catch {}
    }
