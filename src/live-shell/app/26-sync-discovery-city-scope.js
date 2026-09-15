

    function syncDiscoveryCityScope() {
      const allowsAllCities = activeTab === "dancers" || activeTab === "tv" || activeTab === "venues";
      const allOption = [...citySelect.options].find((option) => option.value === ALL_CITIES);
      if (allOption) { allOption.hidden = !allowsAllCities; allOption.disabled = !allowsAllCities; }
      if (!allowsAllCities && citySelect.value === ALL_CITIES) {
        citySelect.value = lastSpecificDiscoveryCity;
        if (venueSelect) venueSelect.value = "all";
        syncHomeDestinationLocation(activeTab);
        void loadLiveDiscovery(citySelect.value);
      }
    }

    function renderCityPickerOptions() {
      if (!citySelectOptions || !citySelect) return;
      citySelectOptions.innerHTML = [...citySelect.options]
        .filter((option) => !option.hidden && !option.disabled)
        .map((option) => cityPickerOptionMarkup(option.value))
        .join("");
    }

    function syncCityPickerSelection(city = citySelect?.value || "Las Vegas") {
      if (!citySelect) return;
      const availableCities = [...citySelect.options].map((option) => option.value);
      if (availableCities.includes(city)) citySelect.value = city;
      if (city !== ALL_CITIES && markets[city]) {
        lastSpecificDiscoveryCity = city;
        try { window.sessionStorage.setItem("mydancrLastDiscoveryCity", city); } catch {}
      }
      if (citySelectButtonText) citySelectButtonText.textContent = userLocationOutsideMarkets ? "Near me" : citySelect.value;
      renderCityPickerOptions();
    }

    function openCityPicker() {
      if (!citySelectPanel || !citySelectButton) return;
      syncCityPickerSelection(citySelect?.value || "Las Vegas");
      homeFilterToggle?.setAttribute("aria-expanded", "false");
      homeFilterToggle?.classList.remove("is-open");
      homeAdvancedFilters?.classList.remove("is-open");
      citySelectButton.setAttribute("aria-expanded", "true");
      citySelectButton.classList.add("is-open");
      citySelectPanel.hidden = false;
      citySelectPanel.classList.add("is-open");
      window.requestAnimationFrame(() => citySelectOptions?.querySelector('[aria-selected="true"]')?.focus());
    }

    function closeCityPicker(restoreFocus = false) {
      syncCityPickerSelection(citySelect?.value || "Las Vegas");
      if (citySelectPanel) {
        citySelectPanel.classList.remove("is-open");
        citySelectPanel.hidden = true;
      }
      citySelectButton?.setAttribute("aria-expanded", "false");
      citySelectButton?.classList.remove("is-open");
      if (restoreFocus) window.requestAnimationFrame(() => citySelectButton?.focus({ preventScroll: true }));
    }

    function toggleCityPicker() {
      if (citySelectButton?.getAttribute("aria-expanded") === "true") {
        closeCityPicker();
        return;
      }
      openCityPicker();
    }

    function applyCityPickerSelection(nextCity) {
      if (!citySelect) return closeCityPicker(true);
      const availableCities = [...citySelect.options].map((option) => option.value);
      if (!availableCities.includes(nextCity)) return;
      const changed = userLocationOutsideMarkets || citySelect.value !== nextCity;
      citySelect.value = nextCity;
      syncCityPickerSelection(citySelect.value);
      closeCityPicker(true);
      if (changed) citySelect.dispatchEvent(new Event("change", { bubbles: true }));
    }

    if (cityPickerField && citySelectButton && citySelectPanel) {
      cityPickerField.classList.add("is-enhanced");
      citySelect.tabIndex = -1;
      citySelect.setAttribute("aria-hidden", "true");
      citySelectButton.hidden = false;
      syncCityPickerSelection(citySelect.value);
    }
    citySelectButton?.addEventListener("click", toggleCityPicker);
    citySelectLabel?.addEventListener("click", (event) => {
      if (!cityPickerField?.classList.contains("is-enhanced")) return;
      event.preventDefault();
      toggleCityPicker();
    });
    citySelectOptions?.addEventListener("click", (event) => {
      const option = event.target.closest("[data-city-picker-value]");
      if (!option) return;
      applyCityPickerSelection(option.dataset.cityPickerValue || citySelect.value);
    });
    citySelectOptions?.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeCityPicker(true);
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const options = [...citySelectOptions.querySelectorAll("[data-city-picker-value]")];
      const currentIndex = options.indexOf(document.activeElement);
      if (!options.length || currentIndex < 0) return;
      event.preventDefault();
      const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (currentIndex + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
      options[nextIndex]?.focus();
    });

    homeFilterToggle?.addEventListener("click", () => {
      const expanded = homeFilterToggle.getAttribute("aria-expanded") === "true";
      if (!expanded) closeCityPicker();
      homeFilterToggle.setAttribute("aria-expanded", String(!expanded));
      homeFilterToggle.classList.toggle("is-open", !expanded);
      homeAdvancedFilters?.classList.toggle("is-open", !expanded);
    });

    homeFilterReset?.addEventListener("click", () => {
      if (distanceSelect) distanceSelect.value = "25 mi";
      if (venueSelect) venueSelect.value = "all";
      syncVenuePickerSelection("all");
      homeDiscoveryFeedOpen = false;
      deactivateHomeDiscoveryFeed();
      tonightExpanded = false;
      dancersExpanded = false;
      selectedVenueName = null;
      populateVenueSelect();
      render();
      showToast("Filters reset");
    });

    homeAdvancedFilters?.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || homeFilterToggle?.getAttribute("aria-expanded") !== "true") return;
      homeFilterToggle.setAttribute("aria-expanded", "false");
      homeFilterToggle.classList.remove("is-open");
      homeAdvancedFilters.classList.remove("is-open");
      homeFilterToggle.focus();
    });

    citySelect.addEventListener("change", () => {
      userLocationOutsideMarkets = false;
      userLocation = null;
      syncCityPickerSelection(citySelect.value);
      deactivateHomeTvFeed();
      homeDiscoveryFeedOpen = false;
      deactivateHomeDiscoveryFeed();
      tonightExpanded = false;
      dancersExpanded = false;
      dashboardTonightExpanded = false;
      dashboardFollowedExpanded = false;
      dashboardVenuesExpanded = false;
      selectedVenueName = null;
      if (venueSelect) venueSelect.value = "all";
      syncHomeDestinationLocation(activeTab);
      const url = new URL(window.location.href);
      url.searchParams.delete("tv_venue");
      url.searchParams.delete("tv_video");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      render();
      loadLiveDiscovery(citySelect.value);
      if (customerDashboard.classList.contains("show")) renderDashboard();
      if (adminDashboard.classList.contains("show")) renderAdminDashboard();
      if (citySelect.value !== ALL_CITIES) saveLiveCustomerProfile({ city: citySelect.value });
      showToast(`${citySelect.value} loaded`);
    });

    viewAllBtn.addEventListener("click", () => {
      if (activeTab === "venues") {
        activateHomeDestination("venues");
        return;
      }
      if (activeTab === "tonight") tonightExpanded = true;
      if (activeTab === "dancers") dancersExpanded = true;
      render();
    });

    function clearHomeTvVenueFilter() {
      if (activeTab !== "tv" || !venueSelect) return;
      const url = new URL(window.location.href);
      const hasUrlVenueFilter = url.searchParams.has("tv_venue");
      if (selectedVenueFilter() === "all" && !hasUrlVenueFilter) return;
      url.searchParams.delete("tv_venue");
      window.history.replaceState({}, document.title, `${url.pathname}?${url.searchParams.toString()}${url.hash}`);
      if (selectedVenueFilter() === "all") {
        homeTvFeedCity = "";
        render();
        return;
      }
      venueSelect.value = "all";
      syncVenuePickerSelection("all");
      venueSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }

    tabCount.addEventListener("click", () => {
      if (tabCount.classList.contains("is-tv-venue-filter")) clearHomeTvVenueFilter();
    });
    tabCount.addEventListener("keydown", (event) => {
      if (
        !tabCount.classList.contains("is-tv-venue-filter") ||
        (event.key !== "Enter" && event.key !== " ")
      ) return;
      event.preventDefault();
      clearHomeTvVenueFilter();
    });

    function syncDistancePickerDisplay() {
      if (distanceSelectButtonText) distanceSelectButtonText.textContent = distanceSelect?.value || "25 mi";
    }

    function syncDistancePickerSelection() {
      distanceSelectDialog?.querySelectorAll('input[name="discoveryDistance"]').forEach((input) => {
        input.checked = input.value === distanceSelect?.value;
      });
      syncDistancePickerDisplay();
    }

    function openDistancePicker() {
      if (!distanceSelectDialog || distanceSelectDialog.open || typeof distanceSelectDialog.showModal !== "function") return;
      syncDistancePickerSelection();
      if (distanceSelectOrigin) {
        distanceSelectOrigin.textContent = userLocation
          ? "From your current location"
          : `From the center of ${selectedCity()}`;
      }
      distanceSelectDialog.showModal();
      distanceSelectButton?.setAttribute("aria-expanded", "true");
      distanceSelectDialog.querySelector('input[name="discoveryDistance"]:checked')?.focus({ preventScroll: true });
    }

    function closeDistancePicker() {
      if (distanceSelectDialog?.open) distanceSelectDialog.close();
    }

    function applyDistancePickerSelection(event) {
      event.preventDefault();
      const value = distanceSelectDialog?.querySelector('input[name="discoveryDistance"]:checked')?.value;
      if (!distanceSelect || ![...distanceSelect.options].some((option) => option.value === value)) return;
      const changed = distanceSelect.value !== value;
      distanceSelect.value = value;
      syncDistancePickerDisplay();
      closeDistancePicker();
      if (changed) distanceSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }

    if (distancePickerField && distanceSelect && distanceSelectButton && typeof distanceSelectDialog?.showModal === "function") {
      distancePickerField.classList.add("is-enhanced");
      distanceSelect.hidden = true;
      distanceSelectButton.hidden = false;
      distanceSelectLabel?.setAttribute("for", "distanceSelectButton");
      syncDistancePickerDisplay();
    }
    distanceSelectButton?.addEventListener("click", openDistancePicker);
    distanceSelectClose?.addEventListener("click", closeDistancePicker);
    distanceSelectForm?.addEventListener("submit", applyDistancePickerSelection);
    distanceSelectDialog?.addEventListener("close", () => {
      syncDistancePickerSelection();
      distanceSelectButton?.setAttribute("aria-expanded", "false");
      distanceSelectButton?.focus({ preventScroll: true });
    });
    distanceSelectDialog?.addEventListener("click", (event) => {
      if (event.target !== distanceSelectDialog) return;
      const bounds = distanceSelectDialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeDistancePicker();
    });

    function openVenuePicker() {
      if (!venueSelectDialog || typeof venueSelectDialog.showModal !== "function") return;
      venuePickerRestoreFocus = document.activeElement;
      syncVenuePickerSelection(venueSelect?.value || "all");
      venueSelectButton?.setAttribute("aria-expanded", "true");
      venueSelectDialog.showModal();
      window.requestAnimationFrame(() => venueSelectOptions?.querySelector('[aria-selected="true"]')?.focus());
    }

    function closeVenuePicker() {
      syncVenuePickerSelection(venueSelect?.value || "all");
      if (venueSelectDialog?.open) venueSelectDialog.close();
      venueSelectButton?.setAttribute("aria-expanded", "false");
      const focusTarget = venuePickerRestoreFocus instanceof HTMLElement ? venuePickerRestoreFocus : venueSelectButton;
      window.requestAnimationFrame(() => focusTarget?.focus());
      venuePickerRestoreFocus = null;
    }

    function applyVenuePickerSelection() {
      if (!venueSelect) return closeVenuePicker();
      const changed = venueSelect.value !== pendingVenueSelection;
      venueSelect.value = pendingVenueSelection;
      syncVenuePickerSelection(venueSelect.value);
      closeVenuePicker();
      if (changed) venueSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }

    distanceSelect.addEventListener("change", () => {
      homeDiscoveryFeedOpen = false;
      deactivateHomeDiscoveryFeed();
      tonightExpanded = false;
      dancersExpanded = false;
      selectedVenueName = null;
      populateVenueSelect();
      render();
      showToast(`Distance set to ${distanceSelect.value}`);
    });

    venueSelect?.addEventListener("change", () => {
      homeDiscoveryFeedOpen = false;
      deactivateHomeDiscoveryFeed();
      tonightExpanded = false;
      dancersExpanded = false;
      selectedVenueName = null;
      render();
      const venueName = selectedVenueFilter();
      showToast(venueName === "all" ? "Showing all clubs" : `Showing ${resolveVenueByName(venueName)?.name || venueName}`);
    });

    if (venuePickerField && venueSelectButton && venueSelectDialog && typeof venueSelectDialog.showModal === "function") {
      venuePickerField.classList.add("is-enhanced");
      venueSelectButton.hidden = false;
    }
    venueSelectButton?.addEventListener("click", openVenuePicker);
    venueSelectLabel?.addEventListener("click", (event) => {
      if (!venuePickerField?.classList.contains("is-enhanced")) return;
      event.preventDefault();
      openVenuePicker();
    });
    venueSelectDone?.addEventListener("click", applyVenuePickerSelection);
    venueSelectClose?.addEventListener("click", closeVenuePicker);
    venueSelectOptions?.addEventListener("click", (event) => {
      const option = event.target.closest("[data-venue-picker-value]");
      if (option) syncVenuePickerSelection(option.dataset.venuePickerValue || "all");
    });
    venueSelectOptions?.addEventListener("keydown", (event) => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const options = [...venueSelectOptions.querySelectorAll("[data-venue-picker-value]")];
      const currentIndex = options.indexOf(document.activeElement);
      if (!options.length || currentIndex < 0) return;
      event.preventDefault();
      const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (currentIndex + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
      options[nextIndex]?.focus();
    });
    venueSelectDialog?.addEventListener("cancel", (event) => { event.preventDefault(); closeVenuePicker(); });
    venueSelectDialog?.addEventListener("click", (event) => { if (event.target === venueSelectDialog) closeVenuePicker(); });

    document.getElementById("locationBtn").addEventListener("click", async () => {
      const button = document.getElementById("locationBtn");
      const label = button?.querySelector(".location-btn-label");
      const originalText = "Use current location";
      if (button) {
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
      }
      if (label) label.textContent = "Checking location...";
      try {
        showToast("Checking your location...");
        const requestedLocation = await requestVenuePosition();
        const nearestMarket = nearestCityForCoordinates(requestedLocation);
        if (!nearestMarket || nearestMarket.miles > MAX_LOCATION_MARKET_DISTANCE_MILES) {
          userLocation = requestedLocation;
          userLocationOutsideMarkets = true;
          tonightExpanded = false;
          dancersExpanded = false;
          dashboardTonightExpanded = false;
          dashboardFollowedExpanded = false;
          dashboardVenuesExpanded = false;
          selectedVenueName = null;
          if (venueSelect) venueSelect.value = "all";
          render();
          showToast(`No MyDancr city within ${MAX_LOCATION_MARKET_DISTANCE_MILES} mi of you.`);
          return;
        }
        userLocation = requestedLocation;
        userLocationOutsideMarkets = false;
        citySelect.value = nearestMarket.city;
        syncCityPickerSelection(nearestMarket.city);
        tonightExpanded = false;
        dancersExpanded = false;
        dashboardTonightExpanded = false;
        dashboardFollowedExpanded = false;
        dashboardVenuesExpanded = false;
        selectedVenueName = null;
        if (venueSelect) venueSelect.value = "all";
        render();
        loadLiveDiscovery(citySelect.value);
        if (customerDashboard.classList.contains("show")) renderDashboard();
        showToast(`${nearestMarket.city} selected from your location.`);
      } catch (error) {
        showToast(error.message || "Could not read location.");
      } finally {
        if (button) {
          button.disabled = false;
          button.removeAttribute("aria-busy");
        }
        if (label) label.textContent = originalText;
      }
    });

    function installReferenceHomeShell() {
      const hero = document.querySelector(".hero");
      if (hero) {
        hero.classList.add("reference-hero", "uploaded-hero-ready");
      }

      document.querySelectorAll("[data-jump-tonight]").forEach((button) => {
        button.addEventListener("click", () => {
          activateHomeDestination("dancers", { dancerFilter: "now" });
          document.getElementById("tabTitle")?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      });
      document.querySelectorAll("[data-jump-clubs]").forEach((button) => {
        button.addEventListener("click", () => {
          document.querySelector('[data-tab="venues"]')?.click();
          document.getElementById("tabTitle")?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      });
    }

    function renderPopularClubs(city) {
      const strip = document.getElementById("popularClubStrip");
      if (!strip || !discoveryMarket(city)) return;
      const venues = discoveryMarket(city).venues.filter((venue) => !venue.hidden && venueWithinSelectedRadius(venue)).slice(0, 5);
      strip.innerHTML = venues.map((venue, index) => `
        <button class="club-mini club-mini-${index + 1}" type="button" data-popular-venue="${escapeHtml(venue.name)}">
          <span class="club-neon">${escapeHtml(venue.name)}</span>
          <strong>${escapeHtml(venue.name)}</strong>
          <small>${escapeHtml(city)}</small>
        </button>
      `).join("");
      strip.querySelectorAll("[data-popular-venue]").forEach((button) => {
        button.addEventListener("click", () => {
          selectedVenueName = button.dataset.popularVenue;
          document.querySelector('[data-tab="venues"]')?.click();
          render();
          scrollToVenueDetail();
        });
      });
    }

    function scrollToSharedVenueSection() {
      const sectionId = window.location.hash.slice(1);
      if (!sectionId) return;
      requestAnimationFrame(() => {
        document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }

    function openSharedProfileMedia(params) {
      if (params.get("media") !== "photo") return;
      const photoThumbs = [...modalGallery.querySelectorAll(".thumb:not([data-profile-tv-index])")];
      if (!photoThumbs.length) return;
      const requestedIndex = Number(params.get("mediaIndex"));
      const photoIndex = Number.isInteger(requestedIndex)
        ? Math.min(Math.max(requestedIndex, 0), photoThumbs.length - 1)
        : 0;
      selectModalMediaThumb(photoThumbs[photoIndex], { syncViewer: true });
      openPhotoViewerFromElement(modalImage, photoIndex);
    }

    async function openSharedProfileFromUrl() {
      const params = new URLSearchParams(window.location.search);
      const city = params.get("city");
      const profileSlug = params.get("profile");
      const venueSlug = params.get("venue");
      const isVenuePreview = Boolean(venueSlug && params.get("venue_preview") === "1");
      if (isVenuePreview) {
        try {
          const previewVenue = await applyVenueDashboardPreview(city, venueSlug);
          if (!previewVenue) return;
          const previewCity = previewVenue.city || citySelect.value;
          citySelect.value = previewCity;
          activeTab = "venues";
          document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item.dataset.tab === activeTab));
          openVenueFromName(previewVenue.slug || previewVenue.name);
          scrollToSharedVenueSection();
        } catch (error) {
          render();
          showToast(error.message || "Venue preview could not be loaded");
        } finally {
          finishVenuePreviewBootstrap();
        }
        return;
      }
      if (!city || (!profileSlug && !venueSlug) || !discoveryMarket(city)) return;
      citySelect.value = city;
      activeTab = venueSlug ? "venues" : "dancers";
      document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item.dataset.tab === activeTab));
      if (venueSlug) {
        const venue = resolveVenueByName(venueSlug, city);
        if (venue && !venue.hidden) {
          openVenueFromName(venue.slug || venue.name);
          scrollToSharedVenueSection();
        } else {
          render();
          if (liveMarketState[city] !== "error") showToast("Club profile not found");
        }
        return;
      }
      render();
      const approvedProfiles = discoveryMarket(city).dancers.filter(isApprovedPublicProfile);
      const profile = approvedProfiles.find((item) => item.slug === profileSlug)
        || approvedProfiles.find((item) => slugify(item.name) === profileSlug);
      if (profile) {
        setTimeout(() => {
          openProfileModal(profileReferenceValue(profile));
          openSharedProfileMedia(params);
        }, 120);
      } else if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(profileSlug)) {
        // Previously assigned links resolve through the same public approval checks.
        const target = new URL(`/dancers/${profileSlug}`, window.location.origin);
        for (const key of ["media", "mediaIndex"]) {
          if (params.has(key)) target.searchParams.set(key, params.get(key));
        }
        window.location.replace(target.toString());
      }
    }

    function handleDancerDashboardDeepLink() {
      const params = new URLSearchParams(window.location.search);
      const linkState = dancerDashboardLinkFromParams(params);
      if (!linkState) return false;
      window.history.replaceState({}, document.title, "/");
      if (isDancerSession()) {
        openDancerDashboardFromLink(linkState);
      } else {
        storePendingDancerDashboardLink(linkState);
        openAuthRole("dancer");
        showToast("Sign in to open your dancer dashboard and review changes.");
        focusAuthFieldWhenKeyboardSafe("customerEmail", 120);
      }
      return true;
    }

    function handleAdminDashboardDeepLink() {
      const params = new URLSearchParams(window.location.search);
      if (params.get("dancr_dashboard") !== "admin") return false;
      window.history.replaceState({}, document.title, "/");
      openAdminDashboard();
      return true;
    }

    function handleVenueDashboardDeepLink() {
      const params = new URLSearchParams(window.location.search);
      if (params.get("dancr_dashboard") !== "venue") return false;
      const forceFreshSignIn = params.get("dancr_force_sign_in") === "1";
      window.history.replaceState({}, document.title, "/");
      if (forceFreshSignIn) {
        saveAuthSession(null);
        isVenueLoggedIn = false;
        activeDashboardType = "venue";
        openAuthRole("venue");
        setCustomerAuthStatus("Sign in as the verified venue manager to open the venue workspace.");
        return true;
      }
      void openVenueDashboard();
      if (!isVenueSession()) {
        setCustomerAuthStatus("Sign in as the verified venue manager to open the venue workspace.");
      }
      return true;
    }

    function safeLocalReturnPath(value) {
      const requested = String(value || "").trim();
      if (
        !requested.startsWith("/")
        || requested.startsWith("//")
        || requested.includes("\\")
        || /^\/%(?:2f|5c)/i.test(requested)
        || /[\u0000-\u001f\u007f]/.test(requested)
      ) return "";
      try {
        const base = new URL("https://return.mydancr.invalid");
        const destination = new URL(requested, base);
        if (destination.origin !== base.origin) return "";
        // Navigation parses this normalized path again; it must stay local.
        if (destination.pathname.startsWith("//") || /^\/%(?:2f|5c)/i.test(destination.pathname)) return "";
        return `${destination.pathname}${destination.search}${destination.hash}`;
      } catch (error) {
        return "";
      }
    }

    function accountLoginDestination(role, returnTo = "") {
      const dashboard = `/dashboard/${role}`;
      const requested = safeLocalReturnPath(returnTo);
      if (!requested || /^\/(?:account|auth|admin)(?:[/?#]|$)/.test(requested)) return dashboard;
      if (/^\/dashboard(?:[/?#]|$)/.test(requested)) {
        const dashboardMatch = requested.match(/^\/dashboard\/(customer|dancer|venue)(?:[/?#]|$)/);
        if (dashboardMatch?.[1] !== role) return dashboard;
      }
      return requested;
    }

    function handleAccountAccessDeepLink() {
      const url = new URL(window.location.href);
      const mode = url.searchParams.get("auth");
      if (mode !== "login" && mode !== "signup") return false;
      const role = url.searchParams.get("role") === "dancer" ? "dancer" : "customer";
      const returnTo = safeLocalReturnPath(url.searchParams.get("return_to"));
      for (const key of ["auth", "role", "return_to"]) url.searchParams.delete(key);
      window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
      openAuthRole(role);
      if (mode === "signup") {
        if (role === "dancer") openDancerSignupPage();
        else openCustomerSignup();
      }
      // Prevent old account/callback links from creating a sign-in redirect loop.
      pendingAccountAuthReturnTo = returnTo && !/^\/(?:account|auth)(?:[/?#]|$)/.test(returnTo) ? returnTo : "";
      return true;
    }

    function handleVenueAccessDeepLink() {
      const url = new URL(window.location.href);
      const legacySignup = url.searchParams.get("venueSignup") === "1";
      const venueAccessRequested = url.searchParams.get("venueAccess") === "1";
      const venueRequestRequested = url.searchParams.get("venueRequest") === "1";
      const agentReferralCode = String(url.searchParams.get("agent") || "").trim().toLowerCase();
      if (!legacySignup && !venueAccessRequested && !venueRequestRequested) return false;

      const mode = legacySignup || url.searchParams.get("venueMode") === "signup" ? "signup" : "login";
      const safeReturnTo = safeLocalReturnPath(url.searchParams.get("return_to"));
      url.searchParams.delete("venueSignup");
      url.searchParams.delete("venueAccess");
      url.searchParams.delete("venueRequest");
      url.searchParams.delete("agent");
      url.searchParams.delete("venueMode");
      url.searchParams.delete("return_to");
      window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);

      pendingVenueAuthReturnTo = safeReturnTo;
      pendingVenueAgentReferralCode = venueRequestRequested ? agentReferralCode : "";
      if (venueRequestRequested) {
        openAuthPage();
        openVenueRequest();
        showToast("Submit the club and authorized business-contact details for review.");
      } else if (mode === "signup") {
        openAuthPage();
        openVenueSignup();
        showToast("Enter the private access code from MyDancr to create your venue account.");
        focusAuthFieldWhenKeyboardSafe("venueSignupCode", 120);
      } else {
        openAuthRole("venue");
        focusAuthFieldWhenKeyboardSafe("customerEmail", 120);
      }
      return true;
    }

    function handleVenueDancerVerificationDeepLink() {
      const url = new URL(window.location.href);
      const token = String(url.searchParams.get("venueVerify") || "").trim();
      if (!token) return false;
      url.searchParams.delete("venueVerify");
      window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
        savePendingVenueDancerVerificationToken("");
        showToast("This dancer verification link is invalid or expired.");
        return true;
      }
      savePendingVenueDancerVerificationToken(token);
      if (isVenueSession()) {
        isVenueLoggedIn = true;
        activeDashboardType = "venue";
        openVenueDashboard();
      } else {
        openAuthRole("venue");
        setCustomerAuthStatus("Sign in as this club's verified manager to confirm the dancer.");
        showToast("Venue manager sign-in required to verify this dancer.");
      }
      return true;
    }

    installReferenceHomeShell();
    void loadDancerSignupCities();
    restoreLoggedInSessionState();
    updateAccountHeader();
    const initialProfileParams = new URLSearchParams(window.location.search);
    const initialProfileCity = initialProfileParams.get("city");
    if (initialProfileCity && discoveryMarket(initialProfileCity)) {
      citySelect.value = initialProfileCity;
    }
    const initialHomeDestinationRequested = homeDestinationWasRequested();
    const initialHomeDestination = homeDestinationFromLocation();
    dancerDirectoryFilter = dancerDirectoryFilterFromLocation();
    if (initialHomeDestination) {
      activeTab = initialHomeDestination;
      homeDiscoveryFeedOpen =
        initialHomeDestination === "venues" &&
        homeDiscoveryFeedUsesInlineLayout();
      document.querySelectorAll(".tab").forEach((item) => {
        const isActive = item.dataset.tab === initialHomeDestination;
        item.classList.toggle("active", isActive);
        item.setAttribute("aria-current", isActive ? "page" : "false");
      });
      const initialIsTv = initialHomeDestination === "tv";
      homeBottomTv?.classList.toggle("active", initialIsTv);
      homeBottomTv?.setAttribute("aria-current", initialIsTv ? "page" : "false");
    }
    if (initialHomeDestinationRequested) {
      syncHomeDestinationLocation(initialHomeDestination);
    }
    homeTvFeedLandingPending = initialHomeDestinationRequested && initialHomeDestination === "tv";
    const initialVenuePreviewRequested = initialProfileParams.get("venue_preview") === "1" && Boolean(initialProfileParams.get("venue"));
    const initialDiscoveryRequest = loadLiveDiscovery(citySelect.value, {
      force: consumePublicDiscoveryRefreshRequest()
    });
    const initialVenuePreviewRequest = initialVenuePreviewRequested
      ? Promise.resolve(initialDiscoveryRequest).finally(() => openSharedProfileFromUrl())
      : null;
    render();
    if (initialHomeDestinationRequested) {
      focusHomeResults();
    }
    async function refreshVisibleHomeDiscovery({ bypassCache = false } = {}) {
      if (document.visibilityState !== "visible") return;
      await loadLiveDiscovery(citySelect.value, { force: true, cacheBust: bypassCache, background: true });
    }
    window.setInterval(() => { void refreshVisibleHomeDiscovery(); }, HOME_DISCOVERY_REFRESH_MS);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void refreshVisibleHomeDiscovery({ bypassCache: true });
    });
    window.addEventListener("focus", () => {
      if (refreshBrowserAccountView()) return;
      void refreshVisibleHomeDiscovery({ bypassCache: true });
    });
    window.addEventListener("storage", (event) => {
      if (event.key === PUBLIC_DISCOVERY_REFRESH_KEY && event.newValue) {
        void refreshVisibleHomeDiscovery({ bypassCache: true });
        return;
      }
      if (!event.key?.startsWith("dancrSavedDealPassesV3:") && event.key !== "dancrAuthSessionV1" && event.key !== null) return;
      if (event.key === "dancrAuthSessionV1" || event.key === null) {
        if (refreshBrowserAccountView()) return;
        synchronizeAuthSession();
      }
      syncDeviceSavedDealPasses();
      renderCustomerQuickActions();
    });
    window.addEventListener("pageshow", (event) => {
      if (refreshBrowserAccountView()) return;
      if (!event.persisted) return;
      consumePublicDiscoveryRefreshRequest();
      void refreshVisibleHomeDiscovery({ bypassCache: true });
      syncDeviceSavedDealPasses();
      renderCustomerQuickActions();
      if (isCustomerSession()) void loadLiveCustomerSaved();
    });
    if (isCustomerSession()) loadLiveCustomerDashboardData();
    if (isDancerSession()) {
      loadLiveDancerAnalytics();
      loadLiveDancerDeals();
      loadLiveDancerWeeklyReport();
      loadLiveDancerRankingEvents();
    }
    if (authSession?.accessToken) loadLiveNotifications();
    if (isCustomerSession() || isDancerSession()) loadLiveSupportThreads();
    if (isAdminSession()) loadLiveAdminSupportThreads();
    const restoredAuthResume = restoreAuthConfirmationResume();
    if (!restoredAuthResume && !handleVenueDancerVerificationDeepLink() && !handleAdminDashboardDeepLink() && !handleVenueDashboardDeepLink() && !handleDancerDashboardDeepLink() && !handleVenueAccessDeepLink() && !handleAccountAccessDeepLink()) {
      if (initialVenuePreviewRequest) void initialVenuePreviewRequest;
      else void initialDiscoveryRequest.finally(() => openSharedProfileFromUrl()).finally(() => {
        document.documentElement.classList.remove("venue-profile-bootstrap");
      });
    } else {
      document.documentElement.classList.remove("venue-profile-bootstrap");
    }
