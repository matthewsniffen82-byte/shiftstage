import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panels = readFileSync(new URL("../app/dashboard/DancerDashboardPanels.tsx", import.meta.url), "utf8");
const analytics = readFileSync(new URL("../app/dashboard/DancerAnalyticsPanel.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/dashboard/DashboardStyles.tsx", import.meta.url), "utf8");
const loader = readFileSync(new URL("../app/dashboard/dancer-dashboard-loader.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/dancer/dashboard/route.ts", import.meta.url), "utf8");

test("dancer analytics replace the retired deal and weekly panels", () => {
  assert.match(panels, /title="Analytics"/);
  assert.match(panels, /<DancerAnalyticsPanel initialAnalytics=\{analytics\} \/>/);
  assert.doesNotMatch(panels, /Club Deal activity|Cashier opens|Redeemed deals|Weekly results|Unranked|No ranking milestones/);
  assert.match(route, /requestedPeriod === null \? getDancerDealMetrics\(client, user.id, admin\) : Promise.resolve\(null\)/);
  assert.match(loader, /\/api\/dancer\/dashboard\?period=7d/);
  assert.doesNotMatch(loader, /\/api\/dancer\/(weekly-report|ranking-events)/);
});

test("analytics offer four engagement cards and two compact detail sections", () => {
  for (const label of ["Profile views", "New followers", "Content likes", "Social link taps"]) assert.ok(analytics.includes('label="' + label + '"'));
  assert.match(analytics, /Your audience/);
  assert.match(analytics, /Top content/);
  assert.doesNotMatch(analytics, /<details/);
  assert.match(styles, /\.dancer-analytics-metrics \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
});
