import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [liveApp, routedDashboards] = await Promise.all([
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
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

test("venue dashboard uses the dancer command, shortcuts, metrics, and compact-management hierarchy", () => {
  const venuePanel = routedDashboards.match(/function VenuePanel[\s\S]*?function VenueClubDealPanel/)?.[0] || "";
  const commandIndex = venuePanel.indexOf('className="venue-command-panel"');
  const shortcutsIndex = venuePanel.indexOf('className="venue-dashboard-shortcuts"');
  const metricsIndex = venuePanel.indexOf('className="venue-dashboard-metrics"');
  const managementIndex = venuePanel.indexOf("<VenueDashboardSection");

  assert.ok(commandIndex >= 0);
  assert.ok(shortcutsIndex > commandIndex);
  assert.ok(metricsIndex > shortcutsIndex);
  assert.ok(managementIndex > metricsIndex);
  assert.match(venuePanel, /className="primary-link"[\s\S]*?Manage Club Deal/);
  assert.match(venuePanel, /function openVenueSection[\s\S]*?section\.open = true[\s\S]*?scrollIntoView/);
  assert.doesNotMatch(venuePanel, /<VenueDashboardSection\s+defaultOpen[\s\S]*?id="venue-overview"/);
  assert.match(routedDashboards, /\.venue-dashboard-shortcuts \{ display: grid; grid-template-columns: repeat\(4/);
  assert.match(routedDashboards, /@media \(max-width: 860px\) \{ \.venue-dashboard-shortcuts \{ grid-template-columns: repeat\(2/);
  assert.match(routedDashboards, /\.venue-dashboard-metrics \{ display: grid; grid-template-columns: repeat\(3/);
  assert.match(
    routedDashboards,
    /\.dashboard-head h1 \{[\s\S]*?font-size: clamp\(21px, 5vw, 26px\);[\s\S]*?text-overflow: ellipsis;[\s\S]*?white-space: nowrap;/,
  );
  assert.doesNotMatch(routedDashboards, /\.dashboard-head-venue h1/);
});
