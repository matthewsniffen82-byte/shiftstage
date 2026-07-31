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
    /\.home-tv-feed-dancer \{[\s\S]*?grid-template-columns: 50px minmax\(0, 1fr\) auto[\s\S]*?\.home-tv-feed-dancer-photo \{[\s\S]*?width: 50px;[\s\S]*?height: 50px;[\s\S]*?border-radius: 999px;[\s\S]*?\.home-tv-feed-dancer-photo img \{[\s\S]*?object-fit: cover;[\s\S]*?\.home-tv-feed-dancer-name \{[\s\S]*?text-overflow: ellipsis/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-verified \{[\s\S]*?width: 18px[\s\S]*?height: 18px/,
  );
  assert.match(
    homeSource,
    /profileCue\.textContent = "View profile →"[\s\S]*?meta\.textContent = `Dancer · \$\{dancerCity\}`/,
  );
  assert.match(
    homeSource,
    /const dancerPhotoUrl = String\(item\?\.dancer\?\.primaryPhotoUrl[\s\S]*?dancerPhoto\.className = "home-tv-feed-dancer-photo"[\s\S]*?dancerPhotoImage\.src = dancerPhotoUrl[\s\S]*?dancerPhotoImage\.addEventListener\("error", \(\) => dancerPhotoImage\.remove\(\)\)[\s\S]*?dancer\.append\(dancerPhoto, nameRow, profileCue\)/,
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

test("empty schedules are hidden while real city, venue, and shift context remains", () => {
  const scheduleFunction =
    homeSource.match(
      /function homeTvFeedSchedule\(item\) \{[\s\S]*?(?=\n    function createHomeTvFeedMediaFallback)/,
    )?.[0] || "";
  assert.match(scheduleFunction, /"Working now"/);
  assert.match(scheduleFunction, /`Upcoming \$\{formatProfileTvShift/);
  assert.match(scheduleFunction, /return null/);
  assert.doesNotMatch(scheduleFunction, /No shift posted/);
  assert.match(
    homeSource,
    /if \(venueName && venueSlug\)[\s\S]*?home-tv-feed-venue[\s\S]*?if \(scheduleContext\)/,
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
});

test("card controls expose accessible labels, keyboard alternatives, and feedback", () => {
  assert.match(
    homeSource,
    /body\.home-tv-feed-locked \.app > header \{[\s\S]*?visibility: hidden !important[\s\S]*?pointer-events: none !important/,
  );
  assert.match(
    homeSource,
    /Tap to play or pause, double tap to applaud[\s\S]*?swipe up or down for another video[\s\S]*?event\.key === "ArrowUp" \|\| event\.key === "ArrowDown"[\s\S]*?event\.key === "a" \|\| event\.key === "A"/,
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
