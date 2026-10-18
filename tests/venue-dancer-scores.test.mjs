import assert from 'node:assert/strict';
import test from 'node:test';
import { scoreVenueDancers, sortScoredDancers, DANCER_SCORE_CATEGORIES, DANCER_SCORE_WEIGHTS, DANCER_SCORE_MINIMUMS } from '../src/lib/dancr/venue-dancer-scores.ts';

const dancer = id => ({ id, name: id,
  internal: { checkedInHours: 8, requests: 20, completed: 8, requestsDuringHours: 20,
    rosterTrackedHours: 8, rosterBothHours: 0, verifiedCheckInDays: 4, checkoutEligibleDays: 4, dancerCheckoutDays: 4, activeCheckInDays: 0 },
  vip: { requests: 25, scoringRequests: 20, scoringUniqueRequesters: 10, scoringRepeatRequesters: 2 },
  external: { dancer_profile: 10, club_page: 10, directions: 10, going: 10, free_entry: 10, transport: 10 },
  results: { checkIns: 2, checkOuts: 1, tableArrived: 8, tableNoShows: 0, tableAttendanceUnrecorded: 2,
    profileClaims: 20, profileCohortConversions: 10, profileConversions: 15 },
});
const peers = () => [dancer('a'), dancer('b'), dancer('c')];
const score = (row, period = '30d') => scoreVenueDancers([row, dancer('b'), dancer('c')], period)[0];

test('five independent categories and overall use the published automatic formulas', () => {
  for (const row of scoreVenueDancers(peers(), '30d')) {
    assert.deepEqual(Object.keys(row.scores), ['overall', ...DANCER_SCORE_CATEGORIES]);
    assert.deepEqual(Object.fromEntries(Object.entries(row.scores).map(([k, s]) => [k, s.value])),
      { overall: 53, checkIns: 75, internal: 50, vip: 44, profile: 50, conversions: 50 });
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

test('Both earns a prorated 25 percent activity boost without changing checkout accuracy or peer baselines', () => {
  const rows=peers(); rows[1].internal.rosterBothHours=4; rows[2].internal.rosterBothHours=8;
  assert.deepEqual(scoreVenueDancers(rows,'30d').map(row=>row.scores.checkIns.value),[75,78,81]);
  rows[2].internal.dancerCheckoutDays=0;
  assert.equal(scoreVenueDancers(rows,'30d')[2].scores.checkIns.value,31,'Both cannot supply missing checkout points');
  assert.match(scoreVenueDancers(rows,'30d')[1].scores.checkIns.evidence,/4h on both rosters/);
});

test('Both bonus stays within the activity allocation, including provisional visits', () => {
  const row=dancer('a'); Object.assign(row.internal,{rosterTrackedHours:800,rosterBothHours:800,verifiedCheckInDays:400});
  assert.equal(score(row).scores.checkIns.value,100);
  row.internal.dancerCheckoutDays=0; assert.equal(score(row).scores.checkIns.value,50);
  Object.assign(row.internal,{rosterTrackedHours:8,rosterBothHours:8,verifiedCheckInDays:4,checkoutEligibleDays:0,dancerCheckoutDays:0,activeCheckInDays:1});
  assert.equal(score(row).scores.checkIns.value,63); assert.equal(score(row).scores.checkIns.confidence,'early');
});

test('unknown mode history earns no bonus and invalid mode hours cannot inflate scores', () => {
  const row=dancer('a'); delete row.internal.rosterBothHours;
  assert.equal(score(row).scores.checkIns.value,75);
  for (const invalid of [null,NaN,Infinity,-1,8.01]) {
    row.internal.rosterBothHours=invalid; assert.equal(score(row).scores.checkIns.value,null);
  }
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
  const expected = Math.round(keys.reduce((sum, k) => sum + result.scores[k].value * DANCER_SCORE_WEIGHTS[k], 0) / 80);
  assert.equal(result.scores.overall.value, expected);
  assert.equal(result.scores.overall.evidence, '4 of 5 categories');
  assert.equal(result.scores.overall.confidence, 'early'); assert.equal(result.rank, null);
  row.internal = {}; row.results = undefined;
  assert.equal(score(row).scores.overall.value, null);
});

test('period minimums and early-data labels prevent tiny samples from being ranked', () => {
  for (const period of ['tonight', '7d', '14d', '30d', 'all']) {
    const min = DANCER_SCORE_MINIMUMS[period];
    const rows = peers().map(row => ({ ...row,
      internal: { ...row.internal, checkedInHours: min.hours, rosterTrackedHours: min.hours, requests: min.requests, requestsDuringHours: min.requests },
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

test('relative scores need peers; absolute entry conversion does not invent a comparison', () => {
  const rows = scoreVenueDancers(peers().slice(0, 2), 'all');
  assert.ok(rows.every(row => row.scores.conversions.value === 50 && row.scores.overall.value === null && row.rank === null));
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

test('score details expose the actual counts, baselines, weights and rounded calculations', () => {
  const result = score(dancer('a')).scores;
  const inputs = key => Object.fromEntries(result[key].details.inputs.map(input => [input.label, input.value]));
  assert.deepEqual(inputs('checkIns'), {
    'Check-in days': '4', 'Tracked hours': '8 h', 'Complete checkout days': '4 of 4 · 100%',
    'Both-roster hours': '0 h · +0% activity boost',
  });
  assert.deepEqual(inputs('internal'), {
    'Requests while checked in': '20', 'Checked-in hours': '8 h', 'Requests per hour': '2.5', 'Club median per hour': '2.5',
  });
  assert.deepEqual(inputs('vip'), {
    'VIP selections': '20', 'Club median selections': '20', 'Requesting customers': '10', 'Returning requesters': '2 of 10 · 20%',
  });
  assert.deepEqual(inputs('profile'), {
    'Profile opens': '10 × 1 = 10', 'Club opens': '10 × 2 = 20', Directions: '10 × 3 = 30',
    "I'm Going": '10 × 3 = 30', 'Offer clicks': '10 × 3 = 30', 'Transport clicks': '10 × 3 = 30',
    'Weighted action total': '150', 'Club median weighted total': '150',
  });
  assert.deepEqual(inputs('conversions'), { 'Profile passes redeemed': '10 of 20 claimed', 'Conversion rate': '50%' });
  assert.deepEqual(inputs('overall'), { 'Check-ins': '75 × 15%', Tables: '50 × 25%', VIP: '44 × 20%', Interest: '50 × 10%', Entries: '50 × 30%' });
  assert.equal(result.internal.details.calculation[1].value, '100 × 2.5 ÷ (2.5 + 2.5) ≈ 50');
  assert.equal(result.vip.details.calculation[2].value, '40 + 4 ≈ 44');
  assert.equal(result.checkIns.details.calculation.at(-1).value, '25 + 50 ≈ 75');
  assert.equal(result.overall.details.calculation[0].value, '(75 × 15 + 50 × 25 + 44 × 20 + 50 × 10 + 50 × 30) ÷ 100 ≈ 53');
});

test('details show only counted actions and cohort redemptions, not unrelated totals', () => {
  const row = dancer('a');
  Object.assign(row.external, { follow: 3, share_completed: 2, share: 100, impressions: 999 });
  Object.assign(row.results, { profileClaims: 23, profileCohortConversions: 20, profileConversions: 999 });
  const result = score(row).scores;
  assert.ok(result.profile.details.inputs.some(input => input.label === 'Follows' && input.value === '3 × 2 = 6'));
  assert.ok(result.profile.details.inputs.some(input => input.label === 'Completed shares' && input.value === '2 × 2 = 4'));
  assert.ok(result.profile.details.inputs.some(input => input.label === 'Weighted action total' && input.value === '160'));
  assert.ok(!JSON.stringify(result.profile.details).includes('999'));
  assert.deepEqual(result.conversions.details.inputs, [
    { label: 'Profile passes redeemed', value: '20 of 23 claimed' }, { label: 'Conversion rate', value: '87%' },
  ]);
  assert.equal(result.conversions.details.calculation[0].value, '20 ÷ 23 × 100 ≈ 87');
  row.results.profileCohortConversions = 0;
  assert.equal(score(row).scores.conversions.details.calculation[0].value, '0 ÷ 23 × 100 ≈ 0');
});

test('check-in details account for partial boosts, provisional scores and unknown roster history', () => {
  const row = dancer('a'); row.internal.rosterBothHours = 4;
  let details = score(row).scores.checkIns.details;
  assert.equal(details.inputs.at(-1).value, '4 h · +12.5% activity boost');
  assert.equal(details.calculation.at(-1).value, '28.125 + 50 ≈ 78');
  Object.assign(row.internal, { checkoutEligibleDays: 0, dancerCheckoutDays: 0, activeCheckInDays: 1 });
  details = score(row).scores.checkIns.details;
  assert.equal(details.inputs[2].value, 'Pending ended visits');
  assert.equal(details.calculation.at(-1).label, 'Provisional score · Rounded');
  assert.equal(details.calculation.at(-1).value, '28.125 ÷ 0.5 ≈ 56');
  assert.ok(!details.calculation.some(step => step.label.startsWith('Checkout points')));
  delete row.internal.rosterBothHours;
  details = score(row).scores.checkIns.details;
  assert.equal(details.inputs.at(-1).value, 'Not recorded · No boost');
  assert.equal(details.calculation.at(-1).value, '25 ÷ 0.5 ≈ 50');
});

test('unscored categories have no invented details and partial overall displays normalized weights', () => {
  const row = dancer('a'); row.vip = {};
  const result = score(row).scores;
  assert.equal(result.vip.details, undefined);
  assert.deepEqual(result.overall.details.inputs.map(input => input.value),
    ['75 × 18.75%', '50 × 31.25%', 'Not scored · Excluded', '50 × 12.5%', '50 × 37.5%']);
  assert.equal(result.overall.details.calculation[0].value, '(75 × 15 + 50 × 25 + 50 × 10 + 50 × 30) ÷ 80 ≈ 55');
  row.internal = {}; row.results = undefined; row.external = {};
  assert.ok(Object.values(score(row).scores).every(category => category.details === undefined));
});

test('all reporting periods expose calculations matching their displayed scores', () => {
  for (const period of ['tonight', '7d', '30d', 'all']) {
    for (const category of Object.values(score(dancer('a'), period).scores)) {
      assert.ok(category.details.calculation.at(-1).value.endsWith(`≈ ${category.value}`));
    }
  }
});
