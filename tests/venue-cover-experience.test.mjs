import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  migration,
  venueService,
  moderationService,
  adminMediaRoute,
  adminClient,
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
  readFile(new URL("../app/api/admin/venues/media/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8"),
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

test("admin-managed venue cover uploads are validated, moderated, and compensated", () => {
  assert.match(venueService, /uploadVenueCoverImageByAdmin/);
  assert.match(venueService, /validateAndPrepareDancrImage\(file\)/);
  assert.match(venueService, /image\.width < 720 \|\| image\.height < 720/);
  assert.match(venueService, /MODERATION_TEMP_BUCKET/);
  assert.match(venueService, /evaluateDancrImageModeration\([\s\S]*?moderateImageWithOpenAI/);
  assert.match(venueService, /evaluation\.decision !== "approved"/);
  assert.match(venueService, /const COVER_BUCKET = "venue-cover-images"/);
  assert.match(venueService, /cover_image_storage_path: finalPath/);
  assert.match(venueService, /if \(finalUploaded\)[\s\S]*?removeResponsiveImage\(/);
  assert.match(venueService, /getVenueById\(client, venueId\)/);
  assert.match(moderationService, /export async function moderateImageWithOpenAI/);
});

test("only a MyDancr administrator can publish or remove a cover image", () => {
  assert.match(adminMediaRoute, /createRequestSupabaseContext\(request\)/);
  assert.match(adminMediaRoute, /requireAdmin/);
  assert.match(adminMediaRoute, /uploadVenueCoverImageByAdmin/);
  assert.match(adminMediaRoute, /deleteVenueCoverImageByAdmin/);
});

test("the admin prepares media and the venue reviews facts with an optional canonical customer preview", () => {
  assert.match(adminClient, /Checking and uploading venue \$\{kind\}/);
  assert.match(adminClient, /accept="image\/\*,\.heic,\.heif"/);
  assert.match(adminClient, /removeVenueImage/);
  assert.match(dashboard, /venueCustomerPreviewHref[\s\S]*?venue_preview=1/);
  assert.match(dashboard, /Preview customer experience/);
  assert.doesNotMatch(dashboard, /Venue review copy · managed by MyDancr|venue-cover-panel/);
  assert.match(dashboard, /className="venue-review-package"/);
  assert.match(dashboard, /Official venue information/);
  assert.match(dashboard, /profile\?\.logoImageUrl/);
  assert.doesNotMatch(dashboard, /Venue card preview|openVenueCardPreview|venue-card-preview-/);
  assert.doesNotMatch(dashboard, /profile\?\.coverImageUrl/);
});

test("approved cover media remains available to the canonical live venue experience", () => {
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

test("venue cards use only official logos or branded monograms", () => {
  const visualHelper =
    homeSource.match(/function venueVisualAttrs\(venue\) \{[\s\S]*?(?=\n    function venueLineupMarkup)/)?.[0] || "";
  const venueCardRenderer =
    homeSource.match(/function venueCard\(venue\) \{[\s\S]*?(?=\n    function venueDancers)/)?.[0] || "";
  const venueSlide =
    homeSource.match(/function homeVenueDiscoveryFeedSlide\(venue, index, total, city\) \{[\s\S]*?(?=\n    function homeDancerGridActionsMarkup)/)?.[0] || "";

  assert.match(visualHelper, /customPhotoAttrs\(venueCoverUrl, venue\.coverImageSrcSet\)/);
  assert.doesNotMatch(visualHelper, /publicProfilePhotoUrl|featuredProfile|has-lineup-photo/);
  assert.match(
    visualHelper,
    /const hasVenueCover = Boolean\(attrs\.style\)[\s\S]*?const sourceClass = hasVenueCover \? " has-venue-cover" : " is-venue-artwork"/,
  );
  assert.match(venueCardRenderer, /venueLogoMarkup\(venue, "venue-card-logo"\)/);
  assert.match(venueCardRenderer, /class="venue-art is-venue-logo-artwork\$\{logoMarkup \? " has-venue-logo" : ""\}"/);
  assert.match(venueCardRenderer, /logoMarkup \|\| `<span class="venue-card-mark">/);
  assert.doesNotMatch(venueCardRenderer, /venueVisualAttrs|coverImageUrl|customPhotoAttrs|visual\.attrs/);
  assert.match(venueSlide, /venueLogoMarkup\(venue, "home-venue-discovery-logo"\)/);
  assert.match(venueSlide, /class="home-venue-discovery-art is-venue-logo-artwork\$\{logoMarkup \? " has-venue-logo" : ""\}"/);
  assert.match(venueSlide, /logoMarkup \|\| `<span class="home-venue-discovery-monogram">/);
  assert.doesNotMatch(venueSlide, /venueVisualAttrs|coverImageUrl|customPhotoAttrs|visual\.attrs/);
  assert.match(homeSource, /home-venue-discovery-lineup/);
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
  assert.match(lineupHelper, /const visibleLimit = options\.mobile \? 2 : 4/);
  assert.match(lineupHelper, /const remaining = liveProfiles\.length - profiles\.length/);
  assert.match(lineupHelper, /aria-label="\$\{remaining\} more dancers working now">\+\$\{remaining\}/);
  assert.match(lineupHelper, /role="group" aria-label="\$\{liveLabel\}"/);
  assert.doesNotMatch(lineupHelper, /on the lineup/);
  assert.match(lineupHelper, /<strong>\$\{liveProfiles\.length\}<\/strong><span>NOW<\/span>/);
  assert.match(venueSlide, /venueLineupMarkup\(venue, city, \{ mobile: true, profiles: workingNow \}\)/);
  assert.match(venueSlide, /home-venue-discovery-slide\$\{workingNow\.length \? " has-live-lineup" : ""\}/);
  assert.doesNotMatch(venueSlide, /workingNowMarkup|home-discovery-feed-status is-now/);
  assert.match(
    aestheticSource,
    /home-venue-discovery-art \.home-venue-discovery-logo-shell \{[\s\S]*?top: 5%;[\s\S]*?right: 72px;[\s\S]*?left: 18px;[\s\S]*?height: 50%;[\s\S]*?pointer-events: none;/,
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
