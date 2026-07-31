import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const homeSource = fs.readFileSync(
  new URL("../outputs/index.html", import.meta.url),
  "utf8",
);
const publicProfileSource = fs.readFileSync(
  new URL("../app/dancers/[slug]/page.tsx", import.meta.url),
  "utf8",
);
const tvSource = fs.readFileSync(
  new URL("../app/tv/TvFeedClient.tsx", import.meta.url),
  "utf8",
);

test("current dancer cards show the approved photo without an image-wide dimming layer", () => {
  assert.match(
    homeSource,
    /#results \.home-dancer-grid-photo\.has-custom-photo,[\s\S]*?#results \.home-feed-card \.portrait\.has-custom-photo \{[\s\S]*?background-image: var\(--custom-photo\) !important;[\s\S]*?filter: none !important;[\s\S]*?opacity: 1 !important;/,
  );
  assert.match(
    homeSource,
    /#results \.home-dancer-grid-photo\.has-custom-photo::after,[\s\S]*?#results \.home-feed-card \.portrait\.has-custom-photo::after \{[\s\S]*?content: none !important;[\s\S]*?background: none !important;/,
  );
});

test("legacy cards retain only a localized bottom text gradient", () => {
  assert.match(
    homeSource,
    /#results \.dancer-card:not\(\.home-dancer-grid-card\):not\(\.home-feed-card\) \.portrait\.has-custom-photo::after \{[\s\S]*?transparent 0 74%,[\s\S]*?rgba\(5,5,8,\.12\) 84%,[\s\S]*?rgba\(5,5,8,\.68\) 100%/,
  );
});

test("profile avatars, gallery thumbnails, and full-screen photos stay at natural luminance", () => {
  assert.match(
    homeSource,
    /#profileBackdrop \.profile-modal-avatar\.has-photo,[\s\S]*?#profileBackdrop \.gallery \.thumb \.portrait\.has-custom-photo,[\s\S]*?\.profile-photo-viewer-image \{[\s\S]*?filter: none !important;[\s\S]*?opacity: 1 !important;/,
  );
  assert.match(
    homeSource,
    /#profileBackdrop \.gallery \.thumb \.portrait\.has-custom-photo::after \{[\s\S]*?content: none !important;[\s\S]*?background: none !important;/,
  );
  assert.match(
    publicProfileSource,
    /\.profile-avatar\.has-photo \{ filter: none; opacity: 1; mix-blend-mode: normal; \}/,
  );
  assert.match(
    publicProfileSource,
    /\.profile-media-grid-item img \{ filter: none; opacity: 1; mix-blend-mode: normal; \}/,
  );
  assert.match(
    publicProfileSource,
    /\.profile-media-viewer-stage > img \{ filter: none; opacity: 1; mix-blend-mode: normal; \}/,
  );
  assert.match(
    tvSource,
    /\.tv-profile-photo\.has-photo \{[^}]*filter: none;[^}]*opacity: 1;[^}]*mix-blend-mode: normal;/,
  );
});
