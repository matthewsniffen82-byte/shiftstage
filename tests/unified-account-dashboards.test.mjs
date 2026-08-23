import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DashboardDataRequestError,
  DASHBOARD_SESSION_KEY,
  clearDashboardSession,
  currentDashboardAuthHeaders,
  persistDashboardSession,
  persistRefreshedDashboardSession,
  readDashboardAccessToken,
  requestDashboardJson,
} from "../app/dashboard/dashboard-session.ts";

const [dashboard, dashboardSession, venueTvPanel, venueTeamPanel, venueNfcPanel, dancerTvStudio, dancerNfcPanel, dancerShiftManager, customerRoute, dancerRoute, venueRoute, liveShell] = await Promise.all([
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/dashboard-session.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/VenueTvPanel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/VenueTeamPanel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/VenueNfcTagPanel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DancerTvStudio.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DancerNfcPanel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DancerShiftManager.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/customer/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/dancer/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/venue/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
]);

test("customer, dancer, and venue use the same routed dashboard client", () => {
  assert.match(customerRoute, /<DashboardClient role="customer"/);
  assert.match(dancerRoute, /<DashboardClient role="dancer"/);
  assert.match(venueRoute, /<DashboardClient role="venue"/);
  assert.doesNotMatch(dancerRoute, /redirect\(/);
  assert.match(dashboard, /<main className=\{`dashboard-shell dashboard-shell-\$\{role\}`\}>/);
  assert.match(dashboard, /<DashboardLoadingState role=\{role\} \/>/);
});

test("every role keeps its real tools on one page inside shared collapsible sections", () => {
  assert.match(dashboard, /function DashboardSection[\s\S]*?<details className="dashboard-section venue-dashboard-section"/);
  for (const id of [
    "customer-tonight",
    "customer-saved",
    "customer-offers",
    "customer-alerts",
    "customer-settings",
    "dancer-overview",
    "dancer-profile-media",
    "dancer-schedule",
    "dancer-performance",
    "dancer-sharing-billing",
    "dancer-account",
    "venue-account",
  ]) {
    assert.match(dashboard, new RegExp(`id="${id}"`));
  }
  assert.match(dashboard, /function openDashboardSection[\s\S]*?section instanceof HTMLDetailsElement[\s\S]*?section\.open = true/);
});

test("normal account navigation cannot reopen a legacy dashboard variant", () => {
  assert.match(
    liveShell,
    /function openUnifiedDashboard\(role = activeDashboardType, section = ""\)[\s\S]*?window\.location\.assign\(`\/dashboard\/\$\{dashboardRole\}\$\{sectionHash\}`\)/,
  );
  assert.match(
    liveShell,
    /dashboardBtn\.addEventListener\("click", \(\) => \{\s*closeUtilityMenu\(\);\s*openUnifiedDashboard\(activeDashboardType\);\s*\}\);/,
  );
  assert.match(liveShell, /showToast\(authMode === "signup" \? "Customer account created" : "Logged in"\);\s*openUnifiedDashboard\("customer"\);/);
  assert.match(liveShell, /await hydrateDancerApprovalProgress\(\);\s*openUnifiedDashboard\("dancer"\);/);
  assert.match(liveShell, /const opened = openUnifiedDashboard\("venue"\);/);
});

test("fresh confirmation sessions load the dashboard account and panels in parallel", () => {
  assert.match(dashboard, /from "\.\/dashboard-session"/);
  assert.match(dashboardSession, /function storedSessionIsFresh\(session: StoredDashboardSession \| null\)/);
  assert.match(dashboardSession, /expiresAt > Math\.floor\(Date\.now\(\) \/ 1000\) \+ 120/);
  assert.match(
    dashboard,
    /if \(storedSessionIsFresh\(session\)\) \{[\s\S]*?\[account, panels\] = await Promise\.all\(\[[\s\S]*?readJson\("\/api\/account", initialAuthHeaders\)[\s\S]*?loadDashboardPanels\(initialAuthHeaders\)/,
  );
  assert.match(
    dashboard,
    /else \{[\s\S]*?account = await readJson\("\/api\/account", initialAuthHeaders\)[\s\S]*?const refreshedHeaders = dashboardAuthHeaders\(readSession\(\)\)[\s\S]*?panels = await loadDashboardPanels\(refreshedHeaders\)/,
  );
});

test("dashboard session persistence and optional panel failures have one typed boundary", () => {
  assert.match(dashboardSession, /export const DASHBOARD_SESSION_KEY = BROWSER_AUTH_SESSION_KEY/);
  assert.match(dashboardSession, /from "\.\.\/\.\.\/src\/lib\/dancr\/browser-session\.ts"/);
  assert.match(dashboardSession, /return readBrowserAuthSession\(\) as StoredDashboardSession \| null/);
  assert.match(dashboardSession, /persistBrowserAuthSession\(\{ \.\.\.current, \.\.\.data\.session \}\)/);
  assert.match(dashboardSession, /return persistBrowserAuthSession\(session\)/);
  assert.match(dashboardSession, /return clearBrowserAuthSession\(\)/);
  assert.match(dashboardSession, /persistRefreshedBrowserAuthSession\(session\)/);
  assert.doesNotMatch(dashboardSession, /window\.localStorage\.(?:getItem|setItem|removeItem)\(/);
  assert.match(dashboardSession, /function dashboardAuthHeaders\(session: StoredDashboardSession \| null\)/);
  assert.match(dashboardSession, /function persistResponseSession/);
  assert.match(dashboardSession, /export async function readOptionalJson/);
  assert.match(dashboardSession, /console\.warn\("Dashboard panel did not load"/);
  assert.doesNotMatch(dashboard, /function readSession\(|function dashboardAuthHeaders\(|async function readOptionalJson/);
});

test("venue dashboard subpanels use the shared session boundary and preserve token rotation", () => {
  const stored = new Map();
  const previousWindow = globalThis.window;
  globalThis.window = {
    localStorage: {
      getItem(key) { return stored.get(key) ?? null; },
      setItem(key, value) { stored.set(key, value); },
      removeItem(key) { stored.delete(key); },
    },
  };

  try {
    stored.set(DASHBOARD_SESSION_KEY, JSON.stringify({
      accessToken: "venue-access",
      refreshToken: "venue-refresh",
      expiresAt: 12345,
      account: { role: "venue", displayName: "Venue Owner" },
    }));
    assert.equal(readDashboardAccessToken("venue"), "venue-access");
    assert.equal(readDashboardAccessToken("dancer"), "");
    assert.deepEqual(currentDashboardAuthHeaders(), {
      authorization: "Bearer venue-access",
      "x-dancr-refresh-token": "venue-refresh",
    });
    assert.deepEqual(currentDashboardAuthHeaders("venue"), {
      authorization: "Bearer venue-access",
      "x-dancr-refresh-token": "venue-refresh",
    });
    assert.equal(currentDashboardAuthHeaders("dancer"), null);

    assert.equal(persistDashboardSession({
      accessToken: "replacement-venue-access",
      refreshToken: "replacement-venue-refresh",
      expiresAt: 23456,
      account: { role: "venue", displayName: "Replacement Venue" },
    }), true);
    assert.equal(readDashboardAccessToken("venue"), "replacement-venue-access");

    persistRefreshedDashboardSession({
      accessToken: "rotated-venue-access",
      refreshToken: "rotated-venue-refresh",
      expiresAt: 67890,
    });
    assert.deepEqual(JSON.parse(stored.get(DASHBOARD_SESSION_KEY)), {
      accessToken: "rotated-venue-access",
      refreshToken: "rotated-venue-refresh",
      expiresAt: 67890,
      account: { role: "venue", displayName: "Replacement Venue" },
    });
    assert.equal(clearDashboardSession(), true);
    assert.equal(stored.has(DASHBOARD_SESSION_KEY), false);
  } finally {
    globalThis.window = previousWindow;
  }

  assert.match(venueTvPanel, /readDashboardAccessToken\("venue"\)/);
  assert.match(venueTeamPanel, /currentDashboardAuthHeaders as authHeaders/);
  assert.match(venueTeamPanel, /persistRefreshedDashboardSession as persistRefreshedSession/);
  assert.match(venueNfcPanel, /currentDashboardAuthHeaders as authHeaders/);
  assert.match(venueNfcPanel, /persistRefreshedDashboardSession as persistRefreshedSession/);
  for (const panel of [venueTvPanel, venueTeamPanel, venueNfcPanel]) {
    assert.doesNotMatch(panel, /const SESSION_KEY|localStorage\.getItem\(SESSION_KEY\)|function readToken\(|function authHeaders\(|function persistRefreshedSession\(/);
  }
});

test("the routed dashboard never mutates the browser auth session directly", () => {
  assert.match(dashboard, /clearDashboardSession\(\)/);
  assert.match(dashboard, /persistDashboardSession\(\{ \.\.\.data\.session, account: data\.account \}\)/);
  assert.doesNotMatch(dashboard, /window\.localStorage\.(?:setItem|removeItem)\(SESSION_KEY/);
});

test("shared dashboard JSON requests are role-aware and preserve refreshed sessions", async () => {
  const stored = new Map();
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  let capturedRequest = null;
  globalThis.window = {
    localStorage: {
      getItem(key) { return stored.get(key) ?? null; },
      setItem(key, value) { stored.set(key, String(value)); },
      removeItem(key) { stored.delete(key); },
    },
  };
  globalThis.fetch = async (path, options) => {
    capturedRequest = { path, options };
    return new Response(JSON.stringify({
      ok: true,
      value: "saved",
      session: { accessToken: "rotated-customer-access", expiresAt: 99999 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    stored.set(DASHBOARD_SESSION_KEY, JSON.stringify({
      accessToken: "customer-access",
      refreshToken: "customer-refresh",
      expiresAt: 12345,
      account: { role: "customer", displayName: "Customer" },
    }));
    const data = await requestDashboardJson("/api/customer/example", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
      expectedRole: "customer",
      fallbackMessage: "Unable to save customer action.",
    });
    assert.equal(data.value, "saved");
    assert.deepEqual(capturedRequest, {
      path: "/api/customer/example",
      options: {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer customer-access",
          "x-dancr-refresh-token": "customer-refresh",
        },
        body: JSON.stringify({ enabled: true }),
      },
    });
    assert.deepEqual(JSON.parse(stored.get(DASHBOARD_SESSION_KEY)), {
      accessToken: "rotated-customer-access",
      refreshToken: "customer-refresh",
      expiresAt: 99999,
      account: { role: "customer", displayName: "Customer" },
    });
    await assert.rejects(
      requestDashboardJson("/api/venue/example", { expectedRole: "venue" }),
      (error) => error instanceof DashboardDataRequestError
        && error.status === 401
        && error.message === "Sign in required.",
    );
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }

  assert.match(dashboardSession, /class DashboardDataRequestError extends Error/);
  assert.match(dashboardSession, /const authHeaders = currentDashboardAuthHeaders\(expectedRole\)/);
  assert.match(dashboardSession, /headers: \{ \.\.\.requestHeaders, \.\.\.authHeaders \}/);
  assert.match(dashboardSession, /persistResponseSession\(data\)/);
});

test("shared dashboard panels use the refresh-aware request boundary", () => {
  const notificationPanel = dashboard.match(/function NotificationPanel[\s\S]*?function SupportInboxPanel/)?.[0] || "";
  const supportPanel = dashboard.match(/function SupportInboxPanel[\s\S]*?function AccountControlsPanel/)?.[0] || "";
  const customerActions = dashboard.match(/async function runCustomerAction[\s\S]*?function requestLocation/)?.[0] || "";
  assert.match(notificationPanel, /requestDashboardJson\("\/api\/notifications"/);
  assert.doesNotMatch(notificationPanel, /authorization: `Bearer/);
  assert.match(supportPanel, /requestDashboardJson\("\/api\/support"/);
  assert.doesNotMatch(supportPanel, /authorization: `Bearer/);
  assert.match(customerActions, /requestDashboardJson\(path/);
  assert.match(customerActions, /requestDashboardJson\("\/api\/customer\/directions"/);
  assert.doesNotMatch(customerActions, /authorization: `Bearer/);
});

test("dancer dashboard subpanels use the shared role-aware session boundary", () => {
  assert.match(dancerTvStudio, /currentDashboardAuthHeaders\("dancer"\)/);
  assert.match(dancerNfcPanel, /currentDashboardAuthHeaders\("dancer"\)/);
  assert.match(dancerShiftManager, /readDashboardAccessToken\("dancer"\)/);
  for (const panel of [dancerTvStudio, dancerNfcPanel, dancerShiftManager]) {
    assert.doesNotMatch(panel, /const SESSION_KEY|dancrAuthSessionV1|localStorage\.getItem\(|function readSession\(|function readDashboardSession\(|function authHeaders\(/);
  }
});
