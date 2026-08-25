import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  liveApp,
  profilePage,
  profileMedia,
  profileActions,
  profileNavigationActions,
  bottomNavigation,
  nfcIcon,
  uberRideStyles,
] =
  await Promise.all([
    readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
    readFile(new URL("../app/dancers/[slug]/page.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../app/dancers/[slug]/DancerPhotoCarousel.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/dancers/[slug]/DancerProfileActions.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/dancers/[slug]/ProfileNavigationActions.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../app/components/GlobalMobileBottomNav.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/components/NfcIcon.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../app/components/UberRideButton.module.css", import.meta.url),
      "utf8",
    ),
  ]);

test("full dancer profiles use a compact identity and honest public activity header without a bio", () => {
  assert.match(profilePage, /className="profile-titlebar"/);
  assert.match(profilePage, /className=\{`profile-titlebar-avatar/);
  assert.match(profilePage, /className="profile-metrics"/);
  assert.match(profilePage, /<DancerFollowerCount \/>/);
  assert.match(profilePage, /<DancerGoingCount \/>/);
  assert.match(profilePage, /profile\.profileViewsToday \|\| 0/);
  assert.match(profilePage, /<dt>Views today<\/dt>/);
  assert.doesNotMatch(profilePage, /<dt>Notifications<\/dt>/);
  assert.match(profilePage, /className="profile-social-section" aria-label="External profiles"/);
  assert.match(profilePage, /<SocialLinks dancerId=\{profile\.id\} links=\{profile\.socialLinks\} showHeading=\{false\} \/>/);
  assert.doesNotMatch(profilePage, /profile\.bio|profile-bio/);

  assert.match(liveApp, /class="profile-modal-summary"/);
  assert.match(liveApp, /class="profile-modal-avatar" id="modalProfileAvatar"/);
  assert.match(liveApp, /class="profile-activity-metrics"/);
  assert.match(liveApp, /id="modalFollowerCount"/);
  assert.match(liveApp, /id="tonightInterestCount"/);
  assert.match(liveApp, /id="modalProfileViews"/);
  assert.match(liveApp, /profileViewsToday\(profile, city\)\.toLocaleString\(\)/);
});

test("profile actions expose live customer actions and keep Club Deal NFC distinct from profile sharing", () => {
  assert.match(profileActions, /\{saved\.following \? "Following" : "Follow"\}/);
  assert.match(profileActions, /\{saved\.notificationsEnabled \? "Turn notifications off" : "Notify me"\}/);
  assert.match(profileActions, /"I’m Going"/);
  assert.match(profileActions, /rideControl/);
  assert.match(profileActions, /profile-action-share-slot/);
  assert.match(profileActions, /DancerProfileActionsPreview[\s\S]*?Follow[\s\S]*?Get a Ride[\s\S]*?Share[\s\S]*?Schedule[\s\S]*?More/);
  assert.match(profileActions, /DancerProfileActionPreviewIcon[\s\S]*?type: "bell" \| "clock" \| "heart" \| "share"/);
  assert.match(profileActions, /readConfirmedNotificationCount/);
  assert.match(liveApp, /profileActionButtonMarkup\("share", "Share"\)/);
  assert.match(liveApp, /data-profile-share-menu="\$\{profile\.name\}"/);
  assert.doesNotMatch(liveApp, /data-show-profile-share-qr/);
  assert.match(liveApp, /Club Deals redeem only through a club cashier NFC tap/);
  assert.doesNotMatch(profileNavigationActions, /import QRCode from "qrcode"/);
  assert.match(
    profileNavigationActions,
    /Club\s+Deal redemption happens only through a club cashier NFC tap/,
  );
  assert.match(
    profileNavigationActions,
    /copy its secure link/,
  );
  assert.match(liveApp, /followerCountEl\.textContent = followerCount\.toLocaleString\(\)/);
  assert.match(liveApp, /followerLabelEl\.textContent = followerCount === 1 \? "Follower" : "Followers"/);
  assert.match(liveApp, /notificationCount: confirmedNotificationCount\(/);
  assert.doesNotMatch(liveApp, /id="modalNotificationCount"/);
  assert.match(liveApp, /countEl\.textContent = realCount\.toLocaleString\(\)/);
});

test("Working Now profiles retain the cashier NFC Club Deal while Upcoming stays date-and-venue only", () => {
  assert.match(profilePage, /data-working-now-indicator="">NOW<\/span>/);
  assert.doesNotMatch(profilePage, /profile-titlebar-status is-live">Working Now<\/span>/);
  assert.match(profilePage, /className=\{`profile-working-card\$\{activeDeal \? " has-club-deal" : ""\}`\}/);
  assert.match(profilePage, /className="profile-working-destination"[\s\S]*?id="profile-working-title">Working now<\/span>[\s\S]*?<small>Club<\/small>[\s\S]*?Venue-confirmed until/);
  assert.match(profilePage, /href=\{`\/venues\/\$\{encodeURIComponent\(activeShift\.venueSlug\)\}`\}/);
  assert.match(profilePage, /activeShift\?\.venueId[\s\S]*?getActiveClubDealsForVenue\(client, activeShift\.venueId\)/);
  assert.match(profilePage, /\{activeShift && activeDeal \? \([\s\S]*?className="profile-active-deal has-club-deal"/);
  assert.match(profilePage, /venueId=\{activeShift\.venueId\}[\s\S]*?venueName=\{activeShift\.venueName\}/);
  assert.match(profilePage, /className="profile-active-deal is-inactive"[\s\S]*?aria-label="Inactive Club Deal"/);
  assert.match(profilePage, /\) : activeShift \|\| !upcomingShifts\.length \? \([\s\S]*?activeShift \? "No active deal" : "No active club deal"[\s\S]*?\) : null\}/);
  assert.doesNotMatch(profilePage, /Available after check-in/);
  assert.match(profilePage, /Deals activate after a verified club check-in\./);
  assert.match(liveApp, /const showDeal = !profile\.scheduled \|\| isWorkingTonight\(profile, city\)[\s\S]*?const dealMarkup = showDeal/);
  assert.match(
    profilePage,
    /const dealSourceType = dancerAttributionEligible \? "dancer_profile" : "club_page"/,
  );
  assert.match(profilePage, /sourceType=\{dealSourceType\}/);
  assert.match(profilePage, /ctaLabel=\{activeDeals\.length > 1 \? `View all \$\{activeDeals\.length\}` : "Use at Club"\}/);
  assert.match(profilePage, /createDancerDealAttributionToken/);
  assert.match(profilePage, /attributionToken=\{dealAttributionToken\}/);
  assert.match(profilePage, /attributionTokens=\{dealAttributionTokens\}/);
  assert.doesNotMatch(profilePage, /VenueQrUnavailable/);
  const shiftsFunction = liveApp.match(
    /function shiftsMarkup\(profile, status = shiftStatus\(profile\), options = \{\}\) \{[\s\S]*?function profileActivityMetricsMarkup/,
  )?.[0] || "";
  const liveScheduleBranch = shiftsFunction.split("if (profile.scheduled)")[0];
  assert.match(liveScheduleBranch, /class="info-tile profile-schedule-card working-now-tile schedule-live"/);
  assert.match(liveScheduleBranch, /<strong>Current shift<\/strong>/);
  assert.match(liveScheduleBranch, /profile-schedule-primary modal-schedule-text tonight">Working Now<\/div>/);
  assert.match(liveScheduleBranch, /class="schedule-stack"[\s\S]*?profileVenueDestinationMarkup\(profile, \{ live: true \}\)/);
  assert.match(liveScheduleBranch, /This dancer is venue-confirmed as working here now\.<\/p>/);
  assert.doesNotMatch(liveScheduleBranch, /rideMarkup|profile-uber-ride/);
  assert.doesNotMatch(liveScheduleBranch, /profile-working-stack|profile-working-directions|Club &amp; directions/);
  assert.doesNotMatch(liveScheduleBranch, /Checked in for current shift|activeShiftStartedMarkup/);
  assert.doesNotMatch(liveScheduleBranch, /Next shift|No next shift posted|shiftNotesMarkup/);
  assert.match(liveApp, /profileDealTileMarkup\(profile\)/);
});

test("active full-profile Club Deals render a compact cashier NFC action and use one live-status color", () => {
  const activeDealMarkup = liveApp.match(
    /function profileDealTileMarkup\(profile\)[\s\S]*?function profileShareText/,
  )?.[0] || "";
  assert.match(
    liveApp,
    /#profileBackdrop \.working-now-tile > strong,[\s\S]*?#profileBackdrop \.working-now-tile \.modal-schedule-text\.tonight,[\s\S]*?color: #4dec9d !important;/,
  );
  assert.match(
    liveApp,
    /Every profile keeps the Club Deal slot\.[\s\S]*?#profileBackdrop #profileModal \.profile-club-deal-tile \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) minmax\(96px, 108px\) !important;[\s\S]*?min-height: 0 !important;[\s\S]*?padding: 8px 9px !important;/,
  );
  assert.match(activeDealMarkup, /data-profile-club-deal-config=/);
  assert.match(activeDealMarkup, /class="profile-club-deal-copy"/);
  assert.match(activeDealMarkup, /class="profile-club-deal-label">Active Club Deal<\/strong>/);
  assert.match(activeDealMarkup, /class="profile-club-deal-title">\$\{escapeHtml\(dealTitle\)\}<\/b>/);
  assert.match(activeDealMarkup, /Available tonight at \$\{escapeHtml\(venueName\)\} · Cashier NFC required/);
  assert.match(activeDealMarkup, /class="profile-club-deal-qr-button"/);
  assert.doesNotMatch(activeDealMarkup, /Working Now Club Deal|How credit works|No sign-in required/);
  assert.match(
    liveApp,
    /async function hydrateProfileClubDealQr\(root\)[\s\S]*?View all \$\{offers\.length\}[\s\S]*?Club Deals[\s\S]*?createRevenueDealPass\(config\)[\s\S]*?profile-club-deal-nfc-symbol[\s\S]*?Use at Club[\s\S]*?Cashier NFC/,
  );
  assert.match(liveApp, /qrButton\.dataset\.dealPass = encodeDealPass\(pass\)/);
  assert.doesNotMatch(liveApp, /profile-club-deal-count/);
  assert.match(
    liveApp,
    /Every profile keeps the Club Deal slot[\s\S]*?#profileBackdrop \.profile-club-deal-qr-button \{[\s\S]*?width: 108px !important;[\s\S]*?min-height: 48px !important;[\s\S]*?grid-template-columns: 22px minmax\(0, 1fr\) !important;/,
  );
  assert.match(
    liveApp,
    /Every profile keeps the Club Deal slot[\s\S]*?#profileBackdrop \.profile-club-deal-qr-button \.club-deal-qr-symbol \{[\s\S]*?width: 22px !important;[\s\S]*?height: 22px !important;/,
  );
  assert.match(
    liveApp,
    /#profileBackdrop \.profile-club-deal-action-copy strong \{[\s\S]*?font-size: 12px;[\s\S]*?font-weight: 950;/,
  );
});

test("live dancer essentials stay compact above media and clear the mobile dock", () => {
  assert.match(
    liveApp,
    /#profileBackdrop #profileModal \.modal-grid \{[\s\S]*?align-content: start !important;[\s\S]*?grid-auto-rows: max-content !important;/,
  );
  assert.match(
    liveApp,
    /Current Shift is a single destination row[\s\S]*?#profileBackdrop #profileModal \.modal-grid > \.working-now-tile \{[\s\S]*?grid-template-columns: auto minmax\(0, 1fr\) !important;[\s\S]*?gap: 9px !important;[\s\S]*?min-height: 0 !important;[\s\S]*?padding: 6px 8px !important;/,
  );
  assert.match(
    liveApp,
    /#profileBackdrop \.working-now-tile > strong,[\s\S]*?#profileBackdrop \.working-now-tile > \.profile-schedule-explanation \{\s*display: none !important;/,
  );
  assert.match(
    liveApp,
    /#profileBackdrop #profileModal \.working-now-tile::before,[\s\S]*?\.working-now-tile::after \{[\s\S]*?content: none !important;[\s\S]*?display: none !important;/,
  );
  assert.match(
    liveApp,
    /#profileBackdrop \.profile-uber-ride \{[\s\S]*?height: 44px;[\s\S]*?max-height: 44px;[\s\S]*?overflow: hidden;[\s\S]*?color: #fff !important;[\s\S]*?opacity: 1 !important;/,
  );
  assert.match(
    liveApp,
    /Available actions stay visible[\s\S]*?#profileBackdrop \.modal-actions \{[\s\S]*?grid-template-columns: repeat\(4, minmax\(0, 1fr\)\) !important;[\s\S]*?\.modal-actions\.is-no-shift \{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\) !important;/,
  );
  assert.match(
    liveApp,
    /Every profile keeps the Club Deal slot[\s\S]*?#profileBackdrop \.profile-club-deal-qr-button \{[\s\S]*?width: 108px !important;[\s\S]*?max-width: 108px !important;/,
  );
  assert.match(
    liveApp,
    /#profileBackdrop \.profile-club-deal-copy small \{[\s\S]*?color: rgba\(248, 250, 252, \.82\);[\s\S]*?font-weight: 800;/,
  );
  assert.match(
    liveApp,
    /--profile-bottom-nav-clearance: max\(132px, calc\(108px \+ env\(safe-area-inset-bottom, 0px\)\)\);[\s\S]*?#profileBackdrop \.profile-modal-media \{[\s\S]*?padding-bottom: var\(--profile-bottom-nav-clearance\) !important;/,
  );
  assert.match(
    profilePage,
    /\.public-profile-shell \{ padding: 0 12px max\(132px, calc\(108px \+ env\(safe-area-inset-bottom\)\)\); \}/,
  );
  assert.match(
    profilePage,
    /\.club-deal-card \{ grid-template-columns: minmax\(0, 1fr\) 128px; gap: 14px; padding: 14px; \}/,
  );
});

test("Working Now uses one full-width live club destination", () => {
  assert.match(
    liveApp,
    /#profileBackdrop \.profile-venue-destination\.is-live,[\s\S]*?border-color: rgba\(77, 236, 157, 0\.28\) !important;[\s\S]*?rgba\(77, 236, 157, 0\.075\)/,
  );
  assert.match(
    liveApp,
    /#profileBackdrop \.profile-venue-destination\.is-live > \.venue-dot,[\s\S]*?color: #4DEC9D !important;[\s\S]*?background: rgba\(77, 236, 157, 0\.08\) !important;/,
  );
});

test("Current Shift uses a quieter club row and secondary ride action", () => {
  assert.match(
    liveApp,
    /Current Shift is a single destination row[\s\S]*?#profileBackdrop #profileModal \.modal-grid > \.working-now-tile \{[\s\S]*?gap: 9px !important;[\s\S]*?min-height: 0 !important;[\s\S]*?padding: 6px 8px !important;/,
  );
  assert.match(
    liveApp,
    /Current Shift is a single destination row[\s\S]*?#profileBackdrop \.working-now-tile \.profile-venue-destination\.is-live \{[\s\S]*?min-height: 46px !important;[\s\S]*?border: 0 !important;[\s\S]*?background: transparent !important;/,
  );
  assert.match(
    liveApp,
    /#profileBackdrop \.profile-uber-ride \{[\s\S]*?border-color: rgba\(255, 255, 255, \.14\) !important;[\s\S]*?background: rgba\(255, 255, 255, \.045\) !important;[\s\S]*?background-image: none !important;/,
  );
  assert.match(
    uberRideStyles,
    /\.dancerProfile \{[\s\S]*?border-color: rgba\(255, 255, 255, 0\.14\);[\s\S]*?background: rgba\(255, 255, 255, 0\.045\);[\s\S]*?box-shadow: inset 0 1px 0 rgba\(255, 255, 255, 0\.045\);/,
  );
});

test("NFC actions use one recognizable phone-and-tap symbol", () => {
  assert.match(nfcIcon, /<rect x="3\.5" y="2\.5" width="10" height="19" rx="2" \/>/);
  assert.match(nfcIcon, /M15\.5 8\.2a4\.4 4\.4 0 0 1 0 7\.6/);
  assert.match(nfcIcon, /M18 5\.5a7\.5 7\.5 0 0 1 0 13/);
  assert.doesNotMatch(nfcIcon, /M15\.1 6\.2v11\.6/);
  assert.match(
    liveApp,
    /qr: '<svg viewBox="0 0 24 24"><rect x="3\.5" y="2\.5" width="10" height="19" rx="2"><\/rect>[\s\S]*?M18 5\.5a7\.5 7\.5 0 0 1 0 13/,
  );
  assert.match(
    liveApp,
    /function clubDealQrSymbolMarkup\(className = ""\)[\s\S]*?<rect x="3\.5" y="2\.5" width="10" height="19" rx="2"><\/rect>[\s\S]*?M18 5\.5a7\.5 7\.5 0 0 1 0 13/,
  );
});

test("the in-profile TV tab is dancer-only, opens full screen, and does not alter global navigation", () => {
  assert.match(
    profilePage,
    /getPublicMyDancrTvFeed\(client, \{[\s\S]*?dancerId: profile\.id/,
  );
  assert.match(profileMedia, /role="tablist"/);
  assert.match(profileMedia, /aria-label=\{`Photos, \$\{photoMedia\.length\}`\}/);
  assert.match(profileMedia, /aria-label=\{`Videos, \$\{videoMedia\.length\}`\}/);
  assert.match(profileMedia, /className="profile-media-tab-icon"[\s\S]*?<rect x="3" y="4"/);
  assert.match(profileMedia, /className="profile-media-tab-play"/);
  assert.match(profileMedia, /className="profile-media-tab-count"/);
  assert.match(profileMedia, /\{photoMedia\.length\}/);
  assert.match(profileMedia, /\{videoMedia\.length\}/);
  assert.match(profileMedia, /className="profile-media-tab-label">Photos<\/span>/);
  assert.match(profileMedia, /className="profile-media-tab-label">Videos<\/span>/);
  assert.match(profileMedia, /className=\{`profile-media-viewer is-\$\{viewer\.kind\}`\}/);
  assert.match(profileMedia, /const mediaSwipe =[\s\S]*?Math\.abs\(distanceY\)[\s\S]*?showRelativeViewerItem\(distanceY < 0 \? 1 : -1\)/);

  assert.match(liveApp, /data-profile-media-tab="photo"/);
  assert.match(liveApp, /data-profile-media-tab="video"/);
  assert.match(liveApp, /id="modalMediaPhotoTab"[\s\S]*?aria-label="Photos"[\s\S]*?class="profile-media-tab-icon"/);
  assert.match(liveApp, /id="modalMediaTvTab"[\s\S]*?aria-label="Videos"[\s\S]*?class="profile-media-tab-play"/);
  assert.match(liveApp, /id="modalMediaPhotoCount"/);
  assert.match(liveApp, /id="modalMediaTvCount"/);
  assert.match(liveApp, /function syncProfileMediaTabCounts\(photoCount = 0, videoCount = 0\)/);
  assert.match(liveApp, /syncProfileMediaTabCounts\(photoCount, videos\.length\)/);
  assert.match(
    liveApp,
    /fetch\(`\/api\/public\/tv\?city=\$\{encodeURIComponent\(citySelect\.value\)\}&dancer=\$\{encodeURIComponent\(profile\.id\)\}&limit=\$\{MAX_DANCER_PROFILE_VIDEOS\}`/,
  );
  assert.match(liveApp, /selectModalMediaThumb\(thumb, \{ syncViewer: true \}\);[\s\S]*?openPhotoViewerFromElement\(modalImage\)/);
  assert.match(liveApp, /openProfileTvViewer\(item, modalGallery\.profileTvProfileName/);

  assert.match(bottomNavigation, /Dancers/);
  assert.match(bottomNavigation, /TV/);
  assert.match(bottomNavigation, /Clubs/);
  assert.doesNotMatch(bottomNavigation, /label: "(?:Now|Trending)"/);
});
