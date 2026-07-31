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
    /\.profile-modal \.modal-image,[\s\S]*?\.profile-photo-viewer-image \{ touch-action: pan-y; overscroll-behavior-x: contain;/,
  );
  assert.doesNotMatch(liveApp, /profilePhotoSwipeBlockClickUntil/);
});

test("live profile photos remain accessible with thumbnails and keyboard navigation", () => {
  assert.match(
    liveApp,
    /id="modalImage" role="group" tabindex="0" aria-label="Profile photos and videos\. Swipe left or right to change media\."/,
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
  assert.doesNotMatch(liveApp, /id="modalPhotoSwipeHint"/);
  assert.doesNotMatch(liveApp, /id="profilePhotoViewerSwipeHint"/);
  assert.doesNotMatch(
    liveApp,
    /modalImage\?\.addEventListener\("click",[\s\S]*?openProfilePhotoViewer\(\)/,
  );
});
test("the profile separates approved photos and dancer-only TV videos into one tabbed media section", () => {
  assert.match(publicPhotoCarousel, /type MediaTab = ProfileMedia\["kind"\]/);
  assert.match(publicPhotoCarousel, /className="profile-media-tabs"/);
  assert.match(publicPhotoCarousel, /Photos <span>\{photoMedia\.length\}<\/span>/);
  assert.match(publicPhotoCarousel, /TV <span>\{videoMedia\.length\}<\/span>/);
  assert.match(publicPhotoCarousel, /activeTab === "photo" \? photoMedia : videoMedia/);
  assert.match(
    publicPhotoCarousel,
    /className="profile-media-grid"[\s\S]*?activeItems\.map\(\(item, index\) =>/,
  );
  assert.match(publicPhotoCarousel, /data-dancer-media-tabs/);
  assert.match(
    publicPhotoCarousel,
    /onClick=\{\(\) => openViewer\(item\.kind, index\)\}/,
  );
  assert.match(
    publicPhotoCarousel,
    /className="profile-media-viewer"[\s\S]*?activeViewerItem\.kind === "photo"/,
  );
  assert.match(
    publicPhotoCarousel,
    /controlsList="nofullscreen noremoteplayback nodownload"[\s\S]*?src=\{activeViewerItem\.videoUrl\}/,
  );
  assert.match(
    publicProfilePage,
    /\.profile-media-grid \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    publicProfilePage,
    /\.profile-media-viewer-stage > img, \.profile-media-viewer-stage > video \{[^}]*object-fit: contain/,
  );
  assert.doesNotMatch(`${publicProfilePage}\n${liveApp}`, /VIEWED TODAY|viewed-today/);
  assert.doesNotMatch(publicProfilePage, /<TvVideoStrip/);
});


test("the standalone public dancer profile uses the production full-screen horizontal media viewer", () => {
  assert.match(
    publicProfilePage,
    /import \{ DancerPhotoCarousel \} from "\.\/DancerPhotoCarousel"/,
  );
  assert.match(
    publicProfilePage,
    /<DancerPhotoCarousel[\s\S]*?photos=\{gallery\.map\([\s\S]*?videos=\{tvVideos\.map\([\s\S]*?stageName=\{profile\.stageName\}/,
  );
  assert.match(
    publicPhotoCarousel,
    /data-profile-media-swipe-surface[\s\S]*?onPointerDown=\{handlePointerDown\}[\s\S]*?onPointerMove=\{handlePointerMove\}[\s\S]*?onPointerUp=\{handlePointerEnd\}/,
  );
  assert.match(
    publicPhotoCarousel,
    /Math\.abs\(distanceX\) >= SWIPE_DISTANCE_PX[\s\S]*?showRelativeViewerItem\(distanceX < 0 \? 1 : -1\)/,
  );
  assert.match(
    publicPhotoCarousel,
    /onWheel=\{handleWheel\}[\s\S]*?className="profile-media-viewer-previous"[\s\S]*?className="profile-media-viewer-next"/,
  );
  assert.match(
    publicProfilePage,
    /\.profile-media-viewer \{[^}]*position: fixed;[^}]*inset: 0;[^}]*touch-action: none;/,
  );
  assert.match(
    publicProfilePage,
    /\.profile-media-viewer-stage \{[^}]*touch-action: none;/,
  );
  assert.match(
    publicPhotoCarousel,
    /event\.key === "ArrowLeft"[\s\S]*?event\.key === "ArrowRight"/,
  );
  assert.match(
    publicProfilePage,
    /@media \(max-width: 600px\)[\s\S]*?\.profile-media-viewer-previous, \.profile-media-viewer-next/,
  );
  assert.doesNotMatch(publicPhotoCarousel, /requestFullscreen|:fullscreen/);
});
