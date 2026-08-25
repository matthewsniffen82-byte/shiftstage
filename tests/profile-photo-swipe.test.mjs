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

test("live profile grid photos open an accessible full-screen collection", () => {
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
    /profilePhotoViewerImage\?\.addEventListener\("keydown",[\s\S]*?event\.key !== "ArrowLeft" && event\.key !== "ArrowRight"[\s\S]*?moveModalPhoto\([^;]*\{ syncViewer: true \}\)/,
  );
  const galleryClickHandler = liveApp.match(
    /modalGallery\.addEventListener\("click"[\s\S]*?(?=\n    \[modalMediaPhotoTab, modalMediaTvTab\])/,
  )?.[0] || "";
  assert.ok(galleryClickHandler, "the media grid click handler must exist");
  assert.match(galleryClickHandler, /thumb\.hasAttribute\("data-profile-tv-index"\)[\s\S]*?openProfileTvViewer/);
  assert.match(galleryClickHandler, /selectModalMediaThumb\(thumb, \{ syncViewer: true \}\);[\s\S]*?openPhotoViewerFromElement\(modalImage\);/);
  assert.match(liveApp, /let profilePhotoViewerReturnTarget = null;/);
  assert.match(liveApp, /returnTarget\?\.isConnected[\s\S]*?returnTarget\.focus\(\{ preventScroll: true \}\)/);
  assert.match(
    liveApp,
    /#profileBackdrop \.gallery \{[\s\S]*?display: flex !important;[\s\S]*?overflow-x: auto !important;[\s\S]*?scroll-snap-type: x mandatory !important;/,
  );
  assert.match(liveApp, /#profileBackdrop \.gallery \.thumb \{[\s\S]*?flex: 0 0 calc\(\(100% - 4px\) \/ 3\) !important;/);
  assert.doesNotMatch(liveApp, /id="modalPhotoSwipeHint"/);
  assert.doesNotMatch(liveApp, /id="profilePhotoViewerSwipeHint"/);
  assert.match(liveApp, /id="profilePhotoViewerImage"[^>]*tabindex="0"[^>]*aria-label="Selected profile photo\. Swipe left or right to change photos\."/);
});
test("the profile presents approved photos and dancer-only videos as separate three-column grids", () => {
  assert.match(publicPhotoCarousel, /type MediaTab = ProfileMedia\["kind"\]/);
  assert.match(publicPhotoCarousel, /className="profile-media-tabs"/);
  assert.match(publicPhotoCarousel, /aria-label=\{`Photos, \$\{photoMedia\.length\}`\}/);
  assert.match(publicPhotoCarousel, /aria-label=\{`Videos, \$\{videoMedia\.length\}`\}/);
  assert.match(publicPhotoCarousel, /className="profile-media-tab-label">Photos<\/span>/);
  assert.match(publicPhotoCarousel, /className="profile-media-tab-label">Videos<\/span>/);
  assert.match(publicPhotoCarousel, /className="profile-media-tab-icon"/);
  assert.match(publicPhotoCarousel, /className="profile-media-tab-play"/);
  assert.match(publicPhotoCarousel, /activeTab === "photo" \? photoMedia : videoMedia/);
  assert.match(publicPhotoCarousel, /data-dancer-media-tabs/);
  assert.match(
    publicPhotoCarousel,
    /onClick=\{\(event\) => openViewer\(item\.kind, index, event\.currentTarget\)\}/,
  );
  assert.match(publicPhotoCarousel, /aria-label=\{`Open \$\{stageName\} \$\{item\.kind\} \$\{index \+ 1\} of \$\{activeItems\.length\}`\}/);
  assert.match(publicPhotoCarousel, /activeViewerItem\.kind === "photo"/);
  assert.match(
    publicPhotoCarousel,
    /controlsList="nofullscreen noremoteplayback nodownload"[\s\S]*?src=\{activeViewerItem\.videoUrl\}/,
  );
  assert.doesNotMatch(publicPhotoCarousel, /profile-media-feature|IntersectionObserver|inlinePlaying/);
  assert.match(
    publicProfilePage,
    /\.profile-media-grid \{[^}]*display: grid;[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/,
  );
  assert.match(
    publicProfilePage,
    /\.profile-media-grid-item \{[^}]*width: 100%;[^}]*aspect-ratio: 4 \/ 5;/,
  );
  assert.match(
    publicProfilePage,
    /\.profile-media-viewer-stage > img, \.profile-media-viewer-stage > video \{[^}]*object-fit: contain/,
  );
  assert.match(publicProfilePage, /<dt>Views today<\/dt>/);
  assert.match(liveApp, /<dt>Views today<\/dt>/);
  assert.doesNotMatch(`${publicProfilePage}\n${liveApp}`, /<dt>Notifications<\/dt>/);
  assert.doesNotMatch(publicProfilePage, /<TvVideoStrip/);
});

test("full-profile photo and video grids use stable portrait tiles", () => {
  assert.match(
    liveApp,
    /#profileBackdrop \.modal-image \{[\s\S]*?max-height: none !important;[\s\S]*?aspect-ratio: 9 \/ 16 !important;[\s\S]*?background-size: cover !important;/,
  );
  assert.match(
    liveApp,
    /@media \(max-width: 720px\) \{\s*#profileBackdrop \.modal-image \{\s*aspect-ratio: 3 \/ 4 !important;/,
  );
  assert.match(
    liveApp,
    /#profileBackdrop \.modal-image\.has-custom-photo \{[\s\S]*?background-size: cover, cover !important;/,
  );
  assert.match(liveApp, /\.profile-modal \.modal-media-video-preview > video \{[\s\S]*?object-fit: cover;/);
  assert.doesNotMatch(liveApp, /--profile-photo-aspect-ratio|syncModalPhotoAspectRatio/);
  assert.match(
    liveApp,
    /#profileBackdrop \.modal-grid > \.info-tile:not\(\.working-now-tile\):not\(\.schedule-upcoming\):not\(\.profile-club-deal-tile\)::before \{[\s\S]*?content: none !important;[\s\S]*?display: none !important;/,
  );
  assert.doesNotMatch(publicPhotoCarousel, /selectedItem|profile-media-feature/);
  assert.match(publicProfilePage, /\.profile-media-grid-item \{[^}]*aspect-ratio: 4 \/ 5;/);
  assert.match(publicProfilePage, /\.profile-media-grid-item img, \.profile-media-grid-item video \{[^}]*object-fit: cover;/);
  assert.match(publicProfilePage, /\.profile-media-viewer-stage > img, \.profile-media-viewer-stage > video \{[^}]*object-fit: contain;/);
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
    /event\.key !== "ArrowLeft"[\s\S]*?event\.key !== "ArrowRight"/,
  );
  assert.match(
    publicProfilePage,
    /@media \(max-width: 600px\)[\s\S]*?\.profile-media-viewer-previous, \.profile-media-viewer-next/,
  );
  assert.doesNotMatch(publicPhotoCarousel, /requestFullscreen|:fullscreen/);
});
