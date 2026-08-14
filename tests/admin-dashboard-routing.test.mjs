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

test("/admin opens the routed production admin workspace", () => {
  assert.match(adminRoute, /import AdminClient from "\.\/AdminClient"/);
  assert.match(adminRoute, /return <AdminClient \/>/);
  assert.doesNotMatch(adminRoute, /redirect\(/);
  assert.match(liveApp, /function handleAdminDashboardDeepLink\(\)/);
  assert.match(liveApp, /params\.get\("dancr_dashboard"\) !== "admin"/);
  assert.match(liveApp, /function openAdminDashboard\(\) \{\s*window\.location\.assign\("\/admin"\);\s*\}/);
  assert.match(
    liveApp,
    /!handleAdminDashboardDeepLink\(\) && !handleVenueDashboardDeepLink\(\) && !handleDancerDashboardDeepLink\(\)/,
  );
});

test("advanced admin operations stay available through the canonical dashboard", () => {
  assert.match(operationsRoute, /import AdminClient from "\.\.\/AdminClient"/);
  assert.match(operationsRoute, /return <AdminClient \/>/);
  assert.match(liveApp, /href="\/admin\/operations"[^>]*>Open full operations center<\/a>/);
  assert.match(
    adminClient,
    /return_to=\$\{encodeURIComponent\("\/admin"\)\}/,
  );
});

test("admin uses the same routed dashboard chrome and structured loading hierarchy", () => {
  assert.match(adminClient, /className="admin-shell dashboard-shell-admin"/);
  assert.match(adminClient, /className="dashboard-head admin-dashboard-head"/);
  assert.match(adminClient, /className="dashboard-close"/);
  assert.match(adminClient, /href=\{homeDiscoveryHref\("tonight"\)\}/);
  assert.match(adminClient, /<AdminDashboardLoadingState \/>/);
  assert.match(adminClient, /className="admin-dashboard-loading-command"/);
  assert.match(adminClient, /className="admin-dashboard-loading-actions"/);
  assert.match(adminClient, /className="admin-dashboard-loading-metrics"/);
  assert.match(adminClient, /\.admin-workspace-nav \{[^}]*grid-template-columns: repeat\(6, minmax\(0, 1fr\)\)/);
  assert.match(adminClient, /\.admin-shell\.dashboard-shell-admin \{[^}]*safe-area-inset-top/);
  assert.match(adminClient, /@media \(max-width: 680px\)[\s\S]*?\.admin-workspace-nav \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(adminClient, /className="top-nav"/);
});

test("Login / Join visibly links to separate platform admin access", () => {
  assert.match(
    homeRoute,
    /id=\"platformAdminAuthLink\" href=\"\/admin\" aria-label=\"Open Platform admin sign in or signup\"/,
  );
  assert.match(
    homeRoute,
    /<strong>Platform admin<\/strong><small>Private admin access<\/small>/,
  );
  assert.match(homeRoute, /#authPage \.auth-admin-entry\{[^}]*min-height:54px;[^}]*grid-template-columns:30px minmax\(0,1fr\) auto;[^}]*padding:9px 12px/);
  assert.match(homeRoute, /#authPage \.auth-admin-entry-mark\{[^}]*width:30px;/);
  assert.match(homeRoute, /#authPage \.auth-admin-entry-copy strong\{font-size:15px;/);
  assert.match(
    homeRoute,
    /withLiveProfileAssets\.replace\([\s\S]*?passwordRecoveryCard[\s\S]*?ADMIN_AUTH_ENTRY_HTML/,
  );
});
