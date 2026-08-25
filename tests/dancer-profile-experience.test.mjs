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
  liveApp,
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
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
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
  assert.match(
    profilePage,
    /\.public-profile-close \{ position: absolute; top: max\(8px, env\(safe-area-inset-top\)\); right: 0; width: 40px; min-height: 40px;/,
  );
  assert.match(profilePage, /\.profile-titlebar \{[\s\S]*?padding: max\(8px, env\(safe-area-inset-top\)\) 52px 8px 0;/);
  assert.match(profilePage, /\.profile-titlebar \{[\s\S]*?border-bottom: 0;/);
  assert.doesNotMatch(profileCarousel, /profile-media-heading|Photos &amp; TV|approved<\/span>/);
  assert.match(profileCarousel, /className="profile-media-section"[\s\S]*?className="profile-media-tabs"/);
  assert.match(profilePage, /\.profile-media-tabs \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[\s\S]*?gap: 4px;[\s\S]*?padding: 4px;[\s\S]*?border-radius: 15px;/);
  assert.match(profilePage, /body\.dancr-button-system \.public-profile-shell \.profile-media-tabs button \{[\s\S]*?min-height: 46px;[\s\S]*?border-radius: 11px !important;/);
  assert.match(profilePage, /\.profile-media-tab-icon \{ width: 18px; height: 18px;[\s\S]*?flex: 0 0 18px;/);
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
  assert.match(profilePage, /Dressing-room NFC verified · active until/);
  assert.match(profilePage, /Club &amp; directions/);
  assert.match(profilePage, /attributionToken=\{dealAttributionToken\}/);
  assert.match(profilePage, /const dealSourceType = dancerAttributionEligible \? "dancer_profile" : "club_page"/);
  assert.match(profilePage, /sourceType=\{dealSourceType\}/);
  assert.match(profilePage, /presentation="launcher"/);
  assert.match(profilePage, /ctaLabel="Club Deals"/);
  assert.doesNotMatch(profilePage, /hasPrimaryDeal=/);
  assert.match(profilePage, /<VenueQrUnavailable venueName=\{activeShift\.venueName\} \/>/);
  assert.match(profilePage, /className=\{`profile-active-deal\$\{activeDeal \? " has-club-deal" : ""\}`\}/);
});

test("working-now profiles show the club's active deal without granting demo commission attribution", () => {
  const configSource = liveApp.match(
    /function dancerProfileClubDealConfig\(profile\) \{[\s\S]*?\n    \}/,
  )?.[0] || "";
  const buildConfig = new Function(
    "isWorkingTonight",
    `${configSource}; return dancerProfileClubDealConfig;`,
  )((profile) => profile?.workingNow === true);
  const baseProfile = {
    id: "dancer-1",
    name: "Nova",
    venue: "Nova Lounge",
    venueId: "venue-1",
    venueSlug: "nova-lounge",
    workingNow: true,
    activeDeal: { id: "deal-1", dealTitle: "Half-off admission" },
    activeDeals: [{ id: "deal-1", dealTitle: "Half-off admission" }],
    dealAttributionTokens: {},
    dealAttributionToken: "",
  };

  assert.deepEqual(buildConfig(baseProfile), {
    deal: baseProfile.activeDeal,
    deals: baseProfile.activeDeals,
    venueId: "venue-1",
    venueSlug: "nova-lounge",
    venueName: "Nova Lounge",
    sourceType: "club_page",
    dancerId: "",
    dancerName: "",
    attributionToken: "",
    dealAttributionTokens: {},
  });

  const attributedProfile = {
    ...baseProfile,
    dealAttributionToken: "signed-token",
    dealAttributionTokens: { "deal-1": "signed-token" },
  };
  assert.equal(buildConfig(attributedProfile).sourceType, "dancer_profile");
  assert.equal(buildConfig(attributedProfile).dancerId, "dancer-1");
  assert.equal(buildConfig(attributedProfile).attributionToken, "signed-token");
  assert.equal(buildConfig({ ...baseProfile, workingNow: false }), null);
  assert.equal(buildConfig({ ...baseProfile, activeDeal: null }), null);

  assert.match(liveApp, /function dancerClubDealState\(profile\)[\s\S]*?const available = Boolean\(dancerProfileClubDealConfig\(profile\)\)/);
  assert.match(liveApp, /function profileDealTileMarkup\(profile\)[\s\S]*?const config = dancerProfileClubDealConfig\(profile\)/);
  assert.match(liveApp, /function homeDiscoveryFeedLiveQrData\(profile\)[\s\S]*?const config = dancerProfileClubDealConfig\(profile\)/);
  assert.match(profilePage, /activeShift && activeShift\.shiftSource !== "demo_locked"/);
  assert.match(profilePage, /dancerId=\{dancerAttributionEligible \? profile\.id : null\}/);
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
  assert.match(profilePage, /<h2 id="profile-schedule-title">Upcoming dates<\/h2>/);
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

test("profile videos stay passive in the grid and open the complete full-screen player", () => {
  assert.match(profileCarousel, /className=\{`profile-media-grid-item is-\$\{item\.kind\}`\}/);
  assert.match(profileCarousel, /preload="metadata"[\s\S]*?src=\{item\.videoUrl\}/);
  assert.match(profileCarousel, /className="profile-media-play"/);
  assert.match(profileCarousel, /className="profile-media-duration"/);
  assert.match(profileCarousel, /openViewer\(item\.kind, index, event\.currentTarget\)/);
  assert.match(profileCarousel, /autoPlay[\s\S]*?controls[\s\S]*?controlsList="nofullscreen noremoteplayback nodownload"/);
  assert.doesNotMatch(profileCarousel, /IntersectionObserver|inlinePlaying|profile-media-video-controls/);
  assert.match(profilePage, /\.profile-media-grid-item \{[\s\S]*?aspect-ratio: 4 \/ 5;/);
});

test("social icons use one simple Socials heading without publishing handles", () => {
  assert.match(socialLinks, /heading = "Socials"/);
  assert.match(socialLinks, /showConnectLabel = false/);
  assert.match(socialLinks, /<h2 id="profile-social-heading">\{heading\}<\/h2>/);
  assert.match(socialLinks, /rel="noopener noreferrer"/);
  assert.match(socialLinks, /opens in a new tab/);
  assert.match(socialLinks, /\{links\.map\(\(link\) =>/);
  assert.match(socialLinks, /<SocialPlatformIcon platform=\{link\.platform\} \/>/);
  assert.match(socialLinks, /export function SocialPlatformIcon/);
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
