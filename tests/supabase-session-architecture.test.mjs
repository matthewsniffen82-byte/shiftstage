import assert from "node:assert/strict";
import test from "node:test";
import { validatePublicSupabaseConfig } from "../src/lib/supabase/public-config.mjs";
import { persistBrowserAuthSession, persistRefreshedBrowserAuthSession, readBrowserAuthSession, clearBrowserAuthSession } from "../src/lib/dancr/browser-session.ts";
import { requestAdminJson } from "../app/admin/admin-session.ts";

const jwt = payload => `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
test("public configuration accepts anon and publishable credentials and rejects secrets without echoing them", () => {
  assert.doesNotThrow(() => validatePublicSupabaseConfig("https://example.supabase.co", jwt({ role: "anon", ref: "example" })));
  assert.doesNotThrow(() => validatePublicSupabaseConfig("http://localhost:54321", "sb_publishable_example"));
  assert.doesNotThrow(() => validatePublicSupabaseConfig(undefined, undefined, { allowMissing: true }));
  for (const [url, key] of [
    ["https://example.supabase.co", jwt({ role: "service_role" })],
    ["https://example.supabase.co", "sb_secret_privatevalue"],
    ["https://example.supabase.co", jwt({ role: "anon", ref: "wrong" })],
    ["http://example.supabase.co", "sb_publishable_example"],
    ["https://user:password@example.supabase.co", "sb_publishable_example"],
    ["not-a-url", "sb_publishable_example"],
    [undefined, undefined],
  ]) {
    assert.throws(() => validatePublicSupabaseConfig(url, key), error => {
      if (key) assert.equal(error.message.includes(key), false);
      return true;
    });
  }
});

test("late refreshed credentials cannot restore logout, replace another account, or roll back newer credentials", async () => {
  const previousWindow = globalThis.window, previousFetch = globalThis.fetch;
  const stored = new Map();
  globalThis.window = { localStorage: {
    getItem: key => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key),
  } };
  const original = { accessToken: "old", refreshToken: "old-refresh", account: { id: "a", role: "admin" } };
  const refreshed = { accessToken: "new", refreshToken: "new-refresh" };
  try {
    persistBrowserAuthSession(original);
    assert.equal(persistRefreshedBrowserAuthSession(refreshed), false);
    assert.equal(persistRefreshedBrowserAuthSession(refreshed, original), true);
    assert.equal(persistRefreshedBrowserAuthSession({ accessToken: "late" }, original), false);
    assert.equal(readBrowserAuthSession().accessToken, "new");
    clearBrowserAuthSession();
    assert.equal(persistRefreshedBrowserAuthSession(refreshed, original), false);
    assert.equal(readBrowserAuthSession(), null);
    persistBrowserAuthSession(original);
    let finish;
    globalThis.fetch = () => new Promise(resolve => { finish = resolve; });
    const pending = requestAdminJson("/api/admin/test");
    const replacement = { accessToken: "other", refreshToken: "other-refresh", account: { id: "b", role: "admin" } };
    persistBrowserAuthSession(replacement);
    finish({ ok: true, json: async () => ({ ok: true, session: refreshed }) });
    await pending;
    assert.deepEqual(readBrowserAuthSession(), replacement);
  } finally { globalThis.window = previousWindow; globalThis.fetch = previousFetch; }
});
