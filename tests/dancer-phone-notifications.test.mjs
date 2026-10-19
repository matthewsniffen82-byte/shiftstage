import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../app/dashboard/DashboardPhoneNotifications.tsx", import.meta.url), "utf8");
const script = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const settle = () => new Promise(resolve => setImmediate(resolve));

function fixture(props = {}, preferences = async () => ({ userId: "venue-one", settings: { alertsEnabled: true, pushEnabled: true } })) {
  let state = null, effect;
  let account = { id: `${props.role || "dancer"}-one`, role: props.role || "dancer" };
  const events = new Map(), requests = [];
  const exports = {};
  vm.runInNewContext(script, { exports, window: {
    addEventListener: (name, listener) => events.set(name, listener),
    removeEventListener: (name, listener) => { if (events.get(name) === listener) events.delete(name); },
  }, require: name => {
    if (name === "react") return { useState: () => [state, value => { state = value; }], useEffect: callback => { effect = callback; } };
    if (name === "react/jsx-runtime") return require(name);
    if (name === "./dashboard-session") return { readSession: () => ({ account }), requestDashboardJson: preferences };
    if (name.endsWith(".css")) return {};
    if (name.endsWith("/customer-push")) return { customerPushDeviceEnabled: id => new Promise(resolve => requests.push({ id, resolve })) };
    throw new Error(`Unexpected dependency: ${name}`);
  } });
  const render = () => renderToStaticMarkup(exports.default(props));
  return { requests, events, render, mount() { render(); return effect(); }, switchAccount(value) { account = value; } };
}

test("the overview card explains email delivery and hides only after enrollment is confirmed", async () => {
  const f = fixture();
  assert.equal(f.render(), "");
  const close = f.mount();
  assert.equal(f.requests[0].id, "dancer-one");
  f.requests[0].resolve(false); await settle();
  assert.match(f.render(), /data-push-settings="true">Enable notifications/);
  assert.match(f.render(), /Get alerts for table and VIP requests/);
  assert.match(f.render(), /also receive them by email/);
  f.events.get("mydancr:push-changed")();
  f.requests[1].resolve(true); await settle();
  assert.equal(f.render(), "");
  close();
  assert.equal(f.events.size, 0);
});

test("stale device checks and checks for a previous account cannot overwrite the current status", async () => {
  const f = fixture(), close = f.mount();
  f.events.get("focus")();
  f.requests[1].resolve(false); await settle();
  f.requests[0].resolve(true); await settle();
  assert.match(f.render(), /data-push-settings="true">Enable notifications/);
  f.events.get("pageshow")();
  f.switchAccount({ id: "dancer-two", role: "dancer" });
  f.requests[2].resolve(true); await settle();
  assert.equal(f.render(), "");
  f.events.get("storage")();
  assert.equal(f.requests[3].id, "dancer-two");
  close();
  f.requests[3].resolve(true); await settle();
  assert.equal(f.render(), "");
});

test("overview setup precedes working tools in both dashboards while Account retains management", () => {
  const panel = readFileSync(new URL("../app/dashboard/DancerDashboardPanels.tsx", import.meta.url), "utf8");
  assert.match(panel, /overview=\{<>\s*<DashboardPhoneNotifications \/>\s*<DancerAgeVerificationGate><section className="dancer-daily-card" id="dancer-schedule"/);
  assert.doesNotMatch(panel.slice(panel.indexOf("const accountTools"), panel.indexOf("return <>", panel.indexOf("const accountTools"))), /DashboardPhoneNotifications/);
  const venue = readFileSync(new URL("../app/dashboard/VenueDashboardPanels.tsx", import.meta.url), "utf8");
  assert.match(venue, /<VenueTonightOverview[^>]*notificationPrompt=\{<DashboardPhoneNotifications role="venue" refreshKey=\{notificationRevision\} \/>\}/);
  assert.match(venue, /<VenueNotificationSettings onSaved=\{\(\) => setNotificationRevision/);
  assert.doesNotMatch(venue, /offerPushNotifications\("venue-dashboard"\)/);
  const client = readFileSync(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8");
  assert.match(client, /<DancerNotificationSettings showPhoneDelivery=\{dancerProfileStatus !== "approved"\} \/>/);
  const settings = readFileSync(new URL("../app/dashboard/DancerNotificationSettings.tsx", import.meta.url), "utf8");
  assert.match(settings, /<\/div> : <button[^>]*data-push-settings>Manage phone notifications<\/button>/);
});

for (const role of ["dancer", "venue"]) test(`${role} overview hides while checking and after enabling, and returns after disabling`, async () => {
  const f = fixture({ role }), close = f.mount();
  assert.equal(f.render(), "");
  f.requests[0].resolve(false); await settle();
  assert.match(f.render(), /data-push-settings="true">Enable notifications/);
  assert.match(f.render(), /table and VIP requests/);
  if (role === "dancer") assert.match(f.render(), /also receive them by email/);
  else assert.match(f.render(), /Manage email alerts and request preferences/);
  f.events.get("mydancr:push-changed")();
  f.requests[1].resolve(true); await settle();
  assert.equal(f.render(), "");
  f.events.get("mydancr:push-changed")();
  f.requests[2].resolve(false); await settle();
  assert.match(f.render(), /data-push-settings="true">Enable notifications/);
  close();
});

for (const settings of [{ alertsEnabled: false, pushEnabled: true }, { alertsEnabled: true, pushEnabled: false }, null]) {
  test(`an enrolled venue device still needs enabled saved preferences: ${JSON.stringify(settings)}`, async () => {
    const f = fixture({ role: "venue" }, async () => {
      if (!settings) throw new Error("Temporary failure");
      return { userId: "venue-one", settings };
    }), close = f.mount();
    f.requests[0].resolve(true); await settle();
    assert.match(f.render(), /href="#venue-notification-settings">Review settings/);
    assert.doesNotMatch(f.render(), /data-push-settings/);
    close();
  });
}

test("late venue preference responses cannot show another account's status", async () => {
  let respond;
  const f = fixture({ role: "venue" }, () => new Promise(resolve => { respond = resolve; }));
  const close = f.mount();
  f.requests[0].resolve(true); await settle();
  f.switchAccount({ id: "venue-two", role: "venue" });
  respond({ userId: "venue-one", settings: { alertsEnabled: false, pushEnabled: false } }); await settle();
  assert.equal(f.render(), "");
  close();
});
