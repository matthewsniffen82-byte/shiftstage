import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [reportsRoute, carousel, profilePage, liveShell] = await Promise.all([
  readFile(new URL("../app/api/reports/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/DancerPhotoCarousel.tsx", import.meta.url), "utf8"),
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
  assert.match(carousel, /Reports can be submitted without signing in\./);
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
  assert.match(liveShell, /class="profile-header-report-toggle" id="reportBtn"[^>]*>Report profile<\/button>/);
  assert.doesNotMatch(actionMarkup, /id="reportBtn"|Report profile/);
  assert.match(liveShell, /prepareContentReportButton\([\s\S]*?"dancer_profile"/);
});

test("live photo and video viewers share the anonymous reason-based report form", () => {
  assert.match(liveShell, /class="profile-photo-viewer-report" id="profilePhotoViewerReport"/);
  assert.match(liveShell, /class="profile-tv-viewer-report"[^>]*data-report-profile-tv/);
  assert.match(liveShell, /id="contentReportForm"[\s\S]*?id="contentReportReason"[\s\S]*?id="contentReportDetails"/);
  assert.match(liveShell, /Reports can be submitted without signing in\./);
  assert.match(liveShell, /async function submitContentReportDialog[\s\S]*?postOptionalAuthJson\("\/api\/reports"/);
  assert.match(liveShell, /reportTargetType = isReportableContentId\(photoId\) \? "profile_photo" : "dancer_profile"/);
  assert.match(liveShell, /targetType:\s*"tv_video"|"tv_video",\s*String\(item\.id/);
});

test("report controls prevent repeat submissions in the current browser session", () => {
  assert.match(liveShell, /const reportedContentTargets = new Set\(\)/);
  assert.match(liveShell, /reportedContentTargets\.has\(contentReportKey/);
  assert.match(liveShell, /reportedContentTargets\.add\(report\.reportKey\)/);
  assert.match(liveShell, /button\.disabled = !normalizedType \|\| !isReportableContentId\(normalizedId\) \|\| reported/);
  assert.match(carousel, /reportedTargets\.includes\(target\.key\)/);
});
