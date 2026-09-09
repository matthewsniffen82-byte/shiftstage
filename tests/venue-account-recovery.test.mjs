import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const source = readFileSync(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const start = source.indexOf("      const loadDashboardPanels = async () =>");
const end = source.indexOf("\n    }\n\n    load();", start);
assert.ok(start > 0 && end > start);
const loader = ts.transpileModule(`async function load() {${source.slice(start, end)}}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture({ fresh = true } = {}) {
  const requests = [];
  const request = (path, options) => new Promise((resolve, reject) => requests.push({ path, options, resolve, reject }));
  const context = vm.createContext({
    controller: new AbortController(), cancelled: false, session: {},
    storedSessionIsFresh: () => fresh,
    requestAccountJson: options => request("account", options),
    requestDashboardJson: request,
    requestOptionalPanel: path => request(path),
    setState: update => { context.state = typeof update === "function" ? update(context.state) : update; },
    setIsLoading: value => { context.loading = value; },
    dashboardLoadErrorMessage: error => error.message,
    state: { account: { role: "venue", accountState: "active" }, profile: { id: "stale-venue" } }, loading: true,
  });
  vm.runInContext(loader, context);
  return { context, requests, find: path => requests.find(request => request.path === path) };
}

for (const blocked of ["failed", "pending"]) test(`verified paused venue recovery does not depend on a ${blocked} active-only request`, async () => {
  const { context, requests, find } = fixture();
  const loading = context.load();
  await settle();
  assert.ok(find("account"), "account verification starts independently of venue access");
  if (blocked === "failed") find("/api/venue/signup-requests")?.reject(new Error("Active venue account required."));
  find("account").resolve({ account: { role: "venue", accountState: "disabled" } });
  await settle();
  assert.equal(context.loading, false, "support or a blocked venue request cannot hide Reactivate");
  assert.equal(context.state.account.accountState, "disabled");
  assert.equal(context.state.error, undefined);
  assert.equal(context.state.profile, undefined, "discard cached venue tools");
  assert.ok(!requests.some(({ path }) => path === "/api/venue/profile" || path.includes("/api/venue/dashboard")));
  find("/api/support").resolve({ threads: [{ id: "own-thread" }] });
  await loading;
  assert.equal(context.state.supportThreads[0].id, "own-thread");
  find("/api/venue/signup-requests")?.resolve({ request: null });
  await settle();
  assert.equal(context.state.profile, undefined);
});

test("an active venue verifies account and request together, then loads its panels concurrently", async () => {
  const { context, requests, find } = fixture();
  const loading = context.load();
  await settle();
  assert.deepEqual(requests.map(({ path }) => path).sort(), ["/api/venue/signup-requests", "account"]);
  find("account").resolve({ account: { role: "venue", accountState: "active" } });
  find("/api/venue/signup-requests").resolve({ request: null });
  await settle();
  for (const path of ["/api/venue/profile", "/api/venue/dashboard?period=30d", "/api/support", "/api/agent/commissions?access=1"]) assert.ok(find(path));
  find("/api/venue/profile").resolve({ profile: { id: "verified-venue" } });
  find("/api/venue/dashboard?period=30d").resolve({ venueAccess: { role: "manager" } });
  find("/api/support").resolve({ threads: [] });
  find("/api/agent/commissions?access=1").resolve({ access: { active: false } });
  await loading;
  assert.equal(context.state.profile.id, "verified-venue");
  assert.equal(context.state.venueAccess.role, "manager");
  assert.equal(context.loading, false);
});

test("an expiring venue session refreshes once before any venue requests", async () => {
  const { context, requests, find } = fixture({ fresh: false });
  const loading = context.load();
  await settle();
  assert.deepEqual(requests.map(({ path }) => path), ["account"]);
  find("account").resolve({ account: { role: "venue", accountState: "active" } });
  await settle();
  find("/api/venue/signup-requests").resolve({ request: { status: "pending" } });
  await settle();
  find("/api/support").resolve({ threads: [] });
  await loading;
  assert.equal(context.state.venueRequest.status, "pending");
  assert.equal(requests.filter(({ path }) => path === "account").length, 1);
  assert.ok(!find("/api/venue/profile"));
});

for (const failedPath of ["account", "/api/venue/signup-requests"]) test(`a failed ${failedPath} cannot authorize recovery using cached account state`, async () => {
  const { context, find } = fixture();
  const loading = context.load();
  await settle();
  assert.ok(find("account"));
  find("account")[failedPath === "account" ? "reject" : "resolve"](failedPath === "account" ? new Error("Denied.") : { account: { role: "venue", accountState: "active" } });
  find("/api/venue/signup-requests")[failedPath === "account" ? "resolve" : "reject"](failedPath === "account" ? { request: null } : new Error("Denied."));
  await loading;
  assert.equal(context.state.error, "Denied.");
  assert.equal(context.state.profile, undefined);
});

test("abandoning paused venue loading prevents late account and support updates", async () => {
  const { context, find } = fixture();
  const loading = context.load();
  await settle();
  assert.ok(find("account"));
  context.cancelled = true;
  context.controller.abort();
  find("account").resolve({ account: { role: "venue", accountState: "disabled" } });
  find("/api/venue/signup-requests").resolve({ request: null });
  await loading;
  assert.equal(context.state.account.accountState, "active");
  assert.equal(context.loading, true);
});

test("late support cannot update a paused account after leaving the dashboard", async () => {
  const { context, find } = fixture();
  const loading = context.load();
  find("account").resolve({ account: { role: "venue", accountState: "disabled" } });
  await settle();
  assert.equal(context.loading, false);
  context.cancelled = true;
  context.controller.abort();
  find("/api/support").resolve({ threads: [{ id: "late-thread" }] });
  find("/api/venue/signup-requests").resolve({ request: null });
  await loading;
  assert.equal(context.state.supportThreads, undefined);
});

test("paused venues do not start live refresh requests, listeners, or timers", () => {
  const begin = source.indexOf('  useEffect(() => {\n    if (role !== "venue" || isLoading');
  const end = source.indexOf('\n\n  useEffect(', begin);
  assert.ok(begin > 0 && end > begin);
  const effect = source.slice(begin, end);
  const body = ts.transpileModule(effect, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  let cleanup;
  vm.runInNewContext(body, {
    useEffect: fn => { cleanup = fn(); }, role: "venue", isLoading: false,
    state: { account: { accountState: "disabled" } }, analyticsPeriod: "30d",
    refreshVenueDashboard: () => assert.fail("paused venue must not refresh"),
    window: { setInterval: () => assert.fail("paused venue must not poll") },
    document: { addEventListener: () => assert.fail("paused venue must not refresh on focus") },
  });
  assert.equal(cleanup, undefined);
});

for (const supportThreads of [undefined, []]) test(`paused venue rendering shows recovery with ${supportThreads ? "ready" : "loading"} support and no active venue tools`, () => {
  const require = createRequire(import.meta.url), exports = {};
  let stateIndex = 0;
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, require: name => {
    if (name === "react") return { ...React, useState(initial) {
      const index = stateIndex++;
      return React.useState(index === 0 ? { account: { role: "venue", accountState: "disabled", email: "fixture@example.test" }, agentAccess: { active: true }, supportThreads } : index === 1 ? false : initial);
    } };
    if (name === "react/jsx-runtime") return require(name);
    if (name === "next/dynamic") return { default: () => () => null };
    return new Proxy(() => null, { get: (_target, key) => key === "__esModule" ? false : () => null });
  } });
  const html = renderToStaticMarkup(React.createElement(exports.default, { role: "venue" })).replace(/<style>[\s\S]*?<\/style>/g, "");
  assert.match(html, /Account paused/);
  assert.match(html, /id="venue-account"[^>]*open=""/);
  assert.match(html, />Reactivate<\/button>/);
  assert.match(html, /fixture@example.test/);
  if (supportThreads) assert.match(html, /id="venue-support"/);
  else {
    assert.match(html, /Loading support…/);
    assert.doesNotMatch(html, /Send message/, "do not offer a new thread while a stale initial list can overwrite it");
  }
  assert.doesNotMatch(html, /venue-workspace-tabs|venue-dancer-roster|id="venue-team"|agent-dashboard-shortcut/);
  assert.doesNotMatch(html, /Delete my team account|Reactivate venue account/, "unknown membership must not be presented as verified ownership or team membership");
});
