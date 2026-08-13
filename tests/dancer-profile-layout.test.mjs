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
  ]);

test("full dancer profiles use a compact identity and honest public activity header without a bio", () => {
  assert.match(profilePage, /className="profile-titlebar profile-identity-summary"/);
  assert.match(profilePage, /className=\{`profile-titlebar-avatar/);
  assert.match(profilePage, /className="profile-metrics"/);
  assert.match(profilePage, /<DancerFollowerCount \/>/);
  assert.match(profilePage, /<DancerGoingCount \/>/);
  assert.match(profilePage, /profile\.profileViewsToday \|\| 0/);
  assert.match(profilePage, /<dt>Views today<\/dt>/);
  assert.doesNotMatch(profilePage, /<dt>Notifications<\/dt>/);
  assert.match(profilePage, /aria-labelledby="profile-social-heading"/);
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
  assert.match(profileActions, /\{saved\.notificationsEnabled \? "Notifications on" : "Notify me"\}/);
  assert.match(profileActions, /"I’m Going"/);
  assert.match(profileActions, /profile-action-share-slot/);
  assert.match(profileActions, /readConfirmedNotificationCount/);
  assert.match(liveApp, /profileActionButtonMarkup\("share", "Share Profile"\)/);
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
  assert.match(liveApp, /followerCountEl\.textContent = followerNumber/);
  assert.match(liveApp, /notificationCount: confirmedNotificationCount\(/);
  assert.doesNotMatch(liveApp, /id="modalNotificationCount"/);
  assert.match(liveApp, /countEl\.textContent = realCount\.toLocaleString\(\)/);
});

test("Working Now profiles promote the checked-in venue, directions, and cashier NFC Club Deal", () => {
  assert.match(profilePage, /data-working-now-indicator="">NOW<\/span>/);
  assert.doesNotMatch(profilePage, /profile-titlebar-status is-live">Working Now<\/span>/);
  assert.match(profilePage, /className=\{`profile-working-card\$\{activeDeal \? " has-club-deal" : ""\}`\}/);
  assert.match(profilePage, /<span className="profile-live-state">Schedule<\/span>[\s\S]*?<h2 id="profile-working-title">Working Now<\/h2>/);
  assert.match(profilePage, /Dressing-room NFC verified · active until/);
  assert.match(profilePage, /directionsHref=\{directionsHref\}/);
  assert.match(profilePage, /venueHref=\{venueHref\}/);
  assert.match(profilePage, /className=\{`profile-active-deal\$\{activeDeal \? " has-club-deal" : ""\}`\}/);
  assert.match(profilePage, /sourceType="dancer_profile"/);
  assert.match(profilePage, /ctaLabel="Club Deals"/);
  assert.match(profilePage, /createDancerDealAttributionToken/);
  assert.match(profilePage, /attributionToken=\{dealAttributionToken\}/);
  assert.match(profilePage, /attributionTokens=\{dealAttributionTokens\}/);
  assert.match(profilePage, /<VenueQrUnavailable venueName=\{activeShift\.venueName\} \/>/);
  const shiftsFunction = liveApp.match(
    /function shiftsMarkup\(profile, status = shiftStatus\(profile\), options = \{\}\) \{[\s\S]*?function profileActivityMetricsMarkup/,
  )?.[0] || "";
  const liveScheduleBranch = shiftsFunction.split("if (profile.scheduled)")[0];
  assert.match(liveScheduleBranch, /class="info-tile profile-schedule-card working-now-tile schedule-live"/);
  assert.match(liveScheduleBranch, /<strong>Schedule<\/strong>/);
  assert.match(liveScheduleBranch, /profile-schedule-primary modal-schedule-text tonight">Working Now<\/div>/);
  assert.match(liveScheduleBranch, /class="meta profile-working-stack"/);
  assert.doesNotMatch(liveScheduleBranch, /Club &amp; directions|profile-working-directions|rideMarkup/);
  assert.doesNotMatch(liveScheduleBranch, /Checked in for current shift|activeShiftStartedMarkup/);
  assert.doesNotMatch(liveScheduleBranch, /Next shift|No next shift posted|shiftNotesMarkup/);
  assert.match(liveApp, /className: "action-btn secondary profile-directions-action"/);
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
    /Compact the live profile essentials[\s\S]*?#profileBackdrop \.profile-club-deal-tile \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) 128px !important;[\s\S]*?padding: 14px 15px !important;/,
  );
  assert.match(activeDealMarkup, /data-profile-club-deal-config=/);
  assert.match(activeDealMarkup, /class="profile-club-deal-copy"/);
  assert.match(activeDealMarkup, /class="profile-club-deal-label">Club Deal<\/strong>/);
  assert.match(activeDealMarkup, /<small>Select here · Tap cashier NFC at the club<\/small>/);
  assert.match(activeDealMarkup, /class="profile-club-deal-qr-button"/);
  assert.doesNotMatch(activeDealMarkup, /Working Now Club Deal|How credit works|No sign-in required/);
  assert.match(
    liveApp,
    /async function hydrateProfileClubDealQr\(root\)[\s\S]*?createRevenueDealPass\(config\)[\s\S]*?profile-club-deal-nfc-symbol/,
  );
  assert.match(liveApp, /qrButton\.dataset\.dealPass = encodeDealPass\(pass\)/);
});

test("live dancer essentials stay compact, scannable, and tight against the mobile dock", () => {
  assert.match(
    liveApp,
    /#profileBackdrop \.modal-grid > \.working-now-tile \{[\s\S]*?gap: 4px 10px !important;[\s\S]*?padding: 9px 12px !important;/,
  );
  assert.match(
    liveApp,
    /#profileBackdrop \.working-now-tile > \.meta \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto !important;[\s\S]*?column-gap: 10px !important;[\s\S]*?row-gap: 4px !important;[\s\S]*?padding-top: 4px !important;/,
  );
  assert.match(
    liveApp,
    /#profileBackdrop \.profile-uber-ride \{[\s\S]*?height: 44px;[\s\S]*?max-height: 44px;[\s\S]*?overflow: hidden;[\s\S]*?color: #fff !important;[\s\S]*?opacity: 1 !important;/,
  );
  assert.match(
    liveApp,
    /#profileBackdrop \.profile-working-directions \{[\s\S]*?grid-column: 2 !important;[\s\S]*?grid-row: 1 !important;[\s\S]*?width: auto !important;[\s\S]*?min-height: 44px !important;[\s\S]*?justify-content: flex-end !important;/,
  );
  assert.match(
    liveApp,
    /#profileBackdrop \.working-now-tile \.profile-uber-ride \{[\s\S]*?grid-column: 1 \/ -1 !important;[\s\S]*?grid-row: 2 !important;/,
  );
  assert.match(
    liveApp,
    /#profileBackdrop \.profile-club-deal-qr-button \{[\s\S]*?width: 128px !important;[\s\S]*?min-width: 128px !important;[\s\S]*?max-width: 128px !important;/,
  );
  assert.match(
    liveApp,
    /#profileBackdrop \.profile-club-deal-copy small \{[\s\S]*?color: rgba\(248, 250, 252, \.82\);[\s\S]*?font-weight: 800;/,
  );
  assert.match(
    liveApp,
    /@media \(max-width: 720px\) \{[\s\S]*?#profileBackdrop \.profile-modal \{[\s\S]*?--profile-report-clearance: max\(16px, env\(safe-area-inset-bottom, 0px\)\);[\s\S]*?#profileBackdrop \.modal-grid \{[\s\S]*?padding-bottom: var\(--profile-report-clearance\) !important;/,
  );
  assert.match(
    profilePage,
    /\.public-profile-shell \{ padding: 0 12px; \}/,
  );
  assert.match(
    profilePage,
    /\.club-deal-card \{ grid-template-columns: minmax\(0, 1fr\) 128px; gap: 14px; padding: 14px; \}/,
  );
});

test("Working Now profile details remain tappable without faint inner boxes", () => {
  assert.match(
    liveApp,
    /#profileBackdrop \.working-now-tile > strong,[\s\S]*?#profileBackdrop \.working-now-tile \.detail-line,[\s\S]*?#profileBackdrop \.working-now-tile \.venue-inline-link,[\s\S]*?#profileBackdrop \.profile-working-directions \{[\s\S]*?border: 0 !important;[\s\S]*?background: transparent !important;[\s\S]*?box-shadow: none !important;/,
  );
  assert.match(
    liveApp,
    /#profileBackdrop \.working-now-tile \.venue-inline-link,[\s\S]*?#profileBackdrop \.profile-working-directions \{[\s\S]*?min-height: 44px !important;[\s\S]*?display: inline-flex !important;/,
  );
});

test("the in-profile TV tab is dancer-only, opens full screen, and does not alter global navigation", () => {
  assert.match(
    profilePage,
    /getPublicMyDancrTvFeed\(client, \{[\s\S]*?dancerId: profile\.id/,
  );
  assert.match(profileMedia, /role="tablist"/);
  assert.match(profileMedia, /aria-label=\{`Photos, \$\{photoMedia\.length\}`\}/);
  assert.match(profileMedia, /aria-label=\{`TV videos, \$\{videoMedia\.length\}`\}/);
  assert.match(profileMedia, /className="profile-media-tab-icon"[\s\S]*?<rect x="3" y="4"/);
  assert.match(profileMedia, /className="profile-media-tab-play"/);
  assert.doesNotMatch(profileMedia, /Photos <span>|TV <span>/);
  assert.match(profileMedia, /className="profile-media-viewer"/);
  assert.match(profileMedia, /showRelativeViewerItem\(distanceX < 0 \? 1 : -1\)/);

  assert.match(liveApp, /data-profile-media-tab="photo"/);
  assert.match(liveApp, /data-profile-media-tab="video"/);
  assert.match(liveApp, /id="modalMediaPhotoTab"[\s\S]*?aria-label="Photos"[\s\S]*?class="profile-media-tab-icon"/);
  assert.match(liveApp, /id="modalMediaTvTab"[\s\S]*?aria-label="TV"[\s\S]*?class="profile-media-tab-play"/);
  assert.match(
    liveApp,
    /fetch\(`\/api\/public\/tv\?city=\$\{encodeURIComponent\(citySelect\.value\)\}&dancer=\$\{encodeURIComponent\(profile\.id\)\}&limit=4`/,
  );
  assert.doesNotMatch(liveApp, /openPhotoViewerFromElement\(modalImage\)/);
  assert.match(liveApp, /openProfileTvViewer\(item, modalGallery\.profileTvProfileName/);

  assert.match(bottomNavigation, /Dancers/);
  assert.match(bottomNavigation, /TV/);
  assert.match(bottomNavigation, /Clubs/);
  assert.doesNotMatch(bottomNavigation, /label: "(?:Now|Trending)"/);
});
