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
  function mountLocationPicker(document, select) {
    const trigger = document.getElementById("citySelectButton");
    const label = document.getElementById("citySelectButtonText");
    const panel = document.getElementById("citySelectPanel");
    const list = document.getElementById("citySelectOptions");
    const scrollbar = document.getElementById("venueLocationScrollbar");
    const scrollThumb = document.getElementById("venueLocationScrollThumb");
    if (!select?.options?.length || !trigger || !label || !panel || !list) return;
    list.innerHTML = [...select.options].map(option => {
      const count = Number(option.dataset?.count);
      const stats = Number.isInteger(count) && count >= 0
        ? `<span class="city-picker-stats venue-embed-location-count">${count} dancers</span>` : "";
      return `<button class="venue-picker-option city-picker-option" type="button" role="option" data-location="${escape(option.value)}" aria-selected="${option.selected}" tabindex="-1"><span class="venue-picker-radio" aria-hidden="true"></span><span class="venue-picker-option-name">${escape(option.textContent.split(" · ")[0])}</span>${stats}</button>`;
    }).join("");
    const options = [...list.querySelectorAll("[data-location]")];
    function syncScrollbar() {
      if (!scrollbar || !scrollThumb) return;
      const range = list.scrollHeight - list.clientHeight;
      scrollbar.hidden = panel.hidden || range <= 0;
      if (scrollbar.hidden) return;
      const height = scrollbar.clientHeight;
      const thumbHeight = Math.min(height, Math.max(28, height * list.clientHeight / list.scrollHeight));
      const top = (height - thumbHeight) * Math.max(0, Math.min(1, list.scrollTop / range));
      scrollThumb.style.height = `${thumbHeight}px`;
      scrollThumb.style.transform = `translateY(${top}px)`;
    }
    function sync() {
      label.textContent = select.selectedOptions[0].textContent.split(" · ")[0];
      options.forEach(option => {
        const selected = option.dataset.location === select.value;
        option.setAttribute("aria-selected", String(selected));
        option.tabIndex = selected ? 0 : -1;
      });
    }
    function close(restoreFocus = false) {
      sync();
      panel.hidden = true;
      panel.classList.remove("is-open");
      trigger.setAttribute("aria-expanded", "false");
      if (restoreFocus) trigger.focus({ preventScroll: true });
    }
    function open() {
      sync();
      panel.hidden = false;
      panel.classList.add("is-open");
      trigger.setAttribute("aria-expanded", "true");
      (options.find(option => option.dataset.location === select.value) || options[0])?.focus();
      syncScrollbar();
    }
    list.addEventListener("scroll", syncScrollbar, { passive: true });
    root.addEventListener?.("resize", syncScrollbar);
    trigger.addEventListener("click", () => panel.hidden ? open() : close());
    trigger.addEventListener("keydown", event => {
      if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
      event.preventDefault(); open();
    });
    options.forEach((option, index) => {
      option.addEventListener("click", () => {
        const changed = select.value !== option.dataset.location;
        select.value = option.dataset.location;
        sync(); close(true);
        if (changed) select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      option.addEventListener("keydown", event => {
        if (event.key === "Escape") { event.preventDefault(); close(true); return; }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
        options.forEach((item, i) => { item.tabIndex = i === next ? 0 : -1; });
        options[next].focus();
      });
    });
    document.addEventListener("click", event => {
      if (!panel.contains(event.target) && !trigger.contains(event.target)) close();
    });
    document.addEventListener("focusin", event => {
      if (!panel.contains(event.target) && !trigger.contains(event.target)) close();
    });
    select.addEventListener("change", sync);
    select.hidden = true;
    trigger.hidden = false;
    sync();
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
    function showCount(value = "") {
      if (!count) return;
      count.textContent = value;
      count.hidden = value === "";
    }
    function render(venue) {
      const option = location();
      const visible = demo && option ? sampleRoster(dancers, option.value, Number(option.dataset.count)) : dancers;
      const displayVenue = option ? { ...venue, name: "Spearmint Rhino" } : venue;
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
      venueName.textContent = option ? "Spearmint Rhino" : venue.name;
      showCount(`${visible.length}${nextCursor && !demo ? "+" : ""}`);
    }
    async function load(append = false) {
      if (busy || (append && !nextCursor)) return;
      const requestId = ++generation;
      const option = location();
      const venueSlug = demo ? sourceSlug : option ? option.dataset.venue : sourceSlug;
      if (!venueSlug) {
        dancers = []; nextCursor = null; loadedPages = 1;
        results.innerHTML = lastMarkup = "";
        venueName.textContent = "Spearmint Rhino";
        status.textContent = "This location’s roster is not connected yet.";
        status.hidden = false; more.hidden = true;
        refresh.disabled = more.disabled = false;
        refresh.setAttribute("aria-busy", "false");
        showCount();
        results.setAttribute("aria-busy", "false");
        return;
      }
      busy = true;
      refresh.disabled = more.disabled = true;
      refresh.setAttribute("aria-busy", "true");
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
    locations?.addEventListener("change", () => {
      generation++; busy = false; loadedPages = 1; dancers = []; nextCursor = null;
      results.innerHTML = lastMarkup = "";
      showCount();
      const url = new URL(root.location.href);
      url.searchParams.set("location", locations.value);
      root.history.replaceState(null, "", url);
      return load();
    });
    mountLocationPicker(document, locations);
    refresh.addEventListener("click", () => load());
    more.addEventListener("click", () => load(true));
    function refreshVisible() { if (!document.hidden) load(); }
    document.addEventListener("visibilitychange", refreshVisible);
    root.setInterval(refreshVisible, 60000);
    return load();
  }
  root.MydancrVenueEmbed = Object.freeze({ cardMarkup, sampleRoster, applyTheme, mountLocationPicker, mount });
  if (root.document?.body?.classList.contains("venue-grid-embed")) mount(root.document);
})(window);
