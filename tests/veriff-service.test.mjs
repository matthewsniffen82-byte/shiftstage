import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { PublicApiError } from '../src/lib/api-error-policy.ts';
import * as policy from '../src/lib/dancr/veriff-policy.ts';
import * as urls from '../src/lib/dancr/veriff-url.ts';

const code = ts.transpileModule(readFileSync(new URL('../src/lib/dancr/veriff.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const sessionId = '11111111-1111-4111-8111-111111111111';
const integrationId = '33333333-3333-4333-8333-333333333333';
const attempt = { user_id: 'owner', attempt_id: 'server-generated-attempt', provider: 'veriff', provider_integration_id: integrationId, session_id: sessionId, status: 'creating', reserved: true };
const approved = { status: 'success', verification: { id: sessionId, vendorData: attempt.attempt_id, status: 'approved', code: 9001,
  attemptId: '22222222-2222-4222-8222-222222222222', decisionTime: '2026-01-01T00:00:00Z',
  person: { dateOfBirth: '1990-01-01' }, document: { type: 'PASSPORT' } } };
const created = { status: 'success', verification: { id: sessionId, vendorData: attempt.attempt_id, status: 'created', url: 'https://saas.veriff.com/v/secret-token' } };
const testConfig = { apiKey: 'secret-test-key', sharedSecret: 'secret-test-secret', integrationId };

function fixture({ reservation = attempt, current = attempt, provider = approved, saveError = null, env = {}, configured = true, providerError = false, responseHeaders = {}, reservationError = null } = {}) {
  const calls = [], writes = [];
  const admin = {
    async rpc(name, args) { calls.push({ rpc: name, args }); return { data: reservation, error: reservationError }; },
    from(table) {
      const filters = []; let mutation;
      const query = { select() { return this; }, eq(column, value) { filters.push([column, value]); return this; }, or(value) { filters.push(['or', value]); return this; },
        update(value) { mutation = value; return this; },
        async single() { return { data: { enabled: true }, error: null }; },
        async maybeSingle() {
          if (mutation) { writes.push({ table, mutation, filters }); return { data: saveError ? null : { session_id: sessionId }, error: saveError }; }
          calls.push({ read: table, filters }); return { data: current, error: null };
        },
        then(resolve) { writes.push({ table, mutation, filters }); return Promise.resolve({ error: saveError }).then(resolve); },
      };
      return query;
    },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, Error, URL, Date, AbortSignal,
    process: { env: configured ? { VERIFF_API_KEY: testConfig.apiKey, VERIFF_SHARED_SECRET: testConfig.sharedSecret,
      VERIFF_INTEGRATION_ID: integrationId, VERIFF_BASE_URL: 'https://api-saas.veriff.com', VERIFF_ENVIRONMENT: 'live', NEXT_PUBLIC_SITE_URL: 'https://www.mydancr.test', ...env } : {} },
    async fetch(url, options) {
      calls.push({ url, options });
      if (providerError) throw new Error('provider error containing sensitive information');
      const raw = JSON.stringify(provider);
      return { ok: true, text: async () => raw, headers: new Headers({ 'x-auth-client': testConfig.apiKey,
        'x-hmac-signature': policy.signVeriff(raw, testConfig.sharedSecret), 'vrf-integration-id': integrationId, ...responseHeaders }) };
    },
    require(name) {
      if (name === 'server-only') return {};
      if (name === '../api-error-policy') return { PublicApiError };
      if (name === './veriff-policy') return policy;
      if (name === './veriff-url') return urls;
      throw new Error(name);
    },
  });
  return { calls, writes, start: () => exports.startDancerAgeVerification(admin, 'owner'),
    reconcile: () => exports.reconcileVeriffSession(admin, sessionId), get: () => exports.getDancerAgeVerification(admin, 'owner'), config: exports.veriffConfig };
}

test('creation signs exact JSON and binds only the opaque reference, live integration and fixed callback', async () => {
  const f = fixture({ provider: created });
  const result = await f.start();
  assert.equal(result.url, created.verification.url);
  const request = f.calls.find(call => call.url), body = JSON.parse(request.options.body);
  assert.deepEqual(body, { verification: { vendorData: attempt.attempt_id, callback: 'https://www.mydancr.test/dashboard/dancer?age-verification=returned' } });
  assert.equal(request.options.headers['x-hmac-signature'], policy.signVeriff(request.options.body, testConfig.sharedSecret));
  assert.equal(f.calls[0].args.p_integration_id, integrationId);
  for (const [key, value] of [['user_id', 'owner'], ['attempt_id', attempt.attempt_id], ['provider', 'veriff'], ['provider_integration_id', integrationId]]) {
    assert.ok(f.writes[0].filters.some(([k, v]) => k === key && v === value));
  }
});
test('pending, verified and in-review sessions are reused without paid session creation', async () => {
  for (const status of ['pending', 'verified', 'in_review']) {
    const f = fixture({ reservation: { ...attempt, reserved: false, status, verification_url: created.verification.url } });
    assert.equal((await f.start()).url, status === 'pending' ? created.verification.url : null);
    assert.equal(f.calls.filter(call => call.url).length, 0);
  }
});
test('unsafe URLs, incomplete/test config, old integrations, invalid signatures, and failed saves never yield a session', async () => {
  for (const options of [
    { provider: { ...created, verification: { ...created.verification, url: 'https://evil.test/v/x' } } },
    { provider: created, saveError: { code: 'database-failed' } }, { configured: false }, { providerError: true },
    { env: { VERIFF_ENVIRONMENT: 'test' } }, { env: { VERIFF_ENVIRONMENT: '' } },
    { env: { VERIFF_BASE_URL: 'https://evil.test' } }, { env: { NEXT_PUBLIC_SITE_URL: 'invalid' } },
    { reservation: { ...attempt, provider: 'didit' } }, { reservation: { ...attempt, provider_integration_id: 'old-integration' } },
    { provider: created, responseHeaders: { 'x-hmac-signature': '0'.repeat(64) } },
    { provider: created, responseHeaders: { 'x-auth-client': 'wrong-integration-key' } },
  ]) await assert.rejects(fixture(options).start(), error => error.status === 503 && !error.message.includes('sensitive'));
});
test('decision retrieval signs session ID and saves only bound minimal status with race protection', async () => {
  const f = fixture(); await f.reconcile();
  const request = f.calls.find(call => call.url);
  assert.equal(request.url, `https://api-saas.veriff.com/v1/sessions/${sessionId}/decision`);
  assert.equal(request.options.headers['x-hmac-signature'], policy.signVeriff(sessionId, testConfig.sharedSecret));
  assert.equal(f.writes[0].mutation.status, 'verified');
  assert.deepEqual(Object.keys(f.writes[0].mutation).sort(), ['checked_at', 'status', 'verification_url', 'verified_at']);
  for (const [key, value] of [['session_id', sessionId], ['provider', 'veriff'], ['attempt_id', attempt.attempt_id]]) assert.ok(f.writes[0].filters.some(([k, v]) => k === key && v === value));
  assert.ok(f.writes[0].filters.some(([key, value]) => key === 'or' && value.startsWith('checked_at.is.null,checked_at.lt.')));
});
test('unknown/cross-account sessions, no decision, and provider outages cannot overwrite saved approvals', async () => {
  const absent = fixture({ current: null }); await absent.reconcile(); assert.equal(absent.calls.filter(call => call.url).length, 0); assert.equal(absent.writes.length, 0);
  const pending = fixture({ current: { ...attempt, status: 'verified' }, provider: { status: 'success', verification: null } });
  await pending.reconcile(); assert.equal(pending.writes.length, 0);
  for (const options of [{ provider: { ...approved, verification: { ...approved.verification, vendorData: 'another-account-attempt' } } },
    { current: { ...attempt, provider_integration_id: 'wrong' } }, { providerError: true }, { responseHeaders: { 'x-hmac-signature': 'bad' } }]) {
    const f = fixture(options); await assert.rejects(f.reconcile(), error => error.status === 503); assert.equal(f.writes.length, 0);
  }
});
test('resubmission retains the existing hosted URL; delayed notification uses current declined decision', async () => {
  for (const [status, code, expectedStatus] of [['resubmission_requested', 9103, 'pending'], ['declined', 9102, 'declined']]) {
    const f = fixture({ provider: { ...approved, verification: { ...approved.verification, status, code } } });
    await f.reconcile(); assert.equal(f.writes[0].mutation.status, expectedStatus);
    assert.equal('verification_url' in f.writes[0].mutation, status === 'declined');
  }
});
test('normal dancer access reads the saved Veriff approval without calling the provider', async () => {
  const f = fixture({ current: { ...attempt, status: 'verified', verified_at: '2026-01-01T00:00:00Z' }, providerError: true });
  assert.equal((await f.get()).status, 'verified'); assert.equal(f.calls.filter(call => call.url).length, 0);
  assert.ok(f.calls.find(call => call.read).filters.some(([key, value]) => key === 'provider' && value === 'veriff'));
});

test('unfinished profile setup cannot create a paid verification session', async () => {
  const f = fixture({ reservationError: { code: '42501', message: 'AGE_PROFILE_SETUP_REQUIRED' } });
  await assert.rejects(f.start(), error => error.status === 409 && /submit your dancer profile/.test(error.message));
  assert.equal(f.calls.filter(call => call.url).length, 0);
  assert.equal(f.writes.length, 0);
});
