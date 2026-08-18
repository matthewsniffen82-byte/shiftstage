import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [aesthetic, tokens, liveShell, publicProfile, tvFeed, rootLayout] = await Promise.all([
  readFile(new URL("../public/dancr-aesthetic.v1.css", import.meta.url), "utf8"),
  readFile(new URL("../public/dancr-brand-tokens.v1.css", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/tv/TvFeedClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
]);

const wrapperRules = aesthetic.match(
  /\/\* Every real dancer avatar keeps its existing outer dimensions[\s\S]*?(?=body\.dancr-button-system \.home-tv-feed-dancer-photo:not)/,
)?.[0] || "";

test("every dancer avatar uses one real neutral border wrapper", () => {
  assert.ok(wrapperRules);
  assert.match(wrapperRules, /body\.dancr-button-system \[data-dancer-avatar\] \{/);
  assert.match(wrapperRules, /position: relative !important;/);
  assert.match(wrapperRules, /isolation: isolate !important;/);
  assert.match(wrapperRules, /padding: 0 !important;/);
  assert.match(wrapperRules, /border: 0 !important;/);
  assert.match(wrapperRules, /\[data-dancer-avatar-border\] \{/);
  assert.match(wrapperRules, /position: absolute !important;/);
  assert.match(wrapperRules, /inset: 0 !important;/);
  assert.match(wrapperRules, /box-sizing: border-box !important;/);
  assert.match(wrapperRules, /overflow: hidden !important;/);
  assert.match(wrapperRules, /border: 2px solid var\(--dancr-color-avatar-ring-inactive\) !important;/);
  assert.match(wrapperRules, /border-radius: 50% !important;/);
  assert.match(wrapperRules, /background-image: inherit !important;/);
  assert.match(wrapperRules, /pointer-events: none !important;/);
});

test("the removed avatar ring implementations cannot render on any platform", () => {
  assert.doesNotMatch(wrapperRules, /Android-only foreground ring/);
  assert.doesNotMatch(wrapperRules, /\[data-dancer-avatar\]::after \{[\s\S]*?content: ""/);
  assert.doesNotMatch(wrapperRules, /inset 0 0 0 2px #ffffff/);
  assert.doesNotMatch(wrapperRules, /inset 0 0 4px/);
  assert.doesNotMatch(wrapperRules, /translateZ\(0\)|backface-visibility|mask-image|clip-path/);
  assert.doesNotMatch(wrapperRules, /\.home-tv-feed-dancer-photo,[\s\S]*?padding: 2px !important;[\s\S]*?background: #ffffff !important;/);
  assert.doesNotMatch(wrapperRules, /html\.is-android body\.dancr-button-system \[data-dancer-avatar\]::after/);
  assert.doesNotMatch(wrapperRules, /body\.samsung-rendering\.dancr-button-system \[data-dancer-avatar\]::after/);
});

test("the border wrapper cannot change avatar size, spacing, shadows, badges, or navigation", () => {
  const borderWrapper = wrapperRules.match(
    /body\.dancr-button-system \[data-dancer-avatar-border\] \{[\s\S]*?\n\}/,
  )?.[0] || "";

  assert.ok(borderWrapper);
  assert.doesNotMatch(borderWrapper, /\b(?:width|height|margin|padding)\s*:/);
  assert.match(borderWrapper, /box-shadow: none !important;/);
  assert.doesNotMatch(borderWrapper, /verified|badge|navigation|discoveryTabs|home-nav/);
  assert.doesNotMatch(borderWrapper, /\.is-ios|iPhone|iPad/);
});

test("every production circular avatar contains the new border wrapper", () => {
  assert.match(liveShell, /class="profile-modal-avatar" id="modalProfileAvatar" data-dancer-avatar[\s\S]*?id="modalProfileAvatarBorder" data-dancer-avatar-border/);
  assert.match(liveShell, /class="approved-avatar-preview\$\{avatarPreviewAttrs\.className\}"\$\{avatarPreviewAttrs\.style\} data-dancer-avatar[\s\S]*?<span data-dancer-avatar-border/);
  assert.match(liveShell, /class="\$\{classPrefix\}-lineup-avatar\$\{attrs\.className\}"\$\{attrs\.style\} data-dancer-avatar[^`]+data-dancer-avatar-border/);
  assert.match(liveShell, /dancerPhoto\.setAttribute\("data-dancer-avatar", ""\)[\s\S]*?dancerPhotoBorder\.setAttribute\("data-dancer-avatar-border", ""\)/);
  assert.match(liveShell, /modalProfileAvatarBorder\.textContent = avatarPhotoUrl/);
  assert.match(publicProfile, /data-dancer-avatar=""[\s\S]*?data-dancer-avatar-border=""/);
  assert.match(tvFeed, /data-dancer-avatar=""[\s\S]*?data-dancer-avatar-border=""/);
});

test("routed pages still classify Android without placing device styles on the wrapper", () => {
  assert.match(rootLayout, /id="dancr-android-device-classes"/);
  assert.match(rootLayout, /\/Android\/i\.test\(userAgent\)/);
  assert.match(rootLayout, /element\.classList\.add\("is-android", "android-rendering"\)/);
  assert.doesNotMatch(wrapperRules, /is-android|android-rendering|is-samsung-browser|samsung-rendering/);
});

test("no-schedule, Upcoming, and Working Now avatar rings remain centralized in the Dancr brand palette", () => {
  assert.match(tokens, /--dancr-color-avatar-ring-core: #ffffff;/);
  assert.match(tokens, /--dancr-color-avatar-ring-live: #34e3a4;/);
  assert.match(tokens, /--dancr-color-avatar-ring-upcoming: #22d3ee;/);
  assert.match(tokens, /--dancr-color-avatar-ring-inactive: #334155;/);
});

test("upcoming avatars use a cyan ring without being promoted to Working Now", () => {
  const homeTvAvatarBuilder = liveShell.match(
    /const dancerPhoto = document\.createElement\("span"\);[\s\S]*?(?=const nameRow = document\.createElement\("span"\);)/,
  )?.[0] || "";

  assert.match(
    wrapperRules,
    /\[data-dancer-avatar\]\[data-upcoming="true"\]:not\(\[data-working-now="true"\]\)[\s\S]*?background-color: var\(--dancr-color-avatar-ring-upcoming\) !important;[\s\S]*?border-color: var\(--dancr-color-avatar-ring-upcoming\) !important;/,
  );
  assert.match(
    wrapperRules,
    /\[data-upcoming="true"\][\s\S]*?> \[data-dancer-avatar-border\] > :is\(img, \.tv-profile-photo-image\) \{[\s\S]*?inset: 0 !important;[\s\S]*?width: 100% !important;[\s\S]*?height: 100% !important;[\s\S]*?background-color: var\(--dancr-color-avatar-ring-upcoming\) !important;/,
  );
  assert.match(publicProfile, /data-upcoming=\{hasUpcomingShift \? "true" : undefined\}/);
  assert.match(tvFeed, /data-upcoming=\{video\.shift && !video\.shift\.isActive \? "true" : undefined\}/);
  assert.match(liveShell, /modalProfileAvatar\.dataset\.upcoming = String\(modalHasUpcomingShift\)/);
  assert.match(homeTvAvatarBuilder, /if \(item\?\.shift && !dancerIsWorkingNow\) dancerPhoto\.setAttribute\("data-upcoming", "true"\)/);
  assert.doesNotMatch(homeTvAvatarBuilder, /data-working-now-indicator|workingNowIndicator|textContent = "NOW"/);
});

test("working-now avatars keep one complete live-teal ring with NOW reserved for full profiles", () => {
  const profileSummary = liveShell.match(
    /<div class="profile-modal-summary">[\s\S]*?(?=<section class="profile-modal-media")/,
  )?.[0] || "";
  const homeTvAvatarBuilder = liveShell.match(
    /const dancerPhoto = document\.createElement\("span"\);[\s\S]*?(?=const nameRow = document\.createElement\("span"\);)/,
  )?.[0] || "";

  assert.match(wrapperRules, /\[data-dancer-avatar\]\[data-working-now="true"\] \{/);
  assert.match(wrapperRules, /0 0 0 1px var\(--dancr-color-avatar-ring-live\)/);
  assert.match(
    wrapperRules,
    /\[data-dancer-avatar\]\[data-working-now="true"\] > \[data-dancer-avatar-border\] \{[\s\S]*?border-color: var\(--dancr-color-avatar-ring-live\) !important;[\s\S]*?background-color: var\(--dancr-color-avatar-ring-live\) !important;/,
  );
  assert.match(
    wrapperRules,
    /\[data-working-now="true"\][\s\S]*?> \[data-dancer-avatar-border\] > :is\(img, \.tv-profile-photo-image\) \{[\s\S]*?inset: 0 !important;[\s\S]*?width: 100% !important;[\s\S]*?height: 100% !important;[\s\S]*?background-color: var\(--dancr-color-avatar-ring-live\) !important;/,
  );
  assert.match(wrapperRules, /\[data-working-now-indicator\] \{/);
  assert.match(wrapperRules, /background: var\(--dancr-color-avatar-ring-live\) !important;/);
  assert.match(publicProfile, /data-working-now=\{activeShift \? "true" : undefined\}/);
  assert.match(tvFeed, /data-working-now=\{video\.shift\?\.isActive \? "true" : undefined\}/);
  assert.match(liveShell, /modalProfileAvatar\.dataset\.workingNow = String\(modalIsWorkingNow\)/);
  assert.match(liveShell, /data-dancer-avatar data-working-now="true" role="img" aria-label="\$\{escapeHtml\(profile\.name\)\}, working now"/);
  assert.match(publicProfile, /data-working-now-indicator="">NOW<\/span>/);
  assert.doesNotMatch(tvFeed, /data-working-now-indicator/);
  assert.match(profileSummary, /data-working-now-indicator aria-hidden="true">NOW<\/span>/);
  assert.doesNotMatch(homeTvAvatarBuilder, /data-working-now-indicator|workingNowIndicator|textContent = "NOW"/);
  assert.doesNotMatch(publicProfile, /profile-titlebar-status is-live">Working Now/);
  assert.doesNotMatch(profileSummary, /profile-modal-live-status/);
});

test("venue-card lineup avatars use one stable circular paint layer while scrolling", () => {
  const lineupLayoutRule = wrapperRules.match(
    /body\.dancr-button-system :is\(\s*\.home-venue-discovery-lineup-avatar,\s*\.venue-card-lineup-avatar\s*\) \{[\s\S]*?\n\}/,
  )?.[0] || "";
  const lineupBorderRule = wrapperRules.match(
    /body\.dancr-button-system :is\(\s*\.home-venue-discovery-lineup-avatar,\s*\.venue-card-lineup-avatar\s*\) > \[data-dancer-avatar-border\] \{[\s\S]*?\n\}/,
  )?.[0] || "";
  const lineupLiveRule = wrapperRules.match(
    /body\.dancr-button-system :is\(\s*\.home-venue-discovery-lineup-avatar,\s*\.venue-card-lineup-avatar\s*\)\[data-working-now="true"\] > \[data-dancer-avatar-border\] \{[\s\S]*?\n\}/,
  )?.[0] || "";

  assert.ok(lineupLayoutRule);
  assert.match(lineupLayoutRule, /isolation: auto !important;/);
  assert.match(lineupLayoutRule, /background-color: transparent !important;/);
  assert.match(lineupLayoutRule, /background-image: none !important;/);
  assert.match(lineupLayoutRule, /box-shadow: none !important;/);
  assert.ok(lineupBorderRule);
  assert.match(lineupBorderRule, /background-image: var\(--custom-photo, none\) !important;/);
  assert.match(lineupBorderRule, /background-position: var\(--custom-photo-position, center\) !important;/);
  assert.match(lineupBorderRule, /background-size: cover !important;/);
  assert.ok(lineupLiveRule);
  assert.match(lineupLiveRule, /0 0 0 1px var\(--dancr-color-avatar-ring-live\)/);
  assert.match(lineupLiveRule, /0 0 11px var\(--dancr-color-success-medium\) !important;/);
  assert.doesNotMatch(
    `${lineupLayoutRule}\n${lineupBorderRule}\n${lineupLiveRule}`,
    /translateZ|backface-visibility|will-change|mask-image|clip-path/,
  );
});
