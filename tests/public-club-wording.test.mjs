import assert from "node:assert/strict";
import { readFile } from "./helpers/dashboard-test-fs-promises.mjs";
import test from "node:test";

const [liveShell, navigation, dancerProfile, clubDeal, nfcTap] = await Promise.all([
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/components/GlobalMobileBottomNav.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/ClubDealCard.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/nfc/[token]/NfcTapClient.tsx", import.meta.url), "utf8"),
]);

test("customer discovery consistently presents venues as clubs", () => {
  assert.match(liveShell, /data-tab="venues"[^>]*data-tab-label="Clubs"/);
  assert.match(liveShell, /id="venueSelectLabel"[^>]*>Club</);
  assert.match(liveShell, /id="venueSelectButtonText">All clubs</);
  assert.match(liveShell, /<h2 id="venueSelectDialogTitle">Choose a club<\/h2>/);
  assert.match(liveShell, /venues: `Clubs \$\{locationPhrase\}`/);
  assert.match(liveShell, /No clubs \$\{locationPhrase\} yet/);
  assert.match(liveShell, /No clubs match these filters/);
  assert.match(liveShell, /aria-label="Club actions"/);
  assert.match(liveShell, /data-account-action="venue-follow"[\s\S]*?aria-label="\$\{followsVenue/);
  assert.match(liveShell, /Your saved dancers and clubs are ready/);
  assert.match(liveShell, /Choose your updates and email or push delivery in Alerts/);
  assert.match(navigation, /id: "venues",[\s\S]*?label: "Clubs"/);

  assert.doesNotMatch(liveShell, /data-tab-label="Venues"/);
  assert.doesNotMatch(liveShell, /venues: `Venues in \$\{city\}`/);
  assert.doesNotMatch(liveShell, /No venues match your current filters/);
  assert.doesNotMatch(liveShell, /Your saved dancers and venues are ready/);
  assert.doesNotMatch(liveShell, /venue-card-kicker">Mydancr venue/i);
});

test("customer profile and Club Deal actions use club language", () => {
  assert.match(dancerProfile, /className="profile-working-destination"[\s\S]*?activeShift\.venueName/);
  assert.match(liveShell, /home-venue-discovery-profile-action[\s\S]*?aria-label="Open \$\{safeName\}'s full club profile"[\s\S]*?actionButtonLabel\("clubProfile", "Club Page"\)/);
  assert.match(liveShell, /Following" : "Follow"/);
  assert.doesNotMatch(liveShell, /saved to Favorite Clubs in your dashboard\. Club alerts on\./);
  assert.match(clubDeal, /Use this deal/);
  assert.match(clubDeal, /Show your admission pass to door staff for scanning/);
  assert.match(nfcTap, /Verified club tap/);
  assert.match(nfcTap, /Confirm my choice & check in/);

  assert.doesNotMatch(dancerProfile, /View venue/);
  assert.doesNotMatch(liveShell, /Following venue" : "Follow venue"/);
  assert.doesNotMatch(clubDeal, /Continue to venue booking/);
  assert.doesNotMatch(clubDeal, /Continue to club booking/);
});
