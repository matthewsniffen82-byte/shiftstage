import assert from 'node:assert/strict';
import test from 'node:test';
import { compileVip } from './helpers/vip-dashboard-fixture.mjs';
import { readBoundedJsonObject } from '../src/lib/bounded-json-body.ts';
import { PublicApiError, resolveApiError } from '../src/lib/api-error-policy.ts';

function fixture({ internal = false, incognito = false, stale = false } = {}) {
  const profile = { id: 'dancer', status: 'approved', verification_status: 'approved', venue_approved_at: '2026-10-01', disabled_at: null, is_public: !internal && !incognito, is_incognito: incognito };
  const calls = [];
  const db = { from() { return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: { ...profile }, error: null }; } }; } };
  const route = compileVip('app/api/dancer/profile/visibility/route.ts', {
    'next/server': { NextResponse: Response },
    '@/src/lib/bounded-json-body': { readBoundedJsonObject },
    '@/src/lib/api': { PublicApiError, apiError(error) { const result = resolveApiError(error); return Response.json(result.body, { status: result.status }); } },
    '@/src/lib/supabase/request': { createRequestSupabaseContext: async (_request, options) => { assert.equal(options.role, 'dancer'); return { user: { id: 'owner' } }; } },
    '@/src/lib/supabase/admin': { createAdminSupabaseClient: () => db },
    '@/src/lib/dancr/profile-approval': { isCoreVerificationApproved: value => value.verification_status === 'approved' && !!value.venue_approved_at },
    '@/src/lib/security/safe-error-metadata': { safeErrorMetadata: () => ({}) },
    '@/src/lib/dancr/profile-publication': { transitionDancerPublication: async (_db, id, action, options) => {
      calls.push({ id, action, options });
      const isIncognito = action === 'set_private', isPublic = !internal && !isIncognito;
      profile.is_public = isPublic; profile.is_incognito = stale ? !isIncognito : isIncognito;
      return { id, isPublic, isIncognito };
    } },
  }, { Response, console: { info() {}, error() {} } });
  return { calls, patch: body => route.PATCH(new Request('https://example.test/api/dancer/profile/visibility', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })) };
}

test('already public-hidden Internal-only dancers can explicitly enter Incognito', async () => {
  const f = fixture({ internal: true });
  const response = await f.patch({ isIncognito: true });
  assert.equal(response.status, 200); const data = await response.json();
  assert.equal(data.profile.is_public, false); assert.equal(data.profile.is_incognito, true);
  assert.equal(data.visibility.isIncognito, true); assert.equal(f.calls[0].action, 'set_private');
  assert.equal(f.calls[0].options.actorUserId, 'owner'); assert.match(response.headers.get('cache-control'), /no-store/);
});

test('restoring an Internal-only dancer confirms visibility without publishing publicly', async () => {
  const f = fixture({ internal: true, incognito: true });
  const data = await (await f.patch({ isIncognito: false })).json();
  assert.equal(data.profile.is_public, false); assert.equal(data.profile.is_incognito, false);
  assert.equal(data.visibility.verified, true); assert.equal(f.calls[0].action, 'restore_visibility');
});

test('legacy hiding is supported; malformed and concurrently changed privacy cannot claim success', async () => {
  assert.equal((await fixture().patch({ isPublic: false })).status, 200);
  assert.equal((await fixture({ internal: true, stale: true }).patch({ isIncognito: true })).status, 500);
  for (const body of [{}, { isIncognito: 'true' }, { isIncognito: true, isPublic: false }]) {
    const f = fixture(); assert.equal((await f.patch(body)).status, 400); assert.equal(f.calls.length, 0);
  }
});
