import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

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
});
let galleryProps;
const profileComponent = load("app/dancers/[slug]/PublicDancerProfile.tsx", {
  "next/link": { default: link },
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
  }
});

test("ordinary public profiles retain Follow, Share and their venue page link", () => {
  const html = renderToStaticMarkup(h(profileComponent, { profile, tvVideos: [] }));
  assert.match(html, /data-follow-control="text"/);
  assert.match(html, /aria-label="Share profile"/);
  assert.match(html, /href="\/venues\/rhino"/);
  assert.doesNotMatch(html, /google\.com\/maps/);
  assert.equal(galleryProps.showSocialActions, true);
  assert.equal(galleryProps.viewerVenue.href, "/venues/rhino");
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
