import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [dashboard, customerService, favoritesRoute, venueFollowsRoute, directionsRoute] = await Promise.all([
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/customer.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/customer/favorites/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/customer/venue-follows/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/customer/directions/route.ts", import.meta.url), "utf8"),
]);

test("customer dashboard leads with tonight, saved, deals, and alerts before account settings", () => {
  assert.match(
    dashboard,
    /<CustomerDashboardTabs \/>[\s\S]*?<CustomerPanel[\s\S]*?id="customer-alerts"[\s\S]*?<NotificationPanel saved=\{state\.saved\} customerMode panelId="customer-alerts-panel" \/>[\s\S]*?id="customer-settings"/,
  );
  assert.match(
    dashboard,
    /href="#customer-tonight"[\s\S]*?>Tonight[\s\S]*?href="#customer-saved"[\s\S]*?>Saved[\s\S]*?href="#customer-offers"[\s\S]*?>Deals[\s\S]*?href="#customer-alerts"[\s\S]*?>Alerts[\s\S]*?href="#customer-settings"[\s\S]*?>Settings/,
  );
  assert.match(dashboard, /role === "customer" \? "Customer dashboard"/);
  assert.match(dashboard, /const dashboardHeading = isLoading[\s\S]*?role === "dancer" \? profileDisplayName \|\| title : resolvedDisplayName \|\| title[\s\S]*?: displayName/);
  assert.doesNotMatch(dashboard, /Welcome back, \$\{displayName\}/);
  assert.match(dashboard, /<DashboardCloseButton[\s\S]*?label=\{`Close \$\{role\} dashboard and return to MyDancr`\}/);
  assert.match(dashboard, /<SupportInboxPanel initialThreads=\{state\.supportThreads \|\| \[\]\} panelId="customer-support" \/>/);
});

test("dancer dashboard header prefers the saved stage name and never the email-derived account name", () => {
  assert.match(dashboard, /const profileDisplayName = String\(dashboardName\(state\.profile, role\) \|\| ""\)\.trim\(\)/);
  assert.match(dashboard, /const resolvedDisplayName = role === "dancer"[\s\S]*?\? profileDisplayName[\s\S]*?: accountDisplayName \|\| profileDisplayName/);
  assert.match(dashboard, /if \(role === "dancer"\) return persistedDancerStageName\(profile\)/);
  assert.match(dashboard, /function persistedDancerStageName[\s\S]*?identity_saved_at[\s\S]*?return ""/);
  assert.doesNotMatch(dashboard, /role === "dancer"[\s\S]{0,120}\? accountDisplayName/);
});

test("Your Night and Saved cards use live customer records and production actions", () => {
  assert.match(dashboard, /signals=\{saved\?\.goingSignals \|\| \[\]\}/);
  assert.match(dashboard, /item\.shift\?\.status === "posted"/);
  assert.match(dashboard, /customerShiftLabel\(shift\)/);
  assert.match(dashboard, />\s*Cancel Going\s*</);
  assert.match(dashboard, /"\/api\/customer\/going"/);
  assert.match(dashboard, /"\/api\/customer\/follows"/);
  assert.match(dashboard, /"\/api\/customer\/favorites"/);
  assert.match(dashboard, /"\/api\/customer\/venue-follows"/);
  assert.match(dashboard, /"\/api\/customer\/directions"/);
  assert.match(dashboard, /navigator\.geolocation\.getCurrentPosition/);
  assert.match(dashboard, /const haversine = Math\.sin/);
  assert.match(dashboard, /srcSet=\{image\.imageSrcSet \|\| undefined\}/);
  assert.match(dashboard, /customerDancerHref\(dancer\)/);
  assert.match(dashboard, /customerVenueHref\(venue\)/);
  assert.match(dashboard, /No plans yet[\s\S]*?Find dancers/);
  assert.match(dashboard, /No followed dancers yet[\s\S]*?No favorite dancers yet[\s\S]*?No followed clubs yet/);
});

test("fictional club direction controls remain visually active while demo navigation is blocked", () => {
  assert.match(dashboard, /import \{ isFictionalVenueTravelPreviewOnly \}/);
  assert.match(dashboard, /async function openDirections[\s\S]*?if \(isFictionalVenueTravelPreviewOnly\(venue\)\) return;/);
  assert.match(dashboard, /function CustomerDirectionsButton[\s\S]*?const previewOnly = isFictionalVenueTravelPreviewOnly\(venue\)/);
  assert.match(dashboard, /aria-disabled=\{previewOnly \? "true" : undefined\}/);
  assert.match(dashboard, /disabled=\{!previewOnly && pending\}/);
  assert.match(dashboard, /if \(previewOnly\) \{[\s\S]*?event\.preventDefault\(\);[\s\S]*?event\.stopPropagation\(\);[\s\S]*?return;/);
  assert.match(dashboard, /tabIndex=\{previewOnly \? -1 : undefined\}/);
  assert.match(dashboard, /\.customer-card-actions button\[aria-disabled="true"\] \{ opacity: 1; cursor: default; \}/);
});

test("saved customer data includes approved responsive imagery and the next real posted shift", () => {
  assert.match(customerService, /getSavedDancerSchedules\(client, dancerIds\)/);
  assert.match(customerService, /\.from\("shifts"\)[\s\S]*?\.eq\("status", "posted"\)[\s\S]*?\.gt\("ends_at", new Date\(\)\.toISOString\(\)\)/);
  assert.match(customerService, /dancer_photos\(storage_path, is_primary, review_status, sort_order\)/);
  assert.match(customerService, /photo\.review_status === "approved"/);
  assert.match(customerService, /responsivePublicImage\(client, "dancer-photos"/);
  assert.match(customerService, /responsivePublicImage\(client, "venue-cover-images"/);
  assert.match(customerService, /nextShift: schedules\.get\(item\.dancer\.id\) \|\| null/);
  assert.doesNotMatch(customerService, /sample|placeholder|mock/i);
});

test("Club Deal wallet and alerts expose real status, expiry, history, and direct destinations", () => {
  assert.match(dashboard, /item\.status === "generated" && new Date\(item\.expiresAt\)\.getTime\(\) > now/);
  assert.match(dashboard, /dealExpiryLabel\(item\.expiresAt, now\)/);
  assert.match(dashboard, /function useCustomerMinuteClock\(\)[\s\S]*?window\.setInterval\(update, 60_000\)/);
  assert.match(dashboard, /<details className="past-deal-history">/);
  assert.match(dashboard, /href=\{`\/deals\/pass\/\$\{encodeURIComponent\(item\.redemptionToken\)\}`\}/);
  assert.match(dashboard, /function customerNotificationHref/);
  assert.match(dashboard, /formatNotificationTimestamp\(notification\.createdAt\)/);
  assert.match(dashboard, /destination \? \([\s\S]*?<Link[\s\S]*?onClick=\{\(\) => void markRead\(notificationId\)\}/);
  assert.match(dashboard, /No alerts yet[\s\S]*?Browse dancers/);
  assert.match(dashboard, /How cashier NFC redemption works/);
  assert.match(dashboard, /Choose the exact deal[\s\S]*?Tap at the cashier[\s\S]*?Wait for confirmation/);
  assert.match(dashboard, /There is no QR code to scan/);
});

test("customer action endpoints reject malformed identifiers and oversized attribution input", () => {
  for (const route of [favoritesRoute, venueFollowsRoute, directionsRoute]) {
    assert.match(route, /const UUID_PATTERN/);
    assert.match(route, /UUID_PATTERN\.test/);
  }
  assert.match(directionsRoute, /MAX_ATTRIBUTED_DANCERS = 20/);
  assert.match(directionsRoute, /dancerIds\.length !== submittedDancerIds\.length/);
  assert.match(directionsRoute, /MAX_SESSION_ID_LENGTH = 160/);
});

test("customer dashboard remains touch-friendly and responsive without owning the global bottom navigation", () => {
  assert.match(dashboard, /@media \(max-width: 620px\)[\s\S]*?\.customer-dashboard-tabs[\s\S]*?overflow-x: auto/);
  assert.match(dashboard, /\.customer-card-actions a, \.customer-card-actions button, \.customer-empty-state a \{ min-height: 42px;/);
  assert.match(dashboard, /@media \(max-width: 520px\)[\s\S]*?\.dashboard-head-row \{ gap: 10px; \}/);
  assert.doesNotMatch(dashboard, /GlobalMobileBottomNav|home-mobile-bottom-nav/);
});
