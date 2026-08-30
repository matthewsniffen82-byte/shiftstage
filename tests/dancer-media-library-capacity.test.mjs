import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  limits,
  carousel,
  profilePage,
  profileRoute,
  imageModeration,
  tvSource,
  liveApp,
] = await Promise.all([
  readFile(new URL("../src/lib/dancr/media-limits.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/DancerPhotoCarousel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/profile/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/image-moderation.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/tv.ts", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
]);

test("dancer profiles accept fifty photos and fifty videos through shared limits", () => {
  assert.match(limits, /MAX_DANCER_PROFILE_PHOTOS = 50/);
  assert.match(limits, /MAX_DANCER_PROFILE_VIDEOS = 50/);
  assert.match(profileRoute, /MAX_DANCER_PROFILE_PHOTOS/);
  assert.match(imageModeration, /sortOrder <= MAX_DANCER_PROFILE_PHOTOS/);
  assert.match(tvSource, /MYDANCR_TV_PROFILE_VIDEO_LIMIT = MAX_DANCER_PROFILE_VIDEOS/);
  assert.match(profilePage, /limit: MAX_DANCER_PROFILE_VIDEOS/);
  assert.match(liveApp, /const MAX_DANCER_PROFILE_PHOTOS = 50/);
  assert.match(liveApp, /const MAX_DANCER_PROFILE_VIDEOS = 50/);
});

test("public media grids lazy-render in batches of twelve without a load button", () => {
  assert.match(limits, /DANCER_PROFILE_MEDIA_PAGE_SIZE = 12/);
  assert.match(carousel, /activeItems\.slice\(0, visibleItemCount\)/);
  assert.match(carousel, /new IntersectionObserver/);
  assert.match(carousel, /current\[activeTab\] \+ DANCER_PROFILE_MEDIA_PAGE_SIZE/);
  assert.match(carousel, /data-profile-media-lazy-sentinel/);
  assert.doesNotMatch(carousel, /Load more/);
  assert.match(liveApp, /const PROFILE_MEDIA_PAGE_SIZE = 12/);
  assert.match(liveApp, /function appendNextProfileMediaBatch/);
  assert.match(liveApp, /function observeProfileMediaSentinel/);
  assert.match(liveApp, /root: profileModal, rootMargin: "480px 0px"/);
  assert.match(liveApp, /const PROFILE_MEDIA_BATCH_SCROLL_STEP = 96/);
  assert.match(liveApp, /profileMediaLastAppendScrollTop = Math\.max\(0, Number\(profileModal\?\.scrollTop \|\| 0\)\)/);
  assert.match(liveApp, /scrollTop < profileMediaLastAppendScrollTop \+ PROFILE_MEDIA_BATCH_SCROLL_STEP/);
  assert.match(liveApp, /profileModal\?\.addEventListener\("scroll", queueProfileMediaObserverAfterScroll, \{ passive: true \}\)/);
  assert.match(liveApp, /action-first media library[\s\S]*?profile-media-lazy-sentinel \{[\s\S]*?grid-column: 1 \/ -1 !important;[\s\S]*?height: 28px !important;/);
  assert.doesNotMatch(liveApp, /profile-media-load-more|>Load more</i);
});

test("fifty-photo viewers keep only the active media window network-active", () => {
  const reactViewer = carousel.slice(
    carousel.indexOf("{viewerItems.map"),
    carousel.indexOf('<div className="profile-media-viewer-footer">'),
  );
  assert.match(reactViewer, /src=\{Math\.abs\(index - viewerIndex\) <= 1 \? item\.imageUrl : undefined\}/);
  assert.match(reactViewer, /srcSet=\{Math\.abs\(index - viewerIndex\) <= 1 \? item\.imageSrcSet \|\| undefined : undefined\}/);

  const legacyViewer = liveApp.slice(
    liveApp.indexOf("function renderProfilePhotoViewerSlides()"),
    liveApp.indexOf("function closeProfilePhotoViewer()"),
  );
  assert.match(legacyViewer, /image\.dataset\.profilePhotoUrl = String\(item\.photoUrl \|\| ""\)\.trim\(\)/);
  assert.match(legacyViewer, /function syncProfilePhotoViewerWindow\(activePhotoIndex\)/);
  assert.match(legacyViewer, /Math\.abs\(index - activePhotoIndex\) > 1/);
  assert.match(legacyViewer, /image\.style\.removeProperty\("background-image"\)/);
  assert.match(legacyViewer, /syncProfilePhotoViewerWindow\(activePhotoIndex\)/);
  const initialRenderer = legacyViewer.slice(0, legacyViewer.indexOf("function syncProfilePhotoViewerWindow"));
  assert.doesNotMatch(initialRenderer, /style\.backgroundImage/);
});

test("video grids show a passive frame from each actual video", () => {
  const gridMarkup = carousel.slice(
    carousel.indexOf("{visibleItems.map"),
    carousel.indexOf("{viewer && activeViewerItem"),
  );
  const gridPosterMarkup = gridMarkup.match(/<img[\s\S]*?src=\{item\.posterUrl\}[\s\S]*?\/>/)?.[0] || "";
  assert.match(gridPosterMarkup, /data-image-state="loading"[\s\S]*?loading="lazy"[\s\S]*?src=\{item\.posterUrl\}/);
  assert.doesNotMatch(gridMarkup, /<video[\s\S]*?poster=\{item\.posterUrl \|\| undefined\}[\s\S]*?preload="none"/);
  assert.doesNotMatch(carousel, /posterUrl: video\.posterUrl \|\| photoMedia/);
  assert.doesNotMatch(profilePage, /posterUrl: video\.dancer\.primaryPhotoUrl/);
  assert.match(carousel, /\{viewerItems\.map\(\(item, index\) => \(/);
  assert.match(carousel, /preload=\{index === viewerIndex[\s\S]*?\? "auto"[\s\S]*?index === viewerIndex \+ 1[\s\S]*?\? "metadata"[\s\S]*?: "none"\}/);
  assert.match(carousel, /src=\{index === viewerIndex \|\| \([\s\S]*?index === viewerIndex \+ 1[\s\S]*?\? item\.videoUrl : undefined\}/);
  assert.match(liveApp, /function profileVideoThumbMarkup/);
  assert.doesNotMatch(liveApp, /function profileVideoPreviewUrl\(item\)/);
  assert.match(liveApp, /function profileVideoThumbMarkup\(item[\s\S]*?<img class="portrait profile-media-thumb-poster-image" src="\$\{escapeHtml\(posterUrl\)\}"[\s\S]*?loading="lazy"[\s\S]*?data-image-state="loading"/);
  assert.doesNotMatch(liveApp.match(/function profileVideoPosterUrl\(item\)[\s\S]*?function profileVideoThumbMarkup/)?.[0] || "", /primaryPhotoUrl|avatarPhotoUrl/);
});
