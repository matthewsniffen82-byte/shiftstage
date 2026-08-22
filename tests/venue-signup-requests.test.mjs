import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  migration,
  requestService,
  publicRoute,
  adminRoute,
  adminClient,
  liveApp,
] = await Promise.all([
  readFile(new URL("../supabase/migrations/202608220001_venue_signup_requests.sql", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/venue-signup-requests.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/signup-requests/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/venue-signup-requests/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
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

test("admin approval atomically connects or creates a venue and issues one private code", () => {
  assert.match(migration, /create or replace function public\.review_venue_signup_request/);
  assert.match(migration, /from public\.venue_signup_requests[\s\S]*for update/);
  assert.match(migration, /if p_existing_venue_id is not null/);
  assert.match(migration, /insert into public\.venues/);
  assert.match(migration, /update public\.venue_claim_codes[\s\S]*set revoked_at/);
  assert.match(migration, /insert into public\.venue_claim_codes/);
  assert.match(migration, /insert into public\.admin_actions/);
  assert.match(migration, /grant execute on function public\.review_venue_signup_request[\s\S]*to service_role/);
  assert.match(requestService, /createVenueSignupCredential\(\)/);
  assert.match(requestService, /rpc\("review_venue_signup_request"/);
  assert.match(requestService, /sendTransactionalEmail/);
  assert.match(requestService, /Do not forward this code/);
  assert.match(adminRoute, /requireAdmin\(client, user\.id\)/g);
});

test("the live venue request form submits the verified business contact for review", () => {
  assert.match(liveApp, /id="venueRequestOpenBtn"[^>]*>Request venue access</);
  assert.match(liveApp, /id="venueRequestForm"/);
  assert.match(liveApp, /id="venueRequestAuthorization"[\s\S]*type="checkbox" required/);
  assert.match(liveApp, /fetch\("\/api\/venue\/signup-requests"/);
  assert.match(liveApp, /authorizedToRepresentVenue: document\.getElementById\("venueRequestAuthorization"\)\.checked/);
  assert.match(liveApp, /submit\.textContent = "✓ Request received"/);
  assert.match(liveApp, /function openVenueRequest\(\)/);
  assert.match(liveApp, /url\.searchParams\.get\("venueRequest"\) === "1"/);
});

test("administrators receive a review queue with explicit approval and rejection actions", () => {
  assert.match(adminClient, /path: "\/api\/admin\/venue-signup-requests"/);
  assert.match(adminClient, /function VenueSignupRequestQueue/);
  assert.match(adminClient, /Approve & send access/);
  assert.match(adminClient, /Reject request/);
  assert.match(adminClient, /Copy private access code/);
  assert.match(adminClient, /Email delivery was unavailable/);
  assert.match(adminClient, /existingVenueId: existingVenueId \|\| null/);
});
