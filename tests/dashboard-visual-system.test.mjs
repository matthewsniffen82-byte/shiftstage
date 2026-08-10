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

test("venue dashboard uses a tonight-first command, shortcuts, metrics, and compact-management hierarchy", () => {
  const venuePanel = routedDashboards.match(/function VenuePanel[\s\S]*?function VenueClubDealPanel/)?.[0] || "";
  const commandIndex = venuePanel.indexOf('className="venue-command-panel"');
  const shortcutsIndex = venuePanel.indexOf('className="venue-dashboard-shortcuts"');
  const metricsIndex = venuePanel.indexOf('className="venue-dashboard-metrics venue-tonight-metrics"');
  const managementIndex = venuePanel.indexOf("<VenueDashboardSection");

  assert.ok(commandIndex >= 0);
  assert.ok(shortcutsIndex > commandIndex);
  assert.ok(metricsIndex > shortcutsIndex);
  assert.ok(managementIndex > metricsIndex);
  assert.match(venuePanel, /className="primary-link" href="#venue-dancer-roster"[\s\S]*?Manage dancer NFC/);
  assert.match(
    routedDashboards,
    /\.venue-command-primary \.primary-link \{[^}]*?width: 100%; max-width: 100%;[^}]*?box-sizing: border-box;/,
  );
  assert.match(venuePanel, /function openVenueSection[\s\S]*?section\.open = true[\s\S]*?scrollIntoView/);
  assert.doesNotMatch(venuePanel, /<VenueDashboardSection\s+defaultOpen[\s\S]*?id="venue-overview"/);
  assert.match(routedDashboards, /\.venue-dashboard-shortcuts \{ display: grid; grid-template-columns: repeat\(4/);
  assert.match(routedDashboards, /@media \(max-width: 860px\) \{ \.venue-dashboard-shortcuts \{ grid-template-columns: repeat\(2/);
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
  assert.match(routedDashboards, /\.venue-dashboard-shortcuts svg \{[^}]*?width: 21px; height: 21px;/);
  assert.match(routedDashboards, /\.venue-dashboard-shortcuts small \{[^}]*?font-size: 10px;/);
  assert.match(routedDashboards, /\.venue-dashboard-metrics \.metric strong \{ font-size: 22px; \}/);
  assert.match(routedDashboards, /\.venue-dashboard-section > summary \{ min-height: 76px;/);
  assert.doesNotMatch(routedDashboards, /venue-deal-builder-progress/);
  assert.match(routedDashboards, /<section className=\{`dashboard-head dashboard-head-\$\{role\}`\}[\s\S]*?<h1>\{dashboardHeading\}<\/h1>/);
  assert.doesNotMatch(routedDashboards, /\.dashboard-head-venue h1/);
  assert.match(
    aesthetic,
    /@media \(max-width: 720px\)[\s\S]*?\.dashboard-shell:not\(\.dashboard-shell-venue\) \.dashboard-head h1,[\s\S]*?font-size: clamp\(38px, 12vw, 54px\) !important;/,
  );
  assert.match(
    aesthetic,
    /\.dashboard-shell-venue \.dashboard-head h1 \{[\s\S]*?font-size: clamp\(20px, 5\.5vw, 26px\) !important;[\s\S]*?font-weight: 850 !important;[\s\S]*?line-height: 0\.98 !important;/,
  );
  assert.match(
    aesthetic,
    /\.dashboard-shell-venue \{[\s\S]*?color-scheme: dark;[\s\S]*?background-color: var\(--dancr-color-background\) !important;[\s\S]*?background-image: none !important;/,
  );
  assert.match(
    routedDashboards,
    /\.dashboard-shell-venue \{ --mydancr-dashboard-panel: #09090d;[\s\S]*?--mydancr-dashboard-panel-raised: #111116;[\s\S]*?color-scheme: dark; background: #050507;/,
  );
  assert.match(
    routedDashboards,
    /\.dashboard-shell-venue \.venue-deal-panel,[\s\S]*?\.dashboard-shell-venue \.venue-verification-panel \{ border-color: var\(--mydancr-dashboard-border\); background: var\(--mydancr-dashboard-panel-raised\); \}/,
  );
  assert.match(
    routedDashboards,
    /\.dashboard-shell-venue \.venue-dashboard-shortcuts > a\.is-primary \{[^}]*?rgba\(139,92,246,\.48\)[^}]*?#8b5cf6/,
  );
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
