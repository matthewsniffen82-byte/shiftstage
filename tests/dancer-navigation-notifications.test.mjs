import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const home = readFileSync(new URL("../outputs/index.html", import.meta.url), "utf8");
function declaration(name) {
  const start = home.indexOf(`    function ${name}(`);
  assert.ok(start >= 0, name);
  return home.slice(start, home.indexOf("\n    }", start) + 6);
}
function element() {
  return { hidden: false, innerHTML: "", textContent: "", attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; } };
}
function fixture(role, notifications) {
  const list = element(), badge = element(), button = element();
  const context = vm.createContext({
    liveNotifications: notifications, liveNotificationsState: "ready",
    isDancerSession: () => role === "dancer", isVenueSession: () => role === "venue",
    visibleLiveNotifications: () => notifications,
    customerNotificationsQuickList: list, customerNotificationQuickCount: badge,
    customerNotificationQuickBtn: button, displayText: String, formatBillingDate: () => "",
  });
  for (const name of ["visibleNavigationNotifications", "customerQuickNotificationItems",
    "renderCustomerQuickNotifications", "notificationFromNode"]) {
    vm.runInContext(declaration(name), context);
  }
  context.renderCustomerQuickNotifications();
  return { context, list, badge, button };
}
const approvalNotices = [
  { id: "profile", type: "approval_status", title: "Your Dancr profile is live", payload: { status: "approved" } },
  { id: "photo", type: "approval_status", title: "Photo approved", payload: { status: "approved", targetType: "photo" } },
  { id: "video", type: "tv_video_status", title: "MyDancr TV video approved", payload: { status: "approved" } },
  { id: "", localOnly: true, type: "approval_status", title: "Your Dancr profile is live", payload: { status: "approved" } },
  { id: "review", type: "approval_status", title: "Photo needs changes", payload: { status: "rejected", targetType: "photo" } },
  { id: "video-review", type: "tv_video_status", title: "MyDancr TV video needs changes", payload: { status: "rejected" } },
];

test("dancer navigation excludes media and profile approval notices from the menu and unread badge", () => {
  const f = fixture("dancer", approvalNotices);
  assert.match(f.list.innerHTML, /No new alerts yet/);
  assert.doesNotMatch(f.list.innerHTML, /customer-quick-item/);
  assert.equal(f.badge.hidden, true);
  assert.equal(f.badge.textContent, "0");
  assert.equal(f.button.attributes["aria-label"], "Open notifications");
  assert.equal(f.context.liveNotifications.length, approvalNotices.length, "the account inbox retains its approval records");
});

test("approval notices do not crowd out other dancer alerts or inflate their unread count", () => {
  const updates = Array.from({ length: 7 }, (_, i) => ({
    id: `update-${i}`, type: "engagement", title: `New follower ${i}`, readAt: i === 0 ? "2026-09-16" : null,
  }));
  const f = fixture("dancer", [...approvalNotices, ...updates]);
  assert.deepEqual(Array.from(f.context.customerQuickNotificationItems(), item => item.id), updates.slice(0, 5).map(item => item.id));
  assert.doesNotMatch(f.list.innerHTML, /approved|needs changes|profile is live/);
  assert.equal(f.badge.hidden, false);
  assert.equal(f.badge.textContent, "6", "unread count includes alerts beyond the five displayed rows");
  assert.equal(f.button.attributes["aria-label"], "Open notifications, 6 unread");
});

test("a remaining local alert still opens the correct record after approval notices are hidden", () => {
  const localNotice = { id: "", localOnly: true, title: "Account update" };
  const f = fixture("dancer", [...approvalNotices, localNotice]);
  const index = f.list.innerHTML.match(/data-notification-index="(\d+)"/)[1];
  assert.equal(f.context.notificationFromNode({ dataset: { notificationIndex: index } }), localNotice);
});

for (const role of ["venue", "customer"]) {
  test(`${role} navigation keeps its approval notices and unread badge`, () => {
    const notices = approvalNotices.slice(0, 3);
    const f = fixture(role, notices);
    assert.deepEqual(Array.from(f.context.customerQuickNotificationItems(), item => item.id), notices.map(item => item.id));
    assert.equal(f.badge.hidden, false);
    assert.equal(f.badge.textContent, "3");
  });
}
