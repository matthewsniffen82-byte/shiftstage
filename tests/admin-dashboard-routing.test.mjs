import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [adminRoute, operationsRoute, adminClient, liveApp, homeRoute] = await Promise.all([
  readFile(new URL("../app/admin/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/operations/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/route.ts", import.meta.url), "utf8"),
]);

test("/admin opens the production app's real platform admin dashboard", () => {
  assert.match(adminRoute, /redirect\("\/\?dancr_dashboard=admin"\)/);
  assert.doesNotMatch(adminRoute, /<AdminClient/);
  assert.match(liveApp, /function handleAdminDashboardDeepLink\(\)/);
  assert.match(liveApp, /params\.get\("dancr_dashboard"\) !== "admin"/);
  assert.match(liveApp, /openAdminDashboard\(\)/);
  assert.match(
    liveApp,
    /!handleAdminDashboardDeepLink\(\) && !handleVenueDashboardDeepLink\(\) && !handleDancerDashboardDeepLink\(\)/,
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

test("Login / Join visibly links to separate platform admin access", () => {
  assert.match(
    homeRoute,
    /id=\"platformAdminAuthLink\" href=\"\/admin\" aria-label=\"Open Platform admin sign in or signup\"/,
  );
  assert.match(
    homeRoute,
    /<strong>Platform admin<\/strong><small>Sign in or create an admin account with your private admin code\.<\/small>/,
  );
  assert.match(homeRoute, /#authPage \.auth-admin-entry\{[^}]*min-height:68px;[^}]*grid-template-columns:42px minmax\(0,1fr\) auto;/);
  assert.match(
    homeRoute,
    /withLiveProfileAssets\.replace\([\s\S]*?passwordRecoveryCard[\s\S]*?ADMIN_AUTH_ENTRY_HTML/,
  );
});
