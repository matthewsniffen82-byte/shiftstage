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
    AbortController, URLSearchParams, console, activeTab: "tv", selectedVenueName: null, dancerDirectoryFilter: "now", selectedVenueFilter: () => "all", resolveVenueByName: () => null, discoveryRequestHeaders: () => ({}),
    LIVE_JSON_REQUEST_TIMEOUT_MS: 15,
    PUBLIC_DISCOVERY_REQUEST_RETRIES: 1,
    discoveryScopeCache: new Map(), DISCOVERY_SCOPE_CACHE_TTL_MS: 20000, DISCOVERY_SCOPE_CACHE_LIMIT: 6,
    userLocationOutsideMarkets: false,
    syncHomeDestinationLocation() {}, showToast() {},
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
    liveMarketState: {}, liveMarketRefreshes: new Set(), liveMarketPendingRefreshes: new Set(),
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

test("refreshing a loaded city keeps its results available until replacement data arrives", async () => {
  for (const background of [false, true]) {
    const requests = [];
    let renders = 0;
    let savedCalls = 0;
    const original = { dancers: [{ id: "existing" }], venues: [] };
    const panel = { classList: { contains: () => false } };
    const ctx = context({
      markets: { Vegas: original, Miami: { dancers: [], venues: [] } },
      liveMarketState: { Vegas: "ready" }, liveMarketRefreshes: new Set(), liveMarketPendingRefreshes: new Set(),
      citySelect: { value: "Vegas" }, customerDashboard: panel, adminDashboard: panel,
      console: { warn() {} }, isCustomerSession: () => true,
      fetchJson: () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
      applyLiveMarket: (city, dancers, _tonight, venues) => { ctx.markets[city] = { dancers, venues }; },
      render: () => { renders += 1; },
      loadLiveCustomerSaved: () => { savedCalls += 1; },
    });
    vm.runInContext(discoverySource, ctx);
    const refresh = ctx.loadLiveDiscovery("Vegas", { force: true, background });
    assert.equal(ctx.liveMarketState.Vegas, "ready", "a render during the request must still see loaded results");
    assert.equal(ctx.discoveryMarket("Vegas"), original);
    assert.equal(ctx.liveMarketRefreshes.has("Vegas"), true);
    assert.equal(renders, 0, "starting a refresh must not replace the current cards");

    const firstVisit = ctx.loadLiveDiscovery("Miami", { background: true });
    assert.equal(ctx.liveMarketState.Miami, "loading", "a different city still needs its initial loading state");
    assert.equal(ctx.liveMarketState.Vegas, "ready");
    requests[1].resolve({ dancers: [] });
    await firstVisit;
    const savedBeforeRefresh = savedCalls;
    requests[0].resolve({ dancers: [{ id: "updated" }] });
    await refresh;
    assert.equal(ctx.discoveryMarket("Vegas").dancers[0].id, "updated");
    assert.equal(renders, 1);
    assert.equal(savedCalls - savedBeforeRefresh, background ? 0 : 1, "preserve explicit account-data refresh behavior");
    assert.equal(ctx.liveMarketRefreshes.size, 0);

    const retry = ctx.loadLiveDiscovery("Vegas", { force: true, background });
    requests[2].reject(new Error("Connection interrupted"));
    await retry;
    assert.equal(ctx.liveMarketState.Vegas, "ready");
    assert.equal(ctx.discoveryMarket("Vegas").dancers[0].id, "updated");
    assert.equal(renders, 1, "a failed refresh must leave the displayed cards intact");
    assert.equal(ctx.liveMarketRefreshes.size, 0);
  }
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
    homeTvFeedAbort: null, homeTvFeedRequest: 0, homeTvFeedCity: "Vegas", homeTvFeedVenueId: "", homeTvFeedSelectedVideoId: "",
    homeTvFeedPageAbort: null, homeTvFeedNextCursor: null, homeTvFeedPageError: false, homeTvFeedLoopStarted: false,
    homeTvFeedStatus: "loading", homeTvFeedVideos: [], activeTab: "tv", citySelect: { value: "Vegas" },
    renderHomeTvFeed: () => { renders += 1; },
    loadAdaptiveVideoController: async () => ({}), loadLiveShellFeature: async () => {},
    homeTvLandingPreload: { takePayload: () => null, clear() {} },
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


function pagedDiscoveryFixture() {
  const requests = [], panel = { classList: { contains: () => false } };
  let renders = 0, privateLoads = 0;
  const ctx = context({
    markets: { Vegas: { dancers: [], venues: [] }, Miami: { dancers: [], venues: [] } },
    liveMarketState: {}, liveMarketRefreshes: new Set(), liveMarketPendingRefreshes: new Set(),
    citySelect: { value: "Vegas" }, customerDashboard: panel, adminDashboard: panel,
    console: { warn() {} }, isCustomerSession: () => true,
    fetchJson: (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })),
    applyLiveMarket: (city, dancers, tonight, venues) => Object.assign(ctx.markets[city], { dancers, tonight, venues }),
    render: () => { renders += 1; }, loadLiveCustomerSaved: () => { privateLoads += 1; },
    escapeHtml: value => String(value),
  });
  vm.runInContext(discoverySource, ctx);
  return { ctx, requests, renders: () => renders, privateLoads: () => privateLoads };
}

const nextPage = () => new Promise(resolve => setImmediate(resolve));
const dancerRows = (start, count) => Array.from({ length: count }, (_, index) => ({ id: `dancer-${start + index}` }));

for (const force of [false, true]) test(`invalidating a loaded grid keeps cards visible while revalidating (force=${force})`, async () => {
  const { ctx, requests } = pagedDiscoveryFixture();
  ctx.activeTab = 'dancers';
  let request = ctx.loadLiveDiscovery('Vegas');
  requests[0].resolve({ dancers: dancerRows(0, 10), nextCursor: null });
  await request;
  const original = ctx.markets.Vegas.dancers;
  ctx.liveMarketState.Vegas = null;
  request = ctx.loadLiveDiscovery('Vegas', { force, background: true });
  assert.equal(ctx.liveMarketState.Vegas, 'ready');
  assert.equal(ctx.markets.Vegas.dancers, original);
  assert.equal(ctx.liveMarketRefreshes.has('Vegas'), true);
  requests[1].reject(new Error('offline'));
  await request;
  assert.equal(ctx.liveMarketState.Vegas, 'ready');
  assert.equal(ctx.markets.Vegas.dancers, original);
});

test("opening a club requests only its working roster and preserves visible city cards until it arrives", async () => {
  const { ctx, requests } = pagedDiscoveryFixture();
  let request = ctx.loadLiveDiscovery("Vegas");
  requests[0].resolve({ dancers: [{ id: "visible" }], venues: [{ id: "club" }], nextCursor: null }); await request;
  ctx.activeTab = "venues";
  ctx.selectedVenueName = "club";
  ctx.resolveVenueByName = () => ({ id: "club" });
  request = ctx.loadLiveDiscovery("Vegas");
  assert.match(requests[1].url, /filter=now&venue=club/);
  assert.equal(ctx.markets.Vegas.dancers[0].id, "visible");
  await ctx.loadLiveDiscovery("Vegas");
  assert.equal(ctx.liveMarketPendingRefreshes.size, 0, "opening an already requested scope must not queue it again");
  requests[1].resolve({ dancers: dancerRows(0, 96), venues: [{ id: "club" }], nextCursor: null }); await request;
  assert.equal(requests.length, 2, "the 96-dancer club does not download the whole city");
  assert.equal(ctx.markets.Vegas.dancers.length, 96);
});

test("a shared club link switches to its roster as soon as metadata resolves, without fetching remaining city pages", async () => {
  const { ctx, requests } = pagedDiscoveryFixture();
  ctx.activeTab = "venues";
  ctx.selectedVenueName = "club-slug";
  ctx.resolveVenueByName = () => ctx.markets.Vegas.venues.find(row => row.slug === "club-slug");
  const request = ctx.loadLiveDiscovery("Vegas");
  requests[0].resolve({ dancers: [{ id: "city-card" }], venues: [{ id: "club", slug: "club-slug" }], nextCursor: "city-next" });
  await request;
  assert.equal(requests.length, 2);
  assert.match(requests[1].url, /filter=now&venue=club/);
  assert.doesNotMatch(requests[1].url, /cursor=/);
  await ctx.loadLiveDiscovery("Vegas");
  assert.equal(ctx.liveMarketPendingRefreshes.size, 0);
  requests[1].resolve({ dancers: dancerRows(0, 100), venues: [{ id: "club", slug: "club-slug" }], nextCursor: "club-next" }); await nextPage();
  assert.match(requests[2].url, /venue=club&cursor=club-next/);
  requests[2].resolve({ dancers: dancerRows(100, 37), venues: [{ id: "club", slug: "club-slug" }], nextCursor: null }); await nextPage();
  assert.equal(ctx.markets.Vegas.dancers.length, 137, "clubs still load every dancer beyond the first 100");
  assert.equal(requests.length, 3);
  assert.equal(ctx.liveMarketRefreshes.size, 0);
});

test("a failed club request settles its loading status after preserving the previous roster", async () => {
  const { ctx, requests } = pagedDiscoveryFixture();
  const snapshots = [];
  ctx.activeTab = "venues";
  ctx.selectedVenueName = "club";
  ctx.resolveVenueByName = () => ({ id: "club" });
  ctx.render = () => snapshots.push({ pending: ctx.liveMarketRefreshes.has("Vegas"), count: ctx.markets.Vegas.dancers.length });
  let request = ctx.loadLiveDiscovery("Vegas");
  requests[0].resolve({ dancers: dancerRows(0, 96), nextCursor: null }); await request;
  request = ctx.loadLiveDiscovery("Vegas", { force: true, background: true });
  assert.equal(ctx.markets.Vegas.dancers.length, 96);
  requests[1].reject(new Error("offline")); await request;
  assert.deepEqual(snapshots.at(-1), { pending: false, count: 96 });
});

test("returning to a recently loaded club list paints it immediately and refreshes without blanking it", async () => {
  const { ctx, requests } = pagedDiscoveryFixture();
  ctx.activeTab = "venues";
  let request = ctx.loadLiveDiscovery("Vegas");
  requests[0].resolve({ dancers: [{ id: "all-dancer" }], venues: [{ id: "club" }], nextCursor: null }); await request;
  ctx.activeTab = "dancers";
  request = ctx.loadLiveDiscovery("Vegas");
  requests[1].resolve({ dancers: [{ id: "working-dancer" }], venues: [{ id: "club" }], nextCursor: null }); await request;
  ctx.activeTab = "venues";
  request = ctx.loadLiveDiscovery("Vegas");
  assert.equal(ctx.liveMarketState.Vegas, "ready");
  assert.equal(ctx.markets.Vegas.dancers[0].id, "all-dancer");
  assert.equal(ctx.markets.Vegas.venues[0].id, "club");
  assert.match(requests[2].url, /filter=all/);
  requests[2].resolve({ dancers: [{ id: "refreshed" }], venues: [], nextCursor: null }); await request;
  assert.equal(ctx.markets.Vegas.dancers[0].id, "refreshed");
  assert.equal(ctx.markets.Vegas.venues.length, 0, "removed clubs disappear when revalidation completes");
});

test("expired, account-mismatched and explicitly invalidated lists are not restored", async () => {
  for (const reason of ["expired", "account", "invalidated"]) {
    const { ctx, requests } = pagedDiscoveryFixture();
    let request = ctx.loadLiveDiscovery("Vegas");
    requests[0].resolve({ dancers: [{ id: "original" }], nextCursor: null }); await request;
    if (reason === "expired") ctx.discoveryScopeCache.forEach(entry => { entry.expiresAt = 0; });
    ctx.activeTab = "dancers";
    request = ctx.loadLiveDiscovery("Vegas", reason === "invalidated" ? { force: true } : {});
    requests[1].resolve({ dancers: [{ id: "working" }], nextCursor: null }); await request;
    if (reason === "account") ctx.discoveryRequestHeaders = () => ({ "x-discovery-session": "new-account" });
    ctx.activeTab = "venues";
    request = ctx.loadLiveDiscovery("Vegas");
    assert.equal(ctx.liveMarketState.Vegas, "loading", reason);
    assert.equal(ctx.markets.Vegas.dancers.length, 0, reason);
    requests[2].resolve({ dancers: [{ id: "current" }], nextCursor: null }); await request;
  }
});

test("recent list reuse has a bounded in-memory lifetime and size", async () => {
  const { ctx, requests } = pagedDiscoveryFixture();
  for (let index = 0; index < 8; index += 1) {
    const city = `City ${index}`;
    ctx.markets[city] = { dancers: [], venues: [] };
    ctx.citySelect.value = city;
    const request = ctx.loadLiveDiscovery(city);
    requests[index].resolve({ dancers: [{ id: `dancer-${index}` }], nextCursor: null }); await request;
  }
  assert.equal(ctx.discoveryScopeCache.size, 6);
  assert.ok([...ctx.discoveryScopeCache.values()].every(entry => entry.expiresAt <= Date.now() + 20000));
});

test("24 opening dancer cards render before larger pages settle while all batches still load automatically", async () => {
  const f = pagedDiscoveryFixture(), { ctx, requests } = f;
  const request = ctx.loadLiveDiscovery("Vegas");
  requests[0].resolve({ dancers: dancerRows(0, 24), venues: [{ id: "club" }], statusCounts: { now: 161, not_now: 0 }, nextCursor: "next" }); await nextPage();
  assert.match(requests[1].url, /cursor=next/);
  assert.equal(ctx.liveMarketState.Vegas, "ready", "first cards are available without waiting for the rest");
  assert.equal(ctx.markets.Vegas.dancers.length, 24);
  assert.equal(ctx.markets.Vegas.venues[0].id, "club");
  assert.equal(ctx.discoveryDancerCount("Vegas"), 161, "the server's full total is available on the first batch");
  assert.match(ctx.discoveryPaginationMarkup("Vegas"), /Loading remaining dancers/);
  assert.doesNotMatch(ctx.discoveryPaginationMarkup("Vegas"), /<button/);
  assert.equal(f.renders(), 1);
  await ctx.loadLiveDiscovery("Vegas", { more: true });
  assert.equal(requests.length, 2, "concurrent calls cannot request the same page twice");
  requests[1].resolve({ dancers: dancerRows(24, 100), nextCursor: "last" }); await nextPage();
  assert.match(requests[2].url, /cursor=last/);
  requests[2].resolve({ dancers: [{ id: "dancer-0", updated: true }, ...dancerRows(124, 37)], nextCursor: null }); await request;
  assert.equal(ctx.markets.Vegas.dancers.length, 161);
  assert.equal(new Set(ctx.markets.Vegas.dancers.map(r => r.id)).size, 161);
  assert.equal(ctx.markets.Vegas.dancers[0].updated, true);
  assert.equal(ctx.markets.Vegas.pagination.pageCount, 3);
  assert.equal(ctx.hasMoreDiscovery("Vegas"), false);
  assert.equal(ctx.discoveryPaginationMarkup("Vegas"), "");
  assert.equal(f.renders(), 3);
  assert.equal(f.privateLoads(), 1);
  await ctx.loadLiveDiscovery("Vegas", { more: true });
  assert.equal(requests.length, 3);
});

test("a failed next page keeps its cursor and visible cards for retry", async () => {
  const { ctx, requests } = pagedDiscoveryFixture();
  let request = ctx.loadLiveDiscovery("Vegas");
  requests[0].resolve({ dancers: [{ id: "first" }], nextCursor: "next" }); await nextPage();
  requests[1].reject(new Error("offline")); await request;
  assert.equal(ctx.markets.Vegas.pagination.nextCursor, "next");
  assert.equal(ctx.markets.Vegas.dancers.length, 1);
  assert.match(ctx.discoveryPaginationMarkup("Vegas"), /Try again/);
  request = ctx.loadLiveDiscovery("Vegas", { more: true });
  assert.match(ctx.discoveryPaginationMarkup("Vegas"), /Loading remaining dancers/);
  await ctx.loadLiveDiscovery("Vegas", { more: true });
  assert.equal(requests.length, 3);
  requests[2].resolve({ dancers: [{ id: "middle" }], nextCursor: "last" }); await nextPage();
  requests[3].resolve({ dancers: [{ id: "last" }], nextCursor: null }); await request;
  assert.equal(ctx.markets.Vegas.dancers.length, 3);
  assert.equal(ctx.hasMoreDiscovery("Vegas"), false);
});

test("refresh revalidates the entire directory, removes revoked profiles and includes new later pages", async () => {
  const { ctx, requests } = pagedDiscoveryFixture();
  let request = ctx.loadLiveDiscovery("Vegas");
  requests[0].resolve({ dancers: [{ id: "first" }], nextCursor: "next" }); await nextPage();
  requests[1].resolve({ dancers: [{ id: "revoked" }], nextCursor: null }); await request;
  request = ctx.loadLiveDiscovery("Vegas", { force: true, background: true });
  requests[2].resolve({ dancers: [{ id: "first" }], nextCursor: "new-next" });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(requests[3].url, /cursor=new-next/);
  requests[3].resolve({ dancers: [{ id: "replacement" }], nextCursor: "new-third" }); await nextPage();
  assert.deepEqual(Array.from(ctx.markets.Vegas.dancers, r => r.id), ["first", "revoked"], "refresh publishes complete replacement data together");
  requests[4].resolve({ dancers: [{ id: "added" }], nextCursor: null }); await request;
  assert.deepEqual(Array.from(ctx.markets.Vegas.dancers, r => r.id), ["first", "replacement", "added"]);
  assert.equal(ctx.markets.Vegas.pagination.pageCount, 3);
  assert.equal(ctx.markets.Vegas.pagination.nextCursor, null);
});

test("a late page for a previous city never replaces the newly selected city's results", async () => {
  const f = pagedDiscoveryFixture(), { ctx, requests } = f;
  const request = ctx.loadLiveDiscovery("Vegas");
  requests[0].resolve({ dancers: [{ id: "first" }], nextCursor: "next" }); await nextPage();
  ctx.citySelect.value = "Miami";
  const cityRequest = ctx.loadLiveDiscovery("Miami");
  requests[2].resolve({ dancers: [{ id: "miami" }], nextCursor: null }); await cityRequest;
  const renders = f.renders();
  requests[1].resolve({ dancers: [{ id: "vegas-late" }], nextCursor: null }); await request;
  assert.equal(f.renders(), renders);
  assert.deepEqual(Array.from(ctx.markets.Miami.dancers, r => r.id), ["miami"]);
});

test("a stalled continuation cannot cause an endless pagination loop", async () => {
  const { ctx, requests } = pagedDiscoveryFixture();
  const request = ctx.loadLiveDiscovery("Vegas");
  requests[0].resolve({ dancers: [{ id: "first" }], nextCursor: "next" }); await nextPage();
  requests[1].resolve({ dancers: [{ id: "duplicate" }], nextCursor: "next" }); await request;
  assert.equal(ctx.markets.Vegas.dancers.length, 1);
  assert.equal(ctx.markets.Vegas.pagination.error, true);
});

test("both status totals survive pagination and failed continuations without leaking across scopes", async () => {
  const { ctx, requests } = pagedDiscoveryFixture();
  const statusCounts = { now: 498, not_now: 31, nowByVenue: { club: 498 } };
  ctx.activeTab = "dancers";
  let request = ctx.loadLiveDiscovery("Vegas");
  requests[0].resolve({ dancers: [{ id: "working" }], statusCounts, nextCursor: "next" }); await nextPage();
  requests[1].reject(new Error("offline")); await request;
  assert.deepEqual({ ...ctx.markets.Vegas.pagination.statusCounts }, statusCounts);
  request = ctx.loadLiveDiscovery("Vegas", { more: true });
  requests[2].resolve({ dancers: [{ id: "second" }], nextCursor: null }); await request;
  assert.deepEqual({ ...ctx.markets.Vegas.pagination.statusCounts }, statusCounts);
  ctx.dancerDirectoryFilter = "not_now";
  request = ctx.loadLiveDiscovery("Vegas");
  requests[3].resolve({ dancers: [], statusCounts: { now: -1, not_now: "unknown" }, nextCursor: null }); await request;
  assert.equal(ctx.markets.Vegas.pagination.statusCounts, null, 'invalid new-scope totals must not reuse the previous scope');
});

test("changing directory status or club starts from that filter's globally ranked first page", async () => {
  const { ctx, requests } = pagedDiscoveryFixture();
  ctx.activeTab = "dancers";
  let request = ctx.loadLiveDiscovery("Vegas");
  assert.match(requests[0].url, /filter=now/);
  requests[0].resolve({ dancers: [{ id: "working" }], nextCursor: null }); await request;
  ctx.dancerDirectoryFilter = "not_now";
  request = ctx.loadLiveDiscovery("Vegas");
  assert.match(requests[1].url, /filter=not_now/);
  assert.doesNotMatch(requests[1].url, /cursor=/);
  assert.equal(ctx.liveMarketState.Vegas, "ready");
  assert.equal(ctx.markets.Vegas.dancers[0].id, "working");
  assert.equal(ctx.markets.Vegas.directoryFilterPending, true);
  assert.doesNotMatch(requests[1].url, /refresh=/);
  requests[1].resolve({ dancers: [{ id: "off" }], nextCursor: null }); await request;
  assert.deepEqual(Array.from(ctx.markets.Vegas.dancers, r => r.id), ["off"]);
  ctx.selectedVenueFilter = () => "Club";
  ctx.resolveVenueByName = () => ({ id: "club-id" });
  request = ctx.loadLiveDiscovery("Vegas");
  assert.match(requests[2].url, /filter=now&venue=club-id/);
  assert.doesNotMatch(requests[2].url, /cursor=/);
  requests[2].resolve({ dancers: [{ id: "club-top" }], nextCursor: null }); await request;
  assert.equal(ctx.markets.Vegas.dancers[0].id, "club-top");
});

test("a filter change while a page is pending discards the stale response and fetches the new scope", async () => {
  for (const failed of [false, true]) {
    const { ctx, requests } = pagedDiscoveryFixture(); ctx.activeTab = "dancers";
    const request = ctx.loadLiveDiscovery("Vegas");
    requests[0].resolve({ dancers: [{ id: "working" }], nextCursor: "next" }); await nextPage();
    ctx.dancerDirectoryFilter = "not_now";
    const nextRequest = ctx.loadLiveDiscovery("Vegas");
    assert.equal(requests.length, 3, "the new filter starts before the previous response settles");
    assert.equal(requests[1].options.signal.aborted, true);
    if (failed) requests[1].reject(new Error("offline"));
    else requests[1].resolve({ dancers: [{ id: "stale" }], nextCursor: null });
    await request;
    assert.equal(requests.length, 3);
    assert.equal(ctx.markets.Vegas.dancers[0].id, "working", "the displayed list remains intact while the new filter loads");
    assert.equal(ctx.markets.Vegas.directoryFilterPending, true);
    assert.match(requests[2].url, /filter=not_now/);
    requests[2].resolve({ dancers: [{ id: "fresh" }], nextCursor: null });
    await nextRequest;
    assert.deepEqual(Array.from(ctx.markets.Vegas.dancers, r => r.id), ["fresh"]);
  }
});

for (const filter of ["now", "not_now"]) test(`preloading ${filter} warms one batch and immediately resumes its continuation when selected`, async () => {
  const { ctx, requests } = pagedDiscoveryFixture();
  const statusCounts = { now: 50, not_now: 31, nowByVenue: { club: 50 } };
  ctx.activeTab = "dancers";
  ctx.dancerDirectoryFilter = filter === "now" ? "not_now" : "now";
  const initial = ctx.loadLiveDiscovery("Vegas");
  requests[0].resolve({ dancers: [{ id: "original" }], nextCursor: null }); await initial;
  ctx.prefetchDancerDirectory("Vegas");
  ctx.prefetchDancerDirectory("Vegas");
  assert.equal(requests.length, 2, "duplicate renders reuse the same warmup");
  assert.match(requests[1].url, new RegExp(`filter=${filter}`));
  requests[1].resolve({ dancers: [{ id: "warm" }], statusCounts, nextCursor: "rest" }); await nextPage();
  assert.equal(requests.length, 2, "the unselected list does not download continuation pages");
  assert.equal(ctx.markets.Vegas.dancers[0].id, "original", "prefetch cannot replace the visible list");
  ctx.dancerDirectoryFilter = filter;
  const selected = ctx.loadLiveDiscovery("Vegas");
  assert.equal(ctx.markets.Vegas.dancers[0].id, "warm", "the first cards switch synchronously from cache");
  assert.equal(ctx.liveMarketState.Vegas, "ready");
  assert.deepEqual({ ...ctx.markets.Vegas.pagination.statusCounts }, statusCounts);
  assert.match(requests[2].url, /cursor=rest/);
  assert.doesNotMatch(requests[2].url, /refresh=/);
  requests[2].resolve({ dancers: [{ id: "rest" }], nextCursor: null }); await selected;
  assert.deepEqual(Array.from(ctx.markets.Vegas.dancers, row => row.id), ["warm", "rest"]);
  assert.deepEqual({ ...ctx.markets.Vegas.pagination.statusCounts }, statusCounts);
});

test("selecting a warming tab shares its request and publishes its first batch immediately", async () => {
  const { ctx, requests } = pagedDiscoveryFixture(); ctx.activeTab = "dancers";
  const initial = ctx.loadLiveDiscovery("Vegas");
  requests[0].resolve({ dancers: [{ id: "working" }], nextCursor: null }); await initial;
  ctx.prefetchDancerDirectory("Vegas");
  ctx.dancerDirectoryFilter = "not_now";
  const selected = ctx.loadLiveDiscovery("Vegas");
  assert.equal(requests.length, 2);
  assert.equal(ctx.markets.Vegas.directoryFilterPending, true);
  requests[1].resolve({ dancers: [{ id: "off" }], nextCursor: "next" }); await nextPage();
  assert.equal(requests.length, 3);
  assert.match(requests[2].url, /cursor=next/);
  assert.equal(ctx.markets.Vegas.dancers[0].id, "off");
  assert.equal(ctx.markets.Vegas.directoryFilterPending, undefined);
  requests[2].resolve({ dancers: [{ id: "off-next" }], nextCursor: null }); await selected;
});

test("rapidly switching back restores the previous tab while the canceled response cannot repaint it", async () => {
  const { ctx, requests } = pagedDiscoveryFixture(); ctx.activeTab = "dancers";
  const initial = ctx.loadLiveDiscovery("Vegas");
  requests[0].resolve({ dancers: [{ id: "working" }], nextCursor: null }); await initial;
  ctx.dancerDirectoryFilter = "not_now";
  const off = ctx.loadLiveDiscovery("Vegas");
  ctx.dancerDirectoryFilter = "now";
  await ctx.loadLiveDiscovery("Vegas");
  assert.equal(requests[1].options.signal.aborted, true);
  assert.equal(requests.length, 2, "returning to the displayed list requires no new request");
  assert.equal(ctx.markets.Vegas.dancers[0].id, "working");
  assert.equal(ctx.markets.Vegas.directoryFilterPending, undefined);
  requests[1].resolve({ dancers: [{ id: "late-off" }], nextCursor: null }); await off;
  assert.equal(ctx.markets.Vegas.dancers[0].id, "working");
  assert.equal(ctx.liveMarketRefreshes.size, 0);
});

test("a failed switch keeps the original list and restores its selected tab with retry feedback", async () => {
  const { ctx, requests } = pagedDiscoveryFixture(); ctx.activeTab = "dancers";
  const notices = []; ctx.showToast = message => notices.push(message);
  const initial = ctx.loadLiveDiscovery("Vegas");
  requests[0].resolve({ dancers: [{ id: "working" }], nextCursor: null }); await initial;
  ctx.dancerDirectoryFilter = "not_now";
  const selected = ctx.loadLiveDiscovery("Vegas");
  requests[1].reject(new Error("offline")); await selected;
  assert.equal(ctx.dancerDirectoryFilter, "now");
  assert.equal(ctx.markets.Vegas.dancers[0].id, "working");
  assert.equal(ctx.markets.Vegas.directoryFilterPending, undefined);
  assert.match(notices[0], /try again/);
});

test("explicit refresh invalidates pending prefetches and never restores their stale rows", async () => {
  const { ctx, requests } = pagedDiscoveryFixture(); ctx.activeTab = "dancers";
  const initial = ctx.loadLiveDiscovery("Vegas");
  requests[0].resolve({ dancers: [{ id: "working" }], nextCursor: null }); await initial;
  ctx.prefetchDancerDirectory("Vegas");
  const refreshed = ctx.loadLiveDiscovery("Vegas", { force: true });
  requests[2].resolve({ dancers: [{ id: "current" }], nextCursor: null }); await refreshed;
  requests[1].resolve({ dancers: [{ id: "stale-off" }], nextCursor: null }); await nextPage();
  ctx.dancerDirectoryFilter = "not_now";
  const selected = ctx.loadLiveDiscovery("Vegas");
  assert.equal(ctx.markets.Vegas.dancers[0].id, "current");
  assert.equal(requests.length, 4);
  requests[3].resolve({ dancers: [], nextCursor: null }); await selected;
  assert.equal(ctx.markets.Vegas.dancers.length, 0, "an actual empty response replaces the previous cards");
  assert.equal(ctx.markets.Vegas.directoryFilterPending, undefined);
});

test("a failed warmup falls back to the selected tab's normal request", async () => {
  const { ctx, requests } = pagedDiscoveryFixture(); ctx.activeTab = "dancers";
  const initial = ctx.loadLiveDiscovery("Vegas");
  requests[0].resolve({ dancers: [{ id: "working" }], nextCursor: null }); await initial;
  ctx.prefetchDancerDirectory("Vegas");
  ctx.dancerDirectoryFilter = "not_now";
  const selected = ctx.loadLiveDiscovery("Vegas");
  requests[1].reject(new Error("warmup failed")); await nextPage();
  assert.equal(requests.length, 3);
  assert.match(requests[2].url, /filter=not_now/);
  assert.equal(ctx.markets.Vegas.dancers[0].id, "working");
  requests[2].resolve({ dancers: [{ id: "off" }], nextCursor: null }); await selected;
  assert.equal(ctx.markets.Vegas.dancers[0].id, "off");
});

test("an account change prevents a pending warmup from entering the cache", async () => {
  const { ctx, requests } = pagedDiscoveryFixture(); ctx.activeTab = "dancers";
  const initial = ctx.loadLiveDiscovery("Vegas");
  requests[0].resolve({ dancers: [{ id: "working" }], nextCursor: null }); await initial;
  ctx.prefetchDancerDirectory("Vegas");
  ctx.discoveryRequestHeaders = () => ({ "x-discovery-session": "different-account" });
  requests[1].resolve({ dancers: [{ id: "previous-account" }], nextCursor: null }); await nextPage();
  assert.ok([...ctx.discoveryScopeCache.values()].every(entry => !entry.page?.dancers.some(row => row.id === "previous-account")));
  ctx.dancerDirectoryFilter = "not_now";
  const selected = ctx.loadLiveDiscovery("Vegas");
  assert.equal(ctx.markets.Vegas.dancers.length, 0);
  requests[2].resolve({ dancers: [{ id: "current-account" }], nextCursor: null }); await selected;
  assert.equal(ctx.markets.Vegas.dancers[0].id, "current-account");
});

test("a failed switch in the previous city cannot change the newly selected city's tab", async () => {
  const { ctx, requests } = pagedDiscoveryFixture(); ctx.activeTab = "dancers";
  const notices = []; ctx.showToast = message => notices.push(message);
  const initial = ctx.loadLiveDiscovery("Vegas");
  requests[0].resolve({ dancers: [{ id: "working" }], nextCursor: null }); await initial;
  ctx.dancerDirectoryFilter = "not_now";
  const selected = ctx.loadLiveDiscovery("Vegas");
  ctx.citySelect.value = "Miami";
  requests[1].reject(new Error("offline")); await selected;
  assert.equal(ctx.dancerDirectoryFilter, "not_now");
  assert.equal(notices.length, 0);
});

test("a failed later refresh page preserves the previous complete directory and its count", async () => {
  const { ctx, requests } = pagedDiscoveryFixture();
  let request = ctx.loadLiveDiscovery("Vegas");
  requests[0].resolve({ dancers: dancerRows(0, 100), nextCursor: "next" }); await nextPage();
  requests[1].resolve({ dancers: dancerRows(100, 37), nextCursor: null }); await request;
  request = ctx.loadLiveDiscovery("Vegas", { force: true, background: true });
  requests[2].resolve({ dancers: [{ id: "replacement" }], nextCursor: "new-next" }); await nextPage();
  requests[3].reject(new Error("offline")); await request;
  assert.equal(ctx.markets.Vegas.dancers.length, 137);
  assert.equal(ctx.markets.Vegas.dancers[0].id, "dancer-0");
  assert.equal(ctx.markets.Vegas.pagination.nextCursor, null);
  assert.equal(ctx.liveMarketState.Vegas, "ready");
});

test("an expired directory continuation restarts from a fresh ranking instead of repeatedly retrying it", async () => {
  const { ctx, requests } = pagedDiscoveryFixture();
  const request = ctx.loadLiveDiscovery("Vegas");
  requests[0].resolve({ dancers: [{ id: "old" }], nextCursor: "expired" }); await nextPage();
  requests[1].reject(Object.assign(new Error("expired"), { status: 409 })); await request;
  assert.equal(requests.length, 3); assert.doesNotMatch(requests[2].url, /cursor=/);
  requests[2].resolve({ dancers: [{ id: "fresh" }], nextCursor: null });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ctx.markets.Vegas.dancers[0].id, "fresh");
});


test("All cities pagination preserves independently loaded city cards and continuation", () => {
  const cityMarket = { dancers: [{ id: "local" }], venues: [], pagination: { nextCursor: "local-next" } };
  const ctx = context({
    markets: { Vegas: cityMarket }, allCitiesMarket: { dancers: [], venues: [], pagination: { nextCursor: "global-next" } },
    venuePreviewRequested: () => false, mergeAuthenticatedDancerIntoDiscovery: (_city, rows) => rows,
    mapLiveDancer: row => row, mapLiveVenue: row => row, dedupePublicVenues: rows => rows,
    isApprovedPublicProfile: () => true, followedByCity: {}, followedVenuesByCity: {}, followedDancerIds: new Set(),
  });
  const applySource = functionSource("    function applyLiveMarket(", "    const LIVE_JSON_REQUEST_TIMEOUT_MS");
  vm.runInContext(applySource, ctx);
  ctx.applyLiveMarket("All cities", [{ id: "global", city: "Vegas" }], [], []);
  assert.equal(ctx.markets.Vegas, cityMarket);
  assert.equal(ctx.markets.Vegas.dancers[0].id, "local");
  assert.equal(ctx.markets.Vegas.pagination.nextCursor, "local-next");
  assert.equal(ctx.allCitiesMarket.dancers[0].id, "global");
});
