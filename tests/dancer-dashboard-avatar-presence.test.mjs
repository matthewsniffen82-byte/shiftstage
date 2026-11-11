import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import * as presence from "../src/lib/dancr/shift-presence.ts";
import { dancerWorkingVisibility } from "../src/lib/dancr/dancer-working-visibility.ts";

const require = createRequire(import.meta.url);
const code = ts.transpileModule(readFileSync("app/dashboard/DancerShiftManager.tsx", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;

// Isolated component with a controlled clock, requests, and React hook lifecycle.
function fixture(shiftOverrides = {}, otherShifts = []) {
  let now = Date.parse("2026-10-19T12:00:00Z"), cursor = 0, failRefresh = false;
  let shifts = [{ id: "active", venue_id: "club-a", checked_in_at: new Date(now).toISOString(), location_status: "club_confirmed",
    location_verification_expires_at: new Date(now + 60000).toISOString(), rankingProgress: { visibility: "internal" }, ...shiftOverrides }, ...otherShifts];
  const slots = [], pending = [], timers = new Map(), listeners = new Map(), changes = [], presenceStates = [];
  let timerId = 0;
  const hooks = {
    useState(initial) {
      const slot = slots[cursor++] ||= { value: typeof initial === "function" ? initial() : initial };
      return [slot.value, value => { slot.value = typeof value === "function" ? value(slot.value) : value; }];
    },
    useRef(initial) { return slots[cursor++] ||= { current: initial }; },
    useMemo(fn, deps) {
      const slot = slots[cursor++] ||= {};
      if (!slot.deps || deps.some((value, i) => !Object.is(value, slot.deps[i]))) { slot.value = fn(); slot.deps = deps; }
      return slot.value;
    },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps); },
    useEffect(fn, deps) {
      const slot = slots[cursor++] ||= {};
      if (!slot.deps || deps.some((value, i) => !Object.is(value, slot.deps[i]))) {
        pending.push(() => { slot.cleanup?.(); slot.cleanup = fn(); }); slot.deps = deps;
      }
    },
  };
  const document = { visibilityState: "visible", addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const window = {
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout: id => timers.delete(id), setInterval: () => ++timerId, clearInterval() {},
  };
  const exports = {};
  vm.runInNewContext(code, { exports, window, document, AbortController, DOMException,
    Date: class extends Date { static now() { return now; } },
    require: name => {
      if (name === "react") return hooks;
      if (name === "react/jsx-runtime") return require(name);
      if (name === "@/src/lib/dancr/shift-presence") return presence;
      if (name === "@/src/lib/dancr/dancer-working-visibility") return { dancerWorkingVisibility };
      if (name === "./dashboard-session") return { requestDancerShiftsJson: async () => {
        if (failRefresh) throw new Error("Offline");
        return { shifts: shifts.map(shift => ({ ...shift })) };
      } };
      if (name === "@/src/lib/dancr/venue-dancer-scores") return { DANCER_SCORE_WEIGHTS: {} };
      if (name === "@/src/lib/dancr/external-ranking-progress") return { formatExternalHours: () => "Not recorded yet" };
      return {};
    },
  });
  const props = { visibilityNotice: "Additional visibility notice", onPresenceChange: key => changes.push(key), onPresenceStateChange: state => presenceStates.push(state) };
  async function render() {
    cursor = 0; const tree = exports.default(props);
    for (const effect of pending.splice(0)) effect();
    // Resolve the mocked request and its load completion before the next render.
    await Promise.resolve(); await Promise.resolve();
    return tree;
  }
  return { changes, presenceStates, timers, render,
    async start() { await render(); await render(); },
    async advance(ms, { resume = false } = {}) {
      now += ms;
      if (resume) listeners.get("visibilitychange")();
      else for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
      await render(); await render();
    },
    async checkOut() { shifts = shifts.map(shift => ({ ...shift, checked_out_at: new Date(now).toISOString() })); listeners.get("visibilitychange")(); await render(); await render(); },
    async changeMode(mode) { shifts = shifts.map(shift => ({ ...shift, rankingProgress: { visibility: mode } })); listeners.get("visibilitychange")(); await render(); await render(); },
    offline() { failRefresh = true; },
    unmount() { for (const slot of slots) slot.cleanup?.(); },
  };
}

test("only the check-in placeholder appears before the first shift response", async () => {
  const f = fixture();
  const loading = renderToStaticMarkup(await f.render());
  assert.match(loading, /class="dashboard-sr-only">Loading check-in/);
  assert.doesNotMatch(loading, /Additional visibility notice|<details|You’re not checked in|Working Now at/);
  const loaded = renderToStaticMarkup(await f.render());
  assert.match(loaded, /Working Now at/);
  const card = loaded.match(/<section class="shift-checkin-card ready"[^>]*>([\s\S]*?)<\/section>/)?.[1];
  assert.match(card, /Checked in until[\s\S]*Additional visibility notice[\s\S]*End Working Now/);
  assert.doesNotMatch(loaded, /shift-checkin-placeholder/);
  f.unmount();
});

test("a managed demo shift shows one quiet note beside its visibility and no checkout button", async () => {
  const f = fixture({ shift_source: "demo_locked", venues: { name: "Spearmint Rhino" } });
  try {
    await f.start();
    const html = renderToStaticMarkup(await f.render());
    assert.match(html, /Working Now at Spearmint Rhino[\s\S]*Additional visibility notice[\s\S]*<small class="shift-managed-note">This demo shift stays active automatically\.<\/small>[\s\S]*?<\/section>/);
    assert.doesNotMatch(html, /<button|Demo managed|End Working Now/);
  } finally { f.unmount(); }
});

test("a checked-out dancer sees one card with club-specific directions until the cooldown ends", async () => {
  const f = fixture({
    nfc_last_tapped_at: "2026-10-19T00:01:00Z",
    checked_out_at: "2026-10-19T06:01:00Z",
    venues: { name: "Spearmint Rhino" },
  });
  await f.start();
  const cooling = renderToStaticMarkup(await f.render());
  assert.match(cooling, /You’re not checked in/);
  assert.match(cooling, /Spearmint Rhino again at .*?<time dateTime="2026-10-19T12:01:00.000Z"/i);
  assert.match(cooling, /<summary>Check-in details<\/summary>[\s\S]*?<\/details><\/section>/);
  assert.doesNotMatch(cooling, /Additional visibility notice/);
  await f.advance(60_000);
  const ready = renderToStaticMarkup(await f.render());
  assert.match(ready, /When you arrive for your shift/);
  assert.doesNotMatch(ready, /Spearmint Rhino again at|Additional visibility notice/);
  f.unmount();
});

test("the dashboard live indicator ends at expiry even when refresh is offline", async () => {
  const f = fixture(); await f.start();
  assert.match(f.changes.at(-1), /^active:/);
  assert.equal(f.presenceStates.at(-1).venueId, 'club-a');
  assert.equal(f.presenceStates.at(-1).mode, 'internal');
  f.offline(); await f.advance(59999);
  assert.match(f.changes.at(-1), /^active:/);
  await f.advance(1);
  assert.equal(f.changes.at(-1), "off");
  assert.equal(f.presenceStates.at(-1), null, 'the visibility notice must stop claiming an active session');
  f.unmount(); assert.equal(f.timers.size, 0);
});

test("club cooldowns expire independently while a dancer switches clubs", async () => {
  const earlier = { venue_id: "club-b", venues: { name: "Earlier Club" }, checked_out_at: "2026-10-19T01:00:00Z", nfc_last_tapped_at: "2026-10-19T00:01:00Z" };
  const f = fixture({ venues: { name: "Later Club" }, checked_out_at: "2026-10-19T08:00:00Z", nfc_last_tapped_at: "2026-10-19T07:00:00Z" }, [earlier]);
  await f.start();
  const both = renderToStaticMarkup(await f.render());
  assert.match(both, /Earlier Club again at/); assert.match(both, /Later Club again at/);
  await f.advance(60_000);
  const later = renderToStaticMarkup(await f.render());
  assert.doesNotMatch(later, /Earlier Club again at/); assert.match(later, /Later Club again at/);
  f.unmount();
});

test("returning after expiry clears the ring even if the suspended expiry timer did not run", async () => {
  const f = fixture(); await f.start(); f.offline();
  await f.advance(61000, { resume: true });
  assert.equal(f.changes.at(-1), "off"); f.unmount();
});

test("checkout and removal of the Working Now panel clear the header indicator", async () => {
  const f = fixture(); await f.start(); await f.checkOut();
  assert.equal(f.changes.at(-1), "off"); f.unmount();
  assert.equal(f.presenceStates.at(-1), null);
  const active = fixture(); await active.start(); active.unmount();
  assert.equal(active.changes.at(-1), "off");
});

test('the visibility notice receives changes to the same session’s check-in mode', async () => {
  const f=fixture();await f.start();assert.equal(f.presenceStates.at(-1).mode,'internal');
  await f.changeMode('both');assert.equal(f.presenceStates.at(-1).mode,'both');
  assert.equal(f.presenceStates.at(-1).venueId,'club-a');f.unmount();
});
