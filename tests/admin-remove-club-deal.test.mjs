import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function load(path, dependencies = {}) {
  const exports = {};
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, console, Date, require: name => dependencies[name] || {},
  });
  return exports;
}
const ids = { venue: '11111111-1111-4111-8111-111111111111', deal: '22222222-2222-4222-8222-222222222222', other: '33333333-3333-4333-8333-333333333333' };
const preset = { title: 'Half-off admission', description: 'Half-price general admission.', terms: 'One per guest.' };
const service = load('src/lib/dancr/venue-deal-actions.ts', {
  './deals': load('src/lib/dancr/deals.ts'),
  './club-deal-presets': { clubDealOfferPresetForTitle: () => preset },
  './deal-policy': { assertLiquorFreeClubDeal() {} },
  './referral-fees': { getVenueReferralFeeState: async () => ({ current: { feeCents: 500 } }) },
});
function database(active = true) {
  const rows = [{ id: ids.deal, venue_id: ids.venue, deal_title: preset.title, deal_description: preset.description, is_active: active, removed_at: null },
    { id: ids.other, venue_id: ids.venue, deal_title: 'Other deal', is_active: true, removed_at: null }];
  const redemptions = [{ id: 'past-guest', club_deal_id: ids.deal, status: 'redeemed' }];
  const db = { rows, redemptions, fail: false, writes: 0, from(table) {
    let matched = table === 'venues' ? [{ id: ids.venue, name: 'Club B' }] : rows;
    let update;
    const run = () => { if (update && db.fail) return { data: null, error: new Error('Database unavailable') }; if (update) { matched.forEach(row => Object.assign(row, update)); db.writes += matched.length; } return { data: matched, error: null }; };
    const q = { select() { return q; }, order() { return q; }, limit() { return q; },
      eq(key, value) { matched = matched.filter(row => row[key] === value); return q; },
      is(key, value) { matched = matched.filter(row => (row[key] ?? null) === value); return q; },
      update(value) { update = value; return q; },
      async maybeSingle() { const result = run(); return { ...result, data: result.data?.[0] || null }; },
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
    }; return q;
  } }; return db;
}
for (const active of [true, false]) test(`admin removes a ${active ? 'live' : 'draft'} deal while preserving history and other offers`, async () => {
  const db = database(active);
  const result = await service.removeAdminVenueDeal(db, ids.venue, ids.deal);
  assert.equal(result.id, ids.deal);
  assert.equal(db.rows.length, 2);
  assert.equal(db.rows[0].is_active, false);
  assert.ok(Number.isFinite(Date.parse(db.rows[0].removed_at)));
  assert.equal(db.rows[1].is_active, true);
  assert.deepEqual(db.redemptions, [{ id: 'past-guest', club_deal_id: ids.deal, status: 'redeemed' }]);
  assert.deepEqual(Array.from(result.deals, deal => deal.id), [ids.other]);
  assert.deepEqual(Array.from(await service.getAdminVenueDealCatalog(db), deal => deal.id), [ids.other]);
});
test('removal rejects wrong venues, missing deals, and invalid identifiers without a write', async () => {
  for (const [venue, deal] of [[ids.other, ids.deal], [ids.venue, ids.venue], ['invalid', ids.deal], [ids.venue, 'invalid']]) {
    const db = database();
    await assert.rejects(service.removeAdminVenueDeal(db, venue, deal));
    assert.equal(db.writes, 0);
    assert.equal(db.rows[0].is_active, true);
  }
});
test('failed removal keeps the live deal available and allows retry', async () => {
  const db = database(); db.fail = true;
  await assert.rejects(service.removeAdminVenueDeal(db, ids.venue, ids.deal), /Database unavailable/);
  assert.equal(db.rows[0].is_active, true);
  assert.equal(db.rows[0].removed_at, null);
  db.fail = false;
  await service.removeAdminVenueDeal(db, ids.venue, ids.deal);
  assert.equal(db.rows[0].is_active, false);
});
test('a removed deal cannot be removed twice or republished by a stale editor', async () => {
  const db = database();
  await service.removeAdminVenueDeal(db, ids.venue, ids.deal);
  const removedAt = db.rows[0].removed_at;
  await assert.rejects(service.removeAdminVenueDeal(db, ids.venue, ids.deal), /already removed/);
  await assert.rejects(service.upsertAdminVenueDeal(db, { venueId: ids.venue, dealId: ids.deal, dealTitle: preset.title, dealDescription: preset.description, isActive: true, offerType: 'admission' }), /not found/);
  assert.equal(db.rows[0].removed_at, removedAt);
  assert.equal(db.rows[0].is_active, false);
  assert.equal(db.writes, 1);
});
function adminRoute(role) {
  const calls = [];
  const route = load('app/api/admin/deals/route.ts', {
    'next/server': { NextResponse: { json: (body, options) => ({ body, status: options?.status || 200 }) } },
    '@/src/lib/api': { apiError: error => ({ status: 403, error: error.message }) },
    '@/src/lib/bounded-json-body': { readBoundedJsonObject: request => request.json() },
    '@/src/lib/supabase/request': { createRequestSupabaseContext: async () => ({ client: {}, user: { id: 'admin-user' } }) },
    '@/src/lib/supabase/admin': { createAdminSupabaseClient: () => ({}) },
    '@/src/lib/dancr/admin': { requireAdmin: async () => { if (role !== 'admin') throw new Error('Admin required'); }, resetManagedVenuePageReview: async (...args) => calls.push(['review', ...args.slice(1)]) },
    '@/src/lib/dancr/venue-deal-actions': { removeAdminVenueDeal: async (_, venue, deal) => { calls.push(['remove', venue, deal]); return { id: deal, deals: [] }; } },
    '@/src/lib/dancr/venue-deal-requests': { getAdminVenueClubDealRequests: async () => [] },
  }); return { route, calls };
}
test('direct removal is admin-only and returns the refreshed deal catalog', async () => {
  const request = { json: async () => ({ action: 'remove_contract_deal', venueId: ids.venue, dealId: ids.deal }) };
  for (const role of ['venue', 'customer', 'dancer']) {
    const { route, calls } = adminRoute(role);
    assert.equal((await route.POST(request)).status, 403);
    assert.equal(calls.length, 0);
  }
  const { route, calls } = adminRoute('admin');
  const result = await route.POST(request);
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.clubDeals.length, 0);
  assert.deepEqual(calls[0], ['remove', ids.venue, ids.deal]);
  assert.equal(calls[1][0], 'review');
});
