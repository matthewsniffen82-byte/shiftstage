import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  migration,
  venueService,
  venueAccess,
  publicationRoute,
  logoRoute,
  adminVenueRoute,
  adminCodeRoute,
  publicVenuesRoute,
  publicDiscoveryRoute,
  publicService,
  dashboard,
  liveApp,
  documentation,
] = await Promise.all([
  readFile(new URL("../supabase/migrations/202608220002_venue_self_publish_onboarding.sql", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/venue.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/venue-access.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/publication/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/logo-image/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/venues/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/venue-claim-codes/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/public/venues/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/public/discovery/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/public.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../docs/venue-onboarding.md", import.meta.url), "utf8"),
]);

test("approved venue requests create an unpublished workspace and bind redemption to that request", () => {
  assert.match(migration, /add column if not exists published_at timestamptz/);
  assert.match(migration, /insert into public\.venues[\s\S]*?is_active,[\s\S]*?published_at[\s\S]*?false,[\s\S]*?null/);
  assert.match(migration, /Existing venue claims are not supported/);
  assert.match(migration, /request\.status = 'approved'/);
  assert.match(migration, /request\.matched_venue_id = v_venue_id/);
  assert.match(migration, /request\.access_code_id = p_code_id/);
  assert.match(migration, /set owner_user_id = p_user_id, updated_at = now\(\)/);
  assert.doesNotMatch(migration, /set owner_user_id = p_user_id, is_active = true/);
});

test("private venue owners retain dashboard access before publication", () => {
  const ownedVenueQuery = venueAccess.match(/const \{ data: ownedVenue[\s\S]*?if \(ownerError\)/)?.[0] || "";
  const teamVenueQuery = venueAccess.match(/const \{ data: membership[\s\S]*?if \(membershipError\)/)?.[0] || "";
  assert.match(ownedVenueQuery, /\.eq\("owner_user_id", userId\)/);
  assert.doesNotMatch(ownedVenueQuery, /\.eq\("is_active", true\)/);
  assert.doesNotMatch(teamVenueQuery, /\.eq\("is_active", true\)/);
});

test("venue self-publication is server-authoritative and requires a complete public page", () => {
  assert.match(venueService, /export function getVenuePublicationState/);
  for (const requirement of [
    "Venue name, public address, city, and state",
    "Public phone number",
    "Opening and closing hours",
    "Venue logo",
    "Discovery cover image",
    "At least one active Club Deal",
  ]) {
    assert.match(venueService, new RegExp(requirement.replaceAll(" ", "\\s+")));
  }
  assert.match(venueService, /export async function publishVenueForAccount/);
  assert.match(venueService, /Complete venue setup before publishing/);
  assert.match(venueService, /update\(\{ is_active: true, published_at: publishedAt \}\)/);
  assert.match(publicationRoute, /requireVenueAccess\(admin, user\.id, "manage_profile"\)/);
  assert.match(publicationRoute, /publishVenueForAccount\(admin, user\.id\)/);
  assert.match(publicationRoute, /profile\.venue_published/);
});

test("venue managers can upload a moderated official logo for public cards", () => {
  assert.match(migration, /'venue-logo-images'/);
  assert.match(migration, /public reads venue logo images/);
  assert.match(venueService, /validateAndPrepareDancrImage\(file\)/);
  assert.match(venueService, /moderateImageWithOpenAI\(client, tempPath\)/);
  assert.match(venueService, /uploadResponsiveImage\([\s\S]*?watermark: false/);
  assert.match(logoRoute, /requireVenueAccess\(admin, user\.id, "manage_profile"\)/g);
  assert.match(logoRoute, /uploadVenueLogoImage/);
  assert.match(logoRoute, /deleteVenueLogoImage/);
});

test("manual venue creation, claiming, and admin publication remain closed", () => {
  assert.match(adminVenueRoute, /New venues must submit the venue request form/);
  assert.match(adminVenueRoute, /status: 410/);
  assert.match(adminVenueRoute, /body\?\.isActive === true/);
  assert.match(adminVenueRoute, /Only the connected venue manager can publish/);
  assert.match(adminCodeRoute, /Venue access codes are created only when an approved venue request/);
  assert.match(adminCodeRoute, /status: 410/);
});

test("only self-published venues reach public discovery and use their uploaded logo", () => {
  for (const source of [publicVenuesRoute, publicDiscoveryRoute, publicService]) {
    assert.match(source, /\.eq\("is_active", true\)/);
    assert.match(source, /logo_storage_path/);
    assert.match(source, /venue-logo-images/);
  }
});

test("the venue dashboard clearly presents private setup, preview, and explicit publishing", () => {
  assert.match(dashboard, /Complete, preview, and publish the guest-facing venue page from this private workspace/);
  assert.match(dashboard, /Nothing appears publicly until you publish/);
  assert.match(dashboard, /Preview private venue page/);
  assert.match(dashboard, /venuePreviewHref[\s\S]*?\/\?city=\$\{encodeURIComponent\(venueCity\)\}&venue=\$\{encodeURIComponent\(venueSlug\)\}&venue_preview=1/);
  assert.doesNotMatch(dashboard, /function VenueDraftPreview/);
  assert.match(dashboard, /Publish venue/);
  assert.match(dashboard, /Upload logo/);
  assert.match(liveApp, /async function applyVenueDashboardPreview[\s\S]*?getAuthenticatedJson\("\/api\/venue\/dashboard"\)/);
  assert.match(liveApp, /venue\.isDashboardPreview[\s\S]*?This is the exact guest page customers will see after you publish/);
  assert.match(liveApp, /venue\.id && !venue\.isDashboardPreview/);
  assert.match(documentation, /request-first venue onboarding model/);
  assert.match(documentation, /private venue workspace and one-time venue signup code/);
  assert.match(documentation, /Venue accounts receive access only to their own venue dashboard; they never receive MyDancr administrator access/);
});

test("each venue publishing requirement opens the control that completes it", () => {
  assert.match(dashboard, /function openVenueSetupRequirement[\s\S]*?section\.open = true[\s\S]*?target\?\.focus/);
  for (const target of [
    "venue-profile-name",
    "venue-profile-phone",
    "venue-profile-opensAt",
    "venue-logo-upload",
    "venue-cover-upload",
    "venue-deal-primary-action",
  ]) {
    assert.match(dashboard, new RegExp(`targetId: "${target}"`));
  }
  assert.match(dashboard, /id=\{`venue-profile-\$\{key\}`\}/);
  assert.match(dashboard, /id="venue-logo-upload"/);
  assert.match(dashboard, /id="venue-cover-upload"/);
  assert.match(dashboard, /id="venue-deal-primary-action"/);
  assert.match(dashboard, /onClick=\{\(event\) => openVenueSetupRequirement\(event, requirement\.sectionId, requirement\.targetId\)\}/);
});

test("venue identity and publication actions share the role-aware refresh boundary", () => {
  const venueIdentityActions = dashboard.match(/async function saveProfile[\s\S]*?function openVenueSection/)?.[0] || "";
  for (const path of [
    "/api/venue/profile",
    "/api/venue/cover-image",
    "/api/venue/logo-image",
    "/api/venue/publication",
  ]) {
    assert.match(venueIdentityActions, new RegExp(`requestDashboardJson\\("${path.replaceAll("/", "\\/")}"`));
  }
  assert.equal((venueIdentityActions.match(/expectedRole: "venue"/g) || []).length, 6);
  assert.doesNotMatch(venueIdentityActions, /authorization: `Bearer/);
  assert.doesNotMatch(venueIdentityActions, /fetch\("\/api\/venue\/(?:profile|cover-image|logo-image|publication)/);
});
