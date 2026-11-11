import assert from 'node:assert/strict';
import test from 'node:test';
import { scoreVenueDancers, sortScoredDancers, DANCER_SCORE_CATEGORIES, DANCER_SCORE_WEIGHTS, DANCER_SCORE_MINIMUMS } from '../src/lib/dancr/venue-dancer-scores.ts';

const dancer = id => ({ id, name: id, media: { videos: 0, photos: 0 },
  internal: { checkedInHours: 8, requests: 20, completed: 8, requestsDuringHours: 20,
    rosterTrackedHours: 8, rosterExternalHours: 8, rosterExternalTrackedHours: 8, rosterBothHours: 0, verifiedCheckInDays: 4, checkoutEligibleDays: 4, dancerCheckoutDays: 4, activeCheckInDays: 0 },
  vip: { requests: 25, scoringRequests: 20, scoringUniqueRequesters: 10, scoringRepeatRequesters: 2 },
  external: { dancer_profile: 10, club_page: 10, directions: 10, going: 10, free_entry: 10, transport: 10 },
  results: { checkIns: 2, checkOuts: 1, tableArrived: 8, tableNoShows: 0, tableAttendanceUnrecorded: 2,
    profileClaims: 20, profileCohortConversions: 10, profileConversions: 15 },
});
const peers = () => [dancer('a'), dancer('b'), dancer('c')];
const score = (row, period = '30d') => scoreVenueDancers([row, dancer('b'), dancer('c')], period)[0];

test('eight independent categories use the private score weights', () => {
  for (const row of scoreVenueDancers(peers(), '30d')) {
    assert.deepEqual(Object.keys(row.scores), ['overall', ...DANCER_SCORE_CATEGORIES]);
    assert.deepEqual(Object.fromEntries(Object.entries(row.scores).map(([k, s]) => [k, s.value])),
      { overall: 45, videos: 0, photos: 0, externalTime: 67, checkIns: 75, internal: 50, vip: 44, profile: 50, conversions: 50 });
    assert.equal(row.scores.overall.value, Math.round(DANCER_SCORE_CATEGORIES.reduce((n, k) => n + row.scores[k].value * DANCER_SCORE_WEIGHTS[k], 0) / 100));
    assert.equal(row.rank, 1); assert.equal(row.rankedCount, 3);
  }
});

test('raw event totals and staff request actions cannot replace paired dancer checkout records', () => {
  const row = dancer('a'); const before = score(row).scores;
  Object.assign(row.internal, { completed: 100, acknowledged: 100, cancelled: 100, responseMinutes: 0 });
  Object.assign(row.vip, { confirmed: 100, declined: 100, cancelled: 100 });
  Object.assign(row.results, { checkIns: 100, checkOuts: 100, tableArrived: 100, tableNoShows: 100,
    showUpPercent: 0, lastCheckInAt: null, lastCheckOutAt: null });
  assert.deepEqual(score(row).scores, before);
});

test('roster accuracy gets half the points, while days and hours contribute a quarter each', () => {
  const row=dancer('a');
  assert.equal(score(row).scores.checkIns.value,75);
  row.internal.dancerCheckoutDays=2; assert.equal(score(row).scores.checkIns.value,50);
  row.internal.dancerCheckoutDays=0; assert.equal(score(row).scores.checkIns.value,25);
  row.internal.dancerCheckoutDays=4; row.internal.verifiedCheckInDays=8;
  assert.equal(score(row).scores.checkIns.value,79);
  row.internal.rosterTrackedHours=16; assert.equal(score(row).scores.checkIns.value,83);
});

test('active first visits show provisional activity and accuracy needs three ended days', () => {
  const row=dancer('a'); Object.assign(row.internal,{checkoutEligibleDays:0,dancerCheckoutDays:0,activeCheckInDays:1});
  let result=score(row); assert.equal(result.scores.checkIns.value,50); assert.equal(result.scores.checkIns.confidence,'early'); assert.equal(result.rank,null);
  assert.match(result.scores.checkIns.evidence,/Checkout accuracy pending/);
  Object.assign(row.internal,{checkoutEligibleDays:2,dancerCheckoutDays:2}); assert.equal(score(row).scores.checkIns.confidence,'early');
  Object.assign(row.internal,{checkoutEligibleDays:3,dancerCheckoutDays:3}); assert.equal(score(row).scores.checkIns.confidence,'established');
});

test('External-only and Both have the largest weight and equal time produces equal ranking scores', () => {
  const rows = peers();
  rows[0].internal.rosterExternalHours = 0;
  rows[2].internal.rosterBothHours = 8;
  const result = scoreVenueDancers(rows, '14d');
  assert.deepEqual(result.map(row => row.scores.externalTime.value), [0, 67, 67]);
  assert.deepEqual(result.map(row => row.scores.overall.value), [24, 45, 45]);
  assert.deepEqual(result.map(row => row.rank), [3, 1, 1]);
  assert.equal(DANCER_SCORE_WEIGHTS.externalTime, 30);
  assert.equal(Object.values(DANCER_SCORE_WEIGHTS).reduce((sum, value) => sum + value, 0), 100);
  assert.ok(DANCER_SCORE_CATEGORIES.filter(key => key !== 'externalTime').every(key => DANCER_SCORE_WEIGHTS[key] < DANCER_SCORE_WEIGHTS.externalTime));
  assert.deepEqual(result.map(row => row.scores.checkIns.value), [75, 75, 75], 'no extra mode bonus stacks on attendance');
  rows[1].internal.rosterExternalHours = 4;
  assert.equal(scoreVenueDancers(rows, '14d')[1].scores.externalTime.value, 50);
  rows[1].internal.dancerCheckoutDays = 0;
  const noCheckout = scoreVenueDancers(rows, '14d')[1];
  assert.equal(noCheckout.scores.externalTime.value, 50);
  assert.equal(noCheckout.scores.checkIns.value, 25, 'external time supplies no checkout credit');
});

test('more external hours raise the time score while Internal-only hours do not', () => {
  const row = dancer('a');
  assert.equal(score(row).scores.externalTime.value, 67);
  row.internal.rosterTrackedHours = 16;
  assert.equal(score(row).scores.externalTime.value, 67);
  row.internal.rosterExternalHours = 16; row.internal.rosterExternalTrackedHours = 16;
  assert.equal(score(row).scores.externalTime.value, 80);
  row.internal.rosterTrackedHours = 800;
  row.internal.rosterExternalHours = 800; row.internal.rosterExternalTrackedHours = 800;
  assert.equal(score(row).scores.externalTime.value, 100);
  Object.assign(row.internal, { rosterTrackedHours: 4, rosterExternalHours: 4, rosterExternalTrackedHours: 4 });
  assert.equal(score(row).scores.externalTime.confidence, 'early');
});

test('unknown and invalid External history stays unscored without affecting attendance', () => {
  for (const invalid of [undefined, null, NaN, Infinity, -1, 8.01]) {
    const row = dancer('a'); row.internal.rosterExternalHours = invalid;
    assert.equal(score(row).scores.externalTime.value, null);
    assert.equal(score(row).scores.checkIns.value, 75);
  }
  const row = dancer('a');
  Object.assign(row.internal, { rosterExternalHours: 2, rosterBothHours: 4 });
  assert.equal(score(row).scores.externalTime.value, null);
  delete row.internal.rosterBothHours;
  row.internal.rosterExternalHours = 8;
  assert.equal(score(row).scores.externalTime.value, 67);
});

test('recorded zero external time scores zero even when the entire club has zero hours', () => {
  const rows = peers(); rows.forEach(row => row.internal.rosterExternalHours = 0);
  for (const result of scoreVenueDancers(rows, '14d')) {
    assert.equal(result.scores.externalTime.value, 0);
  }
});

test('external scoring requires verified mode history and never converts unknown hours into zero', () => {
  for (const invalid of [undefined, null, NaN, Infinity, -1, 0, 8.01]) {
    const row = dancer('a');
    row.internal.rosterExternalTrackedHours = invalid;
    row.internal.rosterExternalHours = 0;
    assert.equal(score(row).scores.externalTime.value, null);
    assert.equal(score(row).scores.checkIns.value, 75);
  }
  const row = dancer('a'); row.internal.rosterExternalTrackedHours = 4;
  assert.equal(score(row).scores.externalTime.value, null, 'external hours cannot exceed observed hours');
  row.internal.rosterExternalHours = 0;
  assert.equal(score(row).scores.externalTime.value, 0);
  assert.equal(score(row).scores.externalTime.confidence, 'early');
});

test('legacy hours and inconsistent paired counts never invent roster accuracy or suppress table scoring', () => {
  const row=dancer('a'); delete row.internal.verifiedCheckInDays;
  assert.equal(score(row).scores.checkIns.value,null); assert.equal(score(row).scores.internal.value,50);
  for(const invalid of [-1,null,undefined,NaN,Infinity,1.5,Number.MAX_VALUE]) {
    const row=dancer('a'); row.internal.checkoutEligibleDays=invalid; assert.equal(score(row).scores.checkIns.value,null);
  }
  const bad=dancer('a'); bad.internal.dancerCheckoutDays=5; assert.equal(score(bad).scores.checkIns.value,null);
});

test('table demand depends on requests per recorded hour, not raw shift length', () => {
  const base = dancer('a'), doubled = dancer('a');
  doubled.internal.checkedInHours *= 2; doubled.internal.requests *= 2; doubled.internal.requestsDuringHours *= 2;
  assert.equal(score(base).scores.internal.value, score(doubled).scores.internal.value);
  const moreDemand = dancer('a'); moreDemand.internal.requests = 40; moreDemand.internal.requestsDuringHours = 40;
  assert.ok(score(moreDemand).scores.internal.value > score(base).scores.internal.value);
});

test('VIP demand uses withdrawal-aware selections and a small returning-customer share', () => {
  const base = dancer('a'), more = dancer('a');
  more.vip.scoringRequests = 40;
  assert.ok(score(more).scores.vip.value > score(base).scores.vip.value);
  more.vip.scoringRepeatRequesters = 10;
  assert.ok(score(more).scores.vip.value > score(base).scores.vip.value);
  const legacy = dancer('a'); legacy.vip = { requests: 500, repeatRequesters: 20 };
  assert.equal(score(legacy).scores.vip.value, null, 'legacy counts must not guess customer withdrawals');
});

test('profile interest and entry conversion are independent; extra views never lower either', () => {
  const base = dancer('a'), more = dancer('a');
  more.external.dancer_profile += 100;
  assert.ok(score(more).scores.profile.value > score(base).scores.profile.value);
  assert.equal(score(more).scores.conversions.value, score(base).scores.conversions.value);
  more.results.profileCohortConversions = 20;
  assert.equal(score(more).scores.conversions.value, 100);
  assert.equal(score(more).scores.profile.value, score({ ...more, results: base.results }).scores.profile.value);
  more.results.profileConversions = 999; // Entry-date count can include claims from a prior period.
  assert.equal(score(more).scores.conversions.value, 100);
});

test('only recorded attributed interest signals count, not appearance or unrelated impressions', () => {
  const base = dancer('a'), more = dancer('a');
  Object.assign(more.external, { impressions: 9999, admissions: 9999, claims: 9999, unfollow: 9999, share: 9999 });
  assert.deepEqual(score(more).scores, score(base).scores);
  more.external.follow = 10; more.external.share_completed = 10;
  assert.ok(score(more).scores.profile.value > score(base).scores.profile.value);
});

test('a recorded zero conversion is zero, while missing tracking remains unscored', () => {
  const zero = dancer('a'); zero.results.profileCohortConversions = 0;
  assert.equal(score(zero).scores.conversions.value, 0);
  const missing = dancer('a'); missing.results = undefined;
  assert.equal(score(missing).scores.conversions.value, null);
  assert.equal(sortScoredDancers([score(missing), score(zero)], 'conversions')[0].scores.conversions.value, 0);
  assert.deepEqual(scoreVenueDancers([], 'all'), []);
});

test('partial overall rescales available weights and shows coverage without awarding rank', () => {
  const row = dancer('a'); row.vip = {};
  const result = score(row);
  const keys = DANCER_SCORE_CATEGORIES.filter(k => k !== 'vip');
  const expected = Math.round(keys.reduce((sum, k) => sum + result.scores[k].value * DANCER_SCORE_WEIGHTS[k], 0) * 75 / 6500);
  assert.equal(result.scores.overall.value, expected);
  assert.equal(result.scores.overall.confidence, 'early'); assert.equal(result.rank, null);
  row.internal = {}; row.results = undefined;
  assert.equal(score(row).scores.overall.value, null);
});

test('period minimums and early-data labels prevent tiny samples from being ranked', () => {
  for (const period of ['tonight', '7d', '14d', '30d', 'all']) {
    const min = DANCER_SCORE_MINIMUMS[period];
    const rows = peers().map(row => ({ ...row,
      internal: { ...row.internal, checkedInHours: min.hours, rosterTrackedHours: min.hours, rosterExternalHours: min.hours, rosterExternalTrackedHours: min.hours, requests: min.requests, requestsDuringHours: min.requests },
      vip: { scoringRequests: min.requests, scoringUniqueRequesters: 1, scoringRepeatRequesters: 0 },
      external: { dancer_profile: min.actions },
      results: { ...row.results, profileClaims: min.claims, profileCohortConversions: min.claims },
    }));
    const result = scoreVenueDancers(rows, period)[0];
    assert.ok(Object.values(result.scores).every(s => s.value !== null));
    assert.equal(result.scores.overall.confidence, 'early'); assert.equal(result.rank, null);
    rows[0].internal.rosterTrackedHours -= 0.01;
    assert.equal(scoreVenueDancers(rows, period)[0].scores.checkIns.value, null);
  }
});

test('relative scores need peers; external time and entry conversion do not invent a comparison', () => {
  const rows = scoreVenueDancers(peers().slice(0, 2), 'all');
  assert.ok(rows.every(row => row.scores.conversions.value === 50 && row.scores.externalTime.value === 67 && row.scores.overall.value === 25 && row.rank === null));
  for (const row of rows) for (const key of ['checkIns', 'internal', 'vip', 'profile']) assert.equal(row.scores[key].value, null);
});

test('ties share competition rank, early dancers stay outside ranking, and sorting is immutable', () => {
  const low = dancer('c'); low.results.profileCohortConversions = 0;
  const early = dancer('d'); early.results.profileClaims = 10; early.results.profileCohortConversions = 10;
  const input = [dancer('b'), low, dancer('a'), early], original = structuredClone(input);
  const rows = scoreVenueDancers(input, 'all');
  assert.deepEqual(rows.map(row => row.rank), [1, 3, 1, null]);
  assert.ok(rows.every(row => row.rankedCount === 3));
  const before = structuredClone(rows);
  sortScoredDancers(rows, 'name'); sortScoredDancers(rows, 'conversions');
  assert.deepEqual(rows, before); assert.deepEqual(input, original);
});

test('missing, malformed and extreme data cannot produce nonfinite or out-of-range scores', () => {
  for (const invalid of [null, undefined, NaN, Infinity, -1]) {
    const row = dancer('a'); row.internal.rosterTrackedHours = invalid; row.results.profileClaims = invalid;
    assert.equal(score(row).scores.checkIns.value, null); assert.equal(score(row).scores.conversions.value, null);
  }
  const bad = dancer('a'); bad.internal.requestsDuringHours = 999; bad.vip.scoringRepeatRequesters = 999;
  bad.results.profileCohortConversions = 999; bad.external.follow = NaN;
  const result = score(bad);
  for (const key of ['internal', 'vip', 'profile', 'conversions']) assert.equal(result.scores[key].value, null);
  const huge = dancer('a'); huge.external.directions = Number.MAX_VALUE; huge.internal.checkedInHours = Number.MAX_VALUE;
  for (const s of Object.values(score(huge).scores)) assert.ok(s.value === null || Number.isInteger(s.value) && s.value >= 0 && s.value <= 100);
});

const newcomer = (hours, both = false) => ({ id: 'new', name: 'New dancer', internal: {
  rosterTrackedHours: hours, rosterExternalTrackedHours: hours, rosterExternalHours: hours,
  rosterBothHours: both ? hours : 0, verifiedCheckInDays: 1,
}, vip: {}, external: {}, results: {} });

test('five recorded minutes start modest placement points without peers, requests or followers', () => {
  for (const period of ['tonight', '7d', '14d', '30d', 'all']) {
    const before = scoreVenueDancers([newcomer(299 / 3600)], period)[0];
    assert.equal(before.scores.externalTime.value, 0);
    assert.equal(before.scores.overall.value, null);
    const after = scoreVenueDancers([newcomer(5 / 60)], period)[0];
    assert.equal(after.scores.externalTime.value, 2);
    assert.equal(after.scores.overall.value, 1);
    assert.equal(after.scores.overall.confidence, 'early');
    assert.equal(after.rank, null);
    for (const key of DANCER_SCORE_CATEGORIES.filter(key => key !== 'externalTime')) assert.equal(after.scores[key].value, null);
  }
});

test('early external points grow with recorded time, Both earns equally, and time alone stays bounded at 30', () => {
  let previous = 0;
  for (const hours of [5 / 60, 0.25, 0.5, 1, 4, 8, 800]) {
    const external = scoreVenueDancers([newcomer(hours)], '14d')[0];
    const both = scoreVenueDancers([newcomer(hours, true)], '14d')[0];
    assert.equal(external.scores.overall.value, both.scores.overall.value);
    assert.ok(external.scores.overall.value > previous);
    assert.ok(external.scores.overall.value <= 30);
    previous = external.scores.overall.value;
    const repeated = newcomer(hours); repeated.results.checkIns = 100;
    assert.deepEqual(scoreVenueDancers([repeated], '14d')[0].scores, external.scores);
  }
  const row = newcomer(8); row.internal.rosterExternalHours = 4 / 60;
  assert.equal(scoreVenueDancers([row], '14d')[0].scores.overall.value, null, 'internal hours never substitute for external minutes');
  delete row.internal.verifiedCheckInDays;
  assert.equal(scoreVenueDancers([row], '14d')[0].scores.externalTime.value, null);
});

test('crossing five external minutes never lowers an otherwise available score', () => {
  const row = dancer('a'); row.internal.rosterExternalHours = 299 / 3600;
  const before = score(row).scores.overall.value;
  row.internal.rosterExternalHours = 5 / 60;
  assert.ok(score(row).scores.overall.value > before);
});

test('media earns four points per TV video and one per photo, capped independently at five', () => {
  for (const make of [() => newcomer(0), () => dancer('a'), () => ({ ...dancer('a'), vip: {} })]) {
    const row = make(); row.media = { videos: 0, photos: 0 };
    const base = score(row, '7d').scores.overall.value ?? 0;
    for (const [videos, photos, points] of [[1,0,4],[0,1,1],[5,0,20],[0,5,5],[6,12,25]]) {
      row.media = { videos, photos };
      assert.equal(score(row, '7d').scores.overall.value, base + points);
    }
  }
  assert.equal(DANCER_SCORE_WEIGHTS.conversions, 10);
});
