import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { requestDashboardJson } from '../app/dashboard/dashboard-session.ts';

const home = readFileSync(new URL('../outputs/index.html', import.meta.url), 'utf8');
const key = 'dancrAuthSessionV1';
const account = { id: 'customer-a', role: 'customer', email: 'a@example.test' };
const original = { account, accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: 100 };
const renewed = { account, accessToken: 'new-access', refreshToken: 'new-refresh', expiresAt: 200 };
const response = session => Response.json({ ok: true, session });
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function sourceBetween(start, end) {
  const a = home.indexOf(start), b = home.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a); return home.slice(a, b);
}
function setup(t, surface) {
  let stored = JSON.stringify(original);
  const storage = { getItem: () => stored, setItem: (_key, value) => { stored = value; }, removeItem: () => { stored = null; } };
  const oldWindow = globalThis.window;
  globalThis.window = { localStorage: storage };
  t.after(() => { globalThis.window = oldWindow; });
  t.mock.method(globalThis, 'fetch');
  let fetchImpl;
  const context = vm.createContext({ authSession: original, localStorage: storage, window: { setTimeout, clearTimeout },
    normalizeAccountEmail: value => value || '', sessionEmailForRole: () => account.email,
    saveAuthSession(session) { context.authSession = session; storage.setItem(key, JSON.stringify(session)); },
    fetch: (...args) => fetchImpl(...args), AbortController,
  });
  vm.runInContext(sourceBetween('    function synchronizeAuthSession()', '    async function requestVenueAffiliationJson('), context);
  return {
    request: path => surface === 'home' ? context.getAuthenticatedJson(path) : requestDashboardJson(path),
    setFetch(fn) { fetchImpl = fn; globalThis.fetch = fn; },
    read: () => JSON.parse(stored),
    store: session => { stored = session ? JSON.stringify(session) : null; },
  };
}

for (const surface of ['home', 'dashboard']) {
  test(`${surface}: a late background response cannot replace credentials refreshed before the next Favorite request`, async t => {
    const fixture = setup(t, surface), background = deferred();
    fixture.setFetch(async path => path === '/api/customer/saved' ? background.promise : response(renewed));
    const loading = fixture.request('/api/customer/saved');
    await fixture.request('/api/account');
    assert.equal(fixture.read().accessToken, renewed.accessToken);
    background.resolve(response(original));
    await loading;
    assert.deepEqual(fixture.read(), renewed);
    fixture.setFetch(async (_path, options) => {
      const headers = new Headers(options.headers);
      assert.equal(headers.get('authorization'), 'Bearer new-access');
      assert.equal(headers.get('x-dancr-refresh-token'), 'new-refresh');
      return response(renewed);
    });
    await fixture.request('/api/account');
  });
  for (const change of ['logout', 'different-account', 'dashboard-refresh']) {
    test(`${surface}: an in-flight response respects ${change} in shared browser storage`, async t => {
      const fixture = setup(t, surface), pending = deferred();
      fixture.setFetch(() => pending.promise);
      const loading = fixture.request('/api/customer/saved');
      const current = change === 'logout' ? null : change === 'different-account'
        ? { ...renewed, account: { id: 'customer-b', role: 'customer', email: 'b@example.test' } } : renewed;
      fixture.store(current);
      pending.resolve(response(original));
      await loading;
      assert.deepEqual(fixture.read(), current);
    });
  }
}
