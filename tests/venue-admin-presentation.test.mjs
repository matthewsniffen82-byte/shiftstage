import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as analytics from "../src/lib/dancr/venue-analytics.ts";
import * as scoring from "../src/lib/dancr/venue-dancer-scores.ts";
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
    ['Roster activity','Guest list & entries','VIP demand','Internal table demand','Customer interest','Transportation demand','Dancer contribution']);
  assert.ok(categories.every(node=>node.props.open===undefined));
  assert.equal(tree.find(node => node.type === "DancerPerformance").props.dancers, performance.dancers);
  assert.equal(tree.filter(node => node.props.className === "venue-supporting-disclosure").length, 3);
  assert.equal(tree.find(node => node.props?.className === "venue-value-methodology").props.open, undefined);
  tree.find(node => node.type === "select").props.onChange({ target: { value: "dancer_profile" } });
  tree = render(props);
  const mobile = tree.find(node => node.props?.className === "venue-action-mobile");
  assert.equal(nodes(mobile).filter(node => node.type === "li").length, 1);
  assert.equal(nodes(mobile).find(node => node.type === "strong").props.children, "Free Entry / Club Deal");
  assert.ok(!tree.some(node => node.props?.children === "Planned visits"));
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
  assert.equal(tree.find(node => node.type === "DancerPerformance").props.period, "all");
  assert.equal(tree.find(node => node.props.className === "venue-value-dates").props.children, "All time");
  assert.ok(!tree.some(node => typeof node.props.children === "string" && /vs prior period|Compared with|1970|Partial tracking/.test(node.props.children)));
  tree = render({ ...props, report: { ...props.report, performance: undefined, automatic:undefined } });
  assert.ok(tree.some(node => node.props.role === "status" && node.props.children.includes("unavailable")));
  assert.ok(nodes(tree.find(node=>node.props.className==='venue-priority-metrics')).filter(node=>node.type==='strong').every(node=>node.props.children==='—'));
});

const dancerResults = (overrides = {}) => ({ checkIns: 2, checkOuts: 1, lastCheckInAt: null, lastCheckOutAt: null,
  profileConversions: 10, profileClaims: 20, profileCohortConversions: 10, profileConversionPercent: 50,
  tableArrived: 0, tableNoShows: 0, tableAttendanceUnrecorded: 0, showUpPercent: null, ...overrides });
const scoreDependencies = { "@/src/lib/dancr/venue-dancer-scores": scoring };
const scoredDancers = () => ["Aria", "Bella", "Celeste"].map((name, index) => ({ id: String.fromCharCode(97 + index), name,
  internal: { requests: 20, completed: 8, checkedInHours: 8, requestsDuringHours: 20,
    rosterTrackedHours: 8, verifiedCheckInDays: 4, checkoutEligibleDays: 4, dancerCheckoutDays: 4, activeCheckInDays: 0 },
  external: { dancer_profile: 10, club_page: 10, directions: 10, going: 10, free_entry: 10, transport: 10 },
  vip: { requests: 20, scoringRequests: 20, scoringUniqueRequesters: 10, scoringRepeatRequesters: 2 }, results: dancerResults(),
}));

test("dancer rows show six compact scores with full labels and evidence in collapsed details", () => {
  const render = component("app/dashboard/VenueDancerPerformance.tsx", "default", "", scoreDependencies);
  const tree = render({ dancers: scoredDancers(), period: "30d" });
  const rows = tree.filter(node => node.type === "li");
  assert.equal(rows.length, 3);
  for (const row of rows) {
    const grid = nodes(row).find(node => node.props.className === "venue-score-grid");
    const details = nodes(row).find(node => node.type === "details");
    assert.equal(grid.props['aria-label'], 'Performance scores out of 100');
    assert.deepEqual(nodes(grid).filter(node => node.type === "abbr").map(node => node.props.children), ["Overall", "Check-ins", "Tables", "VIP", "Interest", "Entries"]);
    assert.deepEqual(nodes(grid).filter(node => node.type === "abbr").map(node => node.props.title), Object.values(scoring.DANCER_SCORE_LABELS));
    assert.deepEqual(nodes(details).filter(node => node.type === "dt").map(node => node.props.children), Object.values(scoring.DANCER_SCORE_LABELS));
    assert.equal(details.props.open, undefined);
    assert.equal(nodes(grid).filter(node => node.props.className === "venue-score-evidence").length, 0);
    assert.deepEqual(nodes(row).filter(node => node.type === "strong").map(node => node.props.children), [53, 75, 50, 44, 50, 50]);
    assert.equal(nodes(row).filter(node => node.props.className === "venue-score-evidence").length, 6);
    assert.ok(nodes(row).some(node => node.props.className === "venue-score-rank" && node.props.children === "#1 of 3 ranked dancers"));
    assert.equal(nodes(row).filter(node => node.type === "details").length, 1);
  }
  assert.deepEqual(tree.filter(node => node.type === "option").map(node => node.props.value), ["overall", "checkIns", "internal", "vip", "profile", "conversions", "name"]);
  assert.equal(tree.filter(node => node.type === "details").length, 4);
  assert.ok(tree.some(node => node.type === "summary" && node.props.children === "How scores are calculated"));
  assert.equal(tree.find(node => node.type === "details").props.open, undefined);
});

test("score explanation stays concise and preserves weights, conversion scope and ranking safeguards", () => {
  const render = component("app/dashboard/VenueDancerPerformance.tsx", "default", "", scoreDependencies);
  const text = node => Array.isArray(node) ? node.map(text).join("")
    : node && typeof node === "object" ? text(node.props?.children)
      : typeof node === "string" || typeof node === "number" ? String(node) : "";
  for (const period of ["tonight", "7d", "30d", "all"]) {
    const explanation = render({ dancers: scoredDancers(), period }).find(node => node.props.className === "venue-score-methodology");
    const copy = nodes(explanation).filter(node => ["p", "dt", "dd", "summary", "small"].includes(node.type)).map(text).join(" ");
    assert.ok(copy.split(/\s+/).length <= 280, "keep the explanation scannable");
    for (const key of scoring.DANCER_SCORE_CATEGORIES) {
      assert.ok(copy.includes(`${scoring.DANCER_SCORE_LABELS[key]} · ${scoring.DANCER_SCORE_WEIGHTS[key]}%`));
    }
    assert.match(copy, /at least three categories.*Missing categories are excluded; remaining weights are rescaled/);
    assert.match(copy, /claimed in this period and redeemed by period end/);
    assert.match(copy, /Customer withdrawals are excluded/);
    assert.match(copy, /Voided passes are excluded/);
    assert.ok(copy.includes(`all five categories past Early data and at least ${scoring.DANCER_SCORE_MIN_PEERS} comparable dancers`));
    assert.match(copy, /Missing data stays unscored/);
    assert.match(copy, /do not prove attendance or revenue/);
  }
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
  const dancers = scoredDancers().map(row => ({ ...row, internal: { ...row.internal, checkedInHours: 1, rosterTrackedHours: 1 } }));
  let tree = render({ dancers, period: "tonight" });
  assert.ok(tree.some(node => node.props.className === "venue-score-early" && node.props.children === "Early"));
  assert.ok(tree.some(node => node.props.className === "venue-score-confidence" && node.props.children === "Early data"));
  assert.ok(tree.some(node => node.props.className === "venue-score-evidence" && node.props.children === "5 of 5 categories"));
  tree = render({ dancers, period: "all" });
  assert.ok(tree.filter(node => node.props.className === "venue-score-rank").every(node => node.props.children === "Unranked"));
  const missing = tree.find(node => node.props.className === "venue-score-missing");
  assert.ok(nodes(missing).some(node => node.props['aria-hidden'] === 'true' && node.props.children === "—"));
  assert.ok(nodes(missing).some(node => node.props.className === "dashboard-sr-only" && node.props.children === "Not enough data"));
  const details = tree.find(node => node.props.className === "venue-score-details");
  assert.ok(nodes(details).some(node => Array.isArray(node.props.children) && node.props.children.includes("Needs at least 4 hours with verified dancer check-in and checkout tracking.")));
  assert.ok(tree.some(node => node.props.className === "venue-score-evidence" && node.props.children === "3 of 5 categories"));
  tree.find(node => node.type === "input").props.onChange({ target: { value: "Nobody matches" } });
  assert.ok(render({ dancers }).some(node => node.props.children === "No dancers match this search."));
  assert.equal(analytics.performanceMinutes(null), "Not yet available");
});

test("score layout keeps six compact columns on phones and larger screens", () => {
  const css = readFileSync(new URL("../app/dashboard/venue-performance.css", import.meta.url), "utf8");
  const grids = [...css.matchAll(/\.venue-score-grid\s*\{([^}]+)\}/g)].map(match => match[1]);
  assert.match(grids[0], /grid-template-columns: repeat\(6,minmax\(0,1fr\)\)/);
  assert.ok(grids.slice(1).every(rule => !rule.includes('grid-template-columns')));
  assert.doesNotMatch(css, /min-height: 92px/);
  assert.match(css, /\.venue-score-details > summary\s*\{[^}]*min-height: 44px/);
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
