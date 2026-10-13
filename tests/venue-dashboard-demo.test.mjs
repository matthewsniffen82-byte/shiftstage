import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as demo from '../src/lib/dancr/venue-dashboard-demo.ts';
import { scoreVenueDancers } from '../src/lib/dancr/venue-dancer-scores.ts';

const now = new Date('2026-10-13T06:00:00Z');
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
// The authorized production response uses the original slug, not the display-name slug.
const echo = { id: '260a8cc4-e7d9-46b8-8ef3-a041fd4fe2af', name: 'Echo House', slug: 'talk-of-the-town' };

test('the production Echo House identity gets samples and other venue identities do not', () => {
  assert.equal(demo.isVenueDashboardDemo(echo), true);
  for (const profile of [undefined, null, {}, { ...echo, id: 'real-venue' }, { ...echo, slug: 'real-club' },
    { ...echo, slug: 'echo-house' }, { name: 'Echo House' }, { slug: 'talk-of-the-town' }]) {
    assert.equal(demo.isVenueDashboardDemo(profile), false);
  }
});

test('all periods populate eight dancers, with Tonight awaiting enough checkout days to rank', () => {
  let lastClaims = 0;
  const overall = [];
  for (const period of Object.keys(demo.DEMO_PERIODS)) {
    const data = demo.createVenueDashboardDemo(period, now);
    assert.ok(data.report.current.claims > lastClaims); lastClaims = data.report.current.claims;
    assert.ok(Date.parse(data.periodStart) < Date.parse(data.periodEnd));
    assert.ok(Date.parse(data.report.trackingStartedAt) <= Date.parse(data.periodStart));
    assert.equal(data.report.interactions.length, 52);
    assert.equal(new Set(data.report.interactions.map(row => row.source)).size, 4);
    assert.equal(data.report.videos.length, 4);
    assert.equal(data.report.hairColor.internal.length, 4);
    assert.equal(data.report.hairColor.external.length, 4);
    const scored = scoreVenueDancers(data.report.performance.dancers, period);
    assert.equal(scored.length, 8);
    assert.ok(scored.every(row => period === 'tonight' ? row.rank === null && row.scores.checkIns.confidence === 'early' : row.rank !== null && row.rankedCount === 8));
    for (const row of scored) for (const score of Object.values(row.scores)) assert.ok(Number.isInteger(score.value) && score.value >= 0 && score.value <= 100);
    overall.push(scored.map(row => row.scores.overall.value).join(','));
    for (const section of ['guestList', 'rides', 'vip', 'tables', 'contacts', 'roster', 'deals', 'team', 'notifications', 'support']) assert.ok(data[section].length > 0, section);
  }
  assert.ok(new Set(overall).size > 1, 'periods demonstrate different results');
});

test('queue totals match the visible sample records and stay live independently of the historical period', () => {
  const expected = demo.createVenueDashboardDemo('tonight', now).operations;
  for (const period of Object.keys(demo.DEMO_PERIODS)) {
    const data = demo.createVenueDashboardDemo(period, now);
    assert.deepEqual(data.operations, expected);
    assert.equal(data.operations.tablePending, data.tables.filter(row => row.status === 'Pending').length);
    assert.equal(data.operations.vipPending, data.vip.filter(row => row.status === 'Pending').length);
    assert.equal(data.operations.guestExpected, data.guestList.filter(row => row.status === 'Awaiting admission').length);
    assert.equal(data.operations.ridesOpen, data.rides.filter(row => ['Received', 'Contacted', 'Arranged'].includes(row.status)).length);
    assert.equal(data.report.performance.tonight.tablePending, data.operations.tablePending);
    assert.equal(data.report.performance.tonight.vipPending, data.operations.vipPending);
  }
  assert.equal(demo.createVenueDashboardDemo('tonight', now).report.current.admissions, expected.admitted);
});

test('sample counts reconcile, conversion and completion rates are bounded, and videos have consistent funnels', () => {
  for (const period of Object.keys(demo.DEMO_PERIODS)) {
    const { report, conversion } = demo.createVenueDashboardDemo(period, now);
    const totals = report.performance.current;
    assert.equal(totals.tableRequests, totals.tablePending + totals.tableAcknowledged + totals.tableCompleted + totals.tableCancelled);
    assert.equal(totals.vipRequests, totals.vipPending + totals.vipConfirmed + totals.vipDeclined + totals.vipCancelled);
    assert.ok(report.current.admissions <= report.current.claims);
    assert.equal(conversion, Math.round(report.current.admissions / report.current.claims * 100));
    for (const dancer of report.performance.dancers) {
      assert.ok(dancer.internal.cancelled >= 0);
      assert.ok(dancer.internal.completed <= dancer.internal.requests);
      assert.ok(dancer.results.profileCohortConversions <= dancer.results.profileClaims);
      assert.ok(dancer.results.tableAttendanceUnrecorded >= 0);
    }
    for (const video of report.videos) {
      assert.ok(video.metrics.completed <= video.metrics.engaged_view && video.metrics.engaged_view <= video.metrics.impression);
      assert.ok(video.metrics.admissions <= video.metrics.claims);
    }
    assert.equal(report.hairColor.internal.reduce((sum, row) => sum + row.metrics.requests, 0), totals.tableRequests);
    assert.equal(report.hairColor.external.reduce((sum, row) => sum + row.metrics.admissions, 0), totals.profileConversions);
  }
});

test('fixtures are deterministic, isolated and contain no usable contacts, credentials, or pass tokens', () => {
  const photos = [{ name: 'Aria', url: '/sample-aria.jpg', dancerId: 'approved-aria-id' }];
  const first = demo.createVenueDashboardDemo('30d', now, photos);
  assert.deepEqual(first, demo.createVenueDashboardDemo('30d', now, photos));
  assert.equal(first.roster[0].photoUrl, '/sample-aria.jpg');
  assert.equal(first.roster[0].profileDancerId, 'approved-aria-id');
  assert.equal(first.tables[0].dancer, first.roster[0]);
  assert.equal(first.roster[1].profileDancerId, null, 'never send synthetic dancer IDs to the profile API');
  assert.equal(first.report.performance.dancers[0].photoUrl, '/sample-aria.jpg');
  first.report.performance.dancers[0].internal.requests = 0;
  assert.ok(demo.createVenueDashboardDemo('30d', now).report.performance.dancers[0].internal.requests > 0);
  for (const section of ['roster', 'guestList', 'rides', 'vip', 'tables', 'contacts']) assert.ok(first[section].every(row => row.id.startsWith('demo-')));
  assert.doesNotMatch(JSON.stringify(first), /accessToken|refreshToken|redemptionToken|tel:|mailto:/);
  assert.ok(first.contacts.every(row => row.detail.includes('@example.invalid')));
  const code = read('app/dashboard/VenueDemoDashboard.tsx') + read('src/lib/dancr/venue-dashboard-demo.ts');
  assert.doesNotMatch(code, /fetch\(|requestDashboard|requestAccount|supabase|localStorage|sessionStorage|\/api\//);
});

const require = createRequire(import.meta.url);
const jsx = require('react/jsx-runtime');
const profileDependencies = { VenueRosterProfileButton: ({ dancerId, stageName, children, className }) => React.createElement('button', {
  type: 'button', 'data-profile-id': dancerId, 'aria-label': `View ${stageName} profile`, className,
}, children) };
function component(file, dependencies = {}, extra = '', globals = {}) {
  const state = []; let cursor = 0;
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read(file) + extra, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, Date, document: { getElementById: () => null }, ...globals, require(name) {
      if (name === 'react/jsx-runtime') return jsx;
      if (name === 'react') return { useState(initial) { const i = cursor++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial; return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; },
        useMemo: callback => callback(), useEffect() {} };
      if (name.endsWith('.css')) return {};
      if (name === '../internal/InternalRoster') return profileDependencies;
      if (name in dependencies) return dependencies[name];
      throw new Error('Unexpected import ' + name);
    } });
  return (props, name = 'default') => { cursor = 0; return exports[name](props); };
}
function nodes(node) { return node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)] : []; }

test('switch defaults Echo House to demo, unmounts live controls, and allows recorded data without affecting other venues', () => {
  const render = component('app/dashboard/VenueDashboardDemoSwitch.tsx', {
    '@/src/lib/dancr/venue-dashboard-demo': demo, 'next/dynamic': { default: () => 'DemoDashboard' },
  });
  const children = React.createElement('LiveDashboard');
  assert.equal(render({ profile: { id: 'real' }, workingNow: [], children }).props.children, children);
  let tree = nodes(render({ profile: echo, workingNow: [], children }));
  assert.ok(tree.some(node => node.type === 'DemoDashboard'));
  assert.ok(!tree.some(node => node.type === 'LiveDashboard'));
  assert.ok(tree.some(node => node.props.children === 'Demo data'));
  tree.find(node => node.type === 'input').props.onChange({ target: { checked: false } });
  tree = nodes(render({ profile: echo, workingNow: [], children }));
  assert.ok(tree.some(node => node.type === 'LiveDashboard'));
  assert.ok(!tree.some(node => node.type === 'DemoDashboard'));
});

test('demo workspace supports all tabs, period changes, filtering, and real report component integration', () => {
  const render = component('app/dashboard/VenueDemoDashboard.tsx', {
    '@/src/lib/dancr/venue-dashboard-demo': demo,
    './VenueDashboardIdentity': { VenueDashboardIcon: () => null },
    './VenueTonightOverview': { default: 'TonightOverview' },
    './VenueSetupChecklist': { default: 'SetupChecklist' },
    './VenueValueAnalytics': { default: 'ValueAnalytics' },
  }, '\nexport { DemoRows };');
  const props = { workingNow: [] };
  let tree = nodes(render(props));
  assert.equal(tree.find(node => node.props.id === 'demo-tonight').props.hidden, false);
  tree.find(node => node.props.id === 'demo-business-tab').props.onClick();
  tree = nodes(render(props));
  assert.equal(tree.find(node => node.props.id === 'demo-business').props.hidden, false);
  assert.ok(nodes(tree.find(node => node.props.className === 'venue-workspace-toolbar')).some(node => node.props['aria-label'] === 'Analytics period'));
  tree.find(node => node.type === 'button' && node.props.children === 'All time').props.onClick();
  tree = nodes(render(props));
  assert.equal(tree.find(node => node.type === 'ValueAnalytics').props.period, 'all');
  assert.equal(tree.find(node => node.type === 'ValueAnalytics').props.report.performance.dancers.length, 8);
  tree.find(node => node.type === 'TonightOverview').props.onOpen({ preventDefault() {} }, 'venue-vip');
  tree = nodes(render(props));
  assert.equal(tree.find(node => node.props.id === 'venue-vip').props.hidden, false);
  assert.equal(tree.find(node => node.props.id === 'demo-tonight').props.hidden, false);
  tree.find(node => node.type === 'TonightOverview').props.onOpen({ preventDefault() {} }, 'table-requests');
  tree = nodes(render(props));
  assert.equal(tree.find(node => node.props.id === 'demo-roster').props.hidden, false);
  tree.find(node => node.props.id === 'demo-venue-tab').props.onClick();
  assert.equal(nodes(render(props)).find(node => node.props.id === 'demo-venue').props.hidden, false);

  const rowRender = component('app/dashboard/VenueDemoDashboard.tsx', {
    '@/src/lib/dancr/venue-dashboard-demo': demo, './VenueDashboardIdentity': {}, './VenueTonightOverview': {}, './VenueSetupChecklist': {}, './VenueValueAnalytics': {},
  }, '\nexport { DemoRows };');
  const rows = demo.createVenueDashboardDemo('tonight', now).vip;
  tree = nodes(rowRender({ rows }, 'DemoRows'));
  tree.find(node => node.type === 'select').props.onChange({ target: { value: 'Pending' } });
  assert.equal(nodes(rowRender({ rows }, 'DemoRows')).filter(node => node.type === 'li').length, 2);
  tree.find(node => node.type === 'input').props.onChange({ target: { value: 'sample vip 2' } });
  assert.equal(nodes(rowRender({ rows }, 'DemoRows')).filter(node => node.type === 'li').length, 1);
  tree.find(node => node.type === 'input').props.onChange({ target: { value: 'no match' } });
  assert.match(renderToStaticMarkup(rowRender({ rows }, 'DemoRows')), /No sample records match/);
});

test('Echo House table QR entry leaves demo for recorded data and preserves the dashboard URL', () => {
  const window = { location: new URL('https://example.invalid/dashboard/venue?tab=venue'), history: { state: { saved: true } } };
  const replacements = [];
  window.history.replaceState = (state, title, path) => {
    replacements.push({ state, title, path });
    window.location = new URL(path, window.location);
  };
  const dependencies = { '@/src/lib/dancr/venue-dashboard-demo': demo, 'next/dynamic': { default: () => 'DemoDashboard' } };
  const render = component('app/dashboard/VenueDashboardDemoSwitch.tsx', dependencies, '', { window });
  const props = { profile: echo, workingNow: [], children: React.createElement('LiveDashboard') };
  const sample = nodes(render(props)).find(node => node.type === 'DemoDashboard');
  sample.props.onOpenTableQrCodes();
  const tree = nodes(render(props));
  assert.ok(tree.some(node => node.type === 'LiveDashboard'));
  assert.ok(!tree.some(node => node.type === 'DemoDashboard'));
  assert.ok(tree.some(node => node.props.children === 'Recorded data'));
  assert.equal(tree.find(node => node.type === 'input').props.checked, false);
  assert.equal(window.location.href, 'https://example.invalid/dashboard/venue?tab=venue#table-qr-codes');
  assert.equal(replacements[0].state, window.history.state);
  const reload = component('app/dashboard/VenueDashboardDemoSwitch.tsx', dependencies, '', { window });
  assert.ok(nodes(reload(props)).some(node => node.type === 'LiveDashboard'), 'QR deep links stay in recorded data on refresh');
});

test('demo table QR entry precedes the roster and explicitly opens recorded tools without sample mutations', () => {
  const render = component('app/dashboard/VenueDemoDashboard.tsx', {
    '@/src/lib/dancr/venue-dashboard-demo': demo, './VenueDashboardIdentity': {}, './VenueTonightOverview': {}, './VenueSetupChecklist': {}, './VenueValueAnalytics': {},
  });
  let opens = 0;
  const panel = nodes(render({ workingNow: [], onOpenTableQrCodes: () => { opens++; } })).find(node => node.props.id === 'demo-roster');
  const entry = panel.props.children[0];
  const button = nodes(entry).find(node => node.type === 'button');
  assert.equal(button.props.children, 'Table QR codes');
  assert.match(button.props.title, /leaves demo/);
  assert.ok(nodes(entry).some(node => node.props.children === 'Recorded data'));
  button.props.onClick();
  assert.equal(opens, 1);
  assert.equal(panel.props.children[1].props.id, 'venue-dancer-roster');
});

test('demo layout uses constrained mobile tracks and no real operation or contact links', () => {
  assert.doesNotMatch(read('app/dashboard/DashboardClient.tsx'), /VenueDashboardDemoSwitch|VenueDemoDashboard/);
  const source = read('app/dashboard/VenueDemoDashboard.tsx');
  assert.doesNotMatch(source, /<form|<a\s|href=|VenuePassScanner|offerPushNotifications|AccountControlsPanel|requestVenue/);
  const css = read('app/dashboard/venue-dashboard-demo.css');
  assert.match(css, /minmax\(0,1fr\)/);
  assert.match(css, /@media\(max-width:480px\)/);
  assert.match(css, /overflow-wrap:anywhere/);
  assert.match(css, /section\[hidden\].*display:none/);
  assert.match(css, /\.venue-demo-banner,\.venue-demo-workspace\s*\{\s*grid-column:1 \/ -1; min-width:0; width:100%/);
});

test('table cards show table, dancer, status and received time while preserving search and status filters', () => {
  const render = component('app/dashboard/VenueDemoDashboard.tsx', {
    '@/src/lib/dancr/venue-dashboard-demo': demo, './VenueDashboardIdentity': {}, './VenueTonightOverview': {}, './VenueSetupChecklist': {}, './VenueValueAnalytics': {},
  }, '\nexport { DemoRows };');
  const rows = [...demo.createVenueDashboardDemo('tonight', now).tables].reverse();
  let tree = nodes(render({ rows, dancerCards: true }, 'DemoRows'));
  const list = tree.find(node => node.props['aria-label'] === 'Table request cards');
  const html = renderToStaticMarkup(list);
  assert.equal((html.match(/class="venue-card-menu"/g) || []).length, rows.length);
  assert.match(html, /<summary class="dashboard-menu-trigger" aria-label="Request details for Table 1/);
  assert.deepEqual(Array.from(list.props.children.slice(0, 2), card => card.key), ['demo-table-0', 'demo-table-1']);
  for (const text of ['Aria', 'Table 1', 'Pending', '2 guests', 'Received:', 'dateTime="2026-10-13T05:55:00.000Z"']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /<button|Mark seen|Dismiss/, 'sample requests cannot perform live actions');
  tree.find(node => node.type === 'select').props.onChange({ target: { value: 'Completed' } });
  tree = nodes(render({ rows, dancerCards: true }, 'DemoRows'));
  assert.equal(tree.filter(node => node.type === 'li').length, 2);
  tree.find(node => node.type === 'input').props.onChange({ target: { value: 'Bailey' } });
  tree = nodes(render({ rows, dancerCards: true }, 'DemoRows'));
  assert.equal(tree.filter(node => node.type === 'li').length, 1);
  assert.equal(tree.find(node => node.type === 'li').key, 'demo-table-4');
  tree.find(node => node.type === 'input').props.onChange({ target: { value: 'missing' } });
  assert.match(renderToStaticMarkup(render({ rows, dancerCards: true }, 'DemoRows')), /No sample records match/);
});

test('roster and table identities open matching real profiles, including off-shift affiliations', () => {
  const render = component('app/dashboard/VenueDemoDashboard.tsx', {
    '@/src/lib/dancr/venue-dashboard-demo': demo, './VenueDashboardIdentity': { VenueDashboardIcon: () => null },
    './VenueTonightOverview': { default: () => null }, './VenueSetupChecklist': { default: () => null }, './VenueValueAnalytics': { default: () => null },
  });
  const names = ['Aria', 'Aurora', 'Autumn', 'Ava', 'Bailey', 'Bianca', 'Blair', 'Brooke'];
  const workingNow = names.slice(0, 6).map((stageName, i) => ({ stageName, dancerId: `real-${i}`, avatarUrl: `/avatar-${i}.jpg` }));
  const affiliations = names.slice(6).map((stageName, i) => ({ canViewProfile: true, dancerId: `real-${i + 6}`, dancer: { stageName, avatarUrl: `/avatar-${i + 6}.jpg` } }));
  const tree = nodes(render({ workingNow, affiliations }));
  const roster = tree.find(node => node.props['aria-label'] === 'Dancer roster cards');
  const rosterHtml = renderToStaticMarkup(roster);
  assert.doesNotMatch(rosterHtml, /venue-card-details|View profile ↗/, 'roster cards have no height-extending footer');
  assert.match(rosterHtml, /venue-card-caption[\s\S]*?Working now/);
  for (let i = 0; i < 8; i++) {
    assert.ok(rosterHtml.includes(`data-profile-id="real-${i}"`));
    assert.ok(rosterHtml.includes(`aria-label="View ${names[i]} profile"`));
    assert.ok(rosterHtml.includes(`src="/avatar-${i}.jpg"`));
  }
  const tables = tree.find(node => node.props.id === 'table-requests');
  const tableHtml = renderToStaticMarkup(tables);
  assert.equal((tableHtml.match(/data-profile-id=/g) || []).length, 6);
  for (let i = 0; i < 6; i++) assert.ok(tableHtml.includes(`data-profile-id="real-${i}"`));
  const empty = renderToStaticMarkup(nodes(render({ workingNow: [], affiliations: [{ ...affiliations[0], canViewProfile: false }] })).find(node => node.props['aria-label'] === 'Dancer roster cards'));
  assert.doesNotMatch(empty, /data-profile-id=|<button/);
  assert.match(empty, /aria-hidden="true">A<\/span>/);
});

test('demo renders the real report, score and queue components without network access or invalid values', () => {
  const cache = new Map();
  const modules = ['VenueDemoDashboard', 'VenueValueAnalytics', 'VenueDancerPerformance', 'VenueHairColorAnalytics', 'VenueTonightOverview', 'VenueSetupChecklist', 'VenueDashboardIdentity', 'VenueMostRequestedDancers'];
  function load(name) {
    if (cache.has(name)) return cache.get(name);
    const exports = {}; cache.set(name, exports);
    vm.runInNewContext(ts.transpileModule(read(`app/dashboard/${name}.tsx`), { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText, { exports, Date, require(path) {
      if (path === 'react') return React;
      if (path === 'react/jsx-runtime') return jsx;
      if (path.endsWith('.css')) return {};
      if (path === '../internal/InternalRoster') return profileDependencies;
      if (modules.includes(path.slice(2))) return load(path.slice(2));
      if (path.startsWith('@/src/lib/dancr/')) return require(`../src/lib/dancr/${path.split('/').at(-1)}.ts`);
      throw new Error(`Unexpected dependency: ${path}`);
    } });
    return exports;
  }
  const html = renderToStaticMarkup(React.createElement(load('VenueDemoDashboard').default, { workingNow: [] }));
  for (const text of ['Overall', 'Dancer performance', 'How scores are calculated', 'ranked dancers', 'Sample VIP', 'Sample guest', 'Sample party', 'Team &amp; activity', 'Check-in stickers', 'Video performance', 'Club Deals', 'Notification settings']) assert.ok(html.includes(text), text);
  assert.deepEqual(html.match(/NaN|Infinity|Invalid Date|Not enough data|Sign in required|class="venue-score-missing"/g), null);
});
