import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const fallback = new Proxy({}, { get: (_target, key) => key === "__esModule" ? true : () => [] });
function compile(source, imports = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { exports, require: name => name === "react/jsx-runtime" ? require(name) : imports[name] || fallback, ...globals });
  return exports;
}
const shared = read("app/dashboard/DashboardShared.tsx");
const { Metric } = compile(shared.slice(shared.indexOf("export function Metric("), shared.indexOf("export function formatVenueReviewHours(")));

// In-memory component events only: no application, browser journey, or network.
function fixture({ hash = "", ready = true, reducedMotion = false } = {}) {
  const slots = [], timers = [], listeners = new Map();
  let cursor = 0, effects = [], dirty = false, tree;
  const react = {
    useState(initial) {
      const i = cursor++;
      slots[i] ||= { value: typeof initial === "function" ? initial() : initial };
      return [slots[i].value, next => {
        const value = typeof next === "function" ? next(slots[i].value) : next;
        if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true; }
      }];
    },
    useRef(initial) { return slots[cursor++] ||= { current: initial }; },
    useEffect(effect, deps) {
      const i = cursor++, previous = slots[i];
      if (!previous || deps.some((value, j) => !Object.is(value, previous.deps[j]))) {
        effects.push(() => { previous?.cleanup?.(); slots[i] = { deps, cleanup: effect() }; });
      }
    },
  };
  class Details {
    open = false;
    summary = { focus: () => { this.focused = true; } };
    scrollIntoView(options) { this.scrolled = options; }
    focus() { this.focused = true; }
    querySelector(selector) { return selector === "summary" ? this.summary : null; }
  }
  const roster = new Details(), deals = new Details();
  const rosterSection = {
    querySelector: selector => selector === "details.venue-nfc-roster" ? roster : null,
    scrollIntoView(options) { this.scrolled = options; }, focus() { this.focused = true; },
  };
  const window = {
    location: { hash, pathname: "/dashboard/venue", search: "" },
    history: { replaceState: (_state, _title, url) => { window.location.hash = url.startsWith("#") ? url : ""; } },
    addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: name => listeners.delete(name),
    setTimeout: callback => timers.push(callback), requestAnimationFrame: callback => timers.push(callback), cancelAnimationFrame() {},
    matchMedia: () => ({ matches: reducedMotion }),
  };
  const props = {
    account: { id: "owner" }, profile: { id: "venue", name: "Test venue", isActive: true },
    venueDeals: [{ id: "live-deal", isActive: true }], dealRequests: [], workingNow: [{ id: "shift" }],
    initialAffiliations: [{ id: "affiliation", status: "active" }], venueAccess: { role: "owner", permissions: [] },
    refreshedAt: ready ? "2026-10-07T12:00:00Z" : null, analyticsPeriod: "tonight", isRefreshing: false, refreshStatus: "",
  };
  const { VenuePanel } = compile(read("app/dashboard/VenueDashboardPanels.tsx"), {
    react, "next/dynamic": { default: loader => loader.toString().match(/\.\/(\w+)/)[1] },
    "./DashboardShared": { ...fallback, Metric, formatVenueReviewHours: () => "", formatDashboardDate: () => "" },
  }, { window, HTMLDetailsElement: Details, document: { getElementById: id => {
    if (id === "venue-dancer-roster" && props.refreshedAt) return rosterSection;
    return id === "venue-club-deals" ? deals : null;
  } } });
  function nodes(node = tree) { return node && typeof node === "object" ? [node, ...[node.props?.children].flat(Infinity).filter(Boolean).flatMap(nodes)] : []; }
  function render() {
    dirty = true;
    for (let i = 0; dirty && i < 20; i++) { dirty = false; cursor = 0; effects = []; tree = VenuePanel(props); effects.forEach(run => run()); }
    assert.equal(dirty, false);
  }
  function flush() { while (timers.length) { timers.shift()(); render(); } }
  function click(label) {
    const active = nodes().find(node => node.props?.role === "tabpanel" && !node.props.hidden);
    const metric = nodes(active).find(node => node.type === Metric && node.props.label === label);
    assert.ok(metric, label);
    const link = Metric(metric.props);
    assert.equal(link.type, "a"); assert.match(link.props.href, /^#venue-/);
    let prevented = false;
    link.props.onClick({ preventDefault() { prevented = true; } });
    assert.ok(prevented); render(); flush();
  }
  render(); flush();
  return { click, window, roster, rosterSection, deals, nodes,
    active: () => nodes().find(node => node.props?.role === "tabpanel" && !node.props.hidden).props.id,
    workingOnly: () => nodes().find(node => node.type === "VenueNfcTagPanel")?.props.workingOnly,
    ready() { props.refreshedAt = "2026-10-07T12:00:00Z"; render(); flush(); },
    hash(value) { window.location.hash = value; listeners.get("hashchange")(); render(); flush(); },
  };
}

test("venue metric cards navigate to expanded sections and reset the roster filter", () => {
  const ui = fixture();
  ui.click("Working now");
  assert.equal(ui.active(), "venue-workspace-roster"); assert.equal(ui.workingOnly(), true); assert.equal(ui.roster.open, true);
  assert.equal(ui.window.location.hash, "#venue-working-now"); assert.equal(ui.rosterSection.focused, true);
  ui.roster.open = false;
  ui.click("Verified roster");
  assert.equal(ui.workingOnly(), false); assert.equal(ui.roster.open, true);
  assert.equal(ui.window.location.hash, "#venue-dancer-roster");
  ui.click("Live Club Deals");
  assert.equal(ui.active(), "venue-workspace-venue"); assert.equal(ui.deals.open, true); assert.equal(ui.deals.focused, true);
  assert.equal(ui.window.location.hash, "#venue-club-deals");
});

test("tonight shortcuts work before live data arrives and honor reduced motion", () => {
  const ui = fixture({ ready: false, reducedMotion: true });
  ui.click("Affiliated dancers"); assert.equal(ui.active(), "venue-workspace-roster");
  ui.ready(); assert.equal(ui.workingOnly(), false); assert.equal(ui.roster.open, true);
  const deals = fixture({ reducedMotion: true });
  deals.click("Live Club Deals"); assert.equal(deals.deals.scrolled.behavior, "auto");
});

test("roster hash navigation switches from working-now to the complete roster", () => {
  const ui = fixture({ hash: "#venue-working-now" });
  assert.equal(ui.workingOnly(), true);
  ui.roster.open = false; ui.hash("#venue-dancer-roster");
  assert.equal(ui.workingOnly(), false); assert.equal(ui.roster.open, true);
});

test("a roster that mounts after navigation still opens its linked list", () => {
  for (const [hash, workingOnly, expected] of [["#venue-dancer-roster", false, true], ["#venue-working-now", true, true], ["", false, false]]) {
    const effects = [], refs = [];
    const Panel = compile(read("app/dashboard/VenueNfcTagPanel.tsx"), { react: {
      useState: initial => [initial, () => {}], useRef: current => { const ref = { current }; refs.push(ref); return ref; },
      useEffect: (effect, deps) => effects.push({ effect, deps }), useCallback: callback => callback,
    } }, { window: { location: { hash } } }).default;
    Panel({ timeZone: "UTC", workingOnly, onWorkingOnlyChange() {} });
    const roster = { open: false }; refs[0].current = roster;
    effects.find(({ deps }) => deps.length === 1 && deps[0] === workingOnly).effect();
    assert.equal(roster.open, expected);
  }
});

test("metrics without destinations remain display-only", () => {
  assert.equal(Metric({ label: "Other metric", value: "4" }).type, "div");
});
