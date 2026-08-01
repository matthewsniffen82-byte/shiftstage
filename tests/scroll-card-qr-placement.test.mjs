import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const homeSource = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");

test("dancer and venue scrolling cards keep QR directly below Profile", () => {
  const dancerActions = homeSource.match(
    /function homeDancerGridActionsMarkup\(profile, city\) \{[\s\S]*?(?=\n    function homeDancerGridCard)/,
  )?.[0] || "";
  const venueSlide = homeSource.match(
    /function homeVenueDiscoveryFeedSlide\(venue, index, total, city\) \{[\s\S]*?(?=\n    function homeDancerGridActionsMarkup)/,
  )?.[0] || "";

  assert.match(
    dancerActions,
    /data-grid-profile-action="\$\{profileValue\}"[\s\S]*?\$\{homeDancerGridQrMarkup\(profile\)\}[\s\S]*?data-native-share="\$\{profileValue\}"/,
  );
  assert.match(
    venueSlide,
    /data-open-venue-profile="\$\{venueValue\}"[\s\S]*?\$\{railQrMarkup\}[\s\S]*?data-share-venue="\$\{venueValue\}"/,
  );
  assert.match(homeSource, /data-card-action-slot="qr"/);
  assert.match(
    homeSource,
    /function homeDancerGridQrMarkup\(profile\)[\s\S]*?is-unavailable is-\$\{state\.key\}[\s\S]*?data-card-qr-label[\s\S]*?data-card-qr-message[\s\S]*?aria-disabled="true"/,
  );
  assert.doesNotMatch(homeSource, /\.home-dancer-grid-qr \{[\s\S]*?position: absolute/);
  assert.match(
    homeSource,
    /const unavailableCardQr = event\.target\.closest\('\[data-card-action-slot="qr"\]\[aria-disabled="true"\]'\)[\s\S]*?event\.preventDefault\(\)[\s\S]*?event\.stopPropagation\(\)[\s\S]*?showToast/,
  );
});

test("TV keeps the real live-deal QR inside the compact actions menu only", () => {
  const tvActions = homeSource.match(
    /function createHomeTvFeedActions\(item, slide, video\) \{[\s\S]*?(?=\n    function createHomeTvFeedSoundButton)/,
  )?.[0] || "";

  assert.match(
    tvActions,
    /const hasLiveDeal = item\?\.shift\?\.isActive === true &&[\s\S]*?item\?\.venue\?\.id && item\?\.deal\?\.id && item\?\.dealAttributionToken/,
  );
  assert.match(
    tvActions,
    /if \(hasLiveDeal\)[\s\S]*?home-tv-feed-primary-action home-tv-feed-deal-action home-card-qr-rail-action[\s\S]*?"Club Deal QR"[\s\S]*?deal\.dataset\.cardActionSlot = "qr"/,
  );
  assert.match(
    tvActions,
    /menu\.append\(applause, share, follow, fullscreen\);\s*if \(deal\) menu\.appendChild\(deal\);\s*menu\.append\(report, reportMenu\);/,
  );
  assert.doesNotMatch(tvActions, /else\s*\{[\s\S]*?cardActionSlot = "qr"/);
});

test("QR placement styling preserves rail geometry, scrolling, and bottom navigation", () => {
  const qrStyle = homeSource.match(
    /\/\* Shared scrolling-card QR rail state; rail geometry remains unchanged\. \*\/[\s\S]*?(?=\n        @media \(max-width: 679px\))/,
  )?.[0] || "";

  assert.ok(qrStyle, "expected shared scrolling-card QR rail styling");
  assert.doesNotMatch(
    qrStyle,
    /(?:^|\s)(?:width|height|min-height|max-height|padding|margin|position|display|grid|flex|top|right|bottom|left|overflow|scroll-snap):/,
  );
  assert.doesNotMatch(qrStyle, /#discoveryTabs|home-bottom-tv|home-nav/);
});
