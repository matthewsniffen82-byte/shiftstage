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

test("successful approval decisions produce an accessible persistent confirmation", () => {
  assert.match(adminSource, /className="admin-action-toast" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(adminSource, /Dancer profile approved successfully\./);
  assert.match(adminSource, /Dancer profile rejected successfully\./);
  assert.match(adminSource, /Picture approved and published successfully\./);
  assert.match(adminSource, /Picture rejected successfully and removed from private review storage\./);
  assert.match(adminSource, /onActionConfirmed\(confirmation\)/);
});

test("content decisions stay visible without collapsing the dancer approval", () => {
  const reviewContent =
    adminSource.match(/async function reviewContent[\s\S]*?\n  }\n\n  return \(/)?.[0] || "";

  assert.match(adminSource, /const \[openApprovalIds, setOpenApprovalIds\] = useState<Record<string, boolean>>\(\{\}\)/);
  assert.match(adminSource, /openById=\{openApprovalIds\}/);
  assert.match(adminSource, /onKeepOpen=\{\(dancerId\) =>/);
  assert.match(reviewContent, /onKeepOpen\(\)/);
  assert.match(reviewContent, /setWorkingByKey\(\(current\) => \(\{ \.\.\.current, \[key\]: true \}\)\)/);
  assert.match(reviewContent, /const confirmation = `\$\{label\} \$\{status === "approved" \? "approved" : "rejected"\} successfully\.`/);
  assert.match(reviewContent, /setStatusByKey\(\(current\) => \(\{ \.\.\.current, \[key\]: status \}\)\)/);
  assert.match(reviewContent, /onActionConfirmed\(confirmation\)/);
  assert.doesNotMatch(reviewContent, /onContentReviewed|loadAdmin/);
  assert.doesNotMatch(adminSource, /onRefresh=\{\(\) => loadAdmin/);
  assert.match(adminSource, /disabled=\{!targetId \|\| isWorking\}/);
  assert.match(adminSource, /<ReviewFeedbackMessage feedback=\{feedback\} \/>/);
  assert.match(adminSource, /role=\{feedback\.tone === "error" \? "alert" : "status"\}/);
});
