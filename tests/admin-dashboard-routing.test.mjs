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
  assert.match(adminClient, /<DashboardCloseButton/);
  assert.match(adminClient, /fallbackHref=\{homeDiscoveryHref\("tonight"\)\}/);
  assert.match(adminClient, /<AdminDashboardLoadingState \/>/);
  assert.match(adminClient, /className="admin-dashboard-loading-command"/);
  assert.match(adminClient, /className="admin-dashboard-loading-actions"/);
  assert.match(adminClient, /className="admin-dashboard-loading-metrics"/);
  assert.match(adminClient, /\.admin-workspace-nav \{[^}]*grid-template-columns: repeat\(6, minmax\(0, 1fr\)\)/);
  assert.match(adminClient, /\.admin-shell\.dashboard-shell-admin \{[^}]*safe-area-inset-top/);
  assert.match(adminClient, /@media \(max-width: 680px\)[\s\S]*?\.admin-workspace-nav \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(adminClient, /className="top-nav"/);
});

test("admin authentication follows the same responsive form hierarchy as other sign-in pages", () => {
  assert.match(adminClient, /\.sign-in \{ max-width: 520px; display: grid; gap: 14px; padding: 18px;/);
  assert.match(adminClient, /\.sign-in \.forgot-password \{ width: 100%; min-height: 44px; justify-self: stretch;/);
  assert.match(adminClient, /\.sign-in > button\[type="submit"\] \{ width: 100%; min-height: 48px;[\s\S]*?linear-gradient\(135deg,#7c3aed,#4c1d95\)/);
  assert.match(adminClient, /@media \(max-width: 680px\)[\s\S]*?\.sign-in \{ gap: 13px; padding: 16px; \}/);

  assert.match(liveApp, /<form class="auth-card auth-form admin-login-form" id="adminLoginForm">/);
  assert.match(liveApp, /class="auth-tabs admin-auth-tabs" aria-label="Admin auth mode"/);
  assert.match(liveApp, /id="adminLoginBtn" type="submit">Sign in<\/button>/);
  assert.match(liveApp, /#adminDashboard \.admin-login-form \{[\s\S]*?display: grid !important;[\s\S]*?gap: 14px !important;[\s\S]*?padding: 18px !important;/);
  assert.match(liveApp, /#adminDashboard \.admin-login-form \.forgot-password-link \{[\s\S]*?width: 100% !important;[\s\S]*?min-height: 44px !important;/);
  assert.match(liveApp, /else button\.textContent = "Sign in";/);
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
  assert.match(homeRoute, /#authPage\.venue-request-succeeded \.auth-admin-entry\{display:none\}/);
  assert.match(
    homeRoute,
    /withPreviewBanner\.replace\([\s\S]*?passwordRecoveryCard[\s\S]*?ADMIN_AUTH_ENTRY_HTML/,
  );
});
