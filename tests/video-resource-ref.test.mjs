import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
const source = readFileSync("src/lib/dancr/video-resource-ref.ts", "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const paints = new Map();
let nextPaint = 0;
const context = vm.createContext({ exports: {}, window: {
  requestAnimationFrame(callback) { paints.set(++nextPaint, callback); return nextPaint; },
  cancelAnimationFrame(id) { paints.delete(id); },
} });
vm.runInContext(compiled, context);
const { videoResourceRef, watchVideoPosterPresentation } = context.exports;
function video() {
  const events = new Map(), frames = new Map();
  let nextFrame = 0;
  return { paused: false, preload: "auto", dataset: { frameReady: "true" }, source: true, loads: 0, pauses: 0,
    events, frames, isConnected: true, readyState: 2,
    addEventListener(name, callback) { events.set(name, callback); },
    removeEventListener(name) { events.delete(name); },
    fire(name) { events.get(name)?.(); },
    requestVideoFrameCallback(callback) { frames.set(++nextFrame, callback); return nextFrame; },
    cancelVideoFrameCallback(id) { frames.delete(id); },
    getAttribute(name) { return name === "src" && this.source ? "clip.mp4" : null; },
    pause() { this.paused = true; this.pauses++; },
    hasAttribute(name) { return name === "src" && this.source; },
    removeAttribute(name) { if (name === "src") this.source = false; },
    load() { this.loads++; } };
}
test("attaching preserves playback; detaching releases the exact retained element", () => {
  const active = video();
  const cleanup = videoResourceRef(active);
  assert.equal(active.pauses, 0);
  assert.equal(active.source, true);
  cleanup();
  assert.equal(active.paused, true);
  assert.equal(active.source, false);
  assert.equal(active.preload, "none");
  assert.equal(active.loads, 1);
  assert.equal(active.dataset.frameReady, undefined);
  cleanup();
  assert.equal(active.loads, 1, "an already released source is not loaded again");
});

test("preloading and playing alone keep the poster until a frame is presented", () => {
  const v = video(); delete v.dataset.frameReady;
  const cleanup = watchVideoPosterPresentation(v);
  v.fire("loadeddata");
  assert.equal(v.dataset.frameReady, undefined);
  assert.equal(v.frames.size, 0, "paused preload never starts a playback or frame loop");
  v.fire("playing"); v.fire("playing");
  assert.equal(v.frames.size, 1, "only one presentation callback per new source");
  assert.equal(v.dataset.frameReady, undefined);
  [...v.frames.values()][0]();
  assert.equal(v.dataset.frameReady, "true");
  v.fire("waiting"); v.fire("pause");
  assert.equal(v.dataset.frameReady, "true", "buffering and pausing retain the displayed frame");
  cleanup();
});

test("source release and cleanup cancel pending frame reveals, including callbacks already queued", () => {
  for (const event of ["emptied", "error", "cleanup"]) {
    const v = video(); delete v.dataset.frameReady;
    const cleanup = watchVideoPosterPresentation(v);
    v.fire("playing");
    const stale = [...v.frames.values()][0];
    if (event === "cleanup") cleanup(); else v.fire(event);
    assert.equal(v.frames.size, 0);
    stale();
    assert.equal(v.dataset.frameReady, undefined, event);
    if (event !== "cleanup") {
      v.fire("playing");
      stale();
      cleanup();
      assert.equal(v.frames.size, 0, "a stale callback cannot discard the new cancellation handle");
    }
  }
});

test("detached players and discarded media cannot hide the poster", () => {
  for (const change of [v => { v.isConnected = false; }, v => { v.source = false; }, v => { v.readyState = 0; }]) {
    const v = video(); delete v.dataset.frameReady;
    const cleanup = watchVideoPosterPresentation(v);
    v.fire("playing"); change(v);
    [...v.frames.values()][0]();
    assert.equal(v.dataset.frameReady, undefined);
    cleanup();
  }
});

test("older browsers wait for playing and a paint opportunity; interrupted playback keeps its poster", () => {
  for (const interrupted of [false, true]) {
    const v = video(); delete v.dataset.frameReady; v.requestVideoFrameCallback = undefined;
    const cleanup = watchVideoPosterPresentation(v);
    v.fire("loadeddata");
    assert.equal(paints.size, 0);
    v.fire("playing");
    const tick = () => { const [id, callback] = [...paints][0]; paints.delete(id); callback(); };
    tick();
    assert.equal(v.dataset.frameReady, undefined);
    v.paused = interrupted;
    tick();
    assert.equal(v.dataset.frameReady, interrupted ? undefined : "true");
    cleanup();
    assert.equal(paints.size, 0);
  }
});

test("TV and profile feeds share the same presentation handoff without changing preload policy", () => {
  const shell = readFileSync("outputs/index.html", "utf8");
  const functionText = shell.match(/    function watchVideoPosterPresentation\([^]*?\n    \}/)?.[0].replace(/^    /gm, "").trim();
  const tree = ts.createSourceFile("ref.ts", source, ts.ScriptTarget.Latest, true);
  const declaration = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === "watchVideoPosterPresentation");
  const expected = ts.transpileModule(declaration.getText(tree).replace("export ", ""), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText.trim();
  assert.equal(functionText, expected);
  assert.match(shell, /poster.className = "home-tv-feed-poster"/);
  assert.match(shell, /const children = \[\s*fallback,\s*video,\s*poster,/);
  assert.match(shell, /\.home-tv-feed-video\[data-frame-ready="true"\] \+ .home-tv-feed-poster/);
  const createVideo = shell.match(/    function createHomeTvFeedVideo\([^]*?\n    \}/)?.[0];
  const profileSlides = shell.match(/    function renderProfileTvViewerSlides\([^]*?\n    \}/)?.[0];
  for (const create of [createVideo, profileSlides]) assert.match(create, /watchVideoPosterPresentation\(video\)/);
  assert.doesNotMatch(profileSlides, /dataset.frameReady = "true"/);
  const carousel = readFileSync("app/dancers/[slug]/DancerPhotoCarousel.tsx", "utf8");
  assert.doesNotMatch(carousel, /dataset.frameReady = "true"/);
});
test("removing one video never interrupts another mounted player", () => {
  const previous = video(), current = video();
  const cleanup = videoResourceRef(previous);
  videoResourceRef(current);
  cleanup();
  assert.equal(current.paused, false);
  assert.equal(current.source, true);
  assert.equal(current.loads, 0);
  assert.equal(videoResourceRef(null), undefined);
});
test("the profile uses one stable resource ref across ordinary renders", () => {
  const carousel = readFileSync("app/dancers/[slug]/DancerPhotoCarousel.tsx", "utf8");
  assert.match(carousel, /import \{ videoResourceRef \} from "@\/src\/lib\/dancr\/video-resource-ref"/);
  assert.match(carousel, /<video\s+ref=\{videoResourceRef\}/);
});
