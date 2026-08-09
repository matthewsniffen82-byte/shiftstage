import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const [
  legacyUploadRoute,
  adminBackend,
  adminUi,
  liveApp,
  legacyIdentityMigration,
  removalMigration,
  legacyPurge,
  signupRoute,
  callbackRoute,
  profileRoute,
  publicProfiles,
  accountUi,
  venueMigration,
  restoreMigration,
  profileApproval,
  dancerBackend,
  environmentExample,
] = await Promise.all([
  readFile(new URL("../app/api/dancer/verification-documents/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/admin.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202607280003_verifymycontent_identity_tokenization.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608080003_remove_verifymycontent_integration.sql", import.meta.url), "utf8"),
  readFile(new URL("../scripts/purge-legacy-identity-data.mjs", import.meta.url), "utf8"),
  readFile(new URL("../app/api/auth/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/auth/callback/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/profile/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/public.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/account/AccountClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608080002_venue_gated_dancer_profiles.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608090001_restore_public_dancer_media.sql", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/profile-approval.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/dancer.ts", import.meta.url), "utf8"),
  readFile(new URL("../.env.example", import.meta.url), "utf8"),
]);

test("new dancers stay private until submission and public visibility is independent of venue affiliation", () => {
  assert.match(profileApproval, /function initialDancerApprovalValues/);
  assert.match(profileApproval, /status: "draft"/);
  assert.match(profileApproval, /verification_status: "pending"/);
  assert.match(profileApproval, /is_public: false/);
  assert.match(signupRoute, /initialDancerApprovalValues\(\)/);
  assert.match(callbackRoute, /initialDancerApprovalValues\(\)/);
  assert.match(profileRoute, /automaticDancerApprovalValues\(\)/);
  assert.match(publicProfiles, /applyPublicApprovalFilters/);
  assert.doesNotMatch(publicProfiles.match(/function applyPublicApprovalFilters[\s\S]*?\n}/)?.[0] || "", /venue_approved_at/);
  assert.doesNotMatch(profileApproval.match(/function isCoreVerificationApproved[\s\S]*?\n}/)?.[0] || "", /venue_approved_at|venueApprovedAt/);
  assert.match(accountUi, /Venue affiliation is confirmed separately for check-ins and Working Now/);
  assert.match(liveApp, /manager scan confirms that you are affiliated/i);
  assert.match(venueMigration, /venue_approved_at is not null/);
  assert.match(restoreMigration, /not profile visibility/i);
  assert.match(restoreMigration, /status = 'approved'/);
  assert.match(restoreMigration, /is_public = true/);
});

test("the hosted identity provider integration is removed from runtime code and configuration", async () => {
  const removedPaths = [
    "../src/lib/verifymycontent.ts",
    "../src/lib/dancr/identity.ts",
    "../src/lib/dancr/identity-mode.ts",
    "../app/api/dancer/identity-verification/route.ts",
    "../app/api/verifymycontent/webhook/route.ts",
  ];
  for (const path of removedPaths) {
    await assert.rejects(access(new URL(path, import.meta.url)));
  }

  const activeRuntime = [profileApproval, profileRoute, publicProfiles, adminBackend, adminUi, liveApp, environmentExample].join("\n");
  assert.doesNotMatch(activeRuntime, /verifymy|VMC_|DANCR_IDENTITY_VERIFICATION_MODE/i);
  assert.doesNotMatch(activeRuntime, /identity_provider|identity_verified_at|dancer_identity_verifications/);
});

test("direct identity uploads remain disabled without a replacement provider", () => {
  assert.match(legacyUploadRoute, /status:\s*410/);
  assert.match(legacyUploadRoute, /MyDancr does not collect identity documents/);
  assert.match(legacyUploadRoute, /replacement: null/);
  assert.doesNotMatch(dancerBackend, /uploadOwnVerificationDocument|listOwnVerificationDocuments/);
  assert.match(legacyPurge, /bucket\.remove/);
  assert.match(legacyPurge, /path\.split\("\/"\)\.includes\("verification"\)/);
  assert.doesNotMatch(adminUi, /Open secure file|Approve file|No verification files submitted/);
});

test("the removal migration deletes provider state without rewriting migration history", () => {
  assert.match(removalMigration, /drop table if exists public\.dancer_identity_verifications cascade/);
  assert.match(removalMigration, /drop constraint if exists dancer_profiles_identity_provider_check/);
  assert.match(removalMigration, /drop column if exists identity_provider/);
  assert.match(removalMigration, /drop column if exists identity_verified_at/);
  assert.match(legacyIdentityMigration, /set real_name = null/);
  assert.match(legacyIdentityMigration, /alter column real_name drop not null/);
});

test("automated media moderation remains the approval gate while venue affiliation stays separate", () => {
  assert.match(profileApproval, /verification_status \|\| profile\.verificationStatus/);
  assert.doesNotMatch(profileApproval, /identityProvider|identityVerifiedAt/);
  assert.match(venueMigration, /photo_review_status = 'approved'/);
  assert.match(venueMigration, /photo\.review_status <> 'approved'/);
  assert.match(venueMigration, /video\.status in \('uploading', 'moderating', 'submitted'\)/);
  assert.match(venueMigration, /status = 'approved'/);
  assert.match(venueMigration, /is_public = true/);
  assert.match(liveApp, /Every image is checked automatically/);
  assert.match(liveApp, /Videos that pass safety moderation stay private until your dancer profile is approved/);
  assert.match(restoreMigration, /public reads approved MyDancr TV videos/);
  assert.doesNotMatch(
    restoreMigration.match(/create policy "public reads approved MyDancr TV videos"[\s\S]*?\n\);/)?.[0] || "",
    /venue_approved_at/,
  );
});

test("legal identity data is absent from dancer profiles and admin screens", () => {
  assert.doesNotMatch(adminUi, /label="Legal name"|label="Verification name"/);
  assert.doesNotMatch(liveApp, /data-setup-profile-field="legalName"/);
  assert.doesNotMatch(liveApp, /Identity verification|Government ID|Selfie verification|Proof that you dance/);
});
