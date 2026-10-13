import assert from 'node:assert/strict';
import test from 'node:test';
import { scoreVenueDancers, sortScoredDancers, DANCER_SCORE_WEIGHTS, DANCER_SCORE_MINIMUMS } from '../src/lib/dancr/venue-dancer-scores.ts';

const dancer = (id, overrides = {}) => ({ id, name: id,
  internal: { checkedInHours: 4, requests: 10, completed: 8, requestsDuringHours: 10 },
  vip: { requests: 10, repeatRequesters: 2 },
  external: { dancer_profile: 10, club_page: 10, directions: 10, going: 10, free_entry: 10, transport: 10 },
  results: { checkIns: 2, checkOuts: 1, lastCheckInAt: '2026-10-12T00:00Z', lastCheckOutAt: null,
    tableArrived: 8, tableNoShows: 0, tableAttendanceUnrecorded: 2, showUpPercent: 100,
    profileClaims: 10, profileCohortConversions: 5, profileConversions: 5, profileConversionPercent: 50 },
  ...overrides,
});
const peers = () => [dancer('a'), dancer('b'), dancer('c')];
const score = (row, period = '30d') => scoreVenueDancers([row, dancer('b'), dancer('c')], period)[0];

test('four bounded scores use the published category formulas and 45/40/15 overall weighting', () => {
  const rows = scoreVenueDancers(peers(), '30d');
  for (const row of rows) {
    assert.deepEqual(Object.keys(row.scores), ['overall', 'checkIns', 'requests', 'profile']);
    assert.deepEqual(Object.fromEntries(Object.entries(row.scores).map(([key, value]) => [key, value.value])),
      { overall: 57, checkIns: 50, requests: 63, profile: 53 });
    assert.equal(row.scores.overall.value, Math.round((row.scores.requests.value * DANCER_SCORE_WEIGHTS.requests
      + row.scores.profile.value * DANCER_SCORE_WEIGHTS.profile + row.scores.checkIns.value * DANCER_SCORE_WEIGHTS.checkIns) / 100));
    assert.equal(row.rank, 1); assert.equal(row.rankedCount, 3);
  }
});

test('same displayed overall scores tie, ranks skip correctly, and input is never mutated', () => {
  const low = dancer('c'); low.internal.completed = 0; low.results.profileCohortConversions = 0; low.results.profileConversions = 0;
  const source = [dancer('b'), low, dancer('a')]; const before = structuredClone(source);
  const rows = scoreVenueDancers(source, 'all');
  assert.deepEqual(rows.map(row => row.rank), [1, 3, 1]);
  assert.deepEqual(source, before);
  assert.deepEqual(sortScoredDancers(rows, 'overall').map(row => row.dancer.id), ['a', 'b', 'c']);
  assert.deepEqual(sortScoredDancers(rows, 'name').map(row => row.rank), [1, 1, 3]);
  assert.deepEqual(rows.map(row => row.dancer.id), ['b', 'c', 'a']);
});

test('period thresholds apply to Tonight, 7 days, 30 days and all time independently', () => {
  for (const period of ['tonight', '7d', '30d', 'all']) {
    const minimum = DANCER_SCORE_MINIMUMS[period];
    const source = peers().map(row => ({ ...row,
      internal: { checkedInHours: minimum.hours, requests: minimum.requests, completed: minimum.requests, requestsDuringHours: minimum.requests },
      vip: {}, external: { dancer_profile: minimum.actions },
      results: { ...row.results, profileClaims: minimum.claims, profileCohortConversions: minimum.claims, profileConversions: minimum.claims },
    }));
    assert.ok(scoreVenueDancers(source, period).every(row => row.scores.overall.value !== null));
    source[0].internal.checkedInHours -= 0.01;
    const result = scoreVenueDancers(source, period)[0];
    assert.equal(result.scores.checkIns.value, null); assert.equal(result.scores.overall.value, null); assert.equal(result.rank, null);
  }
});

test('missing results, insufficient samples and too few peers never turn into a zero score or a rank', () => {
  assert.deepEqual(scoreVenueDancers([], 'all'), []);
  assert.ok(scoreVenueDancers(peers().slice(0, 2), 'all').every(row => row.rank === null && Object.values(row.scores).every(value => value.value === null)));
  const missing = score(dancer('a', { results: undefined }));
  assert.equal(missing.scores.profile.value, null); assert.equal(missing.scores.checkIns.value, null);
  assert.equal(missing.scores.overall.value, null); assert.equal(missing.rank, null);
  assert.match(missing.scores.overall.reason, /All three/);
  const noClaims = dancer('a'); noClaims.results.profileClaims = 0; noClaims.results.profileCohortConversions = 0;
  assert.equal(score(noClaims).scores.profile.value, null);
  const noActions = dancer('a', { external: {} }); assert.equal(score(noActions).scores.profile.value, null);
});

test('recorded zero completions and conversions stay valid, and more completed requests improve Requests', () => {
  const zero = dancer('a'); zero.internal.completed = 0; zero.results.profileCohortConversions = 0; zero.results.profileConversions = 0;
  const result = score(zero);
  assert.notEqual(result.scores.requests.value, null); assert.notEqual(result.scores.profile.value, null);
  assert.ok(result.scores.profile.value <= 15, 'clicks alone cannot outweigh entry outcomes');
  const complete = structuredClone(zero); complete.internal.completed = 10;
  assert.ok(score(complete).scores.requests.value > result.scores.requests.value);
});

test('zero demand is a zero score, missing channels are not, and zero sorts above unscored', () => {
  const source = peers().map(row => ({ ...row, vip: {}, internal: { ...row.internal, completed: 0, requestsDuringHours: 0 } }));
  const rows = scoreVenueDancers([...source, dancer('missing', { internal: {}, vip: {}, results: undefined })], '30d');
  assert.equal(rows[0].scores.requests.value, 0);
  assert.equal(rows[3].scores.requests.value, null);
  assert.equal(sortScoredDancers(rows, 'requests').at(-1).dancer.id, 'missing');
});

test('partial category cohorts do not create an overall rank with fewer than three complete scores', () => {
  const source = [...peers().slice(0, 2), dancer('c', { results: undefined }), dancer('d', { internal: {}, vip: {} })];
  source[2].results = { ...dancer('template').results, profileClaims: 0, profileCohortConversions: 0 };
  const rows = scoreVenueDancers(source, '30d');
  assert.ok(rows[0].scores.overall.value !== null);
  assert.ok(rows.every(row => row.rank === null && row.rankedCount === 0));
});

test('verified-hour and profile-action normalization do not reward extra exposure alone', () => {
  const base = dancer('a');
  const doubled = structuredClone(base);
  for (const key of ['checkedInHours', 'requests', 'completed', 'requestsDuringHours']) doubled.internal[key] *= 2;
  for (const key of Object.keys(doubled.external)) doubled.external[key] *= 2;
  for (const key of ['profileClaims', 'profileCohortConversions', 'profileConversions']) doubled.results[key] *= 2;
  assert.equal(score(base).scores.requests.value, score(doubled).scores.requests.value);
  assert.equal(score(base).scores.profile.value, score(doubled).scores.profile.value);
});

test('checkouts and timestamps do not penalize an ongoing shift or grant extra points', () => {
  const row = dancer('a'); const before = score(row).scores.checkIns.value;
  row.results.checkOuts = 100; row.results.lastCheckInAt = null; row.results.lastCheckOutAt = '2026-10-13T00:00Z';
  assert.equal(score(row).scores.checkIns.value, before);
});

test('VIP-only and table-only request channels are scored without inventing missing channels', () => {
  const vipOnly = peers().map(row => ({ ...row, internal: {}, results: undefined }));
  const vipScores = scoreVenueDancers(vipOnly, '30d');
  assert.ok(vipScores.every(row => row.scores.requests.value === 50 && row.scores.overall.value === null && row.rank === null));
  const tableOnly = peers().map(row => ({ ...row, vip: {} }));
  assert.ok(scoreVenueDancers(tableOnly, '30d').every(row => row.scores.requests.value === 68));
  const moreRepeat = peers(); moreRepeat[0].vip.repeatRequesters = 5;
  assert.ok(scoreVenueDancers(moreRepeat, '30d')[0].scores.requests.value > 63);
});

test('all six activity types contribute, unrelated metrics do not affect score', () => {
  const allViews = dancer('a', { external: { dancer_profile: 60 } });
  const baseline = score(allViews).scores.profile.value;
  for (const key of ['club_page', 'directions', 'going', 'free_entry', 'transport']) {
    const highIntent = dancer('a', { external: { dancer_profile: 50, [key]: 10 } });
    assert.ok(score(highIntent).scores.profile.value > baseline, key);
  }
  const irrelevant = dancer('a'); irrelevant.external.claims = 100000; irrelevant.external.admissions = 100000;
  irrelevant.results.tableArrived = 1000; irrelevant.results.showUpPercent = 0;
  assert.deepEqual(score(irrelevant).scores, score(dancer('a')).scores);
});

test('malformed, inconsistent and extreme inputs never create NaN, infinite, or out-of-range scores', () => {
  for (const invalid of [null, undefined, NaN, Infinity, -1]) {
    const row = dancer('a'); row.internal.checkedInHours = invalid;
    assert.equal(score(row).scores.checkIns.value, null);
    row.results.profileClaims = invalid; assert.equal(score(row).scores.profile.value, null);
  }
  const bad = dancer('a'); bad.internal.completed = 100; bad.vip.repeatRequesters = 100;
  bad.results.profileCohortConversions = 100;
  assert.equal(score(bad).scores.requests.value, null); assert.equal(score(bad).scores.profile.value, null);
  const huge = peers().map(row => ({ ...row, internal: { ...row.internal, checkedInHours: Number.MAX_VALUE } }));
  for (const row of scoreVenueDancers(huge, 'all')) for (const score of Object.values(row.scores)) {
    assert.ok(score.value === null || Number.isInteger(score.value) && score.value >= 0 && score.value <= 100);
  }
});
