import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ADMIN_SESSION_KEY,
  AdminDataRequestError,
  clearAdminSession,
  isAdminAuthenticationError,
  persistAdminSession,
  readAdminAccessToken,
  readAdminJson,
} from "../app/admin/admin-session.ts";

const [adminSource, adminSession, dealMigration] = await Promise.all([
  readFile(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/admin-session.ts", import.meta.url), "utf8"),
  readFile(
    new URL("../supabase/migrations/202606280002_club_deal_qr_attribution.sql", import.meta.url),
    "utf8",
  ),
]);

test("admin authentication is separate from optional dashboard section failures", () => {
  assert.match(adminSource, /authRequired\?: boolean/);
  assert.match(adminSource, /warnings\?: string\[\]/);
  assert.match(adminSource, /const needsSignIn = state\.authRequired === true/);
  assert.match(adminSource, /Promise\.allSettled/);
  assert.match(adminSource, /isAdminAuthenticationError\(result\.reason\)/);
  assert.match(adminSource, /nextState\.warnings = warnings/);
  assert.match(adminSource, /Retry unavailable sections/);
  assert.doesNotMatch(adminSource, /const needsSignIn = Boolean\(state\.error\)/);
});

test("stored sessions must belong to an admin before admin APIs receive their token", () => {
  assert.match(adminSource, /readAdminAccessToken as readToken/);
  assert.match(adminSession, /session\.account\?\.role !== "admin"/);
  assert.match(adminSession, /window\.localStorage\.removeItem\(ADMIN_SESSION_KEY\)/);
});

test("admin session persistence and authenticated JSON errors have one typed boundary", () => {
  assert.match(adminSession, /export const ADMIN_SESSION_KEY = "dancrAuthSessionV1"/);
  assert.match(adminSession, /typeof window === "undefined"/);
  assert.match(adminSession, /export function persistAdminSession/);
  assert.match(adminSession, /export async function readAdminJson/);
  assert.match(adminSession, /throw new AdminDataRequestError/);
  assert.match(adminSession, /error\.status === 401 \|\| error\.status === 403/);
  assert.doesNotMatch(adminSource, /function readToken\(|async function readJson\(|class AdminDataRequestError/);
});

test("the admin session boundary stores only the canonical session and rejects non-admin roles", () => {
  const previousWindow = globalThis.window;
  const stored = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, value),
      removeItem: (key) => stored.delete(key),
    },
  };

  try {
    persistAdminSession(
      { accessToken: "admin-access", refreshToken: "admin-refresh", expiresAt: 12345 },
      { role: "admin", displayName: "Platform Admin" },
    );
    assert.equal(readAdminAccessToken(), "admin-access");
    assert.deepEqual(JSON.parse(stored.get(ADMIN_SESSION_KEY)), {
      accessToken: "admin-access",
      refreshToken: "admin-refresh",
      expiresAt: 12345,
      account: { role: "admin", displayName: "Platform Admin" },
    });

    stored.set(ADMIN_SESSION_KEY, JSON.stringify({ accessToken: "dancer-access", account: { role: "dancer" } }));
    assert.equal(readAdminAccessToken(), "");
    clearAdminSession();
    assert.equal(stored.has(ADMIN_SESSION_KEY), false);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("the admin request boundary classifies authorization failures by HTTP status", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, error: "Admin sign in required." }), {
    status: 403,
    headers: { "content-type": "application/json" },
  });

  try {
    await assert.rejects(
      () => readAdminJson("/api/admin/monitoring", { authorization: "Bearer expired" }),
      (error) => error instanceof AdminDataRequestError
        && error.message === "Admin sign in required."
        && isAdminAuthenticationError(error),
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("deal attribution policies call the shared no-argument admin authorization function", () => {
  assert.match(dealMigration, /using \(public\.is_admin\(\)\)/);
  assert.match(dealMigration, /with check \(public\.is_admin\(\)\)/);
  assert.doesNotMatch(dealMigration, /public\.is_admin\(auth\.uid\(\)\)/);
});
