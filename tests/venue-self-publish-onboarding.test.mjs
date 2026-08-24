import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  signupMigration,
  reviewMigration,
  approvalPublicationMigration,
  venueService,
  venueAccess,
  publicationRoute,
  adminVenueRoute,
  adminMediaRoute,
  adminService,
  adminClient,
  publicVenuesRoute,
  publicDiscoveryRoute,
  publicService,
  dashboard,
  signupService,
  notificationDelivery,
  documentation,
] = await Promise.all([
  readFile(new URL("../supabase/migrations/202608220002_venue_self_publish_onboarding.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608240001_admin_managed_venue_page_review.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608240002_venue_approval_publishes_page.sql", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/venue.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/venue-access.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/publication/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/venues/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/venues/media/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/admin.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/public/venues/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/public/discovery/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/public.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/venue-signup-requests.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/notification-delivery.ts", import.meta.url), "utf8"),
  readFile(new URL("../docs/venue-onboarding.md", import.meta.url), "utf8"),
]);

test("approved requests still create private workspaces without public activation", () => {
  assert.match(signupMigration, /insert into public\.venues[\s\S]*?is_active,[\s\S]*?published_at[\s\S]*?false,[\s\S]*?null/);
  assert.match(signupMigration, /set owner_user_id = p_user_id, updated_at = now\(\)/);
  assert.doesNotMatch(signupMigration, /set owner_user_id = p_user_id, is_active = true/);
});

test("the database stores the complete managed page review state", () => {
  for (const status of ["admin_draft", "venue_review", "changes_requested", "venue_approved", "published"]) {
    assert.match(reviewMigration, new RegExp(`'${status}'`));
  }
  assert.match(reviewMigration, /page_reviewed_by_user_id uuid references public\.app_users/);
  assert.match(reviewMigration, /True only after the connected venue approves/);
  assert.match(approvalPublicationMigration, /approval publishes that exact reviewed version/);
  assert.match(approvalPublicationMigration, /page_review_status = 'published'/);
});

test("private venue owners keep read-only access and approval publishes the completed page", () => {
  const ownedVenueQuery = venueAccess.match(/const \{ data: ownedVenue[\s\S]*?if \(ownerError\)/)?.[0] || "";
  assert.match(ownedVenueQuery, /\.eq\("owner_user_id", userId\)/);
  assert.doesNotMatch(ownedVenueQuery, /\.eq\("is_active", true\)/);
  assert.match(venueService, /export async function reviewVenuePageForAccount/);
  assert.match(venueService, /profile\.pageReviewStatus !== "venue_review"/);
  assert.match(venueService, /is_active: approved/);
  assert.match(venueService, /published_at: approved \? reviewedAt : null/);
  assert.match(venueService, /page_review_status: approved \? "published" : "changes_requested"/);
  assert.match(venueService, /Describe the requested changes in at least 10 characters/);
  assert.doesNotMatch(venueService, /export async function publishVenueForAccount/);
  assert.match(publicationRoute, /decision === "approved" \|\| body\?\.decision === "changes_requested"/);
  assert.match(publicationRoute, /Page approved and published\. Your venue is now live on MyDancr\./);
});

test("only MyDancr can prepare and send a page before venue-controlled publication", () => {
  assert.match(adminVenueRoute, /body\?\.action === "send_for_review" \|\| body\?\.action === "publish"/);
  assert.match(adminVenueRoute, /transitionAdminManagedVenuePage/);
  assert.match(adminService, /profile\.pageReviewStatus !== "venue_approved"/);
  assert.match(adminService, /update\(\{ is_active: true, published_at: now, page_review_status: "published"/);
  assert.match(adminService, /Complete the MyDancr venue page first/);
  assert.match(adminService, /The connected venue manager must approve this exact page/);
  assert.match(adminService, /approve it to make it live/);
  assert.match(adminService, /getVenueReferralFeeState\(client, venueId\)/);
  assert.match(adminService, /The package includes \$\{deals\[0\]\?\.dealTitle/);
  assert.match(adminService, /a MyDancr fee of \$\{formatAdminFee\(referralFee\?\.feeCents \|\| 0\)\} per confirmed customer/);
  assert.match(adminService, /referralFeeCents: referralFee\?\.feeCents \|\| null/);
});

test("admins can prepare all page fields and official venue images", () => {
  assert.match(adminClient, /saveVenuePage/);
  assert.match(adminClient, /uploadVenueImage/);
  assert.match(adminClient, /Send page for venue approval/);
  assert.doesNotMatch(adminClient, /Publish approved page/);
  assert.match(adminMediaRoute, /uploadVenueLogoImageByAdmin/);
  assert.match(adminMediaRoute, /uploadVenueCoverImageByAdmin/);
  assert.match(venueService, /MyDancr manages venue page images/);
  const publicationRequirements = venueService.match(/export function getVenuePublicationState[\s\S]*?(?=export async function reviewVenuePageForAccount)/)?.[0] || "";
  assert.match(publicationRequirements, /key: "logo"/);
  assert.doesNotMatch(publicationRequirements, /key: "cover"/);
});

test("the venue dashboard presents a read-only review and approval experience", () => {
  assert.match(dashboard, /MyDancr prepares the venue page\. Your team reviews it and approves it to make it live/);
  assert.match(dashboard, /Ready to review/);
  assert.match(dashboard, /Changes in progress/);
  assert.match(dashboard, /venueCustomerPreviewHref[\s\S]*?venue_preview=1/);
  assert.match(dashboard, /Preview customer experience/);
  assert.match(dashboard, /className="venue-preview-action"/);
  assert.match(dashboard, /\.venue-preview-action \{[\s\S]*?rgba\(139,92,246,\.7\)[\s\S]*?rgba\(124,58,237,\.24\)/);
  assert.match(dashboard, /Approve & make live/);
  assert.match(dashboard, /Approve this venue information and commercial package and make the venue live on MyDancr/);
  assert.match(dashboard, /Request changes/);
  assert.match(dashboard, /Making venue live/);
  assert.match(dashboard, /Venue approval package/);
  assert.match(dashboard, /Official venue information/);
  assert.match(dashboard, /MyDancr controls how the venue card and customer page are presented/);
  assert.match(dashboard, /Club Deal and MyDancr fee/);
  assert.match(dashboard, /Customer offer/);
  assert.match(dashboard, /per confirmed customer/);
  assert.match(dashboard, /These are read-only\. Request a correction before approving/);
  assert.match(dashboard, /profile\?\.logoImageUrl/);
  assert.match(dashboard, /venue-review-logo-image/);
  assert.match(dashboard, /is-compact-logo-source/);
  assert.match(dashboard, /readOnly/);
  assert.doesNotMatch(dashboard, /Venue card preview|openVenueCardPreview|venue-card-preview-/);
  assert.doesNotMatch(dashboard, /const setupRequirements/);
  assert.doesNotMatch(dashboard, /setupCompletedCount/);
  assert.doesNotMatch(dashboard, />Publish venue</);
  assert.doesNotMatch(dashboard, /Save venue page/);
  assert.doesNotMatch(dashboard, /Save replacement logo/);
});

test("manager access email and documentation describe the managed workflow", () => {
  assert.match(signupService, /MyDancr will prepare the private venue page/);
  assert.match(notificationDelivery, /payload\.event === "venue_page_review" \|\| payload\.event === "venue_page_published"/);
  assert.match(notificationDelivery, /return `\$\{baseUrl\}\/dashboard\/venue`/);
  assert.match(documentation, /MyDancr prepares the private page/);
  assert.match(documentation, /reviews the official information and commercial package/);
  assert.match(documentation, /exact customer venue-page renderer as an optional preview/);
  assert.match(documentation, /MyDancr controls the venue-card and page presentation/);
  assert.match(documentation, /Approval publishes that exact completed page immediately/);
  assert.match(documentation, /approved review atomically marks that exact page published/);
});

test("public discovery remains restricted to administratively published venues", () => {
  for (const source of [publicVenuesRoute, publicDiscoveryRoute, publicService]) {
    assert.match(source, /\.eq\("is_active", true\)/);
    assert.match(source, /logo_storage_path/);
  }
});
