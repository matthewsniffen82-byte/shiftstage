import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const liveApp = fs.readFileSync("outputs/index.html", "utf8");
const publicProfilePage = fs.readFileSync("app/dancers/[slug]/page.tsx", "utf8");
const publicPhotoCarousel = fs.readFileSync(
  "app/dancers/[slug]/DancerPhotoCarousel.tsx",
  "utf8",
);

test("the live dancer profile changes photos with horizontal swipe and trackpad gestures", () => {
  assert.match(
    liveApp,
    /function bindHorizontalProfilePhotoSwipe\(element, options = \{\}\)/,
  );
  assert.match(
    liveApp,
    /element\.addEventListener\("pointermove",[\s\S]*?Math\.abs\(distanceX\) >= 44[\s\S]*?moveModalPhoto\(distanceX < 0 \? 1 : -1, options\)/,
  );
  assert.match(
    liveApp,
    /element\.addEventListener\("wheel",[\s\S]*?Math\.abs\(event\.deltaX\)[\s\S]*?moveModalPhoto\(event\.deltaX > 0 \? 1 : -1, options\)/,
  );
  assert.match(
    liveApp,
    /bindHorizontalProfilePhotoSwipe\(modalImage\);[\s\S]*?bindHorizontalProfilePhotoSwipe\(profilePhotoViewerImage, \{ syncViewer: true \}\)/,
  );
  assert.match(
    liveApp,
    /profilePhotoSwipeBlockClickUntil = Date\.now\(\) \+ 420[\s\S]*?Date\.now\(\) < profilePhotoSwipeBlockClickUntil/,
  );
  assert.match(
    liveApp,
    /\.profile-modal \.modal-image,[\s\S]*?\.profile-photo-viewer-image \{ touch-action: pan-y; overscroll-behavior-x: contain;/,
  );
});

test("live profile photos remain accessible with thumbnails and keyboard navigation", () => {
  assert.match(
    liveApp,
    /id="modalImage" role="button" tabindex="0" aria-label="Open larger profile photo\. Swipe left or right to change photos\."/,
  );
  assert.match(
    liveApp,
    /aria-pressed="\$\{offset === 0 \? "true" : "false"\}"/,
  );
  assert.match(
    liveApp,
    /thumb\.setAttribute\("aria-pressed", String\(isActive\)\)/,
  );
  assert.match(
    liveApp,
    /modalImage\?\.addEventListener\("keydown",[\s\S]*?event\.key === "ArrowLeft" \|\| event\.key === "ArrowRight"/,
  );
  assert.match(
    liveApp,
    /\.profile-modal \.gallery \{ overscroll-behavior-x: contain; scroll-snap-type: x proximity; touch-action: pan-x pan-y; \}/,
  );
  assert.match(
    liveApp,
    /id="modalPhotoSwipeHint"[\s\S]*?<span>←<\/span><strong>Swipe photos<\/strong><span>→<\/span>/,
  );
  assert.match(
    liveApp,
    /id="profilePhotoViewerSwipeHint"[\s\S]*?<span>←<\/span><strong>Swipe photos<\/strong><span>→<\/span>/,
  );
  assert.match(
    liveApp,
    /const multiplePhotos = totalPhotos > 1;[\s\S]*?modalPhotoSwipeHint\.hidden = !multiplePhotos;[\s\S]*?profilePhotoViewerSwipeHint\.hidden = !multiplePhotos/,
  );
});

test("the standalone public dancer profile uses the production swipe carousel", () => {
  assert.match(
    publicProfilePage,
    /import \{ DancerPhotoCarousel \} from "\.\/DancerPhotoCarousel"/,
  );
  assert.match(
    publicProfilePage,
    /<DancerPhotoCarousel[\s\S]*?photos=\{gallery\.map\([\s\S]*?stageName=\{profile\.stageName\}/,
  );
  assert.match(
    publicPhotoCarousel,
    /data-dancer-photo-carousel[\s\S]*?onPointerDown=\{handlePointerDown\}[\s\S]*?onPointerMove=\{handlePointerMove\}[\s\S]*?onPointerUp=\{handlePointerEnd\}/,
  );
  assert.match(
    publicPhotoCarousel,
    /Math\.abs\(distanceX\) >= SWIPE_DISTANCE_PX[\s\S]*?movePhoto\(distanceX < 0 \? 1 : -1\)/,
  );
  assert.match(
    publicPhotoCarousel,
    /onWheel=\{handleWheel\}[\s\S]*?aria-label="Show previous profile photo"[\s\S]*?aria-label="Show next profile photo"/,
  );
  assert.match(
    publicProfilePage,
    /@media \(max-width: 760px\)[\s\S]*?\.public-gallery \{[^}]*overflow-x: auto;[^}]*scroll-snap-type: x mandatory;[^}]*touch-action: pan-x pan-y;/,
  );
  assert.match(
    publicPhotoCarousel,
    /availablePhotos\.length > 1[\s\S]*?className="public-photo-swipe-hint"[\s\S]*?<span>←<\/span>[\s\S]*?<strong>Swipe photos<\/strong>[\s\S]*?<span>→<\/span>/,
  );
  assert.match(publicProfilePage, /\.public-photo-swipe-hint \{[^}]*bottom: 52px;[^}]*pointer-events: none;/);
});
