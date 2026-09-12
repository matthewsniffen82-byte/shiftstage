import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { isPublicDancerProfileEligible } from "../src/lib/dancr/profile-approval.ts";
import { isActiveNfcPresence } from "../src/lib/dancr/shift-presence.ts";
import { isPublicVenueRow } from "../src/lib/dancr/venue-public-visibility.ts";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const copy = value => JSON.parse(JSON.stringify(value));
const venue = { id: "venue", slug: "venue", name: "Published venue", city: "Vegas", is_active: true, has_active_club_deal: true };
const approved = extra => ({ id: "dancer", slug: "dancer", stage_name: "Published dancer", city: "Vegas", status: "approved", verification_status: "approved", is_public: true, disabled_at: null, dancer_photos: [], social_links: [], shifts: [], ...extra });
const noVisibility = () => { const row = approved(); delete row.is_public; return row; };
const invalidProfiles = [
  ["missing visibility", noVisibility()],
  ...[null, false, 0, 1, "true", "false", [], {}].map((value, index) => [`invalid visibility ${index}`, approved({ is_public: value })]),
  ...[undefined, null, "draft", "pending_review", "rejected", "disabled", "verified"].map((value, index) => [`unpublished status ${index}`, approved({ status: value })]),
  ...[undefined, null, "pending", "rejected", ""].map((value, index) => [`unverified profile ${index}`, approved({ verification_status: value })]),
  ["disabled marker", approved({ disabled_at: "2026-09-01" })],
  ["camel disabled marker", approved({ disabledAt: "2026-09-01" })],
  ["contradictory false alias", approved({ isPublic: false })],
  ["contradictory null alias", approved({ isPublic: null })],
];
for (const [name, row] of invalidProfiles) test(`public eligibility rejects ${name}`, () => assert.equal(isPublicDancerProfileEligible(row), false));
for (const [name, row] of [
  ["database publication", approved()],
  ["camel publication", { ...noVisibility(), isPublic: true }],
  ["matching aliases", approved({ isPublic: true })],
]) test(`public eligibility preserves explicit ${name}`, () => assert.equal(isPublicDancerProfileEligible(row), true));

function load(path, dependencies, extra = "", sourceOverride) {
  const exports = {};
  const source = sourceOverride || read(path) + extra;
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(compiled, { exports, Date, Map, Set, URL, console: { log() {}, warn() {} }, require(name) {
    assert.ok(name in dependencies, `Unexpected fixture dependency: ${name}`);
    return dependencies[name];
  } });
  return exports;
}
const publicService = load("src/lib/dancr/public.ts", {
  "./venue-public-visibility": { isPublicVenueRow },
  "./profile-link-alias": { resolveDancerProfileAlias: async () => null },
  "./markets": { isAllMyDancrCities: city => city === "All cities" },
  "./profile-approval": { isPublicDancerProfileEligible },
  "./responsive-image": { responsivePublicImage: () => null },
  "./social-profile-url": { safeSocialProfileUrl: () => null, socialProfileHandle: () => "" },
  "./venue-branding": { verifiedVenueLogoUrl: () => null },
  "./shift-presence": { isActiveNfcPresence },
}, "\nexport { getApprovedDancerRowsByCity, isShiftPubliclyVisible };\n");
const customerService = load("src/lib/dancr/customer.ts", {
  "./venue-public-visibility": { isPublicVenueRow },
  "./public": publicService,
  "./responsive-image": { responsivePublicImage: () => null },
  "./shift-presence": { isActiveNfcPresence },
  "./venue-branding": { verifiedVenueLogoUrl: () => null },
  "./customer-venue-activity": { getSavedVenueActivity: async () => new Map() },
}, "\nexport { getFollowedDancers, getFavoriteDancers, getGoingShifts, getSavedDancerImages, getSavedDancerSchedules };\n");

function clientFixture(resolveQuery = () => ({ data: [], error: null })) {
  const queries = [];
  const client = { queries, rpc: async () => ({ data: [], error: null }), from(table) {
    const log = { table, methods: [] }; queries.push(log);
    const query = new Proxy({}, { get(_target, method) {
      if (method === "then") return (resolve, reject) => Promise.resolve(resolveQuery(log, queries)).then(resolve, reject);
      return (...args) => { log.methods.push([method, ...args]); return query; };
    } });
    return query;
  } };
  return client;
}
const publicReaders = [
  ["directory", client => publicService.getApprovedDancersByCity(client, "Vegas")],
  ["live discovery", client => publicService.getLiveDancerDiscovery(client, "Vegas")],
  ["tonight", client => publicService.getTonightShifts(client, "Vegas")],
  ["profile", client => publicService.getDancerProfile(client, "dancer")],
];
const savedReaders = [
  ["follows", client => customerService.getFollowedDancers(client, "customer")],
  ["favorites", client => customerService.getFavoriteDancers(client, "customer")],
  ["going_signals", client => customerService.getGoingShifts(client, "customer")],
  ["dancer_profiles", client => customerService.getSavedDancerImages(client, ["dancer"])],
];
for (const code of ["42703", "PGRST204"]) {
  for (const [name, readRows] of [...publicReaders, ...savedReaders]) test(`${name} stops on missing visibility schema ${code} without a weaker retry`, async () => {
    const error = { code, message: "is_public column missing" };
    const client = clientFixture((_log, queries) => queries.length === 1 ? { data: null, error } : { data: [], error: null });
    await assert.rejects(readRows(client), value => value === error);
    assert.equal(client.queries.length, 1);
  });
}
test("directory response excludes incomplete publication rows even if its dependency returns them", async () => {
  const client = clientFixture(() => ({ data: [approved(), ...invalidProfiles.map(([, row]) => row)], error: null }));
  const rows = await publicService.getApprovedDancersByCity(client, "Vegas");
  assert.deepEqual(Array.from(rows, row => row.id), ["dancer"]);
  for (const [key, value] of [["status", "approved"], ["verification_status", "approved"], ["is_public", true]]) assert.ok(client.queries[0].methods.some(([method, field, expected]) => method === "eq" && key === field && value === expected));
});
for (const [name, row] of invalidProfiles) test(`profile lookup rejects ${name} before media or metrics reads`, async () => {
  const client = clientFixture(log => ({ data: log.table === "dancer_profiles" ? row : [], error: null, count: 0 }));
  assert.equal(await publicService.getDancerProfile(client, "dancer"), null);
  assert.equal(client.queries.length, 1);
});

const tvSource = read("src/lib/dancr/tv.ts");
const tvAst = ts.createSourceFile("tv.ts", tvSource, ts.ScriptTarget.Latest, true);
const tvFunction = tvAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "normalizeFeedRow");
assert.ok(tvFunction);
// Compile the actual normalizer with its production visibility guard. Other
// helpers below only prepare synthetic artwork/count fields.
const tvContext = { exports: {}, isPublicDancerProfileEligible, one: value => Array.isArray(value) ? value[0] : value, safePublicCount: Number, normalizedVideoPosterStoragePath: () => null };
vm.runInNewContext(ts.transpileModule(tvFunction.getText(tvAst) + "\nexport { normalizeFeedRow };", { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, tvContext);
for (const [name, row] of invalidProfiles) test(`TV normalization excludes ${name} before signing media`, () => assert.equal(tvContext.exports.normalizeFeedRow({ dancer_profiles: row }, Date.now()), null));
test("TV keeps a currently published profile", () => assert.equal(tvContext.exports.normalizeFeedRow({ id: "video", dancer_profiles: approved() }, Date.now()).id, "video"));

test("hidden and unpublished follows remain saved without exposing their profile", async () => {
  const profiles = [approved(), ...invalidProfiles.map(([, row], index) => ({ ...row, id: "private-" + index }))];
  const client = clientFixture(() => ({ data: profiles.map(row => ({ dancer_id: row.id, notifications_enabled: true, dancer_profiles: row })), error: null }));
  const rows = await customerService.getFollowedDancers(client, "customer");
  assert.equal(rows.length, profiles.length);assert.equal(rows[0].dancer.id, "dancer");
  assert.ok(rows.slice(1).every(row => row.dancer === null));
  assert.ok(rows.every(row => row.notificationsEnabled === true));
});
for (const [name, readRows] of savedReaders.slice(0, 3)) test(`${name} reads the disabled marker before exposing an embedded profile`, async () => {
  const client = clientFixture(log => {
    const fields = log.methods.find(([method]) => method === "select")?.[1] || "";
    const dancer = approved({ disabled_at: "2026-09-01" });
    if (!fields.includes("disabled_at")) delete dancer.disabled_at;
    const row = name === "going_signals"
      ? { shift_id: "shift", shifts: { id: "shift", dancer_profiles: dancer, venues: venue } }
      : { dancer_id: dancer.id, dancer_profiles: dancer };
    return { data: [row], error: null };
  });
  const rows = await readRows(client);
  if (name === "follows") { assert.equal(rows.length, 1); assert.equal(rows[0].dancer, null); }
  else assert.equal(rows.length, 0);
});
const future = () => new Date(Date.now() + 3600000).toISOString();
const past = () => new Date(Date.now() - 60000).toISOString();
const scheduled = extra => ({ id: "shift", dancer_id: "dancer", status: "posted", shift_source: "scheduled", starts_at: future(), ends_at: future(), venues: venue, ...extra });
const presence = extra => scheduled({ shift_source: "nfc_presence", checked_in_at: past(), checked_out_at: null, location_status: "club_confirmed", location_verification_expires_at: future(), ...extra });
const hiddenShifts = [
  ["checked-out presence", () => presence({ checked_out_at: past() })],
  ["expired presence", () => presence({ location_verification_expires_at: past() })],
  ["unconfirmed presence", () => presence({ location_status: "self_reported" })],
  ["cancelled shift", () => scheduled({ status: "cancelled" })],
  ["unrecognized source", () => scheduled({ shift_source: "unknown" })],
  ["past schedule", () => scheduled({ ends_at: past() })],
  ["hidden venue", () => scheduled({ venues: { ...venue, is_active: false } })],
  ["venue without an offer", () => scheduled({ venues: { ...venue, has_active_club_deal: false } })],
];
for (const [name, makeShift] of hiddenShifts) test(`saved next-shift cards exclude ${name}`, async () => {
  const client = clientFixture(() => ({ data: [makeShift()], error: null }));
  const rows = await customerService.getSavedDancerSchedules(client, ["dancer"]);
  assert.equal(rows.size, 0);
});
for (const [name, makeShift] of [["published schedule", scheduled], ["active NFC presence", presence]]) test(`saved next-shift cards retain ${name}`, async () => {
  const client = clientFixture(() => ({ data: [makeShift()], error: null }));
  const rows = await customerService.getSavedDancerSchedules(client, ["dancer"]);
  assert.equal(rows.get("dancer").id, "shift");assert.equal(rows.get("dancer").venue.id, "venue");
  assert.ok(!JSON.stringify(copy(rows.get("dancer"))).includes("checkin_distance"));
});
