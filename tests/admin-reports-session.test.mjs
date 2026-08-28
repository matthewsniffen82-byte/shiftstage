import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [adminDashboard, reportsRoute] = await Promise.all([
  readFile(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/reports/route.ts", import.meta.url), "utf8"),
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
