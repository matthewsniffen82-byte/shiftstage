(function () {
  "use strict";
  const MAX_SECONDS = 30;
  const MAX_BYTES = 25 * 1024 * 1024;
  let active = false;
  const confirmed = new WeakMap();
  const even = n => Math.floor(n / 2) * 2;
  const time = n => `${Math.floor(n / 60)}:${(n % 60).toFixed(1).padStart(4, "0")}`;

  async function crop(file, options = {}) {
    if (options.signal?.aborted) throw new DOMException("Video selection closed.", "AbortError");
    if (confirmed.has(file)) return confirmed.get(file);
    if (active) throw new Error("Finish editing the current video first.");
    if (!["video/mp4", "video/webm", "video/quicktime"].includes(file?.type)) throw new Error("Choose an MP4, WebM, or MOV video.");
    if (file.size < 1 || file.size > MAX_BYTES) throw new Error("Video files must be 25 MB or smaller.");
    active = true;
    const previousFocus = document.activeElement;
    const url = URL.createObjectURL(file);
    const dialog = document.createElement("dialog");
    dialog.className = "dancr-video-crop";
    dialog.setAttribute("aria-labelledby", "videoCropTitle");
    dialog.innerHTML = `<form method="dialog" class="video-crop-panel">
      <header><h2 id="videoCropTitle">Crop & trim video</h2><p>Portrait (9:16) · 30 seconds max</p></header>
      <p class="video-crop-status" role="status">Loading video…</p>
      <div class="video-crop-workspace" hidden>
        <div class="video-crop-frame" tabindex="0" role="group" aria-label="Video framing. Drag or use arrow keys to reposition."><video playsinline preload="auto"></video><span aria-hidden="true" class="video-crop-guides"></span></div>
        <p class="video-crop-hint">Drag to reposition</p>
        <div class="video-crop-tools"><label>Zoom<input name="zoom" aria-label="Zoom" type="range" min="1" max="3" step="0.01" value="1"></label><button type="button" name="preview">Play clip</button></div>
        <div class="video-crop-times"><label for="videoCropStart">Start <output name="startTime" for="videoCropStart"></output></label><label for="videoCropEnd">End <output name="endTime" for="videoCropEnd"></output></label></div>
        <div class="video-crop-trim" role="group" aria-label="Trim clip"><span class="video-crop-trim-track" aria-hidden="true"></span><input id="videoCropStart" aria-label="Clip start" name="start" type="range" min="0" step="0.1" value="0"><input id="videoCropEnd" aria-label="Clip end" name="end" type="range" min="0" step="0.1"></div>
        <p class="video-crop-length" aria-live="polite"></p>
      </div>
      <footer><button type="button" name="cancel">Cancel</button><button type="button" name="use" class="video-crop-confirm" disabled>Use video</button></footer>
    </form>`;
    const find = name => dialog.querySelector(`[name="${name}"]`);
    const video = dialog.querySelector("video");
    const frame = dialog.querySelector(".video-crop-frame");
    const panel = dialog.querySelector("form");
    const viewport = window.visualViewport;
    const status = dialog.querySelector(".video-crop-status");
    const start = find("start"), end = find("end"), zoom = find("zoom");
    const trim = dialog.querySelector(".video-crop-trim");
    let metadata, rectangle, offsetX = 0.5, offsetY = 0.5, drag;
    let trimDrag;
    let finished = false, timer;
    let previewTarget = null, previewFrame = 0, playRequest = 0;
    const duration = () => Math.floor(metadata.durationSeconds * 10) / 10;
    const pause = () => { playRequest++; video.pause(); find("preview").textContent = "Play clip"; };
    function clearPreviewSeek() {
      previewTarget = null;
      window.cancelAnimationFrame(previewFrame); previewFrame = 0;
    }
    function schedulePreviewSeek() {
      if (finished || previewTarget === null || previewFrame || video.seeking) return;
      previewFrame = window.requestAnimationFrame(() => {
        previewFrame = 0;
        if (finished || previewTarget === null || video.seeking) return;
        const target = previewTarget;
        previewTarget = null;
        if (Math.abs(video.currentTime - target) > 0.001) video.currentTime = target;
      });
    }
    function previewAt(seconds) {
      if (!metadata || finished) return;
      pause();
      // Let the current seek decode, retaining only the latest handle position.
      // Restarting a seek on every pointer move can starve the visible preview.
      previewTarget = seconds;
      schedulePreviewSeek();
    }
    function render() {
      if (!metadata || finished) return;
      const ratio = 9 / 16;
      const baseWidth = Math.min(metadata.width, metadata.height * ratio);
      zoom.max = String(Math.max(1, Math.min(3, baseWidth / 240)));
      zoom.value = String(Math.min(Number(zoom.value), Number(zoom.max)));
      const width = Math.max(240, even(baseWidth / Number(zoom.value)));
      const height = Math.min(even(metadata.height), even(width / ratio));
      rectangle = { x: even((metadata.width - width) * offsetX), y: even((metadata.height - height) * offsetY), width, height };
      frame.style.aspectRatio = `${width} / ${height}`;
      video.style.width = `${metadata.width / width * 100}%`;
      video.style.height = `${metadata.height / height * 100}%`;
      video.style.left = `${-rectangle.x / width * 100}%`;
      video.style.top = `${-rectangle.y / height * 100}%`;
      find("startTime").value = time(Number(start.value));
      find("endTime").value = time(Number(end.value));
      trim.style.setProperty("--trim-start", `${Number(start.value) / duration() * 100}%`);
      trim.style.setProperty("--trim-end", `${Number(end.value) / duration() * 100}%`);
      start.setAttribute("aria-valuemax", String(Number(end.value) - 1));
      end.setAttribute("aria-valuemin", String(Number(start.value) + 1));
      start.setAttribute("aria-valuetext", `${Number(start.value).toFixed(1)} seconds`);
      end.setAttribute("aria-valuetext", `${Number(end.value).toFixed(1)} seconds`);
      dialog.querySelector(".video-crop-length").textContent = `${(Number(end.value) - Number(start.value)).toFixed(1)} sec selected`;
      // Match the photo cropper: up to 400px wide, bounded by the real
      // controls and visible viewport instead of a small fixed-height preview.
      const styles = getComputedStyle(dialog), panelStyles = getComputedStyle(panel);
      const pixels = value => Number.parseFloat(value) || 0;
      const viewportHeight = Math.min(window.innerHeight, viewport?.height ?? window.innerHeight);
      const maxHeight = Math.min(pixels(styles.maxHeight) || viewportHeight - 24, viewportHeight - 24);
      const chromeHeight = panel.getBoundingClientRect().height - frame.getBoundingClientRect().height
        + pixels(styles.paddingTop) + pixels(styles.paddingBottom)
        + pixels(styles.borderTopWidth) + pixels(styles.borderBottomWidth);
      const availableWidth = panel.clientWidth - pixels(panelStyles.paddingLeft) - pixels(panelStyles.paddingRight);
      const previewWidth = Math.max(1, Math.floor(Math.min(400, availableWidth, Math.max(1, maxHeight - chromeHeight - 2) * width / height)));
      dialog.style.setProperty("--crop-preview-width", `${previewWidth}px`);
    }
    return new Promise((resolve, reject) => {
      function finish(result, error) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        clearPreviewSeek();
        options.signal?.removeEventListener("abort", abort);
        window.removeEventListener("pagehide", abort);
        window.removeEventListener("resize", render);
        viewport?.removeEventListener("resize", render);
        video.onloadedmetadata = video.onerror = video.ontimeupdate = video.onended = video.onseeked = null;
        pause(); video.removeAttribute("src"); video.load();
        URL.revokeObjectURL(url);
        dialog.close(); dialog.remove(); active = false;
        if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
        if (error) reject(error); else resolve(result);
      }
      function abort() { finish(null, new DOMException("Video selection closed.", "AbortError")); }
      dialog.querySelector("form").onsubmit = event => event.preventDefault();
      dialog.addEventListener("cancel", event => { event.preventDefault(); finish(null); });
      find("cancel").onclick = () => finish(null);
      find("use").onclick = () => {
        if (!metadata || !rectangle) return;
        const result = { version: 1, source: metadata, startSeconds: Number(start.value), endSeconds: Number(end.value), crop: rectangle };
        confirmed.set(file, result);
        finish(result);
      };
      find("preview").onclick = async () => {
        if (!video.paused) return pause();
        clearPreviewSeek();
        const request = ++playRequest;
        video.currentTime = Number(start.value);
        try { await video.play(); if (!finished && request === playRequest) find("preview").textContent = "Pause clip"; }
        catch { if (!finished && request === playRequest) status.textContent = "Preview unavailable. Try another video."; }
      };
      video.ontimeupdate = () => { if (!video.paused && video.currentTime >= Number(end.value)) pause(); };
      video.onended = pause;
      video.onseeked = () => {
        if (finished) return;
        window.cancelAnimationFrame(previewFrame);
        // Give the decoded frame a paint before seeking again, even while dragging.
        previewFrame = window.requestAnimationFrame(() => {
          previewFrame = 0; schedulePreviewSeek();
        });
      };
      start.oninput = () => {
        start.value = String(Math.max(0, Math.min(Number(start.value), Number(end.value) - 1)));
        previewAt(Number(start.value)); render();
      };
      end.oninput = () => {
        end.value = String(Math.min(duration(), Math.max(Number(end.value), Number(start.value) + 1)));
        previewAt(Math.max(Number(start.value), Number(end.value) - 0.05)); render();
      };
      // Both native sliders share the full timeline. Delegate pointer gestures
      // so either handle remains reachable even when their touch areas overlap.
      const pointerTime = event => {
        const bounds = trim.getBoundingClientRect();
        return Math.max(0, Math.min(1, (event.clientX - bounds.left - 22) / Math.max(1, bounds.width - 44))) * duration();
      };
      const moveTrim = event => {
        if (!trimDrag || event.pointerId !== trimDrag.pointerId) return;
        trimDrag.control.value = String(Math.round(pointerTime(event) * 10) / 10);
        trimDrag.control.oninput();
      };
      trim.onpointerdown = event => {
        if (!metadata || trimDrag || event.button !== 0) return;
        event.preventDefault();
        const point = pointerTime(event);
        const control = Math.abs(point - Number(start.value)) <= Math.abs(point - Number(end.value)) ? start : end;
        trimDrag = { control, pointerId: event.pointerId };
        control.focus({ preventScroll: true });
        trim.setPointerCapture(event.pointerId);
        moveTrim(event);
      };
      trim.onpointermove = moveTrim;
      trim.onpointerup = trim.onpointercancel = trim.onlostpointercapture = event => {
        if (event.pointerId === trimDrag?.pointerId) trimDrag = null;
      };
      zoom.oninput = render;
      frame.onpointerdown = event => {
        if (!metadata) return;
        frame.setPointerCapture(event.pointerId);
        drag = { x: event.clientX, y: event.clientY, offsetX, offsetY };
      };
      frame.onpointermove = event => {
        if (!drag) return;
        const scale = frame.clientWidth / rectangle.width;
        offsetX = Math.max(0, Math.min(1, drag.offsetX - (event.clientX - drag.x) / (scale * (metadata.width - rectangle.width) || 1)));
        offsetY = Math.max(0, Math.min(1, drag.offsetY - (event.clientY - drag.y) / (scale * (metadata.height - rectangle.height) || 1)));
        render();
      };
      frame.onpointerup = frame.onpointercancel = frame.onlostpointercapture = () => { drag = null; };
      frame.onkeydown = event => {
        if (!metadata || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault();
        offsetX = Math.max(0, Math.min(1, offsetX + (event.key === "ArrowLeft" ? 0.03 : event.key === "ArrowRight" ? -0.03 : 0)));
        offsetY = Math.max(0, Math.min(1, offsetY + (event.key === "ArrowUp" ? 0.03 : event.key === "ArrowDown" ? -0.03 : 0)));
        render();
      };
      video.onloadedmetadata = () => {
        clearTimeout(timer);
        if (Number.isFinite(video.duration) && video.duration > MAX_SECONDS) {
          finish(null, new Error("Over 30 seconds")); return;
        }
        if (!Number.isFinite(video.duration) || video.duration < 1 || !Number.isInteger(video.videoWidth) || !Number.isInteger(video.videoHeight) || Math.min(video.videoWidth, video.videoHeight) < 240 || Math.max(video.videoWidth, video.videoHeight) > 7680) {
          finish(null, new Error("Choose a video between 1 and 30 seconds, at least 240 pixels on each side.")); return;
        }
        metadata = { durationSeconds: video.duration, width: video.videoWidth, height: video.videoHeight, mimeType: file.type, fileSize: file.size };
        if (Math.min(metadata.width, metadata.height * 9 / 16) < 240) {
          finish(null, new Error("Choose a higher-resolution video for a portrait crop.")); return;
        }
        start.max = String(duration());
        end.max = String(Math.min(MAX_SECONDS, duration())); end.value = end.max;
        status.textContent = "";
        dialog.querySelector(".video-crop-workspace").hidden = false;
        find("use").disabled = false;
        render();
        previewAt(Math.min(0.05, video.duration / 2));
      };
      video.onerror = () => finish(null, new Error("This video cannot be previewed in this browser. Choose a compatible MP4, WebM, or MOV file."));
      timer = setTimeout(() => finish(null, new Error("Video preview took too long to load. Please try another video.")), 20000);
      options.signal?.addEventListener("abort", abort, { once: true });
      window.addEventListener("pagehide", abort, { once: true });
      window.addEventListener("resize", render);
      viewport?.addEventListener("resize", render);
      document.body.appendChild(dialog);
      try { dialog.showModal(); video.src = url; }
      catch (error) { finish(null, error); }
    });
  }
  // A batch can upload concurrently, but people must edit one clip at a time.
  // Cancel queued editors immediately without opening them later.
  let queue = Promise.resolve();
  function queueCrop(file, options = {}) {
    const task = queue.then(() => crop(file, options));
    queue = task.catch(() => {});
    if (!options.signal) return task;
    return new Promise((resolve, reject) => {
      const abort = () => reject(new DOMException("Video selection closed.", "AbortError"));
      if (options.signal.aborted) abort();
      else options.signal.addEventListener("abort", abort, { once: true });
      task.then(resolve, reject).finally(() => options.signal.removeEventListener("abort", abort));
    });
  }
  window.DancrVideoCrop = { crop: queueCrop };
})();
