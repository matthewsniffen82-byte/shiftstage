import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const home = readFileSync(new URL("../outputs/index.html", import.meta.url), "utf8");
const oldNotice = { id: "old", title: "Ivy is working now", body: "Silver Circuit", createdAt: "2026-09-07T12:00:00Z", readAt: null };
const clearTime = Date.parse("2026-09-07T12:01:00Z");
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function sourceBetween(start, end) {
  const first = home.indexOf(start), last = home.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first);
  return home.slice(first, last);
}
function element() {
  return { hidden: false, textContent: "", innerHTML: "", disabled: false, attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; } };
}
function fixture(storage = new Map()) {
  const pendingDelete = deferred(), calls = [], toasts = [];
  let now = clearTime, load = async () => ({ notifications: [] });
  const button = element(), list = element(), badge = element();
  const context = vm.createContext({
    authSession: { accessToken: "test-token", account: { id: "customer-a", role: "customer" } },
    liveNotifications: [oldNotice], liveNotificationsState: "ready",
    liveNotificationsRequestVersion: 0, liveNotificationClearPending: null,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    Date: class extends Date { static now() { return now; } },
    document: { querySelectorAll: () => [button], getElementById: () => null },
    customerNotificationList: element(), dancerNotificationList: element(),
    customerNotificationsQuickList: list, customerNotificationQuickCount: badge,
    customerNotificationQuickBtn: element(),
    isDancerSession: () => false, isVenueSession: () => false,
    displayText: String, formatBillingDate: () => "",
    followedProfiles: () => { throw new Error("Saved profiles must not regenerate notification rows"); },
    followedVenues: () => { throw new Error("Saved clubs must not regenerate notification rows"); },
    notificationCenterMarkup: () => context.liveNotifications.length ? "notifications" : "empty",
    renderCustomerQuickActions: () => context.renderCustomerQuickNotifications(),
    getAuthenticatedJson: (...args) => { calls.push({ method: "GET" }); return load(...args); },
    authenticatedRequestHeaders: () => ({ Authorization: "Bearer test-token" }),
    fetchWithTimeout: (url, options, timeoutMs) => {
      calls.push({ url, ...options, timeoutMs });
      return pendingDelete.promise;
    },
    showToast: message => toasts.push(message),
  });
  for (const [start, end] of [
    ["    function notificationClearStorageKey()", "    function notificationCenterMarkup()"],
    ["    function renderNotificationCenters()", "    function isActionableDancerReviewNotification("],
    ["    function customerQuickNotificationItems()", "    function renderCustomerQuickDeals()"],
    ["    async function loadLiveNotifications()", "    async function markLiveNotificationRead("],
    ["    async function clearAllLiveNotifications()", "    function handleNotificationCenterClick("],
  ]) vm.runInContext(sourceBetween(start, end), context);
  context.renderNotificationCenters();
  return { context, button, list, badge, storage, pendingDelete, calls, toasts,
    setLoad: fn => { load = fn; }, setNow: value => { now = value; },
    ids: () => Array.from(context.liveNotifications, item => item.id) };
}
const success = () => Response.json({ ok: true, count: 1 });

test("an empty notification menu stays empty instead of generating rows from follows and favorites", () => {
  const f = fixture();
  f.context.liveNotifications = [];
  f.context.renderNotificationCenters();
  assert.equal(f.context.customerQuickNotificationItems().length, 0);
  assert.match(f.list.innerHTML, /role="status".*No new alerts yet/);
  assert.equal(f.badge.hidden, true);
});

test("Clear removes rows and unread count before the server responds and prevents duplicate submissions", async () => {
  const f = fixture();
  const clearing = f.context.clearAllLiveNotifications();
  assert.deepEqual(f.ids(), []);
  assert.match(f.list.innerHTML, /No new alerts yet/);
  assert.equal(f.badge.hidden, true);
  assert.equal(f.badge.textContent, "0");
  assert.equal(f.button.disabled, true);
  assert.equal(f.button.attributes["aria-busy"], "true");
  assert.equal(f.storage.size, 0);
  assert.deepEqual(f.toasts, []);
  await f.context.clearAllLiveNotifications();
  await f.context.loadLiveNotifications();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].method, "DELETE");
  assert.equal(f.calls[0].timeoutMs, 15000);
  f.pendingDelete.resolve(success());
  await clearing;
  assert.equal(f.button.attributes["aria-busy"], "false");
  assert.equal(f.button.disabled, true);
  assert.equal(f.toasts.at(-1), "Notifications cleared");
});

for (const failure of ["server", "network"]) {
  test(`a ${failure} failure restores notifications and allows Clear to be retried`, async () => {
    const f = fixture();
    const clearing = f.context.clearAllLiveNotifications();
    if (failure === "server") f.pendingDelete.resolve(Response.json({ ok: false, error: "Try again" }, { status: 503 }));
    else f.pendingDelete.reject(new Error("Connection lost"));
    await clearing;
    assert.deepEqual(f.ids(), ["old"]);
    assert.match(f.list.innerHTML, /Ivy is working now/);
    assert.equal(f.badge.hidden, false);
    assert.equal(f.button.disabled, false);
    assert.equal(f.button.attributes["aria-busy"], "false");
    assert.equal(f.context.liveNotificationClearPending, null);
    assert.equal(f.storage.size, 0);
    assert.notEqual(f.toasts.at(-1), "Notifications cleared");
  });
}

for (const outcome of ["success", "error"]) {
  test(`a notification read started before Clear cannot overwrite the empty state on ${outcome}`, async () => {
    const f = fixture(), read = deferred();
    f.setLoad(() => read.promise);
    const loading = f.context.loadLiveNotifications();
    const clearing = f.context.clearAllLiveNotifications();
    assert.equal(f.context.liveNotificationsState, "ready");
    if (outcome === "success") read.resolve({ notifications: [oldNotice] });
    else read.reject(new Error("Old read failed"));
    await loading;
    assert.deepEqual(f.ids(), []);
    assert.equal(f.context.liveNotificationsState, "ready");
    assert.deepEqual(f.toasts, []);
    f.pendingDelete.resolve(success());
    await clearing;
  });
}

test("the successful clear cutoff survives reload and preserves notifications newer than the click", async () => {
  const f = fixture();
  const clearing = f.context.clearAllLiveNotifications();
  f.setNow(clearTime + 60000);
  f.pendingDelete.resolve(success());
  await clearing;
  assert.equal(f.storage.get(f.context.notificationClearStorageKey()), String(clearTime));
  const fresh = { ...oldNotice, id: "new", title: "New shift", createdAt: new Date(clearTime + 1000).toISOString() };
  const reloaded = fixture(f.storage);
  reloaded.setLoad(async () => ({ notifications: [fresh, oldNotice] }));
  await reloaded.context.loadLiveNotifications();
  assert.deepEqual(reloaded.ids(), ["new"]);
  assert.match(reloaded.list.innerHTML, /New shift/);
  assert.doesNotMatch(reloaded.list.innerHTML, /Ivy is working now/);
});

for (const outcome of ["success", "error"]) {
  test(`a late clear ${outcome} cannot change another account's notifications or cutoff`, async () => {
    const f = fixture();
    const clearing = f.context.clearAllLiveNotifications();
    f.context.authSession = { accessToken: "other-token", account: { id: "customer-b", role: "customer" } };
    f.context.liveNotifications = [{ ...oldNotice, id: "other-account" }];
    f.context.renderNotificationCenters();
    if (outcome === "success") f.pendingDelete.resolve(success());
    else f.pendingDelete.reject(new Error("Old account request failed"));
    await clearing;
    assert.deepEqual(f.ids(), ["other-account"]);
    assert.equal(f.storage.size, 0);
    assert.deepEqual(f.toasts, []);
  });
}
