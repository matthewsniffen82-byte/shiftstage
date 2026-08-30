import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  venuesRoute,
  discoveryRoute,
  dancersRoute,
  venueProfileRoute,
  dancerProfileRoute,
  publicService,
  publicTypes,
  dealsService,
  scannerClient,
] = await Promise.all([
  readFile(new URL("../app/api/public/venues/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/public/discovery/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/public/dancers/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/public/venues/[slug]/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/public/dancers/[slug]/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/public.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/types.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/deals.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/deals/redeem/[token]/RedeemDealClient.tsx", import.meta.url), "utf8"),
]);

test("public venue lists expose location and branding without contact or retired QR internals", () => {
  for (const source of [venuesRoute, discoveryRoute]) {
    assert.match(source, /name, city, state, address, latitude, longitude/);
    assert.match(source, /cover_image_storage_path, logo_storage_path/);
    assert.doesNotMatch(source, /\bphone\b|\bwebsite\b|qr_code_storage_path|qr_code_label|qrCodeUrl|qrCodeLabel/);
    assert.match(source, /const MAX_PUBLIC_VENUES = 200/);
    assert.match(source, /\.limit\(MAX_PUBLIC_VENUES\)/);
  }
});

test("public dancer and venue mappers omit ownership, precise proximity, and QR storage data", () => {
  assert.match(publicService, /stage_name/);
  assert.match(publicService, /dancer_photos\(id, storage_path, is_primary, review_status, sort_order, like_count\)/);
  assert.match(publicService, /social_links\(id, platform, handle, url, is_active\)/);
  assert.match(publicService, /address, latitude, longitude/);
  assert.doesNotMatch(
    publicService,
    /owner_user_id|checkin_distance_feet|qr_code_storage_path|qr_code_label|venueQrCodeUrl|venueQrCodeLabel|venueQrCodeUrlFromRow/,
  );
  assert.doesNotMatch(publicTypes, /checkinDistanceFeet|venueQrCodeUrl|venueQrCodeLabel/);

  assert.match(publicService, /const PUBLIC_DANCER_DIRECTORY_LIMIT = 200/);
  assert.ok(
    (publicService.match(/\.limit\(PUBLIC_DANCER_DIRECTORY_LIMIT\)/g) || []).length >= 4,
    "both current and legacy directory queries must be capped",
  );
  assert.match(publicService, /const PUBLIC_PROFILE_MEDIA_LIMIT = 50/);
  assert.match(publicService, /\.limit\(PUBLIC_PROFILE_MEDIA_LIMIT\)/);
  assert.match(publicService, /const PUBLIC_PROFILE_SHIFT_LIMIT = 50/);
  assert.match(publicService, /\.limit\(PUBLIC_PROFILE_SHIFT_LIMIT/);
  assert.match(venueProfileRoute, /const MAX_PUBLIC_UPCOMING_SHIFTS = 200/);
  assert.match(venueProfileRoute, /\.limit\(MAX_PUBLIC_UPCOMING_SHIFTS\)/);
});

test("public list inputs and public profile identifiers are bounded before database access", () => {
  for (const source of [venuesRoute, discoveryRoute, dancersRoute]) {
    assert.match(source, /\.trim\(\)/);
    assert.match(source, /!city \|\| city\.length > 80/);
    assert.match(source, /status: 400/);
  }

  for (const source of [venueProfileRoute, dancerProfileRoute]) {
    assert.match(source, /const PUBLIC_SLUG_PATTERN = \^?\/\^\[a-z0-9\]/);
    assert.match(source, /slug\.length > 100/);
    assert.match(source, /status: 404/);
  }
  assert.match(dancersRoute, /requestedScope === "tonight" \? "tonight" : "all"/);
});

test("the retired scanner response contains customer copy but no attribution or lifecycle internals", () => {
  const scannerFunction = dealsService.slice(
    dealsService.indexOf("export async function getRedemptionForScanner"),
    dealsService.indexOf("export async function getDancerDealMetrics"),
  );
  const scannerSelect = scannerFunction.match(/\.select\(\s*`([\s\S]*?)`\s*,?\s*\)/)?.[1] || "";
  const normalizer = dealsService.slice(
    dealsService.indexOf("function normalizeScannerRedemption"),
    dealsService.indexOf("export function readIssuedDealSnapshot"),
  );

  assert.match(scannerSelect, /status[\s\S]*source_type[\s\S]*expires_at/);
  assert.match(scannerSelect, /venues\(name, city, state\)/);
  assert.match(scannerSelect, /club_deals\(deal_title, deal_description, deal_terms, is_active, offer_type, booking_url\)/);
  assert.doesNotMatch(
    scannerSelect,
    /\bid\b|redemption_token|dancer_id|shift_id|venue_id|generated_at|redeemed_at|saved_at|shared_at|first_scanned_at|confirmed_at|redeemed_by_club_user|payout_|currency/,
  );
  assert.match(scannerSelect, /\baudit\b/, "the server may read the immutable issued-deal snapshot");
  assert.match(normalizer, /status: row\.status/);
  assert.match(normalizer, /venue: venue \? \{ name: venue\.name, city: venue\.city, state: venue\.state \}/);
  assert.match(normalizer, /dealTitle:[\s\S]*dealDescription:[\s\S]*dealTerms:/);
  assert.doesNotMatch(
    normalizer,
    /redemptionToken|dancerId|shiftId|venueId|generatedAt|redeemedAt|savedAt|sharedAt|firstScannedAt|confirmedAt|redeemedByClubUser|referralCommissionCents|currency|audit\s*:/,
  );
  assert.doesNotMatch(scannerClient, /Referral commission|referralCommissionCents|formatMoney/);
});
