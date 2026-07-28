import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  migration,
  tvSource,
  publicRoute,
  feedClient,
  dancerApi,
  dancerStudio,
  adminApi,
  adminPanel,
  venueApi,
  venuePanel,
  dancerPage,
  venuePage,
  liveApp,
] = await Promise.all([
  readFile(new URL("../supabase/migrations/202607270001_mydancr_tv.sql", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/tv.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/public/tv/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/tv/TvFeedClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/tv/videos/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DancerTvStudio.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/tv/videos/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/AdminTvPanel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/tv/videos/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/VenueTvPanel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/venues/[slug]/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
]);

test("MyDancr TV stores private reviewed videos and enforces profile visibility", () => {
  assert.match(migration, /create table if not exists public\.mydancr_tv_videos/);
  assert.match(migration, /status in \('uploading', 'submitted', 'approved', 'rejected', 'hidden', 'expired'\)/);
  assert.match(migration, /'mydancr-tv-videos',[\s\S]*?false,[\s\S]*?78643200/);
  assert.match(migration, /array\['video\/mp4', 'video\/webm'\]/);
  assert.match(migration, /dancer\.is_public = true/);
  assert.match(migration, /dancer\.verification_status = 'approved'/);
  assert.match(migration, /dancer\.photo_review_status = 'approved'/);
  assert.match(migration, /Video mutations intentionally have no dancer RLS policy/);
  assert.doesNotMatch(migration, /create policy "dancers create own MyDancr TV videos"/);
});

test("dancer uploads are direct, validated, persistent, and submitted for review", () => {
  assert.match(dancerApi, /createRequestSupabaseContext\(request\)/);
  assert.match(dancerApi, /createMyDancrTvUpload/);
  assert.match(tvSource, /createSignedUploadUrl\(storagePath\)/);
  assert.match(tvSource, /MYDANCR_TV_MAX_BYTES = 75 \* 1024 \* 1024/);
  assert.match(tvSource, /MYDANCR_TV_MAX_DURATION_SECONDS = 90/);
  assert.match(tvSource, /status: "submitted"/);
  assert.match(dancerStudio, /uploadToSignedUrl\(data\.upload\.path, data\.upload\.token, file/);
  assert.match(dancerStudio, /Your video was submitted for MyDancr TV review/);
  assert.match(dancerStudio, /Under review/);
  assert.match(dancerStudio, /Incognito is on/);
  assert.doesNotMatch(dancerStudio, /sample video|placeholder video|mock/i);
});

test("public feed is real, navigable, measurable, and preserves existing discovery sections", () => {
  assert.match(publicRoute, /getPublicMyDancrTvFeed/);
  assert.match(feedClient, /For You/);
  assert.match(feedClient, /Following/);
  assert.match(feedClient, /Tonight/);
  assert.match(feedClient, /New/);
  assert.match(feedClient, /href=\{`\/tonight\?city=/);
  assert.match(feedClient, /href=\{`\/dancers\?city=/);
  assert.match(feedClient, /href=\{`\/venues\?city=/);
  assert.match(feedClient, /href=\{`\/trending\?city=/);
  assert.match(feedClient, /No sign-in needed/);
  assert.match(feedClient, /Sign in required/);
  assert.match(feedClient, /eventType: "engaged_view"|trackEvent\((?:video\.id|videoId), "engaged_view"\)/);
  assert.match(feedClient, /\/api\/reports/);
  assert.match(liveApp, /data-tv-link="true" href="\/tv"/);
  assert.match(liveApp, /id="homeTvPreviewList"/);
  assert.match(liveApp, /loadProfileMyDancrTv/);
});

test("administrator and venue controls persist confirmed decisions", () => {
  assert.match(adminApi, /requireAdmin\(client, user\.id\)/);
  assert.match(adminApi, /reviewMyDancrTvVideo/);
  assert.match(migration, /record_mydancr_tv_review_decision/);
  assert.match(migration, /'tv_video_status'/);
  assert.match(migration, /insert into public\.admin_actions/);
  assert.match(tvSource, /event: "mydancr_tv\.admin_decision"/);
  assert.match(adminPanel, /Approve and publish/);
  assert.match(adminPanel, /Reject video/);
  assert.match(adminPanel, /window\.confirm/);
  assert.match(venueApi, /requireActiveVenue/);
  assert.match(venueApi, /updateVenueMyDancrTvVideo/);
  assert.match(venuePanel, /Confirm tag/);
  assert.match(venuePanel, /Feature on venue page/);
  assert.match(venuePanel, /Engaged views/);
  assert.match(venuePanel, /Venue visits/);
});

test("approved videos appear on real dancer and venue pages", () => {
  assert.match(dancerPage, /getPublicMyDancrTvFeed/);
  assert.match(dancerPage, /dancerId: profile\.id/);
  assert.match(dancerPage, /<TvVideoStrip/);
  assert.match(venuePage, /getPublicMyDancrTvFeed/);
  assert.match(venuePage, /venueId: venue\.id/);
  assert.match(venuePage, /<TvVideoStrip/);
});
