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
      <header><h2 id="videoCropTitle">Crop & trim video</h2><p>Choose your framing and up to 30 seconds.</p></header>
      <p class="video-crop-status" role="status">Loading video…</p>
      <div class="video-crop-workspace" hidden>
        <div class="video-crop-frame" tabindex="0" role="group" aria-label="Video framing. Drag or use arrow keys to reposition."><video playsinline preload="metadata"></video><span aria-hidden="true" class="video-crop-guides"></span></div>
        <p class="video-crop-hint">Drag the video to reposition</p>
        <div class="video-crop-tools"><label>Shape<select name="shape"><option value="portrait">Portrait</option><option value="square">Square</option></select></label><button type="button" name="preview">Play clip</button></div>
        <label>Zoom<input name="zoom" aria-label="Zoom" type="range" min="1" max="3" step="0.01" value="1"></label>
        <div class="video-crop-times"><label>Start <output name="startTime"></output><input aria-label="Clip start" name="start" type="range" min="0" step="0.1" value="0"></label><label>End <output name="endTime"></output><input aria-label="Clip end" name="end" type="range" min="1" step="0.1"></label></div>
        <p class="video-crop-length" aria-live="polite"></p>
      </div>
      <footer><button type="button" name="cancel">Cancel</button><button type="button" name="use" class="video-crop-confirm" disabled>Use video</button></footer>
    </form>`;
    const find = name => dialog.querySelector(`[name="${name}"]`);
    const video = dialog.querySelector("video");
    const frame = dialog.querySelector(".video-crop-frame");
    const status = dialog.querySelector(".video-crop-status");
    const start = find("start"), end = find("end"), zoom = find("zoom"), shape = find("shape");
    let metadata, rectangle, offsetX = 0.5, offsetY = 0.5, drag;
    let finished = false, timer;
    const duration = () => Math.floor(metadata.durationSeconds * 10) / 10;
    const pause = () => { video.pause(); find("preview").textContent = "Play clip"; };
    function render() {
      const ratio = shape.value === "square" ? 1 : 9 / 16;
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
      dialog.querySelector(".video-crop-length").textContent = `${(Number(end.value) - Number(start.value)).toFixed(1)} sec selected · 30 sec max`;
    }
    return new Promise((resolve, reject) => {
      function finish(result, error) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort);
        window.removeEventListener("pagehide", abort);
        video.onloadedmetadata = video.onerror = video.ontimeupdate = video.onended = null;
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
        video.currentTime = Number(start.value);
        try { await video.play(); if (!finished) find("preview").textContent = "Pause clip"; }
        catch { if (!finished) status.textContent = "Preview unavailable. Try another video."; }
      };
      video.ontimeupdate = () => { if (video.currentTime >= Number(end.value)) pause(); };
      video.onended = pause;
      start.oninput = () => {
        pause();
        end.min = String(Number(start.value) + 1);
        end.max = String(Math.min(duration(), Number(start.value) + MAX_SECONDS));
        end.value = String(Math.max(Number(end.min), Math.min(Number(end.value), Number(end.max))));
        video.currentTime = Number(start.value); render();
      };
      end.oninput = () => { pause(); video.currentTime = Math.max(Number(start.value), Number(end.value) - 0.05); render(); };
      shape.onchange = () => { zoom.value = "1"; offsetX = offsetY = 0.5; render(); };
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
        if (!Number.isFinite(video.duration) || video.duration < 1 || video.duration > 600 || Math.min(video.videoWidth, video.videoHeight) < 240 || Math.max(video.videoWidth, video.videoHeight) > 7680) {
          finish(null, new Error("Choose a video 1 second to 10 minutes long, at least 240 pixels on each side.")); return;
        }
        metadata = { durationSeconds: video.duration, width: video.videoWidth, height: video.videoHeight, mimeType: file.type, fileSize: file.size };
        if (Math.min(metadata.width, metadata.height * 9 / 16) < 240) {
          shape.value = "square"; shape.querySelector('[value="portrait"]').disabled = true;
        } else if (metadata.width === metadata.height) shape.value = "square";
        start.max = String(duration() - 1);
        end.max = String(Math.min(MAX_SECONDS, duration())); end.value = end.max;
        status.textContent = "";
        dialog.querySelector(".video-crop-workspace").hidden = false;
        find("use").disabled = false;
        render();
        video.currentTime = Math.min(0.05, video.duration / 2);
      };
      video.onerror = () => finish(null, new Error("This video cannot be previewed in this browser. Choose a compatible MP4, WebM, or MOV file."));
      timer = setTimeout(() => finish(null, new Error("Video preview took too long to load. Please try another video.")), 20000);
      options.signal?.addEventListener("abort", abort, { once: true });
      window.addEventListener("pagehide", abort, { once: true });
      document.body.appendChild(dialog);
      try { dialog.showModal(); video.src = url; }
      catch (error) { finish(null, error); }
    });
  }
  window.DancrVideoCrop = { crop };
})();
