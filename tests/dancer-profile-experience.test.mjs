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
  dashboardClient,
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
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
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
  assert.match(profilePage, /<DancerReportControl dancerId=\{profile\.id\} profileName=\{profile\.stageName\} \/>/);
  assert.match(navigationActions, /className="public-profile-close"/);
  assert.match(profilePage, /\.profile-titlebar \{ position: relative; z-index: 10;/);
  assert.doesNotMatch(profilePage, /\.profile-titlebar \{ position: sticky;/);
  assert.match(profilePage, /\.profile-titlebar \{[\s\S]*?min-height: 64px;[\s\S]*?grid-template-columns: minmax\(120px, \.95fr\) minmax\(150px, 1\.05fr\) 44px;[\s\S]*?gap: 6px;/);
  assert.match(profilePage, /\.profile-titlebar-avatar \{ width: 48px; height: 48px;/);
  assert.match(
    profilePage,
    /@media \(max-width: 600px\) \{[\s\S]*?body\.dancr-button-system \.public-profile-shell \.profile-titlebar \{[\s\S]*?min-height: 64px !important;[\s\S]*?\.profile-titlebar-avatar \{ width: 46px; height: 46px; \}/,
  );
  assert.match(profilePage, /\.profile-titlebar-city \{ min-height: 22px;[\s\S]*?border-radius: 999px;/);
  assert.match(
    profilePage,
    /\.public-profile-close \{ position: static; width: 44px; min-height: 44px;/,
  );
  assert.match(profilePage, /\.public-profile-close \{ position: static;[^}]*font-size: 26px;/);
  assert.match(profilePage, /\.profile-header-metrics \{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(profilePage, /\.profile-titlebar \{[\s\S]*?border-bottom: 0;/);
  assert.doesNotMatch(profileCarousel, /profile-media-heading|Photos &amp; TV|approved<\/span>/);
  assert.match(profileCarousel, /className="profile-media-section"[\s\S]*?className="profile-media-tabs"/);
  assert.match(profilePage, /\.profile-media-tabs \{[\s\S]*?position: sticky;[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[\s\S]*?gap: 0;[\s\S]*?border-radius: 0;/);
  assert.match(profilePage, /body\.dancr-button-system \.public-profile-shell \.profile-media-tabs button \{[\s\S]*?min-height: 52px;[\s\S]*?border-radius: 0 !important;/);
  assert.match(profilePage, /\.profile-media-tab-icon \{ width: 16px; height: 16px;[\s\S]*?flex: 0 0 16px;/);
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

test("the mobile profile keeps nightlife actions and active deals above the media library", () => {
  const identityIndex = profilePage.indexOf('className="profile-titlebar"');
  const metricsIndex = profilePage.indexOf('className="profile-header-metrics"');
  const mediaIndex = profilePage.indexOf("<DancerPhotoCarousel");
  const actionsIndex = profilePage.indexOf("<DancerProfileActions");
  const scheduleIndex = profilePage.indexOf('className={`profile-tonight-card');
  const dealIndex = profilePage.indexOf('className="profile-tonight-deal"');
  const travelIndex = profilePage.indexOf('aria-label="Venue travel actions"');
  const socialIndex = profilePage.indexOf('className="profile-social-section"');

  assert.ok(identityIndex > -1);
  assert.ok(metricsIndex > identityIndex);
  assert.ok(actionsIndex > metricsIndex);
  assert.ok(scheduleIndex > actionsIndex);
  assert.ok(dealIndex > scheduleIndex);
  assert.ok(travelIndex > dealIndex);
  assert.ok(socialIndex > travelIndex);
  assert.ok(mediaIndex > socialIndex);
  assert.match(profilePage, /<DancerFollowerMetric \/>/);
  assert.match(profilePage, /<DancerGoingCount \/>/);
  assert.match(profilePage, /format\(profile\.profileViewsToday \|\| 0\)[\s\S]*?<dt>Views today<\/dt>/);
  assert.doesNotMatch(profilePage, /className="profile-overview"/);
  assert.doesNotMatch(profilePage, /<dt>Notifications<\/dt>/);
  assert.match(profilePage, /shareControl=\{<ProfileShareButton stageName=\{profile\.stageName\} \/>\}/);
  assert.match(profilePage, /videos=\{tvVideos\.map\(/);
  assert.doesNotMatch(profilePage, /<TvVideoStrip/);
  assert.match(profilePage, /className="profile-working-destination"[\s\S]*?<VenuePinIcon \/>[\s\S]*?<strong>\{activeShift\.venueName\}<\/strong>/);
  assert.match(profilePage, /attributionToken=\{dealAttributionToken\}/);
  assert.match(profilePage, /const dealSourceType = dancerAttributionEligible \? "dancer_profile" : "club_page"/);
  assert.match(profilePage, /sourceType=\{dealSourceType\}/);
  assert.match(profilePage, /presentation="profileCompact"/);
  assert.doesNotMatch(profilePage, /contextLabel=\{`Available tonight at \$\{activeShift\.venueName\}`\}/);
  assert.match(profilePage, /ctaLabel=\{activeDeals\.length > 1 \? `View all \$\{activeDeals\.length\}` : "View Deal"\}/);
  assert.doesNotMatch(profilePage, /hasPrimaryDeal=/);
  assert.doesNotMatch(profilePage, /import \{ VenueQrUnavailable \}|<VenueQrUnavailable/);
  assert.match(profilePage, /\{activeShift && activeDeal \? \([\s\S]*?className="profile-active-deal has-club-deal"/);
  assert.match(profilePage, /aria-label="Tonight"[\s\S]*?className="profile-tonight-deal"/);
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

test("profile actions keep customer and safety controls visible while Tonight owns travel", () => {
  assert.match(
    profileActions,
    /className=\{`profile-action-secondary profile-action-icon-control\$\{saved\.following \? " is-selected" : ""\}`\}/,
  );
  assert.doesNotMatch(profileActions, /Sign in required/);
  assert.match(profileActions, /aria-pressed=\{actionShift \? isGoing : undefined\}/);
  const followButtonIndex = profileActions.indexOf('if (requireCustomerAccount("follow"))');
  const notifyIndex = profileActions.indexOf('if (requireCustomerAccount("notify"))');
  const goingIndex = profileActions.indexOf('className={`${actionShift ? "profile-action-available" : "profile-action-secondary"} profile-action-going');
  const shareIndex = profileActions.indexOf('{shareControl ?');
  assert.ok(followButtonIndex > -1 && notifyIndex > followButtonIndex);
  assert.ok(goingIndex > notifyIndex && shareIndex > goingIndex);
  assert.doesNotMatch(profileActions, /rideControl|directionsControl|Working Now only|Venue required/);
  assert.match(profilePage, /profile-tonight-travel-actions[\s\S]*?<DancerDirectionsButton[\s\S]*?<UberRideButton/);
  assert.doesNotMatch(profileActions, /profile-action-schedule|>Schedule</);
  assert.match(profileActions, /className="profile-header-report"/);
  assert.match(profileActions, /className="profile-header-report-toggle"/);
  assert.doesNotMatch(profileActions, /profile-header-overflow/);
  assert.match(profileActions, /Report profile/);
  assert.match(profileActions, /onClick=\{openReport\}/);
  assert.match(profileActions, /className="profile-report-dialog"/);
  assert.match(profileActions, /<select[\s\S]*required[\s\S]*value=\{reportReason\}/);
  assert.match(profileActions, /<textarea[\s\S]*maxLength=\{1200\}/);
  assert.match(profileActions, /onSubmit=\{submitReportForm\}/);
  assert.match(profileActions, /details: reportDetails\.trim\(\) \|\| null/);
  assert.doesNotMatch(
    profileActions,
    /reason: "Profile report"[\s\S]*details: "Reported from the public dancer profile\."/,
  );
  assert.match(profileActions, /const hasLiveActions = Boolean\(actionShift\?\.isActive\)/);
  assert.match(profileActions, /const hasScheduledActions = Boolean\(actionShift\)/);
  assert.match(profileActions, /live-actions\$\{hasLiveActions \? " has-live-shift" : hasScheduledActions \? " has-upcoming-shift" : " is-no-live-shift"\}/);
  assert.match(profileActions, /profile-action-going[\s\S]*?profile-action-unavailable/);
  assert.doesNotMatch(profileActions, /<small className="profile-action-requirement">No shift posted<\/small>/);
  assert.match(profilePage, /className="profile-shift-card profile-schedule-empty is-empty" aria-label="Schedule status"[\s\S]*?className="profile-empty-state">No shift posted<[\s\S]*?className="profile-empty-copy">[\s\S]*?Follow \{profile\.stageName\} for updates/);
  assert.doesNotMatch(profilePage, /profile-tonight-travel-actions is-no-schedule/);
  assert.match(profilePage, /\.live-actions\.is-no-live-shift \{ grid-template-columns: repeat\(4, minmax\(0, 1fr\)\); \}/);
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
  assert.match(profilePage, /className="profile-shift-card profile-upcoming-card is-upcoming"/);
  assert.match(profilePage, /\{upcomingShifts\.map\(\(shift, index\) =>/);
  assert.match(profilePage, /className="profile-upcoming-state"[\s\S]*?Upcoming · \{formatShiftDate/);
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

test("profile videos stay passive and duration-free in the grid, then open the complete full-screen player", () => {
  const mediaGrid = profileCarousel.slice(
    profileCarousel.indexOf("{visibleItems.map"),
    profileCarousel.indexOf("{viewer && activeViewerItem"),
  );
  assert.match(profileCarousel, /className=\{`profile-media-grid-item is-\$\{item\.kind\}`\}/);
  assert.match(mediaGrid, /<video[\s\S]*?muted[\s\S]*?playsInline[\s\S]*?preload="metadata"/);
  assert.match(mediaGrid, /src=\{`\$\{item\.videoUrl\}#t=0\.1`\}/);
  assert.doesNotMatch(mediaGrid, /autoPlay/);
  assert.match(profileCarousel, /className="profile-media-play"/);
  assert.match(profilePage, /\.profile-media-play \{[^}]*?width: 34px;[^}]*?border: 1px solid rgba\(255,255,255,\.38\);[^}]*?background: rgba\(5,5,9,\.62\);/);
  assert.match(profilePage, /\.profile-media-play::after \{[^}]*?border-left: 9px solid #fff;/);
  assert.match(dashboardClient, /\.dancer-profile-preview-overlay \.profile-media-play \{[^}]*?width:34px;[^}]*?border:1px solid rgba\(255,255,255,\.38\);[^}]*?background:rgba\(5,5,9,\.62\);/);
  assert.match(liveApp, /\.profile-modal \.profile-media-thumb-play \{[^}]*?width: 34px;[^}]*?border: 1px solid rgba\(255,255,255,\.38\);[^}]*?background: rgba\(5,5,9,\.62\);/);
  assert.match(liveApp, /\.profile-modal \.profile-media-thumb-play::after \{[^}]*?border-left: 9px solid #fff;/);
  assert.doesNotMatch(profileCarousel, /profile-media-duration|formatDuration/);
  assert.doesNotMatch(liveApp, /<span class="profile-media-thumb-duration"/);
  assert.match(liveApp, /function profileVideoThumbMarkup\(item, index, total, profileName\)[\s\S]*?aria-label="Open \$\{escapeHtml\(profileName\)\} profile video \$\{index \+ 1\} of \$\{total\} full screen, \$\{escapeHtml\(scheduleLabel\)\}"/);
  assert.match(profileCarousel, /openViewer\(item\.kind, index, event\.currentTarget\)/);
  assert.match(profileCarousel, /\{viewerItems\.map\(\(item, index\) => \([\s\S]*?controls[\s\S]*?controlsList="nofullscreen noremoteplayback nodownload"/);
  assert.match(profileCarousel, /index === viewerIndex[\s\S]*?void video\.play\(\)[\s\S]*?video\.pause\(\)/);
  assert.match(profileCarousel, /DANCER_PROFILE_MEDIA_PAGE_SIZE/);
  assert.match(profileCarousel, /new IntersectionObserver/);
  assert.match(profileCarousel, /data-profile-media-lazy-sentinel/);
  assert.doesNotMatch(profileCarousel, /Load more|inlinePlaying|profile-media-video-controls/);
  assert.match(profilePage, /\.profile-media-grid-item \{[\s\S]*?aspect-ratio: 9 \/ 16;/);
});

test("public social icons render without a visible heading or published handles", () => {
  assert.match(socialLinks, /heading = "Socials"/);
  assert.match(socialLinks, /showConnectLabel = false/);
  assert.match(socialLinks, /showHeading = true/);
  assert.match(socialLinks, /\{showHeading \? \([\s\S]*?<h2 id="profile-social-heading">\{heading\}<\/h2>/);
  assert.match(profilePage, /showHeading=\{false\}/);
  assert.match(profilePage, /className="profile-social-section" aria-label="External profiles"/);
  assert.doesNotMatch(profilePage, /aria-labelledby="profile-social-heading"/);
  assert.match(socialLinks, /rel="noopener noreferrer"/);
  assert.match(socialLinks, /opens in a new tab/);
  assert.match(socialLinks, /\{links\.map\(\(link\) =>/);
  assert.match(socialLinks, /<SocialPlatformIcon platform=\{link\.platform\} \/>/);
  assert.match(socialLinks, /export function SocialPlatformIcon/);
  assert.doesNotMatch(socialLinks, /<strong>\{link\.handle\}<\/strong>/);
  assert.doesNotMatch(socialLinks, /social-list-toggle|Show fewer links|more links/);
  assert.match(profilePage, /\.social-links-control \{ display: grid; justify-items: center;/);
  assert.match(profilePage, /\.profile-social-section \{ min-height: 0;[\s\S]*?margin: 0 0 6px;[\s\S]*?padding: 0;/);
  assert.match(profilePage, /\.social-list \{ width: fit-content;[\s\S]*?flex-wrap: nowrap;[\s\S]*?justify-content: center;[\s\S]*?gap: 6px;/);
  assert.match(profilePage, /\.social-list a \{[\s\S]*?width: 44px;[\s\S]*?height: 44px;[\s\S]*?justify-content: center;/);
  assert.match(profilePage, /\.social-list a::before \{[\s\S]*?inset: 3px;[\s\S]*?border: 1px solid rgba\(226,232,240,\.11\);[\s\S]*?border-radius: 50%;/);
  assert.match(profilePage, /\.social-list a svg \{ position: relative; z-index: 1; width: 14px; height: 14px;/);
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
