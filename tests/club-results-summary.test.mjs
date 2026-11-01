import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as analytics from '../src/lib/dancr/venue-analytics.ts';
import { createVenueDashboardDemo } from '../src/lib/dancr/venue-dashboard-demo.ts';

const jsx = (type, props) => ({ type, props });
const nodes = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)] : [];
const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync('app/dashboard/VenueValueAnalytics.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText, { exports, require(name) {
  if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
  if (name === 'react') return { useState: initial => [initial, () => {}] };
  if (name === '@/src/lib/dancr/venue-analytics') return analytics;
  return { default: 'Stub' };
} });

function summary(period, totals, available = true) {
  const fixture = createVenueDashboardDemo(period, new Date('2026-11-01T08:00:00Z'));
  Object.assign(fixture.report.automatic.current, totals);
  if (!available) fixture.report.automatic = null;
  const tree = exports.default({ report: fixture.report, period, periodStart: fixture.periodStart,
    periodEnd: fixture.periodEnd, timezone: 'America/Los_Angeles', totalFollowers: fixture.totalFollowers });
  return nodes(tree).find(node => node.props.className === 'venue-results-summary').props.children;
}

test('Results summarize entries and request counts independently for every reporting period', () => {
  for (const [period, phrase] of [['tonight', 'tonight'], ['7d', 'over the last 7 days'], ['30d', 'over the last 30 days'], ['all', 'across all recorded time']]) {
    assert.equal(summary(period, { admissions: 12, vipRequests: 5, tableRequests: 8 }),
      `MyDancr recorded 12 verified entries, 5 VIP requests and 8 table requests ${phrase}.`);
  }
});

test('Results use singular labels and retain zero counts without claiming unique guests or revenue', () => {
  assert.equal(summary('tonight', { admissions: 1, vipRequests: 1, tableRequests: 0 }),
    'MyDancr recorded 1 verified entry, 1 VIP request and 0 table requests tonight.');
});

test('An empty period describes only the measured entry and request activity', () => {
  assert.equal(summary('7d', { admissions: 0, vipRequests: 0, tableRequests: 0 }),
    'No verified entries, VIP requests or table requests were recorded through MyDancr over the last 7 days.');
});

test('Unavailable or invalid metrics are never presented as zero activity', () => {
  const unavailable = 'Your results summary will appear when entry and request totals are available.';
  assert.equal(summary('30d', {}, false), unavailable);
  for (const admissions of [undefined, null, NaN, Infinity, -1]) {
    assert.equal(summary('30d', { admissions }), unavailable);
  }
});
