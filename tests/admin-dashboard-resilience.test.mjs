import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ADMIN_SESSION_KEY,
  AdminDataRequestError,
  clearAdminSession,
  adminAuthHeaders,
  isAdminAuthenticationError,
  persistAdminSession,
  persistRefreshedAdminSession,
  readAdminAccessToken,
  requestAdminJson,
} from "../app/admin/admin-session.ts";

const [adminSource, adminSession, nfcPanel, dmcaPanel, pilotPanel, tvPanel, dealMigration, monitoringRoute, operationsRoute, subscriptionsRoute] = await Promise.all([
  readFile(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/admin-session.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/AdminNfcInventoryPanel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/AdminDmcaPanel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/AdminPilotAnalytics.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/AdminTvPanel.tsx", import.meta.url), "utf8"),
  readFile(
    new URL("../supabase/migrations/202606280002_club_deal_qr_attribution.sql", import.meta.url),
    "utf8",
  ),
  readFile(new URL("../app/api/admin/monitoring/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/operations/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/subscriptions/route.ts", import.meta.url), "utf8"),
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
  assert.match(adminSource, /requestAdminJson/);
  assert.match(adminSession, /session\?\.account\?\.role !== "admin"/);
  assert.match(adminSession, /clearBrowserAuthSession\(\)/);
});

test("admin session persistence and authenticated JSON errors have one typed boundary", () => {
  assert.match(adminSession, /export const ADMIN_SESSION_KEY = BROWSER_AUTH_SESSION_KEY/);
  assert.match(adminSession, /from "\.\.\/\.\.\/src\/lib\/dancr\/browser-session\.ts"/);
  assert.match(adminSession, /persistBrowserAuthSession\(\{/);
  assert.match(adminSession, /persistRefreshedBrowserAuthSession\(session\)/);
  assert.doesNotMatch(adminSession, /window\.localStorage\.(?:getItem|setItem|removeItem)\(/);
  assert.match(adminSession, /export function persistAdminSession/);
  assert.match(adminSession, /export async function requestAdminJson/);
  assert.match(adminSession, /throw new AdminDataRequestError/);
  assert.match(adminSession, /error\.status === 401 \|\| error\.status === 403/);
  assert.doesNotMatch(adminSource, /readAdminAccessToken as readToken|readAdminJson as readJson|function readToken\(|async function readJson\(|class AdminDataRequestError/);
});

test("every top-level admin workspace load preserves refreshed sessions", () => {
  assert.equal((adminSource.match(/sections\.map\(\(section\) => requestAdminJson\(section\.path/g) || []).length, 2);
  assert.doesNotMatch(adminSource, /sections\.map\(\(section\) => readJson/);
  for (const route of [monitoringRoute, operationsRoute, subscriptionsRoute]) {
    assert.match(route, /const \{ client, session, user \} = await createRequestSupabaseContext\(request\)/);
    assert.match(route, /session: session \|\| null/);
  }
});

test("the top-level admin shell cancels stale loads and serializes authentication", () => {
  const shell = adminSource.match(/export default function AdminClient[\s\S]*?(?=function AdminDashboardLoadingState)/)?.[0] || "";
  assert.match(shell, /const mountedRef = useRef\(false\);/);
  assert.match(shell, /const dataGenerationRef = useRef\(0\);/);
  assert.match(shell, /const adminLoadAbortRef = useRef<AbortController \| null>\(null\);/);
  assert.match(shell, /const workspaceLoadRef = useRef<AdminWorkspaceRequest \| null>\(null\);/);
  assert.match(shell, /const authActionInFlightRef = useRef\(false\);/);
  assert.match(shell, /function invalidateAdminDataRequests\(\)/);
  assert.match(shell, /function cancelWorkspaceLoad\(\)/);
  assert.match(shell, /if \(!mountedRef\.current \|\| authActionInFlightRef\.current\) return null;/);
  assert.equal((shell.match(/signal: controller\.signal/g) || []).length, 2);
  assert.equal((shell.match(/signal: action\.controller\.signal/g) || []).length, 2);
  assert.match(shell, /workspaceLoadRef\.current === request/);
  assert.match(shell, /generation === dataGenerationRef\.current/);
  assert.match(shell, /invalidateAdminDataRequests\(\);\s+cancelAuthAction\(\);\s+clearAdminSession\(\)/);
  assert.match(shell, /disabled=\{authBusy\}/);
});

test("copyright administration cancels stale loads and serializes mutations", () => {
  assert.match(dmcaPanel, /const mountedRef = useRef\(false\);/);
  assert.match(dmcaPanel, /const loadSequenceRef = useRef\(0\);/);
  assert.match(dmcaPanel, /const loadAbortRef = useRef<AbortController \| null>\(null\);/);
  assert.match(dmcaPanel, /const actionSequenceRef = useRef\(0\);/);
  assert.match(dmcaPanel, /const actionAbortRef = useRef<AbortController \| null>\(null\);/);
  assert.match(dmcaPanel, /const actionInFlightRef = useRef\(false\);/);
  assert.match(dmcaPanel, /signal: controller\.signal/);
  assert.match(dmcaPanel, /requestId !== loadSequenceRef\.current/);
  assert.match(dmcaPanel, /if \(!mountedRef\.current \|\| actionInFlightRef\.current\) return;/);
  assert.match(dmcaPanel, /requestId !== actionSequenceRef\.current/);
  assert.match(dmcaPanel, /disabled=\{actionBusy\}/);
  assert.match(dmcaPanel, /<form key=\{agentFormVersion\} onSubmit=\{saveAgent\}>/);
  assert.match(dmcaPanel, /load\(\{ refreshAgent: false, clearStatus: false \}\)/);
});

test("admin NFC inventory cancels stale loads and serializes sticker mutations", () => {
  assert.match(nfcPanel, /const mountedRef = useRef\(false\);/);
  assert.match(nfcPanel, /const loadSequenceRef = useRef\(0\);/);
  assert.match(nfcPanel, /const loadAbortRef = useRef<AbortController \| null>\(null\);/);
  assert.match(nfcPanel, /const actionSequenceRef = useRef\(0\);/);
  assert.match(nfcPanel, /const actionAbortRef = useRef<AbortController \| null>\(null\);/);
  assert.match(nfcPanel, /const actionInFlightRef = useRef\(false\);/);
  assert.match(nfcPanel, /loadSequenceRef\.current \+= 1;[\s\S]*?loadAbortRef\.current\?\.abort\(\);/);
  assert.match(nfcPanel, /if \(!mountedRef\.current \|\| actionInFlightRef\.current\) return;/);
  assert.match(nfcPanel, /requestId !== actionSequenceRef\.current/);
  assert.match(nfcPanel, /load\(\{ clearStatus: false \}\)/);
  assert.match(nfcPanel, /signal: controller\.signal/);
});

test("admin TV moderation cancels stale queues and serializes review decisions", () => {
  assert.match(tvPanel, /const mountedRef = useRef\(false\);/);
  assert.match(tvPanel, /const loadSequenceRef = useRef\(0\);/);
  assert.match(tvPanel, /const loadAbortRef = useRef<AbortController \| null>\(null\);/);
  assert.match(tvPanel, /const actionSequenceRef = useRef\(0\);/);
  assert.match(tvPanel, /const actionAbortRef = useRef<AbortController \| null>\(null\);/);
  assert.match(tvPanel, /const actionInFlightRef = useRef\(false\);/);
  assert.match(tvPanel, /if \(!mountedRef\.current \|\| actionInFlightRef\.current\) return;/);
  assert.match(tvPanel, /loadSequenceRef\.current \+= 1;[\s\S]*?loadAbortRef\.current\?\.abort\(\);/);
  assert.match(tvPanel, /requestId !== loadSequenceRef\.current/);
  assert.match(tvPanel, /requestId !== actionSequenceRef\.current/);
  assert.match(tvPanel, /loadVideos\(filter, \{ clearStatus: false \}\)/);
  assert.match(tvPanel, /disabled=\{Boolean\(workingId\)\}/);
});

test("pilot analytics cancels stale reports and serializes nightly totals", () => {
  assert.match(pilotPanel, /const mountedRef = useRef\(false\);/);
  assert.match(pilotPanel, /const loadSequenceRef = useRef\(0\);/);
  assert.match(pilotPanel, /const loadAbortRef = useRef<AbortController \| null>\(null\);/);
  assert.match(pilotPanel, /const actionSequenceRef = useRef\(0\);/);
  assert.match(pilotPanel, /const actionAbortRef = useRef<AbortController \| null>\(null\);/);
  assert.match(pilotPanel, /const actionInFlightRef = useRef\(false\);/);
  assert.match(pilotPanel, /if \(!venueId \|\| !mountedRef\.current \|\| actionInFlightRef\.current\) return;/);
  assert.match(pilotPanel, /requestId !== loadSequenceRef\.current/);
  assert.match(pilotPanel, /requestId !== actionSequenceRef\.current/);
  assert.match(pilotPanel, /loadAnalytics\(\{ clearError: false \}\)/);
  assert.match(pilotPanel, /signal: controller\.signal/);
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
    assert.deepEqual(adminAuthHeaders(), {
      authorization: "Bearer admin-access",
      "x-dancr-refresh-token": "admin-refresh",
    });
    assert.deepEqual(JSON.parse(stored.get(ADMIN_SESSION_KEY)), {
      accessToken: "admin-access",
      refreshToken: "admin-refresh",
      expiresAt: 12345,
      account: { role: "admin", displayName: "Platform Admin" },
    });

    persistRefreshedAdminSession({
      accessToken: "rotated-admin-access",
      refreshToken: "rotated-admin-refresh",
      expiresAt: 67890,
    });
    assert.equal(readAdminAccessToken(), "rotated-admin-access");
    assert.deepEqual(JSON.parse(stored.get(ADMIN_SESSION_KEY)), {
      accessToken: "rotated-admin-access",
      refreshToken: "rotated-admin-refresh",
      expiresAt: 67890,
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
  const previousWindow = globalThis.window;
  const stored = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, value),
      removeItem: (key) => stored.delete(key),
    },
  };
  persistAdminSession(
    { accessToken: "expired-admin-access", refreshToken: "admin-refresh", expiresAt: 12345 },
    { role: "admin" },
  );
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, error: "Admin sign in required." }), {
    status: 403,
    headers: { "content-type": "application/json" },
  });

  try {
    await assert.rejects(
      () => requestAdminJson("/api/admin/monitoring"),
      (error) => error instanceof AdminDataRequestError
        && error.message === "Admin sign in required."
        && isAdminAuthenticationError(error),
    );
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }
});

test("admin mutations send the refresh token and persist rotated sessions", async () => {
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  const stored = new Map();
  const requests = [];
  globalThis.window = {
    localStorage: {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, value),
      removeItem: (key) => stored.delete(key),
    },
  };
  persistAdminSession(
    { accessToken: "admin-access", refreshToken: "admin-refresh", expiresAt: 12345 },
    { role: "admin", displayName: "Platform Admin" },
  );
  globalThis.fetch = async (_path, init) => {
    requests.push(init);
    return new Response(JSON.stringify({
      ok: true,
      program: {},
      session: {
        accessToken: "rotated-admin-access",
        refreshToken: "rotated-admin-refresh",
        expiresAt: 67890,
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    await requestAdminJson("/api/admin/sales-agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "set_agent" }),
    });
    await requestAdminJson("/api/admin/sales-agents", { cache: "no-store" });

    assert.equal(requests[0].headers.authorization, "Bearer admin-access");
    assert.equal(requests[0].headers["x-dancr-refresh-token"], "admin-refresh");
    assert.equal(requests[1].headers.authorization, "Bearer rotated-admin-access");
    assert.equal(requests[1].headers["x-dancr-refresh-token"], "rotated-admin-refresh");
    assert.equal(readAdminAccessToken(), "rotated-admin-access");
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }
});

test("admin mutations reject non-admin browser sessions before making a request", async () => {
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  const stored = new Map([[ADMIN_SESSION_KEY, JSON.stringify({
    accessToken: "dancer-access",
    refreshToken: "dancer-refresh",
    account: { role: "dancer" },
  })]]);
  let requestCount = 0;
  globalThis.window = {
    localStorage: {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, value),
      removeItem: (key) => stored.delete(key),
    },
  };
  globalThis.fetch = async () => {
    requestCount += 1;
    throw new Error("A non-admin session must not reach the admin API.");
  };

  try {
    await assert.rejects(
      () => requestAdminJson("/api/admin/sales-agents", { method: "POST" }),
      (error) => error instanceof AdminDataRequestError
        && error.status === 401
        && error.message === "Admin sign in required.",
    );
    assert.equal(requestCount, 0);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }
});

test("every routed admin subpanel consumes the canonical role-aware session boundary", () => {
  assert.match(nfcPanel, /import \{ requestAdminJson \} from "\.\/admin-session"/);
  assert.equal((nfcPanel.match(/requestAdminJson\("\/api\/admin\/nfc-tags"/g) || []).length, 3);
  assert.doesNotMatch(nfcPanel, /adminAuthHeaders|persistRefreshedAdminSession|authorization:|fetch\("\/api\/admin\/nfc-tags"/);
  assert.match(dmcaPanel, /import \{ requestAdminJson \} from "\.\/admin-session"/);
  assert.equal((dmcaPanel.match(/requestAdminJson\("\/api\/admin\/dmca"/g) || []).length, 3);
  assert.doesNotMatch(dmcaPanel, /readAdminAccessToken|authorization:|fetch\("\/api\/admin\/dmca"/);
  assert.match(pilotPanel, /import \{ requestAdminJson \} from "\.\/admin-session"/);
  assert.equal((pilotPanel.match(/requestAdminJson\(/g) || []).length, 2);
  assert.doesNotMatch(pilotPanel, /readAdminAccessToken|authorization:|function pilotJson\(|fetch\(/);
  assert.match(tvPanel, /import \{ requestAdminJson \} from "\.\/admin-session"/);
  assert.equal((tvPanel.match(/requestAdminJson\("\/api\/admin\/tv\/videos"/g) || []).length, 2);
  assert.match(tvPanel, /requestAdminJson\(`\/api\/admin\/tv\/videos\?status=/);
  assert.doesNotMatch(tvPanel, /readAdminAccessToken|authorization:|fetch\("\/api\/admin\/tv\/videos"/);
  for (const panel of [nfcPanel, dmcaPanel, pilotPanel, tvPanel]) {
    assert.doesNotMatch(panel, /const SESSION_KEY|localStorage\.getItem\(SESSION_KEY\)|function readToken\(|function readAdminToken\(|function authHeaders\(/);
  }
});

test("deal attribution policies call the shared no-argument admin authorization function", () => {
  assert.match(dealMigration, /using \(public\.is_admin\(\)\)/);
  assert.match(dealMigration, /with check \(public\.is_admin\(\)\)/);
  assert.doesNotMatch(dealMigration, /public\.is_admin\(auth\.uid\(\)\)/);
});
