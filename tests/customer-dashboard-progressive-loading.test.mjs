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
import * as deviceDeals from '../src/lib/dancr/customer-device-deals.ts';

const require = createRequire(import.meta.url);

function renderCustomerDashboard(initialState = {}, deviceSavedDeals = []) {
  const source = readFileSync(new URL('../app/dashboard/DashboardClient.tsx', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  let stateIndex = 0;
  vm.runInNewContext(code, { exports, require: (name) => {
    if (name === 'react') return { ...React, useState: (value) => {
      const index = stateIndex++;
      return React.useState(index === 0 ? initialState : index === 3 ? deviceSavedDeals : value);
    } };
    if (name.endsWith('/customer-device-deals')) return deviceDeals;
    if (name === 'react/jsx-runtime') return require(name);
    if (name === 'next/link') return { default: ({ children, href }) => React.createElement('a', { href }, children) };
    return new Proxy(() => null, { get: (_target, key) => key === '__esModule' ? false : () => null });
  } });
  return renderToStaticMarkup(React.createElement(exports.default, { role: 'customer' })).replace(/<style>[\s\S]*?<\/style>/g, '');
}

test('customer dashboard renders its real sections before any authenticated request completes', () => {
  const html = renderCustomerDashboard();
  for (const section of ['Followed Dancers', 'Favorite Clubs', 'Saved Club Deals', 'Alerts', 'Account']) assert.ok(html.includes(section), section);
  assert.match(html, /Loading followed dancers/);
  assert.match(html, /Loading your saved deals/);
  assert.doesNotMatch(html, /venue-dashboard-loading-pill|No followed dancers yet|No saved club deals/);
});

test('an account timeout keeps the customer dashboard and retry available without suggesting sign-in', () => {
  const html = renderCustomerDashboard({ account: { displayName: 'Customer QA' }, accountError: "We couldn't refresh your account right now. Please try again." });
  for (const text of ['Customer dashboard', 'Customer QA', 'Followed Dancers', 'Favorite Clubs', 'Saved Club Deals', 'Try again']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /Guest dashboard|href="\/account\?role=customer"/);
});

test('an expired session still offers sign-in and hides protected dashboard sections', () => {
  const html = renderCustomerDashboard({ error: 'Your sign-in expired. Sign in again to continue.', signInRequired: true });
  assert.match(html, /href="\/account\?role=customer"/);
  assert.doesNotMatch(html, /Followed Dancers|Saved Club Deals/);
});

test('a followed profile becoming unavailable retains its saved follow and removal control', () => {
  const html = renderCustomerDashboard({ saved: { follows: [{ dancerId: 'temporarily-unavailable', dancer: null }] } });
  assert.match(html, /Unavailable dancer/);
  assert.match(html, /Your follow is saved/);
  assert.match(html, />Unfollow<\/button>/);
  assert.doesNotMatch(html, /No followed dancers yet/);
});

const localBookmarks = deviceDeals.readDeviceSavedClubDeals({ getItem: () => JSON.stringify([
  { id: 'nfc:club:one', venueId: 'club', dealId: 'one', venueName: 'Silver Circuit', title: 'Half-off admission' },
  { id: 'nfc:club:two', venueId: 'club', dealId: 'two', venueName: 'Neon Ember', title: 'Skip the line' },
]) });

for (const [label, state] of [
  ['empty account', { saved: { dealSaves: [] } }],
  ['account still loading', {}],
  ['saved activity unavailable', { savedError: 'Saved activity is temporarily unavailable.' }],
]) {
  test(`device bookmarks render in the dashboard with an ${label}`, () => {
    const html = renderCustomerDashboard(state, localBookmarks);
    assert.match(html, /Half-off admission/);
    assert.match(html, /Skip the line/);
    assert.equal((html.match(/Saved on this device/g) || []).length, 2);
    assert.match(html, /saved-deal-head[\s\S]*?<strong>2<\/strong>/);
    assert.match(html, /href="\/\?city=Las%20Vegas&amp;venue=silver-circuit"/);
    assert.doesNotMatch(html, /No saved Club Deals yet|No longer available/);
    if (!state.saved && !state.savedError) assert.match(html, /Loading followed dancers/);
    if (state.savedError) assert.match(html, /Account saves could not be loaded/);
  });
}

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

for (const failure of ['timeout', 'unavailable', 'network']) {
  test(`an account ${failure} preserves the session and still loads independently authenticated saved activity`, async (t) => {
    setup(t);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const updates = [];
    const sessionBefore = window.localStorage.getItem(DASHBOARD_SESSION_KEY);
    globalThis.fetch = async (path, { signal }) => {
      if (path === '/api/account') {
        if (failure === 'network') throw new TypeError('Failed to fetch');
        if (failure === 'unavailable') return new Response(JSON.stringify({ ok: false }), { status: 503 });
        return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
      }
      return response(path === '/api/customer/saved' ? { saved: { follows: [{ dancerId: 'still-followed' }] } } : {});
    };
    const loading = loadCustomerDashboard(new AbortController().signal, (panel, data) => updates.push({ panel, data }));
    if (failure === 'timeout') t.mock.timers.tick(15000);
    await loading;
    assert.ok(updates.some(update => update.panel === 'accountError'));
    assert.deepEqual(updates.find(update => update.panel === 'saved').data.follows, [{ dancerId: 'still-followed' }]);
    assert.equal(window.localStorage.getItem(DASHBOARD_SESSION_KEY), sessionBefore);
  });
}

for (const status of [401, 403, 404]) {
  test(`an account ${status} stops loading private customer panels`, async (t) => {
    setup(t);
    const paths = [], updates = [];
    globalThis.fetch = async (path) => {
      paths.push(path);
      return new Response(JSON.stringify({ ok: false, error: 'Account unavailable.' }), { status });
    };
    await assert.rejects(loadCustomerDashboard(new AbortController().signal, (panel) => updates.push(panel)), error => error.status === status);
    assert.deepEqual(paths, ['/api/account']);
    assert.deepEqual(updates, []);
  });
}

test('closing the dashboard during account loading does not publish a failure or request more panels', async (t) => {
  setup(t);
  const controller = new AbortController(), updates = [], paths = [];
  globalThis.fetch = async (path, { signal }) => {
    paths.push(path);
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  };
  const loading = loadCustomerDashboard(controller.signal, (panel) => updates.push(panel));
  controller.abort();
  await assert.rejects(loading, { name: 'AbortError' });
  assert.deepEqual(updates, []);
  assert.deepEqual(paths, ['/api/account']);
});


