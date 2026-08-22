import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [dashboard, dashboardSession, customerRoute, dancerRoute, venueRoute, liveShell] = await Promise.all([
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/dashboard-session.ts", import.meta.url), "utf8"),
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
  assert.match(dashboardSession, /export const DASHBOARD_SESSION_KEY = "dancrAuthSessionV1"/);
  assert.match(dashboardSession, /typeof window === "undefined"/);
  assert.match(dashboardSession, /function dashboardAuthHeaders\(session: StoredDashboardSession \| null\)/);
  assert.match(dashboardSession, /function persistResponseSession/);
  assert.match(dashboardSession, /export async function readOptionalJson/);
  assert.match(dashboardSession, /console\.warn\("Dashboard panel did not load"/);
  assert.doesNotMatch(dashboard, /function readSession\(|function dashboardAuthHeaders\(|async function readOptionalJson/);
});
