import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
function load(path, dependencies) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, require: name => dependencies ? dependencies[name] : require(name), console,
  });
  return exports;
}

for (const endpoint of ['finance', 'referral-fees']) {
  for (const method of ['GET', 'POST']) test(`${method} ${endpoint} authenticates and retires the old operation without reading a body or accessing financial data`, async () => {
    const calls = [];
    const session = { accessToken: 'refreshed-test-token' };
    const route = load(`app/api/admin/${endpoint}/route.ts`, {
      'next/server': { NextResponse: { json: Response.json } },
      '@/src/lib/dancr/admin': { requireAdmin: async () => { calls.push('authorize'); } },
      '@/src/lib/supabase/request': { createRequestSupabaseContext: async () => { calls.push('authenticate'); return { client: {}, user: { id: 'admin' }, session }; } },
      '@/src/lib/api': { apiError: () => { throw new Error('Unexpected error'); } },
    });
    const response = await route[method]({ json() { throw Error('Retired endpoints must not parse bodies'); } });
    assert.equal(response.status, 410);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.deepEqual(body.session, session);
    assert.match(body.error, /subscription only/);
    assert.deepEqual(calls, ['authenticate', 'authorize']);
  });
  test(`${endpoint} denies non-admins before returning a retirement response`, async () => {
    const denial = new Error('denied');
    const route = load(`app/api/admin/${endpoint}/route.ts`, {
      'next/server': { NextResponse: { json: Response.json } },
      '@/src/lib/dancr/admin': { requireAdmin: async () => { throw denial; } },
      '@/src/lib/supabase/request': { createRequestSupabaseContext: async () => ({ client: {}, user: { id: 'guest' } }) },
      '@/src/lib/api': { apiError: error => { assert.equal(error, denial); return Response.json({ ok: false }, { status: 403 }); } },
    });
    assert.equal((await route.POST({})).status, 403);
  });
}

const SubscriptionPanel = load('app/admin/AdminVenueSubscriptions.tsx').default;
test('venue roster distinguishes page publication from unconnected subscription payments', () => {
  const html = renderToStaticMarkup(React.createElement(SubscriptionPanel, { venues: [{ id: '1', name: 'Test Club', city: 'Las Vegas', is_active: true }] }));
  assert.match(html, /Subscription only/);
  assert.match(html, /Test Club/);
  assert.match(html, /Page: Published/);
  assert.match(html, /Payment status unavailable/);
  assert.match(html, /Not connected/);
  assert.doesNotMatch(html, /\$0|\bPaid\b|referral fees|payouts/i);
});
test('unavailable venue data and an empty roster have different messages', () => {
  const unavailable = renderToStaticMarkup(React.createElement(SubscriptionPanel));
  const empty = renderToStaticMarkup(React.createElement(SubscriptionPanel, { venues: [] }));
  assert.match(unavailable, /Venue roster unavailable/);
  assert.doesNotMatch(unavailable, /0 venues listed/);
  assert.match(empty, /No venues are available/);
});
test('admin navigation and operational queries do not load retired financial datasets', () => {
  const client = source('app/admin/AdminClient.tsx');
  assert.doesNotMatch(client, /ReferralFeeManager|FinanceManager|settleVenueBalance|previewCommission|\/api\/admin\/(finance|referral-fees)/);
  assert.match(client, /id: "money", label: "Subscriptions"/);
  const operations = source('src/lib/dancr/admin-operations.ts');
  assert.doesNotMatch(operations, /deal_revenue_events|commission_events|club_invoices|pendingVenuePaymentCents/);
  const admin = source('src/lib/dancr/admin.ts');
  assert.doesNotMatch(admin, /getVenueReferralFeeState|referralFeeCents|per confirmed customer/);
  const agents = source('app/admin/AdminSalesAgentPanel.tsx');
  assert.doesNotMatch(agents, /natsAction|Waiting on clubs|Ready to send for payout|Clubs owe MyDancr/);
});
