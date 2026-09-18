import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { PublicApiError } from '../src/lib/api-error-policy.ts';
import * as policy from '../src/lib/dancr/didit-policy.ts';

const code = ts.transpileModule(readFileSync(new URL('../src/lib/dancr/didit.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const sessionId = '11111111-1111-4111-8111-111111111111';
const attempt = { user_id: 'owner', attempt_id: 'server-generated-attempt', workflow_id: 'configured-workflow', session_id: sessionId, status: 'creating', reserved: true };
const approved = { session_id: sessionId, session_kind: 'user', workflow_id: attempt.workflow_id, vendor_data: attempt.attempt_id, status: 'Approved',
  id_verifications: [{ status: 'Approved', date_of_birth: '1990-01-01' }], liveness_checks: [{ status: 'Approved' }], face_matches: [{ status: 'Approved' }] };

function fixture({ reservation = attempt, current = attempt, provider = approved, saveError = null, configured = true, providerError = false } = {}) {
  const calls = [], writes = [];
  const admin = {
    async rpc(name, args) { calls.push({ rpc: name, args }); return { data: reservation, error: null }; },
    from(table) {
      const filters = []; let mutation;
      const query = { select() { return this; }, eq(column, value) { filters.push([column, value]); return this; }, or(value) { filters.push(['or', value]); return this; },
        update(value) { mutation = value; return this; },
        async maybeSingle() {
          if (mutation) { writes.push({ table, mutation, filters }); return { data: saveError ? null : { session_id: sessionId }, error: saveError }; }
          return { data: current, error: null };
        },
        then(resolve) { writes.push({ table, mutation, filters }); return Promise.resolve({ error: saveError }).then(resolve); },
      };
      return query;
    },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, Error, URL, Date, AbortSignal,
    process: { env: configured ? { DIDIT_API_KEY: 'secret-test-key', DIDIT_WORKFLOW_ID: attempt.workflow_id, DIDIT_WEBHOOK_SECRET: 'secret-test-hook', NEXT_PUBLIC_SITE_URL: 'https://www.mydancr.test' } : {} },
    async fetch(url, options) {
      calls.push({ url, options });
      if (providerError) throw new Error('provider error containing sensitive information');
      return { ok: true, json: async () => provider };
    },
    require(name) {
      if (name === 'server-only') return {};
      if (name === '../api-error-policy') return { PublicApiError };
      if (name === './didit-policy') return policy;
      throw new Error(name);
    },
  });
  return { calls, writes, start: () => exports.startDancerAgeVerification(admin, 'owner'), reconcile: () => exports.reconcileDiditSession(admin, sessionId) };
}
test('creation binds opaque server reference and fixed callback, returns only the saved hosted URL', async () => {
  const f = fixture({ provider: { ...approved, url: 'https://verify.didit.me/session/secret-token' } });
  const result = await f.start();
  assert.equal(result.url, 'https://verify.didit.me/session/secret-token');
  const body = JSON.parse(f.calls[1].options.body);
  assert.equal(body.vendor_data, attempt.attempt_id);
  assert.equal(body.workflow_id, attempt.workflow_id);
  assert.equal(body.callback, 'https://www.mydancr.test/dashboard/dancer?age-verification=returned');
  assert.equal(body.contact_details, undefined);
  assert.ok(f.writes[0].filters.some(([key, value]) => key === 'user_id' && value === 'owner'));
  assert.ok(f.writes[0].filters.some(([key, value]) => key === 'attempt_id' && value === attempt.attempt_id));
});
test('saved pending sessions are reused without creating another paid attempt', async () => {
  const f = fixture({ reservation: { ...attempt, reserved: false, status: 'pending', verification_url: 'https://verify.didit.me/session/existing' } });
  assert.equal((await f.start()).url, 'https://verify.didit.me/session/existing');
  assert.equal(f.calls.filter(call => call.url).length, 0);
});
test('unsafe provider redirects, unsaved sessions and missing credentials never yield a hosted URL', async () => {
  for (const options of [
    { provider: { ...approved, url: 'https://evil.test/' } },
    { provider: { ...approved, url: 'https://verify.didit.me/session/x' }, saveError: { code: 'database-failed' } },
    { configured: false }, { providerError: true },
  ]) await assert.rejects(fixture(options).start(), error => error.status === 503 && !error.message.includes('sensitive'));
});
test('authoritative checks persist minimal status and bind updates to the current session and read order', async () => {
  const f = fixture(); await f.reconcile();
  assert.equal(f.calls[0].url, `https://verification.didit.me/v3/session/${sessionId}/decision/`);
  assert.equal(f.writes[0].mutation.status, 'verified');
  assert.deepEqual(Object.keys(f.writes[0].mutation).sort(), ['checked_at', 'status', 'verification_url', 'verified_at']);
  assert.ok(f.writes[0].filters.some(([key, value]) => key === 'session_id' && value === sessionId));
  assert.ok(f.writes[0].filters.some(([key, value]) => key === 'or' && value.startsWith('checked_at.is.null,checked_at.lt.')));
});
test('unknown and cross-account sessions cannot change a verification record', async () => {
  const absent = fixture({ current: null }); await absent.reconcile(); assert.equal(absent.calls.length, 0); assert.equal(absent.writes.length, 0);
  const other = fixture({ provider: { ...approved, vendor_data: 'another-account-attempt' } });
  await assert.rejects(other.reconcile(), error => error.status === 503); assert.equal(other.writes.length, 0);
});
