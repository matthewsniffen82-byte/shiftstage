import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { compileVip, guest } from './helpers/vip-dashboard-fixture.mjs';

// Focused component events with mocked responses; no browser or network.
function entryFixture({ shortcut = false, token = '', session = null, request = async () => ({ venues: [] }), auth = {} } = {}) {
  const slots = [], listeners = new Map(), calls = [], navigations = [];
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
  const window = { ...events, location: { origin: 'https://mydancr.test', assign: url => navigations.push(url) } };
  const sessions = { DASHBOARD_SESSION_KEY: 'session', readSession: () => currentSession,
    requestDashboardJson: (url, options) => { calls.push({ url, options }); return request(url, options); }, revokeDashboardSession: async () => { currentSession = null; } };
  const Component = compileVip(shortcut ? 'app/dashboard/CustomerVipShortcut.tsx' : 'app/vip/VipClient.tsx', {
    react, 'next/link': { __esModule: true, default: 'a' }, 'next/dynamic': { __esModule: true, default: () => 'vip-dashboard' },
    './dashboard-session': sessions, '@/app/dashboard/dashboard-session': sessions,
    '@/app/components/PasswordField': { PasswordField: 'password-field' }, '@/app/components/PasswordRequirements': { PasswordRequirements: 'password-requirements' },
    '@/src/lib/dancr/browser-session': { BROWSER_AUTH_SESSION_KEY: 'session', captureBrowserAuthSessionGuard: () => () => true,
      persistBrowserAuthSession: value => { currentSession = value; return true; } },
  }, { window, document, URL, AbortSignal,
    fetch: async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => url === '/api/auth' ? { ok: true, ...auth } : { ok: true, invitation: { venueName: 'Velvet Room', maskedEmail: 'g•••@example.test', expiresAt: '2027-01-01' } } }; },
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
    close: () => slots.forEach(slot => slot?.cleanup?.()),
  };
}

test('VIP entry uses existing guest sign-in; account creation is available only from an invitation', async () => {
  const entry = entryFixture(); await entry.settle();
  assert.match(entry.html(), /existing MyDancr guest email and password/);
  assert.doesNotMatch(entry.html(), /Create account|Set up your VIP account/); entry.close();
  const invite = entryFixture({ token: 'private-invitation' }); await invite.settle();
  assert.match(invite.html(), /<h1>Velvet Room<\/h1>/); assert.match(invite.html(), /Your private VIP invitation/);
  assert.match(invite.html(), /Activate your VIP access/); assert.match(invite.html(), /Your invitation adds VIP access/);
  assert.equal(invite.nodes().filter(n => n.type === 'button' && n.props['aria-pressed'] !== undefined).length, 2); invite.close();
});

test('VIP signup keeps the customer identity and returns email confirmation to the invitation', async () => {
  const ui = entryFixture({ token: 'private-invitation' }); await ui.settle();
  ui.nodes().find(n => n.type === 'input' && n.props.type === 'email').props.onChange({ target: { value: guest.email } });
  ui.nodes().find(n => n.type === 'password-field').props.onChange({ target: { value: 'Existing1!' } }); ui.render();
  ui.nodes().find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); await ui.settle();
  const body = JSON.parse(ui.calls.find(c => c.url === '/api/auth').options.body);
  assert.equal(body.role, 'customer'); assert.equal(body.email, guest.email); assert.equal(body.mode, 'signup');
  assert.equal(new URL(body.emailRedirectTo).searchParams.get('return_to'), '/vip/invite/private-invitation');
  assert.match(ui.html(), /confirmation link brings you back/); ui.close();
});

test('an existing signed-in guest activates an invitation without another account or password', async () => {
  const ui = entryFixture({ token: 'private-invitation', session: { accessToken: 'session-token', account: guest } }); await ui.settle();
  assert.equal(ui.nodes().some(n => n.type === 'password-field'), false);
  ui.nodes().find(n => n.type === 'input').props.onChange({ target: { value: 'Jordan' } }); ui.render();
  ui.nodes().find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); await ui.settle();
  const acceptance = ui.calls.find(c => c.options.method === 'PATCH');
  assert.equal(JSON.parse(acceptance.options.body).name, 'Jordan'); assert.deepEqual(ui.navigations, ['/vip']);
  assert.equal(ui.calls.some(c => c.url === '/api/auth'), false); ui.close();
});

test('VIP password recovery asks only for email and uses the password-reset callback', async () => {
  const ui = entryFixture({ token: 'private-invitation', auth: { message: 'Check your email for a reset link.' } }); await ui.settle();
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
  assert.match(ui.html(), /Check your email for a reset link/); ui.close();
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
