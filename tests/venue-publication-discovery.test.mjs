import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const dashboard = readFileSync(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8");
const home = readFileSync(new URL("../outputs/index.html", import.meta.url), "utf8");
const between = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const marker = between(dashboard, "function notifyPublicVenuePublication()", "type SavedImageSummary");
const review = between(dashboard, "  async function submitVenueReview(", "  function selectVenueWorkspace(");

function publicationFixture({ failed = false, decision = "approved" } = {}) {
  const stored = [];
  const context = vm.createContext({
    AbortController, Error, PUBLIC_DISCOVERY_REFRESH_KEY: "mydancrPublicDiscoveryRefreshV1",
    window: { confirm: () => true, sessionStorage: { setItem: (...args) => stored.push(["session", ...args]) }, localStorage: { setItem: (...args) => stored.push(["local", ...args]) } },
    mountedRef: { current: true }, publicationInFlightRef: { current: false }, publicationSequenceRef: { current: 0 }, publicationAbortRef: { current: null },
    reviewNotes: "Please update the hours.", setIsPublishingVenue() {}, setPublicationStatus() {}, setReviewNotes() {}, setNotificationRevision() {}, onProfileChange() {}, onPublicationChange() {},
    requestDashboardJson: async () => { if (failed) throw new Error("Try again"); return { profile: { isActive: true }, publication: { isPublished: true } }; },
  });
  vm.runInContext(compile(marker + review), context);
  return { context, stored, run: () => context.submitVenueReview(decision) };
}

test("successful venue approval refreshes the returning tab and notifies other open club lists", async () => {
  const fixture = publicationFixture();
  await fixture.run();
  assert.deepEqual(fixture.stored.map(row => row.slice(0, 2)), [
    ["session", "mydancrPublicDiscoveryRefreshV1"], ["local", "mydancrPublicDiscoveryRefreshV1"],
  ]);
  assert.equal(fixture.stored[0][2], fixture.stored[1][2]);
});

test("failed approval, requested changes, and abandoned responses never announce publication", async () => {
  for (const options of [{ failed: true }, { decision: "changes_requested" }]) {
    const fixture = publicationFixture(options);
    await fixture.run();
    assert.equal(fixture.stored.length, 0);
  }
  const fixture = publicationFixture();
  fixture.context.requestDashboardJson = async () => { fixture.context.mountedRef.current = false; return {}; };
  await fixture.run();
  assert.equal(fixture.stored.length, 0);
});

test("blocked session storage does not suppress cross-tab refresh or fail a saved approval", async () => {
  const fixture = publicationFixture();
  fixture.context.window.sessionStorage.setItem = () => { throw new Error("Blocked"); };
  await fixture.run();
  assert.equal(fixture.stored.length, 1);
  assert.equal(fixture.stored[0][0], "local");
  fixture.context.window.localStorage.setItem = () => { throw new Error("Blocked"); };
  await fixture.run();
});

test("publication events and browser Back refresh visible cards without reloading the page", async () => {
  const calls = [], listeners = {}, intervals = [];
  let consumed = 0;
  const context = vm.createContext({
    PUBLIC_DISCOVERY_REFRESH_KEY: "publication", HOME_DISCOVERY_REFRESH_MS: 30000,
    document: { visibilityState: "visible", addEventListener: (name, listener) => { listeners[name] = listener; } },
    window: { addEventListener: (name, listener) => { listeners[name] = listener; }, setInterval: callback => intervals.push(callback) },
    citySelect: { value: "All cities" }, loadLiveDiscovery: async (...args) => calls.push(args),
    consumePublicDiscoveryRefreshRequest: () => { consumed++; }, syncDeviceSavedDealPasses() {}, renderCustomerQuickActions() {}, isCustomerSession: () => false,
  });
  vm.runInContext(between(home, "    async function refreshVisibleHomeDiscovery(", "    if (isCustomerSession()) loadLiveCustomerDashboardData();"), context);
  listeners.storage({ key: "publication", newValue: "approved" });
  listeners.pageshow({ persisted: true });
  assert.equal(calls.length, 2);
  assert.equal(consumed, 1);
  for (const [city, options] of calls) {
    assert.equal(city, "All cities");
    assert.equal(options.force, true);
    assert.equal(options.cacheBust, true);
    assert.equal(options.background, true);
  }
  context.document.visibilityState = "hidden";
  listeners.storage({ key: "publication", newValue: "another" });
  intervals[0]();
  assert.equal(calls.length, 2);
  context.document.visibilityState = "visible";
  listeners.visibilitychange();
  assert.equal(calls.length, 3);
  intervals[0]();
  assert.equal(calls.length, 4, "other visitors retain the regular automatic refresh");
  assert.equal(calls[3][1].cacheBust, false, "routine polling still shares the public cache");
});

test("a publication arriving during an older discovery request queues a fresh read instead of being dropped", async () => {
  const requests = [], applied = [];
  const panel = { classList: { contains: () => false } };
  const context = vm.createContext({
    URLSearchParams, console, LIVE_JSON_REQUEST_TIMEOUT_MS: 12000, PUBLIC_DISCOVERY_REQUEST_RETRIES: 1,
    discoveryMarket: () => ({ dancers: [], venues: [] }), liveMarketState: { Vegas: "ready" }, liveMarketRefreshes: new Set(), liveMarketPendingRefreshes: new Set(),
    citySelect: { value: "Vegas" }, customerDashboard: panel, adminDashboard: panel, render() {}, isCustomerSession: () => false,
    fetchJson: (url) => new Promise(resolve => requests.push({ url, resolve })),
    applyLiveMarket: (_city, _dancers, _tonight, venues) => applied.push(venues),
  });
  vm.runInContext(between(home, "    async function loadLiveDiscovery(", "    async function refreshPublicDiscoveryAfterAdminReview("), context);
  const old = context.loadLiveDiscovery("Vegas", { force: true, cacheBust: false, background: true });
  await context.loadLiveDiscovery("Vegas", { force: true, cacheBust: true, background: true });
  await context.loadLiveDiscovery("Vegas", { force: true, cacheBust: true, background: true });
  assert.equal(requests.length, 1);
  requests[0].resolve({ venues: [] });
  await old;
  assert.equal(requests.length, 2);
  assert.ok(new URL(requests[1].url, "https://example.test").searchParams.has("refresh"));
  requests[1].resolve({ venues: [{ id: "newly-approved" }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(applied[1][0].id, "newly-approved");
  assert.equal(context.liveMarketRefreshes.size, 0);
  assert.equal(context.liveMarketPendingRefreshes.size, 0);
});
