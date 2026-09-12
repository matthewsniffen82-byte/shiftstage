import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { publicVideoLoaders } from "./helpers/public-video-loaders.mjs";

const source = readFileSync(new URL("../outputs/index.html", import.meta.url), "utf8");
const renderSource = source.slice(source.indexOf("    function renderHomeTvFeedMessage("), source.indexOf("    async function loadHomeTvFeed("));

function element() {
  return {
    dataset: {}, children: [], attributes: {}, listeners: {},
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
    appendChild(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; },
    addEventListener(name, listener) { this.listeners[name] = listener; },
    closest: () => null,
  };
}

function fixture() {
  const { context } = publicVideoLoaders();
  const navigations = [];
  Object.assign(context, {
    URL, tabTitle: element(), viewAllBtn: element(), results: element(), ALL_CITIES: "All cities",
    selectedHomeTvVenueFilter: () => context.homeTvFeedVenueId ? { id: context.homeTvFeedVenueId, name: "Fixture Club" } : null,
    selectedHomeTvVideoId: () => context.homeTvFeedSelectedVideoId,
    discoveryLocationPhrase: city => `in ${city}`,
    setHomeTvFeedCount() {}, syncHomeTvPageSnapState() {}, settleHomeTvFeedLanding() {},
    syncHomeTvFeedSoundButtons() {}, loadPublicMediaLikes() {}, setupHomeTvFeedObserver() {},
    createHomeTvFeedSlide: video => ({ video }),
  });
  context.document.createElement = element;
  context.window.location = { href: "https://www.mydancr.com/?city=Vegas&view=tv#results", replace: url => navigations.push(url) };
  context.window.requestAnimationFrame = callback => callback();
  vm.runInContext(renderSource, context);
  const load = () => context.loadHomeTvFeed("Vegas", context.homeTvFeedVenueId, context.homeTvFeedSelectedVideoId);
  const button = () => context.results.children.find(child => child.listeners?.click);
  return { context, navigations, load, button };
}

test("a challenged TV request offers document verification instead of replaying the blocked API", async () => {
  const f = fixture(); let calls = 0;
  f.context.homeTvFeedVenueId = "fixture-club";
  f.context.homeTvFeedSelectedVideoId = "fixture-video";
  f.context.fetch = async () => { calls++; return new Response("<html>Vercel Security Checkpoint</html>", {
    status: 403, headers: { "x-vercel-mitigated": "challenge", "content-type": "text/html" },
  }); };
  await f.load();
  assert.equal(calls, 1, "API retries cannot complete a document challenge");
  assert.equal(f.context.homeTvFeedStatus, "verification-required");
  assert.match(f.context.results.children[0].textContent, /browser check/i);
  assert.equal(f.button().textContent, "Reload MyDancr TV");
  assert.equal(f.navigations.length, 0, "never force navigation or create a reload loop");
  f.button().listeners.click();
  assert.equal(calls, 1);
  const destination = new URL(f.navigations[0]);
  assert.equal(destination.origin, "https://www.mydancr.com");
  assert.equal(destination.pathname, "/");
  assert.equal(destination.searchParams.get("view"), "tv");
  assert.equal(destination.searchParams.get("city"), "Vegas");
  assert.equal(destination.searchParams.get("tv_venue"), "fixture-club");
  assert.equal(destination.searchParams.get("tv_video"), "fixture-video");
  assert.ok(destination.searchParams.get("tv_refresh"));
  assert.equal(destination.hash, "#results");
});

test("ordinary forbidden responses remain ordinary errors without initiating verification", async () => {
  const f = fixture();
  f.context.fetch = async () => Response.json({ ok: false }, { status: 403 });
  await f.load();
  assert.equal(f.context.homeTvFeedStatus, "error");
  assert.equal(f.button().textContent, "Retry MyDancr TV");
  assert.equal(f.navigations.length, 0);
});

test("manual TV retry bypasses a stale response and renders recovered videos", async () => {
  const f = fixture(); const requests = [];
  f.context.fetch = async (url, options) => {
    requests.push({ url, cache: options.cache });
    return options.cache === "no-store" && new URL(url, "https://www.mydancr.com").searchParams.has("refresh")
      ? Response.json({ ok: true, videos: [{ id: "recovered", videoUrl: "/video.mp4", dancer: { stageName: "Fixture" } }] })
      : Response.json({ ok: false }, { status: 403 });
  };
  await f.load();
  assert.equal(requests[0].cache, "default");
  await f.button().listeners.click();
  assert.equal(f.context.homeTvFeedStatus, "ready");
  assert.equal(f.context.results.children[0].video.id, "recovered");
  assert.equal(requests[1].cache, "no-store");
  assert.equal(f.navigations.length, 0);
});

test("automatic retries use a fresh HTTP response after a transient failure", async () => {
  const { context } = publicVideoLoaders(); const cacheModes = [];
  context.fetch = async (_url, options) => {
    cacheModes.push(options.cache);
    return options.cache === "no-store" ? Response.json({ ok: true }) : Response.json({ ok: false }, { status: 503 });
  };
  assert.equal((await context.fetchJson("/api/public/tv", { retries: 1 })).ok, true);
  assert.deepEqual(cacheModes, ["default", "no-store"]);
});

test("recovered unchanged videos replace a prior loading or error message", () => {
  const f = fixture();
  f.context.homeTvFeedStatus = "ready";
  f.context.homeTvFeedVideos = [{ id: "same", videoUrl: "/video.mp4", dancer: { stageName: "Fixture" } }];
  f.context.renderHomeTvFeed("Vegas");
  f.context.homeTvFeedStatus = "error";
  f.context.renderHomeTvFeed("Vegas");
  f.context.homeTvFeedStatus = "loading";
  f.context.renderHomeTvFeed("Vegas");
  f.context.homeTvFeedStatus = "ready";
  f.context.renderHomeTvFeed("Vegas");
  assert.equal(f.context.results.children[0].video?.id, "same");
});

const workerSource = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
for (const cache of ["default", "no-store", "no-cache", "reload"]) {
  test(`the service worker preserves a public request's ${cache} cache mode`, async () => {
    let fetchHandler, forwarded, response;
    vm.runInNewContext(workerSource, {
      URL,
      self: { location: { origin: "https://www.mydancr.com" }, addEventListener: (name, fn) => { if (name === "fetch") fetchHandler = fn; } },
      fetch: async (_request, options) => { forwarded = options.cache; return new Response("ok"); },
    });
    fetchHandler({ request: { method: "GET", url: "https://www.mydancr.com/api/public/tv", mode: "cors", cache }, respondWith: pending => { response = pending; } });
    await response;
    assert.equal(forwarded, cache);
  });
}

test("the service worker still forces private document navigation to no-store", async () => {
  let fetchHandler, forwarded, response;
  vm.runInNewContext(workerSource, {
    URL,
    self: { location: { origin: "https://www.mydancr.com" }, addEventListener: (name, fn) => { if (name === "fetch") fetchHandler = fn; } },
    fetch: async (_request, options) => { forwarded = options.cache; return new Response("ok"); },
  });
  fetchHandler({ request: { method: "GET", url: "https://www.mydancr.com/account", mode: "navigate", cache: "reload" }, respondWith: pending => { response = pending; } });
  await response;
  assert.equal(forwarded, "no-store");
});
