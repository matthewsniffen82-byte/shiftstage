import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as analytics from "../src/lib/dancr/venue-analytics.ts";

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
  assert.equal(tree.find(node => node.props.className === "venue-value-dates").props.children, "All time");
  assert.ok(!tree.some(node => typeof node.props.children === "string" && /vs prior period|Compared with|1970|Partial tracking/.test(node.props.children)));
  tree = render({ ...props, report: { ...props.report, performance: undefined } });
  assert.ok(tree.some(node => node.props.role === "status" && node.props.children.includes("unavailable")));
});

const dancer = (id, name, internal = {}, external = {}, vip = {}) => ({ id, name, internal, external, vip });
const dancerResults = (overrides = {}) => ({ checkIns: 0, checkOuts: 0, lastCheckInAt: null, lastCheckOutAt: null,
  profileConversions: 0, profileClaims: 0, profileCohortConversions: 0, profileConversionPercent: null,
  tableArrived: 0, tableNoShows: 0, tableAttendanceUnrecorded: 0, showUpPercent: null, ...overrides });
test("dancer results include check-in-only dancers and display missing conversion data honestly", () => {
  const render = component("app/dashboard/VenueDancerPerformance.tsx", "default", "", { "@/src/lib/dancr/venue-analytics": analytics });
  const results = { checkIns: 1, checkOuts: 0, lastCheckInAt: null, lastCheckOutAt: null,
    profileConversions: 0, profileClaims: 0, profileCohortConversions: 0, profileConversionPercent: null,
    tableArrived: 0, tableNoShows: 0, tableAttendanceUnrecorded: 0, showUpPercent: null };
  const dancers = [{ ...dancer("a", "Aria"), results }, { ...dancer("b", "Bella"), results: { ...results, checkIns: 3 } }];
  let tree = render({ dancers, timezone: "UTC" });
  assert.equal(tree.filter(node => node.type === "li").length, 2);
  assert.ok(!tree.some(node => typeof node.props.children === "string" && /revenue|purchase|club sales/i.test(node.props.children)));
  assert.ok(tree.some(node => node.type === "dd" && [node.props.children].flat().includes("Not recorded")));
  assert.ok(tree.some(node => node.type === "dd" && [node.props.children].flat().includes("No qualifying claims")));
  tree.find(node => node.type === "select").props.onChange({ target: { value: "checkIns" } });
  tree = render({ dancers }); assert.deepEqual(tree.filter(node => node.type === "li").map(node => node.key), ["b", "a"]);
});
test("dancer channels sort meaningful outcomes, search names and do not mutate incoming analytics", () => {
  const render = component("app/dashboard/VenueDancerPerformance.tsx", "default", "", { "@/src/lib/dancr/venue-analytics": analytics });
  const dancers = [{ ...dancer("a", "Aria", { requests: 3, completed: 2 }, { admissions: 1 }, { requests: 2 }), results: dancerResults({ tableArrived: 2, profileConversions: 1 }) },
    { ...dancer("b", "Bella", { requests: 1, completed: 1 }, { admissions: 4 }), results: dancerResults({ tableArrived: 1, profileConversions: 4 }) }, dancer("c", "Celeste", {}, {}, { requests: 8 })];
  const originalOrder = dancers.map(row => row.id);
  const rows = tree => tree.filter(node => node.type === "li").map(node => node.key);
  const choose = label => render({ dancers }).find(node => node.type === "button" && node.props.children === label).props.onClick();
  assert.deepEqual(rows(render({ dancers })), ["a", "b", "c"]);
  choose("Internal"); assert.deepEqual(rows(render({ dancers })), ["a", "b"]);
  choose("External"); assert.deepEqual(rows(render({ dancers })), ["b", "a"]);
  assert.equal(render({ dancers }).find(node => node.type === "select").props.value, "conversions");
  choose("VIP"); assert.deepEqual(rows(render({ dancers })), ["c", "a"]);
  render({ dancers }).find(node => node.type === "input").props.onChange({ target: { value: "  ARI  " } });
  assert.deepEqual(rows(render({ dancers })), ["a"]);
  assert.deepEqual(dancers.map(row => row.id), originalOrder);
});

test("compact dancer rows show only requested measures and distinguish missing data from zeroes", () => {
  const render = component("app/dashboard/VenueDancerPerformance.tsx", "default", "", { "@/src/lib/dancr/venue-analytics": analytics });
  const dancers = [
    dancer("legacy", "Legacy", { requests: 5, completed: 5 }),
    { ...dancer("unknown", "Unknown", { requests: 2, checkedInHours: null }), results: dancerResults({ tableAttendanceUnrecorded: 2 }) },
    { ...dancer("mixed", "Mixed", { requests: 6, checkedInHours: 2.5 }, { admissions: 9 }), results: dancerResults({ tableArrived: 2, tableNoShows: 1, tableAttendanceUnrecorded: 3, profileConversions: 2 }) },
    { ...dancer("missed", "Missed", { requests: 2, checkedInHours: 4 }), results: dancerResults({ tableNoShows: 2, showUpPercent: 0 }) },
    { ...dancer("zero", "Zero", { checkedInHours: 0 }), results: dancerResults({ checkIns: 1 }) },
  ];
  let tree = render({ dancers });
  const rows = tree.filter(node => node.type === "li");
  const values = Object.fromEntries(rows.map(row => [row.key, nodes(row).filter(node => node.type === "b").map(node => node.props.children)]));
  assert.deepEqual(values.legacy, ["Not recorded", "5", "Not recorded"]);
  assert.deepEqual(values.unknown, ["Not recorded", "2", "0"]);
  assert.deepEqual(values.mixed, ["2.5 hr", "6", "2"]);
  assert.deepEqual(values.missed, ["4 hr", "2", "0"]);
  assert.deepEqual(values.zero, ["0 hr", "0", "0"]);
  assert.equal(rows[0].key, "mixed", "default order uses table requests received");
  const summary = nodes(rows[0]).find(node => node.type === "summary");
  assert.deepEqual(nodes(summary).filter(node => node.type === "span" && typeof node.props.children === "string").map(node => node.props.children),
    ["M", "Mixed", "Checked-in time", "Table requests received", "Redeemed profile passes"]);
  const details = nodes(rows[0]);
  assert.deepEqual(details.filter(node => node.type === "h4").map(node => node.props.children),
    ["Check-ins & check-outs", "Internal · table requests", "External · pass results", "VIP · dancer selections", "Clicks & profile activity"]);
  const labels = details.flatMap(node => node.type === "dt" ? [node.props.children] : node.props.label ? [node.props.label] : []);
  assert.deepEqual(labels, ["Checked-in time", "Check-ins", "Check-outs", "Last check-in this period",
    "Requests received", "Marked completed", "Redeemed profile passes", "Profile pass conversion rate", "Selected in requests", "Repeat VIP requesters",
    "Profile opens from this venue", "Club page opens", "Directions", "“I’m Going” signals", "Offer clicks", "Transport clicks"]);
  assert.deepEqual(tree.filter(node => node.type === "option").map(node => node.props.value),
    ["tableRequests", "hours", "completed", "vipRequests", "repeatRequesters", "conversions", "checkIns", "name"]);
  assert.equal(details.find(node => node.props.label === "Marked completed").props.value, undefined);
  tree.find(node => node.type === "select").props.onChange({ target: { value: "completed" } });
  tree = render({ dancers });
  assert.equal(tree.find(node => node.type === "li").key, "legacy");
  tree.find(node => node.type === "select").props.onChange({ target: { value: "hours" } });
  tree = render({ dancers });
  assert.deepEqual(tree.filter(node => node.type === "li").slice(0, 2).map(node => node.key), ["missed", "mixed"]);
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

test("dancer disclosure preserves missing data, pagination and accessible selected channel", () => {
  const render = component("app/dashboard/VenueDancerPerformance.tsx", "default", "", { "@/src/lib/dancr/venue-analytics": analytics });
  const dancers = Array.from({ length: 25 }, (_, i) => dancer(String(i), `Dancer ${i}`, { requests: i + 1 }));
  let tree = render({ dancers });
  assert.equal(tree.filter(node => node.type === "li").length, 20);
  assert.equal(tree.find(node => node.type === "button" && node.props.children === "All").props["aria-pressed"], true);
  assert.ok(tree.some(node => node.type === "dd" && [node.props.children].flat().includes("Not recorded")));
  tree.find(node => node.type === "button" && node.props.children === "Show more dancers").props.onClick();
  tree = render({ dancers }); assert.equal(tree.filter(node => node.type === "li").length, 25);
  tree.find(node => node.type === "button" && node.props.children === "VIP").props.onClick();
  assert.equal(render({ dancers }).filter(node => node.type === "li").length, 0);
  assert.equal(analytics.performanceMinutes(null), "Not yet available"); assert.equal(analytics.performanceMinutes(0.5), "Under 1 min");
});
