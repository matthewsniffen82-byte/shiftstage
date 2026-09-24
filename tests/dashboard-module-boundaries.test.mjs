import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as deviceDeals from '../src/lib/dancr/customer-device-deals.ts';

const require = createRequire(import.meta.url);
const files = ['DashboardClient', 'DashboardShared', 'CustomerDashboardPanels', 'VenueDashboardPanels', 'DancerDashboardPanels', 'DancerProfileEditor', 'DancerAvatarPanel', 'DancerPhotoPanel', 'DancerShiftsPanel', 'DashboardStyles'];
const source = name => readFileSync(new URL('../app/dashboard/' + name + '.tsx', import.meta.url), 'utf8');

test('dashboard role boundaries stay small and shared controls cannot import role panels', () => {
  const root = source('DashboardClient');
  assert.ok(root.split('\n').length < 900);
  for (const role of ['Dancer', 'Venue']) {
    assert.match(root, new RegExp('dynamic\\(\\(\\) => import\\("\\./' + role + 'DashboardPanels"\\)'));
    assert.doesNotMatch(root, new RegExp('from "\\./' + role + 'DashboardPanels"'));
  }
  for (const file of files) assert.ok(source(file).split('\n').length < 1800, file);
  assert.doesNotMatch(source('DashboardShared'), /from "\.\/(?:Dancer|Venue|Customer)(?:DashboardPanels|ProfileEditor|PhotoPanel|AvatarPanel)"/);
  assert.doesNotMatch(source('DancerProfileEditor'), /from "\.\/DancerDashboardPanels"/);
});

// Load actual module imports, including resolved dynamic components. This catches
// missing exports/cycles that the compatibility source view cannot exercise.
async function renderDashboard(role, initialState = {}, loading = true) {
  const cache = new Map();
  const pending = [];
  let stateIndex = 0;
  function load(name) {
    if (cache.has(name)) return cache.get(name);
    const exports = {};
    cache.set(name, exports);
    const code = ts.transpileModule(source(name), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { exports, require: path => {
      if (path === 'react') return { ...React, useState: value => {
        const index = stateIndex++;
        return React.useState(index === 0 ? initialState : index === 1 ? loading : value);
      } };
      if (path === 'react/jsx-runtime') return require(path);
      if (path === 'next/link') return { default: ({ children, href }) => React.createElement('a', { href }, children) };
      if (path === 'next/dynamic') return { default: loader => {
        let component = () => null;
        pending.push(loader().then(result => { component = result.default || result; }));
        return props => React.createElement(component, props);
      } };
      if (path.endsWith('/customer-device-deals')) return deviceDeals;
      if (path.endsWith('/payout-copy')) return require('../src/lib/dancr/payout-copy.ts');
      if (path.endsWith('/profile-approval')) return require('../src/lib/dancr/profile-approval.ts');
      if (path.endsWith('/club-deal-presets')) return require('../src/lib/dancr/club-deal-presets.ts');
      if (files.includes(path.slice(2))) return load(path.slice(2));
      return new Proxy(() => null, { get: (_target, key) => key === 'then' ? undefined : key === '__esModule' ? false : () => null });
    } });
    return exports;
  }
  const root = load('DashboardClient');
  while (pending.length) await Promise.all(pending.splice(0));
  return renderToStaticMarkup(React.createElement(root.default, { role })).replace(/<style>[\s\S]*?<\/style>/g, '');
}
test('customer dashboard renders through real module imports before data arrives', async () => {
  const html = await renderDashboard('customer');
  for (const text of ['Followed Dancers', 'Favorite Clubs', 'Saved Club Deals', 'Account']) assert.ok(html.includes(text), text);
});
test('session recovery still hides protected content through the new module graph', async () => {
  const html = await renderDashboard('customer', { error: 'Sign in again', signInRequired: true });
  assert.match(html, /role=customer/);
  assert.doesNotMatch(html, /Followed Dancers/);
});

for (const scenario of ['active', 'cancelled', 'empty']) test('guest dashboard prioritizes only active plans: ' + scenario, async () => {
  const goingSignals = scenario === 'empty' ? [] : [{
    shiftId: 'test-shift',
    shift: {
      id: 'test-shift', status: scenario === 'cancelled' ? 'cancelled' : 'posted',
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      endsAt: new Date(Date.now() + 3_600_000).toISOString(),
      dancer: { id: 'test-dancer', stageName: 'Sample dancer' },
      venue: { id: 'test-club', name: 'Sample club' },
    },
  }];
  const html = await renderDashboard('customer', {
    account: { role: 'customer', displayName: 'Sample guest' },
    saved: { follows: [], venueFollows: [], dealSaves: [], goingSignals },
  }, false);
  const firstSection = html.match(/<details[^>]+id="([^"]+)"[^>]*>/)?.[0] || '';
  assert.match(firstSection, scenario === 'active' ? /id="customer-going"/ : /id="customer-followed-dancers"/);
  assert.match(firstSection, /open=""/);
  assert.equal((html.match(/id="customer-going"/g) || []).length, 1);
  assert.equal(html.includes('data-has-plans="true"'), scenario === 'active');
});
for (const role of ['dancer', 'venue']) test(role + ' panels render after their dynamic modules resolve', async () => {
  const html = await renderDashboard(role, { account: { role, displayName: 'Module test' }, profile: { stageName: 'Module test', city: 'Las Vegas' } }, false);
  assert.ok(html.includes(role === 'dancer' ? 'Profile setup' : 'Club Deals'));
  assert.ok(html.includes(role + '-dashboard'));
  assert.doesNotMatch(html, /Loading your dashboard/);
});
