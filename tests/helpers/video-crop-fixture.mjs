import { readFileSync } from "node:fs";
import vm from "node:vm";

export function videoCropFixture() {
  const timers = new Map(), urls = new Set(), nodes = new Map();
  let sequence = 0, dialogRemoved = false, focusRestored = false;
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { value: "", style: {}, textContent: "", clientWidth: 180, querySelector: node, setPointerCapture() {} });
    return nodes.get(selector);
  };
  const video = node("video");
  Object.assign(video, { duration: 40, videoWidth: 640, videoHeight: 480, loads: 0, paused: true,
    pause() { this.paused = true; }, async play() { this.paused = false; }, load() { this.loads++; }, removeAttribute() { this.src = ""; } });
  const dialog = { querySelector: node, setAttribute() {}, addEventListener(name, fn) { this[name] = fn; }, showModal() {}, close() {}, remove() { dialogRemoved = true; } };
  const window = { addEventListener() {}, removeEventListener() {} };
  const scope = { window, DOMException, console,
    document: { activeElement: { isConnected: true, focus() { focusRestored = true; } }, createElement: () => dialog, body: { appendChild() {} } },
    URL: { createObjectURL() { urls.add("blob:video"); return "blob:video"; }, revokeObjectURL(url) { urls.delete(url); } },
    setTimeout(fn, delay) { const id = ++sequence; timers.set(id, { fn, delay }); return id; }, clearTimeout(id) { timers.delete(id); },
  };
  vm.runInNewContext(readFileSync(new URL("../../public/profile-video-crop.js", import.meta.url), "utf8"), scope);
  const control = name => node(`[name="${name}"]`);
  control("start").value = "0"; control("zoom").value = "1"; control("shape").value = "portrait";
  const file = { type: "video/mp4", size: 1024 };
  return { crop: window.DancrVideoCrop.crop, file, control, video, dialog, timers,
    released() { return { urls: urls.size, timers: timers.size, dialogRemoved, focusRestored, source: Boolean(video.src), handlers: Boolean(video.onloadedmetadata || video.onerror || video.ontimeupdate), paused: video.paused, loads: video.loads }; } };
}
