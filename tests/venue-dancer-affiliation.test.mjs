import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [baseMigration, firstTapMigration, lifecycleMigration, restoreMigration, service, dancerRoute, venueRoute, checkInRoute, deals, dashboard, dancerPanel, venuePanel] = await Promise.all([
  readFile(new URL("../supabase/migrations/202608050001_dancer_venue_affiliations.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608110002_dressing_room_nfc_checkins.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608110005_nfc_shift_lifecycle.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608090001_restore_public_dancer_media.sql", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/venue-affiliations.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/venue-verification/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/dancer-verifications/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/shifts/check-in/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/deals.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DancerNfcPanel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/VenueNfcTagPanel.tsx", import.meta.url), "utf8"),
]);

test("the dressing-room transaction creates or restores the active venue affiliation", () => {
  assert.match(firstTapMigration, /insert into public\.venue_dancer_affiliations/);
  assert.match(firstTapMigration, /on conflict \(venue_id, dancer_id\) do update/);
  assert.match(firstTapMigration, /status = 'active'/);
  assert.match(firstTapMigration, /revoked_at = null/);
  assert.match(firstTapMigration, /'method', 'dressing_room_nfc'/);
  assert.match(firstTapMigration, /owner\.role = 'venue'/);
  assert.match(firstTapMigration, /owner\.account_state = 'active'/);
});

test("manager QR approval endpoints are retired but both sides retain roster removal", () => {
  assert.match(dancerRoute, /code: "dressing_room_nfc_required"/);
  assert.match(dancerRoute, /}, 410\)/);
  assert.doesNotMatch(dancerRoute, /QRCode\.toDataURL|issueDancerVenueVerification/);
  assert.match(venueRoute, /code: "dressing_room_nfc_required"/);
  assert.match(venueRoute, /}, 410\)/);
  assert.doesNotMatch(venueRoute, /approveDancerVenueVerification/);
  assert.match(dancerRoute, /revokeDancerVenueAffiliation/);
  assert.match(venueRoute, /revokeDancerVenueAffiliation/);
});

test("dancer and venue dashboards show the official NFC workflow", () => {
  assert.match(dashboard, /<DancerNfcPanel initialAffiliations=\{affiliations\}/);
  assert.match(dashboard, /<DancerShiftManager \/>/);
  assert.match(dashboard, /<VenueNfcTagPanel/);
  assert.doesNotMatch(dashboard, /<DancerVenueVerificationPanel|<VenueDancerVerificationPanel/);
  assert.match(dancerPanel, /approved dressing-room tap added this venue/);
  assert.match(dancerPanel, /six-hour Working Now session/);
  assert.match(dancerPanel, /six-hour cooldown/);
  assert.match(venuePanel, /no separate manager approval is needed/);
  assert.match(venuePanel, /NFC-authorized dancer roster/);
  assert.match(venuePanel, /MyDancr programs and supplies every sticker/);
});

test("venue roster affiliations expose responsive approved dancer avatars", () => {
  assert.match(service, /responsivePublicImage\(client, DANCER_PHOTO_BUCKET, dancer\?\.avatar_storage_path\)/);
  assert.match(service, /avatarUrl: avatar\?\.imageUrl \|\| null/);
  assert.match(service, /avatarSrcSet: avatar\?\.imageSrcSet \|\| null/);
  assert.match(venuePanel, /sizes="48px"/);
});

test("active affiliation remains required for NFC activation and attributed deals", () => {
  assert.match(baseMigration, /enforce_verified_venue_affiliation_for_checkin/);
  assert.match(baseMigration, /affiliation\.status = 'active'/);
  assert.match(lifecycleMigration, /create or replace function public\.activate_dancer_shift_from_nfc/);
  assert.match(lifecycleMigration, /affiliation\.status = 'active'/);
  assert.match(lifecycleMigration, /An active venue affiliation is required/);
  assert.match(deals, /dancerHasActiveVenueAffiliation/);
  assert.match(checkInRoute, /code: "nfc_tap_required"/);
});

test("revocation remains audited and ends matching live shifts", () => {
  assert.match(baseMigration, /venue_dancer_affiliation_events/);
  assert.match(baseMigration, /checked_out_at = v_now/);
  assert.match(service, /DANCER_VENUE_AFFILIATION_REVOKED/);
  const restoredRevocation = restoreMigration.match(/create or replace function public\.revoke_dancer_venue_affiliation[\s\S]*?\n\$\$;/)?.[0] || "";
  assert.doesNotMatch(restoredRevocation, /is_public = false/);
  assert.match(restoredRevocation, /'profileDeactivated', false/);
});
