import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const require = createRequire(import.meta.url);
const id = '00000000-0000-4000-8000-000000000001';
const state = '00000000-0000-4000-8000-000000000002';
const clubToken = '00000000-0000-4000-8000-000000000003';
function fixture() {
  const store = new Map(), requests = [], saved = [];
  let now = 100000, current = true, reply = { ok: true, following: true, session: { accessToken: 'renewed' } };
  let session = { accessToken: 'guest', refreshToken: 'refresh', account: { role: 'customer' } };
  const storage = { get length() { return store.size; }, key: index => [...store.keys()][index],
    getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read('src/lib/dancr/internal-profile-auth-return.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, window: { localStorage: storage }, crypto: { randomUUID: () => state },
    Date: class extends Date { static now() { return now; } }, AbortSignal,
    fetch: async (url, options) => { requests.push({ url, options }); return { ok: reply.ok, json: async () => reply }; },
    require: () => ({ readBrowserAuthSession: () => session, isCurrentBrowserSession: () => current,
      persistRefreshedBrowserAuthSession: (...args) => saved.push(args) }),
  });
  return { api: exports, store, requests, saved, storage, setSession: value => { session = value; },
    expire: () => { now += 86400001; }, changeAccount: () => { current = false; }, fail: () => { reply = { ok: false, error: 'Profile unavailable.' }; } };
}

test('authentication receives an opaque return reference without the club token or dancer ID', () => {
  const f = fixture();
  const path = f.api.createInternalFollowReturn(id, clubToken);
  assert.equal(path, `/internal/follow-return?state=${state}`);
  assert.ok(!path.includes(clubToken) && !path.includes(id));
  const record = f.api.readInternalFollowReturn(state);
  assert.equal(record.dancerId, id);
  assert.equal(f.api.internalFollowReturnDestination(record), `/internal/club/${clubToken}?profile=${id}`);
  f.api.clearInternalFollowReturn(state);
  assert.equal(f.api.readInternalFollowReturn(state), null);
});

test('expired, fabricated, malformed and missing return references cannot restore a private club link', () => {
  const f = fixture();
  assert.equal(f.api.readInternalFollowReturn('https://untrusted.invalid'), null);
  assert.equal(f.api.readInternalFollowReturn(state), null);
  assert.throws(() => f.api.createInternalFollowReturn(id, '//untrusted.invalid/'), /guest roster/);
  f.api.createInternalFollowReturn(id, clubToken);
  f.expire();
  assert.equal(f.api.readInternalFollowReturn(state), null);
  assert.equal(f.store.size, 0);
});

test('resuming explicitly follows once and preserves refreshed credentials', async () => {
  const f = fixture();
  await f.api.completeInternalProfileFollow(id);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].url, '/api/customer/follows');
  assert.deepEqual(JSON.parse(f.requests[0].options.body), { dancerId: id, following: true, notificationsEnabled: true });
  assert.equal(f.requests[0].options.headers.authorization, 'Bearer guest');
  assert.equal(f.requests[0].options.headers['x-dancr-refresh-token'], 'refresh');
  assert.equal(f.saved[0][0].accessToken, 'renewed');
});

test('wrong roles, API rejection and account changes never claim a successful follow', async () => {
  for (const role of [null, 'venue', 'dancer']) {
    const f = fixture();
    f.setSession(role ? { accessToken: 'staff', account: { role } } : null);
    await assert.rejects(f.api.completeInternalProfileFollow(id), /guest account/);
    assert.equal(f.requests.length, 0);
  }
  const failed = fixture(); failed.fail();
  await assert.rejects(failed.api.completeInternalProfileFollow(id), /Profile unavailable/);
  assert.equal(failed.saved.length, 0);
  const changed = fixture(); changed.changeAccount();
  await assert.rejects(changed.api.completeInternalProfileFollow(id), /account changed/);
  assert.equal(changed.saved.length, 0);
});

test('signup confirmation preserves the Internal return while ordinary signup keeps its dashboard', async () => {
  const code = read('src/live-shell/app/24-events.js').match(/document\.getElementById\("authForm"\)\.addEventListener\("submit"[\s\S]*?\n    \}\);/)[0];
  for (const returnTo of ['', `/internal/follow-return?state=${state}`]) {
    let submit, requested;
    const context = {
      authMode: 'signup', pendingAccountAuthReturnTo: returnTo, citySelect: { value: 'Las Vegas' },
      document: { getElementById: () => ({ value: 'synthetic', textContent: 'Create guest account', setAttribute() {}, removeAttribute() {}, addEventListener: (_event, fn) => { submit = fn; } }) },
      saveAuthResume: (_role, destination) => destination,
      requestAuth: async payload => { requested = payload; return {}; },
      setCustomerAuthStatus() {}, updateAccountHeader() {}, showToast() {}, startConfirmationResendCooldown() {},
      friendlyAuthErrorMessage: message => { throw Error(message); },
    };
    vm.runInNewContext(code, context);
    await submit({ preventDefault() {} });
    assert.equal(requested.emailRedirectTo, returnTo || '/dashboard/customer?confirmed=1');
  }
});

for (const cancelled of [false, true]) test(`the return page ${cancelled ? 'cancels without following' : 'saves the follow'} and reopens the same club profile`, async () => {
  const f = fixture(), navigation = [], effects = [];
  f.api.createInternalFollowReturn(id, clubToken);
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read('app/internal/follow-return/page.tsx'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports, URLSearchParams,
    window: { location: { search: `?state=${state}${cancelled ? '&cancel=1' : ''}`, replace: path => navigation.push(path) } },
    require: name => name === 'react' ? { useState: initial => [initial, () => {}], useRef: initial => ({ current: initial }), useEffect: effect => effects.push(effect) }
      : name === 'react/jsx-runtime' ? require(name) : f.api,
  });
  exports.default();
  effects[0](); effects[0](); // Strict Mode must not issue two follow writes.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.requests.length, cancelled ? 0 : 1);
  assert.deepEqual(navigation, [`/internal/club/${clubToken}?profile=${id}`]);
  assert.equal(f.api.readInternalFollowReturn(state), null);
});

test('a failed follow keeps the return available for retry and does not navigate as if saved', async () => {
  const f = fixture(), navigation = [], effects = [];
  f.api.createInternalFollowReturn(id, clubToken); f.fail();
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read('app/internal/follow-return/page.tsx'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports, URLSearchParams,
    window: { location: { search: `?state=${state}`, replace: path => navigation.push(path) } },
    require: name => name === 'react' ? { useState: initial => [initial, () => {}], useRef: initial => ({ current: initial }), useEffect: effect => effects.push(effect) }
      : name === 'react/jsx-runtime' ? require(name) : f.api,
  });
  exports.default(); effects[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.requests.length, 1);
  assert.deepEqual(navigation, []);
  assert.ok(f.api.readInternalFollowReturn(state));
});

test('only the active same-origin profile frame can start the full-page account handoff', () => {
  const f = fixture(), navigation = [], effects = [], messages = [];
  const child = { postMessage: message => messages.push(message) };
  let receive, refIndex = 0;
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read('app/internal/InternalFullProfile.tsx'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports,
    window: { location: { origin: 'https://example.invalid', assign: path => navigation.push(path) },
      addEventListener: (_name, fn) => { receive = fn; }, removeEventListener() {} },
    require: name => name === 'react' ? {
      useState: initial => [initial, () => {}], useEffect: effect => effects.push(effect),
      useRef: initial => ({ current: refIndex++ === 0 ? { contentWindow: child } : initial }),
    } : name === 'react/jsx-runtime' ? require(name) : f.api,
  });
  exports.InternalFullProfile({ profile: { id, stage_name: 'Synthetic dancer' }, token: clubToken, onClose: () => assert.fail('Do not close the profile during handoff') });
  effects.forEach(effect => effect());
  const event = { origin: 'https://example.invalid', source: child, data: { type: 'mydancr:internal-profile-auth', profileId: id, mode: 'signup' } };
  receive({ ...event, origin: 'https://untrusted.invalid' });
  receive({ ...event, source: {} });
  receive({ ...event, data: { ...event.data, profileId: state } });
  receive({ ...event, data: { ...event.data, mode: 'other' } });
  assert.equal(navigation.length, 0);
  receive(event);
  assert.equal(navigation.length, 1);
  const destination = new URL(navigation[0], 'https://example.invalid');
  assert.equal(destination.pathname, '/account');
  assert.equal(destination.searchParams.get('mode'), 'signup');
  assert.equal(destination.searchParams.get('return_to'), `/internal/follow-return?state=${state}`);
  assert.ok(!navigation[0].includes(clubToken));
  f.storage.setItem = () => { throw Error('Storage blocked'); };
  receive({ ...event, data: { ...event.data, mode: 'login' } });
  assert.equal(navigation.length, 1);
  assert.equal(messages.at(-1).type, 'mydancr:internal-profile-auth-error');
});
