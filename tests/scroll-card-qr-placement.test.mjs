import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const homeSource = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");

test("dancer and venue cards keep QR directly below Profile in the right-side rail", () => {
  const dancerActions = homeSource.match(
    /function homeDancerGridActionsMarkup\(profile, city\) \{[\s\S]*?(?=\n    function homeDancerGridCard)/,
  )?.[0] || "";
  const venueSlide = homeSource.match(
    /function homeVenueDiscoveryFeedSlide\(venue, index, total, city\) \{[\s\S]*?(?=\n    function homeDancerGridActionsMarkup)/,
  )?.[0] || "";
  const venueNameRow = venueSlide.match(
    /<div class="home-venue-discovery-name-row">[\s\S]*?<\/div>/,
  )?.[0] || "";

  assert.match(
    dancerActions,
    /data-grid-profile-action="\$\{profileReference\}"[\s\S]*?\$\{homeDancerGridQrMarkup\(profile\)\}[\s\S]*?data-native-share="\$\{profileValue\}"/,
  );
  assert.match(
    venueSlide,
    /home-venue-discovery-name-row[\s\S]*?home-venue-discovery-action-rail[\s\S]*?home-venue-discovery-profile-action[\s\S]*?data-open-venue-profile="\$\{venueValue\}"[\s\S]*?actionButtonLabel\("profile", "Profile"\)[\s\S]*?\$\{railQrMarkup\}[\s\S]*?data-share-venue="\$\{venueValue\}"/,
  );
  assert.doesNotMatch(venueNameRow, /data-open-venue-profile|home-venue-discovery-profile-cta/);
  assert.match(homeSource, /data-card-action-slot="qr"/);
  assert.match(
    homeSource,
    /function homeDancerGridQrMarkup\(profile\)[\s\S]*?is-unavailable is-\$\{state\.key\}[\s\S]*?data-card-qr-label[\s\S]*?data-card-qr-message[\s\S]*?aria-disabled="true"/,
  );
  assert.doesNotMatch(homeSource, /\.home-dancer-grid-qr \{[\s\S]*?position: absolute/);
  assert.match(
    homeSource,
    /const unavailableCardQr = event\.target\.closest\('\[data-card-action-slot="qr"\]\[data-card-qr-label\]'\)[\s\S]*?event\.preventDefault\(\)[\s\S]*?event\.stopPropagation\(\)[\s\S]*?showCardQrNotice/,
  );
});

test("TV keeps the real live-deal QR inside the right-side icon rail only", () => {
  const tvActions = homeSource.match(
    /function createHomeTvFeedActions\(item, slide\) \{[\s\S]*?(?=\n    function createHomeTvFeedSoundButton)/,
  )?.[0] || "";

  assert.match(
    tvActions,
    /const hasLiveDeal = item\?\.shift\?\.isActive === true &&[\s\S]*?item\?\.venue\?\.id && item\?\.deal\?\.id && item\?\.dealAttributionToken/,
  );
  assert.match(
    tvActions,
    /if \(hasLiveDeal\)[\s\S]*?home-tv-feed-deal-action home-card-qr-rail-action[\s\S]*?"Club Deal QR"[\s\S]*?deal\.dataset\.cardActionSlot = "qr"/,
  );
  assert.match(
    tvActions,
    /actions\.append\(applause\);\s*if \(deal\) actions\.appendChild\(deal\);\s*actions\.append\(share, follow\);\s*actions\.append\(report, reportMenu\);/,
  );
  assert.doesNotMatch(tvActions, /home-tv-feed-action-menu|home-tv-feed-menu-action/);
  assert.doesNotMatch(tvActions, /else\s*\{[\s\S]*?cardActionSlot = "qr"/);
});

test("QR placement styling shares one fixed venue shape without moving the rail or navigation", () => {
  const qrStyle = homeSource.match(
    /\/\* Shared scrolling-card QR rail shell keeps every deal state the same shape\. \*\/[\s\S]*?(?=\n        @media \(max-width: 679px\))/,
  )?.[0] || "";

  assert.ok(qrStyle, "expected shared scrolling-card QR rail styling");
  assert.match(
    qrStyle,
    /\.home-venue-discovery-action-rail \.home-venue-discovery-rail-qr \{[\s\S]*?width: 48px !important;[\s\S]*?height: 52px !important;[\s\S]*?min-height: 52px !important;[\s\S]*?max-height: 52px !important;[\s\S]*?border-radius: 16px !important;/,
  );
  assert.doesNotMatch(
    qrStyle,
    /(?:^|\s)(?:margin|position|display|grid|flex|top|right|bottom|left|overflow|scroll-snap):/,
  );
  assert.doesNotMatch(qrStyle, /#discoveryTabs|home-bottom-tv|home-nav/);
});
