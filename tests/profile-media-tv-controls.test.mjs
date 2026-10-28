import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import postcss from "postcss";
import mediaFullscreen from "../public/profile-media-fullscreen.js";

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
  assert.match(actions, /mediaFollowAction\.current = \(\) => \{\s*if \(!preview && requireCustomerAccount\("follow"\)\) void updateFollow\(\)/);
  assert.match(actions, /disabled: preview \|\| !savedLoaded \|\| followSaving/);
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
    isConnected: true,
    ownerDocument: { addEventListener() {}, removeEventListener() {} },
    addEventListener() {}, removeEventListener() {},
    hidden: false, dataset: { videoIndex: "12", profilePhotoIndex: "8" },
    classList: { toggle(name, active) { if (active) classes.add(name); else classes.delete(name); } },
    querySelector: () => fullscreen,
    querySelectorAll: () => [fullscreen],
  };
  const selected = [];
  const context = vm.createContext({
    document: { getElementById: () => overlay },
    window: { MyDancrMediaFullscreen: mediaFullscreen },
    profilePhotoViewer: overlay,
    syncProfilePhotoViewerPosition: (index) => selected.push(["photo", index]),
    scrollProfilePhotoViewerTo: (index, options) => selected.push(["photo-scroll", index, options.instant]),
    scrollProfileTvViewerTo: (index, options) => selected.push(["video-scroll", index, options.instant]),
  });
  vm.runInContext(["profileMediaFullscreenController", "setProfilePhotoFullscreen", "setProfileTvFullscreen"].map(source).join("\n"), context);
  for (const toggle of [context.setProfilePhotoFullscreen, context.setProfileTvFullscreen]) {
    overlay.profileFullscreenController?.dispose();
    delete overlay.profileFullscreenController;
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
    renderProfileMediaIdentity() {},
    closeProfilePhotoViewer() {},
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
  context.mountProfilePhotoCardControls(slide, { id: "photo-7" }, 7, "Star");
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
  assert.equal(values.bottom, "var(--dancr-media-actions-bottom, 92px)");
  assert.match(css, /background-color: rgba\(18, 18, 28, 0\.38\)/);
  assert.match(css, /backdrop-filter: blur\(16px\) saturate\(1\.18\)/);
});

test("public media action icons stay neutral while preserving text and reaction colors", () => {
  const root = postcss.parse(css);
  const rules = [];
  root.walkRules((rule) => {
    if (rule.parent.type === "atrule" && rule.parent.params === "dancr-follow-controls") rules.push(rule);
  });
  const values = (rule) => Object.fromEntries(rule.nodes.map((node) => [node.prop, node.value]));
  const normal = rules.find((rule) => values(rule)["--public-media-icon-color"]?.startsWith("var("));
  assert.ok(normal);
  assert.equal(values(normal)["--public-media-icon-color"], "var(--dancr-color-text-primary)");
  assert.equal(values(normal).color, "#f5f2fa", "labels and counts keep their neutral text color");
  assert.equal(values(normal).background, "rgba(0, 0, 0, .45)");
  assert.equal(values(normal)["box-shadow"], "0 2px 8px rgba(0, 0, 0, .24)");
  for (const target of ["#results.home-tv-feed", "#profilePhotoViewer.profile-media-card-feed",
    "#profileTvViewer.profile-media-card-feed", ".public-profile-shell[data-public-profile-page] .profile-media-viewer.profile-media-card-feed",
    ".home-tv-feed-actions > .home-tv-feed-action", ".profile-photo-viewer-actions > button",
    ".profile-tv-viewer-actions > button", ".profile-media-viewer-actions > button"]) assert.ok(normal.selector.includes(target), target);
  assert.doesNotMatch(normal.selector, /:not\(:disabled\)|:not\(\[aria-disabled/, "saving a like must not restore the legacy inset rings");
  const icons = rules.find((rule) => values(rule).color === "var(--public-media-icon-color)");
  assert.ok(icons.selector.endsWith(":is(.action-icon, svg)"));
  assert.ok(icons.nodes.find((node) => node.prop === "color").important);
  const follow = rules.find((rule) => rule.selector.includes('.profile-media-control-follow)[aria-pressed="true"]'));
  const like = rules.find((rule) => rule.selector.includes('.profile-media-viewer-like)[aria-pressed="true"]'));
  assert.equal(values(follow)["--public-media-icon-color"], "#fff");
  assert.equal(values(follow).background, "rgba(0, 0, 0, .45)");
  assert.equal(values(like)["--public-media-icon-color"], "#ff304f");
  assert.doesNotMatch(like.selector, /:not\(:disabled\)|:not\(\[aria-disabled/, "the optimistic liked heart keeps its color while saving");
  const overflow = rules.find((rule) => rule.selector.includes(".profile-media-control-overflow"));
  assert.equal(values(overflow).color, "var(--dancr-color-text-primary)");
});

test("media button borders stay invisible in every state without changing transparency or focus rings", () => {
  const root = postcss.parse(css);
  const borders = [];
  root.walkDecls(/^border(?!.*radius)/, (decl) => {
    if (decl.parent.parent.type === "atrule" && decl.parent.parent.params === "dancr-follow-controls") borders.push(decl);
  });
  assert.equal(borders.length, 1, "selected states must not restore a visible border");
  const border = borders[0];
  assert.equal(border.prop, "border-color", "keep the reserved border width and button size");
  assert.equal(border.value, "transparent");
  assert.ok(border.important);
  assert.equal(border.parent.nodes.length, 1, "the border rule must not change fills, opacity, blur or shadows");
  assert.doesNotMatch(border.parent.selector, /:not\(|aria-pressed|aria-disabled|:hover|:focus|:disabled/);
  for (const target of [".home-tv-feed-actions > .home-tv-feed-action", ".home-tv-feed-full-view-close", ".profile-media-card-back",
    ".profile-photo-viewer-actions > button", ".profile-tv-viewer-actions > button", ".profile-media-viewer-actions > button"]) {
    assert.ok(border.parent.selector.includes(target), target);
  }
  assert.match(css, /> button:focus-visible \{\s*outline: 2px solid var\(--venue-brand-light, #c4b5fd\) !important;/);
  assert.match(css, /outline: 1px solid var\(--venue-brand-edge, #4a365f\) !important;/, "media card edges remain unchanged");
});
