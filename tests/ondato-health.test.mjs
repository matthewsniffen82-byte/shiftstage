import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac, timingSafeEqual } from 'node:crypto';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { PublicApiError } from '../src/lib/api-error-policy.ts';

function compiled(file) {
  return ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
const authCode = compiled('../src/lib/dancr/ondato-diagnostics-auth.ts');
const routeCode = compiled('../app/api/health/ondato/route.ts');
const authorization = 'Bearer ' + createHmac('sha256', 'operator-test-secret').update('mydancr:ondato:read-only-diagnostics:v1').digest('hex');
class OndatoUnavailableError extends PublicApiError {
  constructor(stage, providerStatus) { super('UNAVAILABLE', 'Private failure', 503); this.stage = stage; this.providerStatus = providerStatus; }
}
function fixture({ secret = 'operator-test-secret', failure } = {}) {
  const calls = [], cron = {}, route = {};
  const next = { NextResponse: { json: (body, options) => Response.json(body, options) } };
  vm.runInNewContext(authCode, { exports: cron, Buffer, process: { env: { SUPABASE_SERVICE_ROLE_KEY: secret } }, require(name) {
    if (name === 'server-only') return {};
    if (name === 'node:crypto') return { createHmac, timingSafeEqual };
    if (name === 'next/server') return next;
    throw new Error(name);
  } });
  vm.runInNewContext(routeCode, { exports: route, URL, require(name) {
    if (name === 'next/server') return next;
    if (name.endsWith('/api-error-policy')) return { PublicApiError };
    if (name.endsWith('/ondato-diagnostics-auth')) return cron;
    if (name.endsWith('/supabase/admin')) return { createAdminSupabaseClient: () => { calls.push('database'); return {}; } };
    if (name.endsWith('/ondato')) return { OndatoUnavailableError, inspectOndatoSession: async (_admin, id) => {
      calls.push(id); if (failure) throw failure;
      return { storedStatus: 'in_review', decision: { status: 'in_review', reason: 'active_liveness_not_enabled' } };
    } };
    throw new Error(name);
  } });
  return { calls, run: (authorization) => route.GET(new Request('https://mydancr.test/api/health/ondato?sessionId=synthetic', {
    headers: authorization ? { authorization } : {},
  })) };
}
test('private Ondato diagnostics require the derived read capability before any data access', async () => {
  for (const invalid of [undefined, 'Bearer wrong', 'operator-test-secret', 'Bearer operator-test-secret']) {
    const f = fixture(); const response = await f.run(invalid);
    assert.equal(response.status, 401); assert.equal(f.calls.length, 0);
    assert.match(response.headers.get('cache-control'), /no-store/);
  }
  const missing = fixture({ secret: '' });
  assert.equal((await missing.run(authorization)).status, 503);
  assert.equal(missing.calls.length, 0);
  const f = fixture(); const response = await f.run(authorization);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).decision.reason, 'active_liveness_not_enabled');
  assert.match(response.headers.get('cache-control'), /no-store/);
});
test('private diagnostics expose safe failure codes and never echo exception text', async () => {
  for (const [failure, expectedStatus, body] of [
    [new OndatoUnavailableError('identification', 403), 503, { ok: false, stage: 'identification', providerStatus: 403 }],
    [new Error('token and identity data'), 503, { ok: false, error: 'Verification diagnostics unavailable.' }],
    [new PublicApiError('INVALID_REQUEST', 'private', 400), 400, { ok: false, error: 'A valid session ID is required.' }],
  ]) {
    const response = await fixture({ failure }).run(authorization);
    assert.equal(response.status, expectedStatus); assert.deepEqual(await response.json(), body);
  }
});
