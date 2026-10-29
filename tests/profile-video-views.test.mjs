import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = fs.readFileSync("public/profile-video-views.js", "utf8");
const videoId = "8b5e3b8f-a6f8-497d-875c-001122334455";

function fixture({ storageBlocked = false, fetchResult } = {}) {
  let clock = Date.parse("2026-10-29T12:00:00Z"), timerId = 0;
  const timers = new Map(), requests = [], storage = new Map();
  const win = new EventTarget(), doc = new EventTarget();
  Object.assign(win, {
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { at: clock + delay, callback }); return id; },
    clearTimeout(id) { timers.delete(id); },
    localStorage: {
      getItem(key) { if (storageBlocked) throw Error("blocked"); return storage.get(key); },
      setItem(key, value) { if (storageBlocked) throw Error("blocked"); storage.set(key, value); },
    },
    crypto: { randomUUID: () => "stable-browser-session" },
    fetch: async (url, init) => {
      requests.push({ url, ...init, body: JSON.parse(init.body) });
      return fetchResult ? fetchResult() : { ok: true };
    },
  });
  Object.assign(doc, { defaultView: win, visibilityState: "visible" });
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } }
  const context = vm.createContext({ window: win, Date: ClockDate });
  vm.runInContext(source, context);
  const tracker = win.MyDancrProfileVideoViews;
  function createVideo(options = {}) {
    const video = new EventTarget();
    Object.assign(video, { ownerDocument: doc, isConnected: true, paused: true, ended: false, seeking: false, readyState: 4, muted: true });
    const dispose = tracker.mount(video, { videoId, ...options });
    const emit = (name, values = {}) => { Object.assign(video, values); video.dispatchEvent(new Event(name)); };
    return { video, dispose, emit, play: () => emit("playing", { paused: false }) };
  }
  async function advance(ms) {
    const until = clock + ms;
    while (true) {
      const entry = [...timers.entries()].filter(([, task]) => task.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry) break;
      const [id, task] = entry;
      timers.delete(id);
      clock = task.at;
      task.callback();
      await Promise.resolve();
      await Promise.resolve();
    }
    clock = until;
  }
  return { win, doc, tracker, requests, storage, timers, createVideo, advance };
}

test("muted profile playback records one engaged view after three seconds with the existing React TV session", async () => {
  const f = fixture();
  f.storage.set("mydancrTvViewerSessionV1", "existing-tv-session");
  const p = f.createVideo({ getAccessToken: () => "test-token" });
  await f.advance(5000);
  assert.equal(f.requests.length, 0, "loading a card does not count");
  p.play();
  await f.advance(2999);
  assert.equal(f.requests.length, 0);
  await f.advance(1);
  assert.equal(f.requests.length, 1);
  const request = f.requests[0];
  assert.equal(request.url, `/api/public/tv/${videoId}/events`);
  assert.equal(request.method, "POST");
  assert.equal(request.headers.Authorization, "Bearer test-token");
  assert.deepEqual(request.body, { eventType: "engaged_view", source: "dancer_profile", sessionId: "existing-tv-session" });
  p.emit("playing");
  await f.advance(3000);
  p.dispose();
  f.createVideo().play();
  await f.advance(3000);
  assert.equal(f.requests.length, 1, "loops and reopening the same video do not inflate totals");
});

test("pauses, buffering, seeking, errors and source release restart the three-second threshold", async () => {
  for (const event of ["pause", "waiting", "seeking", "ended", "emptied", "error"]) {
    const f = fixture(), p = f.createVideo();
    p.play();
    await f.advance(2500);
    p.emit(event);
    await f.advance(1000);
    assert.equal(f.requests.length, 0, event);
    p.play();
    await f.advance(2999);
    assert.equal(f.requests.length, 0, event);
    await f.advance(1);
    assert.equal(f.requests.length, 1, event);
  }
});

test("hidden, inactive, detached and unready videos never qualify; disposal removes listeners and timers", async () => {
  for (const state of ["hidden", "inactive", "detached", "unready", "paused", "ended", "seeking", "disposed"]) {
    const f = fixture();
    let active = true;
    const p = f.createVideo({ isActive: () => active });
    p.play();
    await f.advance(2500);
    if (state === "hidden") { f.doc.visibilityState = "hidden"; f.doc.dispatchEvent(new Event("visibilitychange")); }
    if (state === "inactive") active = false;
    if (state === "detached") p.video.isConnected = false;
    if (state === "unready") p.video.readyState = 2;
    if (state === "paused") p.video.paused = true;
    if (state === "ended") p.video.ended = true;
    if (state === "seeking") p.video.seeking = true;
    if (state === "disposed") p.dispose();
    await f.advance(5000);
    assert.equal(f.requests.length, 0, state);
    p.dispose();
    p.play();
    f.doc.dispatchEvent(new Event("visibilitychange"));
    f.win.dispatchEvent(new Event("pageshow"));
    assert.equal(f.timers.size, 0, state);
  }
});

test("returning from a hidden page starts a fresh threshold instead of counting background time", async () => {
  const f = fixture(), p = f.createVideo();
  p.play();
  await f.advance(2000);
  f.doc.visibilityState = "hidden";
  f.doc.dispatchEvent(new Event("visibilitychange"));
  await f.advance(20000);
  f.doc.visibilityState = "visible";
  f.doc.dispatchEvent(new Event("visibilitychange"));
  await f.advance(2999);
  assert.equal(f.requests.length, 0);
  await f.advance(1);
  assert.equal(f.requests.length, 1);
});

test("session and UTC date dedup preserve the live shell session and strip playback variants", async () => {
  const f = fixture();
  let session = "web-live-shell-session";
  const p = f.createVideo({ videoId: `${videoId}~mobile`, getSessionId: () => session });
  p.play();
  await f.advance(3000);
  assert.equal(f.requests[0].body.sessionId, session);
  assert.equal(f.requests[0].headers.Authorization, undefined, "anonymous viewing is supported");
  assert.equal(f.requests[0].url, `/api/public/tv/${videoId}/events`);
  await f.advance(24 * 60 * 60 * 1000);
  p.play();
  await f.advance(3000);
  assert.equal(f.requests.length, 2, "a new UTC day can count again");
  session = "another-browser-session";
  p.play();
  await f.advance(3000);
  assert.equal(f.requests.length, 3);
});

test("simultaneous viewers share in-flight dedup until the request completes", async () => {
  let finish;
  const response = new Promise((resolve) => { finish = resolve; });
  const f = fixture({ fetchResult: () => response });
  const players = [f.createVideo(), f.createVideo(), f.createVideo()];
  players.forEach((p) => p.play());
  await f.advance(3000);
  assert.equal(f.requests.length, 1);
  players[2].play();
  await f.advance(3000);
  assert.equal(f.requests.length, 1);
  finish({ ok: true });
  await Promise.resolve();
});

test("network failure can retry on a later play and blocked storage keeps a stable session", async () => {
  let attempt = 0;
  const f = fixture({ storageBlocked: true, fetchResult: () => {
    if (++attempt === 1) throw Error("offline");
    return { ok: attempt !== 2 };
  } });
  const p = f.createVideo();
  for (let index = 0; index < 4; index++) { p.play(); await f.advance(3000); }
  assert.equal(f.requests.length, 3, "failed requests do not permanently suppress a view");
  assert.equal(new Set(f.requests.map((request) => request.body.sessionId)).size, 1);
});

test("invalid preview IDs are ignored and an already-playing video can mount safely", async () => {
  const f = fixture();
  f.createVideo({ videoId: "local-preview" }).play();
  await f.advance(5000);
  assert.equal(f.requests.length, 0);
  const p = f.createVideo();
  p.dispose();
  p.video.paused = false;
  const dispose = f.tracker.mount(p.video, { videoId });
  await f.advance(3000);
  assert.equal(f.requests.length, 1);
  dispose();
});

test("React gallery tracks only the selected public viewer and excludes editor and profile previews", () => {
  const carousel = fs.readFileSync("app/dancers/[slug]/DancerPhotoCarousel.tsx", "utf8").replace(/\r\n?/g, "\n");
  const guard = carousel.indexOf('if (preview || !trackVideoViews || viewerKind !== "video")');
  const start = carousel.lastIndexOf("  useEffect(() => {", guard);
  const end = carousel.indexOf("\n\n", guard);
  const effect = ts.transpileModule(carousel.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const [preview, trackVideoViews, viewerKind, expected] of [[false, true, "video", 1], [true, true, "video", 0], [false, false, "video", 0], [false, true, "photo", 0], [false, true, null, 0]]) {
    const mounts = [], cleanups = [], selected = {};
    vm.runInNewContext(effect, {
      preview, trackVideoViews, viewerKind, viewerIndex: 1,
      viewerFeed: { current: { querySelectorAll: () => [{}, selected] } },
      videoMedia: [{ id: "first" }, { id: videoId }],
      readBrowserAccessToken: () => "token",
      profileVideoViews: { mount: (video, options) => { mounts.push({ video, options }); return () => cleanups.push(true); } },
      useEffect: (callback) => callback()?.(),
    });
    assert.equal(mounts.length, expected);
    assert.equal(cleanups.length, expected);
    if (expected) { assert.equal(mounts[0].video, selected); assert.equal(mounts[0].options.videoId, videoId); }
  }
  assert.match(fs.readFileSync("app/dashboard/DancerProfileEditor.tsx", "utf8"), /<DancerPhotoCarousel\s+featured\s+trackVideoViews=\{false\}/);
});

test("live profile viewer excludes private previews, cleans up on rebuild and close, and loads the tracker", () => {
  const live = fs.readFileSync("src/live-shell/app/13-open-profile-modal.js", "utf8");
  assert.match(live, /publicDancerId = isPrivatePreview \|\| internal \? ""/);
  assert.match(live, /overlay\.dataset\.publicDancerId = profileModal\.dataset\.publicDancerId/);
  assert.match(live, /if \(overlay\.dataset\.publicDancerId\) \{\s+overlay\.profileTvViewCleanups\.push\(window\.MyDancrProfileVideoViews\.mount/);
  assert.match(live, /isActive: \(\) => !overlay\.hidden && video === activeProfileTvViewerVideo\(\)/);
  assert.match(live, /getSessionId: dancrLiveSessionId/);
  assert.match(live, /disposeProfileTvViewTracking\(overlay\);\s+stage\.innerHTML = ""/);
  assert.match(live, /const returnTarget = overlay\.profileTvReturnTarget;\s+disposeProfileTvViewTracking\(overlay\)/);
  assert.match(fs.readFileSync("src/live-shell/shell.html", "utf8"), /src="\/profile-video-views\.js/);
  assert.match(fs.readFileSync("src/lib/dancr/static-asset-paths.mjs", "utf8"), /"\/profile-video-views\.js"/);
});
