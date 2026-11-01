import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync('app/api/public/discovery/route.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function fixture({ part, venueFailure = false } = {}) {
  const calls = { ranked: 0, lineups: 0, rateLimits: 0, venues: 0, popularity: 0, deals: [] };
  const profile = { id: 'dancer', venueId: 'club', shiftId: 'shift' };
  const deal = { id: 'entry', venueId: 'club' };
  const ranked = { dancers: [profile], tonightDancers: [profile], nextCursor: 'next', statusCounts: { now: 300, not_now: 40 }, cookie: 'visitor=ranked' };
  const query = {};
  for (const name of ['select', 'eq', 'order', 'limit']) query[name] = () => query;
  query.then = (resolve, reject) => (venueFailure ? Promise.reject(new Error('club database unavailable')) : Promise.resolve({ data: [{ id: 'club', name: 'Club', slug: 'club' }] })).then(resolve, reject);
  const deps = {
    'next/server': { NextResponse: { json: (body, options = {}) => ({ body, ...options }) } },
    '@/src/lib/supabase/admin': { createAdminSupabaseClient: () => ({ from: table => { assert.equal(table, 'venues'); calls.venues++; return query; } }) },
    '@/src/lib/security/request-client-address': { requestClientAddress: () => 'test-client' },
    '@/src/lib/dancr/public-club-lineups': { getPublicClubLineups: async (_client, city, ids) => { calls.lineups++; assert.equal(city, 'Las Vegas'); assert.deepEqual([...ids], ['club']); return { dancers: [profile], tonightDancers: [profile], statusCounts: { now: 31, not_now: 10, nowByVenue: { club: 31 } } }; } },
    '@/src/lib/dancr/public-directory': { getRankedDirectoryPage: async () => { calls.ranked++; return ranked; } },
    '@/src/lib/dancr/discovery-pagination': { parseDiscoveryCursor: () => '', directoryFilter: () => 'now', directoryVenue: () => undefined },
    '@/src/lib/dancr/markets': { findAvailableMyDancrCity: () => 'Las Vegas', isAllMyDancrCities: () => false },
    '@/src/lib/dancr/deals': { getActiveClubDealListsForVenues: async (_client, ids) => { calls.deals.push([...ids]); return new Map([['club', [deal]]]); } },
    '@/src/lib/dancr/public-club-deal': { toPublicClubDeal: value => value },
    '@/src/lib/dancr/deal-attribution': { createDancerDealAttributionToken: value => `signed:${value.dancerId}:${value.dealId}` },
    '@/src/lib/dancr/public': { formatVenueHours: () => '', getPublicVenuePopularity: async () => { calls.popularity++; return new Map(); } },
    '@/src/lib/dancr/public-cache-policy': { PRIVATE_NO_STORE_CACHE_CONTROL: 'private, no-store', PUBLIC_DYNAMIC_CACHE_CONTROL: 'private, no-store' },
    '@/src/lib/dancr/responsive-image': { responsivePublicImage: () => null },
    '@/src/lib/dancr/venue-branding': { verifiedVenueLogoUrl: () => null },
    '@/src/lib/security/safe-error-metadata': { safeErrorMetadata: () => ({}) },
    '@/src/lib/api-error-policy': { PublicApiError: class extends Error {} },
    '@/src/lib/dancr/public-request-rate-limit': { PublicRequestRateLimitError: class extends Error {}, enforcePublicRequestRateLimit: async () => { calls.rateLimits++; } },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, URL, console: { error() {} }, require: name => { assert.ok(deps[name], name); return deps[name]; } });
  return { calls, run: () => exports.GET(new Request(`https://example.invalid/api/public/discovery?city=Las+Vegas${part ? `&part=${part}` : ''}`)) };
}

test('dancer batches skip city-wide club queries while retaining current ranking, totals and signed deals', async () => {
  const { calls, run } = fixture({ part: 'dancers', venueFailure: true });
  const result = await run();
  assert.equal(result.body.ok, true);
  assert.equal(calls.ranked, 1); assert.equal(calls.venues, 0); assert.equal(calls.popularity, 0);
  assert.deepEqual(calls.deals, [['club']]);
  assert.equal(result.body.dancers[0].dealAttributionToken, 'signed:dancer:entry');
  assert.equal(result.body.tonightDancers[0].activeDeal.id, 'entry');
  assert.equal(result.body.statusCounts.now, 300); assert.equal(result.body.nextCursor, 'next');
  assert.equal(result.body.venues, undefined);
  assert.equal(result.headers['cache-control'], 'private, no-store');
  assert.equal(result.headers['set-cookie'], 'visitor=ranked');
});

test('independent club metadata does not rerank dancers or replace their visitor cookie', async () => {
  const { calls, run } = fixture({ part: 'venues' }); const result = await run();
  assert.equal(calls.ranked, 0); assert.equal(calls.venues, 1); assert.equal(calls.popularity, 1);
  assert.equal(result.body.venues[0].activeDeal.id, 'entry');
  assert.equal(result.body.dancers, undefined); assert.equal(result.headers['set-cookie'], undefined);
});

test('legacy callers still receive the combined response and invalid response parts do no database work', async () => {
  const combined = fixture(); const result = await combined.run();
  assert.equal(result.body.dancers.length, 1); assert.equal(result.body.venues.length, 1);
  const invalid = fixture({ part: 'invalid' }); assert.equal((await invalid.run()).status, 400);
  assert.equal(invalid.calls.ranked + invalid.calls.venues, 0);
});

test('club directory returns direct lineups and full counts without a city-wide ranked page', async () => {
  const { calls, run } = fixture({ part: 'clubs' }); const result = await run();
  assert.equal(calls.ranked, 0); assert.equal(calls.lineups, 1); assert.equal(calls.rateLimits, 1);
  assert.equal(result.body.venues[0].workingNowCount, 31);
  assert.equal(result.body.dancers.length, 1); assert.equal(result.body.nextCursor, null);
  assert.equal(result.body.dancers[0].dealAttributionToken, 'signed:dancer:entry');
  assert.equal(result.body.statusCounts.nowByVenue.club, 31);
  assert.equal(result.headers['cache-control'], 'private, no-store');
});
