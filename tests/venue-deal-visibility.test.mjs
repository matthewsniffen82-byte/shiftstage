import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function module(path, dependencies = {}) {
  const exports = {};
  vm.runInNewContext(compile(read(path)), { exports, console, Date, Map, Set, require: name => dependencies[name] || {} });
  return exports;
}
const visibility = module("src/lib/dancr/venue-public-visibility.ts");
const presence = module("src/lib/dancr/shift-presence.ts");
const publicSource = read("src/lib/dancr/public.ts");
const tvSource = read("src/lib/dancr/tv.ts");
const pausedVenue = { id: "paused", slug: "paused", name: "Paused Club", city: "Phoenix", is_active: true, has_active_club_deal: false };
const liveVenue = { ...pausedVenue, id: "live", slug: "live", name: "Live Club", has_active_club_deal: true };
const scheduledShift = (venue, id) => ({ id, venue_id: venue.id, dancer_id: "dancer", venues: venue, status: "posted", shift_source: "scheduled", starts_at: new Date(Date.now() + 3600000).toISOString(), ends_at: new Date(Date.now() + 7200000).toISOString() });
const liveShift = venue => ({ ...scheduledShift(venue, "check-in"), shift_source: "nfc", checked_in_at: new Date().toISOString(), location_status: "club_confirmed", location_verification_expires_at: new Date(Date.now() + 3600000).toISOString() });

function queryFixture(rows) {
  return { from() {
    let result = rows;
    const query = {
      select: () => query, order: () => query, limit: () => query,
      eq(key, value) { result = result.filter(row => key.split('.').reduce((v,k) => v?.[k],row) === value); return query; },
      in(key, values) { result = result.filter(row => values.includes(row[key])); return query; },
      is(key, value) { result = result.filter(row => (row[key] ?? null) === value); return query; },
      gte(key, value) { result = result.filter(row => row[key] >= value); return query; },
      maybeSingle: async () => ({ data: result[0] || null, error: null }),
      then: resolve => Promise.resolve({ data: result, error: null }).then(resolve),
    }; return query;
  } };
}

test("an approved venue needs a live deal, without changing approval or affiliations", () => {
  assert.equal(visibility.isPublicVenueRow(pausedVenue), false);
  assert.equal(visibility.isPublicVenueRow(liveVenue), true);
  assert.equal(visibility.isPublicVenueRow({ ...liveVenue, is_active: false }), false);
  assert.equal(visibility.isPublicVenueRow(null), false);
  assert.equal(visibility.isPublicVenueRow({ is_active: true }), false);
  assert.equal(visibility.isPublicVenueRow([liveVenue]), true);
});

test("dancer cards keep their identity and city while hiding a deal-less venue and its schedule", () => {
  const ctx = vm.createContext({ ...visibility, ...presence, Date,
    approvedDancerPhotoSources: () => [], approvedSocialLinks: () => [],
    responsivePublicImage: () => null, formatShiftLabel: () => "Scheduled",
  });
  vm.runInContext(compile(publicSource.slice(publicSource.indexOf("function buildDancerCard("), publicSource.indexOf("async function toDancerCards(")) + publicSource.slice(publicSource.indexOf("function isShiftPubliclyVisible("), publicSource.indexOf("async function getCityTimeZone("))), ctx);
  const dancer = { id: "dancer", stage_name: "Bella", slug: "bella", city: "Phoenix", shifts: [liveShift(pausedVenue), scheduledShift(pausedVenue, "upcoming")] };
  const original = JSON.stringify(dancer);
  const hidden = ctx.buildDancerCard({}, dancer).card;
  assert.equal(hidden.id, dancer.id);
  assert.equal(hidden.stageName, "Bella");
  assert.equal(hidden.city, "Phoenix");
  for (const key of ["venueId", "venueName", "venueSlug", "shiftId", "shiftStartsAt", "shiftLabel"]) assert.equal(hidden[key], null, key);
  assert.equal(ctx.buildDancerCard({}, dancer, { checkedInOnly: true }).card.shiftId, null);
  assert.equal(JSON.stringify(dancer), original, "hidden schedules remain intact");
  const elsewhere = ctx.buildDancerCard({}, { ...dancer, shifts: [...dancer.shifts, scheduledShift(liveVenue, "elsewhere")] }).card;
  assert.equal(elsewhere.venueId, "live");
  const restored = ctx.buildDancerCard({}, { ...dancer, shifts: dancer.shifts.map(shift => ({ ...shift, venues: { ...pausedVenue, has_active_club_deal: true } })) }).card;
  assert.equal(restored.venueId, "paused");
  assert.equal(restored.shiftId, "check-in");
});

test("public venue pages and upcoming schedules exclude paused venues and restore with a deal", async () => {
  const service = module("src/lib/dancr/public.ts", {
    "./venue-public-visibility": visibility, "./shift-presence": presence,
    "./responsive-image": { responsivePublicImage: () => null },
    "./venue-branding": { verifiedVenueLogoUrl: () => null },
  });
  assert.equal(await service.getVenueProfile(queryFixture([pausedVenue]), "paused"), null);
  assert.equal((await service.getVenueProfile(queryFixture([liveVenue]), "live")).id, "live");
  const rows = [scheduledShift(pausedVenue, "hidden"), scheduledShift(liveVenue, "shown")];
  assert.deepEqual(Array.from(await service.getUpcomingShiftsForDancer(queryFixture(rows), "dancer"), row => row.venueId), ["live"]);
});

test("TV keeps videos city-only, uses another public venue, and restores venue context automatically", async () => {
  const ctx = vm.createContext({ ...visibility, Date, Map, Set, isConfirmedActiveTvShift: presence.isActiveNfcPresence, one: value => Array.isArray(value) ? value[0] : value });
  vm.runInContext(compile(tvSource.slice(tvSource.indexOf("async function getPublicTvShiftContexts("), tvSource.indexOf("function isConfirmedActiveTvShift("))), ctx);
  const video = { id: "video", dancer: { id: "dancer", stageName: "Bella", city: "Phoenix" }, status: "approved" };
  const hiddenContexts = await ctx.getPublicTvShiftContexts(queryFixture([liveShift(pausedVenue)]), ["dancer"], Date.now());
  const cityOnly = ctx.applyPublicTvShiftContext(video, hiddenContexts);
  assert.equal(cityOnly.id, "video");
  assert.equal(cityOnly.dancer.city, "Phoenix");
  assert.equal(cityOnly.status, "approved");
  assert.equal(cityOnly.venue, null);
  assert.equal(cityOnly.shift, null);
  const otherContexts = await ctx.getPublicTvShiftContexts(queryFixture([liveShift(pausedVenue), scheduledShift(liveVenue, "other")]), ["dancer"], Date.now());
  assert.equal(ctx.applyPublicTvShiftContext(video, otherContexts).venue.id, "live");
  const restoredContexts = await ctx.getPublicTvShiftContexts(queryFixture([liveShift({ ...pausedVenue, has_active_club_deal: true })]), ["dancer"], Date.now());
  assert.equal(ctx.applyPublicTvShiftContext(video, restoredContexts).venue.id, "paused");
});

const ids = { venue: "10000000-0000-4000-8000-000000000001", user: "20000000-0000-4000-8000-000000000001", deal: "30000000-0000-4000-8000-000000000001", request: "40000000-0000-4000-8000-000000000001" };
const requests = module("src/lib/dancr/venue-deal-requests.ts", { "./club-deal-presets": { CLUB_DEAL_OFFER_PRESETS: [{ key: "free_admission", title: "Free admission" }] } });
function requestFixture(deal) {
  const writes = [];
  return { writes, from(table) {
    if (table === "club_deals") return queryFixture(deal ? [deal] : []).from();
    const query = { select: () => query, eq: () => query, in: () => query,
      insert(row) { writes.push(row); return query; },
      single: async () => ({ data: { ...writes.at(-1), id: ids.request, status: "pending" }, error: null }),
      then: resolve => Promise.resolve({ count: 0, error: null }).then(resolve),
    }; return query;
  } };
}
test("removal requests validate the venue's current deal and store its server-owned identity", async () => {
  const input = { venueId: ids.venue, requestedByUserId: ids.user, requestType: "remove", targetDealId: ids.deal, offerKey: "forged-title" };
  const db = requestFixture({ id: ids.deal, venue_id: ids.venue, deal_title: "Free admission", is_active: true });
  const request = await requests.createVenueClubDealRequest(db, input);
  assert.equal(request.requestType, "remove");
  assert.equal(request.targetDealId, ids.deal);
  assert.equal(request.offerTitle, "Free admission");
  assert.equal(db.writes.length, 1);
  const inactive = await requests.createVenueClubDealRequest(requestFixture({ id: ids.deal, venue_id: ids.venue, deal_title: "Free admission", is_active: false }), input);
  assert.equal(inactive.requestType, "remove");
  for (const deal of [null, { id: ids.deal, venue_id: ids.user, is_active: true }, { id: ids.deal, venue_id: ids.venue, removed_at: "2026-09-09" }]) {
    const invalid = requestFixture(deal);
    await assert.rejects(requests.createVenueClubDealRequest(invalid, input), /current Club Deal belonging/);
    assert.equal(invalid.writes.length, 0);
  }
});

test("removal approval uses one atomic database action scoped to request, venue, and admin", async () => {
  const calls = [];
  const db = { rpc: async (name, args) => { calls.push({ name, args }); return { data: { id: ids.request, venue_id: ids.venue, request_type: "remove", target_deal_id: ids.deal, status: "approved" }, error: null }; } };
  const result = await requests.approveVenueClubDealRemoval(db, { requestId: ids.request, venueId: ids.venue, adminUserId: ids.user });
  assert.equal(result.status, "approved");
  assert.equal(calls[0].name, "approve_venue_deal_removal");
  assert.equal(calls[0].args.p_venue_id, ids.venue);
  await assert.rejects(requests.approveVenueClubDealRemoval({ rpc: async () => ({ error: new Error("Already reviewed") }) }, { requestId: ids.request, venueId: ids.venue, adminUserId: ids.user }), /Already reviewed/);
});

test("hidden venues do not send public schedule, roster, or deal alerts", async () => {
  const broadcasts = module("src/lib/dancr/customer-follow-notifications.ts", {
    "./notification-delivery": { deliverNotificationRows: () => assert.fail("Hidden venue must not notify customers") },
  });
  for (const method of ["broadcastFollowedDancerUpcomingShift", "broadcastFollowedDancerWorkingNow", "broadcastFollowedClubDealPublished", "broadcastFollowedClubRosterAddition"]) {
    const client = { from(table) { assert.equal(table, "venues"); return queryFixture([pausedVenue]).from(); } };
    assert.equal(await broadcasts[method](client, { venueId: "paused" }), 0);
  }
});

test("removed deals leave the current catalog while inactive offers remain manageable", async () => {
  const catalog = module("src/lib/dancr/venue-deal-actions.ts", { "./deals": { toClubDeal: row => row } });
  const rows = [{ id: "live", is_active: true }, { id: "inactive", is_active: false }, { id: "removed", is_active: false, removed_at: "2026-09-09" }];
  assert.deepEqual(Array.from(await catalog.getAdminVenueDealCatalog(queryFixture(rows)), row => row.id), ["live", "inactive"]);
  assert.equal(rows.length, 3, "removed deal is retained in storage");
});
