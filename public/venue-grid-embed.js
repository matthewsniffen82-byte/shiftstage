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
  function mount(document) {
    applyTheme(document);
    const legacyAccent = document.body.dataset.accent;
    const results = document.getElementById("results");
    const status = document.getElementById("venue-status");
    const refresh = document.getElementById("venue-refresh");
    const more = document.getElementById("venue-more");
    const venueName = document.getElementById("venue-name");
    const venueLogo = document.getElementById("venue-logo");
    venueLogo?.addEventListener("error", () => { venueLogo.hidden = true; });
    const count = document.getElementById("venue-count");
    const sourceSlug = document.body.dataset.venueSlug;
    // In-memory identifiers work even when third-party cookies/storage are blocked.
    const session = root.crypto.randomUUID();
    const watchedImages = new WeakSet();
    let visit = "", nextCursor = null, busy = false, loadedPages = 1, dancers = [], lastMarkup = "", generation = 0;
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
      if (busy || (append && !nextCursor)) return;
      const requestId = ++generation;
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
        visit = requestVisit;
        dancers = [...new Map(rows.map(dancer => [dancer.id, dancer])).values()];
        nextCursor = cursor;
        loadedPages = append ? loadedPages + 1 : pages;
        document.body.dataset.accent = venue.embedAccent || legacyAccent;
        applyTheme(document);
        render(venue);
        status.textContent = dancers.length ? "" : "No participating dancers are working here right now. Check back soon.";
      } catch (error) {
        if (requestId !== generation) return;
        status.textContent = error.message || "Unable to load working dancers. Please refresh.";
        // Network/server failures must not erase an already loaded roster.
        // Confirmed loss of access or an unavailable club still clears it.
        if ([401, 403, 404, 410].includes(error.status)) {
          dancers = []; nextCursor = null; loadedPages = 1; results.innerHTML = lastMarkup = "";
          venueName.textContent = "";
          if (venueLogo) { venueLogo.hidden = true; venueLogo.removeAttribute("src"); }
          showCount();
        }
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
  root.MydancrVenueEmbed = Object.freeze({ cardMarkup, applyTheme, mount });
  if (root.document?.body?.classList.contains("venue-grid-embed")) mount(root.document);
})(window);
