import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  migration,
  venueService,
  moderationService,
  coverRoute,
  dashboard,
  discoveryRoute,
  publicVenuesRoute,
  publicService,
  publicVenuePage,
  venueDirectory,
  homeSource,
] = await Promise.all([
  readFile(new URL("../supabase/migrations/202607300001_venue_cover_images.sql", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/venue.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/image-moderation.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/cover-image/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/public/discovery/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/public/venues/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/public.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/venues/[slug]/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/venues/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
]);

test("venue cover storage is owner-scoped and public only after publication", () => {
  assert.match(migration, /cover_image_storage_path text/);
  assert.match(migration, /cover_image_updated_at timestamptz/);
  assert.match(migration, /'venue-cover-images'[\s\S]*?true[\s\S]*?image\/jpeg[\s\S]*?image\/png[\s\S]*?image\/webp/);
  assert.match(migration, /public reads venue cover images/);
  assert.match(
    migration,
    /venue owners manage own cover images[\s\S]*?venue\.owner_user_id = auth\.uid\(\)[\s\S]*?storage\.foldername\(name\)/,
  );
});

test("venue cover uploads are validated, moderated, compensated, and owner-scoped", () => {
  assert.match(venueService, /uploadVenueCoverImage/);
  assert.match(venueService, /validateAndPrepareDancrImage\(file\)/);
  assert.match(venueService, /image\.width < 720 \|\| image\.height < 720/);
  assert.match(venueService, /MODERATION_TEMP_BUCKET/);
  assert.match(venueService, /evaluateDancrImageModeration\([\s\S]*?moderateImageWithOpenAI/);
  assert.match(venueService, /evaluation\.decision !== "approved"/);
  assert.match(venueService, /const COVER_BUCKET = "venue-cover-images"/);
  assert.match(venueService, /cover_image_storage_path: finalPath/);
  assert.match(venueService, /if \(finalUploaded\)[\s\S]*?remove\(\[finalPath\]\)/);
  assert.match(venueService, /\.eq\("owner_user_id", userId\)/);
  assert.match(moderationService, /export async function moderateImageWithOpenAI/);
});

test("only active venue accounts can publish or remove a cover image", () => {
  assert.match(coverRoute, /createRequestSupabaseContext\(request\)/);
  assert.match(coverRoute, /account\.accountState !== "active" \|\| account\.role !== "venue"/);
  assert.match(coverRoute, /uploadVenueCoverImage\([\s\S]*?createAdminSupabaseClient\(\)/);
  assert.match(coverRoute, /deleteVenueCoverImage\(createAdminSupabaseClient\(\), user\.id\)/);
  assert.match(coverRoute, /Choose a venue cover image to upload/);
});

test("the venue dashboard publishes and removes real moderated cover media", () => {
  assert.match(dashboard, /fetch\("\/api\/venue\/cover-image", \{[\s\S]*?method: "POST"/);
  assert.match(dashboard, /fetch\("\/api\/venue\/cover-image", \{[\s\S]*?method: "DELETE"/);
  assert.match(dashboard, /Checking and publishing venue image/);
  assert.match(dashboard, /Every upload is safety checked/);
  assert.match(dashboard, /accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(dashboard, /profile\?\.coverImageUrl/);
});

test("approved cover media flows through discovery, directories, and the canonical live venue profile", () => {
  assert.match(discoveryRoute, /cover_image_storage_path/);
  assert.match(discoveryRoute, /coverImageUrl:[\s\S]*?venue-cover-images/);
  assert.match(publicVenuesRoute, /coverImageUrl:[\s\S]*?venue-cover-images/);
  assert.match(publicService, /coverImageUrl: venueCoverImageUrl/);
  assert.match(publicService, /from\("venue-cover-images"\)/);
  assert.match(publicVenuePage, /permanentRedirect\([\s\S]*?venue=\$\{encodeURIComponent\(venue\.slug\)\}/);
  assert.match(venueDirectory, /cover_image_storage_path/);
  assert.match(venueDirectory, /venue\.coverImageUrl[\s\S]*?backgroundImage:/);
  assert.match(homeSource, /venue\.coverImageUrl \|\| publicProfilePhotoUrl\(featuredProfile\)/);
});

test("venue discovery prefers venue covers and falls back to approved lineup media", () => {
  assert.match(
    homeSource,
    /function venueVisualAttrs\(venue, city\)[\s\S]*?venue\.coverImageUrl \|\| publicProfilePhotoUrl\(featuredProfile\)/,
  );
  assert.match(
    homeSource,
    /function venueVisualProfiles\(city, venueName\)[\s\S]*?venueDancers\(city, venueName\)[\s\S]*?publicProfilePhotoUrl\(profile\)/,
  );
  assert.match(homeSource, /home-venue-discovery-art\$\{visual\.attrs\.className\}/);
  assert.match(homeSource, /home-venue-discovery-lineup/);
  assert.match(homeSource, /\.home-venue-discovery-art\.has-custom-photo[\s\S]*?var\(--custom-photo\)/);
  assert.match(homeSource, /\.home-venue-discovery-slide \.home-discovery-feed-actions[\s\S]*?grid-template-columns: repeat\(3/);
  assert.doesNotMatch(
    homeSource.match(/function homeVenueDiscoveryFeedSlide[\s\S]*?\n    \}/)?.[0] || "",
    /home-discovery-feed-profile-button/,
  );
});
