import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as policy from '../src/lib/dancr/veriff-policy.ts';
import { readBoundedRequestBytes } from '../src/lib/bounded-json-body.ts';

const code = ts.transpileModule(readFileSync(new URL('../app/api/veriff/webhook/route.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const config = { apiKey: 'test-key', sharedSecret: 'test-secret', integrationId: '33333333-3333-4333-8333-333333333333' };
const id = '11111111-1111-4111-8111-111111111111';
function fixture({ configured = true, failure = false } = {}) {
  const exports = {}, calls = [];
  vm.runInNewContext(code, { exports, TextDecoder, require(name) {
    if (name === 'next/server') return { NextResponse: { json: (body, init) => Response.json(body, init) } };
    if (name === '@/src/lib/bounded-json-body') return { readBoundedRequestBytes };
    if (name === '@/src/lib/dancr/veriff-policy') return policy;
    if (name === '@/src/lib/supabase/admin') return { createAdminSupabaseClient: () => ({}) };
    if (name === '@/src/lib/dancr/veriff') return { veriffConfig: () => configured ? config : null,
      reconcileVeriffSession: async (_admin, sessionId, timeoutMs) => { calls.push({ sessionId, timeoutMs }); if (failure) throw new Error('private payload'); } };
    throw new Error(name);
  } });
  return { calls, run: (payload, headers = {}) => {
    const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return exports.POST(new Request('https://www.mydancr.test/api/veriff/webhook', { method: 'POST', body: raw,
      headers: { 'x-auth-client': config.apiKey, 'x-hmac-signature': policy.signVeriff(raw, config.sharedSecret), ...headers } }));
  } };
}
test('signed notifications fetch current decisions, including repeated/old approved notifications', async () => {
  const f = fixture(), payload = { status: 'success', verification: { id, status: 'approved', code: 9001 } };
  assert.equal((await f.run(payload)).status, 200); assert.equal((await f.run(payload)).status, 200);
  assert.deepEqual(f.calls, [{ sessionId: id, timeoutMs: 3000 }, { sessionId: id, timeoutMs: 3000 }]);
});
test('wrong signatures/keys and oversized bodies never reconcile; unavailable provider requests retry', async () => {
  const f = fixture(), payload = { status: 'success', verification: { id } };
  assert.equal((await f.run(payload, { 'x-hmac-signature': '0'.repeat(64) })).status, 401);
  assert.equal((await f.run(payload, { 'x-auth-client': 'other-key' })).status, 401);
  assert.equal((await f.run('a'.repeat(1_048_577))).status, 503); assert.equal(f.calls.length, 0);
  assert.equal((await fixture({ failure: true }).run(payload)).status, 503);
  assert.equal((await fixture({ configured: false }).run(payload)).status, 503);
  const irrelevant = fixture(); assert.equal((await irrelevant.run({ action: 'started', id })).status, 200); assert.equal(irrelevant.calls.length, 0);
});
