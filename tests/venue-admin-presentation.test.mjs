import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as analytics from "../src/lib/dancr/venue-analytics.ts";
import { createVenueDashboardDemo } from "../src/lib/dancr/venue-dashboard-demo.ts";

const require = createRequire(import.meta.url);
const jsx = require("react/jsx-runtime");
function nodes(element) {
  if (!element || typeof element !== "object") return [];
  return [element, ...[element.props?.children].flat(Infinity).flatMap(nodes)];
}
function component(file, name, extra = "", dependencies = {}) {
  const source = readFileSync(new URL("../" + file, import.meta.url), "utf8");
  const code = ts.transpileModule(source + extra, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const state = []; let index = 0; let effects = [];
  const exports = {};
  vm.runInNewContext(code, { exports, URLSearchParams, Date: class extends Date { constructor(value = "2026-01-01T00:05:00.000Z") { super(value); } }, require(module) {
    if (module === "react/jsx-runtime") return jsx;
    if (module === "react") return { useState(initial) { const i = index++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = typeof value === "function" ? value(state[i]) : value; }]; }, useRef(value) { const i = index++; return state[i] ||= { current: value }; }, useEffect(effect) { effects.push(effect); } };
    if (module in dependencies) return dependencies[module];
    if (module === "next/link" || module.includes("VenueAdminUtilities")) return { default: () => null };
    if (module === "./pickup-session") return {};
    throw new Error("Unexpected import: " + module);
  } });
  const render = props => { index = 0; effects = []; return nodes(exports[name](props)); };
  render.flushEffects = () => effects.forEach(effect => effect());
  return render;
}

test("pickup presets preserve UTC inclusive dates across year boundaries and keep custom/all behavior", () => {
  const render = component("app/pickups/PickupInbox.tsx", "Inbox", "\nexport { Inbox };", { "../components/RefreshButton": { default: "RefreshButton" }, "./pickup-inbox.css": {} });
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
const valueDependencies = { "@/src/lib/dancr/venue-analytics": analytics, "./VenueDancerPerformance": { default: "DancerPerformance" }, "./VenueHairColorAnalytics": { default: "HairColorAnalytics" }, "./VenueMostRequestedDancers": { default: "MostRequestedDancers" }, "./venue-performance.css": {} };

test("results show six priority metrics and seven compact automatic categories, preserving source filtering", () => {
  const render = component("app/dashboard/VenueValueAnalytics.tsx", "default", "", valueDependencies);
  const metrics = { claims: 8, pickups: 2, going: 4, directions: 6, visitors: 3, followers: 1, passengers: 7, impressions: 29, admissions: 2 };
  const props = { report: { trackingStartedAt: "2025-12-01", current: metrics, previous: metrics, videos: [], interactions: [{ event_type: "club_page", source: "venue_scroll_card", total: 29, visitors: 3 }, { event_type: "free_entry", source: "dancer_profile", total: 8, visitors: 1 }], dancers: [{ id: "active", name: "Active dancer", metrics: { claims: 1 } }, { id: "zero", name: "Zero dancer", metrics: {} }] }, periodStart: "2025-12-20", periodEnd: "2026-01-01", timezone: "UTC", totalFollowers: 14, conversion: 25 };
  props.report.performance = performance;
  props.report.automatic = createVenueDashboardDemo('30d',new Date('2026-01-01')).report.automatic;
  Object.assign(props.report.automatic.current,{admissions:2,claims:8,cohortAdmissions:2,vipRequests:4,tableRequests:8,dancersCheckedIn:3,checkoutEligibleDays:4,dancerCheckoutDays:3});
  let tree = render(props);
  const cards = nodes(tree.find(node=>node.props.className==='venue-priority-metrics')).filter(node=>node.props.className==='metric');
  assert.equal(cards.length,6);
  assert.deepEqual(cards.map(node => nodes(node).find(item => item.type === "strong").props.children), ["2", "25%", "4", "8", "3", "75%"]);
  const categories=tree.filter(node=>node.props.className==='venue-auto-category');
  assert.deepEqual(categories.map(node=>nodes(node).find(child=>child.type==='summary').props.children[0].props.children),
    ['Roster activity','Guest list & entries','VIP demand','Table requests','Customer interest','Transportation demand','Dancer contribution']);
  assert.ok(categories.every(node=>node.props.open===undefined));
  assert.equal(tree.find(node => node.type === "DancerPerformance").props.dancers, performance.dancers);
  assert.deepEqual(tree.filter(node => node.type === "MostRequestedDancers").map(node => node.props.channel), ["vip", "internal"]);
  assert.ok(tree.filter(node => node.type === "MostRequestedDancers").every(node => node.props.dancers === performance.dancers));
  assert.equal(tree.filter(node => node.props.className === "venue-supporting-disclosure").length, 3);
  assert.equal(tree.find(node => node.props?.className === "venue-value-methodology").props.open, undefined);
  tree.find(node => node.type === "select").props.onChange({ target: { value: "dancer_profile" } });
  tree = render(props);
  const mobile = tree.find(node => node.props?.className === "venue-action-mobile");
  assert.equal(nodes(mobile).filter(node => node.type === "li").length, 1);
  assert.equal(nodes(mobile).find(node => node.type === "strong").props.children, "Free Entry / Club Deal");
  assert.ok(!tree.some(node => node.props?.children === "Planned visits"));
});

const requestedDependencies = {
  "../internal/InternalRoster": { VenueRosterProfileButton: "ProfileButton" },
  "./VenueGridImage": { default: "VenueGridImage" },
  "./venue-dancer-grid.css": {}, "./venue-requested-dancers.css": {},
};
test("most-requested profiles include every requested dancer in channel-specific ranked order", () => {
  const render = component("app/dashboard/VenueMostRequestedDancers.tsx", "default", "", requestedDependencies);
  const dancers = Array.from({ length: 9 }, (_, i) => ({ id: `dancer-${i}`, name: `Dancer ${i}`, photoUrl: i ? null : "/approved-photo.jpg",
    internal: { requests: i }, vip: { scoringRequests: 9 - i } }));
  const originalIds = dancers.map(dancer => dancer.id);
  const tree = render({ dancers, channel: "internal" });
  const profiles = tree.filter(node => node.type === "ProfileButton");
  assert.deepEqual(profiles.map(node => node.props.dancerId), originalIds.slice(1).reverse());
  assert.equal(profiles.length, 8, "the scrollable list is not truncated to five dancers");
  assert.deepEqual(dancers.map(dancer => dancer.id), originalIds, "ranking must not reorder the source report");
  assert.equal(tree.find(node => node.props.role === "region").props.tabIndex, 0);
  assert.equal(tree.find(node => node.type === "ol").props['aria-label'], "Dancers ranked by table requests");
  const vip = render({ dancers, channel: "vip" });
  assert.deepEqual(vip.filter(node => node.type === "ProfileButton").map(node => node.props.dancerId), originalIds);
  assert.equal(vip.find(node => node.type === "VenueGridImage").props.src, "/approved-photo.jpg");
  assert.equal(vip.filter(node => node.props.className === "venue-requested-count").at(-1).props.children.join(""), "1 request");
  const tied = render({ dancers: [{ ...dancers[0], name: "Zoe" }, { ...dancers[0], id: "another", name: "Aria" }], channel: "vip" });
  assert.deepEqual(tied.filter(node => node.type === "ProfileButton").map(node => node.props.stageName), ["Aria", "Zoe"]);
});

test("most-requested profiles distinguish unavailable and empty reports and use real demo profile IDs", () => {
  const render = component("app/dashboard/VenueMostRequestedDancers.tsx", "default", "", requestedDependencies);
  assert.ok(render({ channel: "vip" }).some(node => node.props.children === "Not yet available."));
  assert.ok(render({ channel: "vip", dancers: [] }).some(node => node.props.children === "No requests this period."));
  const demo = createVenueDashboardDemo("tonight", new Date("2026-10-12"), [{ name: "Aria", url: "/approved-photo.jpg", dancerId: "real-aria" }]);
  const tree = render({ channel: "vip", dancers: demo.report.performance.dancers });
  assert.deepEqual(tree.filter(node => node.type === "ProfileButton").map(node => node.props.dancerId), ["real-aria"]);
  assert.equal(tree.filter(node => node.type === "li").length, demo.report.performance.dancers.length);
});

test("live roster is labelled separately, only 7/30-day totals compare, and absent aggregates do not become zeroes", () => {
  const render = component("app/dashboard/VenueValueAnalytics.tsx", "default", "", valueDependencies);
  const metrics = Object.fromEntries(["claims", "pickups", "going", "directions", "visitors", "followers", "passengers", "impressions", "admissions"].map(key => [key, 0]));
  const props = { report: { trackingStartedAt: "2025-12-01", current: metrics, previous: metrics, interactions: [], videos: [], dancers: [], performance },
    period: "tonight", periodStart: "2026-01-01", periodEnd: "2026-01-01T10:00Z", timezone: "UTC", totalFollowers: 0, conversion: null };
  props.report.automatic=createVenueDashboardDemo('30d',new Date('2026-01-01')).report.automatic;
  for(const key of Object.keys(props.report.automatic.current)) if(typeof props.report.automatic.current[key]==='number') {
    props.report.automatic.current[key]=0; props.report.automatic.previous[key]=0;
  }
  let tree = render(props);
  const live=tree.find(node=>node.props.className==='metric'&&nodes(node).some(child=>child.props.children==='Total checked in'));
  assert.equal(nodes(live).find(node=>node.type==='strong').props.children,'6');
  assert.ok(!tree.some(node => typeof node.props.children === "string" && node.props.children.includes("vs prior period")));
  tree = render({ ...props, period: "7d" });
  assert.ok(tree.some(node=>node.props.children==='Working now'));
  assert.ok(tree.some(node => node.props.children === "No change vs prior period"));
  tree = render({ ...props, period: "all", periodStart: "1970-01-01T00:00:00Z" });
  assert.equal(tree.find(node => node.type === "DancerPerformance").props.period, undefined, "activity filters must not change the weekly dancer score");
  assert.equal(tree.find(node => node.props.className === "venue-value-dates").props.children, "All time");
  assert.ok(!tree.some(node => typeof node.props.children === "string" && /vs prior period|Compared with|1970|Partial tracking|Recorded this period/.test(node.props.children)));
  tree = render({ ...props, report: { ...props.report, performance: undefined, automatic:undefined } });
  assert.ok(tree.some(node => node.props.role === "status" && node.props.children.includes("unavailable")));
  assert.ok(nodes(tree.find(node=>node.props.className==='venue-priority-metrics')).filter(node=>node.type==='strong').every(node=>node.props.children==='—'));
});

test('sample working roster is labelled separately from recorded live data', () => {
  const render = component("app/dashboard/VenueValueAnalytics.tsx", "default", "", valueDependencies);
  const demo = createVenueDashboardDemo('30d', new Date('2026-10-13T08:00:00Z'));
  const notes = tree => tree.filter(node => node.props.className === 'venue-value-note')
    .map(node => [node.props.children].flat(Infinity).join('')).join('\n');
  assert.match(notes(render({ ...demo, timezone: 'UTC' })), /Live roster as of/);
  demo.report.automatic.liveRosterIsSample = true;
  const text = notes(render({ ...demo, timezone: 'UTC' }));
  assert.match(text, /Sample roster as of/);
  assert.doesNotMatch(text, /Live roster as of/);
});

for (const period of ["7d", "30d"]) test(`${period} results use recorded-period copy until comparison history is complete`, () => {
  const render = component("app/dashboard/VenueValueAnalytics.tsx", "default", "", valueDependencies);
  const demo = createVenueDashboardDemo(period, new Date("2026-10-13T08:00:00Z"));
  const props = { ...demo, timezone: "UTC" };
  const priorityCards = tree => nodes(tree.find(node => node.props.className === "venue-priority-metrics"))
    .filter(node => node.props.className === "metric");
  const values = tree => priorityCards(tree).map(node => nodes(node).find(child => child.type === "strong").props.children);
  const completeTree = render(props);
  const completeValues = values(completeTree);
  const baselineStart = 2 * Date.parse(demo.periodStart) - Date.parse(demo.periodEnd);
  const incompleteStart = new Date(baselineStart + 1).toISOString();
  demo.report.trackingStartedAt = incompleteStart;
  demo.report.performance.resultsStartedAt = incompleteStart;
  const tree = render(props);
  assert.deepEqual(values(tree), completeValues, "incomplete comparison history must not change recorded totals");
  assert.ok(priorityCards(tree).every(card => nodes(card).some(node => node.props.children === "Recorded this period")));
  assert.ok(!tree.some(node => typeof node.props.children === "string" && /Partial tracking|vs prior period/.test(node.props.children)));

  demo.report.trackingStartedAt = new Date(baselineStart).toISOString();
  let cards = priorityCards(render(props));
  assert.ok(nodes(cards[0]).some(node => typeof node.props.children === "string" && node.props.children.includes("vs prior period")));
  assert.ok(nodes(cards[4]).some(node => node.props.children === "Recorded this period"), "presence keeps its own coverage boundary");
  demo.report.performance.resultsStartedAt = demo.report.trackingStartedAt;
  cards = priorityCards(render(props));
  assert.ok(cards.every(card => nodes(card).some(node => typeof node.props.children === "string" && node.props.children.includes("vs prior period"))));
  assert.ok(!cards.some(card => nodes(card).some(node => node.props.children === "Recorded this period")));
});

for (const period of ["7d", "30d"]) test(`${period} demo comparisons show numeric samples without changing totals or live comparisons`, () => {
  const render = component("app/dashboard/VenueValueAnalytics.tsx", "default", "", valueDependencies);
  const demo = createVenueDashboardDemo(period, new Date("2026-10-13T08:00:00Z"));
  demo.report.trackingStartedAt = demo.periodEnd;
  demo.report.performance.resultsStartedAt = demo.periodEnd;
  const props = { ...demo, timezone: "UTC", demoComparisons: true };
  const snapshot = JSON.stringify(demo.report);
  const cards = tree => nodes(tree.find(node => node.props.className === "venue-priority-metrics")).filter(node => node.props.className === "metric");
  const labels = tree => cards(tree).map(card => nodes(card).filter(node => node.type === "small").at(-1)?.props.children);
  const tree = render(props);
  assert.deepEqual(labels(tree), period === "30d"
    ? ["+18% vs prior period", "+3.6 percentage points vs prior period", "+24% vs prior period", "+17% vs prior period", "+9% vs prior period", "+4.8 percentage points vs prior period"]
    : ["+12% vs prior period", "+2.1 percentage points vs prior period", "+16% vs prior period", "+11% vs prior period", "+6% vs prior period", "+3.2 percentage points vs prior period"]);
  assert.ok(tree.some(node => node.props.children === "Sample comparison figures"));
  assert.equal(JSON.stringify(demo.report), snapshot);
  const live = render({ ...props, demoComparisons: false });
  assert.ok(labels(live).every(label => label === "Recorded this period"));
  assert.ok(!live.some(node => node.props.children === "Sample comparison figures"));
  for (const value of ["tonight", "all"]) {
    const other = render({ ...props, period: value });
    assert.ok(!other.some(node => typeof node.props.children === "string" && /vs prior period|Sample comparison figures/.test(node.props.children)));
  }
  demo.report.trackingStartedAt = "2026-01-01";
  demo.report.performance.resultsStartedAt = "2026-01-01";
  assert.deepEqual(labels(render(props)), labels(render({ ...props, demoComparisons: false })));
  assert.ok(!render(props).some(node => node.props.children === "Sample comparison figures"));
});

test("demo comparisons do not invent activity or missing rates", () => {
  const render = component("app/dashboard/VenueValueAnalytics.tsx", "default", "", valueDependencies);
  const demo = createVenueDashboardDemo("30d", new Date("2026-10-13T08:00:00Z"));
  demo.report.trackingStartedAt = demo.periodEnd;
  demo.report.performance.resultsStartedAt = demo.periodEnd;
  for (const key of Object.keys(demo.report.automatic.current)) if (typeof demo.report.automatic.current[key] === "number") demo.report.automatic.current[key] = 0;
  demo.report.automatic.previous = null;
  const props = { ...demo, timezone: "UTC", demoComparisons: true };
  const tree = render(props);
  const cards = nodes(tree.find(node => node.props.className === "venue-priority-metrics")).filter(node => node.props.className === "metric");
  assert.deepEqual(cards.map(card => nodes(card).find(node => node.type === "strong").props.children), ["0", "—", "0", "0", "0", "—"]);
  assert.ok(!tree.some(node => typeof node.props.children === "string" && node.props.children.startsWith("+")));
  assert.equal(cards.filter(card => nodes(card).some(node => node.props.children === "0% vs prior period")).length, 4);
  demo.report.automatic = undefined;
  const unavailable = render(props);
  assert.ok(!unavailable.some(node => typeof node.props.children === "string" && /vs prior period|Sample comparison figures/.test(node.props.children)));
});

const dancerResults = (overrides = {}) => ({ checkIns: 2, checkOuts: 1, lastCheckInAt: null, lastCheckOutAt: null,
  profileConversions: 10, profileClaims: 20, profileCohortConversions: 10, profileConversionPercent: 50,
  tableArrived: 0, tableNoShows: 0, tableAttendanceUnrecorded: 0, showUpPercent: null, ...overrides });
const scoreDependencies = { "../internal/InternalRoster": { VenueRosterProfileButton: "ProfileButton" }, "./VenueGridImage": { default: "GridImage" }, "./venue-dancer-grid.css": {} };
const scoredDancers = () => ["Aria", "Bella", "Celeste"].map((name, index) => ({ id: String.fromCharCode(97 + index), name,
  internal: { requests: 20, completed: 8, checkedInHours: 8, requestsDuringHours: 20,
    rosterTrackedHours: 8, rosterExternalHours: 8, rosterExternalTrackedHours: 8, verifiedCheckInDays: 4, checkoutEligibleDays: 4, dancerCheckoutDays: 4, activeCheckInDays: 0 },
  external: { dancer_profile: 10, club_page: 10, directions: 10, going: 10, free_entry: 10, transport: 10 },
  vip: { requests: 20, scoringRequests: 20, scoringUniqueRequesters: 10, scoringRepeatRequesters: 2 }, results: dancerResults(),
}));

test("club results show weekly category values beside each profile and keep the calculation private", () => {
  const render = component("app/dashboard/VenueDancerPerformance.tsx", "default", "", scoreDependencies);
  const dancers = scoredDancers().map((row,i) => ({ ...row, dancerScore: [0,null,57][i],
    categoryScores: { videos: [0,null,60][i], photos: 20 } }));
  let tree = render({ dancers });
  assert.deepEqual(tree.filter(n => n.type === "ProfileButton").map(n => n.props.performanceScore.value), [57,0,null]);
  assert.deepEqual(tree.filter(n => n.type === "option").map(n => n.props.value), ["overall","name"]);
  for (const t of ["57/100","0/100","Not available yet"]) assert.ok(tree.some(n => n.props.children === t));
  const lists = tree.filter(n => n.type === "dl" && n.props["aria-label"] === "Category scores out of 100");
  assert.equal(lists.length, dancers.length);
  for (const [i, list] of lists.entries()) {
    const tiles = nodes(list).filter(n => n.type === "div");
    assert.equal(tiles.length, 8);
    const tile = tiles.find(n => nodes(n).some(child => child.type === "dt" && child.props.children === "MyDancr TV videos"));
    const value = nodes(tile).find(n => n.type === "dd");
    if (i < 2) assert.equal(value.props.children, ["60/100", "0/100"][i]);
    else assert.ok(nodes(value).some(n => n.props.children === "Not available yet"));
  }
  assert.ok(!tree.some(n => ["details","dialog","abbr"].includes(n.type)));
  tree.find(n => n.type === "select").props.onChange({target:{value:"name"}});
  assert.deepEqual(render({dancers}).filter(n=>n.type==="ProfileButton").map(n=>n.props.stageName), ["Aria","Bella","Celeste"]);
  tree.find(n => n.type === "input").props.onChange({target:{value:"BELL"}});
  tree = render({dancers});
  const selected = tree.filter(n=>n.type==="ProfileButton"); assert.equal(selected.length, 1);
  assert.equal(selected[0].props.performanceScore.period,"7d"); assert.equal(selected[0].props.stageName,"Bella");
});

test("weekly score list paginates without changing the scores", () => {
  const render = component("app/dashboard/VenueDancerPerformance.tsx", "default", "", scoreDependencies);
  const dancers = Array.from({length:25}, (_,i)=>({ id:String(i), name:"Dancer "+i, dancerScore:i }));
  const first = render({dancers}); assert.equal(first.filter(n => n.type === "li").length,20);
  first.find(n=>n.props.children==="Show more dancers").props.onClick();
  assert.equal(render({dancers}).filter(n => n.type === "li").length,25);
});

test("automatic totals exclude staff-confirmed results and show missing rates without inventing zero", () => {
  const render = component("app/dashboard/VenueValueAnalytics.tsx", "default", "", valueDependencies);
  const metrics = Object.fromEntries(["claims", "pickups", "going", "directions", "visitors", "followers", "passengers", "impressions", "admissions"].map(key => [key, 0]));
  const tree = render({ report: { trackingStartedAt: "2025-12-01", current: metrics, previous: metrics, interactions: [], videos: [], dancers: [],
    performance: { ...performance, resultsStartedAt: "2026-01-01", current: { ...performanceCounts, ...dancerResults({ tableNoShows: 2, tableAttendanceUnrecorded: 3 }) } } },
    period: "7d", periodStart: "2026-01-01", periodEnd: "2026-01-02", timezone: "UTC", totalFollowers: 0, conversion: null });
  const labels=tree.filter(node=>node.props.className==='metric').map(node=>nodes(node).find(child=>child.type==='span').props.children);
  assert.ok(!labels.includes('Table attendance rate')); assert.ok(!labels.includes('Arrived for table requests'));
  for(const kind of ['conversion','checkout','tables']) assert.equal(analytics.venueAutomaticRate(undefined,kind),null);
  assert.equal(analytics.venueAutomaticRate({claims:0,cohortAdmissions:0},'conversion'),null);
  assert.equal(analytics.venueAutomaticRate({claims:5,cohortAdmissions:0},'conversion'),0);
  assert.equal(analytics.venueAutomaticRate({claims:5,cohortAdmissions:6},'conversion'),null);
  assert.equal(analytics.venueAutomaticRate({checkedInHours:4,tableRequestsDuringHours:12},'tables'),3);
});
