
    modalVideoSound?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const video = activeModalVideo();
      if (!video) return;
      video.muted = !video.muted;
      syncModalVideoControls();
      setModalVideoControlsVisible(true, { autoHide: true });
    });
    modalVideoProgress?.addEventListener("input", (event) => {
      event.stopPropagation();
      const video = activeModalVideo();
      const requestedTime = Number(event.currentTarget.value);
      if (!video || !Number.isFinite(requestedTime)) return;
      const duration = Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : Number(event.currentTarget.max) || 0;
      video.currentTime = Math.min(Math.max(0, requestedTime), Math.max(0, duration));
      syncModalVideoControls();
      setModalVideoControlsVisible(true, { autoHide: true });
    });
    modalVideoControls?.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      setModalVideoControlsVisible(true);
    });
    modalVideoControls?.addEventListener("pointerup", () => {
      setModalVideoControlsVisible(true, { autoHide: true });
    });

    bindHorizontalProfilePhotoSwipe(modalImage);
    profilePhotoViewerImage?.addEventListener("scroll", () => {
      window.cancelAnimationFrame(profilePhotoViewerScrollFrame);
      profilePhotoViewerScrollFrame = window.requestAnimationFrame(() => {
        profilePhotoViewerScrollFrame = 0;
        if (profilePhotoViewer.hidden || profilePhotoViewerImage.clientHeight <= 0) return;
        const activePhotoIndex = profilePhotoCardScrollIndex(
          profilePhotoViewerImage.scrollTop,
          [...profilePhotoViewerImage.querySelectorAll("[data-profile-photo-viewer-index]")].map((slide) => slide.offsetTop),
          profilePhotoViewerImage.clientHeight,
          profilePhotoViewerImage.scrollHeight
        );
        syncProfilePhotoViewerPosition(activePhotoIndex);
      });
    }, { passive: true });

    function openSelectedModalMediaViewer() {
      if (modalImage.dataset.activeMediaType !== "video") return false;
      const videos = Array.isArray(modalGallery.profileTvVideos) ? modalGallery.profileTvVideos : [];
      const videoIndex = Number(modalImage.dataset.activeVideoIndex);
      const item = videos[videoIndex];
      if (!item) return false;
      openProfileTvViewer(item, modalGallery.profileTvProfileName || "Dancer", videos, videoIndex);
      return true;
    }

    modalMediaPrevious?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      moveModalPhoto(-1);
    });
    modalMediaNext?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      moveModalPhoto(1);
    });
    modalMediaExpand?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openSelectedModalMediaViewer();
    });
    modalImage?.addEventListener("click", (event) => {
      if (event.target.closest("button, input, [data-modal-video-controls]")) return;
      if (modalImage.dataset.activeMediaType === "video") {
        toggleModalVideoPlayback();
        return;
      }
    });

    modalImage?.addEventListener("pointermove", (event) => {
      if (event.pointerType === "touch" || modalImage.dataset.activeMediaType !== "video") return;
      setModalVideoControlsVisible(true, { autoHide: true });
    });

    modalImage?.addEventListener("keydown", (event) => {
      if (event.target !== modalImage) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        moveModalPhoto(event.key === "ArrowRight" ? 1 : -1);
      } else if ((event.key === "Enter" || event.key === " ") && modalImage.dataset.activeMediaType === "video") {
        event.preventDefault();
        toggleModalVideoPlayback();
      }
    });
    profilePhotoViewerImage?.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      moveModalPhoto(event.key === "ArrowDown" ? 1 : -1, { syncViewer: true });
    });
    profilePhotoViewerPrevious?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      moveModalPhoto(-1, { syncViewer: true });
    });
    profilePhotoViewerNext?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      moveModalPhoto(1, { syncViewer: true });
    });

    function confirmedFollowerCount(data, errorMessage) {
      const count = Number(data?.followerCount);
      if (!Number.isSafeInteger(count) || count < 0) throw new Error(errorMessage);
      return count;
    }

    function confirmedNotificationCount(data, errorMessage) {
      const count = Number(data?.notificationCount);
      if (!Number.isSafeInteger(count) || count < 0) throw new Error(errorMessage);
      return count;
    }

    function profileFollowSnapshot(profile, city) {
      return {
        following: isFollowingProfile(city, profile.name),
        notificationsEnabled: isNotificationOn(city, profile.name),
        followerCount: followerNumber(profile, city),
        notificationCount: notificationNumber(profile, city)
      };
    }

    function syncHomeFeedActionButtons(profile, city) {
      document.querySelectorAll(".feed-card-action[data-profile]").forEach((button) => {
        if (button.dataset.profile !== profile.name && button.dataset.profile !== profile.id) return;
        const action = button.dataset.feedAction;
        if (action === "follow") {
          const active = isFollowingProfile(city, profile.name);
          button.classList.toggle("is-active", active);
          button.setAttribute("aria-pressed", String(active));
          if (button.dataset.iconOnlyAction === "true") {
            const label = active ? `Following ${profile.name}` : `Follow ${profile.name}`;
            button.innerHTML = actionIconMarkup(active ? "check" : "personPlus");
            button.setAttribute("aria-label", label);
            button.title = label;
          } else {
            button.innerHTML = actionButtonLabel(active ? "check" : "personPlus", active ? "Following" : "Follow");
          }
          return;
        }
        if (action === "notify") {
          const active = isNotificationOn(city, profile.name);
          button.classList.toggle("is-active", active);
          button.setAttribute("aria-pressed", String(active));
          button.innerHTML = actionButtonLabel(active ? "check" : "bell", active ? "Notifications On" : "Notify");
          return;
        }
        if (action === "going") {
          const active = !!goingTonightSavedByProfile[profile.name];
          button.classList.toggle("is-active", active);
          button.setAttribute("aria-pressed", String(active));
          button.innerHTML = homeFeedGoingActionMarkup(profile, active);
        }
      });
    }

    function syncOpenProfileFollowButton() {
      const followButton = document.getElementById("followBtn");
      if (!followButton) return;
      const following = isFollowingProfile(selectedCity(), followButton.dataset.profile);
      followButton.innerHTML = profileActionButtonMarkup(following ? "check" : "personPlus", following ? "Following" : "Follow");
      followButton.classList.toggle("is-following", following);
      followButton.setAttribute("aria-pressed", String(following));
    }

    function applyProfileFollowState(profile, city, state) {
      const following = state?.following === true;
      const notificationsEnabled = following && state?.notificationsEnabled === true;
      profile.followerCount = Math.max(0, Number(state?.followerCount) || 0);
      profile.notificationCount = Math.max(0, Number(state?.notificationCount) || 0);
      setProfileFollowed(city, profile.name, following);
      if (notificationsEnabled) enableProfileNotifications(city, profile.name);
      else disableProfileNotifications(city, profile.name);

      syncOpenProfileFollowButton();

      const followerCountEl = document.getElementById("modalFollowerCount");
      const followerCount = followerNumber(profile, city);
      if (followerCountEl) followerCountEl.textContent = followerCount.toLocaleString();
      const followerLabelEl = document.getElementById("modalFollowerLabel");
      const followerLabel = followerCount === 1 ? "Follower" : "Followers";
      if (followerLabelEl) followerLabelEl.textContent = followerLabel;
      modalName.closest(".profile-modal-name-row")?.setAttribute("data-follower-label", followerLabel);
      syncHomeFeedActionButtons(profile, city);
      return { following, notificationsEnabled };
    }

    function applyConfirmedProfileFollow(profile, city, data) {
      return applyProfileFollowState(profile, city, {
        following: data?.following === true,
        notificationsEnabled: data?.notificationsEnabled === true,
        followerCount: confirmedFollowerCount(
          data,
          "The preference was saved, but the follower count could not be confirmed."
        ),
        notificationCount: confirmedNotificationCount(
          data,
          "The preference was saved, but the notification count could not be confirmed."
        )
      });
    }

    async function saveProfileFollow(actionButton) {
      if (actionButton.disabled) return;
      const profileName = actionButton.dataset.profile;
      let city = citySelect.value;
      const profile = findProfile(profileName);
      if (!profile?.id) {
        showToast("This dancer profile is not available to follow.");
        return;
      }

      city = profile.city || city;
      const snapshot = profileFollowSnapshot(profile, city);
      const requestedFollowing = !snapshot.following;
      actionButton.disabled = true;
      actionButton.setAttribute("aria-busy", "true");
      customerSavedStateVersion += 1;
      // Saved follows may still be loading, so this may already be followed.
      // Only the successful write can confirm a change to the public count.
      try {
        const data = await postAuthenticatedJson("/api/customer/follows", {
          dancerId: profile.id,
          following: requestedFollowing,
          notificationsEnabled: requestedFollowing
        });
        if (!data) throw new Error("Sign in required.");
        const { following } = applyConfirmedProfileFollow(profile, city, data);
        if (following && actionButton.dataset.homeTvVideoId) {
          trackHomeTvFeedEvent(actionButton.dataset.homeTvVideoId, "follow");
        }
        recordLiveEvent("profile_action", {
          dancerName: profile.name,
          city,
          source: following ? "follow_added" : "follow_removed"
        });
        showToast(following ? "Following profile. Notifications on." : "Unfollowed profile");
        if (customerDashboard.classList.contains("show")) renderDashboard();
      } catch (error) {
        showToast(error.message || "Could not save follow");
      } finally {
        customerSavedStateVersion += 1;
        actionButton.disabled = false;
        actionButton.removeAttribute("aria-busy");
        syncOpenProfileFollowButton();
        syncHomeFeedActionButtons(profile, city);
      }
    }

    async function saveProfileNotifications(actionButton) {
      if (actionButton.disabled) return;
      const city = citySelect.value;
      const profileName = actionButton.dataset.profile;
      const profile = findProfile(profileName);
      if (!profile?.id) {
        showToast("This dancer profile is not available for notifications.");
        return;
      }

      const followButton = document.getElementById("followBtn");
      const snapshot = profileFollowSnapshot(profile, city);
      const requestedNotifications = !snapshot.notificationsEnabled;
      actionButton.disabled = true;
      actionButton.setAttribute("aria-busy", "true");
      if (followButton) followButton.disabled = true;
      customerSavedStateVersion += 1;
      try {
        const data = await postAuthenticatedJson("/api/customer/follows", {
          dancerId: profile.id,
          following: true,
          notificationsEnabled: requestedNotifications
        });
        if (!data) throw new Error("Sign in required.");
        const { notificationsEnabled } = applyConfirmedProfileFollow(profile, city, data);
        recordLiveEvent("profile_action", {
          dancerName: profileName,
          source: notificationsEnabled ? "notify_added" : "notify_removed"
        });
        showToast(notificationsEnabled ? "Notifications on" : "Notifications off");
        if (customerDashboard.classList.contains("show")) renderDashboard();
      } catch (error) {
        showToast(error.message || "Could not save notifications");
      } finally {
        customerSavedStateVersion += 1;
        actionButton.disabled = false;
        actionButton.removeAttribute("aria-busy");
        if (followButton) followButton.disabled = false;
        syncOpenProfileFollowButton();
        syncHomeFeedActionButtons(profile, city);
      }
    }

    async function saveProfileGoing(actionButton) {
      if (actionButton.disabled) return;
      const profileName = actionButton.dataset.profile;
      const profile = findProfile(profileName);
      if (!profile?.shiftId) {
        showToast("This dancer has no posted shift yet.");
        return;
      }
      const countEl = document.getElementById("tonightInterestCount");
      const wasGoing = goingTonightSavedByProfile[profileName] === true;
      const previousCount = tonightInterestCount(profile);
      const requestedGoing = !wasGoing;
      const optimisticCount = Math.max(0, previousCount + (requestedGoing ? 1 : -1));
      const idleLabel = "I'm Going";
      const activeLabel = "Going";
      actionButton.disabled = true;
      goingTonightByProfile[profileName] = optimisticCount;
      profile.goingCount = optimisticCount;
      goingTonightSavedByProfile[profileName] = requestedGoing;
      if (countEl) {
        countEl.classList.remove("muted");
        countEl.textContent = optimisticCount.toLocaleString();
      }
      actionButton.classList.toggle("is-going", requestedGoing);
      actionButton.setAttribute("aria-label", requestedGoing ? "Remove this shift from your plans" : "Add this shift to your plans");
      actionButton.setAttribute("aria-pressed", String(requestedGoing));
      actionButton.innerHTML = profileActionButtonMarkup(
        requestedGoing ? "check" : "clock",
        requestedGoing ? activeLabel : idleLabel
      );
      syncHomeFeedActionButtons(profile, citySelect.value);
      try {
        const data = await postOptionalAuthJson("/api/customer/going", {
          shiftId: profile.shiftId,
          going: requestedGoing
        });
        const savedGoing = data.going === true;
        const realCount = Number(data.goingCount);
        if (!Number.isSafeInteger(realCount) || realCount < 0) {
          throw new Error("The status was saved, but the going count could not be confirmed.");
        }
        goingTonightByProfile[profileName] = realCount;
        profile.goingCount = realCount;
        goingTonightSavedByProfile[profileName] = savedGoing;
        if (countEl) {
          countEl.classList.remove("muted");
          countEl.textContent = realCount.toLocaleString();
        }
        actionButton.classList.toggle("is-going", savedGoing);
        actionButton.setAttribute("aria-label", savedGoing ? "Remove this shift from your plans" : "Add this shift to your plans");
        actionButton.setAttribute("aria-pressed", String(savedGoing));
        actionButton.innerHTML = profileActionButtonMarkup(savedGoing ? "check" : "clock", savedGoing ? activeLabel : idleLabel);
        syncHomeFeedActionButtons(profile, citySelect.value);
        recordLiveEvent("schedule_action", { dancerName: profileName, source: savedGoing ? "going_tonight_added" : "going_removed" });
        showToast(savedGoing ? "Added to now" : "Removed");
      } catch (error) {
        goingTonightByProfile[profileName] = previousCount;
        profile.goingCount = previousCount;
        goingTonightSavedByProfile[profileName] = wasGoing;
        if (countEl) {
          countEl.classList.remove("muted");
          countEl.textContent = previousCount.toLocaleString();
        }
        actionButton.classList.toggle("is-going", wasGoing);
        actionButton.setAttribute("aria-label", wasGoing ? "Remove this shift from your plans" : "Add this shift to your plans");
        actionButton.setAttribute("aria-pressed", String(wasGoing));
        actionButton.innerHTML = profileActionButtonMarkup(wasGoing ? "check" : "clock", wasGoing ? activeLabel : idleLabel);
        syncHomeFeedActionButtons(profile, citySelect.value);
        showToast(error.message || "Could not save going status");
      } finally {
        actionButton.disabled = false;
      }
    }

    profileModal.addEventListener("click", async (event) => {
      if (handleQrClick(event)) return;
      if (handleShareClick(event)) return;
      if (!event.target.closest("[data-qr-popover]")) closeQrPopovers();
      if (!event.target.closest("[data-share-popover]")) closeSharePopovers();
      const socialLink = event.target.closest(".social-link[data-profile]");
      if (socialLink) {
        recordUniqueTrendEvent("socialClicks", citySelect.value, socialLink.dataset.profile);
        if (socialLink.dataset.social) {
          recordLiveEvent("social_click", { dancerName: socialLink.dataset.profile, platform: socialLink.dataset.social, source: "profile_modal" });
        }
        return;
      }
      const venueLink = event.target.closest("[data-open-venue]");
      if (venueLink) {
        closeProfileModal();
        openVenueFromName(venueLink.dataset.openVenue, { showFocusRing: event.detail === 0 });
        return;
      }
      const actionButton = event.target.closest("#followBtn, #goingBtn, #reportBtn");
      if (!actionButton) return;
      if (
        actionButton.id === "followBtn" &&
        !requireCustomerAccountForProfileAction(actionButton)
      ) return;
      if (actionButton.id === "followBtn") {
        await saveProfileFollow(actionButton);
        return;
      }
      if (actionButton.id === "goingBtn") {
        await saveProfileGoing(actionButton);
        return;
      }
      if (actionButton.id === "reportBtn") {
        if (actionButton.disabled) return;
        const profileName = actionButton.dataset.profile;
        openContentReportDialog({
          button: actionButton,
          targetType: actionButton.dataset.reportTargetType,
          targetId: actionButton.dataset.reportTargetId,
          targetLabel: profileName,
          title: "Report profile",
          quickReasons: true
        });
      }
    });

    const modalCloseButton = document.getElementById("modalClose");
    modalCloseButton.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    }, { passive: true });
    modalCloseButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeProfileModal();
    });
    profilePhotoViewerClose?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeProfilePhotoViewer();
    });
    profilePhotoViewerClose?.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    }, { passive: false });
    profilePhotoViewerShare?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void shareProfilePhoto();
    });
    profilePhotoViewerShare?.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    }, { passive: true });
    profilePhotoViewerReport?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openContentReportDialog({
        button: profilePhotoViewerReport,
        status: profilePhotoViewerStatus,
        targetType: profilePhotoViewerReport.dataset.reportTargetType,
        targetId: profilePhotoViewerReport.dataset.reportTargetId,
        targetLabel: profilePhotoViewerReport.dataset.reportTargetLabel,
        title: "Report photo",
        quickReasons: true
      });
    });
    profilePhotoViewerReport?.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    }, { passive: true });
    profilePhotoViewerLike?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const mediaId = profilePhotoViewerLike.dataset.mediaLikeId || "";
      if (mediaId) void togglePublicMediaLike("photo", mediaId, profilePhotoViewerStatus);
    });
    profilePhotoViewerLike?.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    }, { passive: true });
    profilePhotoViewer?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.target === profilePhotoViewer) closeProfilePhotoViewer();
    });
    profilePhotoViewer?.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    }, { passive: true });
    profilePhotoViewerImage?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    document.addEventListener("click", (event) => {
      const closeButton = event.target.closest?.("#modalClose");
      if (!closeButton) return;
      event.preventDefault();
      event.stopPropagation();
      closeProfileModal();
    }, { capture: true });

    profileBackdrop.addEventListener("click", (event) => {
      if (event.target.closest?.("#profilePhotoViewer")) return;
      if (!event.target.closest("[data-share-popover], [data-toggle-share]")) closeSharePopovers();
      const venueLink = event.target.closest(".profile-modal-summary [data-open-venue]");
      if (venueLink) {
        closeProfileModal();
        openVenueFromName(venueLink.dataset.openVenue, { showFocusRing: event.detail === 0 });
      }
    });

    adminPreviewClose?.addEventListener("click", closeAdminPreview);
    adminPreviewBody?.addEventListener("click", (event) => {
      const contentButton = event.target.closest("[data-admin-delete-photo], [data-admin-delete-social]");
      if (contentButton) {
        const host = contentButton.closest("[data-admin-full-profile]");
        const contentType = contentButton.hasAttribute("data-admin-delete-photo") ? "photo" : "social-link";
        const targetId = contentType === "photo"
          ? contentButton.dataset.adminDeletePhoto
          : contentButton.dataset.adminDeleteSocial;
        deleteLiveAdminDancerContent({
          id: host?.dataset.adminFullProfile,
          stageName: host?.dataset.adminFullProfileName
        }, contentType, targetId, contentButton.dataset.adminContentLabel || "content", contentButton);
        return;
      }
      const deleteButton = event.target.closest("[data-admin-delete-profile]");
      if (!deleteButton) return;
      deleteLiveAdminDancerProfile({
        id: deleteButton.dataset.adminDeleteProfile,
        stageName: deleteButton.dataset.adminDeleteName
      }, deleteButton);
    });
    adminPreviewPopover?.addEventListener("click", (event) => {
      if (event.target === adminPreviewPopover) closeAdminPreview();
    });
    publicContactClose?.addEventListener("click", closePublicContactForm);
    publicContactPopover?.addEventListener("click", (event) => {
      if (event.target === publicContactPopover) closePublicContactForm();
    });
    publicContactForm?.addEventListener("submit", submitPublicContactForm);
    accountRequiredClose?.addEventListener("click", () => closeAccountRequiredPrompt());
    accountRequiredPopover?.addEventListener("click", (event) => {
      if (event.target === accountRequiredPopover) closeAccountRequiredPrompt();
    });
    accountRequiredCreateLink?.addEventListener("click", (event) => {
      event.preventDefault();
      closeAccountRequiredPrompt({ restoreFocus: false });
      closeProfileModal();
      openFreshCustomerSignup();
    });
    accountRequiredSignInLink?.addEventListener("click", (event) => {
      event.preventDefault();
      closeAccountRequiredPrompt({ restoreFocus: false });
      closeProfileModal();
      openAuthRole("customer");
    });
    contentReportClose?.addEventListener("click", () => closeContentReportDialog());
    contentReportCancel?.addEventListener("click", () => closeContentReportDialog());
    contentReportPopover?.addEventListener("click", (event) => {
      if (event.target === contentReportPopover) closeContentReportDialog();
    });
    contentReportQuickOptions?.addEventListener("click", (event) => {
      const option = event.target.closest("[data-content-report-reason]");
      if (!option || option.disabled) return;
      contentReportReason.value = option.dataset.contentReportReason || "";
      contentReportDetails.value = "";
      contentReportForm?.requestSubmit();
    });
    contentReportForm?.addEventListener("submit", submitContentReportDialog);

    document.querySelectorAll("[data-legal-page]").forEach((button) => {
      button.addEventListener("click", () => {
        closeUtilityMenu();
        openLegalPage(button.dataset.legalPage);
      });
    });

    document.querySelectorAll(".legal-close").forEach((button) => {
      button.addEventListener("click", () => closeLegalPage(button));
    });

    accountBtn.addEventListener("click", () => {
      const loggedIn = isCustomerLoggedIn || isDancerLoggedIn || isVenueLoggedIn;
      if (!loggedIn) {
        closeUtilityMenu();
        openAuthRole("customer");
        return;
      }
      dismissAccountTooltip();
      toggleUtilityMenu();
    });

    accountTooltip.addEventListener("click", (event) => {
      event.stopPropagation();
      dismissAccountTooltip();
    });

    customerNotificationQuickBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      closeUtilityMenu();
      toggleCustomerQuickPanel("notifications");
    });

    dancerProfileShareQuickBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      closeUtilityMenu();
      closeCustomerQuickPanels();
      void openOwnDancerProfileShare(dancerProfileShareQuickBtn);
    });

    customerDealQuickBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      closeUtilityMenu();
      toggleCustomerQuickPanel("deals");
    });

    customerNotificationsQuickList.addEventListener("click", (event) => {
      const item = event.target.closest("[data-quick-notification-id]");
      const indexedItem = item || event.target.closest("[data-notification-index]");
      if (!indexedItem) return;
      closeCustomerQuickPanels();
      const notification = notificationFromNode(indexedItem);
      if (openDancerReviewIssue(notification)) return;
      markLiveNotificationRead(indexedItem.dataset.quickNotificationId);
    });

    customerNotificationsQuickPanel.addEventListener("click", (event) => {
      if (handleNotificationCenterClick(event)) return;
    });

    document.addEventListener("click", (event) => {
      if (!event.target.closest(".utility-menu")) closeUtilityMenu();
      if (!event.target.closest(".customer-quick-actions")) closeCustomerQuickPanels();
    });

    adminBtn.addEventListener("click", () => {
      closeUtilityMenu();
      openAdminDashboard();
    });
    contactAdminBtn?.addEventListener("click", () => {
      closeUtilityMenu();
      openContactAdmin();
    });
    dashboardBtn.addEventListener("click", () => {
      closeUtilityMenu();
      openUnifiedDashboard(activeDashboardType);
    });
    logoutBtn.addEventListener("click", () => {
      closeUtilityMenu();
      logoutAccount();
    });
    deleteAccountBtn.addEventListener("click", async () => {
      const role = deleteAccountBtn.dataset.accountRole;
      closeUtilityMenu();
      if (!authSession?.accessToken || !["customer", "dancer", "venue"].includes(role)) {
        showToast("Sign in required");
        updateAccountHeader();
        return;
      }
      const confirmed = window.confirm(`Permanently delete your ${accountRoleLabel(role).toLowerCase()}? Your account and sign-in will be removed. This cannot be undone.`);
      if (!confirmed) return;
      await deleteLiveAccount(role, deleteAccountBtn);
    });
    document.getElementById("authClose").addEventListener("click", closeAuthPage);
    document.getElementById("dancerSignupClose").addEventListener("click", closeDancerSignupPage);
    document.getElementById("stripeClose").addEventListener("click", closeStripeCheckoutPage);
    document.getElementById("dashboardClose").addEventListener("click", closeDashboard);
    document.getElementById("dancerDashboardClose").addEventListener("click", closeDancerDashboard);
    document.getElementById("venueDashboardClose").addEventListener("click", closeVenueDashboard);
    venueDashboard.addEventListener("click", (event) => {
      const dancerProfileButton = event.target.closest("[data-venue-dashboard-dancer-profile]");
      if (!dancerProfileButton) return;
      event.preventDefault();
      event.stopPropagation();
      const dancerCity = String(dancerProfileButton.dataset.venueDashboardDancerCity || "").trim();
      if (dancerCity && markets[dancerCity]) citySelect.value = dancerCity;
      openProfileModal(dancerProfileButton.dataset.venueDashboardDancerProfile, {
        returnTo: "venue-dashboard"
      });
    });
    document.getElementById("venuePreviewPageBtn").addEventListener("click", () => {
      const profile = liveVenueDashboard?.profile;
      if (!profile?.slug) {
        showToast("Venue page is still loading");
        return;
      }
      const profileCity = String(profile.city || citySelect.value).trim();
      const previewUrl = new URL("/", window.location.origin);
      previewUrl.searchParams.set("city", profileCity || citySelect.value);
      previewUrl.searchParams.set("venue", profile.slug);
      previewUrl.searchParams.set("venue_preview", "1");
      window.location.assign(previewUrl.toString());
    });
    document.getElementById("venueProfileForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const submit = event.submitter || event.currentTarget.querySelector('button[type="submit"]');
      const status = document.getElementById("venueDashboardStatus");
      submit.disabled = true;
      status.textContent = "Saving venue page…";
      try {
        const data = await patchAuthenticatedJson("/api/venue/profile", {
          name: document.getElementById("venueProfileNameInput").value,
          address: document.getElementById("venueProfileAddressInput").value,
          phone: document.getElementById("venueProfilePhoneInput").value,
          website: document.getElementById("venueProfileWebsiteInput").value
        });
        liveVenueDashboard = { ...liveVenueDashboard, profile: data.profile };
        renderVenueDashboard();
        status.textContent = "Venue page saved and published.";
        showToast("Venue page saved");
      } catch (error) {
        status.textContent = error.message || "Unable to save venue page.";
      } finally {
        submit.disabled = false;
      }
    });
    document.getElementById("venueQrForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const submit = event.submitter || event.currentTarget.querySelector('button[type="submit"]');
      const status = document.getElementById("venueDashboardStatus");
      const input = document.getElementById("venueQrFileInput");
      const file = input.files?.[0];
      if (!file) {
        status.textContent = "Choose a QR image first.";
        return;
      }
      const headers = authenticatedRequestHeaders();
      if (!headers) return;
      delete headers["Content-Type"];
      const body = new FormData();
      body.set("file", file);
      body.set("label", document.getElementById("venueQrLabelInput").value);
      submit.disabled = true;
      status.textContent = "Uploading and publishing QR code…";
      try {
        const response = await fetch("/api/venue/qr-code", { method: "POST", headers, body });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.ok === false) throw new Error(data.error || "Unable to upload QR code.");
        liveVenueDashboard = { ...liveVenueDashboard, profile: data.profile };
        input.value = "";
        renderVenueDashboard();
        status.textContent = data.message || "QR code published.";
        showToast("Venue QR code published");
      } catch (error) {
        status.textContent = error.message || "Unable to upload QR code.";
      } finally {
        submit.disabled = false;
      }
    });
    document.getElementById("venueQrRemoveBtn").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const status = document.getElementById("venueDashboardStatus");
      const headers = authenticatedRequestHeaders();
      if (!headers) return;
      button.disabled = true;
      status.textContent = "Removing QR code…";
      try {
        const response = await fetch("/api/venue/qr-code", { method: "DELETE", headers });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.ok === false) throw new Error(data.error || "Unable to remove QR code.");
        liveVenueDashboard = { ...liveVenueDashboard, profile: data.profile };
        renderVenueDashboard();
        status.textContent = data.message || "QR code removed.";
        showToast("Venue QR code removed");
      } catch (error) {
        status.textContent = error.message || "Unable to remove QR code.";
      } finally {
        button.disabled = false;
      }
    });
    function openDancerProfilePreview() {
      const setupStageName = document.getElementById("setupStageName")?.value || "";
      const stageName = getDancerDashboardStageName(setupStageName);
      if (!stageName) {
        showToast("Add a stage name first");
        return;
      }
      document.getElementById("dancerStageName").value = stageName;
      const setupCity = document.getElementById("setupCity")?.value?.trim();
      if (setupCity && markets[setupCity]) {
        document.getElementById("dancerCity").value = setupCity;
      }
      const city = activeDancerCity();
      const profile = ensureActiveDancerProfile(dancerSetup.approval ? "Verified" : "Pending");
      if (!profile) {
        showToast("Create a profile first");
        return;
      }
      citySelect.value = city;
      activeTab = "dancers";
      selectedVenueName = null;
      document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item.dataset.tab === "dancers"));
      render();
      openProfileModal(profile.name, { preview: true, returnTo: "dancer-dashboard" });
    }

    document.getElementById("previewPublicProfile")?.addEventListener("click", () => {
      openDancerProfilePreview();
    });
    document.getElementById("adminClose").addEventListener("click", closeAdminDashboard);
    document.getElementById("adminLogoutBtn").addEventListener("click", logoutAdminAccount);
    document.querySelectorAll("[data-admin-auth-mode]").forEach((button) => {
      button.addEventListener("click", () => setAdminAuthMode(button.dataset.adminAuthMode));
    });
    document.getElementById("adminLoginForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = adminAuthMode === "signup" ? document.getElementById("adminCreateBtn") : document.getElementById("adminLoginBtn");
      const status = document.getElementById("adminLiveStatus");
      button.disabled = true;
      try {
        const result = await requestAuth({
          mode: adminAuthMode,
          role: "admin",
          username: document.getElementById("adminEmail").value,
          password: document.getElementById("adminPassword").value,
          adminCode: document.getElementById("adminCode")?.value || ""
        });
        const name = result.account?.displayName || "platform admin";
        if (status) status.textContent = `Logged in as ${name}.`;
        button.textContent = adminAuthMode === "signup" ? "Admin created" : "Admin session active";
        showToast("Admin session active");
        await loadLiveAdminApprovals();
      } catch (error) {
        if (status) status.textContent = error.message || "Admin login failed";
        showToast(error.message || "Admin login failed");
      } finally {
        button.disabled = false;
        if (adminAuthMode === "signup") button.textContent = "Create admin account";
        else button.textContent = "Sign in";
      }
    });

    adminDashboard.addEventListener("click", (event) => {
      if (handleSupportActionClick(event)) return;
      const adminPreviewLink = event.target.closest("[data-admin-preview-url]");
      if (adminPreviewLink) {
        event.preventDefault();
        openAdminPreview({
          kind: adminPreviewLink.dataset.adminPreviewKind || "file",
          title: adminPreviewLink.dataset.adminPreviewTitle || adminPreviewLink.getAttribute("aria-label") || "Preview",
          url: adminPreviewLink.dataset.adminPreviewUrl || adminPreviewLink.getAttribute("href") || ""
        });
        return;
      }
      const contentReviewButton = event.target.closest("[data-admin-content-review]");
      if (contentReviewButton) {
        event.preventDefault();
        reviewAdminSubmittedContent(contentReviewButton);
        return;
      }
      const imageModerationButton = event.target.closest("[data-admin-image-moderation-action]");
      if (imageModerationButton) {
        event.preventDefault();
        reviewAdminImageModeration(imageModerationButton);
        return;
      }
      const button = event.target.closest("[data-admin-action]");
      if (!button) return;
      const host = button.closest("[data-admin-profile], [data-admin-venue], [data-report]");
      runAdminAction(button.dataset.adminAction, host, button);
    });

    adminDashboard.addEventListener("toggle", (event) => {
      const card = event.target.closest?.("#adminDancers details[data-admin-approval-key]");
      if (!card) return;
      const key = card.dataset.adminApprovalKey;
      if (!key) return;
      if (card.open) adminClosedDancerApprovalCards.delete(key);
      else adminClosedDancerApprovalCards.add(key);
      persistClosedAdminApprovalCards();
    }, true);

    adminDashboard.addEventListener("input", (event) => {
      const approvedSearch = event.target.closest("#adminApprovedDancerSearch");
      if (approvedSearch) {
        adminApprovedDancerSearch = approvedSearch.value;
        renderAdminDancerDirectories();
        return;
      }
      const disapprovedSearch = event.target.closest("#adminDisapprovedDancerSearch");
      if (disapprovedSearch) {
        adminDisapprovedDancerSearch = disapprovedSearch.value;
        renderAdminDancerDirectories();
      }
    });

    document.querySelectorAll("[data-support-form]").forEach((form) => {
      const submitButton = form.querySelector("[data-support-submit]") || form.querySelector('button[type="submit"]');
      const defaultSubmitLabel = submitButton?.textContent?.trim() || "Send to admin";
      form.addEventListener("input", () => {
        if (!submitButton?.classList.contains("is-sent")) return;
        submitButton.classList.remove("is-sent");
        submitButton.textContent = defaultSubmitLabel;
      });
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const role = form.dataset.supportForm;
        const subject = document.getElementById(`${role}SupportSubject`)?.value.trim() || "";
        const message = document.getElementById(`${role}SupportMessage`)?.value.trim() || "";
        if (submitButton) {
          submitButton.disabled = true;
          submitButton.classList.remove("is-sent");
          submitButton.textContent = "Sending...";
        }
        const sent = await sendSupportMessage(role, subject, message);
        if (sent) {
          const subjectInput = document.getElementById(`${role}SupportSubject`);
          const messageInput = document.getElementById(`${role}SupportMessage`);
          if (subjectInput) subjectInput.value = "";
          if (messageInput) messageInput.value = "";
        }
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.classList.toggle("is-sent", sent);
          submitButton.textContent = sent ? "\u2713 Sent to admin" : defaultSubmitLabel;
        }
      });
    });

    document.getElementById("authSignInTab").addEventListener("click", () => setAuthEntryMode("signin"));
    document.getElementById("authCreateTab").addEventListener("click", () => setAuthEntryMode("create"));
    document.getElementById("customerSignupBtn").addEventListener("click", () => {
      openCustomerSignup();
    });

    document.getElementById("customerBackToTypes").addEventListener("click", () => setAuthEntryMode("create"));
    document.getElementById("venueBackToTypes").addEventListener("click", () => setAuthEntryMode("create"));
    document.getElementById("venueSignupBtn").addEventListener("click", openVenueRequest);
    document.getElementById("venueRequestOpenBtn").addEventListener("click", openVenueRequest);
    document.getElementById("venueRequestBackBtn").addEventListener("click", openVenueSignup);
    document.getElementById("venueRequestBackToTypes").addEventListener("click", () => setAuthEntryMode("create"));

    document.getElementById("customerForgotPasswordBtn").addEventListener("click", () => {
      openPasswordRecovery({
        role: authRoleHint,
        emailInputId: "customerEmail",
        buttonId: "customerForgotPasswordBtn"
      });
    });

    document.getElementById("customerForgotLoginBtn").addEventListener("click", () => {
      sendLoginRecoveryHelp({
        role: authRoleHint,
        emailInputId: "customerEmail",
        buttonId: "customerForgotLoginBtn"
      });
    });

    passwordRecoveryForm?.addEventListener("submit", submitPasswordRecoveryForm);
    passwordRecoveryClose?.addEventListener("click", () => closeRecoveryPopover(passwordRecoveryCard));
    passwordRecoveryBack?.addEventListener("click", () => closeRecoveryPopover(passwordRecoveryCard));
    loginRecoveryForm?.addEventListener("submit", submitLoginRecoveryForm);
    loginRecoveryClose?.addEventListener("click", closeLoginRecovery);
    loginRecoveryBack?.addEventListener("click", closeLoginRecovery);
    document.getElementById("loginRecoveryRole")?.addEventListener("change", (event) => {
      const role = event.currentTarget.value;
      document.getElementById("loginRecoveryAccountNameLabel").textContent = role === "dancer" ? "Stage name" : role === "venue" ? "Venue name" : "Name used on the account";
      document.getElementById("loginRecoveryTitle").textContent = role === "venue" ? "Find your venue sign-in email" : "Find your sign-in email";
    });
    [passwordRecoveryCard, loginRecoveryCard].forEach((popover) => {
      popover?.addEventListener("click", (event) => {
        if (event.target === popover) closeRecoveryPopover(popover);
      });
    });
    document.addEventListener("keydown", (event) => {
      const activePopover = [passwordRecoveryCard, loginRecoveryCard].find((popover) => popover && !popover.hidden);
      if (!activePopover) return;
      if (event.key === "Escape") {
        closeRecoveryPopover(activePopover);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...activePopover.querySelectorAll("button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href]")]
        .filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    document.getElementById("adminForgotPasswordBtn").addEventListener("click", () => {
      sendPasswordReset({
        role: "admin",
        emailInputId: "adminEmail",
        buttonId: "adminForgotPasswordBtn",
        statusId: "adminLiveStatus"
      });
    });

    document.querySelectorAll("[data-password-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        const input = document.getElementById(button.dataset.passwordToggle);
        if (!input) return;
        const isVisible = input.type === "text";
        input.type = isVisible ? "password" : "text";
        button.classList.toggle("is-visible", !isVisible);
        button.setAttribute("aria-pressed", String(!isVisible));
        button.setAttribute("aria-label", isVisible ? "Show password" : "Hide password");
      });
    });