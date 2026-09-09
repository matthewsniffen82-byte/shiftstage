import assert from "node:assert/strict";
import test from "node:test";
import { loadDancerDashboard } from "../app/dashboard/dancer-dashboard-loader.ts";
import { DASHBOARD_SESSION_KEY } from "../app/dashboard/dashboard-session.ts";

const response = (data) => new Response(JSON.stringify({ ok: true, ...data }));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const settle = () => new Promise(resolve => setImmediate(resolve));
function setup(t, fresh = true, account) {
  const previousWindow = globalThis.window;
  globalThis.window = { localStorage: {
    getItem: key => key === DASHBOARD_SESSION_KEY ? JSON.stringify({ account, accessToken: "test-token", refreshToken: "test-refresh", expiresAt: fresh ? Date.now() / 1000 + 3600 : 0 }) : null,
    setItem() {},
  } };
  t.after(() => { globalThis.window = previousWindow; });
  t.mock.method(globalThis, "fetch", async () => response({}));
  t.mock.method(console, "warn", () => {});
}

test("the real dashboard opens before background reports, support and referral access finish", async t => {
  setup(t);
  const background = deferred(), ready = deferred(), updates = [];
  globalThis.fetch = async path => {
    if (path === "/api/account") return response({ account: { role: "dancer" } });
    if (path === "/api/dancer/dashboard") return response({ nfc: { activated: true }, finance: { connected: true } });
    if (path === "/api/dancer/profile") return response({ profile: { stage_name: "Stacy", status: "approved" } });
    await background.promise;
    return response({ threads: [{ id: "support-1" }], report: { rank: 2 }, events: [{ id: "event-1" }], reviews: [{ id: "review-1" }], access: { active: true } });
  };
  const loading = loadDancerDashboard(new AbortController().signal, (panel, data) => {
    updates.push({ panel, data });
    if (panel === "ready") ready.resolve();
  });
  await ready.promise;
  assert.deepEqual(updates.map(update => update.panel), ["ready"]);
  assert.equal(updates[0].data.profile.status, "approved");
  assert.equal(updates[0].data.nfc.activated, true);
  assert.equal(updates[0].data.finance.connected, true);
  background.resolve();
  await loading;
  assert.equal(updates.length, 6);
  assert.equal(updates.find(update => update.panel === "supportThreads").data[0].id, "support-1");
  assert.equal(updates.find(update => update.panel === "weeklyReport").data.rank, 2);
});

test("first-tap activation finishes before fetching the profile, and account verification gates display", async t => {
  setup(t);
  const account = deferred(), activation = deferred(), paths = [], updates = [];
  globalThis.fetch = async path => {
    paths.push(path);
    if (path === "/api/account") { await account.promise; return response({ account: { role: "dancer" } }); }
    if (path === "/api/dancer/dashboard") await activation.promise;
    return response(path === "/api/dancer/profile" ? { profile: { status: "approved" } } : {});
  };
  const loading = loadDancerDashboard(new AbortController().signal, (panel, data) => updates.push({ panel, data }));
  await settle();
  assert.ok(paths.includes("/api/account") && paths.includes("/api/dancer/dashboard"));
  assert.ok(!paths.includes("/api/dancer/profile"));
  activation.resolve();
  await settle();
  assert.ok(paths.includes("/api/dancer/profile"));
  assert.ok(!updates.some(update => update.panel === "ready"));
  account.resolve();
  await loading;
  assert.equal(updates.find(update => update.panel === "ready").data.profile.status, "approved");
});

test("an expiring session refreshes before any dancer panels start", async t => {
  setup(t, false);
  const account = deferred(), paths = [];
  globalThis.fetch = async path => {
    paths.push(path);
    if (path === "/api/account") await account.promise;
    return response({});
  };
  const loading = loadDancerDashboard(new AbortController().signal, () => {});
  await settle();
  assert.deepEqual(paths, ["/api/account"]);
  account.resolve();
  await loading;
  assert.ok(paths.includes("/api/dancer/profile"));
});

for (const failedPath of ["/api/account", "/api/dancer/dashboard", "/api/dancer/profile"]) {
  test(`a failed ${failedPath} never presents an incomplete or approved dashboard`, async t => {
    setup(t);
    const controller = new AbortController(), updates = [];
    globalThis.fetch = async path => path === failedPath
      ? new Response(JSON.stringify({ ok: false, error: "Temporarily unavailable." }), { status: 503 })
      : response({});
    await assert.rejects(loadDancerDashboard(controller.signal, panel => updates.push(panel)), /Temporarily unavailable/);
    controller.abort();
    await settle();
    assert.ok(!updates.includes("ready"));
  });
}

test("closing during loading discards late responses", async t => {
  setup(t);
  const controller = new AbortController(), pending = deferred(), updates = [], paths = [];
  globalThis.fetch = async path => { paths.push(path); await pending.promise; return response({}); };
  const loading = loadDancerDashboard(controller.signal, panel => updates.push(panel));
  controller.abort();
  pending.resolve();
  await loading;
  assert.deepEqual(updates, []);
  assert.ok(!paths.includes("/api/dancer/profile"));
});

test("background failures cannot block a valid dashboard", async t => {
  setup(t);
  const updates = [];
  globalThis.fetch = async path => ["/api/account", "/api/dancer/dashboard", "/api/dancer/profile"].includes(path)
    ? response({ profile: { stage_name: "Stacy" } })
    : new Response(JSON.stringify({ ok: false }), { status: 503 });
  await loadDancerDashboard(new AbortController().signal, panel => updates.push(panel));
  assert.ok(updates.includes("ready"));
});

const pausedAccount = { id: "dancer-owner", role: "dancer", accountState: "disabled" };
const dancerDenied = () => Response.json({ ok: false, error: "Active dancer account required." }, { status: 403 });

test("a verified paused dancer can reload account controls despite denied dancer tools", async t => {
  setup(t, true, { ...pausedAccount, accountState: "active" });
  const updates = [];
  globalThis.fetch = async path => path === "/api/account"
    ? response({ account: pausedAccount })
    : path.startsWith("/api/dancer/") ? dancerDenied() : response({ threads: [{ id: "support-1" }] });
  await loadDancerDashboard(new AbortController().signal, (panel, data) => updates.push({ panel, data }));
  const ready = updates.find(update => update.panel === "ready").data;
  assert.equal(ready.account.accountState, "disabled");
  assert.equal(ready.profile, null);
  assert.equal(ready.nfc, null);
  assert.equal(ready.finance, null);
  assert.deepEqual(ready.affiliations, []);
  assert.equal(updates.find(update => update.panel === "supportThreads").data[0].id, "support-1");
});

for (const result of ["denied", "stale-success"]) test(`paused controls do not wait for a slow ${result} dancer response`, async t => {
  setup(t);
  const gate = deferred(), updates = [];
  globalThis.fetch = async path => {
    if (path === "/api/account") return response({ account: pausedAccount });
    if (path === "/api/dancer/dashboard") {
      await gate.promise;
      return result === "denied" ? dancerDenied() : response({ finance: { connected: true } });
    }
    return response({ profile: { status: "approved" } });
  };
  const loading = loadDancerDashboard(new AbortController().signal, (panel, data) => updates.push({ panel, data }));
  // Observe a rejection as well, so a deliberately failing baseline cannot leave
  // an unhandled promise when the held private response is released in cleanup.
  const settled = loading.catch(error => error);
  try {
    await settle();
    const ready = updates.find(update => update.panel === "ready");
    assert.ok(ready, "account controls should open while the private response is held");
    assert.equal(ready.data.profile, null);
  } finally {
    gate.resolve();
    await settled;
    await settle();
  }
  assert.equal(updates.filter(update => update.panel === "ready").length, 1);
  assert.equal(updates.find(update => update.panel === "ready").data.profile, null);
});

test("a cached pause cannot bypass a failed account verification", async t => {
  setup(t, true, pausedAccount);
  const updates = [];
  globalThis.fetch = async path => path === "/api/account"
    ? Response.json({ ok: false, error: "Account verification unavailable." }, { status: 503 })
    : dancerDenied();
  await assert.rejects(loadDancerDashboard(new AbortController().signal, panel => updates.push(panel)));
  assert.ok(!updates.includes("ready"));
});

for (const account of [
  { ...pausedAccount, role: "customer" },
  { ...pausedAccount, accountState: "deleted" },
  { ...pausedAccount, accountState: "active" },
]) test(`a ${account.accountState} ${account.role} does not bypass denied dancer tools`, async t => {
  setup(t, true, pausedAccount);
  const updates = [];
  globalThis.fetch = async path => path === "/api/account" ? response({ account }) : dancerDenied();
  await assert.rejects(loadDancerDashboard(new AbortController().signal, panel => updates.push(panel)), /Active dancer account required/);
  assert.ok(!updates.includes("ready"));
});
