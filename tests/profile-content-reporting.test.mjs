import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [reportsRoute, carousel, profileActions, profilePage, liveShell] = await Promise.all([
  readFile(new URL("../app/api/reports/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/DancerPhotoCarousel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/DancerProfileActions.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/page.tsx", import.meta.url), "utf8"),
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
  assert.match(carousel, /const MEDIA_REPORT_REASONS = \[[\s\S]*?"Sexual or unsafe content"[\s\S]*?"Harassment or abuse"[\s\S]*?"Spam or misleading content"[\s\S]*?"Other safety concern"/);
  assert.match(carousel, /className="profile-media-report-options" role="menu"[\s\S]*?submitMediaReport\(reason\)/);
  assert.doesNotMatch(carousel, /profile-media-report-message|setReportDetails|setReportReason/);
  assert.match(
    profilePage,
    /\.profile-media-viewer \.profile-media-viewer-share, \.profile-media-viewer \.profile-media-viewer-report \{[^}]*border-radius: 50% !important;/,
  );
});

test("live profiles expose reports without adding a fifth primary action", () => {
  const actionMarkup = liveShell.slice(
    liveShell.indexOf("function liveProfileModalActionsMarkup"),
    liveShell.indexOf("async function refreshProfileGoingState"),
  );
  assert.match(liveShell, /class="profile-header-report-toggle" id="reportBtn"[^>]*>[\s\S]*?M5 21V4[\s\S]*?<\/button>/);
  assert.match(
    liveShell,
    /class="profile-modal-context">[\s\S]*?id="modalCity"[\s\S]*?<\/div>[\s\S]*?class="profile-modal-header-controls">[\s\S]*?id="reportBtn"[\s\S]*?id="modalClose"/,
  );
  assert.doesNotMatch(
    liveShell.match(/class="profile-modal-context">[\s\S]*?<\/div>/)?.[0] || "",
    /id="reportBtn"/,
  );
  assert.match(
    liveShell,
    /\.profile-header-report-toggle \{[\s\S]*?border: 1px solid transparent;[\s\S]*?background: transparent;[\s\S]*?\.profile-header-report-toggle svg \{ width: 13px;/,
  );
  assert.doesNotMatch(actionMarkup, /id="reportBtn"|Report profile/);
  assert.match(liveShell, /prepareContentReportButton\([\s\S]*?"dancer_profile"/);
});

test("standalone profiles keep reporting beside close instead of beside the city", () => {
  assert.match(
    profilePage,
    /className="profile-titlebar-context">[\s\S]*?profile-titlebar-city[\s\S]*?<\/div>[\s\S]*?className="profile-titlebar-controls">[\s\S]*?<DancerReportControl[\s\S]*?<ProfileCloseButton/,
  );
  assert.doesNotMatch(
    profilePage.match(/className="profile-titlebar-context">[\s\S]*?<\/div>/)?.[0] || "",
    /DancerReportControl/,
  );
  assert.match(
    profilePage,
    /\.profile-titlebar-controls \{[^}]*grid-template-columns: 32px 44px;[^}]*gap: 4px;/,
  );
  assert.match(
    profilePage,
    /\.profile-header-report-toggle \{[^}]*border: 1px solid transparent;[^}]*background: transparent;/,
  );
});

test("live photo and video viewers reuse the scroll-video quick reason card", () => {
  assert.match(liveShell, /class="profile-photo-viewer-report" id="profilePhotoViewerReport"/);
  assert.match(liveShell, /class="profile-tv-viewer-report"[^>]*data-report-profile-tv/);
  assert.match(liveShell, /id="contentReportQuickOptions"[\s\S]*?Sexual or unsafe content[\s\S]*?Harassment or abuse[\s\S]*?Spam or misleading content[\s\S]*?Other safety concern/);
  assert.equal((liveShell.match(/quickReasons: true/g) || []).length, 2);
  assert.match(liveShell, /contentReportQuickOptions\?\.addEventListener\("click"[\s\S]*?contentReportForm\?\.requestSubmit\(\)/);
  assert.match(liveShell, /async function submitContentReportDialog[\s\S]*?postOptionalAuthJson\("\/api\/reports"/);
  assert.match(liveShell, /reportTargetType = isReportableContentId\(photoId\) \? "profile_photo" : "dancer_profile"/);
  assert.match(liveShell, /targetType:\s*"tv_video"|"tv_video",\s*String\(item\.id/);
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
