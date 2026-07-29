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
  readFile(new URL("../src/lib/dancr/dancer.ts", import.meta.url), "utf8"),
]);

test("automatic dancer approval is active without identity-file requirements", () => {
  assert.match(identityMode, /\["auto_approve", "verifymy"\]/);
  assert.match(identityMode, /if \(!configured\) return "auto_approve"/);
  assert.match(identityMode, /status: "approved"/);
  assert.match(identityMode, /verification_status: "approved"/);
  assert.match(identityMode, /is_public: true/);
  assert.match(signupRoute, /automaticDancerApprovalValues\(\)/);
  assert.match(callbackRoute, /automaticDancerApprovalValues\(\)/);
  assert.match(profileRoute, /getIdentityVerificationMode\(\) === "auto_approve"/);
  assert.match(profileRoute, /ensureAutomaticDancerApproval/);
  assert.match(publicProfiles, /applyPublicApprovalFilters/);
  assert.match(accountUi, /Dancer accounts are approved automatically right now/);
  assert.match(accountUi, /no ID, selfie, or dance-proof upload required/);
  assert.match(liveApp, /No identity check or identity-file upload is required right now/);
  assert.match(liveApp, /Automatic dancer approval/);
  assert.doesNotMatch(
    liveApp.match(/const verificationBody = liveIdentityVerificationMode[\s\S]*?const approvalBody/)?.[0] || "",
    /setupIdDocument|setupSelfieDocument|setupDanceProofDocument/,
  );
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

test("signed VerifyMy approval remains intact behind the provider mode", () => {
  assert.match(webhookRoute, /verifyVerifyMyContentWebhook\(rawBody/);
  assert.match(webhookRoute, /parseVerifyMyContentWebhook\(rawBody\)/);
  assert.match(webhookRoute, /syncVerifyMyContentIdentityVerification/);
  assert.match(providerClient, /createHmac\("sha256", apiSecret\)\.update\(rawBody/);
  assert.match(providerClient, /timingSafeEqual/);
  assert.match(identityBackend, /verification\.status === "approved"/);
  assert.match(identityBackend, /if \(verificationSucceeded\)/);
  assert.match(identityBackend, /status: "approved"/);
  assert.match(identityBackend, /verification_status: "approved"/);
  assert.match(identityBackend, /identity_provider: IDENTITY_PROVIDER/);
  assert.match(identityBackend, /identity_verified_at: verifiedAt/);
  assert.match(identityBackend, /is_public: true/);
  assert.match(identityBackend, /const canPublish =/);
  assert.match(identityBackend, /is_public: false/);
  assert.doesNotMatch(identityBackend, /Verified identity belongs to a disabled dancer account/);
  assert.match(adminBackend, /Identity approval is controlled by VerifyMy and cannot be granted manually/);
  assert.doesNotMatch(adminUi, /Approve dancer|Approve profile/);
});

test("pending media is independent from the identity live gate", () => {
  const verifiedProfileUpdate =
    identityBackend.match(/if \(verificationSucceeded\)[\s\S]*?\n  } else if/)?.[0] || "";
  assert.doesNotMatch(verifiedProfileUpdate, /photo_review_status|dancer_photos|mydancr_tv_videos/);
  assert.doesNotMatch(migration, /alter policy[\s\S]*?mydancr_tv_videos|drop policy[\s\S]*?MyDancr TV/);
  assert.match(migration, /does not change profile visibility or revoke the current automatic approvals/);
  assert.match(liveApp, /Pending photos and videos remain private until their separate moderation is complete/);
});

test("legal identity data is removed from dancer profiles and admin screens", () => {
  assert.match(migration, /set real_name = null/);
  assert.match(migration, /raw_user_meta_data[\s\S]*?-\s*'real_name'/);
  assert.match(migration, /alter column real_name drop not null/);
  assert.doesNotMatch(adminUi, /label="Legal name"|label="Verification name"/);
  assert.doesNotMatch(liveApp, /data-setup-profile-field="legalName"/);
  assert.match(liveApp, /No ID, selfie, legal identity details, or report is available to admins/);
});
