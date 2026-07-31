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

test("full dancer profiles use an Instagram-familiar identity and activity header without a bio", () => {
  assert.match(profilePage, /className="profile-titlebar"/);
  assert.match(profilePage, /className=\{`profile-avatar/);
  assert.match(profilePage, /className="profile-metrics"/);
  assert.match(profilePage, /<DancerFollowerCount \/>/);
  assert.match(profilePage, /<DancerNotificationCount \/>/);
  assert.match(profilePage, /<DancerGoingCount \/>/);
  assert.match(profilePage, /aria-label="Approved social links"/);
  assert.doesNotMatch(profilePage, /profile\.bio|profile-bio/);

  assert.match(liveApp, /class="profile-modal-summary"/);
  assert.match(liveApp, /class="profile-modal-avatar" id="modalProfileAvatar"/);
  assert.match(liveApp, /class="profile-activity-metrics"/);
  assert.match(liveApp, /id="modalFollowerCount"/);
  assert.match(liveApp, /id="modalNotificationCount"/);
  assert.match(liveApp, /id="tonightInterestCount"/);
});

test("profile actions expose live customer actions and nest profile QR inside Share Profile", () => {
  assert.match(profileActions, /\{saved\.following \? "Following" : "Follow"\}/);
  assert.match(profileActions, /\{saved\.notificationsEnabled \? "Notifications on" : "Notify me"\}/);
  assert.match(profileActions, /"I’m Going"/);
  assert.match(profileActions, /profile-action-share-slot/);
  assert.match(profileActions, /readConfirmedNotificationCount/);
  assert.match(liveApp, /profileActionButtonMarkup\("share", "Share Profile"\)/);
  assert.match(liveApp, /data-profile-share-menu="\$\{profile\.name\}"/);
  assert.match(liveApp, /data-show-profile-share-qr/);
  assert.match(liveApp, /Show profile-sharing QR/);
  assert.match(liveApp, /This is not a Club Deal and cannot be redeemed at a venue/);
  assert.match(profileNavigationActions, /import QRCode from "qrcode"/);
  assert.match(profileNavigationActions, /Show profile-sharing QR/);
  assert.match(profileNavigationActions, /Profile-sharing QR/);
  assert.match(
    profileNavigationActions,
    /This is not a Club Deal and cannot be redeemed at a venue/,
  );
  assert.match(liveApp, /followerCountEl\.textContent = followerNumber/);
  assert.match(liveApp, /notificationCountEl\.textContent = notificationNumber/);
  assert.match(liveApp, /countEl\.textContent = realCount\.toLocaleString\(\)/);
});

test("Working Now profiles promote the checked-in venue, directions, and Club QR", () => {
  assert.match(profilePage, /className="profile-working-card"/);
  assert.match(profilePage, /Verified check-in · until/);
  assert.match(profilePage, /Venue &amp; directions/);
  assert.match(profilePage, /sourceType="dancer_profile"/);
  assert.match(profilePage, /ctaLabel="Get Club Deal"/);
  assert.match(profilePage, /createDancerDealAttributionToken/);
  assert.match(profilePage, /attributionToken=\{dealAttributionToken\}/);
  assert.match(profilePage, /<VenueQrUnavailable venueName=\{activeShift\.venueName\} \/>/);
  assert.match(liveApp, /class="info-tile working-now-tile"/);
  assert.match(liveApp, /class="profile-working-directions"/);
  assert.match(liveApp, /profileDealTileMarkup\(profile\)/);
});

test("the in-profile TV tab is dancer-only, opens full screen, and does not alter global navigation", () => {
  assert.match(
    profilePage,
    /getPublicMyDancrTvFeed\(client, \{[\s\S]*?dancerId: profile\.id/,
  );
  assert.match(profileMedia, /role="tablist"/);
  assert.match(profileMedia, /Photos <span>\{photoMedia\.length\}<\/span>/);
  assert.match(profileMedia, /TV <span>\{videoMedia\.length\}<\/span>/);
  assert.match(profileMedia, /className="profile-media-viewer"/);
  assert.match(profileMedia, /showRelativeViewerItem\(distanceX < 0 \? 1 : -1\)/);

  assert.match(liveApp, /data-profile-media-tab="photo"/);
  assert.match(liveApp, /data-profile-media-tab="video"/);
  assert.match(
    liveApp,
    /fetch\(`\/api\/public\/tv\?city=\$\{encodeURIComponent\(citySelect\.value\)\}&dancer=\$\{encodeURIComponent\(profile\.id\)\}&limit=4`/,
  );
  assert.match(liveApp, /openPhotoViewerFromElement\(modalImage\)/);
  assert.match(liveApp, /openProfileTvViewer\(item, modalGallery\.profileTvProfileName/);

  assert.match(bottomNavigation, /Now/);
  assert.match(bottomNavigation, /Dancers/);
  assert.match(bottomNavigation, /TV/);
  assert.match(bottomNavigation, /Venues/);
  assert.match(bottomNavigation, /Trending/);
});
