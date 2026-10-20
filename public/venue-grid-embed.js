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
    const accent = /^#[0-9a-f]{6}$/i.test(document.body.dataset.accent || "") ? document.body.dataset.accent : "#7c3aed";
    const channels = accent.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
      .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    const luminance = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
    document.body.style.setProperty("--embed-accent", accent);
    document.body.style.setProperty("--embed-accent-text", luminance > .179 ? "#050507" : "#ffffff");
  }
  function sampleRoster(rows, key, count) {
    // Stable selection per location; retain the shared feed's rank order.
    const score = id => Array.from(`${key}:${id}`).reduce((hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0, 2166136261);
    const selected = new Set([...rows].sort((a, b) => score(a.id) - score(b.id) || a.id.localeCompare(b.id)).slice(0, count).map(row => row.id));
    return rows.filter(row => selected.has(row.id));
  }
  function mount(document) {
    applyTheme(document);
    const legacyAccent = document.body.dataset.accent;
    const results = document.getElementById("results");
    const status = document.getElementById("venue-status");
    const refresh = document.getElementById("venue-refresh");
    const more = document.getElementById("venue-more");
    const venueName = document.getElementById("venue-name");
    const count = document.getElementById("venue-count");
    const locations = document.getElementById("venue-location");
    const sourceSlug = document.body.dataset.venueSlug;
    const demo = document.body.dataset.demo === "true";
    // In-memory identifiers work even when third-party cookies/storage are blocked.
    const session = root.crypto.randomUUID();
    let visit = "", nextCursor = null, busy = false, loadedPages = 1, dancers = [], lastMarkup = "", generation = 0;
    function location() { return locations?.selectedOptions?.[0] || null; }
    function render(venue) {
      const option = location();
      const visible = demo && option ? sampleRoster(dancers, option.value, Number(option.dataset.count)) : dancers;
      const displayVenue = option ? { ...venue, name: `Spearmint Rhino · ${option.textContent.split(" · ")[0]}` } : venue;
      const query = new URLSearchParams();
      if (option) query.set("location", option.value);
      if (demo) query.set("demo", "1");
      const suffix = query.size ? `?${query}` : "";
      const markup = visible.map((dancer, index) => cardMarkup(dancer, displayVenue, index,
        `/embed/venues/${encodeURIComponent(venue.slug)}/dancers/${encodeURIComponent(dancer.slug)}${suffix}`)).join("");
      if (markup !== lastMarkup) {
        results.innerHTML = markup;
        lastMarkup = markup;
        results.querySelectorAll("img").forEach(image => {
          const ready = () => { image.dataset.imageState = image.naturalWidth ? "ready" : "error"; };
          image.addEventListener("load", ready, { once: true });
          image.addEventListener("error", ready, { once: true });
          if (image.complete) ready();
        });
      }
      venueName.textContent = displayVenue.name;
      if (count) count.textContent = `${visible.length}${nextCursor && !demo ? "+" : ""} working now`;
    }
    async function load(append = false) {
      if (busy || (append && !nextCursor)) return;
      const requestId = ++generation;
      const option = location();
      const venueSlug = demo ? sourceSlug : option ? option.dataset.venue : sourceSlug;
      if (!venueSlug) {
        dancers = []; nextCursor = null; loadedPages = 1;
        results.innerHTML = lastMarkup = "";
        venueName.textContent = `Spearmint Rhino · ${option.textContent.split(" · ")[0]}`;
        status.textContent = "This location’s roster is not connected yet.";
        status.hidden = false; more.hidden = true;
        refresh.disabled = more.disabled = false;
        if (count) count.textContent = "";
        results.setAttribute("aria-busy", "false");
        return;
      }
      busy = true;
      refresh.disabled = more.disabled = true;
      results.setAttribute("aria-busy", "true");
      if (!append) visit = root.crypto.randomUUID();
      const rows = append ? [...dancers] : [];
      let cursor = append ? nextCursor : null, venue, pages = 0;
      try {
        do {
          const query = new URLSearchParams();
          if (cursor) query.set("cursor", cursor);
          if (demo) query.set("demo", "1");
          const response = await root.fetch(`/api/public/venue-grid/${encodeURIComponent(venueSlug)}${query.size ? `?${query}` : ""}`, {
            credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(15000),
            headers: { "x-discovery-session": session, "x-discovery-visit": visit },
          });
          const data = await response.json();
          if (requestId !== generation) return;
          if (!response.ok || !data.ok) throw new Error(data.error || "Unable to load working dancers.");
          if (data.venue.slug !== venueSlug || !Array.isArray(data.dancers)) throw new Error("Unable to confirm this club’s roster.");
          venue = data.venue;
          rows.push(...data.dancers);
          cursor = data.nextCursor;
          pages++;
        } while (!append && cursor && pages < (demo ? 10 : loadedPages));
        dancers = [...new Map(rows.map(dancer => [dancer.id, dancer])).values()];
        nextCursor = demo ? null : cursor;
        loadedPages = append ? loadedPages + 1 : pages;
        document.body.dataset.accent = venue.embedAccent || legacyAccent;
        applyTheme(document);
        render(venue);
        status.textContent = dancers.length ? "" : "No participating dancers are working here right now. Check back soon.";
      } catch (error) {
        if (requestId !== generation) return;
        status.textContent = error.message || "Unable to load working dancers. Please refresh.";
        if (!append) {
          dancers = []; nextCursor = null; loadedPages = 1; results.innerHTML = lastMarkup = "";
          if (count) count.textContent = "";
        }
      } finally {
        if (requestId === generation) {
          status.hidden = !status.textContent;
          more.hidden = !nextCursor;
          refresh.disabled = more.disabled = false;
          results.setAttribute("aria-busy", "false");
          busy = false;
        }
      }
    }
    locations?.addEventListener("change", () => {
      generation++; busy = false; loadedPages = 1; dancers = []; nextCursor = null;
      results.innerHTML = lastMarkup = "";
      if (count) count.textContent = "";
      const url = new URL(root.location.href);
      url.searchParams.set("location", locations.value);
      root.history.replaceState(null, "", url);
      return load();
    });
    refresh.addEventListener("click", () => load());
    more.addEventListener("click", () => load(true));
    function refreshVisible() { if (!document.hidden) load(); }
    document.addEventListener("visibilitychange", refreshVisible);
    root.setInterval(refreshVisible, 60000);
    return load();
  }
  root.MydancrVenueEmbed = Object.freeze({ cardMarkup, sampleRoster, applyTheme, mount });
  if (root.document?.body?.classList.contains("venue-grid-embed")) mount(root.document);
})(window);
