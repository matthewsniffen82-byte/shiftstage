import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const liveApp = fs.readFileSync("outputs/index.html", "utf8");
const publicProfilePage = fs.readFileSync("app/dancers/[slug]/page.tsx", "utf8");
const publicPhotoCarousel = fs.readFileSync(
  "app/dancers/[slug]/DancerPhotoCarousel.tsx",
  "utf8",
);

test("the live profile keeps the grid horizontal and makes full photos vertically pageable", () => {
  assert.match(
    liveApp,
    /function bindHorizontalProfilePhotoSwipe\(element, options = \{\}\)/,
  );
  assert.match(
    liveApp,
    /const vertical = options\.vertical === true;[\s\S]*?const verticalSwipe =[\s\S]*?Math\.abs\(distanceY\) >= 44[\s\S]*?moveModalPhoto\(vertical \? distanceY < 0 \? 1 : -1 : distanceX < 0 \? 1 : -1, options\)/,
  );
  assert.match(
    liveApp,
    /element\.addEventListener\("wheel",[\s\S]*?const primaryDelta = vertical \? event\.deltaY : event\.deltaX;[\s\S]*?moveModalPhoto\(primaryDelta > 0 \? 1 : -1, options\)/,
  );
  assert.match(
    liveApp,
    /bindHorizontalProfilePhotoSwipe\(modalImage\);[\s\S]*?bindHorizontalProfilePhotoSwipe\(profilePhotoViewerImage, \{ syncViewer: true, vertical: true \}\)/,
  );
  assert.match(
    liveApp,
    /\.profile-modal \.modal-image \{ touch-action: pan-y;[\s\S]*?\.profile-photo-viewer-image \{ touch-action: none; overscroll-behavior: none;/,
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
    /aria-pressed="\$\{item\.index === 0 \? "true" : "false"\}"/,
  );
  assert.match(
    liveApp,
    /thumb\.setAttribute\("aria-pressed", String\(isActive\)\)/,
  );
  assert.match(
    liveApp,
    /profilePhotoViewerImage\?\.addEventListener\("keydown",[\s\S]*?event\.key !== "ArrowUp" && event\.key !== "ArrowDown"[\s\S]*?moveModalPhoto\(event\.key === "ArrowDown" \? 1 : -1, \{ syncViewer: true \}\)/,
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
  assert.match(liveApp, /id="profilePhotoViewerImage"[^>]*tabindex="0"[^>]*aria-label="Selected profile photo\. Swipe up or down to change photos\."/);
  assert.doesNotMatch(liveApp, /id="profilePhotoViewerName"/);
  assert.doesNotMatch(liveApp, /id="profilePhotoViewerPosition"/);
  assert.doesNotMatch(liveApp, /class="profile-photo-viewer-copy"/);
  assert.match(liveApp, /id="profilePhotoViewerPrevious"[^>]*aria-label="Previous dancer photo"/);
  assert.match(liveApp, /id="profilePhotoViewerNext"[^>]*aria-label="Next dancer photo"/);
  assert.doesNotMatch(liveApp, /profilePhotoScheduleLabel|Swipe up or down · Photo/);
  assert.match(liveApp, /\.profile-photo-viewer-image \{[\s\S]*?background-size: cover !important;/);
  assert.match(
    liveApp,
    /async function requestProfilePhotoViewerFullscreen\(overlay\)[\s\S]*?overlay\.requestFullscreen\(\{ navigationUI: "hide" \}\)[\s\S]*?overlay\.webkitRequestFullscreen\(\)/,
  );
  assert.match(liveApp, /void requestProfilePhotoViewerFullscreen\(profilePhotoViewer\)/);
  assert.match(liveApp, /function exitProfilePhotoViewerFullscreen\(\)[\s\S]*?document\.exitFullscreen[\s\S]*?document\.webkitExitFullscreen/);
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
  assert.doesNotMatch(publicPhotoCarousel, /profile-media-feature|inlinePlaying/);
  assert.match(publicPhotoCarousel, /new IntersectionObserver/);
  assert.match(publicPhotoCarousel, /DANCER_PROFILE_MEDIA_PAGE_SIZE/);
  assert.match(publicPhotoCarousel, /data-profile-media-lazy-sentinel/);
  assert.doesNotMatch(publicPhotoCarousel, /Load more/);
  assert.match(
    publicProfilePage,
    /\.profile-media-grid \{[^}]*display: grid;[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/,
  );
  assert.match(
    publicProfilePage,
    /\.profile-media-grid-item \{[^}]*width: 100%;[^}]*aspect-ratio: 9 \/ 16;/,
  );
  assert.match(
    publicProfilePage,
    /\.profile-media-viewer-stage > img, \.profile-media-viewer-stage > video \{[^}]*object-fit: contain/,
  );
  assert.match(publicProfilePage, /\.profile-media-viewer\.is-photo \.profile-media-viewer-stage > img \{ object-fit: cover; \}/);
  assert.match(publicProfilePage, /<dt>Views today<\/dt>/);
  assert.match(liveApp, /<dt>Views today<\/dt>/);
  assert.doesNotMatch(`${publicProfilePage}\n${liveApp}`, /<dt>Notifications<\/dt>/);
  assert.doesNotMatch(publicProfilePage, /<TvVideoStrip/);
});

test("full-profile photo and video grids use stable tall portrait tiles", () => {
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
  assert.match(publicProfilePage, /\.profile-media-grid-item \{[^}]*aspect-ratio: 9 \/ 16;/);
  assert.match(publicProfilePage, /\.profile-media-grid-item img, \.profile-media-grid-item video \{[^}]*object-fit: cover;/);
  assert.match(publicProfilePage, /\.profile-media-viewer-stage > img, \.profile-media-viewer-stage > video \{[^}]*object-fit: contain;/);
  assert.match(publicProfilePage, /\.profile-media-viewer\.is-photo \.profile-media-viewer-stage > img \{ object-fit: cover; \}/);
});


test("the standalone profile uses vertical profile-scoped full-screen media paging", () => {
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
    /const mediaSwipe =[\s\S]*?Math\.abs\(distanceY\) >= SWIPE_DISTANCE_PX[\s\S]*?showRelativeViewerItem\(distanceY < 0 \? 1 : -1\)/,
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
    /const previousKey = "ArrowUp";[\s\S]*?const nextKey = "ArrowDown";/,
  );
  assert.match(
    publicProfilePage,
    /@media \(max-width: 600px\)[\s\S]*?\.profile-media-viewer-previous, \.profile-media-viewer-next/,
  );
  assert.match(publicPhotoCarousel, /flushSync\(\(\) => setViewer\(\{ kind, index \}\)\);[\s\S]*?requestViewerFullscreen\(\)/);
  assert.match(publicPhotoCarousel, /element\.requestFullscreen\(\{ navigationUI: "hide" \}\)/);
  assert.match(publicProfilePage, /\.profile-media-viewer:fullscreen/);
  assert.match(publicPhotoCarousel, /viewer\.kind === "video"[\s\S]*?\{viewerStatus\} · Swipe up or down · Video/);
  assert.doesNotMatch(publicPhotoCarousel, /viewer\.kind === "photo"[\s\S]*?profile-media-viewer-copy/);
});
