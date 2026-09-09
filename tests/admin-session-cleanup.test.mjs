import assert from "node:assert/strict";
import test from "node:test";
import { clearAdminSession } from "../app/admin/admin-session.ts";
import { BROWSER_AUTH_SESSION_KEY } from "../src/lib/dancr/browser-session.ts";

const session = (id, role = "admin", suffix = "original") => ({
  accessToken: `${id}-${suffix}-access`, refreshToken: `${id}-${suffix}-refresh`,
  account: { id, role },
});
const original = session("admin-a");

for (const [name, expected, current] of [
  ["opening admin as a customer", null, session("customer", "customer")],
  ["a customer login replaces an in-flight admin request", original, session("customer", "customer")],
  ["a different administrator signs in", original, session("admin-b")],
  ["the original administrator has newer credentials", original, session("admin-a", "admin", "new")],
]) {
  test(`admin cleanup preserves the current session when ${name}`, () => {
    const priorWindow = globalThis.window;
    const stored = new Map([[BROWSER_AUTH_SESSION_KEY, JSON.stringify(current)], ["mydancr:push-account", current.account.id]]);
    globalThis.window = { localStorage: {
      getItem: key => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, value),
      removeItem: key => stored.delete(key),
    } };
    try {
      clearAdminSession(expected);
      assert.equal(stored.get(BROWSER_AUTH_SESSION_KEY), JSON.stringify(current));
      assert.equal(stored.get("mydancr:push-account"), current.account.id);
    } finally { globalThis.window = priorWindow; }
  });
}

test("admin cleanup still removes the exact failed admin session", () => {
  const priorWindow = globalThis.window;
  const stored = new Map([[BROWSER_AUTH_SESSION_KEY, JSON.stringify(original)]]);
  globalThis.window = { localStorage: {
    getItem: key => stored.get(key) ?? null,
    removeItem: key => stored.delete(key),
  } };
  try {
    clearAdminSession(original);
    assert.equal(stored.has(BROWSER_AUTH_SESSION_KEY), false);
  } finally { globalThis.window = priorWindow; }
});
