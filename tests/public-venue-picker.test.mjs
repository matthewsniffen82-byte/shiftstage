import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = ['05-real-dancer-dashboard-metrics', '06-rank-label', '22-create-home-tv-landing-preloader']
  .map(name => readFileSync(new URL(`../src/live-shell/app/${name}.js`, import.meta.url), 'utf8')).join('\n');
function extract(name) {
  const start = source.indexOf(`    function ${name}(`);
  const end = source.indexOf('\n    }', start) + '\n    }'.length;
  assert.ok(start >= 0 && end > start, name);
  return source.slice(start, end);
}
const rhino = { id: '260a8cc4-e7d9-46b8-8ef3-a041fd4fe2af', slug: 'talk-of-the-town', name: 'Spearmint Rhino Las Vegas', city: 'Las Vegas' };
const moonline = { id: 'moonline', slug: 'spearmint-rhino-las-vegas', name: 'Moonline Social', city: 'Las Vegas' };
function fixture(city = 'Las Vegas') {
  const market = { venues: [{ ...moonline }, { ...rhino }] };
  const context = vm.createContext({
    citySelect: { value: city }, selectedCity: () => city, ALL_CITIES: 'All cities',
    discoveryMarket: () => market, slugify: value => value.trim().toLowerCase().replaceAll(' ', '-'),
    venueSelect: { value: 'all', innerHTML: '' }, venueSelectOptions: { innerHTML: '', querySelectorAll: () => [] },
    venueSelectButtonText: {}, venueSelectButtonLive: {}, venueSelectButton: { setAttribute() {} },
    pendingVenueSelection: 'all', escapeOptionValue: String,
    venueWithinSelectedRadius: () => true, compareVenueDistance: () => 0,
    venueDancers: (_city, name) => name === rhino.name ? [{ working: true }, { working: false }] : [],
    isWorkingTonight: profile => profile.working,
    activeTab: 'dancers', selectedVenueName: null, dancerDirectoryFilter: 'now',
    URLSearchParams, window: { location: { search: '' } },
  });
  for (const name of ['resolveVenueByName', 'selectedVenueFilter', 'selectedHomeTvVenueFilter',
    'profileMatchesVenueFilter', 'venueMatchesCurrentFilter', 'venueWorkingNowCount',
    'venuePickerOptionMarkup', 'syncVenuePickerSelection', 'populateVenueSelect', 'discoveryRequestScope']) {
    vm.runInContext(extract(name), context);
  }
  return { context, market };
}

test('an exact club name wins over another club carrying its old slug', () => {
  const { context } = fixture();
  for (const reference of [rhino.name, '  SPEARMINT RHINO LAS VEGAS  ', rhino.id, rhino.slug]) {
    assert.equal(context.resolveVenueByName(reference).id, rhino.id, reference);
  }
  // Existing links for the other club must keep their original destination.
  for (const reference of [moonline.id, moonline.name, moonline.slug]) {
    assert.equal(context.resolveVenueByName(reference).id, moonline.id, reference);
  }
});

test('city and All cities pickers use stable IDs and keep the selected roster, label and request scope together', () => {
  for (const city of ['Las Vegas', 'All cities']) {
    const { context } = fixture(city);
    context.populateVenueSelect();
    assert.ok(context.venueSelect.innerHTML.includes(`value="${rhino.id}"`));
    assert.ok(context.venueSelectOptions.innerHTML.includes(`data-venue-picker-value="${rhino.id}"`));
    context.venueSelect.value = rhino.id;
    context.syncVenuePickerSelection();
    assert.equal(context.venueSelectButtonText.textContent, rhino.name);
    assert.equal(context.venueSelectButtonLive.textContent, '1 NOW');
    assert.equal(context.discoveryRequestScope(city).venue, rhino.id);
    assert.equal(context.selectedHomeTvVenueFilter().id, rhino.id);
    assert.equal(context.profileMatchesVenueFilter({ venueId: rhino.id, venue: rhino.name }), true);
    assert.equal(context.profileMatchesVenueFilter({ venueId: moonline.id, venue: moonline.name }), false);
    assert.equal(context.venueMatchesCurrentFilter(rhino), true);
    assert.equal(context.venueMatchesCurrentFilter(moonline), false);
  }
});

test('refresh migrates a name selection to its ID and keeps it after reorder or rename', () => {
  const { context, market } = fixture();
  context.venueSelect.value = rhino.name;
  context.populateVenueSelect();
  assert.equal(context.venueSelect.value, rhino.id);
  market.venues.reverse();
  market.venues.find(venue => venue.id === rhino.id).name = 'Rhino Las Vegas';
  context.populateVenueSelect();
  assert.equal(context.venueSelect.value, rhino.id);
  assert.equal(context.venueSelectButtonText.textContent, 'Rhino Las Vegas');
  market.venues = market.venues.filter(venue => venue.id !== rhino.id);
  context.populateVenueSelect();
  assert.equal(context.venueSelect.value, 'all');
  assert.equal(context.venueSelectButtonText.textContent, 'All clubs');
});
