import assert from "node:assert/strict";
import test from "node:test";
import { BROWSER_AUTH_SESSION_KEY as key, persistRefreshedBrowserAuthSession } from "../src/lib/dancr/browser-session.ts";

const original = { accessToken: "synthetic-a-old", refreshToken: "synthetic-a-refresh", expiresAt: 100,
  account: { id: "account-a", role: "customer", displayName: "Original" }, extra: "retained" };
const refreshed = { accessToken: "synthetic-a-new", refreshToken: "synthetic-a-new-refresh", expiresAt: 200 };

function fixture(t, options = {}) {
  const previousWindow = globalThis.window;
  const stored = new Map([[key, JSON.stringify(original)], ["mydancr:push-account", original.account.id]]);
  let reads = 0, writes = 0, removals = 0;
  globalThis.window = { navigator: {}, localStorage: {
    getItem(name) {
      const value = stored.get(name) ?? null;
      if (name === key) {
        reads++;
        if (options.failRead === reads) throw new Error("Synthetic unavailable storage");
        options.afterRead?.({ reads, stored });
      }
      if (name === "mydancr:push-account") options.afterPushRead?.({ stored });
      return value;
    },
    setItem(name, value) {
      if (options.failWrite) throw new Error("Synthetic full storage");
      writes++; stored.set(name, value);
    },
    removeItem(name) { removals++; stored.delete(name); },
  } };
  t.after(() => { globalThis.window = previousWindow; });
  return { stored, counters: () => ({ writes, removals }) };
}

for (const [name, replacement] of [
  ["another account", { ...original, accessToken: "synthetic-b", refreshToken: "synthetic-b-refresh", account: { id: "account-b", role: "dancer" } }],
  ["logout", null],
  ["newer tokens for the same account", { ...original, ...refreshed }],
  ["newer account details with the same tokens", { ...original, account: { ...original.account, displayName: "Updated elsewhere" } }],
]) test("refresh preserves " + name + " observed after its initial storage snapshot", t => {
  const raw = replacement ? JSON.stringify(replacement) : null;
  const f = fixture(t, { afterRead({ reads, stored }) {
    if (reads !== 1) return;
    if (raw === null) stored.delete(key); else stored.set(key, raw);
    stored.set("mydancr:push-account", "newer-push-marker");
  } });
  const saved = persistRefreshedBrowserAuthSession(refreshed, original);
  assert.equal(f.stored.get(key) ?? null, raw);
  assert.equal(f.stored.get("mydancr:push-account"), "newer-push-marker");
  assert.deepEqual(f.counters(), { writes: 0, removals: 0 });
  assert.equal(saved, false);
});

test("ordinary refresh changes only credentials and retains the captured account and push state", t => {
  const f = fixture(t);
  assert.equal(persistRefreshedBrowserAuthSession({ ...refreshed, account: { id: "ignored-account" } }, original), true);
  assert.deepEqual(JSON.parse(f.stored.get(key)), { ...original, ...refreshed });
  assert.equal(f.stored.get("mydancr:push-account"), original.account.id);
  assert.deepEqual(f.counters(), { writes: 1, removals: 0 });
});

test("refresh rechecks the snapshot after reading notification ownership", t => {
  const replacement = { ...original, accessToken: "synthetic-b", account: { id: "account-b", role: "customer" } };
  const raw = JSON.stringify(replacement);
  const f = fixture(t, { afterPushRead({ stored }) { stored.set(key, raw); stored.set("mydancr:push-account", "account-b"); } });
  assert.equal(persistRefreshedBrowserAuthSession(refreshed, original), false);
  assert.equal(f.stored.get(key), raw);
  assert.equal(f.stored.get("mydancr:push-account"), "account-b");
  assert.deepEqual(f.counters(), { writes: 0, removals: 0 });
});

test("successful refresh still removes stale notification ownership for another account", t => {
  const f = fixture(t); f.stored.set("mydancr:push-account", "stale-account");
  assert.equal(persistRefreshedBrowserAuthSession(refreshed, original), true);
  assert.deepEqual(JSON.parse(f.stored.get(key)), { ...original, ...refreshed });
  assert.equal(f.stored.has("mydancr:push-account"), false);
  assert.deepEqual(f.counters(), { writes: 1, removals: 1 });
});

for (const options of [{ failRead: 1 }, { failRead: 2 }, { failWrite: true }]) {
  test("refresh handles unavailable storage without replacing credentials: " + JSON.stringify(options), t => {
    const f = fixture(t, options);
    assert.equal(persistRefreshedBrowserAuthSession(refreshed, original), false);
    assert.equal(f.stored.get(key), JSON.stringify(original));
    assert.equal(f.stored.get("mydancr:push-account"), original.account.id);
    assert.deepEqual(f.counters(), { writes: 0, removals: 0 });
  });
}

for (const raw of ["not-json", "[]", "null"]) test("refresh rejects malformed stored session: " + raw, t => {
  const f = fixture(t); f.stored.set(key, raw);
  assert.equal(persistRefreshedBrowserAuthSession(refreshed, original), false);
  assert.equal(f.stored.get(key), raw);
  assert.deepEqual(f.counters(), { writes: 0, removals: 0 });
});
