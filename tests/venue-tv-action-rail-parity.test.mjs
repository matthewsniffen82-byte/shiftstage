import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [liveShell, aesthetic] = await Promise.all([
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/dancr-aesthetic.v1.css", import.meta.url), "utf8"),
]);

test("venue-card secondary actions use compact labels and retain accessible names", () => {
  const venueSlide = liveShell.match(/function homeVenueDiscoveryFeedSlide\([\s\S]*?(?=\n    function homeDancerGridActionsMarkup)/)?.[0] || "";
  const clubProfileIcon = liveShell.match(/clubProfile: '([^']+)'/)?.[1] || "";

  assert.match(venueSlide, /home-venue-discovery-profile-action[\s\S]*?aria-label="Open \$\{safeName\}'s full club profile"[\s\S]*?actionButtonLabel\("clubProfile", "Club Page"\)/);
  assert.match(clubProfileIcon, /M5 20V9l7-4 7 4v11/);
  assert.doesNotMatch(clubProfileIcon, /<circle|\.01/);
  assert.match(venueSlide, /home-dancer-grid-share[\s\S]*?aria-label="Share \$\{safeName\}'s club profile"[\s\S]*?actionButtonLabel\("share", "Share"\)/);
  assert.match(venueSlide, /data-venue-follow[\s\S]*?aria-label="\$\{followsVenue \? `Unfollow \$\{safeName\}` : `Follow \$\{safeName\}`\}"[\s\S]*?actionButtonLabel\(followsVenue \? "check" : "heart", followsVenue \? "Saved" : "Favorite"\)/);
  assert.doesNotMatch(venueSlide, /actionIconMarkup\("clubProfile"\)|actionIconMarkup\("share"\)/);
});

test("venue cards retain Deal availability states while TV renders Deals only when active", () => {
  assert.match(liveShell, /function homeVenueDiscoveryQrMarkup\(venue\)[\s\S]*?is-available[\s\S]*?actionButtonLabel\("qr", "Deals"\)[\s\S]*?is-unavailable[\s\S]*?actionButtonLabel\("qr", "Deals"\)/);
  assert.equal((liveShell.match(/home-tv-feed-deal-count">Deals/g) || []).length, 1);
  assert.match(liveShell, /if \(dealState\.key === "available"\)/);
  assert.doesNotMatch(liveShell, /home-tv-feed-deal-count">Club Deals/);
});

test("mobile venue actions use a horizontal discovery row while TV keeps compact glass geometry", () => {
  assert.match(aesthetic, /\.home-tv-feed-profile-action \{[\s\S]*?width: 46px !important;[\s\S]*?height: 46px !important;[\s\S]*?border-radius: 999px !important;[\s\S]*?\.home-tv-feed-profile-action \.action-icon > svg \{[\s\S]*?width: 19px !important;[\s\S]*?height: 19px !important;/);
  assert.match(aesthetic, /\.home-venue-discovery-profile-action \{[\s\S]*?width: 52px !important;[\s\S]*?height: 52px !important;[\s\S]*?border-radius: 999px !important;[\s\S]*?\.home-venue-discovery-profile-action \.action-icon > svg \{[\s\S]*?width: 21px !important;[\s\S]*?height: 21px !important;/);
  assert.match(aesthetic, /Final mobile Clubs geometry[\s\S]*?grid-template-columns: repeat\(4, minmax\(0, 1fr\)\) !important;[\s\S]*?\.home-venue-discovery-action-rail \.feed-card-action,[\s\S]*?width: 100% !important;[\s\S]*?height: 47px !important;[\s\S]*?border-radius: 0 !important/);
  assert.match(aesthetic, /Final mobile Clubs geometry[\s\S]*?\.home-venue-discovery-rail-qr\.is-available \{[\s\S]*?var\(--dancr-color-success\)/);
  assert.match(aesthetic, /Active cashier NFC availability keeps one identical emerald signal on TV[\s\S]*?home-venue-discovery-rail-qr\.is-available,[\s\S]*?home-tv-feed-deal-action\.is-available[\s\S]*?0 0 20px var\(--dancr-color-success-medium\)/);
});
