import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

export function metadataReaderFixture(kind) {
  const legacy = kind === "legacy";
  const source = readFileSync(new URL(legacy ? "../../outputs/index.html" : "../../app/dashboard/DancerTvStudio.tsx", import.meta.url), "utf8");
  const name = legacy ? "readApprovedProfileVideoMetadata" : "readVideoMetadata";
  const start = source.indexOf(`async function ${name}(`);
  const end = source.indexOf(legacy ? "    async function submitApprovedProfileVideo(" : "function statusLabel(", start);
  const compiled = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const urls = new Set(), timers = new Map();
  let nextTimer = 0;
  const video = { duration: 12, videoWidth: 720, videoHeight: 1280, src: "", paused: false, loads: 0,
    pause() { this.paused = true; }, removeAttribute(name) { if (name === "src") this.src = ""; }, load() { this.loads++; } };
  const context = vm.createContext({
    MAX_VIDEO_DURATION_SECONDS: 30, Number, Error, Promise,
    URL: { createObjectURL() { urls.add("blob:fixture"); return "blob:fixture"; }, revokeObjectURL(url) { urls.delete(url); } },
    document: { createElement(tag) { if (tag !== "video") throw new Error("Unexpected element"); return video; } },
    window: { setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; }, clearTimeout(id) { timers.delete(id); } },
  });
  vm.runInContext(compiled, context);
  let outcome = "pending", value;
  const promise = context[name]({ type: "video/mp4", size: 1024 }).then(result => { outcome = "resolved"; value = result; }, error => { outcome = "rejected"; value = error.message; });
  return { video, urls, timers, promise, state: () => ({ outcome, value, urls: urls.size, timers: timers.size, paused: video.paused, source: Boolean(video.src), handlers: Boolean(video.onloadedmetadata || video.onerror), loads: video.loads }), async expire() { for (const [id, timer] of [...timers]) { timers.delete(id); timer.fn(); } await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); } };
}
