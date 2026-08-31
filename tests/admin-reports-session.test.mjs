import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [adminDashboard, reportsRoute, adminService, liveShell] = await Promise.all([
  readFile(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/reports/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/admin.ts", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
]);

const reportManager = adminDashboard.match(/function ReportManager\([\s\S]*?function VenueSignupRequestQueue/)?.[0] || "";

test("admin reports use the refresh-aware role-isolated admin boundary", () => {
  assert.equal((reportsRoute.match(/const \{ client, session, user \} = await createRequestSupabaseContext\(request\)/g) || []).length, 2);
  assert.equal((reportsRoute.match(/session: session \|\| null/g) || []).length, 2);
  assert.equal((reportManager.match(/requestAdminJson\("\/api\/admin\/reports"/g) || []).length, 1);
  assert.doesNotMatch(reportManager, /readToken\(\)|fetch\([\s\S]*?\/api\/admin\/reports/);
});

test("admin report decisions recover from failures and prevent duplicate submission", () => {
  assert.match(reportManager, /function beginReportAction\(\)/);
  assert.match(reportManager, /if \(!mountedRef\.current \|\| actionInFlightRef\.current\) return null;/);
  assert.match(reportManager, /signal: request\.controller\.signal/);
  assert.match(reportManager, /function isCurrentReportAction/);
  assert.match(reportManager, /function finishReportAction/);
  assert.match(reportManager, /fallbackMessage: "Unable to update report\."/);
  assert.match(reportManager, /catch \(error\)[\s\S]*?error instanceof Error \? error\.message/);
  assert.match(reportManager, /finally \{[\s\S]*?finishReportAction\(request\)/);
  assert.equal((reportManager.match(/disabled=\{Boolean\(busyReportId\)\}/g) || []).length, 2);
  assert.match(reportManager, /busyReportId === reportId \? "Saving\.\.\." : "Resolve"/);
});

test("admin reports resolve the owning profile for profile, TV, shift, and venue targets", () => {
  const reportReader = adminService.match(/export async function getContentReports[\s\S]*?(?=export async function updateContentReport)/)?.[0] || "";
  assert.match(reportReader, /\.from\("mydancr_tv_videos"\)\.select\("id, dancer_id"\)/);
  assert.match(reportReader, /\.from\("shifts"\)\.select\("id, dancer_id, venue_id"\)/);
  assert.match(reportReader, /\.from\("dancer_profiles"\)\.select\("id, stage_name, slug"\)/);
  assert.match(reportReader, /\.from\("venues"\)\.select\("id, name, slug"\)/);
  assert.match(reportReader, /function profileTargetForReport\(report: any\)/);
  assert.match(reportReader, /profileTarget: profileTargetForReport\(report\)/);
});

test("admins can open the reported profile with the exact report reason and context", () => {
  assert.match(reportManager, /async function openReportedProfile\(report: Record<string, unknown>\)/);
  assert.match(reportManager, /asText\(profileTarget\.kind\) !== "dancer"/);
  assert.match(reportManager, /requestAdminDancerProfile\(profileId, controller\.signal\)/);
  assert.match(reportManager, /View reported profile/);
  assert.match(reportManager, /Why it was reported/);
  assert.match(reportManager, /Reporter details/);
  assert.match(reportManager, /Target record/);
  assert.match(reportManager, /<AdminDancerFullProfile[\s\S]*?activeTab="all"/);
  assert.match(liveShell, /data-admin-action="view-reported-profile"/);
  assert.match(liveShell, /openAdminFullProfile\(\{ id: report\.profileTarget\.id, name: report\.profileTarget\.label \}, button, report\)/);
  assert.match(liveShell, /function adminReportedProfileContextMarkup\(report\)[\s\S]*?Why it was reported[\s\S]*?Reporter details[\s\S]*?Target record/);
});
