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

function fixture(props = {}, preferences = async () => ({ userId: "venue-one", settings: { alertsEnabled: true, pushEnabled: true } }), options = {}) {
  const states = [], refs = [];
  let stateIndex = 0, refIndex = 0, effect, cleanup;
  let account = { id: `${props.role || "dancer"}-one`, role: props.role || "dancer" };
  const events = new Map(), requests = [], calls = [];
  const exports = {};
  vm.runInNewContext(script, { exports, AbortController, Error, CustomEvent: class {
    constructor(type, init) { this.type = type; this.detail = init.detail; }
  }, window: {
    addEventListener: (name, listener) => events.set(name, listener),
    removeEventListener: (name, listener) => { if (events.get(name) === listener) events.delete(name); },
    dispatchEvent: event => { calls.push({ event }); events.get(event.type)?.(event); },
  }, require: name => {
    if (name === "react") return {
      useState(initial) { const index = stateIndex++; if (!(index in states)) states[index] = initial;
        return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }]; },
      useRef(initial) { const index = refIndex++; return refs[index] ||= { current: initial }; },
      useEffect: callback => { effect = callback; },
    };
    if (name === "react/jsx-runtime") return require(name);
    if (name === "./dashboard-session") return { readSession: () => ({ account }), requestDashboardJson: async (url, init) => {
      calls.push({ url, ...init });
      if (url === '/api/notifications') return options.notifications ? options.notifications() : {
        pushUserId: account.id, notificationDelivery: { pushAvailable: true, pushPublicKey: 'test-key' },
      };
      return preferences(url, init);
    } };
    if (name.endsWith(".css")) return {};
    if (name.endsWith("/customer-push")) return {
      customerPushDeviceEnabled: id => new Promise(resolve => requests.push({ id, resolve })),
      customerPushSupportMessage: () => options.support || '',
      customerPushNeedsHomeScreen: () => Boolean(options.homeScreenRequired),
      async enableCustomerPush(delivery, userId, guard) { calls.push({ enable: userId, delivery }); guard(); await options.enroll?.(); guard(); },
      async disableCustomerPush() { calls.push({ disable: true }); },
    };
    throw new Error(`Unexpected dependency: ${name}`);
  } });
  const tree = () => { stateIndex = refIndex = 0; return exports.default(props); };
  const render = () => renderToStaticMarkup(tree());
  return { requests, events, calls, tree, render, mount() { cleanup?.(); render(); cleanup = effect(); return cleanup; }, switchAccount(value) { account = value; } };
}

function button(tree) {
  if (!tree || typeof tree !== 'object') return null;
  if (tree.type === 'button') return tree;
  for (const child of [tree.props?.children].flat(Infinity)) { const found = button(child); if (found) return found; }
  return null;
}

test("the overview card explains email delivery and hides only after enrollment is confirmed", async () => {
  const f = fixture();
  assert.equal(f.render(), "");
  const close = f.mount();
  assert.equal(f.requests[0].id, "dancer-one");
  f.requests[0].resolve(false); await settle();
  assert.match(f.render(), /aria-busy="false">Enable notifications/);
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
  assert.match(f.render(), /aria-busy="false">Enable notifications/);
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

test("dashboard overviews omit phone enrollment cards and keep email guidance", () => {
  const panel = readFileSync(new URL("../app/dashboard/DancerDashboardPanels.tsx", import.meta.url), "utf8");
  assert.match(panel, /overview=\{<>\s*<DancerAgeVerificationGate><section className="dancer-daily-card" id="dancer-schedule"/);
  assert.doesNotMatch(panel, /DashboardPhoneNotifications/);
  const venue = readFileSync(new URL("../app/dashboard/VenueDashboardPanels.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(venue, /DashboardPhoneNotifications|notificationPrompt=/);
  assert.match(venue, /<VenueNotificationSettings onSaved=\{\(\) => setNotificationRevision/);
  for (const path of ["app/dashboard/DashboardClient.tsx", "app/vip/VipDashboard.tsx", "app/admin/AdminClient.tsx"]) {
    const shell = readFileSync(new URL("../" + path, import.meta.url), "utf8");
    assert.match(shell, /<EmailNotificationGuidance /, path);
    assert.doesNotMatch(shell, /DashboardPhoneNotifications/, path);
  }
  const client = readFileSync(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8");
  assert.match(client, /!dancerOnboarding \? <>\s*<NotificationPanel dancerMode \/>\s*<DancerNotificationSettings showPhoneDelivery=\{false\} \/>/);
  const settings = readFileSync(new URL("../app/dashboard/DancerNotificationSettings.tsx", import.meta.url), "utf8");
  assert.match(settings, /<\/div> : <button[^>]*data-push-settings>Manage phone notifications<\/button>/);
});

for (const role of ["dancer", "venue"]) test(`${role} overview hides while checking and after enabling, and returns after disabling`, async () => {
  const f = fixture({ role }), close = f.mount();
  assert.equal(f.render(), "");
  f.requests[0].resolve(false); await settle();
  assert.match(f.render(), /aria-busy="false">Enable notifications/);
  assert.match(f.render(), /table and VIP requests/);
  if (role === "dancer") assert.match(f.render(), /also receive them by email/);
  else assert.match(f.render(), /Manage email alerts and request preferences/);
  f.events.get("mydancr:push-changed")();
  f.requests[1].resolve(true); await settle();
  assert.equal(f.render(), "");
  f.events.get("mydancr:push-changed")();
  f.requests[2].resolve(false); await settle();
  assert.match(f.render(), /aria-busy="false">Enable notifications/);
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

for (const role of ['dancer', 'venue']) test(`${role} enables from the first tap without a second settings prompt or duplicate enrollment`, async () => {
  let finish;
  const enrolling = new Promise(resolve => { finish = resolve; });
  const f = fixture({ role }, undefined, { enroll: () => enrolling }), close = f.mount();
  f.requests[0].resolve(false); await settle();
  assert.doesNotMatch(f.render(), /data-push-settings/);
  const enable = button(f.tree());
  const before = f.calls.length;
  enable.props.onClick();
  assert.equal(f.calls[before].enable, `${role}-one`, 'Enrollment starts synchronously within the original user gesture');
  enable.props.onClick();
  assert.equal(f.calls.filter(call => call.enable).length, 1);
  assert.equal(button(f.tree()).props.disabled, true);
  assert.match(f.render(), /aria-busy="true">Enabling/);
  for (const event of ['focus', 'pageshow', 'storage']) f.events.get(event)();
  assert.equal(f.requests.length, 1, 'Permission-dialog focus events must not replace the pending card');
  assert.equal(f.calls.filter(call => call.method === 'PATCH').length, 0);
  finish(); await settle();
  assert.equal(f.render(), '');
  const saves = f.calls.filter(call => call.method === 'PATCH');
  assert.equal(saves.length, role === 'venue' ? 1 : 0);
  if (role === 'venue') {
    assert.equal(saves[0].url, '/api/venue/notification-settings');
    assert.deepEqual(JSON.parse(saves[0].body), { settings: { pushEnabled: true } });
  }
  assert.equal(f.calls.filter(call => call.event?.type === 'mydancr:push-changed').length, 1);
  close();
});

test('enrollment failure stays inline, releases the button and allows another explicit tap', async () => {
  let fail = true;
  const f = fixture({}, undefined, { enroll: async () => { if (fail) throw new Error('Permission was not granted.'); } }), close = f.mount();
  f.requests[0].resolve(false); await settle();
  button(f.tree()).props.onClick(); await settle();
  assert.match(f.render(), /Permission was not granted/);
  assert.doesNotMatch(f.render(), /data-push-settings/);
  assert.equal(button(f.tree()).props.disabled, false);
  assert.equal(f.calls.filter(call => call.event).length, 0);
  fail = false; button(f.tree()).props.onClick(); await settle();
  assert.equal(f.render(), '');
  close();
});

test('a failed venue preference save rolls back device enrollment and does not report success', async () => {
  const f = fixture({ role: 'venue' }, async () => { throw new Error('Preferences could not be saved.'); }), close = f.mount();
  f.requests[0].resolve(false); await settle();
  button(f.tree()).props.onClick(); await settle();
  assert.equal(f.calls.filter(call => call.disable).length, 1);
  assert.equal(f.calls.filter(call => call.event).length, 0);
  assert.match(f.render(), /Preferences could not be saved/);
  assert.equal(button(f.tree()).props.disabled, false);
  close();
});

test('enabling a venue device preserves paused account alerts and directs the user to review them', async () => {
  const f = fixture({ role: 'venue' }, async () => ({ userId: 'venue-one', settings: { pushEnabled: true, alertsEnabled: false } })), close = f.mount();
  f.requests[0].resolve(false); await settle();
  button(f.tree()).props.onClick(); await settle();
  assert.match(f.render(), /Review settings/);
  assert.doesNotMatch(f.render(), /<button|data-push-settings/);
  close();
});

test('failed configuration can be retried without asking permission before it is ready', async () => {
  let fail = true;
  const f = fixture({}, undefined, { notifications: async () => {
    if (fail) throw new Error('Unable to prepare notifications.');
    return { pushUserId: 'dancer-one', notificationDelivery: { pushAvailable: true, pushPublicKey: 'key' } };
  } });
  f.mount(); f.requests[0].resolve(false); await settle();
  assert.match(f.render(), /Retry notification setup/);
  button(f.tree()).props.onClick();
  assert.equal(f.calls.filter(call => call.enable).length, 0);
  fail = false; const close = f.mount();
  f.requests[1].resolve(false); await settle();
  assert.match(f.render(), /aria-busy="false">Enable notifications/);
  close();
});

for (const role of ['dancer', 'venue']) test(`${role} iPhone browser offers actionable setup without trying to enroll`, async () => {
  const options = { homeScreenRequired: true, support: 'Add MyDancr to your Home Screen.' };
  const f = fixture({ role }, undefined, options), close = f.mount();
  f.requests[0].resolve(false); await settle();
  const html = f.render();
  assert.match(html, /<details[^>]*><summary[^>]*>Set up iPhone \/ iPad notifications<\/summary>/);
  assert.match(html, /Safari and tap <strong>Share/);
  assert.match(html, /Add to Home Screen/);
  assert.match(html, /Open the new MyDancr icon/);
  assert.match(html, /<strong>Allow/);
  assert.match(html, /Email alerts do not need this setup/);
  assert.equal(button(f.tree()), null);
  assert.equal(f.calls.length, 0, 'Browser setup must not request permission or change delivery settings');

  options.homeScreenRequired = false;
  options.support = '';
  f.events.get('pageshow')();
  f.requests[1].resolve(false); await settle();
  assert.doesNotMatch(f.render(), /<details/);
  assert.equal(button(f.tree()).props.disabled, false);
  button(f.tree()).props.onClick();
  assert.equal(f.calls.filter(call => call.enable).length, 1, 'The installed app can enable from the original tap');
  await settle();
  assert.equal(f.render(), '');
  close();
});

for (const support of ['This browser does not support push notifications.', 'Push is blocked. Allow notifications in site settings.']) {
  test(`unsupported enrollment explains the next step inline: ${support}`, async () => {
    const f = fixture({}, undefined, { support }), close = f.mount();
    f.requests[0].resolve(false); await settle();
    assert.ok(f.render().includes(support));
    assert.equal(button(f.tree()).props.disabled, true);
    button(f.tree()).props.onClick();
    assert.equal(f.calls.length, 0);
    close();
  });
}

for (const mismatch of [false, true]) test(`unavailable or mismatched configuration never permits enrollment: ${mismatch}`, async () => {
  const f = fixture({}, undefined, { notifications: async () => ({ pushUserId: mismatch ? 'someone-else' : 'dancer-one', notificationDelivery: {} }) }), close = f.mount();
  f.requests[0].resolve(false); await settle();
  assert.match(f.render(), mismatch ? /Sign in again/ : /temporarily unavailable/);
  if (!mismatch) assert.equal(button(f.tree()).props.disabled, true);
  assert.equal(f.calls.filter(call => call.enable).length, 0);
  close();
});

for (const unmount of [false, true]) test(`an in-progress enrollment cannot save after ${unmount ? 'unmount' : 'an account change'}`, async () => {
  let finish;
  const gate = new Promise(resolve => { finish = resolve; });
  const f = fixture({ role: 'venue' }, undefined, { enroll: () => gate }), close = f.mount();
  f.requests[0].resolve(false); await settle();
  button(f.tree()).props.onClick();
  if (unmount) close();
  else { f.switchAccount({ id: 'venue-two', role: 'venue' }); f.events.get('storage')(); }
  finish(); await settle();
  assert.equal(f.calls.filter(call => call.method === 'PATCH' || call.event || call.disable).length, 0);
  close();
});
