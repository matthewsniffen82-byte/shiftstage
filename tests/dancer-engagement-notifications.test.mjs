import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  migration,
  helper,
  shareRoute,
  likeRoute,
  followRoute,
  profileCarousel,
  profileShare,
  tvStrip,
  profilePage,
  tvFeed,
  dashboard,
  liveApp,
] = await Promise.all([
  readFile(new URL("../supabase/migrations/202608300008_dancer_engagement_notifications.sql", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/engagement-notifications.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/public/engagement-shares/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/public/media-likes/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/customer/follows/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/DancerPhotoCarousel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/ProfileNavigationActions.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/TvVideoStrip.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/tv/TvFeedClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
]);

test("likes and follows create deduplicated dancer engagement notifications", () => {
  assert.match(migration, /alter type public\.notification_type add value if not exists 'engagement'/);
  assert.match(helper, /deterministicNotificationId/);
  assert.match(helper, /error && error\.code !== "23505"/);
  assert.match(helper, /notification_type: "engagement"/);
  assert.match(helper, /title: "New follower"/);
  assert.match(helper, /title: `New \$\{label\} like`/);
  assert.match(likeRoute, /if \(insertedLike\)[\s\S]*?engagementType: "like"/);
  assert.match(likeRoute, /dedupeSubject: visitorHash/);
  assert.match(followRoute, /existingFollow[\s\S]*?engagementType: "follow"/);
  assert.match(followRoute, /dedupeSubject: user\.id/);
  assert.match(dashboard, /type\.includes\("engagement"\).*"Engagement"/);
});

test("successful profile, photo, and video shares reach the dancer notification endpoint", () => {
  assert.match(shareRoute, /resolvePublicDancerEngagementTarget\(admin, targetType, targetId\)/);
  assert.match(shareRoute, /namespace: "public_engagement_share"/);
  assert.match(shareRoute, /subjectLimit: 30/);
  assert.match(shareRoute, /dedupeSubject: `\$\{visitorHash\}:\$\{day\}`/);
  assert.match(profileCarousel, /recordPublicEngagementShare\(activeViewerItem\.kind, activeViewerItem\.id\)/);
  assert.match(profileShare, /recordPublicEngagementShare\("profile", dancerId\)/);
  assert.match(tvStrip, /recordPublicEngagementShare\("video", video\.id\)/);
  assert.match(liveApp, /recordPublicEngagementShare\("photo", String\(activeItem\?\.id \|\| ""\)\)/);
  assert.match(liveApp, /recordPublicEngagementShare\("video", videoId\)/);
  assert.match(liveApp, /recordProfileEngagementShare\(profileName, city\)/);
});

test("public share notifications resolve only approved public targets", () => {
  assert.match(helper, /isPublicDancerProfileEligible\(profile\)/);
  assert.match(helper, /\.eq\("review_status", "approved"\)/);
  assert.match(helper, /query\.eq\("status", "approved"\)/);
  assert.match(helper, /publishedAt > now/);
  assert.match(helper, /expiresAt <= now/);
  assert.match(shareRoute, /readBoundedJsonObject\(request/);
  assert.match(shareRoute, /UUID_PATTERN\.test\(targetId\)/);
});

test("all liked states keep neutral glass and turn only the heart red", () => {
  const combined = [profilePage, tvFeed, tvStrip, liveApp].join("\n");
  assert.doesNotMatch(combined, /#f9a8d4|244,114,182|190,24,93/);
  assert.match(profilePage, /\.profile-media-viewer-like\.is-liked svg \{ color: #ff304f; fill: currentColor; \}/);
  assert.match(tvFeed, /\.tv-like\.is-liked svg \{ color: #ff304f; fill: currentColor; \}/);
  assert.match(tvStrip, /\.tv-video-viewer-like\.is-liked svg \{ color: #ff304f; fill: currentColor; \}/);
  assert.match(liveApp, /\.home-tv-feed-like-action\[aria-pressed="true"\] svg \{[\s\S]*?color: #ff304f !important;/);
  assert.match(liveApp, /\.home-tv-feed-like-action \{[\s\S]*?width: 52px !important;[\s\S]*?height: 52px !important;[\s\S]*?border-radius: 50% !important;/);
  assert.match(liveApp, /\.home-tv-feed-action:not\(\.home-tv-feed-sound\):not\(\.home-tv-feed-like-action\)\[aria-pressed="true"\]/);
  assert.match(liveApp, /\.home-tv-feed-like-action\[aria-pressed="true"\],[\s\S]*?outline: none !important;[\s\S]*?background: rgba\(5,5,10,\.58\) !important;/);
});

test("liking and unliking media uses the heart state without success wording", () => {
  assert.match(liveApp, /if \(statusTarget\) statusTarget\.textContent = "";/);
  assert.doesNotMatch(liveApp, /statusTarget\.textContent = state\.liked \? "Liked\." : "Like removed\."/);
  assert.doesNotMatch(liveApp, /showHomeTvFeedFeedback\(slide, "Already liked"\)/);
  assert.doesNotMatch(liveApp, /showHomeTvFeedFeedback\(slide, result\.liked \? "Liked" : "Like removed"\)/);
  assert.match(liveApp, /if \(!result\.liked\) showHomeTvFeedFeedback\(slide, "Unable to like"\);/);
});

test("profile photo controls use the same icon-only circular glass treatment as profile videos", () => {
  assert.match(liveApp, /\.profile-photo-viewer-share,[\s\S]*?max-width: 52px !important;[\s\S]*?max-height: 52px !important;[\s\S]*?border-radius: 50% !important;[\s\S]*?blur\(14px\) saturate\(1\.12\)/);
  const photoShare = liveApp.match(/<button class="profile-photo-viewer-share"[\s\S]*?<\/button>/)?.[0] || "";
  assert.match(photoShare, /<svg/);
  assert.doesNotMatch(photoShare, /<span>Share<\/span>/);
});
