import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [dashboard, customerService, favoritesRoute, venueFollowsRoute, directionsRoute, customerPage, savedRoute, dealSavesRoute, dealSaveClient, clubDealCard, dealSaveMigration] = await Promise.all([
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/customer.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/customer/favorites/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/customer/venue-follows/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/customer/directions/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/customer/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/customer/saved/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/customer/deal-saves/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/customer-deal-saves-client.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/components/ClubDealCard.tsx", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608300009_customer_saved_club_deals.sql", import.meta.url), "utf8"),
]);

test("customer dashboard leads with four clear activity areas before alerts and account", () => {
  assert.match(
    dashboard,
    /<CustomerDashboardNav saved=\{state\.saved\} \/>[\s\S]*?<CustomerPanel[\s\S]*?id="customer-alerts"[\s\S]*?<NotificationPanel saved=\{state\.saved\} customerMode panelId="customer-alerts-panel" \/>[\s\S]*?id="customer-account"/,
  );
  assert.match(
    dashboard,
    /customer-followed-dancers", label: "Followed Dancers"[\s\S]*?customer-followed-clubs", label: "Followed Clubs"[\s\S]*?customer-saved-deals", label: "Saved Club Deals"[\s\S]*?customer-going", label: "I’m Going"[\s\S]*?href="#customer-alerts"[\s\S]*?>Alerts[\s\S]*?href="#customer-account"[\s\S]*?>Account/,
  );
  assert.match(dashboard, /role === "customer" \? "Guest dashboard"/);
  assert.doesNotMatch(dashboard, /eyebrow="(?:Guest workspace|Your activity)"/);
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

test("I’m Going and followed profile sections use live customer records and production actions", () => {
  assert.match(dashboard, /signals=\{saved\?\.goingSignals \|\| \[\]\}/);
  assert.match(dashboard, /item\.shift\?\.status === "posted"/);
  assert.match(dashboard, /customerShiftLabel\(shift\)/);
  assert.match(dashboard, />\s*Cancel Going\s*</);
  assert.match(dashboard, /"\/api\/customer\/going"/);
  assert.match(dashboard, /"\/api\/customer\/follows"/);
  assert.match(dashboard, /"\/api\/customer\/venue-follows"/);
  assert.match(dashboard, /"\/api\/customer\/directions"/);
  assert.match(dashboard, /srcSet=\{image\.imageSrcSet \|\| undefined\}/);
  assert.match(dashboard, /customerDancerHref\(dancer\)/);
  assert.match(dashboard, /customerVenueHref\(venue\)/);
  assert.match(dashboard, /No plans yet[\s\S]*?Find dancers/);
  assert.match(dashboard, /function CustomerNightPanel[\s\S]*?<div className="customer-night-panel"[\s\S]*?<div className="customer-night-list">/);
  assert.doesNotMatch(dashboard, /Plans you confirmed|Dancer shifts you chose|info-panel customer-night-panel/);
  assert.match(dashboard, /No followed dancers yet[\s\S]*?No followed clubs yet/);
  assert.match(dashboard, /id="customer-followed-dancers"[\s\S]*?id="customer-followed-clubs"[\s\S]*?id="customer-saved-deals"[\s\S]*?id="customer-going"/);
});

test("followed dancers and clubs are grouped by city without location-based distance UI", () => {
  assert.match(dashboard, /function customerFollowedDancerCity[\s\S]*?dancer\?\.city \|\| dancer\?\.nextShift\?\.venue\.city[\s\S]*?City not listed/);
  assert.match(dashboard, /function groupFollowedDancersByCity[\s\S]*?customerDashboardCollator\.compare\(left\.city, right\.city\)/);
  assert.match(dashboard, /group\.follows\.slice\(\)\.sort[\s\S]*?left\.dancer\?\.stageName[\s\S]*?right\.dancer\?\.stageName/);
  assert.match(dashboard, /function customerFollowedVenueCity[\s\S]*?item\.venue\?\.city[\s\S]*?City not listed/);
  assert.match(dashboard, /function groupFollowedVenuesByCity[\s\S]*?left\.venue\?\.name[\s\S]*?right\.venue\?\.name[\s\S]*?customerDashboardCollator\.compare\(left\.city, right\.city\)/);
  assert.match(dashboard, /customer-followed-city-list[\s\S]*?customer-followed-city-heading[\s\S]*?customer-saved-card-grid customer-followed-dancer-grid/);
  assert.match(dashboard, /followedVenueCityGroups\.map[\s\S]*?customer-followed-city-heading[\s\S]*?group\.follows\.length === 1 \? "club" : "clubs"/);
  assert.match(dashboard, /\.customer-followed-dancer-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(dashboard, /\.customer-followed-dancer-grid \.customer-saved-card-image \{ height: auto; aspect-ratio: 4 \/ 5; \}/);
  assert.match(dashboard, /\.customer-saved-head \{ align-items: center; flex-direction: row; \}/);
  assert.doesNotMatch(dashboard, /navigator\.geolocation\.getCurrentPosition|customerVenueDistance|Refresh distance|Show distance|Distances updated from your current location/);
});

test("fictional club direction controls navigate to the shared MyDancr destination", () => {
  assert.match(dashboard, /import \{ fictionalVenueTravelAddress \}/);
  assert.doesNotMatch(dashboard, /isFictionalVenueTravelPreviewOnly|previewOnly/);
  assert.match(dashboard, /function CustomerDirectionsButton[\s\S]*?disabled=\{pending\}[\s\S]*?onClick=\{\(\) => void onDirections\(venue, dancerId\)\}/);
  assert.match(dashboard, /function customerDirectionsHref[\s\S]*?const fictionalAddress = fictionalVenueTravelAddress\(venue\)[\s\S]*?const query = fictionalAddress \|\|/);
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
  assert.match(dashboard, /How cashier tap redemption works/);
  assert.match(dashboard, /Choose the exact deal[\s\S]*?Tap at the cashier[\s\S]*?Wait for confirmation/);
  assert.match(dashboard, /There is no QR code to scan/);
});

test("new guest confirmation explains private account benefits once", () => {
  assert.match(customerPage, /showCustomerWelcome=\{params\.confirmed === "1"\}/);
  assert.match(dashboard, /mydancr:customer-welcome-dismissed:/);
  assert.match(dashboard, /Your private MyDancr account is ready/);
  assert.match(dashboard, /account or activity on a public profile/);
  assert.match(dashboard, /Follow dancers and clubs/);
  assert.match(dashboard, /Save favorite profiles and Club Deals/);
  assert.match(dashboard, /Get Working Now and schedule alerts/);
  assert.match(dashboard, /Use I&amp;apos;m Going|Use I\&apos;m Going/);
  assert.match(dashboard, /Explore dancers/);
  assert.match(dashboard, /View Club Deals/);
  assert.match(dashboard, /url\.searchParams\.delete\("confirmed"\)/);
});

test("Club Deals can be privately bookmarked without reserving or redeeming them", () => {
  assert.match(dealSaveMigration, /create table if not exists public\.customer_deal_saves/);
  assert.match(dealSaveMigration, /primary key \(customer_id, club_deal_id\)/);
  assert.match(dealSaveMigration, /enable row level security/);
  assert.match(dealSaveMigration, /customer_id = auth\.uid\(\)/);
  assert.match(dealSaveMigration, /Saving never reserves, selects, or redeems an offer/);
  assert.doesNotMatch(dealSaveMigration, /redemption_token|redeemed_at/);

  assert.match(dealSavesRoute, /createRequestSupabaseContext\(request\)/);
  assert.match(dealSavesRoute, /requireActiveCustomer/);
  assert.match(dealSavesRoute, /readBoundedJsonObject/);
  assert.match(dealSavesRoute, /enforcePublicRequestRateLimit/);
  assert.match(dealSavesRoute, /requirePublicClubDeal/);
  assert.match(dealSavesRoute, /saveCustomerClubDeal/);
  assert.match(dealSavesRoute, /removeCustomerClubDeal/);
  assert.match(dealSavesRoute, /persisted: false/);
  assert.match(dealSavesRoute, /ok: true, saved, persisted, session/);
  assert.match(savedRoute, /getCustomerSavedClubDeals/);
  assert.match(savedRoute, /dealSaves/);
  assert.match(customerService, /\.from\("customer_deal_saves"\)/);

  assert.match(dealSaveClient, /readBrowserAuthSession/);
  assert.match(dealSaveClient, /persistRefreshedBrowserAuthSession/);
  assert.match(dealSaveClient, /data\.persisted !== false/);
  assert.match(clubDealCard, /setCustomerDealSavedInAccount/);
  assert.match(clubDealCard, /savedToAccount[\s\S]*?saved\.filter\(\(item\) => item\.id !== id\)/);
  assert.match(clubDealCard, /Saved privately to your account\. This does not reserve or redeem the deal\./);
  assert.match(clubDealCard, /Saved on this device\. Sign in to keep it across devices\. This does not redeem the deal\./);
});

test("customer dashboard keeps saved deals separate from cashier redemption activity", () => {
  assert.match(dashboard, /<h2>Saved Club Deals<\/h2>/);
  assert.match(dashboard, /Saved deals are private bookmarks\. Saving does not reserve, select, or redeem an offer\./);
  assert.match(dashboard, /<details className="customer-deal-activity">[\s\S]*?Club Deal use &amp; history/);
  assert.match(dashboard, />View deal<\/Link>/);
  assert.match(dashboard, />\s*Remove\s*<\/button>/);
  assert.match(dashboard, /"\/api\/customer\/deal-saves"/);
  assert.match(dashboard, /CustomerDirectionsButton/);
  assert.match(dashboard, /No saved Club Deals yet/);
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
  assert.match(dashboard, /@media \(max-width: 620px\)[\s\S]*?\.customer-dashboard-primary-links \{ grid-template-columns: repeat\(2/);
  assert.match(dashboard, /\.customer-card-actions a, \.customer-card-actions button, \.customer-empty-state a \{ min-height: 42px;/);
  assert.match(dashboard, /@media \(max-width: 520px\)[\s\S]*?\.dashboard-head-row \{ gap: 10px; \}/);
  assert.doesNotMatch(dashboard, /GlobalMobileBottomNav|home-mobile-bottom-nav/);
});

test("customer dashboard close control matches the compact dancer-profile close style", () => {
  assert.match(dashboard, /\.dashboard-shell-customer \.dashboard-head-row \{ grid-template-columns: minmax\(0, 1fr\) 36px; \}/);
  assert.match(dashboard, /\.dashboard-shell-customer \.dashboard-close \{[^}]*width: 36px !important;[^}]*height: 36px !important;[^}]*border: 1px solid rgba\(226,232,240,\.22\) !important;[^}]*linear-gradient\(145deg,rgba\(49,47,59,\.96\),rgba\(19,19,25,\.94\)\) !important;/);
  assert.match(dashboard, /\.dashboard-shell-customer \.dashboard-close svg \{ width: 15px !important; height: 15px !important; stroke-width: 1\.85; \}/);
});
