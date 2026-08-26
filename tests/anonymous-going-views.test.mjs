import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  goingRoute,
  customerSource,
  migrationSource,
  nextActions,
  dancerPage,
  profileViewTracker,
  eventsRoute,
  venueEventsRoute,
  venueTrackingComponent,
  venueMigration,
  liveApp,
] = await Promise.all([
  readFile(new URL("../app/api/customer/going/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/customer.ts", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202607260003_anonymous_going_signals.sql", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/DancerProfileActions.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/ProfileViewTracker.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/events/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/public/venue-events/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/components/VenueQrCode.tsx", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202607260002_venue_accounts_qr_analytics.sql", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
]);

test("anonymous Going uses a private durable visitor identity and cannot duplicate one shift signal", () => {
  assert.match(migrationSource, /alter column customer_id drop not null/);
  assert.match(migrationSource, /visitor_token_hash text/);
  assert.match(migrationSource, /num_nonnulls\(customer_id, visitor_token_hash\) = 1/);
  assert.match(migrationSource, /unique index if not exists going_signals_visitor_shift_unique/);
  assert.match(customerSource, /markAnonymousGoing/);
  assert.match(customerSource, /error && error\.code !== "23505"/);
  assert.match(goingRoute, /randomBytes\(32\)\.toString\("base64url"\)/);
  assert.match(goingRoute, /createHash\("sha256"\)\.update\(token\)/);
  assert.match(goingRoute, /httpOnly: true/);
  assert.match(goingRoute, /sameSite: "lax"/);
  assert.match(goingRoute, /maxAge: VISITOR_COOKIE_MAX_AGE/);
});

test("Going GET and POST work with or without auth and return the authoritative database count", () => {
  assert.match(goingRoute, /export async function GET\(request: Request\)/);
  assert.match(goingRoute, /export async function POST\(request: Request\)/);
  assert.match(goingRoute, /if \(getBearerToken\(request\)\)/);
  assert.match(goingRoute, /An expired session can still use the public action as an anonymous visitor/);
  assert.match(goingRoute, /requirePublicShift\(admin, shiftId\)/);
  assert.match(goingRoute, /isPublicDancerProfileEligible\(dancer\)/);
  assert.match(goingRoute, /countShiftGoingSignals\(admin, shiftId\)/);
  assert.match(goingRoute, /anonymous: !identity\.customerId/);
});

test("both production dancer profile surfaces keep Going visible and enable it for posted shifts", () => {
  assert.doesNotMatch(nextActions, /requireCustomerAccount\("going"\)/);
  assert.match(nextActions, /shifts\.find\(\(shift\) => shift\.isActive\) \|\| shifts\[0\] \|\| null/);
  assert.match(nextActions, /onClick=\{\(\) => actionShift && updateGoing\(actionShift\.id\)\}/);
  assert.match(nextActions, /profile-action-going[\s\S]*?profile-action-unavailable/);
  assert.doesNotMatch(nextActions, /<small className="profile-action-requirement">No shift posted<\/small>/);
  assert.match(nextActions, /fetch\(`\/api\/customer\/going\?shiftId=/);
  assert.match(nextActions, /credentials: "same-origin"/);
  assert.match(nextActions, /export function DancerGoingCount/);
  assert.match(dancerPage, /initialGoingCount=\{profile\.goingCount\}/);
  assert.match(dancerPage, /<DancerGoingCount \/>/);
  assert.match(
    liveApp,
    /\(actionButton\.id === "followBtn" \|\| actionButton\.id === "notifyBtn"\) &&\s+!requireCustomerAccountForProfileAction\(actionButton\)/,
  );
  assert.match(liveApp, /const canMarkGoing = Boolean\(profile\?\.scheduled && profile\.shiftId\)/);
  assert.match(liveApp, /data-shift-state="unavailable"[\s\S]*?profileActionButtonMarkup\("clock", goingCopy\.idle\)/);
  assert.match(liveApp, /await postOptionalAuthJson\("\/api\/customer\/going"/);
});

test("dancer profile views count signed-in and signed-out visitors", () => {
  assert.match(profileViewTracker, /recordEvent\(\{ type: "profile_view", dancerId/);
  assert.doesNotMatch(profileViewTracker, /authorization|accessToken|Sign in required/);
  assert.match(eventsRoute, /viewer_id: viewerId/);
  assert.match(eventsRoute, /session_id: sessionId/);
  assert.match(liveApp, /recordLiveEvent\("profile_view", \{ dancerName: profileName/);
});

test("venue profile views count signed-in and signed-out visitors once per session and day", () => {
  assert.match(venueMigration, /viewer_id uuid references public\.app_users\(id\) on delete set null/);
  assert.match(
    venueMigration,
    /unique \(venue_id, event_type, source, session_id, occurred_on\)/,
  );
  assert.doesNotMatch(venueEventsRoute, /authorization|accessToken|Sign in required/);
  assert.match(venueTrackingComponent, /export function VenuePageView/);
  assert.match(venueTrackingComponent, /eventType: "page_view"/);
  assert.match(
    liveApp,
    /recordVenuePageEvent\(\{ venueId: venue\.id, eventType: "page_view", source: "venue_page" \}\)/,
  );
});
