import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const liveApp = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");

test("dancer and venue cards keep the Club Deal action in the established right-side rail", () => {
  assert.match(liveApp, /home-dancer-grid-action-rail/);
  assert.match(liveApp, /home-venue-discovery-action-rail/);
  assert.match(liveApp, /home-card-qr-rail-action/);
  assert.match(liveApp, /home-venue-discovery-rail-qr/);
  assert.match(liveApp, /Cashier NFC redemption/);
});

test("TV keeps the live Club Deal NFC action inside its established card actions", () => {
  const tvDeal = liveApp.match(/function homeDiscoveryFeedLiveQrMarkup\(profile[\s\S]*?(?=\n    function homeDancerGridQrMarkup)/)?.[0] || "";
  assert.match(tvDeal, /data-feed-live-qr/);
  assert.match(tvDeal, /triggerAttribute/);
  assert.match(liveApp, /tap the cashier NFC sticker/i);
});

test("the NFC symbol replaces generated QR imagery without moving the rail or navigation", () => {
  assert.match(liveApp, /function clubDealQrSymbolMarkup/);
  assert.match(liveApp, /aria-label="NFC tap"/);
  assert.match(liveApp, /Shared scrolling-card QR rail shell/);
  assert.doesNotMatch(liveApp, /<img src="\$\{pass\.qrImageUrl\}"/);
});
