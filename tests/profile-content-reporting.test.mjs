import assert from "node:assert/strict";
import { readFile } from "./helpers/dashboard-test-fs-promises.mjs";
import test from "node:test";
import vm from "node:vm";

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
  assert.match(reportDialog, /<SafetyReportForm onSubmit=\{onReason\}/);
  assert.match(carousel, /<PublicReportReasonDialog[\s\S]*?submitMediaReport\(reason\)/);
  assert.doesNotMatch(carousel, /profile-media-report-message|setReportDetails|setReportReason/);
  assert.match(
    profilePage,
    /\.profile-media-viewer \.profile-media-viewer-share, \.profile-media-viewer \.profile-media-viewer-report \{[^}]*border-radius: 50% !important;/,
  );
});

test("live profiles expose reporting through the labeled options disclosure", () => {
  assert.match(liveShell, /<details class="profile-options"[^>]*>\s*<summary aria-label="Profile options"[\s\S]*?class="profile-options-panel">\s*<button class="profile-header-report-action" id="reportBtn"[^>]*aria-haspopup="dialog"[^>]*><svg[\s\S]*?<span>Report profile<\/span>/);
  assert.doesNotMatch(liveShell, /profileHeaderOverflowToggle|profileHeaderOverflowMenu|profile-footer-report-action/);
  assert.match(liveShell, /\.profile-header-report-action svg \{[^}]*width: 14px;[^}]*height: 14px;/);
  assert.match(liveShell, /actionButton.id === "reportBtn"[\s\S]*?openContentReportDialog\(\{/);
  assert.match(liveShell, /prepareContentReportButton\([\s\S]*?"dancer_profile"/);
});

test("standalone profiles expose reporting through the labeled options disclosure", () => {
  assert.match(profilePage, /<details className="profile-options"[^>]*>\s*<summary aria-label="Profile options"[\s\S]*?className="profile-options-panel">\s*<DancerReportControl preview=\{preview\} dancerId=\{profile.id\} profileName=\{profile.stageName\} \/>/);
  assert.match(profileActions, /className="profile-header-report-action"[\s\S]*?onClick=\{openReport\}[\s\S]*?<ReportFlagIcon \/>/);
  assert.doesNotMatch(profileActions, /profile-header-overflow|reportMenuOpen/);
  assert.match(profilePage, /\.profile-header-report-action \{[^}]*width: 44px;[^}]*min-height: 44px;[^}]*background: transparent !important;/);
  assert.match(profilePage, /\.profile-header-report-action svg \{[^}]*width: 14px;[^}]*height: 14px;/);
});

test("live profile and TV reports use the public review form without posting an allegation", () => {
  const handler = liveShell.match(/function openContentReportDialog\([\s\S]*?(?=    function closeContentReportDialog)/)?.[0];
  assert.ok(handler);
  const assigned=[];
  const context={URLSearchParams,window:{location:{assign:value=>assigned.push(value)}},isReportableContentId:()=>true,showToast:()=>{}};
  vm.runInNewContext(handler + ';openContentReportDialog({targetType:"tv_video",targetId:"synthetic-id",targetLabel:"A & B"});',context);
  const url=new URL(assigned[0],"https://www.mydancr.com");
  assert.equal(url.pathname,"/report-harmful-content/submit");
  assert.equal(url.searchParams.get("targetLabel"),"A & B");
  assert.doesNotMatch(handler,/fetch|postOptionalAuthJson|requestSubmit/);
  assert.match(liveShell,/reportTargetType = isReportableContentId\(photoId\) \? "profile_photo" : "dancer_profile"/);
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
  assert.match(liveShell, /"home-tv-feed-report-action"[\s\S]*?"Report video"[\s\S]*?actionIconMarkup\("report"\)/);
  assert.doesNotMatch(liveShell, /"home-tv-feed-overflow-action"[\s\S]{0,120}?"More video options"/);
});

test("standalone media controls prevent repeated submissions and show a case reference", () => {
  assert.match(carousel, /reportedTargets\.includes\(target\.key\)/);
  assert.match(carousel, /Case reference: \$\{data\.report\.id\}/);
  assert.match(profileActions, /Case reference: \{reportReceipt\?\.id\}/);
});
