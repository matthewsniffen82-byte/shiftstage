import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [migration, freeAdmissionMigration, service, venueRoute, adminRoute, dashboardRoute, dashboard, adminClient, access, profileRoute] = await Promise.all([
  readFile(new URL("../supabase/migrations/202608230001_venue_club_deal_requests.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608240004_free_admission_club_deals.sql", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/venue-deal-requests.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/deal-requests/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/deals/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/dashboard/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/venue-access.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/profile/route.ts", import.meta.url), "utf8"),
]);

test("venue Club Deal requests are durable, venue-scoped, audited records", () => {
  assert.match(migration, /create table if not exists public\.venue_club_deal_requests/);
  assert.match(migration, /offer_key in \('half_off_admission', 'skip_the_line'\)/);
  assert.match(freeAdmissionMigration, /offer_key in \('half_off_admission', 'skip_the_line', 'free_admission'\)/);
  assert.match(freeAdmissionMigration, /offer_title in \('Half-off admission', 'Skip the line', 'Free admission'\)/);
  assert.match(migration, /status in \('pending', 'under_review', 'approved', 'rejected', 'withdrawn'\)/);
  assert.match(migration, /Venue teams read own Club Deal requests/);
  assert.match(migration, /Admins manage venue Club Deal requests/);
  assert.match(venueRoute, /requireVenueAccess\(admin, auth\.user\.id, "request_deals"\)/);
  assert.match(venueRoute, /recordVenueActivity/);
  assert.match(venueRoute, /deal\.requested/);
  assert.match(service, /MyDancr is already reviewing five Club Deal requests/);
});

test("venue owners and managers can request but cannot publish contract deals", () => {
  assert.match(access, /owner: \[[\s\S]*?"request_deals"/);
  assert.match(access, /manager: \[[\s\S]*?"request_deals"/);
  const staffPermissions = access.match(/staff: \[([\s\S]*?)\],/)?.[1] || "";
  assert.doesNotMatch(staffPermissions, /request_deals|manage_deals/);
  const venueLedger = dashboard.match(/function VenueDealReadOnlyPanel[\s\S]*?(?=function readOptionalNumber)/)?.[0] || "";
  assert.match(venueLedger, /Request a new deal/);
  assert.match(venueLedger, /\/api\/venue\/deal-requests/);
  assert.match(venueLedger, /Send request to MyDancr/);
  assert.match(venueLedger, /data\.dealRequest\?\.id/);
  assert.match(venueLedger, /confirmedRequests\.some/);
  assert.match(venueLedger, /Request sent successfully/);
  assert.match(venueLedger, /It is saved and pending review/);
  assert.match(venueLedger, /venue-deal-request-feedback is-\$\{requestStatusTone\}/);
  assert.match(venueLedger, /requestStatusTone === "error" \? "alert" : "status"/);
  assert.match(venueLedger, /Club Deal request history/);
  assert.match(venueLedger, /Only venue owners and managers can request a new deal/);
  assert.doesNotMatch(venueLedger, /Publish contract deal/);
  assert.match(dashboardRoute, /getVenueClubDealRequests/);
});

test("MyDancr admins receive, review, link, and publish requested deals", () => {
  assert.match(adminRoute, /getAdminVenueClubDealRequests/);
  assert.match(adminRoute, /reviewVenueClubDealRequest/);
  assert.match(adminRoute, /upsert_contract_deal/);
  assert.match(adminRoute, /status: result\.deal\.isActive \? "approved" : "under_review"/);
  const manager = adminClient.match(/function AdminClubDealManager[\s\S]*?(?=function ReferralFeeManager)/)?.[0] || "";
  assert.match(manager, /Venue deal requests/);
  assert.match(manager, /Prepare deal/);
  assert.match(manager, /review_deal_request/);
  assert.match(manager, /Publishing it will approve the request automatically/);
  assert.match(manager, /Publish contract deal/);
});

test("venue owner permissions survive partial dashboard loads without exposing page controls", () => {
  assert.match(profileRoute, /venueAccess/);
  assert.match(dashboard, /secondary\.venueAccess \|\| profile\.venueAccess/);
  assert.match(dashboard, /venueRole === "owner" \|\| venueRole === "manager"/);
  assert.doesNotMatch(dashboard, /venue-readonly-fields|type=\{key === "opensAt"/);
});
