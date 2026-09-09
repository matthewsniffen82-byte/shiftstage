(function () {
  "use strict";
  if (window.DancrPhotoCrop) return;
  const confirmed = new WeakMap();
  let active = false;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function cropRect(width, height, ratio, zoom, x, y) {
    if (![width, height, ratio, zoom, x, y].every(Number.isFinite) || width <= 0 || height <= 0 || ratio <= 0) throw new Error("Invalid photo dimensions.");
    const scale = clamp(zoom, 1, 3);
    const w = Math.min(width, height * ratio) / scale;
    const h = w / ratio;
    return { x: Math.max(0, width - w) * clamp(x, 0, 1), y: Math.max(0, height - h) * clamp(y, 0, 1), width: w, height: h };
  }

  function cardRatio() {
    const probe = document.createElement("div");
    probe.className = "profile-media-card-feed";
    probe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;width:min(730px,100%);left:0;top:0";
    const card = document.createElement("div");
    card.style.cssText = "height:var(--profile-media-card-height);width:calc(100% - 10px)";
    probe.append(card);
    document.body.append(probe);
    const rect = card.getBoundingClientRect();
    probe.remove();
    if (!rect.width || !rect.height) throw new Error("Photo card styles are still loading. Please try again.");
    return rect.width / rect.height;
  }

  function crop(file, options) {
    if (options.signal?.aborted) return Promise.reject(new DOMException("Photo selection closed.", "AbortError"));
    if (confirmed.has(file)) return Promise.resolve(confirmed.get(file));
    if (active) return Promise.reject(new Error("Finish the current photo crop first."));
    if (!file.size || file.size > 25 * 1024 * 1024) return Promise.reject(new Error("Photos must be 25 MB or smaller."));
    let ratio;
    try { ratio = cardRatio(); } catch (error) { return Promise.reject(error); }
    active = true;
    return new Promise((resolve, reject) => {
      const previousFocus = document.activeElement;
      const dialog = document.createElement("dialog");
      dialog.className = "dancr-photo-crop";
      dialog.setAttribute("aria-label", "Crop profile photo");
      dialog.innerHTML = '<h2>Fit your photo to the card</h2><p>Drag to position, then adjust zoom. Framing may vary slightly by screen.</p><div data-crop-frame hidden><canvas tabindex="0" role="img" aria-label="Photo crop preview. Use arrow keys to reposition the photo."></canvas></div><label data-crop-zoom hidden>Zoom<input type="range" min="1" max="3" step="0.01" value="1" aria-label="Photo zoom"></label><div data-crop-actions><button type="button" data-crop-cancel>Cancel</button><button type="button" data-crop-reset disabled>Reset</button><button type="button" data-crop-confirm disabled>Use photo</button><button type="button" data-crop-retry hidden>Retry</button></div><p data-crop-status role="status" aria-live="polite">Preparing your photo…</p>';
      const canvas = dialog.querySelector("canvas");
      const frame = dialog.querySelector("[data-crop-frame]");
      const range = dialog.querySelector("input");
      const confirm = dialog.querySelector("[data-crop-confirm]");
      const reset = dialog.querySelector("[data-crop-reset]");
      const retry = dialog.querySelector("[data-crop-retry]");
      const status = dialog.querySelector("[data-crop-status]");
      const controller = new AbortController();
      let image = null, settled = false, saving = false, pointer = null;
      let zoom = 1, x = .5, y = .5;
      function finish(value, error) {
        if (settled) return;
        settled = true;
        active = false;
        controller.abort();
        options.signal?.removeEventListener("abort", abort);
        window.removeEventListener("resize", draw);
        window.removeEventListener("pagehide", abort);
        dialog.close();
        dialog.remove();
        canvas.width = canvas.height = 0;
        if (image) image.src = "";
        if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
        if (error) reject(error); else resolve(value);
      }
      function abort() { finish(null, new DOMException("Photo selection closed.", "AbortError")); }
      function draw() {
        if (!image || settled) return;
        const previewWidth = Math.max(80, Math.min(400, document.documentElement.clientWidth - 64, Math.max(120, window.innerHeight - 270) * ratio));
        dialog.style.setProperty("--crop-preview-width", `${previewWidth}px`);
        canvas.width = Math.round(previewWidth * 2);
        canvas.height = Math.round(canvas.width / ratio);
        const rect = cropRect(image.naturalWidth, image.naturalHeight, ratio, zoom, x, y);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
      }
      async function prepare() {
        retry.hidden = true;
        status.textContent = "Preparing your photo…";
        try {
          const dataUrl = await options.prepare(file, controller.signal);
          if (settled) return;
          if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/jpeg;base64,")) throw new Error("Unable to prepare this photo.");
          const nextImage = new Image();
          nextImage.src = dataUrl;
          await nextImage.decode();
          if (settled) { nextImage.src = ""; return; }
          image = nextImage;
          frame.hidden = false;
          dialog.querySelector("[data-crop-zoom]").hidden = false;
          confirm.disabled = reset.disabled = false;
          status.textContent = "Your photo is added to your profile only after you choose Use photo.";
          draw();
          canvas.focus({ preventScroll: true });
        } catch (error) {
          if (settled) return;
          status.textContent = error instanceof Error ? error.message : "Unable to prepare this photo.";
          retry.hidden = false;
        }
      }
      canvas.addEventListener("pointerdown", (event) => {
        if (saving || !image) return;
        pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
        canvas.setPointerCapture(event.pointerId);
      });
      canvas.addEventListener("pointermove", (event) => {
        if (!pointer || pointer.id !== event.pointerId || saving) return;
        const rect = cropRect(image.naturalWidth, image.naturalHeight, ratio, zoom, x, y);
        const size = canvas.getBoundingClientRect();
        const overflowX = image.naturalWidth - rect.width, overflowY = image.naturalHeight - rect.height;
        if (overflowX > 0) x = clamp(x - (event.clientX - pointer.x) * rect.width / size.width / overflowX, 0, 1);
        if (overflowY > 0) y = clamp(y - (event.clientY - pointer.y) * rect.height / size.height / overflowY, 0, 1);
        pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
        draw();
      });
      for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) canvas.addEventListener(name, () => { pointer = null; });
      canvas.addEventListener("keydown", (event) => {
        if (saving || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault();
        const step = event.shiftKey ? .1 : .02;
        if (event.key === "ArrowLeft") x = clamp(x + step, 0, 1);
        if (event.key === "ArrowRight") x = clamp(x - step, 0, 1);
        if (event.key === "ArrowUp") y = clamp(y + step, 0, 1);
        if (event.key === "ArrowDown") y = clamp(y - step, 0, 1);
        draw();
      });
      range.addEventListener("input", () => { if (!saving) { zoom = Number(range.value); draw(); } });
      reset.addEventListener("click", () => { zoom = 1; x = y = .5; range.value = "1"; draw(); });
      retry.addEventListener("click", () => { void prepare(); });
      dialog.querySelector("[data-crop-cancel]").addEventListener("click", () => finish(null));
      dialog.addEventListener("cancel", (event) => { event.preventDefault(); finish(null); });
      dialog.addEventListener("keydown", (event) => { if (event.key === "Escape") event.stopPropagation(); });
      confirm.addEventListener("click", () => {
        if (!image || saving) return;
        saving = true;
        confirm.disabled = reset.disabled = range.disabled = true;
        status.textContent = "Saving your crop…";
        try {
          const rect = cropRect(image.naturalWidth, image.naturalHeight, ratio, zoom, x, y);
          const output = document.createElement("canvas");
          const scale = Math.min(1, 2400 / Math.max(rect.width, rect.height));
          output.width = Math.max(1, Math.round(rect.width * scale));
          output.height = Math.max(1, Math.round(rect.height * scale));
          output.getContext("2d").drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, output.width, output.height);
          output.toBlob((blob) => {
            output.width = output.height = 0;
            if (settled) return;
            if (!blob) { finish(null, new Error("Unable to save this crop. Please try again.")); return; }
            const cropped = new File([blob], file.name.replace(/\.[^.]*$/, "") + "-card.jpg", { type: "image/jpeg", lastModified: file.lastModified });
            confirmed.set(file, cropped);
            confirmed.set(cropped, cropped);
            finish(cropped);
          }, "image/jpeg", .94);
        } catch { finish(null, new Error("Unable to save this crop. Please try again.")); }
      });
      options.signal?.addEventListener("abort", abort, { once: true });
      window.addEventListener("resize", draw);
      window.addEventListener("pagehide", abort, { once: true });
      document.body.append(dialog);
      try { dialog.showModal(); void prepare(); }
      catch { finish(null, new Error("Unable to open the photo editor. Please try again.")); }
    });
  }
  window.DancrPhotoCrop = { crop, cropRect, cardRatio };
})();
