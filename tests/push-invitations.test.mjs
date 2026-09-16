import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../public/mydancr-push-invitations.js", import.meta.url), "utf8");
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture({ role = "customer", configured = true, enabled = false, support = "", permission = "default", failSave = false, failEnroll = false } = {}) {
  const stored = new Map(), calls = [], listeners = {}, nodes = [];
  let now = 1_000_000_000;
  const auth = { accessToken: "synthetic", account: { id: "account-one", role } };
  stored.set("dancrAuthSessionV1", JSON.stringify(auth));
  const storage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) };
  const window = { Notification: { permission }, addEventListener: (name, fn) => { (listeners[name] ||= []).push(fn); },
    dispatchEvent: event => { for (const fn of listeners[event.type] || []) fn(event); } };
  function element(tag) { return { tag, children: [], disabled: false, hidden: false,
    append(...items) { this.children.push(...items); }, setAttribute() {}, remove() { nodes.splice(nodes.indexOf(this), 1); } }; }
  const device = {
    customerPushDeviceEnabled: async () => enabled,
    customerPushSupportMessage: () => support,
    async enableCustomerPush(delivery, userId, guard) {
      calls.push("permission"); guard();
      if (failEnroll) throw new Error("Permission was not granted.");
      calls.push("subscription"); enabled = true;
    },
    async disableCustomerPush() { enabled = false; calls.push("unsubscribe"); },
  };
  const context = {
    window, localStorage: storage, Map, AbortSignal,
    Date: { now: () => now }, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    document: { currentScript: { dataset: { deviceModule: "/device.js" } }, createElement: element,
      body: { append: node => nodes.push(node) }, addEventListener() {} },
    loadDevice: async () => { calls.push("device-module"); return device; },
    fetch: async (url, init) => {
      calls.push({ url, ...init });
      if (url === "/api/notifications") return Response.json({ ok: true, pushUserId: "account-one", notificationDelivery: { pushAvailable: configured } });
      return Response.json(failSave ? { ok: false, error: "Save failed" } : { ok: true, profile: { userId: "account-one", notificationSettings: { pushEnabled: true } } }, { status: failSave ? 503 : 200 });
    },
  };
  // Replace only the module-loading boundary; execute the shipped UI and policy.
  const run = () => vm.runInNewContext(source.replace("import(deviceUrl)", "loadDevice(deviceUrl)"), context);
  run();
  return { calls, nodes, stored, window, run, context,
    offer: async moment => { window.dispatchEvent({ type: "mydancr:push-invitation", detail: { moment } }); await tick(); },
    advance: minutes => { now += minutes * 60_000; },
    card: () => nodes[0],
    buttons: () => nodes[0]?.children[2].children,
  };
}

test("page entry loads no device module, configuration or permission prompt", () => {
  const f = fixture(); assert.equal(f.nodes.length, 0); assert.equal(f.calls.length, 0);
});
for (const [role, moment, words] of [
  ["customer", "customer-follow", /favorites/], ["customer", "customer-pickup", /pickup/],
  ["dancer", "dancer-review", /profile/], ["dancer", "dancer-shift", /account/],
  ["venue", "venue-dashboard", /venue/], ["venue", "venue-live", /live/],
  ["venue", "venue-pickup", /ride/], ["venue", "venue-chat", /reply/],
]) test(`${moment} offers context without requesting browser permission`, async () => {
  const f = fixture({ role }); await f.offer(moment);
  assert.match(f.card().children[0].textContent, words);
  assert.equal(f.buttons()[0].textContent, "Enable notifications");
  assert.equal(f.buttons()[1].textContent, "Not now");
  assert.ok(!f.calls.includes("permission"));
});
test("only an explicit tap enrolls; customer preference saves after subscription confirmation", async () => {
  const f = fixture(); await f.offer("customer-pickup");
  await f.buttons()[0].onclick();
  assert.ok(f.calls.indexOf("permission") < f.calls.indexOf("subscription"));
  const save = f.calls.findIndex(call => call.url === "/api/customer/profile");
  assert.ok(save > f.calls.indexOf("subscription"));
  assert.deepEqual(JSON.parse(f.calls[save].body), { notificationSettings: { pushEnabled: true } });
  assert.equal(f.buttons()[0].hidden, true);
  assert.match(f.card().children[1].textContent, /enabled on this device/);
});
test("professionals enroll without changing customer preferences", async () => {
  const f = fixture({ role: "venue" }); await f.offer("venue-chat"); await f.buttons()[0].onclick();
  assert.ok(f.calls.includes("subscription"));
  assert.ok(!f.calls.some(call => call.url === "/api/customer/profile"));
});
test("dismissals survive reload; a later pickup can offer again without nagging", async () => {
  const f = fixture(); await f.offer("customer-follow"); f.buttons()[1].onclick();
  await f.offer("customer-follow"); assert.equal(f.nodes.length, 0);
  await f.offer("customer-pickup"); assert.equal(f.nodes.length, 0);
  f.advance(11); await f.offer("customer-pickup"); assert.equal(f.nodes.length, 1);
  f.buttons()[1].onclick();
  delete f.window.mydancrPushInvitationsInstalled; f.run();
  f.advance(1500); await f.offer("customer-follow"); await f.offer("customer-pickup");
  assert.equal(f.nodes.length, 0);
});
test("venue chat offers again later after dismissal during setup", async () => {
  const f = fixture({ role: "venue" }); await f.offer("venue-dashboard"); f.buttons()[1].onclick();
  f.advance(11); await f.offer("venue-chat"); assert.equal(f.nodes.length, 1);
});
for (const options of [{ enabled: true }, { configured: false }, { support: "Push is unsupported." }, { permission: "denied" }, { role: "admin" }]) {
  test(`unavailable, already enabled and excluded accounts do not receive automatic invitations: ${JSON.stringify(options)}`, async () => {
    const f = fixture(options); await f.offer("customer-pickup"); assert.equal(f.nodes.length, 0);
    assert.ok(!f.calls.includes("permission"));
  });
}
test("guests and wrong roles never enroll under another account", async () => {
  const f = fixture({ role: "dancer" }); await f.offer("customer-pickup"); assert.equal(f.nodes.length, 0);
  f.stored.delete("dancrAuthSessionV1"); await f.offer("dancer-review"); assert.equal(f.calls.length, 0);
});
test("iPhone installation guidance has no working permission button", async () => {
  const f = fixture({ support: "Add MyDancr to your Home Screen, then open it there to enable push." });
  await f.offer("customer-pickup"); assert.match(f.card().children[1].textContent, /Home Screen/);
  assert.equal(f.buttons()[0].disabled, true);
});
test("a changed account closes a pending invitation without permission or preference writes", async () => {
  const f = fixture(); await f.offer("customer-pickup");
  f.stored.set("dancrAuthSessionV1", JSON.stringify({ accessToken: "other", account: { id: "account-two", role: "customer" } }));
  await f.buttons()[0].onclick(); assert.equal(f.nodes.length, 0);
  assert.ok(!f.calls.includes("permission"));
});
for (const options of [{ failSave: true }, { failEnroll: true }]) test(`failed enrollment rolls back device registration: ${JSON.stringify(options)}`, async () => {
  const f = fixture(options); await f.offer("customer-pickup"); await f.buttons()[0].onclick();
  assert.ok(f.calls.includes("unsubscribe")); assert.equal(f.buttons()[0].hidden, false);
  assert.doesNotMatch(f.card().children[1].textContent, /enabled on this device/);
});
test("manual settings remain available after dismissal and can disable this device", async () => {
  const f = fixture({ role: "venue", enabled: true }); await f.offer("settings");
  assert.equal(f.buttons()[0].textContent, "Disable on this device"); await f.buttons()[0].onclick();
  assert.ok(f.calls.includes("unsubscribe"));
});

test("unconfigured manual settings explain the fallback without offering enrollment", async () => {
  const f = fixture({ configured: false }); await f.offer("settings");
  assert.match(f.card().children[1].textContent, /currently unavailable.*Check MyDancr/);
  assert.equal(f.buttons().length, 1);
  assert.equal(f.buttons()[0].textContent, "Close");
  assert.ok(!f.calls.includes("permission"));
  f.buttons()[0].onclick();
  assert.equal(f.nodes.length, 0);
});

test("a subscribed device can still opt out while the provider is unavailable", async () => {
  const f = fixture({ role: "venue", configured: false, enabled: true }); await f.offer("settings");
  assert.match(f.card().children[1].textContent, /currently unavailable.*turn off/);
  assert.doesNotMatch(f.card().children[1].textContent, /are enabled/);
  assert.equal(f.buttons()[0].textContent, "Disable on this device");
  await f.buttons()[0].onclick();
  assert.ok(f.calls.includes("unsubscribe"));
  assert.ok(!f.calls.includes("permission"));
});
test("the discovery module is generated from the same enrollment implementation as the dashboards", () => {
  const input = readFileSync(new URL("../src/lib/dancr/customer-push.ts", import.meta.url), "utf8");
  const expected = "// Generated from src/lib/dancr/customer-push.ts. Do not edit.\n" + ts.transpileModule(input, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  assert.equal(readFileSync(new URL("../public/mydancr-push-device.js", import.meta.url), "utf8").replaceAll("\r\n", "\n"), expected.replaceAll("\r\n", "\n"));
});
