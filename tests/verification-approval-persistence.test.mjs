import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const adminBackend = await readFile(new URL("../src/lib/dancr/admin.ts", import.meta.url), "utf8");
const dancerBackend = await readFile(new URL("../src/lib/dancr/dancer.ts", import.meta.url), "utf8");
const uploadRoute = await readFile(new URL("../app/api/dancer/verification-documents/route.ts", import.meta.url), "utf8");
const liveApp = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");

test("verification uploads preserve their required document identity", () => {
  assert.match(uploadRoute, /documentType,\s*\n\s*\}\);/);
  assert.match(dancerBackend, /documentType\?: string/);
  assert.match(dancerBackend, /const documentType = normalizeVerificationDocumentType\(input\.documentType\)/);
  assert.match(dancerBackend, /const storageName = `\$\{documentType \? `\$\{documentType\}-` : ""\}\$\{makeStorageFileName\(input\.fileName\)\}`/);
  assert.match(dancerBackend, /value === "government_id" \|\| value === "selfie" \|\| value === "dance_proof"/);
});

test("dancers receive the persisted admin status for every saved verification file", () => {
  const loader =
    dancerBackend.match(/export async function listOwnVerificationDocuments[\s\S]*?\r?\n}\r?\n\r?\nexport function getDancerPhotoUrl/)?.[0] || "";

  assert.match(loader, /\.from\("approval_reviews"\)/);
  assert.match(loader, /`verification_document:\$\{storagePath\}`/);
  assert.match(loader, /const review = latestApprovalReview/);
  assert.match(loader, /status: review\?\.status === "pending" \? "pending_review" : review\?\.status \|\| "pending_review"/);
  assert.match(loader, /reviewNotes: review\?\.notes \|\| null/);
  assert.match(loader, /reviewedAt: review\?\.reviewed_at \|\| null/);
});

test("admin decisions update every matching review row and only insert when none exists", () => {
  const reviewer =
    adminBackend.match(/export async function reviewSubmissionContent[\s\S]*?\r?\n}\r?\n\r?\nfunction dancerApprovalNotificationCopy/)?.[0] || "";

  assert.match(reviewer, /\.update\(reviewUpdate\)[\s\S]*?\.eq\("dancer_id", input\.dancerId\)[\s\S]*?\.eq\("review_type", reviewType\)/);
  assert.match(reviewer, /let persistedReview = updatedReviews\?\.\[0\] \|\| null/);
  assert.match(reviewer, /if \(!persistedReview\) \{[\s\S]*?\.insert\(/);
  assert.match(reviewer, /status: persistedReview\.status/);
  assert.match(reviewer, /reviewedAt: persistedReview\.reviewed_at \|\| reviewedAt/);
});

test("approving all verification files does not bypass final profile approval", () => {
  const summary =
    adminBackend.match(/async function updateVerificationReviewSummary[\s\S]*?\r?\n}\r?\n\r?\nfunction aggregateReviewStatus/)?.[0] || "";

  assert.match(summary, /const profileAlreadyApproved = profileResult\.data\.status === "approved" && status === "approved"/);
  assert.match(summary, /verification_status: profileAlreadyApproved \? "approved" : status === "rejected" \? "rejected" : "pending"/);
  assert.match(summary, /profileUpdate\.status = profileAlreadyApproved \? "approved" : "pending_review"/);
  assert.match(summary, /profileUpdate\.approved_at = profileAlreadyApproved \? profileResult\.data\.approved_at : null/);
  assert.doesNotMatch(summary, /profileUpdate\.status = "approved"/);
});

test("admin verifies the exact stored file before saving its decision", () => {
  const reviewer =
    adminBackend.match(/export async function reviewSubmissionContent[\s\S]*?\r?\n}\r?\n\r?\nfunction dancerApprovalNotificationCopy/)?.[0] || "";

  assert.match(reviewer, /const fileName = input\.targetId\.slice\(expectedPrefix\.length\)/);
  assert.match(reviewer, /\.from\("verification-documents"\)[\s\S]*?search: fileName/);
  assert.match(reviewer, /\.some\(\(file: any\) => file\.name === fileName\)/);
});

test("live admin UI waits for the server and then renders the saved decision", () => {
  const reviewer =
    liveApp.match(/async function reviewAdminSubmittedContent[\s\S]*?\n    async function reviewAdminImageModeration/)?.[0] || "";

  assert.ok(
    reviewer.indexOf('await postAuthenticatedJson("/api/admin/approvals"') <
      reviewer.indexOf("applyLocalAdminContentReview(profileMatch.profile"),
    "the production response must arrive before the approval is shown locally",
  );
  assert.match(reviewer, /savedStatus = normalizedReviewStatus\(data\?\.review\?\.status\) \|\| status/);
  assert.match(liveApp, /class="admin-review-status \$\{isApproved \? "is-approved"/);
  assert.match(liveApp, /\$\{isApproved \? "Approved" : "Approve file"\}/);
  assert.match(liveApp, /All verification files approved/);
});
