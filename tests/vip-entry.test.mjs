import * as vipEntry from '../src/lib/dancr/vip-entry.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { compileVip, guest } from './helpers/vip-dashboard-fixture.mjs';
import * as accessTerms from '../src/lib/dancr/access-terms.ts';
import * as userTerms from '../src/lib/dancr/user-terms-version.ts';

// Focused component events with mocked responses; no browser or network.
function entryFixture({ shortcut = false, token = '', session = null, request = async () => ({ passwordSetupComplete: true, venues: [], venueId: '97000000-0000-4000-8000-000000000020' }), auth = {} } = {}) {
  const slots = [], listeners = new Map(), calls = [], navigations = [], timers = new Map(); let timerId = 0;
  let cursor = 0, dirty = true, effects = [], tree, currentSession = session;
  const react = {
    useState(initial) {
      const i = cursor++; slots[i] ||= { value: initial };
      return [slots[i].value, next => { const value = typeof next === 'function' ? next(slots[i].value) : next;
        if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true; } }];
    },
    useRef(initial) { return slots[cursor++] ||= { current: initial }; },
    useEffect(effect, deps) {
      const i = cursor++, previous = slots[i];
      if (!previous || deps.some((value, j) => !Object.is(value, previous.deps[j]))) {
        effects.push(() => { previous?.cleanup?.(); slots[i] = { deps, cleanup: effect() }; });
      }
    },
  };
  const events = { addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: name => listeners.delete(name) };
  const document = { ...events, visibilityState: 'visible' };
  const window = { ...events, setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id), location: { origin: 'https://mydancr.test', assign: url => navigations.push(url) } };
  const sessions = { DASHBOARD_SESSION_KEY: 'session', readSession: () => currentSession,
    requestDashboardJson: (url, options) => { calls.push({ url, options }); return request(url, options); }, revokeDashboardSession: async () => { currentSession = null; } };
  const Component = compileVip(shortcut ? 'app/dashboard/CustomerVipShortcut.tsx' : 'app/vip/VipClient.tsx', {
    '@/src/lib/dancr/vip-entry': vipEntry,
    react, 'next/link': { __esModule: true, default: 'a' }, 'next/dynamic': { __esModule: true, default: () => 'vip-dashboard' },
    './dashboard-session': sessions, '@/app/dashboard/dashboard-session': sessions,
    '@/src/lib/dancr/access-terms': accessTerms,
    '@/src/lib/dancr/user-terms-version': userTerms,
    '@/app/components/PasswordField': { PasswordField: 'password-field' }, '@/app/components/PasswordRequirements': { PasswordRequirements: 'password-requirements' },
    '@/src/lib/dancr/browser-session': { BROWSER_AUTH_SESSION_KEY: 'session', captureBrowserAuthSessionGuard: () => { const original = currentSession; return () => currentSession === original; },
      persistBrowserAuthSession: value => { currentSession = value; return true; } },
  }, { window, document, URL, AbortSignal,
    fetch: async (url, options) => { calls.push({ url, options }); return { ok: url !== '/api/auth' || auth.ok !== false, json: async () => url === '/api/auth' ? { ok: true, ...auth } : { ok: true, invitation: { venueName: 'Velvet Room', maskedEmail: 'g•••@example.test', expiresAt: '2027-01-01' } } }; },
  }).default;
  function render() {
    dirty = true;
    for (let i = 0; dirty && i < 25; i++) { dirty = false; cursor = 0; effects = []; tree = Component(shortcut ? { accountId: guest.id } : { token }); effects.forEach(run => run()); }
    assert.equal(dirty, false); return tree;
  }
  function nodes(node = tree) { return node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).filter(Boolean).flatMap(nodes)] : []; }
  async function settle() { for (let i = 0; i < 8; i++) { await Promise.resolve(); render(); } }
  render();
  return { calls, navigations, render, nodes, settle, html: () => renderToStaticMarkup(tree),
    event: (name, data = {}) => listeners.get(name)?.(data), session: value => { currentSession = value; },
    tick: () => { const callback = timers.values().next().value; timers.clear(); callback?.(); render(); },
    close: () => slots.forEach(slot => slot?.cleanup?.()),
  };
}

test('VIP entry uses existing guest sign-in; account creation is available only from an invitation', async () => {
  const entry = entryFixture(); await entry.settle();
  assert.match(entry.html(), /invited MyDancr guest account/);
  assert.doesNotMatch(entry.html(), /Create account|Set up your VIP account/); entry.close();
  const invite = entryFixture({ token: 'private-invitation' }); await invite.settle();
  assert.match(invite.html(), /You’re invited to Velvet Room/); assert.match(invite.html(), /I have an account · Sign in/);
  assert.match(invite.html(), /I’m new · Create account/); assert.equal(invite.nodes().some(n => n.type === "form"), false);
  invite.nodes().find(n => n.props.children === "I’m new · Create account").props.onClick(); invite.render();
  assert.equal(invite.nodes().filter(n => n.type === 'button' && n.props['aria-pressed'] !== undefined).length, 2); invite.close();
});

test('VIP signup keeps the customer identity and returns email confirmation to the invitation', async () => {
  const ui = entryFixture({ token: 'private-invitation' }); await ui.settle();
  ui.nodes().find(n => n.props.children === 'I’m new · Create account').props.onClick(); ui.render();
  ui.nodes().find(n => n.type === 'input' && n.props.type === 'email').props.onChange({ target: { value: guest.email } });
  ui.nodes().find(n => n.type === 'password-field').props.onChange({ target: { value: 'Existing1!' } }); ui.render();
  ui.nodes().find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); await ui.settle();
  assert.equal(ui.calls.some(c => c.url === '/api/auth'), false);
  assert.match(ui.html(), /Please read and accept the User Terms/);
  ui.nodes().find(n => n.props.type === 'checkbox').props.onChange({ target: { checked: true } }); ui.render();
  ui.nodes().find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); await ui.settle();
  const body = JSON.parse(ui.calls.find(c => c.url === '/api/auth').options.body);
  assert.equal(body.role, 'customer'); assert.equal(body.email, guest.email); assert.equal(body.mode, 'signup');
  assert.equal(body.userTermsAccepted, true); assert.equal(body.userTermsVersion, userTerms.USER_TERMS_VERSION);
  assert.equal(new URL(body.emailRedirectTo).searchParams.get('return_to'), '/vip/invite/private-invitation');
  assert.match(ui.html(), /confirmation link brings you back/); ui.close();
});

test('repeat VIP signup opens sign-in with the email and invitation retained, and clears the proposed password', async () => {
  const ui = entryFixture({ token: 'private-invitation', auth: { ok: false, code: 'SIGN_IN_REQUIRED', error: 'Unable to create this account.' } });
  await ui.settle();
  ui.nodes().find(n => n.props.children === 'I’m new · Create account').props.onClick(); ui.render();
  ui.nodes().find(n => n.type === 'input' && n.props.type === 'email').props.onChange({ target: { value: guest.email } });
  ui.nodes().find(n => n.type === 'password-field').props.onChange({ target: { value: 'Proposed1!password' } });
  ui.nodes().find(n => n.props.type === 'checkbox').props.onChange({ target: { checked: true } }); ui.render();
  ui.nodes().find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); await ui.settle();
  assert.match(ui.html(), /Sign in to continue/); assert.match(ui.html(), /Finish password setup/);
  assert.doesNotMatch(ui.html(), /Check your email|Unable to authenticate|Proposed1!password/);
  assert.equal(ui.nodes().find(n => n.type === 'input' && n.props.type === 'email').props.value, guest.email);
  assert.equal(ui.nodes().find(n => n.type === 'password-field').props.value, '');
  assert.equal(ui.calls.filter(c => c.url === '/api/auth').length, 1);
  assert.equal(ui.navigations.length, 0);
  assert.match(ui.html(), /You’re invited to Velvet Room/);
  ui.nodes().find(n => n.props.className === 'vip-text-button').props.onClick(); ui.render();
  ui.nodes().find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); await ui.settle();
  const reset = JSON.parse(ui.calls.filter(c => c.url === '/api/auth').at(-1).options.body);
  assert.equal(reset.mode, 'reset_password'); assert.equal(reset.email, guest.email);
  assert.equal(new URL(reset.emailRedirectTo).searchParams.get('vip_return_to'), '/vip/invite/private-invitation');
  ui.close();
});

test('other VIP signup failures keep the signup form available for correction', async () => {
  const ui = entryFixture({ token: 'private-invitation', auth: { ok: false, code: 'WEAK_PASSWORD', error: 'Choose a stronger password.' } }); await ui.settle();
  ui.nodes().find(n => n.props.children === 'I’m new · Create account').props.onClick(); ui.render();
  ui.nodes().find(n => n.props.type === 'checkbox').props.onChange({ target: { checked: true } }); ui.render();
  ui.nodes().find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); await ui.settle();
  assert.match(ui.html(), /Create your guest account/); assert.match(ui.html(), /Choose a stronger password/);
  assert.doesNotMatch(ui.html(), /Sign in to continue|Check your email/);
  assert.equal(ui.calls.filter(c => c.url === '/api/auth').length, 1); ui.close();
});

test('unfinished verified guests resume password setup before VIP activation', async () => {
  const token = 'vip_' + 'a'.repeat(48);
  const ui = entryFixture({ token, session: { accessToken: 'verified', account: guest }, request: async () => ({ passwordSetupComplete: false }) });
  await ui.settle();
  assert.match(ui.html(), /Set your password/); assert.doesNotMatch(ui.html(), /Activate your VIP access/);
  const link = ui.nodes().find(n => n.props?.href?.startsWith('/account/reset-password'));
  const destination = new URL(link.props.href, 'https://mydancr.test');
  assert.equal(destination.searchParams.get('return_to'), '/vip/invite/' + token);
  assert.equal(destination.searchParams.get('setup'), '1');
  assert.equal(ui.calls.some(c => c.options.method === 'PATCH'), false); ui.close();
});

test('a signed-out guest can request and resend secure setup without a password or another signup', async () => {
  const token = 'vip_' + 'b'.repeat(48);
  const ui = entryFixture({ token }); await ui.settle();
  ui.nodes().find(n => n.props.children === 'Already confirmed? Finish password setup').props.onClick(); ui.render();
  assert.equal(ui.nodes().some(n => n.type === 'password-field'), false);
  ui.nodes().find(n => n.props.type === 'email').props.onChange({target:{value:guest.email}}); ui.render();
  ui.nodes().find(n => n.type === 'form').props.onSubmit({preventDefault(){}}); await ui.settle();
  assert.match(ui.html(), /secure password setup link/);
  for (let i=0;i<60;i++) ui.tick();
  ui.nodes().find(n => n.props.children === 'Resend email').props.onClick(); await ui.settle();
  const requests = ui.calls.filter(c => c.url === '/api/auth'); assert.equal(requests.length, 2);
  for (const request of requests) {
    const body = JSON.parse(request.options.body); assert.equal(body.mode, 'reset_password'); assert.equal(body.email, guest.email);
    const callback = new URL(body.emailRedirectTo); assert.equal(callback.searchParams.get('vip_setup'), '1');
    assert.equal(callback.searchParams.get('vip_return_to'), '/vip/invite/' + token);
  }
  ui.close();
});

test('an existing signed-in guest activates an invitation without another account or password', async () => {
  const ui = entryFixture({ token: 'private-invitation', session: { accessToken: 'session-token', account: guest } }); await ui.settle();
  assert.equal(ui.nodes().some(n => n.type === 'password-field'), false);
  ui.nodes().find(n => n.type === 'input').props.onChange({ target: { value: 'Jordan' } }); ui.render();
  assert.equal(ui.nodes().find(n => n.props.type === 'checkbox').props.checked, false);
  const consentLabel = ui.nodes().find(n => n.props.className === 'vip-terms-consent');
  assert.equal(renderToStaticMarkup(consentLabel).replace(/<[^>]*>/g, '').replace(/&amp;/g, '&'), userTerms.VIP_USER_TERMS_CONSENT);
  ui.nodes().find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); await ui.settle();
  assert.equal(ui.calls.some(c => c.options.method === 'PATCH'), false);
  assert.match(ui.html(), /Please read and accept/);
  ui.nodes().find(n => n.props.type === 'checkbox').props.onChange({ target: { checked: true } }); ui.render();
  ui.nodes().find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); await ui.settle();
  const acceptance = ui.calls.find(c => c.options.method === 'PATCH');
  assert.equal(JSON.parse(acceptance.options.body).termsAccepted, true);
  assert.equal(JSON.parse(acceptance.options.body).termsVersion, accessTerms.ACCESS_TERMS_VERSION);
  assert.equal(JSON.parse(acceptance.options.body).userTermsAccepted, true);
  assert.equal(JSON.parse(acceptance.options.body).userTermsVersion, userTerms.USER_TERMS_VERSION);
  assert.equal(JSON.parse(acceptance.options.body).name, 'Jordan'); assert.deepEqual(ui.navigations, ['/vip?venueId=97000000-0000-4000-8000-000000000020#vip-plan']);
  assert.equal(ui.calls.some(c => c.url === '/api/auth'), false); ui.close();
});

test('VIP acceptance resets when the signed-in account changes', async () => {
  const ui = entryFixture({ token: 'private-invitation', session: { accessToken: 'session-token', account: guest } }); await ui.settle();
  ui.nodes().find(n => n.props.type === 'checkbox').props.onChange({ target: { checked: true } }); ui.render();
  ui.session({ accessToken: 'different-token', account: { ...guest, id: 'other-guest' } });
  ui.event('storage', { key: 'session' }); await ui.settle();
  assert.equal(ui.nodes().find(n => n.props.type === 'checkbox').props.checked, false);
  ui.close();
});

test('VIP password recovery asks only for email and uses the password-reset callback', async () => {
  const ui = entryFixture({ token: 'private-invitation', auth: { message: 'Check your email for a reset link.' } }); await ui.settle();
  ui.nodes().find(n => n.props.children === 'I have an account · Sign in').props.onClick(); ui.render();
  ui.nodes().find(n => n.type === 'input' && n.props.type === 'email').props.onChange({ target: { value: guest.email } });
  ui.nodes().find(n => n.props?.className === 'vip-text-button').props.onClick(); await ui.settle();
  assert.match(ui.html(), /send you a link to choose a new password/);
  assert.doesNotMatch(ui.html(), /existing password|Create account/);
  assert.equal(ui.nodes().some(n => n.type === 'password-field'), false);
  ui.nodes().find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); await ui.settle();
  const body = JSON.parse(ui.calls.find(c => c.url === '/api/auth').options.body);
  assert.equal(body.mode, 'reset_password'); assert.equal(body.role, 'customer'); assert.equal(body.email, guest.email);
  const callback = new URL(body.emailRedirectTo);
  assert.equal(callback.searchParams.get('type'), 'recovery'); assert.equal(callback.searchParams.get('return_to'), '/account/reset-password');
  assert.match(ui.html(), /Check your email/); assert.equal(callback.searchParams.get("vip_return_to"), "/vip/invite/private-invitation"); ui.close();
});

test('the lounge shortcut requires confirmed access and disappears after revocation or a failed refresh', async () => {
  let result = { venues: [{ id: 'venue' }] }, fail = false;
  const ui = entryFixture({ shortcut: true, session: { accessToken: 'token', account: guest }, request: async () => { if (fail) throw new Error('Unavailable'); return result; } });
  assert.equal(ui.render(), null); await ui.settle(); assert.match(ui.html(), /VIP Lounge/);
  assert.equal(ui.calls[0].url, '/api/vip?view=account'); assert.equal(ui.calls[0].options.cache, 'no-store');
  result = { venues: [] }; ui.event('visibilitychange'); await ui.settle(); assert.equal(ui.html(), '');
  result = { venues: [{ id: 'venue' }] }; ui.event('visibilitychange'); await ui.settle(); assert.match(ui.html(), /VIP Lounge/);
  fail = true; ui.event('visibilitychange'); await ui.settle(); assert.equal(ui.html(), ''); ui.close();
});

test('a delayed VIP lookup cannot show a shortcut after the guest signs out or changes account', async () => {
  let resolve;
  const ui = entryFixture({ shortcut: true, session: { accessToken: 'token', account: guest }, request: () => new Promise(done => { resolve = done; }) });
  ui.session({ accessToken: 'other-token', account: { ...guest, id: 'different-guest' } });
  resolve({ venues: [{ id: 'venue' }] }); await ui.settle(); assert.equal(ui.html(), '');
  ui.session(null); ui.event('storage', { key: 'session' }); await ui.settle(); assert.equal(ui.html(), '');
  assert.equal(ui.calls.length, 1); ui.close();
});

test('signup shows a dedicated confirmation step, clears the password, and throttles resends', async () => {
  const token = 'vip_' + 'a'.repeat(48);
  const ui = entryFixture({ token }); await ui.settle();
  ui.nodes().find(n => n.props.children === 'I’m new · Create account').props.onClick(); ui.render();
  ui.nodes().find(n => n.props.type === 'email').props.onChange({ target: { value: guest.email } });
  ui.nodes().find(n => n.type === 'password-field').props.onChange({ target: { value: 'Secret1!' } });
  ui.nodes().find(n => n.props.type === 'checkbox').props.onChange({ target: { checked: true } }); ui.render();
  ui.nodes().find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); await ui.settle();
  assert.match(ui.html(), /Check your email/); assert.equal(ui.nodes().some(n => n.type === 'form'), false);
  const resend = () => ui.nodes().find(n => n.props.className === 'vip-primary');
  assert.equal(resend().props.disabled, true); resend().props.onClick(); await ui.settle();
  assert.equal(ui.calls.some(c => c.url === '/api/vip/confirmation'), false);
  for (let i = 0; i < 60; i++) ui.tick();
  assert.equal(resend().props.disabled, false); resend().props.onClick(); await ui.settle();
  const body = JSON.parse(ui.calls.find(c => c.url === '/api/vip/confirmation').options.body);
  assert.deepEqual(body, { token, email: guest.email }); assert.equal(resend().props.disabled, true);
  ui.nodes().find(n => n.props.children === 'I’m ready to sign in').props.onClick(); ui.render();
  assert.equal(ui.nodes().find(n => n.type === 'password-field').props.value, ''); ui.close();
});
