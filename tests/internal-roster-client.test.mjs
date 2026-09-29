import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../app/internal/InternalRoster.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(`${source}\nexport { rosterFetch };`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const flush = () => new Promise(resolve => setImmediate(resolve));
const dancer = { id: "dancer-1", stageName: "Demo dancer", mainPhotoId: null };
const roster = { ok: true, venueName: "Demo club", dancers: [dancer] };
const response = (data, ok = true) => ({ ok, json: async () => data });
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function harness(fetch, { token = "table-token", session = null } = {}) {
  let now = 0;
  let nextTimer = 0;
  const timers = new Map();
  const schedule = (callback, delay, interval = false) => {
    const id = ++nextTimer;
    timers.set(id, { callback, at: now + delay, interval: interval ? delay : 0 });
    return id;
  };
  const states = [];
  const refs = [];
  const effects = [];
  const cleanups = [];
  const persisted = [];
  let stateIndex = 0;
  let refIndex = 0;
  let mounting = true;
  const exports = {};
  vm.runInNewContext(code, {
    exports, fetch, Error, AbortController,
    Date: class extends Date { static now() { return now; } },
    setTimeout: (callback, delay) => schedule(callback, delay),
    setInterval: (callback, delay) => schedule(callback, delay, true),
    clearTimeout: id => timers.delete(id),
    clearInterval: id => timers.delete(id),
    window: { addEventListener() {}, removeEventListener() {}, location: { hash: "" }, cancelAnimationFrame() {} },
    require(name) {
      if (name === "react/jsx-runtime") return require(name);
      if (name === "react") return {
        useState(initial) {
          const index = stateIndex++;
          if (mounting) states[index] = initial;
          return [states[index], value => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
        },
        useRef(initial) {
          const index = refIndex++;
          if (mounting) refs[index] = { current: initial };
          return refs[index];
        },
        useCallback: callback => callback,
        useEffect: callback => { if (mounting) effects.push(callback); },
      };
      if (name === "./InternalRequestPushSettings") return { InternalRequestPushSettings: () => null };
      if (name === "@/src/lib/dancr/browser-session") return {
        readBrowserAuthSession: () => session,
        isCurrentBrowserSession: () => true,
        persistRefreshedBrowserAuthSession: (...args) => persisted.push(args),
      };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  const render = () => {
    stateIndex = 0;
    refIndex = 0;
    const tree = exports.InternalRoster({ token });
    mounting = false;
    return tree;
  };
  return {
    exports, persisted, timers, render,
    async mount() { render(); effects.forEach(effect => cleanups.push(effect())); await flush(); },
    unmount() { cleanups.forEach(cleanup => cleanup?.()); },
    async advance(milliseconds) {
      const target = now + milliseconds;
      for (;;) {
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, timer] = next;
        now = timer.at;
        if (timer.interval) timer.at += timer.interval;
        else timers.delete(id);
        timer.callback();
        await flush();
      }
      now = target;
      await flush();
    },
  };
}

function find(tree, predicate) {
  if (!tree || typeof tree !== "object") return undefined;
  if (Array.isArray(tree)) return tree.map(item => find(item, predicate)).find(Boolean);
  return predicate(tree) ? tree : find(tree.props?.children, predicate);
}
const alert = app => find(app.render(), node => node.props?.role === "alert");
const alertMessage = app => find(alert(app), node => node.type === "p")?.props.children;
const grid = app => find(app.render(), node => node.props?.className === "ir-grid ir-directory-grid");
const profile = app => find(app.render(), node => node.type?.name === "ClubProfileDialog")?.props.profile;

for (const message of [
  "This club link has been revoked or is unavailable.",
  "This club link is unavailable.",
  "You do not have permission to view this roster.",
]) {
  test(`polling and the freshness watchdog preserve: ${message}`, async t => {
    const app = harness(async () => response({ ok: false, error: message }, false));
    t.after(() => app.unmount());
    await app.mount();
    assert.equal(alertMessage(app), message);
    await app.advance(30000);
    assert.equal(alertMessage(app), message);
    assert.equal(grid(app), undefined);
  });
}

test("the sign-in error is not replaced by a connection error", async t => {
  // An empty token selects the staff flow, like the component's omitted token prop.
  const staff = harness(() => assert.fail("Signed-out staff must not fetch a roster"), { token: "" });
  t.after(() => staff.unmount());
  await staff.mount();
  await staff.advance(30000);
  assert.equal(alertMessage(staff), "Sign in with your MyDancr club account to open the internal roster.");
});

test("a stalled fetch times out, polling recovers, and a late response cannot replace the fresh roster", async t => {
  const stalled = deferred();
  const calls = [];
  const app = harness((_url, options) => {
    calls.push(options);
    return calls.length === 1 ? stalled.promise : Promise.resolve(response(roster));
  });
  t.after(() => app.unmount());
  await app.mount();
  await app.advance(15000);
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(alertMessage(app), "The request timed out. Please try again.");
  await app.advance(5000);
  assert.equal(calls.length, 2);
  assert.equal(alert(app), undefined);
  assert.ok(grid(app));
  stalled.resolve(response({ ok: true, venueName: "Old response", dancers: [] }));
  await flush();
  assert.ok(grid(app));
  assert.equal(find(app.render(), node => node.type === "h1").props.children, "Demo club");
});

test("a stalled response body hides the old roster and open profile, then retries", async t => {
  const stalledBody = deferred();
  let rosterCalls = 0;
  const app = harness(async url => {
    if (url.includes("/profile/")) return response({ ok: true, profile: { id: dancer.id, stage_name: dancer.stageName } });
    rosterCalls++;
    return rosterCalls === 2 ? { ok: true, json: () => stalledBody.promise } : response(roster);
  });
  t.after(() => app.unmount());
  await app.mount();
  find(app.render(), node => node.props?.className === "ir-profile-link").props.onClick();
  await flush();
  assert.ok(profile(app));
  await app.advance(20000);
  assert.equal(alertMessage(app), "The request timed out. Please try again.");
  assert.equal(grid(app), undefined);
  assert.equal(profile(app), null);
  await app.advance(5000);
  assert.ok(grid(app));
  assert.equal(alert(app), undefined);
});

test("non-JSON server responses show a readable error and can be retried manually", async t => {
  let calls = 0;
  const app = harness(async () => ++calls === 1
    ? { ok: false, json: async () => { throw new SyntaxError("Unexpected token <"); } }
    : response(roster));
  t.after(() => app.unmount());
  await app.mount();
  assert.equal(alertMessage(app), "The club roster is temporarily unavailable. Please try again.");
  find(alert(app), node => node.type === "button").props.onClick();
  await flush();
  assert.equal(alert(app), undefined);
  assert.ok(grid(app));
});

test("unmount cancels a stalled poll without leaving request or retry timers", async () => {
  let requestSignal;
  const app = harness((_url, options) => { requestSignal = options.signal; return new Promise(() => {}); });
  await app.mount();
  app.unmount();
  await flush();
  assert.equal(requestSignal.aborted, true);
  assert.equal(app.timers.size, 0);
  await app.advance(30000);
  assert.equal(alert(app), undefined);
});

test("timed-out staff responses cannot persist a late refreshed session", async () => {
  const body = deferred();
  const app = harness(async () => ({ ok: true, json: () => body.promise }), {
    session: { accessToken: "test-token", account: { role: "venue" } },
  });
  const request = app.exports.rosterFetch("/api/internal", undefined);
  const failure = assert.rejects(request, /request timed out/);
  await flush();
  await app.advance(15000);
  await failure;
  body.resolve({ ...roster, session: { accessToken: "late-token" } });
  await flush();
  assert.deepEqual(app.persisted, []);
  assert.equal(app.timers.size, 0);
});
