import assert from 'node:assert/strict';
import test from 'node:test';
import { compileVip } from './helpers/vip-dashboard-fixture.mjs';
import * as vipEntry from '../src/lib/dancr/vip-entry.ts';
import * as passwordPolicy from '../src/lib/dancr/password-policy.ts';
import * as accessTerms from '../src/lib/dancr/access-terms.ts';
import * as userTerms from '../src/lib/dancr/user-terms-version.ts';

const account = { id: 'verified-guest', email: 'confirmed@example.test', displayName: 'Jordan', role: 'customer', accountState: 'active', passwordSetupComplete: false, passwordLoginComplete: false };
const invitationPath = '/vip/invite/vip_' + 'a'.repeat(48);
const venueId = '97000000-0000-4000-8000-000000000020';
const session = { accessToken: 'email-session', refreshToken: 'email-refresh', account };
const password = 'Unique1!password';

// Unit component events and synthetic API responses only. No browser or network.
function fixture(options = {}) {
  const states = [], refs = [], calls = [], navigations = [], cleanups = [], writes = [];
  const failures = options.failures || {};
  let index = 0, refIndex = 0, stored = session, tree;
  const Component = compileVip('app/account/reset-password/VipPasswordSetup.tsx', {
    react: { useState: initial => { const slot = index++; if (!(slot in states)) states[slot] = initial; return [states[slot], next => { states[slot] = next; }]; },
      useRef: initial => refs[refIndex++] ||= { current: initial }, useEffect: effect => { if (!cleanups.length) cleanups.push(effect()); } },
    '@/app/components/PasswordField': { PasswordField: 'password-field' }, '@/app/components/PasswordRequirements': { PasswordRequirements: 'password-requirements' },
    '@/src/lib/dancr/password-policy': passwordPolicy, '@/src/lib/dancr/vip-entry': vipEntry,
    '@/src/lib/dancr/access-terms': accessTerms, '@/src/lib/dancr/user-terms-version': userTerms,
    '@/src/lib/dancr/browser-session': {
      readBrowserAuthSession: () => stored,
      captureBrowserAuthSessionGuard: () => { const previous = stored; return () => stored === previous; },
      isCurrentBrowserSession: expected => stored?.accessToken === expected?.accessToken && stored?.refreshToken === expected?.refreshToken,
      persistRefreshedBrowserAuthSession: (value, expected) => { if (options.storageFails || stored !== expected) return false; stored = { ...stored, ...value }; return true; },
      persistBrowserAuthSession: value => { if (options.storageFails) return false; writes.push(value); stored = value; return true; },
    },
  }, { setTimeout, clearTimeout, window: { location: { replace: url => navigations.push(url) } }, fetch: async (url, input) => {
    calls.push({ url, ...input });
    if (options.afterRequest) stored = options.afterRequest(url, stored) || stored;
    const data = url === '/api/account' ? { passwordSetupComplete: options.saveUnconfirmed !== true }
      : url === '/api/auth' ? { account: options.loginAccount || account, passwordLoginComplete: options.loginUnconfirmed !== true, session: { accessToken: 'password-session', refreshToken: 'password-refresh' } }
      : { venueId: options.venueId || venueId, session: { accessToken: 'activation-session', refreshToken: 'activation-refresh' } };
    return { ok: !failures[url], json: async () => failures[url] ? { ok: false, error: failures[url] } : { ok: true, ...data } };
  } }).default;
  const render = () => { index = 0; refIndex = 0; tree = Component({ account: { ...account, ...options.account }, invitationPath: options.invitationPath || invitationPath }); return tree; };
  const nodes = (node = tree) => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).filter(Boolean).flatMap(nodes)] : [];
  const change = (predicate, value, checked = false) => { nodes().find(predicate).props.onChange({ target: checked ? { checked: value } : { value } }); render(); };
  render();
  return { calls, failures, navigations, writes, nodes, render, stored: () => stored, setSession: value => { stored = value; },
    fill() {
      const fields = nodes().filter(n => n.type === 'password-field');
      for (const field of fields) field.props.onChange({ target: { value: password } });
      change(n => n.props.type === 'checkbox', true, true);
    },
    consent: value => change(n => n.props.type === 'checkbox', value, true),
    name: value => change(n => n.type === 'input' && n.props.autoComplete === 'name', value),
    submit: async () => { await nodes().find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); render(); },
    close: () => cleanups.forEach(cleanup => cleanup?.()),
  };
}

test('confirmed email is populated and read-only; one submission saves, signs in and opens the correct VIP lounge', async () => {
  const f = fixture();
  const email = f.nodes().find(n => n.props.type === 'email');
  assert.equal(email.props.value, account.email); assert.equal(email.props.readOnly, true); assert.equal(email.props.onChange, undefined);
  assert.equal(f.calls.length, 0); f.fill(); await f.submit();
  assert.deepEqual(f.calls.map(c => [c.url, c.method]), [['/api/account', 'PATCH'], ['/api/auth', 'POST'], ['/api/vip/invitation', 'PATCH']]);
  assert.deepEqual(JSON.parse(f.calls[0].body), { password });
  assert.deepEqual(JSON.parse(f.calls[1].body), { mode: 'login', role: 'customer', email: account.email, password });
  assert.equal(f.calls[0].headers.authorization, 'Bearer email-session'); assert.equal(f.calls[1].headers.authorization, undefined);
  assert.equal(f.calls[2].headers.authorization, 'Bearer password-session');
  const body = JSON.parse(f.calls[2].body);
  assert.equal(body.token, invitationPath.slice('/vip/invite/'.length)); assert.equal(body.name, account.displayName);
  assert.equal(body.termsAccepted, true); assert.equal(body.termsVersion, accessTerms.ACCESS_TERMS_VERSION);
  assert.equal(body.userTermsAccepted, true); assert.equal(body.userTermsVersion, userTerms.USER_TERMS_VERSION);
  assert.deepEqual(f.navigations, [vipEntry.vipPlannerPath(venueId)]);
  assert.equal(f.stored().accessToken, 'activation-session');
  assert.equal(JSON.stringify(f.writes).includes(password), false); f.close();
});

test('unchecked terms, missing name and mismatched passwords stop before any request', async () => {
  const f = fixture(); f.fill(); f.consent(false); await f.submit(); assert.equal(f.calls.length, 0);
  f.consent(true); f.name(''); await f.submit(); assert.equal(f.calls.length, 0);
  f.name('Jordan'); f.nodes().filter(n => n.type === 'password-field')[1].props.onChange({ target: { value: 'Different1!' } }); f.render();
  await f.submit(); assert.equal(f.calls.length, 0); assert.match(JSON.stringify(f.render()), /do not match/); f.close();
});

test('a failed password save cannot sign in or activate VIP; a retry can finish', async () => {
  const f = fixture({ failures: { '/api/account': 'Save unavailable' } }); f.fill(); await f.submit();
  assert.equal(f.calls.length, 1); assert.equal(f.navigations.length, 0);
  delete f.failures['/api/account']; await f.submit(); assert.equal(f.navigations.length, 1); f.close();
});

test('failed automatic login retries the saved password without another save or email confirmation', async () => {
  const f = fixture({ failures: { '/api/auth': 'Sign-in temporarily unavailable' } }); f.fill(); await f.submit();
  assert.equal(f.calls.length, 2); assert.equal(f.navigations.length, 0);
  delete f.failures['/api/auth']; await f.submit();
  assert.deepEqual(f.calls.map(c => c.url), ['/api/account', '/api/auth', '/api/auth', '/api/vip/invitation']);
  assert.equal(f.navigations.length, 1); f.close();
});

test('revoked or unavailable invitations keep the successful sign-in and retry only activation', async () => {
  const f = fixture({ failures: { '/api/vip/invitation': 'Invitation unavailable' } }); f.fill(); await f.submit();
  assert.equal(f.stored().accessToken, 'password-session'); assert.equal(f.navigations.length, 0);
  assert.equal(f.nodes().filter(n => n.type === 'password-field').length, 0);
  delete f.failures['/api/vip/invitation']; await f.submit();
  assert.equal(f.calls.filter(c => c.url === '/api/account').length, 1);
  assert.equal(f.calls.filter(c => c.url === '/api/auth').length, 1);
  assert.equal(f.calls.filter(c => c.url === '/api/vip/invitation').length, 2); assert.equal(f.navigations.length, 1); f.close();
});

test('reopening saved-password setup does not overwrite the password; completed sign-ins need only activation', async () => {
  for (const passwordLoginComplete of [false, true]) {
    const f = fixture({ account: { passwordSetupComplete: true, passwordLoginComplete } });
    assert.equal(f.nodes().filter(n => n.type === 'password-field').length, passwordLoginComplete ? 0 : 1);
    f.fill(); await f.submit();
    assert.equal(f.calls.some(c => c.url === '/api/account'), false); assert.equal(f.navigations.length, 1); f.close();
  }
});

test('setup or password-login recording failures never claim activation or send another verification email', async () => {
  for (const options of [{ saveUnconfirmed: true }, { loginUnconfirmed: true }]) {
    const f = fixture(options); f.fill(); await f.submit();
    assert.equal(f.calls.some(c => c.url === '/api/vip/invitation'), false); assert.equal(f.navigations.length, 0);
    assert.match(JSON.stringify(f.render()), /couldn’t be confirmed/); f.close();
  }
});

test('a changed account or session cannot be overwritten by delayed setup responses', async () => {
  for (const step of ['/api/account', '/api/auth', '/api/vip/invitation']) {
    const other = { ...session, accessToken: 'another-sign-in', account: { ...account, id: 'other-guest' } };
    const f = fixture({ afterRequest: (url, stored) => url === step ? other : stored }); f.fill(); await f.submit();
    assert.equal(f.stored(), other); assert.equal(f.navigations.length, 0);
    assert.match(JSON.stringify(f.render()), /sign-in changed/); f.close();
  }
  const f = fixture(); f.fill(); f.setSession(null); await f.submit(); assert.equal(f.calls.length, 0); f.close();
});

test('wrong login identity, blocked storage and unsafe return destinations never open VIP', async () => {
  for (const options of [{ loginAccount: { ...account, id: 'other-guest' } }, { loginAccount: { ...account, role: 'venue' } }, { storageFails: true }, { venueId: '//evil.test' }, { invitationPath: '//evil.test' }]) {
    const f = fixture(options); f.fill(); await f.submit(); assert.equal(f.navigations.length, 0); f.close();
  }
});
