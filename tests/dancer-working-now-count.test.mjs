import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../outputs/index.html', import.meta.url), 'utf8');
const names = ['discoveryWorkingNowCount', 'updateTabCounts', 'dancerDirectoryFilterMarkup',
  'selectedVenueFilter', 'profileMatchesVenueFilter', 'venueWithinSelectedRadius',
  'workingNowItems', 'getItems'];
const functions = names.map(name => {
  const start = source.indexOf(`    function ${name}(`);
  const end = source.indexOf('\n    }', start) + '\n    }'.length;
  assert.ok(start >= 0 && end > start, name);
  return source.slice(start, end);
}).join('\n');

function fixture() {
  const venues = [{ id: 'near', name: 'Near club', miles: 2 }, { id: 'far', name: 'Far club', miles: 20 }];
  const profiles = Array.from({ length: 18 }, (_, i) => ({
    id: String(i), working: i < 9, venueId: i < 3 ? 'near' : 'far', city: 'Las Vegas',
  }));
  const vegas = { venues, dancers: profiles, pagination: {
    filter: 'all', statusCounts: { now: 9, not_now: 9, nowByVenue: { near: 3, far: 6 } }, nextCursor: null,
  } };
  const markets = { 'Las Vegas': vegas, Miami: { venues: [], dancers: [], pagination: {
    filter: 'all', statusCounts: { now: 0, not_now: 0, nowByVenue: {} }, nextCursor: null,
  } } };
  const tabs = ['dancers', 'venues'].map(tab => ({ dataset: { tab, tabLabel: tab }, innerHTML: '' }));
  const state = {
    activeTab: 'dancers', dancerDirectoryFilter: 'now', selectedVenueName: null,
    userLocationOutsideMarkets: false, ALL_CITIES: 'All cities', radius: 25,
    citySelect: { value: 'Las Vegas' }, venueSelect: { value: 'all' },
    liveMarketState: { 'Las Vegas': 'ready', Miami: 'ready' },
    selectedCity: () => state.citySelect.value,
    discoveryMarket: city => markets[city],
    selectedRadiusMiles: () => state.radius, venueDistanceMiles: venue => venue.miles,
    resolveVenueByName: (name, city = state.citySelect.value) => markets[city].venues.find(v => [v.id, v.name].includes(name)),
    hasMoreDiscovery: city => Boolean(markets[city].pagination.nextCursor),
    liveDiscoveryIsLoading: city => state.liveMarketState[city] === 'loading',
    isApprovedPublicProfile: profile => !profile.hidden,
    isWorkingTonight: profile => profile.working,
    withTrendingRank: profile => profile, dancerGridPosition: () => 0,
    dancerDirectoryProfiles: profiles => profiles,
    orderedVenueDiscoveryCards: venues => venues, venueMatchesCurrentFilter: () => true,
    homeNavigationIconMarkup: () => '', escapeHtml: String,
    document: { querySelectorAll: () => tabs },
  };
  vm.runInNewContext(functions, state);
  const badge = () => {
    state.updateTabCounts(state.citySelect.value);
    return tabs[0].innerHTML.match(/class="tab-count">([^<]+)</)[1];
  };
  const nowTab = () => state.dancerDirectoryFilterMarkup(markets[state.citySelect.value].dancers, state.citySelect.value)
    .match(/dancer-directory-filter-count">([^<]+)</)[1];
  return { state, markets, vegas, profiles, badge, nowTab };
}

test('the Dancers badge stays at nine working across all destinations and status lists', () => {
  const f = fixture();
  for (const [tab, filter] of [['dancers', 'now'], ['dancers', 'not_now'], ['tv', 'all'], ['venues', 'all']]) {
    f.state.activeTab = tab;
    f.state.dancerDirectoryFilter = filter === 'all' ? 'now' : filter;
    f.vegas.pagination.filter = filter;
    f.vegas.dancers = f.profiles.filter(p => filter === 'all' || p.working === (filter === 'now'));
    assert.equal(f.badge(), '9', `${tab}/${filter}`);
    assert.equal(f.nowTab(), '9');
  }
});

test('city, distance and club filters select the same working total on every tab', () => {
  const f = fixture();
  for (const tab of ['dancers', 'tv', 'venues']) {
    f.state.activeTab = tab;
    f.state.radius = 5;
    assert.equal(f.badge(), '3');
    assert.equal(f.nowTab(), '3');
    assert.equal(f.state.getItems('Las Vegas', 'tonight').length, 3, 'cards respect the same radius');
    f.state.radius = 25;
    f.state.venueSelect.value = 'far';
    assert.equal(f.badge(), '6');
    assert.equal(f.nowTab(), '6');
    assert.equal(f.state.getItems('Las Vegas', 'tonight').length, 6);
    f.state.venueSelect.value = 'all';
  }
  f.state.citySelect.value = 'Miami';
  assert.equal(f.badge(), '0');
  f.state.citySelect.value = 'Las Vegas';
  assert.equal(f.badge(), '9');
  f.state.radius = 1;
  assert.equal(f.badge(), '0');
  f.state.radius = 25;
  f.state.userLocationOutsideMarkets = true;
  assert.equal(f.badge(), '0');
});

test('partial pages and a club profile do not replace the selected working count with a subset', () => {
  const f = fixture();
  f.vegas.dancers = f.profiles.slice(0, 1);
  f.vegas.pagination.nextCursor = 'next';
  assert.equal(f.badge(), '9');
  f.state.activeTab = 'venues';
  f.state.selectedVenueName = 'Near club';
  f.vegas.pagination.filter = 'now';
  f.vegas.pagination.statusCounts.now = 3;
  assert.equal(f.badge(), '9');
  f.state.venueSelect.value = 'far';
  assert.equal(f.badge(), '6');
});

test('zero, loading, errors and older responses do not invent a working total', () => {
  const f = fixture();
  f.state.liveMarketState['Las Vegas'] = 'loading';
  assert.equal(f.badge(), '...');
  f.state.liveMarketState['Las Vegas'] = 'error';
  assert.equal(f.badge(), '...');
  f.state.liveMarketState['Las Vegas'] = 'ready';
  f.vegas.pagination.statusCounts.nowByVenue = {};
  assert.equal(f.badge(), '0');
  delete f.vegas.pagination.statusCounts.nowByVenue;
  f.vegas.pagination.filter = 'not_now';
  f.vegas.dancers = f.profiles.filter(p => !p.working);
  assert.equal(f.badge(), '...');
  f.vegas.pagination.filter = 'all';
  f.vegas.dancers = f.profiles;
  assert.equal(f.badge(), '9');
  f.vegas.pagination.nextCursor = 'next';
  assert.equal(f.badge(), '9+');
  f.vegas.pagination.statusCounts.nowByVenue = { near: -3 };
  assert.equal(f.badge(), '9+');
});
