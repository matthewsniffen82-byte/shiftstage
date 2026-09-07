import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

const home = readFileSync(new URL("../outputs/index.html", import.meta.url), "utf8");
function section(start, end) {
  const first = home.indexOf(start), last = home.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first);
  return home.slice(first, last);
}
function fixture({ following = false, count = 2 } = {}) {
  let resolve, reject;
  const response = new Promise((yes, no) => { resolve = yes; reject = no; });
  const profile = { id: "dancer-id", name: "Dancer", followerCount: count, notificationCount: count };
  const attributes = new Map();
  const button = { id: "followBtn", dataset: { profile: "Dancer" }, disabled: false, innerHTML: following ? "Following" : "Follow",
    setAttribute: (key, value) => attributes.set(key, value), removeAttribute: key => attributes.delete(key),
    classList: { toggle() {} },
  };
  const metric = { textContent: String(count) };
  const label = { textContent: "Followers" };
  const notices = [], requests = [];
  const context = vm.createContext({
    profile, following, notifications: following, customerSavedStateVersion: 0,
    selectedCity: () => "Las Vegas", citySelect: { value: "Las Vegas" },
    document: { getElementById: id => ({ followBtn: button, modalFollowerCount: metric, modalFollowerLabel: label })[id], querySelectorAll: () => [] },
    modalName: { closest: () => ({ setAttribute() {} }) },
    customerDashboard: { classList: { contains: () => false } },
    findProfile: () => profile,
    isFollowingProfile: () => context.following,
    setProfileFollowed: (_city, _name, value) => { context.following = value; },
    isNotificationOn: () => context.notifications,
    enableProfileNotifications: () => { context.notifications = true; },
    disableProfileNotifications: () => { context.notifications = false; },
    profileActionButtonMarkup: (_icon, text) => text,
    recordLiveEvent() {}, showToast: text => notices.push(text),
    postAuthenticatedJson: (path, body) => { requests.push({ path, body }); return response; },
  });
  vm.runInContext(section("    function firstRealMetric(", "    function shiftRecipientCounts(") +
    section("    function confirmedFollowerCount(", "    async function saveProfileGoing("), context);
  return { context, profile, button, metric, label, attributes, notices, requests, resolve, reject };
}

for (const action of ["saveProfileFollow", "saveProfileNotifications"]) {
  test(`${action}: a saved follow whose status loads late never displays an extra follower`, async () => {
    const f = fixture();
    const pending = f.context[action](f.button);
    assert.equal(f.metric.textContent, "2");
    assert.equal(f.profile.followerCount, 2);
    assert.equal(f.context.following, false, "Do not claim a saved change before confirmation");
    assert.equal(f.attributes.get("aria-busy"), "true");
    await f.context[action](f.button);
    assert.equal(f.requests.length, 1, "Repeated taps cannot submit a duplicate request");
    f.resolve({ following: true, notificationsEnabled: true, followerCount: 2, notificationCount: 2 });
    await pending;
    assert.equal(f.metric.textContent, "2");
    assert.equal(f.context.following, true);
    assert.equal(f.button.disabled, false);
    assert.equal(f.attributes.has("aria-busy"), false);
  });
}

for (const following of [false, true]) {
  test(`a real ${following ? "unfollow" : "follow"} displays the confirmed total and leaves it unchanged on failure`, async () => {
    const f = fixture({ following, count: following ? 2 : 1 });
    const before = f.metric.textContent;
    const pending = f.context.saveProfileFollow(f.button);
    assert.equal(f.metric.textContent, before);
    assert.equal(f.button.innerHTML, following ? "Following" : "Follow");
    f.resolve({ following: !following, notificationsEnabled: !following, followerCount: following ? 1 : 2, notificationCount: following ? 1 : 2 });
    await pending;
    assert.equal(f.metric.textContent, following ? "1" : "2");
    assert.equal(f.label.textContent, following ? "Follower" : "Followers");
    assert.equal(f.button.innerHTML, following ? "Follow" : "Following");

    const failed = fixture({ following, count: 2 });
    const failing = failed.context.saveProfileFollow(failed.button);
    failed.reject(new Error("Could not save follow"));
    await failing;
    assert.equal(failed.metric.textContent, "2");
    assert.equal(failed.context.following, following);
    assert.equal(failed.button.innerHTML, following ? "Following" : "Follow");
    assert.equal(failed.button.disabled, false);
    assert.equal(failed.notices.at(-1), "Could not save follow");
  });
}
