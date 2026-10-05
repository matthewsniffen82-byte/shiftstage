import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import postcss from "postcss";

const live = fs.readFileSync("outputs/index.html", "utf8");
const carousel = fs.readFileSync("app/dancers/[slug]/DancerPhotoCarousel.tsx", "utf8");
const actions = fs.readFileSync("app/dancers/[slug]/DancerProfileActions.tsx", "utf8");
const css = fs.readFileSync("public/profile-media-card-feed.css", "utf8");
const source = (name) => {
  const result = live.match(new RegExp("    function " + name + "\\([^]*?\\n    \\}"))?.[0];
  assert.ok(result, name);
  return result;
};
const button = () => ({
  dataset: {}, attributes: {}, listeners: {},
  setAttribute(key, value) { this.attributes[key] = value; },
  addEventListener(key, value) { this.listeners[key] = value; },
  closest() { return null; },
});

test("both live rails follow TV action order and keep reports in the overflow", () => {
  for (const [kind, expected] of [
    ["tv", ["data-toggle-profile-tv-sound", "data-profile-tv-follow", "data-like-profile-tv", "data-share-profile-tv", "data-profile-tv-fullscreen"]],
    ["photo", ["data-profile-photo-follow", "profile-photo-viewer-like", "profile-photo-viewer-share", "data-profile-media-fullscreen"]],
  ]) {
    const rail = live.match(new RegExp(`<div class="profile-${kind}-viewer-actions">([^]*?)</div>`))?.[1];
    assert.ok(rail);
    const positions = expected.map((control) => rail.indexOf(control));
    assert.ok(positions.every((position, index) => position >= 0 && (!index || position > positions[index - 1])));
    assert.doesNotMatch(rail, /report|previous|next/);
  }
  assert.match(carousel, /profile-media-viewer-sound[^]*?<DancerMediaFollowButton[^]*?<MediaLikeButton[^]*?profile-media-viewer-share[^]*?profile-media-control-fullscreen/);
  assert.match(actions, /mediaFollowAction\.current = \(\) => \{\s*if \(requireCustomerAccount\("follow"\)\) void updateFollow\(\)/);
  assert.match(actions, /disabled: !savedLoaded \|\| followSaving/);
});

test("sound updates all profile videos and exposes the correct accessible state", () => {
  const videos = [{ muted: true }, { muted: true }];
  const sound = button();
  const context = vm.createContext({
    profileTvViewerMuted: true,
    activeProfileTvViewerVideo: () => videos[0],
    document: { querySelector: () => sound, querySelectorAll: () => videos },
  });
  vm.runInContext(["profileTvSoundIcon", "syncProfileTvSoundControl", "toggleProfileTvSound"].map(source).join("\n"), context);
  context.toggleProfileTvSound();
  assert.ok(videos.every((video) => !video.muted));
  assert.equal(sound.attributes["aria-pressed"], "true");
  assert.equal(sound.attributes["aria-label"], "Mute video");
  assert.match(sound.innerHTML, /M15 9a4/);
  context.toggleProfileTvSound();
  assert.ok(videos.every((video) => video.muted));
  assert.equal(sound.attributes["aria-label"], "Turn sound on");
  assert.match(sound.innerHTML, /m16 9 5 5m0-5-5 5/);
});

test("expanding and collapsing preserves the selected photo or video", () => {
  const fullscreen = button();
  const classes = new Set();
  const overlay = {
    hidden: false, dataset: { videoIndex: "12", profilePhotoIndex: "8" },
    classList: { toggle(name, active) { if (active) classes.add(name); else classes.delete(name); } },
    querySelector: () => fullscreen,
    querySelectorAll: () => [fullscreen],
  };
  const selected = [];
  const context = vm.createContext({
    document: { getElementById: () => overlay },
    profilePhotoViewer: overlay,
    syncProfilePhotoViewerPosition: (index) => selected.push(["photo", index]),
    scrollProfilePhotoViewerTo: (index, options) => selected.push(["photo-scroll", index, options.instant]),
    scrollProfileTvViewerTo: (index, options) => selected.push(["video-scroll", index, options.instant]),
  });
  vm.runInContext(["setProfilePhotoFullscreen", "setProfileTvFullscreen"].map(source).join("\n"), context);
  for (const toggle of [context.setProfilePhotoFullscreen, context.setProfileTvFullscreen]) {
    toggle(true);
    assert.ok(classes.has("is-media-fullscreen"));
    assert.equal(fullscreen.attributes["aria-pressed"], "true");
    toggle(false);
    assert.equal(classes.size, 0);
    assert.equal(fullscreen.attributes["aria-pressed"], "false");
  }
  assert.deepEqual(selected, [["photo", 8], ["photo-scroll", 8, true], ["photo", 8], ["photo-scroll", 8, true], ["video-scroll", 12, true], ["video-scroll", 12, true]]);
});

test("photo rail actions and reports target their own card after scrolling", () => {
  const nodes = new Map();
  const slide = { querySelector(selector) {
    if (!nodes.has(selector)) nodes.set(selector, button());
    return nodes.get(selector);
  } };
  const calls = [];
  let customerAllowed = false;
  const context = vm.createContext({
    profilePhotoViewer: { dataset: { publicDancerId: "dancer-id" } },
    profileMediaCardControls: () => [],
    closeProfileMediaOptions() {},
    modalGallery: { dataset: { profileMediaProfile: "dancer-id" } },
    actionIconMarkup: (icon) => icon,
    findProfile: () => null,
    requireCustomerAccountForProfileAction: () => customerAllowed,
    saveProfileFollow: (control) => calls.push(["follow", control.dataset.profile]),
    togglePublicMediaLike: (kind, id) => calls.push(["like", kind, id]),
    preparePublicMediaLikeButton() {},
    shareProfilePhoto: (index) => calls.push(["share", index]),
    isReportableContentId: () => true,
    prepareContentReportButton() {},
    openContentReportDialog: (target) => calls.push(["report", target.targetType, target.targetId, target.targetLabel]),
  });
  vm.runInContext(source("mountProfilePhotoCardControls"), context);
  context.mountProfilePhotoCardControls(slide, { id: "photo-7" }, 7, 30, "Star");
  const click = (selector) => nodes.get(selector).listeners.click({ preventDefault() {}, stopPropagation() {} });
  click("[data-profile-photo-follow]");
  assert.equal(calls.length, 0, "the account gate prevents unauthenticated follows");
  customerAllowed = true;
  click("[data-profile-photo-follow]");
  click(".profile-photo-viewer-like");
  click(".profile-photo-viewer-share");
  click(".profile-photo-viewer-report");
  assert.deepEqual(calls, [["follow", "dancer-id"], ["like", "photo", "photo-7"], ["share", 7], ["report", "profile_photo", "photo-7", "Star profile photo 8"]]);
});

test("profile rails retain TV dimensions, spacing and glass material", () => {
  const root = postcss.parse(css);
  const rail = root.nodes.find((node) => node.type === "rule" && node.selector === ".profile-media-card-feed :is(.profile-photo-viewer-actions, .profile-tv-viewer-actions, .profile-media-viewer-actions)");
  const values = Object.fromEntries(rail.nodes.map((node) => [node.prop, node.value]));
  assert.equal(values.width, "46px");
  assert.equal(values.gap, "6px");
  assert.equal(values.bottom, "144px");
  assert.match(css, /background-color: rgba\(18, 18, 28, 0\.38\)/);
  assert.match(css, /backdrop-filter: blur\(16px\) saturate\(1\.18\)/);
});
