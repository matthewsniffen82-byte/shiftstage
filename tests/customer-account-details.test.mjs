import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../app/dashboard/CustomerAccountPanel.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function fixture() {
  const slots = [], cleanups = [], requests = [], updates = [];
  const account = { id: 'customer-one', role: 'customer', email: 'original@example.com', accountState: 'active' };
  let index = 0, session = { account }, respond = async () => ({ account, message: 'Confirmed by server.' });
  const hooks = {
    useState(initial) { const slot = index++; if (!(slot in slots)) slots[slot] = initial; return [slots[slot], next => { slots[slot] = typeof next === 'function' ? next(slots[slot]) : next; }]; },
    useRef(initial) { const slot = index++; return slots[slot] ||= { current: initial }; },
    useEffect(effect) { const slot = index++; if (!(slot in slots)) { slots[slot] = true; cleanups.push(effect()); } },
  };
  const exports = {};
  vm.runInNewContext(code, {
    exports, AbortController, Error,
    FormData: class { constructor(fields) { this.fields = fields; } get(key) { return this.fields[key] ?? null; } },
    require(name) {
      if (name === 'react') return hooks;
      if (name === 'react/jsx-runtime') return require(name);
      if (name === './dashboard-session') return { readSession: () => session, requestAccountJson: async request => { requests.push(request); return respond(request); } };
      throw new Error('Unexpected import: ' + name);
    },
  });
  const render = () => { index = 0; return exports.default({ account, onAccountChange: next => updates.push(next) }); };
  const find = (node, match) => {
    if (!node || typeof node !== 'object') return null;
    if (match(node)) return node;
    for (const child of [node.props?.children].flat(Infinity)) { const found = find(child, match); if (found) return found; }
    return null;
  };
  const form = () => find(render(), node => node.props?.credential);
  return {
    account, requests, updates, render, find, form,
    open(credential) { find(render(), node => node.type === 'button' && node.key === credential).props.onClick(); },
    submit(fields) { return form().props.onSubmit({ preventDefault() {}, currentTarget: fields }); },
    feedback() { return find(render(), node => ['alert', 'status'].includes(node.props?.role))?.props.children || ''; },
    respondWith(fn) { respond = fn; },
    switchAccount() { session = { account: { id: 'customer-two', role: 'customer' } }; },
    unmount() { for (const cleanup of cleanups) cleanup?.(); },
  };
}

test('email change rejects the current address and only submits the normalized new email', async () => {
  const f = fixture();
  f.open('email');
  await f.submit({ email: ' ORIGINAL@example.com ' });
  assert.equal(f.requests.length, 0);
  assert.match(f.feedback(), /different email/);
  f.respondWith(async () => ({ account: f.account, message: 'Check your new email address to confirm the change.' }));
  await f.submit({ email: ' NEW@example.com ', password: 'must-not-be-sent' });
  assert.deepEqual(JSON.parse(f.requests[0].body), { email: 'new@example.com' });
  assert.equal(f.requests[0].expectedRole, 'customer');
  assert.equal(f.updates[0].email, 'original@example.com');
  assert.match(f.feedback(), /confirm the change/);
  assert.equal(f.form(), null);
});

test('password changes require matching values and never submit confirmation or account identifiers', async () => {
  const f = fixture();
  f.open('password');
  await f.submit({ password: 'short', confirmPassword: 'short' });
  await f.submit({ password: 'new-secure-password', confirmPassword: 'mismatch' });
  assert.equal(f.requests.length, 0);
  assert.match(f.feedback(), /don’t match/);
  await f.submit({ password: 'new-secure-password', confirmPassword: 'new-secure-password', email: 'ignored@example.com' });
  assert.deepEqual(JSON.parse(f.requests[0].body), { password: 'new-secure-password' });
  assert.equal(f.form(), null);
  assert.ok(!JSON.stringify(f.updates).includes('new-secure-password'));
});

test('a pending change prevents duplicate requests and waits for server confirmation', async () => {
  const f = fixture();
  let resolve;
  f.respondWith(() => new Promise(done => { resolve = done; }));
  f.open('email');
  const pending = f.submit({ email: 'new@example.com' });
  await f.submit({ email: 'second@example.com' });
  assert.equal(f.requests.length, 1);
  assert.equal(f.form().props.busy, true);
  assert.equal(f.updates.length, 0);
  assert.equal(f.feedback(), '');
  resolve({ account: f.account, message: 'Check your email.' });
  await pending;
  assert.match(f.feedback(), /Check your email/);
});

test('provider failure keeps the form available without reporting a successful change', async () => {
  const f = fixture();
  f.respondWith(async () => { throw new Error('Unable to update email.'); });
  f.open('email');
  await f.submit({ email: 'new@example.com' });
  assert.match(f.feedback(), /Unable to update email/);
  assert.equal(f.form().props.busy, false);
  assert.equal(f.updates.length, 0);
});

test('changing accounts prevents credential submissions from the previous dashboard', async () => {
  const f = fixture();
  f.open('email');
  f.switchAccount();
  await f.submit({ email: 'new@example.com' });
  assert.equal(f.requests.length, 0);
  assert.match(f.feedback(), /Sign in again/);
});

for (const action of ['switchAccount', 'unmount']) test(`a late credential response is ignored after ${action}`, async () => {
  const f = fixture();
  let resolve;
  f.respondWith(() => new Promise(done => { resolve = done; }));
  f.open('password');
  const pending = f.submit({ password: 'new-secure-password', confirmPassword: 'new-secure-password' });
  f[action]();
  resolve({ account: f.account, message: 'Password updated.' });
  await pending;
  assert.equal(f.updates.length, 0);
  assert.equal(f.feedback(), '');
  if (action === 'unmount') assert.equal(f.requests[0].signal.aborted, true);
});
