import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [adminRoute, operationsRoute, adminClient, liveApp] = await Promise.all([
  readFile(new URL("../app/admin/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/operations/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
]);

test("/admin opens the production app's real platform admin dashboard", () => {
  assert.match(adminRoute, /redirect\("\/\?dancr_dashboard=admin"\)/);
  assert.doesNotMatch(adminRoute, /<AdminClient/);
  assert.match(liveApp, /function handleAdminDashboardDeepLink\(\)/);
  assert.match(liveApp, /params\.get\("dancr_dashboard"\) !== "admin"/);
  assert.match(liveApp, /openAdminDashboard\(\)/);
  assert.match(
    liveApp,
    /!handleAdminDashboardDeepLink\(\) && !handleDancerDashboardDeepLink\(\)/,
  );
});

test("advanced admin operations stay available without replacing the real dashboard", () => {
  assert.match(operationsRoute, /import AdminClient from "\.\.\/AdminClient"/);
  assert.match(operationsRoute, /return <AdminClient \/>/);
  assert.match(liveApp, /href="\/admin\/operations"[^>]*>Open full operations center<\/a>/);
  assert.match(
    adminClient,
    /return_to=\$\{encodeURIComponent\("\/admin\/operations"\)\}/,
  );
});
