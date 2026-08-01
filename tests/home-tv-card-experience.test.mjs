import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [homeSource, tvSource, applauseMigration] = await Promise.all([
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/tv.ts", import.meta.url), "utf8"),
  readFile(
    new URL("../supabase/migrations/202607300003_mydancr_tv_applause_events.sql", import.meta.url),
    "utf8",
  ),
]);

test("the homepage TV card uses a resilient, readable media-first presentation", () => {
  assert.match(
    homeSource,
    /\.home-tv-feed-video \{[\s\S]*?object-fit: cover[\s\S]*?\.home-tv-feed-media-fallback \{[\s\S]*?background-size: cover/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-shade \{[\s\S]*?rgba\(0,0,0,.98\) 100%/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-dancer \{[\s\S]*?grid-template-columns: 46px minmax\(0, 1fr\)[\s\S]*?gap: 8px;[\s\S]*?\.home-tv-feed-dancer-photo \{[\s\S]*?width: 46px;[\s\S]*?height: 46px;[\s\S]*?border-radius: 999px;[\s\S]*?\.home-tv-feed-dancer-photo img \{[\s\S]*?object-fit: cover;[\s\S]*?\.home-tv-feed-dancer-copy \{[\s\S]*?\.home-tv-feed-dancer-name \{[\s\S]*?text-overflow: ellipsis/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-verified \{[\s\S]*?width: 18px[\s\S]*?height: 18px/,
  );
  assert.match(
    homeSource,
    /dancerCopy\.appendChild\(nameRow\)[\s\S]*?dancer\.append\(dancerPhoto, dancerCopy\)[\s\S]*?meta\.textContent = `Dancer · \$\{dancerCity\}`/,
  );
  assert.doesNotMatch(homeSource, /home-tv-feed-profile-hint|home-tv-feed-profile-cue|View profile →/);
  assert.match(
    homeSource,
    /dancerActions\.className = "home-tv-feed-dancer-actions"[\s\S]*?profileAction\.innerHTML = actionButtonLabel\("star", "Profile"\)[\s\S]*?followAction\.dataset\.feedAction = "follow"[\s\S]*?followAction\.dataset\.profile = dancerName[\s\S]*?followAction\.dataset\.homeTvVideoId = videoId[\s\S]*?actionButtonLabel\(isFollowed \? "check" : "heart", isFollowed \? "Following" : "Follow"\)/,
  );
  assert.match(
    homeSource,
    /const dancerPhotoUrl = String\(item\?\.dancer\?\.primaryPhotoUrl[\s\S]*?dancerPhoto\.className = "home-tv-feed-dancer-photo"[\s\S]*?dancerPhotoImage\.src = dancerPhotoUrl[\s\S]*?dancerPhotoImage\.addEventListener\("error", \(\) => dancerPhotoImage\.remove\(\)\)[\s\S]*?dancer\.append\(dancerPhoto, dancerCopy\)/,
  );
  assert.match(
    homeSource,
    /const hasLiveDeal = item\?\.shift\?\.isActive === true[\s\S]*?item\?\.venue\?\.id && item\?\.deal\?\.id && item\?\.dealAttributionToken[\s\S]*?"home-tv-feed-deal-action home-card-qr-rail-action"[\s\S]*?deal\.dataset\.clubDealCta = encodeDealPass[\s\S]*?sourceType: "dancer_profile"[\s\S]*?deal\.dataset\.feedLiveQr = "true"/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-deal-action \{[\s\S]*?border-color: var\(--dancr-color-success-strong\)[\s\S]*?var\(--dancr-color-success\)/,
  );
  assert.match(
    homeSource,
    /const posterUrl = String\(item\?\.dancer\?\.primaryPhotoUrl[\s\S]*?if \(posterUrl\) video\.poster = posterUrl[\s\S]*?video\.addEventListener\("error"[\s\S]*?"Video unavailable"/,
  );
  assert.match(
    homeSource,
    /function createHomeTvFeedProgress\(\)[\s\S]*?role", "progressbar"/,
  );
  assert.match(
    homeSource,
    /function syncHomeTvFeedProgress\(video, slide\)[\s\S]*?aria-valuenow/,
  );
});

test("the TV loading card keeps the final neutral edge during destination swipes", () => {
  assert.match(
    homeSource,
    /\.home-tv-feed-loading \{[\s\S]*?border: 1px solid rgba\(248,250,252,\.15\);/,
  );
  assert.match(
    homeSource,
    /#results\.home-dancer-grid > \.home-dancer-grid-card,[\s\S]*?#results\.home-tv-feed > \.home-tv-feed-loading,[\s\S]*?#results\.home-tv-feed > \.home-tv-feed-slide,[\s\S]*?linear-gradient\(145deg,var\(--home-card-edge-neutral\),var\(--home-card-edge-neutral\)\) border-box !important;[\s\S]*?0 0 22px var\(--home-card-glow\) !important;/,
  );
  assert.doesNotMatch(
    homeSource.match(/\.home-tv-feed-loading \{[\s\S]*?\}/)?.[0] || "",
    /139,92,246|124,58,237|violet/,
  );
});

test("the mobile TV identity and progress sit low without moving actions or navigation", () => {
  assert.match(
    homeSource,
    /\.home-tv-feed-copy \{[\s\S]*?padding: 96px 0 calc\(66px \+ env\(safe-area-inset-bottom\)\) 14px;/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-actions \{[\s\S]*?bottom: calc\(98px \+ env\(safe-area-inset-bottom\)\);/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-progress \{[\s\S]*?bottom: calc\(52px \+ env\(safe-area-inset-bottom\)\);/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-progress \{[\s\S]*?height: 5px;[\s\S]*?background: rgba\(255,255,255,\.36\);[\s\S]*?\.home-tv-feed-progress > span \{[\s\S]*?background: var\(--dancr-color-text-primary\);[\s\S]*?box-shadow: 0 0 4px rgba\(248,250,252,\.96\), 0 0 12px rgba\(248,250,252,\.78\);/,
  );
  assert.doesNotMatch(
    homeSource.match(/\.home-tv-feed-progress > span \{[\s\S]*?\}/)?.[0] || "",
    /#a855f7|#22d3ee|linear-gradient/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \{[\s\S]*?bottom: calc\(8px \+ env\(safe-area-inset-bottom\)\);/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-position \{\s*top: calc\(14px \+ env\(safe-area-inset-top\)\);\s*left: 12px;/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-fullscreen \{\s*top: calc\(66px \+ env\(safe-area-inset-top\)\);\s*right: 12px;/,
  );
});

test("empty schedules are hidden while real city, venue, and shift context remains", () => {
  const scheduleFunction =
    homeSource.match(
      /function homeTvFeedSchedule\(item\) \{[\s\S]*?(?=\n    function createHomeTvFeedMediaFallback)/,
    )?.[0] || "";
  assert.match(scheduleFunction, /"Working Now"/);
  assert.match(scheduleFunction, /dateLabel \? `Upcoming · \$\{dateLabel\}` : "Upcoming"/);
  assert.match(scheduleFunction, /return null/);
  assert.doesNotMatch(scheduleFunction, /No shift posted/);
  const shiftDateFormatter = homeSource.match(
    /function formatProfileTvShift\(startsAt, timeZone\) \{[\s\S]*?(?=\n    function clearProfileDeepLink)/,
  )?.[0] || "";
  assert.match(shiftDateFormatter, /weekday: "short"[\s\S]*?month: "short"[\s\S]*?day: "numeric"/);
  assert.doesNotMatch(shiftDateFormatter, /hour:|minute:|toLocaleTimeString|formatClock/);
  assert.match(
    homeSource,
    /if \(scheduleContext\)[\s\S]*?context\.className = "home-tv-feed-context"[\s\S]*?context\.appendChild\(schedule\)[\s\S]*?if \(venueName\)[\s\S]*?venue\.className = "home-tv-feed-venue"[\s\S]*?context\.appendChild\(venue\)[\s\S]*?copy\.appendChild\(context\)/,
  );
});

test("every uploaded video gets a vertically scrollable card with playback, applause, sharing, and reporting", () => {
  assert.match(
    homeSource,
    /results\.replaceChildren\(\s*\.\.\.homeTvFeedVideos\.map\(\(item, index\) => \(\s*createHomeTvFeedSlide\(item, index, homeTvFeedVideos\.length\)/,
  );
  assert.match(
    homeSource,
    /function createHomeTvFeedSlide\(item, index, total\)[\s\S]*?renderHomeTvFeedSlide\(slide, item, index, total\)/,
  );
  assert.match(
    homeSource,
    /position\.textContent = `Video \$\{videoIndex \+ 1\} of \$\{totalVideos\}`/,
  );
  assert.doesNotMatch(homeSource, /groupHomeTvFeedVideos|setupHomeTvFeedMediaGestures|showHomeTvFeedMedia/);
  assert.match(
    homeSource,
    /tapAt - lastTapAt <= 320[\s\S]*?applaudHomeTvFeedVideo\(item, slide\)/,
  );
  assert.match(
    homeSource,
    /async function shareHomeTvFeedVideo\(item, slide, button\)[\s\S]*?`\/tv\/\$\{encodeURIComponent\(videoId\)\}`[\s\S]*?navigator\.share[\s\S]*?copyText\(url, "Video link copied"\)[\s\S]*?"share"/,
  );
  assert.match(
    homeSource,
    /async function reportHomeTvFeedVideo\(item, reason, slide, button\)[\s\S]*?fetch\("\/api\/reports"[\s\S]*?targetType: "tv_video"[\s\S]*?targetId: videoId[\s\S]*?"report"/,
  );
  assert.match(homeSource, /Sexual or unsafe content[\s\S]*?Other safety concern/);
  assert.doesNotMatch(
    homeSource.match(
      /function createHomeTvFeedActions\(item, slide\) \{[\s\S]*?(?=\n    function createHomeTvFeedSoundButton)/,
    )?.[0] || "",
    /save|bookmark/i,
  );
});

test("applause is recorded through the constrained production TV analytics path", () => {
  assert.match(tvSource, /MYDANCR_TV_EVENT_TYPES = new Set\(\[[\s\S]*?"applause"/);
  assert.match(tvSource, /function emptyMetrics\(\)[\s\S]*?applause: 0/);
  assert.match(
    applauseMigration,
    /drop constraint if exists mydancr_tv_event_type_check[\s\S]*?event_type in \([\s\S]*?'applause'/,
  );
  assert.match(
    homeSource,
    /if \(following && actionButton\.dataset\.homeTvVideoId\)[\s\S]*?trackHomeTvFeedEvent\(actionButton\.dataset\.homeTvVideoId, "follow"\)/,
  );
});

test("card controls expose accessible labels, keyboard alternatives, and feedback", () => {
  assert.doesNotMatch(homeSource, /home-tv-feed-locked|home-destination-immersive/);
  assert.match(
    homeSource,
    /Tap to play or pause, double tap to applaud[\s\S]*?scroll up or down for another video[\s\S]*?event\.key === "ArrowUp" \|\| event\.key === "ArrowDown"[\s\S]*?event\.key === "a" \|\| event\.key === "A"/,
  );
  assert.match(
    homeSource,
    /feedback\.setAttribute\("role", "status"\)[\s\S]*?feedback\.setAttribute\("aria-live", "polite"\)/,
  );
  assert.match(
    homeSource,
    /reportMenu\.setAttribute\("role", "menu"\)[\s\S]*?option\.setAttribute\("role", "menuitem"\)/,
  );
  assert.match(
    homeSource,
    /video\.controlsList = "nodownload noremoteplayback nofullscreen"[\s\S]*?video\.disablePictureInPicture = true/,
  );
});

test("intentional pauses persist and every TV card exposes immersive fullscreen", () => {
  assert.match(
    homeSource,
    /function toggleHomeTvFeedPlayback\(video\)[\s\S]*?delete slide\.dataset\.userPaused[\s\S]*?slide\.dataset\.userPaused = "true"[\s\S]*?video\.pause\(\)/,
  );
  assert.match(
    homeSource,
    /function activateHomeTvFeedVideo\(videoId\)[\s\S]*?slide\.dataset\.userPaused === "true"[\s\S]*?video\.pause\(\)[\s\S]*?return/,
  );
  assert.match(
    homeSource,
    /function createHomeTvFeedFullscreenButton\(slide, video\)[\s\S]*?aria-hidden="true"[\s\S]*?toggleHomeTvFeedFullscreen\(slide, video\)/,
  );
  assert.match(
    homeSource,
    /function toggleHomeTvFeedFullscreen\(slide, video\)[\s\S]*?slide\.requestFullscreen\(\{ navigationUI: "hide" \}\)[\s\S]*?video\.webkitEnterFullscreen\(\)/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-slide:fullscreen,[\s\S]*?height: 100dvh;[\s\S]*?border-radius: 0;/,
  );
});

test("TV sound and fullscreen utilities are compact icon-only controls with accessible names", () => {
  assert.match(
    homeSource,
    /\.home-tv-feed-sound \{[\s\S]*?width: 44px;[\s\S]*?height: 44px;[\s\S]*?padding: 0;/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-fullscreen \{[\s\S]*?width: 44px;[\s\S]*?height: 44px;[\s\S]*?padding: 0;/,
  );
  const soundFactory = homeSource.match(
    /function createHomeTvFeedSoundButton\(slide\) \{[\s\S]*?(?=\n    function createHomeTvFeedFullscreenButton)/,
  )?.[0] || "";
  const fullscreenFactory = homeSource.match(
    /function createHomeTvFeedFullscreenButton\(slide, video\) \{[\s\S]*?(?=\n    function renderHomeTvFeedSlide)/,
  )?.[0] || "";
  assert.match(soundFactory, /sound\.innerHTML = '<svg[\s\S]*?<\/svg>'/);
  assert.match(fullscreenFactory, /button\.innerHTML = '<svg[\s\S]*?<\/svg>'/);
  assert.doesNotMatch(
    soundFactory.match(/sound\.innerHTML = '[^']*'/)?.[0] || "",
    /<span|Sound off|Sound on/,
  );
  assert.doesNotMatch(
    fullscreenFactory.match(/button\.innerHTML = '[^']*'/)?.[0] || "",
    /<span|View full screen|Exit full screen/,
  );
  assert.match(
    homeSource,
    /function syncHomeTvFeedSoundButtons\(\)[\s\S]*?button\.setAttribute\("aria-label", label\)[\s\S]*?button\.setAttribute\("title", label\)/,
  );
  assert.match(
    homeSource,
    /function syncHomeTvFeedFullscreenButtons\(\)[\s\S]*?button\.setAttribute\("aria-label", label\)[\s\S]*?button\.setAttribute\("title", label\)/,
  );
});

test("iPhone autoplay flags are applied before a TV card starts loading media", () => {
  assert.match(
    homeSource,
    /const video = document\.createElement\("video"\)[\s\S]*?video\.autoplay = index === 0[\s\S]*?video\.muted = homeTvFeedMuted[\s\S]*?video\.defaultMuted = homeTvFeedMuted[\s\S]*?video\.setAttribute\("playsinline", ""\)[\s\S]*?video\.setAttribute\("webkit-playsinline", ""\)[\s\S]*?video\.setAttribute\("muted", ""\)[\s\S]*?video\.src = item\.videoUrl/,
  );
  assert.match(
    homeSource,
    /function activateHomeTvFeedVideo\(videoId\)[\s\S]*?video\.setAttribute\("autoplay", ""\)[\s\S]*?video\.setAttribute\("webkit-playsinline", ""\)[\s\S]*?video\.play\(\)/,
  );
});
