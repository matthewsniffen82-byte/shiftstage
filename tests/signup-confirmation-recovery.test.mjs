import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function compile(path, overrides = {}) {
  const source = readFileSync(path, 'utf8');
  const dependencies = Object.fromEntries([...source.matchAll(/from "([^"]+)"/g)].map(match => [match[1], {}]));
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, URL, Request, Response, Error, TextDecoder, Uint8Array, setTimeout, clearTimeout,
    console: { info() {}, warn() {}, error() {} },
    require: name => name === 'next/server' ? require(name) : { ...dependencies, ...overrides }[name],
  });
  return exports;
}
const policy = compile('src/lib/api-error-policy.ts', {
  './dancr/phone-tap-copy.ts': compile('src/lib/dancr/phone-tap-copy.ts'),
  './dancr/payout-copy.ts': compile('src/lib/dancr/payout-copy.ts'),
});
const api = { PublicApiError: policy.PublicApiError, apiError(error, fallback) {
  const result = policy.resolveApiError(error, fallback);
  return Response.json(result.body, { status: result.status });
} };
const bounded = compile('src/lib/bounded-json-body.ts', { './api-error-policy.ts': policy });
class RateLimitError extends Error {
  constructor(seconds) { super('Limited'); this.retryAfterSeconds = seconds; }
}
function fixture({ providerError = null, limitError = null, resend } = {}) {
  const calls = [], limits = [];
  const route = compile('app/api/auth/confirmation/route.ts', {
    '@/src/lib/api': api,
    '@/src/lib/bounded-json-body': bounded,
    '@/src/lib/dancr/public-app-url': { publicAppUrl: () => 'https://www.mydancr.com' },
    '@/src/lib/dancr/public-request-rate-limit': {
      PublicRequestRateLimitError: RateLimitError,
      enforcePublicRequestRateLimit: async (_client, input) => { limits.push(input); if (limitError) throw limitError; },
    },
    '@/src/lib/supabase/admin': { createAdminSupabaseClient: () => ({}) },
    '@/src/lib/dancr/email-actions': { sendPendingAccountEmail: async (_admin, email, purpose) => {
      calls.push({ email, purpose });
      if (providerError?.status === 429) throw new RateLimitError(60);
      if (providerError && providerError.status !== 400) throw new policy.PublicApiError('UNAVAILABLE', 'Email delivery is temporarily unavailable.', 503);
      return resend ? resend({ email, purpose }) : !providerError;
    } },
  });
  return { ...route, calls, limits };
}
const request = body => new Request('https://www.mydancr.com/api/auth/confirmation', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

test('a fresh confirmation uses the current email and trusted callback, never submitted role or credentials', async () => {
  const f = fixture();
  const response = await f.POST(request({ email: ' Guest@Example.Test ', role: 'admin', userId: 'deleted-id', password: 'ignored', emailRedirectTo: 'https://outside.test' }));
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), [{ email: 'guest@example.test', purpose: 'confirmation' }]);
  assert.equal(f.limits[0].subject, 'guest@example.test');
  assert.equal(f.limits[0].subjectLimit, 3);
  assert.equal(f.limits[0].ipLimit, 8);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.match((await response.json()).message, /Check your inbox/);
});

test('resending cannot recreate a deleted account or reveal whether an email exists', async () => {
  const responses = [];
  for (const providerError of [null, { status: 400, code: 'email_not_found' }, { status: 400, code: 'email_already_confirmed' }]) {
    const f = fixture({ providerError });
    const response = await f.POST(request({ email: 'former@example.test' }));
    assert.equal(response.status, 200);
    responses.push(await response.json());
    assert.equal(f.calls.length, 1);
  }
  assert.deepEqual(responses[0], responses[1]);
  assert.deepEqual(responses[1], responses[2]);
});

for (const email of ['', 'missing-at.test', 'a@b', {}, 'a'.repeat(255) + '@example.test']) test(`rejects invalid email ${typeof email === 'string' ? email.slice(0, 30) : 'object'}`, async () => {
  const f = fixture();
  assert.equal((await f.POST(request({ email }))).status, 400);
  assert.equal(f.calls.length, 0);
  assert.equal(f.limits.length, 0);
});

test('oversize requests are rejected before email delivery', async () => {
  const f = fixture();
  assert.equal((await f.POST(request({ email: 'guest@example.test', extra: 'x'.repeat(2048) }))).status, 413);
  assert.equal(f.calls.length, 0);
});

for (const status of [0, 408, 500, 503]) test(`provider outage ${status} does not claim a confirmation email was sent`, async () => {
  const f = fixture({ providerError: { status } });
  const response = await f.POST(request({ email: 'guest@example.test' }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).ok, false);
  assert.equal(f.calls.length, 1);
});

for (const source of ['application', 'provider']) test(`${source} email rate limit is returned with retry guidance`, async () => {
  const f = fixture(source === 'application' ? { limitError: new RateLimitError(300) } : { providerError: { status: 429 } });
  const response = await f.POST(request({ email: 'guest@example.test' }));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), source === 'application' ? '300' : '60');
  assert.equal(f.calls.length, source === 'application' ? 0 : 1);
});

for (const role of ['customer', 'dancer', 'venue', 'admin']) test(`${role} deletion removes the authenticated identity, including its email reservation`, async () => {
  const events = [];
  const admin = { auth: { admin: { deleteUser: async (...args) => { events.push(['delete', ...args]); return { error: null }; } } } };
  const account = { id: 'old-user', role, accountState: 'deleted', email: null };
  const route = compile('app/api/account/route.ts', {
    '@/src/lib/api': api,
    '@/src/lib/supabase/request': { createRequestSupabaseContext: async () => ({ client: {}, user: { id: 'old-user' } }) },
    '@/src/lib/supabase/admin': { createAdminSupabaseClient: () => admin },
    '@/src/lib/dancr/auth': { setAccountState: async (_client, id, state, authority) => {
      assert.equal(authority, admin); events.push(['state', id, state]); return account;
    } },
  });
  const response = await route.DELETE(new Request('https://www.mydancr.com/api/account', { method: 'DELETE' }));
  assert.equal(response.status, 200);
  assert.deepEqual(events, [['state', 'old-user', 'deleted'], ['delete', 'old-user']]);
  assert.equal((await response.json()).ok, true);
});
