import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  migration,
  tenSecondMigration,
  thirtySecondMigration,
  tvSource,
  publicRoute,
  publicCountRoute,
  tvPage,
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
  globalNavigation,
] = await Promise.all([
  readFile(new URL("../supabase/migrations/202607270001_mydancr_tv.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202607270002_mydancr_tv_ten_second_limit.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608080001_mydancr_tv_thirty_second_feed_distribution.sql", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/tv.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/public/tv/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/public/tv/count/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/tv/page.tsx", import.meta.url), "utf8"),
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
  readFile(new URL("../app/components/GlobalMobileBottomNav.tsx", import.meta.url), "utf8"),
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

test("dancer uploads are direct, validated, persistent, and submitted for automated review", () => {
  assert.match(dancerApi, /createRequestSupabaseContext\(request\)/);
  assert.match(dancerApi, /createMyDancrTvUpload/);
  assert.match(tvSource, /createSignedUploadUrl\(storagePath\)/);
  assert.match(tvSource, /MYDANCR_TV_MAX_BYTES = 75 \* 1024 \* 1024/);
  assert.match(tvSource, /MYDANCR_TV_MAX_DURATION_SECONDS = 30/);
  assert.match(tvSource, /\.lte\("duration_seconds", MYDANCR_TV_MAX_DURATION_SECONDS\)/);
  assert.match(tvSource, /Only videos that are 30 seconds or shorter can be approved/);
  assert.match(dancerStudio, /1–30 seconds/);
  assert.match(dancerStudio, /metadata\.duration > 30/);
  assert.match(tenSecondMigration, /where duration_seconds > 10[\s\S]*?status not in \('hidden', 'expired'\)/);
  assert.match(tenSecondMigration, /check \(duration_seconds between 1 and 10\)[\s\S]*?not valid/);
  assert.match(thirtySecondMigration, /check \(duration_seconds between 1 and 30\)[\s\S]*?not valid/);
  assert.match(tvSource, /status: "submitted"/);
  assert.match(dancerStudio, /uploadToSignedUrl\(data\.upload\.path, data\.upload\.token, file/);
  assert.match(dancerStudio, /Your video completed automated safety review/);
  assert.match(dancerStudio, /Under review/);
  assert.match(dancerStudio, /Incognito is on/);
  assert.doesNotMatch(dancerStudio, /sample video|placeholder video|mock/i);
});

test("feed-only platform videos remain public in TV without consuming profile slots", () => {
  assert.match(thirtySecondMigration, /distribution_scope in \('profile_and_feed', 'feed_only'\)/);
  assert.match(thirtySecondMigration, /if new\.distribution_scope = 'feed_only' then[\s\S]*?return new/);
  assert.match(thirtySecondMigration, /distribution_scope = 'profile_and_feed'/);
  assert.match(tvSource, /\.eq\("distribution_scope", "profile_and_feed"\)/);
  assert.match(tvSource, /distributionScope: row\.distribution_scope === "feed_only"/);
});

test("public feed is real, navigable, measurable, and preserves existing discovery sections", () => {
  assert.match(publicRoute, /getPublicMyDancrTvFeed/);
  assert.match(publicRoute, /const requestedCity = \(url\.searchParams\.get\("city"\) \|\| ""\)\.trim\(\)\.slice\(0, 80\)/);
  assert.match(publicRoute, /const city = requestedCity \|\| "Las Vegas"/);
  assert.match(tvSource, /\.filter\(\(row\) => !city \|\| tvCitiesMatch\(row\.dancer\.city, city\)\)/);
  assert.match(tvSource, /selectedRowWithShift &&[\s\S]*?\(!city \|\| tvCitiesMatch\(selectedRowWithShift\.dancer\.city, city\)\)/);
  assert.match(feedClient, /For You/);
  assert.match(feedClient, /Following/);
  assert.match(feedClient, /Tonight/);
  assert.doesNotMatch(feedClient, /\{ value: "new", label: "New" \}/);
  assert.doesNotMatch(feedClient, /className="tv-city"/);
  assert.doesNotMatch(feedClient, /id="tv-city"/);
  assert.match(feedClient, /const homepageHref = `\/\?city=\$\{encodeURIComponent\(city\)\}&view=dancers`/);
  assert.match(feedClient, /className=\{initialVenueId \? "tv-header has-venue-filter" : "tv-header"\}[\s\S]*?<h1>\{initialVenueName \? `MyDancr TV at \$\{initialVenueName\}` : `MyDancr TV \$\{myDancrTvCityLabel\(city\)\}`\}<\/h1>[\s\S]*?className="tv-close"[\s\S]*?href=\{homepageHref\}[\s\S]*?aria-label="Close MyDancr TV and return to homepage"/);
  assert.match(feedClient, /\.tv-filters \{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(globalNavigation, /view: "dancers"/);
  assert.match(globalNavigation, /view: "tv"/);
  assert.match(globalNavigation, /view: "venues"/);
  assert.doesNotMatch(globalNavigation, /view: "(?:tonight|trending)"/);
  assert.match(feedClient, /className="tv-global-header"/);
  assert.match(feedClient, /className="tv-global-logo" href=\{homepageHref\} aria-label="Go to Mydancr home"/);
  assert.doesNotMatch(feedClient, /className="tv-global-search"|className="tv-site-nav"/);
  assert.match(feedClient, /className="tv-global-account" href="\/account">Login \/ Join<\/Link>/);
  assert.match(feedClient, /className="tv-global-account tv-account-icon"[\s\S]*?href=\{dashboardHref\(role\)\}[\s\S]*?aria-label=\{`Open \$\{role\} dashboard`\}/);
  assert.match(
    feedClient,
    /showNotifications[\s\S]*?role === "customer" \|\| role === "dancer" \|\| role === "venue"/,
  );
  assert.match(feedClient, /fetch\("\/api\/notifications"[\s\S]*?authorization: `Bearer \$\{nextSession\.accessToken\}`/);
  assert.match(feedClient, /className=\{notificationsOpen \? "tv-notification-button active" : "tv-notification-button"\}/);
  assert.match(feedClient, /className="tv-notification-panel"[\s\S]*?No notifications yet\.[\s\S]*?Clear notifications/);
  assert.match(feedClient, /function dashboardHref\(role: SessionRole \| undefined\)[\s\S]*?"\/dashboard\/dancer"[\s\S]*?"\/dashboard\/venue"[\s\S]*?"\/admin"[\s\S]*?"\/dashboard\/customer"/);
  assert.match(feedClient, /\.tv-global-logo \{[\s\S]*?aspect-ratio: 331 \/ 103/);
  assert.match(feedClient, /\.tv-global-topbar \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto/);
  assert.match(feedClient, /\.tv-header h1 \{[\s\S]*?font-size: clamp\(30px, 4\.2vw, 48px\)/);
  assert.match(feedClient, /@media \(max-width: 760px\)[\s\S]*?\.tv-header h1 \{ font-size: clamp\(23px, 6\.5vw, 29px\); white-space: nowrap;/);
  assert.match(feedClient, /eventType: "engaged_view"|trackEvent\((?:video\.id|videoId), "engaged_view"\)/);
  assert.match(feedClient, /video\.shift\.isActive[\s\S]*?\? "Working Now"[\s\S]*?: `Upcoming · \$\{formatShift\(video\.shift\.shiftDate \|\| video\.shift\.startsAt, video\.shift\.timezone\)\}`/);
  assert.doesNotMatch(feedClient, /\/api\/reports/);
  assert.match(feedClient, /initialVenueName \? `MyDancr TV at \$\{initialVenueName\}` : `MyDancr TV \$\{myDancrTvCityLabel\(city\)\}`/);
  assert.match(feedClient, /function myDancrTvCityLabel\(city: string\) \{\s*return city\.trim\(\) \|\| "Las Vegas";\s*\}/);
  assert.doesNotMatch(feedClient, /normalized\.toLowerCase\(\) === "las vegas" \? "Vegas"/);
  assert.match(feedClient, /data\.videos\.filter\([\s\S]*?tvCitiesMatch\(video\.dancer\.city, nextCity\)/);
  assert.doesNotMatch(liveApp, /data-tab="tv"/);
  assert.doesNotMatch(liveApp, /renderHomeTvTab/);
  assert.match(
    liveApp,
    /id="locationBtn"[\s\S]*?<\/section>\s*<div class="home-live-summary"[\s\S]*?<\/div>\s*<a[\s\S]*?class="home-tv-launch"[\s\S]*?<nav class="tabs"/,
  );
  assert.match(liveApp, /id="homeTvLaunch"[\s\S]*?href="\/\?city=Las%20Vegas&amp;view=tv"[\s\S]*?id="homeTvLaunchTitle"[\s\S]*?id="homeTvLaunchCount"/);
  assert.match(liveApp, /renderHomeTvLaunch\(city, tvVenueFilter\)/);
  assert.match(liveApp, /title\.textContent = venueName \? `MyDancr TV at \$\{venueName\}` : `MyDancr TV \$\{tvCityLabel\}`/);
  assert.match(liveApp, /const tvCityLabel = String\(city\)\.trim\(\) \|\| "Las Vegas"/);
  assert.doesNotMatch(liveApp, /toLowerCase\(\) === "las vegas" \? "Vegas"/);
  assert.match(liveApp, /const launchParams = new URLSearchParams\(\{ city: tvCityLabel, view: "tv" \}\)[\s\S]*?launchParams\.set\("tv_venue", venueId\)[\s\S]*?launch\.href = `\/\?\$\{launchParams\.toString\(\)\}`/);
  assert.match(liveApp, /function selectedHomeTvVideoId\(\)[\s\S]*?get\("tv_video"\)[\s\S]*?UUID_PATTERN|function selectedHomeTvVideoId\(\)[\s\S]*?get\("tv_video"\)[\s\S]*?\[0-9a-f\]/i);
  assert.match(liveApp, /async function loadHomeTvFeed\(city, venueId = "", selectedVideoId = selectedHomeTvVideoId\(\)\)[\s\S]*?params\.set\("video", selectedVideoId\)/);
  assert.match(liveApp, /homeTvFeedSelectedVideoId !== selectedVideoId[\s\S]*?homeTvFeedSelectedVideoId = selectedVideoId/);
  assert.match(liveApp, /const countParams = new URLSearchParams\(\{ city: tvCityLabel \}\)[\s\S]*?fetch\(`\/api\/public\/tv\/count\?\$\{countParams\.toString\(\)\}`[\s\S]*?cache: "no-store"/);
  assert.match(liveApp, /Number\(payload\.approvedVideoCount\)[\s\S]*?Number\.isSafeInteger\(approvedVideoCount\)[\s\S]*?`\$\{approvedVideoCount\} video\$\{approvedVideoCount === 1 \? "" : "s"\}`/);
  assert.match(liveApp, /\.home-tv-launch \{[^}]*width: 100%[^}]*grid-template-columns: auto minmax\(0, 1fr\) auto auto[^}]*background: #2d106f/);
  assert.doesNotMatch(liveApp, /home-tv-teaser|renderHomeTvTeaser|home-tv-teaser-card/);
  assert.match(publicCountRoute, /getPublicMyDancrTvVideoCount/);
  assert.match(publicCountRoute, /approvedVideoCount[\s\S]*?"Cache-Control": "private, no-store"/);
  assert.match(tvSource, /export async function getPublicMyDancrTvVideoCount/);
  assert.match(tvSource, /\.select\("id, dancer_profiles!inner\(id\)", \{ count: "exact", head: true \}\)/);
  assert.match(tvSource, /\.eq\("dancer_profiles\.status", "approved"\)[\s\S]*?\.eq\("dancer_profiles\.verification_status", "approved"\)[\s\S]*?\.is\("dancer_profiles\.disabled_at", null\)[\s\S]*?\.eq\("dancer_profiles\.is_public", true\)/);
  assert.match(feedClient, /className="tv-profile-card"[\s\S]*?<video[\s\S]*?href=\{dancerLiveProfileHref\(video\)\}[\s\S]*?aria-label=\{`Open \$\{video\.dancer\.stageName\}'s live profile`\}/);
  assert.match(
    feedClient,
    /function dancerLiveProfileHref\(video: MyDancrTvVideo\) \{[\s\S]*?const city = video\.dancer\.city\.trim\(\) \|\| "Las Vegas";[\s\S]*?const slug = video\.dancer\.slug\.trim\(\);[\s\S]*?`\/\?city=\$\{encodeURIComponent\(city\)\}&profile=\$\{encodeURIComponent\(slug\)\}`[\s\S]*?homeDiscoveryHref\("dancers", city\)/,
  );
  assert.match(feedClient, /function venueLiveProfileHref\(video: MyDancrTvVideo\) \{[\s\S]*?video\.dancer\.city\.trim\(\)[\s\S]*?return `\/\?city=\$\{encodeURIComponent\(city\)\}&venue=\$\{encodeURIComponent\(venue\)\}`/);
  assert.match(feedClient, /function slugifyLiveProfileName\(value: string\) \{[\s\S]*?replaceAll\(" ", "-"\)[\s\S]*?replace\(\/\[\^a-z0-9-\]\/g, ""\)/);
  assert.doesNotMatch(feedClient, /slugifyLiveProfileName\(video\.dancer\.stageName\)|`\/dancers\/\$\{encodeURIComponent\(slug\)\}`/);
  assert.match(liveApp, /const initialDiscoveryRequest = loadLiveDiscovery\(citySelect\.value\)/);
  assert.match(liveApp, /initialDiscoveryRequest\.finally\(\(\) => openSharedProfileFromUrl\(\)\)/);
  assert.match(liveApp, /const approvedProfiles = markets\[city\]\.dancers\.filter\(isApprovedPublicProfile\);[\s\S]*?approvedProfiles\.find\(\(item\) => item\.slug === profileSlug\)[\s\S]*?\|\| approvedProfiles\.find\(\(item\) => slugify\(item\.name\) === profileSlug\)/);
  assert.match(liveApp, /const venueSlug = params\.get\("venue"\);[\s\S]*?activeTab = venueSlug \? "venues" : "dancers";[\s\S]*?resolveVenueByName\(venueSlug, city\)[\s\S]*?openVenueFromName\(venue\.slug \|\| venue\.name\)/);
  assert.match(liveApp, /function homeDancerGridCard[\s\S]*?profile\.status === "Verified"[\s\S]*?'<span class="verified-mark" aria-label="Verified">✓<\/span>'/);
  assert.doesNotMatch(liveApp, /verifiedCheckMarkup/);
  assert.match(liveApp, /const initialProfileCity = initialProfileParams\.get\("city"\);[\s\S]*?if \(initialProfileCity && markets\[initialProfileCity\]\)[\s\S]*?citySelect\.value = initialProfileCity/);
  assert.match(feedClient, /aria-label="Close MyDancr TV and return to homepage"/);
  assert.match(globalNavigation, /label: "Dancers"[\s\S]*?label: "TV"[\s\S]*?label: "Clubs"/);
  assert.match(globalNavigation, /\.global-mobile-bottom-nav \{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(feedClient, /className="tv-card-venue-line"[\s\S]*?className="tv-card-venue-name"[\s\S]*?video\.venue\.name/);
  assert.match(feedClient, /className="tv-card-stage-name"[\s\S]*?video\.dancer\.stageName/);
  assert.match(
    feedClient,
    /className="tv-sound"[\s\S]*?aria-label=\{muted \? "Turn sound on" : "Mute video"\}[\s\S]*?<SoundIcon muted=\{muted\} \/>/,
  );
  assert.doesNotMatch(feedClient, /className="tv-sound"[\s\S]*?title=\{muted/);
  assert.match(feedClient, /function SoundIcon\(\{ muted \}: \{ muted: boolean \}\)[\s\S]*?aria-hidden="true"/);
  assert.doesNotMatch(feedClient, /\{muted \? "Sound off" : "Sound on"\}/);
  assert.match(feedClient, /className="tv-verified-mark" aria-label="Verified">✓/);
  assert.match(tvSource, /\.from\("dancer_photos"\)[\s\S]*?\.eq\("is_primary", true\)[\s\S]*?\.eq\("review_status", "approved"\)/);
  assert.match(
    tvSource,
    /dancer: \{[\s\S]*?\.\.\.publicVideo\.dancer,[\s\S]*?avatarPhotoUrl: avatarPhoto\?\.imageUrl \|\| null,[\s\S]*?avatarPhotoFocalX: avatarPhoto\?\.imageFocalX \?\? 50,[\s\S]*?avatarPhotoFocalY: avatarPhoto\?\.imageFocalY \?\? 50/,
  );
  assert.match(feedClient, /className=\{`tv-profile-photo\$\{video\.dancer\.avatarPhotoUrl \? " has-photo" : ""\}`\}/);
  assert.match(feedClient, /backgroundImage: `url\(\$\{JSON\.stringify\(video\.dancer\.avatarPhotoUrl\)\}\)`/);
  assert.match(feedClient, /video\.dancer\.avatarPhotoUrl \? \([\s\S]*?className="tv-profile-photo-image"[\s\S]*?: dancerInitials\(video\.dancer\.stageName\)/);
  assert.match(feedClient, /\.tv-profile-photo \{[^}]*width: 58px[^}]*height: 58px[^}]*background: #fff/);
  assert.match(feedClient, /\.tv-profile-photo-image \{[^}]*inset: 2px[^}]*background-size: cover/);
  assert.match(feedClient, /className=\{video\.shift\.isActive \? "tv-schedule-row is-tonight" : "tv-schedule-row is-upcoming"\}/);
  assert.doesNotMatch(feedClient, /className="tv-details"|className="tv-mobile-actions"|<p>\{video\.caption\}<\/p>/);
  assert.doesNotMatch(feedClient, /function updateFollow|function updateGoing|function shareVideo|function reportVideo/);
  assert.match(
    feedClient,
    /video\.shift\.isActive[\s\S]*?\? "Working Now"[\s\S]*?: `Upcoming · \$\{formatShift\(video\.shift\.shiftDate \|\| video\.shift\.startsAt, video\.shift\.timezone\)\}`/,
  );
  assert.match(tvSource, /async function getPublicTvShiftContexts/);
  assert.match(tvSource, /\.from\("shifts"\)[\s\S]*?\.in\("dancer_id", uniqueDancerIds\)/);
  assert.match(tvSource, /isActiveNfcPresence\(shift, now\)/);
  assert.match(tvSource, /location_verification_expires_at/);
  assert.match(tvSource, /timezone: row\.timezone \|\| "UTC"/);
  assert.match(feedClient, /formatShift\(video\.shift\.shiftDate \|\| video\.shift\.startsAt, video\.shift\.timezone\)/);
  assert.match(feedClient, /function formatShift\(value: string, timeZone: string\)[\s\S]*?timeZone,/);
  assert.match(
    tvSource,
    /function tvSchedulePriority\(video: NormalizedFeedRow\) \{[\s\S]*?video\.shift\?\.isActive[\s\S]*?return 0[\s\S]*?video\.shift[\s\S]*?return 1[\s\S]*?return 2/,
  );
  assert.doesNotMatch(tvSource, /comparePublicTvFeedRows|upcomingDifference|scoreDifference/);
  assert.match(
    tvSource,
    /const scheduleOrdered = \[0, 1, 2\]\.flatMap\(\(priority\) =>[\s\S]*?shuffleVideos\(remaining\.filter\(\(video\) => tvSchedulePriority\(video\) === priority\)\)/,
  );
  assert.match(
    tvSource,
    /function shuffleVideos\(rows: NormalizedFeedRow\[\]\) \{[\s\S]*?for \(let index = shuffled\.length - 1; index > 0; index -= 1\)[\s\S]*?Math\.floor\(Math\.random\(\) \* \(index \+ 1\)\)[\s\S]*?return shuffled/,
  );
  assert.match(tvSource, /from\("shifts"\)[\s\S]*?eq\("status", "posted"\)[\s\S]*?is\("checked_out_at", null\)[\s\S]*?const scheduled = shift\.shift_source === "scheduled" && Number\.isFinite\(start\) && Number\.isFinite\(end\) && end >= now/);
  assert.match(liveApp, /class="controls home-discovery-controls"[\s\S]*?class="field home-city-filter"[\s\S]*?id="homeFilterToggle"[\s\S]*?aria-controls="homeAdvancedFilters"/);
  assert.match(liveApp, /class="home-advanced-filters" id="homeAdvancedFilters"[\s\S]*?id="distanceSelect"[\s\S]*?id="venueSelect"[\s\S]*?id="locationBtn"/);
  assert.match(liveApp, /homeFilterToggle\?\.addEventListener\("click"[\s\S]*?aria-expanded[\s\S]*?classList\.toggle\("is-open"/);
  assert.match(liveApp, /@media \(max-width: 640px\)[\s\S]*?\.home-advanced-filters \{[\s\S]*?display: none[\s\S]*?\.home-advanced-filters\.is-open \{ display: grid/);
  assert.match(liveApp, /@media \(min-width: 721px\)[\s\S]*?\.stack > \.hero\.reference-hero[\s\S]*?max-width: 640px/);
  assert.doesNotMatch(liveApp, /home-tv-discovery-cue/);
  assert.doesNotMatch(liveApp, /Live discovery below/);
  assert.match(liveApp, /id="discoveryTabs" aria-label="Discovery tabs"/);
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

test("long selected venue names cannot widen the mobile homepage", () => {
  assert.match(liveApp, /main\.stack,\s*main\.stack > \* \{ min-width: 0; max-width: 100%; \}/);
  assert.match(
    liveApp,
    /\.home-discovery-controls \{[^}]*width: 100%[^}]*min-width: 0[^}]*max-width: 100%[^}]*overflow: hidden/,
  );
  assert.match(
    liveApp,
    /\.home-discovery-controls select,[\s\S]*?width: 100% !important[^}]*min-width: 0 !important[^}]*max-width: 100% !important/,
  );
  assert.match(
    liveApp,
    /\.home-live-summary \{[^}]*width: 100%[^}]*min-width: 0[^}]*max-width: 100%[^}]*grid-template-columns: max-content minmax\(0, 1fr\) max-content[^}]*overflow: hidden/,
  );
  assert.match(liveApp, /#homeLiveRadius \{ min-width: 0; \}/);
  assert.match(
    liveApp,
    /\.home-tv-launch \{[^}]*width: 100%[^}]*min-width: 0[^}]*max-width: 100%[^}]*overflow: hidden/,
  );
  assert.match(liveApp, /#discoveryTabs \{ width: 100%; min-width: 0; max-width: 100%/);
});

test("administrator moderation persists decisions and venue TV is schedule-derived analytics", () => {
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
  assert.match(venueApi, /getVenueMyDancrTvVideos/);
  assert.doesNotMatch(venueApi, /PATCH|updateVenueMyDancrTvVideo/);
  assert.doesNotMatch(venuePanel, /Confirm tag|Reject tag|Feature on venue page/);
  assert.match(venuePanel, /verified current shifts and posted upcoming shifts/);
  assert.match(venuePanel, /Engaged views/);
  assert.match(venuePanel, /Venue visits/);
  assert.match(venuePanel, /Open live/);
});

test("video publishing never asks for a venue tag and public venue context comes from schedules", () => {
  assert.doesNotMatch(dancerApi, /shiftId|venueId/);
  assert.doesNotMatch(dancerStudio, /Connect a posted shift|Connect a venue|shiftId|venueId/);
  assert.match(dancerStudio, /Venue context is automatic/);
  assert.match(tvSource, /venue_id: null,[\s\S]*?shift_id: null,[\s\S]*?venue_tag_status: "unlinked"/);
  assert.doesNotMatch(tvSource, /eq\("venue_tag_status"/);
  assert.match(tvSource, /const isActive = isConfirmedActiveTvShift\(row, now\);[\s\S]*?const isScheduled = row\.shift_source === "scheduled" && Number\.isFinite\(start\) && Number\.isFinite\(end\) && end >= now;[\s\S]*?if \(!current \|\| \(!current\.shift\?\.isActive && candidate\.shift\?\.isActive\)\)/);
  assert.match(tvSource, /isStartingSoon: false/);
  assert.match(tvSource, /context[\s\S]*?venue: null, shift: null/);
});

test("approved videos appear on full dancer and venue profiles", () => {
  const profileTvLoader = liveApp.match(
    /async function loadProfileMyDancrTv\(profile\) \{[\s\S]*?(?=\n    function formatProfileTvShift)/,
  )?.[0] || "";
  assert.match(dancerPage, /getPublicMyDancrTvFeed/);
  assert.match(dancerPage, /dancerId: profile\.id/);
  assert.match(dancerPage, /videos=\{tvVideos\.map\(/);
  assert.match(dancerPage, /videoUrl: video\.videoUrl/);
  assert.doesNotMatch(dancerPage, /<TvVideoStrip/);
  assert.doesNotMatch(dancerPage, /watchAllHref|href=\{`\/tv/);
  assert.match(videoStrip, /<video aria-hidden="true" loop muted playsInline/);
  assert.doesNotMatch(videoStrip, /<video aria-hidden="true" autoPlay/);
  assert.match(videoStrip, /onMouseEnter=\{\(event\) => playPreviewCard\(event\.currentTarget\)\}/);
  assert.match(videoStrip, /onMouseLeave=\{\(event\) => pausePreviewCard\(event\.currentTarget\)\}/);
  assert.match(videoStrip, /<button[\s\S]*?className="tv-strip-card"[\s\S]*?onClick=\{\(\) => \{[\s\S]*?setActiveVideo\(video\)/);
  assert.doesNotMatch(videoStrip, /Watch all|href=\{`\/tv|from "next\/link"/);
  assert.match(videoStrip, /tvProfileShiftLabel\(video\)/);
  assert.match(videoStrip, /"Working now"[\s\S]*?label: formatTvProfileShift[\s\S]*?"No shift posted"/);
  assert.doesNotMatch(videoStrip, /label: `Upcoming \$\{formatTvProfileShift/);
  assert.match(videoStrip, /className=\{`tv-strip-schedule \$\{schedule\.className\}`\}/);
  assert.doesNotMatch(videoStrip, /video\.caption|tv-strip-play/);
  assert.match(videoStrip, /className="tv-video-viewer"[\s\S]*?role="dialog"[\s\S]*?aria-modal="true"/);
  assert.match(videoStrip, /<video[\s\S]*?autoPlay[\s\S]*?controlsList="nofullscreen noremoteplayback nodownload"[\s\S]*?src=\{activeVideo\.videoUrl\}/);
  assert.match(videoStrip, /aria-label="Previous dancer video"[\s\S]*?showRelativeVideo\(-1\)[\s\S]*?aria-label="Next dancer video"[\s\S]*?showRelativeVideo\(1\)/);
  assert.match(videoStrip, /onTouchStart=[\s\S]*?swipeStartX\.current[\s\S]*?onTouchEnd=[\s\S]*?finishVideoSwipe/);
  assert.match(videoStrip, /className="tv-video-viewer-gallery"[\s\S]*?videos\.map\(\(video, index\)[\s\S]*?setActiveVideo\(video\)/);
  assert.match(videoStrip, /overflow-x: auto;[\s\S]*?scroll-snap-type: x proximity/);
  assert.doesNotMatch(videoStrip, /requestFullscreen\(\)|:fullscreen|<video[\s\S]*?\scontrols(?:\s|>)/);
  assert.match(videoStrip, /`\/tv\/\$\{encodeURIComponent\(video\.id\)\}`[\s\S]*?navigator\.share[\s\S]*?navigator\.clipboard\.writeText/);
  assert.doesNotMatch(profileTvLoader, /video\.autoplay = true/);
  assert.match(liveApp, /const videos = payload\.videos\.slice\(0, 4\)/);
  assert.match(liveApp, /modalGallery\.profileTvVideos = videos/);
  assert.match(liveApp, /thumb\.className = "thumb profile-media-thumb is-video"/);
  assert.match(liveApp, /function setModalVideo\(item, profileName, videos, index\)[\s\S]*?className = "modal-media-video-preview"/);
  assert.match(liveApp, /video\.autoplay = true[\s\S]*?preview\.appendChild\(video\)[\s\S]*?void video\.play\(\)\.catch/);
  assert.doesNotMatch(liveApp, /modal-media-video-play/);
  assert.match(liveApp, /id="profileTvViewer"[\s\S]*?role="dialog"[\s\S]*?profile-tv-viewer-video[\s\S]*?controlslist="nofullscreen noremoteplayback nodownload"[\s\S]*?loop playsinline/);
  assert.match(liveApp, /data-previous-profile-tv[\s\S]*?data-next-profile-tv[\s\S]*?id="profileTvViewerGallery"/);
  assert.match(liveApp, /touchstart[\s\S]*?touchend[\s\S]*?showRelativeProfileTvVideo\(distance < 0 \? 1 : -1\)/);
  assert.match(liveApp, /function renderProfileTvViewerItem\(index\)[\s\S]*?profileTvVideos[\s\S]*?scrollIntoView/);
  assert.match(liveApp, /profile-tv-viewer-gallery[\s\S]*?overflow-x: auto[\s\S]*?scroll-snap-type: x proximity/);
  assert.match(liveApp, /requestProfileTvViewerFullscreen\(overlay\)[\s\S]*?requestFullscreen\(\{ navigationUI: "hide" \}\)/);
  assert.match(liveApp, /async function shareProfileTvVideo\(\)[\s\S]*?`\/tv\/\$\{encodeURIComponent\(videoId\)\}`[\s\S]*?navigator\.share[\s\S]*?copyText\(url, "Video link copied"\)/);
  assert.doesNotMatch(liveApp, /all\.href = `\/tv\?|link\.href = `\/tv\/\$\{encodeURIComponent\(item\.id\)\}`/);
  assert.doesNotMatch(liveApp, /id="homeTvTeaserLink"/);
  assert.match(liveApp, /formatProfileTvShift\(item\.shift\.startsAt, item\.shift\.timezone\)/);
  assert.match(
    liveApp,
    /class="info-tile profile-schedule-card working-now-tile schedule-live"[\s\S]*?<strong>Schedule<\/strong>[\s\S]*?profile-schedule-primary modal-schedule-text tonight">Working Now<\/div>/,
  );
  assert.doesNotMatch(liveApp, /Upcoming interest/);
  assert.doesNotMatch(liveApp, /caption\.textContent = item\.caption \|\| "Watch video"/);
  assert.match(tvPage, /const city = resolveMyDancrCity\(params\.city\)[\s\S]*?permanentRedirect\(homeTvHref\(city, \{/);
  assert.match(tvPage, /videoId: cleanUuid\(params\.video\)/);
  assert.match(tvPage, /venueId: cleanUuid\(params\.venue\)/);
  assert.doesNotMatch(tvPage, /TvFeedClient|getPublicMyDancrTvFeed|getPublicMyDancrTvVenue/);
  assert.match(feedClient, /if \(initialDancerId\) params\.set\("dancer", initialDancerId\)/);
  assert.match(feedClient, /if \(initialDancerId\) url\.searchParams\.set\("dancer", initialDancerId\)/);
  assert.match(liveApp, /function venueDetailPage\(venue\)/);
  assert.match(venuePage, /permanentRedirect/);
  assert.doesNotMatch(venuePage, /TvVideoStrip|watchAllHref|href=\{`\/tv/);
});
