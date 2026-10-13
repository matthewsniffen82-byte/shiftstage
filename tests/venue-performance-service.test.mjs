import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/dancr/venue.ts', import.meta.url), 'utf8');
// Exercise the service orchestration with in-memory database doubles, never an application journey.
function fixture({ denied = false, rpcError = null, photoError = null, primaryError = null, count = 203 } = {}) {
  const calls = [], filters = [], dancers = Array.from({ length: count }, (_, i) => ({ id: `dancer-${i}`, name: `Dancer ${i}` }));
  const report = { current: { claims: 1, admissions: 1, cohortRedemptions: 1, directions: 2 }, previous: { admissions: 0, directions: 1 }, performance: { dancers } };
  const code = ts.transpileModule(source.slice(source.indexOf('export async function getVenueDashboard('), source.indexOf('const VENUE_OWNER_COLUMNS'))
    + source.slice(source.indexOf('function venueAnalyticsRange('), source.indexOf('function percentChange(')), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  const client = {
    rpc: async (name, args) => { calls.push(['rpc', name, args]); return { data: name === 'get_venue_hair_color_analytics' ? { trackingStartedAt: '2026-10-12', internal: [], external: [] } : report, error: rpcError }; },
    from(name) {
      assert.ok(['dancer_profiles', 'dancer_photos'].includes(name)); let ids;
      const primary = name === 'dancer_photos';
      const query = {
        select(columns) { assert.equal(columns, primary ? 'dancer_id,storage_path' : 'id,avatar_storage_path'); return query; },
        in(key, values) { assert.equal(key, primary ? 'dancer_id' : 'id'); ids = values; calls.push([primary ? 'primary' : 'photos', values]); return query; },
        eq(key, value) { filters.push([key, value]); return query; },
        is(key, value) { filters.push([key, value]); return query; },
        then(resolve) { return Promise.resolve(primary
          ? { error: primaryError, data: ids.filter(id => !['dancer-2', 'dancer-3'].includes(id)).map(id => ({ dancer_id: id, storage_path: `${id}/main.jpg` })) }
          : { error: photoError, data: ids.filter(id => id !== 'dancer-1').map(id => ({ id, avatar_storage_path: id === 'dancer-2' ? 'https://untrusted.test/photo.jpg' : `${id}/approved.jpg` })) }).then(resolve); },
      }; return query;
    },
  };
  vm.runInNewContext(code, { exports, Date: class extends Date { constructor(value = '2026-10-08T07:00:00.000Z') { super(value); } },
    requireVenueAccess: async (_client, user, permission) => { calls.push(['authorize', user, permission]); if (denied) throw new Error('Forbidden'); },
    requireVenueForAccount: async () => { calls.push(['profile']); return { id: 'own-venue', timezone: 'America/Los_Angeles' }; },
    getTonightWindow: () => ({ startsAt: '2026-10-07T19:00Z', endsAt: '2026-10-08T19:00Z' }),
    countByVenue: async () => 0, countByVenueBetween: async () => 0, countVenueEvents: async () => 0,
    countVenueNfcTaps: async () => 0, countUpcomingShifts: async () => 0, countVenueGoingSignals: async () => 0,
    getWorkingDancers: async () => [], getVenueDealsForAccount: async () => ({ deals: [] }),
    responsivePublicImage: (_client, bucket, path) => { assert.equal(bucket, 'dancer-photos'); return !path || /^https?:/.test(path) ? null : { imageUrl: `/approved-photo?path=${encodeURIComponent(path)}`, imageSrcSet: `/approved-photo?path=${encodeURIComponent(path)} 480w` }; },
    conversionPercent: () => 0, percentChange: () => 0, getVenuePublicationState: () => ({}),
  });
  return { run: (period = '7d') => exports.getVenueDashboard(client, 'owner', period), readPeriod: exports.readVenueAnalyticsPeriod, calls, filters };
}

test('performance is read only after venue authorization and uses venue-local tonight boundaries', async () => {
  const f = fixture(); const r = await f.run();
  assert.equal(f.calls[0][0], 'authorize'); assert.equal(f.calls[0][2], 'view_dashboard');
  const rpc = f.calls.find(c => c[0] === 'rpc');
  assert.equal(rpc[1], 'get_venue_performance_analytics'); assert.equal(rpc[2].p_venue_id, 'own-venue');
  assert.equal(rpc[2].p_since, '2026-10-01T07:00:00.000Z'); assert.equal(rpc[2].p_tonight_since, '2026-10-07T19:00Z');
  const hair = f.calls.find(c => c[1] === 'get_venue_hair_color_analytics');
  assert.equal(hair[2].p_venue_id, 'own-venue'); assert.equal(hair[2].p_since, rpc[2].p_since);
  assert.equal(r.analytics.valueReport.hairColor.trackingStartedAt, '2026-10-12');
  assert.deepEqual(f.calls.filter(c => c[0] === 'photos').map(c => c[1].length), [200, 3]);
  for (let i = 0; i < 2; i++) assert.deepEqual(f.filters.slice(i * 6, i * 6 + 6), [['status', 'approved'], ['verification_status', 'approved'], ['is_public', true], ['disabled_at', null], ['is_primary', true], ['review_status', 'approved']]);
  assert.deepEqual(f.calls.filter(c => c[0] === 'primary').map(c => c[1].length), [199, 3]);
  assert.ok(f.calls.filter(c => c[0] === 'primary').every(c => !c[1].includes('dancer-1')));
  assert.equal(r.analytics.valueReport.performance.dancers[0].photoUrl, '/approved-photo?path=dancer-0%2Fmain.jpg');
  assert.equal(r.analytics.valueReport.performance.dancers[0].photoSrcSet, '/approved-photo?path=dancer-0%2Fmain.jpg 480w');
  assert.equal(r.analytics.valueReport.performance.dancers[1].photoUrl, null);
  assert.equal(r.analytics.valueReport.performance.dancers[2].photoUrl, null);
  assert.equal(r.analytics.valueReport.performance.dancers[3].photoUrl, '/approved-photo?path=dancer-3%2Fapproved.jpg');
});

test('Tonight, 7 days, 30 days and All time use identical boundaries across every reporting section', async () => {
  for (const [period, since, label] of [
    ['tonight', '2026-10-07T19:00:00.000Z', 'Tonight'],
    ['7d', '2026-10-01T07:00:00.000Z', 'Last 7 days'],
    ['30d', '2026-09-08T07:00:00.000Z', 'Last 30 days'],
    ['all', '1970-01-01T00:00:00.000Z', 'All time'],
  ]) {
    const f = fixture({ count: 0 }); const { analytics } = await f.run(period);
    assert.equal(f.readPeriod(period), period);
    assert.equal(analytics.period, period); assert.equal(analytics.periodLabel, label);
    assert.equal(analytics.periodStart, since);
    for (const call of f.calls.filter(call => call[0] === 'rpc')) {
      assert.equal(call[2].p_since, since); assert.equal(call[2].p_until, '2026-10-08T07:00:00.000Z');
    }
    if (period === 'all') for (const key of ['pageViewsChangePercent', 'directionsChangePercent', 'redemptionsChangePercent']) assert.equal(analytics[key], null);
  }
  for (const invalid of [null, undefined, '', 'forever', '365d']) assert.equal(fixture().readPeriod(invalid), '30d');
});

test('denied access never starts analytics or photo reads; data failures are not turned into zero outcomes', async () => {
  const denied = fixture({ denied: true }); await assert.rejects(denied.run(), /Forbidden/);
  assert.equal(denied.calls.length, 1);
  const failed = fixture({ rpcError: new Error('Aggregate unavailable') }); await assert.rejects(failed.run(), /Aggregate unavailable/);
  assert.equal(failed.calls.filter(c => c[0] === 'photos').length, 0);
  await assert.rejects(fixture({ photoError: new Error('Photo read failed') }).run(), /Photo read failed/);
  await assert.rejects(fixture({ primaryError: new Error('Main photo read failed') }).run(), /Main photo read failed/);
});
