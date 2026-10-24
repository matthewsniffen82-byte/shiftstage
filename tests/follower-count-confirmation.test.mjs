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
function fixture({ following = false, count = 2, grid = false } = {}) {
  let resolve, reject;
  const response = new Promise((yes, no) => { resolve = yes; reject = no; });
  const profile = { id: "dancer-id", name: "Dancer", followerCount: count, notificationCount: count };
  const attributes = new Map();
  const modalButton = { id: "followBtn", dataset: { profile: "Dancer" }, disabled: false, innerHTML: following ? "Following" : "Follow",
    setAttribute: (key, value) => attributes.set(key, value), removeAttribute: key => attributes.delete(key),
    classList: { toggle() {} },
  };
  const gridAttributes = new Map();
  const gridButton = {
    dataset: { profile: profile.id, feedAction: "follow", iconOnlyAction: "true" }, disabled: false,
    innerHTML: following ? "check" : "personPlus",
    setAttribute: (key, value) => gridAttributes.set(key, value), removeAttribute: key => gridAttributes.delete(key),
    classList: { toggle() {} },
  };
  const button = grid ? gridButton : modalButton;
  const metric = { textContent: String(count) };
  const label = { textContent: "Followers" };
  const notices = [], requests = [], invitations = [];
  const context = vm.createContext({
    window: { dispatchEvent: event => invitations.push(event.detail.moment) },
    CustomEvent: class { constructor(type, { detail }) { this.type = type; this.detail = detail; } },
    profile, following, notifications: following, customerSavedStateVersion: 0,
    selectedCity: () => "Las Vegas", citySelect: { value: "Las Vegas" },
    document: { getElementById: id => ({ followBtn: modalButton, modalFollowerCount: metric, modalFollowerLabel: label })[id], querySelectorAll: () => [gridButton] },
    modalName: { closest: () => ({ setAttribute() {} }) },
    customerDashboard: { classList: { contains: () => false } },
    findProfile: () => profile,
    isFollowingProfile: () => context.following,
    setProfileFollowed: (_city, _name, value) => { context.following = value; },
    isNotificationOn: () => context.notifications,
    enableProfileNotifications: () => { context.notifications = true; },
    disableProfileNotifications: () => { context.notifications = false; },
    profileActionButtonMarkup: (_icon, text) => text,
    actionIconMarkup: icon => icon,
    recordLiveEvent() {}, refreshOpenProfileWorkingAlert() {}, showToast: text => notices.push(text),
    postAuthenticatedJson: (path, body) => { requests.push({ path, body }); return response; },
  });
  vm.runInContext(section("    function firstRealMetric(", "    function shiftRecipientCounts(") +
    section("    function confirmedFollowerCount(", "    async function saveProfileGoing("), context);
  return { context, profile, button, modalButton, gridButton, metric, label, attributes: grid ? gridAttributes : attributes, gridAttributes, notices, requests, invitations, resolve, reject };
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
    assert.equal(f.invitations.length, 0);
    assert.equal(f.metric.textContent, before);
    assert.equal(f.button.innerHTML, following ? "Follow" : "Following", "Personal selection updates immediately; public counts wait for confirmation");
    f.resolve({ following: !following, notificationsEnabled: !following, followerCount: following ? 1 : 2, notificationCount: following ? 1 : 2 });
    await pending;
    assert.equal(f.metric.textContent, following ? "1" : "2");
    assert.deepEqual(f.invitations, following ? [] : ["customer-follow"]);
    assert.equal(f.label.textContent, following ? "Follower" : "Followers");
    assert.equal(f.button.innerHTML, following ? "Follow" : "Following");
    assert.equal(f.gridButton.innerHTML, following ? "personPlus" : "check", "Profile actions update grid quick-follow too");

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

for (const following of [false, true]) {
  for (const fails of [false, true]) {
    test(`grid quick-${following ? "unfollow" : "follow"} ${fails ? "recovers on failure" : "saves through the profile handler"}`, async () => {
      const f = fixture({ grid: true, following });
      const pending = f.context.saveProfileFollow(f.button);
      assert.equal(f.attributes.get("aria-busy"), "true");
      assert.equal(f.button.disabled, true);
      assert.equal(f.button.innerHTML, following ? "personPlus" : "check");
      assert.equal(f.modalButton.innerHTML, following ? "Follow" : "Following");
      assert.equal(f.metric.textContent, "2", "Counts wait for confirmation");
      await f.context.saveProfileFollow(f.button);
      await f.context.saveProfileFollow(f.modalButton);
      assert.equal(f.requests.length, 1, "Neither repeated grid taps nor profile taps duplicate the pending request");
      assert.equal(f.requests[0].path, "/api/customer/follows");
      assert.equal(f.requests[0].body.dancerId, f.profile.id);
      assert.equal(f.requests[0].body.following, !following);
      assert.equal(f.requests[0].body.notificationsEnabled, !following);
      if (fails) f.reject(new Error("Could not save follow"));
      else f.resolve({ following: !following, notificationsEnabled: !following, followerCount: 2, notificationCount: 2 });
      await pending;
      const saved = fails ? following : !following;
      assert.equal(f.context.following, saved);
      assert.equal(f.button.innerHTML, saved ? "check" : "personPlus");
      assert.equal(f.attributes.get("aria-label"), `${saved ? "Following" : "Follow"} Dancer`);
      assert.equal(f.attributes.get("aria-pressed"), String(saved));
      assert.equal(f.button.title, `${saved ? "Following" : "Follow"} Dancer`);
      assert.equal(f.modalButton.innerHTML, saved ? "Following" : "Follow");
      assert.equal(f.button.disabled, false);
      assert.equal(f.attributes.has("aria-busy"), false);
    });
  }
}
