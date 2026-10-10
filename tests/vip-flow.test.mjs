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
    '@/src/lib/dancr/vip-setup-link': { sendVipSetupLink: async (_admin, input) => { sends.push({ ...input, method: 'setup' }); if (providerError) throw providerError; } },
    '@/src/lib/supabase/admin': { createAdminSupabaseClient: () => ({ from: () => chain, rpc: async (name, input) => { terms.push({ name, input }); return termsUnavailable ? { error: new Error('offline') } : { data: '97000000-0000-4000-8000-000000000001' }; } }) },
    '@/src/lib/supabase/server': { createServerSupabaseClient: () => ({ auth: {
      resend: async input => { sends.push({ ...input, method: 'resend' }); return { error: providerError }; },
      signInWithOtp: async input => { sends.push({ ...input, method: 'otp' }); return { error: providerError }; },
    } }) },
    '@/src/lib/dancr/public-app-url': { publicAppUrl: () => 'https://mydancr.test' },
    '@/src/lib/dancr/public-request-rate-limit': { PublicRequestRateLimitError, enforcePublicRequestRateLimit: async (_client, input) => { limits.push(input); if (throttled) throw new PublicRequestRateLimitError(120); } },
    '@/src/lib/dancr/vip': { VIP_HEADERS: { 'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer' }, vipError: error => error,
      vipTokenDigest: value => { assert.equal(value, token); return 'digest'; },
      resolveVipInvitation: async () => { if (unavailable) throw new PublicApiError('NOT_FOUND', 'Expired', 404); return { expiresAt: '2026-10-17T00:00:00Z' }; } },
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
test('VIP email-first signup and repeated links use reusable setup without setting a password', async () => {
  const f = confirmationFixture();
  for (let i = 0; i < 2; i++) {
    const response = await f.post({ ...startSetup, password: 'Never1!use-this', role: 'admin' });
    assert.equal(response.status, 200);
    const sent = f.sends[i]; assert.equal(sent.method, 'setup'); assert.equal(sent.email, 'guest@example.test');
    assert.equal(sent.password, undefined); assert.equal(sent.invitation, token);
    assert.equal(sent.metadata.role, 'customer'); assert.ok(sent.metadata.user_terms_intent);
    assert.equal(sent.expiresAt, '2026-10-17T00:00:00Z'); assert.equal(sent.emailRedirectTo, undefined);
    assert.equal((await response.json()).link, undefined);
  }
  assert.equal(f.sends.length, 2); assert.equal(f.limits.length, 2);
  assert.equal(f.terms[0].input.p_email, 'guest@example.test');
});
test('finish setup cannot create another guest or change existing metadata', async () => {
  const f = confirmationFixture();
  assert.equal((await f.post({ action: 'resume' })).status, 200);
  assert.equal(f.sends[0].method, 'setup');
  assert.equal(f.sends[0].metadata, undefined); assert.equal(f.terms.length, 0);
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
  const calls = [], failures = {};
  const dancers = [{ id: 'd1', stage_name: 'Aria', working_now: false }, { id: 'd2', stage_name: 'Nova', working_now: true }];
  const tables = {
    venue_vip_members: [{ user_id: 'guest', active: true, display_name: 'Guest', venue: { id: venueId, name: 'Invited venue', timezone: 'America/Los_Angeles', is_active: true, owner: { role: 'venue', account_state: 'active' } } }],
    favorites: [],
    dancer_profiles: [{ id: 'd1', slug: 'aria', is_public: true, avatar_storage_path: 'd1/avatar.jpg', status: 'approved', verification_status: 'approved', disabled_at: null },
      { id: 'd2', slug: 'nova', is_public: true, avatar_storage_path: null, status: 'approved', verification_status: 'approved', disabled_at: null },
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
        range: (start, end) => { range = [start, end]; call.range = range; return chain; },
        then: (resolve, reject) => {
          rows.sort((a, b) => { for (const [key, direction] of orders) { if (a[key] !== b[key]) return (a[key] > b[key] ? 1 : -1) * direction; } return 0; });
          return Promise.resolve({ data: rows.slice(range[0], range[1] + 1), count: rows.length, error: failures[table] }).then(resolve, reject);
        } };
      return chain;
    },
    rpc: async name => ({ data: name === 'vip_manager_access' ? true : name === 'vip_eligible_dancers' ? dancers : { members: [], memberCount: 0 } }),
  };
  const service = compileVip('src/lib/dancr/vip.ts', {
    '../api-error-policy': { PublicApiError }, './venue-access': { requireVenueAccess: async () => ({ venueId }) },
    './media-delivery-url': { dancerPhotoDeliveryUrl: (path, width, preview) => { assert.equal(preview, undefined); return '/api/media/dancer-photo?' + new URLSearchParams({ path, width }); } },
  });
  return { client, calls, service, tables, dancers, failures };
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

test('VIP favorites belong to the guest and older requested dancers belong to the current venue', async () => {
  const { client, calls, service, tables } = dataFixture();
  tables.favorites = [{ customer_id: 'guest', dancer_id: 'd1' }, { customer_id: 'another-guest', dancer_id: 'd2' }, { customer_id: 'guest', dancer_id: 'outsider' }];
  tables.venue_vip_requests = [
    { id: 'other-guest', user_id: 'another-guest', venue_id: venueId, dancers: [{ id: 'd1' }], created_at: 2000 },
    { id: 'other-venue', user_id: 'guest', venue_id: 'another-venue', dancers: [{ id: 'd1' }], created_at: 2000 },
    ...Array.from({ length: 501 }, (_, i) => ({ id: String(i), user_id: 'guest', venue_id: venueId, created_at: i,
      dancers: i === 0 ? [{ id: 'd2' }, { id: 'd2' }] : [{ id: 'no-longer-eligible' }] })),
  ];
  const result = await service.getVipState(client, 'guest', new URLSearchParams({ view: 'plan' }));
  assert.deepEqual(Array.from(result.dancers, row => [row.id, row.favorite, row.previouslyRequested, row.profileHref]), [
    ['d1', true, false, '/dancers/aria'], ['d2', false, true, '/dancers/nova'],
  ]);
  assert.doesNotMatch(JSON.stringify(result.dancers), /outsider|no-longer-eligible/);
  const historyCalls = calls.filter(call => call.table === 'venue_vip_requests');
  assert.deepEqual(historyCalls.map(call => call.range), [[0, 499], [500, 999]]);
  for (const call of historyCalls) {
    assert.ok(call.filters.some(([key, value]) => key === 'user_id' && value === 'guest'));
    assert.ok(call.filters.some(([key, value]) => key === 'venue_id' && value === venueId));
  }
});

test('VIP planner cannot expose a private profile or turn a history/favorite failure into empty success', async () => {
  const f = dataFixture(); f.tables.dancer_profiles[0].is_public = false;
  const result = await f.service.getVipState(f.client, 'guest', new URLSearchParams({ view: 'plan' }));
  assert.equal(result.dancers[0].profileHref, null); assert.equal(result.dancers[0].photoUrl, null);
  assert.equal(result.dancers[1].profileHref, '/dancers/nova');
  for (const table of ['favorites', 'venue_vip_requests']) {
    const failed = dataFixture(); failed.failures[table] = new Error(`${table} unavailable`);
    await assert.rejects(failed.service.getVipState(failed.client, 'guest', new URLSearchParams({ view: 'plan' })), new RegExp(`${table} unavailable`));
  }
});
