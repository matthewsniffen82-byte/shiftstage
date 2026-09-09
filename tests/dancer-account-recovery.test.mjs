import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8");
const start = source.indexOf("  function beginAccountAction(", source.indexOf("function AccountControlsPanel("));
const end = source.indexOf("  async function deleteAccount(", start);
assert.ok(start > 0 && end > start);
const actions = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture() {
  const requests = [], reloads = [];
  let url = new URL("https://www.mydancr.com/dashboard/dancer#dancer-account");
  const context = vm.createContext({
    AbortController, Error,
    accountRole: "dancer", isVenueAccount: false, ownsVenueWorkspace: false,
    mountedRef: { current: true }, actionSequenceRef: { current: 0 },
    actionAbortRef: { current: null }, actionInFlightRef: { current: false },
    setIsWorking: value => { context.working = value; },
    setState: value => { context.accountState = value; },
    setStatus: value => { context.status = value; },
    requestAccountJson: options => new Promise((resolve, reject) => requests.push({ options, resolve, reject })),
    window: {
      history: { state: { preservedRouterState: true }, replaceState(state, _title, next) {
        assert.equal(state.preservedRouterState, true);
        url = new URL(next, url);
      } },
      location: {
        reload: () => reloads.push(url.pathname + url.hash),
        // Like the browser, navigating within the same document only changes
        // its fragment; it does not reload the authenticated dashboard state.
        replace(next) { url = new URL(next, url); },
      },
    },
  });
  vm.runInContext(actions, context);
  return { context, requests, reloads };
}

for (const state of ["disabled", "active"]) test(`a persisted dancer ${state} transition reloads the account even when only its fragment changes`, async () => {
  const { context, requests, reloads } = fixture();
  const action = context.updateAccount(state);
  await context.updateAccount(state);
  assert.equal(requests.length, 1);
  assert.equal(context.working, true);
  assert.deepEqual(reloads, []);
  assert.deepEqual(JSON.parse(requests[0].options.body), { accountState: state });
  requests[0].resolve({ account: { accountState: state } });
  await action;
  assert.deepEqual(reloads, [state === "disabled" ? "/dashboard/dancer#dancer-account" : "/dashboard/dancer"]);
  assert.equal(context.working, false);
});

test("a denied reactivation stays on the paused page and permits retry", async () => {
  const { context, requests, reloads } = fixture();
  const action = context.updateAccount("active");
  requests[0].reject(new Error("Contact support to restore access."));
  await action;
  assert.deepEqual(reloads, []);
  assert.equal(context.accountState, undefined);
  assert.equal(context.status, "Contact support to restore access.");
  assert.equal(context.working, false);
  assert.equal(context.actionInFlightRef.current, false);
});

test("an abandoned account update cannot reload a different page", async () => {
  const { context, requests, reloads } = fixture();
  const action = context.updateAccount("active");
  context.mountedRef.current = false;
  context.actionAbortRef.current.abort();
  requests[0].resolve({ account: { accountState: "active" } });
  await action;
  assert.deepEqual(reloads, []);
  assert.equal(context.accountState, undefined);
});
