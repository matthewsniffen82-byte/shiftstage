(function (root) {
  "use strict";
  const grid = root.MydancrDancerGrid;
  const escape = grid.escape;
  function safeImageUrl(value) {
    if (!String(value || "").trim()) return "";
    try {
      const url = new URL(value, root.location.origin);
      return url.protocol === "https:" || (url.origin === root.location.origin && url.protocol === "http:") ? url.href : "";
    } catch { return ""; }
  }
  function imageSources(value) {
    return String(value || "").split(",")
      .map(value => value.trim().match(/^(\S+)\s+(\d+)w$/)).filter(Boolean)
      .map(match => ({ url: safeImageUrl(match[1]), width: Number(match[2]) }))
      .filter(source => source.url && source.width > 0).sort((a, b) => a.width - b.width);
  }
  function cardMarkup(dancer, venue, index, profileHref) {
    const sources = imageSources(dancer.primaryPhotoSrcSet);
    const photo = sources.find(source => source.width >= 320)?.url || sources.at(-1)?.url || safeImageUrl(dancer.primaryPhotoUrl || "");
    const srcset = list => list.map(source => `${escape(source.url)} ${source.width}w`).join(", ");
    const mobile = sources.filter(source => source.width <= 320);
    const photoMarkup = photo
      ? `<picture class="photo-thumbnail">${mobile.length ? `<source media="(max-width: 520px)" sizes="calc((100vw - 20px) / 3)" srcset="${srcset(mobile)}">` : ""}<img class="home-dancer-grid-photo has-custom-photo" src="${escape(photo)}"${sources.length ? ` srcset="${srcset(sources)}"` : ""} sizes="(max-width: 720px) calc((100vw - 20px) / 3), (max-width: 1280px) calc((100vw - 64px) / 3), 390px" width="360" height="640" loading="${index < 12 ? "eager" : "lazy"}" fetchpriority="${index < 12 ? "high" : "auto"}" decoding="async" draggable="false" alt="" aria-hidden="true" data-image-state="loading"></picture>`
      : `<div class="home-dancer-grid-photo" aria-hidden="true">${escape(String(dancer.stageName).trim().charAt(0))}</div>`;
    return grid.render({ id: dancer.id, name: dancer.stageName, reference: dancer.id,
      identityVerified: dancer.identityVerified === true,
      href: profileHref || `/dancers/${encodeURIComponent(dancer.slug)}`, newTab: !profileHref, compact: true,
      groupClass: "is-now", scheduleLabel: "Working now", photoMarkup,
      venueMarkup: `<span class="home-dancer-grid-venue"><span class="venue-dot" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 21s6-5.3 6-11a6 6 0 0 0-12 0c0 5.7 6 11 6 11Z"></path><circle cx="12" cy="10" r="2.2"></circle></svg></span><span>${escape(venue.name)}</span></span>`,
    });
  }
  function applyTheme(document) {
    const value = String(document.body.dataset.accent || "").trim();
    const accent = /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : "#6d28ff";
    const channels = accent.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
      .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    const luminance = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
    document.body.style.setProperty("--embed-accent", accent);
    document.body.style.setProperty("--embed-accent-text", luminance > .179 ? "#050507" : "#ffffff");
    document.body.dataset.venueGuestColor = accent === "#6d28ff" ? "default" : "custom";
  }
  function mountProfileDialog(document, onClose = () => {}) {
    const dialog = document.getElementById("venue-profile-dialog");
    if (!dialog || typeof dialog.showModal !== "function" || !root.addEventListener) return { isOpen: () => false };
    const results = document.getElementById("results");
    const loading = document.getElementById("venue-profile-loading");
    const status = document.getElementById("venue-profile-status");
    const fallback = document.getElementById("venue-profile-fallback");
    const back = document.getElementById("venue-profile-back");
    const historyKey = "mydancrVenueProfile";
    let active = null, returning = false;
    function profileUrl(href) {
      try {
        const url = new URL(href, root.location.href);
        const prefix = `/embed/venues/${document.body.dataset.venueSlug}/dancers/`;
        if (url.origin !== root.location.origin || !url.pathname.startsWith(prefix)
          || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(url.pathname.slice(prefix.length))) return null;
        // Forward only the existing dashboard return context.
        const clean = new URL(url.pathname, root.location.origin);
        if (url.searchParams.get("from") === "club-dashboard") clean.searchParams.set("from", "club-dashboard");
        return clean;
      } catch { return null; }
    }
    function close(updateHistory = true) {
      if (!active) return;
      const previous = active;
      active = null;
      root.clearTimeout(previous.timer);
      previous.frame.remove(); // Stop playback and release profile listeners.
      dialog.close();
      document.body.classList.remove("venue-profile-open");
      document.body.style.removeProperty("--venue-profile-scroll-y");
      root.scrollTo({ left: previous.x, top: previous.y, behavior: "instant" });
      if (previous.trigger?.isConnected) previous.trigger.focus({ preventScroll: true });
      if (updateHistory && root.history.state?.[historyKey]?.href === previous.href) {
        returning = true;
        root.history.back();
      }
      onClose();
    }
    function open(href, trigger, pushHistory = true) {
      const url = profileUrl(href);
      if (!url || active || returning) return false;
      const frame = document.createElement("iframe");
      frame.className = "venue-profile-frame";
      frame.title = trigger?.getAttribute("aria-label") || "Dancer profile";
      frame.allow = "autoplay; fullscreen";
      frame.referrerPolicy = "no-referrer";
      const profileHref = url.pathname + url.search;
      url.searchParams.set("overlay", "1");
      frame.src = url.href;
      frame.dataset.loading = "true";
      const current = { frame, href: profileHref, trigger, x: root.scrollX, y: root.scrollY, timer: null };
      active = current;
      loading.hidden = false;
      fallback.hidden = true;
      fallback.href = profileHref;
      status.textContent = "Opening profile…";
      dialog.setAttribute("aria-label", frame.title);
      // Save the grid's history position before fixing the body changes window.scrollY.
      if (pushHistory) root.history.pushState({ ...root.history.state, [historyKey]: { href: profileHref } }, "");
      document.body.style.setProperty("--venue-profile-scroll-y", `${-current.y}px`);
      document.body.classList.add("venue-profile-open");
      dialog.append(frame);
      dialog.showModal();
      back.focus({ preventScroll: true });
      const failed = () => {
        if (active !== current) return;
        status.textContent = "This profile could not load. Go back or open it in a new tab.";
        fallback.hidden = false;
      };
      frame.addEventListener("error", failed);
      current.timer = root.setTimeout(failed, 20000);
      return true;
    }
    results.addEventListener("click", event => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target.closest("a[href]");
      if (!link || !results.contains(link) || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
      if (open(link.href, link)) event.preventDefault();
    });
    back.addEventListener("click", () => close());
    dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
    dialog.addEventListener("close", () => { if (!dialog.open) close(); });
    root.addEventListener("message", event => {
      if (!active || event.origin !== root.location.origin || event.source !== active.frame.contentWindow) return;
      if (event.data?.type === "mydancr:embed-profile-close") close();
      else if (event.data?.type === "mydancr:embed-profile-ready") {
        root.clearTimeout(active.timer);
        if (active.frame.dataset.loading !== "true") return;
        loading.hidden = true;
        active.frame.dataset.loading = "false";
        active.frame.focus();
      }
    });
    root.addEventListener("popstate", event => {
      returning = false;
      const href = event.state?.[historyKey]?.href;
      if (active?.href === href) return;
      close(false);
      if (typeof href === "string") {
        const trigger = [...results.querySelectorAll("a[href]")].find(link => {
          const url = profileUrl(link.href);
          return url && url.pathname + url.search === href;
        });
        open(href, trigger, false);
      }
    });
    // A reload starts at the grid; do not retain a stale overlay history marker.
    if (root.history.state?.[historyKey]) {
      const state = { ...root.history.state };
      delete state[historyKey];
      root.history.replaceState(state, "");
    }
    return { isOpen: () => !!active };
  }
  function mount(document) {
    applyTheme(document);
    const profileDialog = mountProfileDialog(document, () => { if (rosterExpired()) void load(); });
    const legacyAccent = document.body.dataset.accent;
    const results = document.getElementById("results");
    const status = document.getElementById("venue-status");
    const refresh = document.getElementById("venue-refresh");
    const more = document.getElementById("venue-more");
    const venueName = document.getElementById("venue-name");
    const venueCity = document.getElementById("venue-city");
    const venueLogo = document.getElementById("venue-logo");
    venueLogo?.addEventListener("error", () => { venueLogo.hidden = true; });
    const count = document.getElementById("venue-count");
    const sourceSlug = document.body.dataset.venueSlug;
    // In-memory identifiers work even when third-party cookies/storage are blocked.
    const session = root.crypto.randomUUID();
    const watchedImages = new WeakSet();
    let visit = "", nextCursor = null, busy = false, loadedPages = 1, dancers = [], lastMarkup = "", generation = 0;
    const maxRosterAge = 5 * 60 * 1000;
    let lastConfirmedAt = null;
    function rosterExpired() { return lastConfirmedAt !== null && Date.now() - lastConfirmedAt >= maxRosterAge; }
    function clearRoster() {
      dancers = []; nextCursor = null; loadedPages = 1; results.innerHTML = lastMarkup = "";
      lastConfirmedAt = null;
      venueName.textContent = "";
      if (venueCity) { venueCity.textContent = ""; venueCity.hidden = true; }
      if (venueLogo) { venueLogo.hidden = true; venueLogo.removeAttribute("src"); }
      showCount();
      more.hidden = true;
    }
    function showCount(value = "") {
      if (!count) return;
      count.textContent = value;
      count.hidden = value === "";
    }
    function render(venue) {
      const visible = dancers;
      const query = new URLSearchParams();
      if (document.body.dataset.fromClubDashboard === "true") query.set("from", "club-dashboard");
      const suffix = query.size ? `?${query}` : "";
      const markup = visible.map((dancer, index) => cardMarkup(dancer, venue, index,
        `/embed/venues/${encodeURIComponent(venue.slug)}/dancers/${encodeURIComponent(dancer.slug)}${suffix}`)).join("");
      if (markup !== lastMarkup) {
        grid.update(results, markup);
        lastMarkup = markup;
        results.querySelectorAll("img").forEach(image => {
          if (watchedImages.has(image)) return;
          watchedImages.add(image);
          const ready = () => { image.dataset.imageState = image.naturalWidth ? "ready" : "error"; };
          image.addEventListener("load", ready, { once: true });
          image.addEventListener("error", ready, { once: true });
          if (image.complete) ready();
        });
      }
      venueName.textContent = venue.name;
      if (venueCity) {
        venueCity.textContent = typeof venue.city === "string" ? venue.city.trim() : "";
        venueCity.hidden = !venueCity.textContent;
      }
      const logo = safeImageUrl(venue.logoImageUrl || "");
      if (venueLogo) {
        venueLogo.alt = `${venueName.textContent} logo`;
        if (logo && venueLogo.src !== logo) {
          venueLogo.src = logo;
          venueLogo.hidden = false;
        } else if (!logo) {
          venueLogo.hidden = true;
          venueLogo.removeAttribute("src");
        }
      }
      showCount(`${visible.length}${nextCursor ? "+" : ""}`);
    }
    async function load(append = false) {
      // Keep the loaded cards and their positions intact behind an open profile.
      if (profileDialog.isOpen()) return;
      // Check before the busy guard, including when a hidden tab becomes visible.
      // Invalidate an in-flight append so it cannot restore an expired snapshot.
      if (rosterExpired()) {
        clearRoster(); generation++; busy = false; append = false;
        status.textContent = "Unable to confirm who’s working now. Please refresh.";
        status.hidden = false;
      }
      if (busy || (append && !nextCursor)) return;
      const requestId = ++generation;
      const requestStartedAt = Date.now();
      const venueSlug = sourceSlug;
      busy = true;
      refresh.disabled = more.disabled = true;
      refresh.setAttribute("aria-busy", "true");
      results.setAttribute("aria-busy", "true");
      const requestVisit = append ? visit : root.crypto.randomUUID();
      const rows = append ? [...dancers] : [];
      let cursor = append ? nextCursor : null, venue, pages = 0;
      try {
        do {
          const query = new URLSearchParams();
          if (cursor) query.set("cursor", cursor);
          const response = await root.fetch(`/api/public/venue-grid/${encodeURIComponent(venueSlug)}${query.size ? `?${query}` : ""}`, {
            credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(15000),
            headers: { "x-discovery-session": session, "x-discovery-visit": requestVisit },
          });
          const data = await response.json();
          if (requestId !== generation) return;
          if (!response.ok || !data.ok) {
            const error = new Error(data.error || "Unable to load working dancers.");
            error.status = response.status;
            throw error;
          }
          if (data.venue.slug !== venueSlug || !Array.isArray(data.dancers)) throw new Error("Unable to confirm this club’s roster.");
          venue = data.venue;
          rows.push(...data.dancers);
          cursor = data.nextCursor;
          pages++;
        } while (!append && cursor && pages < loadedPages);
        if (profileDialog.isOpen()) return;
        if (Date.now() - requestStartedAt >= maxRosterAge || (append && rosterExpired())) {
          throw new Error("Unable to confirm who’s working now. Please refresh.");
        }
        visit = requestVisit;
        dancers = [...new Map(rows.map(dancer => [dancer.id, dancer])).values()];
        nextCursor = cursor;
        loadedPages = append ? loadedPages + 1 : pages;
        if (!append) lastConfirmedAt = requestStartedAt;
        document.body.dataset.accent = venue.embedAccent || legacyAccent;
        applyTheme(document);
        render(venue);
        status.textContent = dancers.length ? "" : "No participating dancers are working here right now. Check back soon.";
      } catch (error) {
        if (requestId !== generation) return;
        if (profileDialog.isOpen()) return;
        status.textContent = error.message || "Unable to load working dancers. Please refresh.";
        // Preserve short outages, but never retain an unconfirmed roster forever.
        if ([401, 403, 404, 410].includes(error.status) || rosterExpired()) clearRoster();
      } finally {
        if (requestId === generation) {
          status.hidden = !status.textContent;
          more.hidden = !nextCursor;
          refresh.disabled = more.disabled = false;
          refresh.setAttribute("aria-busy", "false");
          results.setAttribute("aria-busy", "false");
          busy = false;
        }
      }
    }
    refresh.addEventListener("click", () => load());
    more.addEventListener("click", () => load(true));
    function refreshVisible() { if (!document.hidden) load(); }
    document.addEventListener("visibilitychange", refreshVisible);
    root.setInterval(refreshVisible, 60000);
    return load();
  }
  root.MydancrVenueEmbed = Object.freeze({ cardMarkup, applyTheme, mountProfileDialog, mount });
  if (root.document?.body?.classList.contains("venue-grid-embed")) mount(root.document);
})(window);
