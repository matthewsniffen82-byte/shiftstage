import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { PublicApiError, resolveApiError } from '../src/lib/api-error-policy.ts';
import { readBoundedJsonObject } from '../src/lib/bounded-json-body.ts';

function fixture(options = {}) {
  const calls = [];
  const user = { id: 'signed-in-admin', email: options.email || 'owner@admin.mydancr.local' };
  class PublicRequestRateLimitError extends Error { retryAfterSeconds = 900; }
  const deps = {
    'next/server': { NextResponse: Response },
    '@/src/lib/api': { PublicApiError, apiError(error, fallback) { const result = resolveApiError(error, fallback); return Response.json(result.body, { status: result.status }); } },
    '@/src/lib/bounded-json-body': { readBoundedJsonObject },
    '@/src/lib/dancr/admin': { async requireAdmin(_client, id, scope) { calls.push(['authorize', id, scope]); if (options.forbidden) throw new Error('Admin access required.'); } },
    '@/src/lib/dancr/email-actions': {
      EMAIL_ACTION_HEADERS: { 'cache-control': 'private, no-store, max-age=0', 'referrer-policy': 'no-referrer' },
      isUsernameOnlyAdminEmail: email => /^[^@]+@admin\.mydancr\.local$/i.test(email),
      async sendAdminEmailChange(_admin, input) {
        calls.push(['send', input]);
        if (options.deliveryFails) throw new PublicApiError('UNAVAILABLE', 'Unable to send confirmation.', 503);
        return { newEmail: input.newEmail, needsCurrentInbox: Boolean(options.email) };
      },
    },
    '@/src/lib/dancr/public-request-rate-limit': {
      PublicRequestRateLimitError,
      async enforcePublicRequestRateLimit(_admin, input) { calls.push(['limit', input]); if (options.limited) throw new PublicRequestRateLimitError('Too many requests.'); },
    },
    '@/src/lib/supabase/admin': { createAdminSupabaseClient: () => ({}) },
    '@/src/lib/supabase/request': { async createRequestSupabaseContext() {
      if (options.signedOut) throw new Error('Sign in required.');
      return { client: {}, user, session: { accessToken: 'refreshed-admin-token' } };
    } },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync('app/api/admin/account/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Error, require(name) { assert.ok(name in deps, name); return deps[name]; } });
  return { calls, user, get: () => exports.GET(new Request('https://www.mydancr.com/api/admin/account')),
    patch: (input = { email: ' NEW@EXAMPLE.INVALID ', currentPassword: 'current password' }) => exports.PATCH(new Request('https://www.mydancr.com/api/admin/account', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })),
  };
}

test('own admin settings show real email or legacy username without presenting a synthetic inbox', async () => {
  const f = fixture(); const response = await f.get(); const body = await response.json();
  assert.equal(body.usernameOnly, true); assert.equal(body.username, 'owner'); assert.equal(body.email, null);
  assert.equal(body.userId, f.user.id); assert.match(response.headers.get('cache-control'), /no-store/);
  assert.deepEqual(f.calls, [['authorize', f.user.id, 'workspace']]);
  const real = await (await fixture({ email: 'admin@example.invalid' }).get()).json();
  assert.equal(real.usernameOnly, false); assert.equal(real.email, 'admin@example.invalid');
});

test('email requests authorize every staff role for their own account and ignore supplied target IDs', async () => {
  const f = fixture();
  const response = await f.patch({ email: ' NEW@EXAMPLE.INVALID ', currentPassword: 'current password', userId: 'someone-else', passwordVerifiedEmail: f.user.email });
  assert.equal(response.status, 200); const body = await response.json();
  assert.equal(body.session.accessToken, 'refreshed-admin-token'); assert.equal(body.userId, f.user.id);
  assert.deepEqual(f.calls.map(call => call[0]), ['authorize', 'limit', 'send']);
  assert.equal(f.calls[1][1].subject, f.user.id); assert.equal(f.calls[1][1].subjectLimit, 5);
  assert.deepEqual({ ...f.calls[2][1] }, { userId: f.user.id, newEmail: 'new@example.invalid', currentPassword: 'current password' });
  assert.match(body.message, /instead of your username/); assert.match(response.headers.get('cache-control'), /no-store/);
});

test('a real-email admin is told to confirm both inboxes without prematurely changing the displayed email', async () => {
  const f = fixture({ email: 'current@example.invalid' });
  const body = await (await f.patch()).json(); assert.match(body.message, /both your current inbox/);
  assert.equal((await (await f.get()).json()).email, 'current@example.invalid');
});

test('signed-out and non-admin accounts cannot read or change admin sign-in details', async () => {
  for (const options of [{ signedOut: true }, { forbidden: true }]) {
    const f = fixture(options); const expected = options.signedOut ? 401 : 403;
    assert.equal((await f.get()).status, expected); assert.equal((await f.patch()).status, expected);
    assert.ok(!f.calls.some(call => call[0] === 'send' || call[0] === 'limit'));
  }
});

test('invalid or oversized requests never attempt password checks or email delivery', async () => {
  for (const input of [ {}, { email: 'invalid', currentPassword: 'p' }, { email: 'new@example.invalid', currentPassword: '' },
    { email: 'new@example.invalid', currentPassword: 'p'.repeat(1025) }, { email: 'n'.repeat(9000), currentPassword: 'p' } ]) {
    const f = fixture(); const response = await f.patch(input);
    assert.ok([400, 413].includes(response.status)); assert.ok(!f.calls.some(call => call[0] === 'send'));
  }
});

test('rate limits stop email requests and delivery failures remain errors', async () => {
  const limited = fixture({ limited: true }); const response = await limited.patch();
  assert.equal(response.status, 429); assert.equal(response.headers.get('retry-after'), '900');
  assert.ok(!limited.calls.some(call => call[0] === 'send'));
  const failed = await fixture({ deliveryFails: true }).patch();
  assert.equal(failed.status, 503); assert.equal((await failed.json()).ok, false);
});
