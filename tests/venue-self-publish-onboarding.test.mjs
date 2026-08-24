import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  signupMigration,
  reviewMigration,
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
  documentation,
] = await Promise.all([
  readFile(new URL("../supabase/migrations/202608220002_venue_self_publish_onboarding.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608240001_admin_managed_venue_page_review.sql", import.meta.url), "utf8"),
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
});

test("private venue owners keep access but can only approve or request corrections", () => {
  const ownedVenueQuery = venueAccess.match(/const \{ data: ownedVenue[\s\S]*?if \(ownerError\)/)?.[0] || "";
  assert.match(ownedVenueQuery, /\.eq\("owner_user_id", userId\)/);
  assert.doesNotMatch(ownedVenueQuery, /\.eq\("is_active", true\)/);
  assert.match(venueService, /export async function reviewVenuePageForAccount/);
  assert.match(venueService, /profile\.pageReviewStatus !== "venue_review"/);
  assert.match(venueService, /"venue_approved" : "changes_requested"/);
  assert.match(venueService, /Describe the requested changes in at least 10 characters/);
  assert.doesNotMatch(venueService, /export async function publishVenueForAccount/);
  assert.match(publicationRoute, /decision === "approved" \|\| body\?\.decision === "changes_requested"/);
  assert.doesNotMatch(publicationRoute, /is_active: true/);
});

test("only MyDancr can send review and publish after venue approval", () => {
  assert.match(adminVenueRoute, /body\?\.action === "send_for_review" \|\| body\?\.action === "publish"/);
  assert.match(adminVenueRoute, /transitionAdminManagedVenuePage/);
  assert.match(adminService, /profile\.pageReviewStatus !== "venue_approved"/);
  assert.match(adminService, /update\(\{ is_active: true, published_at: now, page_review_status: "published"/);
  assert.match(adminService, /Complete the MyDancr venue page first/);
  assert.match(adminService, /The connected venue manager must approve this exact page/);
});

test("admins can prepare all page fields and official venue images", () => {
  assert.match(adminClient, /saveVenuePage/);
  assert.match(adminClient, /uploadVenueImage/);
  assert.match(adminClient, /Send page for venue approval/);
  assert.match(adminClient, /Publish approved page/);
  assert.match(adminMediaRoute, /uploadVenueLogoImageByAdmin/);
  assert.match(adminMediaRoute, /uploadVenueCoverImageByAdmin/);
  assert.match(venueService, /MyDancr manages venue page images/);
});

test("the venue dashboard presents a read-only review and approval experience", () => {
  assert.match(dashboard, /MyDancr prepares the venue page\. Your team reviews it before MyDancr publishes it/);
  assert.match(dashboard, /Ready to review/);
  assert.match(dashboard, /Changes in progress/);
  assert.match(dashboard, /canPreviewVenuePage \? <button type="button" onClick=\{openVenueCardPreview\}>Preview venue<\/button>/);
  assert.match(dashboard, /Approve page/);
  assert.match(dashboard, /Request changes/);
  assert.match(dashboard, /Your approval is recorded\. A MyDancr administrator will complete the final check/);
  assert.match(dashboard, /readOnly/);
  assert.doesNotMatch(dashboard, /const setupRequirements/);
  assert.doesNotMatch(dashboard, /setupCompletedCount/);
  assert.doesNotMatch(dashboard, />Publish venue</);
  assert.doesNotMatch(dashboard, /Save venue page/);
  assert.doesNotMatch(dashboard, /Save replacement logo/);
});

test("manager access email and documentation describe the managed workflow", () => {
  assert.match(signupService, /MyDancr will prepare the private venue page/);
  assert.match(documentation, /MyDancr prepares the private page/);
  assert.match(documentation, /venue previews the page and either approves/);
  assert.match(documentation, /Venue approval records consent but never activates a listing/);
});

test("public discovery remains restricted to administratively published venues", () => {
  for (const source of [publicVenuesRoute, publicDiscoveryRoute, publicService]) {
    assert.match(source, /\.eq\("is_active", true\)/);
    assert.match(source, /logo_storage_path/);
  }
});
