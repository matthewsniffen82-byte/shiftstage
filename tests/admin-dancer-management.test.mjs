import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [listRoute, detailRoute, rosterService, approvalsRoute, adminDashboard] = await Promise.all([
  readFile(new URL("../app/api/admin/dancers/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/dancers/[id]/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/admin-dancers.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/approvals/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8"),
]);

test("the dancer roster is a protected, paginated production query", () => {
  assert.match(listRoute, /const \{ client, session, user \} = await createRequestSupabaseContext\(request\)/);
  assert.match(listRoute, /await requireAdmin\(client, user\.id\)/);
  assert.match(listRoute, /\{ ok: true, roster, session: session \|\| null \}/);
  assert.match(listRoute, /parseAdminDancerRosterQuery\(request\.url\)/);
  assert.match(listRoute, /createAdminSupabaseClient\(\)/);
  assert.match(rosterService, /select\([^\n]+\{ count: "exact" \}\)/);
  assert.match(rosterService, /\.range\(from, to\)/);
  assert.match(rosterService, /pageSize: boundedInteger\(params\.get\("pageSize"\), 20, 10, 50\)/);
  assert.match(rosterService, /totalPages: Math\.max\(1, Math\.ceil\(total \/ input\.pageSize\)\)/);
});

test("the roster supports operational search and bounded server filters", () => {
  assert.match(rosterService, /ADMIN_DANCER_STATUSES[\s\S]*?"needs_action"[\s\S]*?"disabled"/);
  assert.match(rosterService, /ADMIN_DANCER_SCHEDULES[\s\S]*?"working_now"[\s\S]*?"upcoming"[\s\S]*?"no_schedule"/);
  assert.match(rosterService, /ADMIN_DANCER_MODERATION[\s\S]*?"pending"[\s\S]*?"clear"/);
  assert.match(rosterService, /ADMIN_DANCER_COMMISSIONS[\s\S]*?"active"[\s\S]*?"not_active"/);
  assert.match(rosterService, /ADMIN_DANCER_SOURCES[\s\S]*?"demo"[\s\S]*?"standard"/);
  assert.match(rosterService, /\["uploading", "moderating", "submitted"\]/);
  assert.match(rosterService, /stage_name\.ilike[\s\S]*?email\.ilike/);
  assert.match(rosterService, /input\.venueId/);
  assert.match(rosterService, /input\.city/);
});

test("admin dancer detail combines profile, media, operations, reports, and history", () => {
  assert.match(detailRoute, /getAdminDancerOperationalDetail/);
  assert.match(detailRoute, /profile: \{ \.\.\.profile, operations \}/);
  assert.match(rosterService, /venue_dancer_affiliations/);
  assert.match(rosterService, /mydancr_tv_videos/);
  assert.match(rosterService, /nats_affiliate_accounts/);
  assert.match(rosterService, /commission_events/);
  assert.match(rosterService, /content_reports/);
  assert.match(rosterService, /admin_actions/);
  assert.match(rosterService, /profileViews/);
  assert.match(rosterService, /directionRequests/);
});

test("reversible profile lifecycle actions require an admin and a recorded reason", () => {
  assert.match(detailRoute, /export async function PATCH/);
  assert.match(detailRoute, /body\?\.action === "disable" \|\| body\?\.action === "reactivate"/);
  assert.match(detailRoute, /await requireAdmin\(client, user\.id\)/);
  assert.match(rosterService, /Add a reason between 4 and 500 characters\./);
  assert.match(rosterService, /transitionDancerPublication\(client, input\.dancerId, input\.action/);
  assert.match(rosterService, /action: input\.action === "disable" \? "disable_dancer_profile" : "reactivate_dancer_profile"/);
});

test("the dashboard exposes a compact responsive roster and operational detail tabs", () => {
  assert.match(adminDashboard, /Stage name, city, email, or slug/);
  assert.match(adminDashboard, /Needs action/);
  assert.match(adminDashboard, /Working now/);
  assert.match(adminDashboard, /No schedule/);
  assert.match(adminDashboard, /Disabled \/ archived/);
  assert.match(adminDashboard, /Profile & media/);
  assert.match(adminDashboard, /Clubs & shifts/);
  assert.match(adminDashboard, /Club Deals & commissions/);
  assert.match(adminDashboard, /Analytics & reports/);
  assert.match(adminDashboard, /Admin account history/);
  assert.match(adminDashboard, /Disable profile/);
  assert.match(adminDashboard, /Reactivate profile/);
  assert.match(adminDashboard, /Permanent deletion/);
  assert.match(adminDashboard, /Type \$\{stageName\} to permanently delete this profile/);
  assert.match(adminDashboard, /page > data\.roster\.totalPages/);
  assert.match(adminDashboard, /setRefreshVersion\(\(value\) => value \+ 1\)/);
  assert.match(adminDashboard, /\.dancer-roster-filters/);
  assert.match(adminDashboard, /\.dancer-roster-data/);
  assert.match(adminDashboard, /@media \(max-width: 680px\)/);
});

test("dancer management keeps refreshed admin sessions across every roster operation", () => {
  assert.equal((detailRoute.match(/const \{ client, session, user \} = await createRequestSupabaseContext\(request\)/g) || []).length, 3);
  assert.equal((detailRoute.match(/session: session \|\| null/g) || []).length, 3);
  assert.match(adminDashboard, /requestAdminJson\(`\/api\/admin\/dancers\?\$\{params\.toString\(\)\}`/);
  assert.match(adminDashboard, /requestAdminJson\(`\/api\/admin\/dancers\/\$\{encodeURIComponent\(dancerId\)\}`/);
  assert.doesNotMatch(adminDashboard, /fetch\(`\/api\/admin\/dancers/);
});

test("approval loading no longer transfers the complete dancer table", () => {
  assert.doesNotMatch(approvalsRoute, /getAdminDancerDirectory/);
  assert.match(approvalsRoute, /count: "exact", head: true/);
  assert.match(approvalsRoute, /dancerTotal: Number\(count \|\| 0\)/);
  assert.match(adminDashboard, /Profiles in roster/);
  assert.match(adminDashboard, /\/api\/admin\/dancers\?/);
});

test("approval decisions use the refresh-aware role-isolated admin boundary", () => {
  assert.equal((approvalsRoute.match(/const \{ client, session, user \} = await createRequestSupabaseContext\(request\)/g) || []).length, 2);
  assert.equal((approvalsRoute.match(/session: session \|\| null/g) || []).length, 3);
  assert.equal((adminDashboard.match(/requestAdminJson\("\/api\/admin\/approvals"/g) || []).length, 2);
  assert.doesNotMatch(adminDashboard, /fetch\("\/api\/admin\/approvals"/);
});

test("approval profile and content actions share one abortable single-flight boundary", () => {
  const approvalQueue = adminDashboard.match(/function ApprovalQueue[\s\S]*?(?=type AdminPreview)/)?.[0] || "";
  const submissionDetails = adminDashboard.match(/function SubmissionDetails[\s\S]*?(?=function ReviewFeedbackMessage)/)?.[0] || "";
  assert.match(approvalQueue, /function beginApprovalAction\(\)/);
  assert.match(approvalQueue, /if \(!mountedRef\.current \|\| actionInFlightRef\.current\) return null;/);
  assert.match(approvalQueue, /function isCurrentApprovalAction/);
  assert.match(approvalQueue, /function finishApprovalAction/);
  assert.equal((approvalQueue.match(/const action = beginApprovalAction\(\)/g) || []).length, 3);
  assert.match(approvalQueue, /requestAdminDancerProfile\(asText\(item\.id\), action\.controller\.signal\)/);
  assert.match(approvalQueue, /requestAdminDancerContentDeletion\(dancerId, kind, targetId, action\.controller\.signal\)/);
  assert.match(submissionDetails, /const action = beginAction\(\)/);
  assert.match(submissionDetails, /signal: action\.controller\.signal/);
  assert.match(submissionDetails, /activeActionRef\.current\?\.controller\.abort\(\)/);
  assert.match(submissionDetails, /disabled=\{actionBusy\}/);
});
