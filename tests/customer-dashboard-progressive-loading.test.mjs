import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadCustomerDashboard } from '../app/dashboard/customer-dashboard-loader.ts';
import { DASHBOARD_SESSION_KEY } from '../app/dashboard/dashboard-session.ts';

const require = createRequire(import.meta.url);

test('guest dashboard renders its real sections before any authenticated request completes', () => {
  const source = readFileSync(new URL('../app/dashboard/DashboardClient.tsx', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: (name) => {
    if (name === 'react' || name === 'react/jsx-runtime') return require(name);
    if (name === 'next/link') return { default: ({ children, href }) => React.createElement('a', { href }, children) };
    return new Proxy(() => null, { get: (_target, key) => key === '__esModule' ? false : () => null });
  } });
  const html = renderToStaticMarkup(React.createElement(exports.default, { role: 'customer' })).replace(/<style>[\s\S]*?<\/style>/g, '');
  for (const section of ['Followed Dancers', 'Followed Clubs', 'Saved Club Deals', 'Alerts', 'Account']) assert.ok(html.includes(section), section);
  assert.match(html, /Loading followed dancers/);
  assert.match(html, /Loading your saved deals/);
  assert.doesNotMatch(html, /venue-dashboard-loading-pill|No followed dancers yet|No saved club deals/);
});

function setup(t) {
  const previousWindow = globalThis.window;
  globalThis.window = { localStorage: {
    getItem: (key) => key === DASHBOARD_SESSION_KEY ? JSON.stringify({ accessToken: 'test-token', refreshToken: 'test-refresh' }) : null,
    setItem() {},
  } };
  t.after(() => { globalThis.window = previousWindow; });
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ ok: true })));
  t.mock.method(console, 'warn', () => {});
}
const response = (data) => new Response(JSON.stringify({ ok: true, ...data }));

test('account and saved activity publish while support and referral access are still pending', async (t) => {
  setup(t);
  const controller = new AbortController();
  const updates = [];
  let savedReady;
  const ready = new Promise(resolve => { savedReady = resolve; });
  globalThis.fetch = async (path, { signal }) => {
    if (path === '/api/account') return response({ account: { role: 'customer' } });
    if (path === '/api/customer/saved') return response({ saved: { follows: [{ dancerId: 'test-dancer' }] } });
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  };
  const loading = loadCustomerDashboard(controller.signal, (panel, data) => {
    updates.push({ panel, data });
    if (panel === 'saved') savedReady();
  });
  await ready;
  assert.deepEqual(updates.map(update => update.panel), ['account', 'saved']);
  controller.abort();
  await assert.rejects(loading, { name: 'AbortError' });
  assert.equal(updates.length, 2);
});

test('saved activity failure leaves account available and reports an explicit panel error', async (t) => {
  setup(t);
  const updates = [];
  globalThis.fetch = async (path) => path === '/api/customer/saved'
    ? new Response(JSON.stringify({ ok: false, error: 'Saved activity is temporarily unavailable.' }), { status: 503 })
    : response(path === '/api/account' ? { account: { role: 'customer' } } : {});
  await loadCustomerDashboard(new AbortController().signal, (panel, data) => updates.push({ panel, data }));
  assert.ok(updates.some(update => update.panel === 'account'));
  assert.ok(updates.some(update => update.panel === 'savedError' && /temporarily unavailable/.test(update.data)));
  assert.ok(!updates.some(update => update.panel === 'saved'));
});


