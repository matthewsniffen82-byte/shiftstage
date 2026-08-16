import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const closeButton = await readFile(
  new URL("../app/components/DashboardCloseButton.tsx", import.meta.url),
  "utf8",
);
const dashboard = await readFile(
  new URL("../app/dashboard/DashboardClient.tsx", import.meta.url),
  "utf8",
);
const admin = await readFile(
  new URL("../app/admin/AdminClient.tsx", import.meta.url),
  "utf8",
);

test("routed dashboards restore the already-loaded referring discovery page", () => {
  assert.match(closeButton, /previousUrl\.origin === window\.location\.origin/);
  assert.match(closeButton, /!DASHBOARD_ROUTE\.test\(previousUrl\.pathname\)/);
  assert.match(closeButton, /window\.history\.length > 1/);
  assert.match(closeButton, /event\.preventDefault\(\)/);
  assert.match(closeButton, /window\.history\.back\(\)/);
  assert.match(closeButton, /window\.addEventListener\([\s\S]*?"pagehide"/);
});

test("dashboard close keeps a canonical discovery fallback for direct entry", () => {
  assert.match(closeButton, /href=\{fallbackHref\}/);
  assert.match(closeButton, /new URL\(fallbackHref, window\.location\.origin\)/);
  assert.match(closeButton, /window\.location\.assign\(destination\.toString\(\)\)/);
  assert.match(closeButton, /HISTORY_FALLBACK_DELAY_MS = 900/);
});

test("customer, dancer, club, and admin dashboards share the fast close control", () => {
  assert.match(dashboard, /<DashboardCloseButton[\s\S]*?fallbackHref=\{dashboardCloseHref\}/);
  assert.match(dashboard, /label=\{`Close \$\{role\} dashboard and return to MyDancr`\}/);
  assert.match(admin, /<DashboardCloseButton[\s\S]*?fallbackHref=\{homeDiscoveryHref\("tonight"\)\}/);
  assert.match(admin, /label="Close admin dashboard and return to MyDancr"/);
});
