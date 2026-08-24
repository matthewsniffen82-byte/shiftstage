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
  requestAgentCommissionsJson,
  requestAgentCommissionStatement,
  requestCustomerProfileJson,
  requestDancerAvatarJson,
  requestDancerFinanceJson,
  requestDancerFinanceStatement,
  requestDancerProfileJson,
  requestDancerProfileVisibilityJson,
  requestDancerShiftCheckInJson,
  requestDancerShiftsJson,
  requestDancerTvVideoJson,
  requestDancerTvVideosJson,
  requestDancerVenueVerificationJson,
  requestDashboardJson,
  requestVenueDancerVerificationsJson,
  requestVenueFinanceStatement,
  requestVenueNfcSupportJson,
  requestVenueNfcTagsJson,
  requestVenueTeamJson,
  requestVenueTvVideosJson,
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
const agentDashboard = await readFile(new URL("../app/dashboard/agent/AgentDashboardClient.tsx", import.meta.url), "utf8");

test("customer, dancer, and venue use the same routed dashboard client", () => {
  assert.match(customerRoute, /<DashboardClient role="customer"/);
  assert.match(dancerRoute, /<DashboardClient role="dancer"/);
  assert.match(venueRoute, /<DashboardClient role="venue"/);
  assert.doesNotMatch(dancerRoute, /redirect\(/);
  assert.match(dashboard, /<main className=\{`dashboard-shell dashboard-shell-\$\{role\}`\}>/);
  assert.match(dashboard, /<DashboardLoadingState role=\{role\} \/>/);
});

test("every role keeps its real tools on one page inside shared collapsible sections", () => {
  assert.match(dashboard, /function DashboardSection[\s\S]*?<details className=\{`dashboard-section venue-dashboard-section dashboard-section-\$\{emphasis\}`\}/);
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
  assert.match(liveShell, /showToast\(authMode === "signup" \? "Guest account created" : "Logged in"\);\s*openUnifiedDashboard\("customer"\);/);
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
  assert.match(venueTeamPanel, /requestVenueTeamJson/);
  assert.match(venueNfcPanel, /requestVenueNfcTagsJson/);
  assert.match(venueNfcPanel, /requestVenueDancerVerificationsJson/);
  assert.match(venueNfcPanel, /requestVenueNfcSupportJson/);
  for (const panel of [venueTvPanel, venueTeamPanel, venueNfcPanel]) {
    assert.doesNotMatch(panel, /const SESSION_KEY|localStorage\.getItem\(SESSION_KEY\)|function readToken\(|function authHeaders\(|function persistRefreshedSession\(|currentDashboardAuthHeaders|persistRefreshedDashboardSession/);
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

test("dancer profile requests use one role-aware dashboard boundary", async () => {
  const stored = new Map();
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  const capturedRequests = [];
  globalThis.window = {
    localStorage: {
      getItem(key) { return stored.get(key) ?? null; },
      setItem(key, value) { stored.set(key, String(value)); },
      removeItem(key) { stored.delete(key); },
    },
  };
  globalThis.fetch = async (path, options) => {
    capturedRequests.push({ path, options });
    return new Response(JSON.stringify({ ok: true, profile: { id: "dancer-profile" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    stored.set(DASHBOARD_SESSION_KEY, JSON.stringify({
      accessToken: "dancer-access",
      refreshToken: "dancer-refresh",
      account: { role: "dancer" },
    }));
    await requestDancerProfileJson({ cache: "no-store" });
    await requestDancerProfileVisibilityJson({
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isPublic: false }),
    });
    assert.deepEqual(capturedRequests, [
      {
        path: "/api/dancer/profile",
        options: {
          cache: "no-store",
          headers: {
            authorization: "Bearer dancer-access",
            "x-dancr-refresh-token": "dancer-refresh",
          },
        },
      },
      {
        path: "/api/dancer/profile/visibility",
        options: {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer dancer-access",
            "x-dancr-refresh-token": "dancer-refresh",
          },
          body: JSON.stringify({ isPublic: false }),
        },
      },
    ]);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }

  assert.match(dashboardSession, /function requestDancerProfileJson/);
  assert.match(dashboardSession, /function requestDancerProfileVisibilityJson/);
  assert.doesNotMatch(dashboard, /fetch\("\/api\/dancer\/profile"/);
  assert.doesNotMatch(dashboard, /fetch\("\/api\/dancer\/profile\/visibility"/);
});

test("dancer payout actions use the refresh-aware role boundary", async () => {
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
    return new Response(JSON.stringify({ ok: true, finance: { available: 25 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    stored.set(DASHBOARD_SESSION_KEY, JSON.stringify({
      accessToken: "dancer-access",
      refreshToken: "dancer-refresh",
      account: { role: "dancer" },
    }));
    const data = await requestDancerFinanceJson({
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "dancer-finance-request",
      },
      body: JSON.stringify({ action: "cash_out" }),
    });
    assert.equal(data.finance.available, 25);
    assert.deepEqual(capturedRequest, {
      path: "/api/dancer/finance",
      options: {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "dancer-finance-request",
          authorization: "Bearer dancer-access",
          "x-dancr-refresh-token": "dancer-refresh",
        },
        body: JSON.stringify({ action: "cash_out" }),
      },
    });
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }

  assert.match(dashboardSession, /function requestDancerFinanceJson/);
  assert.doesNotMatch(dashboard, /fetch\("\/api\/dancer\/finance"/);
});

test("dancer and venue statements refresh their role-aware sessions before downloading", async () => {
  const stored = new Map();
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  const capturedRequests = [];
  globalThis.window = {
    localStorage: {
      getItem(key) { return stored.get(key) ?? null; },
      setItem(key, value) { stored.set(key, String(value)); },
      removeItem(key) { stored.delete(key); },
    },
  };
  globalThis.fetch = async (path, options) => {
    capturedRequests.push({ path, options });
    if (String(path).includes("/statement?")) {
      return new Response(String(path).includes("/dancer/") ? "dancer,amount\nDancer,20.00" : "venue,amount\nClub,40.00", {
        status: 200,
        headers: { "content-type": "text/csv" },
      });
    }
    const isDancer = String(path).startsWith("/api/dancer/");
    return new Response(JSON.stringify({
      ok: true,
      access: { active: true },
      session: {
        accessToken: isDancer ? "rotated-dancer-access" : "rotated-venue-access",
        expiresAt: 99999,
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    stored.set(DASHBOARD_SESSION_KEY, JSON.stringify({
      accessToken: "dancer-access",
      refreshToken: "dancer-refresh",
      account: { role: "dancer" },
    }));
    const dancerStatement = await requestDancerFinanceStatement("2026-08");
    assert.equal(await dancerStatement.text(), "dancer,amount\nDancer,20.00");

    stored.set(DASHBOARD_SESSION_KEY, JSON.stringify({
      accessToken: "venue-access",
      refreshToken: "venue-refresh",
      account: { role: "venue" },
    }));
    const venueStatement = await requestVenueFinanceStatement("2026-08");
    assert.equal(await venueStatement.text(), "venue,amount\nClub,40.00");

    assert.deepEqual(capturedRequests, [
      {
        path: "/api/dancer/finance?access=1",
        options: {
          cache: "no-store",
          headers: {
            authorization: "Bearer dancer-access",
            "x-dancr-refresh-token": "dancer-refresh",
          },
        },
      },
      {
        path: "/api/dancer/finance/statement?month=2026-08",
        options: {
          headers: {
            authorization: "Bearer rotated-dancer-access",
            "x-dancr-refresh-token": "dancer-refresh",
          },
        },
      },
      {
        path: "/api/venue/finance?access=1",
        options: {
          cache: "no-store",
          headers: {
            authorization: "Bearer venue-access",
            "x-dancr-refresh-token": "venue-refresh",
          },
        },
      },
      {
        path: "/api/venue/finance/statement?month=2026-08",
        options: {
          headers: {
            authorization: "Bearer rotated-venue-access",
            "x-dancr-refresh-token": "venue-refresh",
          },
        },
      },
    ]);
    assert.deepEqual(JSON.parse(stored.get(DASHBOARD_SESSION_KEY)), {
      accessToken: "rotated-venue-access",
      refreshToken: "venue-refresh",
      expiresAt: 99999,
      account: { role: "venue" },
    });
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }

  assert.match(dashboardSession, /function requestDancerFinanceStatement/);
  assert.match(dashboardSession, /function requestVenueFinanceStatement/);
  assert.match(dashboard, /requestDancerFinanceStatement/);
  assert.match(dashboard, /requestVenueFinanceStatement/);
  assert.doesNotMatch(dashboard, /function downloadDashboardFile|fetch\(path, \{ headers: \{ authorization/);
});

test("dancer and venue affiliation actions share role-aware refresh boundaries", async () => {
  const stored = new Map();
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  const capturedRequests = [];
  globalThis.window = {
    localStorage: {
      getItem(key) { return stored.get(key) ?? null; },
      setItem(key, value) { stored.set(key, String(value)); },
      removeItem(key) { stored.delete(key); },
    },
  };
  globalThis.fetch = async (path, options) => {
    capturedRequests.push({ path, options });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    stored.set(DASHBOARD_SESSION_KEY, JSON.stringify({
      accessToken: "dancer-access",
      refreshToken: "dancer-refresh",
      account: { role: "dancer" },
    }));
    await requestDancerVenueVerificationJson({ cache: "no-store" });
    await requestDancerVenueVerificationJson({
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ affiliationId: "dancer-affiliation-id" }),
      fallbackMessage: "Unable to remove venue access.",
    });

    stored.set(DASHBOARD_SESSION_KEY, JSON.stringify({
      accessToken: "venue-access",
      refreshToken: "venue-refresh",
      account: { role: "venue" },
    }));
    await requestVenueDancerVerificationsJson("private token", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ affiliationId: "affiliation-id" }),
    });

    assert.deepEqual(capturedRequests, [
      {
        path: "/api/dancer/venue-verification",
        options: {
          cache: "no-store",
          headers: {
            authorization: "Bearer dancer-access",
            "x-dancr-refresh-token": "dancer-refresh",
          },
        },
      },
      {
        path: "/api/dancer/venue-verification",
        options: {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer dancer-access",
            "x-dancr-refresh-token": "dancer-refresh",
          },
          body: JSON.stringify({ affiliationId: "dancer-affiliation-id" }),
        },
      },
      {
        path: "/api/venue/dancer-verifications?token=private%20token",
        options: {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer venue-access",
            "x-dancr-refresh-token": "venue-refresh",
          },
          body: JSON.stringify({ affiliationId: "affiliation-id" }),
        },
      },
    ]);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }

  assert.match(dashboardSession, /function requestDancerVenueVerificationJson/);
  assert.match(dashboardSession, /function requestVenueDancerVerificationsJson/);
  assert.match(dancerNfcPanel, /requestDancerVenueVerificationJson/);
  assert.doesNotMatch(dancerNfcPanel, /fetch\("\/api\/dancer\/venue-verification"/);
  assert.doesNotMatch(dancerNfcPanel, /currentDashboardAuthHeaders/);
  assert.doesNotMatch(dashboard, /fetch\("\/api\/dancer\/venue-verification"/);
  assert.doesNotMatch(dashboard, /fetch\(`\/api\/venue\/dancer-verifications/);
  assert.doesNotMatch(dashboard, /fetch\("\/api\/venue\/dancer-verifications"/);
});

test("dancer schedule actions use refresh-aware role boundaries", async () => {
  const stored = new Map();
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  const capturedRequests = [];
  globalThis.window = {
    localStorage: {
      getItem(key) { return stored.get(key) ?? null; },
      setItem(key, value) { stored.set(key, String(value)); },
      removeItem(key) { stored.delete(key); },
    },
  };
  globalThis.fetch = async (path, options) => {
    capturedRequests.push({ path, options });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    stored.set(DASHBOARD_SESSION_KEY, JSON.stringify({
      accessToken: "dancer-access",
      refreshToken: "dancer-refresh",
      account: { role: "dancer" },
    }));
    await requestDancerShiftsJson({ cache: "no-store" });
    await requestDancerShiftsJson({
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ shiftId: "shift-id", status: "cancelled" }),
      fallbackMessage: "Unable to save changes.",
    });
    await requestDancerShiftCheckInJson({
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ shiftId: "shift-id" }),
    });

    assert.deepEqual(capturedRequests, [
      {
        path: "/api/dancer/shifts",
        options: {
          cache: "no-store",
          headers: {
            authorization: "Bearer dancer-access",
            "x-dancr-refresh-token": "dancer-refresh",
          },
        },
      },
      {
        path: "/api/dancer/shifts",
        options: {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer dancer-access",
            "x-dancr-refresh-token": "dancer-refresh",
          },
          body: JSON.stringify({ shiftId: "shift-id", status: "cancelled" }),
        },
      },
      {
        path: "/api/dancer/shifts/check-in",
        options: {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer dancer-access",
            "x-dancr-refresh-token": "dancer-refresh",
          },
          body: JSON.stringify({ shiftId: "shift-id" }),
        },
      },
    ]);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }

  const shiftPanel = dashboard.match(/function DancerShiftPanel\(\)[\s\S]*?function canCheckInToShift/)?.[0] || "";
  assert.match(dashboardSession, /function requestDancerShiftsJson/);
  assert.match(dashboardSession, /function requestDancerShiftCheckInJson/);
  assert.match(shiftPanel, /requestDancerShiftsJson/);
  assert.match(shiftPanel, /requestDancerShiftCheckInJson/);
  assert.match(dancerShiftManager, /requestDancerShiftsJson/);
  assert.match(dancerShiftManager, /requestDancerShiftCheckInJson/);
  assert.doesNotMatch(shiftPanel, /fetch\("\/api\/dancer\/shifts/);
  assert.doesNotMatch(shiftPanel, /authorization: `Bearer/);
  assert.doesNotMatch(dancerShiftManager, /fetch\(/);
  assert.doesNotMatch(dancerShiftManager, /readDashboardAccessToken/);
});

test("customer preference saves use the refresh-aware customer boundary", async () => {
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
      profile: { city: "Las Vegas", notificationSettings: { workingTonight: true } },
      session: { accessToken: "rotated-customer-access", expiresAt: 99999 },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    stored.set(DASHBOARD_SESSION_KEY, JSON.stringify({
      accessToken: "customer-access",
      refreshToken: "customer-refresh",
      account: { role: "customer" },
    }));
    const data = await requestCustomerProfileJson({
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        city: "Las Vegas",
        notificationSettings: { workingTonight: true },
      }),
      fallbackMessage: "Unable to save preferences.",
    });

    assert.equal(data.profile.city, "Las Vegas");
    assert.deepEqual(capturedRequest, {
      path: "/api/customer/profile",
      options: {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer customer-access",
          "x-dancr-refresh-token": "customer-refresh",
        },
        body: JSON.stringify({
          city: "Las Vegas",
          notificationSettings: { workingTonight: true },
        }),
      },
    });
    assert.deepEqual(JSON.parse(stored.get(DASHBOARD_SESSION_KEY)), {
      accessToken: "rotated-customer-access",
      refreshToken: "customer-refresh",
      expiresAt: 99999,
      account: { role: "customer" },
    });
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }

  const preferencesPanel = dashboard.match(/function CustomerPreferencesPanel[\s\S]*?function readSetting/)?.[0] || "";
  assert.match(dashboardSession, /function requestCustomerProfileJson/);
  assert.match(preferencesPanel, /requestCustomerProfileJson/);
  assert.doesNotMatch(preferencesPanel, /fetch\("\/api\/customer\/profile"/);
  assert.doesNotMatch(preferencesPanel, /authorization: `Bearer/);
});

test("dancer avatar uploads and removals use the refresh-aware dancer boundary", async () => {
  const stored = new Map();
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  const capturedRequests = [];
  globalThis.window = {
    localStorage: {
      getItem(key) { return stored.get(key) ?? null; },
      setItem(key, value) { stored.set(key, String(value)); },
      removeItem(key) { stored.delete(key); },
    },
  };
  globalThis.fetch = async (path, options) => {
    capturedRequests.push({ path, options });
    return new Response(JSON.stringify({ ok: true, decision: "pending" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    stored.set(DASHBOARD_SESSION_KEY, JSON.stringify({
      accessToken: "dancer-access",
      refreshToken: "dancer-refresh",
      account: { role: "dancer" },
    }));
    const avatarForm = new FormData();
    avatarForm.set("idempotencyKey", "avatar-upload-key");
    await requestDancerAvatarJson({
      method: "POST",
      headers: { "idempotency-key": "avatar-upload-key" },
      body: avatarForm,
      fallbackMessage: "Unable to upload avatar.",
    });
    await requestDancerAvatarJson({
      method: "DELETE",
      fallbackMessage: "Unable to remove avatar.",
    });

    assert.deepEqual(capturedRequests, [
      {
        path: "/api/dancer/avatar",
        options: {
          method: "POST",
          headers: {
            "idempotency-key": "avatar-upload-key",
            authorization: "Bearer dancer-access",
            "x-dancr-refresh-token": "dancer-refresh",
          },
          body: avatarForm,
        },
      },
      {
        path: "/api/dancer/avatar",
        options: {
          method: "DELETE",
          headers: {
            authorization: "Bearer dancer-access",
            "x-dancr-refresh-token": "dancer-refresh",
          },
        },
      },
    ]);

    globalThis.fetch = async () => new Response(JSON.stringify({
      ok: false,
      message: "Avatar needs a visible face.",
    }), {
      status: 422,
      headers: { "content-type": "application/json" },
    });
    await assert.rejects(
      requestDancerAvatarJson({ method: "POST", body: avatarForm }),
      (error) => error instanceof DashboardDataRequestError
        && error.status === 422
        && error.message === "Avatar needs a visible face.",
    );
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }

  const avatarPanel = dashboard.match(/function DancerAvatarPanel[\s\S]*?function DancerVenueVerificationPanel/)?.[0] || "";
  assert.match(dashboardSession, /function requestDancerAvatarJson/);
  assert.match(avatarPanel, /requestDancerAvatarJson/);
  assert.doesNotMatch(avatarPanel, /fetch\("\/api\/dancer\/avatar"/);
  assert.doesNotMatch(avatarPanel, /authorization: `Bearer/);
});

test("MyDancr TV lifecycle requests use the refresh-aware dancer boundary", async () => {
  const stored = new Map();
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  const capturedRequests = [];
  globalThis.window = {
    localStorage: {
      getItem(key) { return stored.get(key) ?? null; },
      setItem(key, value) { stored.set(key, String(value)); },
      removeItem(key) { stored.delete(key); },
    },
  };
  globalThis.fetch = async (path, options) => {
    capturedRequests.push({ path, options });
    return new Response(JSON.stringify({
      ok: true,
      upload: { videoId: "video id/with spaces" },
      session: { accessToken: "rotated-dancer-access", expiresAt: 99999 },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    stored.set(DASHBOARD_SESSION_KEY, JSON.stringify({
      accessToken: "dancer-access",
      refreshToken: "dancer-refresh",
      account: { role: "dancer" },
    }));
    await requestDancerTvVideosJson({ cache: "no-store" });
    await requestDancerTvVideosJson({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mimeType: "video/mp4" }),
      fallbackMessage: "Unable to prepare upload.",
    });
    await requestDancerTvVideoJson("video id/with spaces", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "submit" }),
    });
    await requestDancerTvVideoJson("video id/with spaces", { method: "DELETE" });

    assert.deepEqual(capturedRequests, [
      {
        path: "/api/dancer/tv/videos",
        options: {
          cache: "no-store",
          headers: {
            authorization: "Bearer dancer-access",
            "x-dancr-refresh-token": "dancer-refresh",
          },
        },
      },
      {
        path: "/api/dancer/tv/videos",
        options: {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer rotated-dancer-access",
            "x-dancr-refresh-token": "dancer-refresh",
          },
          body: JSON.stringify({ mimeType: "video/mp4" }),
        },
      },
      {
        path: "/api/dancer/tv/videos/video%20id%2Fwith%20spaces",
        options: {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer rotated-dancer-access",
            "x-dancr-refresh-token": "dancer-refresh",
          },
          body: JSON.stringify({ action: "submit" }),
        },
      },
      {
        path: "/api/dancer/tv/videos/video%20id%2Fwith%20spaces",
        options: {
          method: "DELETE",
          headers: {
            authorization: "Bearer rotated-dancer-access",
            "x-dancr-refresh-token": "dancer-refresh",
          },
        },
      },
    ]);
    assert.deepEqual(JSON.parse(stored.get(DASHBOARD_SESSION_KEY)), {
      accessToken: "rotated-dancer-access",
      refreshToken: "dancer-refresh",
      expiresAt: 99999,
      account: { role: "dancer" },
    });
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }

  assert.match(dashboardSession, /function requestDancerTvVideosJson/);
  assert.match(dashboardSession, /function requestDancerTvVideoJson/);
  assert.match(dancerTvStudio, /requestDancerTvVideosJson/);
  assert.match(dancerTvStudio, /requestDancerTvVideoJson/);
  assert.doesNotMatch(dancerTvStudio, /fetch\(/);
  assert.doesNotMatch(dancerTvStudio, /currentDashboardAuthHeaders/);
});

test("venue TV loading uses the refresh-aware venue boundary", async () => {
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
      videos: [{ id: "venue-video" }],
      session: { accessToken: "rotated-venue-access", expiresAt: 99999 },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    stored.set(DASHBOARD_SESSION_KEY, JSON.stringify({
      accessToken: "venue-access",
      refreshToken: "venue-refresh",
      account: { role: "venue" },
    }));
    const data = await requestVenueTvVideosJson({ cache: "no-store" });

    assert.deepEqual(data.videos, [{ id: "venue-video" }]);
    assert.deepEqual(capturedRequest, {
      path: "/api/venue/tv/videos",
      options: {
        cache: "no-store",
        headers: {
          authorization: "Bearer venue-access",
          "x-dancr-refresh-token": "venue-refresh",
        },
      },
    });
    assert.deepEqual(JSON.parse(stored.get(DASHBOARD_SESSION_KEY)), {
      accessToken: "rotated-venue-access",
      refreshToken: "venue-refresh",
      expiresAt: 99999,
      account: { role: "venue" },
    });
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }

  assert.match(dashboardSession, /function requestVenueTvVideosJson/);
  assert.match(venueTvPanel, /requestVenueTvVideosJson/);
  assert.doesNotMatch(venueTvPanel, /fetch\(/);
  assert.doesNotMatch(venueTvPanel, /authorization: `Bearer/);
});

test("venue team actions use one refresh-aware venue boundary", async () => {
  const stored = new Map();
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  const capturedRequests = [];
  globalThis.window = {
    localStorage: {
      getItem(key) { return stored.get(key) ?? null; },
      setItem(key, value) { stored.set(key, String(value)); },
      removeItem(key) { stored.delete(key); },
    },
  };
  globalThis.fetch = async (path, options) => {
    capturedRequests.push({ path, options });
    return new Response(JSON.stringify({
      ok: true,
      session: { accessToken: "rotated-venue-access", expiresAt: 99999 },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    stored.set(DASHBOARD_SESSION_KEY, JSON.stringify({
      accessToken: "venue-access",
      refreshToken: "venue-refresh",
      account: { role: "venue" },
    }));
    await requestVenueTeamJson({ cache: "no-store" });
    await requestVenueTeamJson({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "manager@example.com", role: "manager" }),
    });
    await requestVenueTeamJson({
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ memberId: "member-id", role: "staff" }),
    });
    await requestVenueTeamJson({
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ invitationId: "invitation-id" }),
    });

    assert.deepEqual(capturedRequests, [
      {
        path: "/api/venue/team",
        options: {
          cache: "no-store",
          headers: {
            authorization: "Bearer venue-access",
            "x-dancr-refresh-token": "venue-refresh",
          },
        },
      },
      {
        path: "/api/venue/team",
        options: {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer rotated-venue-access",
            "x-dancr-refresh-token": "venue-refresh",
          },
          body: JSON.stringify({ email: "manager@example.com", role: "manager" }),
        },
      },
      {
        path: "/api/venue/team",
        options: {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer rotated-venue-access",
            "x-dancr-refresh-token": "venue-refresh",
          },
          body: JSON.stringify({ memberId: "member-id", role: "staff" }),
        },
      },
      {
        path: "/api/venue/team",
        options: {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer rotated-venue-access",
            "x-dancr-refresh-token": "venue-refresh",
          },
          body: JSON.stringify({ invitationId: "invitation-id" }),
        },
      },
    ]);
    assert.deepEqual(JSON.parse(stored.get(DASHBOARD_SESSION_KEY)), {
      accessToken: "rotated-venue-access",
      refreshToken: "venue-refresh",
      expiresAt: 99999,
      account: { role: "venue" },
    });
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }

  assert.match(dashboardSession, /function requestVenueTeamJson/);
  assert.match(venueTeamPanel, /requestVenueTeamJson/);
  assert.doesNotMatch(venueTeamPanel, /fetch\(/);
  assert.doesNotMatch(venueTeamPanel, /currentDashboardAuthHeaders|persistRefreshedDashboardSession/);
});

test("venue NFC operations use refresh-aware venue boundaries", async () => {
  const stored = new Map();
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  const capturedRequests = [];
  globalThis.window = {
    localStorage: {
      getItem(key) { return stored.get(key) ?? null; },
      setItem(key, value) { stored.set(key, String(value)); },
      removeItem(key) { stored.delete(key); },
    },
  };
  globalThis.fetch = async (path, options) => {
    capturedRequests.push({ path, options });
    return new Response(JSON.stringify({
      ok: true,
      tags: [],
      affiliations: [],
      message: "NFC support request sent.",
      session: { accessToken: "rotated-venue-access", expiresAt: 99999 },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    stored.set(DASHBOARD_SESSION_KEY, JSON.stringify({
      accessToken: "venue-access",
      refreshToken: "venue-refresh",
      account: { role: "venue" },
    }));
    await requestVenueNfcTagsJson({ cache: "no-store" });
    await requestVenueDancerVerificationsJson("", {
      cache: "no-store",
      fallbackMessage: "Unable to load the verified dancer roster.",
    });
    await requestVenueDancerVerificationsJson("", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ affiliationId: "affiliation-id", reason: "Venue removed NFC access." }),
      fallbackMessage: "Unable to remove NFC access.",
    });
    await requestVenueNfcSupportJson({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tagId: "tag-id", requestType: "damaged", notes: "Needs replacement." }),
    });

    assert.deepEqual(capturedRequests, [
      {
        path: "/api/venue/nfc-tags",
        options: {
          cache: "no-store",
          headers: {
            authorization: "Bearer venue-access",
            "x-dancr-refresh-token": "venue-refresh",
          },
        },
      },
      {
        path: "/api/venue/dancer-verifications",
        options: {
          cache: "no-store",
          headers: {
            authorization: "Bearer rotated-venue-access",
            "x-dancr-refresh-token": "venue-refresh",
          },
        },
      },
      {
        path: "/api/venue/dancer-verifications",
        options: {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer rotated-venue-access",
            "x-dancr-refresh-token": "venue-refresh",
          },
          body: JSON.stringify({ affiliationId: "affiliation-id", reason: "Venue removed NFC access." }),
        },
      },
      {
        path: "/api/venue/nfc-support",
        options: {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer rotated-venue-access",
            "x-dancr-refresh-token": "venue-refresh",
          },
          body: JSON.stringify({ tagId: "tag-id", requestType: "damaged", notes: "Needs replacement." }),
        },
      },
    ]);
    assert.deepEqual(JSON.parse(stored.get(DASHBOARD_SESSION_KEY)), {
      accessToken: "rotated-venue-access",
      refreshToken: "venue-refresh",
      expiresAt: 99999,
      account: { role: "venue" },
    });
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }

  assert.match(dashboardSession, /function requestVenueNfcTagsJson/);
  assert.match(dashboardSession, /function requestVenueNfcSupportJson/);
  assert.match(venueNfcPanel, /requestVenueNfcTagsJson/);
  assert.match(venueNfcPanel, /requestVenueDancerVerificationsJson/);
  assert.match(venueNfcPanel, /requestVenueNfcSupportJson/);
  assert.doesNotMatch(venueNfcPanel, /fetch\(/);
  assert.doesNotMatch(venueNfcPanel, /currentDashboardAuthHeaders|persistRefreshedDashboardSession/);
});

test("sales agent commission actions use the shared refresh-aware session boundary", async () => {
  const stored = new Map();
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  const capturedRequests = [];
  globalThis.window = {
    localStorage: {
      getItem(key) { return stored.get(key) ?? null; },
      setItem(key, value) { stored.set(key, String(value)); },
      removeItem(key) { stored.delete(key); },
    },
  };
  globalThis.fetch = async (path, options) => {
    capturedRequests.push({ path, options });
    if (path === "/api/agent/commissions?format=csv") {
      return new Response("venue,amount\nClub,15.00", {
        status: 200,
        headers: { "content-type": "text/csv" },
      });
    }
    const statementAccess = path === "/api/agent/commissions?access=1";
    return new Response(JSON.stringify({
      ok: true,
      dashboard: { commissions: [] },
      access: { active: true },
      session: {
        accessToken: statementAccess ? "statement-agent-access" : "rotated-agent-access",
        expiresAt: 99999,
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    stored.set(DASHBOARD_SESSION_KEY, JSON.stringify({
      accessToken: "agent-account-access",
      refreshToken: "agent-account-refresh",
      account: { role: "customer" },
    }));
    await requestAgentCommissionsJson({ cache: "no-store" });
    await requestAgentCommissionsJson({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "request_nats_link", loginId: "42", username: "agent" }),
    });
    const statement = await requestAgentCommissionStatement();
    assert.equal(await statement.text(), "venue,amount\nClub,15.00");

    assert.deepEqual(capturedRequests, [
      {
        path: "/api/agent/commissions",
        options: {
          cache: "no-store",
          headers: {
            authorization: "Bearer agent-account-access",
            "x-dancr-refresh-token": "agent-account-refresh",
          },
        },
      },
      {
        path: "/api/agent/commissions",
        options: {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer rotated-agent-access",
            "x-dancr-refresh-token": "agent-account-refresh",
          },
          body: JSON.stringify({ action: "request_nats_link", loginId: "42", username: "agent" }),
        },
      },
      {
        path: "/api/agent/commissions?access=1",
        options: {
          cache: "no-store",
          headers: {
            authorization: "Bearer rotated-agent-access",
            "x-dancr-refresh-token": "agent-account-refresh",
          },
        },
      },
      {
        path: "/api/agent/commissions?format=csv",
        options: {
          headers: {
            authorization: "Bearer statement-agent-access",
            "x-dancr-refresh-token": "agent-account-refresh",
          },
        },
      },
    ]);
    assert.deepEqual(JSON.parse(stored.get(DASHBOARD_SESSION_KEY)), {
      accessToken: "statement-agent-access",
      refreshToken: "agent-account-refresh",
      expiresAt: 99999,
      account: { role: "customer" },
    });
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }

  assert.match(dashboardSession, /function requestAgentCommissionsJson/);
  assert.match(dashboardSession, /function requestAgentCommissionStatement/);
  assert.match(agentDashboard, /requestAgentCommissionsJson/);
  assert.match(agentDashboard, /requestAgentCommissionStatement/);
  assert.doesNotMatch(agentDashboard, /fetch\(|readBrowserAccessToken|authorization: `Bearer/);
});

test("dancer dashboard subpanels use the shared role-aware session boundary", () => {
  assert.match(dancerTvStudio, /requestDancerTvVideosJson/);
  assert.match(dancerNfcPanel, /requestDancerVenueVerificationJson/);
  assert.match(dancerShiftManager, /requestDancerShiftsJson/);
  for (const panel of [dancerTvStudio, dancerNfcPanel, dancerShiftManager]) {
    assert.doesNotMatch(panel, /const SESSION_KEY|dancrAuthSessionV1|localStorage\.getItem\(|function readSession\(|function readDashboardSession\(|function authHeaders\(/);
  }
});
