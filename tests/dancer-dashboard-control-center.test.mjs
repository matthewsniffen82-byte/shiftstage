import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");

test("approved dancer dashboard leads with a real daily control center", () => {
  assert.match(page, /id="dancerApprovedTopTools"[^>]*aria-label="Dancer daily controls"/);
  assert.match(page, /id="dancerDashboardShiftAction"[^>]*data-dancer-control-action="dashboard-primary"/);
  assert.match(page, /data-dancer-control-action="edit-profile"/);
  assert.match(page, /data-dancer-control-action="preview-profile"/);
  assert.match(page, /data-dancer-control-action="share-profile"/);
  const shortcuts = page.match(
    /<div class="dancer-quick-actions" aria-label="Profile shortcuts">[\s\S]*?<\/div>/,
  )?.[0] || "";
  assert.doesNotMatch(shortcuts, /MyDancr TV|Manage videos|\/dashboard\/dancer\/tv/);
  assert.match(page, /\.dancer-quick-actions \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/s);
  assert.match(page, /\.dancer-quick-actions > \[data-dancer-control-action="share-profile"\] \{\s*grid-column: 1 \/ -1;/);
  assert.match(page, /function renderDancerDailyOverview\(/);
  assert.match(page, /handleShiftVerificationAction\("check-in", trigger\)/);
});

test("schedule editing expands inside the dashboard schedule card", () => {
  const scheduleCard = page.match(
    /<section class="dancer-next-shift"[\s\S]*?<\/section>/,
  )?.[0] || "";
  assert.match(scheduleCard, /id="dancerDashboardShiftAction"/);
  assert.match(scheduleCard, /id="approvedScheduleDropdown"[^>]*hidden/);
  assert.match(scheduleCard, /id="approvedScheduleFormMount"/);
  assert.match(
    page,
    /\.dancer-next-shift > #approvedScheduleDropdown \{[\s\S]*?grid-column: 1 \/ -1;[\s\S]*?border-top: 1px solid rgba\(195,169,255,\.22\) !important;[\s\S]*?background: transparent;/,
  );
  assert.match(
    page,
    /function renderApprovedToolDropdowns\(\)[\s\S]*?schedulePanel\?\.closest\("\.dancer-next-shift"\)[\s\S]*?classList\.toggle\("is-schedule-editor-open", scheduleExpanded\)/,
  );
  assert.match(
    page,
    /function openApprovedScheduleEditor\(\)[\s\S]*?setApprovedToolDropdown\("schedule", \{ force: true \}\)[\s\S]*?approvedScheduleDropdown[\s\S]*?scrollIntoView\(\{ behavior: "smooth", block: "nearest" \}\)/,
  );
  const collapseButtonRule = page.match(
    /\.approved-tool-dropdown-actions button\[data-dancer-control-action="collapse-approved-tool"\] \{[^}]*\}/,
  )?.[0] || "";
  assert.match(collapseButtonRule, /border: 1px solid rgba\(195,169,255,\.48\) !important;/);
  assert.match(collapseButtonRule, /var\(--dancr-color-brand-primary\) 12%/);
  assert.match(collapseButtonRule, /0 8px 18px rgba\(0,0,0,\.26\)/);
  assert.match(
    page,
    /button\[data-dancer-control-action="collapse-approved-tool"\]::before \{[\s\S]*?color: #e1d7ff;[\s\S]*?background: rgba\(139,92,246,\.18\);/,
  );
  assert.doesNotMatch(
    collapseButtonRule,
    /0 0 28px rgba\(53,216,255,\.24\)/,
  );
});

test("dashboard glance metrics are populated only from live analytics fields", () => {
  assert.match(page, /dancerDashboardProfileViews:\s*views/);
  assert.match(page, /dancerDashboardFollowers:\s*followers/);
  assert.match(page, /dancerDashboardDirections:\s*directions/);
  assert.match(page, /dashboardMetrics\?\.profileViews30/);
  assert.match(page, /dashboardMetrics\?\.followers/);
  assert.match(page, /dashboardMetrics\?\.directionRequests30/);
});

test("profile visibility is separated from daily actions and hiding requires confirmation", () => {
  assert.match(page, /id="dancerVisibilitySection"/);
  assert.match(page, /id="dancerIncognitoToggle"/);
  assert.match(page, /window\.confirm\("Go incognito\?/);
  assert.match(page, /patchAuthenticatedJson\("\/api\/dancer\/profile\/visibility", \{ isPublic: nextPublic \}\)/);
});

test("approved dashboard suppresses irrelevant billing, approval, and generic moderation status", () => {
  assert.match(page, /id="dancerBillingSection" hidden/);
  assert.match(page, /billingSection\.hidden = !Boolean\(liveDancerBilling\?\.subscription\?\.hasStripeSubscription\)/);
  assert.match(page, /approvalStatusSection\.hidden = approved && !optionalProfileFixes && !rejected/);
  assert.doesNotMatch(page, /Complete your public details, post shifts, and track how Dancr sends customers to you\. Photos and videos publish only after separate media moderation\./);
});

test("collapsed dashboard sections expose real summary counts", () => {
  assert.match(page, /id="dancerQrSummaryCount"/);
  assert.match(page, /id="dancerNotificationSummaryCount"/);
  assert.match(page, /id="dancerSupportSummaryCount"/);
  assert.match(page, /liveNotifications\.filter\(\(notification\) => !notification\.readAt\)\.length/);
  assert.match(page, /summaryCount\.textContent = String\(threads\.length\)/);
});

test("dancer dashboard header scrolls with the dashboard content", () => {
  assert.match(
    page,
    /#dancerDashboard \.page-head\s*\{[^}]*position:\s*relative\s*!important;[^}]*top:\s*auto\s*!important;[^}]*z-index:\s*2\s*!important;/s,
  );
  assert.doesNotMatch(
    page,
    /#dancerDashboard \.page-head\s*\{[^}]*position:\s*sticky\s*!important;/s,
  );
});

test("dancer dashboard uses the same quiet neutral scrollbar as profile scrolling", () => {
  assert.match(
    page,
    /#dancerDashboard\s*\{[^}]*scrollbar-color:\s*rgba\(255, 255, 255, 0\.28\) transparent;/s,
  );
  assert.match(
    page,
    /#dancerDashboard::-webkit-scrollbar-thumb\s*\{[^}]*background:\s*rgba\(255, 255, 255, 0\.28\);[^}]*box-shadow:\s*none;/s,
  );
  assert.match(
    page,
    /#dancerDashboard::-webkit-scrollbar-thumb:hover,[\s\S]*?#dancerDashboard::-webkit-scrollbar-thumb:active\s*\{[^}]*background:\s*rgba\(255, 255, 255, 0\.42\);[^}]*box-shadow:\s*none;/,
  );
});
