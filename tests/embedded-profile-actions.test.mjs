import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import postcss from "postcss";

const noop = () => {};
const h = React.createElement;
const link = ({ children, ...props }) => h("a", props, children);
const deal = ({ renderTrigger }) => renderTrigger ? renderTrigger(noop) : h("button", {}, "Free Entry");
function load(file, dependencies) {
  const exports = {};
  const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { exports, require(name) {
    if (name === "react/jsx-runtime") return jsx;
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  } });
  return exports;
}
const actions = load("app/dancers/[slug]/DancerProfileActions.tsx", {
  react: React, "react-dom": { createPortal: noop }, "next/link": { default: link },
  "@/app/components/PublicReportReasonDialog": { PublicReportReasonDialog: () => null },
  "@/src/lib/dancr/browser-session": {},
  "@/src/lib/dancr/customer-push": {},
  "@/src/lib/dancr/push-invitation": {},
  "@/app/dashboard/dashboard-session": {},
  "@/public/profile-action-feedback": {},
});
let galleryProps;
const profileComponent = load("app/dancers/[slug]/PublicDancerProfile.tsx", {
  "next/link": { default: link },
  "@/app/components/DancerIdentityBadge": load("app/components/DancerIdentityBadge.tsx", {}),
  "@/app/components/ClubDealCard": { ClubDealCard: deal },
  "@/src/lib/dancr/image-focal-point": { imageFocalPointCss: () => "50% 50%" },
  "@/src/lib/dancr/shift-presence": { isActiveNfcPresence: () => true },
  "./DancerProfileActions": actions,
  "./DancerDirectionsButton": { DancerDirectionsButton: () => null },
  "./DancerPhotoCarousel": { DancerPhotoCarousel: props => { galleryProps = props; return null; } },
  "./ProfileNavigationActions": {
    ProfileCloseButton: () => h("button", {}, "Back"),
    ProfileShareButton: () => h("button", { "aria-label": "Share profile" }, "Share"),
  },
  "./ProfileViewTracker": { ProfileViewTracker: () => null },
  "./VipProfileRequest": { default: () => h("button", { "data-vip-profile-request": true }, "Request") },
}).default;
const directions = "https://www.google.com/maps/dir/?api=1&destination=Spearmint%20Rhino%2C%20Boise%2C%20ID";
const profile = {
  id: "dancer-one", stageName: "Star", city: "Boise", venueName: "Spearmint Rhino",
  photos: [], followerCount: 4, goingCount: 3, viewsToday: 10,
  upcomingShifts: [{
    id: "shift-one", venueId: "venue-one", venueName: "Spearmint Rhino", venueSlug: "rhino",
    startsAt: "2026-10-20T01:00:00Z", endsAt: "2026-10-20T10:00:00Z",
  }],
};

test("embedded profile removes social controls, keeps visit actions, and links city and club to directions", () => {
  for (const preview of [false, true]) {
    const html = renderToStaticMarkup(h(profileComponent, {
      profile, tvVideos: [], embedded: true, preview, venueDirectionsHref: directions,
      activeDeals: [{ id: "deal-one", venueId: "venue-one" }],
    }));
    assert.doesNotMatch(html, /data-follow-control|aria-label="Share profile"|aria-label="Guest actions"/);
    assert.match(html, /data-profile-layout="portrait-details"/);
    const header = html.match(/<header class="profile-titlebar">([\s\S]*?)<\/header>/)[1];
    assert.doesNotMatch(header, /profile-header-metrics|profile-titlebar-person/);
    assert.match(html, /class="profile-portrait-info"><div class="profile-portrait-copy">/);
    const metrics = html.match(/<dl class="profile-header-metrics"[^>]*>([\s\S]*?)<\/dl>/)[1];
    assert.doesNotMatch(metrics, /Followers/);
    assert.match(metrics, /<dt>I’m Going<\/dt>/);
    assert.match(metrics, /<dt>Views today<\/dt>/);
    assert.deepEqual([...metrics.matchAll(/<div data-profile-metric="([^"]+)">/g)].map(match => match[1]), ["going", "views"]);
    const city = html.match(/<a class="profile-titlebar-city"[^>]*>([\s\S]*?)<\/a>/)[1];
    assert.match(city, /<svg aria-hidden="true" class="profile-venue-pin"/);
    assert.match(city, /Boise/);
    assert.match(html, /Free Entry/);
    assert.match(html, /I’m Going/);
    const mapLinks = html.match(/<a [^>]*href="https:\/\/www\.google\.com\/maps\/dir\/[^"]*"[^>]*>/g);
    assert.equal(mapLinks.length, 2, "both city and club open directions");
    for (const anchor of mapLinks) {
      assert.match(anchor, /target="_blank"/);
      assert.match(anchor, /rel="noopener noreferrer"/);
    }
    assert.equal(galleryProps.showSocialActions, false);
    assert.equal(galleryProps.viewerVenue.href, directions);
    assert.equal(galleryProps.viewerVenue.directions, true);
    assert.ok(html.indexOf('class="profile-portrait-copy"') < html.indexOf('class="profile-working-head"'));
    assert.ok(html.indexOf('class="profile-working-head"') < html.indexOf('class="profile-header-metrics"'));
    assert.equal((html.match(/class="profile-header-metrics"/g) || []).length, 1);
  }
});

test("embed loads the shared portrait footer styles and only customizes its metric count and button glow", () => {
  const page = readFileSync(new URL('../app/embed/venues/[slug]/dancers/[dancerSlug]/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /import "@\/public\/dancer-profile-details\.css"/);
  const css = postcss.parse(readFileSync(new URL('../app/embed/venues/[slug]/dancers/[dancerSlug]/embedded-profile.css', import.meta.url), 'utf8'));
  const rules = [];
  css.walkRules(rule => rules.push(rule));
  const value = (rule, prop) => rule.nodes.find(node => node.prop === prop);
  const metrics = rules.find(rule => rule.selector.endsWith('[data-profile-layout="portrait-details"] .profile-header-metrics'));
  assert.equal(metrics.parent.params, 'dancr-palette');
  assert.equal(value(metrics, 'grid-template-columns').value, 'repeat(2, minmax(0, 1fr))');
  assert.equal(value(metrics, 'grid-template-columns').important, true);
  assert.ok(!rules.some(rule => rule.selector.endsWith('> .profile-featured-column')), 'the old embed must not stretch the portrait across gallery rows');
  const entry = rules.find(rule => rule.selector.endsWith(':is(.free-entry-cta, .profile-media-entry, [data-free-entry-glow="true"])'));
  assert.equal(entry.parent.params, 'dancr-palette');
  assert.equal(value(entry, 'box-shadow').value, 'none');
  assert.equal(value(entry, 'box-shadow').important, true);
});

test("ordinary public profiles retain Follow, Share and their venue page link", () => {
  const html = renderToStaticMarkup(h(profileComponent, { profile, tvVideos: [] }));
  assert.match(html, /data-follow-control="text"/);
  assert.match(html, /aria-label="Share profile"/);
  assert.match(html, /I’m Going/);
  assert.match(html, /<dt>Followers<\/dt>/);
  assert.match(html, /href="\/venues\/rhino"/);
  assert.doesNotMatch(html, /google\.com\/maps/);
  assert.equal(galleryProps.showSocialActions, true);
  assert.equal(galleryProps.viewerVenue.href, "/venues/rhino");
});

test("VIP-linked profiles retain Follow and Share with Request as their only visit action", () => {
  const html = renderToStaticMarkup(h(profileComponent, {
    profile, tvVideos: [], vipReturnHref: "/vip?venueId=venue-one#vip-plan",
    activeDeals: [{ id: "deal-one", venueId: "venue-one" }],
  }));
  assert.match(html, /data-follow-control="text"/);
  assert.match(html, /aria-label="Share profile"/);
  assert.match(html, /data-vip-profile-request="true">Request/);
  assert.match(html, /profile-tonight-card is-vip-profile/);
  assert.doesNotMatch(html, /<button[^>]*class="[^"]*profile-action-going|>I’m Going<|>Free Entry</);
});

// Render the already-open media component without a browser, network or effects.
function mediaMarkup(kind, embedded, expanded) {
  let stateIndex = 0;
  const { DancerPhotoCarousel } = load("app/dancers/[slug]/DancerPhotoCarousel.tsx", {
    react: { ...React, useState(initial) {
      const index = stateIndex++;
      return React.useState(index === 1 ? { kind, index: 0 } : index === 2 ? expanded : initial);
    } },
    "react-dom": { flushSync: noop, preload: noop },
    "@/app/components/MediaLikeButton": { MediaLikeButton: () => h("button", { "aria-label": "Like media" }) },
    "@/app/components/ClubDealCard": { ClubDealCard: deal },
    "./DancerProfileActions": { DancerMediaFollowButton: () => h("button", { "aria-label": "Follow Star" }) },
    "@/app/components/PublicReportReasonDialog": {},
    "@/src/lib/dancr/browser-session": {},
    "@/src/lib/dancr/engagement-client": {},
    "@/src/lib/dancr/use-video-sound-preference": { useVideoSoundPreference: () => [true, noop] },
    "@/src/lib/dancr/use-adaptive-video-warmup": { useAdaptiveVideoWarmup: () => false },
    "@/src/lib/dancr/video-buffer-policy": {},
    "@/src/lib/dancr/public-video-playback": { publicVideoPlaybackUrl: item => item.videoUrl },
    "@/src/lib/dancr/video-resource-ref": { videoResourceRef: noop },
    "@/src/lib/dancr/use-anonymous-media-likes": { useAnonymousMediaLikes: () => ({
      stateFor: () => ({ liked: false, likeCount: 0, pending: false }), toggle: noop,
    }) },
    "@/src/lib/dancr/media-limits": { DANCER_PROFILE_MEDIA_PAGE_SIZE: 12 },
    "@/src/lib/dancr/image-focal-point": { imageFocalPointCss: () => "50% 50%" },
    "@/public/profile-media-fullscreen": {},
    "@/public/profile-media-progress": {},
    "@/public/profile-video-views": { default: { mount: () => noop } },
    "@/public/video-autoplay-lifecycle": {},
  });
  return renderToStaticMarkup(h(DancerPhotoCarousel, {
    stageName: "Star", showSocialActions: !embedded, viewerStatus: "Working Now", viewerCity: "Boise",
    viewerVenue: { name: "Spearmint Rhino", href: embedded ? directions : "/venues/rhino", directions: embedded },
    photos: [{ id: "photo-one", imageUrl: "/photo.jpg" }],
    videos: [{ id: "video-one", videoUrl: "/video.mp4", durationSeconds: 10 }],
  }));
}

for (const kind of ["photo", "video"]) {
  for (const expanded of [false, true]) {
    test(`embedded ${kind} controls keep Like and fullscreen without Follow or Share (expanded=${expanded})`, () => {
      const html = mediaMarkup(kind, true, expanded);
      assert.doesNotMatch(html, /aria-label="Follow Star"|class="profile-media-viewer-share"/);
      assert.match(html, /aria-label="Like media"/);
      assert.match(html, /class="profile-media-control-fullscreen"/);
      assert.match(html, /class="profile-media-venue" href="https:\/\/www.google.com\/maps\/dir\/[^"]+" target="_blank"/);
      if (kind === "video") assert.match(html, /aria-label="Turn sound on"/);
    });
  }
  test(`public ${kind} controls still offer Follow and Share`, () => {
    const html = mediaMarkup(kind, false, false);
    assert.match(html, /aria-label="Follow Star"/);
    assert.match(html, /profile-media-viewer-share/);
    assert.match(html, /class="profile-media-venue" href="\/venues\/rhino"/);
  });
}
