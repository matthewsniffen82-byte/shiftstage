import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { createDancerConnectOnboarding, requestDancerCashOut, refreshDancerConnectAccount } from '../src/lib/dancr/dancer-payout-actions.ts';

const noClient = new Proxy({}, { get() { throw new Error('Unexpected financial operation'); } });
test('retired dancer actions never contact a payout provider or financial database', async () => {
  await assert.rejects(createDancerConnectOnboarding(noClient, 'user', 'https://example.test', 'https://example.test'), /program has ended/);
  await assert.rejects(requestDancerCashOut(noClient, 'user', 'key'), /program has ended/);
  assert.equal(await refreshDancerConnectAccount(noClient, 'user'), null);
});

const source = readFileSync(new URL('../app/api/dancer/finance/route.ts', import.meta.url), 'utf8');
function routeFor(account, authenticated = true) {
  const dependencies = {
    'next/server': { NextResponse: { json: Response.json } },
    '@/src/lib/api': { apiError: () => Response.json({ ok: false }, { status: 401 }) },
    '@/src/lib/dancr/auth': { getAccountByUserId: async () => account },
    '@/src/lib/supabase/request': { createRequestSupabaseContext: async () => { if (!authenticated) throw Error('Sign in required'); return { client: noClient, user: { id: 'user' } }; } },
    '@/src/lib/supabase/admin': { createAdminSupabaseClient() { throw Error('Unexpected admin access'); } },
    '@/src/lib/dancr/finance-reporting': { getDancerFinance() { throw Error('Unexpected archive access'); } },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, URL, require(name) { assert.ok(dependencies[name], name); return dependencies[name]; },
  });
  return exports;
}
for (const action of ['request_nats_link', 'connect_onboarding', 'cash_out']) test(action + ' returns 410 after dancer authorization without starting money movement', async () => {
  const route = routeFor({ role: 'dancer', accountState: 'active' });
  const response = await route.POST(new Request('https://example.test/api/dancer/finance', { method: 'POST', body: JSON.stringify({ action, loginId: '100' }) }));
  assert.equal(response.status, 410);
  assert.match((await response.json()).error, /program has ended/);
});
for (const role of ['customer', 'venue', 'agent', 'admin']) test(role + ' cannot use the retired dancer endpoint', async () => {
  const response = await routeFor({ role, accountState: 'active' }).POST(new Request('https://example.test', { method: 'POST' }));
  assert.equal(response.status, 403);
});
test('historical statement authorization remains available only to an active dancer', async () => {
  const response = await routeFor({ role: 'dancer', accountState: 'active' }).GET(new Request('https://example.test/api/dancer/finance?access=1'));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).access, { active: true });
});
test('signed-out users are denied before retirement actions', async () => {
  assert.equal((await routeFor(null, false).POST(new Request('https://example.test', { method: 'POST' }))).status, 401);
});
