import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/dancr/customer-push.ts", import.meta.url), "utf8");
function fixture({ permission = "granted", delayedId = false, userAgent = "Edge" } = {}) {
  const events = [], stored = new Map(), listeners = new Set();
  const subscription = {
    optedIn: false, id: undefined,
    async optIn() {
      events.push("optIn"); subscription.optedIn = true;
      if (delayedId) setTimeout(() => { subscription.id = "subscription-id"; for (const listener of listeners) listener(); }, 10);
      else subscription.id = "subscription-id";
    },
    async optOut() { events.push("optOut"); subscription.optedIn = false; },
    addEventListener(_event, listener) { listeners.add(listener); },
    removeEventListener(_event, listener) { listeners.delete(listener); },
  };
  const sdk = {
    async init(options) { events.push({ init: options }); },
    async login(id) { events.push({ login: id }); },
    async logout() { events.push("logout"); },
    Notifications: { isPushSupported: () => true },
    User: { PushSubscription: subscription },
  };
  const Notification = { permission: "default", async requestPermission() { events.push("permission"); Notification.permission = permission; return permission; } };
  const localStorage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) };
  const navigator = { userAgent, serviceWorker: {
    async getRegistration(scope) {
      assert.equal(scope, "/push/onesignal/");
      return { scope: "https://mydancr.com/push/onesignal/", pushManager: { async getSubscription() { return { async unsubscribe() { events.push("unsubscribe"); } }; } } };
    },
  } };
  const window = { Notification, PushManager: {}, navigator, localStorage, isSecureContext: true, matchMedia: () => ({ matches: false }), setTimeout, clearTimeout };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, window, navigator, Notification, localStorage,
    document: { getElementById: () => null, createElement: () => ({}), head: {
      appendChild(script) {
        events.push({ script: script.src });
        for (const callback of window.OneSignalDeferred) void callback(sdk);
      },
    } },
  });
  return { ...exports, events, stored, subscription, listeners, Notification };
}
const delivery = { pushAvailable: true, pushAppId: "public-app", pushExternalId: "opaque-own-customer-alias" };

test("push enrollment requests consent before SDK loading and confirms the subscription before success", async () => {
  const f = fixture({ delayedId: true });
  await f.enableCustomerPush(delivery, "customer", () => {});
  assert.equal(f.events[0], "permission");
  assert.equal(f.events.find(event => event.init).init.serviceWorkerParam.scope, "/push/onesignal/");
  assert.equal(f.events.find(event => event.init).init.autoResubscribe, false);
  assert.equal(f.events.find(event => event.login).login, "opaque-own-customer-alias");
  assert.equal(f.stored.get("mydancr:push-account"), "customer");
  assert.equal(f.listeners.size, 0);
  assert.equal(await f.customerPushDeviceEnabled("customer"), true);
  assert.equal(await f.customerPushDeviceEnabled("someone-else"), false);
  await f.disableCustomerPush();
  assert.ok(f.events.includes("unsubscribe"));
  assert.ok(f.events.includes("logout"));
  assert.equal(f.stored.size, 0);
});

for (const permission of ["denied", "default"]) test("push stays off when permission is " + permission, async () => {
  const f = fixture({ permission });
  await assert.rejects(f.enableCustomerPush(delivery, "customer", () => {}), /stays off/);
  assert.deepEqual(f.events, ["permission"]);
  assert.equal(f.stored.size, 0);
});

test("missing configuration and unsupported iPhone browser never request permission or enroll", async () => {
  const missing = fixture();
  await assert.rejects(missing.enableCustomerPush({}, "customer", () => {}), /not available/);
  assert.deepEqual(missing.events, []);
  const iphone = fixture({ userAgent: "iPhone" });
  await assert.rejects(iphone.enableCustomerPush(delivery, "customer", () => {}), /Home Screen/);
  assert.deepEqual(iphone.events, []);
});

test("a changed session cannot enroll after the permission prompt completes", async () => {
  const f = fixture();
  await assert.rejects(f.enableCustomerPush(delivery, "customer", () => { throw new Error("Session changed"); }), /Session changed/);
  assert.deepEqual(f.events, ["permission"]);
  assert.equal(f.stored.size, 0);
});

test("native sign-out cleanup works after a refresh without loading a third-party SDK", async () => {
  const f = fixture();
  f.stored.set("mydancr:push-account", "customer");
  await f.disableCustomerPush();
  assert.deepEqual(f.events, ["unsubscribe"]);
  assert.equal(f.stored.size, 0);
});
