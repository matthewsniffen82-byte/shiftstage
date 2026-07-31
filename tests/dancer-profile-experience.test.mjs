import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  profilePage,
  profileActions,
  profileHeader,
  tvFeed,
  reportsRoute,
  navigationActions,
  socialLinks,
  tvStrip,
] = await Promise.all([
  readFile(new URL("../app/dancers/[slug]/page.tsx", import.meta.url), "utf8"),
  readFile(
    new URL("../app/dancers/[slug]/DancerProfileActions.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../app/components/PublicProfileHeader.tsx", import.meta.url),
    "utf8",
  ),
  readFile(new URL("../app/tv/TvFeedClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/reports/route.ts", import.meta.url), "utf8"),
  readFile(
    new URL("../app/dancers/[slug]/ProfileNavigationActions.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../app/dancers/[slug]/SocialLinks.tsx", import.meta.url),
    "utf8",
  ),
  readFile(new URL("../app/components/TvVideoStrip.tsx", import.meta.url), "utf8"),
]);

test("the public dancer profile keeps identity, verification, city, and close control at the top", () => {
  assert.match(profilePage, /<header className="profile-titlebar">/);
  assert.match(profilePage, /<h1>\{profile\.stageName\}<\/h1>/);
  assert.match(profilePage, /className="profile-verified" aria-label="Verified dancer"/);
  assert.match(profilePage, /<span>\{profile\.city\}<\/span>/);
  assert.match(profilePage, /<ProfileCloseButton/);
  assert.match(navigationActions, /className="public-profile-close"/);
  assert.match(profilePage, /\.profile-titlebar \{ position: sticky;/);
  assert.doesNotMatch(profilePage, /<PublicProfileHeader/);
});

test("the mobile profile is ordered around identity, metrics, actions, live revenue, media, and schedule", () => {
  const identityIndex = profilePage.indexOf('className="profile-titlebar"');
  const overviewIndex = profilePage.indexOf('className="profile-overview"');
  const actionsIndex = profilePage.indexOf("<DancerProfileActions");
  const dealIndex = profilePage.indexOf('className="profile-working-card"');
  const mediaIndex = profilePage.indexOf("<DancerPhotoCarousel");
  const scheduleIndex = profilePage.indexOf('className="profile-schedule-section"');

  assert.ok(identityIndex > -1);
  assert.ok(overviewIndex > identityIndex);
  assert.ok(actionsIndex > overviewIndex);
  assert.ok(dealIndex > actionsIndex);
  assert.ok(mediaIndex > dealIndex);
  assert.ok(scheduleIndex > mediaIndex);
  assert.match(profilePage, /<DancerFollowerCount \/>/);
  assert.match(profilePage, /<DancerNotificationCount \/>/);
  assert.match(profilePage, /<DancerGoingCount \/>/);
  assert.match(profilePage, /shareControl=\{<ProfileShareButton stageName=\{profile\.stageName\} \/>\}/);
  assert.match(profilePage, /videos=\{tvVideos\.map\(/);
  assert.doesNotMatch(profilePage, /<TvVideoStrip/);
  assert.match(profilePage, /Verified check-in · until/);
  assert.match(profilePage, /Venue &amp; directions/);
  assert.match(profilePage, /attributionToken=\{dealAttributionToken\}/);
  assert.match(profilePage, /<VenueQrUnavailable venueName=\{activeShift\.venueName\} \/>/);
});

test("profile actions prioritize Going and demote reporting to a complete safety flow", () => {
  assert.match(
    profileActions,
    /className=\{`profile-action-primary profile-action-public\$\{actionShift \? "" : " profile-action-unavailable"\}`\}/,
  );
  assert.match(profileActions, /className="profile-action-report"/);
  assert.match(profileActions, /onClick=\{submitReport\}/);
  assert.match(profileActions, /className="profile-report-dialog"/);
  assert.match(profileActions, /<select[\s\S]*required[\s\S]*value=\{reportReason\}/);
  assert.match(profileActions, /<textarea[\s\S]*maxLength=\{1200\}/);
  assert.match(profileActions, /onSubmit=\{submitReportForm\}/);
  assert.match(profileActions, /details: reportDetails\.trim\(\) \|\| null/);
  assert.doesNotMatch(
    profileActions,
    /reason: "Profile report"[\s\S]*details: "Reported from the public dancer profile\."/,
  );
});

test("reports are bounded, validated, attributable when possible, and logged", () => {
  assert.match(reportsRoute, /MAX_TARGET_LABEL_LENGTH = 160/);
  assert.match(reportsRoute, /MAX_REASON_LENGTH = 120/);
  assert.match(reportsRoute, /MAX_DETAILS_LENGTH = 2000/);
  assert.match(reportsRoute, /Invalid report target id/);
  assert.match(reportsRoute, /reporter_id: reporterId/);
  assert.match(reportsRoute, /event: "content_report\.created"/);
});

test("the profile removes repeated galleries and hides empty ranking language", () => {
  assert.match(profilePage, /className=\{`profile-avatar/);
  assert.match(profilePage, /<DancerPhotoCarousel/);
  assert.doesNotMatch(profilePage, /Not ranked yet/);
  assert.doesNotMatch(profilePage, /profile\.bio|profile-bio|About \{profile\.stageName\}/);
  assert.doesNotMatch(profilePage, /profile\.currentRank/);
});

test("the primary shift is not repeated and empty profile sections stay hidden", () => {
  assert.match(
    profilePage,
    /const upcomingShifts = profile\.upcomingShifts\.filter\([\s\S]*?shift\.id !== activeShift\?\.id/,
  );
  assert.match(profilePage, /\{upcomingShifts\.length \? \(/);
  assert.match(profilePage, /<h2 id="profile-schedule-title">Upcoming shifts<\/h2>/);
  assert.match(profilePage, /\{upcomingShifts\.map\(\(shift\) =>/);
  assert.doesNotMatch(profilePage, /<p className="muted">No posted shifts right now\.<\/p>/);
});

test("profiles can be shared and close back to the referring site page", () => {
  assert.match(profilePage, /<ProfileShareButton stageName=\{profile\.stageName\} \/>/);
  assert.match(profilePage, /<ProfileCloseButton/);
  assert.match(navigationActions, /navigator\.share/);
  assert.match(navigationActions, /navigator\.clipboard\.writeText\(url\)/);
  assert.match(navigationActions, /previousUrl\.origin === window\.location\.origin/);
  assert.match(navigationActions, /window\.history\.back\(\)/);
  assert.match(navigationActions, /window\.location\.assign\(fallbackHref\)/);
});

test("official social icons stay centered without publishing handles", () => {
  assert.match(socialLinks, /<h2 id="profile-social-heading">Official socials<\/h2>/);
  assert.match(socialLinks, /rel="noopener noreferrer"/);
  assert.match(socialLinks, /opens in a new tab/);
  assert.match(socialLinks, /\{links\.map\(\(link\) =>/);
  assert.match(socialLinks, /<SocialIcon platform=\{link\.platform\} \/>/);
  assert.doesNotMatch(socialLinks, /<strong>\{link\.handle\}<\/strong>/);
  assert.doesNotMatch(socialLinks, /social-list-toggle|Show fewer links|more links/);
  assert.match(profilePage, /\.social-links-control \{ display: grid; justify-items: center;/);
  assert.match(profilePage, /\.social-list \{ width: 100%;[\s\S]*?justify-content: center;/);
  assert.match(profilePage, /\.social-list a \{ width: 48px;[\s\S]*?height: 48px;[\s\S]*?justify-content: center;/);
});

test("real videos keep distinct metadata", () => {
  assert.match(tvStrip, /Video \$\{index \+ 1\} of \$\{videos\.length\}/);
  assert.match(tvStrip, /formatVideoDuration\(video\.durationSeconds\)/);
  assert.match(tvStrip, /formatVideoDate\(video\.publishedAt\)/);
});

test("every MyDancr TV dancer destination opens the in-app live profile with the canonical database slug", () => {
  const dancerProfileHref =
    tvFeed.match(/function dancerLiveProfileHref\(video: MyDancrTvVideo\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(
    dancerProfileHref,
    /const city = video\.dancer\.city\.trim\(\) \|\| "Las Vegas";[\s\S]*?const slug = video\.dancer\.slug\.trim\(\);[\s\S]*?`\/\?city=\$\{encodeURIComponent\(city\)\}&profile=\$\{encodeURIComponent\(slug\)\}`[\s\S]*?homeDiscoveryHref\("dancers", city\)/,
  );
  assert.doesNotMatch(
    dancerProfileHref,
    /slugifyLiveProfileName\(video\.dancer\.stageName\)|`\/dancers\/\$\{encodeURIComponent\(slug\)\}`/,
  );
});
