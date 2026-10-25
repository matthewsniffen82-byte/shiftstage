import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const compile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const code = compile('../app/dashboard/CustomerEmailPreferencesPanel.tsx');
const preferences = {};
vm.runInNewContext(compile('../src/lib/dancr/customer-notification-preferences.ts'), { exports: preferences });

function fixture(emailEnabled = true, emailAvailable = true) {
  const slots = [], effects = [], requests = [], updates = [];
  let index = 0, dirty = false;
  let profile = { userId: 'guest-one', notificationSettings: { emailEnabled, pushEnabled: true, clubDeals: false }, notificationDelivery: { emailAvailable } };
  let session = { accessToken: 'token', account: { id: profile.userId, role: 'customer' } };
  let respond = async request => ({ profile: { ...profile, notificationSettings: { ...profile.notificationSettings, ...JSON.parse(request.body).notificationSettings } } });
  const hooks = {
    useState(initial) {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial;
      return [slots[slot], next => {
        const value = typeof next === 'function' ? next(slots[slot]) : next;
        if (!Object.is(value, slots[slot])) { slots[slot] = value; dirty = true; }
      }];
    },
    useRef(initial) { const slot = index++; return slots[slot] ||= { current: initial }; },
    useEffect(effect, deps) {
      const slot = index++;
      const previous = slots[slot];
      if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
      effects.push(() => { previous?.cleanup?.(); slots[slot] = { deps, cleanup: effect() }; });
    },
  };
  const exports = {};
  vm.runInNewContext(code, {
    exports, AbortController, Error,
    require(name) {
      if (name === 'react') return hooks;
      if (name === 'react/jsx-runtime') return require(name);
      if (name === '@/src/lib/dancr/customer-notification-preferences') return preferences;
      if (name === './dashboard-session') return {
        readSession: () => session,
        requestCustomerProfileJson: async request => { requests.push(request); return respond(request); },
      };
      throw new Error('Unexpected import: ' + name);
    },
  });
  function render() {
    let tree;
    for (let pass = 0; pass < 10; pass++) {
      index = 0; dirty = false;
      tree = exports.default({ profile, onProfileChange: next => { updates.push(next); profile = next; } });
      effects.splice(0).forEach(effect => effect());
      if (!dirty) return tree;
    }
    throw new Error('Render did not settle');
  }
  function find(node, match) {
    if (!node || typeof node !== 'object') return null;
    if (match(node)) return node;
    for (const child of [node.props?.children].flat(Infinity)) { const result = find(child, match); if (result) return result; }
    return null;
  }
  const button = (key = 'emailEnabled') => find(render(), node => node.props?.['data-email-choice'] === key);
  return {
    requests, updates, render, find, button,
    click: (key = 'emailEnabled') => button(key).props.onClick(),
    feedback: () => find(render(), node => ['status', 'alert'].includes(node.props?.role)),
    respondWith(fn) { respond = fn; },
    changeSession(next = { accessToken: 'new-token', account: { id: 'guest-two', role: 'customer' } }) { session = next; },
    changeProfile(next) { profile = next; render(); },
    getProfile: () => profile,
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

test('saved choices show the appropriate action without changing subscription on mount', () => {
  for (const enabled of [true, false]) {
    const f = fixture(enabled);
    assert.equal(f.button().props.children, enabled ? 'Unsubscribe' : 'Subscribe');
    assert.equal(f.requests.length, 0);
    const description = f.find(f.render(), node => node.props?.id === 'customer-email-emailEnabled').props.children;
    assert.equal(description, preferences.CUSTOMER_EMAIL_CONSENT_TEXT);
    assert.equal(f.button().props['aria-describedby'], 'customer-email-emailEnabled');
  }
});

test('follow email changes leave offers and newsletters subscribed',async()=>{
  const f=fixture(true);
  assert.equal(f.button('followEmailEnabled').props.children,'Subscribe');
  await f.click('followEmailEnabled');
  assert.deepEqual(JSON.parse(f.requests[0].body).notificationSettings,{followEmailEnabled:true});
  assert.equal(f.getProfile().notificationSettings.emailEnabled,true);
  assert.equal(f.button('followEmailEnabled').props.children,'Unsubscribe');
  await f.click('followEmailEnabled');
  assert.equal(f.getProfile().notificationSettings.followEmailEnabled,false);
  assert.equal(f.getProfile().notificationSettings.emailEnabled,true);
});

test('guests can unsubscribe and subscribe again, changing only the email preference', async () => {
  const f = fixture();
  for (const enabled of [false, true]) {
    await f.click();
    const request = f.requests.at(-1);
    assert.equal(request.method, 'PATCH');
    assert.deepEqual(JSON.parse(request.body), { notificationSettings: { emailEnabled: enabled }, emailConsentSource: 'account_preferences', emailConsentVersion: preferences.CUSTOMER_EMAIL_CONSENT_VERSION });
    assert.equal(f.updates.at(-1).notificationSettings.emailEnabled, enabled);
    assert.equal(f.updates.at(-1).notificationSettings.pushEnabled, true);
    assert.equal(f.updates.at(-1).notificationSettings.clubDeals, false);
    assert.equal(f.feedback().props.role, 'status');
    assert.match(f.feedback().props.children, enabled ? /^Subscribed$/ : /^Not subscribed$/);
    assert.equal(f.button().props.children, enabled ? 'Unsubscribe' : 'Subscribe');
  }
});

test('pending saves disable duplicate requests and wait for confirmation before showing success', async () => {
  const f = fixture(false);
  let resolve;
  f.respondWith(() => new Promise(done => { resolve = done; }));
  const pending = f.click();
  await f.click();
  assert.equal(f.requests.length, 1);
  assert.equal(f.button().props.disabled, true);
  assert.equal(f.button().props['aria-busy'], true);
  assert.equal(f.button().props.children, 'Subscribing…');
  assert.equal(f.updates.length, 0);
  assert.equal(f.feedback(), null);
  resolve({ profile: { ...f.getProfile(), notificationSettings: { emailEnabled: true } } });
  await pending;
  assert.equal(f.button().props.children, 'Unsubscribe');
});

test('failed saves keep the previous preference and allow retry', async () => {
  const f = fixture();
  f.respondWith(async () => { throw new Error('Unable to save. Please retry.'); });
  await f.click();
  assert.equal(f.feedback().props.role, 'alert');
  assert.match(f.feedback().props.children, /Please retry/);
  assert.equal(f.updates.length, 0);
  assert.equal(f.button().props.disabled, false);
  assert.equal(f.button().props.children, 'Unsubscribe');
  f.respondWith(async () => ({ profile: { ...f.getProfile(), notificationSettings: { emailEnabled: false } } }));
  await f.click();
  assert.equal(f.button().props.children, 'Subscribe');
});

test('unconfirmed or wrong-account responses cannot report a successful preference change', async () => {
  for (const profile of [undefined, { userId: 'guest-one' }, { userId: 'guest-one', notificationSettings: { emailEnabled: true } }, { userId: 'guest-two', notificationSettings: { emailEnabled: false } }]) {
    const f = fixture();
    f.respondWith(async () => ({ profile }));
    await f.click();
    assert.equal(f.updates.length, 0);
    assert.match(f.feedback().props.children, /not confirmed/);
    assert.equal(f.button().props.children, 'Unsubscribe');
  }
});

test('signed-out, different-account and wrong-role sessions cannot save', async () => {
  for (const session of [null, { account: { id: 'guest-one', role: 'customer' } }, { accessToken: 'token', account: { id: 'guest-two', role: 'customer' } }, { accessToken: 'token', account: { id: 'guest-one', role: 'dancer' } }]) {
    const f = fixture();
    f.changeSession(session);
    await f.click();
    assert.equal(f.requests.length, 0);
    assert.match(f.feedback().props.children, /Sign in again/);
  }
});

for (const action of ['changeSession', 'unmount']) test(`late responses are ignored after ${action}`, async () => {
  const f = fixture();
  let resolve;
  f.respondWith(() => new Promise(done => { resolve = done; }));
  const pending = f.click();
  f[action]();
  resolve({ profile: { ...f.getProfile(), notificationSettings: { emailEnabled: false } } });
  await pending;
  assert.equal(f.updates.length, 0);
  assert.equal(f.feedback(), null);
  if (action === 'unmount') assert.equal(f.requests[0].signal.aborted, true);
});

test('changes from Manage alerts update the account button without another save', () => {
  const f = fixture();
  f.render();
  f.changeProfile({ ...f.getProfile(), notificationSettings: { emailEnabled: false } });
  assert.equal(f.button().props.children, 'Subscribe');
  assert.equal(f.requests.length, 0);
});

test('unavailable delivery still permits unsubscribe and explains why subscribe is disabled', async () => {
  const f = fixture(true, false);
  assert.equal(f.button().props.disabled, false);
  await f.click();
  assert.equal(f.button().props.children, 'Subscribe');
  assert.equal(f.button().props.disabled, true);
  assert.ok(f.find(f.render(), node => node.type === 'p' && String(node.props.children).includes('temporarily unavailable')));
  await f.click();
  assert.equal(f.requests.length, 1);
});
