import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
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

test("Working Now includes every current check-in even when the approved roster has different dancers", () => {
  const present = [
    { shiftId: "live", dancerId: "four", dancerSlug: "nova", stageName: "Nova", shiftSource: "nfc_presence" },
    { shiftId: "demo", dancerId: "five", dancerSlug: "luna", stageName: "Luna", shiftSource: "demo_locked" },
  ];
  const rows = roster.getVenueRosterEntries(affiliations, present, "", true);
  assert.equal(rows.length, present.length, "the list and dashboard use the same presence count");
  assert.deepEqual(Array.from(rows, row => row.dancer.stageName), ["Nova", "Luna"]);
  assert.deepEqual(Array.from(rows, row => row.checkIn), present);
  assert.ok(rows.every(row => row.affiliation === null), "presence does not create affiliation or removal permission");
  assert.deepEqual(ids(roster.getVenueRosterEntries(affiliations, present, "", false)), ["a", "b"]);
  assert.deepEqual(ids(roster.getVenueRosterEntries(affiliations, present, " LuNA ", true)), ["check-in:demo"]);
  assert.equal(roster.getVenueRosterEntries(affiliations, present, "missing", true).length, 0);
  assert.equal(roster.getVenueRosterEntries(affiliations, [], "", true).length, 0);
});

test("working rows only attach matching active affiliations and preserve the exact checkout target", () => {
  const present = [
    { shiftId: "active", dancerId: "two", dancerSlug: "ivy", stageName: "Ivy" },
    { shiftId: "revoked", dancerId: "three", dancerSlug: "former", stageName: "Former" },
    { shiftId: "other-id", dancerId: "different", dancerSlug: "bella", stageName: "Different dancer" },
  ];
  const rows = roster.getVenueRosterEntries(affiliations, present, "", true);
  assert.equal(rows[0].affiliation, affiliations[1]);
  assert.equal(rows[1].affiliation, null);
  assert.equal(rows[2].affiliation, null, "matching slugs must not override different dancer IDs");
  assert.deepEqual(Array.from(rows, row => row.checkIn.shiftId), ["active", "revoked", "other-id"]);
  assert.deepEqual(ids(roster.getVenueRosterEntries([], present, "", true)), ["check-in:active", "check-in:revoked", "check-in:other-id"]);
});

const panel = read("../app/dashboard/VenueNfcTagPanel.tsx");
test("live roster cards retain photos, shift details and permission-scoped profile and management controls", () => {
  const require = createRequire(import.meta.url);
  const exports = {};
  const state = []; let cursor = 0;
  vm.runInNewContext(ts.transpileModule(panel, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, Date, Intl, require(name) {
      if (name === 'react/jsx-runtime') return require(name);
      if (name === 'react') return {
        useState(initial) { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }]; },
        useCallback: callback => callback, useEffect() {}, useRef: value => ({ current: value }),
      };
      if (name.endsWith('.css') || name === './dashboard-session') return {};
      if (name.includes('venue-roster')) return roster;
      if (name === '../internal/InternalRoster') return { InternalRoster: 'InternalRoster', VenueRosterProfileButton: 'ProfileButton' };
      if (name === './VenueDashboardIdentity') return { VenueDashboardIcon: 'Icon' };
      if (name === './VenueGridImage') return { default: 'img' };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  const nodes = tree => tree && typeof tree === 'object' ? [tree, ...[tree.props?.children, tree.props?.roster].flat(Infinity).flatMap(nodes)] : [];
  const fixture = [
    { ...affiliations[0], canViewProfile: true, workingUntil: new Date(Date.now() + 3600000).toISOString(), internalVisible: true, externalVisible: true, dancer: { ...affiliations[0].dancer, avatarUrl: '/bella.jpg' } },
    { ...affiliations[1], canViewProfile: false },
  ];
  const props = { initialAffiliations: fixture, workingNow: [{ dancerId: 'one', checkedInAt: '2026-10-13T03:00:00Z' }], timeZone: 'America/Los_Angeles', workingOnly: false, onWorkingOnlyChange() {} };
  const render = options => { cursor = 0; return nodes(exports.default({ ...props, ...options })); };
  let tree = render({ canManageRoster: true });
  assert.equal(tree.find(node => node.props.className === 'venue-nfc-roster').props.open, undefined);
  assert.equal(render({ view: 'tools' }).find(node => node.props.className === 'venue-roster-stickers').props.open, undefined);
  const dedicatedRoster = render({ view: 'roster' }).find(node => node.props.className === 'venue-nfc-roster');
  assert.equal(dedicatedRoster.props.open, true, 'the dedicated roster stays visible because its summary is hidden');
  assert.equal(nodes(dedicatedRoster).find(node => node.type === 'summary').props.hidden, true);
  const cards = tree.filter(node => node.props.className === 'venue-dancer-card');
  assert.equal(cards.length, 2);
  assert.equal(nodes(cards[0]).find(node => node.type === 'ProfileButton').props.dancerId, 'one');
  assert.equal(nodes(cards[0]).find(node => node.type === 'ProfileButton').props.rosterStatus, 'Internal + External');
  for (const [internalVisible, externalVisible, expected] of [[true, false, 'Internal only'], [false, true, 'External only'], [false, false, 'Affiliated']]) {
    Object.assign(fixture[0], { internalVisible, externalVisible });
    const updated = render({ canManageRoster: true });
    const button = updated.find(node => node.type === 'ProfileButton');
    assert.equal(button.props.rosterStatus, expected);
    assert.ok(nodes(button).some(node => node.props.children === expected), 'profile and grid use the same visibility label');
  }
  Object.assign(fixture[0], { internalVisible: true, externalVisible: true });
  assert.equal(nodes(cards[0]).find(node => node.type === 'img').props.src, '/bella.jpg');
  assert.ok(nodes(cards[0]).some(node => node.props.children === 'Internal + External'));
  const caption = nodes(cards[0]).find(node => node.props.className === 'venue-card-caption');
  assert.ok(nodes(caption).some(node => node.props.children === '● Working now'));
  const menu = nodes(cards[0]).find(node => node.type === 'details');
  assert.equal(nodes(cards[0]).find(node => node.props.className === 'venue-card-details'),
    nodes(menu).find(node => node.props.className === 'venue-card-details'), 'full shift details stay in the menu, not below the card');
  assert.equal(nodes(cards[0]).find(node => node.type === 'time').props.dateTime, '2026-10-13T03:00:00Z');
  assert.equal(nodes(cards[1]).find(node => node.type === 'ProfileButton'), undefined);
  assert.ok(nodes(cards[1]).some(node => node.props.children === 'Not working now'));
  assert.equal(tree.filter(node => node.props.className === 'venue-card-menu').length, 2);
  assert.equal(tree.filter(node => node.props.className === 'venue-nfc-remove-access').length, 2);
  tree = render({ canManageRoster: false });
  assert.equal(tree.filter(node => node.props.className === 'venue-card-menu').length, 2, 'staff can still inspect full shift details');
  assert.equal(tree.filter(node => node.props.className === 'venue-nfc-remove-access').length, 0);
  tree.find(node => node.type === 'input' && node.props.type === 'search').props.onChange({ target: { value: 'Ivy' } });
  tree = render({ canManageRoster: false });
  assert.equal(tree.filter(node => node.props.className === 'venue-dancer-card').length, 1);
  assert.ok(tree.some(node => node.props.children === 'Ivy'));
});

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
function rosterQueryFixture(rows, failPage = -1, { permissions = ["view_roster"], previews = new Map(), previewError = null } = {}) {
  const calls = [];
  const previewCalls = [];
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
        const data = rows.filter(row => (!row.venueId || row.venueId === call.scope[1]) && (!call.cursor || row.id > call.cursor[1])).slice(0, call.limit);
        return Promise.resolve(resolve(calls.length === failPage ? { error: new Error("Unavailable") } : { data }));
      },
    };
    return query;
  } };
  vm.runInNewContext(loadRoster, {
    exports, venueRosterMembers: async () => [],
    requireManagedVenue: async () => ({ venue: { id: "own-venue" }, access: { permissions } }), AFFILIATION_COLUMNS: "id",
    mainPhotoPreviews: async (_client, ids) => {
      previewCalls.push(Array.from(ids));
      if (previewError) throw previewError;
      return previews;
    },
    console: { warn() {} }, safeErrorMetadata: () => ({}),
    mapVenue: row => row, mapAffiliation: (_client, row) => row,
  });
  return { load: () => exports.getVenueDancerVerificationState(client, "manager"), calls, previewCalls };
}

test("club reviewers see a private main-photo fallback only for their active affiliations missing avatars", async () => {
  const rows = [
    { id: "pending", status: "active", dancer: { id: "ty", avatarUrl: null, avatarSrcSet: "stale-srcset" } },
    { id: "approved", status: "active", dancer: { id: "approved", avatarUrl: "/approved-avatar", avatarSrcSet: "/approved-avatar 320w" } },
    { id: "removed", status: "revoked", dancer: { id: "removed" } },
    { id: "revoked", status: "active", revokedAt: "2026-10-27", dancer: { id: "revoked" } },
    { id: "other", venueId: "other-venue", status: "active", dancer: { id: "other" } },
  ];
  const f = rosterQueryFixture(rows, -1, { permissions: ["view_roster", "manage_roster"], previews: new Map([["ty", "/private-signed-main"]]) });
  const result = await f.load();
  assert.deepEqual(f.previewCalls, [["ty"]]);
  const ty = result.affiliations.find(row => row.id === "pending");
  assert.equal(ty.dancer.avatarUrl, "/private-signed-main");
  assert.equal(ty.dancer.avatarSrcSet, null);
  assert.equal(ty.canViewProfile, false);
  assert.equal(ty.workingUntil, null);
  assert.equal(ty.internalVisible, false);
  assert.equal(ty.externalVisible, false);
  assert.equal(result.affiliations.find(row => row.id === "approved").dancer.avatarUrl, "/approved-avatar");
  assert.equal(rows[0].dancer.avatarUrl, null);
});

test("view-only club staff never receive pending photo previews", async () => {
  const f = rosterQueryFixture([{ id: "pending", status: "active", dancer: { id: "ty", avatarUrl: null } }]);
  const result = await f.load();
  assert.deepEqual(f.previewCalls, []);
  assert.equal(result.affiliations[0].dancer.avatarUrl, null);
});

test("missing or temporarily unavailable previews do not hide roster entries", async () => {
  for (const previewError of [null, new Error("Storage unavailable")]) {
    const f = rosterQueryFixture([{ id: "pending", status: "active", dancer: { id: "ty", avatarUrl: null } }], -1,
      { permissions: ["manage_roster"], previewError });
    const result = await f.load();
    assert.equal(result.affiliations.length, 1);
    assert.equal(result.affiliations[0].dancer.avatarUrl, null);
  }
});

test("reviewer photo previews are loaded in bounded batches", async () => {
  const rows = Array.from({ length: 53 }, (_, index) => ({ id: String(index), status: "active", dancer: { id: `dancer-${index}` } }));
  const f = rosterQueryFixture(rows, -1, { permissions: ["manage_roster"] });
  await f.load();
  assert.deepEqual(f.previewCalls.map(ids => ids.length), [24, 24, 5]);
  assert.equal(new Set(f.previewCalls.flat()).size, rows.length);
});

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

test("channel filters include Both, never infer opt-in, and exclude expired or removed affiliation", () => {
  const future = new Date(Date.now() + 3600000).toISOString();
  const rows = [
    { id: 'i', status: 'active', workingUntil: future, internalVisible: true, externalVisible: false },
    { id: 'e', status: 'active', workingUntil: future, internalVisible: false, externalVisible: true },
    { id: 'b', status: 'active', workingUntil: future, internalVisible: true, externalVisible: true },
    { id: 'expired', status: 'active', workingUntil: '2000-01-01', internalVisible: true, externalVisible: true },
    { id: 'removed', status: 'revoked', workingUntil: future, internalVisible: true, externalVisible: true },
    { id: 'unset', status: 'active', workingUntil: future },
  ].map(affiliation => ({ id: affiliation.id, affiliation }));
  assert.deepEqual(ids(roster.filterRosterChannel(rows, 'internal')), ['i', 'b']);
  assert.deepEqual(ids(roster.filterRosterChannel(rows, 'external')), ['e', 'b']);
  assert.equal(roster.filterRosterChannel(rows, 'all').length, 6);
  assert.equal(roster.rosterChannelVisibility(null).internal, false);
});
