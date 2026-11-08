import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const adminSource = await readFile(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8");

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

  assert.match(reviewContent, /onKeepOpen\(\)/);
  assert.match(reviewContent, /setWorkingByKey\(\(current\) => \(\{ \.\.\.current, \[key\]: true \}\)\)/);
  assert.match(reviewContent, /const responseStatus = asText\(data\.review\?\.status\)/);
  assert.match(reviewContent, /responseStatus !== status/);
  assert.match(reviewContent, /!isContentReviewVersion\(data\.review\?\.reviewVersion, targetType\)/);
  assert.doesNotMatch(reviewContent, /\? responseStatus : status/);
  assert.match(reviewContent, /const confirmation = `\$\{label\} \$\{savedStatus === "approved" \? "approved" : "rejected"\} successfully\.`/);
  assert.match(reviewContent, /setStatusByKey\(\(current\) => \(\{ \.\.\.current, \[key\]: savedStatus \}\)\)/);
  assert.match(reviewContent, /onActionConfirmed\(confirmation\)/);
  assert.match(reviewContent, /onContentReviewed\?\.\(dancerId, targetType, targetId, savedStatus, notes, data\.review\.reviewVersion\)/);
  assert.doesNotMatch(reviewContent, /loadAdmin/);
  assert.doesNotMatch(adminSource, /onRefresh=\{\(\) => loadAdmin/);
  assert.match(adminSource, /disabled=\{!targetId \|\| actionBusy\}/);
  assert.match(adminSource, /<ReviewFeedbackMessage feedback=\{feedback\} \/>/);
  assert.match(adminSource, /role=\{feedback\.tone === "error" \? "alert" : "status"\}/);
});

test("account approval does not expose identity files or provider controls", () => {
  assert.match(adminSource, /Account approval/);
  assert.match(adminSource, /Approval is based on the dancer&apos;s club affiliation and profile and media review/);
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
  assert.match(adminSource, /reviewContent\(event, "social_link"[\s\S]*?disabled=\{!targetId \|\| actionBusy \|\| isApproved\}/);
  assert.match(adminSource, /\.submitted-social-review\.is-approved/);
  assert.match(adminSource, /\.submitted-social-review-status\.is-approved/);
});

test("content decisions keep the selected dancer open without triggering parent controls", () => {
  const reviewContent =
    adminSource.match(/async function reviewContent[\s\S]*?\r?\n  }\r?\n\r?\n  return \(/)?.[0] || "";
  const keepOpenCalls = reviewContent.match(/onKeepOpen\(\)/g) || [];

  assert.match(adminSource, /<ApprovalQueue items=\{\[profile\]\} openById=\{\{ \[selectedId\]: true \}\}/);
  assert.match(reviewContent, /event\.preventDefault\(\)/);
  assert.match(reviewContent, /event\.stopPropagation\(\)/);
  assert.ok(keepOpenCalls.length >= 3, "content review must reassert the open state before, after, and while settling");
  assert.match(adminSource, /onClick=\{\(event\) => reviewContent\(event, "social_link"/);
  assert.match(adminSource, /onClick=\{\(event\) => reviewContent\(event, "photo"/);
});
