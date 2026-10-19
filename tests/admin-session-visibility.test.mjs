import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as adminSession from "../app/admin/admin-session.ts";
import * as browserSession from "../src/lib/dancr/browser-session.ts";
import * as dataEvents from "../app/admin/admin-data-events.ts";

const source = readFileSync(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8");
const boundary = source.indexOf("  const needsSignIn =");
assert.ok(boundary > 0);
// Execute the actual shell lifecycle and loaders; omit its unrelated JSX tree.
const compiled = ts.transpileModule(source.slice(0, boundary) + "\nreturn { loadAdmin, loadWorkspaceData }; }", {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const key = browserSession.BROWSER_AUTH_SESSION_KEY;
const original = { accessToken: "admin-access", refreshToken: "admin-refresh", account: { id: "admin-a", role: "admin" } };
const newer = { accessToken: "customer-access", refreshToken: "customer-refresh", account: { id: "customer-b", role: "customer" } };
const settle = () => new Promise(resolve => setImmediate(resolve));

function fixture(initial = original) {
  const previousWindow = globalThis.window, previousFetch = globalThis.fetch;
  const stored = new Map([[key, JSON.stringify(initial)]]), states = [], effects = [], listeners = new Map(), pending = [], navigations = [];
  const localStorage = {
    getItem: name => stored.get(name) ?? null,
    setItem: (name, value) => stored.set(name, value),
    removeItem: name => stored.delete(name),
  };
  const window = {
    localStorage, sessionStorage: { getItem: () => null, removeItem() {} },
    location: { reload: () => navigations.push("reload"), replace: path => navigations.push(path) },
    addEventListener(name, listener) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(listener); },
    removeEventListener(name, listener) { listeners.get(name)?.delete(listener); },
    setTimeout, clearTimeout,
  };
  globalThis.window = window;
  globalThis.fetch = (path, options) => new Promise(resolve => pending.push({ path, options, resolve }));
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, window, AbortController, setTimeout, clearTimeout,
    readPersistedOpenApprovals: () => ({}),
    require(name) {
      if (name === "react") return {
        useState(initialValue) { const index = states.length; states.push(initialValue); return [initialValue, value => { states[index] = typeof value === "function" ? value(states[index]) : value; }]; },
        useRef: current => ({ current }), useEffect: effect => effects.push(effect),
      };
      if (name === "./admin-session") return adminSession;
      if (name === "./admin-data-events") return dataEvents;
      if (name.includes("browser-session")) return browserSession;
      return {};
    },
  });
  const shell = exports.default();
  const cleanups = effects.map(effect => effect());
  const respond = async () => {
    for (const request of pending.splice(0)) request.resolve(new Response(JSON.stringify({
      ok: true, monitoring: { marker: "private-admin-data" }, operations: { marker: "private-operations" },
      venues: [{ id: "private-venue" }],
    }), { headers: { "content-type": "application/json" } }));
    await settle();
  };
  return {
    shell, stored, pending, navigations, listeners, state: () => states[4], respond,
    event(name, detail = {}) { for (const listener of listeners.get(name) || []) listener({ storageArea: localStorage, ...detail }); },
    async close() { for (const cleanup of cleanups) cleanup?.(); await respond(); globalThis.window = previousWindow; globalThis.fetch = previousFetch; },
  };
}

for (const event of ["storage", "pageshow", "focus"]) {
  test(`admin data is cleared when ${event} detects logout or an account switch`, async () => {
    const f = fixture();
    try {
      await f.respond();
      assert.equal(f.state().monitoring.marker, "private-admin-data");
      f.stored.set(key, JSON.stringify(newer));
      f.event(event, { key });
      assert.equal(f.state().monitoring, undefined, "cached admin data must leave the shell");
      assert.equal(f.state().authRequired, true);
      assert.ok(f.navigations.length > 0, "remount child workspaces under the current session");
      assert.equal(f.stored.get(key), JSON.stringify(newer), "never revoke the new account");
    } finally { await f.close(); }
  });
}

test("cross-tab logout cancels a pending admin load and its late response cannot restore data", async () => {
  const f = fixture();
  try {
    const requests = [...f.pending];
    assert.equal(requests.length, 2);
    f.stored.delete(key);
    f.event("storage", { key });
    assert.ok(requests.every(request => request.options.signal.aborted));
    await f.respond();
    assert.equal(f.state().monitoring, undefined);
    assert.equal(f.state().authRequired, true);
  } finally { await f.close(); }
});

test("same-account token refresh and unrelated storage events preserve the admin workspace", async () => {
  const f = fixture();
  try {
    await f.respond();
    f.stored.set(key, JSON.stringify({ ...original, accessToken: "refreshed-access", refreshToken: "refreshed-refresh" }));
    f.event("storage", { key });
    f.event("storage", { key: "unrelated-preference" });
    assert.equal(f.state().monitoring.marker, "private-admin-data");
    assert.equal(f.navigations.length, 0);
  } finally { await f.close(); }
});

test("opening admin while signed in as a customer preserves that account and sends no admin request", async () => {
  const f = fixture(newer);
  try {
    await settle();
    assert.equal(f.pending.length, 0);
    assert.equal(f.state().authRequired, true);
    assert.equal(f.stored.get(key), JSON.stringify(newer));
  } finally { await f.close(); }
});

test("successful actions refresh counts without resetting workspace data and ignore late results after an account switch", async () => {
  const f = fixture();
  try {
    await f.respond();
    f.event(dataEvents.ADMIN_DATA_CHANGED); f.event(dataEvents.ADMIN_DATA_CHANGED);
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(f.pending.length, 1, 'rapid actions share one count refresh');
    const request = f.pending.shift(); assert.equal(request.path, '/api/admin/operations');
    request.resolve(Response.json({ ok: true, operations: { marker: 'updated', attention: { total: 2 } } })); await settle();
    assert.equal(f.state().operations.marker, 'updated'); assert.equal(f.state().monitoring.marker, 'private-admin-data');
    f.event(dataEvents.ADMIN_DATA_CHANGED); await new Promise(resolve => setTimeout(resolve, 300));
    const late = f.pending.shift();
    f.stored.set(key, JSON.stringify(newer)); f.event('storage', { key });
    late.resolve(Response.json({ ok: true, operations: { marker: 'late', attention: { total: 1 } } })); await settle();
    assert.equal(f.state().authRequired, true); assert.equal(f.state().operations, undefined);
  } finally { await f.close(); }
});
