import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [liveShell, aesthetic, profilePage, profileCarousel, dashboard] = await Promise.all([
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/dancr-aesthetic.v1.css", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/page.tsx", import.meta.url), "utf8"),
  readFile(
    new URL("../app/dancers/[slug]/DancerPhotoCarousel.tsx", import.meta.url),
    "utf8",
  ),
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
]);

test("the critical hero reserves its final box and reveals over a lightweight placeholder", () => {
  assert.match(
    liveShell,
    /class="hero-art"[\s\S]*?width="1590"[\s\S]*?height="889"[\s\S]*?data-image-state="loading"[\s\S]*?onload="this\.dataset\.imageState='ready'"[\s\S]*?onerror="this\.dataset\.imageState='error'"/,
  );
  assert.match(
    liveShell,
    /Final hero fit:[\s\S]*?aspect-ratio: 1672 \/ 941 !important;[\s\S]*?radial-gradient\(circle at 74% 22%[\s\S]*?linear-gradient\(145deg,#101018,#050507\)/,
  );
  assert.match(
    liveShell,
    /\.hero\.reference-hero \.hero-art\[data-image-state="ready"\] \{\s*opacity: 1;/,
  );
  assert.match(
    liveShell,
    /\.hero\.reference-hero \.hero-art\[data-image-state="error"\] \{\s*visibility: hidden;/,
  );
  assert.match(
    aesthetic,
    /Image readiness is the final general-media paint layer[\s\S]*?body > \.app main\.stack > \.hero\.reference-hero \{[\s\S]*?radial-gradient[\s\S]*?hero\.reference-hero > \.hero-art\[data-image-state="loading"\][\s\S]*?opacity: 0 !important;/,
  );
});

test("home card photography keeps final geometry and never exposes an empty rectangle", () => {
  assert.match(
    liveShell,
    /#results\.home-dancer-grid\.home-dancer-three-column > \.home-dancer-grid-card \{[\s\S]*?aspect-ratio: 9 \/ 16 !important;/,
  );
  assert.match(
    liveShell,
    /<img class="home-dancer-grid-photo has-custom-photo"[^>]*width="360" height="640"[^>]*data-image-state="loading"[^>]*onload="this\.dataset\.imageState='ready'"[^>]*onerror="this\.dataset\.imageState='error'"/,
  );
  assert.match(
    liveShell,
    /home-dancer-grid-link:has\(> img\[data-image-state\]\)::before \{[\s\S]*?radial-gradient[\s\S]*?linear-gradient/,
  );
  assert.match(
    liveShell,
    /img\.home-dancer-grid-photo\[data-image-state="loading"\],[\s\S]*?data-image-state="error"[\s\S]*?opacity: 0 !important;[\s\S]*?data-image-state="ready"[\s\S]*?opacity: 1 !important;/,
  );
  assert.match(
    liveShell,
    /function settleCompletedStableImages[\s\S]*?image\.complete[\s\S]*?settleCompletedStableImages\(\);/,
  );
});

test("profile photo grids and viewers reveal decoded images over stable placeholders", () => {
  assert.match(
    profileCarousel,
    /data-image-state="loading"[\s\S]*?onError=\{markImageUnavailable\}[\s\S]*?onLoad=\{markImageReady\}/,
  );
  assert.match(profileCarousel, /function markImageReady[\s\S]*?dataset\.imageState = "ready"/);
  assert.match(profileCarousel, /function markImageUnavailable[\s\S]*?dataset\.imageState = "error"/);
  assert.match(profilePage, /\.profile-media-grid-item \{[\s\S]*?aspect-ratio: 9 \/ 16;/);
  assert.match(
    profilePage,
    /\.profile-media-grid-item\.is-photo::before[\s\S]*?radial-gradient[\s\S]*?\.profile-media-grid-item img\[data-image-state="ready"\] \{ opacity: 1;/,
  );
  assert.match(
    profilePage,
    /\.profile-media-viewer-slide::before[\s\S]*?linear-gradient[\s\S]*?\.profile-media-viewer-slide > img\[data-image-state="error"\] \{ visibility: hidden;/,
  );
  assert.match(
    profilePage,
    /@media \(prefers-reduced-motion: no-preference\)[\s\S]*?transition: opacity 160ms ease-out/,
  );
});

test("live modal and dashboard previews use the same stable photo treatment", () => {
  assert.match(
    liveShell,
    /function profilePhotoThumbMarkup[\s\S]*?width="360" height="504"[^>]*data-image-state="loading"[^>]*onload="this\.dataset\.imageState='ready'"/,
  );
  assert.match(
    liveShell,
    /#profileBackdrop \.gallery \.thumb::before[\s\S]*?radial-gradient[\s\S]*?#profileBackdrop \.gallery \.thumb > img\.portrait\[data-image-state="ready"\][\s\S]*?opacity: 1 !important;/,
  );
  assert.match(
    liveShell,
    /image\.style\.backgroundImage = `url\('\$\{safeUrl\}'\), radial-gradient[\s\S]*?linear-gradient/,
  );
  assert.match(
    dashboard,
    /\.dancer-profile-preview-overlay \.profile-media-grid-item\.is-photo::before[\s\S]*?\.profile-media-grid-item img\[data-image-state="ready"\] \{ opacity:1;/,
  );
  assert.match(
    dashboard,
    /\.dancer-profile-preview-overlay \.profile-media-viewer-slide::before[\s\S]*?\.profile-media-viewer-slide > img\[data-image-state="error"\] \{ visibility:hidden;/,
  );
});
