import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [shiftRoute, dashboard, liveApp, migration] = await Promise.all([
  readFile(new URL("../app/api/dancer/shifts/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608090002_require_shift_venue_affiliation.sql", import.meta.url), "utf8"),
]);

test("the dancer shift API exposes only active manager-approved venues", () => {
  assert.match(shiftRoute, /from\("venue_dancer_affiliations"\)/);
  assert.match(shiftRoute, /\.eq\("dancer_id", dancerId\)[\s\S]*?\.eq\("status", "active"\)[\s\S]*?\.is\("revoked_at", null\)/);
  assert.match(shiftRoute, /\.eq\("venues\.is_active", true\)/);
  assert.match(shiftRoute, /noStoreJson\(\{ ok: true, shifts: data \|\| \[\], venues \}\)/);
});

test("posting and moving a shift require that exact dancer-venue affiliation", () => {
  assert.equal((shiftRoute.match(/getAffiliatedVenueForShift\(createAdminSupabaseClient\(\) as any, dancer\.id, body\.venueId\)/g) || []).length, 2);
  assert.match(shiftRoute, /This venue must approve your affiliation before you can post a shift there\./);
  assert.match(shiftRoute, /This venue must approve your affiliation before you can move a shift there\./);
  assert.doesNotMatch(shiftRoute, /getVenueForShift/);
});

test("both dancer dashboards restrict the venue selector to approved affiliations", () => {
  const reactShiftPanel = dashboard.match(/function DancerShiftPanel\(\)[\s\S]*?function checkInErrorMessage/)?.[0] || "";
  assert.match(reactShiftPanel, /const approvedVenues = Array\.isArray\(data\.venues\) \? data\.venues : \[\]/);
  assert.doesNotMatch(reactShiftPanel, /api\/public\/venues/);
  assert.match(reactShiftPanel, /No approved venue affiliations/);
  assert.match(reactShiftPanel, /A venue manager must approve your affiliation before you can post a shift there\./);

  assert.match(liveApp, /function approvedDancerShiftVenues\(\)[\s\S]*?affiliation\?\.status !== "active"[\s\S]*?affiliation\?\.revokedAt/);
  assert.match(liveApp, /approvedVenues\.map\(\(venue\) => `<option value="\$\{escapeHtml\(venue\.id\)\}"/);
  assert.match(liveApp, /const approvedVenue = approvedDancerShiftVenues\(\)\.find\(\(venue\) => venue\.id === venueId\)/);
  assert.match(liveApp, /renderDancerVenueVerification\(\)[\s\S]*?renderShiftPostForm\(\)/);
});

test("Postgres rejects posted shifts without an active approved affiliation", () => {
  assert.match(migration, /create or replace function public\.enforce_active_affiliation_for_posted_shift/);
  assert.match(migration, /affiliation\.dancer_id = new\.dancer_id/);
  assert.match(migration, /affiliation\.venue_id = new\.venue_id/);
  assert.match(migration, /affiliation\.status = 'active'/);
  assert.match(migration, /affiliation\.revoked_at is null/);
  assert.match(migration, /venue\.is_active = true/);
  assert.match(migration, /before insert or update on public\.shifts/);
});
