import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/dancr/venue.ts', import.meta.url), 'utf8');
// Exercise the service orchestration with in-memory database doubles, never an application journey.
function fixture({ denied = false, rpcError = null, photoError = null, count = 203 } = {}) {
  const calls = [], filters = [], dancers = Array.from({ length: count }, (_, i) => ({ id: `dancer-${i}`, name: `Dancer ${i}` }));
  const report = { current: { claims: 1, admissions: 1, cohortRedemptions: 1, directions: 2 }, previous: { admissions: 0, directions: 1 }, performance: { dancers } };
  const start = new Date('2026-10-01T07:00Z'), end = new Date('2026-10-08T07:00Z');
  const code = ts.transpileModule(source.slice(source.indexOf('export async function getVenueDashboard('), source.indexOf('export type VenueAnalyticsPeriod')), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  const client = {
    rpc: async (name, args) => { calls.push(['rpc', name, args]); return { data: report, error: rpcError }; },
    from(name) {
      assert.equal(name, 'dancer_profiles'); let ids;
      const query = {
        select(columns) { assert.equal(columns, 'id,avatar_storage_path'); return query; },
        in(key, values) { assert.equal(key, 'id'); ids = values; calls.push(['photos', values]); return query; },
        eq(key, value) { filters.push([key, value]); return query; },
        is(key, value) { filters.push([key, value]); return query; },
        then(resolve) { return Promise.resolve({ error: photoError, data: ids.filter(id => id !== 'dancer-1').map(id => ({ id, avatar_storage_path: id === 'dancer-2' ? 'https://untrusted.test/photo.jpg' : `${id}/approved.jpg` })) }).then(resolve); },
      }; return query;
    },
  };
  vm.runInNewContext(code, { exports, Date,
    requireVenueAccess: async (_client, user, permission) => { calls.push(['authorize', user, permission]); if (denied) throw new Error('Forbidden'); },
    requireVenueForAccount: async () => { calls.push(['profile']); return { id: 'own-venue', timezone: 'America/Los_Angeles' }; },
    venueAnalyticsRange: () => ({ start, end, previousStart: new Date('2026-09-24T07:00Z'), label: 'Last 7 days' }),
    getTonightWindow: () => ({ startsAt: '2026-10-08T07:01Z', endsAt: '2026-10-09T07:01Z' }),
    countByVenue: async () => 0, countByVenueBetween: async () => 0, countVenueEvents: async () => 0,
    countVenueNfcTaps: async () => 0, countUpcomingShifts: async () => 0, countVenueGoingSignals: async () => 0,
    getWorkingDancers: async () => [], getVenueDealsForAccount: async () => ({ deals: [] }),
    dancerPhotoDeliveryUrl: path => `/approved-photo?path=${encodeURIComponent(path)}`,
    conversionPercent: () => 0, percentChange: () => 0, getVenuePublicationState: () => ({}),
  });
  return { run: () => exports.getVenueDashboard(client, 'owner', '7d'), calls, filters };
}

test('performance is read only after venue authorization and uses venue-local tonight boundaries', async () => {
  const f = fixture(); const r = await f.run();
  assert.equal(f.calls[0][0], 'authorize'); assert.equal(f.calls[0][2], 'view_dashboard');
  const rpc = f.calls.find(c => c[0] === 'rpc');
  assert.equal(rpc[1], 'get_venue_performance_analytics'); assert.equal(rpc[2].p_venue_id, 'own-venue');
  assert.equal(rpc[2].p_since, '2026-10-01T07:00:00.000Z'); assert.equal(rpc[2].p_tonight_since, '2026-10-08T07:01Z');
  assert.deepEqual(f.calls.filter(c => c[0] === 'photos').map(c => c[1].length), [200, 3]);
  for (let i = 0; i < 2; i++) assert.deepEqual(f.filters.slice(i * 4, i * 4 + 4), [['status', 'approved'], ['verification_status', 'approved'], ['is_public', true], ['disabled_at', null]]);
  assert.ok(r.analytics.valueReport.performance.dancers[0].photoUrl.startsWith('/approved-photo'));
  assert.equal(r.analytics.valueReport.performance.dancers[1].photoUrl, null);
  assert.equal(r.analytics.valueReport.performance.dancers[2].photoUrl, null);
});

test('denied access never starts analytics or photo reads; data failures are not turned into zero outcomes', async () => {
  const denied = fixture({ denied: true }); await assert.rejects(denied.run(), /Forbidden/);
  assert.equal(denied.calls.length, 1);
  const failed = fixture({ rpcError: new Error('Aggregate unavailable') }); await assert.rejects(failed.run(), /Aggregate unavailable/);
  assert.equal(failed.calls.filter(c => c[0] === 'photos').length, 0);
  await assert.rejects(fixture({ photoError: new Error('Photo read failed') }).run(), /Photo read failed/);
});
