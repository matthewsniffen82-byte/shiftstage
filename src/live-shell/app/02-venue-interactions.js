    function recordVenueInteraction({ venueId, dancerId = null, eventType, source }) {
      if (!venueId || window.location.protocol === "file:") return;
      try {
        const payload = JSON.stringify({ eventId: crypto.randomUUID(), venueId, dancerId: dancerId || null, eventType, source, sessionId: trendEventStore.viewerId });
        fetch("/api/public/venue-interactions", { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true }).catch(() => {});
      } catch {}
    }

    function venueInteractionContext(target) {
      const root = target?.closest?.("[data-analytics-venue-id]");
      const profileRoot = target?.closest?.("#profileModal, .dancer-card");
      const configNode = target?.closest?.("[data-club-deal-cta], [data-deal-pass], [data-profile-club-deal-config]");
      const config = configNode ? decodeDealPass(configNode.dataset.clubDealCta || configNode.dataset.dealPass || configNode.dataset.profileClubDealConfig) : null;
      const venueReference = target?.dataset?.analyticsVenueId || target?.dataset?.venueId || target?.dataset?.openVenueProfile || target?.dataset?.openVenue || target?.dataset?.cardVenue || target?.dataset?.shareVenue || target?.dataset?.venueFollow || config?.venueId || config?.venue?.id || config?.deal?.venueId || root?.dataset.analyticsVenueId;
      const venue = resolveVenueByName(venueReference);
      const profileReference = target?.dataset?.dancerId || config?.dancerId || profileRoot?.dataset.analyticsDancerId || profileRoot?.dataset.profileReference || profileRoot?.dataset.profile;
      const profile = profileReference ? findProfile(profileReference) : null;
      return { venueId: venue?.isDashboardPreview ? null : venue?.id, dancerId: profile?.id || null, source: root?.dataset.analyticsSource || (profileRoot ? "dancer_profile" : "venue_detail") };
    }

    document.addEventListener("click", event => {
      const target = event.target.closest?.("a, button, .dancer-card, .venue-shift-row");
      if (!target || target.disabled || target.getAttribute("aria-disabled") === "true") return;
      let eventType = "";
      if (target.matches("[data-open-venue-profile], [data-open-venue], [data-card-venue]")) eventType = "club_page";
      else if (target.matches("[data-venue-dancer-profile]")) eventType = "dancer_profile";
      else if (target.matches(".venue-directions-btn, .venue-address-directions")) eventType = "directions";
      else if (target.matches("[data-club-deal-cta], [data-profile-club-deal-config], [data-deal-pass]")) eventType = "free_entry";
      else if (target.matches("[data-free-ride-link]")) eventType = "transport";
      else if (target.matches("[data-venue-follow]")) eventType = target.getAttribute("aria-pressed") === "true" ? "unfollow" : "follow";
      else if (target.matches("[data-share-venue]")) eventType = "share";
      else if (target.matches('a[href^="tel:"]')) eventType = "phone";
      const root = target.closest("[data-analytics-venue-id]");
      const dancerCard = target.closest(".dancer-card, .venue-shift-row");
      if (!eventType && root && dancerCard && (target === dancerCard || target.matches("[data-grid-profile-action]"))) {
        const profile = findProfile(dancerCard.dataset.profileReference || dancerCard.dataset.profile);
        recordVenueInteraction({ venueId: root.dataset.analyticsVenueId, dancerId: profile?.id, eventType: "dancer_profile", source: root.dataset.analyticsSource });
        return;
      }
      if (eventType) recordVenueInteraction({ ...venueInteractionContext(target), eventType });
    }, true);

    // Count visible cards, not markup generated below the fold. Re-rendering the
    // same card during this page visit does not create another impression.
    const seenVenueCards = new Set();
    const venueCardObserver = typeof IntersectionObserver === "function" ? new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting || entry.intersectionRatio < 0.5 || document.visibilityState !== "visible") continue;
        const venueId = entry.target.dataset.analyticsVenueId;
        if (venueId && !seenVenueCards.has(venueId)) {
          seenVenueCards.add(venueId);
          recordVenueInteraction({ venueId, eventType: "card_impression", source: "venue_scroll_card" });
        }
        venueCardObserver.unobserve(entry.target);
      }
    }, { threshold: 0.5 }) : null;
    function observeVenueCards(root) {
      if (!venueCardObserver || !root?.querySelectorAll) return;
      const selector = '[data-analytics-source="venue_scroll_card"]';
      if (root.matches?.(selector)) venueCardObserver.observe(root);
      root.querySelectorAll(selector).forEach(card => venueCardObserver.observe(card));
    }
    if (venueCardObserver) {
      observeVenueCards(document);
      new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(observeVenueCards))).observe(document.body, { childList: true, subtree: true });
    }
