import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../app/vip/VipAccountPanel.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const passwordPolicy = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/dancr/password-policy.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: passwordPolicy });
function fixture(role = 'customer') {
  const slots = [], cleanups = [], requests = [], updates = [], alerts = [], navigations = [];
  const account = { id: `${role}-one`, role, email: 'original@example.com', accountState: 'active' };
  let index = 0, session = { account, accessToken: 'original-token', refreshToken: 'original-refresh' }, respond = async () => ({ account, message: 'Confirmed by server.' });
  const hooks = {
    useState(initial) { const slot = index++; if (!(slot in slots)) slots[slot] = initial; return [slots[slot], next => { slots[slot] = typeof next === 'function' ? next(slots[slot]) : next; }]; },
    useRef(initial) { const slot = index++; return slots[slot] ||= { current: initial }; },
    useEffect(effect) { const slot = index++; if (!(slot in slots)) { slots[slot] = true; cleanups.push(effect()); } },
  };
  const exports = {};
  vm.runInNewContext(code, {
    exports, AbortController, Error,
    window: { alert: message => alerts.push(message), location: { replace: url => navigations.push(url) } },
    FormData: class { constructor(fields) { this.fields = fields; } get(key) { return this.fields[key] ?? null; } },
    require(name) {
      if (name === '@/src/lib/dancr/password-policy') return passwordPolicy;
      if (name === '@/app/components/PasswordRequirements') return { PasswordRequirements: () => null };
      if (name === 'react') return hooks;
      if (name === 'react/jsx-runtime') return require(name);
      if (name === '@/app/dashboard/dashboard-session') return { readSession: () => session, clearDashboardSession: () => { session = null; }, requestAccountJson: async request => { requests.push(request); return respond(request); } };
      if (name === '@/src/lib/dancr/browser-session') return { isCurrentBrowserSession: expected => Boolean(expected?.accessToken && session?.accessToken === expected.accessToken && session?.refreshToken === expected.refreshToken) };
      throw new Error('Unexpected import: ' + name);
    },
  });
  const render = () => { index = 0; return exports.default({ account, ...(role === 'dancer' ? { accountRole: role } : {}), onAccountChange: next => updates.push(next) }); };
  const find = (node, match) => {
    if (!node || typeof node !== 'object') return null;
    if (match(node)) return node;
    for (const child of [node.props?.children].flat(Infinity)) { const found = find(child, match); if (found) return found; }
    return null;
  };
  const form = () => find(render(), node => node.props?.credential);
  return {
    account, requests, updates, alerts, navigations, render, find, form,
    open(credential) { find(render(), node => node.type === 'button' && node.key === credential).props.onClick(); },
    label(credential) { return find(find(render(), node => node.type === 'button' && node.key === credential), node => node.type === 'span').props.children; },
    submit(fields) { return form().props.onSubmit({ preventDefault() {}, currentTarget: fields }); },
    feedback() { return find(render(), node => ['alert', 'status'].includes(node.props?.role))?.props.children || ''; },
    respondWith(fn) { respond = fn; },
    switchAccount() { session = { account: { id: `${role}-two`, role }, accessToken: 'new-user-token' }; },
    session: () => session,
    setSession(value) { session = value; },
    openDeletion() { find(render(), node => node.type === 'button' && node.props.children === 'Delete account').props.onClick(); },
    deletionForm: () => find(render(), node => node.props?.id === 'vip-delete-form'),
    confirmDeletion(value) { find(render(), node => node.props?.id === 'vip-delete-confirmation').props.onChange({ target: { value } }); },
    submitDeletion() { return find(render(), node => node.props?.id === 'vip-delete-form').props.onSubmit({ preventDefault() {} }); },
    unmount() { for (const cleanup of cleanups) cleanup?.(); },
  };
}

for (const role of ['customer']) describe(`VIP sign-in details`, () => {
test('each credential form drops below its own button and closes when toggled or cancelled', () => {
  const f = fixture(role);
  const dropdown = credential => f.find(f.render(), node => node.props?.className === 'vip-credentials-dropdown' && node.key === credential);
  const button = credential => f.find(dropdown(credential), node => node.type === 'button');
  assert.equal(f.form(), null);
  for (const credential of ['email', 'password']) {
    f.open(credential);
    const group = dropdown(credential);
    assert.equal(group.props.children[0].type, 'button');
    assert.equal(group.props.children[1].props.credential, credential);
    assert.equal(button(credential).props['aria-expanded'], true);
    assert.equal(button(credential).props['aria-controls'], `vip-credentials-${credential}-form`);
    const other = credential === 'email' ? 'password' : 'email';
    assert.equal(button(other).props['aria-expanded'], false);
    assert.equal(dropdown(other).props.children[1], null);
  }
  f.open('password');
  assert.equal(f.form(), null);
  f.open('email');
  f.form().props.onCancel();
  assert.equal(f.form(), null);
  assert.equal(f.requests.length, 0);
});

test('email change rejects the current address and only submits the normalized new email', async () => {
  const f = fixture(role);
  f.open('email');
  await f.submit({ email: ' ORIGINAL@example.com ' });
  assert.equal(f.requests.length, 0);
  assert.match(f.feedback(), /different email/);
  f.respondWith(async () => ({ account: f.account, message: 'Check your new email address to confirm the change.' }));
  await f.submit({ email: ' NEW@example.com ', password: 'must-not-be-sent' });
  assert.deepEqual(JSON.parse(f.requests[0].body), { email: 'new@example.com', returnTo: '/vip' });
  assert.equal(f.requests[0].expectedRole, role);
  assert.equal(f.updates[0].email, 'original@example.com');
  assert.match(f.feedback(), /confirm the change/);
  assert.equal(f.label('email'), '✓ Check your email');
  assert.equal(f.form(), null);
});

test('password changes require matching values and never submit confirmation or account identifiers', async () => {
  const f = fixture(role);
  f.open('password');
  await f.submit({ password: 'short', confirmPassword: 'short' });
  await f.submit({ password: 'New1!secure-password', confirmPassword: 'mismatch' });
  assert.equal(f.requests.length, 0);
  assert.match(f.feedback(), /don’t match/);
  await f.submit({ password: 'New1!secure-password', confirmPassword: 'New1!secure-password', email: 'ignored@example.com' });
  assert.deepEqual(JSON.parse(f.requests[0].body), { password: 'New1!secure-password' });
  assert.equal(f.requests[0].expectedRole, role);
  assert.equal(f.form(), null);
  assert.ok(!JSON.stringify(f.updates).includes('New1!secure-password'));
  assert.equal(f.label('password'), '✓ Password updated');
  f.open('password');
  assert.equal(f.label('password'), 'Change password');
});

test('a pending change prevents duplicate requests and waits for server confirmation', async () => {
  const f = fixture(role);
  let resolve;
  f.respondWith(() => new Promise(done => { resolve = done; }));
  f.open('email');
  const pending = f.submit({ email: 'new@example.com' });
  await f.submit({ email: 'second@example.com' });
  assert.equal(f.requests.length, 1);
  assert.equal(f.form().props.busy, true);
  assert.equal(f.updates.length, 0);
  assert.equal(f.label('email'), 'Change email');
  assert.equal(f.feedback(), '');
  resolve({ account: f.account, message: 'Check your email.' });
  await pending;
  assert.match(f.feedback(), /Check your email/);
});

test('provider failure keeps the form available without reporting a successful change', async () => {
  const f = fixture(role);
  f.respondWith(async () => { throw new Error('Unable to update email.'); });
  f.open('email');
  await f.submit({ email: 'new@example.com' });
  assert.match(f.feedback(), /Unable to update email/);
  assert.equal(f.form().props.busy, false);
  assert.equal(f.updates.length, 0);
});

test('changing accounts prevents credential submissions from the previous dashboard', async () => {
  const f = fixture(role);
  f.open('email');
  f.switchAccount();
  await f.submit({ email: 'new@example.com' });
  assert.equal(f.requests.length, 0);
  assert.match(f.feedback(), /Sign in again/);
});

for (const action of ['switchAccount', 'unmount']) test(`a late credential response is ignored after ${action}`, async () => {
  const f = fixture(role);
  let resolve;
  f.respondWith(() => new Promise(done => { resolve = done; }));
  f.open('password');
  const pending = f.submit({ password: 'New1!secure-password', confirmPassword: 'New1!secure-password' });
  f[action]();
  resolve({ account: f.account, message: 'Password updated.' });
  await pending;
  assert.equal(f.updates.length, 0);
  assert.equal(f.feedback(), '');
  if (action === 'unmount') assert.equal(f.requests[0].signal.aborted, true);
});
});

describe('VIP account deletion', () => {
test('opening and cancelling keeps the account intact and resets confirmation', () => {
  const f = fixture();
  assert.equal(f.deletionForm(), null);
  f.openDeletion();
  f.confirmDeletion('DELETE');
  f.find(f.deletionForm(), node => node.type === 'button' && node.props.children === 'Cancel').props.onClick();
  assert.equal(f.deletionForm(), null);
  f.openDeletion();
  assert.equal(f.find(f.deletionForm(), node => node.type === 'input').props.value, '');
  assert.equal(f.requests.length, 0);
  assert.ok(f.session());
});

test('deletion requires exact confirmation and calls only the signed-in customer endpoint', async () => {
  const f = fixture();
  f.openDeletion();
  for (const value of ['', 'delete', 'DELETE ']) {
    f.confirmDeletion(value);
    assert.equal(f.find(f.deletionForm(), node => node.props?.type === 'submit').props.disabled, true);
    await f.submitDeletion();
  }
  assert.equal(f.requests.length, 0);
  f.confirmDeletion('DELETE');
  assert.equal(f.find(f.deletionForm(), node => node.props?.type === 'submit').props.disabled, false);
  await f.submitDeletion();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].method, 'DELETE');
  assert.equal(f.requests[0].expectedRole, 'customer');
  assert.equal(f.requests[0].body, undefined, 'the server chooses the authenticated account');
  assert.equal(f.session(), null);
  assert.deepEqual(f.navigations, ['/']);
  assert.deepEqual(f.alerts, []);
});

test('deletion cannot overlap a credential change or be submitted twice', async () => {
  const f = fixture();
  let resolve;
  f.respondWith(() => new Promise(done => { resolve = done; }));
  f.open('email');
  const saving = f.submit({ email: 'new@example.com' });
  f.openDeletion();
  assert.equal(f.deletionForm(), null);
  resolve({ account: f.account });
  await saving;
  f.openDeletion();
  f.confirmDeletion('DELETE');
  const deleting = f.submitDeletion();
  await f.submitDeletion();
  f.open('password');
  assert.equal(f.form(), null);
  assert.equal(f.requests.length, 2);
  assert.equal(f.find(f.deletionForm(), node => node.props?.type === 'submit').props.children, 'Deleting…');
  resolve({ ok: true });
  await deleting;
});

for (const session of [null, { account: { id: 'customer-two', role: 'customer' }, accessToken: 'other' }, { account: { id: 'customer-one', role: 'venue' }, accessToken: 'wrong-role' }]) {
  test(`stale or wrong-role account cannot delete (${session?.account?.role || 'signed out'} ${session?.account?.id || ''})`, async () => {
    const f = fixture();
    f.openDeletion(); f.confirmDeletion('DELETE'); f.setSession(session);
    await f.submitDeletion();
    assert.equal(f.requests.length, 0);
    assert.match(f.feedback(), /Sign in again/);
    assert.deepEqual(f.navigations, []);
  });
}

test('failed deletion signs out the requesting session and explains that deletion was not confirmed', async () => {
  const f = fixture();
  f.respondWith(async () => { throw new Error('Account login could not be removed.'); });
  f.openDeletion(); f.confirmDeletion('DELETE');
  await f.submitDeletion();
  assert.equal(f.session(), null);
  assert.match(f.alerts[0], /Account login could not be removed.*sign in again/i);
  assert.deepEqual(f.navigations, ['/']);
});

for (const success of [true, false]) test(`late deletion ${success ? 'success' : 'failure'} preserves a different signed-in account`, async () => {
  const f = fixture();
  let settle;
  f.respondWith(() => new Promise((resolve, reject) => { settle = () => success ? resolve({ ok: true }) : reject(new Error('Failure')); }));
  f.openDeletion(); f.confirmDeletion('DELETE');
  const deleting = f.submitDeletion();
  f.switchAccount();
  const newer = f.session();
  settle(); await deleting;
  assert.equal(f.session(), newer);
  assert.deepEqual(f.navigations, []);
  assert.deepEqual(f.alerts, []);
});

for (const unmounted of [false, true]) test(`successful deletion clears refreshed credentials${unmounted ? ' after leaving the Account tab' : ''}`, async () => {
  const f = fixture();
  let resolve;
  f.respondWith(() => new Promise(done => { resolve = done; }));
  f.openDeletion(); f.confirmDeletion('DELETE');
  const deleting = f.submitDeletion();
  f.setSession({ ...f.session(), accessToken: 'refreshed-token', refreshToken: 'refreshed-refresh' });
  if (unmounted) f.unmount();
  resolve({ ok: true }); await deleting;
  assert.equal(f.session(), null);
  assert.deepEqual(f.navigations, ['/']);
});

test('late failure cannot sign out a newer session for the same account', async () => {
  const f = fixture();
  let reject;
  f.respondWith(() => new Promise((_, fail) => { reject = fail; }));
  f.openDeletion(); f.confirmDeletion('DELETE');
  const deleting = f.submitDeletion();
  const newer = { ...f.session(), accessToken: 'new-session-token', refreshToken: 'new-session-refresh' };
  f.setSession(newer);
  reject(new Error('Timed out')); await deleting;
  assert.equal(f.session(), newer);
  assert.deepEqual(f.navigations, []);
});
});

test('VIP credentials stay in the VIP dashboard with only notification preferences shared', () => {
  const dashboard = readFileSync(new URL('../app/vip/VipDashboard.tsx', import.meta.url), 'utf8');
  const guestDashboard = readFileSync(new URL('../app/dashboard/DashboardClient.tsx', import.meta.url), 'utf8');
  const shell = readFileSync(new URL('../src/live-shell/shell.html', import.meta.url), 'utf8');
  assert.match(dashboard, /<VipAccountPanel/);
  assert.deepEqual([...dashboard.matchAll(/href="(\/dashboard\/customer[^"]*)"/g)].map(match => match[1]),
    ['/dashboard/customer#customer-alerts']);
  assert.doesNotMatch(guestDashboard, /CustomerVipShortcut/);
  assert.doesNotMatch(shell, /id="vipDashboardLink"/);
  assert.match(shell, /id="vipSignInLink" href="\/vip">VIP sign in/);
});
