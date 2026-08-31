import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const homeSource = await readFile(
  new URL("../outputs/index.html", import.meta.url),
  "utf8",
);

test("every account dashboard fully isolates the public shell and keeps its X as the exit to home", () => {
  assert.match(
    homeSource,
    /body\.account-surface-open \.app > header,\s*body\.account-surface-open \.app > main,\s*body\.account-surface-open #discoveryTabs \{\s*display: none !important;\s*\}/,
  );
  assert.match(
    homeSource,
    /body\.account-surface-open \.page-panel\.show \{\s*z-index: 120 !important;\s*min-height: 100vh;\s*min-height: 100dvh;\s*background: var\(--dancr-color-background, #030304\) !important;\s*isolation: isolate;\s*\}/,
  );
  const dashboardLayer = homeSource.match(
    /#customerDashboard\.page-panel\.show,\s*#dancerDashboard\.page-panel\.show,\s*#venueDashboard\.page-panel\.show,\s*#adminDashboard\.page-panel\.show \{\s*z-index: (\d+) !important;\s*isolation: isolate;\s*\}/,
  );
  const discoveryLayer = homeSource.match(
    /\.discovery-sticky-head \{[^}]*z-index: (\d+);/s,
  );
  const profileLayer = homeSource.match(
    /#profileBackdrop\.modal-backdrop\.show \{\s*z-index: (\d+) !important;/,
  );
  assert.ok(dashboardLayer);
  assert.ok(discoveryLayer);
  assert.ok(profileLayer);
  assert.ok(Number(dashboardLayer[1]) > Number(discoveryLayer[1]));
  assert.ok(Number(dashboardLayer[1]) < Number(profileLayer[1]));
  assert.match(
    homeSource,
    /const dashboardOverlayOpen = !!document\.querySelector\(\s*"#customerDashboard\.show, #dancerDashboard\.show, #venueDashboard\.show, #adminDashboard\.show"\s*\);[\s\S]*?document\.body\.classList\.toggle\("dashboard-overlay-open", dashboardOverlayOpen\);/,
  );
  assert.match(
    homeSource,
    /const accountSurfaceOpen =\s*dashboardOverlayOpen \|\|\s*accountCreationOverlayOpen \|\|\s*authPage\.classList\.contains\("show"\);[\s\S]*?document\.body\.classList\.toggle\("account-surface-open", accountSurfaceOpen\);/,
  );
  assert.match(
    homeSource,
    /const customerAuthOverlayOpen =\s*authPage\.classList\.contains\("show"\) &&\s*!authForm\.hidden;[\s\S]*?document\.body\.classList\.toggle\("customer-auth-overlay-open", customerAuthOverlayOpen\);/,
  );
  assert.match(
    homeSource,
    /document\.body\.classList\.toggle\("dancer-auth-overlay-open", false\);/,
  );
  assert.match(
    homeSource,
    /const venueAuthOverlayOpen =\s*authPage\.classList\.contains\("show"\) &&\s*!document\.getElementById\("venueLoginForm"\)\.hidden;[\s\S]*?document\.body\.classList\.toggle\("venue-auth-overlay-open", venueAuthOverlayOpen\);/,
  );
  assert.match(
    homeSource,
    /<button class="close-btn" id="dancerDashboardClose" aria-label="Close dancer dashboard">/,
  );
  assert.match(
    homeSource,
    /function closeDancerDashboard\(\) \{[\s\S]*?dancerDashboard\.classList\.remove\("show"\);\s*dancerDashboard\.setAttribute\("aria-hidden", "true"\);[\s\S]*?syncOverlayScrollLock\(\);\s*\}/,
  );
  assert.match(
    homeSource,
    /function closeDancerDashboard\(\) \{\s*stopDancerVenueVerificationLifecycle\(\);/,
  );
  assert.match(
    homeSource,
    /function closeDancerDashboard\(\) \{[\s\S]*?stopDancerVenueApprovalPolling\(\);\s*syncOverlayScrollLock\(\);/,
  );
  assert.match(
    homeSource,
    /document\.getElementById\("dancerDashboardClose"\)\.addEventListener\("click", closeDancerDashboard\);/,
  );
});

test("customer, dancer, venue, and admin access screens cannot expose public discovery content", () => {
  assert.match(
    homeSource,
    /const accountSurfaceOpen =\s*dashboardOverlayOpen \|\|\s*accountCreationOverlayOpen \|\|\s*authPage\.classList\.contains\("show"\);/,
  );
  assert.match(homeSource, /<section class="page-panel" id="authPage"/);
  assert.match(homeSource, /<form class="auth-form" id="authForm" data-auth-view="unified">/);
  assert.doesNotMatch(homeSource, /<form class="auth-form" id="dancerLoginForm"/);
  assert.match(homeSource, /<form class="auth-form" id="venueLoginForm"/);
  assert.match(homeSource, /<section class="page-panel" id="dancerSignupPage"/);
  assert.match(homeSource, /<section class="page-panel" id="adminDashboard"/);
  assert.match(homeSource, /<form class="auth-card auth-form admin-login-form" id="adminLoginForm">/);
  const accountCreationLayer = homeSource.match(
    /#dancerSignupPage\.page-panel\.show,\s*#stripeCheckoutPage\.page-panel\.show \{\s*z-index: (\d+) !important;\s*isolation: isolate;\s*\}/,
  );
  const discoveryLayer = homeSource.match(
    /\.discovery-sticky-head \{[^}]*z-index: (\d+);/s,
  );
  assert.ok(accountCreationLayer);
  assert.ok(discoveryLayer);
  assert.ok(Number(accountCreationLayer[1]) > Number(discoveryLayer[1]));
  assert.match(
    homeSource,
    /const accountCreationOverlayOpen =\s*dancerSignupPage\.classList\.contains\("show"\) \|\|\s*stripeCheckoutPage\.classList\.contains\("show"\);[\s\S]*?document\.body\.classList\.toggle\("account-creation-overlay-open", accountCreationOverlayOpen\);/,
  );
});
