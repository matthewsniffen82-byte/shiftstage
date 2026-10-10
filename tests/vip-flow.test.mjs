import assert from 'node:assert/strict';
import test from 'node:test';
import { compileVip } from './helpers/vip-dashboard-fixture.mjs';
import { vipReturnPath, vipPlannerPath } from '../src/lib/dancr/vip-entry.ts';
import { USER_TERMS_VERSION } from '../src/lib/dancr/user-terms-version.ts';

class PublicApiError extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status; } }
class PublicRequestRateLimitError extends Error { constructor(seconds) { super('Wait'); this.retryAfterSeconds = seconds; } }
const venueId = '97000000-0000-4000-8000-000000000020';
const token = 'vip_' + 'a'.repeat(48);

function confirmationFixture({ matches = true, unavailable = false, throttled = false, providerError = null, termsUnavailable = false } = {}) {
  const sends = [], queries = [], limits = [], terms = [];
  const userTerms = compileVip('src/lib/dancr/user-terms.ts', {
    '../api-error-policy': { PublicApiError }, './user-terms-version': { USER_TERMS_VERSION },
  });
  const chain = { select: () => chain, eq: (key, value) => { queries.push([key, value]); return chain; }, is: () => chain, gt: () => chain,
    maybeSingle: async () => ({ data: matches ? { id: 'pending-invitation' } : null }) };
  const route = compileVip('app/api/vip/confirmation/route.ts', {
    'next/server': { NextResponse: Response },
    '@/src/lib/api': { PublicApiError, apiError: error => Response.json({ ok: false, error: error.message }, { status: error.status || 500 }) },
    '@/src/lib/bounded-json-body': { readBoundedJsonObject: async request => request.json() },
    '@/src/lib/dancr/user-terms': userTerms,
    '@/src/lib/supabase/admin': { createAdminSupabaseClient: () => ({ from: () => chain, rpc: async (name, input) => { terms.push({ name, input }); return termsUnavailable ? { error: new Error('offline') } : { data: '97000000-0000-4000-8000-000000000001' }; } }) },
    '@/src/lib/supabase/server': { createServerSupabaseClient: () => ({ auth: {
      resend: async input => { sends.push({ ...input, method: 'resend' }); return { error: providerError }; },
      signInWithOtp: async input => { sends.push({ ...input, method: 'otp' }); return { error: providerError }; },
    } }) },
    '@/src/lib/dancr/public-app-url': { publicAppUrl: () => 'https://mydancr.test' },
    '@/src/lib/dancr/public-request-rate-limit': { PublicRequestRateLimitError, enforcePublicRequestRateLimit: async (_client, input) => { limits.push(input); if (throttled) throw new PublicRequestRateLimitError(120); } },
    '@/src/lib/dancr/vip': { VIP_HEADERS: { 'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer' }, vipError: error => error,
      vipTokenDigest: value => { assert.equal(value, token); return 'digest'; },
      resolveVipInvitation: async () => { if (unavailable) throw new PublicApiError('NOT_FOUND', 'Expired', 404); } },
  }, { Response, Request, URL });
  return { sends, queries, limits, terms, post: (body = {}) => route.POST(new Request('https://mydancr.test/api/vip/confirmation', { method: 'POST', body: JSON.stringify({ token, email: 'Guest@Example.test', emailRedirectTo: 'https://evil.test', ...body }) })) };
}

test('confirmation resend is bound to the invited email and uses a server-built VIP return', async () => {
  const f = confirmationFixture(); const response = await f.post();
  assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(f.limits[0].subject, 'guest@example.test'); assert.equal(f.sends.length, 1);
  assert.ok(f.queries.some(([key, value]) => key === 'token_digest' && value === 'digest'));
  assert.ok(f.queries.some(([key, value]) => key === 'email' && value === 'guest@example.test'));
  const redirect = new URL(f.sends[0].options.emailRedirectTo);
  assert.equal(redirect.origin, 'https://mydancr.test'); assert.equal(redirect.searchParams.get('return_to'), '/vip/invite/' + token);
  const mismatched = confirmationFixture({ matches: false });
  assert.deepEqual(await (await mismatched.post()).json(), await response.json()); assert.equal(mismatched.sends.length, 0);
});

test('expired invitations and throttled confirmations cannot trigger another email', async () => {
  for (const [options, status] of [[{ unavailable: true }, 404], [{ throttled: true }, 429]]) {
    const f = confirmationFixture(options); const response = await f.post();
    assert.equal(response.status, status); assert.equal(f.sends.length, 0);
    if (status === 429) assert.equal(response.headers.get('retry-after'), '120');
  }
  const outage = confirmationFixture({ providerError: { status: 503 } }); assert.equal((await outage.post()).status, 503);
  const confirmed = confirmationFixture({ providerError: { status: 422 } }); assert.equal((await confirmed.post()).status, 200);
});

const startSetup = { action: 'start', userTermsAccepted: true, userTermsVersion: USER_TERMS_VERSION };
test('VIP email-first signup and repeated links use OTP identity reuse without setting a password', async () => {
  const f = confirmationFixture();
  for (let i = 0; i < 2; i++) {
    const response = await f.post({ ...startSetup, password: 'Never1!use-this', role: 'admin' });
    assert.equal(response.status, 200);
    const sent = f.sends[i]; assert.equal(sent.method, 'otp'); assert.equal(sent.email, 'guest@example.test');
    assert.equal(sent.password, undefined); assert.equal(sent.options.shouldCreateUser, true);
    assert.equal(sent.options.data.role, 'customer'); assert.ok(sent.options.data.user_terms_intent);
    const redirect = new URL(sent.options.emailRedirectTo);
    assert.equal(redirect.origin, 'https://mydancr.test');
    assert.equal(redirect.searchParams.get('return_to'), '/account/reset-password');
    assert.equal(redirect.searchParams.get('vip_return_to'), '/vip/invite/' + token);
    assert.equal(redirect.searchParams.get('reset_target'), 'account_password');
    assert.equal(redirect.searchParams.get('vip_setup'), '1');
  }
  assert.equal(f.sends.length, 2); assert.equal(f.limits.length, 2);
  assert.equal(f.terms[0].input.p_email, 'guest@example.test');
});
test('finish setup cannot create another guest or change existing metadata', async () => {
  const f = confirmationFixture();
  assert.equal((await f.post({ action: 'resume' })).status, 200);
  assert.equal(f.sends[0].method, 'otp'); assert.equal(f.sends[0].options.shouldCreateUser, false);
  assert.equal(f.sends[0].options.data, undefined); assert.equal(f.terms.length, 0);
});
test('new guest setup requires current terms and a matching live invitation before contacting Auth', async () => {
  for (const userTermsAccepted of [false, 'true', undefined]) {
    const f = confirmationFixture();
    assert.equal((await f.post({ ...startSetup, userTermsAccepted })).status, 400); assert.equal(f.sends.length, 0);
  }
  const old = confirmationFixture(); assert.equal((await old.post({ ...startSetup, userTermsVersion: 'old' })).status, 400);
  for (const action of ['invalid', {}, 3, false]) {
    const invalid = confirmationFixture(); assert.equal((await invalid.post({ action })).status, 400); assert.equal(invalid.sends.length, 0);
  }
  for (const action of ['start', 'resume']) {
    const known = confirmationFixture(), wrong = confirmationFixture({ matches: false });
    assert.deepEqual(await (await wrong.post({ ...startSetup, action })).json(), await (await known.post({ ...startSetup, action })).json());
    assert.equal(wrong.sends.length, 0); assert.equal(wrong.terms.length, 0);
    const revoked = confirmationFixture({ unavailable: true });
    assert.equal((await revoked.post({ ...startSetup, action })).status, 404); assert.equal(revoked.sends.length, 0);
  }
});
test('verification outages and throttles stay retryable without claiming email delivery', async () => {
  const terms = confirmationFixture({ termsUnavailable: true });
  assert.equal((await terms.post(startSetup)).status, 503); assert.equal(terms.sends.length, 0);
  for (const action of ['start', 'resume']) for (const [options, status] of [
    [{ throttled: true }, 429], [{ providerError: { status: 429 } }, 429], [{ providerError: { status: 503 } }, 503],
  ]) {
    const f = confirmationFixture(options);
    const response = await f.post({ ...startSetup, action });
    assert.equal(response.status, status); assert.equal((await response.json()).ok, false);
  }
});

test('VIP destinations reject arbitrary return URLs and preserve the activated venue', () => {
  assert.equal(vipReturnPath('/vip/invite/' + token), '/vip/invite/' + token);
  for (const path of ['/vip/../admin', '//evil.test', '/vip?redirect=//evil.test', '/vip/invite/' + token + '?x=1', null]) assert.equal(vipReturnPath(path), '');
  assert.equal(vipPlannerPath(venueId), `/vip?venueId=${venueId}#vip-plan`);
  assert.throws(() => vipPlannerPath('//evil.test'));
});

function dataFixture() {
  const calls = [];
  const dancers = [{ id: 'd1', stage_name: 'Aria', working_now: false }, { id: 'd2', stage_name: 'Nova', working_now: true }];
  const tables = {
    venue_vip_members: [{ user_id: 'guest', active: true, display_name: 'Guest', venue: { id: venueId, name: 'Invited venue', timezone: 'America/Los_Angeles', is_active: true, owner: { role: 'venue', account_state: 'active' } } }],
    dancer_profiles: [{ id: 'd1', avatar_storage_path: 'd1/avatar.jpg', status: 'approved', verification_status: 'approved', disabled_at: null },
      { id: 'd2', avatar_storage_path: null, status: 'approved', verification_status: 'approved', disabled_at: null },
      { id: 'outsider', avatar_storage_path: 'private/photo.jpg', status: 'approved', verification_status: 'approved', disabled_at: null }],
    venue_vip_invitations: [],
    venue_vip_requests: Array.from({ length: 125 }, (_, i) => ({ id: String(i), venue_id: i < 120 ? venueId : 'other-venue', status: i < 60 || i >= 120 ? 'pending' : 'confirmed', created_at: i })),
  };
  const client = {
    from(table) {
      let rows = [...tables[table]], range = [0, Infinity];
      const orders = []; const call = { table, filters: [] }; calls.push(call);
      const chain = { select: () => chain,
        eq: (key, value) => { call.filters.push([key, value]); rows = rows.filter(row => row[key] === value); return chain; },
        is: (key, value) => { rows = rows.filter(row => row[key] === value); return chain; },
        in: (key, values) => { rows = rows.filter(row => values.includes(row[key])); return chain; },
        gt: (key, value) => { rows = rows.filter(row => row[key] > value); return chain; },
        order: (key, options = {}) => { orders.push([key, options.ascending === false ? -1 : 1]); return chain; },
        range: (start, end) => { range = [start, end]; return chain; },
        then: (resolve, reject) => {
          rows.sort((a, b) => { for (const [key, direction] of orders) { if (a[key] !== b[key]) return (a[key] > b[key] ? 1 : -1) * direction; } return 0; });
          return Promise.resolve({ data: rows.slice(range[0], range[1] + 1), count: rows.length }).then(resolve, reject);
        } };
      return chain;
    },
    rpc: async name => ({ data: name === 'vip_manager_access' ? true : name === 'vip_eligible_dancers' ? dancers : { members: [], memberCount: 0 } }),
  };
  const service = compileVip('src/lib/dancr/vip.ts', {
    '../api-error-policy': { PublicApiError }, './venue-access': { requireVenueAccess: async () => ({ venueId }) },
    './media-delivery-url': { dancerPhotoDeliveryUrl: (path, width, preview) => { assert.equal(preview, undefined); return '/api/media/dancer-photo?' + new URLSearchParams({ path, width }); } },
  });
  return { client, calls, service };
}

test('venue pending filter finds older requests across pages and never mixes venues', async () => {
  const { client, service } = dataFixture();
  const all = await service.getVenueVipState(client, 'manager', new URLSearchParams());
  assert.equal(all.requests.every(row => row.status === 'confirmed'), true);
  const first = await service.getVenueVipState(client, 'manager', new URLSearchParams({ status: 'pending' }));
  const second = await service.getVenueVipState(client, 'manager', new URLSearchParams({ status: 'pending', page: '1' }));
  assert.equal(first.requestCount, 60); assert.equal(first.requests.length, 50); assert.equal(first.hasMore, true);
  assert.equal(second.requests.length, 10); assert.equal(second.hasMore, false);
  assert.equal(new Set([...first.requests, ...second.requests].map(row => row.id)).size, 60);
  assert.ok([...first.requests, ...second.requests].every(row => row.venue_id === venueId && row.status === 'pending'));
  await assert.rejects(service.getVenueVipState(client, 'manager', new URLSearchParams({ status: 'invalid' })), error => error.status === 400);
});

test('VIP planner includes only eligible dancer photos through the revocable photo endpoint', async () => {
  const { client, service } = dataFixture();
  const result = await service.getVipState(client, 'guest', new URLSearchParams({ view: 'plan' }));
  assert.equal(result.dancers.length, 2); assert.match(result.dancers[0].photoUrl, /^\/api\/media\/dancer-photo\?/);
  assert.equal(result.dancers[1].photoUrl, null); assert.doesNotMatch(JSON.stringify(result), /private\/photo|outsider|preview=/);
});
