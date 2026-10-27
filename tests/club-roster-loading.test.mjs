import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/live-shell/app/11-post-verified-shift.js', import.meta.url), 'utf8');
function extract(name) {
  const start = source.indexOf(`    function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n    }', start) + 6);
}
const club = { id: 'rhino', name: 'Spearmint Rhino', slug: 'talk-of-the-town', city: 'Las Vegas' };
const scopeKey = JSON.stringify(['now', club.id]);
function fixture(city = 'Las Vegas') {
  const market = { dancers: [], venues: [club] };
  const context = vm.createContext({
    citySelect: { value: city }, liveMarketRefreshes: new Set(), loading: true,
    discoveryMarket: requested => requested === city ? market : { dancers: [], venues: [] },
    liveDiscoveryIsLoading: () => context.loading,
    venueDetails: venue => venue, venueOperatingStatus: () => ({}),
    venueVisualAttrs: () => ({ attrs: { className: '', style: '' }, source: 'fixture' }),
    venueLogoMarkup: () => '<img alt="Club logo">', isWorkingTonight: () => true, dancerGridPosition: () => 0,
    isApprovedPublicProfile: () => true, withTrendingRank: row => row,
    isFollowingVenue: () => false, escapeOptionValue: String, escapeHtml: String,
    publicAvatarPhotoUrl: () => '', profileReferenceValue: row => row.id,
    publicAvatarPhotoSrcSet: () => '', nativeResponsivePhotoAttrs: () => '', hasMoreDiscovery: () => false,
    discoveryRefreshButtonMarkup: () => '<button>Refresh</button>',
    venueDancerGridMarkup: profiles => `<div data-roster>${profiles.map(row => row.id).join(',')}</div>`,
    actionIconMarkup: () => '', recordVenuePageEvent() {}, venueOfferStatusMarkup: () => '',
    venueOfferMarkup: () => '', venueDirectionsMarkup: () => '', actionButtonLabel: () => '',
  });
  for (const name of ['venueDancers', 'venueRosterState', 'venueLineupMarkup', 'venueDetailPage']) vm.runInContext(extract(name), context);
  return { context, market, render: () => context.venueDetailPage(club) };
}

test('initial loading and failed club rosters never claim zero dancers or show the empty roster box', () => {
  const { context, render } = fixture();
  assert.match(render(), /role="status"><span[^>]*>Loading dancers/);
  assert.doesNotMatch(render(), /Working now · 0|No dancers checked in right now/);
  context.loading = false;
  assert.match(render(), /Dancers could not load\. Tap Refresh/);
  assert.doesNotMatch(render(), /Working now · 0|No dancers checked in right now/);
});

test('partial pages show the full scoped total and cannot present an empty roster', () => {
  const { context, market, render } = fixture();
  context.loading = false;
  market.pagination = { scopeKey, nextCursor: 'next', loading: true, statusCounts: { now: 137 } };
  assert.match(render(), /Working now · 137/);
  assert.match(render(), /Loading dancers/);
  assert.doesNotMatch(render(), /No dancers checked in right now/);
  market.pagination.loading = false;
  market.pagination.error = true;
  assert.match(render(), /Dancers could not load/);
  assert.doesNotMatch(render(), /No dancers checked in right now/);
});

test('only a successfully completed matching club request can confirm an empty roster', () => {
  const { context, market, render } = fixture();
  context.loading = false;
  market.pagination = { scopeKey: JSON.stringify(['now', 'other-club']), nextCursor: null };
  assert.doesNotMatch(render(), /Working now · 0|No dancers checked in right now/);
  market.pagination.scopeKey = scopeKey;
  assert.match(render(), /Working now · 0/);
  assert.match(render(), /No dancers checked in right now/);
  assert.equal((render().match(/No dancers checked in right now/g) || []).length, 1);
  assert.match(render(), /venue-profile-hours[\s\S]*?venue-profile-lineup[\s\S]*?No dancers checked in right now/);
  assert.match(render(), /venue-activity-section is-working is-empty/);
  assert.doesNotMatch(render(), /data-working-now="true"|venue-activity-empty/);
});

test('refresh keeps confirmed cards and counts visible, including clubs opened from All cities', () => {
  for (const city of ['Las Vegas', 'All cities']) {
    const { context, market, render } = fixture(city);
    context.loading = false;
    market.pagination = { scopeKey, nextCursor: null };
    market.dancers = [{ id: 'star', venueId: club.id, venue: club.name }];
    context.liveMarketRefreshes.add(city);
    assert.match(render(), /Working now · 1/);
    assert.match(render(), /data-roster>star/);
    assert.match(render(), /venue-profile-lineup[\s\S]*?data-dancer-id="star"[\s\S]*?data-working-now="true"/);
    assert.doesNotMatch(render(), /venue-activity-section is-working is-empty/);
    assert.doesNotMatch(render(), /No dancers checked in right now|Loading dancers/);
    context.liveMarketRefreshes.delete(city);
    assert.match(render(), /data-roster>star/);
  }
});

test('All cities uses the selected club ID when locations share the same name', () => {
  const { context, market, render } = fixture('All cities');
  context.loading = false;
  market.pagination = { scopeKey, nextCursor: null };
  market.venues.unshift({ id: 'other-city-club', name: club.name, city: 'Other city' });
  market.dancers = [
    { id: 'star', venueId: club.id, venue: club.name },
    { id: 'other-city-dancer', venueId: 'other-city-club', venue: club.name },
  ];
  assert.match(render(), /Working now · 1/);
  assert.match(render(), /data-roster>star/);
  assert.doesNotMatch(render(), /other-city-dancer/);
});
