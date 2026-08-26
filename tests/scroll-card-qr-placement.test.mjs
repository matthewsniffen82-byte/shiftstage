import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const liveApp = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");
const aesthetic = await readFile(new URL("../public/dancr-aesthetic.v1.css", import.meta.url), "utf8");

test("dancer cards keep their rail while venue Deals join the compact horizontal action row", () => {
  assert.match(liveApp, /home-dancer-grid-action-rail/);
  assert.match(liveApp, /home-venue-discovery-action-rail/);
  assert.match(liveApp, /home-card-qr-rail-action/);
  assert.match(liveApp, /home-venue-discovery-rail-qr/);
  assert.match(liveApp, /Tap your phone at the cashier/);
  assert.match(aesthetic, /Final mobile Clubs geometry[\s\S]*?grid-template-columns: repeat\(4, minmax\(0, 1fr\)\) !important;/);
});

test("TV keeps the live Club Deal tap action inside its established card actions", () => {
  const tvDeal = liveApp.match(/function homeDiscoveryFeedLiveQrMarkup\(profile[\s\S]*?(?=\n    function homeDancerGridQrMarkup)/)?.[0] || "";
  assert.match(tvDeal, /data-feed-live-qr/);
  assert.match(tvDeal, /triggerAttribute/);
  assert.match(liveApp, /tap the cashier sticker/i);
});

test("the NFC symbol replaces generated QR imagery without changing action behavior or navigation", () => {
  assert.match(liveApp, /function clubDealQrSymbolMarkup/);
  assert.match(liveApp, /aria-label="Tap cashier sticker"/);
  assert.match(liveApp, /Shared scrolling-card QR rail shell/);
  assert.doesNotMatch(liveApp, /<img src="\$\{pass\.qrImageUrl\}"/);
});
