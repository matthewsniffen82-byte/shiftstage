import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { currentDashboardAuthHeaders, persistResponseSession } from "../app/dashboard/dashboard-session.ts";

const home = readFileSync(new URL("../outputs/index.html", import.meta.url), "utf8");
const profile = readFileSync(new URL("../app/dancers/[slug]/DancerProfileActions.tsx", import.meta.url), "utf8");
const followRoute = readFileSync(new URL("../app/api/customer/follows/route.ts", import.meta.url), "utf8");

function between(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `Missing ${start}`);
  return source.slice(a, b);
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function homeFixture() {
  const notices = [], requests = [];
  const button = {
    dataset: { venueFollow: "Test Club" }, disabled: false, innerHTML: "Favorite", attributes: {},
    setAttribute(key, value) { this.attributes[key] = value; },
    removeAttribute(key) { delete this.attributes[key]; },
  };
  const context = vm.createContext({
    customerSavedStateVersion: 0,
    followedVenuesByCity: { "Test City": [] },
    markets: { "Test City": { venues: [{ id: "club-id", name: "Test Club" }] } },
    citySelect: { value: "Test City" },
    event: { target: { closest: () => button }, preventDefault() {}, stopPropagation() {} },
    requireCustomerAccountForProfileAction: () => true,
    isCustomerSession: () => true,
    actionButtonLabel: (_icon, label) => label,
    getAuthenticatedJson: async () => ({}),
    postAuthenticatedJson: async (_path, body) => {
      requests.push(body);
      return { ok: true, following: body.following };
    },
    showToast: (message) => notices.push(message),
    render() {}, renderDashboard() {}, console,
    customerDashboard: { classList: { contains: () => false } },
    applyLiveCustomerSaved(saved) {
      context.followedVenuesByCity["Test City"] = (saved.venueFollows || []).map((item) => item.venue.name);
      context.followedDancers = (saved.follows || []).map((item) => item.dancerId);
    },
  });
  vm.runInContext(between(home, "    async function loadLiveCustomerSaved()", "    async function loadLiveCustomerDashboardData()"), context);
  vm.runInContext("async function saveVenue() {" + between(home,
    '      const followVenueButton = event.target.closest("[data-venue-follow]");',
    '      const venueJump = event.target.closest("[data-venue-jump]");') + "}", context);
  return { context, button, notices, requests };
}

test("a venue save survives a saved-items refresh replacing the list during the request", async () => {
  const { context, button, notices } = homeFixture();
  const pending = deferred();
  context.getAuthenticatedJson = () => pending.promise;
  const save = context.saveVenue();
  assert.equal(button.innerHTML, "Saving…");
  assert.equal(button.attributes["aria-busy"], "true");
  context.followedVenuesByCity["Test City"] = ["Another Club"];
  pending.resolve({ ok: true });
  await save;
  assert.deepEqual(Array.from(context.followedVenuesByCity["Test City"]), ["Another Club", "Test Club"]);
  assert.match(notices[0], /saved to Favorite Clubs in your dashboard/);
  assert.equal(button.disabled, false);
  assert.equal(button.attributes["aria-busy"], undefined);
});

test("an old saved-items response cannot erase a venue favorite confirmed after the read started", async () => {
  const { context } = homeFixture();
  const pending = deferred();
  context.getAuthenticatedJson = (path) => path.endsWith("/saved") ? pending.promise : Promise.resolve({ ok: true });
  const loading = context.loadLiveCustomerSaved();
  await context.saveVenue();
  pending.resolve({ ok: true, saved: { venueFollows: [] } });
  assert.equal(await loading, false);
  assert.deepEqual(Array.from(context.followedVenuesByCity["Test City"]), ["Test Club"]);
});

test("a fresh page restores multiple dancers and favorite venues from the saved response", async () => {
  const { context } = homeFixture();
  context.getAuthenticatedJson = async () => ({ ok: true, saved: {
    follows: ["dancer-1", "dancer-2", "dancer-3"].map((dancerId) => ({ dancerId })),
    venueFollows: [{ venue: { name: "Test Club" } }],
  } });
  assert.equal(await context.loadLiveCustomerSaved(), true);
  assert.deepEqual(Array.from(context.followedDancers), ["dancer-1", "dancer-2", "dancer-3"]);
  assert.deepEqual(Array.from(context.followedVenuesByCity["Test City"]), ["Test Club"]);
});

for (const following of [true, false]) {
  test(`late saved-state hydration updates an already-open dancer profile to ${following ? "Following" : "Follow"}`, () => {
    const city = "Test City";
    const dancers = ["Alpha", "Beta", "Gamma"].map((name) => ({ id: name, slug: name.toLowerCase(), name, followerCount: 12 }));
    const classes = new Set();
    const button = {
      dataset: { profile: "Beta" }, innerHTML: following ? "Follow" : "Following",
      attributes: { "aria-pressed": String(!following) },
      classList: { toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name) },
      setAttribute(name, value) { this.attributes[name] = value; },
    };
    const context = vm.createContext({
      markets: { [city]: { dancers, venues: [] } },
      followedByCity: { [city]: following ? [] : ["Beta"] },
      followedDancerIds: new Set(following ? [] : ["Beta"]),
      goingTonightSavedByProfile: {}, goingTonightByProfile: {},
      selectedCity: () => city,
      document: { getElementById: (id) => id === "followBtn" ? button : null },
      profileActionButtonMarkup: (icon, label) => `${icon}:${label}`,
      clearLiveProfileActionCollections() { context.followedByCity[city] = []; context.followedDancerIds.clear(); },
      enableProfileNotifications() {}, disableProfileNotifications() {},
    });
    vm.runInContext(between(home, "    function isFollowingProfile(", "    function isFavoritedProfile("), context);
    vm.runInContext(between(home, "    function findProfileBySavedDancer(", "    function applyLiveCustomerSaved("), context);
    vm.runInContext(between(home, "    function syncHomeFeedActionButtons(", "    function applyProfileFollowState("), context);
    // The profile has already rendered before the account's saved response arrives.
    context.applyLiveProfileActions({ follows: dancers.filter((dancer) => following || dancer.name !== "Beta").map((dancer) => ({
      dancer: { id: dancer.id, slug: dancer.slug, stageName: dancer.name, city }, notificationsEnabled: true,
    })) });
    assert.equal(button.attributes["aria-pressed"], String(following));
    assert.equal(classes.has("is-following"), following);
    assert.equal(button.innerHTML, following ? "check:Following" : "personPlus:Follow");
    assert.equal(dancers[1].followerCount, 12, "Loading preferences must not alter public follower counts.");
    context.document.getElementById = () => null;
    assert.doesNotThrow(() => context.applyLiveProfileActions({ follows: [] }), "Loading saved follows also works without an open profile.");
  });
}

test("a delayed saved-items response cannot erase multiple dancer follows", async () => {
  const { context } = homeFixture();
  const pending = deferred();
  context.followedDancers = [];
  context.getAuthenticatedJson = () => pending.promise;
  context.findProfile = (name) => ({ id: name, name });
  context.profileFollowSnapshot = (dancer) => ({ following: context.followedDancers.includes(dancer.id) });
  context.applyProfileFollowState = (dancer, _city, state) => {
    context.followedDancers = context.followedDancers.filter((id) => id !== dancer.id);
    if (state.following) context.followedDancers.push(dancer.id);
    return state;
  };
  context.applyConfirmedProfileFollow = context.applyProfileFollowState;
  context.recordLiveEvent = () => {};
  context.syncOpenProfileFollowButton = () => {};
  context.syncHomeFeedActionButtons = () => {};
  vm.runInContext(between(home, "    async function saveProfileFollow(", "    async function saveProfileNotifications("), context);
  const loading = context.loadLiveCustomerSaved();
  for (const name of ["dancer-1", "dancer-2", "dancer-3"]) {
    await context.saveProfileFollow({ disabled: false, dataset: { profile: name }, setAttribute() {}, removeAttribute() {} });
  }
  pending.resolve({ ok: true, saved: { follows: [] } });
  assert.equal(await loading, false);
  assert.deepEqual(Array.from(context.followedDancers), ["dancer-1", "dancer-2", "dancer-3"]);
});

test("repeated venue clicks submit once while saving and a failed save restores the button", async () => {
  const { context, button, notices } = homeFixture();
  const pending = deferred();
  let calls = 0;
  context.getAuthenticatedJson = async () => { calls += 1; await pending.promise; throw new Error("Service unavailable. Try again."); };
  const save = context.saveVenue();
  await context.saveVenue();
  assert.equal(calls, 1);
  pending.resolve();
  await save;
  assert.equal(button.innerHTML, "Favorite");
  assert.equal(button.disabled, false);
  assert.deepEqual(Array.from(context.followedVenuesByCity["Test City"]), []);
  assert.match(notices[0], /Try again/);
});

for (const following of [true, false]) {
  test(`dancer ${following ? "follow" : "unfollow"} preserves refreshed session credentials`, async () => {
    const session = { accessToken: "renewed-access", refreshToken: "renewed-refresh", expiresAt: 12345 };
    const writes = [];
    const query = { select() { return this; }, eq() { return this; },
      maybeSingle: async () => ({ data: { customer_id: "guest" }, error: null }),
      then: (resolve) => Promise.resolve({ count: 3, error: null }).then(resolve),
    };
    const exports = {};
    const context = vm.createContext({ exports, require(name) {
      if (name === "next/server") return { NextResponse: { json: Response.json } };
      if (name.endsWith("/request")) return { createRequestSupabaseContext: async () => ({ client: {}, user: { id: "guest" }, session }) };
      if (name.endsWith("/admin")) return { createAdminSupabaseClient: () => ({ from: () => query }) };
      if (name.endsWith("/bounded-json-body")) return { readBoundedJsonObject: (request) => request.json() };
      if (name.endsWith("/public-request-rate-limit")) return { enforcePublicRequestRateLimit: async () => {}, PublicRequestRateLimitError: class extends Error {} };
      if (name.endsWith("/resource-authorization")) return { requirePublicDancer: async () => {} };
      if (name.endsWith("/engagement-notifications")) return { resolvePublicDancerEngagementTarget: async () => null };
      if (name.endsWith("/customer")) return {
        followDancer: async (_client, customerId, dancerId) => writes.push({ customerId, dancerId, following: true }),
        unfollowDancer: async (_client, customerId, dancerId) => writes.push({ customerId, dancerId, following: false }),
      };
      if (name.endsWith("/api")) return { apiError: (error) => { throw error; } };
      throw new Error(name);
    } });
    vm.runInContext(ts.transpileModule(followRoute, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
    const dancerId = "11111111-1111-4111-8111-111111111111";
    const result = await context.exports.POST(new Request("https://example.test/api/customer/follows", {
      method: "POST", body: JSON.stringify({ dancerId, following }),
    }));
    const data = await result.json();
    assert.deepEqual(data.session, session);
    assert.deepEqual(writes, [{ customerId: "guest", dancerId, following }]);
    assert.equal(data.following, following);
  });
}

test("full dancer profiles use refreshed credentials for successive follows and after a hard refresh", async (t) => {
  const originalWindow = globalThis.window;
  let stored = JSON.stringify({ accessToken: "access-0", refreshToken: "refresh-0", account: { role: "customer" } });
  globalThis.window = { localStorage: { getItem: () => stored, setItem: (_key, value) => { stored = value; } } };
  t.after(() => { globalThis.window = originalWindow; });
  let generation = 0;
  const follows = [];
  const context = vm.createContext({
    token: "stale-render-token", mountedRef: { current: true },
    currentDashboardAuthHeaders, persistResponseSession,
    setStatus() {}, setToken() {}, setAccountRequiredAction() {},
    fetch: async (_path, options) => {
      assert.equal(options.headers.authorization, `Bearer access-${generation}`);
      assert.equal(options.headers["x-dancr-refresh-token"], `refresh-${generation}`);
      if (options.method === "POST") follows.push({ dancerId: JSON.parse(options.body).dancerId, notificationsEnabled: true });
      generation += 1;
      return Response.json({ ok: true, following: true, saved: { follows }, session: { accessToken: `access-${generation}`, refreshToken: `refresh-${generation}` } });
    },
  });
  const post = between(profile, "  async function postAction(", "  return (\n    <>".replaceAll("\n", profile.includes("\r\n") ? "\r\n" : "\n"));
  vm.runInContext(ts.transpileModule(post, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  for (const dancerId of ["dancer-1", "dancer-2", "dancer-3"]) {
    await context.postAction("/api/customer/follows", { dancerId, following: true }, "follow", new AbortController().signal);
  }
  // Execute the mount-time request again, using only the persisted browser session.
  context.controller = new AbortController();
  context.accessToken = JSON.parse(stored).accessToken;
  context.dancerId = "dancer-2";
  context.setSaved = (state) => { context.restored = state; };
  context.setSavedLoaded = () => {};
  const load = between(profile, '    const savedRequestHeaders =', "    return () => controller.abort();");
  await vm.runInContext(ts.transpileModule(load, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  assert.equal(context.restored.following, true);
  assert.equal(context.restored.notificationsEnabled, true);
  assert.equal(generation, 4);
  assert.equal(JSON.parse(stored).refreshToken, "refresh-4");
});
