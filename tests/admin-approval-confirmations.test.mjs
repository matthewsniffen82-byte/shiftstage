import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const adminSource = await readFile(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8");

test("dancer approvals prominently show the live number still needed", () => {
  assert.match(adminSource, /const pendingDancerApprovalCount = state\.queue\?\.length \|\| 0/);
  assert.match(adminSource, /title="Dancer approvals"/);
  assert.match(adminSource, /badge=\{`\$\{pendingDancerApprovalCount\} needed`\}/);
  assert.match(adminSource, /<Metric label="Dancers needing approval" value=\{String\(pendingDancerApprovalCount\)\}/);
  assert.match(adminSource, /className="admin-panel-badge"/);
});

test("successful review decisions produce an accessible persistent confirmation", () => {
  assert.match(adminSource, /className="admin-action-toast" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(adminSource, /Dancer profile rejected successfully\./);
  assert.match(adminSource, /Picture approved and published successfully\./);
  assert.match(adminSource, /Picture rejected successfully and removed from private review storage\./);
  assert.match(adminSource, /onActionConfirmed\(confirmation\)/);
});

test("content decisions stay visible without collapsing the dancer approval", () => {
  const reviewContent =
    adminSource.match(/async function reviewContent[\s\S]*?\r?\n  }\r?\n\r?\n  return \(/)?.[0] || "";

  assert.match(adminSource, /const \[openApprovalIds, setOpenApprovalIds\] = useState<Record<string, boolean>>\(\{\}\)/);
  assert.match(adminSource, /openById=\{openApprovalIds\}/);
  assert.match(adminSource, /onKeepOpen=\{\(dancerId\) =>/);
  assert.match(reviewContent, /onKeepOpen\(\)/);
  assert.match(reviewContent, /setWorkingByKey\(\(current\) => \(\{ \.\.\.current, \[key\]: true \}\)\)/);
  assert.match(reviewContent, /const responseStatus = asText\(data\.review\?\.status\)/);
  assert.match(reviewContent, /const savedStatus = responseStatus === "approved" \|\| responseStatus === "rejected" \? responseStatus : status/);
  assert.match(reviewContent, /const confirmation = `\$\{label\} \$\{savedStatus === "approved" \? "approved" : "rejected"\} successfully\.`/);
  assert.match(reviewContent, /setStatusByKey\(\(current\) => \(\{ \.\.\.current, \[key\]: savedStatus \}\)\)/);
  assert.match(reviewContent, /onActionConfirmed\(confirmation\)/);
  assert.doesNotMatch(reviewContent, /onContentReviewed|loadAdmin/);
  assert.doesNotMatch(adminSource, /onRefresh=\{\(\) => loadAdmin/);
  assert.match(adminSource, /disabled=\{!targetId \|\| isWorking\}/);
  assert.match(adminSource, /<ReviewFeedbackMessage feedback=\{feedback\} \/>/);
  assert.match(adminSource, /role=\{feedback\.tone === "error" \? "alert" : "status"\}/);
});

test("account approval does not expose identity files or provider controls", () => {
  assert.match(adminSource, /Account approval/);
  assert.match(adminSource, /Approval is based on the dancer&apos;s venue affiliation and profile and media review/);
  assert.doesNotMatch(adminSource, /Tokenized identity verification|VerifyMy|opaque provider reference/);
  assert.doesNotMatch(adminSource, /"verification_document"/);
  assert.doesNotMatch(adminSource, /reviewContent\(event, "verification_document"/);
  assert.doesNotMatch(adminSource, /Approve file/);
  assert.doesNotMatch(adminSource, /Dancer profile approved successfully/);
  assert.doesNotMatch(adminSource, /reviewProfile\(dancerId, "approved"\)/);
});

test("approved socials stay in the submitted list and visibly retain their decision", () => {
  const reviewContent =
    adminSource.match(/async function reviewContent[\s\S]*?\r?\n  }\r?\n\r?\n  return \(/)?.[0] || "";
  const reviewedSocial =
    adminSource.match(/function withReviewedSocial[\s\S]*?\r?\n}\r?\n\r?\nfunction socialPlatformLabel/)?.[0] || "";

  assert.match(reviewContent, /if \(targetType === "social_link"\) \{[\s\S]*?onSocialReviewed\(dancerId, targetId, savedStatus, notes\)/);
  assert.match(reviewedSocial, /socialLinks = asRecordArray\(item\.socialLinks \|\| item\.social_links\)\.map/);
  assert.match(reviewedSocial, /reviewStatus: status/);
  assert.match(adminSource, /submitted-social-review \$\{isApproved \? "is-approved" : isDisapproved \? "is-rejected" : ""\}/);
  assert.match(adminSource, /\{social\.label\} \/ \{isApproved \? "✓ Approved" : isDisapproved \? "Disapproved" : "Pending review"\}/);
  assert.match(adminSource, /reviewContent\(event, "social_link"[\s\S]*?disabled=\{!targetId \|\| isWorking \|\| isApproved\}/);
  assert.match(adminSource, /\.submitted-social-review\.is-approved/);
  assert.match(adminSource, /\.submitted-social-review-status\.is-approved/);
});

test("expanded dancer approvals survive remounts and approval button events cannot collapse them", () => {
  const reviewContent =
    adminSource.match(/async function reviewContent[\s\S]*?\r?\n  }\r?\n\r?\n  return \(/)?.[0] || "";
  const keepOpenCalls = reviewContent.match(/onKeepOpen\(\)/g) || [];

  assert.match(adminSource, /const OPEN_APPROVALS_SESSION_KEY = "dancrAdminOpenApprovalsV1"/);
  assert.match(adminSource, /const persistedOpenApprovals = readPersistedOpenApprovals\(\)/);
  assert.match(adminSource, /openApprovalIdsRef\.current = persistedOpenApprovals/);
  assert.match(adminSource, /persistOpenApprovals\(next\)/);
  assert.match(adminSource, /window\.sessionStorage\.setItem\(OPEN_APPROVALS_SESSION_KEY, JSON\.stringify\(openApprovalIds\)\)/);
  assert.match(reviewContent, /event\.preventDefault\(\)/);
  assert.match(reviewContent, /event\.stopPropagation\(\)/);
  assert.ok(keepOpenCalls.length >= 3, "content review must reassert the open state before, after, and while settling");
  assert.match(adminSource, /onClick=\{\(event\) => reviewContent\(event, "social_link"/);
  assert.match(adminSource, /onClick=\{\(event\) => reviewContent\(event, "photo"/);
});
