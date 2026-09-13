import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const home = readFileSync(new URL("../outputs/index.html", import.meta.url), "utf8");
function declaration(name) {
  const start = home.search(new RegExp(`    (?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  return home.slice(start, home.indexOf("\n    }", start) + 6);
}
function element() {
  return { hidden: true, innerHTML: "", classList: { add() {}, remove() {} }, setAttribute() {} };
}
function fixture() {
  const requests = [], toasts = [], session = { accessToken: "synthetic-venue-token", account: { id: "venue-a", role: "venue" } };
  let respond = () => Response.json({ ok: true, notifications: [] });
  const context = vm.createContext({
    authSession: session, liveNotifications: [], liveNotificationsState: "loading",
    liveNotificationsRequestVersion: 0, liveNotificationClearPending: null,
    customerNotificationsQuickPanel: element(), customerDealsQuickPanel: element(),
    customerNotificationQuickBtn: element(), customerDealQuickBtn: element(),
    customerNotificationsQuickList: element(), customerNotificationQuickCount: element(),
    authenticatedRequestHeaders: () => ({ Authorization: `Bearer ${session.accessToken}` }),
    fetchWithTimeout: async (url, options) => { requests.push({ url, options }); return respond(); },
    applyResponseSession() {}, isVisibleAfterNotificationClear: () => true,
    visibleLiveNotifications: () => context.liveNotifications,
    customerQuickNotificationItems: () => [],
    renderNotificationCenters: () => context.renderCustomerQuickNotifications(),
    showToast: message => toasts.push(message),
  });
  for (const name of ["isCustomerSession", "isDancerSession", "isVenueSession", "notificationClearStorageKey",
    "getAuthenticatedJson", "loadLiveNotifications", "closeCustomerQuickPanels", "toggleCustomerQuickPanel",
    "renderCustomerQuickNotifications", "notificationCenterMarkup"]) {
    vm.runInContext(declaration(name), context);
  }
  return { context, requests, toasts, respond: fn => { respond = fn; } };
}

for (const status of [401, 403, 503, "network"]) {
  test(`venue homepage refresh keeps notification ${status} failures inside the notification panel`, async () => {
    const f = fixture();
    f.respond(() => {
      if (status === "network") throw new Error("Failed to fetch");
      return Response.json({ ok: false, error: "This account cannot access this feature." }, { status });
    });
    // Run the homepage's actual automatic notification request, without a user click.
    const startup = home.match(/    if \(authSession\?\.accessToken\) loadLiveNotifications\(\);/);
    assert.ok(startup);
    await vm.runInContext(startup[0], f.context);
    assert.deepEqual(f.requests.map(request => request.url), ["/api/notifications"]);
    assert.equal(f.context.liveNotificationsState, "error");
    assert.match(f.context.customerNotificationsQuickList.innerHTML, /Notifications .*unavailable|Notifications .*loaded/);
    assert.match(f.context.notificationCenterMarkup(), /Notifications .*unavailable|Notifications .*loaded/);
    assert.deepEqual(f.toasts, [], "an optional background read must not interrupt public browsing");
    assert.equal(f.context.authSession.account.role, "venue");
  });
}

test("an active venue session still loads its notifications with authentication", async () => {
  const f = fixture();
  const notice = { id: "notice-a", title: "Venue update", readAt: null };
  f.respond(() => Response.json({ ok: true, notifications: [notice] }));
  await f.context.loadLiveNotifications();
  assert.equal(f.requests[0].options.headers.Authorization, "Bearer synthetic-venue-token");
  assert.equal(f.context.liveNotificationsState, "ready");
  assert.equal(f.context.liveNotifications[0].id, notice.id);
  assert.deepEqual(f.toasts, []);
});

test("opening a failed notification panel retries once and recovers without duplicate requests", async () => {
  const f = fixture();
  f.context.liveNotificationsState = "error";
  let resolve;
  f.respond(() => new Promise(done => { resolve = done; }));
  f.context.toggleCustomerQuickPanel("notifications");
  assert.equal(f.requests.length, 1);
  assert.equal(f.context.liveNotificationsState, "loading");
  f.context.toggleCustomerQuickPanel("notifications");
  f.context.toggleCustomerQuickPanel("notifications");
  assert.equal(f.requests.length, 1, "reopening during a pending retry must not duplicate the request");
  resolve(Response.json({ ok: true, notifications: [] }));
  await new Promise(done => setImmediate(done));
  assert.equal(f.context.liveNotificationsState, "ready");
  assert.deepEqual(f.toasts, []);
});

test("opening a ready notification panel does not request data again", () => {
  const f = fixture();
  f.context.liveNotificationsState = "ready";
  f.context.toggleCustomerQuickPanel("notifications");
  assert.equal(f.requests.length, 0);
});
