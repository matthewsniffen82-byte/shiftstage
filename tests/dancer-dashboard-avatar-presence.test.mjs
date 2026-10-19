import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as presence from "../src/lib/dancr/shift-presence.ts";

const require = createRequire(import.meta.url);
const code = ts.transpileModule(readFileSync("app/dashboard/DancerShiftManager.tsx", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;

// Isolated component with a controlled clock, requests, and React hook lifecycle.
function fixture() {
  let now = Date.parse("2026-10-19T12:00:00Z"), cursor = 0, failRefresh = false;
  let shifts = [{ id: "active", checked_in_at: new Date(now).toISOString(), location_status: "club_confirmed",
    location_verification_expires_at: new Date(now + 60000).toISOString(), rankingProgress: { visibility: "internal" } }];
  const slots = [], pending = [], timers = new Map(), listeners = new Map(), changes = [];
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
      if (name === "./dashboard-session") return { requestDancerShiftsJson: async () => {
        if (failRefresh) throw new Error("Offline");
        return { shifts: shifts.map(shift => ({ ...shift })) };
      } };
      if (name === "@/src/lib/dancr/venue-dancer-scores") return { DANCER_SCORE_WEIGHTS: {} };
      if (name === "@/src/lib/dancr/external-ranking-progress") return { formatExternalHours: () => "Not recorded yet" };
      return {};
    },
  });
  const props = { onPresenceChange: key => changes.push(key) };
  async function render() {
    cursor = 0; exports.default(props);
    for (const effect of pending.splice(0)) effect();
    // Resolve the mocked request and its load completion before the next render.
    await Promise.resolve(); await Promise.resolve();
  }
  return { changes, timers, render,
    async start() { await render(); await render(); },
    async advance(ms, { resume = false } = {}) {
      now += ms;
      if (resume) listeners.get("visibilitychange")();
      else for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
      await render(); await render();
    },
    async checkOut() { shifts = shifts.map(shift => ({ ...shift, checked_out_at: new Date(now).toISOString() })); listeners.get("visibilitychange")(); await render(); await render(); },
    offline() { failRefresh = true; },
    unmount() { for (const slot of slots) slot.cleanup?.(); },
  };
}

test("the dashboard live indicator ends at expiry even when refresh is offline", async () => {
  const f = fixture(); await f.start();
  assert.match(f.changes.at(-1), /^active:/);
  f.offline(); await f.advance(59999);
  assert.match(f.changes.at(-1), /^active:/);
  await f.advance(1);
  assert.equal(f.changes.at(-1), "off");
  f.unmount(); assert.equal(f.timers.size, 0);
});

test("returning after expiry clears the ring even if the suspended expiry timer did not run", async () => {
  const f = fixture(); await f.start(); f.offline();
  await f.advance(61000, { resume: true });
  assert.equal(f.changes.at(-1), "off"); f.unmount();
});

test("checkout and removal of the Working Now panel clear the header indicator", async () => {
  const f = fixture(); await f.start(); await f.checkOut();
  assert.equal(f.changes.at(-1), "off"); f.unmount();
  const active = fixture(); await active.start(); active.unmount();
  assert.equal(active.changes.at(-1), "off");
});
