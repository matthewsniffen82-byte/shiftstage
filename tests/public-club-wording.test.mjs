import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [liveShell, navigation, dancerProfile, clubDeal, clubActions, nfcTap] = await Promise.all([
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/components/GlobalMobileBottomNav.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/ClubDealCard.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/venues/[slug]/VenueProfileActions.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/nfc/[token]/NfcTapClient.tsx", import.meta.url), "utf8"),
]);

test("customer discovery consistently presents venues as clubs", () => {
  assert.match(liveShell, /data-tab="venues"[^>]*data-tab-label="Clubs"/);
  assert.match(liveShell, /id="venueSelectLabel"[^>]*>Club</);
  assert.match(liveShell, /id="venueSelectButtonText">All clubs</);
  assert.match(liveShell, /<span>Club search<\/span><strong id="venueSelectDialogTitle">Choose a club<\/strong>/);
  assert.match(liveShell, /venues: `Clubs in \$\{city\}`/);
  assert.match(liveShell, /No clubs match your current filters/);
  assert.match(liveShell, /venue-card-kicker">MyDancr club</);
  assert.match(liveShell, /Follow this club for updates/);
  assert.match(liveShell, /Your saved dancers and clubs are ready/);
  assert.match(liveShell, /Choose which dancer and club alerts/);
  assert.match(navigation, /id: "venues",[\s\S]*?label: "Clubs"/);

  assert.doesNotMatch(liveShell, /data-tab-label="Venues"/);
  assert.doesNotMatch(liveShell, /venues: `Venues in \$\{city\}`/);
  assert.doesNotMatch(liveShell, /No venues match your current filters/);
  assert.doesNotMatch(liveShell, /Your saved dancers and venues are ready/);
  assert.doesNotMatch(liveShell, /venue-card-kicker">Mydancr venue/i);
});

test("customer profile and Club Deal actions use club language", () => {
  assert.match(dancerProfile, /Club &amp; directions/);
  assert.match(liveShell, /home-venue-discovery-profile-action[\s\S]*?aria-label="Open \$\{safeName\}'s full club profile"[\s\S]*?actionIconMarkup\("venue"\)/);
  assert.match(clubActions, /Follow club/);
  assert.match(clubActions, /Club alerts/);
  assert.match(clubDeal, /Continue to club booking/);
  assert.match(clubDeal, /official MyDancr NFC sticker/);
  assert.match(nfcTap, /Verified club NFC/);
  assert.match(nfcTap, /Confirm Working Now/);

  assert.doesNotMatch(dancerProfile, /View venue/);
  assert.doesNotMatch(clubActions, /Follow venue/);
  assert.doesNotMatch(clubDeal, /Continue to venue booking/);
});
