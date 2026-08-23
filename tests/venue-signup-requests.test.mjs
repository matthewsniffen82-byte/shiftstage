import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  migration,
  onboardingMigration,
  requestService,
  publicRoute,
  adminRoute,
  adminClient,
  liveApp,
  clubJoinPage,
] = await Promise.all([
  readFile(new URL("../supabase/migrations/202608220001_venue_signup_requests.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608220002_venue_self_publish_onboarding.sql", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/venue-signup-requests.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/signup-requests/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/venue-signup-requests/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/clubs/join/page.tsx", import.meta.url), "utf8"),
]);

test("public venue signup requests are private, validated, deduplicated, and rate limited", () => {
  assert.match(migration, /create table if not exists public\.venue_signup_requests/);
  assert.match(migration, /venue_signup_requests_pending_duplicate_idx/);
  assert.match(migration, /alter table public\.venue_signup_requests enable row level security/);
  assert.match(migration, /revoke all on table public\.venue_signup_requests from anon, authenticated/);
  assert.match(requestService, /MAX_REQUESTS_PER_IP_PER_DAY = 3/);
  assert.match(requestService, /authorizedToRepresentVenue !== true/);
  assert.match(requestService, /hashVenueClaimRequestIp\(requestIp\)/);
  assert.match(requestService, /This venue request is already waiting for review/);
  assert.match(publicRoute, /body\?\.companyFax/);
  assert.match(publicRoute, /createAdminSupabaseClient\(\)/);
  assert.match(publicRoute, /status: 201/);
  assert.doesNotMatch(publicRoute, /contactEmail|contactPhone/);
});

test("admin approval always creates a private venue workspace and issues one request-bound code", () => {
  assert.match(onboardingMigration, /create or replace function public\.review_venue_signup_request/);
  assert.match(onboardingMigration, /from public\.venue_signup_requests[\s\S]*for update/);
  assert.match(onboardingMigration, /if p_existing_venue_id is not null then[\s\S]*Existing venue claims are not supported/);
  assert.match(onboardingMigration, /insert into public\.venues/);
  assert.match(onboardingMigration, /is_active[\s\S]*false/);
  assert.match(onboardingMigration, /published_at[\s\S]*null/);
  assert.match(onboardingMigration, /insert into public\.venue_claim_codes/);
  assert.match(onboardingMigration, /insert into public\.admin_actions/);
  assert.match(onboardingMigration, /grant execute on function public\.review_venue_signup_request[\s\S]*to service_role/);
  assert.match(requestService, /createVenueSignupCredential\(\)/);
  assert.match(requestService, /rpc\("review_venue_signup_request"/);
  assert.match(requestService, /p_existing_venue_id: null/);
  assert.match(requestService, /sendTransactionalEmail/);
  assert.match(requestService, /Do not forward this code/);
  assert.match(adminRoute, /requireAdmin\(client, user\.id\)/g);
});

test("the live venue request form submits the verified business contact for review", () => {
  assert.match(liveApp, /id="venueRequestOpenBtn"[^>]*>Request to list your club</);
  assert.match(liveApp, /id="venueRequestForm"/);
  assert.match(liveApp, /id="venueRequestAuthorization"[\s\S]*type="checkbox" required/);
  assert.match(liveApp, /fetch\("\/api\/venue\/signup-requests"/);
  assert.match(liveApp, /authorizedToRepresentVenue: document\.getElementById\("venueRequestAuthorization"\)\.checked/);
  assert.match(liveApp, /submit\.textContent = "✓ Request received"/);
  assert.match(liveApp, /function openVenueRequest\(\)/);
  assert.match(liveApp, /url\.searchParams\.get\("venueRequest"\) === "1"/);
});

test("club owners can find a direct request-first entry point throughout discovery", () => {
  assert.match(clubJoinPage, /searchParams: Promise<\{ agent\?: string \| string\[\] \}>/);
  assert.match(clubJoinPage, /`\/\?venueRequest=1&agent=\$\{encodeURIComponent\(referral\.slice\(0, 128\)\)\}`/);
  assert.match(clubJoinPage, /"\/\?venueRequest=1"/);
  assert.match(liveApp, /class="utility-menu-item utility-menu-club-join" href="\/clubs\/join">List Your Club</);
  assert.match(liveApp, /id="clubListDirectoryCta" href="\/clubs\/join" hidden>List Your Club</);
  assert.match(liveApp, /Own or manage a club\?/);
  assert.match(liveApp, /href="\/clubs\/join">List it on MyDancr</);
  assert.match(liveApp, /<strong>Request to list your club<\/strong>/);
  assert.match(liveApp, /After approval, MyDancr sends a private code so you can build and publish your club page/);
  assert.match(liveApp, /id="venueRequestBackBtn"[^>]*>Already approved\? Enter your access code</);
  assert.match(liveApp, /id="venueSignupBtn"[\s\S]*?<strong>Club<\/strong>/);
  assert.match(liveApp, /getElementById\("venueSignupBtn"\)\.addEventListener\("click", openVenueRequest\)/);
  assert.match(liveApp, /clubListDirectoryCta\.hidden = activeTab !== "venues" \|\| venueProfileOpen/);
});

test("administrators receive a review queue with explicit approval and rejection actions", () => {
  assert.match(adminClient, /path: "\/api\/admin\/venue-signup-requests"/);
  assert.match(adminClient, /function VenueSignupRequestQueue/);
  assert.match(adminClient, /Approve & send access/);
  assert.match(adminClient, /Reject request/);
  assert.match(adminClient, /Copy private access code/);
  assert.match(adminClient, /Email delivery was unavailable/);
  assert.match(adminClient, /Approval creates a private venue workspace/i);
  assert.doesNotMatch(adminClient, /existingVenueId/);
});
