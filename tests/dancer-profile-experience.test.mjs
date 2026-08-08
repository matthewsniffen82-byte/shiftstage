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
  profileCarousel,
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
  readFile(
    new URL("../app/dancers/[slug]/DancerPhotoCarousel.tsx", import.meta.url),
    "utf8",
  ),
]);

test("the public dancer profile keeps a compact identity that scrolls with the whole profile", () => {
  assert.match(profilePage, /<header className="profile-titlebar">/);
  assert.match(profilePage, /className=\{`profile-titlebar-avatar/);
  assert.match(profilePage, /<h1>\{profile\.stageName\}<\/h1>/);
  assert.match(profilePage, /className="profile-verified" aria-label="Verified dancer"/);
  assert.match(profilePage, /className="profile-titlebar-context"/);
  assert.match(profilePage, /className="profile-titlebar-city">\{profile\.city\}<\/span>/);
  assert.doesNotMatch(profilePage, /const nextShift =/);
  assert.match(profilePage, /<ProfileCloseButton/);
  assert.match(navigationActions, /className="public-profile-close"/);
  assert.match(profilePage, /\.profile-titlebar \{ position: relative; z-index: 1;/);
  assert.doesNotMatch(profilePage, /\.profile-titlebar \{ position: sticky;/);
  assert.match(profilePage, /\.profile-titlebar \{[\s\S]*?min-height: 64px;[\s\S]*?gap: 10px;/);
  assert.match(profilePage, /\.profile-titlebar-avatar \{ width: 42px; height: 42px;/);
  assert.match(profilePage, /\.profile-titlebar-city \{ min-height: 22px;[\s\S]*?border-radius: 999px;/);
  assert.match(profilePage, /\.public-profile-close \{ width: 40px; min-height: 40px;/);
  assert.match(profilePage, /\.profile-titlebar \{[\s\S]*?border-bottom: 0;/);
  assert.doesNotMatch(profileCarousel, /profile-media-heading|Photos &amp; TV|approved<\/span>/);
  assert.match(profileCarousel, /className="profile-media-section"[\s\S]*?className="profile-media-tabs"/);
  assert.match(profilePage, /\.profile-media-tabs \{[\s\S]*?grid-template-columns: repeat\(2, 44px\);[\s\S]*?gap: 0;[\s\S]*?padding: 0;[\s\S]*?border: 0;/);
  assert.match(profilePage, /body\.dancr-button-system \.public-profile-shell \.profile-media-tabs button::before \{[\s\S]*?inset: 4px;[\s\S]*?border-radius: 50%;/);
  assert.match(profilePage, /\.profile-media-tab-icon \{ position: relative; z-index: 1; width: 18px; height: 18px;/);
  assert.doesNotMatch(profilePage, /<PublicProfileHeader/);
});

test("standalone dancer profiles keep the document scrollbar neutral", () => {
  assert.match(
    profilePage,
    /html:has\(\.public-profile-shell\), body:has\(\.public-profile-shell\) \{ scrollbar-width: thin; scrollbar-color: rgba\(255,255,255,\.28\) transparent; \}/,
  );
  assert.match(
    profilePage,
    /html:has\(\.public-profile-shell\)::\-webkit-scrollbar-thumb,[\s\S]*?background: rgba\(255,255,255,\.28\); box-shadow: none;/,
  );
});

test("the mobile profile places schedule directly after media, before revenue and actions", () => {
  const identityIndex = profilePage.indexOf('className="profile-titlebar"');
  const mediaIndex = profilePage.indexOf("<DancerPhotoCarousel");
  const overviewIndex = profilePage.indexOf('className="profile-overview"');
  const actionsIndex = profilePage.indexOf("<DancerProfileActions");
  const scheduleIndex = profilePage.indexOf('className={`profile-working-card');
  const dealIndex = profilePage.indexOf('className={`profile-active-deal');
  const socialIndex = profilePage.indexOf('className="profile-social-section"');

  assert.ok(identityIndex > -1);
  assert.ok(mediaIndex > identityIndex);
  assert.ok(scheduleIndex > mediaIndex);
  assert.ok(dealIndex > scheduleIndex);
  assert.ok(actionsIndex > dealIndex);
  assert.ok(socialIndex > actionsIndex);
  assert.ok(overviewIndex > socialIndex);
  assert.match(profilePage, /<DancerFollowerCount \/>/);
  assert.match(profilePage, /<DancerGoingCount \/>/);
  assert.match(profilePage, /\{profile\.profileViewsToday \|\| 0\}[\s\S]*?<dt>Views today<\/dt>/);
  assert.doesNotMatch(profilePage, /<dt>Notifications<\/dt>/);
  assert.match(profilePage, /shareControl=\{<ProfileShareButton stageName=\{profile\.stageName\} \/>\}/);
  assert.match(profilePage, /videos=\{tvVideos\.map\(/);
  assert.doesNotMatch(profilePage, /<TvVideoStrip/);
  assert.match(profilePage, /Verified check-in · until/);
  assert.match(profilePage, /View venue/);
  assert.match(profilePage, /attributionToken=\{dealAttributionToken\}/);
  assert.match(profilePage, /sourceType="dancer_profile"/);
  assert.match(profilePage, /presentation="launcher"/);
  assert.match(profilePage, /ctaLabel=\{activeDeals\.length > 1 \? `Club Deals · \$\{activeDeals\.length\}` : "Get Club Deal QR"\}/);
  assert.doesNotMatch(profilePage, /hasPrimaryDeal=/);
  assert.match(profilePage, /<VenueQrUnavailable venueName=\{activeShift\.venueName\} \/>/);
  assert.match(profilePage, /className=\{`profile-active-deal\$\{activeDeal \? " has-club-deal" : ""\}`\}/);
});

test("profile actions prioritize Going and demote reporting to a complete safety flow", () => {
  assert.match(
    profileActions,
    /className=\{`profile-action-primary profile-action-public profile-action-going\$\{isGoing \? " is-going" : ""\}/,
  );
  assert.match(profileActions, /aria-pressed=\{isGoing\}/);
  const goingIndex = profileActions.indexOf('className={`profile-action-primary');
  const followIndex = profileActions.indexOf('if (requireCustomerAccount("follow"))');
  assert.ok(goingIndex > -1 && goingIndex < followIndex);
  assert.match(profileActions, /className="profile-action-overflow-toggle"/);
  assert.match(profileActions, /className="profile-action-overflow-menu" role="menu"/);
  assert.match(profileActions, /Report profile/);
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
  assert.match(profilePage, /className=\{`profile-titlebar-avatar/);
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
  assert.match(profilePage, /upcomingShifts\.length \? \(/);
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
  assert.match(navigationActions, /new URL\(fallbackHref, window\.location\.origin\)/);
  assert.match(navigationActions, /window\.setTimeout\(navigateToFallback, 900\)/);
  assert.match(navigationActions, /window\.addEventListener\([\s\S]*?"pagehide"/);
  assert.match(navigationActions, /window\.location\.assign\(destination\.toString\(\)\)/);
});

test("inline profile TV has complete play, sound, progress, and duration controls", () => {
  assert.match(profileCarousel, /function toggleInlinePlayback\(\)/);
  assert.match(profileCarousel, /function toggleInlineSound\(\)/);
  assert.match(profileCarousel, /function seekInlineVideo\(value: number\)/);
  assert.match(profileCarousel, /aria-label="TV video progress"/);
  assert.match(profileCarousel, /type="range"/);
  assert.match(profileCarousel, /\{inlinePlaying \? "Pause" : "Play"\}/);
  assert.match(profileCarousel, /\{inlineMuted \? "Sound on" : "Sound off"\}/);
  assert.match(profileCarousel, /formatDuration\(inlineCurrentTime\)/);
  assert.match(profilePage, /\.profile-media-video-controls \{ position: absolute;/);
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
