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

test("the public dancer profile uses the full authenticated global header", () => {
  assert.match(profilePage, /<PublicProfileHeader/);
  assert.match(profilePage, /<ProfileCloseButton/);
  assert.match(navigationActions, /className="public-profile-close"/);
  assert.match(profileHeader, /className="profile-global-logo"/);
  assert.match(profileHeader, /Open notifications/);
  assert.match(profileHeader, /fetch\("\/api\/notifications"/);
  assert.match(profileHeader, /href=\{dashboardHref\(role\)\}/);
  assert.match(profileHeader, /Login \/ Join/);
  assert.match(profileHeader, /method: "DELETE"/);
});

test("the mobile profile is ordered around identity, revenue, schedule, media, and details", () => {
  const heroIndex = profilePage.indexOf('className="public-hero dancer-hero"');
  const mediaIndex = profilePage.indexOf("<DancerPhotoCarousel");
  const dealIndex = profilePage.indexOf('className="venue-qr-section live-deal-section"');
  const scheduleIndex = profilePage.indexOf('className="profile-schedule-section"');
  const detailsIndex = profilePage.indexOf('className="public-grid"');

  assert.ok(heroIndex > -1);
  assert.ok(mediaIndex > heroIndex);
  assert.ok(dealIndex > mediaIndex);
  assert.ok(scheduleIndex > dealIndex);
  assert.ok(detailsIndex > scheduleIndex);
  assert.match(profilePage, /videos=\{tvVideos\.map\(/);
  assert.doesNotMatch(profilePage, /<TvVideoStrip/);
  assert.match(profilePage, /grid-template-areas: "photo" "copy"/);
  assert.match(profilePage, /profile-live-state\$\{activeShift \? " is-working"/);
  assert.match(profilePage, /Verified check-in · until/);
  assert.match(profilePage, /No posted shift right now/);
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
  assert.doesNotMatch(profilePage, /className="public-gallery"/);
  assert.doesNotMatch(profilePage, /className="gallery-photo"/);
  assert.doesNotMatch(profilePage, /Not ranked yet/);
  assert.match(profilePage, /\{profile\.bio \? <p className="profile-bio">/);
  assert.match(profilePage, /\{profile\.currentRank \? \(/);
});

test("the primary shift is not repeated and empty profile sections stay hidden", () => {
  assert.match(
    profilePage,
    /const additionalShifts = primaryShift[\s\S]*?shift\.id !== primaryShift\.id/,
  );
  assert.match(profilePage, /\{additionalShifts\.length \? \(/);
  assert.match(profilePage, /<h2 id="profile-schedule-title">More shifts<\/h2>/);
  assert.match(profilePage, /\{additionalShifts\.map\(\(shift\) =>/);
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

test("official links stay compact and real videos have distinct metadata", () => {
  assert.match(socialLinks, /const visibleLinks = expanded \? links : links\.slice\(0, 3\)/);
  assert.match(socialLinks, /Show \$\{links\.length - 3\} more links/);
  assert.match(tvStrip, /Video \$\{index \+ 1\} of \$\{videos\.length\}/);
  assert.match(tvStrip, /formatVideoDuration\(video\.durationSeconds\)/);
  assert.match(tvStrip, /formatVideoDate\(video\.publishedAt\)/);
});

test("every MyDancr TV dancer destination opens the full live profile with the canonical database slug", () => {
  assert.match(
    tvFeed,
    /function dancerLiveProfileHref\(video: MyDancrTvVideo\) \{[\s\S]*?video\.dancer\.slug\.trim\(\)[\s\S]*?city=\$\{encodeURIComponent\(city\)\}&profile=\$\{encodeURIComponent\(profile\)\}/,
  );
  assert.doesNotMatch(
    tvFeed,
    /function dancerLiveProfileHref\(video: MyDancrTvVideo\) \{\s+return `\/dancers\//,
  );
});
