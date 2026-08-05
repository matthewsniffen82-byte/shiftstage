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

test("every dancer avatar uses one real electric-white border wrapper", () => {
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
  assert.match(wrapperRules, /border: 2px solid #ffffff !important;/);
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
  assert.match(liveShell, /class="venue-shift-avatar [^\n]+data-dancer-avatar[^\n]+data-dancer-avatar-border/);
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

test("the Electric White value remains centralized in the Dancr brand palette", () => {
  assert.match(tokens, /--dancr-color-avatar-ring-core: #ffffff;/);
});
