import assert from 'node:assert/strict';
import test from 'node:test';
import { compileVip } from './helpers/vip-dashboard-fixture.mjs';
import { vipReturnPath, vipPlannerPath } from '../src/lib/dancr/vip-entry.ts';

class PublicApiError extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status; } }
class PublicRequestRateLimitError extends Error { constructor(seconds) { super('Wait'); this.retryAfterSeconds = seconds; } }
const venueId = '97000000-0000-4000-8000-000000000020';
const token = 'vip_' + 'a'.repeat(48);

function confirmationFixture({ matches = true, unavailable = false, throttled = false, providerError = null } = {}) {
  const sends = [], queries = [], limits = [];
  const chain = { select: () => chain, eq: (key, value) => { queries.push([key, value]); return chain; }, is: () => chain, gt: () => chain,
    maybeSingle: async () => ({ data: matches ? { id: 'pending-invitation' } : null }) };
  const route = compileVip('app/api/vip/confirmation/route.ts', {
    'next/server': { NextResponse: Response },
    '@/src/lib/api': { PublicApiError, apiError: error => Response.json({ ok: false, error: error.message }, { status: error.status || 500 }) },
    '@/src/lib/bounded-json-body': { readBoundedJsonObject: async request => request.json() },
    '@/src/lib/supabase/admin': { createAdminSupabaseClient: () => ({ from: () => chain }) },
    '@/src/lib/supabase/server': { createServerSupabaseClient: () => ({ auth: { resend: async input => { sends.push(input); return { error: providerError }; } } }) },
    '@/src/lib/dancr/public-app-url': { publicAppUrl: () => 'https://mydancr.test' },
    '@/src/lib/dancr/public-request-rate-limit': { PublicRequestRateLimitError, enforcePublicRequestRateLimit: async (_client, input) => { limits.push(input); if (throttled) throw new PublicRequestRateLimitError(120); } },
    '@/src/lib/dancr/vip': { VIP_HEADERS: { 'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer' }, vipError: error => error,
      vipTokenDigest: value => { assert.equal(value, token); return 'digest'; },
      resolveVipInvitation: async () => { if (unavailable) throw new PublicApiError('NOT_FOUND', 'Expired', 404); } },
  }, { Response, Request, URL });
  return { sends, queries, limits, post: () => route.POST(new Request('https://mydancr.test/api/vip/confirmation', { method: 'POST', body: JSON.stringify({ token, email: 'Guest@Example.test', emailRedirectTo: 'https://evil.test' }) })) };
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
