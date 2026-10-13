import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as analytics from "../src/lib/dancr/venue-analytics.ts";
import * as scoring from "../src/lib/dancr/venue-dancer-scores.ts";

const require = createRequire(import.meta.url);
const jsx = require("react/jsx-runtime");
function nodes(element) {
  if (!element || typeof element !== "object") return [];
  return [element, ...[element.props?.children].flat(Infinity).flatMap(nodes)];
}
function component(file, name, extra = "", dependencies = {}) {
  const source = readFileSync(new URL("../" + file, import.meta.url), "utf8");
  const code = ts.transpileModule(source + extra, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const state = []; let index = 0;
  const exports = {};
  vm.runInNewContext(code, { exports, URLSearchParams, Date: class extends Date { constructor(value = "2026-01-01T00:05:00.000Z") { super(value); } }, require(module) {
    if (module === "react/jsx-runtime") return jsx;
    if (module === "react") return { useState(initial) { const i = index++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = typeof value === "function" ? value(state[i]) : value; }]; }, useRef: value => ({ current: value }), useEffect() {} };
    if (module in dependencies) return dependencies[module];
    if (module === "next/link" || module.includes("VenueAdminUtilities")) return { default: () => null };
    if (module === "./pickup-session") return {};
    throw new Error("Unexpected import: " + module);
  } });
  return props => { index = 0; return nodes(exports[name](props)); };
}

test("pickup presets preserve UTC inclusive dates across year boundaries and keep custom/all behavior", () => {
  const render = component("app/pickups/PickupInbox.tsx", "Inbox", "\nexport { Inbox };");
  const choose = label => render({ role: "venue" }).find(node => node.type === "button" && node.props.children === label).props.onClick();
  assert.equal(render({ role: "venue" }).filter(node => node.type === "input" && node.props.type === "date").length, 0);
  choose("7 days"); choose("Custom");
  let dates = render({ role: "venue" }).filter(node => node.type === "input" && node.props.type === "date");
  assert.deepEqual(dates.map(node => node.props.value), ["2025-12-26", "2026-01-01"]);
  dates[0].props.onChange({ target: { value: "2025-12-20" } });
  assert.equal(render({ role: "venue" }).find(node => node.type === "input").props.value, "2025-12-20");
  choose("Today"); choose("Custom");
  assert.deepEqual(render({ role: "venue" }).filter(node => node.type === "input").map(node => node.props.value), ["2026-01-01", "2026-01-01"]);
  choose("30 days"); choose("Custom");
  assert.deepEqual(render({ role: "venue" }).filter(node => node.type === "input").map(node => node.props.value), ["2025-12-03", "2026-01-01"]);
  choose("All"); choose("Custom");
  assert.deepEqual(render({ role: "venue" }).filter(node => node.type === "input").map(node => node.props.value), ["", ""]);
});

const performanceCounts = { guestList: 5, vipRequests: 4, vipPending: 1, vipConfirmed: 2, vipDeclined: 0, vipCancelled: 1,
  tableRequests: 8, tablePending: 2, tableAcknowledged: 1, tableCompleted: 4, tableCancelled: 1,
  vipResponseMinutes: null, vipResponseSamples: 0, tableResponseMinutes: 5, tableResponseSamples: 2, tableCompletionMinutes: null, tableCompletionSamples: 0 };
const performance = { current: performanceCounts, previous: performanceCounts, trackingStartedAt: "2026-01-01",
  dancers: [], tonight: { vipPending: 2, vipConfirmed: 3, tablePending: 4, tableAcknowledged: 1, guestListExpected: 6 } };
const valueDependencies = { "@/src/lib/dancr/venue-analytics": analytics, "./VenueDancerPerformance": { default: "DancerPerformance" }, "./VenueHairColorAnalytics": { default: "HairColorAnalytics" }, "./venue-performance.css": {} };

test("results prioritize outcomes and preserve click source filtering inside supporting disclosures", () => {
  const render = component("app/dashboard/VenueValueAnalytics.tsx", "default", "", valueDependencies);
  const metrics = { claims: 8, pickups: 2, going: 4, directions: 6, visitors: 3, followers: 1, passengers: 7, impressions: 29, admissions: 2 };
  const props = { report: { trackingStartedAt: "2025-12-01", current: metrics, previous: metrics, videos: [], interactions: [{ event_type: "club_page", source: "venue_scroll_card", total: 29, visitors: 3 }, { event_type: "free_entry", source: "dancer_profile", total: 8, visitors: 1 }], dancers: [{ id: "active", name: "Active dancer", metrics: { claims: 1 } }, { id: "zero", name: "Zero dancer", metrics: {} }] }, periodStart: "2025-12-20", periodEnd: "2026-01-01", timezone: "UTC", totalFollowers: 14, conversion: 25 };
  props.report.performance = performance;
  let tree = render(props);
  const cards = tree.filter(node => node.props?.className === "metric");
  assert.equal(cards.length, 14);
  assert.deepEqual(cards.slice(0, 8).map(node => nodes(node).find(item => item.type === "strong").props.children), ["2", "5", "4", "8", "8", "2", "7", "1"]);
  assert.equal(tree.find(node => node.type === "DancerPerformance").props.dancers, performance.dancers);
  assert.equal(tree.filter(node => node.props.className === "venue-supporting-disclosure").length, 4);
  assert.equal(tree.find(node => node.props?.className === "venue-value-methodology").props.open, undefined);
  tree.find(node => node.type === "select").props.onChange({ target: { value: "dancer_profile" } });
  tree = render(props);
  const mobile = tree.find(node => node.props?.className === "venue-action-mobile");
  assert.equal(nodes(mobile).filter(node => node.type === "li").length, 1);
  assert.equal(nodes(mobile).find(node => node.type === "strong").props.children, "Free Entry / Club Deal");
  assert.ok(!tree.some(node => node.props?.children === "Planned visits"));
});

test("Tonight shows live queues; older periods show trends and absent performance is not replaced with zeroes", () => {
  const render = component("app/dashboard/VenueValueAnalytics.tsx", "default", "", valueDependencies);
  const metrics = Object.fromEntries(["claims", "pickups", "going", "directions", "visitors", "followers", "passengers", "impressions", "admissions"].map(key => [key, 0]));
  const props = { report: { trackingStartedAt: "2025-12-01", current: metrics, previous: metrics, interactions: [], videos: [], dancers: [], performance },
    period: "tonight", periodStart: "2026-01-01", periodEnd: "2026-01-01T10:00Z", timezone: "UTC", totalFollowers: 0, conversion: null };
  let tree = render(props);
  const queues = tree.find(node => node.props.className === "venue-tonight-results");
  assert.deepEqual(nodes(queues).filter(node => node.type === "dd").map(node => node.props.children), ["2", "3", "4", "1", "6"]);
  assert.ok(!tree.some(node => typeof node.props.children === "string" && node.props.children.includes("vs prior period")));
  tree = render({ ...props, period: "7d" });
  assert.ok(!tree.some(node => node.props.className === "venue-tonight-results"));
  assert.ok(tree.some(node => node.props.children === "No change vs prior period"));
  tree = render({ ...props, period: "all", periodStart: "1970-01-01T00:00:00Z" });
  assert.equal(tree.find(node => node.type === "DancerPerformance").props.period, "all");
  assert.equal(tree.find(node => node.props.className === "venue-value-dates").props.children, "All time");
  assert.ok(!tree.some(node => typeof node.props.children === "string" && /vs prior period|Compared with|1970|Partial tracking/.test(node.props.children)));
  tree = render({ ...props, report: { ...props.report, performance: undefined } });
  assert.ok(tree.some(node => node.props.role === "status" && node.props.children.includes("unavailable")));
});

const dancerResults = (overrides = {}) => ({ checkIns: 2, checkOuts: 1, lastCheckInAt: null, lastCheckOutAt: null,
  profileConversions: 5, profileClaims: 10, profileCohortConversions: 5, profileConversionPercent: 50,
  tableArrived: 0, tableNoShows: 0, tableAttendanceUnrecorded: 0, showUpPercent: null, ...overrides });
const scoreDependencies = { "@/src/lib/dancr/venue-dancer-scores": scoring };
const scoredDancers = () => ["Aria", "Bella", "Celeste"].map((name, index) => ({ id: String.fromCharCode(97 + index), name,
  internal: { requests: 10, completed: 8, checkedInHours: 4, requestsDuringHours: 10 },
  external: { dancer_profile: 10, club_page: 10, directions: 10, going: 10, free_entry: 10, transport: 10 },
  vip: { requests: 10, repeatRequesters: 2 }, results: dancerResults(),
}));

test("dancer rows show exactly four scores and an overall venue rank without raw metric breakdowns", () => {
  const render = component("app/dashboard/VenueDancerPerformance.tsx", "default", "", scoreDependencies);
  const tree = render({ dancers: scoredDancers(), period: "30d" });
  const rows = tree.filter(node => node.type === "li");
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.deepEqual(nodes(row).filter(node => node.type === "dt").map(node => node.props.children), ["Overall", "Check-in activity", "Requests", "Profile results"]);
    assert.deepEqual(nodes(row).filter(node => node.type === "strong").map(node => node.props.children), [57, 50, 63, 53]);
    assert.ok(nodes(row).some(node => node.props.className === "venue-score-rank" && node.props.children === "#1 of 3 ranked dancers"));
    assert.equal(nodes(row).filter(node => node.type === "details").length, 0);
  }
  assert.deepEqual(tree.filter(node => node.type === "option").map(node => node.props.value), ["overall", "checkIns", "requests", "profile", "name"]);
  assert.equal(tree.filter(node => node.type === "details").length, 1);
  assert.ok(tree.some(node => node.type === "summary" && node.props.children === "How scores are calculated"));
  assert.equal(tree.find(node => node.type === "details").props.open, undefined);
});

test("search, category sorting and pagination do not recalculate club ranks", () => {
  const render = component("app/dashboard/VenueDancerPerformance.tsx", "default", "", scoreDependencies);
  const dancers = scoredDancers();
  dancers[0].internal.completed = 10; dancers[0].results.profileCohortConversions = 10;
  const original = structuredClone(dancers);
  let tree = render({ dancers, period: "7d" });
  const before = tree.filter(node => node.type === "li").map(node => [node.key, nodes(node).find(node => node.props.className === "venue-score-rank").props.children]);
  tree.find(node => node.type === "input").props.onChange({ target: { value: "  BELL  " } });
  tree = render({ dancers, period: "7d" });
  assert.equal(tree.filter(node => node.type === "li").length, 1);
  assert.equal(tree.find(node => node.props.className === "venue-score-rank").props.children, before.find(([id]) => id === "b")[1]);
  tree.find(node => node.type === "select").props.onChange({ target: { value: "profile" } });
  assert.equal(render({ dancers, period: "7d" }).find(node => node.props.className === "venue-score-rank").props.children, before.find(([id]) => id === "b")[1]);
  tree.find(node => node.type === "input").props.onChange({ target: { value: "" } });
  const many = Array.from({ length: 25 }, (_, i) => ({ ...dancers[0], id: String(i), name: `Dancer ${i}` }));
  tree = render({ dancers: many });
  assert.equal(tree.filter(node => node.type === "li").length, 20);
  tree.find(node => node.type === "button" && node.props.children === "Show more dancers").props.onClick();
  assert.equal(render({ dancers: many }).filter(node => node.type === "li").length, 25);
  assert.deepEqual(dancers, original);
});

test("missing data stays unranked and changing reporting period recalculates eligibility", () => {
  const render = component("app/dashboard/VenueDancerPerformance.tsx", "default", "", scoreDependencies);
  const dancers = scoredDancers().map(row => ({ ...row, internal: { ...row.internal, checkedInHours: 1 } }));
  let tree = render({ dancers, period: "tonight" });
  assert.ok(tree.some(node => node.props.className === "venue-score-rank" && node.props.children !== "Unranked"));
  tree = render({ dancers, period: "all" });
  assert.ok(tree.filter(node => node.props.className === "venue-score-rank").every(node => node.props.children === "Unranked"));
  assert.ok(tree.some(node => node.props.className === "venue-score-missing" && node.props.children === "Not enough data"));
  assert.ok(tree.some(node => node.props.title?.includes("All three category scores")));
  tree.find(node => node.type === "input").props.onChange({ target: { value: "Nobody matches" } });
  assert.ok(render({ dancers }).some(node => node.props.children === "No dancers match this search."));
  assert.equal(analytics.performanceMinutes(null), "Not yet available");
});

test("score layout keeps four fixed columns on desktop and two on small screens", () => {
  const css = readFileSync(new URL("../app/dashboard/venue-performance.css", import.meta.url), "utf8");
  assert.match(css, /\.venue-score-grid\s*\{[^}]*grid-template-columns: repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css, /@media\(max-width:480px\)\s*\{\s*\.venue-score-grid\s*\{\s*grid-template-columns: repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /\.venue-score\s*\{[^}]*min-height: 92px/);
  assert.match(css, /\.venue-score-missing\s*\{[^}]*overflow-wrap: anywhere/);
});

test("venue attendance summary labels missing records and staff-confirmed missed table arrivals", () => {
  const render = component("app/dashboard/VenueValueAnalytics.tsx", "default", "", valueDependencies);
  const metrics = Object.fromEntries(["claims", "pickups", "going", "directions", "visitors", "followers", "passengers", "impressions", "admissions"].map(key => [key, 0]));
  const tree = render({ report: { trackingStartedAt: "2025-12-01", current: metrics, previous: metrics, interactions: [], videos: [], dancers: [],
    performance: { ...performance, resultsStartedAt: "2026-01-01", current: { ...performanceCounts, ...dancerResults({ tableNoShows: 2, tableAttendanceUnrecorded: 3 }) } } },
    period: "7d", periodStart: "2026-01-01", periodEnd: "2026-01-02", timezone: "UTC", totalFollowers: 0, conversion: null });
  const card = tree.find(node => node.props.className === "metric" && nodes(node).some(child => child.props.children === "Table attendance rate"));
  assert.equal(nodes(card).find(node => node.type === "strong").props.children, "Not recorded");
  assert.equal(nodes(card).find(node => node.type === "small").props.children.join(""), "2 didn’t arrive at table · 3 not recorded");
});
