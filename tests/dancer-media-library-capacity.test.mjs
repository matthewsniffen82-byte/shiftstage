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
  assert.match(liveApp, /action-first media library[\s\S]*?profile-media-lazy-sentinel \{[\s\S]*?grid-column: 1 \/ -1 !important;[\s\S]*?height: 28px !important;/);
  assert.doesNotMatch(liveApp, /profile-media-load-more|>Load more</i);
});

test("video grids show a passive frame from each actual video", () => {
  const gridMarkup = carousel.slice(
    carousel.indexOf("{visibleItems.map"),
    carousel.indexOf("{viewer && activeViewerItem"),
  );
  const gridVideoMarkup = gridMarkup.match(/<video[\s\S]*?\/>/)?.[0] || "";
  assert.match(gridMarkup, /<video/);
  assert.match(gridVideoMarkup, /muted[\s\S]*?playsInline[\s\S]*?poster=\{item\.posterUrl \|\| undefined\}[\s\S]*?preload="none"/);
  assert.doesNotMatch(gridVideoMarkup, /src=\{/);
  assert.doesNotMatch(carousel, /posterUrl: video\.posterUrl \|\| photoMedia/);
  assert.doesNotMatch(profilePage, /posterUrl: video\.dancer\.primaryPhotoUrl/);
  assert.match(carousel, /\{viewerItems\.map\(\(item, index\) => \(/);
  assert.match(carousel, /preload=\{index === viewerIndex[\s\S]*?\? "auto"[\s\S]*?index === viewerIndex \+ 1[\s\S]*?\? "metadata"[\s\S]*?: "none"\}/);
  assert.match(carousel, /src=\{index === viewerIndex \|\| \([\s\S]*?index === viewerIndex \+ 1[\s\S]*?\? item\.videoUrl : undefined\}/);
  assert.match(liveApp, /function profileVideoThumbMarkup/);
  assert.doesNotMatch(liveApp, /function profileVideoPreviewUrl\(item\)/);
  assert.match(liveApp, /function profileVideoThumbMarkup\(item[\s\S]*?<video poster="\$\{escapeHtml\(posterUrl\)\}"[\s\S]*?muted playsinline preload="none"/);
  assert.doesNotMatch(liveApp.match(/function profileVideoPosterUrl\(item\)[\s\S]*?function profileVideoThumbMarkup/)?.[0] || "", /primaryPhotoUrl|avatarPhotoUrl/);
});
