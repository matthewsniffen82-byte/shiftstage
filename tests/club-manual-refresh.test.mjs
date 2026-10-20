import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/live-shell/app/26-sync-discovery-city-scope.js', import.meta.url), 'utf8');
function extract(text, name) {
  const start = text.search(new RegExp(`    (?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  return text.slice(start, text.indexOf('\n    }', start) + 6);
}
function fixture(load = async () => true) {
  const requests = [], notices = [], buttons = Array.from({ length: 2 }, () => ({
    disabled: false, textContent: 'Refresh', attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
  }));
  const listeners = { document: {}, window: {} };
  let timer;
  const context = vm.createContext({
    activeTab: 'venues', citySelect: { value: 'Las Vegas' }, clubRefreshPending: false,
    HOME_DISCOVERY_REFRESH_MS: 30000,
    liveDiscoveryIsLoading: () => false, liveMarketRefreshes: new Set(),
    loadLiveDiscovery: (city, options) => { requests.push({ city, ...options }); return load(); },
    showToast: text => notices.push(text),
    document: { visibilityState: 'visible', querySelectorAll: () => buttons,
      addEventListener: (name, handler) => { listeners.document[name] = handler; } },
    window: { setInterval: handler => { timer = handler; },
      addEventListener: (name, handler) => { listeners.window[name] = handler; } },
    refreshBrowserAccountView: () => false, renderCustomerQuickActions() {},
    consumePublicDiscoveryRefreshRequest() {}, syncDeviceSavedDealPasses() {}, isCustomerSession: () => false,
  });
  for (const name of ['clubRefreshButtonMarkup', 'syncClubRefreshButtons', 'refreshClubsManually', 'refreshVisibleHomeDiscovery']) {
    vm.runInContext(extract(source, name), context);
  }
  const eventsStart = source.indexOf('    window.setInterval(() => { void refreshVisibleHomeDiscovery(');
  vm.runInContext(source.slice(eventsStart, source.indexOf('    if (isCustomerSession()) loadLiveCustomerDashboardData();', eventsStart)), context);
  return { context, requests, notices, buttons, listeners, tick: () => timer() };
}

test('club lists and open club pages do not reload on timers, focus, visibility, or browser restoration', () => {
  for (const selectedVenueName of [null, 'rhino-id']) {
    const { context, requests, listeners, tick } = fixture();
    context.selectedVenueName = selectedVenueName;
    tick();
    listeners.document.visibilitychange();
    listeners.window.focus();
    listeners.window.pageshow({ persisted: true });
    assert.equal(requests.length, 0);
    context.activeTab = 'dancers';
    tick();
    assert.equal(requests.length, 1, 'Dancer discovery retains its existing refresh behavior');
    context.document.visibilityState = 'hidden';
    tick();
    assert.equal(requests.length, 1);
  }
});

test('Refresh bypasses cached data, disables both controls, and prevents duplicate requests', async () => {
  let finish;
  const { context, requests, notices, buttons } = fixture(() => new Promise(resolve => { finish = resolve; }));
  const pending = context.refreshClubsManually();
  await context.refreshClubsManually();
  assert.deepEqual(requests, [{ city: 'Las Vegas', force: true, cacheBust: true, background: true }]);
  assert.ok(buttons.every(button => button.disabled && button.textContent === 'Refreshing…' && button.attributes['aria-busy'] === 'true'));
  assert.match(context.clubRefreshButtonMarkup(), /disabled/);
  finish(true);
  await pending;
  assert.ok(buttons.every(button => !button.disabled && button.textContent === 'Refresh'));
  assert.deepEqual(notices, ['Club information refreshed']);
});

test('failed refreshes offer a retry and never announce success', async () => {
  for (const load of [async () => false, async () => undefined, async () => { throw new Error('offline'); }]) {
    const { context, notices, buttons } = fixture(load);
    await context.refreshClubsManually();
    assert.deepEqual(notices, ['Could not refresh clubs. Please try again.']);
    assert.ok(buttons.every(button => !button.disabled));
    assert.equal(context.clubRefreshPending, false);
  }
});

test('a click during the initial club load does not start a competing request', async () => {
  const { context, requests, notices } = fixture();
  context.liveMarketRefreshes.add('Las Vegas');
  await context.refreshClubsManually();
  assert.equal(requests.length, 0);
  assert.deepEqual(notices, ['Clubs are already loading. Please wait a moment.']);
});

test('club pages render the Refresh control beside the working roster', () => {
  const venueSource = readFileSync(new URL('../src/live-shell/app/11-post-verified-shift.js', import.meta.url), 'utf8');
  const { context } = fixture();
  Object.assign(context, {
    venueDetails: venue => ({ ...venue, city: 'Las Vegas' }), venueOperatingStatus: () => ({}),
    venueVisualAttrs: () => ({ attrs: { className: '', style: '' }, source: 'fixture' }),
    venueLogoMarkup: () => '<img alt="Club logo">', venueDancers: () => [],
    isFollowingVenue: () => false, escapeOptionValue: String, escapeHtml: String,
    actionIconMarkup: () => '', recordVenuePageEvent() {}, venueOfferStatusMarkup: () => '',
    venueOfferMarkup: () => '', venueDirectionsMarkup: () => '', actionButtonLabel: () => '',
  });
  vm.runInContext(extract(venueSource, 'venueDetailPage'), context);
  const markup = context.venueDetailPage({ id: 'rhino', name: 'Spearmint Rhino', slug: 'talk-of-the-town' });
  assert.match(markup, /venue-roster-heading[\s\S]*?Working now · 0[\s\S]*?<button[^>]*data-club-refresh[^>]*>Refresh<\/button>/);
  context.clubRefreshPending = true;
  assert.match(context.venueDetailPage({ name: 'Club' }), /data-club-refresh[^>]*aria-busy="true" disabled>Refreshing…/);
});

test('club rosters survive a renamed club without admitting dancers from another club with the same name', () => {
  const venueSource = readFileSync(new URL('../src/live-shell/app/11-post-verified-shift.js', import.meta.url), 'utf8');
  const context = vm.createContext({
    discoveryMarket: () => ({ venues: [{ id: 'rhino', name: 'Spearmint Rhino' }], dancers: [
      { id: 'star', venueId: 'rhino', venue: 'Spearmint Rhino Las Vegas' },
      { id: 'another-club', venueId: 'other', venue: 'Spearmint Rhino' },
      { id: 'hidden', venueId: 'rhino', venue: 'Spearmint Rhino', approved: false },
      { id: 'legacy', venue: 'Spearmint Rhino' },
    ] }),
    isApprovedPublicProfile: row => row.approved !== false, withTrendingRank: row => row,
  });
  vm.runInContext(extract(venueSource, 'venueDancers'), context);
  assert.deepEqual(Array.from(context.venueDancers('Las Vegas', 'Spearmint Rhino'), row => row.id), ['star', 'legacy']);
});

test('opening a club requests its data immediately after leaving another dancer filter', () => {
  const navigation = readFileSync(new URL('../src/live-shell/app/22-create-home-tv-landing-preloader.js', import.meta.url), 'utf8');
  const requests = [];
  const context = vm.createContext({
    URL, selectedVenueName: null, activeTab: 'dancers', dancerDirectoryFilter: 'not_now',
    citySelect: { value: 'Las Vegas' },
    resolveVenueByName: () => ({ id: 'rhino', slug: 'talk-of-the-town', name: 'Spearmint Rhino' }),
    window: { scrollY: 0, location: { href: 'https://mydancr.com/?view=not_now' }, history: { replaceState() {} } },
    document: { title: 'MyDancr', querySelectorAll: () => [] }, homeBottomTv: null,
    captureProfileReturnContext: () => null, deactivateHomeDiscoveryFeed() {},
    render() {}, syncOverlayScrollLock() {}, focusVenueProfileStart() {},
    loadLiveDiscovery: city => { requests.push({ city, tab: context.activeTab, club: context.selectedVenueName }); },
  });
  vm.runInContext(extract(navigation, 'openVenueFromName'), context);
  context.openVenueFromName('rhino');
  assert.deepEqual(requests, [{ city: 'Las Vegas', tab: 'venues', club: 'rhino' }]);
});
