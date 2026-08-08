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

test("inactive and Working Now avatar rings remain centralized in the Dancr brand palette", () => {
  assert.match(tokens, /--dancr-color-avatar-ring-core: #ffffff;/);
  assert.match(tokens, /--dancr-color-avatar-ring-live: #34e3a4;/);
  assert.match(tokens, /--dancr-color-avatar-ring-inactive: rgba\(245, 245, 255, 0\.65\);/);
});

test("working-now avatars use one complete live-teal ring and status layer on every platform", () => {
  assert.match(wrapperRules, /\[data-dancer-avatar\]\[data-working-now="true"\] \{/);
  assert.match(wrapperRules, /0 0 0 1px var\(--dancr-color-avatar-ring-live\)/);
  assert.match(
    wrapperRules,
    /\[data-dancer-avatar\]\[data-working-now="true"\] > \[data-dancer-avatar-border\] \{[\s\S]*?border-color: var\(--dancr-color-avatar-ring-live\) !important;/,
  );
  assert.match(wrapperRules, /\[data-working-now-indicator\] \{/);
  assert.match(wrapperRules, /background: var\(--dancr-color-avatar-ring-live\) !important;/);
  assert.match(publicProfile, /data-working-now=\{activeShift \? "true" : undefined\}/);
  assert.match(tvFeed, /data-working-now=\{video\.shift\?\.isActive \? "true" : undefined\}/);
  assert.match(liveShell, /modalProfileAvatar\.dataset\.workingNow = String\(modalIsWorkingNow\)/);
  assert.match(liveShell, /data-dancer-avatar data-working-now="true" role="img" aria-label="\$\{escapeHtml\(profile\.name\)\}, working now"/);
  assert.match(liveShell, /dancerIsWorkingNow[\s\S]*?data-working-now[\s\S]*?data-working-now-indicator/);
  assert.match(publicProfile, /data-working-now-indicator="">NOW<\/span>/);
  assert.match(tvFeed, /data-working-now-indicator="">NOW<\/span>/);
  assert.match(liveShell, /data-working-now-indicator aria-hidden="true">NOW<\/span>/);
  assert.match(liveShell, /workingNowIndicator\.textContent = "NOW"/);
  assert.doesNotMatch(publicProfile, /data-working-now-indicator="">LIVE<\/span>/);
  assert.doesNotMatch(tvFeed, /data-working-now-indicator="">LIVE<\/span>/);
  assert.doesNotMatch(liveShell, /data-working-now-indicator[^>]*>LIVE<\/span>/);
});
