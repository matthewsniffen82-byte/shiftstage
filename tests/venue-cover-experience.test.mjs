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
  aestheticSource,
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
  readFile(new URL("../public/dancr-aesthetic.v1.css", import.meta.url), "utf8"),
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
  assert.match(venueService, /if \(finalUploaded\)[\s\S]*?removeResponsiveImage\(/);
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
  assert.match(dashboard, /after the safety check/);
  assert.match(dashboard, /accept="image\/jpeg,image\/png,image\/webp,image\/heic,image\/heif/);
  assert.match(dashboard, /profile\?\.coverImageUrl/);
});

test("approved cover media flows through discovery and the canonical live venue experience", () => {
  assert.match(discoveryRoute, /cover_image_storage_path/);
  assert.match(discoveryRoute, /responsivePublicImage\([\s\S]*?"venue-cover-images"[\s\S]*?coverImageUrl:/);
  assert.match(publicVenuesRoute, /responsivePublicImage\([\s\S]*?"venue-cover-images"[\s\S]*?coverImageUrl:/);
  assert.match(publicService, /coverImageUrl: image\?\.imageUrl/);
  assert.match(publicService, /responsivePublicImage\([\s\S]*?"venue-cover-images"/);
  assert.match(publicVenuePage, /permanentRedirect\([\s\S]*?venue=\$\{encodeURIComponent\(venue\.slug\)\}/);
  assert.match(
    venueDirectory,
    /permanentRedirect\(homeDiscoveryHref\("venues", params\.city\)\)/,
  );
  assert.doesNotMatch(venueDirectory, /cover_image_storage_path|backgroundImage:/);
  assert.match(
    homeSource,
    /function venueVisualAttrs\(venue\)[\s\S]*?const venueCoverUrl = String\(venue\.coverImageUrl \|\| ""\)\.trim\(\)[\s\S]*?customPhotoAttrs\(venueCoverUrl, venue\.coverImageSrcSet\)/,
  );
});

test("venue discovery uses approved venue covers with a branded artwork fallback", () => {
  const visualHelper =
    homeSource.match(/function venueVisualAttrs\(venue\) \{[\s\S]*?(?=\n    function venueLineupMarkup)/)?.[0] || "";
  assert.match(visualHelper, /customPhotoAttrs\(venueCoverUrl, venue\.coverImageSrcSet\)/);
  assert.doesNotMatch(visualHelper, /publicProfilePhotoUrl|featuredProfile|has-lineup-photo/);
  assert.match(
    visualHelper,
    /const hasVenueCover = Boolean\(attrs\.style\)[\s\S]*?const sourceClass = hasVenueCover \? " has-venue-cover" : " is-venue-artwork"/,
  );
  assert.match(homeSource, /home-venue-discovery-art\$\{visual\.attrs\.className\}/);
  assert.match(homeSource, /home-venue-discovery-lineup/);
  assert.match(
    homeSource,
    /#results\.venue-card-grid \.venue-card \.venue-art\.has-custom-photo[\s\S]*?var\(--custom-photo\) !important/,
  );
  assert.match(homeSource, /\.home-venue-discovery-art\.has-custom-photo[\s\S]*?var\(--custom-photo\)/);
  assert.match(homeSource, /\.home-venue-discovery-art\.is-venue-artwork \{[\s\S]*?repeating-linear-gradient\(115deg[\s\S]*?radial-gradient\(circle at 50% 36%[\s\S]*?linear-gradient\(145deg, #1d1e22/);
  assert.match(homeSource, /\.home-venue-discovery-monogram \{[\s\S]*?width: 112px;[\s\S]*?height: 112px;/);
  assert.doesNotMatch(homeSource, /\.home-venue-discovery-art\.has-lineup-photo/);
  assert.doesNotMatch(homeSource, /\.home-venue-discovery-art\.has-custom-photo\.has-venue-cover::before/);
  assert.match(homeSource, /\.home-venue-discovery-context-actions[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(homeSource, /home-venue-discovery-name-row[\s\S]*?home-venue-discovery-action-rail[\s\S]*?home-venue-discovery-profile-action[\s\S]*?data-open-venue-profile[\s\S]*?data-share-venue/);
  assert.doesNotMatch(
    homeSource.match(/function homeVenueDiscoveryFeedSlide[\s\S]*?\n    \}/)?.[0] || "",
    /home-discovery-feed-profile-button/,
  );
});

test("venue lineups show only dancers working now as compact avatar stacks", () => {
  const lineupHelper = homeSource.match(
    /function venueLineupMarkup\(venue, city, options = \{\}\) \{[\s\S]*?(?=\n    function venueCardQrMarkup)/,
  )?.[0] || "";
  const venueSlide = homeSource.match(
    /function homeVenueDiscoveryFeedSlide\(venue, index, total, city\) \{[\s\S]*?\n    \}/,
  )?.[0] || "";

  assert.match(
    lineupHelper,
    /venueDancers\(city, venue\.name\)[\s\S]*?filter\(\(profile\) => isWorkingTonight\(profile, city\)\)/,
  );
  assert.match(lineupHelper, /const visibleLimit = options\.mobile \? 3 : 4/);
  assert.match(lineupHelper, /const remaining = liveProfiles\.length - profiles\.length/);
  assert.match(lineupHelper, /aria-label="\$\{remaining\} more dancers working now">\+\$\{remaining\}/);
  assert.match(lineupHelper, /role="group" aria-label="\$\{liveLabel\}"/);
  assert.doesNotMatch(lineupHelper, /on the lineup|<strong>/);
  assert.match(venueSlide, /venueLineupMarkup\(venue, city, \{ mobile: true, profiles: workingNow \}\)/);
  assert.match(venueSlide, /home-venue-discovery-slide\$\{workingNow\.length \? " has-live-lineup" : ""\}/);
  assert.doesNotMatch(venueSlide, /workingNowMarkup|home-discovery-feed-status is-now/);
  assert.match(
    aestheticSource,
    /home-venue-discovery-art \.home-venue-discovery-logo-shell \{[\s\S]*?inset: 0;[\s\S]*?pointer-events: none;/,
  );
});

test("venue detail heroes use approved cover media with verified logo and generated sign fallbacks", () => {
  const venueDetail =
    homeSource.match(/function venueDetailPage\(venue\) \{[\s\S]*?\n    \}/)?.[0] || "";

  assert.match(venueDetail, /const visual = venueVisualAttrs\(venue\)/);
  assert.match(venueDetail, /const logoMarkup = venueLogoMarkup\(venue, "venue-detail-logo"\)/);
  assert.match(venueDetail, /venue-main-photo\$\{visual\.attrs\.className\}[\s\S]*?\$\{visual\.attrs\.style\}[\s\S]*?data-venue-visual-source="\$\{visual\.source\}"/);
  assert.match(venueDetail, /\$\{logoMarkup \|\| `[\s\S]*?venue-sign-name/);
  assert.match(
    aestheticSource,
    /\.venue-main-photo\.has-custom-photo\.has-venue-cover \{[\s\S]*?var\(--custom-photo\) !important;[\s\S]*?background-size: cover !important;/,
  );
});
