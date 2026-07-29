import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  migration,
  tenSecondMigration,
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
  assert.match(tvSource, /MYDANCR_TV_MAX_DURATION_SECONDS = 10/);
  assert.match(tvSource, /\.lte\("duration_seconds", MYDANCR_TV_MAX_DURATION_SECONDS\)/);
  assert.match(tvSource, /Only videos that are 10 seconds or shorter can be approved/);
  assert.match(dancerStudio, /1–10 seconds/);
  assert.match(dancerStudio, /metadata\.duration > 10/);
  assert.match(tenSecondMigration, /where duration_seconds > 10[\s\S]*?status not in \('hidden', 'expired'\)/);
  assert.match(tenSecondMigration, /check \(duration_seconds between 1 and 10\)[\s\S]*?not valid/);
  assert.match(tvSource, /status: "submitted"/);
  assert.match(dancerStudio, /uploadToSignedUrl\(data\.upload\.path, data\.upload\.token, file/);
  assert.match(dancerStudio, /Your video completed automated safety review/);
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
  assert.match(feedClient, /const homepageHref = `\/\?city=\$\{encodeURIComponent\(city\)\}`/);
  assert.match(feedClient, /className="tv-header"[\s\S]*?<h1>MyDancr TV \{myDancrTvCityLabel\(city\)\}<\/h1>[\s\S]*?className="tv-close"[\s\S]*?href=\{homepageHref\}[\s\S]*?aria-label="Close MyDancr TV and return to homepage"/);
  assert.match(feedClient, /\.tv-filters \{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(globalNavigation, /path: "\/tonight"/);
  assert.match(globalNavigation, /path: "\/dancers"/);
  assert.match(globalNavigation, /path: "\/tv"/);
  assert.match(globalNavigation, /path: "\/venues"/);
  assert.match(globalNavigation, /path: "\/trending"/);
  assert.match(feedClient, /className="tv-global-header"/);
  assert.match(feedClient, /className="tv-global-logo" href=\{homepageHref\} aria-label="Go to Mydancr home"/);
  assert.doesNotMatch(feedClient, /className="tv-global-search"|className="tv-site-nav"/);
  assert.match(feedClient, /className="tv-global-account" href="\/account">Login \/ Join<\/Link>/);
  assert.match(feedClient, /className="tv-global-account tv-account-icon"[\s\S]*?href=\{dashboardHref\(role\)\}[\s\S]*?aria-label=\{`Open \$\{role\} dashboard`\}/);
  assert.match(feedClient, /showNotifications[\s\S]*?role === "customer" \|\| role === "dancer"/);
  assert.match(feedClient, /fetch\("\/api\/notifications"[\s\S]*?authorization: `Bearer \$\{nextSession\.accessToken\}`/);
  assert.match(feedClient, /className=\{notificationsOpen \? "tv-notification-button active" : "tv-notification-button"\}/);
  assert.match(feedClient, /className="tv-notification-panel"[\s\S]*?No notifications yet\.[\s\S]*?Clear notifications/);
  assert.match(feedClient, /function dashboardHref\(role: SessionRole \| undefined\)[\s\S]*?"\/dashboard\/dancer"[\s\S]*?"\/dashboard\/venue"[\s\S]*?"\/admin"[\s\S]*?"\/dashboard\/customer"/);
  assert.match(feedClient, /\.tv-global-logo \{[\s\S]*?aspect-ratio: 331 \/ 103/);
  assert.match(feedClient, /\.tv-global-topbar \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto/);
  assert.match(feedClient, /\.tv-header h1 \{[\s\S]*?font-size: clamp\(30px, 4\.2vw, 48px\)/);
  assert.match(feedClient, /@media \(max-width: 760px\)[\s\S]*?\.tv-header h1 \{ font-size: clamp\(23px, 6\.5vw, 29px\); white-space: nowrap;/);
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
    /id="locationBtn"[\s\S]*?<\/section>\s*<div class="home-live-summary"[\s\S]*?<\/div>\s*<a[\s\S]*?class="home-tv-launch"[\s\S]*?<nav class="tabs"/,
  );
  assert.match(liveApp, /id="homeTvLaunch"[\s\S]*?href="\/tv\?city=Las%20Vegas"[\s\S]*?id="homeTvLaunchTitle"[\s\S]*?id="homeTvLaunchCount"/);
  assert.match(liveApp, /renderHomeTvLaunch\(city\)/);
  assert.match(liveApp, /title\.textContent = `MyDancr TV \$\{tvCityLabel\}`/);
  assert.match(liveApp, /const tvCityLabel = String\(city\)\.trim\(\) \|\| "Las Vegas"/);
  assert.doesNotMatch(liveApp, /toLowerCase\(\) === "las vegas" \? "Vegas"/);
  assert.match(liveApp, /launch\.href = `\/tv\?city=\$\{encodeURIComponent\(tvCityLabel\)\}`/);
  assert.match(liveApp, /fetch\(`\/api\/public\/tv\/count\?city=\$\{encodeURIComponent\(tvCityLabel\)\}`[\s\S]*?cache: "no-store"/);
  assert.match(liveApp, /Number\(payload\.approvedVideoCount\)[\s\S]*?Number\.isSafeInteger\(approvedVideoCount\)[\s\S]*?`\$\{approvedVideoCount\} video\$\{approvedVideoCount === 1 \? "" : "s"\}`/);
  assert.match(liveApp, /\.home-tv-launch \{[^}]*width: 100%[^}]*grid-template-columns: auto minmax\(0, 1fr\) auto auto[^}]*background: #2d106f/);
  assert.doesNotMatch(liveApp, /home-tv-teaser|renderHomeTvTeaser|home-tv-teaser-card/);
  assert.match(publicCountRoute, /getPublicMyDancrTvVideoCount/);
  assert.match(publicCountRoute, /approvedVideoCount[\s\S]*?"Cache-Control": "private, no-store"/);
  assert.match(tvSource, /export async function getPublicMyDancrTvVideoCount/);
  assert.match(tvSource, /\.select\("id, dancer_profiles!inner\(id\)", \{ count: "exact", head: true \}\)/);
  assert.match(tvSource, /\.eq\("dancer_profiles\.status", "approved"\)[\s\S]*?\.eq\("dancer_profiles\.verification_status", "approved"\)[\s\S]*?\.is\("dancer_profiles\.disabled_at", null\)[\s\S]*?\.eq\("dancer_profiles\.is_public", true\)/);
  assert.match(feedClient, /className="tv-profile-card"[\s\S]*?<video[\s\S]*?href=\{dancerLiveProfileHref\(video\)\}[\s\S]*?aria-label=\{`Open \$\{video\.dancer\.stageName\}'s live profile`\}/);
  assert.match(feedClient, /function dancerLiveProfileHref\(video: MyDancrTvVideo\) \{\s+return `\/dancers\/\$\{encodeURIComponent\(video\.dancer\.slug\)\}`;\s+\}/);
  assert.match(feedClient, /function venueLiveProfileHref\(video: MyDancrTvVideo\) \{[\s\S]*?city=\$\{encodeURIComponent\(city\)\}&venue=\$\{encodeURIComponent\(venue\)\}/);
  assert.match(feedClient, /function slugifyLiveProfileName\(value: string\) \{[\s\S]*?replaceAll\(" ", "-"\)[\s\S]*?replace\(\/\[\^a-z0-9-\]\/g, ""\)/);
  assert.doesNotMatch(feedClient, /function dancerLiveProfileHref[\s\S]*?&profile=/);
  assert.match(liveApp, /const initialDiscoveryRequest = loadLiveDiscovery\(citySelect\.value\)/);
  assert.match(liveApp, /initialDiscoveryRequest\.finally\(\(\) => openSharedProfileFromUrl\(\)\)/);
  assert.match(liveApp, /const venueSlug = params\.get\("venue"\);[\s\S]*?activeTab = venueSlug \? "venues" : "dancers";[\s\S]*?resolveVenueByName\(venueSlug, city\)[\s\S]*?openVenueFromName\(venue\.slug \|\| venue\.name\)/);
  assert.match(liveApp, /function venueUpcomingShiftRow[\s\S]*?profile\.status === "Verified" \? '<span class="verified-mark" aria-label="Verified">✓<\/span>' : ""/);
  assert.doesNotMatch(liveApp, /verifiedCheckMarkup/);
  assert.match(liveApp, /const initialProfileCity = initialProfileParams\.get\("city"\);[\s\S]*?if \(initialProfileCity && markets\[initialProfileCity\]\)[\s\S]*?citySelect\.value = initialProfileCity/);
  assert.match(feedClient, /aria-label="Close MyDancr TV and return to homepage"/);
  assert.match(globalNavigation, /label: "Now"[\s\S]*?label: "Dancers"[\s\S]*?label: "TV"[\s\S]*?label: "Venues"[\s\S]*?label: "Trending"/);
  assert.match(globalNavigation, /\.global-mobile-bottom-nav \{[\s\S]*?grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(feedClient, /className="tv-card-venue-line"[\s\S]*?className="tv-card-venue-name"[\s\S]*?video\.venue\.name/);
  assert.match(feedClient, /className="tv-card-stage-name"[\s\S]*?video\.dancer\.stageName/);
  assert.match(feedClient, /className="tv-verified-mark" aria-label="Verified">✓/);
  assert.match(tvSource, /\.from\("dancer_photos"\)[\s\S]*?\.eq\("is_primary", true\)[\s\S]*?\.eq\("review_status", "approved"\)/);
  assert.match(tvSource, /dancer: \{ \.\.\.publicVideo\.dancer, primaryPhotoUrl \}/);
  assert.match(feedClient, /className=\{`tv-profile-photo\$\{video\.dancer\.primaryPhotoUrl \? " has-photo" : ""\}`\}/);
  assert.match(feedClient, /backgroundImage: `url\(\$\{JSON\.stringify\(video\.dancer\.primaryPhotoUrl\)\}\)`/);
  assert.match(feedClient, /video\.dancer\.primaryPhotoUrl \? null : dancerInitials\(video\.dancer\.stageName\)/);
  assert.match(feedClient, /\.tv-profile-photo \{[^}]*width: 58px[^}]*height: 58px[^}]*background-size: cover/);
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
  assert.doesNotMatch(tvSource, /comparePublicTvFeedRows|upcomingDifference|scoreDifference/);
  assert.match(
    tvSource,
    /const scheduleOrdered = \[0, 1, 2\]\.flatMap\(\(priority\) =>[\s\S]*?shuffleVideos\(remaining\.filter\(\(video\) => tvSchedulePriority\(video\) === priority\)\)/,
  );
  assert.match(
    tvSource,
    /function shuffleVideos\(rows: NormalizedFeedRow\[\]\) \{[\s\S]*?for \(let index = shuffled\.length - 1; index > 0; index -= 1\)[\s\S]*?Math\.floor\(Math\.random\(\) \* \(index \+ 1\)\)[\s\S]*?return shuffled/,
  );
  assert.match(tvSource, /shift\?\.status === "posted"[\s\S]*?!shift\.checked_out_at[\s\S]*?start > now/);
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
  assert.match(dancerPage, /showDancerName=\{false\}/);
  assert.doesNotMatch(dancerPage, /watchAllHref|href=\{`\/tv/);
  assert.match(videoStrip, /<video aria-hidden="true" autoPlay loop muted playsInline/);
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
  assert.match(liveApp, /loadProfileMyDancrTv[\s\S]*?video\.autoplay = true/);
  assert.match(liveApp, /heading\.textContent = `\$\{profile\.name\} on MyDancr TV`/);
  assert.match(liveApp, /const card = document\.createElement\("button"\)[\s\S]*?card\.className = "profile-tv-strip-card"/);
  assert.match(liveApp, /card\.addEventListener\("click", \(\) => openProfileTvViewer\(item, profile\.name, payload\.videos\)\)/);
  assert.match(liveApp, /id="profileTvViewer"[\s\S]*?role="dialog"[\s\S]*?profile-tv-viewer-video[\s\S]*?controlslist="nofullscreen noremoteplayback nodownload"[\s\S]*?loop playsinline/);
  assert.match(liveApp, /data-previous-profile-tv[\s\S]*?data-next-profile-tv[\s\S]*?id="profileTvViewerGallery"/);
  assert.match(liveApp, /touchstart[\s\S]*?touchend[\s\S]*?showRelativeProfileTvVideo\(distance < 0 \? 1 : -1\)/);
  assert.match(liveApp, /function renderProfileTvViewerItem\(index\)[\s\S]*?profileTvVideos[\s\S]*?scrollIntoView/);
  assert.match(liveApp, /profile-tv-viewer-gallery[\s\S]*?overflow-x: auto[\s\S]*?scroll-snap-type: x proximity/);
  assert.doesNotMatch(liveApp, /enterProfileTvFullscreen|requestFullscreen\(\)|:fullscreen/);
  assert.match(liveApp, /async function shareProfileTvVideo\(\)[\s\S]*?`\/tv\/\$\{encodeURIComponent\(videoId\)\}`[\s\S]*?navigator\.share[\s\S]*?copyText\(url, "Video link copied"\)/);
  assert.doesNotMatch(liveApp, /all\.href = `\/tv\?|link\.href = `\/tv\/\$\{encodeURIComponent\(item\.id\)\}`/);
  assert.doesNotMatch(liveApp, /id="homeTvTeaserLink"/);
  assert.match(liveApp, /profile-tv-strip-schedule is-now[\s\S]*?profile-tv-strip-schedule is-upcoming[\s\S]*?profile-tv-strip-schedule is-no-shift/);
  assert.match(liveApp, /formatProfileTvShift\(item\.shift\.startsAt, item\.shift\.timezone\)/);
  assert.match(liveApp, /<strong>Next shift<\/strong>/);
  assert.doesNotMatch(liveApp, /Upcoming interest/);
  assert.doesNotMatch(liveApp, /caption\.textContent = item\.caption \|\| "Watch video"/);
  assert.match(tvPage, /const dancerId = cleanUuid\(params\.dancer\)/);
  assert.match(tvPage, /dancerId,[\s\S]*?initialDancerId=\{dancerId \|\| ""\}/);
  assert.match(feedClient, /if \(initialDancerId\) params\.set\("dancer", initialDancerId\)/);
  assert.match(feedClient, /if \(initialDancerId\) url\.searchParams\.set\("dancer", initialDancerId\)/);
  assert.match(venuePage, /getPublicMyDancrTvFeed/);
  assert.match(venuePage, /venueId: venue\.id/);
  assert.match(venuePage, /<TvVideoStrip/);
  assert.doesNotMatch(venuePage, /watchAllHref|href=\{`\/tv/);
});
