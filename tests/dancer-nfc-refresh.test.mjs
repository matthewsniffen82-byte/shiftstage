import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { dancerCheckInState } from "../src/lib/dancr/dancer-check-in-state.ts";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../app/dashboard/DancerNfcPanel.tsx", import.meta.url), "utf8");
const script = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function find(node, predicate) {
  if (!node || typeof node !== "object") return null;
  if (predicate(node)) return node;
  for (const child of [node.props?.children].flat(Infinity)) {
    const match = find(child, predicate);
    if (match) return match;
  }
  return null;
}

// Invoke the component's refresh handler with a mocked API; no browser or server.
function fixture(respond, props = {}) {
  const states = [], refs = [], requests = [];
  let stateIndex = 0, refIndex = 0, mount;
  const exports = {};
  vm.runInNewContext(script, { exports, AbortController, DOMException, Error, require: name => {
    if (name === "react") return {
      useState(initial) {
        const index = stateIndex++;
        if (!(index in states)) states[index] = initial;
        return [states[index], value => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
      },
      useRef(initial) { return refs[refIndex++] ||= { current: initial }; },
      useEffect(callback) { mount = callback; },
    };
    if (name === "react/jsx-runtime") return require(name);
    if (name === "../components/RefreshButton" || name === "../components/NfcIcon") return { default: () => null };
    if (name === "@/src/lib/dancr/visibility-mode") return { VISIBILITY_OPTIONS: [] };
    if (name === "@/src/lib/dancr/dancer-check-in-state") return { dancerCheckInState };
    if (name === "./dashboard-session") return { requestDancerVenueVerificationJson: async options => {
      requests.push(options);
      return respond();
    } };
    throw new Error(`Unexpected dependency: ${name}`);
  } });
  const tree = () => { stateIndex = refIndex = 0; return exports.default({ onboarding: true, ...props }); };
  tree();
  const unmount = mount();
  return {
    requests, unmount,
    refresh: () => find(tree(), node => node.props?.className === "dancer-nfc-refresh").props.onClick(),
    status: () => find(tree(), node => node.props?.role === "status")?.props.children || "",
    busy: () => find(tree(), node => node.props?.className === "dancer-nfc-refresh").props.busy,
  };
}

test("checking status without a tap reports no tap and only reads the API", async () => {
  const f = fixture(async () => ({ affiliations: [], enrollment: null, clubApprovals: [], profileAuthorization: { authorized: false } }));
  assert.equal(f.status(), "");
  const refreshing = f.refresh();
  assert.equal(f.busy(), true);
  await refreshing;
  assert.match(f.status(), /No club tap found\. Tap the club’s check-in tag/);
  assert.equal(f.busy(), false);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].method, undefined);
  assert.equal(f.requests[0].body, undefined);
  assert.equal(f.requests[0].cache, "no-store");
});

for (const data of [
  { enrollment: { status: "pending" } },
  { enrollment: { status: "expired" } },
  { clubApprovals: [{ status: "pending", venue: { id: "club" } }] },
  { clubApprovals: [{ status: "rejected", venue: { id: "club" } }] },
  { clubApprovals: [{ status: "approved", venue: { id: "club" } }] },
]) test(`an unactivated profile with ${JSON.stringify(data)} is not reported as activated`, async () => {
  const f = fixture(async () => ({ ...data, profileAuthorization: { authorized: false } }));
  await f.refresh();
  assert.doesNotMatch(f.status(), /Profile activation confirmed|Working Now is active/);
});

for (const data of [
  { profileAuthorization: { authorized: true, profileStatus: "approved" } },
]) test(`activation requires affirmative server state: ${JSON.stringify(data)}`, async () => {
  const f = fixture(async () => data);
  await f.refresh();
  assert.match(f.status(), /Approved—tap again to check in/);
});

test("revoked access is not mistaken for an account that never tapped", async () => {
  const f = fixture(async () => ({ affiliations: [{ status: "revoked" }] }));
  await f.refresh();
  assert.match(f.status(), /No completed check-in found/);
});

test("the refresh message uses fresh state instead of previously active access", async () => {
  const f = fixture(async () => ({ affiliations: [], profileAuthorization: { authorized: false } }), {
    initialAffiliations: [{ status: "active" }], initialNfcState: { profileAuthorization: { authorized: true } },
  });
  await f.refresh();
  assert.match(f.status(), /No club tap found\./);
});

test("a failed check reports the error instead of claiming there is no tap", async () => {
  const f = fixture(async () => { throw new Error("Unable to refresh venue access."); });
  await f.refresh();
  assert.equal(f.status(), "Unable to refresh venue access.");
  assert.equal(f.busy(), false);
});

test("a stale refresh cannot overwrite the latest activation status", async () => {
  const responses = [];
  const f = fixture(() => new Promise(resolve => responses.push(resolve)));
  const first = f.refresh(), second = f.refresh();
  assert.equal(f.requests[0].signal.aborted, true);
  responses[1]({ affiliations: [], enrollment: null });
  await second;
  responses[0]({ profileAuthorization: { authorized: true } });
  await first;
  assert.match(f.status(), /No club tap found\./);
});
