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
const refreshInterval = 20 * 60 * 1000;
const sessionKey = "dancrAuthSessionV1";
const dancer = { id: "dancer-1", stageName: "Demo dancer", mainPhotoId: null };
const roster = { ok: true, venueName: "Demo club", dancers: [dancer] };
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function harness(fetch, { token = "table-token", session = null, component = "InternalRoster" } = {}) {
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
  const listeners = new Map();
  let stateIndex = 0;
  let refIndex = 0;
  let mounting = true;
  const exports = {};
  vm.runInNewContext(code, {
    exports, fetch, Error, AbortController, crypto: { randomUUID: () => "request-key" },
    Date: class extends Date { static now() { return now; } },
    setTimeout: (callback, delay) => schedule(callback, delay),
    setInterval: (callback, delay) => schedule(callback, delay, true),
    clearTimeout: id => timers.delete(id),
    clearInterval: id => timers.delete(id),
    window: {
      addEventListener: (name, callback) => listeners.set(name, callback),
      removeEventListener: name => listeners.delete(name),
      location: { hash: "" }, cancelAnimationFrame() {},
    },
    require(name) {
      if (name === "react/jsx-runtime") return require(name);
      if (name === "react") return {
        useState(initial) {
          const index = stateIndex++;
          if (mounting) states[index] = component === "VenueRosterProfileButton" && index === 0 ? true : initial;
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
      if (name === "./InternalFullProfile") return { InternalFullProfile: () => null };
      if (name === "@/src/lib/dancr/browser-session") return {
        BROWSER_AUTH_SESSION_KEY: sessionKey,
        readBrowserAuthSession: () => session,
        isCurrentBrowserSession: expected => expected?.accessToken === session?.accessToken,
        persistRefreshedBrowserAuthSession: (...args) => persisted.push(args),
      };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  const render = () => {
    stateIndex = 0;
    refIndex = 0;
    const tree = exports[component]({ token, dancerId: dancer.id, stageName: dancer.stageName });
    mounting = false;
    return tree;
  };
  return {
    exports, persisted, timers, render,
    setSession: next => { session = next; },
    storage: key => listeners.get("storage")?.({ key }),
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
  test(`initial access failures preserve the actual error: ${message}`, async t => {
    const app = harness(async () => response({ ok: false, error: message }, 403));
    t.after(() => app.unmount());
    await app.mount();
    assert.equal(alertMessage(app), message);
    await app.advance(refreshInterval);
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
  await app.advance(refreshInterval);
  assert.equal(calls.length, 2);
  assert.equal(alert(app), undefined);
  assert.ok(grid(app));
  stalled.resolve(response({ ok: true, venueName: "Old response", dancers: [] }));
  await flush();
  assert.ok(grid(app));
  assert.equal(find(app.render(), node => node.type === "h1").props.children, "Demo club");
});

test("refreshes wait 20 minutes and a stalled response keeps the roster and profile visible without messages", async t => {
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
  await app.advance(refreshInterval - 1);
  assert.equal(rosterCalls, 1);
  assert.ok(grid(app));
  assert.ok(profile(app));
  await app.advance(1);
  assert.equal(rosterCalls, 2);
  assert.ok(grid(app));
  assert.equal(find(app.render(), node => node.props?.role === "status"), undefined);
  await app.advance(15000);
  assert.equal(alert(app), undefined);
  assert.ok(grid(app));
  assert.ok(profile(app));
  await app.advance(refreshInterval);
  assert.equal(rosterCalls, 3);
  stalledBody.resolve({ ok: true, venueName: "Stale roster", dancers: [] });
  await flush();
  assert.ok(grid(app));
  assert.equal(alert(app), undefined);
  assert.equal(find(app.render(), node => node.type === "h1").props.children, "Demo club");
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

for (const failure of ["offline", 429, 503]) {
  test(`a background ${failure} failure quietly retains the roster and recovers on the next 20-minute refresh`, async t => {
    let calls = 0;
    const app = harness(async () => {
      if (++calls === 2) {
        if (failure === "offline") throw new TypeError("Failed to fetch");
        return response({ ok: false, error: "Try later" }, failure);
      }
      return response(calls > 2 ? { ...roster, dancers: [] } : roster);
    });
    t.after(() => app.unmount());
    await app.mount();
    await app.advance(refreshInterval);
    assert.equal(calls, 2);
    assert.ok(grid(app));
    assert.equal(alert(app), undefined);
    assert.equal(find(app.render(), node => node.props?.role === "status"), undefined);
    await app.advance(refreshInterval - 1);
    assert.equal(calls, 2);
    await app.advance(1);
    assert.equal(calls, 3);
    assert.equal(grid(app), undefined);
    assert.ok(find(app.render(), node => node.props?.className === "ir-empty"));
    assert.equal(alert(app), undefined);
  });
}

for (const status of [401, 403, 404, 410]) {
  test(`confirmed access loss (${status}) still clears an already loaded roster and profile`, async t => {
    let revoked = false;
    const app = harness(async url => revoked
      ? response({ ok: false, error: "This club link is unavailable." }, status)
      : response(url.includes("/profile/") ? { ok: true, profile: { id: dancer.id } } : roster));
    t.after(() => app.unmount());
    await app.mount();
    find(app.render(), node => node.props?.className === "ir-profile-link").props.onClick();
    await flush();
    assert.ok(profile(app));
    revoked = true;
    await app.advance(refreshInterval);
    assert.equal(grid(app), undefined);
    assert.equal(profile(app), null);
    assert.equal(alertMessage(app), "This club link is unavailable.");
  });
}

test("unrelated browser storage changes do not reload or hide the guest roster", async t => {
  let calls = 0;
  const app = harness(async () => { calls++; return response(roster); });
  t.after(() => app.unmount());
  await app.mount();
  for (const key of ["favorites", sessionKey, null]) app.storage(key);
  await flush();
  assert.equal(calls, 1);
  assert.ok(grid(app));
});

test("staff sign-out immediately clears the roster and cancels an in-flight refresh", async t => {
  const pending = deferred();
  let calls = 0;
  let signal;
  const app = harness(async (_url, options) => {
    signal = options.signal;
    return ++calls === 2 ? pending.promise : response(roster);
  }, { token: "", session: { accessToken: "staff-token", account: { role: "venue" } } });
  t.after(() => app.unmount());
  await app.mount();
  app.storage("favorites");
  await flush();
  assert.equal(calls, 1);
  assert.ok(grid(app));
  await app.advance(refreshInterval);
  app.setSession(null);
  app.storage(sessionKey);
  await flush();
  assert.equal(signal.aborted, true);
  assert.equal(grid(app), undefined);
  assert.equal(alertMessage(app), "Sign in with your MyDancr club account to open the internal roster.");
  pending.resolve(response(roster));
  await flush();
  assert.equal(grid(app), undefined);
});

test("sending a table request updates the roster immediately without waiting 20 minutes", async t => {
  const methods = [];
  const app = harness(async (_url, options) => {
    methods.push(options.method);
    return response({ ...roster, kind: "table", receipt: methods.includes("POST") ? { status: "pending" } : null });
  });
  t.after(() => app.unmount());
  await app.mount();
  find(app.render(), node => node.props?.className === "ir-table-request").props.onClick();
  await flush();
  assert.deepEqual(methods, ["GET", "POST", "GET"]);
  assert.ok(grid(app));
  assert.equal(alert(app), undefined);
  assert.ok(find(app.render(), node => node.type === "strong" && node.props.children === "pending"));
});

test("a request made after link revocation clears the roster immediately", async t => {
  const app = harness(async (_url, options) => options.method === "POST"
    ? response({ ok: false, error: "This club link is unavailable." }, 404)
    : response({ ...roster, kind: "table" }));
  t.after(() => app.unmount());
  await app.mount();
  find(app.render(), node => node.props?.className === "ir-table-request").props.onClick();
  await flush();
  assert.equal(grid(app), undefined);
  assert.equal(alertMessage(app), "This club link is unavailable.");
});

test("an open staff profile also refreshes quietly every 20 minutes and closes on confirmed access loss", async t => {
  let calls = 0;
  const app = harness(async () => {
    calls++;
    if (calls === 2) throw new TypeError("Failed to fetch");
    if (calls === 4) return response({ ok: false, error: "Profile unavailable." }, 403);
    return response({ ok: true, profile: { id: dancer.id } });
  }, { component: "VenueRosterProfileButton", session: { accessToken: "staff-token", account: { role: "venue" } } });
  t.after(() => app.unmount());
  await app.mount();
  assert.ok(profile(app));
  await app.advance(refreshInterval - 1);
  assert.equal(calls, 1);
  await app.advance(1);
  assert.equal(calls, 2);
  assert.ok(profile(app));
  assert.equal(find(app.render(), node => node.props?.role === "status"), undefined);
  await app.advance(refreshInterval);
  assert.equal(calls, 3);
  assert.ok(profile(app));
  await app.advance(refreshInterval);
  assert.equal(profile(app), null);
});
