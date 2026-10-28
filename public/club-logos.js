/* Fit visible club artwork, including uploads with transparent or black margins. */
(function () {
  "use strict";
  if (window.MydancrClubLogos) return;
  const selector = [
    "img[data-club-logo]", ".venue-review-logo img", ".venue-dashboard-logo img",
    "img.home-venue-discovery-logo", "img.venue-card-logo", "img.venue-detail-logo",
    "img.ir-venue-logo", ".club-entry-brand > img", "img.venue-embed-logo",
    ".customer-favorite-club-logo img", ".venue-demo-brand img"
  ].join(",");
  const cache = new Map();
  const watched = new Set();
  const revisions = new WeakMap();

  function readBounds(image) {
    const width = image.naturalWidth, height = image.naturalHeight;
    if (!width || !height) return null;
    const factor = Math.min(1, 240 / Math.max(width, height));
    const w = Math.max(1, Math.round(width * factor)), h = Math.max(1, Math.round(height * factor));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0, w, h);
    const pixels = context.getImageData(0, 0, w, h).data;
    const corners = [0, (w - 1) * 4, (h - 1) * w * 4, (w * h - 1) * 4];
    const background = [0, 0, 0, 0];
    for (const offset of corners) for (let c = 0; c < 4; c++) background[c] += pixels[offset + c] / 4;
    let left = w, top = h, right = -1, bottom = -1, count = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const offset = (y * w + x) * 4, alpha = pixels[offset + 3];
      if (alpha <= 18) continue;
      // Black artboards disappear into the site's dark logo surfaces.
      if (Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2]) <= 32) continue;
      const delta = Math.hypot(pixels[offset] - background[0], pixels[offset + 1] - background[1], pixels[offset + 2] - background[2]);
      if (!(background[3] < 28 ? alpha >= 44 : delta >= 52 || Math.abs(alpha - background[3]) >= 52)) continue;
      left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x); bottom = Math.max(bottom, y); count++;
    }
    if (count < w * h * .001) return null;
    return { width, height, w: (right - left + 1) / w, h: (bottom - top + 1) / h,
      x: (left + right + 1) / (2 * w), y: (top + bottom + 1) / (2 * h) };
  }

  function measure(image, source) {
    if (cache.has(source)) return cache.get(source);
    let pending;
    try {
      pending = Promise.resolve(readBounds(image));
    } catch {
      // Keep displaying the original even when a remote host denies CORS.
      pending = new Promise(resolve => {
        const sample = new Image();
        sample.crossOrigin = "anonymous";
        sample.onload = () => { try { resolve(readBounds(sample)); } catch { resolve(null); } };
        sample.onerror = () => resolve(null);
        sample.src = source;
      });
    }
    if (cache.size >= 100) cache.delete(cache.keys().next().value);
    cache.set(source, pending);
    return pending;
  }

  function apply(image, bounds) {
    let scale = 1, centerX = .5, centerY = .5;
    if (bounds && image.clientWidth && image.clientHeight) {
      const ratio = bounds.width / bounds.height, boxRatio = image.clientWidth / image.clientHeight;
      const paintedWidth = Math.min(1, ratio / boxRatio), paintedHeight = Math.min(1, boxRatio / ratio);
      const w = bounds.w * paintedWidth, h = bounds.h * paintedHeight;
      scale = Math.min(4, Math.max(1, Math.min(.94 / w, .94 / h)));
      centerX = .5 + (bounds.x - .5) * paintedWidth;
      centerY = .5 + (bounds.y - .5) * paintedHeight;
    }
    const shiftX = (.5 - centerX) * scale * 100, shiftY = (.5 - centerY) * scale * 100;
    image.style.setProperty("--venue-logo-scale", scale.toFixed(4));
    image.style.setProperty("--venue-logo-shift-x", `${shiftX.toFixed(4)}%`);
    image.style.setProperty("--venue-logo-shift-y", `${shiftY.toFixed(4)}%`);
    image.style.setProperty("transform", `translate(${shiftX.toFixed(4)}%, ${shiftY.toFixed(4)}%) scale(${scale.toFixed(4)})`, "important");
    image.style.setProperty("transform-origin", "center", "important");
    image.style.setProperty("object-fit", "contain", "important");
    image.style.setProperty("object-position", "center", "important");
    // Clip the enlarged canvas to its original slot, keeping artwork inside it
    // without letting empty artboard pixels cover adjacent labels or controls.
    const inset = [centerY - .5 / scale, 1 - centerX - .5 / scale, 1 - centerY - .5 / scale, centerX - .5 / scale];
    image.style.setProperty("clip-path", `inset(${inset.map(value => `${(Math.max(0, value) * 100).toFixed(4)}%`).join(" ")})`, "important");
  }

  async function fit(image) {
    if (!(image instanceof HTMLImageElement) || !image.complete || !image.naturalWidth) return;
    if (image.getAttribute?.("data-club-logo-fit") === "contain") return;
    const source = image.currentSrc || image.src;
    const revision = (revisions.get(image) || 0) + 1;
    revisions.set(image, revision);
    const bounds = await measure(image, source);
    if (image.isConnected && revisions.get(image) === revision && (image.currentSrc || image.src) === source) apply(image, bounds);
  }

  const resize = typeof ResizeObserver === "function" ? new ResizeObserver(entries => {
    for (const entry of entries) void fit(entry.target);
  }) : null;
  function scan(root) {
    const images = root instanceof HTMLImageElement && root.matches(selector) ? [root] : [];
    if (root.querySelectorAll) images.push(...root.querySelectorAll(selector));
    for (const image of images) {
      if (image.getAttribute?.("data-club-logo-fit") === "contain") continue;
      if (!watched.has(image)) { watched.add(image); resize?.observe(image); }
      void fit(image);
    }
  }
  function start() {
    scan(document);
    document.addEventListener("load", event => {
      if (event.target instanceof HTMLImageElement && event.target.matches(selector)) scan(event.target);
    }, true);
    new MutationObserver(records => {
      for (const record of records) {
        if (record.type === "attributes") {
          if (record.target.matches(selector)) {
            if (record.target.getAttribute?.("data-club-logo-fit") === "contain") continue;
            revisions.set(record.target, (revisions.get(record.target) || 0) + 1);
            apply(record.target, null);
            scan(record.target);
          }
        } else for (const node of record.addedNodes) scan(node);
      }
      for (const image of watched) if (!image.isConnected) { resize?.unobserve(image); watched.delete(image); }
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "srcset"] });
    if (!resize) window.addEventListener("resize", () => { for (const image of watched) void fit(image); });
  }
  window.MydancrClubLogos = { fit };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
