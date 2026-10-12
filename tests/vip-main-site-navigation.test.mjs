import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { BROWSER_AUTH_SESSION_KEY, rememberVipDashboard, persistBrowserAuthSession, persistRefreshedBrowserAuthSession, clearBrowserAuthSession, readBrowserAuthSession } from '../src/lib/dancr/browser-session.ts';
import { dashboardHarness, state, guest, venues } from './helpers/vip-dashboard-fixture.mjs';

const venueId = '97000000-0000-4000-8000-000000000020';
const secondVenueId = '97000000-0000-4000-8000-000000000021';
const session = () => ({ accessToken: 'vip-access', refreshToken: 'vip-refresh', account: { id: guest.id, role: 'customer' } });
const home = readFileSync(new URL('../outputs/index.html', import.meta.url), 'utf8');

function withStorage(run) {
  const previous = globalThis.window, storage = new Map();
  globalThis.window = { localStorage: {
    get length() { return storage.size; }, key: index => [...storage.keys()][index],
    getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key),
  }, navigator: {} };
  try { return run(storage); } finally { globalThis.window = previous; }
}

function shell(currentSession) {
  const navigations = [], signIns = [];
  const element = () => ({ hidden: false, textContent: '', classList: { toggle() {} }, setAttribute(key, value) { this[key] = value; }, removeAttribute(key) { delete this[key]; } });
  const context = vm.createContext({ authSession: currentSession, activeDashboardType: currentSession?.account?.role || 'customer',
    document: { getElementById: () => null },
    isCustomerLoggedIn: currentSession?.account?.role === 'customer', isDancerLoggedIn: currentSession?.account?.role === 'dancer', isVenueLoggedIn: currentSession?.account?.role === 'venue',
    dashboardBtn: element(), accountBtn: element(), adminBtn: element(), sessionMenuEnd: element(), guestMenuBtn: element(),
    accountIconMarkup: () => '', renderCustomerQuickActions() {}, closeUtilityMenu() {}, hideAccountTooltip() {},
    openAuthRole: role => signIns.push(role), loadAuthSession: () => readBrowserAuthSession(),
    window: { location: { assign: href => navigations.push(href), reload: () => assert.fail('Same-account VIP navigation must not reload the page') } },
  });
  for (const name of ['vipDashboardHref', 'updateAccountHeader', 'openUnifiedDashboard', 'openDashboard', 'browserAccountIdentity', 'refreshBrowserAccountView']) {
    const source = home.match(new RegExp(`    function ${name}\\([\\s\\S]*?\\n    }`))?.[0];
    assert.ok(source, name); vm.runInContext(source, context);
  }
  context.visibleAuthAccountIdentity = context.browserAccountIdentity(currentSession);
  return { context, navigations, signIns };
}

test('the public menu has no VIP dashboard shortcut while Login / Join retains VIP sign-in', () => {
  assert.doesNotMatch(home, /vipDashboardLink/);
  assert.match(home, /id="vipSignInLink" href="\/vip">VIP sign in<\/a>/);
  const signedOut = shell(null); signedOut.context.updateAccountHeader();
  assert.equal(signedOut.context.dashboardBtn.hidden, true);
  assert.equal(signedOut.context.guestMenuBtn.hidden, false);
  assert.equal(signedOut.context.accountBtn.innerHTML, 'Login / Join');
});

test('a verified VIP visit survives the main site, token refresh and Back with a VIP dashboard menu', () => withStorage(() => {
  persistBrowserAuthSession(session());
  const oldHome = shell(readBrowserAuthSession()); oldHome.context.updateAccountHeader();
  assert.equal(oldHome.context.dashboardBtn.textContent, 'Guest dashboard');
  assert.equal(oldHome.context.dashboardBtn.hidden, false);
  assert.equal(rememberVipDashboard(guest.id, venueId), true);
  const saved = readBrowserAuthSession();
  assert.equal(saved.account.role, 'customer');
  assert.deepEqual(saved.vipNavigation, { accountId: guest.id, venueId });
  assert.equal(persistRefreshedBrowserAuthSession({ accessToken: 'rotated-access' }, saved), true);
  assert.deepEqual(readBrowserAuthSession().vipNavigation, saved.vipNavigation);
  assert.equal(oldHome.context.refreshBrowserAccountView(), false);
  assert.equal(oldHome.context.dashboardBtn.textContent, 'VIP dashboard');
  assert.equal(oldHome.context.dashboardBtn.hidden, false);
  assert.equal(oldHome.context.accountBtn.title, 'VIP account');
  oldHome.context.openDashboard();
  assert.deepEqual(oldHome.navigations, [`/vip?venueId=${venueId}`]);
  const newHome = shell(readBrowserAuthSession()); newHome.context.openUnifiedDashboard('customer');
  assert.deepEqual(newHome.navigations, [`/vip?venueId=${venueId}`]);
  // Explicit guest account features remain reachable from VIP account settings.
  newHome.context.openUnifiedDashboard('customer', 'customer-support');
  assert.equal(newHome.navigations.at(-1), '/dashboard/customer#customer-support');
  rememberVipDashboard(guest.id, secondVenueId);
  oldHome.context.refreshBrowserAccountView(); oldHome.context.openDashboard();
  assert.equal(oldHome.navigations.at(-1), `/vip?venueId=${secondVenueId}`);
}));

test('revocation, logout, other accounts and other roles cannot reuse a VIP navigation preference', () => withStorage(() => {
  persistBrowserAuthSession(session()); rememberVipDashboard(guest.id, venueId);
  const home = shell(readBrowserAuthSession());
  rememberVipDashboard(guest.id, ''); home.context.refreshBrowserAccountView(); home.context.openDashboard();
  assert.equal(home.context.dashboardBtn.textContent, 'Guest dashboard'); assert.equal(home.navigations.at(-1), '/dashboard/customer');
  rememberVipDashboard(guest.id, venueId); clearBrowserAuthSession();
  assert.equal(readBrowserAuthSession(), null); assert.equal(rememberVipDashboard(guest.id, venueId), false);
  const signedOut = shell(null); signedOut.context.updateAccountHeader(); signedOut.context.openUnifiedDashboard('customer');
  assert.equal(signedOut.context.dashboardBtn.hidden, true);
  assert.equal(signedOut.context.accountBtn.innerHTML, 'Login / Join');
  assert.deepEqual(signedOut.signIns, ['customer']); assert.deepEqual(signedOut.navigations, []);
  for (const role of ['customer', 'dancer', 'venue']) {
    const current = { ...session(), account: { id: 'another-account', role }, vipNavigation: { accountId: guest.id, venueId } };
    persistBrowserAuthSession(current); assert.equal(rememberVipDashboard(guest.id, venueId), false);
    const page = shell(readBrowserAuthSession()); page.context.updateAccountHeader(); page.context.openUnifiedDashboard(role);
    assert.equal(page.context.dashboardBtn.hidden, false);
    assert.equal(page.context.dashboardBtn.textContent, `${role === 'customer' ? 'Guest' : role === 'dancer' ? 'Dancer' : 'Venue'} dashboard`);
    assert.equal(page.navigations.at(-1), `/dashboard/${role}`);
    if (role !== 'customer') assert.equal(rememberVipDashboard('another-account', venueId), false);
  }
}));

test('navigation hints reject malformed venues and cannot overwrite a newer account', () => withStorage(storage => {
  persistBrowserAuthSession(session());
  for (const value of ['//evil.test', '/dashboard/venue', `${venueId}#elsewhere`, null, {}, 3]) {
    assert.equal(rememberVipDashboard(guest.id, value), false);
    const page = shell({ ...session(), vipNavigation: { accountId: guest.id, venueId: value } });
    assert.equal(page.context.vipDashboardHref(), '');
  }
  const newer = { ...session(), account: { id: 'new-account', role: 'customer' } };
  let reads = 0;
  window.localStorage.getItem = key => {
    if (key === BROWSER_AUTH_SESSION_KEY && ++reads === 2) storage.set(key, JSON.stringify(newer));
    return storage.get(key) ?? null;
  };
  assert.equal(rememberVipDashboard(guest.id, venueId), false);
  assert.deepEqual(JSON.parse(storage.get(BROWSER_AUTH_SESSION_KEY)), newer);
  window.localStorage.getItem = () => { throw Error('Storage unavailable'); };
  assert.equal(rememberVipDashboard(guest.id, venueId), false);
}));

test('the VIP dashboard remembers only verified venues and clears revoked access without losing transient returns', async () => {
  let result = state(), failure;
  const ui = dashboardHarness({ request: async () => { if (failure) throw failure; return result; } });
  assert.equal(ui.vipNavigation.length, 0); await ui.settle();
  assert.deepEqual(ui.vipNavigation.at(-1), { accountId: guest.id, venueId: venues[0].id });
  failure = new Error('Temporary outage'); ui.navigate('requests'); await ui.settle();
  assert.equal(ui.vipNavigation.length, 1);
  failure = Object.assign(new Error('Access revoked'), { status: 403 }); ui.navigate('account'); await ui.settle();
  assert.deepEqual(ui.vipNavigation.at(-1), { accountId: guest.id, venueId: '' });
  failure = null; result = state('', { venues: [] }); ui.navigate('overview'); await ui.settle();
  assert.deepEqual(ui.vipNavigation.at(-1), { accountId: guest.id, venueId: '' }); ui.unmount();
});

test('a delayed VIP read from a previous account cannot set the main-site destination', async () => {
  let resolve;
  const ui = dashboardHarness({ request: () => new Promise(done => { resolve = done; }) });
  ui.session({ id: 'different-account', role: 'customer' }); resolve(state()); await ui.settle();
  assert.equal(ui.vipNavigation.length, 0); ui.unmount();
});
