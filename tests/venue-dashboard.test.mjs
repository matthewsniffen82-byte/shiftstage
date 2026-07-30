import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  authRoute,
  authHelpers,
  venueSource,
  profileRoute,
  dashboardRoute,
  qrRoute,
  publicVenueSource,
  publicVenuePage,
  dancerPage,
  trackingComponent,
  migration,
  liveApp,
] = await Promise.all([
  readFile(new URL("../app/api/auth/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/auth.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/venue.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/profile/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/dashboard/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/qr-code/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/public.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/venues/[slug]/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/VenueQrCode.tsx", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202607260002_venue_accounts_qr_analytics.sql", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
]);

test("venue signup creates an owned venue and routes successful authentication to its dashboard", () => {
  assert.match(authRoute, /role === "venue"\s*\?\s*readRequired\(body\.name, "Venue name is required\."\)/);
  assert.match(authRoute, /if \(password\.length < 8\)/);
  assert.match(authRoute, /await ensureVenueForAccount\(admin, \{/);
  assert.match(authRoute, /userId,\s*name: displayName,\s*city,/);
  assert.match(authRoute, /expectedRole === "venue" && account\?\.role === "venue"/);
  assert.match(authRoute, /const venueName = venueFallback\?\.name \|\| account\.displayName/);
  assert.match(authHelpers, /if \(role === "venue"\) return "\/dashboard\/venue"/);
  assert.match(liveApp, /document\.getElementById\("venueJoinNowBtn"\)\.addEventListener\("click", async/);
  assert.match(liveApp, /document\.getElementById\("venueLoginForm"\)\.addEventListener\("submit", async/);
  assert.match(liveApp, /id="venueLoginCity"/);
  assert.match(liveApp, /city: venueCity/);
  assert.match(liveApp, /startVenueDashboardSession\("Venue dashboard opened"\)/);
  assert.doesNotMatch(liveApp, /venue@example\.com|venue123|demo venue/i);
});

test("venue dashboard APIs require an active venue account and scope writes by owner", () => {
  for (const source of [profileRoute, dashboardRoute, qrRoute]) {
    assert.match(source, /account\.role !== "venue"|account\.role === "venue"|account\.role !== "venue"/);
    assert.match(source, /account\.accountState !== "active"/);
  }
  assert.match(venueSource, /\.eq\("owner_user_id", userId\)/);
  assert.match(venueSource, /\.eq\("id", venue\.id\)\s*\.eq\("owner_user_id", userId\)/);
  assert.match(profileRoute, /updateVenueForAccount\(createAdminSupabaseClient\(\), user\.id/);
  assert.match(dashboardRoute, /getVenueDashboard\(createAdminSupabaseClient\(\), user\.id\)/);
});

test("uploaded venue QR images are validated, safely stored, and published on eligible public pages", () => {
  assert.match(venueSource, /validateAndPrepareDancrImage\(file\)/);
  assert.match(venueSource, /image\.width < 180 \|\| image\.height < 180/);
  assert.match(venueSource, /ratio < 0\.8 \|\| ratio > 1\.25/);
  assert.match(venueSource, /const QR_BUCKET = "venue-qr-codes"/);
  assert.match(venueSource, /qr_code_storage_path: storagePath/);
  assert.match(migration, /insert into storage\.buckets \(id, name, public, file_size_limit, allowed_mime_types\)/);
  assert.match(migration, /image\/jpeg.*image\/png.*image\/webp/s);
  assert.match(publicVenueSource, /qr_code_storage_path/);
  assert.match(publicVenuePage, /<VenueQrCode[\s\S]*?tapToShow/);
  assert.match(liveApp, /function venueOfferMarkup\(venue\)[\s\S]*?publishedVenueQrPass/);
  assert.match(liveApp, /data-feed-venue-qr/);
  assert.match(dancerPage, /activeShift\.venueQrCodeUrl/);
  assert.match(dancerPage, /Boolean\(shift\.checkedInAt\)/);
  assert.match(dancerPage, /!shift\.checkedOutAt/);
  assert.match(dancerPage, /source="dancer_profile"/);
  assert.match(dancerPage, /<VenueQrUnavailable venueName=\{activeShift\.venueName\}/);
  assert.match(trackingComponent, /Club Scan unavailable at this venue\./);
  assert.match(trackingComponent, /if \(tapToShow && !visible\)/);
  assert.match(trackingComponent, /Show venue QR/);
  assert.match(trackingComponent, /className="venue-qr-dialog"/);
  assert.match(trackingComponent, /eventType: "qr_impression"/);
});

test("checked-in dancer profiles show a Club Scan or an explicit unavailable state without exposing it on future shifts", () => {
  assert.match(liveApp, /if \(!profile\?\.venue \|\| !isWorkingTonight\(profile\)\) return ""/);
  assert.match(liveApp, /if \(!profile\.venueId \|\| !profile\.venueQrCodeUrl\)/);
  assert.match(liveApp, /Club Scan unavailable at this venue\./);
  assert.match(liveApp, /<strong>Club Scan<\/strong>/);
  assert.match(liveApp, /id="venueQrPlaceholder"/);
  assert.match(liveApp, /qrPlaceholder\.hidden = Boolean\(profile\.qrCodeUrl\)/);
  assert.match(liveApp, /A venue-uploaded QR appears on your live profile only while this shift is actively checked in/);
});

test("venue analytics are real database counts and the dashboard exposes useful operating metrics", () => {
  assert.match(venueSource, /countByVenue\(client, "venue_follows"/);
  assert.match(venueSource, /countByVenueSince\(client, "direction_requests"/);
  assert.match(venueSource, /countVenueEvents\(client, profile\.id, "page_view"/);
  assert.match(venueSource, /countVenueEvents\(client, profile\.id, "qr_impression"/);
  assert.match(venueSource, /countUpcomingShifts\(client, profile\.id/);
  assert.match(venueSource, /countVenueGoingSignals\(client, profile\.id/);
  assert.match(venueSource, /getWorkingDancers\(client, profile\.id/);
  assert.match(venueSource, /\.not\("checked_in_at", "is", null\)/);
  assert.match(venueSource, /\.in\("location_status", \["location_confirmed", "club_confirmed"\]\)/);
  assert.match(liveApp, /id="venuePageViewCount"/);
  assert.match(liveApp, /id="venueQrImpressions"/);
  assert.match(liveApp, /id="venueDirectionCount"/);
  assert.match(liveApp, /id="venueFollowerCount"/);
  assert.match(liveApp, /id="venueWorkingNowList"/);
  assert.match(liveApp, /getAuthenticatedJson\("\/api\/venue\/dashboard"\)/);
  assert.doesNotMatch(liveApp, /\.example\.com|\\(555\\)/);
});
