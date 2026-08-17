import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildPilotAnalytics, validatePilotDateRange } from "../src/lib/dancr/pilot-analytics.ts";

const [route, client, migration] = await Promise.all([
  readFile(new URL("../app/api/admin/pilot-analytics/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/AdminPilotAnalytics.tsx", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608160003_venue_pilot_night_reports.sql", import.meta.url), "utf8"),
]);

test("pilot API requires an authenticated administrator and production records", () => {
  assert.match(route, /createRequestSupabaseContext\(request\)/);
  assert.match(route, /await requireAdmin\(client, user\.id\)/);
  assert.match(route, /getAdminPilotAnalytics\(createAdminSupabaseClient\(\)/);
  assert.match(route, /upsertAdminPilotNightReport\(createAdminSupabaseClient\(\), user\.id/);
});

test("pilot night totals are admin-only, constrained, and auditable", () => {
  assert.match(migration, /create table if not exists public\.venue_pilot_night_reports/);
  assert.match(migration, /unique \(venue_id, service_date\)/);
  assert.match(migration, /total_door_count integer not null check/);
  assert.match(migration, /pilot_cost_cents integer not null default 0 check/);
  assert.match(migration, /using \(public\.is_admin\(\)\)/);
  assert.match(migration, /reported_by_user_id uuid references public\.app_users/);
  assert.match(migration, /function public\.upsert_venue_pilot_night_report/);
  assert.match(migration, /insert into public\.admin_actions/);
  assert.match(migration, /grant execute on function public\.upsert_venue_pilot_night_report[^\n]+to service_role/);
});

test("pilot dashboard explains and exports proof-of-arrival metrics", () => {
  for (const copy of [
    "Verified arrivals",
    "Attributable door share",
    "Selection → arrival",
    "Cost per verified arrival",
    "Discovery to the door",
    "Record a service night",
    "Download CSV",
  ]) assert.match(client, new RegExp(copy));
  assert.match(client, /successful cashier NFC taps/);
  assert.match(client, /suspicious and voided redemptions do not count/i);
  assert.doesNotMatch(client, /mock|fake|sample data/i);
});

test("pilot calculator deduplicates same-night taps and aligns nightlife dates", () => {
  const venue = { id: "venue-1", name: "Pilot Club", city: "Omaha", state: "NE", timezone: "America/Chicago" };
  const range = validatePilotDateRange("2026-08-01", "2026-08-02");
  const analytics = buildPilotAnalytics({
    venue,
    range,
    checkedAt: "2026-08-03T12:00:00.000Z",
    rows: {
      redemptions: [
        {
          id: "r1", customer_id: "customer-1", source_type: "dancer_profile", status: "redeemed",
          generated_at: "2026-08-02T02:00:00.000Z", redeemed_at: "2026-08-02T02:30:00.000Z", nfc_tag_id: "tag-1",
          saved_at: "2026-08-02T02:05:00.000Z", club_deals: { deal_title: "Admission" },
        },
        {
          id: "r2", customer_id: "customer-1", source_type: "club_page", status: "redeemed",
          generated_at: "2026-08-02T06:00:00.000Z", redeemed_at: "2026-08-02T07:00:00.000Z", nfc_tag_id: "tag-1",
          club_deals: { deal_title: "Drink" },
        },
        {
          id: "r3", customer_id: "customer-1", source_type: "club_page", status: "redeemed",
          generated_at: "2026-08-03T03:00:00.000Z", redeemed_at: "2026-08-03T03:20:00.000Z", nfc_tag_id: "tag-1",
          club_deals: { deal_title: "Drink" },
        },
        {
          id: "r4", session_id: "anonymous-2", source_type: "club_page", status: "redeemed",
          generated_at: "2026-08-03T03:10:00.000Z", redeemed_at: "2026-08-03T03:25:00.000Z", nfc_tag_id: "tag-1",
          club_deals: { deal_title: "Drink" },
        },
        {
          id: "test", session_id: "staff-test", source_type: "club_page", status: "redeemed", suspicious: true,
          generated_at: "2026-08-03T03:10:00.000Z", redeemed_at: "2026-08-03T03:25:00.000Z", nfc_tag_id: "tag-1",
        },
      ],
      venueViews: [
        { id: "v1", session_id: "visitor-1", occurred_at: "2026-08-02T01:00:00.000Z" },
        { id: "v2", session_id: "visitor-1", occurred_at: "2026-08-02T01:30:00.000Z" },
        { id: "v3", session_id: "visitor-2", occurred_at: "2026-08-03T02:00:00.000Z" },
      ],
      directions: [{ id: "d1", session_id: "visitor-1", requested_at: "2026-08-02T01:45:00.000Z" }],
      reports: [
        { id: "p1", service_date: "2026-08-01", total_door_count: 100, pilot_cost_cents: 5000, updated_at: "2026-08-02T10:00:00.000Z" },
        { id: "p2", service_date: "2026-08-02", total_door_count: 200, pilot_cost_cents: 10000, updated_at: "2026-08-03T10:00:00.000Z" },
      ],
    },
  });

  assert.equal(analytics.totals.verifiedArrivals, 3);
  assert.equal(analytics.totals.uniqueArrivingCustomers, 2);
  assert.equal(analytics.totals.dealSelections, 3);
  assert.equal(analytics.totals.venueVisitors, 2);
  assert.equal(analytics.totals.directionRequests, 1);
  assert.equal(analytics.totals.dealSaves, 1);
  assert.equal(analytics.rates.arrivalConversionPercent, 100);
  assert.equal(analytics.rates.attributableDoorSharePercent, 1);
  assert.equal(analytics.rates.costPerVerifiedArrivalCents, 5000);
  assert.equal(analytics.rates.repeatArrivalPercent, 50);
  assert.equal(analytics.daily[0].verifiedArrivals, 1);
  assert.equal(analytics.daily[1].verifiedArrivals, 2);
  assert.equal(analytics.sourceBreakdown[0].source, "club_page");
});

test("pilot date windows reject inverted and oversized reports", () => {
  assert.throws(() => validatePilotDateRange("2026-08-03", "2026-08-02"), /on or after/);
  assert.throws(() => validatePilotDateRange("2026-02-30", "2026-03-01"), /on or after/);
  assert.throws(() => validatePilotDateRange("2026-01-01", "2026-12-31"), /180 days/);
});
