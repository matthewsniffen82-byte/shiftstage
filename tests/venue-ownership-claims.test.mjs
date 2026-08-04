import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  migration,
  claimService,
  claimRoute,
  adminRoute,
  authRoute,
  venueService,
  claimForm,
  dashboard,
  publicVenueSource,
  liveApp,
] = await Promise.all([
  readFile(new URL("../supabase/migrations/202608030001_venue_ownership_claims.sql", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/venue-claims.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/claims/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/venue-claims/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/auth/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/venue.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/venues/[slug]/claim/VenueClaimForm.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/public.ts", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
]);

test("venue ownership claims are private, rate-limited, and reviewable only by administrators", () => {
  assert.match(migration, /create table if not exists public\.venue_ownership_claims/);
  assert.match(migration, /where status = 'pending'/);
  assert.match(migration, /alter table public\.venue_ownership_claims enable row level security/);
  assert.match(migration, /venue-ownership-proofs/);
  assert.match(migration, /false,\s*10485760/s);
  assert.match(migration, /claimant_user_id = auth\.uid\(\)/);
  assert.match(migration, /public\.is_admin\(\)/);
  assert.match(migration, /create trigger enforce_available_venue_ownership_claim/);
  assert.match(migration, /for key share/);
  assert.match(claimService, /MAX_CLAIMS_PER_IP_PER_DAY = 5/);
  assert.match(claimService, /createSignedUrl\(row\.proof_storage_path, 15 \* 60\)/);
  assert.match(claimService, /email_confirmed_at/);
  assert.match(adminRoute, /requireAdmin\(client, user\.id\)/);
  assert.match(adminRoute, /body\?\.status === "approved" \|\| body\?\.status === "rejected"/);
});

test("claim approval atomically assigns the existing venue and records the decision", () => {
  assert.match(migration, /create or replace function public\.review_venue_ownership_claim/);
  assert.match(migration, /for update/g);
  assert.match(migration, /set owner_user_id = v_claim\.claimant_user_id/);
  assert.match(migration, /insert into public\.notifications/);
  assert.match(migration, /insert into public\.admin_actions/);
  assert.match(migration, /grant execute on function public\.review_venue_ownership_claim[\s\S]*to service_role/);
  assert.match(claimService, /rpc\("review_venue_ownership_claim"/);
  assert.match(claimService, /storage\.from\(PROOF_BUCKET\)\.remove/);
  assert.match(claimService, /proof_storage_path: null, proof_cleared_at/);
});

test("an existing venue is claimed instead of duplicated during venue signup", () => {
  assert.match(authRoute, /assertNewVenueAvailable\(createAdminSupabaseClient\(\), displayName\)/);
  assert.match(authRoute, /hasVenueOwnershipClaim\(admin, userId\)/);
  assert.match(venueService, /already listed\. Open its venue card and choose Claim this venue/);
  assert.doesNotMatch(venueService, /uniqueVenueSlug/);
  assert.match(claimRoute, /request\.formData\(\)/);
  assert.match(claimRoute, /formText\(formData, "attested"\) !== "on"/);
  assert.match(claimRoute, /createVenueOwnershipClaim/);
  assert.match(claimRoute, /admin\.auth\.admin\.deleteUser\(createdUserId\)/);
  assert.match(claimRoute, /emailRedirectTo/);
});

test("the public venue card, venue profile, claim form, and dashboards expose the complete workflow", () => {
  assert.match(publicVenueSource, /isClaimable: !data\.owner_user_id/);
  assert.match(liveApp, /Manage this venue\? <strong>Claim it<\/strong>/);
  assert.match(liveApp, /Represent \$\{escapeHtml\(details\.name\)\}\? <strong>Claim this venue<\/strong>/);
  assert.match(liveApp, /reviewLiveAdminVenueClaim/);
  assert.match(claimForm, /name="proofFile"/);
  assert.match(claimForm, /accept="application\/pdf,image\/jpeg,image\/png,image\/webp"/);
  assert.match(claimForm, /className=\{styles\.attestation\}/);
  assert.match(claimForm, /Submit updated proof/);
  assert.match(claimForm, /Official business email/);
  assert.match(dashboard, /function VenueClaimStatePanel/);
  assert.match(dashboard, /Venue management will unlock here after approval/);
});
