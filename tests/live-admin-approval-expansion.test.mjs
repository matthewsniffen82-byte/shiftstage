import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const liveSource = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");

test("live dancer approval cards default open and remember only an explicit collapse", () => {
  const rememberOpenCards =
    liveSource.match(/function rememberOpenAdminApprovalCards\(\) \{[\s\S]*?\r?\n    \}/)?.[0] || "";
  const approvalCard =
    liveSource.match(/function adminDancerApprovalCard\([\s\S]*?\r?\n    \}/)?.[0] || "";
  const toggleHandler =
    liveSource.match(/adminDashboard\.addEventListener\("toggle"[\s\S]*?\r?\n    \}, true\);/)?.[0] || "";

  assert.match(liveSource, /const ADMIN_CLOSED_DANCER_APPROVAL_CARDS_KEY = "dancrAdminClosedApprovalCardsV1"/);
  assert.match(liveSource, /const adminClosedDancerApprovalCards = loadClosedAdminApprovalCards\(\)/);
  assert.match(liveSource, /sessionStorage\.getItem\(ADMIN_CLOSED_DANCER_APPROVAL_CARDS_KEY\)/);
  assert.match(liveSource, /sessionStorage\.setItem\([\s\S]*?ADMIN_CLOSED_DANCER_APPROVAL_CARDS_KEY/);
  assert.match(approvalCard, /\$\{adminClosedDancerApprovalCards\.has\(approvalKey\) \? "" : "open"\}/);
  assert.match(rememberOpenCards, /if \(card\.open\) adminClosedDancerApprovalCards\.delete\(key\)/);
  assert.match(rememberOpenCards, /else adminClosedDancerApprovalCards\.add\(key\)/);
  assert.match(toggleHandler, /if \(card\.open\) adminClosedDancerApprovalCards\.delete\(key\)/);
  assert.match(toggleHandler, /else adminClosedDancerApprovalCards\.add\(key\)/);
  assert.match(toggleHandler, /persistClosedAdminApprovalCards\(\)/);
  assert.doesNotMatch(liveSource, /adminOpenDancerApprovalCards/);
});

test("every live content decision reopens its dancer card before the dashboard redraw", () => {
  const keepOpen =
    liveSource.match(/function keepAdminApprovalCardOpen\(card\) \{[\s\S]*?\r?\n    \}/)?.[0] || "";
  const reviewContent =
    liveSource.match(/async function reviewAdminSubmittedContent\(button\) \{[\s\S]*?\r?\n    \}/)?.[0] || "";
  const keepOpenCalls = reviewContent.match(/keepAdminApprovalCardOpen\(approvalCard\)/g) || [];

  assert.match(keepOpen, /adminClosedDancerApprovalCards\.delete\(key\)/);
  assert.match(keepOpen, /card\.open = true/);
  assert.match(keepOpen, /persistClosedAdminApprovalCards\(\)/);
  assert.match(reviewContent, /const approvalCard = host\.closest\("details\[data-admin-approval-key\]"\)/);
  assert.ok(keepOpenCalls.length >= 2, "review actions must keep the card open before saving and before redrawing");
  assert.match(
    reviewContent,
    /keepAdminApprovalCardOpen\(approvalCard\);\s*renderAdminDashboard\(\)/
  );
});
