import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';
import { isLiquorRelatedClubDeal } from '../src/lib/dancr/deal-policy.ts';
import { PublicApiError, resolveApiError } from '../src/lib/api-error-policy.ts';

const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
function load(path, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: name => imports[name] || {}, console });
  return exports;
}
const deals = load('src/lib/dancr/deals.ts', { './deal-policy': { isLiquorRelatedClubDeal } });
const { getVenuePublicationState } = load('src/lib/dancr/venue.ts');
const venueId = 'a1000000-0000-4000-8000-000000000001';
const ownerId = 'a1000000-0000-4000-8000-000000000002';
const dealId = 'a1000000-0000-4000-8000-000000000003';
const offer = (patch = {}) => ({ id: dealId, venue_id: venueId, deal_title: 'Free admission', deal_description: 'General admission', deal_terms: 'House rules apply.',
  is_active: true, offer_type: 'admission', payout_type: 'flat', payout_amount_cents: 0, redemption_rules: { billing_model: 'subscription' }, sort_order: 0, ...patch });
const profile = { id: venueId, ownerUserId: ownerId, name: 'Pilot club', city: 'Las Vegas', state: 'NV', address: '123 Main St', phone: '555-0100',
  opensAt: '00:00:00', closesAt: '00:00:00', logoImageUrl: 'https://example.invalid/logo.jpg', isActive: false, pageReviewStatus: 'admin_draft' };

function dealClient(rows) {
  const queries = [];
  return { queries, from(table) {
    assert.equal(table, 'club_deals', 'Reading offers must not require a subscription or payout record');
    const filters = [], orders = []; let limit = Infinity;
    queries.push({ filters, orders });
    const result = () => ({ data: rows.filter(row => filters.every(([method, key, value]) =>
      method === 'eq' ? row[key] === value : method === 'in' ? value.includes(row[key]) : row[key] > value))
      .sort((a, b) => { for (const [key, ascending] of orders) if (a[key] !== b[key]) return (a[key] < b[key] ? -1 : 1) * (ascending ? 1 : -1); return 0; }).slice(0, limit), error: null });
    const q = { select() { return q; }, eq(key, value) { filters.push(['eq', key, value]); return q; },
      in(key, value) { filters.push(['in', key, value]); return q; }, gt(key, value) { filters.push(['gt', key, value]); return q; },
      order(key, options) { orders.push([key, options.ascending]); return q; }, limit(value) { limit = value; return q; },
      async maybeSingle() { const r = result(); return { ...r, data: r.data[0] || null }; },
      then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
    }; return q;
  } };
}

test('all active offer readers include a zero-payout pilot offer without consulting billing', async () => {
  for (const payout_type of ['flat', 'none']) {
    const client = dealClient([offer({ payout_type }), offer({ id: 'inactive', is_active: false }), offer({ id: 'alcohol', deal_description: 'Free beer' }), offer({ id: 'other-club', venue_id: ownerId })]);
    assert.deepEqual((await deals.getActiveClubDealsForVenue(client, venueId)).map(d => d.id), [dealId]);
    assert.equal((await deals.getActiveClubDealByIdForVenue(client, venueId, dealId)).id, dealId);
    assert.equal((await deals.getActiveClubDealById(client, dealId)).id, dealId);
    assert.equal((await deals.getActiveClubDealListsForVenues(client, [venueId])).get(venueId)[0].id, dealId);
    assert.equal(await deals.getActiveClubDealByIdForVenue(client, ownerId, dealId), null);
    for (const id of ['inactive', 'alcohol', 'missing']) assert.equal(await deals.getActiveClubDealById(client, id), null);
  }
});

function reviewFixture({ offers = [offer()], changes = {} } = {}) {
  const client = dealClient(offers), writes = [], deliveries = [];
  const reviewed = { ...profile, ...changes };
  const reviewClient = { from(table) {
    if (table === 'club_deals') return client.from(table);
    if (table === 'venues') {
      let patch;
      const q = { update(value) { patch = value; return q; }, eq(key, value) { assert.equal(key, 'id'); assert.equal(value, venueId); return q; }, select() { return q; },
        async single() { writes.push({ table, patch }); return { data: { id: venueId, is_active: false, ...patch }, error: null }; } };
      return q;
    }
    assert.ok(['notifications', 'admin_actions'].includes(table), `Unexpected billing or other access: ${table}`);
    return { async insert(value) { writes.push({ table, value }); return { error: null }; } };
  } };
  const admin = load('src/lib/dancr/admin.ts', {
    './deals': deals, './venue': { getVenueById: async () => reviewed, getVenuePublicationState },
    './markets': { findAvailableMyDancrCity: city => city === 'Las Vegas' ? city : null },
    '../api-error-policy': { PublicApiError },
    './notification-delivery': { async deliverNotificationRows(_client, rows) { deliveries.push(...rows); } },
  });
  return { writes, deliveries, send: () => admin.transitionAdminManagedVenuePage(reviewClient, 'synthetic-admin', venueId, 'send_for_review') };
}

test('a complete pilot club with no subscription can be sent for review while remaining private', async () => {
  const f = reviewFixture(); const result = await f.send();
  assert.equal(result.page_review_status, 'venue_review');
  assert.equal(result.is_active, false);
  assert.equal(f.writes.filter(w => w.table === 'venues').length, 1);
  assert.equal(f.writes.filter(w => w.table === 'notifications').length, 1);
  assert.equal(f.writes.find(w => w.table === 'admin_actions').value.action, 'send_venue_page_for_review');
  assert.equal(f.deliveries[0].recipient_id, ownerId);
});

test('incomplete pages report the specific missing requirement without sending review', async () => {
  for (const [options, missing] of [[{ offers: [] }, 'active Club Deal'], [{ changes: { logoImageUrl: null } }, 'Venue logo']]) {
    const f = reviewFixture(options);
    await assert.rejects(f.send(), error => {
      const response = resolveApiError(error, 'Unable to update venue.');
      assert.equal(response.status, 400); assert.match(response.body.error, new RegExp(missing)); return true;
    });
    assert.equal(f.writes.length, 0); assert.equal(f.deliveries.length, 0);
  }
});

test('missing managers and already published pages retain their review restrictions', async () => {
  for (const changes of [{ ownerUserId: null }, { isActive: true }]) {
    const f = reviewFixture({ changes });
    await assert.rejects(f.send(), error => error instanceof PublicApiError && [400, 409].includes(error.status));
    assert.equal(f.writes.length, 0);
  }
});

test('database discovery recognizes pilot offers without creating billing or changing publication', async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create schema auth; create role anon; create role authenticated; create role service_role;
    create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb,banned_until timestamptz);
    create table public.venues(id uuid primary key,slug text,owner_user_id uuid,is_active boolean);
    create table public.club_deals(id uuid primary key,venue_id uuid,is_active boolean,payout_type text,payout_amount_cents integer,offer_type text,deal_title text);`);
  const prior = source('supabase/migrations/20261019212456_spearmint_rhino_demo_roster.sql');
  await db.exec(prior.slice(prior.indexOf('create or replace function public.has_active_club_deal'), prior.indexOf("notify pgrst")));
  await db.query('insert into public.venues values($1,$2,$3,false)', [venueId, 'pilot-club', ownerId]);
  await db.query("insert into public.club_deals values($1,$2,true,'flat',0,'admission','Free admission')", [dealId, venueId]);
  const state = async () => (await db.query('select public.has_active_club_deal(v) eligible,is_active from public.venues v where id=$1', [venueId])).rows[0];
  assert.equal((await state()).eligible, false, 'Reproduce the obsolete payout gate');
  await db.exec(source('supabase/migrations/20261026012943_subscription_club_deal_eligibility.sql'));
  assert.deepEqual(await state(), { eligible: true, is_active: false });
  assert.equal((await db.query('select payout_amount_cents from public.club_deals')).rows[0].payout_amount_cents, 0);
  for (const sql of ["update public.club_deals set is_active=false", "update public.club_deals set is_active=true,offer_type='other'", "update public.club_deals set offer_type='admission',deal_title='Unapproved offer'"]) {
    await db.exec(sql); assert.equal((await state()).eligible, false);
  }
  await db.exec("update public.club_deals set deal_title='Free admission',payout_type='none'");
  assert.equal((await state()).eligible, true);
  await db.exec('delete from public.club_deals');
  assert.equal((await state()).eligible, false);
  await db.query("update public.venues set slug='spearmint-rhino-las-vegas-demo' where id=$1", [venueId]);
  assert.equal((await state()).eligible, false, 'A demo-like slug alone cannot bypass eligibility');
  await db.query("insert into auth.users values($1,'spearmint-rhino-las-vegas-demo@synthetic.mydancr.invalid','{\"dataset_marker\":\"mydancr-spearmint-rhino-las-vegas-demo-v1\"}',now()+interval '1 day')", [ownerId]);
  assert.equal((await state()).eligible, true, 'Preserve the existing marked, banned synthetic demo');
});
