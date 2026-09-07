import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { isPublicDancerProfileEligible } from "../src/lib/dancr/profile-approval.ts";

const source = readFileSync(new URL("../src/lib/dancr/customer.ts", import.meta.url), "utf8");
const home = readFileSync(new URL("../outputs/index.html", import.meta.url), "utf8");
const publicDancer = id => ({ id, slug: id, stage_name: id, city: "Las Vegas", status: "approved", verification_status: "approved", is_public: true, disabled_at: null, venue_approved_at: null, dancer_photos: [] });
function savedFixture() {
  const queries = [];
  const rows = [publicDancer("one"), publicDancer("two"), publicDancer("three"),
    { ...publicDancer("private"), is_public: false },
    { ...publicDancer("disabled"), disabled_at: "2026-09-01" },
    { ...publicDancer("pending"), status: "pending_review", verification_status: "pending" },
  ];
  function client(kind) {
    return { from(table) {
      const queryLog = { kind, table, filters: [], fields: "" };
      queries.push(queryLog);
      const query = {
        select(fields) { queryLog.fields = fields; return query; },
        eq(key, value) { queryLog.filters.push([key, value]); return query; },
        is(key, value) { queryLog.filters.push([key, value]); return query; },
        in(key, value) { queryLog.ids = value; return query; },
        gt() { return query; }, order() { return query; },
        then(resolve) {
          let data = [];
          if (kind === "customer") {
            if (table !== "shifts") assert.ok(queryLog.filters.some(([key, value]) => key === "customer_id" && value === "signed-in-customer"));
            if (table === "follows") data = rows.map((dancer, index) => ({
              dancer_id: dancer.id, notifications_enabled: true,
              // Reproduce production: customer RLS omits otherwise approved
              // profiles without the old venue-approval prerequisite.
              dancer_profiles: index === 0 ? dancer : null,
            }));
          } else {
            assert.equal(table, "dancer_profiles", "The public reader must never query another customer's private follows");
            data = rows.filter(row => queryLog.ids.includes(row.id) && queryLog.filters.every(([key, value]) => row[key] === value));
          }
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      };
      return query;
    } };
  }
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, console,
    require: name => ({
      "./public": { isApprovedPublicDancerRow: isPublicDancerProfileEligible },
      "./responsive-image": { responsivePublicImage: () => null },
      "./customer-venue-activity": { getSavedVenueActivity: async () => new Map() },
    })[name] || {},
  });
  return { customer: client("customer"), publicReader: client("public"), queries, ...exports };
}

test("saved follows survive an omitted embedded profile and use the approved discovery projection", async () => {
  const f = savedFixture();
  const saved = await f.getCustomerSavedItems(f.customer, "signed-in-customer", f.publicReader);
  assert.equal(saved.follows.length, 6, "A missing profile must not erase its saved follow");
  assert.deepEqual(Array.from(saved.follows.slice(0, 3), follow => follow.dancer.stageName), ["one", "two", "three"]);
  assert.ok(saved.follows.slice(3).every(follow => follow.dancer === null), "Private, disabled and unapproved profile details stay hidden");
  const publicQuery = f.queries.find(query => query.kind === "public");
  for (const [key, value] of [["status", "approved"], ["verification_status", "approved"], ["is_public", true], ["disabled_at", null]]) {
    assert.ok(publicQuery.filters.some(filter => filter[0] === key && filter[1] === value));
  }
  assert.ok(!publicQuery.fields.includes("real_name"));
  assert.ok(!publicQuery.filters.some(([key]) => key === "venue_approved_at"), "Approved discovery profiles do not require a club check-in to stay followed");
});

function extract(start, end) {
  const first = home.indexOf(start), last = home.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first);
  return home.slice(first, last);
}
function homeFixture() {
  const city = "Las Vegas";
  const context = vm.createContext({
    followedDancerIds: new Set(), followedByCity: { [city]: [] },
    markets: { [city]: { dancers: [], venues: [] } },
    clearLiveProfileActionCollections() { context.followedDancerIds.clear(); context.followedByCity[city] = []; },
    enableProfileNotifications() {}, disableProfileNotifications() {}, syncOpenProfileFollowButton() {},
    goingTonightSavedByProfile: {}, goingTonightByProfile: {},
    mergeAuthenticatedDancerIntoDiscovery: (_city, dancers) => dancers,
    mapLiveDancer: row => ({ ...row, name: row.stageName }),
    mapLiveVenue: row => row, venuePreviewRequested: () => false,
    dedupePublicVenues: rows => rows, isApprovedPublicProfile: () => true,
    followedVenuesByCity: {},
  });
  vm.runInContext([
    extract("    function findProfileBySavedDancer(", "    function applyLiveCustomerSaved("),
    extract("    function isFollowingProfile(", "    function isFavoritedProfile("),
    extract("    function applyLiveMarket(", "    const LIVE_JSON_REQUEST_TIMEOUT_MS"),
  ].join("\n"), context);
  return { context, city };
}

for (const savedFirst of [true, false]) test("follow restoration works when " + (savedFirst ? "saved IDs" : "discovery") + " arrive first", () => {
  const { context, city } = homeFixture();
  const dancers = [{ id: "one", stageName: "One" }, { id: "two", stageName: "Two" }];
  const saved = { follows: dancers.map(row => ({ dancerId: row.id, dancer: null, notificationsEnabled: true })) };
  if (savedFirst) context.applyLiveProfileActions(saved);
  context.applyLiveMarket(city, dancers, [], []);
  if (!savedFirst) context.applyLiveProfileActions(saved);
  assert.equal(context.isFollowingProfile(city, "One"), true);
  assert.equal(context.isFollowingProfile(city, "Two"), true);
  assert.deepEqual(Array.from(context.followedByCity[city]), ["One", "Two"]);
  context.applyLiveMarket(city, [{ id: "one", stageName: "New Name" }, dancers[1]], [], []);
  assert.equal(context.isFollowingProfile(city, "New Name"), true);
  context.setProfileFollowed(city, "Two", false);
  context.applyLiveMarket(city, [{ id: "one", stageName: "New Name" }, dancers[1]], [], []);
  assert.equal(context.isFollowingProfile(city, "Two"), false);
  assert.equal(context.isFollowingProfile(city, "New Name"), true);
});

test("saved IDs cannot follow a different dancer with the same display name", () => {
  const { context, city } = homeFixture();
  context.applyLiveMarket(city, [{ id: "different", stageName: "Same Name" }], [], []);
  context.applyLiveProfileActions({ follows: [{ dancerId: "original", dancer: { id: "original", stageName: "Same Name", city } }] });
  assert.equal(context.isFollowingProfile(city, "Same Name"), false);
});
