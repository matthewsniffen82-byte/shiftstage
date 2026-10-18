import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../app/dashboard/DancerPhoneNotifications.tsx", import.meta.url), "utf8");
const script = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const settle = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
  let state = null, effect;
  let account = { id: "dancer-one", role: "dancer" };
  const events = new Map(), requests = [];
  const exports = {};
  vm.runInNewContext(script, { exports, window: {
    addEventListener: (name, listener) => events.set(name, listener),
    removeEventListener: (name, listener) => { if (events.get(name) === listener) events.delete(name); },
  }, require: name => {
    if (name === "react") return { useState: () => [state, value => { state = value; }], useEffect: callback => { effect = callback; } };
    if (name === "react/jsx-runtime") return require(name);
    if (name === "./dashboard-session") return { readSession: () => ({ account }) };
    if (name.endsWith("/customer-push")) return { customerPushDeviceEnabled: id => new Promise(resolve => requests.push({ id, resolve })) };
    throw new Error(`Unexpected dependency: ${name}`);
  } });
  const render = () => renderToStaticMarkup(exports.default());
  return { requests, events, render, mount() { render(); return effect(); }, switchAccount(value) { account = value; } };
}

test("the priority card explains email delivery and only calls confirmed enrolled devices enabled", async () => {
  const f = fixture();
  assert.match(f.render(), /Checking phone notifications/);
  assert.doesNotMatch(f.render(), /Phone notifications are enabled/);
  const close = f.mount();
  assert.equal(f.requests[0].id, "dancer-one");
  f.requests[0].resolve(false); await settle();
  assert.match(f.render(), /data-push-settings="true">Enable notifications/);
  assert.match(f.render(), /Get phone notifications for table and VIP requests/);
  assert.match(f.render(), /Table and VIP requests are also sent to your account email/);
  assert.match(f.render(), /Turn on notifications for your email app/);
  f.events.get("mydancr:push-changed")();
  f.requests[1].resolve(true); await settle();
  assert.match(f.render(), /Phone notifications are enabled on this device/);
  assert.match(f.render(), /data-push-settings="true">Manage notifications/);
  close();
  assert.equal(f.events.size, 0);
});

test("stale device checks and checks for a previous account cannot overwrite the current status", async () => {
  const f = fixture(), close = f.mount();
  f.events.get("focus")();
  f.requests[1].resolve(false); await settle();
  f.requests[0].resolve(true); await settle();
  assert.match(f.render(), /Phone notifications are off on this device/);
  f.events.get("pageshow")();
  f.switchAccount({ id: "dancer-two", role: "dancer" });
  f.requests[2].resolve(true); await settle();
  assert.doesNotMatch(f.render(), /Phone notifications are enabled/);
  f.events.get("storage")();
  assert.equal(f.requests[3].id, "dancer-two");
  close();
  f.requests[3].resolve(true); await settle();
  assert.doesNotMatch(f.render(), /Phone notifications are enabled/);
});

test("phone setup is the first Account section and is not duplicated below the activity preferences", () => {
  const panel = readFileSync(new URL("../app/dashboard/DancerDashboardPanels.tsx", import.meta.url), "utf8");
  assert.match(panel, /const accountTools = <>\s*<DancerPhoneNotifications \/>\s*<DashboardSection id="dancer-connected-clubs"/);
  const client = readFileSync(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8");
  assert.match(client, /<DancerNotificationSettings showPhoneDelivery=\{dancerProfileStatus !== "approved"\} \/>/);
});
