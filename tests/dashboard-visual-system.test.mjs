import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [liveApp, routedDashboards, aesthetic] = await Promise.all([
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../public/dancr-aesthetic.v1.css", import.meta.url), "utf8"),
]);

test("all customer-facing dashboards use the same MyDancr visual tokens", () => {
  for (const source of [liveApp, routedDashboards]) {
    assert.match(source, /--mydancr-dashboard-gap:\s*18px;/);
    assert.match(source, /--mydancr-dashboard-panel:\s*#0b0b10;/);
    assert.match(source, /--mydancr-dashboard-panel-raised:\s*#111118;/);
    assert.match(source, /--mydancr-dashboard-border:\s*rgba\(255,255,255,\.11\);/);
    assert.match(source, /--mydancr-dashboard-radius:\s*16px;/);
  }
});

test("dancer dashboard has one primary action and neutral secondary cards", () => {
  assert.match(
    liveApp,
    /#dancerDashboard \.page-head \{[\s\S]*?border: 1px solid var\(--mydancr-dashboard-border\) !important;[\s\S]*?background: var\(--mydancr-dashboard-panel\) !important;[\s\S]*?box-shadow: none !important;/,
  );
  assert.match(
    liveApp,
    /#dancerDashboard\.is-approved #dancerApprovalCommand,[\s\S]*?background: var\(--mydancr-dashboard-panel\) !important;[\s\S]*?box-shadow: none !important;/,
  );
  assert.match(
    liveApp,
    /#dancerDashboard \.dancer-shift-primary \{[\s\S]*?background: linear-gradient\(135deg, #5223d6, #7c3aed 58%, #4a19c8\);/,
  );
  assert.match(
    liveApp,
    /#dancerDashboard \.dancer-quick-actions button,[\s\S]*?border: 1px solid var\(--mydancr-dashboard-border\);[\s\S]*?background: var\(--mydancr-dashboard-panel-raised\);[\s\S]*?box-shadow: none;/,
  );
  assert.match(
    liveApp,
    /#dancerDashboard \.dancer-glance-metrics \{[\s\S]*?gap: 0;[\s\S]*?border: 1px solid var\(--mydancr-dashboard-border\);/,
  );
  assert.match(
    liveApp,
    /#approvedScheduleDropdown \{[\s\S]*?border-color: var\(--mydancr-dashboard-border\) !important;[\s\S]*?box-shadow: none !important;/,
  );
  assert.match(
    liveApp,
    /#dancerDashboard \.section-title-row::before \{[\s\S]*?background: rgba\(255,255,255,\.22\) !important;[\s\S]*?box-shadow: none !important;/,
  );
});

test("customer and venue dashboards avoid double-bordered nested panels", () => {
  assert.match(
    routedDashboards,
    /\.info-panel \{ border: 1px solid var\(--mydancr-dashboard-border\);[\s\S]*?border-radius: var\(--mydancr-dashboard-radius\);[\s\S]*?box-shadow: none;/,
  );
  assert.match(
    routedDashboards,
    /\.venue-dashboard-section-body > \.info-panel, \.venue-dashboard-inner-grid > \.info-panel \{[\s\S]*?border-color: transparent;[\s\S]*?background: var\(--mydancr-dashboard-panel-raised\);/,
  );
  assert.match(
    routedDashboards,
    /\.customer-settings-grid > \.info-panel \{[\s\S]*?border-color: transparent;[\s\S]*?background: var\(--mydancr-dashboard-panel-raised\);/,
  );
  assert.match(
    routedDashboards,
    /\.deal-metrics \{[\s\S]*?gap: 0 !important;[\s\S]*?border: 1px solid var\(--mydancr-dashboard-border\);/,
  );
});

test("venue dashboard uses one state-aware three-destination workspace", () => {
  const venuePanel = routedDashboards.match(/function VenuePanel[\s\S]*?function VenueClubDealPanel/)?.[0] || "";
  const commandIndex = venuePanel.indexOf('className="venue-command-panel"');
  const tabsIndex = venuePanel.indexOf('className="venue-workspace-tabs"');
  const tonightIndex = venuePanel.indexOf('id="venue-workspace-tonight"');
  const metricsIndex = venuePanel.indexOf('className="venue-dashboard-metrics venue-tonight-metrics"');
  const managementIndex = venuePanel.indexOf("<DashboardSection");

  assert.ok(commandIndex >= 0);
  assert.ok(tabsIndex > commandIndex);
  assert.ok(tonightIndex > tabsIndex);
  assert.ok(metricsIndex > tonightIndex);
  assert.ok(managementIndex > metricsIndex);
  assert.match(venuePanel, /\["tonight", "Tonight"[\s\S]*?\["venue", "Venue page"[\s\S]*?\["business", "Business"/);
  assert.match(venuePanel, /role="tablist"[\s\S]*?aria-selected=\{activeWorkspace === workspace\}/);
  assert.match(venuePanel, /initialVenueWorkspace\(profile\?\.isActive === true\)/);
  assert.match(routedDashboards, /return isPublished \? "tonight" : "venue";/);
  assert.match(venuePanel, /hidden=\{activeWorkspace !== "tonight"\}[\s\S]*?id="venue-working-now"/);
  assert.match(venuePanel, /hidden=\{activeWorkspace !== "venue"\}[\s\S]*?id="venue-public-profile"/);
  assert.match(venuePanel, /hidden=\{activeWorkspace !== "business"\}[\s\S]*?id="venue-overview"/);
  assert.match(venuePanel, /className=\{`primary-link venue-working-now-link\$\{workingNow\.length \? " is-live" : ""\}`\} href="#venue-working-now"[\s\S]*?Open working-now roster/);
  assert.match(
    routedDashboards,
    /\.venue-command-primary \.venue-working-now-link \{[^}]*?width: 100%; max-width: 100%;[^}]*?box-sizing: border-box;/,
  );
  assert.match(venuePanel, /function openVenueSection[\s\S]*?section\.open = true[\s\S]*?scrollIntoView/);
  assert.doesNotMatch(venuePanel, /<DashboardSection\s+defaultOpen[\s\S]*?id="venue-overview"/);
  assert.match(routedDashboards, /\.venue-workspace-tabs \{ position: sticky;[\s\S]*?grid-template-columns: repeat\(3/);
  assert.match(routedDashboards, /\.venue-workspace-tabs button\.active \{[^}]*?linear-gradient/);
  assert.match(routedDashboards, /\.venue-workspace-summary\[hidden\][\s\S]*?\.venue-dashboard-section\[hidden\] \{ display: none !important; \}/);
  assert.match(routedDashboards, /\.venue-dashboard-metrics \{ display: grid; grid-template-columns: repeat\(3/);
  assert.match(routedDashboards, /\.venue-tonight-metrics \{ grid-template-columns: repeat\(4/);
  assert.match(
    routedDashboards,
    /\.dashboard-head h1 \{[\s\S]*?font-size: clamp\(21px, 5vw, 26px\);[\s\S]*?text-overflow: ellipsis;[\s\S]*?white-space: nowrap;/,
  );
  assert.match(routedDashboards, /\.dashboard-shell \{[\s\S]*?-webkit-text-size-adjust: 100%; text-size-adjust: 100%;/);
  assert.match(routedDashboards, /\.venue-dashboard-loading-command[\s\S]*?\.venue-dashboard-loading-actions[\s\S]*?\.venue-dashboard-loading-metrics/);
  assert.match(liveApp, /#dancerDashboard \.dancer-live-heading strong \{[\s\S]*?font-size: 20px;/);
  assert.match(routedDashboards, /\.venue-command-status h2 \{[^}]*?font-size: 20px;/);
  assert.match(routedDashboards, /\.venue-command-status p, \.venue-command-primary p \{[^}]*?font-size: 12px;/);
  assert.match(routedDashboards, /\.venue-workspace-tabs strong \{[^}]*?font-size: 14px;/);
  assert.match(routedDashboards, /\.venue-workspace-tabs small \{[^}]*?font-size: 9px;/);
  assert.match(routedDashboards, /\.venue-dashboard-metrics \.metric strong \{ font-size: 22px; \}/);
  assert.match(routedDashboards, /\.venue-dashboard-section > summary \{ min-height: 76px;/);
  assert.doesNotMatch(routedDashboards, /venue-deal-builder-progress/);
  assert.match(routedDashboards, /<section className=\{`dashboard-head dashboard-head-\$\{role\}`\}[\s\S]*?<h1>\{dashboardHeading\}<\/h1>/);
  assert.match(
    routedDashboards,
    /\.dashboard-shell-venue \.dashboard-head h1 \{[^}]*?font-size: clamp\(32px,5vw,48px\);[^}]*?white-space: normal;/,
  );
  assert.match(
    aesthetic,
    /@media \(max-width: 720px\)[\s\S]*?\.account-shell \.account-copy h1,[\s\S]*?font-size: clamp\(38px, 12vw, 54px\) !important;/,
  );
  assert.match(
    aesthetic,
    /\.dashboard-shell \.dashboard-head h1 \{[\s\S]*?font-size: clamp\(20px, 5\.5vw, 26px\) !important;[\s\S]*?font-weight: 850 !important;[\s\S]*?line-height: 0\.98 !important;/,
  );
  assert.match(
    aesthetic,
    /\.dashboard-shell \{[\s\S]*?color-scheme: dark;[\s\S]*?background-color: var\(--dancr-color-background\) !important;[\s\S]*?background-image: none !important;/,
  );
  assert.match(
    routedDashboards,
    /\.dashboard-shell-venue \{ --mydancr-dashboard-panel: #09090d;[\s\S]*?--mydancr-dashboard-panel-raised: #111116;[\s\S]*?color-scheme: dark; background: #050507;/,
  );
  assert.match(
    routedDashboards,
    /\.dashboard-shell-venue \.venue-deal-panel,[\s\S]*?\.dashboard-shell-venue \.venue-verification-panel \{ border-color: var\(--mydancr-dashboard-border\); background: var\(--mydancr-dashboard-panel-raised\); \}/,
  );
  assert.doesNotMatch(routedDashboards, /venue-dashboard-shortcuts/);
  assert.match(
    routedDashboards,
    /\.dashboard-shell-venue \.venue-deal-form-actions \.primary \{[^}]*?linear-gradient\(135deg, #8b20ef, #6d19d6\)/,
  );
  assert.match(
    routedDashboards,
    /\.dashboard-shell-venue \.venue-deal-builder-step legend > span:first-child \{[^}]*?rgba\(196,122,255,\.8\)[^}]*?linear-gradient\(135deg, #a020f0, #6d19d6\)[^}]*?rgba\(139,92,246,\.36\)/,
  );
  assert.doesNotMatch(aesthetic, /\.dashboard-shell \.venue-deal-panel \{[\s\S]*?success-medium/);
});
