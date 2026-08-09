import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  identityBackend,
  providerClient,
  identityRoute,
  legacyUploadRoute,
  webhookRoute,
  adminBackend,
  adminUi,
  liveApp,
  migration,
  legacyPurge,
  identityMode,
  signupRoute,
  callbackRoute,
  profileRoute,
  publicProfiles,
  accountUi,
  venueMigration,
  profileApproval,
  dancerBackend,
] = await Promise.all([
  readFile(new URL("../src/lib/dancr/identity.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/verifymycontent.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/identity-verification/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/verification-documents/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/verifymycontent/webhook/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/admin.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202607280003_verifymycontent_identity_tokenization.sql", import.meta.url), "utf8"),
  readFile(new URL("../scripts/purge-legacy-identity-data.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/identity-mode.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/auth/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/auth/callback/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/profile/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/public.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/account/AccountClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608080002_venue_gated_dancer_profiles.sql", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/profile-approval.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/dancer.ts", import.meta.url), "utf8"),
]);

test("every new dancer remains private until a venue manager confirms affiliation", () => {
  assert.match(identityMode, /\["auto_approve", "verifymy"\]/);
  assert.match(identityMode, /function initialDancerApprovalValues/);
  assert.match(identityMode, /status: "draft"/);
  assert.match(identityMode, /verification_status: "pending"/);
  assert.match(identityMode, /is_public: false/);
  assert.match(signupRoute, /initialDancerApprovalValues\(\)/);
  assert.match(callbackRoute, /initialDancerApprovalValues\(\)/);
  assert.doesNotMatch(profileRoute, /ensureAutomaticDancerApproval|automaticDancerApprovalValues/);
  assert.match(publicProfiles, /applyPublicApprovalFilters/);
  assert.match(publicProfiles, /venue_approved_at/);
  assert.match(profileApproval, /venue_approved_at \|\| profile\.venueApprovedAt/);
  assert.match(accountUi, /verified venue manager scan your personal QR/);
  assert.match(liveApp, /successful manager scan publishes your profile/i);
  assert.match(venueMigration, /venue_approved_at is not null/);
});

test("identity documents and selfie stay inside VerifyMy hosted verification", () => {
  assert.match(identityBackend, /createVerifyMyContentVerification/);
  assert.match(providerClient, /POST/);
  assert.match(providerClient, /\/api\/v1\/identity-verification/);
  assert.match(providerClient, /customer:\s*\{[\s\S]*?id: input\.customerId,[\s\S]*?email: input\.email/);
  assert.match(identityRoute, /cache-control": "private, no-store"/);
  assert.doesNotMatch(identityRoute, /publishableKey|clientSecret/);
  assert.match(liveApp, /window\.location\.assign\(data\.redirectUrl\)/);
  assert.match(liveApp, /not your government ID, selfie, legal identity details, or verification report/);
});

test("MyDancr persists only an opaque provider token and non-PII status", () => {
  assert.match(migration, /dancer_identity_verifications/);
  assert.match(migration, /provider_session_id text not null unique/);
  assert.match(migration, /dancer_identity_no_client_secret/);
  assert.match(migration, /Never store hosted URLs, identity attributes, reports, document images, or selfies/);
  assert.doesNotMatch(identityBackend, /\.verified_outputs|verification_report|document_number|dob|first_name|last_name/);
  assert.doesNotMatch(
    identityBackend.match(/async function saveIdentityRecord[\s\S]*?\n}/)?.[0] || "",
    /redirectUrl|hostedUrl|identity attributes|document images/,
  );
});

test("legacy direct identity uploads are disabled and purged", () => {
  assert.match(legacyUploadRoute, /status:\s*410/);
  assert.match(legacyUploadRoute, /\/api\/dancer\/identity-verification/);
  assert.doesNotMatch(dancerBackend, /uploadOwnVerificationDocument|listOwnVerificationDocuments/);
  assert.match(identityBackend, /purgeLegacyVerificationDocuments/);
  assert.match(identityBackend, /\.from\("verification-documents"\)/);
  assert.match(identityBackend, /\.like\("review_type", "verification_document:%"\)/);
  assert.match(migration, /delete from public\.approval_reviews[\s\S]*?verification_document:%/);
  assert.match(legacyPurge, /bucket\.remove/);
  assert.match(legacyPurge, /path\.split\("\/"\)\.includes\("verification"\)/);
  assert.doesNotMatch(adminUi, /Open secure file|Approve file|No verification files submitted/);
});

test("signed VerifyMy approval records identity but never bypasses venue affiliation", () => {
  assert.match(webhookRoute, /verifyVerifyMyContentWebhook\(rawBody/);
  assert.match(webhookRoute, /parseVerifyMyContentWebhook\(rawBody\)/);
  assert.match(webhookRoute, /syncVerifyMyContentIdentityVerification/);
  assert.match(providerClient, /createHmac\("sha256", apiSecret\)\.update\(rawBody/);
  assert.match(providerClient, /timingSafeEqual/);
  assert.match(identityBackend, /verification\.status === "approved"/);
  assert.match(identityBackend, /if \(verificationSucceeded\)/);
  assert.match(identityBackend, /status: "pending_review"/);
  assert.match(identityBackend, /verification_status: "approved"/);
  assert.match(identityBackend, /identity_provider: IDENTITY_PROVIDER/);
  assert.match(identityBackend, /identity_verified_at: verifiedAt/);
  assert.match(identityBackend, /is_public: false/);
  assert.match(identityBackend, /approved_at: null/);
  assert.doesNotMatch(identityBackend, /is_public: true/);
  assert.match(identityBackend, /venue affiliation is next/i);
  assert.doesNotMatch(identityBackend, /Verified identity belongs to a disabled dancer account/);
  assert.match(adminBackend, /Identity approval is controlled by VerifyMy and cannot be granted manually/);
  assert.doesNotMatch(adminUi, /Approve dancer|Approve profile/);
});

test("automated media moderation completes before venue activation", () => {
  const verifiedProfileUpdate =
    identityBackend.match(/if \(verificationSucceeded\)[\s\S]*?\n  } else if/)?.[0] || "";
  assert.doesNotMatch(verifiedProfileUpdate, /photo_review_status|dancer_photos|mydancr_tv_videos/);
  assert.match(venueMigration, /photo_review_status = 'approved'/);
  assert.match(venueMigration, /photo\.review_status <> 'approved'/);
  assert.match(venueMigration, /video\.status in \('uploading', 'moderating', 'submitted'\)/);
  assert.match(venueMigration, /status = 'approved'/);
  assert.match(venueMigration, /is_public = true/);
  assert.match(liveApp, /Every image is checked automatically/);
  assert.match(liveApp, /Videos that pass safety moderation stay private until venue affiliation is approved/);
});

test("legal identity data is removed from dancer profiles and admin screens", () => {
  assert.match(migration, /set real_name = null/);
  assert.match(migration, /raw_user_meta_data[\s\S]*?-\s*'real_name'/);
  assert.match(migration, /alter column real_name drop not null/);
  assert.doesNotMatch(adminUi, /label="Legal name"|label="Verification name"/);
  assert.doesNotMatch(liveApp, /data-setup-profile-field="legalName"/);
  assert.match(liveApp, /No ID, selfie, legal identity details, or report is available to admins/);
});
