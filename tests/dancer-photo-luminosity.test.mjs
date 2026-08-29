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
    /#profileBackdrop \.modal-image\.has-custom-photo,[\s\S]*?#profileBackdrop \.profile-modal-avatar\.has-photo,[\s\S]*?#profileBackdrop \.gallery \.thumb \.portrait\.has-custom-photo,[\s\S]*?\.profile-photo-viewer-slide-image \{[\s\S]*?filter: brightness\(1\.14\) contrast\(1\.03\) !important;[\s\S]*?opacity: 1 !important;/,
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
    /\.profile-media-grid-item img \{ filter: brightness\(1\.14\) contrast\(1\.03\); opacity: 1; mix-blend-mode: normal; \}/,
  );
  assert.match(
    publicProfileSource,
    /\.profile-media-viewer-slide > img \{ filter: brightness\(1\.14\) contrast\(1\.03\); opacity: 1; mix-blend-mode: normal; \}/,
  );
  assert.match(
    tvSource,
    /\.tv-profile-photo\.has-photo \{[^}]*filter: none;[^}]*opacity: 1;[^}]*mix-blend-mode: normal;/,
  );
});

test("profile grid photos use the native responsive image path used by dancer discovery", () => {
  const profileThumbRenderer = homeSource.match(
    /function profilePhotoThumbMarkup\(item, total, galleryIndex = item\.index\) \{[\s\S]*?\n    \}/,
  )?.[0] || "";

  assert.ok(profileThumbRenderer, "the profile photo thumbnail renderer must exist");
  assert.match(
    profileThumbRenderer,
    /nativeResponsivePhotoAttrs\(item\.photoUrl, item\.photoSrcSet\)/,
  );
  assert.match(
    profileThumbRenderer,
    /<img class="portrait \$\{item\.photoClass\} has-custom-photo" \$\{photoAttrs\}[^>]*sizes="\(max-width: 720px\) calc\(\(100vw - 6px\) \/ 3\), 250px"[^>]*width="360" height="504"[^>]*loading="lazy"[^>]*decoding="async"[^>]*draggable="false">/,
  );
  assert.doesNotMatch(profileThumbRenderer, /customPhotoAttrs\(/);
  assert.match(
    homeSource,
    /#profileBackdrop \.gallery \.thumb > img,[\s\S]*?object-fit: cover !important;[\s\S]*?object-position: center top !important;/,
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
    /#profileBackdrop :is\([\s\S]*?\.profile-modal-avatar\.has-photo,[\s\S]*?\.profile-photo-viewer-slide-image/,
  );
  assert.match(
    androidMediaLayer,
    /\.tv-shell \.tv-profile-photo-image[\s\S]*?filter: brightness\(1\.14\) contrast\(1\.03\) !important;[\s\S]*?-webkit-filter: brightness\(1\.14\) contrast\(1\.03\) !important;/,
  );
});

test("venue-card heroes avoid Android-only logo correction and whole-card backdrop compositing", () => {
  assert.match(
    homeSource,
    /home-venue-discovery-art is-venue-logo-artwork\$\{logoMarkup \? " has-venue-logo" : ""\}/,
  );
  assert.match(
    aestheticSource,
    /The legacy \.venue glass rule applies backdrop blur[\s\S]*?> #results\.home-venue-discovery-feed > \.home-venue-discovery-slide \{[\s\S]*?-webkit-backdrop-filter: none !important;[\s\S]*?backdrop-filter: none !important;/,
  );
  assert.doesNotMatch(
    aestheticSource,
    /\.home-venue-discovery-logo,[\s\S]*?\.venue-card-logo,[\s\S]*?\.venue-detail-logo[\s\S]*?brightness\(1\.12\)/,
  );
  assert.doesNotMatch(aestheticSource, /\.home-venue-discovery-art\.has-venue-logo \{[\s\S]*?z-index: 2 !important;/);
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
