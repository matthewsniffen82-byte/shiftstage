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
  assert.match(liveApp, /root: modalGallery, rootMargin: "0px 480px"/);
  assert.match(liveApp, /profile-media-lazy-sentinel \{[\s\S]*?flex: 0 0 28px/);
  assert.doesNotMatch(liveApp, /profile-media-load-more|>Load more</i);
});

test("video grids use poster images and only create video elements in viewers", () => {
  const gridMarkup = carousel.slice(
    carousel.indexOf("{visibleItems.map"),
    carousel.indexOf("{viewer && activeViewerItem"),
  );
  assert.match(gridMarkup, /item\.posterUrl/);
  assert.doesNotMatch(gridMarkup, /<video/);
  assert.match(carousel, /className="profile-media-viewer-preload"/);
  assert.match(carousel, /preload="metadata"/);
  assert.match(liveApp, /function profileVideoThumbMarkup/);
  assert.match(liveApp, /profileVideoPosterUrl\(item\)/);
});
