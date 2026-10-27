import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { requestDashboardJson } from "../app/dashboard/dashboard-session.ts";

const key = "dancrAuthSessionV1";
const original = { accessToken: "old-access", refreshToken: "old-refresh", account: { id: "club-a", role: "venue", accountState: "active" } };
const source = readFileSync(new URL("../src/live-shell/app/02-record-live-event.js", import.meta.url), "utf8");
const validator = source.slice(source.indexOf("    let storedAuthValidation = null;"), source.indexOf("    function captureAuthSessionGuard()"));
const events = readFileSync(new URL("../src/live-shell/app/26-sync-discovery-city-scope.js", import.meta.url), "utf8");

function fixture(t, surface) {
  const stored = new Map([[key, JSON.stringify(original)]]), reloads = [], headerUpdates = [], restored = [];
  const storage = { getItem: k => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v), removeItem: k => stored.delete(k) };
  const previousWindow = globalThis.window;
  globalThis.window = { localStorage: storage, navigator: {} };
  t.after(() => { globalThis.window = previousWindow; });
  const body = { inert: false, style: { visibility: "visible" } };
  let fetcher;
  t.mock.method(globalThis, "fetch", (...args) => fetcher(...args));
  const context = vm.createContext({
    internalProfileFrameId: "", Promise, Date,
    synchronizeAuthSession: () => JSON.parse(stored.get(key) || "null"),
    authenticatedRequestHeaders: (_, session) => ({ Authorization: `Bearer ${session.accessToken}`, "X-Dancr-Refresh-Token": session.refreshToken }),
    fetchWithTimeout: (...args) => fetcher(...args),
    saveAuthSession: session => session ? stored.set(key, JSON.stringify(session)) : stored.delete(key),
    document: { body }, window: { location: { reload: () => reloads.push(true) } },
    restoreLoggedInSessionState: () => restored.push(true), syncSignedInAccountControl() {}, updateAccountHeader: () => headerUpdates.push(true),
  });
  vm.runInContext(validator, context);
  return {
    context, reloads, body, headerUpdates, restored,
    read: () => JSON.parse(stored.get(key) || "null"),
    store: session => session ? stored.set(key, JSON.stringify(session)) : stored.delete(key),
    setFetch: fn => { fetcher = fn; },
    run: (path = "/api/account", options) => surface === "home" ? context.validateStoredAuthSession() : requestDashboardJson(path, options),
  };
}

const reply = (status, extra = {}) => Response.json({ ok: status === 200, ...extra }, { status });
async function finish(f) { try { await f.run(); } catch (error) { assert.equal(error.status, 401); } }

for (const surface of ["home", "dashboard"]) {
  for (const [reason, status, extra] of [
    ["deleted auth identity", 401, {}], ["missing account", 404, {}],
    ["deleted app account", 200, { account: { ...original.account, accountState: "deleted" } }],
  ]) {
    test(`${surface} removes stale credentials after ${reason}`, async t => {
      const f = fixture(t, surface);
      f.setFetch(async () => reply(status, extra));
      await finish(f);
      assert.equal(f.read(), null);
      if (surface === "home") {
        assert.equal(f.body.inert, true);
        assert.equal(f.body.style.visibility, "hidden");
        assert.equal(f.reloads.length, 1);
      }
    });
  }

  for (const status of [403, 409, 429, 500, 503]) {
    test(`${surface} preserves sign-in on HTTP ${status}`, async t => {
      const f = fixture(t, surface);
      f.setFetch(async () => reply(status));
      await f.run().catch(() => {});
      assert.deepEqual(f.read(), original);
      assert.equal(f.reloads.length, 0);
    });
  }

  test(`${surface} preserves sign-in while offline`, async t => {
    const f = fixture(t, surface);
    f.setFetch(async () => { throw new TypeError("Network unavailable"); });
    await f.run().catch(() => {});
    assert.deepEqual(f.read(), original);
  });

  test(`${surface} keeps a paused account available for recovery`, async t => {
    const f = fixture(t, surface);
    f.setFetch(async () => reply(200, { account: { ...original.account, accountState: "disabled" } }));
    await f.run();
    assert.equal(f.read().account.accountState, "disabled");
    assert.equal(f.read().accessToken, original.accessToken);
  });

  for (const replacement of [null,
    { ...original, accessToken: "rotated", refreshToken: "rotated-refresh" },
    { accessToken: "new-login", refreshToken: "new-refresh", account: { id: "customer-b", role: "customer" } },
  ]) {
    for (const status of [200, 401]) {
      test(`${surface} ignores late HTTP ${status} after ${replacement?.accessToken || "logout"}`, async t => {
        const f = fixture(t, surface);
        let resolve;
        f.setFetch(() => new Promise(done => { resolve = done; }));
        const pending = f.run().catch(() => {});
        f.store(replacement);
        resolve(reply(status, { account: original.account, session: original }));
        await pending;
        assert.deepEqual(f.read(), replacement);
        assert.equal(f.reloads.length, 0);
      });
    }
  }
}

test("homepage validation coalesces page, focus, and visibility checks", async t => {
  const f = fixture(t, "home");
  let resolve, calls = 0;
  f.setFetch((_url, options, timeout) => {
    calls++;
    assert.equal(options.cache, "no-store");
    assert.equal(timeout, 8000);
    return new Promise(done => { resolve = done; });
  });
  const first = f.run(), second = f.run();
  resolve(reply(200, { account: original.account }));
  await Promise.all([first, second]);
  await f.run();
  assert.equal(calls, 1);
  assert.equal(f.headerUpdates.length, 1);
  assert.equal(f.restored.length, 0, "same-account validation must preserve already loaded private data");
});

test("homepage stores the verified account and refreshed credentials", async t => {
  const f = fixture(t, "home");
  f.setFetch(async () => reply(200, { account: { ...original.account, displayName: "Confirmed club" }, session: { accessToken: "fresh", refreshToken: "fresh-refresh", expiresAt: 123 } }));
  await f.run();
  assert.equal(f.read().account.displayName, "Confirmed club");
  assert.equal(f.read().accessToken, "fresh");
  assert.equal(f.read().expiresAt, 123);
});

test("homepage checks saved sign-in on startup and return without refreshing internal profiles", async t => {
  assert.match(events, /restoreLoggedInSessionState\(\);\s+updateAccountHeader\(\);\s+void validateStoredAuthSession\(\)/);
  for (const event of ["focus", "pageshow", "visibilitychange"]) {
    assert.match(events, new RegExp(`addEventListener\\("${event}"[\\s\\S]*?validateStoredAuthSession\\(\\)`));
  }
  const f = fixture(t, "home");
  f.context.internalProfileFrameId = "internal-profile";
  f.setFetch(() => { assert.fail("Internal profile must not restart authentication"); });
  await f.run();
});

test("dashboard resource 404 does not mean the account was deleted", async t => {
  const f = fixture(t, "dashboard");
  f.setFetch(async () => reply(404));
  await assert.rejects(f.run("/api/venue/dashboard"), { status: 404 });
  assert.deepEqual(f.read(), original);
});

test("an aborted dashboard check cannot clear the saved session", async t => {
  const f = fixture(t, "dashboard"), controller = new AbortController();
  f.setFetch(async () => { controller.abort(); return reply(401); });
  await assert.rejects(f.run("/api/account", { signal: controller.signal }), { status: 401 });
  assert.deepEqual(f.read(), original);
});
