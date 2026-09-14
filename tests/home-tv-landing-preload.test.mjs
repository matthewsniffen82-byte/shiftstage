import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const shell = readFileSync("outputs/index.html", "utf8");
const source = name => shell.match(new RegExp("    (?:async )?function " + name + "\\([^]*?\\n    \\}"))?.[0];
const clips = Array.from({ length: 24 }, (_, index) => ({
  id: String(index), videoUrl: `/clip-${index}.mp4`, posterUrl: `/poster-${index}.jpg`, dancer: { stageName: "Dancer" },
}));

class Video {
  static HAVE_CURRENT_DATA = 2;
  static HAVE_NOTHING = 0;
  static NETWORK_EMPTY = 0;
  dataset = {};
  attrs = new Map();
  paused = true;
  readyState = 0;
  networkState = 0;
  assignments = 0;
  resets = 0;
  set src(value) { this.attrs.set("src", value); this.assignments++; this.networkState = 2; }
  setAttribute(key, value) { this.attrs.set(key, value); }
  hasAttribute(key) { return this.attrs.has(key); }
  removeAttribute(key) { this.attrs.delete(key); }
  pause() { this.paused = true; }
  play() { throw new Error("A background preload must never play"); }
  load() { this.resets++; }
}

function fixture() {
  const timers = new Map(), idle = new Map(), requests = [], videos = [], features = [], renders = [];
  let serial = 0, now = 1000;
  const card = { loading: false, getBoundingClientRect: () => ({ top: 100, bottom: 300 }), hasAttribute() { return this.loading; } };
  const context = vm.createContext({
    AbortController, URLSearchParams, HTMLVideoElement: Video, HTMLMediaElement: Video, Date: { now: () => now },
    activeTab: "dancers", citySelect: { value: "Vegas" }, userLocationOutsideMarkets: false,
    homeTvFeedStatus: "idle", homeTvFeedAbort: null, homeTvFeedRequest: 0,
    homeTvFeedCity: "Vegas", homeTvFeedVenueId: "", homeTvFeedSelectedVideoId: "", homeTvFeedVideos: [],
    PUBLIC_DISCOVERY_REQUEST_RETRIES: 1, pageSuspendedVideos: new Set(),
    navigator: { connection: { effectiveType: "4g", saveData: false } },
    window: { innerHeight: 800,
      setTimeout(fn, ms) { const id = ++serial; timers.set(id, { fn, ms }); return id; },
      clearTimeout(id) { timers.delete(id); },
      requestIdleCallback(fn) { const id = ++serial; idle.set(id, fn); return id; },
      cancelIdleCallback(id) { idle.delete(id); },
    },
    document: { readyState: "complete", visibilityState: "visible", body: { classList: { contains: () => false } },
      createElement(tag) { assert.equal(tag, "video"); const video = new Video(); videos.push(video); return video; },
    },
    results: { querySelectorAll: () => [card] },
    renderHomeTvFeed: city => renders.push(city),
    loadLiveShellFeature: async feature => { features.push(feature); },
    fetchJson: (url, options) => new Promise((resolve, reject) => {
      if (options.signal.aborted) { reject(Object.assign(new Error("aborted"), { name: "AbortError" })); return; }
      requests.push({ url, options, resolve: (items = clips) => resolve({ ok: true, videos: items }), reject });
      options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
    }),
  });
  vm.runInContext(["createHomeTvLandingPreloader", "homeTvPlaybackVideoUrl", "canWarmAdjacentVideo", "attachDeferredVideoSource", "releaseDeferredVideoSource", "loadHomeTvFeed"].map(source).join("\n"), context);
  context.homeTvLandingPreload = context.createHomeTvLandingPreloader();
  const api = context.homeTvLandingPreload;
  const runTimer = ms => {
    const entry = [...timers].find(([, timer]) => timer.ms === ms);
    assert.ok(entry, `expected ${ms}ms timer`);
    timers.delete(entry[0]); entry[1].fn();
  };
  const start = () => {
    api.schedule(); runTimer(750);
    const [id, fn] = [...idle][0] || [];
    assert.ok(fn, "preloading should wait for idle"); idle.delete(id); fn();
  };
  return { context, api, card, requests, videos, features, renders, timers, start, runTimer, setNow: value => { now = value; } };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test("landing preload waits for visible photos, document load and idle, then loads only two paused players", async () => {
  const f = fixture();
  f.card.loading = true; f.api.schedule(); assert.equal(f.timers.size, 0);
  f.card.loading = false; f.context.document.readyState = "loading";
  f.api.schedule(); assert.equal(f.timers.size, 0);
  f.context.document.readyState = "complete"; f.start();
  f.api.schedule(); assert.equal(f.requests.length, 1);
  f.requests[0].resolve(); await settle();
  assert.equal(f.videos.length, 2);
  assert.deepEqual(f.videos.map(v => v.preload), ["auto", "metadata"]);
  assert.ok(f.videos.every(v => v.paused && !v.autoplay && v.muted && v.playsInline));
  assert.deepEqual(f.videos.map(v => v.poster), ["/poster-0.jpg", "/poster-1.jpg"]);
  assert.equal(f.requests[0].options.cache, "no-store");
  assert.equal(f.renders.length, 0);
});

test("Data Saver, very slow connections, hidden pages and overlays never start background requests", () => {
  for (const configure of [
    f => { f.context.navigator.connection.saveData = true; },
    f => { f.context.navigator.connection.effectiveType = "2g"; },
    f => { f.context.document.visibilityState = "hidden"; },
    f => { f.context.document.body.classList.contains = () => true; },
    f => { f.context.activeTab = "tv"; },
  ]) {
    const f = fixture(); configure(f); f.api.schedule();
    assert.equal(f.timers.size, 0); assert.equal(f.requests.length, 0);
  }
});

test("opening TV during a pending preload uses one request and never builds background players late", async () => {
  const f = fixture(); f.start(); f.context.activeTab = "tv";
  const opening = f.context.loadHomeTvFeed("Vegas", "", "");
  assert.equal(f.requests.length, 1);
  f.requests[0].resolve(); await opening;
  assert.equal(f.context.homeTvFeedStatus, "ready");
  assert.equal(f.context.homeTvFeedVideos.length, 24);
  assert.deepEqual(f.renders, ["Vegas"]);
  assert.equal(f.videos.length, 0, "the foreground constructor owns player creation after a fast tap");
});

test("prepared TV adopts the exact paused media elements without assigning their sources again", async () => {
  const f = fixture(); f.start(); f.requests[0].resolve(); await settle();
  f.context.activeTab = "tv"; await f.context.loadHomeTvFeed("Vegas", "", "");
  assert.equal(f.requests.length, 1);
  assert.equal(f.api.takeVideo(clips[0]), f.videos[0]);
  assert.equal(f.api.takeVideo(clips[0]), null, "each player has only one owner");
  f.api.clear();
  assert.equal(f.videos[0].hasAttribute("src"), true, "clearing unused warmup must not reset the adopted player");
  assert.equal(f.videos[0].assignments, 1); assert.equal(f.videos[0].resets, 0);
  assert.equal(f.videos[1].hasAttribute("src"), false, "unclaimed neighbors release their network and decoder");
});

test("expired, refreshed or differently scoped TV loads discard warmup and request current data", async () => {
  for (const [city, venue, video, options, expired] of [
    ["Miami", "", "", {}, false], ["Vegas", "club", "", {}, false],
    ["Vegas", "", "selected", {}, false], ["Vegas", "", "", { refresh: true }, false],
    ["Vegas", "", "", {}, true],
  ]) {
    const f = fixture(); f.start(); f.requests[0].resolve(); await settle();
    if (expired) f.setNow(21001);
    const prepared = f.api.takePayload(city, venue, video, options, new AbortController().signal);
    assert.equal(prepared, null); assert.ok(f.videos.every(v => !v.hasAttribute("src")));
  }
});

test("changing city, leaving the grid or aborting an adopted request cancels obsolete work", async () => {
  for (const cancel of [
    f => f.api.sync("Miami"),
    f => { f.context.activeTab = "venues"; f.api.sync("Vegas"); },
    f => { f.context.navigator.connection.saveData = true; f.api.sync("Vegas"); },
    f => f.api.clear(),
  ]) {
    const f = fixture(); f.start(); cancel(f); await settle();
    assert.equal(f.requests[0].options.signal.aborted, true);
    f.requests[0].resolve(); await settle(); assert.equal(f.videos.length, 0);
  }
  const f = fixture(); f.start(); const controller = new AbortController();
  const pending = f.api.takePayload("Vegas", "", "", {}, controller.signal);
  controller.abort(); assert.equal(await pending, null);
  assert.equal(f.requests[0].options.signal.aborted, true);
});

test("expiry releases all unused resources without repeatedly downloading while browsing", async () => {
  const f = fixture(); f.start(); f.requests[0].resolve(); await settle(); f.runTimer(20000);
  assert.ok(f.videos.every(v => !v.hasAttribute("src") && v.paused));
  f.api.schedule(); assert.equal(f.timers.size, 0); assert.equal(f.requests.length, 1);
});

test("a failed speculative request is silent and ordinary TV opening can recover", async () => {
  const f = fixture(); f.start(); f.requests[0].reject(new Error("temporary")); await settle();
  assert.equal(f.context.homeTvFeedStatus, "idle"); assert.equal(f.renders.length, 0);
  f.context.activeTab = "tv"; const opening = f.context.loadHomeTvFeed("Vegas", "", "");
  assert.equal(f.requests.length, 2); f.requests[1].resolve(); await opening;
  assert.equal(f.context.homeTvFeedStatus, "ready");
});
