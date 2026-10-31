import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/live-shell/app/26-sync-discovery-city-scope.js', import.meta.url), 'utf8');
const refreshInterval = Number(readFileSync(new URL('../src/live-shell/app/01-user-agent.js', import.meta.url), 'utf8').match(/const HOME_DISCOVERY_REFRESH_MS = (\d+);/)[1]);
function extract(text, name) {
  const start = text.search(new RegExp(`    (?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  return text.slice(start, text.indexOf('\n    }', start) + 6);
}
function fixture(load = async () => true) {
  const requests = [], notices = [], buttons = Array.from({ length: 2 }, (_, index) => ({
    id: index === 0 ? 'discoveryRefresh' : '',
    disabled: false, innerHTML: '<svg></svg>', attributes: {},
    set textContent(value) { throw new Error('Refresh must preserve its icon: ' + value); },
    setAttribute(name, value) { this.attributes[name] = value; },
  }));
  const listeners = { document: {}, window: {} };
  let timer, timerInterval;
  const context = vm.createContext({
    internalProfileFrameId: null, activeTab: 'venues', selectedVenueName: null, citySelect: { value: 'Las Vegas' }, discoveryRefreshPending: false,
    HOME_DISCOVERY_REFRESH_MS: refreshInterval,
    liveDiscoveryIsLoading: () => false, liveMarketRefreshes: new Set(),
    loadLiveDiscovery: (city, options) => { requests.push({ city, ...options }); return load(); },
    showToast: text => notices.push(text),
    document: { visibilityState: 'visible', querySelectorAll: () => buttons,
      addEventListener: (name, handler) => { listeners.document[name] = handler; } },
    window: { setInterval: (handler, interval) => { timer = handler; timerInterval = interval; },
      addEventListener: (name, handler) => { listeners.window[name] = handler; } },
    refreshBrowserAccountView: () => false, renderCustomerQuickActions() {},
    validateStoredAuthSession: async () => {},
    consumePublicDiscoveryRefreshRequest() {}, syncDeviceSavedDealPasses() {}, isCustomerSession: () => false,
  });
  for (const name of ['discoveryRefreshButtonMarkup', 'syncDiscoveryRefreshButtons', 'refreshDiscoveryManually', 'refreshVisibleHomeDiscovery', 'refreshRestoredPublicGrid']) {
    vm.runInContext(extract(source, name), context);
  }
  const eventsStart = source.indexOf('    window.setInterval(() => { void refreshVisibleHomeDiscovery(');
  vm.runInContext(source.slice(eventsStart, source.indexOf('    if (!internalProfileFrameId && isCustomerSession()) loadLiveCustomerDashboardData();', eventsStart)), context);
  return { context, requests, notices, buttons, listeners, timerInterval, tick: () => timer() };
}

test('visible dancer and club grids refresh every 30 seconds and on return to the page', () => {
  for (const tab of ['dancers', 'venues']) {
    const { context, requests, listeners, timerInterval, tick } = fixture();
    context.activeTab = tab;
    assert.equal(timerInterval, 30000);
    tick();
    assert.deepEqual(requests, [{ city: 'Las Vegas', force: true, cacheBust: false, background: true }]);
    listeners.document.visibilitychange();
    listeners.window.focus();
    listeners.window.pageshow({ persisted: true });
    assert.equal(requests.length, 4);
    context.document.visibilityState = 'hidden';
    tick();
    assert.equal(requests.length, 4, 'Hidden pages do not poll');
    context.document.visibilityState = 'visible';
    context.internalProfileFrameId = 'internal-viewer';
    tick();
    assert.equal(requests.length, 4, 'Internal profiles do not poll the public grid');
  }
});

test('open club rosters refresh every 30 seconds and on return while retaining the selected club', () => {
  const { context, requests, notices, listeners, timerInterval, tick } = fixture();
  context.selectedVenueName = 'rhino-id';
  assert.equal(timerInterval, 30000);
  tick();
  assert.deepEqual(requests, [{ city: 'Las Vegas', force: true, cacheBust: false, background: true }]);
  listeners.document.visibilitychange();
  listeners.window.focus();
  listeners.window.pageshow({ persisted: true });
  assert.equal(requests.length, 4);
  assert.ok(requests.slice(1).every(request => request.cacheBust && request.background));
  assert.equal(context.selectedVenueName, 'rhino-id');
  assert.equal(context.activeTab, 'venues');
  assert.deepEqual(notices, [], 'Automatic refresh does not interrupt browsing with a toast');
  context.document.visibilityState = 'hidden';
  tick();
  assert.equal(requests.length, 4, 'Hidden club pages do not poll');
});

test('Refresh bypasses cached data, disables both controls, and prevents duplicate requests', async () => {
  let finish;
  const { context, requests, notices, buttons } = fixture(() => new Promise(resolve => { finish = resolve; }));
  const pending = context.refreshDiscoveryManually();
  await context.refreshDiscoveryManually();
  assert.deepEqual(requests, [{ city: 'Las Vegas', force: true, cacheBust: true, background: true }]);
  assert.ok(buttons.every(button => button.disabled && button.attributes['aria-label'] === 'Refresh clubs' && button.attributes['aria-busy'] === 'true'));
  assert.match(context.discoveryRefreshButtonMarkup(), /disabled/);
  finish(true);
  await pending;
  assert.ok(buttons.every(button => !button.disabled && button.innerHTML === '<svg></svg>'));
  assert.deepEqual(notices, ['Club information refreshed']);
});

test('failed refreshes offer a retry and never announce success', async () => {
  for (const load of [async () => false, async () => undefined, async () => { throw new Error('offline'); }]) {
    const { context, notices, buttons } = fixture(load);
    await context.refreshDiscoveryManually();
    assert.deepEqual(notices, ['Could not refresh clubs. Please try again.']);
    assert.ok(buttons.every(button => !button.disabled));
    assert.equal(context.discoveryRefreshPending, false);
  }
});

test('visibility restoration only releases rows confirmed by a completed refresh of the same grid', async () => {
  for (const changed of ['none', 'city', 'filter', 'failed']) {
    const deferred = Promise.withResolvers();
    const { context } = fixture(() => deferred.promise);
    context.activeTab = 'dancers';
    let scope = 'now';
    context.discoveryRequestScope = () => ({ key: scope });
    context.discoveryMarket = () => ({ pagination: { dancers: [{ id: 'fresh' }] } });
    const request = context.refreshRestoredPublicGrid();
    if (changed === 'city') context.citySelect.value = 'Miami';
    if (changed === 'filter') scope = 'not_now';
    deferred.resolve(changed !== 'failed');
    const result = await request;
    if (changed === 'none') assert.deepEqual(Array.from(result), ['fresh']);
    else assert.equal(result, false);
  }
});

test('a click during the initial club load does not start a competing request', async () => {
  const { context, requests, notices } = fixture();
  context.liveMarketRefreshes.add('Las Vegas');
  await context.refreshDiscoveryManually();
  assert.equal(requests.length, 0);
  assert.deepEqual(notices, ['Clubs are already loading. Please wait a moment.']);
});

test('club pages render the Refresh control beside the working roster', () => {
  const venueSource = readFileSync(new URL('../src/live-shell/app/11-post-verified-shift.js', import.meta.url), 'utf8');
  const { context } = fixture();
  Object.assign(context, {
    venueDetails: venue => ({ ...venue, city: 'Las Vegas' }), venueOperatingStatus: () => ({}),
    venueVisualAttrs: () => ({ attrs: { className: '', style: '' }, source: 'fixture' }),
    venueLogoMarkup: () => '<img alt="Club logo">', venueInitials: () => 'SR', venueDancers: () => [],
    venueLineupMarkup: () => '',
    venueRosterState: () => ({ count: 0, message: '' }),
    isFollowingVenue: () => false, escapeOptionValue: String, escapeHtml: String,
    actionIconMarkup: () => '', recordVenuePageEvent() {}, venueOfferStatusMarkup: () => '',
    venueOfferMarkup: () => '', venueDirectionsMarkup: () => '', actionButtonLabel: () => '',
  });
  vm.runInContext(extract(venueSource, 'venueDetailPage'), context);
  const markup = context.venueDetailPage({ id: 'rhino', name: 'Spearmint Rhino', slug: 'talk-of-the-town' });
  assert.match(markup, /venue-roster-heading[\s\S]*?Working now · 0[\s\S]*?<button[^>]*data-discovery-refresh[^>]*aria-label="Refresh clubs"[^>]*><svg/);
  context.discoveryRefreshPending = true;
  assert.match(context.venueDetailPage({ name: 'Club' }), /data-discovery-refresh[^>]*aria-busy="true" disabled><svg/);
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


test('dancer refresh retains the city and filters, fetches fresh data, and labels the header correctly', async () => {
  const { context, requests, notices, buttons } = fixture();
  context.activeTab = 'dancers';
  context.dancerDirectoryFilter = 'now';
  context.venueSelect = { value: 'rhino' };
  context.distanceSelect = { value: '25 mi' };
  await context.refreshDiscoveryManually();
  assert.deepEqual(requests, [{ city: 'Las Vegas', force: true, cacheBust: true, background: true }]);
  assert.equal(context.dancerDirectoryFilter, 'now');
  assert.equal(context.venueSelect.value, 'rhino');
  assert.equal(context.distanceSelect.value, '25 mi');
  assert.equal(buttons[0].attributes['aria-label'], 'Refresh dancers');
  assert.equal(buttons[0].attributes.title, 'Refresh dancers');
  assert.deepEqual(notices, ['Dancers refreshed']);
});

test('refresh controls appear on dancer and club grids, but not the TV feed or an open club heading', () => {
  const render = readFileSync(new URL('../src/live-shell/app/20-render.js', import.meta.url), 'utf8');
  const start = render.indexOf('      const discoveryRefresh =');
  const end = render.indexOf('      syncDiscoveryRefreshButtons();', start);
  const button = {};
  const context = vm.createContext({ document: { getElementById: () => button } });
  for (const [tab, profile, hidden] of [['dancers', false, false], ['venues', false, false], ['tv', false, true], ['venues', true, true]]) {
    Object.assign(context, { activeTab: tab, expectsVenueProfile: profile });
    vm.runInContext('{'+render.slice(start,end)+'}', context);
    assert.equal(button.hidden, hidden, `${tab}, profile=${profile}`);
  }
});

test('failed dancer refreshes stay recoverable and keep the icon', async () => {
  for (const load of [async () => false, async () => { throw new Error('offline'); }]) {
    const { context, notices, buttons } = fixture(load);
    context.activeTab = 'dancers';
    await context.refreshDiscoveryManually();
    assert.deepEqual(notices, ['Could not refresh dancers. Please try again.']);
    assert.equal(context.discoveryRefreshPending, false);
    assert.ok(buttons.every(button => !button.disabled && button.innerHTML === '<svg></svg>'));
  }
});

test('switching city or tab while refreshing does not announce stale results in the new view', async () => {
  for (const change of [context => { context.citySelect.value = 'Miami'; }, context => { context.activeTab = 'venues'; }]) {
    let finish;
    const { context, notices } = fixture(() => new Promise(resolve => { finish = resolve; }));
    context.activeTab = 'dancers';
    const pending = context.refreshDiscoveryManually();
    change(context);
    finish(true);
    await pending;
    assert.deepEqual(notices, []);
    assert.equal(context.discoveryRefreshPending, false);
  }
});
