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
const aestheticSource = fs.readFileSync(
  new URL("../public/dancr-aesthetic.v1.css", import.meta.url),
  "utf8",
);

test("current dancer cards brighten the approved photo without an image-wide dimming layer", () => {
  assert.match(
    homeSource,
    /#results \.home-dancer-grid-photo\.has-custom-photo,[\s\S]*?#results \.home-feed-card \.portrait\.has-custom-photo \{[\s\S]*?background-image: var\(--custom-photo\) !important;[\s\S]*?filter: brightness\(1\.14\) contrast\(1\.03\) !important;[\s\S]*?opacity: 1 !important;/,
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

test("profile avatars, gallery thumbnails, and full-screen photos share the restrained brightness lift", () => {
  assert.match(
    homeSource,
    /#profileBackdrop \.modal-image\.has-custom-photo,[\s\S]*?#profileBackdrop \.profile-modal-avatar\.has-photo,[\s\S]*?#profileBackdrop \.gallery \.thumb \.portrait\.has-custom-photo,[\s\S]*?\.profile-photo-viewer-image \{[\s\S]*?filter: brightness\(1\.14\) contrast\(1\.03\) !important;[\s\S]*?opacity: 1 !important;/,
  );
  assert.match(
    homeSource,
    /#profileBackdrop \.gallery \.thumb \.portrait\.has-custom-photo::after \{[\s\S]*?content: none !important;[\s\S]*?background: none !important;/,
  );
  assert.match(
    publicProfileSource,
    /\.profile-titlebar-avatar img \{[^}]*filter: brightness\(1\.14\) contrast\(1\.03\);/,
  );
  assert.match(
    publicProfileSource,
    /\.profile-media-feature > img \{ object-fit: contain; filter: brightness\(1\.14\) contrast\(1\.03\); opacity: 1; mix-blend-mode: normal; \}/,
  );
  assert.match(
    publicProfileSource,
    /\.profile-media-grid-item img \{ filter: brightness\(1\.14\) contrast\(1\.03\); opacity: 1; mix-blend-mode: normal; \}/,
  );
  assert.match(
    publicProfileSource,
    /\.profile-media-viewer-stage > img \{ filter: brightness\(1\.14\) contrast\(1\.03\); opacity: 1; mix-blend-mode: normal; \}/,
  );
  assert.match(
    tvSource,
    /\.tv-profile-photo\.has-photo \{[^}]*filter: none;[^}]*opacity: 1;[^}]*mix-blend-mode: normal;/,
  );
});

test("Android's final media layer outranks the coarse-pointer filter reset", () => {
  const androidMediaLayer = aestheticSource.match(
    /Android media luminance recovery must remain the final media layer[\s\S]*$/,
  )?.[0] || "";

  assert.ok(androidMediaLayer, "the final Android media correction must exist");
  assert.match(
    androidMediaLayer,
    /#results\.home-dancer-grid\.home-dancer-three-column[\s\S]*?\.home-dancer-grid-photo\.has-custom-photo/,
  );
  assert.match(
    androidMediaLayer,
    /#profileBackdrop :is\([\s\S]*?\.profile-modal-avatar\.has-photo,[\s\S]*?\.profile-photo-viewer-image/,
  );
  assert.match(
    androidMediaLayer,
    /\.tv-shell \.tv-profile-photo-image[\s\S]*?filter: brightness\(1\.14\) contrast\(1\.03\) !important;[\s\S]*?-webkit-filter: brightness\(1\.14\) contrast\(1\.03\) !important;/,
  );
});

test("Android venue logos paint above the card shade without changing other platforms", () => {
  assert.match(
    homeSource,
    /home-venue-discovery-art\$\{visual\.attrs\.className\}\$\{logoMarkup \? " has-venue-logo" : ""\}/,
  );
  const androidMediaLayer = aestheticSource.match(
    /Android media luminance recovery must remain the final media layer[\s\S]*$/,
  )?.[0] || "";
  assert.match(
    androidMediaLayer,
    /\.home-venue-discovery-art\.has-venue-logo \{[\s\S]*?z-index: 2 !important;/,
  );
  assert.match(
    androidMediaLayer,
    /\.home-venue-discovery-logo,[\s\S]*?\.venue-card-logo,[\s\S]*?\.venue-detail-logo[\s\S]*?filter: brightness\(1\.12\) contrast\(1\.03\) !important;/,
  );
  assert.doesNotMatch(
    androidMediaLayer,
    /body\.dancr-button-system :is\([\s\S]*?\.home-venue-discovery-logo[\s\S]*?\) \{[\s\S]*?background:/,
  );
});

test("iPhone compact grid photos avoid filtered momentum-scroll layers", () => {
  const iosPaintLayer = aestheticSource.match(
    /iOS Safari can evict filtered photo layers[\s\S]*$/,
  )?.[0] || "";

  assert.ok(iosPaintLayer, "the final iOS compact-grid paint correction must exist");
  assert.match(iosPaintLayer, /@supports \(-webkit-touch-callout: none\)/);
  assert.match(
    iosPaintLayer,
    /#results\.home-dancer-grid\.home-dancer-three-column[\s\S]*?img\.home-dancer-grid-photo[\s\S]*?filter: none !important;[\s\S]*?-webkit-filter: none !important;[\s\S]*?will-change: auto !important;/,
  );
  assert.match(iosPaintLayer, /isolation: auto !important;[\s\S]*?opacity: 1 !important;/);
});
