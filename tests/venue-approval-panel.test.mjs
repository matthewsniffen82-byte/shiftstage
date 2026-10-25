import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../app/dashboard/VenueApprovalPanel.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const text = node => typeof node === 'string' ? node : node && typeof node === 'object' ? [node.props?.children].flat(Infinity).map(text).join(' ') : '';
const find = (node, predicate) => {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const child of [node.props?.children].flat(Infinity)) { const result = find(child, predicate); if (result) return result; }
  return null;
};

function fixture(status = 'pending') {
  const slots = [], requests = [], cleanups = [], exports = {};
  let index = 0, approved = 0, changes = 0;
  vm.runInNewContext(code, { exports, AbortController, require(name) {
    if (name === 'react/jsx-runtime') return require(name);
    if (name === 'react') return {
      useState(initial) { const slot = index++; if (!(slot in slots)) slots[slot] = initial; return [slots[slot], value => { changes++; slots[slot] = value; }]; },
      useRef(initial) { const slot = index++; return slots[slot] ||= { current: initial }; },
      useEffect(callback) { const slot = index++; if (!(slot in slots)) { slots[slot] = true; cleanups.push(callback()); } },
    };
    if (name === './dashboard-session') return { requestDashboardJson: (path, options) => new Promise((resolve, reject) => requests.push({ path, options, resolve, reject })) };
    throw new Error(`Unexpected import: ${name}`);
  } });
  const render = () => { index = 0; return exports.default({ request: { id: 'request-one', venueName: 'Test club', status }, onApproved: () => { approved++; } }); };
  return {
    requests, render, text: () => text(render()),
    button: () => find(render(), node => node.type === 'button'),
    check: () => find(render(), node => node.type === 'button').props.onClick(),
    result: () => text(find(render(), node => node.props?.role === 'status')),
    approved: () => approved, changes: () => changes,
    unmount: () => cleanups.forEach(cleanup => cleanup?.()),
  };
}

test('pending approval checks stay in the panel and give a visible result', async () => {
  const f = fixture();
  assert.equal(f.result(), '');
  const checking = f.check();
  assert.equal(f.button().props.disabled, true);
  assert.match(f.text(), /Checking…/);
  assert.match(f.text(), /Waiting for approval/);
  assert.equal(f.requests[0].path, '/api/venue/signup-requests');
  assert.equal(f.requests[0].options.cache, 'no-store');
  assert.equal(f.requests[0].options.expectedRole, 'venue');
  f.requests[0].resolve({ request: { status: 'pending' } });
  await checking;
  assert.equal(f.approved(), 0, 'pending checks must not reload the dashboard or remount Help');
  assert.match(f.result(), /Checked—still waiting for approval/);
  assert.equal(f.button().props.disabled, false);
  const again = f.check();
  assert.equal(f.requests.length, 2);
  f.requests[1].resolve({ request: { status: 'pending' } });
  await again;
  assert.equal(f.approved(), 0);
  assert.equal(find(f.render(), node => node.type === 'a').props.href, '#venue-support');
});

test('a rejected request updates the heading and result in place', async () => {
  const f = fixture();
  const checking = f.check();
  f.requests[0].resolve({ request: { status: 'rejected' } });
  await checking;
  assert.match(f.text(), /Request not approved/);
  assert.match(f.result(), /Checked—your club request was not approved/);
  assert.equal(f.approved(), 0);
});

for (const request of [{ status: 'approved' }, null]) test(`a ${request ? 'newly approved' : 'no longer pending'} request loads the authorized dashboard`, async () => {
  const f = fixture();
  const checking = f.check();
  f.requests[0].resolve({ request });
  await checking;
  assert.equal(f.approved(), 1);
});

test('a failed check stays on the approval panel and can be retried', async () => {
  const f = fixture();
  const checking = f.check();
  f.requests[0].reject(new Error('Network unavailable'));
  await checking;
  assert.match(f.text(), /Waiting for approval/);
  assert.match(f.result(), /Unable to check approval right now/);
  assert.equal(f.button().props.disabled, false);
  assert.equal(f.approved(), 0);
  const retry = f.check();
  f.requests[1].resolve({ request: { status: 'pending' } });
  await retry;
  assert.match(f.result(), /still waiting for approval/);
});

test('rapid taps send only one approval request', async () => {
  const f = fixture();
  const first = f.check(), second = f.check();
  assert.equal(f.requests.length, 1);
  f.requests[0].resolve({ request: { status: 'pending' } });
  await Promise.all([first, second]);
});

for (const outcome of ['pending', 'approved', 'error']) test(`leaving cancels a check and ignores a late ${outcome} response`, async () => {
  const f = fixture();
  const checking = f.check();
  f.unmount();
  const changes = f.changes();
  assert.equal(f.requests[0].options.signal.aborted, true);
  if (outcome === 'error') f.requests[0].reject(new Error('Aborted'));
  else f.requests[0].resolve({ request: { status: outcome } });
  await checking;
  assert.equal(f.approved(), 0);
  assert.equal(f.changes(), changes);
});
