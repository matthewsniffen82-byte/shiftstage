import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { PublicApiError, resolveApiError } from '../src/lib/api-error-policy.ts';
import { readBoundedJsonObject } from '../src/lib/bounded-json-body.ts';
import { staffRole } from '../src/lib/dancr/admin-workspace-policy.ts';

const id = '00000000-0000-4000-8000-000000000002';
const person = { id, email: 'staff@example.invalid', display_name: 'Sam', admin_workspace_role: 'reviewer', account_state: 'active' };
function load(file, deps) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, console: { error() {} }, Error, require(name) { assert.ok(name in deps, name); return deps[name]; } });
  return exports;
}
function fixture(options = {}) {
  const calls = [];
  const user = { id, email: person.email, app_metadata: { mydancr_staff_created_by: 'owner' }, ...options.user };
  const admin = { auth: { admin: {
    async createUser(input) { calls.push(['create', input]); return { data: { user }, error: options.createError }; },
    async getUserById(target) { calls.push(['getUser', target]); return { data: { user } }; },
  } }, from(table) {
    const filters = [];
    const chain = { select() { return this; }, eq(key, value) { filters.push([key, value]); return this; }, is(key, value) { filters.push([key, value]); return this; },
      async maybeSingle() { calls.push(['lookup', table, filters]); return { data: filters.some(([key]) => key === 'email') ? options.existing : options.missing ? null : person }; } };
    return chain;
  }, async rpc(name, input) { calls.push(['rpc', name, input]); return { data: person, error: options.rpcError }; } };
  const service = load('src/lib/dancr/admin-staff.ts', {
    'server-only': {}, 'node:crypto': { randomBytes: () => ({ toString: () => 'random-unshared-password' }) },
    '../api-error-policy': { PublicApiError }, '../security/safe-error-metadata': { safeErrorMetadata: () => ({}) },
    './admin-workspace-policy': { staffRole }, './email-actions': {
      isUsernameOnlyAdminEmail: email => email.endsWith('@admin.mydancr.local'),
      async sendAccountEmailAction(_client, input) { calls.push(['email', input]); if (options.deliveryFails) throw new Error('Provider unavailable'); return !options.notSent; },
    },
  });
  class RateLimitError extends Error { retryAfterSeconds = 3600; }
  const route = load('app/api/admin/staff/route.ts', {
    'next/server': { NextResponse: Response }, '@/src/lib/api': { PublicApiError, apiError(error, fallback) { const r = resolveApiError(error, fallback); return Response.json(r.body, { status: r.status }); } },
    '@/src/lib/dancr/admin': { async requireAdmin(_client, actor, scope) { calls.push(['authorize', actor, scope]); if (options.forbidden) throw new PublicApiError('FORBIDDEN', 'Owner required.', 403); } },
    '@/src/lib/dancr/admin-staff': service, '@/src/lib/bounded-json-body': { readBoundedJsonObject },
    '@/src/lib/dancr/public-request-rate-limit': { PublicRequestRateLimitError: RateLimitError, async enforcePublicRequestRateLimit() { calls.push(['limit']); if (options.limited) throw new RateLimitError('Wait before retrying.'); } },
    '@/src/lib/supabase/admin': { createAdminSupabaseClient: () => admin },
    '@/src/lib/supabase/request': { async createRequestSupabaseContext() { if (options.signedOut) throw new Error('Sign in required.'); return { client: {}, user: { id: 'owner' }, session: { accessToken: 'refreshed' } }; } },
  });
  return { calls, service, post: (body = { action: 'add', displayName: ' Sam ', email: ' STAFF@EXAMPLE.INVALID ', role: 'reviewer', actorId: 'forged' }) => route.POST(new Request('https://www.mydancr.com/api/admin/staff', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })) };
}
test('owner creates a scoped staff login before sending setup; secrets stay server-side', async () => {
  const f = fixture(); const res = await f.post(); const body = await res.json();
  assert.equal(res.status, 200); assert.match(res.headers.get('cache-control'), /no-store/);
  assert.equal(body.staff.id, id); assert.equal(body.session.accessToken, 'refreshed');
  assert.deepEqual(f.calls.map(c => c[0]), ['authorize', 'limit', 'lookup', 'create', 'rpc', 'email']);
  assert.deepEqual(f.calls[0], ['authorize', 'owner', 'owner']);
  const created = f.calls.find(c => c[0] === 'create')[1];
  assert.equal(created.email_confirm, false); assert.equal(created.app_metadata.mydancr_staff_created_by, 'owner');
  assert.equal(created.app_metadata.mydancr_provisioned_role, undefined);
  const rpc = f.calls.find(c => c[0] === 'rpc'); assert.equal(rpc[1], 'provision_admin_staff'); assert.equal(rpc[2].p_role, 'reviewer'); assert.equal(rpc[2].p_actor, 'owner');
  assert.equal(rpc[2].p_email, person.email); assert.equal(rpc[2].p_name, 'Sam');
  assert.equal(f.calls.at(-1)[1].returnTo, '/admin'); assert.equal(f.calls.at(-1)[1].purpose, 'recovery');
  assert.doesNotMatch(JSON.stringify(body), /random-unshared-password|mydancr_staff_created_by/);
});
test('signed-out, non-owner and throttled requests cannot provision or send email', async () => {
  for (const [options, status] of [[{ signedOut: true }, 401], [{ forbidden: true }, 403], [{ limited: true }, 429]]) {
    const f = fixture(options); assert.equal((await f.post()).status, status);
    assert.ok(!f.calls.some(c => ['create', 'rpc', 'email'].includes(c[0])));
  }
});
test('invalid input fails before provisioning', async () => {
  for (const body of [{}, { action: 'other' }, { action: 'resend', id: 'bad' },
    ...[{ email: 'bad' }, { email: 'someone@admin.mydancr.local' }, { displayName: '' }, { role: 'root' }, { displayName: 'a'.repeat(101) }, { email: 'x'.repeat(5000) }].map(change => ({ action: 'add', email: person.email, displayName: 'Sam', role: 'reviewer', ...change }))]) {
    const f = fixture(); assert.ok([400, 413].includes((await f.post(body)).status)); assert.ok(!f.calls.some(c => ['create', 'rpc', 'email'].includes(c[0])));
  }
});
test('ordinary and accepted accounts cannot be silently promoted, even with user metadata claims', async () => {
  for (const user of [{ app_metadata: {}, user_metadata: { mydancr_staff_created_by: 'owner' } }, { email_confirmed_at: '2026-10-30' }, { last_sign_in_at: '2026-10-30' }, { app_metadata: { mydancr_staff_created_by: 'another-owner' } }]) {
    const f = fixture({ existing: { id }, user }); assert.equal((await f.post()).status, 409);
    assert.ok(!f.calls.some(c => ['create', 'rpc', 'email'].includes(c[0])));
  }
});
test('an interrupted setup resumes only its owner-created account', async () => {
  const f = fixture({ existing: { id } }); assert.equal((await f.post()).status, 200);
  assert.ok(!f.calls.some(c => c[0] === 'create')); assert.ok(f.calls.some(c => c[0] === 'rpc'));
});
test('database failures never send setup; delivery failure retains staff and permits resend', async () => {
  const failed = fixture({ rpcError: new Error('Database unavailable') }); assert.equal((await failed.post()).status, 500);
  assert.ok(!failed.calls.some(c => c[0] === 'email'));
  for (const options of [{ deliveryFails: true }, { notSent: true }]) {
    const f = fixture(options); const res = await f.post(); const body = await res.json(); assert.equal(res.status, 200);
    assert.equal(body.staff.id, id); assert.match(body.deliveryWarning, /saved.*could not be sent/); assert.equal(body.message, undefined);
  }
  const resend = fixture(); assert.equal((await resend.post({ action: 'resend', id })).status, 200);
  assert.ok(!resend.calls.some(c => c[0] === 'create' || c[0] === 'rpc'));
  assert.deepEqual(resend.calls.find(c => c[0] === 'lookup')[2], [['id', id], ['role', 'admin'], ['account_state', 'active'], ['dmca_suspended_at', null]]);
  assert.equal((await fixture({ missing: true }).post({ action: 'resend', id })).status, 404);
  assert.equal((await fixture({ deliveryFails: true }).post({ action: 'resend', id })).status, 500);
});
