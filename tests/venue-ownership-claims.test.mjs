import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  migration,
  claimCodeMigration,
  signupCodeMigration,
  claimService,
  claimRoute,
  adminRoute,
  adminCodeRoute,
  authRoute,
  venueService,
  claimForm,
  dashboard,
  publicVenueSource,
  claimPage,
  liveApp,
] = await Promise.all([
  readFile(new URL("../supabase/migrations/202608030001_venue_ownership_claims.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608030002_venue_claim_codes.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608030003_venue_signup_code_redemption.sql", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/venue-claims.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/claims/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/venue-claims/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/venue-claim-codes/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/auth/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/venue.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/venues/[slug]/claim/VenueClaimForm.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/public.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/venues/[slug]/claim/page.tsx", import.meta.url), "utf8"),
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

test("an existing venue is connected directly instead of duplicated during venue signup", () => {
  assert.match(authRoute, /resolveVenueSignupCode\(admin, input\.venueCode\)/);
  assert.match(authRoute, /redeemVenueSignupCode\(admin, \{/);
  assert.doesNotMatch(authRoute, /assertNewVenueAvailable|ensureVenueForAccount/);
  assert.doesNotMatch(venueService, /uniqueVenueSlug/);
  assert.match(claimRoute, /status: 410/);
  assert.match(claimRoute, /redeemed directly during venue sign up/);
  assert.match(claimPage, /redirect\("\/\?venueSignup=1"\)/);
});

test("venue claims require a one-time venue-specific code issued by an administrator", () => {
  assert.match(claimCodeMigration, /create table if not exists public\.venue_claim_codes/);
  assert.match(claimCodeMigration, /code_digest text not null unique/);
  assert.match(claimCodeMigration, /venue_claim_codes_one_unconsumed_idx/);
  assert.match(claimCodeMigration, /alter table public\.venue_claim_codes enable row level security/);
  assert.match(claimCodeMigration, /add column if not exists claim_code_id uuid/);
  assert.match(claimCodeMigration, /new\.claim_code_id is null/);
  assert.match(claimCodeMigration, /v_claim_code\.venue_id <> new\.venue_id/);
  assert.match(claimCodeMigration, /set used_at = now\(\), used_by = new\.claimant_user_id/);
  assert.match(claimCodeMigration, /create or replace function public\.issue_venue_claim_code/);
  assert.match(claimCodeMigration, /create or replace function public\.revoke_venue_claim_code/);
  assert.match(claimCodeMigration, /grant execute on function public\.issue_venue_claim_code[\s\S]*to service_role/);
  assert.match(claimService, /randomBytes\(10\)/);
  assert.match(claimService, /createHmac\("sha256", secret\)/);
  assert.match(claimService, /resolveVenueClaimCode/);
  assert.match(claimService, /resolveVenueSignupCode/);
  assert.match(claimService, /redeemVenueSignupCode/);
  assert.match(claimService, /claim_code_id: claimCodeId/);
  assert.match(signupCodeMigration, /create or replace function public\.redeem_venue_signup_code/);
  assert.match(signupCodeMigration, /from public\.venues[\s\S]*?for update/);
  assert.match(signupCodeMigration, /from public\.venue_claim_codes[\s\S]*?for update/);
  assert.match(signupCodeMigration, /set owner_user_id = p_user_id/);
  assert.match(signupCodeMigration, /set used_at = now\(\), used_by = p_user_id/);
  assert.match(signupCodeMigration, /grant execute on function public\.redeem_venue_signup_code[\s\S]*to service_role/);
  assert.match(adminCodeRoute, /requireAdmin\(client, user\.id\)/);
  assert.match(adminCodeRoute, /action === "issue" \|\| body\?\.action === "revoke"/);
});

test("venue access stays in signup and never appears as a claim action on public venue pages", () => {
  assert.doesNotMatch(publicVenueSource, /isClaimable/);
  assert.doesNotMatch(liveApp, /Have a venue code|Claim this venue|venue-card-claim|venue-detail-claim/);
  assert.match(liveApp, /id="venueSignupCode"/);
  assert.match(liveApp, /It can connect only the venue assigned to that code/);
  assert.match(liveApp, /handleVenueAccessDeepLink/);
  assert.match(liveApp, /reviewLiveAdminVenueClaim/);
  assert.match(liveApp, /issueLiveAdminVenueClaimCode/);
  assert.match(liveApp, /revokeLiveAdminVenueClaimCode/);
  assert.match(liveApp, /Venue access code copied/);
  assert.match(claimForm, /name="claimCode"/);
  assert.match(claimForm, /autoComplete="one-time-code"/);
  assert.match(claimForm, /name="proofFile"/);
  assert.match(claimForm, /accept="application\/pdf,image\/jpeg,image\/png,image\/webp"/);
  assert.match(claimForm, /className=\{styles\.attestation\}/);
  assert.match(claimForm, /Submit updated proof/);
  assert.match(claimForm, /Official business email/);
  assert.match(dashboard, /function VenueClaimStatePanel/);
  assert.match(dashboard, /Venue management will unlock here after approval/);
});
