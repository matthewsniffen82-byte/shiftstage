import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { PublicApiError } from '../src/lib/api-error-policy.ts';
const code = ts.transpileModule(readFileSync(new URL('../src/lib/supabase/request.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture({ required = true, verified = false, error = null, role = 'dancer' } = {}) {
  const calls = [], client = {
    auth: { getUser: async () => ({ data: { user: { id: 'user' } }, error: null }) },
    from() { return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { id: 'user', role, account_state: 'active' }, error: null }) }; },
    rpc: async name => { if (name === 'dancer_agreement_access') return { data: { required: true, accepted: true }, error: null }; calls.push(name); return { data: { required, verified }, error }; },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, Error, URL, require(name) {
    if (name === '@supabase/supabase-js') return { createClient: () => client };
    if (name === '../env.ts') return { getPublicEnv: () => ({ supabaseUrl: 'https://test.invalid', supabaseAnonKey: 'test' }) };
    if (name === '../api-error-policy.ts') return { PublicApiError };
    if (name === './bounded-fetch.ts') return { boundedSupabaseFetch: fetch };
    throw new Error(name);
  } });
  return { calls, run: (method = 'POST', access = { role: 'dancer' }) => exports.createRequestSupabaseContext(new Request('https://mydancr.test/api/dancer/profile', { method, headers: { authorization: 'Bearer synthetic-token' } }), access) };
}
test('unverified dancers cannot mutate features, including when the Veriff result lookup fails', async () => {
  await assert.rejects(fixture().run(), error => error.status === 403);
  await assert.rejects(fixture({ error: { code: 'failure' } }).run(), error => error.status === 503);
  await assert.rejects(fixture({ required: undefined, verified: null }).run(), error => error.status === 503);
  await fixture({ verified: true }).run();
  await fixture({ required: false }).run();
});
test('verification itself and read/delete actions remain accessible, other roles cannot use dancer endpoints', async () => {
  const f = fixture();
  await f.run('GET'); await f.run('DELETE'); await f.run('POST', { role: 'dancer', allowAgeVerification: true });
  assert.equal(f.calls.length, 0);
  await assert.rejects(fixture({ role: 'customer' }).run('POST', { role: 'dancer', allowAgeVerification: true }), error => error.status === 403);
  const customer = fixture({ role: 'customer' }); await customer.run('POST', { role: 'customer' }); assert.equal(customer.calls.length, 0);
});

test('profile setup is available before verification but still requires an active dancer account', async () => {
  const f = fixture({ error: { code: 'verification-outage' } });
  for (const method of ['POST', 'PATCH']) await f.run(method, { role: 'dancer', allowProfileSetup: true });
  assert.equal(f.calls.length, 0);
  await assert.rejects(fixture({ role: 'customer' }).run('PATCH', { role: 'dancer', allowProfileSetup: true }), error => error.status === 403);
});
