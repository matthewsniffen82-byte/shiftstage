import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");
const functionSource = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const fetchSource = functionSource("    async function fetchJson(", "    function dancerSignupCityOptionsMarkup(");
const discoverySource = functionSource("    async function loadLiveDiscovery(", "    async function refreshPublicDiscoveryAfterAdminReview(");
const profileSource = functionSource("    function requestProfileTvPayload(", "    function prefetchProfileNavigation(");
const feedSource = functionSource("    async function loadHomeTvFeed(", "    function resolveVenueByName(");

function context(overrides = {}) {
  return createDiscoveryContext({
    AbortController, URLSearchParams, console,
    LIVE_JSON_REQUEST_TIMEOUT_MS: 15,
    PUBLIC_DISCOVERY_REQUEST_RETRIES: 1,
    window: { setTimeout, clearTimeout },
    ...overrides,
  });
}

test("public JSON requests time out even when headers arrive but the body never completes", { timeout: 1000 }, async () => {
  let signal;
  const ctx = context({
    fetch: async (_url, options) => {
      signal = options.signal;
      return { ok: true, json: () => new Promise(() => {}) };
    },
  });
  vm.runInContext(fetchSource, ctx);
  await assert.rejects(ctx.fetchJson("/api/public/discovery"), { name: "TimeoutError" });
  assert.equal(signal.aborted, true);
});

test("a transient public request retries and a missing resource does not", async () => {
  let calls = 0;
  const ctx = context({
    fetch: async () => ++calls === 1
      ? { ok: false, status: 503 }
      : { ok: true, json: async () => ({ ok: true, videos: [{ id: "video" }] }) },
  });
  vm.runInContext(fetchSource, ctx);
  assert.equal((await ctx.fetchJson("/api/public/tv", { retries: 1 })).videos.length, 1);
  assert.equal(calls, 2);
  calls = 0;
  ctx.fetch = async () => { calls += 1; return { ok: false, status: 404 }; };
  await assert.rejects(ctx.fetchJson("/api/public/tv", { retries: 1 }), { status: 404 });
  assert.equal(calls, 1);
});

test("signed-in discovery renders and settles while saved-account data is stalled", { timeout: 1000 }, async () => {
  let renders = 0;
  let savedCalls = 0;
  const panel = { classList: { contains: () => false } };
  const ctx = context({
    markets: { Vegas: { dancers: [], venues: [] } },
    liveMarketState: {}, liveMarketRefreshes: new Set(),
    citySelect: { value: "Vegas" }, customerDashboard: panel, adminDashboard: panel,
    fetchJson: async () => ({ dancers: [{ id: "dancer" }], venues: [{ id: "venue" }] }),
    applyLiveMarket: () => true, isCustomerSession: () => true,
    render: () => { renders += 1; },
    loadLiveCustomerSaved: () => { savedCalls += 1; return new Promise(() => {}); },
  });
  vm.runInContext(discoverySource, ctx);
  await ctx.loadLiveDiscovery("Vegas");
  assert.equal(ctx.liveMarketState.Vegas, "ready");
  assert.equal(renders, 1);
  assert.equal(savedCalls, 1);
  await ctx.loadLiveDiscovery("Vegas", { force: true, background: true });
  assert.equal(renders, 2);
  assert.equal(savedCalls, 1, "background discovery must not duplicate private fetches and rendering");
  assert.equal(ctx.liveMarketRefreshes.size, 0);
});

test("failed profile-video prefetches are evicted so opening the profile can recover", async () => {
  const profile = { id: "11111111-1111-4111-8111-111111111111" };
  let calls = 0;
  const ctx = context({
    profileNavigationPrefetchCache: new Map(), PROFILE_NAVIGATION_PREFETCH_TTL_MS: 20000,
    MAX_DANCER_PROFILE_VIDEOS: 24, pruneProfileNavigationPrefetchCache() {},
    fetchJson: async (_url, options) => {
      assert.equal(options.retries, 1);
      calls += 1;
      if (calls === 1) throw new Error("Connection interrupted");
      return { ok: true, videos: [{ id: "recovered" }] };
    },
  });
  vm.runInContext(profileSource, ctx);
  const first = ctx.requestProfileTvPayload(profile, "Vegas");
  assert.equal(ctx.requestProfileTvPayload(profile, "Vegas"), first);
  assert.equal(await first, null);
  assert.equal(ctx.profileNavigationPrefetchCache.size, 0);
  assert.equal((await ctx.requestProfileTvPayload(profile, "Vegas")).videos[0].id, "recovered");
  assert.equal(calls, 2);
});

test("a failed TV request exits loading and cannot replace a newer city's videos", async () => {
  let renders = 0;
  let rejectOld;
  const ctx = context({
    homeTvFeedRequest: 0, homeTvFeedCity: "Vegas", homeTvFeedVenueId: "", homeTvFeedSelectedVideoId: "",
    homeTvFeedStatus: "loading", homeTvFeedVideos: [], activeTab: "tv", citySelect: { value: "Vegas" },
    renderHomeTvFeed: () => { renders += 1; },
    fetchJson: () => new Promise((_resolve, reject) => { rejectOld = reject; }),
  });
  vm.runInContext(feedSource, ctx);
  const oldRequest = ctx.loadHomeTvFeed("Vegas", "", "");
  ctx.homeTvFeedCity = "Miami";
  ctx.citySelect.value = "Miami";
  ctx.fetchJson = async () => ({ ok: true, videos: [{ id: "new", videoUrl: "/clip.mp4", dancer: { stageName: "Dancer" } }] });
  await ctx.loadHomeTvFeed("Miami", "", "");
  rejectOld(new Error("Timed out"));
  await oldRequest;
  assert.equal(ctx.homeTvFeedVideos[0].id, "new");
  assert.equal(ctx.homeTvFeedStatus, "ready");
  assert.equal(renders, 1);
  ctx.fetchJson = async () => { throw new Error("Timed out"); };
  await ctx.loadHomeTvFeed("Miami", "", "");
  assert.equal(ctx.homeTvFeedStatus, "error");
  assert.equal(renders, 2);
});

function createDiscoveryContext(values) {
  const context = vm.createContext({ ALL_CITIES: "All cities", allCitiesMarket: { dancers: [], venues: [] }, ...values });
  const start = source.indexOf("    function discoveryMarket(");
  const end = source.indexOf("    const citySelect =", start);
  vm.runInContext(source.slice(start, end), context);
  return context;
}
