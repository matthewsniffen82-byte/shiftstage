import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Run the actual event handlers with deferred, in-memory responses. No app server or browser journeys.
function handlers(file, start, end, context) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const first = source.indexOf(start), last = source.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, file);
  vm.runInContext(ts.transpileModule(source.slice(first, last), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const plain = value => JSON.parse(JSON.stringify(value));
const ref = current => ({ current });

for (const action of ['follow', 'going']) for (const selected of [false, true]) {
  test(`profile ${action} ${selected ? 'off' : 'on'} highlights immediately, blocks duplicate taps and rolls back on failure`, async () => {
    const response = deferred(), calls = [];
    const context = vm.createContext({
      Error, AbortController, mountedRef: ref(true), savedLoaded: true, dancerId: 'dancer',
      followAbortRef: ref(null), followInFlightRef: ref(false), goingAbortRef: ref(null), goingInFlightRef: ref(false),
      saved: { following: selected, notificationsEnabled: selected, goingShiftIds: selected ? ['shift', 'other'] : ['other'] },
      readBrowserAuthSession: () => ({ account: { id: 'guest' } }),
      setSaved: update => { context.saved = update(context.saved); },
      setStatus: value => { context.status = value; }, setFollowSaving() {}, setGoingSaving() {},
      postAction: (...args) => { calls.push(args); return response.promise; },
      postGoingAction: (...args) => { calls.push(args); return response.promise; },
      setFollowerCount: () => assert.fail('No speculative public count'), setNotificationCount: () => assert.fail('No speculative public count'),
      setGoingCount: () => assert.fail('No speculative public count'),
      profileActionFeedback: { dismiss() {}, show: () => assert.fail('No confirmation before a successful save') },
    });
    handlers('app/dancers/[slug]/DancerProfileActions.tsx', '  async function updateFollow(', '  async function postGoingAction(', context);
    const run = () => action === 'follow' ? context.updateFollow() : context.updateGoing('shift');
    const pending = run();
    assert.equal(action === 'follow' ? context.saved.following : context.saved.goingShiftIds.includes('shift'), !selected);
    await run(); assert.equal(calls.length, 1);
    // An independent selection made during this request must survive rollback.
    if (action === 'follow') context.saved.goingShiftIds.push('new-shift');
    else context.saved.following = !selected;
    response.reject(new Error('Save failed')); await pending;
    assert.equal(action === 'follow' ? context.saved.following : context.saved.goingShiftIds.includes('shift'), selected);
    assert.equal(action === 'follow' ? context.saved.goingShiftIds.includes('new-shift') : context.saved.following === !selected, true);
    assert.ok(context.saved.goingShiftIds.includes('other'));
    assert.equal(context.status, 'Save failed');
  });
}

for (const kind of ['Dancer', 'Venue']) for (const selected of [false, true]) {
  test(`${kind} preference changes before the response and restores on rejection (${selected})`, async () => {
    const response = deferred(), calls = [];
    const context = vm.createContext({
      Error, AbortController, settings: { activityAlertsEnabled: selected, alertsEnabled: selected, untouched: true },
      pending: ref(false), mounted: ref(true), saveAbort: ref(null), userId: ref('user'),
      readSession: () => ({ account: { id: 'user' } }),
      setSettings: update => { context.settings = typeof update === 'function' ? update(context.settings) : update; },
      setSaving() {}, setStatus: value => { context.status = value; }, setFailed() {},
      requestDashboardJson: (...args) => { calls.push(args); return response.promise; },
    });
    handlers(`app/dashboard/${kind}NotificationSettings.tsx`, '  async function save(', kind === 'Dancer' ? '  return <article' : '  const row =', context);
    const key = kind === 'Dancer' ? 'activityAlertsEnabled' : 'alertsEnabled';
    const pending = context.save(key);
    assert.equal(context.settings[key], !selected);
    await context.save(key); assert.equal(calls.length, 1);
    response.reject(new Error('Settings unavailable')); await pending;
    assert.equal(context.settings[key], selected); assert.equal(context.settings.untouched, true);
    assert.equal(context.pending.current, false); assert.equal(context.status, 'Settings unavailable');
  });
}

test('venue push selection rolls back if device permission fails and does not write a preference', async () => {
  const permission = deferred();
  const context = vm.createContext({
    Error, AbortController, settings: { pushEnabled: false }, delivery: {}, pending: ref(false), mounted: ref(true), saveAbort: ref(null), userId: ref('user'),
    readSession: () => ({ account: { id: 'user' } }),
    setSettings: update => { context.settings = typeof update === 'function' ? update(context.settings) : update; },
    setSaving() {}, setStatus() {}, setFailed() {},
    enableCustomerPush: () => permission.promise, disableCustomerPush: async () => {},
    requestDashboardJson: () => assert.fail('No server preference before permission'),
    setPushDeviceEnabled: () => assert.fail('Do not claim device delivery'),
  });
  handlers('app/dashboard/VenueNotificationSettings.tsx', '  async function save(', '  const row =', context);
  const pending = context.save('pushEnabled'); assert.equal(context.settings.pushEnabled, true);
  permission.reject(new Error('Permission denied')); await pending;
  assert.equal(context.settings.pushEnabled, false); assert.equal(context.pending.current, false);
});

for (const action of ['markRead', 'markAllRead', 'clearNotifications']) for (const succeeds of [false, true]) {
  test(`dashboard ${action} is immediate and ${succeeds ? 'confirmed' : 'reversible'}`, async () => {
    const response = deferred(), calls = [];
    let overlay = null;
    const context = vm.createContext({
      Error, mountedRef: ref(true), actionInFlightRef: ref(false), actionSequenceRef: ref(0), loadSequenceRef: ref(0),
      loadAbortRef: ref(new AbortController()), loadQueuedRef: ref(false),
      rows: [{ id: 'one' }, { id: 'two', readAt: 'already-read' }],
      setOptimisticNotifications: value => { overlay = typeof value === 'function' ? value() : value; },
      setNotifications: update => { context.rows = typeof update === 'function' ? update(context.rows) : update; },
      setStatus() {}, loadNotifications() {},
      requestDashboardJson: (...args) => { calls.push(args); return response.promise; },
    });
    handlers('app/dashboard/DashboardShared.tsx', '  function beginNotificationAction()', '  const unreadCount =', context);
    const visible = () => overlay ? overlay(context.rows) : context.rows;
    const oldRead = context.loadAbortRef.current;
    const pending = context[action]('one');
    assert.equal(oldRead.signal.aborted, true, 'Old polling response cannot undo feedback');
    assert.equal(action === 'clearNotifications' ? visible().length === 0 : !!visible()[0].readAt, true);
    await context[action]('one'); assert.equal(calls.length, 1);
    if (succeeds) response.resolve({ count: 2, readAt: 'server', notification: { readAt: 'server' } });
    else response.reject(new Error('Unavailable'));
    await pending;
    assert.equal(overlay, null);
    assert.equal(action === 'clearNotifications' ? visible().length === 0 : !!visible()[0].readAt, succeeds);
    if (!succeeds) assert.equal(visible()[1].readAt, 'already-read');
  });
}

for (const selected of [false, true]) for (const succeeds of [false, true]) {
  test(`deal ${selected ? 'removal' : 'saving'} responds before persistence and ${succeeds ? 'confirms' : 'rolls back'}`, async () => {
    const response = deferred(), calls = [];
    let overlay = null, confirmed = selected;
    const context = vm.createContext({
      Error, saveInFlight: ref(false), saveStateVersion: ref(0),
      activeDeal: { id: 'deal', dealTitle: 'Entry' }, activeDealIdRef: ref('deal'), venueId: 'club', venueName: 'Club', sourceType: 'venue', dancerId: null,
      displayDescription: '', displayTerms: '',
      setSavePending() {}, setStatus() {},
      setOptimisticSaved: value => { overlay = value; }, setSavedOnDevice: value => { confirmed = value; },
      hasSignedInCustomerDealAccount: () => true, currentSavedDealsStorageKey: () => 'guest-deals',
      setCustomerDealSavedInAccount: (...args) => { calls.push(args); return response.promise; },
      readSavedDeals: () => [], savedDealId: () => 'club:deal',
      window: { location: { href: 'https://example.invalid' }, localStorage: { setItem() { if (!succeeds) throw new Error('Storage blocked'); } } },
    });
    handlers('app/components/ClubDealCard.tsx', '  async function saveForLater()', '  async function shareDeal()', context);
    const run = () => selected ? context.removeSavedDeal() : context.saveForLater();
    const pending = run(); assert.equal(overlay.saved, !selected);
    await run(); assert.equal(calls.length, 1);
    response.resolve(succeeds); await pending;
    assert.equal(overlay, null); assert.equal(confirmed, succeeds ? !selected : selected);
    assert.equal(context.saveInFlight.current, false);
  });
}

for (const all of [false, true]) test(`Home mark ${all ? 'all' : 'one'} read updates immediately, blocks stale loads, and restores unread on failure`, async () => {
  const response = deferred(), calls = [];
  const context = vm.createContext({
    authSession: { accessToken: 'synthetic' }, notificationClearStorageKey: () => 'account', liveNotificationClearPending: null,
    liveNotificationsRequestVersion: 4, liveNotifications: [{ id: 'one' }, { id: 'two' }], liveNotificationsState: 'ready',
    renderNotificationCenters() {}, showToast() {},
    patchAuthenticatedJson: (...args) => { calls.push(args); return response.promise; },
  });
  handlers('src/live-shell/app/04-apply-live-admin-venues.js', '    async function markLiveNotificationRead(', '    async function clearAllLiveNotifications()', context);
  const run = () => all ? context.markAllLiveNotificationsRead() : context.markLiveNotificationRead('one');
  const pending = run();
  assert.equal(!!context.liveNotifications[0].readAt, true);
  assert.equal(!!context.liveNotifications[1].readAt, all);
  assert.equal(context.liveNotificationsRequestVersion, 5);
  await run(); assert.equal(calls.length, 1);
  response.reject(new Error('Failed')); await pending;
  assert.deepEqual(plain(context.liveNotifications), [{ id: 'one' }, { id: 'two' }]);
  assert.equal(context.liveNotificationClearPending, null);
});

test('a late Home read receipt cannot change another account after switching', async () => {
  const response = deferred(); let accountKey = 'first';
  const context = vm.createContext({
    authSession: { accessToken: 'synthetic' }, notificationClearStorageKey: () => accountKey, liveNotificationClearPending: null,
    liveNotificationsRequestVersion: 0, liveNotifications: [{ id: 'first-alert' }], liveNotificationsState: 'ready',
    renderNotificationCenters() {}, showToast() {}, patchAuthenticatedJson: () => response.promise,
  });
  handlers('src/live-shell/app/04-apply-live-admin-venues.js', '    async function markLiveNotificationRead(', '    async function clearAllLiveNotifications()', context);
  const pending = context.markAllLiveNotificationsRead();
  accountKey = 'second'; context.liveNotifications = [{ id: 'second-alert' }];
  response.resolve({ readAt: 'confirmed' }); await pending;
  assert.deepEqual(plain(context.liveNotifications), [{ id: 'second-alert' }]);
});

for (const selected of [false, true]) test(`Home club ${selected ? 'unfollow' : 'follow'} highlights before sign-in refresh and restores on failure`, async () => {
  const response = deferred(), attributes = new Map(), classes = new Set();
  const button = { disabled: false, dataset: { venueFollow: 'Club' },
    setAttribute: (key, value) => attributes.set(key, value), removeAttribute: key => attributes.delete(key),
    classList: { contains: key => classes.has(key), toggle: (key, enabled) => enabled ? classes.add(key) : classes.delete(key) },
  };
  const context = vm.createContext({
    event: { target: { closest: () => button }, preventDefault() {}, stopPropagation() {} },
    requireCustomerAccountForProfileAction: () => true, resolveVenueByName: () => ({ id: 'club', name: 'Club', city: 'City' }),
    citySelect: { value: 'City' }, followedVenuesByCity: { City: selected ? ['Club'] : [] }, customerSavedStateVersion: 0,
    actionButtonLabel: (_icon, label) => label,
    getAuthenticatedJson: () => response.promise, postAuthenticatedJson: () => assert.fail('Cannot save before session check'),
    showToast() {},
  });
  const source = readFileSync(new URL('../src/live-shell/app/22-create-home-tv-landing-preloader.js', import.meta.url), 'utf8');
  const first = source.indexOf('      const followVenueButton ='), last = source.indexOf('      const venueJump =', first);
  vm.runInContext(`async function run() {${source.slice(first, last)}}`, context);
  const pending = context.run();
  assert.equal(attributes.get('aria-pressed'), String(!selected));
  assert.equal(button.innerHTML, selected ? 'Follow' : 'Following');
  await context.run();
  response.reject(new Error('Unavailable')); await pending;
  assert.equal(attributes.get('aria-pressed'), String(selected));
  assert.equal(button.innerHTML, selected ? 'Following' : 'Follow');
  assert.equal(button.disabled, false);
});
