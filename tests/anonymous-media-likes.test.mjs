import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [route, migration, hook, carousel, feed, strip, liveApp, publicData, tvData, dancerData] = await Promise.all([
  readFile(new URL("../app/api/public/media-likes/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608300007_anonymous_media_likes.sql", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/use-anonymous-media-likes.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/DancerPhotoCarousel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/tv/TvFeedClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/TvVideoStrip.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/public.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/tv.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/dancer.ts", import.meta.url), "utf8"),
]);

test("anonymous media likes use a private durable browser identity and one row per target", () => {
  assert.match(migration, /create table if not exists public\.media_likes/);
  assert.match(migration, /num_nonnulls\(photo_id, video_id\) = 1/);
  assert.match(migration, /media_likes_visitor_photo_unique/);
  assert.match(migration, /media_likes_visitor_video_unique/);
  assert.match(migration, /alter table public\.media_likes enable row level security/);
  assert.match(migration, /revoke all on table public\.media_likes from public, anon, authenticated/);
  assert.match(route, /randomBytes\(32\)\.toString\("base64url"\)/);
  assert.match(route, /createHash\("sha256"\)\.update\(token\)/);
  assert.match(route, /httpOnly: true/);
  assert.match(route, /sameSite: "lax"/);
  assert.doesNotMatch(route, /createRequestSupabaseContext|getBearerToken|customerId|profile required/i);
});

test("media likes are toggleable, rate limited, and counted by database triggers", () => {
  assert.match(route, /body\?\.liked !== false/);
  assert.match(route, /error && error\.code !== "23505"/);
  assert.match(route, /\.delete\(\)[\s\S]*?visitor_token_hash/);
  assert.match(route, /namespace: "public_media_like"/);
  assert.match(route, /subjectLimit: 60/);
  assert.match(migration, /after insert or delete on public\.media_likes/);
  assert.match(migration, /set like_count = like_count \+ 1/);
  assert.match(migration, /set like_count = greatest\(0, like_count - 1\)/);
});

test("only public approved photos and videos can receive anonymous likes", () => {
  assert.match(route, /isPublicDancerProfileEligible\(one\(row\.dancer_profiles\)\)/);
  assert.match(route, /\.eq\("review_status", "approved"\)/);
  assert.match(route, /\.from\("mydancr_tv_videos"\)[\s\S]*?\.eq\("status", "approved"\)/);
  assert.match(route, /publishedAt <= now/);
  assert.match(route, /expiresAt > now/);
});

test("all public profile and TV surfaces use the same no-account like endpoint", () => {
  assert.match(hook, /fetch\(`\/api\/public\/media-likes\?/);
  assert.match(hook, /fetch\("\/api\/public\/media-likes"/);
  assert.match(hook, /credentials: "same-origin"/);
  assert.match(hook, /Math\.max\(0, previous\.likeCount \+ \(liked \? 1 : -1\)\)/);
  assert.match(carousel, /className="profile-media-viewer-like"/);
  assert.match(feed, /className="tv-like"/);
  assert.match(strip, /className="tv-video-viewer-like"/);
  assert.match(liveApp, /id="profilePhotoViewerLike"/);
  assert.match(liveApp, /data-like-profile-tv/);
  assert.match(liveApp, /home-tv-feed-like-action/);
  assert.match(liveApp, /function togglePublicMediaLike/);
  assert.doesNotMatch(liveApp.match(/async function togglePublicMediaLike[\s\S]*?\n    \}/)?.[0] || "", /requireCustomerAccount|accountRequired/);
});

test("public payloads carry only media IDs and aggregate counts needed by the like UI", () => {
  assert.match(publicData, /galleryPhotoIds: approvedPhotos\.map/);
  assert.match(publicData, /galleryPhotoLikeCounts: approvedPhotos\.map/);
  assert.match(tvData, /likeCount: safePublicCount\(row\.like_count\)/);
  assert.match(dancerData, /countDancerMediaLikes\(client, dancerId\)/);
  assert.match(dancerData, /mediaLikes,/);
  assert.doesNotMatch(dancerData.match(/return \{[\s\S]*?mediaLikes,[\s\S]*?\};/)?.[0] || "", /rank.*mediaLikes|mediaLikes.*rank/i);
  assert.match(liveApp, /metricCardMarkup\(compactNumber\(dashboardMetrics\.mediaLikes\), "Media likes"\)/);
  assert.match(migration, /Raw visitor tokens are never stored/);
});
