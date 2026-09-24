(() => {
  "use strict";
  const selector = "[data-public-dancer-id]";
  const storageKey = "mydancrDancerVisibilityChangedV1";
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const states = new Map();
  const watched = new Set();
  const needsRecheck = new Set();
  const unpublished = new Set();
  const suspendedMedia = new WeakMap();
  const placeholders = new WeakMap();
  let pending = null;
  let timer = 0;
  let generation = 0;
  const style = document.createElement("style");
  style.textContent = '[data-public-visibility-hidden]{display:none!important} .public-visibility-message{padding:80px 24px;text-align:center;color:#eee}.public-visibility-message a{color:inherit}';
  document.head.appendChild(style);

  function elements() {
    return [...document.querySelectorAll(selector)].filter(element => uuid.test(element.dataset.publicDancerId || ""));
  }

  function suspendMedia(root) {
    if (document.fullscreenElement && root.contains(document.fullscreenElement)) void document.exitFullscreen().catch(() => {});
    if (document.pictureInPictureElement && root.contains(document.pictureInPictureElement)) void document.exitPictureInPicture().catch(() => {});
    root.querySelectorAll("video, audio").forEach(media => {
      media.pause();
      const sources = [media, ...media.querySelectorAll("source")];
      if (!suspendedMedia.has(media)) suspendedMedia.set(media, sources.map(source => [source, source.getAttribute("src")]));
      sources.forEach(source => source.removeAttribute("src"));
      media.load();
    });
  }

  function setVisible(element, visible) {
    const wasHidden = element.hasAttribute("data-public-visibility-hidden");
    if (!visible) {
      element.setAttribute("data-public-visibility-hidden", "");
      // Also catches newly mounted or reattached media inside a hidden card.
      if (!wasHidden || [...element.querySelectorAll("video, audio")].some(media => !media.paused || media.hasAttribute("src"))) suspendMedia(element);
      if (element.hasAttribute("data-public-profile-page") && !placeholders.has(element)) {
        const message = document.createElement("section");
        message.className = "public-visibility-message";
        message.setAttribute("role", "status");
        message.innerHTML = '<p>This profile is currently unavailable.</p><a href="/?view=dancers">Browse dancers</a>';
        element.after(message);
        placeholders.set(element, message);
      }
    } else if (wasHidden) {
      element.removeAttribute("data-public-visibility-hidden");
      placeholders.get(element)?.remove();
      placeholders.delete(element);
      element.querySelectorAll("video, audio").forEach(media => {
        suspendedMedia.get(media)?.forEach(([source, src]) => { if (src) source.setAttribute("src", src); });
        suspendedMedia.delete(media);
      });
    }
  }

  function apply() {
    elements().forEach(element => {
      const id = element.dataset.publicDancerId.toLowerCase();
      const state = states.get(id);
      if (document.visibilityState === "hidden") needsRecheck.add(id);
      if (state !== undefined) setVisible(element, !needsRecheck.has(id) && state);
    });
  }

  function schedule(delay = 5000) {
    window.clearTimeout(timer);
    timer = window.setTimeout(check, delay);
  }

  async function check() {
    timer = 0;
    if (document.visibilityState === "hidden" || pending) return;
    const currentIds = elements().map(element => element.dataset.publicDancerId.toLowerCase());
    currentIds.forEach(id => watched.add(id));
    // Keep checking removed entries so a background feed refresh cannot lose
    // the signal that an incognito dancer has become public again.
    const ids = [...new Set([...currentIds, ...[...watched].filter(id => states.get(id) === false)])];
    if (!ids.length) return;
    const controller = new AbortController();
    const version = generation;
    pending = controller;
    const deadline = window.setTimeout(() => controller.abort(), 4500);
    const hiddenIds = [];
    const restoredIds = [];
    try {
      for (let start = 0; start < ids.length; start += 200) {
        const batch = ids.slice(start, start + 200);
        let visible = new Set();
        let confirmed = false;
        try {
          const response = await fetch(`/api/public/dancers/visibility?ids=${batch.join(",")}`, {
            cache: "no-store", credentials: "omit", signal: controller.signal,
          });
          const data = await response.json();
          if (!response.ok || data.ok !== true || !Array.isArray(data.visibleIds) || data.visibleIds.some(id => !batch.includes(id))) throw new Error("Unavailable");
          visible = new Set(data.visibleIds);
          confirmed = true;
        } catch { /* Hide content until its public visibility can be confirmed. */ }
        if (generation !== version) return;
        if (batch.some(id => visible.has(id) && unpublished.has(id))) {
          // Read the current page again instead of exposing an old snapshot:
          // the dancer may have edited or removed media while incognito.
          window.location.reload();
          return;
        }
        batch.forEach(id => {
          const next = visible.has(id);
          if (confirmed && !next) unpublished.add(id);
          if (!next && states.get(id) !== false) hiddenIds.push(id);
          if (next && states.get(id) === false) restoredIds.push(id);
          needsRecheck.delete(id);
          states.set(id, next);
        });
        apply();
      }
      if (hiddenIds.length || restoredIds.length) {
        window.dispatchEvent(new CustomEvent("mydancr:public-visibility", { detail: { hiddenIds, restoredIds } }));
      }
    } finally {
      window.clearTimeout(deadline);
      if (pending === controller) pending = null;
      schedule(generation === version ? 5000 : 0);
    }
  }

  function changed(detail) {
    if (!detail || !uuid.test(detail.dancerId || "") || typeof detail.isPublic !== "boolean") return;
    generation += 1;
    pending?.abort();
    if (!detail.isPublic) {
      states.set(detail.dancerId.toLowerCase(), false);
      unpublished.add(detail.dancerId.toLowerCase());
      apply();
      window.dispatchEvent(new CustomEvent("mydancr:public-visibility", { detail: { hiddenIds: [detail.dancerId], restoredIds: [] } }));
    } else {
      window.dispatchEvent(new CustomEvent("mydancr:public-visibility", { detail: { hiddenIds: [], restoredIds: [detail.dancerId] } }));
    }
    // A cross-tab message can hide content, but only a public server read can
    // restore it. An older in-flight response cannot undo a completed toggle.
    schedule(0);
  }
  window.addEventListener("mydancr:dancer-visibility-saved", event => {
    changed(event.detail);
    try { localStorage.setItem(storageKey, JSON.stringify({ ...event.detail, at: Date.now() })); } catch { /* Optional cross-tab signal. */ }
  });
  window.addEventListener("storage", event => {
    if (event.key !== storageKey || !event.newValue) return;
    try { changed(JSON.parse(event.newValue)); } catch { /* Ignore invalid messages. */ }
  });
  function resume() { schedule(0); }
  function concealUntilChecked() {
    elements().forEach(element => {
      needsRecheck.add(element.dataset.publicDancerId.toLowerCase());
      setVisible(element, false);
    });
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      generation += 1;
      pending?.abort();
      concealUntilChecked();
    } else resume();
  });
  window.addEventListener("pageshow", event => {
    if (event.persisted) concealUntilChecked();
    resume();
  });
  window.addEventListener("focus", resume);
  document.addEventListener("play", event => {
    if (event.target.closest?.("[data-public-visibility-hidden]")) event.target.pause();
  }, true);
  new MutationObserver(() => {
    apply();
    if (!pending && (!timer || elements().some(element => !states.has(element.dataset.publicDancerId.toLowerCase())))) schedule(100);
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-public-dancer-id"] });
  resume();
})();
