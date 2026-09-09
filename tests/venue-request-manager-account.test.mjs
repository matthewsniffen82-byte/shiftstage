import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
function compile(source, dependencies = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, URL, Request, Response, Error, Buffer,
    console: { info() {}, warn() {}, error() {} },
    require: name => name === 'next/server' ? require(name) : dependencies[name] || {},
  });
  return exports;
}
const policy = compile(read('src/lib/dancr/password-policy.ts'));
const input = { loginEmail: ' Manager@Example.com ', password: ' Exact1! ', confirmPassword: ' Exact1! ', venueName: 'Test Club', streetAddress: '123 Test Street', city: 'Las Vegas', state: 'NV', postalCode: '89101', contactName: 'Test Manager', contactTitle: 'Owner', contactPhone: '702-555-0123', authorizedToRepresentVenue: true };
function managerModule(provision = async () => {}) {
  return compile(read('src/lib/dancr/venue-request-account.ts'), {
    './password-policy': policy, './account-provisioning': { provisionAppAccount: provision },
    '../security/safe-error-metadata': { safeErrorMetadata: () => ({}) },
  });
}
test('manager credentials normalize the login email and preserve exact passwords', () => {
  const m = managerModule();
  const result = m.venueRequestCredentials(input);
  assert.equal(result.email, 'manager@example.com');
  assert.equal(result.password, input.password);
  for (const patch of [{ loginEmail: '' }, { password: 'abcdef' }, { confirmPassword: 'Exact1!' }]) {
    assert.throws(() => m.venueRequestCredentials({ ...input, ...patch }));
  }
});
test('a provisioning failure cleans up only the newly created auth account', async () => {
  const calls = [];
  const m = managerModule(async () => { throw new Error('private database detail'); });
  const client = { auth: { admin: {
    createUser: async value => { calls.push(value); return { data: { user: { id: 'new-manager' } } }; },
    deleteUser: async id => { calls.push(id); return {}; },
  } } };
  await assert.rejects(m.createRequestManager(client, { email: 'manager@example.com', password: input.password, displayName: 'Test Club', city: 'Las Vegas' }), /Unable to set up/);
  assert.equal(calls[0].app_metadata.mydancr_provisioned_role, 'venue');
  assert.equal(calls[0].password, input.password);
  assert.equal(calls[1], 'new-manager');
});
function requestFixture({ insertError = null, duplicate = false, committed = false } = {}) {
  const calls = [], removed = [], rows = [];
  const helpers = managerModule();
  const service = compile(read('src/lib/dancr/venue-signup-requests.ts'), {
    './venue-request-account': { ...helpers, createRequestManager: async (_c, value) => { calls.push(value); return 'new-manager'; }, removeUnsubmittedRequestManager: async (_c, id) => { removed.push(id); } },
    './venue-claims': { hashVenueClaimRequestIp: () => 'a'.repeat(64) },
  });
  const client = { from() {
    let inserted = null;
    const q = {
      select() { return q; }, eq() { return q; }, ilike() { return q; },
      gte: async () => ({ count: 0 }), maybeSingle: async () => ({ data: committed && rows.length ? { id: 'request', ...rows[0] } : duplicate ? { id: 'existing' } : null }),
      insert(row) { inserted = row; rows.push(row); return q; },
      single: async () => ({ data: { id: 'request', ...inserted }, error: insertError }),
    }; return q;
  } };
  return { calls, removed, rows, submit: () => service.createVenueSignupRequest(client, input, '127.0.0.1') };
}
test('saved requests bind the manager without storing password fields', async () => {
  const f = requestFixture(); const result = await f.submit();
  assert.equal(result.requesterUserId, 'new-manager');
  assert.equal(result.loginEmail, 'manager@example.com');
  assert.equal(f.rows[0].contact_email, result.loginEmail);
  assert.equal('password' in f.rows[0], false);
  assert.equal('confirmPassword' in f.rows[0], false);
  assert.equal(f.removed.length, 0);
});
test('failed request persistence removes its new login, and duplicates never create one', async () => {
  const f = requestFixture({ insertError: new Error('insert failed') });
  await assert.rejects(f.submit(), /insert failed/);
  assert.deepEqual(f.removed, ['new-manager']);
  const d = requestFixture({ duplicate: true });
  await assert.rejects(d.submit(), /already waiting/);
  assert.equal(d.calls.length, 0);
});
test('pending managers can sign in but cannot manage any venue', async () => {
  const auth = compile(read('app/api/auth/route.ts') + '\nexport { authResponse };', {
    '@/src/lib/supabase/admin': { createAdminSupabaseClient: () => ({}) },
    '@/src/lib/dancr/auth': { getAccountByUserId: async () => ({ id: 'pending', role: 'venue', accountState: 'active' }) },
    '@/src/lib/dancr/venue': { getVenueForAccount: async () => null },
    '@/src/lib/dancr/venue-request-account': { getVenueRequestForManager: async () => ({ status: 'pending' }) },
  });
  const result = await auth.authResponse('pending', 'venue', { access_token: 'token' }, false);
  assert.equal(result.session.accessToken, 'token');
  const access = compile(read('src/lib/dancr/venue-access.ts'));
  const client = { from(table) {
    const q = { select() { return q; }, eq() { return q; }, order() { return q; }, limit() { return q; },
      maybeSingle: async () => ({ data: table === 'app_users' ? { id: 'pending', role: 'venue', account_state: 'active' } : null }) };
    return q;
  } };
  await assert.rejects(access.requireVenueAccess(client, 'pending', 'manage_profile'), /active venue account is required/);
});
test('approval emails the existing login and never exposes a reusable access code', async () => {
  const messages = [];
  const service = compile(read('src/lib/dancr/venue-signup-requests.ts'), {
    './venue-claims': { createVenueSignupCredential: () => ({ code: 'legacy-secret', digest: 'a'.repeat(64) }) },
    './public-app-url': { publicAppUrl: () => 'https://mydancr.com' },
    './notification-delivery': { sendTransactionalEmail: async message => { messages.push(message); return { delivered: true }; } },
  });
  const client = {
    from() { const q = { select() { return q; }, eq() { return q; }, maybeSingle: async () => ({ data: { id: 'request' } }) }; return q; },
    rpc: async () => ({ data: { request: { id: 'request', requester_user_id: 'manager', login_email: 'login@example.com', contact_email: 'business@example.com', contact_name: 'Manager', status: 'approved' }, venue: { id: 'venue', name: 'Test Club' }, claim_code: { id: 'code' } } }),
  };
  const result = await service.reviewVenueSignupRequest(client, { requestId: 'request', adminId: 'admin', decision: 'approved' });
  assert.equal(result.managerAccountReady, true);
  assert.equal(result.accessCode, null); assert.equal(result.claimCode, null);
  assert.equal(messages[0].to, 'login@example.com');
  assert.match(messages[0].text, /https:\/\/mydancr.com\/dashboard\/venue/);
  assert.doesNotMatch(JSON.stringify(messages), /legacy-secret/);
});

test('an interrupted insert response preserves a request that already committed', async () => {
  const f = requestFixture({ insertError: new Error('response interrupted'), committed: true });
  const request = await f.submit();
  assert.equal(request.requesterUserId, 'new-manager');
  assert.equal(f.removed.length, 0);
});
test('a saved request remains successful when automatic sign-in is temporarily unavailable', async () => {
  let created = 0;
  const route = compile(read('app/api/venue/signup-requests/route.ts'), {
    '@/src/lib/bounded-json-body': { readBoundedJsonObject: request => request.json() },
    '@/src/lib/supabase/admin': { createAdminSupabaseClient: () => ({}) },
    '@/src/lib/dancr/public-request-rate-limit': { enforcePublicRequestRateLimit: async () => {}, PublicRequestRateLimitError: class extends Error {} },
    '@/src/lib/dancr/venue-signup-requests': { createVenueSignupRequest: async () => { created++; return { id: 'request', venueName: 'Test Club', loginEmail: 'manager@example.com', requesterUserId: 'manager', status: 'pending' }; } },
    '@/src/lib/supabase/server': { createServerSupabaseClient: () => ({ auth: { signInWithPassword: async () => ({ error: new Error('Temporary sign-in outage') }) } }) },
    '@/src/lib/security/safe-error-metadata': { safeErrorMetadata: () => ({}) },
  });
  const response = await route.POST(new Request('https://mydancr.com/api/venue/signup-requests', { method: 'POST', body: JSON.stringify(input) }));
  const payload = await response.json();
  assert.equal(response.status, 201);
  assert.equal(payload.request.status, 'pending');
  assert.equal(payload.session, null);
  assert.equal(created, 1);
  assert.doesNotMatch(JSON.stringify(payload), /Exact1|manager@example.com/);
});
test('request status requires authentication before looking up a manager request', async () => {
  let reads = 0;
  const route = compile(read('app/api/venue/signup-requests/route.ts'), {
    '@/src/lib/supabase/request': { createRequestSupabaseContext: async () => { throw new Error('Sign in required'); } },
    '@/src/lib/dancr/venue-request-account': { getVenueRequestForManager: async () => { reads++; } },
    '@/src/lib/api': { apiError: () => Response.json({ ok: false }, { status: 401 }) },
  });
  const response = await route.GET(new Request('https://mydancr.com/api/venue/signup-requests'));
  assert.equal(response.status, 401); assert.equal(reads, 0);
});
