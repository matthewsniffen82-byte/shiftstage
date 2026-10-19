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
  function cardMarkup(dancer, venue, index) {
    const sources = imageSources(dancer.primaryPhotoSrcSet);
    const photo = sources.find(source => source.width >= 320)?.url || sources.at(-1)?.url || safeImageUrl(dancer.primaryPhotoUrl || "");
    const srcset = list => list.map(source => `${escape(source.url)} ${source.width}w`).join(", ");
    const mobile = sources.filter(source => source.width <= 320);
    const photoMarkup = photo
      ? `<picture class="photo-thumbnail">${mobile.length ? `<source media="(max-width: 520px)" sizes="calc((100vw - 20px) / 3)" srcset="${srcset(mobile)}">` : ""}<img class="home-dancer-grid-photo has-custom-photo" src="${escape(photo)}"${sources.length ? ` srcset="${srcset(sources)}"` : ""} sizes="(max-width: 720px) calc((100vw - 20px) / 3), (max-width: 1280px) calc((100vw - 64px) / 3), 390px" width="360" height="640" loading="${index < 12 ? "eager" : "lazy"}" fetchpriority="${index < 12 ? "high" : "auto"}" decoding="async" draggable="false" alt="" aria-hidden="true" data-image-state="loading"></picture>`
      : `<div class="home-dancer-grid-photo" aria-hidden="true">${escape(String(dancer.stageName).trim().charAt(0))}</div>`;
    return grid.render({ id: dancer.id, name: dancer.stageName, reference: dancer.id,
      href: `/dancers/${encodeURIComponent(dancer.slug)}`, newTab: true, compact: true,
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
  function profileMarkup(profile, venue) {
    const photo = safeImageUrl(profile.primaryPhotoUrl);
    const href = `/dancers/${encodeURIComponent(profile.slug)}`;
    const photos = profile.photos || [], videos = profile.videos || [];
    const media = (items, kind) => items.map((item, index) => {
      const thumbnails = kind === "photo" ? imageSources(item.imageSrcSet) : [];
      const image = thumbnails.find(source => source.width >= 320)?.url || safeImageUrl(kind === "photo" ? item.imageUrl : item.posterUrl);
      return `<button class="venue-embed-media-tile" data-media-kind="${kind}" data-media-index="${index}" aria-label="Open ${escape(profile.stageName)} ${kind} ${index + 1}">${image ? `<img src="${escape(image)}" alt="" loading="lazy" decoding="async">` : ""}${kind === "video" ? '<span class="venue-embed-play" aria-hidden="true">▶</span>' : ""}</button>`;
    }).join("");
    return `<div class="venue-embed-profile-hero"><div class="venue-embed-profile-copy"><h2>${escape(profile.stageName)}</h2><p>${escape(profile.city)}</p><p class="venue-embed-live">● Working now</p><strong>${escape(venue.name)}</strong><a class="venue-embed-primary" href="${href}" target="_blank" rel="noopener noreferrer">Open full profile ↗</a><p class="venue-embed-note">Follow and free entry on MyDancr.</p></div>${photo ? `<img class="venue-embed-portrait" src="${escape(photo)}" alt="${escape(profile.stageName)}" decoding="async">` : '<div class="venue-embed-portrait"></div>'}</div>
      <div class="venue-embed-media-tabs" aria-label="Profile media"><button type="button" data-media-tab="photos" aria-pressed="true">Photos ${photos.length}</button><button type="button" data-media-tab="videos" aria-pressed="false">Videos ${videos.length}</button></div>
      <div class="venue-embed-media-grid" data-media-panel="photos">${media(photos, "photo") || '<p>No photos yet.</p>'}</div>
      <div class="venue-embed-media-grid" data-media-panel="videos" hidden>${media(videos, "video") || '<p>No videos yet.</p>'}</div>`;
  }
  function mount(document) {
    applyTheme(document);
    const results = document.getElementById("results");
    const status = document.getElementById("venue-status");
    const refresh = document.getElementById("venue-refresh");
    const more = document.getElementById("venue-more");
    const venueName = document.getElementById("venue-name");
    const directory = document.getElementById("venue-directory");
    const profileSection = document.getElementById("venue-profile");
    const profileContent = document.getElementById("venue-profile-content");
    const profileStatus = document.getElementById("venue-profile-status");
    const profileBack = document.getElementById("venue-profile-back");
    const mediaDialog = document.getElementById("venue-media-dialog");
    const mediaContent = document.getElementById("venue-media-content");
    const endpoint = `/api/public/venue-grid/${encodeURIComponent(document.body.dataset.venueSlug)}`;
    // In-memory identifiers work even when third-party cookies/storage are blocked.
    const session = root.crypto.randomUUID();
    let visit = "", nextCursor = null, busy = false, loadedPages = 1, dancers = [], lastMarkup = "";
    let selectedSlug = "", selectedProfile = null, profileRequest = 0, profileReturn = null, profileSignature = "";
    function closeMedia() {
      mediaDialog.close();
      mediaContent.innerHTML = ""; // Also stops video playback.
    }
    async function openProfile(slug, recheck = false) {
      const requestId = ++profileRequest;
      selectedSlug = slug;
      if (!recheck) {
        profileReturn = document.activeElement;
        directory.hidden = true; profileSection.hidden = false;
        profileContent.innerHTML = ""; profileSignature = "";
        profileStatus.textContent = "Loading profile…";
        profileSection.focus(); root.scrollTo(0, 0);
      }
      try {
        const response = await root.fetch(`${endpoint}/dancers/${encodeURIComponent(slug)}`, { credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(15000) });
        const data = await response.json();
        if (requestId !== profileRequest) return;
        if (!response.ok || !data.ok || data.venue.slug !== document.body.dataset.venueSlug) throw new Error(data.error || "Profile unavailable.");
        selectedProfile = data.profile;
        const signature = JSON.stringify(data.profile);
        if (signature !== profileSignature) {
          closeMedia(); profileContent.innerHTML = profileMarkup(data.profile, data.venue); profileSignature = signature;
        }
        profileStatus.textContent = data.profile.secondaryUnavailable ? "Some media is temporarily unavailable." : "";
      } catch (error) {
        if (requestId !== profileRequest) return;
        selectedProfile = null; profileSignature = ""; profileContent.innerHTML = ""; closeMedia();
        profileStatus.textContent = error.message || "Profile unavailable. Return to Working now and try again.";
      }
    }
    results.addEventListener("click", event => {
      const link = event.target.closest?.(".home-dancer-grid-link");
      if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button > 0) return;
      const dancer = dancers.find(row => row.id === link.closest("[data-public-dancer-id]")?.dataset.publicDancerId);
      if (!dancer) return;
      event.preventDefault(); openProfile(dancer.slug);
    });
    profileBack.addEventListener("click", () => {
      selectedSlug = ""; selectedProfile = null; profileRequest++; closeMedia();
      profileContent.innerHTML = ""; profileSection.hidden = true; directory.hidden = false;
      profileReturn?.focus(); load();
    });
    profileContent.addEventListener("click", event => {
      const tab = event.target.closest?.("[data-media-tab]");
      if (tab) {
        profileContent.querySelectorAll("[data-media-tab]").forEach(button => button.setAttribute("aria-pressed", String(button === tab)));
        profileContent.querySelectorAll("[data-media-panel]").forEach(panel => { panel.hidden = panel.dataset.mediaPanel !== tab.dataset.mediaTab; });
        return;
      }
      const tile = event.target.closest?.("[data-media-kind]");
      if (!tile || !selectedProfile) return;
      const video = tile.dataset.mediaKind === "video";
      const media = (video ? selectedProfile.videos : selectedProfile.photos)?.[Number(tile.dataset.mediaIndex)];
      const url = safeImageUrl(video ? media?.videoUrl : media?.imageUrl);
      if (!url) return;
      mediaContent.innerHTML = video ? `<video src="${escape(url)}" controls playsinline autoplay></video>` : `<img src="${escape(url)}" alt="${escape(selectedProfile.stageName)}">`;
      mediaDialog.showModal();
    });
    document.getElementById("venue-media-close").addEventListener("click", closeMedia);
    mediaDialog.addEventListener("close", () => { mediaContent.innerHTML = ""; });
    function render(venue) {
      const markup = dancers.map((dancer, index) => cardMarkup(dancer, venue, index)).join("");
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
    }
    async function load(append = false) {
      if (busy || (append && !nextCursor)) return;
      busy = true;
      refresh.disabled = more.disabled = true;
      results.setAttribute("aria-busy", "true");
      if (!append) visit = root.crypto.randomUUID(); // Include new check-ins on every refresh.
      const rows = append ? [...dancers] : [];
      let cursor = append ? nextCursor : null, venue, pages = 0;
      try {
        do {
          const response = await root.fetch(endpoint + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""), {
            credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(15000),
            headers: { "x-discovery-session": session, "x-discovery-visit": visit },
          });
          const data = await response.json();
          if (!response.ok || !data.ok) throw new Error(data.error || "Unable to load working dancers.");
          if (data.venue.slug !== document.body.dataset.venueSlug || !Array.isArray(data.dancers)) throw new Error("Unable to confirm this club’s roster.");
          venue = data.venue;
          rows.push(...data.dancers);
          cursor = data.nextCursor;
          pages++;
        } while (!append && cursor && pages < loadedPages);
        dancers = [...new Map(rows.map(dancer => [dancer.id, dancer])).values()];
        nextCursor = cursor;
        loadedPages = append ? loadedPages + 1 : pages;
        venueName.textContent = venue.name;
        render(venue);
        // Cards retain a real public URL for no-JS / modified-click fallbacks.
        results.querySelectorAll(".home-dancer-grid-link").forEach(link => {
          link.removeAttribute("target");
          link.setAttribute("aria-label", link.getAttribute("aria-label").replace(" (opens in a new tab)", ""));
        });
        status.textContent = dancers.length ? "" : "No participating dancers are working here right now. Check back soon.";
      } catch (error) {
        status.textContent = error.message || "Unable to load working dancers. Please refresh.";
        if (!append) { dancers = []; nextCursor = null; loadedPages = 1; results.innerHTML = lastMarkup = ""; }
      } finally {
        status.hidden = !status.textContent;
        more.hidden = !nextCursor;
        refresh.disabled = more.disabled = false;
        results.setAttribute("aria-busy", "false");
        busy = false;
      }
    }
    refresh.addEventListener("click", () => load());
    more.addEventListener("click", () => load(true));
    function refreshVisible() { if (!document.hidden) { load(); if (selectedSlug) openProfile(selectedSlug, true); } }
    document.addEventListener("visibilitychange", refreshVisible);
    root.setInterval(refreshVisible, 60000);
    return load();
  }
  root.MydancrVenueEmbed = Object.freeze({ cardMarkup, profileMarkup, applyTheme, mount });
  if (root.document?.body?.classList.contains("venue-grid-embed")) mount(root.document);
})(window);
