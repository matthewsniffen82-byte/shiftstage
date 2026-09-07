import assert from 'node:assert/strict';
import test from 'node:test';
import { countSavedVenueDancers, getSavedVenueActivity } from '../src/lib/dancr/customer-venue-activity.ts';

const now = new Date('2026-09-07T20:00:00Z');
const approved = { status: 'approved', verification_status: 'approved', is_public: true, disabled_at: null };
const shift = (id, extra = {}) => ({ id, dancer_id: id, venue_id: 'echo', status: 'posted', shift_source: 'scheduled', ends_at: '2026-09-08T06:00:00Z', dancer_profiles: approved, ...extra });
const checkedIn = { shift_source: 'nfc_checkin', checked_in_at: '2026-09-07T19:00:00Z', location_status: 'club_confirmed', location_verification_expires_at: '2026-09-08T01:00:00Z' };

test('club activity counts distinct dancers and keeps working dancers out of the upcoming total', () => {
  const counts = countSavedVenueDancers(['echo', 'neon'], [
    shift('star', checkedIn), shift('star', checkedIn), shift('star'),
    shift('ivy'), shift('ivy'), shift('bella'), shift('star', { venue_id: 'neon' }),
  ], now.getTime());
  assert.deepEqual(counts.get('echo'), { workingNowCount: 1, upcomingDancerCount: 2 });
  assert.deepEqual(counts.get('neon'), { workingNowCount: 0, upcomingDancerCount: 1 });
});

test('expired check-ins, ended dates, cancelled shifts, and nonpublic dancers do not inflate counts', () => {
  const excluded = [
    shift('expired-tap', { ...checkedIn, location_verification_expires_at: now.toISOString() }),
    shift('ended', { ends_at: '2026-09-06T06:00:00Z' }),
    shift('cancelled', { ...checkedIn, status: 'cancelled' }),
    shift('checked-out', { ...checkedIn, checked_out_at: now.toISOString() }),
    shift('private', { dancer_profiles: { ...approved, is_public: false } }),
    shift('disabled', { dancer_profiles: { ...approved, disabled_at: now.toISOString() } }),
    shift('draft', { dancer_profiles: { ...approved, status: 'draft' } }),
    shift('unverified', { dancer_profiles: { ...approved, verification_status: 'pending' } }),
    shift('missing-profile', { dancer_profiles: null }),
    shift('unknown-date', { ends_at: 'invalid' }),
    shift('other-club', { venue_id: 'elsewhere' }),
  ];
  assert.deepEqual(countSavedVenueDancers(['echo'], excluded, now.getTime()).get('echo'), { workingNowCount: 0, upcomingDancerCount: 0 });
});

test('Now follows the verified check-in window, including demo presence, rather than a nominal scheduled end', () => {
  const counts = countSavedVenueDancers(['echo'], [shift('demo', { ...checkedIn, shift_source: 'demo_locked', ends_at: '2026-09-07T18:00:00Z' })], now.getTime());
  assert.deepEqual(counts.get('echo'), { workingNowCount: 1, upcomingDancerCount: 0 });
});

function clientFixture(pages) {
  const calls = [];
  const client = { from(table) {
    const call = { table, filters: [], range: [] };
    calls.push(call);
    const query = {};
    for (const method of ['select', 'in', 'eq', 'is', 'or', 'order']) query[method] = (...args) => { call.filters.push([method, ...args]); return query; };
    query.range = (...range) => { call.range = range; return query; };
    query.abortSignal = signal => {
      call.signal = signal;
      const page = pages[calls.length - 1];
      return typeof page === 'function' ? page(signal) : Promise.resolve(page);
    };
    return query;
  } };
  return { client, calls };
}

test('activity reads are scoped to saved clubs and public profiles, and paginate before counting', async () => {
  const first = Array.from({ length: 500 }, (_, id) => shift(`dancer-${id}`));
  const { client, calls } = clientFixture([{ data: first, error: null }, { data: [shift('dancer-0', checkedIn)], error: null }]);
  const counts = await getSavedVenueActivity(client, ['echo'], now);
  assert.deepEqual(counts.get('echo'), { workingNowCount: 1, upcomingDancerCount: 499 });
  assert.deepEqual(calls.map(call => call.range), [[0, 499], [500, 999]]);
  for (const call of calls) {
    assert.equal(call.table, 'shifts');
    assert.ok(call.filters.some(filter => JSON.stringify(filter) === JSON.stringify(['in', 'venue_id', ['echo']])));
    for (const key of ['dancer_profiles.status', 'dancer_profiles.verification_status', 'dancer_profiles.is_public']) assert.ok(call.filters.some(filter => filter[0] === 'eq' && filter[1] === key));
    assert.ok(call.filters.some(filter => filter[0] === 'is' && filter[1] === 'dancer_profiles.disabled_at'));
  }
});

test('an unavailable count does not become zero or expose a partial result', async t => {
  t.mock.method(console, 'warn', () => {});
  const { client } = clientFixture([{ data: Array.from({ length: 500 }, (_, id) => shift(String(id))), error: null }, { data: null, error: { code: '503' } }]);
  const counts = await getSavedVenueActivity(client, ['echo'], now);
  assert.equal(counts.has('echo'), false);
});

test('optional counts stop waiting after four seconds instead of blocking the saved dashboard', async t => {
  t.mock.method(console, 'warn', () => {});
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { client, calls } = clientFixture([signal => new Promise(resolve => signal.addEventListener('abort', () => resolve({ error: { code: 'aborted' } }))) ]);
  const pending = getSavedVenueActivity(client, ['echo'], now);
  t.mock.timers.tick(4000);
  assert.equal((await pending).size, 0);
  assert.equal(calls[0].signal.aborted, true);
});

test('an empty favorites list needs no activity request, while a successful empty result is a real zero', async () => {
  const { client, calls } = clientFixture([{ data: [], error: null }]);
  assert.equal((await getSavedVenueActivity(client, [], now)).size, 0);
  assert.equal(calls.length, 0);
  assert.deepEqual((await getSavedVenueActivity(client, ['echo'], now)).get('echo'), { workingNowCount: 0, upcomingDancerCount: 0 });
});
