import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { accountEntryHref } from '../src/lib/dancr/account-entry.ts';
import { safeLocalReturnPath } from '../src/lib/dancr/safe-return-path.ts';
import { createRootContentSecurityPolicy } from '../src/lib/security/root-content-security-policy.mjs';

const callbackSource = readFileSync(new URL('../app/auth/callback/route.ts', import.meta.url), 'utf8');
const homeSource = readFileSync(new URL('../outputs/index.html', import.meta.url), 'utf8');
const sessionKey = 'dancrAuthSessionV1';
const savedSession = role => ({ accessToken: 'existing-access', refreshToken: 'existing-refresh', account: { id: 'existing-user', role } });

function callbackRoute({ providerError = null, freshRole = null } = {}) {
  const exports = {};
  const dependencies = {
    '@/src/lib/security/root-content-security-policy.mjs': { createRootContentSecurityPolicy },
    '@/src/lib/dancr/browser-session': { BROWSER_AUTH_SESSION_KEY: sessionKey },
    '@/src/lib/dancr/safe-return-path': { safeLocalReturnPath },
    '@/src/lib/security/safe-error-metadata': { safeErrorMetadata: () => ({}) },
    '@/src/lib/dancr/auth': { getAccountByUserId: async () => ({ id: 'fresh-user', role: freshRole }) },
    '@/src/lib/dancr/account-provisioning': { provisionAppAccount: () => { throw new Error('Must not reprovision'); } },
    '@/src/lib/supabase/admin': { createAdminSupabaseClient: () => ({}) },
    '@/src/lib/supabase/server': { createServerSupabaseClient: () => ({ auth: {
      verifyOtp: async () => ({ error: providerError, data: freshRole ? {
        user: { id: 'fresh-user' }, session: { access_token: 'fresh-access', refresh_token: 'fresh-refresh' },
      } : {} }),
    } }) },
  };
  vm.runInNewContext(ts.transpileModule(callbackSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, URL, URLSearchParams, Request, Response, console: { warn() {}, error() {} }, require: name => dependencies[name],
  });
  return exports;
}

async function callbackFixture({ role = 'customer', stored = savedSession('customer'), query = '?error=access_denied&error_code=otp_expired&role=dancer', providerError = null, freshRole = null, fetcher } = {}) {
  const response = await callbackRoute({ providerError, freshRole }).GET(new Request('https://mydancr.com/auth/callback' + query));
  const html = await response.text();
  const source = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(source);
  const store = new Map(stored ? [[sessionKey, JSON.stringify(stored)]] : []);
  const calls = [], navigation = [], scrubbed = [];
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { hidden: id !== 'openingDancr', href: '', textContent: '' });
    return nodes.get(id);
  };
  const context = vm.createContext({ URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
    localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) },
    document: { title: 'Opening MyDancr', getElementById: node },
    window: { location: { origin: 'https://mydancr.com', pathname: '/auth/callback', search: query.split('#')[0], hash: query.includes('#') ? '#' + query.split('#')[1] : '', replace: value => navigation.push(value) }, history: { replaceState: (_state, _title, value) => scrubbed.push(value) } },
    fetch: async (url, options) => {
      calls.push({ url, ...options, body: JSON.parse(options.body) });
      return fetcher ? fetcher(url, options) : Response.json({ ok: true, account: { id: 'existing-user', role }, session: { accessToken: 'refreshed-access', refreshToken: 'refreshed-refresh' } });
    },
  });
  vm.runInContext(source.replace('void completeCallback();', 'globalThis.completion = completeCallback();'), context);
  return { html, calls, navigation, scrubbed, node, store, completion: context.completion, status: response.status };
}

for (const input of ['/a/..//outside.example/path', '/a/%2e%2e//outside.example/path', '/.//outside.example/path']) {
  test(`callback HTML never exposes an external continuation after normalization: ${input}`, async () => {
    const f = await callbackFixture({ stored: null, query: '?return_to=' + encodeURIComponent(input) });
    await f.completion;
    const links = [...f.html.matchAll(/href="([^"]+)"/g)].map(match => match[1]);
    assert.ok(links.length);
    for (const link of links) assert.equal(new URL(link, 'https://mydancr.com').origin, 'https://mydancr.com');
    assert.equal(f.calls.length, 0);
  });
}

for (const role of ['customer', 'dancer', 'venue', 'admin']) test(`reused confirmation opens the existing ${role} account’s current dashboard using its verified role`, async () => {
  const f = await callbackFixture({ role, stored: savedSession(role) });
  await f.completion;
  assert.deepEqual(f.navigation, [role === 'admin' ? '/admin' : `/dashboard/${role}`]);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, '/api/auth');
  assert.equal(f.calls[0].method, 'PUT');
  assert.deepEqual(f.calls[0].body, { accessToken: 'existing-access', refreshToken: 'existing-refresh' });
  assert.deepEqual(f.scrubbed, ['/auth/callback']);
  assert.equal(JSON.parse(f.store.get(sessionKey)).account.role, role);
  assert.equal(f.node('confirmationError').hidden, true);
  assert.equal(f.node('dancerConfirmation').hidden, true, 'an already-signed-in dancer does not repeat first-confirmation onboarding');
});

test('a provider rejecting an already-used token still preserves a valid browser sign-in', async () => {
  const f = await callbackFixture({ query: '?token_hash=used-token&type=signup&role=customer', providerError: { status: 403 } });
  await f.completion;
  assert.deepEqual(f.navigation, ['/dashboard/customer']);
  assert.equal(f.status, 200);
});

test('a signed-out reused link shows current sign-in links and does not claim verification succeeded', async () => {
  const f = await callbackFixture({ stored: null });
  await f.completion;
  assert.equal(f.node('confirmationError').hidden, false);
  assert.equal(f.node('dancerConfirmation').hidden, true);
  assert.equal(f.calls.length, 0);
  assert.deepEqual(f.navigation, []);
  assert.doesNotMatch(f.html, /href="\/account(?:\?|"|\/)/);
  assert.match(f.html, /href="\/\?auth=login">Continue to sign in/);
});

test('an expired stored session uses the modern sign-in fallback without a redirect loop', async () => {
  const f = await callbackFixture({ fetcher: async () => Response.json({ ok: false }, { status: 401 }) });
  await f.completion;
  assert.equal(f.node('confirmationError').hidden, false);
  assert.deepEqual(f.navigation, []);
  assert.equal(JSON.parse(f.store.get(sessionKey)).accessToken, 'existing-access');
});

test('a temporary validation outage preserves the existing sign-in and shows retry guidance', async () => {
  const f = await callbackFixture({ fetcher: async () => Response.json({ ok: false }, { status: 503 }) });
  await f.completion;
  assert.equal(f.node('temporaryError').hidden, false);
  assert.equal(f.node('confirmationError').hidden, true);
  assert.equal(JSON.parse(f.store.get(sessionKey)).accessToken, 'existing-access');
  assert.deepEqual(f.navigation, []);
});

test('a callback validation reply cannot undo a sign-in changed in another tab', async () => {
  let finish;
  const f = await callbackFixture({ fetcher: () => new Promise(resolve => { finish = resolve; }) });
  f.store.set(sessionKey, JSON.stringify(savedSession('venue')));
  finish(Response.json({ ok: true, session: { accessToken: 'obsolete', refreshToken: 'obsolete' }, account: { id: 'existing-user', role: 'customer' } }));
  await f.completion;
  assert.equal(JSON.parse(f.store.get(sessionKey)).account.role, 'venue');
  assert.deepEqual(f.navigation, ['/?auth=login']);
});

test('an old password reset link does not reuse a normal session as recovery authorization', async () => {
  const f = await callbackFixture({ query: '?type=recovery' });
  await f.completion;
  assert.equal(f.calls.length, 0);
  assert.deepEqual(f.navigation, ['/account/reset-password?error=expired']);
  assert.equal(f.store.get(sessionKey), JSON.stringify(savedSession('customer')), 'an invalid link must not sign out an unrelated account');
});

for (const type of ['signup', 'recovery', 'email_change']) {
  for (const change of ['logout', 'different-account', 'refreshed-session']) {
    test(`a delayed ${type} callback cannot overwrite ${change}`, async () => {
      let finish;
      const f = await callbackFixture({
        query: `?role=customer#access_token=callback-access&refresh_token=callback-refresh&type=${type}`,
        fetcher: () => new Promise(resolve => { finish = resolve; }),
      });
      const newer = change === 'logout' ? null : JSON.stringify({
        accessToken: 'newer-access', refreshToken: 'newer-refresh',
        account: { id: change === 'different-account' ? 'different-user' : 'existing-user', role: 'customer' },
      });
      if (newer === null) f.store.delete(sessionKey);
      else f.store.set(sessionKey, newer);
      finish(Response.json({ ok: true, session: { accessToken: 'obsolete-access', refreshToken: 'obsolete-refresh' }, account: { id: 'callback-user', role: 'customer' } }));
      await f.completion;
      assert.equal(f.store.get(sessionKey) ?? null, newer);
      assert.deepEqual(f.navigation, ['/?auth=login']);
      assert.equal(f.node('dancerConfirmation').hidden, true);
    });
  }
}

for (const query of [
  '?type=recovery', '?dancr_reset=1', '?reset_target=account_password',
  '?type=recovery&error_code=otp_expired',
  '?type=recovery#access_token=invalid&refresh_token=invalid',
]) test(`invalid recovery preserves the current account: ${query}`, async () => {
  const f = await callbackFixture({ query, fetcher: async () => Response.json({ ok: false }, { status: 401 }) });
  await f.completion;
  assert.equal(f.store.get(sessionKey), JSON.stringify(savedSession('customer')));
  assert.deepEqual(f.navigation, ['/account/reset-password?error=expired']);
});

test('a valid recovery link can still deliberately replace the previously signed-in account', async () => {
  const f = await callbackFixture({
    query: '?type=recovery#access_token=recovery-access&refresh_token=recovery-refresh',
    fetcher: async () => Response.json({ ok: true, session: { accessToken: 'verified-recovery', refreshToken: 'verified-refresh' }, account: { id: 'recovery-user', role: 'dancer' } }),
  });
  await f.completion;
  assert.equal(JSON.parse(f.store.get(sessionKey)).account.id, 'recovery-user');
  assert.deepEqual(f.navigation, ['/account/reset-password']);
});

test('fresh customer confirmation with an old account return URL goes to the current dashboard', async () => {
  const f = await callbackFixture({ stored: null, freshRole: 'customer', query: '?token_hash=new-token&type=signup&return_to=%2Faccount%3Fmode%3Dlogin' });
  await f.completion;
  assert.equal(new URL(f.navigation[0], 'https://mydancr.com').pathname, '/dashboard/customer');
  assert.equal(f.calls.length, 0);
});

test('a fresh dancer confirmation retains the current first-time profile continuation', async () => {
  const f = await callbackFixture({ stored: null, freshRole: 'dancer', query: '?token_hash=new-token&type=signup&role=dancer' });
  await f.completion;
  assert.equal(f.node('dancerConfirmation').hidden, false);
  assert.equal(f.node('confirmationError').hidden, true);
  assert.match(f.node('dancerConfirmationContinue').href, /^\/\?dancr_confirm=1/);
  assert.equal(f.calls.length, 0);
});

test('a cached role cannot override the role verified by the server', async () => {
  const f = await callbackFixture({ role: 'customer', stored: savedSession('admin') });
  await f.completion;
  assert.deepEqual(f.navigation, ['/dashboard/customer']);
  assert.equal(JSON.parse(f.store.get(sessionKey)).account.role, 'customer');
});

test('ordinary account URLs resolve to the current auth surface with safe return paths', () => {
  assert.equal(accountEntryHref({}), '/?auth=login&role=customer');
  assert.equal(accountEntryHref({ role: 'customer', mode: 'signup' }), '/?auth=signup&role=customer');
  assert.equal(accountEntryHref({ role: 'dancer', mode: 'login' }), '/?auth=login&role=dancer');
  assert.equal(accountEntryHref({ role: 'venue', mode: 'signup' }), '/?venueAccess=1&venueMode=signup');
  assert.equal(new URL(accountEntryHref({ return_to: '/deals/claim/offer' }), 'https://mydancr.com').searchParams.get('return_to'), '/deals/claim/offer');
  for (const value of ['https://evil.example', '//evil.example', '/account?mode=login', '/auth/callback']) assert.equal(accountEntryHref({ return_to: value }), '/?auth=login&role=customer');
  assert.equal(accountEntryHref({ venue_nfc: 'valid_token_'.repeat(4) }), null, 'specialized dressing-room sign-in retains its verified tap context');
  assert.equal(accountEntryHref({ venue_nfc: 'invalid' }), '/?auth=login&role=customer');
});

test('Home account deep links open only the current sign-in or signup screens', () => {
  const start = homeSource.indexOf('    function handleAccountAccessDeepLink()');
  const end = homeSource.indexOf('    function handleVenueAccessDeepLink()', start);
  const run = (query) => {
    const opened = [];
    const context = vm.createContext({ URL, safeLocalReturnPath,
      document: { title: '' }, window: { location: { href: 'https://mydancr.com/' + query }, history: { replaceState() {} } },
      openAuthRole: role => opened.push(`login:${role}`), openCustomerSignup: () => opened.push('signup:customer'), openDancerSignupPage: () => opened.push('signup:dancer'),
    });
    vm.runInContext('let pendingAccountAuthReturnTo = "";\n' + homeSource.slice(start, end), context);
    const handled = context.handleAccountAccessDeepLink();
    return { handled, opened, returnTo: vm.runInContext('pendingAccountAuthReturnTo', context) };
  };
  assert.deepEqual(run('?auth=login').opened, ['login:customer']);
  assert.deepEqual(run('?auth=signup&role=customer').opened, ['login:customer', 'signup:customer']);
  assert.deepEqual(run('?auth=signup&role=dancer').opened, ['login:dancer', 'signup:dancer']);
  assert.equal(run('?auth=login&return_to=%2Faccount').returnTo, '');
  assert.equal(run('?auth=login&return_to=%2Fdeals%2Fclaim%2Foffer').returnTo, '/deals/claim/offer');
  assert.equal(run('?city=Las%20Vegas').handled, false);
});
