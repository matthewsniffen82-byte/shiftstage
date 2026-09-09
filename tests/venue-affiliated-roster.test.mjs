import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const roster = {};
vm.runInNewContext(compile(read("../src/lib/dancr/venue-roster.ts")), { exports: roster });
const affiliations = [
  { id: "a", dancerId: "one", status: "active", dancer: { stageName: "Bella Rose", slug: "bella", city: "Las Vegas" } },
  { id: "b", dancerId: "two", status: "active", dancer: { stageName: "Ivy", slug: "ivy", city: "Phoenix" } },
  { id: "c", dancerId: "three", status: "revoked", dancer: { stageName: "Former", slug: "former" } },
];
const workingNow = [{ dancerId: "two", dancerSlug: "ivy" }];
const ids = results => Array.from(results, row => row.id);

test("affiliated roster searches active dancers by stage name only regardless of case or spacing", () => {
  assert.deepEqual(ids(roster.filterVenueAffiliations(affiliations, workingNow, "  ROSE  bella ", false)), ["a"]);
  assert.deepEqual(ids(roster.filterVenueAffiliations(affiliations, workingNow, "IVY", false)), ["b"]);
  assert.deepEqual(ids(roster.filterVenueAffiliations(affiliations, workingNow, "PHOENIX", false)), []);
  assert.deepEqual(ids(roster.filterVenueAffiliations(affiliations, workingNow, "ROSE vegas", false)), []);
  assert.deepEqual(ids(roster.filterVenueAffiliations(affiliations, workingNow, "", false)), ["a", "b"]);
  assert.deepEqual(ids(roster.filterVenueAffiliations(affiliations, workingNow, "missing", false)), []);
});

test("working-now filtering uses current presence rather than active affiliation and combines with search", () => {
  assert.deepEqual(ids(roster.filterVenueAffiliations(affiliations, workingNow, "", true)), ["b"]);
  assert.deepEqual(ids(roster.filterVenueAffiliations(affiliations, workingNow, "Bella", true)), []);
  assert.deepEqual(ids(roster.filterVenueAffiliations(affiliations, [], "", true)), []);
  assert.equal(roster.isAffiliatedDancerWorkingNow(affiliations[0], [{ dancerId: "other", dancerSlug: "bella" }]), false);
  assert.equal(roster.isAffiliatedDancerWorkingNow(affiliations[0], [{ dancerSlug: "bella" }]), true);
  assert.equal(roster.isAffiliatedDancerWorkingNow({ id: "empty", status: "active" }, [{}]), false);
});

const panel = read("../app/dashboard/VenueNfcTagPanel.tsx");
const removal = compile(panel.slice(panel.indexOf("  async function removeAccess("), panel.indexOf("  function startTapTest(")));
function removalFixture({ canManageRoster = true, confirmed = true } = {}) {
  let saved = affiliations;
  const requests = [], removed = [];
  const context = vm.createContext({
    AbortController, Error, canManageRoster,
    window: { confirm: () => confirmed }, readDashboardAccessToken: () => "fixture",
    mountedRef: { current: true }, savingRef: { current: false },
    actionSequenceRef: { current: 0 }, actionAbortRef: { current: null },
    loadSequenceRef: { current: 0 }, loadAbortRef: { current: new AbortController() }, loadInFlightRef: { current: null },
    setIsLoading: () => {}, setIsSaving: value => { context.saving = value; },
    setStatus: value => { context.status = value; },
    setAffiliations: update => { saved = update(saved); },
    onAccessRemoved: value => removed.push(value),
    requestVenueDancerVerificationsJson: (path, options) => new Promise((resolve, reject) => requests.push({ path, options, resolve, reject })),
  });
  vm.runInContext(removal, context);
  return { context, requests, removed, saved: () => saved };
}

test("removal waits for persistence then revokes only the selected dancer and synchronizes the dashboard", async () => {
  const fixture = removalFixture();
  const oldLoad = fixture.context.loadAbortRef.current;
  const action = fixture.context.removeAccess(affiliations[1]);
  assert.equal(oldLoad.signal.aborted, true);
  assert.equal(fixture.saved()[1].status, "active");
  assert.equal(fixture.requests[0].options.method, "DELETE");
  assert.equal(JSON.parse(fixture.requests[0].options.body).affiliationId, "b");
  await fixture.context.removeAccess(affiliations[0]);
  assert.equal(fixture.requests.length, 1);
  fixture.requests[0].resolve({ ok: true });
  await action;
  assert.equal(fixture.saved()[0].status, "active");
  assert.equal(fixture.saved()[1].status, "revoked");
  assert.deepEqual(fixture.removed, [affiliations[1]]);
  assert.equal(fixture.context.saving, false);
});

test("failed removal preserves access and allows retry without changing dashboard counts", async () => {
  const fixture = removalFixture();
  const action = fixture.context.removeAccess(affiliations[0]);
  fixture.requests[0].reject(new Error("Please try again."));
  await action;
  assert.equal(fixture.saved()[0].status, "active");
  assert.equal(fixture.removed.length, 0);
  assert.equal(fixture.context.status, "Please try again.");
  assert.equal(fixture.context.saving, false);
});

test("staff, cancelled confirmations, and abandoned responses cannot remove roster access locally", async () => {
  for (const options of [{ canManageRoster: false }, { confirmed: false }]) {
    const fixture = removalFixture(options);
    await fixture.context.removeAccess(affiliations[0]);
    assert.equal(fixture.requests.length, 0);
  }
  const fixture = removalFixture();
  const action = fixture.context.removeAccess(affiliations[0]);
  fixture.context.mountedRef.current = false;
  fixture.requests[0].resolve({ ok: true });
  await action;
  assert.equal(fixture.saved()[0].status, "active");
  assert.equal(fixture.removed.length, 0);
});

const service = read("../src/lib/dancr/venue-affiliations.ts");
const loadRoster = compile(service.slice(service.indexOf("export async function getVenueDancerVerificationState("), service.indexOf("export async function approveDancerVenueVerification(")));
function rosterQueryFixture(rows, failPage = -1) {
  const calls = [];
  const exports = {};
  const client = { from(table) {
    const call = { table };
    const query = {
      select: () => query,
      eq: (column, value) => { call.scope = [column, value]; return query; },
      order: (column, options) => { call.order = [column, options.ascending]; return query; },
      limit: value => { call.limit = value; return query; },
      gt: (column, value) => { call.cursor = [column, value]; return query; },
      then(resolve) {
        calls.push(call);
        const data = rows.filter(row => !call.cursor || row.id > call.cursor[1]).slice(0, call.limit);
        return Promise.resolve(resolve(calls.length === failPage ? { error: new Error("Unavailable") } : { data }));
      },
    };
    return query;
  } };
  vm.runInNewContext(loadRoster, {
    exports, requireManagedVenue: async () => ({ id: "own-venue" }), AFFILIATION_COLUMNS: "id",
    mapVenue: row => row, mapAffiliation: (_client, row) => row,
  });
  return { load: () => exports.getVenueDancerVerificationState(client, "manager"), calls };
}

test("all venue affiliations remain searchable beyond the database's default 1,000-row cap", async () => {
  const rows = Array.from({ length: 1003 }, (_, index) => ({ id: String(index).padStart(5, "0"), updated_at: "2026-09-09", status: "active", dancer: { stageName: `Dancer ${index}` } }));
  const fixture = rosterQueryFixture(rows);
  const result = await fixture.load();
  assert.equal(result.affiliations.length, 1003);
  assert.deepEqual(ids(roster.filterVenueAffiliations(result.affiliations, [], "Dancer 1002", false)), ["01002"]);
  assert.equal(fixture.calls.length, 3);
  for (const call of fixture.calls) {
    assert.deepEqual(call.scope, ["venue_id", "own-venue"]);
    assert.deepEqual(call.order, ["id", true]);
  }
  assert.deepEqual(fixture.calls[1].cursor, ["id", "00499"]);
});

test("roster pagination handles empty and exact pages and rejects partial results on database failure", async () => {
  assert.equal((await rosterQueryFixture([]).load()).affiliations.length, 0);
  const rows = Array.from({ length: 500 }, (_, index) => ({ id: String(index).padStart(5, "0") }));
  const fixture = rosterQueryFixture(rows);
  assert.equal((await fixture.load()).affiliations.length, 500);
  assert.equal(fixture.calls.length, 2);
  await assert.rejects(rosterQueryFixture(rows, 2).load(), /Unavailable/);
});
