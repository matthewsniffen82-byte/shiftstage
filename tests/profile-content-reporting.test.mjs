import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [reportsRoute, carousel, profileActions, profilePage, reportDialog, liveShell] = await Promise.all([
  readFile(new URL("../app/api/reports/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/DancerPhotoCarousel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/DancerProfileActions.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/PublicReportReasonDialog.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
]);

test("approved profile photos are first-class public moderation targets", () => {
  assert.match(reportsRoute, /TARGET_TYPES = new Set\(\[[^\]]*"profile_photo"/);
  assert.match(
    reportsRoute,
    /targetType === "profile_photo"[\s\S]*?\.from\("dancer_photos"\)[\s\S]*?\.eq\("review_status", "approved"\)[\s\S]*?requireReportableDancer/,
  );
  assert.match(reportsRoute, /profile photo \$\{photoNumber\}/);
});

test("standalone profile photos and videos expose a circular report action", () => {
  assert.match(profilePage, /<DancerPhotoCarousel[\s\S]*?dancerId=\{profile\.id\}/);
  assert.match(carousel, /className="profile-media-viewer-report"[\s\S]*?<ReportIcon \/>/);
  assert.match(carousel, /targetType: "profile_photo"/);
  assert.match(carousel, /targetType: "tv_video"/);
  assert.match(carousel, /fetch\("\/api\/reports"/);
  assert.match(reportDialog, /PUBLIC_REPORT_REASONS = \[[\s\S]*?"Sexual or unsafe content"[\s\S]*?"Harassment or abuse"[\s\S]*?"Spam or misleading content"[\s\S]*?"Other safety concern"/);
  assert.match(reportDialog, /className="public-report-reason-options" role="menu"[\s\S]*?onReason\(reason\)/);
  assert.match(carousel, /<PublicReportReasonDialog[\s\S]*?submitMediaReport\(reason\)/);
  assert.doesNotMatch(carousel, /profile-media-report-message|setReportDetails|setReportReason/);
  assert.match(
    profilePage,
    /\.profile-media-viewer \.profile-media-viewer-share, \.profile-media-viewer \.profile-media-viewer-report \{[^}]*border-radius: 50% !important;/,
  );
});

test("live profiles keep reporting as a subdued footer safety action", () => {
  const actionMarkup = liveShell.slice(
    liveShell.indexOf("function liveProfileModalActionsMarkup"),
    liveShell.indexOf("async function refreshProfileGoingState"),
  );
  assert.match(liveShell, /class="profile-footer-report-action" id="reportBtn"[^>]*>[\s\S]*?M5 21V4[\s\S]*?<span>Report profile<\/span>[\s\S]*?<\/button>/);
  assert.match(
    liveShell,
    /class="profile-modal-header-controls">[\s\S]*?id="modalClose"[\s\S]*?<\/div>[\s\S]*?class="profile-modal-media"[\s\S]*?<\/section>\s*<button class="profile-footer-report-action" id="reportBtn"/,
  );
  assert.doesNotMatch(
    liveShell.match(/class="profile-modal-context">[\s\S]*?<\/div>/)?.[0] || "",
    /id="reportBtn"/,
  );
  assert.match(
    liveShell,
    /\.profile-footer-report-action \{[\s\S]*?min-height: 36px;[\s\S]*?border: 0;[\s\S]*?color: rgba\(189,180,200,\.46\);[\s\S]*?background: transparent;[\s\S]*?font-size: 9px;[\s\S]*?\.profile-footer-report-action svg \{ width: 11px;/,
  );
  assert.doesNotMatch(actionMarkup, /id="reportBtn"|Report profile/);
  assert.match(liveShell, /prepareContentReportButton\([\s\S]*?"dancer_profile"/);
});

test("standalone profiles move reporting below media and reserve the header for close", () => {
  assert.match(
    profilePage,
    /className="profile-titlebar-controls">\s*<ProfileCloseButton/,
  );
  assert.doesNotMatch(
    profilePage.match(/className="profile-titlebar-context">[\s\S]*?<\/div>/)?.[0] || "",
    /DancerReportControl/,
  );
  assert.match(
    profilePage,
    /<DancerPhotoCarousel[\s\S]*?\/>\s*<DancerReportControl dancerId=\{profile\.id\} profileName=\{profile\.stageName\} \/>/,
  );
  assert.match(
    profilePage,
    /\.profile-titlebar-controls \{[^}]*width: 44px;[^}]*grid-template-columns: 44px;/,
  );
  assert.match(
    profilePage,
    /\.profile-footer-report-toggle \{[^}]*border: 0;[^}]*color: rgba\(189,180,200,\.46\);[^}]*background: transparent;/,
  );
});

test("every live report button reuses one four-reason report card", () => {
  assert.match(liveShell, /class="profile-photo-viewer-report" id="profilePhotoViewerReport"/);
  assert.match(liveShell, /class="profile-tv-viewer-report"[^>]*data-report-profile-tv/);
  assert.match(liveShell, /id="contentReportQuickOptions"[\s\S]*?Sexual or unsafe content[\s\S]*?Harassment or abuse[\s\S]*?Spam or misleading content[\s\S]*?Other safety concern/);
  assert.equal((liveShell.match(/quickReasons: true/g) || []).length, 4);
  assert.match(liveShell, /contentReportQuickOptions\?\.addEventListener\("click"[\s\S]*?contentReportForm\?\.requestSubmit\(\)/);
  assert.match(liveShell, /async function submitContentReportDialog[\s\S]*?postOptionalAuthJson\("\/api\/reports"/);
  assert.match(liveShell, /reportTargetType = isReportableContentId\(photoId\) \? "profile_photo" : "dancer_profile"/);
  assert.match(liveShell, /targetType:\s*"tv_video"|"tv_video",\s*String\(item\.id/);
  assert.doesNotMatch(liveShell, /home-tv-feed-report-menu|home-tv-feed-report-option/);
  assert.match(liveShell, /dataset\.homeTvReport = "true"[\s\S]*?openContentReportDialog\(\{[\s\S]*?title: "Report video"[\s\S]*?quickReasons: true/);
});

test("the shared report card reserves a separate header row for its close button", () => {
  assert.match(reportDialog, /className="public-report-reason-header"[\s\S]*?className="public-report-reason-close"/);
  assert.match(profilePage, /\.public-report-reason-header \{[^}]*min-height: 54px[^}]*display: flex/);
  assert.match(profilePage, /\.public-report-reason-close \{[^}]*position: static[^}]*width: 52px/);
  assert.match(liveShell, /\.content-report-popover\.is-quick-reason \.content-report-header \{[^}]*min-height: 54px/);
  assert.match(liveShell, /\.content-report-popover\.is-quick-reason \.content-report-close \{[^}]*position: static[^}]*width: 52px/);
});

test("every public report entry point uses the same flag symbol", () => {
  const flagPattern = /M5 21V4[\s\S]*?M5 5h11l-1\.8 3L16 11H5/;
  assert.match(carousel.match(/function ReportIcon\(\)[\s\S]*?\n}/)?.[0] || "", flagPattern);
  assert.match(profileActions.match(/function ReportFlagIcon\(\)[\s\S]*?\n}/)?.[0] || "", flagPattern);
  assert.match(liveShell.match(/report: '<svg[\s\S]*?<\/svg>'/)?.[0] || "", flagPattern);
  assert.match(liveShell, /"home-tv-feed-overflow-action"[\s\S]*?"Report video"[\s\S]*?actionIconMarkup\("report"\)/);
  assert.doesNotMatch(liveShell, /"home-tv-feed-overflow-action"[\s\S]{0,120}?"More video options"/);
});

test("report controls prevent repeat submissions in the current browser session", () => {
  assert.match(liveShell, /const reportedContentTargets = new Set\(\)/);
  assert.match(liveShell, /reportedContentTargets\.has\(contentReportKey/);
  assert.match(liveShell, /reportedContentTargets\.add\(report\.reportKey\)/);
  assert.match(liveShell, /button\.disabled = !normalizedType \|\| !isReportableContentId\(normalizedId\) \|\| reported/);
  assert.match(carousel, /reportedTargets\.includes\(target\.key\)/);
});
