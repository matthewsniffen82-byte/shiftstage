import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  migration,
  tenSecondMigration,
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
  videoStrip,
  liveApp,
] = await Promise.all([
  readFile(new URL("../supabase/migrations/202607270001_mydancr_tv.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202607270002_mydancr_tv_ten_second_limit.sql", import.meta.url), "utf8"),
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
  readFile(new URL("../app/components/TvVideoStrip.tsx", import.meta.url), "utf8"),
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
  assert.match(migration, /duration_seconds between 1 and 10/);
  assert.match(migration, /Video mutations intentionally have no dancer RLS policy/);
  assert.doesNotMatch(migration, /create policy "dancers create own MyDancr TV videos"/);
});

test("dancer uploads are direct, validated, persistent, and submitted for review", () => {
  assert.match(dancerApi, /createRequestSupabaseContext\(request\)/);
  assert.match(dancerApi, /createMyDancrTvUpload/);
  assert.match(tvSource, /createSignedUploadUrl\(storagePath\)/);
  assert.match(tvSource, /MYDANCR_TV_MAX_BYTES = 75 \* 1024 \* 1024/);
  assert.match(tvSource, /MYDANCR_TV_MAX_DURATION_SECONDS = 10/);
  assert.match(tvSource, /\.lte\("duration_seconds", MYDANCR_TV_MAX_DURATION_SECONDS\)/);
  assert.match(tvSource, /Only videos that are 10 seconds or shorter can be approved/);
  assert.match(dancerStudio, /1–10 seconds/);
  assert.match(dancerStudio, /metadata\.duration > 10/);
  assert.match(tenSecondMigration, /where duration_seconds > 10[\s\S]*?status not in \('hidden', 'expired'\)/);
  assert.match(tenSecondMigration, /check \(duration_seconds between 1 and 10\)[\s\S]*?not valid/);
  assert.match(tvSource, /status: "submitted"/);
  assert.match(dancerStudio, /uploadToSignedUrl\(data\.upload\.path, data\.upload\.token, file/);
  assert.match(dancerStudio, /Your video was submitted for MyDancr TV review/);
  assert.match(dancerStudio, /Under review/);
  assert.match(dancerStudio, /Incognito is on/);
  assert.doesNotMatch(dancerStudio, /sample video|placeholder video|mock/i);
});

test("public feed is real, navigable, measurable, and preserves existing discovery sections", () => {
  assert.match(publicRoute, /getPublicMyDancrTvFeed/);
  assert.match(publicRoute, /const requestedCity = \(url\.searchParams\.get\("city"\) \|\| ""\)\.trim\(\)\.slice\(0, 80\)/);
  assert.match(publicRoute, /const city = requestedCity \|\| "Las Vegas"/);
  assert.match(tvSource, /\.filter\(\(row\) => !city \|\| tvCitiesMatch\(row\.dancer\.city, city\)\)/);
  assert.match(tvSource, /selectedRowWithShift && \(!city \|\| tvCitiesMatch\(selectedRowWithShift\.dancer\.city, city\)\)/);
  assert.match(feedClient, /For You/);
  assert.match(feedClient, /Following/);
  assert.match(feedClient, /Tonight/);
  assert.doesNotMatch(feedClient, /\{ value: "new", label: "New" \}/);
  assert.doesNotMatch(feedClient, /className="tv-city"/);
  assert.doesNotMatch(feedClient, /id="tv-city"/);
  assert.match(feedClient, /className="tv-close"[\s\S]*?href="\/"[\s\S]*?aria-label="Close MyDancr TV and return to homepage"/);
  assert.match(feedClient, /\.tv-filters \{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(feedClient, /href=\{`\/tonight\?city=/);
  assert.match(feedClient, /href=\{`\/dancers\?city=/);
  assert.match(feedClient, /href=\{`\/venues\?city=/);
  assert.match(feedClient, /href=\{`\/trending\?city=/);
  assert.match(feedClient, /className="tv-global-header"/);
  assert.match(feedClient, /className="tv-global-logo" href="\/" aria-label="Go to Mydancr home"/);
  assert.match(feedClient, /className="tv-global-search" href="\/#discoveryTabs"/);
  assert.match(feedClient, /Search dancers, clubs, cities\.\.\./);
  assert.match(feedClient, /className="tv-global-account" href="\/account"/);
  assert.match(feedClient, /setAccountLabel\("Account"\)/);
  assert.match(feedClient, /\.tv-global-logo \{[\s\S]*?aspect-ratio: 331 \/ 103/);
  assert.match(feedClient, /\.tv-global-search \{[\s\S]*?width: min\(520px, 34vw\)/);
  assert.match(feedClient, /eventType: "engaged_view"|trackEvent\((?:video\.id|videoId), "engaged_view"\)/);
  assert.doesNotMatch(feedClient, /\/api\/reports/);
  assert.match(feedClient, /<h1>MyDancr TV \{myDancrTvCityLabel\(city\)\}<\/h1>/);
  assert.match(feedClient, /function myDancrTvCityLabel\(city: string\) \{\s*return city\.trim\(\) \|\| "Las Vegas";\s*\}/);
  assert.doesNotMatch(feedClient, /normalized\.toLowerCase\(\) === "las vegas" \? "Vegas"/);
  assert.match(feedClient, /data\.videos\.filter\([\s\S]*?tvCitiesMatch\(video\.dancer\.city, nextCity\)/);
  assert.doesNotMatch(liveApp, /data-tab="tv"/);
  assert.doesNotMatch(liveApp, /renderHomeTvTab/);
  assert.match(
    liveApp,
    /id="locationBtn"[\s\S]*?<\/section>\s*<div class="home-live-summary"[\s\S]*?<\/div>\s*<section class="home-tv-teaser"[\s\S]*?<nav class="tabs"/,
  );
  assert.doesNotMatch(liveApp, /id="homeTvTeaser"[^>]*\shidden(?:\s|>)/);
  assert.match(liveApp, /renderHomeTvTeaser\(city\)/);
  assert.match(liveApp, /title\.textContent = `MyDancr TV \$\{tvCityLabel\}`/);
  assert.match(liveApp, /const tvCityLabel = String\(city\)\.trim\(\) \|\| "Las Vegas"/);
  assert.doesNotMatch(liveApp, /toLowerCase\(\) === "las vegas" \? "Vegas"/);
  assert.match(liveApp, /payload\.videos\.filter\([\s\S]*?item\.dancer\?\.city[\s\S]*?=== normalizedCity/);
  assert.match(liveApp, /String\(item\.dancer\?\.slug \|\| ""\)\.trim\(\)/);
  assert.match(liveApp, /card\.href = `\/dancers\/\$\{encodeURIComponent\(String\(item\.dancer\.slug\)\.trim\(\)\)\}`/);
  assert.match(liveApp, /card\.setAttribute\("aria-label", `Open \$\{item\.dancer\?\.stageName \|\| "dancer"\} live profile`\)/);
  assert.match(feedClient, /className="tv-profile-card"[\s\S]*?href=\{dancerProfileHref\(video\)\}[\s\S]*?aria-label=\{`Open \$\{video\.dancer\.stageName\}'s live profile`\}[\s\S]*?<video/);
  assert.match(feedClient, /function dancerProfileHref\(video: MyDancrTvVideo\) \{[\s\S]*?encodeURIComponent\(video\.dancer\.slug\)/);
  assert.match(feedClient, /aria-label="Close MyDancr TV and return to homepage"/);
  assert.match(feedClient, /className="tv-mobile-nav"[\s\S]*?>Now<[\s\S]*?>Dancers<[\s\S]*?>Venues<[\s\S]*?>Trending</);
  assert.match(feedClient, /\.tv-mobile-nav \{[\s\S]*?grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(feedClient, /className="tv-card-venue-line"[\s\S]*?className="tv-card-venue-name"[\s\S]*?video\.venue\.name/);
  assert.match(feedClient, /className="tv-card-stage-name"[\s\S]*?video\.dancer\.stageName/);
  assert.match(feedClient, /className="tv-verified-mark" aria-label="Verified">✓/);
  assert.match(feedClient, /className=\{video\.shift\.isActive \? "tv-schedule-row is-tonight" : "tv-schedule-row is-upcoming"\}/);
  assert.doesNotMatch(feedClient, /className="tv-details"|className="tv-mobile-actions"|<p>\{video\.caption\}<\/p>/);
  assert.doesNotMatch(feedClient, /function updateFollow|function updateGoing|function shareVideo|function reportVideo/);
  assert.match(
    feedClient,
    /video\.shift\.isActive[\s\S]*?\? "Working now"[\s\S]*?: `Upcoming \$\{formatShift\(video\.shift\.startsAt, video\.shift\.timezone\)\}`/,
  );
  assert.match(tvSource, /async function getPublicTvShiftContexts/);
  assert.match(tvSource, /\.from\("shifts"\)[\s\S]*?\.in\("dancer_id", uniqueDancerIds\)/);
  assert.match(tvSource, /shift\.location_status !== "location_confirmed" && shift\.location_status !== "club_confirmed"/);
  assert.match(tvSource, /timezone: row\.timezone \|\| "UTC"/);
  assert.match(feedClient, /formatShift\(video\.shift\.startsAt, video\.shift\.timezone\)/);
  assert.match(feedClient, /function formatShift\(value: string, timeZone: string\)[\s\S]*?timeZone,/);
  assert.match(
    tvSource,
    /function tvSchedulePriority\(video: NormalizedFeedRow\) \{[\s\S]*?video\.shift\?\.isActive[\s\S]*?return 0[\s\S]*?video\.shift[\s\S]*?return 1[\s\S]*?return 2/,
  );
  assert.match(tvSource, /rows = rows\.sort\(\(left, right\) =>[\s\S]*?comparePublicTvFeedRows/);
  assert.match(tvSource, /const scheduleOrdered = \[0, 1, 2\]\.flatMap/);
  assert.match(tvSource, /shift\?\.status === "posted"[\s\S]*?!shift\.checked_out_at[\s\S]*?start > now/);
  assert.match(liveApp, /filter=for-you&limit=8/);
  assert.match(liveApp, /home-tv-teaser-list[\s\S]*?overflow-x: auto/);
  assert.match(liveApp, /home-tv-teaser-list \{[\s\S]*?grid-auto-columns: minmax\(150px, 180px\)/);
  assert.match(liveApp, /home-tv-teaser-card \{[\s\S]*?height: 224px/);
  assert.match(liveApp, /className = "home-tv-card-verified"[\s\S]*?aria-label", "Verified"/);
  assert.match(liveApp, /className = "home-tv-card-venue"[\s\S]*?item\.venue\.name/);
  assert.match(
    liveApp,
    /item\.shift\?\.isActive[\s\S]*?"Working now"[\s\S]*?`Upcoming \$\{formatHomeTvShift\(item\.shift\.startsAt, item\.shift\.timezone\)\}`[\s\S]*?"No shift posted"/,
  );
  assert.match(liveApp, /function formatHomeTvShift\(startsAt, timeZone\)[\s\S]*?timeZone: timeZone \|\| "UTC"/);
  assert.doesNotMatch(liveApp, /home-tv-discovery-cue/);
  assert.doesNotMatch(liveApp, /Live discovery below/);
  assert.match(liveApp, /id="discoveryTabs" aria-label="Discovery tabs"/);
  assert.match(liveApp, /No approved videos in \$\{city\} yet\./);
  assert.match(liveApp, /MyDancr TV is temporarily unavailable\./);
  assert.match(liveApp, /video\.autoplay = true/);
  assert.doesNotMatch(liveApp, /id="homeTvPreviewList"/);
  assert.match(liveApp, /loadProfileMyDancrTv/);
});

test("the vertical TV feed locks exactly one stable video into the available viewport", () => {
  assert.match(feedClient, /const feedElement = useRef<HTMLElement \| null>\(null\)/);
  assert.match(feedClient, /\{ root: feed, threshold: \[0\.75, 0\.9\] \}/);
  assert.match(feedClient, /<section ref=\{feedElement\} className="tv-feed"/);
  assert.match(feedClient, /className="tv-feedback" aria-live="polite"/);
  assert.match(feedClient, /html, body \{[^}]*height: 100%[^}]*overflow: hidden[^}]*overscroll-behavior: none/);
  assert.match(feedClient, /\.tv-shell \{[^}]*height: 100dvh[^}]*display: flex[^}]*flex-direction: column[^}]*overflow: hidden/);
  assert.match(feedClient, /\.tv-feed \{[^}]*flex: 1 1 0[^}]*overflow-y: auto[^}]*overscroll-behavior-y: contain[^}]*overflow-anchor: none[^}]*scroll-snap-type: y mandatory/);
  assert.match(feedClient, /\.tv-slide \{[^}]*height: 100%[^}]*min-height: 100%[^}]*max-height: 100%[^}]*overflow: hidden[^}]*scroll-snap-align: start[^}]*scroll-snap-stop: always/);
  assert.match(feedClient, /\.tv-player \{[^}]*height: 100%[^}]*min-height: 0[^}]*max-height: none/);
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
  assert.match(adminPanel, /useState\("all"\)/);
  assert.match(adminPanel, /video\.status === "submitted"/);
  assert.match(adminPanel, /item\.id === video\.id[\s\S]*?status: decision/);
  assert.match(adminPanel, /Approved and published\./);
  assert.match(adminPanel, /pendingCount[\s\S]*?videos\.length[\s\S]*?total/);
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
  assert.match(videoStrip, /<video autoPlay loop muted playsInline/);
  assert.match(liveApp, /loadProfileMyDancrTv[\s\S]*?video\.autoplay = true/);
  assert.match(venuePage, /getPublicMyDancrTvFeed/);
  assert.match(venuePage, /venueId: venue\.id/);
  assert.match(venuePage, /<TvVideoStrip/);
});
