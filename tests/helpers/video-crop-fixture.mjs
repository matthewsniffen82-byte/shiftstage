import { readFileSync } from "node:fs";
import vm from "node:vm";

export function videoCropFixture({ deferSeeks = false } = {}) {
  const timers = new Map(), frames = new Map(), urls = new Set(), nodes = new Map(), seeks = [];
  let sequence = 0, dialogRemoved = false, focusRestored = false;
  const style = () => ({ setProperty(name, value) { this[name] = value; } });
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { value: "", style: style(), attributes: {}, textContent: "", clientWidth: 180, querySelector: node,
      setAttribute(name, value) { this.attributes[name] = value; }, focus() { this.focused = true; }, setPointerCapture(id) { this.capturedPointer = id; } });
    return nodes.get(selector);
  };
  const video = node("video");
  Object.assign(video, { duration: 30, videoWidth: 640, videoHeight: 480, readyState: 2, loads: 0, paused: true,
    pause() { this.paused = true; }, async play() { this.paused = false; }, load() { this.loads++; }, removeAttribute() { this.src = ""; } });
  let currentTime = 0;
  video.seeking = false; video.displayedTime = 0;
  Object.defineProperty(video, 'currentTime', {
    get: () => currentTime,
    set(value) { currentTime = value; seeks.push(value); video.seeking = deferSeeks; if (!deferSeeks) video.displayedTime = value; },
  });
  const settleSeek = () => { video.seeking = false; video.displayedTime = currentTime; video.onseeked?.(); };
  const dialog = { open: false, showCount: 0, style: { setProperty(name, value) { this[name] = value; } }, querySelector: node, setAttribute() {}, addEventListener(name, fn) { this[name] = fn; },
    showModal() { this.open = true; this.showCount++; }, close() { this.open = false; }, remove() { dialogRemoved = true; } };
  const viewport = Object.assign(new EventTarget(), { height: 700 });
  const window = Object.assign(new EventTarget(), { innerHeight: 700, visualViewport: viewport });
  window.requestAnimationFrame = fn => { const id = ++sequence; frames.set(id, fn); return id; };
  window.cancelAnimationFrame = id => frames.delete(id);
  const paint = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn()); };
  const frame = node('.video-crop-frame'), panel = node('form');
  const trim = node('.video-crop-trim');
  trim.getBoundingClientRect = () => ({ left: 0, width: 300 });
  frame.getBoundingClientRect = () => {
    const width = Number.parseFloat(dialog.style['--crop-preview-width'] || '200');
    const [cropWidth, cropHeight] = (frame.style.aspectRatio || '9 / 16').split('/').map(Number);
    return { width, height: width * cropHeight / cropWidth };
  };
  Object.assign(panel, { clientWidth: 334, chromeHeight: 228,
    getBoundingClientRect: () => ({ height: frame.getBoundingClientRect().height + panel.chromeHeight }) });
  const scope = { window, DOMException, console,
    getComputedStyle: element => element === dialog
      ? { maxHeight: `${window.innerHeight - 24}px`, paddingTop: '0px', paddingBottom: '0px', borderTopWidth: '1px', borderBottomWidth: '1px' }
      : { paddingLeft: '14px', paddingRight: '14px' },
    document: { activeElement: { isConnected: true, focus() { focusRestored = true; } }, createElement: () => dialog, body: { appendChild() {} } },
    URL: { createObjectURL() { urls.add("blob:video"); return "blob:video"; }, revokeObjectURL(url) { urls.delete(url); } },
    setTimeout(fn, delay) { const id = ++sequence; timers.set(id, { fn, delay }); return id; }, clearTimeout(id) { timers.delete(id); },
  };
  vm.runInNewContext(readFileSync(new URL("../../public/profile-video-crop.js", import.meta.url), "utf8"), scope);
  const control = name => node(`[name="${name}"]`);
  control("start").value = "0"; control("zoom").value = "1";
  const file = { type: "video/mp4", size: 1024 };
  return { crop: window.DancrVideoCrop.crop, file, control, video, dialog, timers, frame, panel, trim, viewport, window, seeks, settleSeek, paint,
    released() { return { urls: urls.size, timers: timers.size, frames: frames.size, dialogRemoved, focusRestored, source: Boolean(video.src), handlers: Boolean(video.onloadedmetadata || video.onloadeddata || video.oncanplay || video.onerror || video.ontimeupdate || video.onseeked), paused: video.paused, loads: video.loads }; } };
}
