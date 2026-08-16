import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [liveShell, aesthetic] = await Promise.all([
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/dancr-aesthetic.v1.css", import.meta.url), "utf8"),
]);

test("venue-card familiar actions are icon-only and retain accessible names", () => {
  const venueSlide = liveShell.match(/function homeVenueDiscoveryFeedSlide\([\s\S]*?(?=\n    function homeDancerGridActionsMarkup)/)?.[0] || "";
  const clubProfileIcon = liveShell.match(/clubProfile: '([^']+)'/)?.[1] || "";

  assert.match(venueSlide, /home-venue-discovery-profile-action[\s\S]*?aria-label="Open \$\{safeName\}'s full club profile"[\s\S]*?actionIconMarkup\("clubProfile"\)/);
  assert.match(clubProfileIcon, /M5 20V9l7-4 7 4v11/);
  assert.doesNotMatch(clubProfileIcon, /<circle|\.01/);
  assert.match(venueSlide, /home-dancer-grid-share[\s\S]*?aria-label="Share \$\{safeName\}'s club profile"[\s\S]*?actionIconMarkup\("share"\)/);
  assert.match(venueSlide, /data-venue-follow[\s\S]*?aria-label="\$\{followsVenue \? `Unfollow \$\{safeName\}` : `Follow \$\{safeName\}`\}"[\s\S]*?actionIconMarkup\(followsVenue \? "check" : "heart"\)/);
  assert.doesNotMatch(venueSlide, /actionButtonLabel\("profile", "View Club"\)|actionButtonLabel\("share", "Share"\)|actionButtonLabel\(followsVenue/);
});

test("venue and TV cards reserve one short visible label for Club Deals", () => {
  assert.match(liveShell, /function homeVenueDiscoveryQrMarkup\(venue\)[\s\S]*?is-available[\s\S]*?actionButtonLabel\("qr", "Deals"\)[\s\S]*?is-unavailable[\s\S]*?actionButtonLabel\("qr", "Deals"\)/);
  assert.equal((liveShell.match(/home-tv-feed-deal-count">Deals/g) || []).length, 2);
  assert.doesNotMatch(liveShell, /home-tv-feed-deal-count">Club Deals/);
});

test("venue buttons match TV glass geometry and both active NFC states keep the emerald glow", () => {
  assert.match(aesthetic, /\.home-tv-feed-profile-action,[\s\S]*?\.home-venue-discovery-profile-action \{[\s\S]*?width: 52px !important;[\s\S]*?height: 52px !important;[\s\S]*?border-radius: 999px !important;[\s\S]*?\.home-tv-feed-profile-action \.action-icon > svg,[\s\S]*?\.home-venue-discovery-profile-action \.action-icon > svg \{[\s\S]*?width: 21px !important;[\s\S]*?height: 21px !important;/);
  assert.match(aesthetic, /Venue cards use the same compact glass action rail as MyDancr TV[\s\S]*?width: 52px !important;[\s\S]*?height: 52px !important;[\s\S]*?border-radius: 999px !important;[\s\S]*?rgba\(5, 5, 10, 0\.58\)[\s\S]*?backdrop-filter: blur\(12px\)/);
  assert.match(aesthetic, /home-venue-discovery-rail-qr[\s\S]*?grid-template-rows: 21px 10px !important;[\s\S]*?border-radius: 16px !important/);
  assert.match(aesthetic, /Active cashier NFC availability keeps one identical emerald signal on TV[\s\S]*?home-venue-discovery-rail-qr\.is-available,[\s\S]*?home-tv-feed-deal-action\.is-available[\s\S]*?0 0 20px var\(--dancr-color-success-medium\)/);
});
