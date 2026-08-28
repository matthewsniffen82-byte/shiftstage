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
    /bindHorizontalProfilePhotoSwipe\(modalImage\);[\s\S]*?profilePhotoViewerImage\?\.addEventListener\("scroll"/,
  );
  assert.match(
    liveApp,
    /\.profile-photo-viewer-image \{[\s\S]*?overflow-y: auto;[\s\S]*?scroll-snap-type: y mandatory;[\s\S]*?touch-action: pan-y;/,
  );
  assert.match(liveApp, /\.profile-photo-viewer-slide \{[\s\S]*?scroll-snap-align: start;[\s\S]*?scroll-snap-stop: always;/);
  assert.match(liveApp, /Math\.round\(profilePhotoViewerImage\.scrollTop \/ profilePhotoViewerImage\.clientHeight\)/);
  assert.doesNotMatch(liveApp, /profilePhotoSwipeBlockClickUntil/);
});

test("live profile grid photos open an accessible full-screen collection", () => {
  assert.match(
    liveApp,
    /id="modalImage" role="group" tabindex="0" aria-label="Profile photos and videos\. Swipe left or right to change media\."/,
  );
  assert.match(
    liveApp,
    /aria-pressed="\$\{galleryIndex === 0 \? "true" : "false"\}"/,
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
  assert.match(galleryClickHandler, /selectModalMediaThumb\(thumb, \{ syncViewer: true \}\);[\s\S]*?openPhotoViewerFromElement\(modalImage, Number\.isInteger\(photoIndex\) \? photoIndex : null\);/);
  assert.match(liveApp, /let profilePhotoViewerReturnTarget = null;/);
  assert.match(liveApp, /returnTarget\?\.isConnected[\s\S]*?returnTarget\.focus\(\{ preventScroll: true \}\)/);
  assert.match(
    liveApp,
    /#profileBackdrop \.gallery \{[\s\S]*?display: flex !important;[\s\S]*?overflow-x: auto !important;[\s\S]*?scroll-snap-type: x mandatory !important;/,
  );
  assert.match(liveApp, /#profileBackdrop \.gallery \.thumb \{[\s\S]*?flex: 0 0 calc\(\(100% - 4px\) \/ 3\) !important;/);
  assert.doesNotMatch(liveApp, /id="modalPhotoSwipeHint"/);
  assert.doesNotMatch(liveApp, /id="profilePhotoViewerSwipeHint"/);
  assert.match(liveApp, /id="profilePhotoViewerImage"[^>]*role="group"[^>]*tabindex="0"[^>]*aria-label="Dancer photos\. Scroll up or down to change photos\."/);
  assert.doesNotMatch(liveApp, /id="profilePhotoViewerName"/);
  assert.doesNotMatch(liveApp, /id="profilePhotoViewerPosition"/);
  assert.doesNotMatch(liveApp, /class="profile-photo-viewer-copy"/);
  assert.match(liveApp, /id="profilePhotoViewerPrevious"[^>]*aria-label="Previous dancer photo"/);
  assert.match(liveApp, /id="profilePhotoViewerNext"[^>]*aria-label="Next dancer photo"/);
  assert.doesNotMatch(liveApp, /profilePhotoScheduleLabel|Swipe up or down · Photo/);
  assert.match(liveApp, /\.profile-photo-viewer-slide-image \{[\s\S]*?background-size: cover !important;/);
  assert.match(liveApp, /\.profile-photo-viewer-footer \{[\s\S]*?background: transparent;/);
  assert.match(
    liveApp,
    /async function requestProfilePhotoViewerFullscreen\(overlay, requestedIndex\)[\s\S]*?overlay\.requestFullscreen\(\{ navigationUI: "hide" \}\)[\s\S]*?overlay\.webkitRequestFullscreen\(\)/,
  );
  assert.match(liveApp, /void requestProfilePhotoViewerFullscreen\(profilePhotoViewer, initialIndex\)/);
  assert.match(liveApp, /function exitProfilePhotoViewerFullscreen\(\)[\s\S]*?document\.exitFullscreen[\s\S]*?document\.webkitExitFullscreen/);
});

test("a tapped profile photo or video is the first full-screen item shown", () => {
  const galleryClickHandler = liveApp.match(
    /modalGallery\.addEventListener\("click"[\s\S]*?(?=\n    \[modalMediaPhotoTab, modalMediaTvTab\])/,
  )?.[0] || "";
  assert.match(
    galleryClickHandler,
    /const videoIndex = Number\(thumb\.dataset\.profileTvIndex\);[\s\S]*?openProfileTvViewer\(item, modalGallery\.profileTvProfileName \|\| "Dancer", videos, videoIndex\)/,
  );
  assert.match(
    galleryClickHandler,
    /const photoIndex = Number\(thumb\.dataset\.profilePhotoIndex\);[\s\S]*?openPhotoViewerFromElement\(modalImage, Number\.isInteger\(photoIndex\) \? photoIndex : null\)/,
  );
  assert.match(
    liveApp,
    /function openProfileTvViewer\(item, profileName, videos, requestedIndex = null\)[\s\S]*?requestedIndex !== null && Number\.isInteger\(parsedRequestedIndex\)[\s\S]*?parsedRequestedIndex/,
  );
  assert.match(
    liveApp,
    /function openPhotoViewerFromElement\(element, requestedIndex = null\)[\s\S]*?requestedIndex !== null && Number\.isInteger\(parsedRequestedIndex\)[\s\S]*?parsedRequestedIndex/,
  );
  assert.match(liveApp, /top: activeSlide\?\.offsetTop \?\? index \* stage\.clientHeight/);
  assert.match(liveApp, /top: activeSlide\?\.offsetTop \?\? activePhotoIndex \* profilePhotoViewerImage\.clientHeight/);
  assert.match(
    publicPhotoCarousel,
    /flushSync\(\(\) => setViewer\(\{ kind, index \}\)\);[\s\S]*?scrollViewerToIndex\(index, \{ instant: true \}\)[\s\S]*?requestViewerFullscreen\(index\)/,
  );
  assert.match(
    publicPhotoCarousel,
    /await request\(\);[\s\S]*?finally \{[\s\S]*?settleViewerAtIndex\(requestedIndex\)/,
  );
  assert.match(publicPhotoCarousel, /top: slide\?\.offsetTop \?\? index \* feed\.clientHeight/);
});

test("fullscreen layout cannot reset a clicked profile video to the first slide", () => {
  const resolverSource = liveApp.match(
    /function profileTvViewerScrollTarget\(openingIndexValue, scrollTop, clientHeight\) \{[\s\S]*?\n    \}/,
  )?.[0] || "";
  assert.ok(resolverSource, "the profile video opening-index resolver must exist");
  const resolveScrollTarget = Function(
    `"use strict"; ${resolverSource}; return profileTvViewerScrollTarget;`,
  )();
  assert.deepEqual(resolveScrollTarget("2", 0, 800), { index: 2, locked: true });
  assert.deepEqual(resolveScrollTarget(undefined, 1600, 800), { index: 2, locked: false });
  assert.match(
    liveApp,
    /overlay\.dataset\.openingVideoIndex = String\(initialIndex\)[\s\S]*?requestProfileTvViewerFullscreen\(overlay\)\.then\(\(\) => \{[\s\S]*?settleProfileTvViewerOpening\(overlay, initialIndex\)/,
  );
  assert.match(
    liveApp,
    /const target = profileTvViewerScrollTarget\([\s\S]*?if \(target\.locked\) \{[\s\S]*?scrollProfileTvViewerTo\(target\.index, \{ instant: true \}\);[\s\S]*?return;/,
  );
  assert.match(
    publicPhotoCarousel,
    /viewerOpeningIndex\.current = index;[\s\S]*?requestViewerFullscreen\(index\)/,
  );
  assert.match(
    publicPhotoCarousel,
    /function handleViewerScroll\(\) \{[\s\S]*?viewerOpeningIndex\.current !== null[\s\S]*?scrollViewerToIndex\(viewerOpeningIndex\.current, \{ instant: true \}\);[\s\S]*?return;/,
  );
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
  assert.match(publicPhotoCarousel, /viewerItems\.map\(\(item, index\) =>/);
  assert.match(publicPhotoCarousel, /className="profile-media-viewer-slide"/);
  assert.match(
    publicPhotoCarousel,
    /controlsList="nofullscreen noremoteplayback nodownload"[\s\S]*?src=\{item\.videoUrl\}/,
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
    /\.profile-media-viewer-slide > img, \.profile-media-viewer-slide > video \{[^}]*object-fit: contain/,
  );
  assert.match(publicProfilePage, /\.profile-media-viewer\.is-photo \.profile-media-viewer-slide > img \{ object-fit: cover; \}/);
  assert.match(publicProfilePage, /\.profile-media-viewer\.is-photo \.profile-media-viewer-footer \{ background: transparent; \}/);
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
  assert.match(publicProfilePage, /\.profile-media-viewer-slide > img, \.profile-media-viewer-slide > video \{[^}]*object-fit: contain;/);
  assert.match(publicProfilePage, /\.profile-media-viewer\.is-photo \.profile-media-viewer-slide > img \{ object-fit: cover; \}/);
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
    /data-profile-media-snap-feed[\s\S]*?onScroll=\{handleViewerScroll\}[\s\S]*?ref=\{viewerFeed\}/,
  );
  assert.match(
    publicPhotoCarousel,
    /viewerItems\.map\(\(item, index\) =>[\s\S]*?className="profile-media-viewer-slide"[\s\S]*?data-profile-media-viewer-index=\{index\}/,
  );
  assert.match(
    publicPhotoCarousel,
    /scrollViewerToIndex\(nextIndex\)[\s\S]*?className="profile-media-viewer-previous"[\s\S]*?className="profile-media-viewer-next"/,
  );
  assert.match(
    publicProfilePage,
    /\.profile-media-viewer \{[^}]*position: fixed;[^}]*inset: 0;[^}]*touch-action: none;/,
  );
  assert.match(
    publicProfilePage,
    /\.profile-media-viewer-stage \{[^}]*overflow-y: auto;[^}]*scroll-snap-type: y mandatory;[^}]*touch-action: pan-y;/,
  );
  assert.match(
    publicPhotoCarousel,
    /const previousKey = "ArrowUp";[\s\S]*?const nextKey = "ArrowDown";/,
  );
  assert.match(
    publicProfilePage,
    /@media \(max-width: 600px\)[\s\S]*?\.profile-media-viewer-previous, \.profile-media-viewer-next/,
  );
  assert.match(publicPhotoCarousel, /flushSync\(\(\) => setViewer\(\{ kind, index \}\)\);[\s\S]*?requestViewerFullscreen\(index\)/);
  assert.match(publicPhotoCarousel, /element\.requestFullscreen\(\{ navigationUI: "hide" \}\)/);
  assert.match(publicProfilePage, /\.profile-media-viewer:fullscreen/);
  assert.match(publicPhotoCarousel, /viewer\.kind === "video"[\s\S]*?\{viewerStatus\} · Scroll up or down · Video/);
  assert.doesNotMatch(publicPhotoCarousel, /viewer\.kind === "photo"[\s\S]*?profile-media-viewer-copy/);
});
